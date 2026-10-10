import { ValidationError, type ValidationIssue } from './errors';
import type { PaymentCard, PaymentRequest } from '../types';

/**
 * Request validation that runs before a provider is called, so obviously
 * invalid input fails fast with a ValidationError that names the field.
 *
 * The rules are deliberately conservative: they reject what every provider
 * rejects, and nothing that some provider accepts.
 */

export interface PaymentValidationRules {
  /** Validate `paymentCard` (the provider receives card data) */
  card?: boolean;
  /** The provider accepts `storedCard` instead of `paymentCard` */
  storedCard?: boolean;
  /** The provider can save the card during the payment (`saveCard`) */
  saveCard?: boolean;
  /** Basket item prices must add up to `price` (iyzico) */
  basketMatchesPrice?: boolean;
  /** At least one basket item */
  basketRequired?: boolean;
  /** Dotted paths that must be present and non-empty, e.g. `buyer.email` */
  required?: string[];
}

const DECIMAL = /^\d+(\.\d{1,2})?$/;
// Domain labels exclude '.', so the pattern matches in linear time
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+(%\w+)?$/;

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function valueAt(source: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      source
    );
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

/** Amount in minor units, or undefined when the value is not a valid 2-decimal amount */
function toCents(value: unknown): number | undefined {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !DECIMAL.test(text.trim())) return undefined;
  const [whole, fraction = ''] = text.trim().split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export class RequestValidator {
  readonly issues: ValidationIssue[] = [];

  add(path: string, message: string): this {
    this.issues.push({ path, message });
    return this;
  }

  amount(value: unknown, path: string, { required = true } = {}): number | undefined {
    if (isBlank(value)) {
      if (required) this.add(path, 'is required');
      return undefined;
    }
    const cents = toCents(value);
    if (cents === undefined) {
      this.add(path, 'must be a decimal amount with at most 2 decimals, e.g. "10.50"');
    } else if (cents <= 0) {
      this.add(path, 'must be greater than 0');
    }
    return cents;
  }

  card(card: PaymentCard | undefined, path = 'paymentCard', now = new Date()): this {
    if (!card) return this.add(path, 'is required');

    const number = String(card.cardNumber ?? '').replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(number)) {
      this.add(`${path}.cardNumber`, 'must be 12-19 digits');
    } else if (!luhn(number)) {
      this.add(`${path}.cardNumber`, 'is not a valid card number (Luhn check failed)');
    }

    if (isBlank(card.cardHolderName)) this.add(`${path}.cardHolderName`, 'is required');

    const month = Number(card.expireMonth);
    const rawYear = String(card.expireYear ?? '').trim();
    const year = /^\d{2}$/.test(rawYear) ? 2000 + Number(rawYear) : Number(rawYear);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      this.add(`${path}.expireMonth`, 'must be 1-12');
    } else if (!/^\d{2}(\d{2})?$/.test(rawYear)) {
      this.add(`${path}.expireYear`, 'must be YY or YYYY');
    } else {
      // A card is valid through the last day of its expiry month
      const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
      if (year * 12 + (month - 1) < current) this.add(`${path}.expireYear`, 'card is expired');
    }

    if (!/^\d{3,4}$/.test(String(card.cvc ?? ''))) this.add(`${path}.cvc`, 'must be 3 or 4 digits');
    return this;
  }

  required(source: unknown, paths: string[]): this {
    for (const path of paths) {
      if (isBlank(valueAt(source, path))) this.add(path, 'is required');
    }
    return this;
  }

  buyerFormats(request: PaymentRequest): this {
    const buyer = request.buyer;
    if (!buyer) return this;
    if (!isBlank(buyer.email) && !EMAIL.test(String(buyer.email))) {
      this.add('buyer.email', 'is not a valid email address');
    }
    if (!isBlank(buyer.ip) && !IPV4.test(String(buyer.ip)) && !IPV6.test(String(buyer.ip))) {
      this.add('buyer.ip', 'is not a valid IPv4 or IPv6 address');
    }
    if (!isBlank(buyer.gsmNumber)) {
      const digits = String(buyer.gsmNumber).replace(/[\s()+-]/g, '');
      if (!/^\d{10,15}$/.test(digits)) this.add('buyer.gsmNumber', 'must have 10-15 digits');
    }
    return this;
  }

  /** Throws a ValidationError listing every issue, if there are any */
  assert(provider?: string): void {
    if (this.issues.length === 0) return;
    const list = this.issues.map((i) => `${i.path} ${i.message}`).join('; ');
    throw new ValidationError(`Invalid request: ${list}`, provider, this.issues);
  }
}

/**
 * Validates a payment request: amounts, basket, buyer formats, and optionally
 * the card and provider-specific required fields.
 */
export function validatePaymentRequest(
  request: PaymentRequest,
  rules: PaymentValidationRules = {},
  provider?: string
): void {
  const v = new RequestValidator();
  if (!request || typeof request !== 'object') {
    v.add('request', 'is required').assert(provider);
    return;
  }

  const price = v.amount(request.price, 'price');
  v.amount(request.paidPrice, 'paidPrice', { required: false });

  const items = Array.isArray(request.basketItems) ? request.basketItems : [];
  if (rules.basketRequired && items.length === 0) v.add('basketItems', 'must not be empty');

  let basketTotal = 0;
  let basketValid = true;
  // Item prices are only checked where the provider requires them to add up
  (rules.basketMatchesPrice ? items : []).forEach((item, i) => {
    const cents = v.amount(item?.price, `basketItems[${i}].price`);
    if (cents === undefined || cents <= 0) basketValid = false;
    else basketTotal += cents;
  });
  if (
    rules.basketMatchesPrice &&
    items.length > 0 &&
    basketValid &&
    price !== undefined &&
    price > 0 &&
    basketTotal !== price
  ) {
    v.add(
      'basketItems',
      `prices add up to ${(basketTotal / 100).toFixed(2)} but price is ${(price / 100).toFixed(2)}`
    );
  }

  if (request.storedCard !== undefined) {
    if (!rules.storedCard) {
      v.add('storedCard', 'is not supported by this provider');
    } else {
      if (isBlank(request.storedCard?.customerToken))
        v.add('storedCard.customerToken', 'is required');
      if (isBlank(request.storedCard?.cardToken)) v.add('storedCard.cardToken', 'is required');
    }
  } else if (rules.card) {
    v.card(request.paymentCard);
  }
  if (request.saveCard && !rules.saveCard) {
    v.add('saveCard', 'is not supported by this provider for this payment type');
  }
  if (rules.required) v.required(request, rules.required);
  v.buyerFormats(request);

  v.assert(provider);
}

/** Validates the amount of a refund */
export function validateRefundAmount(price: unknown, provider?: string): void {
  const v = new RequestValidator();
  v.amount(price, 'price');
  v.assert(provider);
}

/** Validates a capture: a payment id and a positive amount */
export function validateCaptureRequest(
  request: { paymentId?: unknown; amount?: unknown },
  provider?: string
): void {
  const v = new RequestValidator();
  if (!request || typeof request !== 'object') {
    v.add('request', 'is required').assert(provider);
    return;
  }
  if (typeof request.paymentId !== 'string' || request.paymentId.trim() === '') {
    v.add('paymentId', 'is required');
  }
  v.amount(request.amount, 'amount');
  v.assert(provider);
}
