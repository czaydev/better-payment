import {
  ConfigurationError,
  HttpClient,
  PROVIDER_DEFAULT_URLS,
  ProviderType,
  hmac,
  randomHex,
  toBase64,
} from 'better-payment';
import {
  ReconciliationError,
  assertQueryRange,
  chunkIsoRange,
  fieldsOf,
  foldTurkish,
  mergeFieldCandidates,
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
} from '../../types/reconciliation';

/**
 * Akbank Sanal POS daily transaction history via txnCode 1009.
 *
 * Akbank's full Sanal POS API reference sits behind the bank's merchant
 * registration, so the request/response shape here is pinned to what the issue
 * (#41) names (txnCode 1009) plus the protocol the public integrations agree
 * on — POST `<baseUrl>/transaction/process` with an `auth-hash` header
 * (`base64(HMAC-SHA512(body, secretKey))`), success code `VPS-0000`, and a
 * `txnDetailList` array in the response:
 * - https://github.com/recepasl44/poslar (AkbankPosRequestDataMapper::createHistoryRequestData,
 *   `report: { startDateTime, endDateTime }` / `report: { batchNumber }`, and
 *   the VPS-2235 "Toplam kayıt sayısı aşıldı" note: more than 9999 rows in one
 *   range requires paging by `batchNumber`)
 * - https://github.com/Voxyfy/anadolupay-node (AkbankPosGateway protocol notes)
 * - Daily history sample rows: https://github.com/recepasl44/poslar/tree/main/tests/Unit/test_data/akbankpos/history
 *
 * Every documented-but-uncertain aspect is configurable: request path
 * (`processPath`), field names (`fields`), and the VPS-2235 continuation
 * (`batchNumber` / `batchStep`). Amounts arrive as JSON numbers; they are
 * re-read from their shortest decimal form (`String(value)`), never through
 * float arithmetic.
 */
export interface AkbankReconciliationConfig extends ReconciliationSourceOptions {
  merchantSafeId: string;
  terminalSafeId: string;
  secretKey: string;
  /** Required in this repo's Akbank provider too; the JSON API host differs per environment. */
  baseUrl?: string;
  mode?: 'sandbox' | 'production';
  /** Default: /transaction/process */
  processPath?: string;
  /** Continue a truncated day from this batch number (VPS-2235). */
  batchNumber?: number;
  /**
   * When the provider answers VPS-2235 for a day, step `batchNumber` forward by
   * this amount and re-request until the day is complete. Default: 0 (stop and
   * throw, so no day is silently truncated).
   */
  batchStep?: number;
}

const AKBANK_API_VERSION = '1.00';
const AKBANK_SUCCESS_CODE = 'VPS-0000';
const AKBANK_TOO_MANY_RECORDS = 'VPS-2235';

/** txnCode -> normalized type (the codes are the repo's own AKBANK_TXN_CODES). */
const TYPE_BY_TXN_CODE: Record<string, ReconciledTransaction['type']> = {
  '1000': 'sale',
  '3000': 'sale',
  '1005': 'sale',
  '1002': 'refund',
  '1003': 'void',
  '1004': 'other',
  '3004': 'other',
};

const DEFAULT_FIELDS: ReconciliationFieldCandidates = {
  transactionId: ['bankId', 'id', 'settlementId', 'rrn'],
  orderId: ['orderId'],
  amount: ['amount', 'transactionAmount'],
  fee: ['merchantFee', 'commissionAmount'],
  currency: ['currencyLabel', 'currency'],
  date: ['txnDateTime', 'transactionDate'],
  type: ['txnCode'],
  status: ['responseCode', 'txnStatus'],
};

/** Europe/Istanbul is UTC+3 all year (no DST since 2016); no Intl needed. */
function istanTimeString(date: Date = new Date()): string {
  const local = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 19) + '.000';
}

export function akbankReconciliation(config: AkbankReconciliationConfig): ReconciliationSource {
  const missing = (['merchantSafeId', 'terminalSafeId', 'secretKey'] as const).filter(
    (key) => !config[key]
  );
  if (missing.length > 0) {
    throw new ConfigurationError(
      `akbankReconciliation: configuration is missing: ${missing.join(', ')}`,
      'akbank'
    );
  }
  const baseUrl =
    config.baseUrl ?? PROVIDER_DEFAULT_URLS[ProviderType.AKBANK][config.mode ?? 'production'];
  const fields = mergeFieldCandidates(DEFAULT_FIELDS, config.fields);
  const processPath = config.processPath ?? '/transaction/process';
  const batchStep = config.batchStep ?? 0;

  const client = new HttpClient({
    provider: 'akbank-reconciliation',
    baseURL: baseUrl,
    timeout: config.timeoutMs ?? 30000,
    headers: { 'Content-Type': 'application/json' },
    fetch: config.fetch,
    retry: config.retry,
  });

  async function requestHistory(
    fromIso: string,
    toIso: string,
    batchNumber?: number
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      version: AKBANK_API_VERSION,
      txnCode: '1009',
      requestDateTime: istanTimeString(),
      randomNumber: randomHex(64).toUpperCase(),
      terminal: {
        merchantSafeId: config.merchantSafeId,
        terminalSafeId: config.terminalSafeId,
      },
      report:
        batchNumber !== undefined
          ? { batchNumber }
          : { startDateTime: fromIso, endDateTime: toIso },
    };
    const json = JSON.stringify(body);
    const authHash = toBase64(await hmac('SHA-512', config.secretKey, json));
    try {
      const response = await client.post<unknown>(processPath, json, {
        retryable: true,
        headers: { 'Content-Type': 'application/json', 'auth-hash': authHash },
        // Akbank answers 4xx with a JSON body for validation errors
        validateStatus: (status) => status < 500,
      });
      return fieldsOf(response.data);
    } catch (error) {
      throw new ReconciliationError('Akbank transaction list request failed', 'akbank', {
        cause: error,
      });
    }
  }

  function rowsOf(data: Record<string, unknown>): unknown[] {
    const inner = fieldsOf(data.data);
    if (Array.isArray(inner.txnDetailList)) return inner.txnDetailList;
    if (Array.isArray(data.txnDetailList)) return data.txnDetailList;
    return [];
  }

  async function requestDayWindow(
    start: string,
    end: string
  ): Promise<{ rows: unknown[]; responseCode?: string }> {
    const startDateTime = `${start}T00:00:00.000`;
    const endDateTime = `${end}T23:59:59.999`;
    let batchNumber = config.batchNumber;
    const allRows: unknown[] = [];
    for (;;) {
      const data = await requestHistory(startDateTime, endDateTime, batchNumber);
      const responseCode = pickString(data, ['responseCode']);
      if (responseCode === AKBANK_TOO_MANY_RECORDS && batchStep > 0) {
        // The day holds more rows than one response; step the batch forward
        // (this is Akbank's documented continuation mechanism) and re-ask.
        batchNumber = (batchNumber ?? 0) + batchStep;
        continue;
      }
      if (responseCode !== undefined && responseCode !== AKBANK_SUCCESS_CODE) {
        // Only the code travels into the message; bodies hold order data (PII).
        throw new ReconciliationError(
          `Akbank history query failed (${responseCode})${
            responseCode === AKBANK_TOO_MANY_RECORDS
              ? ': more records than one response holds; set batchNumber/batchStep'
              : ''
          }`,
          'akbank'
        );
      }
      allRows.push(...rowsOf(data));
      return { rows: allRows, responseCode };
    }
  }

  const listTransactions = async (query: ReconciliationQuery): Promise<ReconciledTransaction[]> => {
    const { from, to } = assertQueryRange(query, 'akbank');
    const out: ReconciledTransaction[] = [];
    const seen = new Set<string>();

    // One request per day window: keeps a single response below Akbank's
    // 9999-record limit and makes day overlap deduplicate by transaction id.
    for (const window of chunkIsoRange(from, to, config.maxDaysPerRequest ?? 1)) {
      const { rows } = await requestDayWindow(window.start, window.end);
      for (let index = 0; index < rows.length; index++) {
        const row = fieldsOf(rows[index]);
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
        const txnCode = pickString(row, fields.type);
        const mapped = txnCode === undefined ? undefined : TYPE_BY_TXN_CODE[txnCode];
        const type: ReconciledTransaction['type'] = mapped ?? 'other';
        const transactionId =
          pickString(row, fields.transactionId) ??
          `akbank|${orderId ?? ''}|${txnCode ?? ''}|${pickString(row, fields.date) ?? window.start}|${index}`;
        if (seen.has(transactionId)) continue;
        seen.add(transactionId);

        const responseCode = pickString(row, ['responseCode']);
        const txnStatus = pickString(row, ['txnStatus']);
        let status: ReconciledTransaction['status'];
        if (txnStatus !== undefined) {
          const folded = foldTurkish(txnStatus);
          if (folded === 'basarili' || folded === 'success') status = 'success';
          else if (folded === 'basarisiz' || folded === 'fail' || folded.includes('fail'))
            status = 'failure';
          else status = 'unknown';
        } else if (responseCode !== undefined) {
          status = responseCode === AKBANK_SUCCESS_CODE ? 'success' : 'failure';
        } else {
          status = 'unknown';
        }

        out.push({
          provider: 'akbank',
          transactionId,
          ...(orderId !== undefined ? { orderId } : {}),
          type,
          amount,
          ...(fee !== undefined ? { fee } : {}),
          currency,
          status,
          date: normalizeDate(pickString(row, fields.date), window.start) ?? window.start,
        });
      }
    }
    return out;
  };

  return { provider: 'akbank', listTransactions };
}
