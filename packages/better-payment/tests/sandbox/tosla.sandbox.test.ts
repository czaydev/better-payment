import { describe, it, expect } from 'vitest';
import { betterPayment, tosla as createTosla } from '../../src';
import { PaymentStatus } from '../../src/types';
import { describeResult, orderId, record, requireEnv, sandboxCard, threeDSRequest } from './setup';

// Tosla gives test merchants and cards on request. Opt-in: these tests run only
// when the merchant's credentials are set.
const env = requireEnv(
  'TOSLA_SANDBOX_CLIENT_ID',
  'TOSLA_SANDBOX_API_USER',
  'TOSLA_SANDBOX_API_PASS'
);
const card = sandboxCard('TOSLA_SANDBOX');

// 3D Secure needs a browser. To verify completion, refund and void:
// 1. Run the session test below and open the returned threeDSHtmlContent in a browser
//    (or use your own checkout page), completing 3D Secure with the test card.
// 2. Set TOSLA_SANDBOX_PAID_ORDER_ID to that order id and TOSLA_SANDBOX_PAID_AMOUNT to
//    its amount (e.g. "1.00"), then run this file again.
const paid = requireEnv('TOSLA_SANDBOX_PAID_ORDER_ID', 'TOSLA_SANDBOX_PAID_AMOUNT');

describe.skipIf(!env)('Tosla sandbox', () => {
  const tosla = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          tosla: createTosla({
            clientId: env.TOSLA_SANDBOX_CLIENT_ID,
            apiUser: env.TOSLA_SANDBOX_API_USER,
            apiPass: env.TOSLA_SANDBOX_API_PASS,
          }),
        },
      }).tosla;

  it.skipIf(!card)('opens a 3D Secure session and returns the card form', async () => {
    const id = orderId('TS');
    const init = await tosla.initThreeDSPayment(threeDSRequest(card!, { conversationId: id }));
    record('tosla', 'three-d-session', {
      ...(init.rawResponse as object),
      ThreeDSessionId: '<redacted>',
    });
    expect(init.status, describeResult(init)).toBe(PaymentStatus.PENDING);
    expect(init.threeDSHtmlContent).toContain('/api/Payment/ProcessCardForm');
    expect(init.paymentId).toBe(id);
  });

  it('reads the card and installment rates for a BIN', async () => {
    const options = await tosla.installmentInfo({
      binNumber: (card?.cardNumber ?? '540667').slice(0, 6),
      price: '100.00',
    });
    record('tosla', 'installment-info', options.rawResponse);
    expect(options.status, describeResult(options)).toBe(PaymentStatus.SUCCESS);
    expect(options.installmentDetails?.[0].installmentPrices.length).toBeGreaterThan(0);
  });

  describe.skipIf(!paid)('a payment completed by hand (see the steps above)', () => {
    it('confirms it with an inquiry, only for the right order and amount', async () => {
      const callback = { OrderId: paid!.TOSLA_SANDBOX_PAID_ORDER_ID };
      const result = await tosla.completeThreeDSPayment(callback, {
        orderId: paid!.TOSLA_SANDBOX_PAID_ORDER_ID,
        amount: paid!.TOSLA_SANDBOX_PAID_AMOUNT,
      });
      record('tosla', 'complete-3d', result.rawResponse);
      expect(result.status, describeResult(result)).toBe(PaymentStatus.SUCCESS);

      const wrongAmount = await tosla.completeThreeDSPayment(callback, { amount: '999.99' });
      expect(wrongAmount.errorCode).toBe('INVALID_HASH');
      expect(wrongAmount.paymentId).toBeUndefined();
    });

    it('voids it the same day', async () => {
      const cancel = await tosla.cancel({
        paymentId: paid!.TOSLA_SANDBOX_PAID_ORDER_ID,
        ip: '85.34.78.112',
      });
      record('tosla', 'void', cancel.rawResponse);
      expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
    });
  });
});
