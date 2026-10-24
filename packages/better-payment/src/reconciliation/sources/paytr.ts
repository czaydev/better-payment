import { ConfigurationError, HttpClient } from 'better-payment';
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
  signHmacBase64Sha256,
} from '../utils';
import type {
  ReconciliationFieldCandidates,
  ReconciliationQuery,
  ReconciliationSource,
  ReconciliationSourceOptions,
  ReconciledTransaction,
} from '../../types/reconciliation';

/**
 * PayTR daily transaction list via the official İşlem Dökümü report.
 *
 * Official documentation: https://dev.paytr.com/en/islem-dokumu
 * - POST https://www.paytr.com/rapor/islem-dokumu, form fields merchant_id,
 *   start_date, end_date, paytr_token; at most 3 days per request.
 * - Token formula from the same page's sample code and PayTR's official Postman
 *   collection (https://github.com/paytr/paytr-postman, "İşlem Dökümü"
 *   pre-request script): base64(HMAC-SHA256(merchant_id + start_date +
 *   end_date + merchant_salt, merchant_key)).
 * - Row fields: islem_tipi (S = sale, I = return), net_tutar, kesinti_tutari,
 *   kesinti_orani, islem_tutari, odeme_tutari, islem_tarihi, para_birimi,
 *   taksit, kart_marka, kart_no, siparis_no, odeme_tipi.
 * - `status` is `success`, `failed` (no transaction in the range) or `error`
 *   (check `err_msg`). The page does not show a JSON sample, so the rows array
 *   is read from `data`, `transactions` or the top-level array.
 *
 * The rows carry no unique transaction id, so the id is a deterministic
 * composite of the documented fields; the same row delivered by two overlapping
 * windows therefore deduplicates. Without sandbox report credentials this has
 * not been verified against a live PayTR account.
 */
export interface PayTRReconciliationConfig extends ReconciliationSourceOptions {
  merchantId: string;
  merchantKey: string;
  merchantSalt: string;
  /** Default: https://www.paytr.com (PayTR has a single host for reports) */
  baseUrl?: string;
}

const DEFAULT_FIELDS: ReconciliationFieldCandidates = {
  transactionId: ['referans_no', 'reference_no', 'islem_no', 'id'],
  orderId: ['siparis_no', 'merchant_oid', 'order_id'],
  amount: ['odeme_tutari', 'islem_tutari', 'net_tutar'],
  fee: ['kesinti_tutari'],
  currency: ['para_birimi', 'currency'],
  date: ['islem_tarihi', 'tarih'],
  type: ['islem_tipi'],
  status: ['durum', 'status'],
};

function mapPayTRType(value: string | undefined): ReconciledTransaction['type'] {
  if (value === undefined) return 'sale';
  const v = foldTurkish(value);
  // The report's own values are S (sales) and I (returns); the word forms are
  // accepted too, for accounts whose row labels differ.
  if (v === 'i' || v.includes('iade')) return 'refund';
  if (v === 's' || v.includes('sat') || v.includes('odeme') || v.includes('payment')) return 'sale';
  if (v.includes('iptal')) return 'void';
  return 'other';
}

function rowsOf(body: unknown): unknown[] {
  const root = fieldsOf(body);
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.transactions)) return root.transactions;
  if (Array.isArray(body)) return body as unknown[];
  return [];
}

export function paytrReconciliation(config: PayTRReconciliationConfig): ReconciliationSource {
  const missing = (['merchantId', 'merchantKey', 'merchantSalt'] as const).filter(
    (key) => !config[key]
  );
  if (missing.length > 0) {
    throw new ConfigurationError(
      `paytrReconciliation: configuration is missing: ${missing.join(', ')}`,
      'paytr'
    );
  }
  const fields = mergeFieldCandidates(DEFAULT_FIELDS, config.fields);
  const maxDays = config.maxDaysPerRequest ?? 3; // PayTR: "en fazla 3 gün" per request

  const client = new HttpClient({
    provider: 'paytr-reconciliation',
    baseURL: config.baseUrl ?? 'https://www.paytr.com',
    timeout: config.timeoutMs ?? 30000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    fetch: config.fetch,
    retry: config.retry,
  });

  const listTransactions = async (query: ReconciliationQuery): Promise<ReconciledTransaction[]> => {
    const { from, to } = assertQueryRange(query, 'paytr');
    const out: ReconciledTransaction[] = [];
    const seen = new Set<string>();

    for (const window of chunkIsoRange(from, to, maxDays)) {
      const startDate = `${window.start} 00:00:00`;
      const endDate = `${window.end} 23:59:59`;
      const token = await signHmacBase64Sha256(
        config.merchantId + startDate + endDate + config.merchantSalt,
        config.merchantKey
      );
      const form = new URLSearchParams({
        merchant_id: config.merchantId,
        start_date: startDate,
        end_date: endDate,
        paytr_token: token,
      });

      let body: unknown;
      try {
        const response = await client.post<unknown>('/rapor/islem-dokumu', form.toString(), {
          retryable: true,
        });
        body = response.data;
      } catch (error) {
        throw new ReconciliationError('PayTR transaction list request failed', 'paytr', {
          cause: error,
        });
      }

      const root = fieldsOf(body);
      const reportStatus = pickString(root, ['status']);
      if (reportStatus === 'failed') {
        // Documented: "no transaction in the given date range". Not an error.
        continue;
      }
      if (reportStatus !== undefined && reportStatus !== 'success') {
        // Only error codes travel into the message: bodies carry order data.
        throw new ReconciliationError(
          `PayTR report failed (${pickString(root, ['err_no', 'error_code']) ?? 'unknown error'})`,
          'paytr'
        );
      }

      for (const rawRow of rowsOf(body)) {
        const row = fieldsOf(rawRow);
        const orderId = pickString(row, fields.orderId);
        const currency = normalizeCurrency(pickString(row, fields.currency));
        const amount = normalizeAmountString(
          pickRaw(row, fields.amount),
          currency,
          config.currencyDecimals
        );
        if (amount === undefined) continue; // a row without an amount cannot be reconciled
        const fee = normalizeAmountString(
          pickRaw(row, fields.fee),
          currency,
          config.currencyDecimals
        );
        const type = mapPayTRType(pickString(row, fields.type));
        const statusField = pickString(row, fields.status);
        const foldedStatus = statusField === undefined ? undefined : foldTurkish(statusField);
        const status: ReconciledTransaction['status'] =
          foldedStatus === undefined
            ? // The İşlem Dökümü lists the sales and returns that were made (with
              // their deduction), so a row is the provider's confirmation. Failed
              // attempts never get a row.
              'success'
            : /basarisiz|hata|fail/i.test(foldedStatus)
              ? 'failure'
              : /basarili|success|odendi/i.test(foldedStatus)
                ? 'success'
                : 'unknown';
        const transactionId =
          pickString(row, fields.transactionId) ??
          // Deterministic composite so the same row re-delivered by two 3-day
          // windows (or pages) dedupes to one entry.
          `paytr|${orderId ?? ''}|${pickString(row, fields.date) ?? ''}|${pickString(row, fields.type) ?? ''}|${amount}`;
        const key = `${transactionId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          provider: 'paytr',
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

  return { provider: 'paytr', listTransactions };
}
