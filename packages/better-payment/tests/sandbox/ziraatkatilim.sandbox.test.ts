import { describe, it, expect } from 'vitest';
import { betterPayment, ziraatKatilim as createZiraatKatilim } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, paymentRequest, record, requireEnv, sandboxCard } from './setup';

// Ziraat Katılım gives test merchants and cards on request
const env = requireEnv(
  'ZIRAAT_KATILIM_SANDBOX_MBR_ID',
  'ZIRAAT_KATILIM_SANDBOX_MERCHANT_ID',
  'ZIRAAT_KATILIM_SANDBOX_USER_CODE',
  'ZIRAAT_KATILIM_SANDBOX_USER_PASS',
  'ZIRAAT_KATILIM_SANDBOX_MERCHANT_PASS'
);
const card = sandboxCard('ZIRAAT_KATILIM_SANDBOX');

describe.skipIf(!env)('Ziraat Katılım sandbox', () => {
  const ziraatkatilim = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          ziraatkatilim: createZiraatKatilim({
            mbrId: env!.ZIRAAT_KATILIM_SANDBOX_MBR_ID,
            merchantId: env!.ZIRAAT_KATILIM_SANDBOX_MERCHANT_ID,
            userCode: env!.ZIRAAT_KATILIM_SANDBOX_USER_CODE,
            userPass: env!.ZIRAAT_KATILIM_SANDBOX_USER_PASS,
            merchantPass: env!.ZIRAAT_KATILIM_SANDBOX_MERCHANT_PASS,
          }),
        },
      }).ziraatkatilim;

  it('reports an unknown order as failure instead of throwing', async () => {
    const result = await ziraatkatilim.getPayment(orderId('ZKNONE'));
    record('ziraatkatilim', 'status-unknown-order', result.rawResponse);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBeTruthy();
  });

  describe.skipIf(!card)('with a test card', () => {
    it('charges, looks up and cancels', async () => {
      const id = orderId('ZK');
      const payment = await ziraatkatilim.createPayment(
        paymentRequest(card!, { conversationId: id })
      );
      record('ziraatkatilim', 'create-payment', payment.rawResponse);
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const lookup = await ziraatkatilim.getPayment(id);
      expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

      const cancel = await ziraatkatilim.cancel({ paymentId: id, ip: '85.34.78.112' });
      expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);

      const afterCancel = await ziraatkatilim.getPayment(id);
      expect(afterCancel.status, describeResult(afterCancel)).toBe(PaymentStatus.CANCELLED);
    });
  });
});
