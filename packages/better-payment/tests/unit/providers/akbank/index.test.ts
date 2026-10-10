import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { Akbank, mapAkbankTxnStatus } from '../../../../src/providers/akbank';
import { akbankSign } from '../../../../src/providers/akbank/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import { AKBANK_TEST, AKBANK_3DPAY_CALLBACK } from '../../../fixtures/akbank';

describe('Akbank provider', () => {
  let akbank: Akbank;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    akbank = new Akbank({ ...AKBANK_TEST, baseUrl: 'https://apipre.akbank.com/api/v1/payment/virtualpos', testMode: true });
    post = vi.fn();
    (akbank as any).client.post = post;
  });

  const sent = (call = 0) => ({
    url: post.mock.calls[call][0] as string,
    body: JSON.parse(post.mock.calls[call][1]),
    raw: post.mock.calls[call][1] as string,
    config: post.mock.calls[call][2],
  });

  it.each(['merchantSafeId', 'terminalSafeId', 'secretKey'])('requires %s', (field) => {
    expect(() => new Akbank({ ...AKBANK_TEST, baseUrl: 'https://x', [field]: '' })).toThrow(field);
  });

  it('createPayment sends a signed txnCode 1000 request', async () => {
    post.mockResolvedValue({ data: { responseCode: 'VPS-0000', order: { orderId: 'ORDER1' } } });

    const result = await akbank.createPayment({ ...mockPaymentRequest, conversationId: 'ORDER1' });

    const { url, body, raw, config } = sent();
    expect(url).toBe('/transaction/process');
    expect(config.headers['auth-hash']).toBe(await akbankSign(raw, AKBANK_TEST.secretKey));
    expect(config.retryable).toBe(false);
    expect(body).toMatchObject({
      version: '1.00',
      txnCode: '1000',
      terminal: { merchantSafeId: AKBANK_TEST.merchantSafeId, terminalSafeId: AKBANK_TEST.terminalSafeId },
      card: { cardNumber: '5528790000000008', cvv2: '123', expireDate: '1230' },
      transaction: { amount: '1.20', currencyCode: 949, motoInd: 0, installCount: 1 },
      customer: { ipAddress: '85.34.78.112' },
      order: { orderId: 'ORDER1' },
    });
    expect(body.randomNumber).toMatch(/^[0-9A-F]{128}$/);
    expect(body.requestDateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000$/);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('ORDER1');
  });

  it('createPayment maps declines', async () => {
    post.mockResolvedValue({ data: { responseCode: 'VPS-1073', responseMessage: 'Red', hostMessage: 'YETERSIZ BAKIYE' } });
    const result = await akbank.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorCode).toBe('VPS-1073');
    expect(result.errorMessage).toBe('YETERSIZ BAKIYE');
  });

  it('initThreeDSPayment returns a signed 3D_PAY form to the test gateway', async () => {
    const result = await akbank.initThreeDSPayment({ ...mockThreeDSPaymentRequest, conversationId: 'ORDER3D' });

    expect(post).not.toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.PENDING);
    const html = result.threeDSHtmlContent!;
    expect(html).toContain('action="https://virtualpospaymentgatewaypre.akbank.com/securepay"');
    expect(html).toContain('name="paymentModel" value="3D_PAY"');
    expect(html).toContain('name="txnCode" value="3000"');
    expect(html).toContain('name="orderId" value="ORDER3D"');
    expect(html).toContain('name="amount" value="1.20"');
    expect(html).toMatch(/name="hash" value="[^"]+"/);
  });

  it('uses the production gateway when testMode is off', async () => {
    const prod = new Akbank({ ...AKBANK_TEST, baseUrl: 'https://api.akbank.com/api/v1/payment/virtualpos' });
    const result = await prod.initThreeDSPayment(mockThreeDSPaymentRequest);
    expect(result.threeDSHtmlContent).toContain('https://virtualpospaymentgateway.akbank.com/securepay');
  });

  describe('completeThreeDSPayment', () => {
    const history = (txnDetailList: Record<string, unknown>[]) => ({
      data: { responseCode: 'VPS-0000', txnDetailList },
    });
    const approvedSale = { txnCode: '3000', responseCode: 'VPS-0000', txnStatus: 'N', orderId: '2024041811DA' };

    it('accepts a correctly signed successful callback confirmed by the order history', async () => {
      post.mockResolvedValue(history([approvedSale]));
      const result = await akbank.completeThreeDSPayment(AKBANK_3DPAY_CALLBACK);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('2024041811DA');
      expect(sent().body).toMatchObject({ txnCode: '1010', order: { orderId: '2024041811DA' } });
    });

    it('rejects a signed success callback that Akbank has no approved payment for', async () => {
      post.mockResolvedValue(history([{ ...approvedSale, responseCode: 'VPS-1005', txnStatus: 'S' }]));
      const result = await akbank.completeThreeDSPayment(AKBANK_3DPAY_CALLBACK);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('rejects a signed callback whose fields were re-split to name another order', async () => {
      // Same signed string, different field boundaries: orderId becomes "2024"
      const { hashParams, hash, merchantSafeId, terminalSafeId } = AKBANK_3DPAY_CALLBACK;
      const values = AKBANK_3DPAY_CALLBACK as Record<string, string>;
      const signed = hashParams.split('+').map((k) => values[k]).join('');
      const start = signed.indexOf(terminalSafeId) + terminalSafeId.length;
      const resplit = {
        before: signed.slice(0, signed.indexOf('VPS-0000')),
        responseCode: 'VPS-0000',
        middle: signed.slice(signed.indexOf('VPS-0000') + 8, signed.indexOf(merchantSafeId)),
        merchantSafeId,
        terminalSafeId,
        orderId: '2024',
        after: signed.slice(start + 4),
        hashParams: 'before+responseCode+middle+merchantSafeId+terminalSafeId+orderId+after',
        hash,
      };
      post.mockResolvedValue(history([]));

      const result = await akbank.completeThreeDSPayment(resplit);

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_HASH');
      expect(sent().body.order).toEqual({ orderId: '2024' });
    });

    it('rejects a signed decline when Akbank reports the order as paid', async () => {
      const decline = { ...AKBANK_3DPAY_CALLBACK, responseCode: 'VPS-1005' };
      const signed = decline.hashParams.split('+').map((k) => (decline as Record<string, string>)[k]).join('');
      decline.hash = await akbankSign(signed, AKBANK_TEST.secretKey);
      post.mockResolvedValue(history([approvedSale]));

      const result = await akbank.completeThreeDSPayment(decline);

      expect(result.errorCode).toBe('INVALID_HASH');
    });

    it('returns a confirmed decline as a failure', async () => {
      const decline = { ...AKBANK_3DPAY_CALLBACK, responseCode: 'VPS-1005', hostMessage: 'RED' };
      const signed = decline.hashParams.split('+').map((k) => (decline as Record<string, string>)[k]).join('');
      decline.hash = await akbankSign(signed, AKBANK_TEST.secretKey);
      post.mockResolvedValue(history([{ ...approvedSale, responseCode: 'VPS-1005', txnStatus: 'S' }]));

      const result = await akbank.completeThreeDSPayment(decline);

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('VPS-1005');
      expect(result.errorMessage).toBe('RED');
    });

    it('is pending when the order history query gets no response', async () => {
      post.mockRejectedValue(new HttpError('timeout', {}, { code: 'ETIMEDOUT' }));
      const result = await akbank.completeThreeDSPayment(AKBANK_3DPAY_CALLBACK);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.errorCode).toBe('NETWORK_ERROR');
    });

    it('rejects an unsigned/forged callback without calling Akbank', async () => {
      const result = await akbank.completeThreeDSPayment({ ...AKBANK_3DPAY_CALLBACK, hash: 'forged' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_HASH');
      expect(post).not.toHaveBeenCalled();
    });

    it('does not default to success when responseCode is missing', async () => {
      const { responseCode: _drop, ...rest } = AKBANK_3DPAY_CALLBACK;
      const result = await akbank.completeThreeDSPayment(rest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('rejects callbacks for another terminal', async () => {
      const other = new Akbank({ ...AKBANK_TEST, terminalSafeId: 'OTHER', baseUrl: 'https://x' });
      const result = await other.completeThreeDSPayment(AKBANK_3DPAY_CALLBACK);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('TERMINAL_MISMATCH');
    });
  });

  it('refund sends txnCode 1002 with amount', async () => {
    post.mockResolvedValue({ data: { responseCode: 'VPS-0000', transaction: { rrn: 'R1' } } });
    const result = await akbank.refund({ paymentId: 'ORDER1', price: '5', currency: 'TRY', ip: '1.1.1.1' });
    expect(sent().body).toMatchObject({
      txnCode: '1002',
      transaction: { amount: '5.00', currencyCode: 949 },
      order: { orderId: 'ORDER1' },
    });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.refundId).toBe('R1');
  });

  it('cancel sends txnCode 1003', async () => {
    post.mockResolvedValue({ data: { responseCode: 'VPS-0000' } });
    const result = await akbank.cancel({ paymentId: 'ORDER1', ip: '1.1.1.1' });
    expect(sent().body).toMatchObject({ txnCode: '1003', order: { orderId: 'ORDER1' } });
    expect(result.status).toBe(PaymentStatus.SUCCESS);
  });

  it('getPayment uses order history (1010) and is retryable', async () => {
    post.mockResolvedValue({
      data: {
        responseCode: 'VPS-0000',
        txnDetailList: [{ txnCode: '1000', responseCode: 'VPS-0000', txnStatus: 'V', orderId: 'ORDER1' }],
      },
    });
    const result = await akbank.getPayment('ORDER1');
    expect(sent().body).toMatchObject({ txnCode: '1010', order: { orderId: 'ORDER1' } });
    expect(sent().config.retryable).toBe(true);
    expect(result.status).toBe(PaymentStatus.CANCELLED);
  });

  it('maps txnStatus values', async () => {
    expect(mapAkbankTxnStatus({ responseCode: 'VPS-0000', txnStatus: 'N' })).toBe(PaymentStatus.SUCCESS);
    expect(mapAkbankTxnStatus({ responseCode: 'VPS-0000', txnStatus: 'R' })).toBe(PaymentStatus.CANCELLED);
    expect(mapAkbankTxnStatus({ responseCode: 'VPS-1005' })).toBe(PaymentStatus.FAILURE);
    expect(mapAkbankTxnStatus(undefined)).toBe(PaymentStatus.PENDING);
  });

  it('BIN and installment queries are explicitly unsupported', async () => {
    await expect(akbank.binCheck('415956')).rejects.toThrow(/not supported/);
    await expect(akbank.installmentInfo({ binNumber: '415956', price: '1' })).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
      message: expect.stringContaining('no installment-rate query'),
    });
  });

  it('reports timeouts as PENDING', async () => {
    post.mockRejectedValue(new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' }));
    const result = await akbank.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.PENDING);
  });
});
