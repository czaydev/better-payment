import { digest, toBase64 } from '../../core/crypto';
import { ValidationError } from '../../core/errors';
import { toMinorUnits } from '../../core/utils';

export const ALBARAKA_ENDPOINTS = {
  /** JSON API operations: `${API}/Sale`, `/Reverse`, `/Return` */
  API: '/ALBMerchantService/MerchantJSONAPI.svc',
  /** 3D Secure form target (customer's browser) */
  GATE: '/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx',
} as const;

/**
 * MAC of a request: base64(SHA256(values joined without a separator + encKey)).
 * `MACParams` names the values, e.g. MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate:Amount.
 */
export async function createAlbarakaMac(values: string[], encKey: string): Promise<string> {
  return toBase64(await digest('SHA-256', values.join('') + encKey));
}

/** Amount in kuruş as an integer ("1.20" is 120) */
export function formatAlbarakaAmount(amount: string | number): number {
  return toMinorUnits(amount);
}

/** Posnet currency codes */
export function getAlbarakaCurrencyCode(currency: string | undefined): string {
  const map: Record<string, string> = { TRY: 'TL', TL: 'TL', USD: 'US', EUR: 'EU', GBP: 'GB' };
  const code = map[(currency || 'TRY').toUpperCase()];
  if (!code) {
    throw new ValidationError(`Currency ${currency} is not supported by Albaraka`);
  }
  return code;
}

/** InstallmentCount (0 for a single payment) and InstallmentType */
export function formatAlbarakaInstallment(installment: number | string | undefined): {
  InstallmentCount: number;
  InstallmentType: 'Y' | 'N';
} {
  const count = Number(installment ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 99) {
    throw new ValidationError(`Invalid installment count: ${installment}`);
  }
  return count > 1
    ? { InstallmentCount: count, InstallmentType: 'Y' }
    : { InstallmentCount: 0, InstallmentType: 'N' };
}

/** Card expiry as YYMM */
export function formatAlbarakaExpiry(month: string, year: string): string {
  const mm = month.padStart(2, '0');
  const yy = year.length === 4 ? year.slice(-2) : year.padStart(2, '0');
  if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12 || !/^\d{2}$/.test(yy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return `${yy}${mm}`;
}

/** The order id the bank expects: up to 20 letters or digits, padded with zeros to 20 */
export function formatAlbarakaOrderId(orderId: string): string {
  if (!/^[A-Za-z0-9]{1,20}$/.test(orderId)) {
    throw new ValidationError(
      `Albaraka order ids must be 1 to 20 letters or digits, got: ${orderId}`
    );
  }
  return orderId.padStart(20, '0');
}

/** ResponseCode 00 */
export function isAlbarakaApproved(response: {
  ServiceResponseData?: { ResponseCode?: string };
}): boolean {
  return response?.ServiceResponseData?.ResponseCode === '00';
}
