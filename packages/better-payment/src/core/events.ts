import { PaymentStatus } from '../types';
import type { PaymentErrorCode } from './error-codes';
import type { PaymentOperation } from './plugin';
import { BetterPaymentError } from './errors';

type Awaitable<T> = T | Promise<T>;

/**
 * Payment events, emitted after an operation returns a result (and after the
 * provider verified it: forged callbacks emit nothing):
 *
 * | Event               | Operations                                                              |
 * | ------------------- | ----------------------------------------------------------------------- |
 * | `payment.succeeded` | createPayment, completeThreeDSPayment, capture: `success`               |
 * | `payment.authorized`| authorize: `success` (the amount is blocked)                            |
 * | `payment.pending`   | createPayment, completeThreeDSPayment, authorize, capture: `pending`    |
 * | `payment.failed`    | the payment operations and the 3D Secure inits: `failure`               |
 * | `payment.cancelled` | cancel, voidAuthorization: `success`                                    |
 * | `refund.succeeded`  | refund: `success`                                                       |
 * | `refund.failed`     | refund: `failure`                                                       |
 * | `payout.approved`   | approvePayout: `success` (the seller's share is released)               |
 * | `payout.disapproved`| disapprovePayout: `success`                                             |
 * | `payout.failed`     | approvePayout, disapprovePayout: `failure`                              |
 */
export type PaymentEventType =
  | 'payment.succeeded'
  | 'payment.authorized'
  | 'payment.pending'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'payment.expired'
  | 'payment.unresolved'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'payout.approved'
  | 'payout.disapproved'
  | 'payout.failed';

export const PAYMENT_EVENT_TYPES: readonly PaymentEventType[] = [
  'payment.succeeded',
  'payment.authorized',
  'payment.pending',
  'payment.failed',
  'payment.cancelled',
  'payment.expired',
  'payment.unresolved',
  'refund.succeeded',
  'refund.failed',
  'payout.approved',
  'payout.disapproved',
  'payout.failed',
];

export interface PaymentEvent<T extends PaymentEventType = PaymentEventType> {
  type: T;
  /** Id of the provider that handled the operation */
  provider: string;
  operation: PaymentOperation;
  /** The provider's payment id, when known */
  paymentId?: string;
  /** Your order / conversation id, when known */
  conversationId?: string;
  /** Amount charged or refunded, from the request, when known */
  amount?: string;
  currency?: string;
  /** Normalized error code of failed results */
  code?: PaymentErrorCode;
  /** The operation's result as returned to the caller */
  result: unknown;
  /** The operation's request (callback data for 3D Secure completions) */
  request: unknown;
  /** Present when a pending payment was resolved by pendingResolver */
  resolvedFrom?: 'pending';
}

/** Listeners by event type; `*` receives every event */
export type PaymentEventListeners = {
  [T in PaymentEventType]?: (event: PaymentEvent<T>) => Awaitable<void>;
} & {
  '*'?: (event: PaymentEvent) => Awaitable<void>;
};

export type PaymentEventName = PaymentEventType | '*';

export type PaymentEventListener<T extends PaymentEventName> = (
  event: T extends PaymentEventType ? PaymentEvent<T> : PaymentEvent
) => Awaitable<void>;

/**
 * Thrown when an event listener fails. The operation itself completed:
 * `result` is its result, so the payment is not lost.
 */
export class EventListenerError extends BetterPaymentError {
  constructor(
    public readonly event: PaymentEvent,
    public readonly result: unknown,
    public readonly cause: unknown
  ) {
    super(
      `A '${event.type}' event listener failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      'EVENT_LISTENER_FAILED',
      event.provider
    );
    this.name = 'EventListenerError';
  }
}

const PAYMENT_OPERATIONS = new Set<PaymentOperation>([
  'createPayment',
  'completeThreeDSPayment',
  'authorize',
  'capture',
]);

function field(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : undefined;
}

/** The event an operation result triggers, if any */
export function eventFor(
  operation: PaymentOperation,
  provider: string,
  request: unknown,
  result: unknown
): PaymentEvent | undefined {
  const status = field(result, 'status');
  // A forged callback is not a payment outcome
  if (field(result, 'errorCode') === 'INVALID_HASH') return undefined;

  let type: PaymentEventType | undefined;
  if (PAYMENT_OPERATIONS.has(operation)) {
    if (status === PaymentStatus.SUCCESS) {
      type = operation === 'authorize' ? 'payment.authorized' : 'payment.succeeded';
    } else if (status === PaymentStatus.PENDING) type = 'payment.pending';
    else if (status === PaymentStatus.FAILURE) type = 'payment.failed';
  } else if (operation === 'initThreeDSPayment' || operation === 'initThreeDSAuthorize') {
    if (status === PaymentStatus.FAILURE) type = 'payment.failed';
  } else if (operation === 'cancel' || operation === 'voidAuthorization') {
    if (status === PaymentStatus.SUCCESS) type = 'payment.cancelled';
  } else if (operation === 'refund') {
    if (status === PaymentStatus.SUCCESS) type = 'refund.succeeded';
    else if (status === PaymentStatus.FAILURE) type = 'refund.failed';
  } else if (operation === 'approvePayout' || operation === 'disapprovePayout') {
    if (status === PaymentStatus.SUCCESS) {
      type = operation === 'approvePayout' ? 'payout.approved' : 'payout.disapproved';
    } else if (status === PaymentStatus.FAILURE) type = 'payout.failed';
  }
  if (!type) return undefined;

  const code = field(result, 'code') as PaymentErrorCode | undefined;
  return {
    type,
    provider,
    operation,
    paymentId: field(result, 'paymentId') ?? field(request, 'paymentId'),
    conversationId: field(result, 'conversationId') ?? field(request, 'conversationId'),
    amount:
      operation === 'capture'
        ? field(request, 'amount')
        : (field(request, 'paidPrice') ?? field(request, 'price')),
    currency: field(request, 'currency'),
    ...(code ? { code } : {}),
    result,
    request,
  };
}
