import { describe, it, expect } from 'vitest';
import { betterPayment, mokaUnited as createMokaUnited } from '../../src';
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

// Moka United gives test dealers on request. Opt-in: these tests run only when the
// dealer's credentials are set. Non-3D payments need Moka United's approval.
const env = requireEnv(
  'MOKAUNITED_SANDBOX_DEALER_CODE',
  'MOKAUNITED_SANDBOX_USERNAME',
  'MOKAUNITED_SANDBOX_PASSWORD'
);

// A test card from developer.mokaunited.com: Moka United answers it without a bank
const card = sandboxCard('MOKAUNITED_SANDBOX', {
  cardHolderName: 'Test User',
  cardNumber: '5127541122223332',
  expireMonth: '12',
  expireYear: '2030',
  cvc: '000',
})!;

describe.skipIf(!env)('Moka United sandbox', () => {
  const moka = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          mokaunited: createMokaUnited({
            dealerCode: env.MOKAUNITED_SANDBOX_DEALER_CODE,
            username: env.MOKAUNITED_SANDBOX_USERNAME,
            password: env.MOKAUNITED_SANDBOX_PASSWORD,
          }),
        },
      }).mokaunited;

  it('charges, looks up and cancels a payment', async () => {
    const id = orderId('MU');
    const payment = await moka.createPayment(paymentRequest(card, { conversationId: id }));
    record('mokaunited', 'create-payment', payment.rawResponse);
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

    const lookup = await moka.getPayment(id);
    record('mokaunited', 'get-payment', lookup.rawResponse);
    expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

    const cancel = await moka.cancel({ paymentId: id, ip: '85.34.78.112' });
    record('mokaunited', 'cancel', cancel.rawResponse);
    expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
    expect((await moka.getPayment(id)).status).toBe(PaymentStatus.CANCELLED);
  });

  it('starts a 3D Secure payment and returns its CodeForHash', async () => {
    const init = await moka.initThreeDSPayment(
      threeDSRequest(card, { conversationId: orderId('MU') })
    );
    record('mokaunited', 'three-d', { ...(init.rawResponse as object), Data: '<redacted>' });
    expect(init.status, describeResult(init)).toBe(PaymentStatus.PENDING);
    expect(init.redirectUrl).toBeTruthy();
    expect((init as { codeForHash?: string }).codeForHash).toBeTruthy();
  });

  it('reads the card for a BIN', async () => {
    const bin = await moka.binCheck(card.cardNumber.slice(0, 8));
    record('mokaunited', 'bin', bin.rawResponse);
    expect(bin.bankName).toBeTruthy();
  });
});
