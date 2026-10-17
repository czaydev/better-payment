import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { HttpError } from '../../../../src/core/http';
import { BetterPaymentHandler } from '../../../../src/core/BetterPaymentHandler';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment } from '../../../../src';
import { Tosla, tosla, toslaOrderStatus } from '../../../../src/providers/tosla';
import { PaymentStatus } from '../../../../src/types';
import { mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  TOSLA_TEST,
  TOSLA_BASE_URL,
  TOSLA_COMMISSION,
  toslaInquiry,
} from '../../../fixtures/tosla';

const formFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1],
      m[2],
    ])
  );
const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });

describe('Tosla provider', () => {
  let provider: Tosla;
  let post: ReturnType<typeof vi.fn>;

  const create = () => {
    const instance = new Tosla({ ...TOSLA_TEST, baseUrl: TOSLA_BASE_URL });
    (instance as any).client.post = post;
    return instance;
  };
  const sent = (call = 0) => JSON.parse(post.mock.calls[call][1]);
  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  it.each(['clientId', 'apiUser', 'apiPass'])('requires %s', (field) => {
    expect(() => new Tosla({ ...TOSLA_TEST, baseUrl: TOSLA_BASE_URL, [field]: '' })).toThrow(field);
  });

  it('createPayment is not supported (3D Secure only)', async () => {
    await expect(provider.createPayment(mockThreeDSPaymentRequest)).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
  });

  describe('initThreeDSPayment', () => {
    it('opens a signed session and posts the card to ProcessCardForm', async () => {
      post.mockResolvedValue({ data: { ThreeDSessionId: 'SESSION1', Code: 0, Message: '' } });

      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDERTS',
        installment: 3,
      });

      expect(post.mock.calls[0][0]).toBe('/api/Payment/threeDPayment');
      expect(post.mock.calls[0][2]).toMatchObject({ retryable: false });
      const body = sent();
      expect(body).toMatchObject({
        callbackUrl: 'https://example.com/callback',
        orderId: 'ORDERTS',
        amount: 120,
        currency: 949,
        installmentCount: 3,
        clientId: 1000000001,
        apiUser: 'POS_TEST_USER',
      });
      expect(body.timeSpan).toMatch(/^\d{14}$/);
      expect(body.Hash).toBe(
        crypto
          .createHash('sha512')
          .update('POS_TEST_PASS' + '1000000001' + 'POS_TEST_USER' + body.Rnd + body.timeSpan)
          .digest('base64')
      );
      expect(JSON.stringify(body)).not.toContain('5528790000000008');

      expect(result.status).toBe(PaymentStatus.PENDING);
      const html = result.threeDSHtmlContent!;
      expect(html).toContain(`action="${TOSLA_BASE_URL}/api/Payment/ProcessCardForm"`);
      expect(formFields(html)).toEqual({
        ThreeDSessionId: 'SESSION1',
        CardHolderName: 'John Doe',
        CardNo: '5528790000000008',
        ExpireDate: '1230',
        Cvv: '123',
        installment: '3',
      });
      expect(result.paymentId).toBe('ORDERTS');
    });

    it('fails without a form when Tosla refuses the session', async () => {
      post.mockResolvedValue({
        data: { ThreeDSessionId: null, Code: 998, Message: 'Validasyon Hatası' },
      });
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('998');
      expect(result.errorMessage).toBe('Validasyon Hatası');
      expect(result.threeDSHtmlContent).toBeUndefined();
    });

    it('requires a callbackUrl', async () => {
      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        callbackUrl: '',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('completeThreeDSPayment', () => {
    const CALLBACK = { OrderId: 'ORDERTS', BankResponseCode: '00', BankResponseMessage: 'Onay' };

    it('confirms the payment with an inquiry', async () => {
      post.mockResolvedValue({ data: toslaInquiry() });
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(post.mock.calls[0][0]).toBe('/api/Payment/inquiry');
      expect(sent()).toMatchObject({ OrderId: 'ORDERTS' });
      expect(post.mock.calls[0][2]).toMatchObject({ retryable: true });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERTS');
    });

    it('fails with the bank code on a declined callback, without calling Tosla', async () => {
      const result = await provider.completeThreeDSPayment({
        ...CALLBACK,
        BankResponseCode: '51',
        BankResponseMessage: 'Yetersiz bakiye',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expectNoIds(result);
    });

    it('rejects an approved callback Tosla does not confirm', async () => {
      post.mockResolvedValue({ data: toslaInquiry({ OrderId: null, Code: 200, Message: 'Yok' }) });
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects an inquiry for another order', async () => {
      post.mockResolvedValue({ data: toslaInquiry({ OrderId: 'OTHER' }) });
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a refunded payment', async () => {
      post.mockResolvedValue({ data: toslaInquiry({ RefundedAmount: 120 }) });
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('checks the amount when given', async () => {
      post.mockResolvedValue({ data: toslaInquiry() });
      const ok = await provider.completeThreeDSPayment(CALLBACK, { amount: '1.20' });
      expect(ok.status).toBe(PaymentStatus.SUCCESS);
      const wrong = await provider.completeThreeDSPayment(CALLBACK, { amount: '99.00' });
      expect(wrong.errorCode).toBe('INVALID_HASH');
      expectNoIds(wrong);
    });

    it('fails with the bank code when the inquiry shows a decline', async () => {
      post.mockResolvedValue({
        data: toslaInquiry({ BankResponseCode: '05', BankResponseMessage: 'Red' }),
      });
      const result = await provider.completeThreeDSPayment({ OrderId: 'ORDERTS' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('05');
      expectNoIds(result);
    });

    it('prefers the order id from your records', async () => {
      post.mockResolvedValue({ data: toslaInquiry() });
      await provider.completeThreeDSPayment({ OrderId: 'FORGED' }, { orderId: 'ORDERTS' });
      expect(sent()).toMatchObject({ OrderId: 'ORDERTS' });
    });

    it('ignores orderId and amount sent in the callback body', async () => {
      post.mockResolvedValue({ data: toslaInquiry() });
      const result = await provider.completeThreeDSPayment({
        ...CALLBACK,
        orderId: 'VICTIM',
        amount: '99.00',
      } as any);
      expect(sent()).toMatchObject({ OrderId: 'ORDERTS' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDERTS');
    });

    // The default handler passes only the HTTP body: a client must not be able to
    // name the order or get ids attached to a pending result
    it('does not trust an orderId in the body through the default handler', async () => {
      post.mockRejectedValue(timeout());
      const payment = betterPayment({
        mode: 'sandbox',
        providers: { tosla: tosla({ ...TOSLA_TEST, baseUrl: TOSLA_BASE_URL }) },
      });
      (payment.use('tosla') as any).client.post = post;
      const onCallback = vi.fn();
      await new BetterPaymentHandler(payment, { onCallback }).handle({
        method: 'POST',
        url: '/api/pay/tosla/callback',
        headers: { 'content-type': 'application/json' },
        body: { ...CALLBACK, orderId: 'VICTIM' },
      });
      expect(sent()).toMatchObject({ OrderId: 'ORDERTS' });
      expect(onCallback).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.PENDING }),
        expect.anything()
      );
      const [result] = onCallback.mock.calls[0];
      expectNoIds(result);
    });

    it('needs an order id', async () => {
      const result = await provider.completeThreeDSPayment({ BankResponseCode: '00' });
      expect(result.errorCode).toBe('VALIDATION_ERROR');
      expect(post).not.toHaveBeenCalled();
    });

    it('returns pending without ids when the inquiry times out for an unsigned order id', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(CALLBACK);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBeUndefined();
      expect(result.conversationId).toBeUndefined();
    });

    it('keeps the order id on a timeout when it came from your records', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(CALLBACK, { orderId: 'ORDERTS' });
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('ORDERTS');
    });
  });

  describe('refund, cancel, getPayment', () => {
    it('refunds an amount in kuruş', async () => {
      post.mockResolvedValue({ data: { Code: 0, TransactionId: 'RF1', OrderId: 'ORDERTS' } });
      const result = await provider.refund({
        paymentId: 'ORDERTS',
        price: '0.50',
        currency: 'TRY',
        ip: '1.2.3.4',
      });
      expect(post.mock.calls[0][0]).toBe('/api/Payment/refund');
      expect(sent()).toMatchObject({ OrderId: 'ORDERTS', Amount: 50 });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.refundId).toBe('RF1');
    });

    it('maps a refused refund', async () => {
      post.mockResolvedValue({
        data: { Code: 1, Message: 'Hata', BankResponseCode: '57', BankResponseMessage: 'İzin yok' },
      });
      const result = await provider.refund({
        paymentId: 'ORDERTS',
        price: '0.50',
        currency: 'TRY',
        ip: '1.2.3.4',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('57');
    });

    it('cancels with void', async () => {
      post.mockResolvedValue({ data: { Code: 0, OrderId: 'ORDERTS' } });
      const result = await provider.cancel({ paymentId: 'ORDERTS', ip: '1.2.3.4' });
      expect(post.mock.calls[0][0]).toBe('/api/Payment/void');
      expect(sent()).toMatchObject({ OrderId: 'ORDERTS' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    // Tosla's Code acknowledges the request; when the answer also carries the bank's
    // result, a non-00 code must not count as an approved refund or void
    it.each([
      [
        'refund',
        (p: Tosla) =>
          p.refund({ paymentId: 'ORDERTS', price: '0.50', currency: 'TRY', ip: '1.2.3.4' }),
      ],
      ['void', (p: Tosla) => p.cancel({ paymentId: 'ORDERTS', ip: '1.2.3.4' })],
    ] as const)('fails a %s with Code 0 but a declined bank code', async (_name, call) => {
      post.mockResolvedValue({
        data: { Code: 0, Message: '', BankResponseCode: '05', BankResponseMessage: 'Red' },
      });
      const result = await call(provider);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('05');
    });

    it.each([
      [
        'refund',
        (p: Tosla) =>
          p.refund({ paymentId: 'ORDERTS', price: '0.50', currency: 'TRY', ip: '1.2.3.4' }),
      ],
      ['void', (p: Tosla) => p.cancel({ paymentId: 'ORDERTS', ip: '1.2.3.4' })],
    ] as const)('approves a %s with Code 0 and bank code 00', async (_name, call) => {
      post.mockResolvedValue({ data: { Code: 0, BankResponseCode: '00', TransactionId: 'T1' } });
      expect((await call(provider)).status).toBe(PaymentStatus.SUCCESS);
    });

    // How a same-day void shows in the inquiry answer is not confirmed yet, so the
    // status is not offered: a voided payment must not be reported as paid
    it('does not report a status after a void or refund (not supported yet)', async () => {
      post.mockResolvedValue({ data: { Code: 0, OrderId: 'ORDERTS' } });
      expect((await provider.cancel({ paymentId: 'ORDERTS', ip: '1.2.3.4' })).status).toBe(
        PaymentStatus.SUCCESS
      );
      post.mockClear();
      await expect(provider.getPayment('ORDERTS')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
      expect(post).not.toHaveBeenCalled();
    });

    it('maps statuses', () => {
      expect(toslaOrderStatus(toslaInquiry())).toBe(PaymentStatus.SUCCESS);
      expect(toslaOrderStatus(toslaInquiry({ RefundedAmount: 120 }))).toBe(PaymentStatus.CANCELLED);
      expect(toslaOrderStatus(toslaInquiry({ BankResponseCode: '05' }))).toBe(
        PaymentStatus.FAILURE
      );
      expect(toslaOrderStatus(toslaInquiry({ OrderId: null }))).toBe(PaymentStatus.FAILURE);
      expect(toslaOrderStatus({ Code: 998, Message: 'Validasyon Hatası' })).toBe(
        PaymentStatus.FAILURE
      );
    });
  });

  describe('BIN and installments', () => {
    it('reads the card from GetCommissionAndInstallmentInfo', async () => {
      post.mockResolvedValue({ data: TOSLA_COMMISSION });
      const bin = await provider.binCheck('540667');
      expect(post.mock.calls[0][0]).toBe('/api/Payment/GetCommissionAndInstallmentInfo');
      expect(sent()).toMatchObject({ Bin: '540667' });
      expect(bin).toMatchObject({
        binNumber: '540667',
        cardType: 'Kredi Kartı',
        cardAssociation: 'MASTER_CARD',
        cardFamily: 'Axess',
        bankName: 'Akbank',
        bankCode: 46,
        commercial: true,
      });
    });

    it('lists the allowed counts with their rates', async () => {
      post.mockResolvedValue({ data: TOSLA_COMMISSION });
      const result = await provider.installmentInfo({ binNumber: '540667', price: '100.00' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails![0].installmentPrices).toEqual([
        { installmentNumber: 1, totalPrice: 100, installmentPrice: 100, commissionRate: 0 },
        { installmentNumber: 3, totalPrice: 103.5, installmentPrice: 34.5, commissionRate: 3.5 },
        { installmentNumber: 6, totalPrice: 106, installmentPrice: 17.67, commissionRate: 6 },
      ]);
    });

    it('fails when Tosla refuses the query', async () => {
      post.mockResolvedValue({ data: { Code: 998, Message: 'Validasyon Hatası' } });
      const result = await provider.installmentInfo({ binNumber: '540667', price: '100.00' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      await expect(provider.binCheck('540667')).rejects.toThrow(/Validasyon Hatası/);
    });

    it('rejects a malformed BIN', async () => {
      const result = await provider.installmentInfo({ binNumber: '12', price: '100.00' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('tosla()', () => {
    it('uses the test host in sandbox mode', () => {
      const bp = betterPayment({ mode: 'sandbox', providers: { tosla: tosla(TOSLA_TEST) } });
      expect((bp.tosla as any).config.baseUrl).toBe('https://prepentegrasyon.tosla.com');
    });

    it('uses the production host by default', () => {
      const bp = betterPayment({ providers: { tosla: tosla(TOSLA_TEST) } });
      expect((bp.tosla as any).config.baseUrl).toBe('https://entegrasyon.tosla.com');
    });
  });
});
