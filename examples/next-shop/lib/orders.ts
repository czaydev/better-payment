import { prisma } from './db';
import { cartSummary, readCart } from './cart';

/**
 * Order lifecycle:
 *
 *   NEW -> PENDING -> PAID -> REFUNDED
 *              \-> FAILED (a failed payment can be retried, which sets PENDING again)
 *
 * Only `payment.*` / `refund.*` events move an order past PAID/FAILED/REFUNDED,
 * so a browser return and a provider notification always behave the same.
 */
export const OrderStatus = {
  New: 'NEW',
  Pending: 'PENDING',
  Paid: 'PAID',
  Failed: 'FAILED',
  Refunded: 'REFUNDED',
} as const;

export type OrderStatusValue = (typeof OrderStatus)[keyof typeof OrderStatus];

/** An order that a new 3D Secure payment may be started for */
const PAYABLE: OrderStatusValue[] = [OrderStatus.New, OrderStatus.Pending, OrderStatus.Failed];

/** Letters and digits only: providers use the order id as conversationId */
function newOrderId(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD${stamp}${random}`;
}

/**
 * Creates the order on the server. The amount comes from database prices,
 * never from anything the browser sent.
 */
export async function createOrderFromCart(): Promise<string> {
  const summary = await cartSummary(await readCart());
  if (summary.rows.length === 0) {
    throw new Error('The cart is empty');
  }

  const id = newOrderId();
  await prisma.order.create({
    data: {
      id,
      status: OrderStatus.New,
      amountKurus: summary.totalKurus,
      currency: summary.currency,
      installment: 1,
      items: {
        create: summary.rows.map((row, index) => ({
          id: `${id}-${index + 1}`,
          productId: row.productId,
          name: row.name,
          quantity: row.quantity,
          unitPriceKurus: row.unitPriceKurus,
        })),
      },
    },
  });
  return id;
}

export async function getOrder(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: { items: true, refunds: { orderBy: { createdAt: 'desc' } } },
  });
}

export type OrderWithItems = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

export function isPayable(status: string): boolean {
  return PAYABLE.includes(status as OrderStatusValue);
}

/** Saves the installment the customer picked, only while the order can still be paid */
export async function setInstallment(id: string, installment: number): Promise<boolean> {
  const order = await getOrder(id);
  if (!order || !isPayable(order.status)) return false;
  await prisma.order.update({ where: { id }, data: { installment } });
  return true;
}

export async function listOrders(limit = 50) {
  return prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { items: true },
  });
}
