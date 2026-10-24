import { ConfigurationError, HttpClient } from 'better-payment';
import {
  buildParamposSoapEnvelope,
  parseParamposDataSetRows,
  parseParamposSoapResponse,
} from '../../providers/parampos/utils';
import type { XmlValue } from '../../providers/parampos/utils';
import {
  ReconciliationError,
  assertQueryRange,
  foldTurkish,
  formatDottedDateRange,
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
 * Param (TurkPOS) daily transactions via the TP_Islem_Izleme SOAP operation.
 *
 * Official sources (Param publishes its integration contracts on GitHub):
 * - https://github.com/PARAMPOS/php-client (src/Features/IslemIzleme/TP_Islem_Izleme.php):
 *   request fields G{CLIENT_CODE, CLIENT_USERNAME, CLIENT_PASSWORD}, GUID,
 *   Tarih_Bas, Tarih_Bit, Islem_Tip ('İptal' | 'İade' | 'Satış'),
 *   Islem_Durum ('Başarılı' | 'Başarısız')
 * - https://github.com/PARAMPOS/nodejs-client (src/types/models/IslemIzlemeModel.js):
 *   the date fields must be `dd.MM.yyyy HH:mm:ss`
 * - https://github.com/PARAMPOS/API-Kullanim-Ornekleri (SAMPLE_DOTNET_CODE/.../TP_Islem_Izleme):
 *   response rows arrive as `DT_Bilgi/Temp` elements with SanalPOS_Islem_ID,
 *   SanalPOS_Islem_ID_Orj, ORJ_ORDER_ID, Tip_Str, Tarih, Tutar, Komisyon_Tutar,
 *   Net_Tutar, Sonuc, Sonuc_Str, PB, Taksit, Dekont_ID, Toplam_Iade_Tutar
 *
 * TP_Islem_Izleme returns the whole window in one response (no paging). The
 * order id column of a sale row is documented only as `ORJ_ORDER_ID` (whose
 * name suggests "original order id"); if your merchant's rows carry the order
 * id under a different tag, pass `fields.orderId`.
 */
export interface ParamposReconciliationConfig extends ReconciliationSourceOptions {
  clientCode: string;
  clientUsername: string;
  clientPassword: string;
  /** Merchant GUID (anahtar) */
  guid: string;
  /** Service URL; required, same as the provider's own config. */
  baseUrl?: string;
  mode?: 'sandbox' | 'production';
  /** Filter by Param's Islem_Tip ('Satış' | 'İade' | 'İptal'); sent only when set. */
  transactionType?: string;
  /** Filter by Param's Islem_Durum ('Başarılı' | 'Başarısız'); sent only when set. */
  transactionState?: string;
}

const DEFAULT_FIELDS: ReconciliationFieldCandidates = {
  transactionId: ['SanalPOS_Islem_ID', 'Dekont_ID'],
  orderId: ['OrderId', 'ORJ_ORDER_ID', 'Siparis_ID'],
  amount: ['Tutar', 'Islem_Tutar', 'Toplam_Tutar'],
  fee: ['Komisyon_Tutar'],
  currency: ['PB', 'Currency'],
  date: ['Tarih', 'Islem_Tarih'],
  type: ['Tip_Str'],
  status: ['Sonuc_Str', 'Sonuc', 'Islem_Durum'],
};

function mapParamType(value: string | undefined): ReconciledTransaction['type'] {
  switch (value === undefined ? '' : foldTurkish(value)) {
    case 'iade':
      return 'refund';
    case 'iptal':
      return 'void';
    case 'satis':
      return 'sale';
    default:
      return value === undefined ? 'sale' : 'other';
  }
}

function mapParamStatus(value: string | undefined): ReconciledTransaction['status'] {
  if (value === undefined) return 'unknown';
  if (/^\d+$/.test(value)) return Number(value) > 0 ? 'success' : 'failure';
  const folded = foldTurkish(value);
  if (folded === 'basarili' || folded === 'success') return 'success';
  if (folded === 'basarisiz' || folded === 'fail') return 'failure';
  return 'unknown';
}

export function paramposReconciliation(config: ParamposReconciliationConfig): ReconciliationSource {
  const missing = (['clientCode', 'clientUsername', 'clientPassword', 'guid'] as const).filter(
    (key) => !config[key]
  );
  if (missing.length > 0) {
    throw new ConfigurationError(
      `paramposReconciliation: configuration is missing: ${missing.join(', ')}`,
      'parampos'
    );
  }
  const baseUrl =
    config.baseUrl ??
    (config.mode === 'sandbox'
      ? 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx'
      : 'https://posws.param.com.tr/turkpos.ws/service_turkpos_prod.asmx');
  const fields = mergeFieldCandidates(DEFAULT_FIELDS, config.fields);

  const client = new HttpClient({
    provider: 'parampos-reconciliation',
    baseURL: baseUrl,
    timeout: config.timeoutMs ?? 60000,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    fetch: config.fetch,
    retry: config.retry,
  });

  const listTransactions = async (query: ReconciliationQuery): Promise<ReconciledTransaction[]> => {
    const { from, to } = assertQueryRange(query, 'parampos');

    const requestFields: Record<string, XmlValue> = {
      G: {
        CLIENT_CODE: config.clientCode,
        CLIENT_USERNAME: config.clientUsername,
        CLIENT_PASSWORD: config.clientPassword,
      },
      GUID: config.guid,
      Tarih_Bas: formatDottedDateRange(from, false),
      Tarih_Bit: formatDottedDateRange(to, true),
    };
    if (config.transactionType !== undefined) requestFields.Islem_Tip = config.transactionType;
    if (config.transactionState !== undefined) requestFields.Islem_Durum = config.transactionState;

    let xml: string;
    try {
      const response = await client.post(
        '',
        buildParamposSoapEnvelope('TP_Islem_Izleme', requestFields),
        {
          headers: { SOAPAction: 'https://turkpos.com.tr/TP_Islem_Izleme' },
          retryable: true,
          responseType: 'text',
        }
      );
      xml = String(response.data);
    } catch (error) {
      throw new ReconciliationError('Param transaction list request failed', 'parampos', {
        cause: error,
      });
    }

    let result: Record<string, string>;
    try {
      result = parseParamposSoapResponse<Record<string, string>>(xml, 'TP_Islem_IzlemeResult');
    } catch (error) {
      throw new ReconciliationError(
        'Param returned an unusable TP_Islem_Izleme response',
        'parampos',
        {
          cause: error,
        }
      );
    }
    // Param's result codes: > 0 means success (same rule the provider uses).
    // Note: the flat parse keeps the first `Sonuc` occurrence, which is a row
    // value when rows exist; with no rows this is the envelope's code, and a
    // non-positive code there means the whole query failed.
    const rows = parseParamposDataSetRows(xml, 'Temp');
    const sonuc = result['Sonuc'];
    if (rows.length === 0 && sonuc !== undefined && /^\d+$/.test(sonuc) && Number(sonuc) <= 0) {
      throw new ReconciliationError(`Param TP_Islem_Izleme failed (Sonuc ${sonuc})`, 'parampos');
    }

    const out: ReconciledTransaction[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < rows.length; index++) {
      const row: Record<string, unknown> = rows[index];
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
      const transactionId =
        pickString(row, fields.transactionId) ?? `param|${orderId ?? ''}|${index}`;
      if (seen.has(transactionId)) continue;
      seen.add(transactionId);
      out.push({
        provider: 'parampos',
        transactionId,
        ...(orderId !== undefined ? { orderId } : {}),
        type: mapParamType(pickString(row, fields.type)),
        amount,
        ...(fee !== undefined ? { fee } : {}),
        currency,
        status: mapParamStatus(pickString(row, fields.status)),
        date: normalizeDate(pickString(row, fields.date), from) ?? from,
      });
    }
    return out;
  };

  return { provider: 'parampos', listTransactions };
}
