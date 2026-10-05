import { describe, it, expect } from 'vitest';
import { betterPayment, paytr as createPaytr } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, record, requireEnv, sandboxCard, threeDSRequest } from './setup';

const env = requireEnv(
  'PAYTR_SANDBOX_MERCHANT_ID',
  'PAYTR_SANDBOX_MERCHANT_KEY',
  'PAYTR_SANDBOX_MERCHANT_SALT'
);

// PayTR's iFrame flow does not send card data; the card is only used for BIN queries
const card = sandboxCard('PAYTR_SANDBOX', {
  cardHolderName: 'Test User',
  cardNumber: '4355084355084358',
  expireMonth: '12',
  expireYear: '2030',
  cvc: '000',
})!;

describe.skipIf(!env)('PayTR sandbox (test_mode=1)', () => {
  const paytr = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          paytr: createPaytr({
            merchantId: env!.PAYTR_SANDBOX_MERCHANT_ID,
            merchantKey: env!.PAYTR_SANDBOX_MERCHANT_KEY,
            merchantSalt: env!.PAYTR_SANDBOX_MERCHANT_SALT,
          }),
        },
      }).paytr;

  it('gets an iFrame token for a payment (signature accepted)', async () => {
    const id = orderId('PTR');
    const result = await paytr.initThreeDSPayment(threeDSRequest(card, { conversationId: id }));
    record('paytr', 'get-token', result.rawResponse);
    expect(result.status, describeResult(result)).toBe(PaymentStatus.PENDING);
    expect(result.paymentId).toBe(id);
    expect(result.redirectUrl).toContain('/odeme/guvenli/');
    expect(result.threeDSHtmlContent).toContain('<iframe');
  });

  it('reports an unknown order as failure instead of throwing', async () => {
    const result = await paytr.getPayment(orderId('PTRNONE'));
    record('paytr', 'status-unknown-order', result.rawResponse);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBeTruthy();
  });

  it('rejects a refund for an unknown order', async () => {
    const result = await paytr.refund({
      paymentId: orderId('PTRNONE'),
      price: '1',
      currency: 'TRY',
      ip: '85.34.78.112',
    });
    record('paytr', 'refund-unknown-order', result.rawResponse);
    expect(result.status).toBe(PaymentStatus.FAILURE);
  });

  it('returns installment options for a BIN', async () => {
    const result = await paytr.installmentInfo({
      binNumber: card.cardNumber.slice(0, 6),
      price: '100',
    });
    record('paytr', 'installment-info', result.rawResponse);
    expect(result.status, describeResult(result)).toBe(PaymentStatus.SUCCESS);
  });
});
