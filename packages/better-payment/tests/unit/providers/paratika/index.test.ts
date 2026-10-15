import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpError } from '../../../../src/core/http';
import { PaymentErrorCode } from '../../../../src/core/error-codes';
import { betterPayment, PROVIDER_DEFAULT_URLS, ProviderType } from '../../../../src';
import { Paratika, paratika } from '../../../../src/providers/paratika';
import {
  buildParatikaOrderItems,
  formatParatikaExpiry,
  getParatikaCurrency,
  verifyParatikaCallback,
} from '../../../../src/providers/paratika/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockPaymentRequest, mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';
import {
  PARATIKA_TEST,
  PARATIKA_BASE_URL,
  PARATIKA_3D_CALLBACK,
  paratikaApproved,
  paratikaDeclined,
  paratikaTransactions,
  paratikaSale,
} from '../../../fixtures/paratika';

const order = { ...mockPaymentRequest, conversationId: 'ORDER1' };
const timeout = () => new HttpError('Request timed out', {}, { code: 'ETIMEDOUT' });
const formFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1],
      m[2],
    ])
  );

describe('Paratika utils', () => {
  it('verifies the callback hash (reference vector)', async () => {
    expect(await verifyParatikaCallback(PARATIKA_3D_CALLBACK, 'TESTSECRET')).toBe(true);
    expect(
      await verifyParatikaCallback(
        { ...PARATIKA_3D_CALLBACK, merchantPaymentId: 'X' },
        'TESTSECRET'
      )
    ).toBe(false);
    expect(
      await verifyParatikaCallback({ ...PARATIKA_3D_CALLBACK, sdSha512: '' }, 'TESTSECRET')
    ).toBe(false);
  });

  it('formats currency and expiry, and builds order items', () => {
    expect(getParatikaCurrency('TL')).toBe('TRY');
    expect(() => getParatikaCurrency('JPY')).toThrow();
    expect(formatParatikaExpiry('1', '30')).toEqual({ month: '01', year: '2030' });
    const items = JSON.parse(
      buildParatikaOrderItems(
        [{ id: 'A', name: 'A', category1: 'C', itemType: 'PHYSICAL', price: '1.20' }],
        '1.20'
      )
    );
    expect(items).toEqual([
      { productCode: 'A', name: 'A', description: 'A', quantity: 1, amount: 1.2 },
    ]);
    // Items that do not add up become one line for the order (ERR10022 otherwise)
    expect(
      JSON.parse(buildParatikaOrderItems(mockPaymentRequest.basketItems, '5.00'))
    ).toHaveLength(1);
  });
});

describe('Paratika provider', () => {
  let provider: Paratika;
  let post: ReturnType<typeof vi.fn>;

  const create = (overrides: Partial<ConstructorParameters<typeof Paratika>[0]> = {}) => {
    const instance = new Paratika({ ...PARATIKA_TEST, baseUrl: PARATIKA_BASE_URL, ...overrides });
    (instance as any).client.post = post;
    return instance;
  };
  const sent = (call = 0) => Object.fromEntries(new URLSearchParams(post.mock.calls[call][1]));

  beforeEach(() => {
    post = vi.fn();
    provider = create();
  });

  it.each(['merchant', 'merchantUser', 'merchantPassword'])('requires %s', (field) => {
    expect(() => create({ [field]: '' })).toThrow(field);
  });

  describe('createPayment', () => {
    it('sends a SALE with the card and order', async () => {
      post.mockResolvedValue({ data: paratikaApproved() });

      const result = await provider.createPayment({ ...order, installment: 3 });

      expect(post.mock.calls[0][0]).toBe('');
      expect(sent()).toMatchObject({
        ACTION: 'SALE',
        MERCHANT: '10000000',
        MERCHANTUSER: 'api@example.com',
        MERCHANTPASSWORD: 'apipass',
        MERCHANTPAYMENTID: 'ORDER1',
        AMOUNT: '1.20',
        CURRENCY: 'TRY',
        CARDPAN: '5528790000000008',
        CARDEXPIRY: '12.2030',
        CARDCVV: '123',
        INSTALLMENTS: '3',
      });
      expect(sent()).not.toHaveProperty('secretKey');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('18285OQZD14766');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('maps a decline', async () => {
      post.mockResolvedValue({ data: paratikaDeclined() });
      const result = await provider.createPayment(order);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('ERR20051');
      expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
      expect(result.paymentId).toBeUndefined();
    });

    it('returns pending on a timeout', async () => {
      post.mockRejectedValue(timeout());
      expect((await provider.createPayment(order)).status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('initThreeDSPayment', () => {
    it('creates a payment session and returns a card form for /post/sale3d/{token}', async () => {
      post.mockResolvedValue({ data: paratikaApproved({ sessionToken: 'TOKEN123' }) });

      const result = await provider.initThreeDSPayment({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER1',
      });

      expect(sent()).toMatchObject({
        ACTION: 'SESSIONTOKEN',
        SESSIONTYPE: 'PAYMENTSESSION',
        RETURNURL: mockThreeDSPaymentRequest.callbackUrl,
        MERCHANTPAYMENTID: 'ORDER1',
        AMOUNT: '1.20',
      });
      expect(sent()).not.toHaveProperty('CARDPAN');
      expect(result.status).toBe(PaymentStatus.PENDING);
      const html = result.threeDSHtmlContent!;
      expect(html).toContain(`action="${PARATIKA_BASE_URL}/post/sale3d/TOKEN123"`);
      expect(formFields(html)).toEqual({
        cardOwner: 'John Doe',
        pan: '5528790000000008',
        expiryMonth: '12',
        expiryYear: '2030',
        cvv: '123',
        installmentCount: '1',
      });
      expect(html).not.toContain('apipass');
    });

    it('fails when the session is refused', async () => {
      post.mockResolvedValue({
        data: paratikaDeclined('ERR10020', 'Geçersiz kullanıcı bilgileri'),
      });
      const result = await provider.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorCode).toBe('ERR10020');
    });
  });

  describe('completeThreeDSPayment', () => {
    it('confirms an approved callback with QUERYTRANSACTION', async () => {
      post.mockResolvedValue({ data: paratikaTransactions([paratikaSale()]) });

      const result = await provider.completeThreeDSPayment(PARATIKA_3D_CALLBACK);

      expect(sent()).toMatchObject({ ACTION: 'QUERYTRANSACTION', PGTRANID: '18285OQZD14766' });
      expect(post.mock.calls[0][2]).toMatchObject({ retryable: true });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('18285OQZD14766');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('rejects a callback whose hash does not verify', async () => {
      const result = await provider.completeThreeDSPayment({
        ...PARATIKA_3D_CALLBACK,
        merchantPaymentId: 'OTHER',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.errorCode).toBe('INVALID_HASH');
      expect(result.paymentId).toBeUndefined();
    });

    it('rejects an approved callback the inquiry does not confirm', async () => {
      post.mockResolvedValue({
        data: paratikaTransactions([paratikaSale({ transactionStatus: 'DE' })]),
      });
      const result = await provider.completeThreeDSPayment(PARATIKA_3D_CALLBACK);
      expect(result.errorCode).toBe('INVALID_HASH');
      expect(result.conversationId).toBeUndefined();
    });

    it('rejects a sale of another order', async () => {
      post.mockResolvedValue({
        data: paratikaTransactions([paratikaSale({ merchantPaymentId: 'OTHER' })]),
      });
      expect((await provider.completeThreeDSPayment(PARATIKA_3D_CALLBACK)).errorCode).toBe(
        'INVALID_HASH'
      );
    });

    describe('without secretKey (unsigned callback): the order must be bound by Paratika', () => {
      const unsigned = { ...PARATIKA_3D_CALLBACK, sdSha512: undefined };
      const { merchantPaymentId: _omit, ...saleWithoutOrder } = paratikaSale();
      let unsignedProvider: Paratika;

      beforeEach(() => {
        unsignedProvider = create({ secretKey: undefined });
      });

      it('accepts a sale whose merchantPaymentId matches, with one query', async () => {
        post.mockResolvedValue({ data: paratikaTransactions([paratikaSale()]) });
        const result = await unsignedProvider.completeThreeDSPayment(unsigned);
        expect(post).toHaveBeenCalledTimes(1);
        expect(result.status).toBe(PaymentStatus.SUCCESS);
        expect(result.conversationId).toBe('ORDER1');
      });

      it('rejects a sale whose merchantPaymentId differs, without ids', async () => {
        post.mockResolvedValue({
          data: paratikaTransactions([paratikaSale({ merchantPaymentId: 'OTHER' })]),
        });
        const result = await unsignedProvider.completeThreeDSPayment(unsigned);
        expect(post).toHaveBeenCalledTimes(1);
        expect(result.errorCode).toBe('INVALID_HASH');
        expect(result.paymentId).toBeUndefined();
        expect(result.conversationId).toBeUndefined();
      });

      it.each([
        ['missing', saleWithoutOrder],
        ['empty', paratikaSale({ merchantPaymentId: '' })],
      ])(
        'binds a sale with a %s merchantPaymentId through a query by order id',
        async (_case, sale) => {
          post
            .mockResolvedValueOnce({ data: paratikaTransactions([sale]) })
            .mockResolvedValueOnce({ data: paratikaTransactions([saleWithoutOrder]) });
          const result = await unsignedProvider.completeThreeDSPayment(unsigned);
          expect(sent(1)).toMatchObject({
            ACTION: 'QUERYTRANSACTION',
            MERCHANTPAYMENTID: 'ORDER1',
          });
          expect(result.status).toBe(PaymentStatus.SUCCESS);
          expect(result.conversationId).toBe('ORDER1');
        }
      );

      it.each([
        ['finds nothing for the order', paratikaTransactions([])],
        [
          'lists another payment only',
          paratikaTransactions([{ ...saleWithoutOrder, pgTranId: 'X1' }]),
        ],
        [
          'also lists another order (filter not applied)',
          paratikaTransactions([
            saleWithoutOrder,
            paratikaSale({ merchantPaymentId: 'OTHER', pgTranId: 'X2' }),
          ]),
        ],
        ['is declined', paratikaDeclined('ERR10020', 'Geçersiz kullanıcı bilgileri')],
      ])('fails closed when the order query %s', async (_case, orderAnswer) => {
        post
          .mockResolvedValueOnce({ data: paratikaTransactions([saleWithoutOrder]) })
          .mockResolvedValueOnce({ data: orderAnswer });
        const result = await unsignedProvider.completeThreeDSPayment(unsigned);
        expect(result.status).toBe(PaymentStatus.FAILURE);
        expect(result.errorCode).toBe('INVALID_HASH');
        expect(result.paymentId).toBeUndefined();
        expect(result.conversationId).toBeUndefined();
      });
    });

    it('fails without ids on a declined callback, without querying', async () => {
      const result = await create({ secretKey: undefined }).completeThreeDSPayment({
        ...PARATIKA_3D_CALLBACK,
        responseCode: '99',
        errorCode: 'ERR30002',
        errorMsg: '3D işlemi başarısız',
      });
      expect(post).not.toHaveBeenCalled();
      expect(result.code).toBe(PaymentErrorCode.THREEDS_FAILED);
      expect(result.conversationId).toBeUndefined();
    });

    it('returns pending with the ids on a timeout', async () => {
      post.mockRejectedValue(timeout());
      const result = await provider.completeThreeDSPayment(PARATIKA_3D_CALLBACK);
      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.paymentId).toBe('18285OQZD14766');
    });
  });

  describe('3D pre-authorization', () => {
    const auth3dCallback = {
      sessionToken: 'TOKEN123',
      auth3DToken: 'AUTH3DTOKEN',
      merchantPaymentId: 'ORDER1',
      responseCode: '00',
      responseMsg: 'Approved',
      mdStatus: '1',
      mdErrorMsg: 'Authenticated',
    };

    it('initThreeDSAuthorize() posts the card to /post/auth3d/{token}', async () => {
      post.mockResolvedValue({ data: paratikaApproved({ sessionToken: 'TOKEN123' }) });
      const result = await provider.initThreeDSAuthorize({
        ...mockThreeDSPaymentRequest,
        conversationId: 'ORDER1',
      });
      expect(sent().ACTION).toBe('SESSIONTOKEN');
      expect(result.threeDSHtmlContent).toContain(
        `action="${PARATIKA_BASE_URL}/post/auth3d/TOKEN123"`
      );
    });

    it('blocks the amount with PREAUTH on the session after authentication', async () => {
      post.mockResolvedValue({ data: paratikaApproved({ pgTranId: 'P1' }) });

      const result = await provider.completeThreeDSPayment(auth3dCallback);

      expect(sent()).toMatchObject({
        ACTION: 'PREAUTH',
        SESSIONTOKEN: 'TOKEN123',
        AUTH3DTOKEN: 'AUTH3DTOKEN',
      });
      expect(sent()).not.toHaveProperty('CARDPAN');
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('P1');
      expect(result.conversationId).toBe('ORDER1');
    });

    it('fails without ids when authentication failed or mdStatus is not accepted', async () => {
      const failed = await provider.completeThreeDSPayment({
        ...auth3dCallback,
        responseCode: '99',
        errorCode: 'ERR30002',
      });
      expect(failed.code).toBe(PaymentErrorCode.THREEDS_FAILED);

      const halfSecure = await provider.completeThreeDSPayment({
        ...auth3dCallback,
        mdStatus: '2',
      });
      expect(halfSecure.errorCode).toBe('MD_STATUS_2');
      expect(halfSecure.paymentId).toBeUndefined();
      expect(post).not.toHaveBeenCalled();

      post.mockResolvedValue({ data: paratikaApproved({ pgTranId: 'P1' }) });
      const lenient = await create({ acceptedMdStatuses: ['1', '2'] }).completeThreeDSPayment({
        ...auth3dCallback,
        mdStatus: '2',
      });
      expect(lenient.status).toBe(PaymentStatus.SUCCESS);
    });

    it('fails without ids when PREAUTH is declined', async () => {
      post.mockResolvedValue({ data: paratikaDeclined() });
      const result = await provider.completeThreeDSPayment(auth3dCallback);
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.paymentId).toBeUndefined();
      expect(result.conversationId).toBeUndefined();
    });
  });

  describe('refund, cancel, capture, getPayment', () => {
    it('refunds and cancels by pgTranId', async () => {
      post.mockResolvedValue({ data: paratikaApproved({ pgTranId: 'R1' }) });
      const refund = await provider.refund({
        paymentId: '18285OQZD14766',
        price: '0.5',
        currency: 'TRY',
        ip: '1.1.1.1',
      });
      expect(sent()).toMatchObject({
        ACTION: 'REFUND',
        PGTRANID: '18285OQZD14766',
        AMOUNT: '0.50',
        CURRENCY: 'TRY',
      });
      expect(refund.refundId).toBe('R1');

      const cancel = await provider.cancel({ paymentId: '18285OQZD14766', ip: '1.1.1.1' });
      expect(sent(1)).toMatchObject({ ACTION: 'VOID', PGTRANID: '18285OQZD14766' });
      expect(cancel.status).toBe(PaymentStatus.SUCCESS);
    });

    it('authorizes, captures and voids', async () => {
      post.mockResolvedValue({ data: paratikaApproved() });
      await provider.authorize(order);
      expect(sent().ACTION).toBe('PREAUTH');
      await provider.capture({ paymentId: '18285OQZD14766', amount: '1', ip: '1.1.1.1' });
      expect(sent(1)).toMatchObject({
        ACTION: 'POSTAUTH',
        PGTRANID: '18285OQZD14766',
        AMOUNT: '1.00',
      });
      await provider.voidAuthorization({ paymentId: '18285OQZD14766', ip: '1.1.1.1' });
      expect(sent(2).ACTION).toBe('VOID');
    });

    it('getPayment: an approved sale is success, cancelled once voided or refunded', async () => {
      post
        .mockResolvedValueOnce({ data: paratikaTransactions([paratikaSale()]) })
        .mockResolvedValueOnce({ data: paratikaTransactions([paratikaSale()]) });
      const paid = await provider.getPayment('18285OQZD14766');
      expect(sent(1)).toMatchObject({ ACTION: 'QUERYTRANSACTION', MERCHANTPAYMENTID: 'ORDER1' });
      expect(paid.status).toBe(PaymentStatus.SUCCESS);
      expect(paid.conversationId).toBe('ORDER1');

      post
        .mockResolvedValueOnce({ data: paratikaTransactions([paratikaSale()]) })
        .mockResolvedValueOnce({
          data: paratikaTransactions([
            paratikaSale(),
            paratikaSale({ pgTranId: 'V1', transactionType: 'VOID' }),
          ]),
        });
      expect((await provider.getPayment('18285OQZD14766')).status).toBe(PaymentStatus.CANCELLED);
    });

    it('getPayment: a declined or unknown transaction is failure', async () => {
      post.mockResolvedValueOnce({ data: paratikaTransactions([]) });
      expect((await provider.getPayment('X')).status).toBe(PaymentStatus.FAILURE);
      post
        .mockResolvedValueOnce({
          data: paratikaTransactions([paratikaSale({ transactionStatus: 'DE' })]),
        })
        .mockResolvedValueOnce({ data: paratikaTransactions([]) });
      expect((await provider.getPayment('18285OQZD14766')).status).toBe(PaymentStatus.FAILURE);
    });
  });

  describe('BIN and installments', () => {
    it('binCheck maps QUERYBIN', async () => {
      post.mockResolvedValue({
        data: paratikaApproved({
          bin: {
            bin: '450803',
            cardBrand: 'VISA',
            cardType: 'CREDIT',
            cardLevel: 'BUSINESS',
            cardNetwork: 'MAXIMUM',
            issuer: 'T. IS BANKASI A.S.',
          },
        }),
      });
      const bin = await provider.binCheck('450803');
      expect(sent()).toMatchObject({ ACTION: 'QUERYBIN', BIN: '450803' });
      expect(bin).toMatchObject({
        cardType: 'CREDIT_CARD',
        cardAssociation: 'VISA',
        cardFamily: 'MAXIMUM',
        bankName: 'T. IS BANKASI A.S.',
        commercial: true,
      });
    });

    it('installmentInfo adds the customer commission to each total', async () => {
      post.mockResolvedValue({
        data: paratikaApproved({
          paymentSystemList: [
            {
              name: 'My Finans Webpos Online Account (Test)',
              installmentList: [
                { count: 'NOT_ON_US', customerCostCommissionRate: 0 },
                { count: '3', customerCostCommissionRate: 5 },
              ],
            },
          ],
        }),
      });
      const result = await provider.installmentInfo({ binNumber: '402277', price: '100' });
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails![0].installmentPrices).toEqual([
        { installmentNumber: 1, totalPrice: 100, installmentPrice: 100, commissionRate: 0 },
        { installmentNumber: 3, totalPrice: 105, installmentPrice: 35, commissionRate: 5 },
      ]);
    });
  });

  describe('paratika()', () => {
    it.each([
      ['paratika', 'https://entegrasyon.paratika.com.tr/paratika/api/v2'],
      ['vakifpay', 'https://testpos.vakifpays.com.tr/vakifpays/api/v2'],
      ['ziraatpay', 'https://test.ziraatpay.com.tr/ziraatpay/api/v2'],
    ] as const)('uses the %s test host in sandbox mode', (brand, url) => {
      const bp = betterPayment({
        mode: 'sandbox',
        providers: { pos: paratika({ ...PARATIKA_TEST, brand }) },
      });
      expect((bp.pos as any).config.baseUrl).toBe(url);
    });

    it('uses the production hosts', () => {
      expect(PROVIDER_DEFAULT_URLS[ProviderType.VAKIFPAY].production).toBe(
        'https://pos.vakifpays.com.tr/vakifpays/api/v2'
      );
      expect(PROVIDER_DEFAULT_URLS[ProviderType.ZIRAATPAY].production).toBe(
        'https://vpos.ziraatpay.com.tr/ziraatpay/api/v2'
      );
    });
  });
});
