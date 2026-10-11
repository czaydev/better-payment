import { describe, it, expect } from 'vitest';
import { betterPayment, vakifKatilim as createVakifKatilim } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, paymentRequest, record, requireEnv, sandboxCard } from './setup';

// Vakıf Katılım gives test merchants and cards on request
const env = requireEnv(
  'VAKIFKATILIM_SANDBOX_MERCHANT_ID',
  'VAKIFKATILIM_SANDBOX_CUSTOMER_ID',
  'VAKIFKATILIM_SANDBOX_USERNAME',
  'VAKIFKATILIM_SANDBOX_PASSWORD'
);
const card = sandboxCard('VAKIFKATILIM_SANDBOX');

describe.skipIf(!env || !card)('Vakıf Katılım sandbox', () => {
  const vakifkatilim = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          vakifkatilim: createVakifKatilim({
            merchantId: env!.VAKIFKATILIM_SANDBOX_MERCHANT_ID,
            customerId: env!.VAKIFKATILIM_SANDBOX_CUSTOMER_ID,
            username: env!.VAKIFKATILIM_SANDBOX_USERNAME,
            password: env!.VAKIFKATILIM_SANDBOX_PASSWORD,
          }),
        },
      }).vakifkatilim;

  it('charges and cancels a non-3D payment', async () => {
    const payment = await vakifkatilim.createPayment(
      paymentRequest(card!, { conversationId: orderId('VK') })
    );
    record('vakifkatilim', 'create-payment', payment.rawResponse);
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

    const cancel = await vakifkatilim.cancel({ paymentId: payment.paymentId!, ip: '85.34.78.112' });
    record('vakifkatilim', 'cancel', cancel.rawResponse);
    expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
  });
});
