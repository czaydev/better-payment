import { describe, it, expect } from 'vitest';
import { betterPayment, paratika as createParatika } from '../../src';
import type { ParatikaBrand } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, paymentRequest, record, requireEnv, sandboxCard } from './setup';

// Paratika, VakıfPay and ZiraatPay give test merchants on request; the docs list test cards
const env = requireEnv(
  'PARATIKA_SANDBOX_MERCHANT',
  'PARATIKA_SANDBOX_MERCHANT_USER',
  'PARATIKA_SANDBOX_MERCHANT_PASSWORD'
);
const card = sandboxCard('PARATIKA_SANDBOX');
const brand = (process.env.PARATIKA_SANDBOX_BRAND || 'paratika') as ParatikaBrand;

describe.skipIf(!env)('Paratika sandbox', () => {
  const paratika = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          paratika: createParatika({
            brand,
            merchant: env!.PARATIKA_SANDBOX_MERCHANT,
            merchantUser: env!.PARATIKA_SANDBOX_MERCHANT_USER,
            merchantPassword: env!.PARATIKA_SANDBOX_MERCHANT_PASSWORD,
            secretKey: process.env.PARATIKA_SANDBOX_SECRET_KEY,
          }),
        },
      }).paratika;

  it('returns installment options for a BIN', async () => {
    const result = await paratika.installmentInfo({ binNumber: '402277', price: '100' });
    record('paratika', 'installment-info', result.rawResponse);
    expect(result.status, describeResult(result)).toBe(PaymentStatus.SUCCESS);
  });

  describe.skipIf(!card)('with a test card', () => {
    it('charges, looks up and cancels a non-3D payment', async () => {
      const payment = await paratika.createPayment(
        paymentRequest(card!, { conversationId: orderId('PTK') })
      );
      record('paratika', 'create-payment', payment.rawResponse);
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const lookup = await paratika.getPayment(payment.paymentId!);
      expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

      const cancel = await paratika.cancel({ paymentId: payment.paymentId!, ip: '85.34.78.112' });
      expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
    });
  });
});
