import {
  definePlugin,
  ConfigurationError,
  ValidationError,
  type BetterPaymentPlugin,
  type OperationContext,
  type OperationResultContext,
  type PaymentRequest,
  type RefundRequest,
  type BasketItem,
} from 'better-payment';
import { toMinorUnits, parseAmount } from '../core/utils';

export type TcmbRateType =
  'forex-selling' | 'forex-buying' | 'banknote-selling' | 'banknote-buying';

export type CurrencyRateSource =
  'tcmb' | ((from: string, to: string) => Promise<number | undefined> | number | undefined);

export interface CurrencyConversionOptions {
  /**
   * Rate source: `'tcmb'` (default) or a custom async/sync function `(from, to) => rate`.
   * @default 'tcmb'
   */
  source?: CurrencyRateSource;

  /**
   * Which TCMB rate to use when `source: 'tcmb'`.
   * - `'forex-selling'` (default): Döviz Satış
   * - `'forex-buying'`: Döviz Alış
   * - `'banknote-selling'`: Efektif Satış
   * - `'banknote-buying'`: Efektif Alış
   * @default 'forex-selling'
   */
  rate?: TcmbRateType;

  /**
   * Optional markup margin percentage added to the exchange rate (e.g. 0.01 for +1%).
   */
  markup?: number;

  /**
   * Target currency mapping per provider id.
   * Example: `{ parampos: 'TRY', iyzico: ['TRY', 'USD', 'EUR'] }`.
   * If a provider receives a currency in its allowed list, no conversion occurs.
   * If not allowed, it converts to the target currency (or the first element of the list).
   */
  target?: Record<string, string | string[]>;

  /**
   * Cache configuration for exchange rates.
   */
  cache?: {
    /**
     * Cache TTL in milliseconds, or string format like `'1h'`, `'30m'`, `'60s'`.
     * @default '1h'
     */
    ttl?: number | string;
  };

  /**
   * Custom fetch implementation (optional, for tests or edge environments).
   * @default globalThis.fetch
   */
  fetch?: typeof fetch;

  /**
   * Custom TCMB XML endpoint URL.
   * @default 'https://www.tcmb.gov.tr/kurlar/today.xml'
   */
  tcmbUrl?: string;
}

export interface FxQuoteRequest {
  amount: number | string;
  from: string;
  to: string;
}

export interface FxQuoteResponse {
  amount: number;
  from: string;
  to: string;
  convertedAmount: number;
  exchangeRate: number;
  markup?: number;
}

interface ConversionRecord {
  originalAmount: string;
  originalPaidPrice?: string;
  originalCurrency: string;
  exchangeRate: number;
  targetCurrency: string;
  convertedAmount: string;
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

function parseTtl(ttl?: number | string): number {
  if (ttl === undefined) return 60 * 60 * 1000; // 1 hour
  if (typeof ttl === 'number') return ttl;
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(ttl.trim());
  if (!match) {
    throw new ConfigurationError(
      `currencyConversion: invalid cache ttl '${ttl}'. Use milliseconds or '60s', '30m', '1h', '1d'.`
    );
  }
  return Number(match[1]) * DURATION_UNITS[match[2].toLowerCase()];
}

interface TcmbParsedCurrency {
  unit: number;
  forexBuying?: number;
  forexSelling?: number;
  banknoteBuying?: number;
  banknoteSelling?: number;
}

function parseTcmbXml(xml: string): Map<string, TcmbParsedCurrency> {
  const currencies = new Map<string, TcmbParsedCurrency>();
  const currencyRegex = /<Currency\s+[^>]*CurrencyCode="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/gi;
  let match: RegExpExecArray | null;

  while ((match = currencyRegex.exec(xml)) !== null) {
    const code = match[1].toUpperCase();
    const content = match[2];

    const unitMatch = /<Unit>(\d+)<\/Unit>/i.exec(content);
    const fbMatch = /<ForexBuying>([0-9.]+)<\/ForexBuying>/i.exec(content);
    const fsMatch = /<ForexSelling>([0-9.]+)<\/ForexSelling>/i.exec(content);
    const bbMatch = /<BanknoteBuying>([0-9.]+)<\/BanknoteBuying>/i.exec(content);
    const bsMatch = /<BanknoteSelling>([0-9.]+)<\/BanknoteSelling>/i.exec(content);

    const unit = unitMatch ? Number(unitMatch[1]) : 1;
    currencies.set(code, {
      unit: unit > 0 ? unit : 1,
      forexBuying: fbMatch ? Number(fbMatch[1]) : undefined,
      forexSelling: fsMatch ? Number(fsMatch[1]) : undefined,
      banknoteBuying: bbMatch ? Number(bbMatch[1]) : undefined,
      banknoteSelling: bsMatch ? Number(bsMatch[1]) : undefined,
    });
  }

  return currencies;
}

/**
 * Currency conversion plugin for better-payment.
 * Automatically converts prices to accepted provider currencies using TCMB daily exchange rates
 * or custom rate providers, preserves kuruş accuracy across basket items, and locks original
 * exchange rates for refunds.
 */
export function currencyConversion(options: CurrencyConversionOptions = {}): BetterPaymentPlugin {
  const rateType: TcmbRateType = options.rate ?? 'forex-selling';
  const ttlMs = parseTtl(options.cache?.ttl);
  const tcmbUrl = options.tcmbUrl ?? 'https://www.tcmb.gov.tr/kurlar/today.xml';
  const customFetch = options.fetch;

  let cachedRates: Map<string, TcmbParsedCurrency> | null = null;
  let cacheTimestamp = 0;

  // Track conversions for ongoing and completed payments
  const conversionRecordsByConversation = new Map<string, ConversionRecord>();
  const conversionRecordsByPaymentId = new Map<string, ConversionRecord>();
  const requestConversions = new WeakMap<object, ConversionRecord>();

  async function fetchTcmbRates(): Promise<Map<string, TcmbParsedCurrency>> {
    const now = Date.now();
    if (cachedRates && now - cacheTimestamp < ttlMs) {
      return cachedRates;
    }

    const fetcher = customFetch || globalThis.fetch;
    const response = await fetcher(tcmbUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch TCMB exchange rates: HTTP ${response.status}`);
    }

    const xml = await response.text();
    cachedRates = parseTcmbXml(xml);
    cacheTimestamp = now;
    return cachedRates;
  }

  function extractTcmbRate(item: TcmbParsedCurrency, type: TcmbRateType): number | undefined {
    let raw: number | undefined;
    switch (type) {
      case 'forex-selling':
        raw = item.forexSelling ?? item.banknoteSelling;
        break;
      case 'forex-buying':
        raw = item.forexBuying ?? item.banknoteBuying;
        break;
      case 'banknote-selling':
        raw = item.banknoteSelling ?? item.forexSelling;
        break;
      case 'banknote-buying':
        raw = item.banknoteBuying ?? item.forexBuying;
        break;
    }
    if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return undefined;
    return raw / item.unit;
  }

  async function getBaseRate(from: string, to: string): Promise<number> {
    const f = from.trim().toUpperCase();
    const t = to.trim().toUpperCase();
    if (f === t) return 1;

    if (typeof options.source === 'function') {
      const customRate = await options.source(f, t);
      if (customRate === undefined || !Number.isFinite(customRate) || customRate <= 0) {
        throw new ValidationError(
          `currencyConversion: custom rate source returned no rate for ${f} -> ${t}`
        );
      }
      return customRate;
    }

    const rates = await fetchTcmbRates();

    const getTryRate = (currency: string): number => {
      if (currency === 'TRY') return 1;
      const data = rates.get(currency);
      if (!data) {
        throw new ValidationError(
          `currencyConversion: TCMB rate not found for currency '${currency}'`
        );
      }
      const rate = extractTcmbRate(data, rateType);
      if (!rate) {
        throw new ValidationError(
          `currencyConversion: TCMB ${rateType} rate not found for currency '${currency}'`
        );
      }
      return rate;
    };

    if (t === 'TRY') {
      return getTryRate(f);
    }
    if (f === 'TRY') {
      return 1 / getTryRate(t);
    }

    // Cross-rate: F -> TRY -> T
    const rateF = getTryRate(f);
    const rateT = getTryRate(t);
    return rateF / rateT;
  }

  async function getEffectiveRate(from: string, to: string): Promise<number> {
    const base = await getBaseRate(from, to);
    if (from.toUpperCase() === to.toUpperCase()) return 1;
    const markupMultiplier = 1 + (options.markup ?? 0);
    return base * markupMultiplier;
  }

  function resolveTargetCurrency(provider: string, requestCurrency: string): string | undefined {
    if (!options.target) return undefined;
    const rule = options.target[provider];
    if (!rule) return undefined;

    const current = requestCurrency.toUpperCase();
    if (Array.isArray(rule)) {
      const allowed = rule.map((c) => c.toUpperCase());
      if (allowed.includes(current)) return undefined; // Already acceptable
      return allowed[0];
    }

    const target = rule.toUpperCase();
    if (target === current) return undefined;
    return target;
  }

  function convertBasketItems(
    items: BasketItem[],
    rate: number,
    targetTotalPriceStr: string
  ): BasketItem[] {
    if (items.length === 0) return [];
    const targetPriceMinor = toMinorUnits(targetTotalPriceStr);

    // Convert each item's price
    let sumMinor = 0;
    const convertedItems: BasketItem[] = [];
    const minors: number[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemMinor = toMinorUnits(item.price);
      const convertedItemMinor = Math.round(itemMinor * rate);
      minors.push(convertedItemMinor);
      sumMinor += convertedItemMinor;
    }

    // Distribute kuruş difference so sum equals targetPriceMinor
    const diff = targetPriceMinor - sumMinor;
    if (diff !== 0 && minors.length > 0) {
      // Adjust largest remainder / last item
      minors[minors.length - 1] += diff;
    }

    for (let i = 0; i < items.length; i++) {
      convertedItems.push({
        ...items[i],
        price: (minors[i] / 100).toFixed(2),
      });
    }

    return convertedItems;
  }

  return definePlugin({
    id: 'currency-conversion',
    version: '0.12.0',
    options,

    methods: () => ({
      fx: {
        quote: async ({ amount, from, to }: FxQuoteRequest): Promise<FxQuoteResponse> => {
          const numAmount = parseAmount(amount);
          const rate = await getEffectiveRate(from, to);
          const convertedMinor = Math.round(toMinorUnits(numAmount) * rate);
          const convertedAmount = convertedMinor / 100;

          return {
            amount: numAmount,
            from: from.toUpperCase(),
            to: to.toUpperCase(),
            convertedAmount,
            exchangeRate: rate,
            markup: options.markup,
          };
        },
        getRate: (from: string, to: string) => getEffectiveRate(from, to),
        clearCache: () => {
          cachedRates = null;
          cacheTimestamp = 0;
        },
      },
    }),

    hooks: {
      before: [
        {
          matcher: (ctx: OperationContext) =>
            ctx.operation === 'createPayment' ||
            ctx.operation === 'initThreeDSPayment' ||
            ctx.operation === 'authorize' ||
            ctx.operation === 'initThreeDSAuthorize',
          handler: async (ctx: OperationContext) => {
            const provider = ctx.provider;
            if (!provider) return;

            const req = ctx.request as PaymentRequest;
            if (!req || !req.currency || !req.price) return;

            const targetCurrency = resolveTargetCurrency(provider, String(req.currency));
            if (!targetCurrency) return; // No conversion needed

            const originalCurrency = String(req.currency).toUpperCase();
            const originalAmount = String(req.price);
            const originalPaidPrice =
              req.paidPrice !== undefined ? String(req.paidPrice) : originalAmount;

            const rate = await getEffectiveRate(originalCurrency, targetCurrency);

            const convertedPriceMinor = Math.round(toMinorUnits(originalAmount) * rate);
            const convertedPrice = (convertedPriceMinor / 100).toFixed(2);

            const convertedPaidMinor = Math.round(toMinorUnits(originalPaidPrice) * rate);
            const convertedPaidPrice = (convertedPaidMinor / 100).toFixed(2);

            let convertedBasketItems: BasketItem[] | undefined;
            if (req.basketItems && Array.isArray(req.basketItems)) {
              convertedBasketItems = convertBasketItems(req.basketItems, rate, convertedPrice);
            }

            const record: ConversionRecord = {
              originalAmount,
              originalPaidPrice,
              originalCurrency,
              exchangeRate: rate,
              targetCurrency,
              convertedAmount: convertedPrice,
            };

            const updatedRequest: PaymentRequest = {
              ...req,
              price: convertedPrice,
              paidPrice: convertedPaidPrice,
              currency: targetCurrency,
              ...(convertedBasketItems ? { basketItems: convertedBasketItems } : {}),
            };

            if (req.conversationId) {
              conversionRecordsByConversation.set(req.conversationId, record);
            }
            requestConversions.set(updatedRequest, record);

            return { request: updatedRequest };
          },
        },
        {
          matcher: (ctx: OperationContext) => ctx.operation === 'refund',
          handler: async (ctx: OperationContext): Promise<{ request: unknown } | undefined> => {
            const req = ctx.request as RefundRequest;
            if (!req) return undefined;

            // Check if this payment was converted at checkout
            const record =
              (req.paymentId ? conversionRecordsByPaymentId.get(req.paymentId) : undefined) ??
              (req.conversationId
                ? conversionRecordsByConversation.get(req.conversationId)
                : undefined);

            if (!record) return undefined;

            // If refund is requested in the customer's original currency, convert using the ORIGINAL rate
            if (req.currency && String(req.currency).toUpperCase() === record.originalCurrency) {
              const refundAmount = parseAmount(req.price);
              const convertedMinor = Math.round(toMinorUnits(refundAmount) * record.exchangeRate);
              const convertedPrice = (convertedMinor / 100).toFixed(2);

              const updatedRefund: RefundRequest = {
                ...req,
                price: convertedPrice,
                currency: record.targetCurrency,
              };

              const refundRecord: ConversionRecord = {
                originalAmount: String(req.price),
                originalCurrency: record.originalCurrency,
                exchangeRate: record.exchangeRate,
                targetCurrency: record.targetCurrency,
                convertedAmount: convertedPrice,
              };

              requestConversions.set(updatedRefund, refundRecord);
              return { request: updatedRefund };
            }
            return undefined;
          },
        },
      ],

      after: [
        {
          handler: (ctx: OperationResultContext) => {
            const req = ctx.request as object;
            const record =
              requestConversions.get(req) ??
              ('conversationId' in req && typeof req.conversationId === 'string'
                ? conversionRecordsByConversation.get(req.conversationId)
                : undefined);

            if (record && ctx.result && typeof ctx.result === 'object') {
              const res = ctx.result as unknown as Record<string, unknown>;
              res.originalAmount = record.originalAmount;
              res.originalCurrency = record.originalCurrency;
              res.exchangeRate = record.exchangeRate;

              if (typeof res.paymentId === 'string') {
                conversionRecordsByPaymentId.set(res.paymentId, record);
              }
            }
          },
        },
      ],
    },
  });
}
