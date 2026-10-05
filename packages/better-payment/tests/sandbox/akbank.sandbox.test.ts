import { describe, it, expect } from 'vitest';
import { betterPayment, akbank as createAkbank } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, paymentRequest, record, requireEnv, sandboxCard } from './setup';

const env = requireEnv(
  'AKBANK_SANDBOX_MERCHANT_SAFE_ID',
  'AKBANK_SANDBOX_TERMINAL_SAFE_ID',
  'AKBANK_SANDBOX_SECRET_KEY'
);
// Akbank's test cards are issued with the test terminal
const card = sandboxCard('AKBANK_SANDBOX');

describe.skipIf(!env)('Akbank sandbox', () => {
  const akbank = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          akbank: createAkbank({
            merchantSafeId: env!.AKBANK_SANDBOX_MERCHANT_SAFE_ID,
            terminalSafeId: env!.AKBANK_SANDBOX_TERMINAL_SAFE_ID,
            secretKey: env!.AKBANK_SANDBOX_SECRET_KEY,
          }),
        },
      }).akbank;

  it('reports an unknown order as failure instead of throwing', async () => {
    const result = await akbank.getPayment(orderId('AKBNONE'));
    record('akbank', 'status-unknown-order', result.rawResponse);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBeTruthy();
  });

  describe.skipIf(!card)('with a test card', () => {
    it('charges, looks up, refunds and cancels', async () => {
      const id = orderId('AKB');
      const payment = await akbank.createPayment(paymentRequest(card!, { conversationId: id }));
      record('akbank', 'create-payment', payment.rawResponse);
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const lookup = await akbank.getPayment(id);
      record('akbank', 'get-payment', lookup.rawResponse);
      expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

      const cancel = await akbank.cancel({ paymentId: id, ip: '85.34.78.112' });
      record('akbank', 'cancel', cancel.rawResponse);
      expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
    });

    it('refunds part of a payment', async () => {
      const id = orderId('AKB');
      const payment = await akbank.createPayment(paymentRequest(card!, { conversationId: id }));
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const refund = await akbank.refund({
        paymentId: id,
        price: '0.5',
        currency: 'TRY',
        ip: '85.34.78.112',
      });
      record('akbank', 'refund', refund.rawResponse);
      expect(refund.status, describeResult(refund)).toBe(PaymentStatus.SUCCESS);
    });
  });
});
