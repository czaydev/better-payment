import { PaymentStatus } from '../types/common';
import { errorMessage, isNetworkError } from './utils';
import { ValidationError } from './errors';
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
  if (isNetworkError(error)) {
    return {
      status: PaymentStatus.PENDING,
      errorCode: NETWORK_ERROR_CODE,
      errorMessage: `No response from ${providerName}${networkCause(error)}. The transaction may have been processed; verify it with getPayment() before retrying.`,
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
    ...extra,
  } as T;
}
