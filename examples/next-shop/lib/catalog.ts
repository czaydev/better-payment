/** Demo catalog, in kuruş. `loadProducts()` inserts it on first use. */
export const CATALOG = [
  {
    id: 'P1',
    name: 'Mechanical Keyboard',
    detail: 'Tenkeyless, hot-swappable switches',
    priceKurus: 249900,
  },
  { id: 'P2', name: 'USB-C Hub', detail: 'Seven ports, 100 W passthrough', priceKurus: 89900 },
  { id: 'P3', name: 'Desk Lamp', detail: 'Dimmable, 4000 K', priceKurus: 45500 },
  { id: 'P4', name: 'Notebook', detail: 'A5, 120 pages, dot grid', priceKurus: 12000 },
] as const;

export const CURRENCY = 'TRY';
