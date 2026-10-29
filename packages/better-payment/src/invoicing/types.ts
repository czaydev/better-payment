import type { BasketItem, Buyer, PaymentEvent } from 'better-payment';

export interface InvoiceBuyer {
  name: string;
  /**
   * Id of this customer in the integrator's system (for Paraşüt, the `contacts`
   * resource id). Adapters that model customers as records require it: a sales
   * invoice must be attached to an existing contact, not to free-text fields.
   */
  contactId?: string;
  taxNumber?: string; // TCKN or VKN
  taxOffice?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
}

export interface InvoiceItem {
  name: string;
  quantity?: number;
  unitPrice: number | string;
  vatRate?: number; // e.g. 20 (percent)
  /**
   * Id of the catalogued product in the integrator's system (for Paraşüt, the
   * `products` resource id). Adapters reference line items by product id so the
   * invoice line updates stock and reporting of the real product.
   */
  productId?: string;
}

/** Which electronic document an issued sales invoice becomes. */
export type InvoiceDocumentType = 'efatura' | 'earsiv';

export interface CreateInvoiceParams {
  paymentId?: string;
  conversationId?: string;
  buyer: InvoiceBuyer;
  items: InvoiceItem[];
  total: number | string;
  currency?: string;
  issueDate?: string;
  dueDate?: string;
  vatRate?: number;
  /**
   * Force the e-document type for the issuance step. When omitted, the adapter
   * decides with its documented rule (Paraşüt: e-Fatura when the buyer's
   * VKN/TCKN has a registered e-Fatura inbox, e-Arşiv otherwise).
   */
  documentType?: InvoiceDocumentType;
}

export interface InvoiceResult {
  id: string;
  invoiceNumber?: string;
  pdfUrl?: string;
  /**
   * `created` means the underlying sales invoice exists at the provider. It is
   * not a claim that the e-document was issued — see `IssuanceResult`.
   */
  status: 'created' | 'pending' | 'failed';
  rawResponse?: unknown;
}

export interface IssueInvoiceParams {
  /** Id of the already-created sales invoice at the provider */
  invoiceId: string;
  documentType?: InvoiceDocumentType;
  buyer: InvoiceBuyer;
  total?: number | string;
  currency?: string;
  conversationId?: string;
  /** YYYY-MM-DD; used for the e-Arşiv internet-sale payment date */
  paymentDate?: string;
  /** Payment gateway name for the e-Arşiv internet-sale block (e.g. `iyzico`) */
  paymentPlatform?: string;
}

export interface IssuanceResult {
  /**
   * `pending` when the provider accepted the submission but has not confirmed
   * the document yet (Paraşüt answers with a trackable job). `issued` only when
   * the provider confirmed the document.
   */
  status: 'pending' | 'issued' | 'failed';
  documentType: InvoiceDocumentType;
  /** Provider job id for a pending submission, checkable via `checkIssuance` */
  jobId?: string;
  error?: string;
  rawResponse?: unknown;
}

export interface IssuanceCheckResult {
  status: 'pending' | 'issued' | 'failed';
  error?: string;
}

export interface InvoicingAdapter {
  name: string;
  createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult>;
  /** Turns a created sales invoice into the e-Fatura / e-Arşiv document. */
  issueInvoice?(params: IssueInvoiceParams): Promise<IssuanceResult>;
  /** Polls a pending issuance job returned by `issueInvoice`. */
  checkIssuance?(jobId: string): Promise<IssuanceCheckResult>;
  cancelInvoice?(invoiceId: string, reason?: string): Promise<void>;
  createReturnInvoice?(invoiceId: string, params: CreateInvoiceParams): Promise<InvoiceResult>;
}

export interface InvoicingMappedData {
  buyer?: Partial<InvoiceBuyer>;
  items?: InvoiceItem[];
  vatRate?: number;
  description?: string;
  documentType?: InvoiceDocumentType;
}

export type InvoicingMapFn = (payment: {
  buyer?: Buyer;
  basketItems?: BasketItem[];
  amount?: string;
  currency?: string;
  paymentId?: string;
  conversationId?: string;
  event: PaymentEvent<'payment.succeeded'>;
}) => InvoicingMappedData | Promise<InvoicingMappedData>;

export type InvoiceRefundAction = 'return-invoice' | 'cancel' | 'none';

export interface InvoicingRetryConfig {
  /** Maximum number of attempts. Default: 3 */
  attempts?: number;
  /** Delay in milliseconds between attempts. Default: 1000 */
  delay?: number;
}

/** Status of the invoicing record through the full lifecycle. */
export type InvoicingStatus = 'created' | 'pending' | 'issued' | 'cancelled' | 'failed';

export interface InvoicingRecord {
  paymentId: string;
  conversationId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  pdfUrl?: string;
  documentType?: InvoiceDocumentType;
  /** Issuance job id at the provider, while `status` is `pending` */
  issuanceJobId?: string;
  /**
   * The sales invoice this refund produced, so a redelivered `refund.succeeded`
   * cannot create a second return invoice.
   */
  returnInvoiceId?: string;
  status: InvoicingStatus;
  amount?: string;
  currency?: string;
  error?: string;
  /** Snapshot of the invoice request, so a retry recreates the real invoice */
  invoiceParams?: CreateInvoiceParams;
  /** Gateway that took the payment, used for the e-Arşiv internet-sale block */
  paymentPlatform?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence for issued invoices. A legally relevant document must survive
 * restarts: losing the record breaks idempotency and can cause a second
 * e-Fatura for the same payment.
 *
 * Implementations must be keyed by `paymentId`. Methods may return values
 * synchronously or as promises.
 */
export interface InvoicingStore {
  get(paymentId: string): Promise<InvoicingRecord | undefined> | InvoicingRecord | undefined;
  set(paymentId: string, record: InvoicingRecord): Promise<void> | void;
  list(): Promise<InvoicingRecord[]> | InvoicingRecord[];
  delete?(paymentId: string): Promise<void> | void;
}

export interface InvoicingIssuanceOptions {
  /**
   * - `auto`: the plugin queues the issuance step in the background after the
   *   sales invoice is created (fire-and-forget; nothing blocks the checkout,
   *   and an unconfirmed document stays `pending`, never `issued`).
   * - `manual`: nothing is issued until `payment.invoicing.issue(paymentId)`
   *   is called — run it from your own queue consumer.
   * - `none`: disable the e-document step.
   * Default: `auto` (only when the adapter supports `issueInvoice`).
   */
  mode?: 'auto' | 'manual' | 'none';
  /** Delay between `checkIssuance` polls of a pending job. Default: 2000 */
  pollIntervalMs?: number;
  /** Maximum polls before giving up and leaving the record `pending`. Default: 5 */
  pollAttempts?: number;
}

export interface InvoicingOptions {
  /** The invoicing provider adapter (e.g. parasut) */
  adapter: InvoicingAdapter;
  /**
   * Store for invoicing records. Default: `MemoryInvoicingStore`, which is
   * per-process and dev-only — production must supply a persistent store or
   * issued documents are forgotten on restart and can be duplicated.
   */
  store?: InvoicingStore;
  /** Function to map payment data into invoice fields */
  map?: InvoicingMapFn;
  /**
   * Action to perform when a payment refund succeeds:
   * - 'return-invoice': issue a return / storno invoice
   * - 'cancel': cancel the original sales invoice
   * - 'none': do nothing
   * Default: 'return-invoice'
   */
  onRefund?: InvoiceRefundAction;
  /** Retry policy for transient API failures. Default: 3 attempts, 1s delay */
  retry?: InvoicingRetryConfig;
  /** Default VAT rate percentage (e.g. 20 for 20%). Default: 20 */
  defaultVatRate?: number;
  /** e-Fatura / e-Arşiv issuance step configuration */
  issuance?: InvoicingIssuanceOptions;
  /** Hook called when the provider confirms the underlying sales invoice */
  onInvoiceCreated?: (
    invoice: InvoiceResult,
    event: PaymentEvent<'payment.succeeded'>
  ) => void | Promise<void>;
  /** Hook called when invoice creation fails after retries */
  onInvoiceFailed?: (
    error: Error,
    event: PaymentEvent<'payment.succeeded'>
  ) => void | Promise<void>;
  /** Hook called when the provider confirms the e-document was issued */
  onInvoiceIssued?: (
    record: InvoicingRecord,
    event?: PaymentEvent<'payment.succeeded'>
  ) => void | Promise<void>;
  /** Hook called when the issuance step fails; the record stays retryable */
  onInvoiceIssuanceFailed?: (
    error: Error,
    record: InvoicingRecord,
    event?: PaymentEvent<'payment.succeeded'>
  ) => void | Promise<void>;
}
