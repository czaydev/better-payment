/**
 * Information returned by offline BIN lookup
 */
export interface BinInfo {
  /** The 6 or 8 digit BIN number matched */
  binNumber: string;
  /** Bank name (e.g. "Garanti BBVA", "Türkiye İş Bankası", "Yapı Kredi") */
  bankName: string;
  /** Numerical bank code (e.g. 62 for Garanti, 64 for İş Bankası, 67 for Yapı Kredi) */
  bankCode: number;
  /** Card family / loyalty program (e.g. "Bonus", "Maximum", "World", "Axess", "Paraf", "CardFinans", "Bankkart Combo") */
  cardFamily: string;
  /** Card type: CREDIT_CARD, DEBIT_CARD, or PREPAID_CARD */
  cardType: 'CREDIT_CARD' | 'DEBIT_CARD' | 'PREPAID_CARD';
  /** Card network association: VISA, MASTER_CARD, TROY, AMERICAN_EXPRESS */
  cardAssociation: 'VISA' | 'MASTER_CARD' | 'TROY' | 'AMERICAN_EXPRESS';
  /** True for corporate/commercial cards, false for consumer cards */
  commercial: boolean;
}
