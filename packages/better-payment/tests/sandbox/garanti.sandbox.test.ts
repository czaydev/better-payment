import { describe, it, expect } from 'vitest';
import { betterPayment, garanti as createGaranti } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, paymentRequest, record, requireEnv, sandboxCard } from './setup';

// The Garanti BBVA test terminal and test cards are listed on dev.garantibbva.com.tr
const env = requireEnv(
  'GARANTI_SANDBOX_MERCHANT_ID',
  'GARANTI_SANDBOX_TERMINAL_ID',
  'GARANTI_SANDBOX_PASSWORD',
  'GARANTI_SANDBOX_STORE_KEY'
);
const card = sandboxCard('GARANTI_SANDBOX');

describe.skipIf(!env)('Garanti BBVA sandbox', () => {
  const garanti = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          garanti: createGaranti({
            merchantId: env!.GARANTI_SANDBOX_MERCHANT_ID,
            terminalId: env!.GARANTI_SANDBOX_TERMINAL_ID,
            password: env!.GARANTI_SANDBOX_PASSWORD,
            storeKey: env!.GARANTI_SANDBOX_STORE_KEY,
          }),
        },
      }).garanti;

  it('reports an unknown order as failure instead of throwing', async () => {
    const result = await garanti.getPayment(orderId('GARNONE'));
    record('garanti', 'status-unknown-order', result.rawResponse);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBeTruthy();
  });

  it('returns a signed 3D form', async () => {
    const id = orderId('GAR3D');
    const init = await garanti.initThreeDSPayment({
      ...paymentRequest(
        card ??
          sandboxCard('NONE', {
            cardHolderName: 'Test User',
            cardNumber: '5549603469426017',
            expireMonth: '01',
            expireYear: '2027',
            cvc: '916',
          })!,
        { conversationId: id }
      ),
      callbackUrl: 'https://example.com/api/pay/garanti/payment/complete-3ds',
    });
    expect(init.status, describeResult(init)).toBe(PaymentStatus.PENDING);
    expect(init.threeDSHtmlContent).toContain(
      'sanalposprovtest.garantibbva.com.tr/servlet/gt3dengine'
    );
  });

  describe.skipIf(!card)('with a test card', () => {
    it('charges, looks up and cancels', async () => {
      const id = orderId('GAR');
      const payment = await garanti.createPayment(paymentRequest(card!, { conversationId: id }));
      record('garanti', 'create-payment', payment.rawResponse);
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const lookup = await garanti.getPayment(id);
      record('garanti', 'get-payment', lookup.rawResponse);
      expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

      const cancel = await garanti.cancel({ paymentId: id, ip: '85.34.78.112' });
      record('garanti', 'cancel', cancel.rawResponse);
      expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);

      const afterCancel = await garanti.getPayment(id);
      expect(afterCancel.status, describeResult(afterCancel)).toBe(PaymentStatus.CANCELLED);
    });

    it('refunds part of a payment', async () => {
      const id = orderId('GAR');
      const payment = await garanti.createPayment(paymentRequest(card!, { conversationId: id }));
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const refund = await garanti.refund({
        paymentId: id,
        price: '0.5',
        currency: 'TRY',
        ip: '85.34.78.112',
      });
      record('garanti', 'refund', refund.rawResponse);
      expect(refund.status, describeResult(refund)).toBe(PaymentStatus.SUCCESS);
      expect(refund.refundId).toBeTruthy();
    });
  });
});
