import type {
  InstallmentInfoResponse,
  InstallmentPrice,
  InstallmentDetail,
  Currency,
} from '../types';
import { toMinorUnits } from './utils';

/**
 * Options for configuring the installment table builder.
 */
export interface BuildInstallmentTableOptions {
  /**
   * Locale used by Intl.NumberFormat to format amounts.
   * @default 'tr-TR'
   */
  locale?: string;

  /**
   * Currency code for formatting (e.g. 'TRY', 'USD', 'EUR').
   * @default 'TRY'
   */
  currency?: Currency | string;

  /**
   * Optional custom Intl.NumberFormat options to override or extend defaults.
   */
  formatOptions?: Intl.NumberFormatOptions;

  /**
   * Filter by card family name when multiple installment details exist in the response.
   */
  cardFamily?: string;

  /**
   * Filter by bank code when multiple installment details exist in the response.
   */
  bankCode?: number;

  /**
   * Zero-based index of the installment detail to use when multiple are present.
   * @default 0
   */
  detailIndex?: number;

  /**
   * If true, builds rows for all installment details present in the response.
   * @default false
   */
  allDetails?: boolean;

  /**
   * Base single-payment total override (used to compute the `difference` if
   * the response does not include a single-payment option `installmentNumber: 1`).
   */
  singlePaymentTotal?: number | string;
}

/**
 * A single row in the installment table, representing an installment option.
 */
export interface InstallmentTableRow {
  /** Installment count (1 for single payment, 2, 3, 6, 12, etc.) */
  count: number;

  /** Raw monthly installment amount as number */
  monthlyAmount: number;

  /** Formatted monthly amount string according to locale and currency (e.g. "340,00 ₺") */
  formattedMonthlyAmount: string;

  /** Raw total amount to be paid as number */
  total: number;

  /** Formatted total amount string according to locale and currency (e.g. "1.020,00 ₺") */
  formattedTotal: string;

  /** Difference from single-payment total (0 for single payment) */
  difference: number;

  /** Formatted difference string according to locale and currency (e.g. "0,00 ₺" or "20,00 ₺") */
  formattedDifference: string;

  /** True if this option is the single payment (count === 1) */
  isSinglePayment: boolean;

  /** Commission rate in percent, when reported by the provider (e.g. 1.75) */
  commissionRate?: number;

  /** Card family name when known (e.g. 'Bonus', 'Maximum', 'Axess', 'World') */
  cardFamily?: string;

  /** Bank name when known (e.g. 'Garanti BBVA', 'Akbank', 'İş Bankası') */
  bankName?: string;

  /** Bank code when known */
  bankCode?: number;

  /** Card association when known (e.g. 'VISA', 'MASTER_CARD', 'TROY') */
  cardAssociation?: string;

  /** Card type when known (e.g. 'CREDIT_CARD', 'DEBIT_CARD') */
  cardType?: string;

  /** Commercial card indicator (0: personal, 1: commercial) */
  commercial?: number;

  /** 3DS requirement indicator (0: optional, 1: required) */
  force3ds?: number;

  // Convenience aliases matching provider response properties:
  /** Alias for count */
  installmentNumber: number;

  /** Alias for monthlyAmount */
  installmentPrice: number;

  /** Alias for total */
  totalPrice: number;
}

/**
 * Turns an `installmentInfo()` response or installment detail array into a clean,
 * formatted table of installment options for checkout pages.
 *
 * - Computes monthly amounts, totals, and differences from single payment to the kuruş.
 * - Formats amounts with `Intl.NumberFormat` for the specified locale and currency.
 * - Marks the single-payment row (`isSinglePayment`) and sorts options by installment count.
 * - Works with responses from every provider that supports `installmentInfo()`.
 *
 * @param response - The response from `installmentInfo()`, an InstallmentPrice, or an array of details
 * @param options - Configuration options for locale, currency, and detail selection
 * @returns Array of sorted `InstallmentTableRow` objects
 *
 * @example
 * ```typescript
 * const info = await payment.iyzico.installmentInfo({ binNumber: '552879', price: '100.00' });
 * const table = buildInstallmentTable(info);
 *
 * for (const row of table) {
 *   console.log(`${row.count}x: ${row.formattedMonthlyAmount} (Toplam: ${row.formattedTotal})`);
 * }
 * ```
 */
export function buildInstallmentTable(
  response:
    | InstallmentInfoResponse
    | InstallmentPrice
    | InstallmentPrice[]
    | InstallmentDetail[]
    | null
    | undefined,
  options?: BuildInstallmentTableOptions
): InstallmentTableRow[] {
  if (!response) {
    return [];
  }

  let details: InstallmentPrice[] = [];

  if (Array.isArray(response)) {
    if (response.length === 0) return [];

    const first = response[0];
    if (first && typeof first === 'object' && 'installmentPrices' in first) {
      details = response as InstallmentPrice[];
    } else if (first && typeof first === 'object' && 'installmentNumber' in first) {
      // Direct array of InstallmentDetail
      details = [
        {
          binNumber: '',
          price: (first as InstallmentDetail).totalPrice,
          cardType: '',
          cardAssociation: '',
          cardFamilyName: '',
          bankCode: 0,
          bankName: '',
          commercial: 0,
          installmentPrices: response as InstallmentDetail[],
        },
      ];
    }
  } else if ('installmentDetails' in response) {
    if (response.status === 'failure' || !response.installmentDetails) {
      return [];
    }
    details = response.installmentDetails;
  } else if ('installmentPrices' in response) {
    details = [response];
  }

  if (details.length === 0) {
    return [];
  }

  const locale = options?.locale ?? 'tr-TR';
  const currency = options?.currency ?? 'TRY';

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options?.formatOptions,
  });

  const selectedDetails = options?.allDetails ? details : [pickDetail(details, options)];

  const allRows: InstallmentTableRow[] = [];

  for (const detail of selectedDetails) {
    if (
      !detail ||
      !Array.isArray(detail.installmentPrices) ||
      detail.installmentPrices.length === 0
    ) {
      continue;
    }

    // Determine baseline single-payment amount for difference computation
    const singlePriceItem = detail.installmentPrices.find((p) => p.installmentNumber === 1);
    let singlePaymentTotalMinor: number | undefined;

    if (singlePriceItem) {
      singlePaymentTotalMinor = toMinorUnits(singlePriceItem.totalPrice);
    } else if (options?.singlePaymentTotal !== undefined) {
      singlePaymentTotalMinor = toMinorUnits(options.singlePaymentTotal);
    } else if (detail.price !== undefined && Number.isFinite(detail.price) && detail.price > 0) {
      singlePaymentTotalMinor = toMinorUnits(detail.price);
    }

    for (const item of detail.installmentPrices) {
      const count = item.installmentNumber;
      const isSinglePayment = count === 1;

      const totalMinor = toMinorUnits(item.totalPrice);
      const total = totalMinor / 100;

      const monthlyMinor = toMinorUnits(item.installmentPrice);
      const monthlyAmount = monthlyMinor / 100;

      let difference = 0;
      if (!isSinglePayment && singlePaymentTotalMinor !== undefined) {
        difference = (totalMinor - singlePaymentTotalMinor) / 100;
      }

      const row: InstallmentTableRow = {
        count,
        monthlyAmount,
        formattedMonthlyAmount: formatter.format(monthlyAmount),
        total,
        formattedTotal: formatter.format(total),
        difference,
        formattedDifference: formatter.format(difference),
        isSinglePayment,
        commissionRate: item.commissionRate,
        cardFamily: detail.cardFamilyName || undefined,
        bankName: detail.bankName || undefined,
        bankCode:
          detail.bankCode !== undefined && detail.bankCode !== 0 ? detail.bankCode : undefined,
        cardAssociation: detail.cardAssociation || undefined,
        cardType: detail.cardType || undefined,
        commercial: detail.commercial,
        force3ds: detail.force3ds,

        installmentNumber: count,
        installmentPrice: monthlyAmount,
        totalPrice: total,
      };

      allRows.push(row);
    }
  }

  // Sort rows ascending by installment count
  allRows.sort((a, b) => a.count - b.count);

  return allRows;
}

function pickDetail(
  details: InstallmentPrice[],
  options?: BuildInstallmentTableOptions
): InstallmentPrice {
  if (options?.cardFamily) {
    const query = options.cardFamily.trim().toLowerCase();
    const matched = details.find(
      (d) => d.cardFamilyName && d.cardFamilyName.trim().toLowerCase() === query
    );
    if (matched) return matched;
  }

  if (options?.bankCode !== undefined) {
    const matched = details.find((d) => d.bankCode === options.bankCode);
    if (matched) return matched;
  }

  const index = options?.detailIndex ?? 0;
  return details[index] ?? details[0];
}
