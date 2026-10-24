/**
 * Parampos (TurkPOS) SOAP API types
 *
 * Flow used by this provider:
 * - Non-3D payment:   TP_WMD_UCD (Islem_Guvenlik_Tip = NS)
 * - 3D payment init:  TP_WMD_UCD (Islem_Guvenlik_Tip = 3D) -> UCD_HTML
 * - 3D completion:    bank POSTs md/mdStatus/orderId/islemGUID/islemHash to the
 *                     callback URL, then TP_WMD_Pay finalizes the payment
 * - Foreign currency: TP_Islem_Odeme_WD (Doviz_Kodu 1001/1002/1003) -> UCD_URL;
 *                     Param POSTs TURKPOS_RETVAL_* fields, verified by
 *                     TURKPOS_RETVAL_Hash (no second request)
 * - Refund / cancel:  TP_Islem_Iptal_Iade_Kismi2 (Durum = IADE / IPTAL), TRY only
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
 * Param Durum values returned by TP_Islem_Sorgulama4
 */
export type ParamposOrderStatus =
  'SUCCESS' | 'FAIL' | 'BANK_FAIL' | 'CANCEL' | 'REFUND' | 'PARTIAL_REFUND';
