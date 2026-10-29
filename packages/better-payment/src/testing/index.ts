/**
 * better-payment/testing
 *
 * An in-memory payment provider for application tests: no network access, no
 * provider sandbox. Pass it to betterPayment() as a provider (`providers: { mock: new MockProvider() }`) and drive
 * outcomes with magic card numbers or with `failNext()` / `networkErrorNext()`.
 */
// Classes and enums come from the main entry point (kept external in the build), so
// that `instanceof PaymentProvider` / `ValidationError` checks in better-payment see
// the same classes. Only stateless helpers are bundled into this entry.
import {
  PaymentProvider,
  PaymentErrorCode,
  PaymentStatus,
  ValidationError,
  type PaymentProviderConfig,
} from 'better-payment';
import type { PaymentValidationRules } from '../core/validation';
import { maxInstallment } from '../core/utils';
import { hmac, randomHex, safeEqual, toHex } from '../core/crypto';
import type {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  ThreeDSInitResponse,
  CheckoutRequest,
  CheckoutInitResponse,
  RefundRequest,
  RefundResponse,
  CancelRequest,
  CancelResponse,
  CaptureRequest,
  VoidAuthorizationRequest,
  SaveCardRequest,
  SaveCardResponse,
  ListCardsResponse,
  DeleteCardRequest,
  DeleteCardResponse,
  StoredCard,
  BinCheckResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
} from '../types';

/**
 * Magic card numbers. Any other valid card number succeeds. All numbers pass the
 * Luhn check; use any future expiry date and any 3-digit CVC.
 */
export const MOCK_CARDS = {
  /** Succeeds (Visa) */
  SUCCESS: '4242424242424242',
  /** Succeeds (Mastercard) */
  SUCCESS_MASTERCARD: '5555555555554444',
  CARD_DECLINED: '4000000000000002',
  INSUFFICIENT_FUNDS: '4000000000009995',
  EXPIRED_CARD: '4000000000000069',
  INVALID_CVC: '4000000000000127',
  FRAUD_SUSPECTED: '4100000000000019',
  LIMIT_EXCEEDED: '4000000000009987',
  PROVIDER_ERROR: '4000000000000119',
  /** Declined without 3D Secure (`CARD_DECLINED`); succeeds with 3D Secure */
  THREEDS_REQUIRED: '4000002760003184',
  /** 3D Secure authentication fails (`THREEDS_FAILED`) */
  THREEDS_FAILED: '4000008400001629',
  /**
   * The payment is processed, but the response is lost: the result is `PENDING` with
   * `NETWORK_ERROR`, and `getPayment()` then reports the payment as successful.
   */
  NETWORK_ERROR: '4000000000000341',
  /** Payments succeed; refunds and cancels fail with `PROVIDER_ERROR` */
  REFUND_FAILS: '4000000000005126',
} as const;

export type MockOperation =
  'payment' | 'threeDSInit' | 'threeDSComplete' | 'refund' | 'cancel' | 'capture' | 'void';

export type MockPaymentState =
  'pending_3ds' | 'succeeded' | 'authorized' | 'failed' | 'cancelled' | 'voided';

/** A payment as the mock bank sees it (returned by `getRecord()` and in `rawResponse`) */
export interface MockPaymentRecord {
  paymentId: string;
  conversationId?: string;
  state: MockPaymentState;
  /** Amounts in minor units (kuruş/cents) */
  amount: number;
  /** Captured amount for pre-authorizations, otherwise equal to `amount` */
  capturedAmount: number;
  refundedAmount: number;
  currency: string;
  installment: number;
  cardLastFour?: string;
  preAuth: boolean;
  errorCode?: PaymentErrorCode;
  refunds: Array<{ refundId: string; amount: number }>;
  createdAt: string;
}

export interface MockProviderConfig extends PaymentProviderConfig {
  /**
   * Secret that signs 3D Secure callbacks. Default: random per instance, so
   * callbacks from another instance are rejected like forged ones.
   */
  secret?: string;
  /** Commission rates by installment count for `installmentInfo()`. Default: 1→0, 2→2, 3→3, 6→5 (%) */
  installmentRates?: Record<number, number>;
}

type Scenario =
  | { type: 'success' }
  | { type: 'decline'; code: PaymentErrorCode; message?: string }
  | { type: 'threeds-required' }
  | { type: 'threeds-failed' }
  | { type: 'network-error' }
  | { type: 'refund-fails' };

const DECLINE_MESSAGES: Partial<Record<PaymentErrorCode, string>> = {
  [PaymentErrorCode.CARD_DECLINED]: 'The card was declined',
  [PaymentErrorCode.INSUFFICIENT_FUNDS]: 'Insufficient funds',
  [PaymentErrorCode.EXPIRED_CARD]: 'The card has expired',
  [PaymentErrorCode.INVALID_CVC]: 'The CVC is incorrect',
  [PaymentErrorCode.FRAUD_SUSPECTED]: 'The payment was blocked as suspected fraud',
  [PaymentErrorCode.LIMIT_EXCEEDED]: 'The card limit was exceeded',
  [PaymentErrorCode.PROVIDER_ERROR]: 'The mock bank could not process the request',
  [PaymentErrorCode.THREEDS_FAILED]: '3D Secure authentication failed',
};

const CARD_SCENARIOS: Record<string, Scenario> = {
  [MOCK_CARDS.CARD_DECLINED]: { type: 'decline', code: PaymentErrorCode.CARD_DECLINED },
  [MOCK_CARDS.INSUFFICIENT_FUNDS]: { type: 'decline', code: PaymentErrorCode.INSUFFICIENT_FUNDS },
  [MOCK_CARDS.EXPIRED_CARD]: { type: 'decline', code: PaymentErrorCode.EXPIRED_CARD },
  [MOCK_CARDS.INVALID_CVC]: { type: 'decline', code: PaymentErrorCode.INVALID_CVC },
  [MOCK_CARDS.FRAUD_SUSPECTED]: { type: 'decline', code: PaymentErrorCode.FRAUD_SUSPECTED },
  [MOCK_CARDS.LIMIT_EXCEEDED]: { type: 'decline', code: PaymentErrorCode.LIMIT_EXCEEDED },
  [MOCK_CARDS.PROVIDER_ERROR]: { type: 'decline', code: PaymentErrorCode.PROVIDER_ERROR },
  [MOCK_CARDS.THREEDS_REQUIRED]: { type: 'threeds-required' },
  [MOCK_CARDS.THREEDS_FAILED]: { type: 'threeds-failed' },
  [MOCK_CARDS.NETWORK_ERROR]: { type: 'network-error' },
  [MOCK_CARDS.REFUND_FAILS]: { type: 'refund-fails' },
};

const RULES: PaymentValidationRules = { card: true, storedCard: true, saveCard: true };

const IDENTITY_CODES = Object.fromEntries(
  Object.values(PaymentErrorCode).map((code) => [code, code])
) as Record<string, PaymentErrorCode>;

interface SavedCard extends StoredCard {
  scenario: Scenario;
}

interface InternalRecord extends MockPaymentRecord {
  scenario: Scenario;
  saveCard?: PaymentRequest['saveCard'];
  cardNumber?: string;
  cardHolderName?: string;
  expireMonth?: string;
  expireYear?: string;
}

/**
 * In-memory payment provider for tests.
 *
 * @example
 * ```ts
 * import { betterPayment } from 'better-payment';
 * import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
 *
 * const payment = betterPayment({ providers: { mock: new MockProvider() } });
 *
 * const result = await payment.mock.createPayment({
 *   ...order,
 *   paymentCard: { ...card, cardNumber: MOCK_CARDS.INSUFFICIENT_FUNDS },
 * });
 * // result.status === 'failure', result.code === 'INSUFFICIENT_FUNDS'
 * ```
 */
export class MockProvider extends PaymentProvider<MockProviderConfig> {
  private readonly secret: string;
  private readonly records = new Map<string, InternalRecord>();
  private readonly cards = new Map<string, SavedCard[]>();
  private readonly hosted = new Set<string>();
  private readonly queued: Array<{ operation: MockOperation; scenario: Scenario }> = [];
  private sequence = 0;

  constructor(config: MockProviderConfig = {}) {
    super(config);
    this.secret = config.secret ?? randomHex(16);
  }

  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return { ...IDENTITY_CODES, THREEDS_REQUIRED: PaymentErrorCode.CARD_DECLINED };
  }

  // ---- Test controls ------------------------------------------------------

  /** The next `operation` fails with `code` (default CARD_DECLINED), whatever the card */
  failNext(
    operation: MockOperation,
    code: PaymentErrorCode = PaymentErrorCode.CARD_DECLINED,
    message?: string
  ): this {
    this.queued.push({ operation, scenario: { type: 'decline', code, message } });
    return this;
  }

  /**
   * The next `operation` is processed but its response is lost: it returns PENDING
   * with NETWORK_ERROR, and `getPayment()` shows the real outcome.
   */
  networkErrorNext(operation: MockOperation): this {
    this.queued.push({ operation, scenario: { type: 'network-error' } });
    return this;
  }

  /** Clears payments, saved cards and queued outcomes */
  reset(): void {
    this.records.clear();
    this.cards.clear();
    this.hosted.clear();
    this.queued.length = 0;
    this.sequence = 0;
  }

  /** The mock bank's record of a payment, for assertions */
  getRecord(paymentId: string): MockPaymentRecord | undefined {
    const record = this.records.get(paymentId);
    return record ? this.publicRecord(record) : undefined;
  }

  /** All payments, oldest first */
  get payments(): MockPaymentRecord[] {
    return [...this.records.values()].map((record) => this.publicRecord(record));
  }

  /**
   * The signed callback the mock bank posts to `callbackUrl` after the 3D Secure
   * page. Post it to the handler (`/mock/payment/complete-3ds`) or pass it to
   * `completeThreeDSPayment()`. `approve: false` simulates a failed or abandoned
   * authentication.
   */
  async threeDSCallback(
    paymentId: string,
    options: { approve?: boolean } = {}
  ): Promise<Record<string, string>> {
    const record = this.records.get(paymentId);
    const approve = (options.approve ?? true) && record?.scenario.type !== 'threeds-failed';
    const mdStatus = approve ? '1' : '0';
    return {
      paymentId,
      conversationId: record?.conversationId ?? '',
      mdStatus,
      signature: await this.sign(paymentId, mdStatus),
    };
  }

  // ---- Payments -----------------------------------------------------------

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.pay(request, false);
  }

  async authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.pay(request, true);
  }

  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.initThreeDS(request, false);
  }

  async initThreeDSAuthorize(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.initThreeDS(request, true);
  }

  async completeThreeDSPayment(callbackData: unknown): Promise<PaymentResponse> {
    const data = (callbackData ?? {}) as Record<string, unknown>;
    const paymentId = typeof data.paymentId === 'string' ? data.paymentId : '';
    const mdStatus = typeof data.mdStatus === 'string' ? data.mdStatus : '';
    const signature = typeof data.signature === 'string' ? data.signature : '';

    if (!paymentId || !safeEqual(await this.sign(paymentId, mdStatus), signature)) {
      return this.failure('INVALID_HASH', 'Invalid 3D Secure callback signature', {
        paymentId: paymentId || undefined,
        rawResponse: callbackData,
      });
    }
    const record = this.records.get(paymentId);
    if (!record) {
      return this.failure(PaymentErrorCode.INVALID_REQUEST, `Unknown payment ${paymentId}`, {
        paymentId,
      });
    }
    if (record.state !== 'pending_3ds') return this.paymentResult(record);

    const forced = this.take('threeDSComplete');
    if (mdStatus !== '1') {
      return this.settle(
        record,
        forced ?? {
          type: 'decline',
          code: PaymentErrorCode.THREEDS_FAILED,
        }
      );
    }
    return this.settle(record, forced ?? record.scenario);
  }

  /**
   * The mock hosted page: the customer enters the card on `redirectUrl`, not in
   * your request. `completeCheckoutPage()` plays the customer; the returned
   * signed callback then goes through the normal verified flow (`/mock/callback`
   * or `completeThreeDSPayment()`). The payment is `pending` until then.
   */
  async createCheckout(request: CheckoutRequest): Promise<CheckoutInitResponse> {
    try {
      this.validatePayment(request, { required: ['returnUrl'] });
      const amount = toMinor(request.paidPrice ?? request.price);
      const record: InternalRecord = {
        paymentId: this.nextId('MOCKPAY'),
        conversationId: request.conversationId,
        state: 'pending_3ds',
        amount,
        capturedAmount: amount,
        refundedAmount: 0,
        currency: String(request.currency ?? 'TRY'),
        installment: maxInstallment(request.installments) ?? 1,
        preAuth: false,
        refunds: [],
        createdAt: new Date().toISOString(),
        scenario: { type: 'success' },
      };
      this.records.set(record.paymentId, record);
      this.hosted.add(record.paymentId);
      return {
        status: PaymentStatus.PENDING,
        redirectUrl: `https://mock.bank/checkout/${record.paymentId}`,
        iframeUrl: `https://mock.bank/checkout/${record.paymentId}`,
        token: record.paymentId,
        paymentId: record.paymentId,
        conversationId: record.conversationId,
      };
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        return this.failure('VALIDATION_ERROR', error.message, {
          conversationId: request?.conversationId,
        });
      }
      throw error;
    }
  }

  /**
   * Plays the customer on the mock hosted page: picks the card (default
   * `MOCK_CARDS.SUCCESS`) and returns the signed callback to post to the
   * handler. The payment stays pending until that callback is verified.
   */
  async completeCheckoutPage(
    token: string,
    options: { cardNumber?: string; approve?: boolean } = {}
  ): Promise<Record<string, string>> {
    const record = this.records.get(token);
    if (!record || !this.hosted.delete(token)) {
      throw new ValidationError(`Unknown checkout ${token}`);
    }
    const cardNumber = (options.cardNumber ?? MOCK_CARDS.SUCCESS).replace(/\s/g, '');
    record.cardNumber = cardNumber;
    record.cardLastFour = cardNumber.slice(-4);
    record.scenario =
      options.approve === false
        ? { type: 'decline', code: PaymentErrorCode.THREEDS_FAILED }
        : (CARD_SCENARIOS[cardNumber] ?? { type: 'success' });
    return this.threeDSCallback(token);
  }

  /** The mock's record of a hosted checkout; `pending` until the callback settles it */
  async getCheckoutResult(token: string): Promise<PaymentResponse> {
    return this.getPayment(token);
  }

  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    return this.guard(() => this.doCapture(request), { paymentId: request?.paymentId });
  }

  private async doCapture(request: CaptureRequest): Promise<PaymentResponse> {
    this.validateCapture(request);
    const record = this.records.get(request.paymentId);
    const forced = this.take('capture');
    if (!record || record.state !== 'authorized') {
      return this.failure(
        PaymentErrorCode.INVALID_REQUEST,
        'Only an authorized pre-authorization can be captured',
        { paymentId: request.paymentId }
      );
    }
    const amount = toMinor(request.amount);
    if (amount > record.amount) {
      return this.failure(
        PaymentErrorCode.INVALID_REQUEST,
        'Capture amount exceeds the authorized amount',
        { paymentId: record.paymentId }
      );
    }
    if (forced?.type === 'decline') return this.decline(forced, { paymentId: record.paymentId });
    record.state = 'succeeded';
    record.capturedAmount = amount;
    if (forced?.type === 'network-error') return this.lost({ paymentId: record.paymentId });
    return this.paymentResult(record);
  }

  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    const record = this.records.get(request.paymentId);
    const forced = this.take('void');
    if (!record || record.state !== 'authorized') {
      return this.failure(
        PaymentErrorCode.INVALID_REQUEST,
        'Only an authorized pre-authorization can be voided',
        { conversationId: request.conversationId }
      );
    }
    if (forced?.type === 'decline') return this.decline(forced, {});
    record.state = 'voided';
    if (forced?.type === 'network-error') return this.lost({});
    return {
      status: PaymentStatus.SUCCESS,
      voidId: record.paymentId,
      rawResponse: this.publicRecord(record),
    };
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    return this.guard(() => this.doRefund(request), { conversationId: request?.conversationId });
  }

  private async doRefund(request: RefundRequest): Promise<RefundResponse> {
    this.validateRefund(request);
    const record = this.records.get(request.paymentId);
    const forced = this.take('refund');
    if (!record || record.state !== 'succeeded') {
      return this.failure(
        PaymentErrorCode.INVALID_REQUEST,
        'Only a successful payment can be refunded',
        {
          conversationId: request.conversationId,
        }
      );
    }
    const amount = toMinor(request.price);
    if (record.refundedAmount + amount > record.capturedAmount) {
      return this.failure(
        PaymentErrorCode.INVALID_REQUEST,
        'Refund amount exceeds the refundable amount',
        { conversationId: request.conversationId }
      );
    }
    const refundFails = record.scenario.type === 'refund-fails';
    if (forced?.type === 'decline' || (!forced && refundFails)) {
      return this.decline(
        forced?.type === 'decline'
          ? forced
          : {
              code: PaymentErrorCode.PROVIDER_ERROR,
              message: 'Refund rejected by the mock bank',
            },
        { conversationId: request.conversationId }
      );
    }
    const refundId = this.nextId('MOCKREF');
    record.refundedAmount += amount;
    record.refunds.push({ refundId, amount });
    if (forced?.type === 'network-error')
      return this.lost({ conversationId: request.conversationId });
    return {
      status: PaymentStatus.SUCCESS,
      refundId,
      conversationId: request.conversationId,
      rawResponse: this.publicRecord(record),
    };
  }

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    const record = this.records.get(request.paymentId);
    const forced = this.take('cancel');
    if (!record || record.state !== 'succeeded' || record.refundedAmount > 0) {
      return this.failure(
        PaymentErrorCode.INVALID_REQUEST,
        'Only a successful payment without refunds can be cancelled',
        { conversationId: request.conversationId }
      );
    }
    if (forced?.type === 'decline' || (!forced && record.scenario.type === 'refund-fails')) {
      return this.decline(
        forced?.type === 'decline'
          ? forced
          : {
              code: PaymentErrorCode.PROVIDER_ERROR,
              message: 'Cancel rejected by the mock bank',
            },
        { conversationId: request.conversationId }
      );
    }
    record.state = 'cancelled';
    if (forced?.type === 'network-error')
      return this.lost({ conversationId: request.conversationId });
    return {
      status: PaymentStatus.SUCCESS,
      transactionId: record.paymentId,
      conversationId: request.conversationId,
      rawResponse: this.publicRecord(record),
    };
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    const record = this.records.get(paymentId);
    if (!record) {
      return this.failure(PaymentErrorCode.INVALID_REQUEST, `Unknown payment ${paymentId}`, {
        paymentId,
      });
    }
    return this.paymentResult(record);
  }

  // ---- Stored cards, BIN, installments ------------------------------------

  async saveCard(request: SaveCardRequest): Promise<SaveCardResponse> {
    return this.guard(() => this.doSaveCard(request), {});
  }

  private async doSaveCard(request: SaveCardRequest): Promise<SaveCardResponse> {
    const card = request.card;
    if (!card?.cardNumber) throw new ValidationError('card.cardNumber is required');
    const customerToken = request.customerToken ?? this.nextId('MOCKCUS');
    const saved = this.store(
      customerToken,
      card.cardNumber,
      card.expireMonth,
      card.expireYear,
      request.alias
    );
    return {
      status: PaymentStatus.SUCCESS,
      customerToken,
      card: this.publicCard(saved),
    };
  }

  async listCards(request: { customerToken: string }): Promise<ListCardsResponse> {
    const cards = this.cards.get(request.customerToken) ?? [];
    return {
      status: PaymentStatus.SUCCESS,
      customerToken: request.customerToken,
      cards: cards.map((card) => this.publicCard(card)),
    };
  }

  async deleteCard(request: DeleteCardRequest): Promise<DeleteCardResponse> {
    const cards = this.cards.get(request.customerToken) ?? [];
    const remaining = cards.filter((card) => card.cardToken !== request.cardToken);
    if (remaining.length === cards.length) {
      return this.failure(PaymentErrorCode.INVALID_REQUEST, 'Unknown card', {});
    }
    this.cards.set(request.customerToken, remaining);
    return { status: PaymentStatus.SUCCESS };
  }

  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    const association = associationOf(binNumber);
    return {
      binNumber: binNumber.slice(0, 6),
      cardType: 'CREDIT_CARD',
      cardAssociation: association,
      cardFamily: 'Mock',
      bankName: 'Mock Bank',
      bankCode: 999,
      commercial: false,
    };
  }

  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    return this.guard(() => this.doInstallmentInfo(request), {
      conversationId: request?.conversationId,
    });
  }

  private async doInstallmentInfo(
    request: InstallmentInfoRequest
  ): Promise<InstallmentInfoResponse> {
    const rates = this.config.installmentRates ?? { 1: 0, 2: 2, 3: 3, 6: 5 };
    const price = toMinor(request.price);
    return {
      status: PaymentStatus.SUCCESS,
      conversationId: request.conversationId,
      installmentDetails: [
        {
          binNumber: request.binNumber.slice(0, 6),
          price: price / 100,
          cardType: 'CREDIT_CARD',
          cardAssociation: associationOf(request.binNumber),
          cardFamilyName: 'Mock',
          bankCode: 999,
          bankName: 'Mock Bank',
          commercial: 0,
          installmentPrices: Object.entries(rates)
            .map(([count, rate]) => {
              const installments = Number(count);
              const total = Math.round((price * (100 + rate)) / 100);
              return {
                installmentNumber: installments,
                totalPrice: total / 100,
                installmentPrice: Math.round(total / installments) / 100,
                commissionRate: rate,
              };
            })
            .sort((a, b) => a.installmentNumber - b.installmentNumber),
        },
      ],
    };
  }

  // ---- Internals ----------------------------------------------------------

  private async pay(request: PaymentRequest, preAuth: boolean): Promise<PaymentResponse> {
    let record: InternalRecord;
    try {
      this.validatePayment(request, RULES);
      record = this.open(request, preAuth);
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        return this.failure('VALIDATION_ERROR', error.message, {
          conversationId: request?.conversationId,
        });
      }
      throw error;
    }
    const scenario = this.take('payment') ?? record.scenario;
    if (scenario.type === 'threeds-required') {
      return this.settle(
        record,
        {
          type: 'decline',
          code: PaymentErrorCode.CARD_DECLINED,
          message: '3D Secure authentication is required for this card',
        },
        'THREEDS_REQUIRED'
      );
    }
    return this.settle(record, scenario.type === 'threeds-failed' ? { type: 'success' } : scenario);
  }

  private async initThreeDS(
    request: ThreeDSPaymentRequest,
    preAuth: boolean
  ): Promise<ThreeDSInitResponse> {
    let record: InternalRecord;
    try {
      this.validatePayment(request, RULES);
      if (!request.callbackUrl) throw new ValidationError('callbackUrl is required');
      record = this.open(request, preAuth);
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        return this.failure('VALIDATION_ERROR', error.message, {
          conversationId: request?.conversationId,
        });
      }
      throw error;
    }
    record.state = 'pending_3ds';

    const forced = this.take('threeDSInit');
    if (forced?.type === 'decline') {
      record.state = 'failed';
      record.errorCode = forced.code;
      return this.decline(forced, {
        paymentId: record.paymentId,
        conversationId: record.conversationId,
      });
    }
    if (forced?.type === 'network-error') {
      return this.lost({ paymentId: record.paymentId, conversationId: record.conversationId });
    }

    const fields = await this.threeDSCallback(record.paymentId);
    return {
      status: PaymentStatus.PENDING,
      paymentId: record.paymentId,
      conversationId: record.conversationId,
      threeDSHtmlContent: autoSubmitForm(request.callbackUrl, fields),
      rawResponse: this.publicRecord(record),
    };
  }

  /** Creates the record for a new payment */
  private open(request: PaymentRequest, preAuth: boolean): InternalRecord {
    let cardNumber: string | undefined;
    let scenario: Scenario;
    if (request.storedCard) {
      const saved = (this.cards.get(request.storedCard.customerToken) ?? []).find(
        (card) => card.cardToken === request.storedCard?.cardToken
      );
      if (!saved) throw new ValidationError('Unknown stored card');
      scenario = saved.scenario;
      cardNumber = `${saved.binNumber}000000${saved.lastFourDigits}`;
    } else {
      const card = this.cardOf(request);
      cardNumber = card.cardNumber.replace(/\s/g, '');
      scenario = CARD_SCENARIOS[cardNumber] ?? { type: 'success' };
    }
    const amount = toMinor(request.paidPrice ?? request.price);
    const record: InternalRecord = {
      paymentId: this.nextId('MOCKPAY'),
      conversationId: request.conversationId,
      state: 'failed',
      amount,
      capturedAmount: preAuth ? 0 : amount,
      refundedAmount: 0,
      currency: String(request.currency ?? 'TRY'),
      installment: Number((request as { installment?: number }).installment ?? 1),
      cardLastFour: cardNumber.slice(-4),
      preAuth,
      refunds: [],
      createdAt: new Date().toISOString(),
      scenario,
      saveCard: request.saveCard,
      cardNumber: request.storedCard ? undefined : cardNumber,
      cardHolderName: request.paymentCard?.cardHolderName,
      expireMonth: request.paymentCard?.expireMonth,
      expireYear: request.paymentCard?.expireYear,
    };
    this.records.set(record.paymentId, record);
    return record;
  }

  /** Applies the outcome to a payment and returns the result */
  private settle(record: InternalRecord, scenario: Scenario, rawCode?: string): PaymentResponse {
    if (scenario.type === 'decline') {
      record.state = 'failed';
      record.errorCode = scenario.code;
      return this.decline(
        scenario,
        {
          paymentId: record.paymentId,
          conversationId: record.conversationId,
          rawResponse: this.publicRecord(record),
        },
        rawCode
      );
    }
    record.state = record.preAuth ? 'authorized' : 'succeeded';
    const storedCard = this.saveFromPayment(record);
    if (scenario.type === 'network-error') {
      return this.lost({ paymentId: record.paymentId, conversationId: record.conversationId });
    }
    return { ...this.paymentResult(record), ...(storedCard ? { storedCard } : {}) };
  }

  private saveFromPayment(record: InternalRecord): PaymentResponse['storedCard'] {
    if (!record.saveCard || !record.cardNumber) return undefined;
    const options = typeof record.saveCard === 'object' ? record.saveCard : {};
    const customerToken = options.customerToken ?? this.nextId('MOCKCUS');
    const saved = this.store(
      customerToken,
      record.cardNumber,
      record.expireMonth,
      record.expireYear,
      options.alias
    );
    return { customerToken, cardToken: saved.cardToken };
  }

  private store(
    customerToken: string,
    cardNumber: string,
    expireMonth?: string,
    expireYear?: string,
    alias?: string
  ): SavedCard {
    const digits = cardNumber.replace(/\s/g, '');
    const saved: SavedCard = {
      cardToken: this.nextId('MOCKCARD'),
      alias,
      binNumber: digits.slice(0, 6),
      lastFourDigits: digits.slice(-4),
      expireMonth,
      expireYear,
      cardType: 'CREDIT_CARD',
      cardAssociation: associationOf(digits),
      bankName: 'Mock Bank',
      scenario: CARD_SCENARIOS[digits] ?? { type: 'success' },
    };
    this.cards.set(customerToken, [...(this.cards.get(customerToken) ?? []), saved]);
    return saved;
  }

  private paymentResult(record: InternalRecord): PaymentResponse {
    const status =
      record.state === 'succeeded' || record.state === 'authorized'
        ? PaymentStatus.SUCCESS
        : record.state === 'pending_3ds'
          ? PaymentStatus.PENDING
          : record.state === 'cancelled' || record.state === 'voided'
            ? PaymentStatus.CANCELLED
            : PaymentStatus.FAILURE;
    const result: PaymentResponse = {
      status,
      paymentId: record.paymentId,
      conversationId: record.conversationId,
      rawResponse: this.publicRecord(record),
    };
    if (status === PaymentStatus.FAILURE) {
      const code = record.errorCode ?? PaymentErrorCode.UNKNOWN;
      return this.withErrorCode({
        ...result,
        errorCode: code,
        errorMessage: DECLINE_MESSAGES[code],
      });
    }
    return result;
  }

  private decline<T extends { status: PaymentStatus }>(
    scenario: { code: PaymentErrorCode; message?: string },
    extra: Record<string, unknown>,
    rawCode?: string
  ): T {
    return this.failure<T>(
      rawCode ?? scenario.code,
      scenario.message ?? DECLINE_MESSAGES[scenario.code] ?? 'Declined by the mock bank',
      extra
    );
  }

  private failure<T extends { status: PaymentStatus }>(
    errorCode: string,
    errorMessage: string,
    extra: Record<string, unknown>
  ): T {
    return this.withErrorCode({
      status: PaymentStatus.FAILURE,
      errorCode,
      errorMessage,
      ...extra,
    }) as unknown as T;
  }

  /** The operation went through, but the response was lost */
  private lost<T extends { status: PaymentStatus }>(extra: Record<string, unknown>): T {
    return this.withErrorCode({
      status: PaymentStatus.PENDING,
      errorCode: NETWORK_ERROR_CODE,
      errorMessage:
        'No response from the mock bank (ETIMEDOUT). The transaction may have been processed; verify it with getPayment() before retrying.',
      ...extra,
    }) as unknown as T;
  }

  /** Invalid input becomes a VALIDATION_ERROR result, as with the other providers */
  private async guard<T extends { status: PaymentStatus }>(
    run: () => Promise<T>,
    extra: Record<string, unknown>
  ): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        return this.failure<T>('VALIDATION_ERROR', error.message, extra);
      }
      throw error;
    }
  }

  private take(operation: MockOperation): Scenario | undefined {
    const index = this.queued.findIndex((entry) => entry.operation === operation);
    if (index === -1) return undefined;
    return this.queued.splice(index, 1)[0].scenario;
  }

  private async sign(paymentId: string, mdStatus: string): Promise<string> {
    return toHex(await hmac('SHA-256', this.secret, `${paymentId}:${mdStatus}`));
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}${String(this.sequence).padStart(6, '0')}`;
  }

  private publicRecord(record: InternalRecord): MockPaymentRecord {
    return {
      paymentId: record.paymentId,
      conversationId: record.conversationId,
      state: record.state,
      amount: record.amount,
      capturedAmount: record.capturedAmount,
      refundedAmount: record.refundedAmount,
      currency: record.currency,
      installment: record.installment,
      cardLastFour: record.cardLastFour,
      preAuth: record.preAuth,
      errorCode: record.errorCode,
      refunds: record.refunds.map((refund) => ({ ...refund })),
      createdAt: record.createdAt,
    };
  }

  private publicCard(card: SavedCard): StoredCard {
    const publicCard: StoredCard & { scenario?: Scenario } = { ...card };
    delete publicCard.scenario;
    return publicCard;
  }
}

const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

/** Decimal amount ("12.50") to minor units; throws ValidationError for invalid input */
function toMinor(amount: string | number): number {
  const value = Number(String(amount ?? '').trim());
  if (String(amount ?? '').trim() === '' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(`Invalid amount: ${amount}`);
  }
  return Math.round(value * 100);
}

function associationOf(number: string): string {
  if (number.startsWith('4')) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(number)) return 'MASTER_CARD';
  if (number.startsWith('9792') || number.startsWith('65')) return 'TROY';
  if (/^3[47]/.test(number)) return 'AMERICAN_EXPRESS';
  return 'UNKNOWN';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The mock bank's 3D Secure page: posts the signed result to callbackUrl */
function autoSubmitForm(action: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
    )
    .join('');
  return (
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Mock 3D Secure</title></head><body>' +
    `<form id="mock-3ds" method="POST" action="${escapeHtml(action)}">${inputs}</form>` +
    '<script>document.getElementById("mock-3ds").submit();</script>' +
    '</body></html>'
  );
}
