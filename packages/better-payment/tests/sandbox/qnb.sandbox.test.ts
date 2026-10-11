import { describe, it, expect } from 'vitest';
import { betterPayment, qnb as createQnb } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, paymentRequest, record, requireEnv, sandboxCard } from './setup';

// QNB publishes its demo merchants and test cards on vpos.qnb.com.tr/Help
const env = requireEnv(
  'QNB_SANDBOX_MERCHANT_ID',
  'QNB_SANDBOX_USER_CODE',
  'QNB_SANDBOX_USER_PASS',
  'QNB_SANDBOX_MERCHANT_PASS'
);
const card = sandboxCard('QNB_SANDBOX');

describe.skipIf(!env)('QNB sandbox', () => {
  const qnb = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          qnb: createQnb({
            merchantId: env!.QNB_SANDBOX_MERCHANT_ID,
            userCode: env!.QNB_SANDBOX_USER_CODE,
            userPass: env!.QNB_SANDBOX_USER_PASS,
            merchantPass: env!.QNB_SANDBOX_MERCHANT_PASS,
          }),
        },
      }).qnb;

  it('reports an unknown order as failure instead of throwing', async () => {
    const result = await qnb.getPayment(orderId('QNBNONE'));
    record('qnb', 'status-unknown-order', result.rawResponse);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBeTruthy();
  });

  describe.skipIf(!card)('with a test card', () => {
    it('charges, looks up and cancels', async () => {
      const id = orderId('QNB');
      const payment = await qnb.createPayment(paymentRequest(card!, { conversationId: id }));
      record('qnb', 'create-payment', payment.rawResponse);
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const lookup = await qnb.getPayment(id);
      record('qnb', 'get-payment', lookup.rawResponse);
      expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

      const cancel = await qnb.cancel({ paymentId: id, ip: '85.34.78.112' });
      record('qnb', 'cancel', cancel.rawResponse);
      expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);

      const afterCancel = await qnb.getPayment(id);
      expect(afterCancel.status, describeResult(afterCancel)).toBe(PaymentStatus.CANCELLED);
    });
  });
});
