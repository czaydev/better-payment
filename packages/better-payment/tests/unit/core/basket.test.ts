import { describe, it, expect } from 'vitest';
import { buildBasket, ValidationError } from '../../../src';
import type { BasketBuilderItem } from '../../../src';

const item = (id: string, price: string, quantity?: number): BasketBuilderItem => ({
  id,
  name: `Item ${id}`,
  category1: 'Category',
  itemType: 'PHYSICAL',
  price,
  ...(quantity !== undefined ? { quantity } : {}),
});

const toMinor = (price: string) => Math.round(Number(price) * 100);
const sumMinor = (items: { price: string }[]) =>
  items.reduce((sum, { price }) => sum + toMinor(price), 0);

describe('buildBasket', () => {
  it('returns the items unchanged without discount or shipping', () => {
    const result = buildBasket({ items: [item('A', '49.9'), item('B', 35)] as never });
    expect(result.basketItems.map((i) => i.price)).toEqual(['49.90', '35.00']);
    expect(result.price).toBe('84.90');
    expect(result.discount).toBe('0.00');
    expect(result.basketItems[0]).toEqual({
      id: 'A',
      name: 'Item A',
      category1: 'Category',
      itemType: 'PHYSICAL',
      price: '49.90',
    });
  });

  it('spreads a percentage discount and gives the leftover kuruş to the largest remainder', () => {
    // 100.00 - 10% over three equal items: 3.33 + 3.33 + 3.34 = 10.00
    const result = buildBasket({
      items: [item('A', '33.33'), item('B', '33.33'), item('C', '33.34')],
      discount: { percent: 10 },
    });
    expect(result.discount).toBe('10.00');
    expect(result.price).toBe('90.00');
    expect(sumMinor(result.basketItems)).toBe(9000);
    expect(result.basketItems.map((i) => i.price)).toEqual(['30.00', '30.00', '30.00']);
  });

  it('breaks remainder ties towards the larger item, then the earlier one', () => {
    // 0.01 over two equal items goes to the first
    const equal = buildBasket({ items: [item('A', '10'), item('B', '10')], discount: '0.01' });
    expect(equal.basketItems.map((i) => i.price)).toEqual(['9.99', '10.00']);

    // 0.02 over 10.00 and 20.00: shares 0.0066.. and 0.0133.., the larger remainder wins
    const unequal = buildBasket({ items: [item('A', '10'), item('B', '20')], discount: '0.02' });
    expect(unequal.basketItems.map((i) => i.price)).toEqual(['9.99', '19.99']);
  });

  it('spreads a fixed discount in proportion to item totals', () => {
    const result = buildBasket({
      items: [item('A', '49.90', 2), item('B', '35.00')],
      discount: '13.48',
      quantity: 'multiply',
    });
    // 99.80 and 35.00 of 134.80: 9.98 and 3.50
    expect(result.basketItems.map((i) => i.price)).toEqual(['89.82', '31.50']);
    expect(result.price).toBe('121.32');
  });

  it('expands quantities into one item per unit by default', () => {
    const result = buildBasket({ items: [item('A', '49.90', 2), item('B', '35.00')] });
    expect(result.basketItems.map((i) => [i.id, i.price])).toEqual([
      ['A-1', '49.90'],
      ['A-2', '49.90'],
      ['B', '35.00'],
    ]);
    expect(result.basketItems[0]).not.toHaveProperty('quantity');
  });

  it('multiplies the price by the quantity when asked', () => {
    const result = buildBasket({ items: [item('A', '49.90', 3)], quantity: 'multiply' });
    expect(result.basketItems).toHaveLength(1);
    expect(result.basketItems[0]).toMatchObject({ id: 'A', price: '149.70' });
  });

  it('adds shipping as the last item, outside the discount', () => {
    const result = buildBasket({
      items: [item('A', '100')],
      discount: { percent: 10 },
      shipping: { price: '29.90' },
    });
    expect(result.basketItems).toEqual([
      expect.objectContaining({ id: 'A', price: '90.00' }),
      {
        id: 'shipping',
        name: 'Shipping',
        category1: 'Shipping',
        itemType: 'VIRTUAL',
        price: '29.90',
      },
    ]);
    expect(result.price).toBe('119.90');
  });

  it('accepts a custom shipping item and skips free shipping', () => {
    const custom = buildBasket({
      items: [item('A', '10')],
      shipping: { price: 5, id: 'S1', name: 'Kargo', category1: 'Kargo', itemType: 'PHYSICAL' },
    });
    expect(custom.basketItems[1]).toEqual({
      id: 'S1',
      name: 'Kargo',
      category1: 'Kargo',
      itemType: 'PHYSICAL',
      price: '5.00',
    });

    const free = buildBasket({ items: [item('A', '10')], shipping: { price: '0' } });
    expect(free.basketItems).toHaveLength(1);
    expect(free.price).toBe('10.00');
  });

  it('rounds percentage discounts half up', () => {
    // 12.5% of 0.20 = 0.025 -> 0.03
    expect(buildBasket({ items: [item('A', '0.20')], discount: { percent: 12.5 } }).discount).toBe(
      '0.03'
    );
    // 33.333% of 1.00 = 0.33333 -> 0.33
    expect(buildBasket({ items: [item('A', '1')], discount: { percent: 33.333 } }).discount).toBe(
      '0.33'
    );
  });

  describe('validation', () => {
    const expectIssue = (fn: () => unknown, path: string) => {
      try {
        fn();
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).field).toBe(path);
        return;
      }
      throw new Error('expected a ValidationError');
    };

    it('rejects an empty basket', () => {
      expectIssue(() => buildBasket({ items: [] }), 'items');
    });

    it('rejects zero, negative and invalid prices', () => {
      expectIssue(() => buildBasket({ items: [item('A', '0')] }), 'items[0].price');
      expectIssue(
        () => buildBasket({ items: [item('A', '10'), item('B', '-1')] }),
        'items[1].price'
      );
      expectIssue(() => buildBasket({ items: [item('A', 'abc')] }), 'items[0].price');
      expectIssue(
        () => buildBasket({ items: [item('A', '10')], shipping: { price: '-5' } }),
        'shipping.price'
      );
    });

    it('rejects an invalid quantity', () => {
      expectIssue(() => buildBasket({ items: [item('A', '10', 0)] }), 'items[0].quantity');
      expectIssue(() => buildBasket({ items: [item('A', '10', 1.5)] }), 'items[0].quantity');
    });

    it('rejects a discount equal to or larger than the item total', () => {
      expectIssue(() => buildBasket({ items: [item('A', '10')], discount: '10' }), 'discount');
      expectIssue(() => buildBasket({ items: [item('A', '10')], discount: '12' }), 'discount');
      expectIssue(
        () => buildBasket({ items: [item('A', '10')], discount: { percent: 100 } }),
        'discount'
      );
      // Shipping does not count towards the discountable total
      expectIssue(
        () => buildBasket({ items: [item('A', '10')], discount: '10', shipping: { price: '5' } }),
        'discount'
      );
    });

    it('rejects an invalid percent', () => {
      expectIssue(
        () => buildBasket({ items: [item('A', '10')], discount: { percent: -1 } }),
        'discount.percent'
      );
      expectIssue(
        () => buildBasket({ items: [item('A', '10')], discount: { percent: 101 } }),
        'discount.percent'
      );
      expectIssue(
        () => buildBasket({ items: [item('A', '10')], discount: { percent: NaN } }),
        'discount.percent'
      );
    });

    it('rejects a discount that brings an item down to zero', () => {
      // 1.00 of 1.01: the 0.01 item gets 0.01 off
      expectIssue(
        () => buildBasket({ items: [item('A', '1.00'), item('B', '0.01')], discount: '1.00' }),
        'discount'
      );
    });
  });

  it('always adds up to price, to the kuruş, over many random baskets', () => {
    // Deterministic PRNG (mulberry32) so failures are reproducible
    let seed = 0x5eed;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

    let checked = 0;
    for (let run = 0; run < 2000; run++) {
      const items = Array.from({ length: int(1, 8) }, (_, i) =>
        item(`I${i}`, (int(1, 500_000) / 100).toFixed(2), int(1, 4))
      );
      const quantity = random() < 0.5 ? 'expand' : 'multiply';
      const itemTotal = items.reduce((s, it) => s + toMinor(it.price as string) * it.quantity!, 0);
      const discount =
        random() < 0.5 ? { percent: int(0, 9999) / 100 } : (int(0, itemTotal - 1) / 100).toFixed(2);
      const shipping = random() < 0.5 ? { price: (int(0, 10_000) / 100).toFixed(2) } : undefined;

      let result;
      try {
        result = buildBasket({ items, discount, shipping, quantity });
      } catch (error) {
        // Only a discount that zeroes out a small item may be rejected
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toMatch(/down to zero/);
        continue;
      }
      checked++;

      const shippingMinor = shipping ? toMinor(shipping.price) : 0;
      expect(sumMinor(result.basketItems)).toBe(toMinor(result.price));
      expect(toMinor(result.price)).toBe(itemTotal - toMinor(result.discount) + shippingMinor);
      for (const line of result.basketItems) {
        expect(line.price).toMatch(/^\d+\.\d{2}$/);
        expect(toMinor(line.price)).toBeGreaterThan(0);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
