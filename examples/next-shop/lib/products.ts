import { prisma } from './db';
import { CATALOG, CURRENCY } from './catalog';

export interface CatalogProduct {
  id: string;
  name: string;
  detail: string;
  priceKurus: number;
  currency: string;
}

/**
 * Inserts the demo catalog the first time it is read, so `pnpm dev` works with no
 * seed step. Prices come from this file, so the database is only a cache of them.
 */
export async function loadProducts(): Promise<CatalogProduct[]> {
  const existing = await prisma.product.findMany({ orderBy: { id: 'asc' } });
  if (existing.length) return existing;

  for (const product of CATALOG) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: { name: product.name, detail: product.detail, priceKurus: product.priceKurus },
      create: { ...product, currency: CURRENCY },
    });
  }
  return prisma.product.findMany({ orderBy: { id: 'asc' } });
}

/** The catalog as a plain object, for server-side price lookups. */
export async function productsById(): Promise<Record<string, CatalogProduct>> {
  const products = await loadProducts();
  return Object.fromEntries(products.map((product) => [product.id, product]));
}

/** Formats kuruş as a price string with the two decimals the library expects. */
export function formatKurus(kurus: number): string {
  return (kurus / 100).toFixed(2);
}
