import { describe, it, expect } from 'vitest';
import { betterPayment, qnbpay as createQnbpay } from '../../src';
import { PaymentStatus } from '../../src/types';
import {
  describeResult,
  orderId,
  paymentRequest,
  record,
  requireEnv,
  sandboxCard,
  threeDSRequest,
  withSandboxRetry,
} from './setup';

// QNBpay gives test merchants and cards on request. Opt-in: these tests run only
// when the merchant's credentials are set. Non-3D payments need QNBpay's approval.
const env = requireEnv(
  'QNBPAY_SANDBOX_APP_ID',
  'QNBPAY_SANDBOX_APP_SECRET',
  'QNBPAY_SANDBOX_MERCHANT_KEY'
);
const card = sandboxCard('QNBPAY_SANDBOX');

describe.skipIf(!env || !card)('QNBpay sandbox', () => {
  const qnbpay = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          qnbpay: createQnbpay({
            appId: env.QNBPAY_SANDBOX_APP_ID,
            appSecret: env.QNBPAY_SANDBOX_APP_SECRET,
            merchantKey: env.QNBPAY_SANDBOX_MERCHANT_KEY,
          }),
        },
      }).qnbpay;

  it('charges, looks up and refunds part of a payment', async () => {
    const id = orderId('QP');
    const payment = await withSandboxRetry(() =>
      qnbpay.createPayment(paymentRequest(card!, { conversationId: id }))
    );
    record('qnbpay', 'create-payment', payment.rawResponse);
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

    const lookup = await qnbpay.getPayment(id);
    record('qnbpay', 'get-payment', lookup.rawResponse);
    expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

    const refund = await qnbpay.refund({
      paymentId: id,
      price: '0.5',
      currency: 'TRY',
      ip: '85.34.78.112',
    });
    record('qnbpay', 'refund', refund.rawResponse);
    expect(refund.status, describeResult(refund)).toBe(PaymentStatus.SUCCESS);
  });

  it('cancels a payment and reports it cancelled', async () => {
    const id = orderId('QP');
    const payment = await withSandboxRetry(() =>
      qnbpay.createPayment(paymentRequest(card!, { conversationId: id }))
    );
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

    const cancel = await qnbpay.cancel({ paymentId: id, ip: '85.34.78.112' });
    record('qnbpay', 'cancel', cancel.rawResponse);
    expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
    expect((await qnbpay.getPayment(id)).status).toBe(PaymentStatus.CANCELLED);
  });

  it('starts a 3D Secure payment', async () => {
    const init = await qnbpay.initThreeDSPayment(
      threeDSRequest(card!, { conversationId: orderId('QP') })
    );
    expect(init.status, describeResult(init)).toBe(PaymentStatus.PENDING);
    expect(init.threeDSHtmlContent).toBeTruthy();
  });
});
