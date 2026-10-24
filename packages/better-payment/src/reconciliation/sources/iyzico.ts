import { ConfigurationError, HttpClient, hmac, toBase64, toHex, randomHex } from 'better-payment';
import {
  ReconciliationError,
  addAmounts,
  addIsoDays,
  assertQueryRange,
  currencyDecimals,
  decimalToMinor,
  fieldsOf,
  mergeFieldCandidates,
  minorToDecimal,
  normalizeAmountString,
  normalizeCurrency,
  normalizeDate,
  pickRaw,
  pickString,
} from '../utils';
import type {
  ReconciliationFieldCandidates,
  ReconciliationQuery,
  ReconciliationSource,
  ReconciliationSourceOptions,
  ReconciledTransaction,
  ReconciliationTransactionStatus,
} from '../../types/reconciliation';

/**
 * iyzico daily transactions via the official Reporting API.
 *
 * Official documentation: https://docs.iyzico.com/en/advanced/reporting-service
 * - GET https://api.iyzipay.com/v2/reporting/payment/transactions (sandbox:
 *   https://sandbox-api.iyzipay.com), query parameters `transactionDate`
 *   (YYYY-MM-DD, one day per request) and `page`; the response carries
 *   `transactions`, `currentPage` and `totalPageCount`. The documentation's
 *   sample response is the shape the tests use.
 * - Row fields: transactionId, conversationId, paidPrice, price,
 *   transactionType (PAYMENT / REFUND / CANCEL), transactionCurrency, iyzicoFee,
 *   transactionDate, transactionStatus, paymentId.
 * - Authorization: the IYZWSv2 header documented at
 *   https://docs.iyzico.com/en/getting-started/preliminaries/authorization
 *   (HMAC-SHA256 of `randomString + uri + requestBody`, hex-encoded, then
 *   base64 of `apiKey:...&randomKey:...&signature:...`).
 *
 * Two things the public documentation does not settle, both configurable:
 * 1. What the GET request signs as "requestBody". iyzico's official PHP SDK
 *    (ReportingPaymentTransactionRequest + IyziAuthV2Generator) signs the empty
 *    string; the official Node SDK signs `{}`. Default: "" (PHP behaviour). Set
 *    `signPayload: '{}'` if your account rejects it.
 * 2. The meaning of `transactionStatus` numbers: the reporting API returns the
 *    field but the public docs do not enumerate it. Rows whose status is not in
 *    `statusMap` are reported as `unknown`, never as success. The docs' sample
 *    payment rows carry `2`, so `statusMap: { '2': 'success' }` is the usual
 *    setting once your account's codes are known.
 *
 * A day's feed has one row per basket item (`paymentId` is the payment), so by
 * default rows are summed per payment id and type into one transaction. Two
 * successful payments for the same conversation id stay separate, so
 * `reconcile()` still reports a possible double charge as ambiguous.
 */
export interface IyzicoReconciliationConfig extends ReconciliationSourceOptions {
  apiKey: string;
  secretKey: string;
  /** Default follows `mode`: https://api.iyzipay.com / https://sandbox-api.iyzipay.com */
  baseUrl?: string;
  mode?: 'sandbox' | 'production';
  /** Payload covered by the IYZWSv2 signature of the GET; default "" (see above) */
  signPayload?: string;
  /** `transactionStatus` value -> normalized status; default: {} (everything unknown) */
  statusMap?: Record<string, ReconciliationTransactionStatus>;
  /** First page number iyzico serves for your account. Default: 1. */
  firstPage?: number;
  /** Safety cap on page requests per day. Default: 100. */
  maxPages?: number;
  /**
   * Sum the feed's per-item rows per payment id and type into one transaction.
   * Default: true. Set false to keep the provider's raw rows.
   */
  aggregateByPayment?: boolean;
}

const URI = '/v2/reporting/payment/transactions';

/** The payment the feed's per-item rows belong to (not exposed through `fields`). */
const PAYMENT_ID_KEYS = ['paymentId', 'paymentTxId'] as const;

const DEFAULT_FIELDS: ReconciliationFieldCandidates = {
  transactionId: ['transactionId', 'itemTransactionId'],
  orderId: ['conversationId'],
  amount: ['paidPrice', 'price'],
  fee: ['iyzicoFee'],
  currency: ['transactionCurrency', 'currency'],
  date: ['transactionDate'],
  type: ['transactionType'],
  status: ['transactionStatus'],
};

function mapIyzicoType(value: string | undefined): ReconciledTransaction['type'] {
  switch ((value ?? '').toUpperCase()) {
    case 'PAYMENT':
      return 'sale';
    case 'REFUND':
      return 'refund';
    case 'CANCEL':
    case 'VOID':
    case 'REVERSAL':
      return 'void';
    case 'PAYOUT':
      return 'settlement';
    default:
      return 'other';
  }
}

async function iyzicoAuthHeader(
  apiKey: string,
  secretKey: string,
  randomString: string,
  uri: string,
  signPayload: string
): Promise<string> {
  const signature = toHex(await hmac('SHA-256', secretKey, randomString + uri + signPayload));
  return `IYZWSv2 ${toBase64(`apiKey:${apiKey}&randomKey:${randomString}&signature:${signature}`)}`;
}

interface Aggregate {
  transactionId: string;
  orderId?: string;
  type: ReconciledTransaction['type'];
  currency: string;
  amount: string;
  fee: string;
  status: ReconciliationTransactionStatus;
  date: string;
}

function mergeStatus(
  current: ReconciliationTransactionStatus,
  next: ReconciliationTransactionStatus
): ReconciliationTransactionStatus {
  if (current === 'success' || next === 'success') return 'success';
  if (current === 'failure' || next === 'failure') return 'failure';
  if (current === 'pending' || next === 'pending') return 'pending';
  return 'unknown';
}

export function iyzicoReconciliation(config: IyzicoReconciliationConfig): ReconciliationSource {
  const missing = (['apiKey', 'secretKey'] as const).filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new ConfigurationError(
      `iyzicoReconciliation: configuration is missing: ${missing.join(', ')}`,
      'iyzico'
    );
  }
  const fields = mergeFieldCandidates(DEFAULT_FIELDS, config.fields);
  const baseUrl =
    config.baseUrl ??
    (config.mode === 'sandbox' ? 'https://sandbox-api.iyzipay.com' : 'https://api.iyzipay.com');
  const signPayload = config.signPayload ?? '';
  const firstPage = config.firstPage ?? 1;
  const maxPages = config.maxPages ?? 100;
  const aggregate = config.aggregateByPayment !== false;

  const client = new HttpClient({
    provider: 'iyzico-reconciliation',
    baseURL: baseUrl,
    timeout: config.timeoutMs ?? 30000,
    fetch: config.fetch,
    retry: config.retry,
  });

  const fetchPage = async (date: string, page: number): Promise<Record<string, unknown>> => {
    const randomString = randomHex(8);
    let authorization: string;
    try {
      authorization = await iyzicoAuthHeader(
        config.apiKey,
        config.secretKey,
        randomString,
        URI,
        signPayload
      );
    } catch (error) {
      throw new ReconciliationError('iyzico request signing failed', 'iyzico', { cause: error });
    }
    const url = `${URI}?transactionDate=${encodeURIComponent(date)}&page=${page}`;
    try {
      const response = await client.get<unknown>(url, {
        retryable: true,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authorization,
          'x-iyzi-rnd': randomString,
        },
      });
      const body = fieldsOf(response.data);
      const status = pickString(body, ['status']);
      if (status !== undefined && status !== 'success') {
        throw new ReconciliationError(
          `iyzico report failed (${pickString(body, ['errorCode', 'error_code']) ?? 'unknown error'})`,
          'iyzico'
        );
      }
      return body;
    } catch (error) {
      if (error instanceof ReconciliationError) throw error;
      throw new ReconciliationError('iyzico transaction list request failed', 'iyzico', {
        cause: error,
      });
    }
  };

  const listTransactions = async (query: ReconciliationQuery): Promise<ReconciledTransaction[]> => {
    const { from, to } = assertQueryRange(query, 'iyzico');
    const out: ReconciledTransaction[] = [];
    const groups = new Map<string, Aggregate>();
    const seen = new Set<string>();

    const keep = (row: ReconciledTransaction): void => {
      if (seen.has(row.transactionId)) return;
      seen.add(row.transactionId);
      out.push(row);
    };

    const accumulate = (row: ReconciledTransaction, paymentId: string | undefined): void => {
      if (!aggregate || paymentId === undefined) {
        keep(row);
        return;
      }
      // The feed is per basket item: one provider payment id can repeat on
      // several rows. Items are summed; separate payment ids stay separate.
      if (seen.has(`item:${row.transactionId}`)) return;
      seen.add(`item:${row.transactionId}`);
      const key = `${paymentId}|${row.type}|${row.currency}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          transactionId: `${paymentId}:${row.type}`,
          ...(row.orderId !== undefined ? { orderId: row.orderId } : {}),
          type: row.type,
          currency: row.currency,
          amount: row.amount,
          fee: row.fee ?? '0',
          status: row.status,
          date: row.date,
        });
        return;
      }
      existing.amount = addAmounts(
        existing.amount,
        row.amount,
        row.currency,
        config.currencyDecimals
      );
      existing.fee = addAmounts(
        existing.fee,
        row.fee ?? '0',
        row.currency,
        config.currencyDecimals
      );
      existing.status = mergeStatus(existing.status, row.status);
      if (row.date < existing.date) existing.date = row.date;
    };

    // iyzico's transactions feed is one day per request.
    for (let date = from; ; date = addIsoDays(date, 1)) {
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
        const page = firstPage + pageIndex;
        const body = await fetchPage(date, page);
        const rows = Array.isArray(body.transactions) ? body.transactions : [];
        const totalPageCount = Number(body.totalPageCount ?? firstPage) || firstPage;
        const currentPage = Number(body.currentPage ?? page) || page;

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = fieldsOf(rows[rowIndex]);
          const currency = normalizeCurrency(pickString(row, fields.currency));
          const amount = normalizeAmountString(
            pickRaw(row, fields.amount),
            currency,
            config.currencyDecimals
          );
          if (amount === undefined) continue;
          const fee = normalizeAmountString(
            pickRaw(row, fields.fee),
            currency,
            config.currencyDecimals
          );
          const orderId = pickString(row, fields.orderId);
          const providerTransactionId = pickString(row, fields.transactionId);
          const transactionId =
            providerTransactionId ?? `iyzico|${date}|${orderId ?? ''}|${amount}|${rowIndex}`;
          const type = mapIyzicoType(pickString(row, fields.type));
          const statusValue = pickString(row, fields.status);
          const status: ReconciledTransaction['status'] =
            statusValue !== undefined && config.statusMap?.[statusValue]
              ? config.statusMap[statusValue]
              : statusValue !== undefined
                ? 'unknown'
                : // No status column: the row is part of iyzico's own
                  // transaction feed, which is the provider record.
                  'success';
          accumulate(
            {
              provider: 'iyzico',
              transactionId,
              ...(orderId !== undefined ? { orderId } : {}),
              type,
              amount,
              ...(fee !== undefined ? { fee } : {}),
              currency,
              status,
              date: normalizeDate(pickString(row, fields.date), date) ?? date,
            },
            pickString(row, PAYMENT_ID_KEYS)
          );
        }

        if (rows.length === 0 || currentPage >= totalPageCount) break;
      }
      if (date === to) break;
    }

    if (aggregate) {
      for (const group of groups.values()) {
        const decimals = currencyDecimals(group.currency, config.currencyDecimals);
        const feeMinor = decimalToMinor(group.fee, decimals) ?? 0n;
        out.push({
          provider: 'iyzico',
          transactionId: group.transactionId,
          ...(group.orderId !== undefined ? { orderId: group.orderId } : {}),
          type: group.type,
          amount: group.amount,
          ...(feeMinor > 0n ? { fee: minorToDecimal(feeMinor, decimals) } : {}),
          currency: group.currency,
          status: group.status,
          date: group.date,
        });
      }
      out.sort((a, b) => a.date.localeCompare(b.date));
    }
    return out;
  };

  return { provider: 'iyzico', listTransactions };
}
