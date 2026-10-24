import type { RecurringPaymentRequest } from '../types';
import { ValidationError } from './errors';

/**
 * Checks the parts of a merchant-initiated charge that the type system cannot:
 * JavaScript callers, and requests that reached the library through the HTTP
 * handler. A recurring charge targets a stored card (never card data) and
 * carries the order id of its billing period, so a retry cannot become a second
 * charge.
 */
export function validateRecurringRequest(request: RecurringPaymentRequest): void {
  const issues: Array<{ path: string; message: string }> = [];
  if (!request || typeof request !== 'object') {
    throw new ValidationError('request is required', undefined, [
      { path: 'request', message: 'is required' },
    ]);
  }
  if (request.recurring !== true) {
    issues.push({ path: 'recurring', message: 'must be true for a merchant-initiated charge' });
  }
  if (!request.storedCard || typeof request.storedCard !== 'object') {
    issues.push({ path: 'storedCard', message: 'is required' });
  } else {
    if (!request.storedCard.customerToken) {
      issues.push({ path: 'storedCard.customerToken', message: 'is required' });
    }
    if (!request.storedCard.cardToken) {
      issues.push({ path: 'storedCard.cardToken', message: 'is required' });
    }
  }
  if (typeof request.conversationId !== 'string' || request.conversationId.trim() === '') {
    issues.push({ path: 'conversationId', message: 'is required for a recurring charge' });
  }
  if ((request as { paymentCard?: unknown }).paymentCard) {
    // Only the tokens may leave the application; a PAN must never be part of a
    // charge that the library reports as card-on-file.
    issues.push({ path: 'paymentCard', message: 'must not be sent with a stored card' });
  }
  if (issues.length > 0) {
    const list = issues.map((issue) => `${issue.path} ${issue.message}`).join('; ');
    throw new ValidationError(`Invalid recurring payment request: ${list}`, undefined, issues);
  }
}

/**
 * Adds whole billing months to a date, clamping to the end of shorter months:
 * 2026-01-31 + 1 month = 2026-02-28, 2024-01-31 + 1 month = 2024-02-29 (leap),
 * 2026-05-31 + 1 month = 2026-06-30. So a subscription anchored on the 31st
 * still bills every month. The input is not mutated.
 *
 * Returns a UTC-midnight Date so billing periods do not drift with DST or the
 * host timezone. Amounts are untouched here: prices stay decimal strings
 * (`price`/`paidPrice` on the request); never do float money maths.
 */
export function addBillingMonths(date: Date, months: number): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new ValidationError('date must be a valid Date');
  }
  if (!Number.isInteger(months) || months < 0) {
    throw new ValidationError(`Invalid billing months: ${months}`);
  }
  const anchor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const shifted = new Date(anchor);
  const day = shifted.getUTCDate();
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  // Day 0 of the NEXT month is the last day of the target month
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted;
}

/**
 * A stable order id for one billing period, e.g. `sub42202602` for `sub42` and
 * February 2026. Reuse it when retrying the SAME period and change it only when
 * you move to the next one: a repeated id lets the provider (PayTR:
 * `merchant_oid`) and the HTTP handler's `Idempotency-Key` recognize a retry
 * instead of charging twice.
 *
 * `base` and the result are alphanumeric: PayTR rejects every other character
 * in `merchant_oid`, so the id stays usable with every provider.
 */
export function billingOrderId(base: string, periodStart: Date): string {
  if (!base || !/^[A-Za-z0-9]+$/.test(base)) {
    throw new ValidationError(`billingOrderId base must be alphanumeric: ${base}`);
  }
  if (!(periodStart instanceof Date) || Number.isNaN(periodStart.getTime())) {
    throw new ValidationError('periodStart must be a valid Date');
  }
  const year = periodStart.getUTCFullYear();
  const month = String(periodStart.getUTCMonth() + 1).padStart(2, '0');
  return `${base}${year}${month}`;
}
