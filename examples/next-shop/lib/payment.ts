import {
  betterPayment,
  iyzico,
  CALLBACK_HANDLER_ACTIONS,
  type BasketItem,
  type BetterPaymentLogger,
  type HandlerContext,
  type PaymentCard,
  type ThreeDSPaymentRequest,
} from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { localizedErrors } from 'better-payment/plugins';
import { randomUUID } from 'node:crypto';
import { prisma } from './db';
import { formatKurus } from './products';
import { getOrder, isPayable } from './orders';
import { demoAddress, demoBuyer } from './demo-customer';
import { hasDemoAdmin } from './admin';
import { PAYMENT_API_BASE } from './constants';

export { PAYMENT_API_BASE };

/**
 * The provider the demo uses. Without credentials everything runs on the
 * in-memory MockProvider: no network access, no real money, and the full 3D
 * Secure round trip is simulated. Set IYZICO_API_KEY + IYZICO_SECRET_KEY to
 * switch to the iyzico sandbox (its own test cards apply then).
 */
export const PROVIDER_ID: 'mock' | 'iyzico' =
  process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY ? 'iyzico' : 'mock';

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The card is read from the request body, passed straight to the provider and
 * never stored: nothing in the Prisma schema holds card data, and this function
 * returns before the payment even happened. In production the card should not
 * transit your server at all — use the provider's hosted fields/form.
 */
function readCard(value: unknown): PaymentCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('paymentCard is required');
  }
  const source = value as Record<string, unknown>;
  const card: PaymentCard = {
    cardHolderName: optionalText(source.cardHolderName) ?? '',
    cardNumber: optionalText(source.cardNumber) ?? '',
    expireMonth: optionalText(source.expireMonth) ?? '',
    expireYear: optionalText(source.expireYear) ?? '',
    cvc: optionalText(source.cvc) ?? '',
  };
  // The library validates the card itself (Luhn, expiry, cvc) and fails the
  // request before the provider is called; here we only reject empty shapes.
  if (!card.cardNumber || !card.expireMonth || !card.expireYear || !card.cvc) {
    throw new Error('paymentCard.cardNumber, expireMonth, expireYear and cvc are required');
  }
  return card;
}

function orderIdFrom(body: Record<string, unknown> | undefined): string {
  const orderId = optionalText(body?.orderId);
  if (!orderId) throw new Error('orderId is required');
  return orderId;
}

/**
 * The total the provider quoted for the chosen installment. The count is the
 * only thing the browser picked; the price asked for is the server-side order
 * total, and the answer comes from the provider, so no amount ever crosses the
 * trust boundary as a client value.
 */
async function quotedPaidPrice(
  cardNumber: string,
  total: string,
  conversationId: string,
  installment: number
): Promise<string> {
  if (installment <= 1) return total;
  const binNumber = cardNumber.replace(/\D/g, '').slice(0, 6);
  if (binNumber.length !== 6) return total;
  try {
    const quote = await getBetterPayment()
      .use(PROVIDER_ID)
      .installmentInfo({ binNumber, price: total, conversationId });
    const option = quote.installmentDetails?.[0]?.installmentPrices?.find(
      (price) => price.installmentNumber === installment
    );
    return option ? option.totalPrice.toFixed(2) : total;
  } catch {
    // A failed quote must not block a payment: the provider applies (and shows)
    // the commission on its own 3D Secure page.
    return total;
  }
}

/**
 * The browser sends only ids (orderId, and for installments the BIN it typed).
 * Everything that moves money — amount, currency, basket, installment — is
 * looked up from the database here. This is `transformRequest` in the docs:
 * amounts never come from the client.
 */
async function buildRequestFromDatabase(ctx: HandlerContext): Promise<object> {
  const body = ctx.body ?? {};

  if (ctx.action === 'payment/init-3ds') {
    const orderId = orderIdFrom(body);
    const order = await getOrder(orderId);
    if (!order) throw new Error(`Unknown order ${orderId}`);
    if (!isPayable(order.status)) throw new Error(`Order ${orderId} is not payable`);

    const origin = new URL(ctx.request.url).origin;
    const total = formatKurus(order.amountKurus);
    const paymentCard = readCard(body.paymentCard);
    const paidPrice = await quotedPaidPrice(
      paymentCard.cardNumber,
      total,
      order.id,
      order.installment
    );
    // What is about to be charged, kept on the order row so a refund returns
    // exactly that amount even when the provider added an installment commission.
    await prisma.order.update({
      where: { id: order.id },
      data: { paidPriceKurus: Math.round(Number(paidPrice) * 100) },
    });

    // Line totals use unit price x quantity; they add up to `price`, which is
    // what iyzico requires. The mock ignores it, real providers check it.
    const basketItems: BasketItem[] = order.items.map((item, index) => ({
      id: `BI${orderId}-${index + 1}`,
      name: item.name,
      category1: 'Demo',
      itemType: 'PHYSICAL',
      price: formatKurus(item.unitPriceKurus * item.quantity),
    }));

    const request: ThreeDSPaymentRequest = {
      price: total,
      paidPrice,
      currency: order.currency,
      basketId: order.id,
      conversationId: order.id,
      installment: order.installment,
      paymentCard,
      buyer: demoBuyer(order.id),
      shippingAddress: demoAddress('Demo Buyer'),
      billingAddress: demoAddress('Demo Buyer'),
      basketItems,
      // Where the bank posts the 3DS result. The handler verifies it and the
      // payment events update the order — the browser result is never trusted.
      callbackUrl: `${origin}${PAYMENT_API_BASE}/${PROVIDER_ID}/payment/complete-3ds`,
    };
    return request;
  }

  if (ctx.action === 'installment') {
    const orderId = orderIdFrom(body);
    const binNumber = optionalText(body.binNumber) ?? '';
    if (!/^\d{6,8}$/.test(binNumber)) throw new Error('binNumber must be 6-8 digits');
    const order = await getOrder(orderId);
    if (!order) throw new Error(`Unknown order ${orderId}`);
    // The price queried is the server-side order total, not a client value.
    return { binNumber, price: formatKurus(order.amountKurus), conversationId: order.id };
  }

  if (ctx.action === 'refund') {
    const orderId = orderIdFrom(body);
    const order = await getOrder(orderId);
    if (!order) throw new Error(`Unknown order ${orderId}`);
    if (order.status !== 'PAID' || !order.paymentId) {
      throw new Error(`Order ${orderId} is not a paid payment`);
    }
    return {
      paymentId: order.paymentId,
      price: formatKurus(order.paidPriceKurus ?? order.amountKurus),
      currency: order.currency,
      ip: '127.0.0.1',
      conversationId: order.id,
    };
  }

  return body;
}

function authorizeDemo(ctx: HandlerContext): boolean {
  // Provider callbacks come from the bank/customer browser and are verified by
  // the provider's signature; the handler only accepts them after verification.
  if (CALLBACK_HANDLER_ACTIONS.includes(ctx.action)) return true;
  // The checkout itself is customer-facing; amounts are forced server-side
  if (ctx.action === 'payment/init-3ds' || ctx.action === 'installment') return true;
  // `refund` is privileged: it is gated behind the demo admin cookie.
  if (ctx.action === 'refund') return hasDemoAdmin(ctx.request.headers);
  return false;
}

function centsOf(amount: string | undefined): number {
  return amount ? Math.round(Number(amount) * 100) : 0;
}

/**
 * Orders are updated ONLY by payment events. The same events fire for a 3D
 * Secure browser return and a server-to-server notification, so the two paths
 * can never disagree, and a forged callback emits nothing at all.
 */
function attachOrderEvents(payment: ReturnType<typeof createPayment>): void {
  payment.on('payment.succeeded', async (event) => {
    await prisma.order.updateMany({
      where: { id: event.conversationId ?? '' },
      data: { status: 'PAID', paymentId: event.paymentId ?? null, errorCode: null },
    });
  });

  payment.on('payment.pending', async (event) => {
    // The outcome is unknown (e.g. a lost response): never overwrite a final state.
    await prisma.order.updateMany({
      where: { id: event.conversationId ?? '', status: { notIn: ['PAID', 'REFUNDED'] } },
      data: { status: 'PENDING' },
    });
  });

  payment.on('payment.failed', async (event) => {
    await prisma.order.updateMany({
      where: { id: event.conversationId ?? '', status: { notIn: ['PAID', 'REFUNDED'] } },
      data: { status: 'FAILED', errorCode: event.code ?? 'UNKNOWN' },
    });
  });

  payment.on('refund.succeeded', async (event) => {
    const orderId = event.conversationId;
    if (!orderId) return;
    const providerRefundId = (event.result as { refundId?: unknown }).refundId;
    const amount = centsOf(event.amount);
    await prisma.order.updateMany({ where: { id: orderId }, data: { status: 'REFUNDED' } });
    await prisma.refund.create({
      data: {
        id: randomUUID(),
        providerRefundId: typeof providerRefundId === 'string' ? providerRefundId : null,
        orderId,
        paymentId: event.paymentId ?? '',
        amountKurus: amount,
      },
    });
  });
}

/**
 * Only messages and error text: the library never passes request/response
 * bodies to the logger, and this example must not log card data either.
 */
const logger: BetterPaymentLogger = {
  debug: () => undefined,
  info: () => undefined,
  error: (message, error) => console.error(`[better-payment] ${message}`, error?.message ?? ''),
};

function createPayment() {
  return betterPayment({
    mode: 'sandbox',
    logger,
    providers: {
      mock: new MockProvider(),
      ...(PROVIDER_ID === 'iyzico'
        ? {
            iyzico: iyzico({
              apiKey: process.env.IYZICO_API_KEY ?? '',
              secretKey: process.env.IYZICO_SECRET_KEY ?? '',
            }),
          }
        : {}),
    },
    defaultProvider: PROVIDER_ID,
    plugins: [
      // Customer-facing error messages in the browser's language: detectLocale
      // reads the Accept-Language header of each handler response (default true).
      localizedErrors({ locale: 'en' }),
    ],
    handler: {
      basePath: PAYMENT_API_BASE,
      // The smallest set this demo needs. Everything else (direct payments,
      // card storage, subscriptions) stays closed.
      allowedActions: ['payment/init-3ds', 'payment/complete-3ds', 'installment', 'refund'],
      authorize: authorizeDemo,
      transformRequest: buildRequestFromDatabase,
      // After a verified 3DS callback, send the shopper to the order page.
      callbackRedirect: (result) =>
        result.conversationId ? `/orders/${result.conversationId}?payment=${result.status}` : '/',
      // In-memory callback dedup is enough for one dev process. Production:
      // pass a shared store (Redis or your DB) — see the README.
    },
  });
}

let instance: ReturnType<typeof createPayment> | undefined;

/**
 * Lazy singleton: the first request creates the instance, so `next build` works
 * without any environment variables (the pattern the Next.js integration docs
 * describe). Event listeners are registered with the instance, once.
 */
export function getBetterPayment(): ReturnType<typeof createPayment> {
  if (!instance) {
    instance = createPayment();
    attachOrderEvents(instance);
  }
  return instance;
}
