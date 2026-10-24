import {
  PaymentCard,
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
  BinCheckResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  CaptureRequest,
  VoidAuthorizationRequest,
  SaveCardRequest,
  SaveCardResponse,
  ListCardsResponse,
  DeleteCardRequest,
  DeleteCardResponse,
  PaymentStatus,
} from '../types';
import { BetterPaymentLogger } from './logger';
import type { RetryConfig } from './retry';
import { HttpClient } from './http';
import { BetterPaymentError, ValidationError } from './errors';
import { PaymentErrorCode, resolveErrorCode } from './error-codes';
import { NETWORK_ERROR_CODE, type FailureResult } from './failure';
import {
  validateCaptureRequest,
  validatePaymentRequest,
  validateRefundAmount,
  type PaymentValidationRules,
} from './validation';

/**
 * Configuration fields shared by all providers.
 * Credentials are defined in each provider's own configuration type.
 */
export interface PaymentProviderConfig {
  baseUrl?: string;
  locale?: string;
  logger?: BetterPaymentLogger;
  retry?: RetryConfig;
  /** Custom fetch implementation for API calls. Default: globalThis.fetch. */
  fetch?: typeof fetch;
  /**
   * Validate requests before calling the provider (card, amounts, basket,
   * required fields). Default: true.
   */
  validate?: boolean;
}

/**
 * Abstract base class for all payment providers
 */
export abstract class PaymentProvider<
  TConfig extends PaymentProviderConfig = PaymentProviderConfig,
> {
  protected config: TConfig;

  constructor(config: TConfig) {
    this.config = {
      locale: 'tr',
      ...config,
    };
    this.validateConfig();
  }

  /**
   * Validate the configuration. Each provider checks its own required fields.
   */
  protected validateConfig(): void {}

  /**
   * The provider's documented error codes mapped to PaymentErrorCode.
   * Codes missing from the table resolve to UNKNOWN.
   */
  protected errorCodeTable(): Record<string, PaymentErrorCode> {
    return {};
  }

  /**
   * Throws a ValidationError naming the invalid fields, unless validation is
   * disabled with `validate: false`. Call it before building the provider request.
   */
  protected validatePayment(request: PaymentRequest, rules: PaymentValidationRules): void {
    if (this.config.validate === false) return;
    validatePaymentRequest(request, rules, this.constructor.name);
  }

  protected validateRefund(request: RefundRequest): void {
    if (this.config.validate === false) return;
    validateRefundAmount(request?.price, this.constructor.name);
  }

  /** Resolves the normalized code of a failed result */
  protected resolveErrorCode(result: FailureResult): PaymentErrorCode {
    return resolveErrorCode(result.errorCode, this.errorCodeTable());
  }

  /**
   * Adds the normalized `code` to failed results (and to NETWORK_ERROR results,
   * which are pending). Other results are returned unchanged.
   */
  protected withErrorCode<T extends FailureResult>(result: T): T {
    if (result.status !== PaymentStatus.FAILURE && result.errorCode !== NETWORK_ERROR_CODE) {
      return result;
    }
    return { ...result, code: this.resolveErrorCode(result) };
  }

  /**
   * Direct payment (without 3D Secure)
   */
  abstract createPayment(request: PaymentRequest): Promise<PaymentResponse>;

  /**
   * Initialize a 3D Secure payment
   */
  abstract initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse>;

  /**
   * Complete a 3D Secure payment (after the callback)
   */
  abstract completeThreeDSPayment(callbackData: unknown): Promise<PaymentResponse>;

  /**
   * Refund a payment
   */
  abstract refund(request: RefundRequest): Promise<RefundResponse>;

  /**
   * Cancel a payment
   */
  abstract cancel(request: CancelRequest): Promise<CancelResponse>;

  /**
   * Query a payment
   */
  abstract getPayment(paymentId: string): Promise<PaymentResponse>;

  /**
   * Creates the fetch-based HTTP client for a provider, with the configured logger,
   * retry policy (idempotent requests only) and fetch implementation.
   */
  protected createHttpClient(
    provider: string,
    options: { timeout: number; headers?: Record<string, string> }
  ): HttpClient {
    return new HttpClient({
      provider,
      baseURL: this.config.baseUrl,
      timeout: options.timeout,
      headers: options.headers,
      fetch: this.config.fetch,
      logger: this.config.logger,
      retry: this.config.retry,
    });
  }

  /**
   * Pre-authorization: blocks the amount on the card without charging it.
   * Charge it later with capture(), or release it with voidAuthorization().
   * A `success` result means the amount is blocked.
   */
  async authorize(_request: PaymentRequest): Promise<PaymentResponse> {
    throw this.notSupported('Pre-authorization');
  }

  /**
   * Pre-authorization with 3D Secure. Complete it with completeThreeDSPayment()
   * as usual; `success` then means the amount is blocked.
   */
  async initThreeDSAuthorize(_request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    throw this.notSupported('Pre-authorization');
  }

  /** Charges (all or part of) a pre-authorized amount */
  async capture(_request: CaptureRequest): Promise<PaymentResponse> {
    throw this.notSupported('Capture');
  }

  /**
   * Hosted checkout: creates the provider's payment page. The request carries no
   * card data; the customer enters it on the hosted page. Providers without a
   * verifiable hosted page throw `NOT_SUPPORTED`.
   */
  async createCheckout(_request: CheckoutRequest): Promise<CheckoutInitResponse> {
    throw this.notSupported(
      'Hosted checkout',
      'this provider has no hosted payment page, use createPayment()/initThreeDSPayment()'
    );
  }

  /**
   * The result of a hosted checkout, verified against the provider. Only a
   * `success` here (or a verified provider callback) may mark an order as paid;
   * the customer's return to your `returnUrl` is not a confirmation.
   */
  async getCheckoutResult(_token: string): Promise<PaymentResponse> {
    throw this.notSupported('Hosted checkout result lookup');
  }

  /** Releases a pre-authorization; nothing is charged */
  async voidAuthorization(_request: VoidAuthorizationRequest): Promise<CancelResponse> {
    throw this.notSupported('Voiding a pre-authorization');
  }

  /** Saves a card with the provider without charging it */
  async saveCard(_request: SaveCardRequest): Promise<SaveCardResponse> {
    throw this.notSupported('Card storage');
  }

  /** A customer's saved cards */
  async listCards(_request: { customerToken: string }): Promise<ListCardsResponse> {
    throw this.notSupported('Card storage');
  }

  /** Deletes a saved card */
  async deleteCard(_request: DeleteCardRequest): Promise<DeleteCardResponse> {
    throw this.notSupported('Card storage');
  }

  /**
   * The request's card, for code paths that need card data. Validation normally
   * rejects a missing card first; this keeps the types honest.
   */
  protected cardOf(request: { paymentCard?: PaymentCard }): PaymentCard {
    if (!request.paymentCard) {
      throw new ValidationError('paymentCard is required', undefined, [
        { path: 'paymentCard', message: 'is required' },
      ]);
    }
    return request.paymentCard;
  }

  protected notSupported(feature: string, detail?: string): BetterPaymentError {
    return new BetterPaymentError(
      `${feature} is not supported by this provider${detail ? `: ${detail}` : ''}`,
      'NOT_SUPPORTED'
    );
  }

  /** Validates a capture request (payment id and amount) */
  protected validateCapture(request: CaptureRequest): void {
    if (this.config.validate === false) return;
    validateCaptureRequest(request, this.constructor.name);
  }

  /**
   * Look up a BIN
   */
  async binCheck(_binNumber: string): Promise<BinCheckResponse> {
    throw new BetterPaymentError('BIN check is not supported by this provider', 'NOT_SUPPORTED');
  }

  /**
   * Query installment options
   */
  async installmentInfo(_request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    throw new BetterPaymentError(
      'Installment info is not supported by this provider',
      'NOT_SUPPORTED'
    );
  }
}
