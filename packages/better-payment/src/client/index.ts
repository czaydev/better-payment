import {
  PaymentRequest,
  PaymentResponse,
  ThreeDSPaymentRequest,
  ThreeDSInitResponse,
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
  BinCheckResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
} from '../types';
import { ProviderType } from '../core/BetterPaymentConfig';

/**
 * Client configuration
 */
export interface BetterPaymentClientConfig {
  /**
   * Base URL for API endpoints
   * @example '/api/pay'
   * @example 'https://api.example.com/pay'
   */
  baseUrl: string;

  /**
   * Custom fetch implementation (opsiyonel)
   * @default globalThis.fetch
   */
  fetch?: typeof fetch;

  /**
   * Default headers for all requests
   */
  headers?: Record<string, string>;
}

/**
 * Provider client for making payment requests
 */
class ProviderClient {
  constructor(
    private provider: string,
    private config: BetterPaymentClientConfig
  ) {}

  /**
   * Get fetch implementation
   */
  private get fetch(): typeof fetch {
    return this.config.fetch || globalThis.fetch;
  }

  /**
   * Build full URL for endpoint
   */
  private buildUrl(path: string): string {
    const baseUrl = this.config.baseUrl.replace(/\/$/, '');
    const cleanPath = path.replace(/^\//, '');
    return `${baseUrl}/${this.provider}/${cleanPath}`;
  }

  /**
   * Make HTTP request
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);

    const headers: Record<string, string> = { ...this.config.headers };
    const options: RequestInit = { method, headers };

    if (body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const response = await this.fetch(url, options);
    const data: unknown = await response.json().catch(() => undefined);
    const result = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;

    // 422 = the provider rejected the operation; the body is the unified result
    if (response.ok || (response.status === 422 && result && 'status' in result)) {
      return data as T;
    }

    const message =
      typeof result?.message === 'string' && result.message ? result.message : undefined;
    throw new Error(message || `HTTP ${response.status}: ${response.statusText}`);
  }

  /**
   * Create payment
   *
   * @example
   * ```typescript
   * const result = await client.iyzico.createPayment({
   *   price: '1.00',
   *   paidPrice: '1.00',
   *   currency: 'TRY',
   *   // ... other fields
   * });
   * ```
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    return this.request<PaymentResponse>('POST', 'payment', request);
  }

  /**
   * Initialize 3D Secure payment
   *
   * @example
   * ```typescript
   * const result = await client.iyzico.initThreeDSPayment({
   *   price: '1.00',
   *   paidPrice: '1.00',
   *   currency: 'TRY',
   *   callbackUrl: 'https://example.com/callback',
   *   // ... other fields
   * });
   *
   * // Render 3DS HTML content
   * document.getElementById('threeds-container').innerHTML = result.threeDSHtmlContent;
   * ```
   */
  async initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.request<ThreeDSInitResponse>('POST', 'payment/init-3ds', request);
  }

  /**
   * Complete 3D Secure payment (callback handler)
   *
   * @example
   * ```typescript
   * // In your callback page:
   * const callbackData = { ... }; // Data from provider
   * const result = await client.iyzico.completeThreeDSPayment(callbackData);
   * ```
   */
  async completeThreeDSPayment(callbackData: Record<string, unknown>): Promise<PaymentResponse> {
    return this.request<PaymentResponse>('POST', 'payment/complete-3ds', callbackData);
  }

  /**
   * Pre-authorization: blocks the amount on the card (`POST /:provider/authorize`)
   */
  async authorize(request: PaymentRequest): Promise<PaymentResponse> {
    return this.request<PaymentResponse>('POST', 'authorize', request);
  }

  /**
   * 3D Secure pre-authorization (`POST /:provider/authorize/init-3ds`).
   * Render `threeDSHtmlContent`; the callback completes it like a 3D payment.
   */
  async initThreeDSAuthorize(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse> {
    return this.request<ThreeDSInitResponse>('POST', 'authorize/init-3ds', request);
  }

  /**
   * Captures a pre-authorization (`POST /:provider/capture`, needs `authorize` on the server)
   */
  async capture(request: CaptureRequest): Promise<PaymentResponse> {
    return this.request<PaymentResponse>('POST', 'capture', request);
  }

  /**
   * Releases a pre-authorization (`POST /:provider/void`, needs `authorize` on the server)
   */
  async voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse> {
    return this.request<CancelResponse>('POST', 'void', request);
  }

  /** Saves a card (`POST /:provider/cards/save`, needs `authorize` on the server) */
  async saveCard(request: SaveCardRequest): Promise<SaveCardResponse> {
    return this.request<SaveCardResponse>('POST', 'cards/save', request);
  }

  /** Lists a customer's saved cards (`POST /:provider/cards/list`, needs `authorize`) */
  async listCards(request: { customerToken: string }): Promise<ListCardsResponse> {
    return this.request<ListCardsResponse>('POST', 'cards/list', request);
  }

  /** Deletes a saved card (`POST /:provider/cards/delete`, needs `authorize`) */
  async deleteCard(request: DeleteCardRequest): Promise<DeleteCardResponse> {
    return this.request<DeleteCardResponse>('POST', 'cards/delete', request);
  }

  /**
   * Refund payment
   *
   * @example
   * ```typescript
   * const result = await client.iyzico.refund({
   *   paymentId: '123456',
   *   price: '0.50',
   *   currency: 'TRY',
   * });
   * ```
   */
  async refund(request: RefundRequest): Promise<RefundResponse> {
    return this.request<RefundResponse>('POST', 'refund', request);
  }

  /**
   * Cancel payment
   *
   * @example
   * ```typescript
   * const result = await client.iyzico.cancel({
   *   paymentId: '123456',
   * });
   * ```
   */
  async cancel(request: CancelRequest): Promise<CancelResponse> {
    return this.request<CancelResponse>('POST', 'cancel', request);
  }

  /**
   * Get payment details
   *
   * @example
   * ```typescript
   * const payment = await client.iyzico.getPayment('payment-id-123');
   * ```
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    return this.request<PaymentResponse>('GET', `payment/${encodeURIComponent(paymentId)}`);
  }

  async binCheck(binNumber: string): Promise<BinCheckResponse> {
    return this.request<BinCheckResponse>('POST', 'bin-check', { binNumber });
  }

  async installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse> {
    return this.request<InstallmentInfoResponse>('POST', 'installment', request);
  }
}

/**
 * BetterPay client for frontend applications
 *
 * Better-auth tarzı client library. Frontend'den otomatik olarak API endpoint'lerini
 * çağırmak için kullanılır.
 *
 * @example
 * ```typescript
 * import { createBetterPaymentClient } from 'better-payment/client';
 *
 * const client = createBetterPaymentClient({
 *   baseUrl: '/api/pay',
 * });
 *
 * // İyzico ile ödeme oluştur
 * const result = await client.iyzico.createPayment({
 *   price: '100.00',
 *   paidPrice: '100.00',
 *   currency: 'TRY',
 *   basketId: 'B67832',
 *   paymentCard: {
 *     cardHolderName: 'John Doe',
 *     cardNumber: '5528790000000008',
 *     expireMonth: '12',
 *     expireYear: '2030',
 *     cvc: '123',
 *   },
 *   buyer: {
 *     id: 'BY789',
 *     name: 'John',
 *     surname: 'Doe',
 *     gsmNumber: '+905350000000',
 *     email: 'email@email.com',
 *     identityNumber: '74300864791',
 *     registrationAddress: 'Nidakule Göztepe, Merdivenköy Mah.',
 *     ip: '85.34.78.112',
 *     city: 'Istanbul',
 *     country: 'Turkey',
 *   },
 *   shippingAddress: {
 *     contactName: 'Jane Doe',
 *     city: 'Istanbul',
 *     country: 'Turkey',
 *     address: 'Nidakule Göztepe, Merdivenköy Mah.',
 *   },
 *   billingAddress: {
 *     contactName: 'Jane Doe',
 *     city: 'Istanbul',
 *     country: 'Turkey',
 *     address: 'Nidakule Göztepe, Merdivenköy Mah.',
 *   },
 *   basketItems: [
 *     {
 *       id: 'BI101',
 *       name: 'Product 1',
 *       category1: 'Electronics',
 *       itemType: 'PHYSICAL',
 *       price: '100.00',
 *     },
 *   ],
 * });
 *
 * // PayTR ile 3DS ödeme başlat
 * const threeds = await client.paytr.initThreeDSPayment({
 *   price: '100.00',
 *   paidPrice: '100.00',
 *   currency: 'TRY',
 *   callbackUrl: 'https://example.com/callback',
 *   // ... other fields
 * });
 *
 * // 3DS HTML'i render et
 * document.getElementById('payment-iframe').innerHTML = threeds.threeDSHtmlContent;
 * ```
 */
export { PaymentErrorCode } from '../core/error-codes';
export { PaymentStatus } from '../types/common';

export class BetterPaymentClient {
  readonly iyzico: ProviderClient;
  readonly paytr: ProviderClient;
  readonly akbank: ProviderClient;
  readonly parampos: ProviderClient;
  readonly kuveytturk: ProviderClient;
  /** The in-memory test provider (`MockProvider` from `better-payment/testing`) */
  readonly mock: ProviderClient;

  constructor(private config: BetterPaymentClientConfig) {
    this.iyzico = new ProviderClient(ProviderType.IYZICO, config);
    this.paytr = new ProviderClient(ProviderType.PAYTR, config);
    this.akbank = new ProviderClient(ProviderType.AKBANK, config);
    this.parampos = new ProviderClient(ProviderType.PARAMPOS, config);
    this.kuveytturk = new ProviderClient(ProviderType.KUVEYTTURK, config);
    this.mock = new ProviderClient(ProviderType.MOCK, config);
  }

  /**
   * A provider by its id on the server (the key in `providers`), for custom
   * providers or ids other than the built-in ones.
   */
  use(providerId: string): ProviderClient {
    return new ProviderClient(providerId, this.config);
  }

  /**
   * Health check endpoint
   *
   * @example
   * ```typescript
   * const health = await client.health();
   * console.log(health.status); // 'ok'
   * ```
   */
  async health(): Promise<{
    status: string;
    service: string;
    version: string;
    timestamp: string;
  }> {
    const fetch = this.config.fetch || globalThis.fetch;
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/health`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { ...this.config.headers },
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }

    return response.json() as Promise<{
      status: string;
      service: string;
      version: string;
      timestamp: string;
    }>;
  }
}

/**
 * Create a BetterPay client instance
 *
 * @param config - Client configuration
 * @returns BetterPayClient instance
 *
 * @example
 * ```typescript
 * const client = createBetterPaymentClient({
 *   baseUrl: '/api/pay',
 * });
 * ```
 */
export function createBetterPaymentClient(config: BetterPaymentClientConfig): BetterPaymentClient {
  return new BetterPaymentClient(config);
}
