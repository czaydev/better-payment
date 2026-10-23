import { PaymentStatus } from '../types/common';
import { errorMessage, isNetworkError } from './utils';
import { BetterPaymentError, ValidationError } from './errors';
import type { PaymentErrorCode } from './error-codes';

export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

/**
 * Common shape of provider results that can represent a failure
 */
export interface FailureResult {
  status: PaymentStatus;
  /** Normalized error code, set on every failure (and on NETWORK_ERROR) */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `i18n`) */
  providerMessage?: string;
  rawResponse?: unknown;
  /**
   * The HTTP status of the provider response, on results built from an HTTP error
   * that got an answer. Absent when no response arrived (transport errors) and
   * when the provider returned a failure body with a 2xx status.
   */
  httpStatus?: number;
  /** HTTP attempts made before this result, counting the first one (1 = no retry) */
  attempts?: number;
}

/**
 * The transport metadata of a thrown HTTP error: the status the provider answered
 * with, and how many attempts were made. Nothing sensitive: the request body and
 * headers are never part of it.
 */
function transportMeta(error: unknown): Partial<FailureResult> {
  const e = error as { response?: { status?: unknown }; attempts?: unknown } | undefined;
  const meta: Partial<FailureResult> = {};
  if (typeof e?.response?.status === 'number') meta.httpStatus = e.response.status;
  if (typeof e?.attempts === 'number') meta.attempts = e.attempts;
  return meta;
}

/**
 * Returns the HTTP response body attached to an HTTP client error, if any
 */
export function responseDataOf(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined;
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return undefined;
  return (response as { data?: unknown }).data;
}

/** " (ECONNRESET: socket hang up)" for transport errors, to make them diagnosable */
function networkCause(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : undefined;
  const message = typeof e.message === 'string' ? e.message : undefined;
  if (!code && !message) return '';
  return ` (${[code, message].filter(Boolean).join(': ')})`;
}

/**
 * Builds the result returned when a provider call throws.
 *
 * - Transport errors (timeout, connection reset, no response) become PENDING with
 *   NETWORK_ERROR: the provider may still have processed the request.
 * - A ValidationError (bad input caught before calling the provider) becomes
 *   FAILURE with VALIDATION_ERROR.
 * - Any other error becomes FAILURE. `errorCode`/`errorMessage` from a JSON error
 *   body are used when present, and the body is attached as `rawResponse`.
 */
export function failureResult<T extends FailureResult>(
  providerName: string,
  error: unknown,
  fallback: string,
  extra: Partial<T> = {}
): T {
  const meta = transportMeta(error);

  if (isNetworkError(error)) {
    return {
      status: PaymentStatus.PENDING,
      errorCode: NETWORK_ERROR_CODE,
      errorMessage: `No response from ${providerName}${networkCause(error)}. The transaction may have been processed; verify it with getPayment() before retrying.`,
      ...meta,
      ...extra,
    } as T;
  }

  if (error instanceof ValidationError) {
    return {
      status: PaymentStatus.FAILURE,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: error.message,
      ...extra,
    } as T;
  }

  if (error instanceof BetterPaymentError) {
    // e.g. NOT_SUPPORTED for a split basket sent to a provider without a marketplace API
    return {
      status: PaymentStatus.FAILURE,
      errorCode: error.code,
      errorMessage: error.message,
      ...extra,
    } as T;
  }

  const data = responseDataOf(error);
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
  const code = typeof body?.errorCode === 'string' ? body.errorCode : undefined;
  const message =
    typeof body?.errorMessage === 'string' && body.errorMessage.length > 0
      ? body.errorMessage
      : errorMessage(error, fallback);

  return {
    status: PaymentStatus.FAILURE,
    ...(code ? { errorCode: code } : {}),
    errorMessage: message,
    rawResponse: data,
    ...meta,
    ...extra,
  } as T;
}
