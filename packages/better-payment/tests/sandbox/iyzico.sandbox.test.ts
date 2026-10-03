import { describe, it, expect } from 'vitest';
import { betterPayment, iyzico as createIyzico } from '../../src';
import { PaymentStatus } from '../../src/types';
import {
  CALLBACK_URL,
  describeResult,
  order,
  orderId,
  paymentRequest,
  record,
  requireEnv,
  sandboxCard,
  threeDSRequest,
  withSandboxRetry,
} from './setup';

const env = requireEnv('IYZICO_SANDBOX_API_KEY', 'IYZICO_SANDBOX_SECRET_KEY');

// Published iyzico sandbox test cards
const card = sandboxCard('IYZICO_SANDBOX', {
  cardHolderName: 'John Doe',
  cardNumber: '5528790000000008',
  expireMonth: '12',
  expireYear: '2030',
  cvc: '123',
})!;
const insufficientFundsCard = { ...card, cardNumber: '4111111111111129' };

describe.skipIf(!env)('iyzico sandbox', () => {
  const iyzico = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          iyzico: createIyzico({
            apiKey: env!.IYZICO_SANDBOX_API_KEY,
            secretKey: env!.IYZICO_SANDBOX_SECRET_KEY,
          }),
        },
      }).iyzico;

  it('charges, looks up and partially refunds a payment', async () => {
    const payment = await withSandboxRetry(() =>
      iyzico.createPayment(paymentRequest(card, { conversationId: orderId('IYZ') }))
    );
    record('iyzico', 'create-payment', payment.rawResponse);
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);
    expect(payment.paymentId).toBeTruthy();

    const lookup = await iyzico.getPayment(payment.paymentId!);
    record('iyzico', 'get-payment', lookup.rawResponse);
    expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);
    expect(lookup.paymentId).toBe(payment.paymentId);

    const refund = await iyzico.refund({
      paymentId: payment.paymentId!,
      price: '0.1',
      currency: 'TRY',
      ip: '85.34.78.112',
    });
    record('iyzico', 'refund', refund.rawResponse);
    expect(refund.status, describeResult(refund)).toBe(PaymentStatus.SUCCESS);

    const raw = payment.rawResponse as { itemTransactions?: { paymentTransactionId: string }[] };
    const transactionId = raw.itemTransactions?.[0]?.paymentTransactionId;
    expect(transactionId).toBeTruthy();

    const itemRefund = await iyzico.refund({
      paymentId: payment.paymentId!,
      paymentTransactionId: transactionId!,
      price: '0.1',
      currency: 'TRY',
      ip: '85.34.78.112',
    });
    record('iyzico', 'refund-item', itemRefund.rawResponse);
    expect(itemRefund.status, describeResult(itemRefund)).toBe(PaymentStatus.SUCCESS);
  });

  it('cancels a payment', async () => {
    const payment = await withSandboxRetry(() =>
      iyzico.createPayment(paymentRequest(card, { conversationId: orderId('IYZ') }))
    );
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

    const cancel = await iyzico.cancel({ paymentId: payment.paymentId!, ip: '85.34.78.112' });
    record('iyzico', 'cancel', cancel.rawResponse);
    expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
  });

  it('pre-authorizes and captures part of the amount', async () => {
    const auth = await withSandboxRetry(() =>
      iyzico.authorize(paymentRequest(card, { conversationId: orderId('IYZ') }))
    );
    record('iyzico', 'preauth', auth.rawResponse);
    expect(auth.status, describeResult(auth)).toBe(PaymentStatus.SUCCESS);

    const capture = await iyzico.capture({
      paymentId: auth.paymentId!,
      amount: '0.60',
      currency: 'TRY',
      ip: '85.34.78.112',
    });
    record('iyzico', 'postauth', capture.rawResponse);
    expect(capture.status, describeResult(capture)).toBe(PaymentStatus.SUCCESS);
  });

  it('pre-authorizes and voids without charging', async () => {
    const auth = await withSandboxRetry(() =>
      iyzico.authorize(paymentRequest(card, { conversationId: orderId('IYZ') }))
    );
    expect(auth.status, describeResult(auth)).toBe(PaymentStatus.SUCCESS);

    const voided = await iyzico.voidAuthorization({
      paymentId: auth.paymentId!,
      ip: '85.34.78.112',
    });
    record('iyzico', 'preauth-void', voided.rawResponse);
    expect(voided.status, describeResult(voided)).toBe(PaymentStatus.SUCCESS);
  });

  it('starts a 3D Secure pre-authorization', async () => {
    const result = await iyzico.initThreeDSAuthorize(
      threeDSRequest(card, { conversationId: orderId('IYZ') })
    );
    record('iyzico', 'init-3ds-preauth', result.rawResponse);
    expect(result.status, describeResult(result)).not.toBe(PaymentStatus.FAILURE);
    expect(result.threeDSHtmlContent).toMatch(/<form|<html/i);
  });

  it('saves a card during a payment, charges it by token, lists and deletes it', async () => {
    const first = await withSandboxRetry(() =>
      iyzico.createPayment(paymentRequest(card, { conversationId: orderId('IYZ'), saveCard: true }))
    );
    record('iyzico', 'payment-save-card', first.rawResponse);
    expect(first.status, describeResult(first)).toBe(PaymentStatus.SUCCESS);
    expect(first.storedCard?.customerToken).toBeTruthy();
    expect(first.storedCard?.cardToken).toBeTruthy();
    const storedCard = {
      customerToken: first.storedCard!.customerToken,
      cardToken: first.storedCard!.cardToken!,
    };

    const listed = await iyzico.listCards({ customerToken: storedCard.customerToken });
    record('iyzico', 'card-list', listed.rawResponse);
    expect(listed.status, describeResult(listed)).toBe(PaymentStatus.SUCCESS);
    expect(listed.cards.map((c) => c.cardToken)).toContain(storedCard.cardToken);

    const order = paymentRequest(card, { conversationId: orderId('IYZ') });
    const again = await withSandboxRetry(() =>
      iyzico.createPayment({ ...order, paymentCard: undefined, storedCard })
    );
    record('iyzico', 'payment-stored-card', again.rawResponse);
    expect(again.status, describeResult(again)).toBe(PaymentStatus.SUCCESS);

    const deleted = await iyzico.deleteCard(storedCard);
    record('iyzico', 'card-delete', deleted.rawResponse);
    expect(deleted.status, describeResult(deleted)).toBe(PaymentStatus.SUCCESS);
  });

  it('reports a declined card as failure with the provider error', async () => {
    const payment = await withSandboxRetry(() =>
      iyzico.createPayment(
        paymentRequest(insufficientFundsCard, { conversationId: orderId('IYZ') })
      )
    );
    record('iyzico', 'create-payment-declined', payment.rawResponse);
    expect(payment.status).toBe(PaymentStatus.FAILURE);
    expect(payment.errorCode).toBeTruthy();
  });

  it('starts a 3D Secure payment and returns the bank form', async () => {
    const result = await iyzico.initThreeDSPayment(
      threeDSRequest(card, { conversationId: orderId('IYZ') })
    );
    record('iyzico', 'init-3ds', result.rawResponse);
    expect(result.status, describeResult(result)).not.toBe(PaymentStatus.FAILURE);
    expect(result.threeDSHtmlContent).toMatch(/<form|<html/i);
  });

  it('initializes a checkout form', async () => {
    const result = await iyzico.initCheckoutForm({
      ...order(),
      conversationId: orderId('IYZ'),
      callbackUrl: CALLBACK_URL,
    });
    record('iyzico', 'checkout-form-init', result.rawResponse);
    expect(result.status, describeResult(result)).toBe(PaymentStatus.SUCCESS);
    expect(result.token).toBeTruthy();
  });

  it('looks up BIN and installment information', async () => {
    const bin = await iyzico.binCheck(card.cardNumber.slice(0, 6));
    record('iyzico', 'bin-check', bin.rawResponse);
    expect(bin.bankName).toBeTruthy();

    const installments = await iyzico.installmentInfo({
      binNumber: card.cardNumber.slice(0, 6),
      price: '100',
    });
    record('iyzico', 'installment-info', installments.rawResponse);
    expect(installments.status, describeResult(installments)).toBe(PaymentStatus.SUCCESS);
    expect(installments.installmentDetails?.length).toBeGreaterThan(0);
  });
});
