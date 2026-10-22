import { cookies } from 'next/headers';
import { prisma } from './db';
import { CATALOG } from './catalog';

/**
 * The cart lives in a cookie, but the prices never do: every total is computed
 * on the server from the `Product` rows. The browser can only send product ids
 * and quantities.
 */
export const CART_COOKIE = 'next-shop-cart';

export type CartLines = Record<string, number>;

const MAX_QUANTITY = 99;

function sanitizeLines(value: unknown): CartLines {
  const lines: CartLines = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return lines;
  const knownIds = new Set<string>(CATALOG.map((product) => product.id));
  for (const [productId, quantity] of Object.entries(value)) {
    if (!knownIds.has(productId)) continue;
    const count = Math.floor(Number(quantity));
    if (!Number.isFinite(count) || count <= 0) continue;
    lines[productId] = Math.min(count, MAX_QUANTITY);
  }
  return lines;
}

/** Reads and validates the cart cookie. Returns {} when it is missing or broken. */
export async function readCart(): Promise<CartLines> {
  const store = await cookies();
  const raw = store.get(CART_COOKIE)?.value;
  if (!raw) return {};
  try {
    return sanitizeLines(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export async function writeCart(lines: CartLines): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE, JSON.stringify(lines), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export interface CartRow {
  productId: string;
  name: string;
  quantity: number;
  /** Server-side unit price, in kuruş */
  unitPriceKurus: number;
  /** Server-side line total, in kuruş */
  lineKurus: number;
}

export interface CartSummary {
  rows: CartRow[];
  /** Server-side cart total, in kuruş */
  totalKurus: number;
  currency: string;
}

/** Joins the cart lines with database prices. Unknown or emptied lines drop out. */
export async function cartSummary(lines: CartLines): Promise<CartSummary> {
  const ids = Object.keys(lines);
  if (ids.length === 0) return { rows: [], totalKurus: 0, currency: 'TRY' };

  const products = await prisma.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(products.map((product) => [product.id, product]));

  const rows: CartRow[] = [];
  let totalKurus = 0;
  for (const id of ids) {
    const product = byId.get(id);
    const quantity = lines[id];
    if (!product || quantity === undefined) continue;
    const lineKurus = product.priceKurus * quantity;
    totalKurus += lineKurus;
    rows.push({
      productId: product.id,
      name: product.name,
      quantity,
      unitPriceKurus: product.priceKurus,
      lineKurus,
    });
  }
  return { rows, totalKurus, currency: 'TRY' };
}
