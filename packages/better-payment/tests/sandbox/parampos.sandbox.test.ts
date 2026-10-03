import { describe, it, expect } from 'vitest';
import { betterPayment, parampos as createParampos } from '../../src';
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

const env = requireEnv(
  'PARAMPOS_SANDBOX_CLIENT_CODE',
  'PARAMPOS_SANDBOX_CLIENT_USERNAME',
  'PARAMPOS_SANDBOX_CLIENT_PASSWORD',
  'PARAMPOS_SANDBOX_GUID'
);
// Param's test cards are issued with the test account
const card = sandboxCard('PARAMPOS_SANDBOX');

describe.skipIf(!env)('Parampos sandbox', () => {
  const parampos = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          parampos: createParampos({
            clientCode: env!.PARAMPOS_SANDBOX_CLIENT_CODE,
            clientUsername: env!.PARAMPOS_SANDBOX_CLIENT_USERNAME,
            clientPassword: env!.PARAMPOS_SANDBOX_CLIENT_PASSWORD,
            guid: env!.PARAMPOS_SANDBOX_GUID,
            ...(process.env.PARAMPOS_SANDBOX_BASE_URL
              ? { baseUrl: process.env.PARAMPOS_SANDBOX_BASE_URL }
              : {}),
          }),
        },
      }).parampos;

  it('reports an unknown order as failure instead of throwing', async () => {
    const result = await parampos.getPayment(orderId('PRMNONE'));
    record('parampos', 'status-unknown-order', result.rawResponse);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBeTruthy();
  });

  it('lists the merchant installment rates (TP_Ozel_Oran_SK_Liste)', async () => {
    const programs = await parampos.getInstallmentRates();
    expect(programs.length).toBeGreaterThan(0);
    expect(programs.some((p) => p.rates[1] !== undefined)).toBe(true);
  });

  it('returns installment options with totals for a BIN', async () => {
    const binNumber = card?.cardNumber.slice(0, 6) ?? '552879';
    const result = await parampos.installmentInfo({ binNumber, price: '100.00' });
    record('parampos', 'installment-info', result.rawResponse);
    expect(result.status, describeResult(result)).toBe(PaymentStatus.SUCCESS);
    const options = result.installmentDetails?.[0].installmentPrices ?? [];
    for (const option of options) {
      expect(option.totalPrice).toBeGreaterThanOrEqual(100);
    }
  });

  describe.skipIf(!card)('with a test card', () => {
    it('starts a 3D payment (TP_WMD_UCD) and returns the bank form', async () => {
      const id = orderId('PRM');
      const result = await parampos.initThreeDSPayment(
        threeDSRequest(card!, { conversationId: id })
      );
      record('parampos', 'init-3ds', result.rawResponse);
      expect(result.status, describeResult(result)).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe(id);
      expect(result.threeDSHtmlContent).toMatch(/<form|<html/i);
    });

    it('charges, looks up and cancels a non-3D payment', async () => {
      const id = orderId('PRM');
      const payment = await parampos.createPayment(paymentRequest(card!, { conversationId: id }));
      record('parampos', 'create-payment', payment.rawResponse);
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const lookup = await parampos.getPayment(id);
      record('parampos', 'get-payment', lookup.rawResponse);
      expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

      const cancel = await parampos.cancel({ paymentId: id, ip: '85.34.78.112', price: '1' });
      record('parampos', 'cancel', cancel.rawResponse);
      expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
    });

    it('looks up the card BIN', async () => {
      const bin = await parampos.binCheck(card!.cardNumber.slice(0, 6));
      record('parampos', 'bin-check', bin.rawResponse);
      expect(bin.bankName).toBeTruthy();
    });
  });
});
