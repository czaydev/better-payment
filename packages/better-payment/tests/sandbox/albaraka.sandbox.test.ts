import { describe, it, expect } from 'vitest';
import { betterPayment, albaraka as createAlbaraka } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, paymentRequest, record, requireEnv, sandboxCard } from './setup';

// Albaraka Türk gives test merchants and cards on request
const env = requireEnv(
  'ALBARAKA_SANDBOX_MERCHANT_ID',
  'ALBARAKA_SANDBOX_TERMINAL_ID',
  'ALBARAKA_SANDBOX_POSNET_ID',
  'ALBARAKA_SANDBOX_ENC_KEY'
);
const card = sandboxCard('ALBARAKA_SANDBOX');

describe.skipIf(!env || !card)('Albaraka sandbox', () => {
  const albaraka = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          albaraka: createAlbaraka({
            merchantId: env!.ALBARAKA_SANDBOX_MERCHANT_ID,
            terminalId: env!.ALBARAKA_SANDBOX_TERMINAL_ID,
            posnetId: env!.ALBARAKA_SANDBOX_POSNET_ID,
            encKey: env!.ALBARAKA_SANDBOX_ENC_KEY,
          }),
        },
      }).albaraka;

  it('charges and cancels a non-3D payment', async () => {
    const payment = await albaraka.createPayment(
      paymentRequest(card!, { conversationId: orderId('ALB').slice(0, 20) })
    );
    record('albaraka', 'create-payment', payment.rawResponse);
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

    const cancel = await albaraka.cancel({ paymentId: payment.paymentId!, ip: '85.34.78.112' });
    record('albaraka', 'cancel', cancel.rawResponse);
    expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
  });
});
