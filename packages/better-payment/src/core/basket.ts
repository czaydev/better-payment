import { ValidationError, type ValidationIssue } from './errors';
import { toMinorUnits } from './utils';
import type { BasketItem, BasketItemType } from '../types';

/** A product line given to `buildBasket` */
export interface BasketBuilderItem extends Omit<BasketItem, 'price'> {
  /** Unit price, e.g. `'49.90'` */
  price: string | number;
  /** Number of units (a positive integer). Defaults to 1. */
  quantity?: number;
}

/** A shipping fee, added to the basket as its own item */
export interface BasketShipping {
  price: string | number;
  /** Defaults to `'shipping'` */
  id?: string;
  /** Defaults to `'Shipping'` */
  name?: string;
  /** Defaults to `'Shipping'` */
  category1?: string;
  category2?: string;
  /** Defaults to `'VIRTUAL'` */
  itemType?: BasketItemType | string;
}

export interface BuildBasketOptions {
  items: BasketBuilderItem[];
  /**
   * Discount on the items (not on shipping): a fixed amount such as `'13.48'`, or
   * `{ percent: 10 }`. It is spread over the items in proportion to their totals.
   */
  discount?: string | number | { percent: number };
  /** Shipping fee, added as the last item. A zero fee adds no item. */
  shipping?: BasketShipping;
  /**
   * How `quantity` is sent: `'expand'` (default) adds one item per unit, with ids
   * `A-1`, `A-2`, ...; `'multiply'` adds one item priced at unit price × quantity.
   */
  quantity?: 'expand' | 'multiply';
}

export interface BuiltBasket {
  /** Items with the discount applied; their prices add up exactly to `price` */
  basketItems: BasketItem[];
  /** Basket total after discount, shipping included. Use it as `price` (and `paidPrice`). */
  price: string;
  /** The discount actually applied, e.g. `'4.99'` for `{ percent: 10 }` of `'49.90'` */
  discount: string;
}

const fromMinor = (minor: number): string => (minor / 100).toFixed(2);

/**
 * Builds a basket whose item prices add up to the payment total to the kuruş, which
 * iyzico requires. Spreads the discount over the items in proportion to their totals,
 * giving rounding leftovers to the items with the largest remainders (ties go to the
 * larger item, then the earlier one), and adds shipping as an item. All arithmetic is
 * done in minor units.
 *
 * Throws `ValidationError` for non-positive prices, an invalid quantity or percent, a
 * discount that is not smaller than the item total, or a discount that would bring
 * an item down to zero.
 *
 * @example
 * const { basketItems, price } = buildBasket({
 *   items: [{ id: 'A', name: 'T-shirt', category1: 'Clothing', itemType: 'PHYSICAL', price: '49.90', quantity: 2 }],
 *   discount: { percent: 10 },
 *   shipping: { price: '29.90' },
 * });
 */
export function buildBasket(options: BuildBasketOptions): BuiltBasket {
  const { items, discount, shipping, quantity: quantityMode = 'expand' } = options;
  const issues: ValidationIssue[] = [];
  const fail = (path: string, message: string): never => {
    issues.push({ path, message });
    throw new ValidationError(message, undefined, issues);
  };

  if (!Array.isArray(items) || items.length === 0) {
    fail('items', 'The basket needs at least one item');
  }

  const lines: BasketItem[] = [];
  const minors: number[] = [];
  items.forEach((item, index) => {
    const path = `items[${index}]`;
    const unit = minorOrFail(item.price, `${path}.price`, fail);
    if (unit <= 0) fail(`${path}.price`, `${path}.price must be greater than zero`);
    const qty = item.quantity ?? 1;
    if (!Number.isInteger(qty) || qty < 1) {
      fail(`${path}.quantity`, `${path}.quantity must be a positive integer`);
    }
    const rest: Omit<BasketItem, 'price'> = {
      id: item.id,
      name: item.name,
      category1: item.category1,
      ...(item.category2 !== undefined ? { category2: item.category2 } : {}),
      itemType: item.itemType,
    };
    if (quantityMode === 'multiply' || qty === 1) {
      lines.push({ ...rest, price: '' });
      minors.push(unit * qty);
    } else {
      for (let n = 1; n <= qty; n++) {
        lines.push({ ...rest, id: `${item.id}-${n}`, price: '' });
        minors.push(unit);
      }
    }
  });

  const subtotal = minors.reduce((sum, value) => sum + value, 0);
  const discountMinor = resolveDiscount(discount, subtotal, fail);
  if (discountMinor >= subtotal) {
    fail('discount', 'The discount must be smaller than the item total');
  }

  const shares = distribute(discountMinor, minors, subtotal);
  minors.forEach((value, i) => {
    const discounted = value - shares[i];
    if (discounted <= 0) {
      fail('discount', `The discount brings item "${lines[i].id}" down to zero`);
    }
    minors[i] = discounted;
    lines[i].price = fromMinor(discounted);
  });

  if (shipping) {
    const fee = minorOrFail(shipping.price, 'shipping.price', fail);
    if (fee > 0) {
      lines.push({
        id: shipping.id ?? 'shipping',
        name: shipping.name ?? 'Shipping',
        category1: shipping.category1 ?? 'Shipping',
        ...(shipping.category2 !== undefined ? { category2: shipping.category2 } : {}),
        itemType: shipping.itemType ?? 'VIRTUAL',
        price: fromMinor(fee),
      });
      minors.push(fee);
    }
  }

  return {
    basketItems: lines,
    price: fromMinor(minors.reduce((sum, value) => sum + value, 0)),
    discount: fromMinor(discountMinor),
  };
}

function minorOrFail(
  value: string | number,
  path: string,
  fail: (path: string, message: string) => never
): number {
  try {
    return toMinorUnits(value, path);
  } catch {
    return fail(path, `Invalid ${path}: ${value}`);
  }
}

function resolveDiscount(
  discount: BuildBasketOptions['discount'],
  subtotal: number,
  fail: (path: string, message: string) => never
): number {
  if (discount === undefined) return 0;
  if (typeof discount === 'object' && discount !== null) {
    const { percent } = discount;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      fail('discount.percent', 'discount.percent must be between 0 and 100');
    }
    // Percent in millionths of a percent, so the rounding below stays in integers
    const scaled = BigInt(Math.round(percent * 1_000_000));
    const hundredMillion = BigInt(100_000_000);
    // Round half up
    return Number(
      (BigInt(subtotal) * scaled * BigInt(2) + hundredMillion) / (hundredMillion * BigInt(2))
    );
  }
  return minorOrFail(discount, 'discount', fail);
}

/**
 * Splits `amount` over `weights` in proportion, in whole minor units, with the
 * largest remainder method. The result always adds up to `amount`.
 */
function distribute(amount: number, weights: number[], total: number): number[] {
  if (amount === 0) return weights.map(() => 0);
  const bigAmount = BigInt(amount);
  const bigTotal = BigInt(total);
  const remainders: Array<{ index: number; remainder: bigint }> = [];
  let allocated = 0;
  const shares = weights.map((weight, index) => {
    const product = bigAmount * BigInt(weight);
    const share = Number(product / bigTotal);
    remainders.push({ index, remainder: product % bigTotal });
    allocated += share;
    return share;
  });
  remainders.sort(
    (a, b) =>
      (a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1) ||
      weights[b.index] - weights[a.index] ||
      a.index - b.index
  );
  for (let i = 0; i < amount - allocated; i++) shares[remainders[i].index] += 1;
  return shares;
}
