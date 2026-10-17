import { describe, it, expect } from 'vitest';
import { betterPayment, lidio as createLidio } from '../../src';
import { PaymentStatus } from '../../src/types';
import {
  describeResult,
  orderId,
  paymentRequest,
  record,
  requireEnv,
  sandboxCard,
  threeDSRequest,
} from './setup';

// Lidio gives test merchants to its customers (destek@lidio.com). Opt-in: these
// tests run only when the merchant's credentials are set.
const env = requireEnv(
  'LIDIO_SANDBOX_MERCHANT_CODE',
  'LIDIO_SANDBOX_API_KEY',
  'LIDIO_SANDBOX_MERCHANT_KEY'
);

// Garanti BBVA test card from Lidio's "Test Card Numbers" page (3D code 147852)
const card = sandboxCard('LIDIO_SANDBOX', {
  cardHolderName: 'Test User',
  cardNumber: '5549602257210013',
  expireMonth: '02',
  expireYear: '2030',
  cvc: '689',
})!;

describe.skipIf(!env)('Lidio sandbox', () => {
  const lidio = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          lidio: createLidio({
            merchantCode: env.LIDIO_SANDBOX_MERCHANT_CODE,
            apiKey: env.LIDIO_SANDBOX_API_KEY,
            merchantKey: env.LIDIO_SANDBOX_MERCHANT_KEY,
          }),
        },
      }).lidio;

  it('charges, looks up and cancels a payment', async () => {
    const id = orderId('LD');
    const payment = await lidio.createPayment(paymentRequest(card, { conversationId: id }));
    record('lidio', 'create-payment', payment.rawResponse);
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

    const lookup = await lidio.getPayment(id);
    record('lidio', 'get-payment', lookup.rawResponse);
    expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

    const cancel = await lidio.cancel({ paymentId: id, ip: '85.34.78.112' });
    record('lidio', 'cancel', cancel.rawResponse);
    expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);

    const after = await lidio.getPayment(id);
    record('lidio', 'get-payment-cancelled', after.rawResponse);
    expect(after.status, describeResult(after)).toBe(PaymentStatus.CANCELLED);
  });

  it('starts a 3D Secure payment with a redirect form', async () => {
    const init = await lidio.initThreeDSPayment(
      threeDSRequest(card, { conversationId: orderId('LD') })
    );
    record('lidio', 'three-d', init.rawResponse);
    expect(init.status, describeResult(init)).toBe(PaymentStatus.PENDING);
    expect(init.threeDSHtmlContent).toBeTruthy();
  });

  it('reads the card for a BIN', async () => {
    const bin = await lidio.binCheck(card.cardNumber.slice(0, 6));
    record('lidio', 'bin', bin.rawResponse);
    expect(bin.bankCode).toBeGreaterThan(0);
  });
});
