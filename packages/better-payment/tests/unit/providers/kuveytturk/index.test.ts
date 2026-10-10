import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment } from '../../../../src';
import {
  KuveytTurk,
  kuveytturk,
  mapKuveytTurkTransactionStatus,
} from '../../../../src/providers/kuveytturk';
import {
  createKuveytTurkPaymentHash,
  createKuveytTurkProvisionHash,
  createKuveytTurkSaleReversalHash,
  createKuveytTurkGetTransactionsHash,
} from '../../../../src/providers/kuveytturk/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  KUVEYTTURK_TEST,
  KUVEYTTURK_BASE_URL,
  KUVEYTTURK_PAYMENT_REJECTED_HTML,
  KUVEYTTURK_PAYMENT_3D_HTML,
  KUVEYTTURK_CALLBACK,
  kuveytTurkTransaction,
  kuveytTurkTransactions,
  kuveytTurkResponse,
} from '../../../fixtures/kuveytturk';

const CREDENTIALS = {
  merchantId: KUVEYTTURK_TEST.merchantId,
  username: KUVEYTTURK_TEST.username,
  password: KUVEYTTURK_TEST.password,
};

describe('Kuveyt Türk provider', () => {
  let provider: KuveytTurk;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new KuveytTurk({ ...KUVEYTTURK_TEST, baseUrl: KUVEYTTURK_BASE_URL });
    post = vi.fn();
    (provider as any).client.post = post;
  });

  const sent = (call = 0) => ({
    url: post.mock.calls[call][0] as string,
    body: JSON.parse(post.mock.calls[call][1]),
    config: post.mock.calls[call][2],
  });

  const expectNoIds = (result: { paymentId?: string; conversationId?: string }) => {
    expect(result.paymentId).toBeUndefined();
    expect(result.conversationId).toBeUndefined();
  };

  it.each(['merchantId', 'customerId', 'username', 'password'])('requires %s', (field) => {
    expect(
      () => new KuveytTurk({ ...KUVEYTTURK_TEST, baseUrl: KUVEYTTURK_BASE_URL, [field]: '' })
    ).toThrow(field);
  });

  it('createPayment is not supported (3D Secure only)', async () => {
    await expect(provider.createPayment(mockThreeDSPaymentRequest)).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
  });

  describe('initThreeDSPayment', () => {
    it('sends a signed Payment request and returns the 3D page', async () => {
      post.mockResolvedValue({ data: KUVEYTTURK_PAYMENT_3D_HTML });

      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER3D',
        installment: 3,
      });

      const { url, body, config } = sent();
      expect(url).toBe('/KTPay/Payment');
      expect(config.responseType).toBe('text');
      expect(config.retryable).toBeUndefined();
      expect(body).toMatchObject({
        language: 1,
        merchantOrderId: 'ORDER3D',
        successUrl: 'https://example.com/callback',
        failUrl: 'https://example.com/callback',
        merchantId: '12345',
        customerId: '67890',
        username: 'apiuser',
        amount: '120',
        currency: '0949',
        installmentCount: 3,
        paymentType: 1,
        customer: {
          fullName: 'John Doe',
          cc: '90',
          subscriber: '5350000000',
          email: 'john.doe@example.com',
          identityNumber: '74300864791',
          ipAddress: '85.34.78.112',
        },
        card: {
          cardHolderName: 'John Doe',
          cardNumber: '5528790000000008',
          expireMonth: '12',
          expireYear: '30',
          securityCode: '123',
        },
      });
      expect(body).not.toHaveProperty('password');
      expect(body.hashData).toBe(
        await createKuveytTurkPaymentHash(CREDENTIALS, {
          merchantOrderId: 'ORDER3D',
          amount: '120',
          successUrl: 'https://example.com/callback',
          failUrl: 'https://example.com/callback',
        })
      );
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.threeDSHtmlContent).toBe(KUVEYTTURK_PAYMENT_3D_HTML);
      expect(result.paymentId).toBe('ORDER3D');
    });

    it('uses failUrl and paymentType when given', async () => {
      post.mockResolvedValue({ data: KUVEYTTURK_PAYMENT_3D_HTML });
      const custom = new KuveytTurk({
        ...KUVEYTTURK_TEST,
        baseUrl: KUVEYTTURK_BASE_URL,
        paymentType: 2,
      });
      (custom as any).client.post = post;

      await custom.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        failUrl: 'https://example.com/fail',
      });

      expect(sent().body).toMatchObject({ failUrl: 'https://example.com/fail', paymentType: 2 });
    });

    it('maps a rejected Payment form to a failure', async () => {
      post.mockResolvedValue({ data: KUVEYTTURK_PAYMENT_REJECTED_HTML });

      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('HashDataError');
      expect(result.errorMessage).toBe('Şifrelenen veriler (Hashdata) uyuşmamaktadır.');
      expect(result.code).toBe(PaymentErrorCode.PROVIDER_ERROR);
      expect(result.threeDSHtmlContent).toBeUndefined();
    });

    it('treats an empty response as a failure', async () => {
      post.mockResolvedValue({ data: '' });
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('rejects callback URLs with "&" before calling the bank', async () => {
      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        callbackUrl: 'https://example.com/callback?a=1&b=2',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.INVALID_REQUEST);
    });

    it('requires the buyer GSM number', async () => {
      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        buyer: { ...mockThreeDSPaymentRequest.buyer, gsmNumber: '' },
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toContain('gsmNumber');
    });

    it('rejects unsupported currencies', async () => {
      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        currency: 'GBP',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('returns pending on a timeout', async () => {
      post.mockRejectedValue(new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' }));
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.code).toBe(PaymentErrorCode.NETWORK_ERROR);
    });
  });

  describe('completeThreeDSPayment', () => {
    it('looks up the order and charges it with Provision', async () => {
      post
        .mockResolvedValueOnce({ data: kuveytTurkTransactions(kuveytTurkTransaction()) })
        .mockResolvedValueOnce({ data: kuveytTurkResponse({ ResponseCode: '00' }) });

      const result = await provider.completeThreeDSPayment(KUVEYTTURK_CALLBACK);

      const lookup = sent(0);
      expect(lookup.url).toBe('/KTPay/GetTransactions');
      expect(lookup.config.retryable).toBe(true);
      expect(lookup.body).toMatchObject({ merchantOrderId: 'ORDER3D', merchantId: '12345' });
      expect(lookup.body.hashData).toBe(
        await createKuveytTurkGetTransactionsHash(CREDENTIALS, { merchantOrderId: 'ORDER3D' })
      );

      const provision = sent(1);
      expect(provision.url).toBe('/KTPay/Provision');
      expect(provision.config.retryable).toBe(false);
      expect(provision.body).toMatchObject({
        merchantId: '12345',
        customerId: '67890',
        username: 'apiuser',
        merchantOrderId: 'ORDER3D',
        orderId: '334210503',
        amount: '120',
        md: 'mdValue+/=',
      });
      expect(provision.body.hashData).toBe(
        await createKuveytTurkProvisionHash(CREDENTIALS, {
          merchantOrderId: 'ORDER3D',
          amount: '120',
        })
      );

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER3D');
      expect(result.conversationId).toBe('ORDER3D');
    });

    it('signs Provision with the bank amount, ignoring an amount in the callback', async () => {
      post
        .mockResolvedValueOnce({
          data: kuveytTurkTransactions(kuveytTurkTransaction({ FirstAmount: 5000 })),
        })
        .mockResolvedValueOnce({ data: kuveytTurkResponse() });

      await provider.completeThreeDSPayment({ ...KUVEYTTURK_CALLBACK, Amount: '1' } as any);

      expect(sent(1).body.amount).toBe('5000');
    });

    it('fails without calling the bank when verification failed', async () => {
      const result = await provider.completeThreeDSPayment({
        ...KUVEYTTURK_CALLBACK,
        Success: 'False',
        ResponseCode: 'CardVerificationFailed',
        ResponseMessage: 'Kart doğrulanamadı.',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('CardVerificationFailed');
      expectNoIds(result);
    });

    it('does not take order ids of a Success=False callback from the request', async () => {
      const result = await provider.completeThreeDSPayment({
        Success: 'False',
        MerchantOrderId: 'SOMEONE-ELSES-ORDER',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expectNoIds(result);
      expect(result.rawResponse).toEqual({
        Success: 'False',
        MerchantOrderId: 'SOMEONE-ELSES-ORDER',
      });
    });

    it.each(['MD', 'OrderId', 'MerchantOrderId'])('fails when %s is missing', async (field) => {
      const result = await provider.completeThreeDSPayment({
        ...KUVEYTTURK_CALLBACK,
        [field]: undefined,
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('rejects a callback whose bank order id does not match', async () => {
      post.mockResolvedValueOnce({
        data: kuveytTurkTransactions(kuveytTurkTransaction({ OrderId: 999 })),
      });

      const result = await provider.completeThreeDSPayment(KUVEYTTURK_CALLBACK);

      expect(post).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_HASH');
      expect(result.code).toBe(PaymentErrorCode.INVALID_HASH);
      expectNoIds(result);
    });

    it('uses the transaction with the callback bank order id', async () => {
      post
        .mockResolvedValueOnce({
          data: kuveytTurkTransactions(
            kuveytTurkTransaction({
              OrderId: 111,
              TransactionStatus: 'Basarısız (2)',
              FirstAmount: 999,
            }),
            kuveytTurkTransaction({ FirstAmount: 120 })
          ),
        })
        .mockResolvedValueOnce({ data: kuveytTurkResponse() });

      const result = await provider.completeThreeDSPayment(KUVEYTTURK_CALLBACK);

      expect(sent(1).body).toMatchObject({ orderId: '334210503', amount: '120' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('rejects a callback for an unknown order', async () => {
      post.mockResolvedValueOnce({ data: kuveytTurkTransactions() });
      const result = await provider.completeThreeDSPayment(KUVEYTTURK_CALLBACK);
      expect(post).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('INVALID_HASH');
      expectNoIds(result);
    });

    it('never picks a transaction of another order', async () => {
      post.mockResolvedValueOnce({
        data: kuveytTurkTransactions(kuveytTurkTransaction({ MerchantOrderId: 'OTHER' })),
      });
      const result = await provider.completeThreeDSPayment(KUVEYTTURK_CALLBACK);
      expect(post).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(PaymentStatus.FAILURE);
    });

    it('maps a failed Provision', async () => {
      post
        .mockResolvedValueOnce({ data: kuveytTurkTransactions(kuveytTurkTransaction()) })
        .mockResolvedValueOnce({
          data: kuveytTurkResponse({
            Success: false,
            ResponseCode: '51',
            ResponseMessage: 'Yetersiz bakiye',
          }),
        });

      const result = await provider.completeThreeDSPayment(KUVEYTTURK_CALLBACK);

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('51');
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expectNoIds(result);
    });

    it('fails without ids when the order lookup is rejected by the bank', async () => {
      post.mockRejectedValueOnce(
        new HttpError(
          'Request failed with status code 500',
          {},
          { response: { data: {}, status: 500, headers: {} } }
        )
      );
      const result = await provider.completeThreeDSPayment(KUVEYTTURK_CALLBACK);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expectNoIds(result);
    });

    it('returns pending without ids when the order lookup times out', async () => {
      post.mockRejectedValueOnce(new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' }));
      const result = await provider.completeThreeDSPayment(KUVEYTTURK_CALLBACK);
      expect(post).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expectNoIds(result);
    });

    it('returns pending with the confirmed ids when Provision times out', async () => {
      post
        .mockResolvedValueOnce({ data: kuveytTurkTransactions(kuveytTurkTransaction()) })
        .mockRejectedValueOnce(new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' }));

      const result = await provider.completeThreeDSPayment(KUVEYTTURK_CALLBACK);

      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.code).toBe(PaymentErrorCode.NETWORK_ERROR);
      expect(result.paymentId).toBe('ORDER3D');
      expect(result.conversationId).toBe('ORDER3D');
    });
  });

  describe('refund', () => {
    it('sends Drawback for the full amount', async () => {
      post
        .mockResolvedValueOnce({
          data: kuveytTurkTransactions(kuveytTurkTransaction({ FirstAmount: 120 })),
        })
        .mockResolvedValueOnce({ data: kuveytTurkResponse() });

      const result = await provider.refund({
        paymentId: 'ORDER3D',
        price: '1.20',
        currency: 'TRY',
        ip: '1.1.1.1',
      });

      const { url, body } = sent(1);
      expect(url).toBe('/KTPay/SaleReversal');
      expect(body).toMatchObject({
        merchantOrderId: 'ORDER3D',
        orderId: '334210503',
        saleReversalType: 'Drawback',
        amount: '120',
      });
      expect(body.hashData).toBe(
        await createKuveytTurkSaleReversalHash(CREDENTIALS, {
          merchantOrderId: 'ORDER3D',
          type: 'Drawback',
          amount: '120',
        })
      );
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('sends PartialDrawback for a lower amount', async () => {
      post
        .mockResolvedValueOnce({
          data: kuveytTurkTransactions(kuveytTurkTransaction({ FirstAmount: 120 })),
        })
        .mockResolvedValueOnce({ data: kuveytTurkResponse() });

      await provider.refund({
        paymentId: 'ORDER3D',
        price: '0.50',
        currency: 'TRY',
        ip: '1.1.1.1',
      });

      const { body } = sent(1);
      expect(body).toMatchObject({ saleReversalType: 'PartialDrawback', amount: '50' });
      expect(body.hashData).toBe(
        await createKuveytTurkSaleReversalHash(CREDENTIALS, {
          merchantOrderId: 'ORDER3D',
          type: 'PartialDrawback',
          amount: '50',
        })
      );
    });

    it('sends PartialDrawback after an earlier partial refund', async () => {
      post
        .mockResolvedValueOnce({
          data: kuveytTurkTransactions(
            kuveytTurkTransaction({ FirstAmount: 120, DrawbackAmount: 50 })
          ),
        })
        .mockResolvedValueOnce({ data: kuveytTurkResponse() });

      await provider.refund({
        paymentId: 'ORDER3D',
        price: '1.20',
        currency: 'TRY',
        ip: '1.1.1.1',
      });

      expect(sent(1).body.saleReversalType).toBe('PartialDrawback');
    });

    it('fails when the order is unknown', async () => {
      post.mockResolvedValueOnce({ data: kuveytTurkTransactions() });
      const result = await provider.refund({
        paymentId: 'NOPE',
        price: '1',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      expect(post).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('OrderIdNotFound');
    });

    it('maps a rejected refund', async () => {
      post
        .mockResolvedValueOnce({ data: kuveytTurkTransactions(kuveytTurkTransaction()) })
        .mockResolvedValueOnce({
          data: kuveytTurkResponse({
            Success: false,
            ResponseCode: 'TechnicalException',
            ResponseMessage: 'Hata',
          }),
        });
      const result = await provider.refund({
        paymentId: 'ORDER3D',
        price: '1.20',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.PROVIDER_ERROR);
    });
  });

  describe('cancel', () => {
    it('sends Cancel signed with amount 0', async () => {
      post
        .mockResolvedValueOnce({ data: kuveytTurkTransactions(kuveytTurkTransaction()) })
        .mockResolvedValueOnce({ data: kuveytTurkResponse() });

      const result = await provider.cancel({ paymentId: 'ORDER3D', ip: '1.1.1.1' });

      const { body } = sent(1);
      expect(body).toMatchObject({
        saleReversalType: 'Cancel',
        orderId: '334210503',
        amount: '120',
      });
      expect(body.hashData).toBe(
        await createKuveytTurkSaleReversalHash(CREDENTIALS, {
          merchantOrderId: 'ORDER3D',
          type: 'Cancel',
        })
      );
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });
  });

  describe('getPayment', () => {
    it('returns the status of the order', async () => {
      post.mockResolvedValueOnce({ data: kuveytTurkTransactions(kuveytTurkTransaction()) });
      const result = await provider.getPayment('ORDER3D');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('ORDER3D');
    });

    it('prefers the successful sale over a failed attempt', async () => {
      post.mockResolvedValueOnce({
        data: kuveytTurkTransactions(
          kuveytTurkTransaction({ OrderId: 111, TransactionStatus: 'Basarısız (2)' }),
          kuveytTurkTransaction()
        ),
      });
      const result = await provider.getPayment('ORDER3D');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('returns the bank error for a failed transaction', async () => {
      post.mockResolvedValueOnce({
        data: kuveytTurkTransactions(
          kuveytTurkTransaction({
            TransactionStatus: 'Basarısız (2)',
            ResponseCode: '51',
            ResponseExplain: 'Yetersiz bakiye',
          })
        ),
      });
      const result = await provider.getPayment('ORDER3D');
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
    });

    it('maps an API error', async () => {
      post.mockResolvedValueOnce({
        data: kuveytTurkResponse({
          Success: false,
          ResponseCode: 'HashDataError',
          ResponseMessage: 'Hash',
        }),
      });
      const result = await provider.getPayment('ORDER3D');
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('HashDataError');
    });
  });

  describe('mapKuveytTurkTransactionStatus', () => {
    it.each([
      [undefined, PaymentStatus.PENDING],
      [kuveytTurkTransaction(), PaymentStatus.SUCCESS],
      [kuveytTurkTransaction({ TransactionStatus: 'Basarısız (2)' }), PaymentStatus.FAILURE],
      [kuveytTurkTransaction({ TransactionStatus: 'Zaman Aşımı (3)' }), PaymentStatus.FAILURE],
      [kuveytTurkTransaction({ CancelAmount: 120 }), PaymentStatus.CANCELLED],
      [kuveytTurkTransaction({ DrawbackAmount: 120 }), PaymentStatus.CANCELLED],
      [kuveytTurkTransaction({ DrawbackAmount: 50 }), PaymentStatus.SUCCESS],
      [kuveytTurkTransaction({ TransactionStatus: 'Bilinmiyor' }), PaymentStatus.PENDING],
    ])('%#', (tx, status) => {
      expect(mapKuveytTurkTransactionStatus(tx as any)).toBe(status);
    });
  });

  it('selects the test URL in sandbox mode', () => {
    const bp = betterPayment({
      mode: 'sandbox',
      providers: { kuveytturk: kuveytturk(KUVEYTTURK_TEST) },
    });
    expect((bp.kuveytturk as any).config.baseUrl).toBe(KUVEYTTURK_BASE_URL);
  });

  it('selects the production URL by default', () => {
    const bp = betterPayment({ providers: { kuveytturk: kuveytturk(KUVEYTTURK_TEST) } });
    expect((bp.kuveytturk as any).config.baseUrl).toBe(
      'https://sanalpos.kuveytturk.com.tr/ServiceGateWay'
    );
  });
});
