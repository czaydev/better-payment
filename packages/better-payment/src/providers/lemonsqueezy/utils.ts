import { hmac, toHex, safeEqual } from '../../core/crypto';
import { PaymentStatus } from '../../types';

/** Every Lemon Squeezy request and answer is JSON:API */
export const LEMONSQUEEZY_MEDIA_TYPE = 'application/vnd.api+json';

/**
 * Verifies a webhook: `X-Signature` is the hex HMAC-SHA256 of the raw body with
 * the webhook's signing secret.
 */
export async function verifyLemonSqueezySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false;
  const expected = toHex(await hmac('SHA-256', secret, rawBody));
  return safeEqual(expected, signature.trim().toLowerCase());
}

/**
 * An order's status as a payment status: paid (also after a partial refund) is
 * success, refunded is cancelled, failed or fraudulent is failure, pending is
 * pending.
 */
export function mapLemonSqueezyOrderStatus(status: string | undefined): PaymentStatus {
  switch (status) {
    case 'paid':
    case 'partial_refund':
      return PaymentStatus.SUCCESS;
    case 'refunded':
      return PaymentStatus.CANCELLED;
    case 'failed':
    case 'fraudulent':
      return PaymentStatus.FAILURE;
    default:
      return PaymentStatus.PENDING;
  }
}
