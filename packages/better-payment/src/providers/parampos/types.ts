/**
 * Parampos (TurkPOS) SOAP API types
 *
 * Flow used by this provider:
 * - Non-3D payment:   TP_WMD_UCD (Islem_Guvenlik_Tip = NS)
 * - 3D payment init:  TP_WMD_UCD (Islem_Guvenlik_Tip = 3D) -> UCD_HTML
 * - 3D completion:    bank POSTs md/mdStatus/orderId/islemGUID/islemHash to the
 *                     callback URL, then TP_WMD_Pay finalizes the payment
 * - Stored card:      KS_Kart_Ekle / KS_Kart_Liste / KS_Kart_Sil (card storage
 *                     service) and KS_Tahsilat (payment with a KS_GUID)
 * - KS 3D completion: Param POSTs TURKPOS_RETVAL_* to the callback URL; the
 *                     result is confirmed with TP_Islem_Sorgulama4 (no hash)
 * - Refund / cancel:  TP_Islem_Iptal_Iade_Kismi2 (Durum = IADE / IPTAL)
 * - Status query:     TP_Islem_Sorgulama4
 * - BIN query:        BIN_SanalPos
 */

/**
 * Parsed SOAP result. All values are strings as returned by the service.
 */
export interface ParamposResult {
  Sonuc?: string;
  Sonuc_Str?: string;
  Sonuc_Ack?: string;
  [key: string]: string | undefined;
}

/**
 * Data POSTed by Param to Basarili_URL / Hata_URL after 3D authentication
 */
export interface Parampos3DSCallbackData {
  md: string;
  mdStatus: string;
  orderId: string;
  islemGUID: string;
  islemHash: string;
  transactionAmount?: string;
  bankResult?: string;
  [key: string]: string | undefined;
}

/**
 * Data POSTed by Param to Basarili_URL / Hata_URL after a KS_Tahsilat 3D
 * payment. There is no hash: the payment is confirmed with
 * TP_Islem_Sorgulama4(Siparis_ID) instead.
 */
export interface ParamposKsCallbackData {
  TURKPOS_RETVAL_Sonuc?: string;
  TURKPOS_RETVAL_Sonuc_Str?: string;
  /** GUID of the operation, as sent by Param */
  TURKPOS_RETVAL_GUID?: string;
  TURKPOS_RETVAL_Islem_Tarih?: string;
  TURKPOS_RETVAL_Dekont_ID?: string;
  TURKPOS_RETVAL_Tahsilat_Tutari?: string;
  TURKPOS_RETVAL_Odeme_Tutari?: string;
  /** The Siparis_ID sent to KS_Tahsilat */
  TURKPOS_RETVAL_Siparis_ID?: string;
  TURKPOS_RETVAL_Islem_ID?: string;
  TURKPOS_RETVAL_Ext_Data?: string;
  TURKPOS_RETVAL_Banka_Sonuc_Kod?: string;
  TURKPOS_RETVAL_KK_No?: string;
  [key: string]: string | undefined;
}

/** A row of KS_Kart_Liste's DT_Bilgi DataSet (only the fields this provider reads) */
export interface ParamposStoredCardRow {
  KK_GUID?: string;
  Kart_Adi?: string;
  KK_Tip?: string;
  KK_Banka?: string;
  KK_Marka?: string;
  KK_SK?: string;
  [key: string]: string | undefined;
}

/**
 * Param Durum values returned by TP_Islem_Sorgulama4
 */
export type ParamposOrderStatus =
  'SUCCESS' | 'FAIL' | 'BANK_FAIL' | 'CANCEL' | 'REFUND' | 'PARTIAL_REFUND';
