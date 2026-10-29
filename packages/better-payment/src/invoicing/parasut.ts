import { ConfigurationError } from 'better-payment';
import type {
  CreateInvoiceParams,
  InvoiceDocumentType,
  InvoiceResult,
  InvoicingAdapter,
  IssueInvoiceParams,
  IssuanceCheckResult,
  IssuanceResult,
} from './types';

/**
 * Verified against the official Paraşüt API v4 OpenAPI spec
 * (https://apidocs.parasut.com/swagger.json). No sandbox credentials exist, so
 * nothing here was exercised against the live service.
 */
export interface ParasutOptions {
  clientId: string;
  clientSecret: string;
  /** Paraşüt account e-mail: the password grant requires it */
  username: string;
  /** Paraşüt account password: the password grant requires it */
  password: string;
  companyId: string;
  /** OAuth redirect; Paraşüt documents `urn:ietf:wg:oauth:2.0:oob` as default */
  redirectUri?: string;
  baseUrl?: string;
  tokenUrl?: string;
  /** `scenario` attribute of issued e-Faturas. Default: `basic` */
  efaturaScenario?: 'basic' | 'commercial';
  /**
   * Shop URL for the e-Arşiv `internet_sale` block. Paraşüt requires it for
   * sales made over the internet.
   */
  eArchiveInternetSaleUrl?: string;
  /** Payment type of the e-Arşiv internet-sale block. Default card transfer */
  eArchivePaymentType?: 'KREDIKARTI/BANKAKARTI' | 'EFT/HAVALE' | 'KAPIDAODEME' | 'ODEMEARACISI';
  fetch?: typeof fetch;
}

interface TokenCache {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms after which the access token is no longer valid */
  expiresAt: number;
}

interface ParasutErrorBody {
  errors?: { title?: unknown; detail?: unknown }[];
  error?: unknown;
  error_description?: unknown;
}

interface ParasutDocument {
  data?: {
    id?: string | number;
    type?: string;
    attributes?: Record<string, unknown>;
  };
  included?: { id?: string | number; type?: string; attributes?: Record<string, unknown> }[];
}

/** JSON:API resource id/typelink, kept as one typed builder piece */
interface ParasutResourceLink<T extends string> {
  data: { type: T; id: string };
}

interface ParasutSalesInvoiceDetail {
  type: 'sales_invoice_details';
  attributes: {
    quantity: number;
    unit_price: number;
    vat_rate: number;
    description: string;
  };
  relationships: {
    product: ParasutResourceLink<'products'>;
  };
}

/** Paraşüt `sales_invoices` `item_type` values used by this adapter */
type ParasutSalesInvoiceItemType = 'invoice' | 'refund';

interface ParasutSalesInvoicePayload {
  data: {
    type: 'sales_invoices';
    attributes: {
      item_type: ParasutSalesInvoiceItemType;
      description: string;
      issue_date: string;
      due_date?: string;
      currency: 'TRL' | 'USD' | 'EUR' | 'GBP';
      tax_number?: string;
      tax_office?: string;
      billing_address?: string;
      billing_phone?: string;
      city?: string;
      country?: string;
    };
    relationships: {
      contact: ParasutResourceLink<'contacts'>;
      details: { data: ParasutSalesInvoiceDetail[] };
    };
  };
}

const OOB_REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';
const TOKEN_SAFETY_MS = 30_000;

/** Paraşüt only accepts these currency codes; TRY is spelled TRL there */
function toParasutCurrency(
  currency?: string
): ParasutSalesInvoicePayload['data']['attributes']['currency'] {
  const code = (currency ?? 'TRY').toUpperCase();
  if (code === 'TRY') return 'TRL';
  if (code === 'TRL' || code === 'USD' || code === 'EUR' || code === 'GBP') return code;
  throw new Error(
    `parasut: unsupported currency '${currency}' (supported: TRY/TRL, USD, EUR, GBP)`
  );
}

function toNumber(value: number | string, field: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`parasut: ${field} is not a finite number: '${String(value)}'`);
  }
  return num;
}

/**
 * Single builder for `POST /sales_invoices` payloads so create and return
 * invoices can not drift apart. Paraşüt computes `net_total` server-side from
 * the details (it is read-only), so it is never sent.
 */
export function buildSalesInvoicePayload(
  params: CreateInvoiceParams,
  itemType: ParasutSalesInvoiceItemType,
  issueDate: string,
  extra?: { returnOfInvoiceId?: string }
): ParasutSalesInvoicePayload {
  const contactId = params.buyer.contactId?.trim();
  if (!contactId) {
    throw new Error(
      'parasut: buyer.contactId (the Paraşüt `contacts` id) is required for a sales invoice; ' +
        'map your customer to its Paraşüt contact id in the `map` option'
    );
  }
  if (params.items.length === 0) {
    throw new Error('parasut: a sales invoice needs at least one line item');
  }

  const details = params.items.map((item) => {
    const productId = item.productId?.trim();
    if (!productId) {
      throw new Error(
        `parasut: line item '${item.name}' has no productId (the Paraşüt \`products\` id); ` +
          'invoice lines must reference the real catalogued product'
      );
    }
    return {
      type: 'sales_invoice_details' as const,
      attributes: {
        quantity: item.quantity ?? 1,
        unit_price: toNumber(item.unitPrice, `unit price of '${item.name}'`),
        vat_rate: item.vatRate ?? params.vatRate ?? 20,
        description: item.name,
      },
      relationships: {
        product: { data: { type: 'products' as const, id: productId } },
      },
    };
  });

  const attributes: ParasutSalesInvoicePayload['data']['attributes'] = {
    item_type: itemType,
    description:
      itemType === 'refund' && extra?.returnOfInvoiceId
        ? `Return for invoice ${extra.returnOfInvoiceId} — payment: ${params.paymentId || 'N/A'}`
        : `Payment: ${params.paymentId || 'N/A'}${
            params.conversationId ? ` (Order: ${params.conversationId})` : ''
          }`,
    issue_date: issueDate,
    currency: toParasutCurrency(params.currency),
  };
  if (params.dueDate) attributes.due_date = params.dueDate;
  if (params.buyer.taxNumber) attributes.tax_number = params.buyer.taxNumber;
  if (params.buyer.taxOffice) attributes.tax_office = params.buyer.taxOffice;
  if (params.buyer.address) attributes.billing_address = params.buyer.address;
  if (params.buyer.phone) attributes.billing_phone = params.buyer.phone;
  if (params.buyer.city) attributes.city = params.buyer.city;
  if (params.buyer.country) attributes.country = params.buyer.country;

  return {
    data: {
      type: 'sales_invoices',
      attributes,
      relationships: {
        contact: { data: { type: 'contacts', id: contactId } },
        details: { data: details },
      },
    },
  };
}

/** Only provider-supplied error titles/details are surfaced; bodies and tokens never are */
function providerDetail(status: number, body: ParasutErrorBody | null, context: string): string {
  const parts: string[] = [];
  if (typeof body?.error === 'string') parts.push(body.error);
  if (typeof body?.error_description === 'string') parts.push(body.error_description);
  const first = body?.errors?.[0];
  if (first) {
    if (typeof first.title === 'string') parts.push(first.title);
    if (typeof first.detail === 'string') parts.push(first.detail);
  }
  const detail = parts.join(': ').slice(0, 160);
  return detail ? `${context} (HTTP ${status}): ${detail}` : `${context} (HTTP ${status})`;
}

async function readErrorBody(res: Response): Promise<ParasutErrorBody | null> {
  try {
    return (await res.json()) as ParasutErrorBody;
  } catch {
    return null;
  }
}

function parseTokenResponse(data: unknown, context: string): TokenCache {
  const tokenBody = data as {
    access_token?: unknown;
    expires_in?: unknown;
    refresh_token?: unknown;
  };
  if (typeof tokenBody?.access_token !== 'string' || tokenBody.access_token.length === 0) {
    throw new Error(`parasut: ${context} response did not contain an access_token`);
  }
  const expiresIn = Number(tokenBody.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error(`parasut: ${context} response has an unusable expires_in`);
  }
  return {
    accessToken: tokenBody.access_token,
    refreshToken: typeof tokenBody.refresh_token === 'string' ? tokenBody.refresh_token : undefined,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

function jobOutcome(
  doc: ParasutDocument | undefined,
  context: string
): { status: IssuanceCheckResult['status']; jobId?: string; error?: string } {
  const jobId = doc?.data?.id === undefined ? undefined : String(doc.data.id);
  const attributes = doc?.data?.attributes;
  const rawStatus = attributes?.status;
  if (rawStatus !== 'running' && rawStatus !== 'done' && rawStatus !== 'error') {
    throw new Error(`parasut: ${context} did not return a trackable job with a known status`);
  }
  const errors = Array.isArray(attributes?.errors) ? (attributes?.errors as unknown[]) : [];
  return {
    status: rawStatus === 'done' ? 'issued' : rawStatus === 'error' ? 'failed' : 'pending',
    jobId,
    error:
      rawStatus === 'error'
        ? errors
            .map((e) => String(e))
            .join('; ')
            .slice(0, 160) || 'provider reported an error'
        : undefined,
  };
}

export function parasut(options: ParasutOptions): InvoicingAdapter {
  for (const key of ['clientId', 'clientSecret', 'username', 'password', 'companyId'] as const) {
    if (!options?.[key]?.trim()) {
      throw new ConfigurationError(
        `parasut: option '${key}' is required (Paraşüt password-grant OAuth)`
      );
    }
  }

  const baseUrl = options.baseUrl ? options.baseUrl.replace(/\/+$/, '') : 'https://api.parasut.com';
  const tokenUrl = options.tokenUrl ?? `${baseUrl}/oauth/token`;
  const redirectUri = options.redirectUri ?? OOB_REDIRECT;
  const fetchFn = options.fetch ?? globalThis.fetch;

  let tokenCache: TokenCache | null = null;

  async function requestToken(form: URLSearchParams, context: string): Promise<TokenCache> {
    const res = await fetchFn(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      throw new Error(
        providerDetail(res.status, await readErrorBody(res), `parasut: ${context} failed`)
      );
    }
    return parseTokenResponse(await res.json(), context);
  }

  function passwordGrantForm(): URLSearchParams {
    const form = new URLSearchParams();
    form.set('grant_type', 'password');
    form.set('client_id', options.clientId);
    form.set('client_secret', options.clientSecret);
    form.set('username', options.username);
    form.set('password', options.password);
    form.set('redirect_uri', redirectUri);
    return form;
  }

  async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + TOKEN_SAFETY_MS) {
      return tokenCache.accessToken;
    }

    if (tokenCache?.refreshToken) {
      const form = new URLSearchParams();
      form.set('grant_type', 'refresh_token');
      form.set('client_id', options.clientId);
      form.set('client_secret', options.clientSecret);
      // Paraşüt rotates refresh tokens: every refresh response carries the new one
      form.set('refresh_token', tokenCache.refreshToken);
      try {
        tokenCache = await requestToken(form, 'OAuth refresh_token grant');
        return tokenCache.accessToken;
      } catch {
        tokenCache = null;
      }
    }

    tokenCache = await requestToken(passwordGrantForm(), 'OAuth password grant');
    return tokenCache.accessToken;
  }

  async function request(
    path: string,
    init: RequestInit = {}
  ): Promise<ParasutDocument | undefined> {
    const send = async (token: string) =>
      fetchFn(`${baseUrl}/v4/${options.companyId}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(init.headers || {}),
        },
      });

    let res = await send(await getAccessToken());
    if (res.status === 401) {
      // Token may have been revoked server-side: refresh once, then retry
      tokenCache = null;
      res = await send(await getAccessToken());
    }
    if (!res.ok) {
      throw new Error(
        providerDetail(res.status, await readErrorBody(res), `parasut: API error on ${path}`)
      );
    }
    if (res.status === 204) return undefined;
    return (await res.json()) as ParasutDocument;
  }

  function requireInvoiceId(doc: ParasutDocument | undefined, context: string): string {
    const id = doc?.data?.id;
    if (id === undefined || id === null || id === '') {
      throw new Error(`parasut: ${context} response did not include the created invoice id`);
    }
    return String(id);
  }

  function invoiceNumberFrom(doc: ParasutDocument | undefined): string | undefined {
    const value = doc?.data?.attributes?.invoice_no;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  async function createSalesInvoice(
    params: CreateInvoiceParams,
    itemType: ParasutSalesInvoiceItemType,
    context: string,
    extra?: { returnOfInvoiceId?: string }
  ): Promise<InvoiceResult> {
    const payload = buildSalesInvoicePayload(
      params,
      itemType,
      params.issueDate ?? new Date().toISOString().split('T')[0],
      extra
    );
    const response = await request('/sales_invoices', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      id: requireInvoiceId(response, context),
      invoiceNumber: invoiceNumberFrom(response),
      status: 'created',
      rawResponse: response,
    };
  }

  async function findEfaturaInbox(taxNumber: string): Promise<string | undefined> {
    const doc = await request(`/e_invoice_inboxes?filter[vkn]=${encodeURIComponent(taxNumber)}`);
    const match = (doc?.data ?? undefined) as unknown;
    const inboxList = Array.isArray(match) ? match : [];
    for (const entry of inboxList) {
      const attributes = (entry as { attributes?: Record<string, unknown> }).attributes;
      const address = attributes?.e_invoice_address;
      if (typeof address === 'string' && address.length > 0) return address;
    }
    return undefined;
  }

  return {
    name: 'parasut',

    async createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
      return createSalesInvoice(params, 'invoice', 'sales invoice creation');
    },

    async issueInvoice(issueParams: IssueInvoiceParams): Promise<IssuanceResult> {
      let documentType: InvoiceDocumentType | undefined = issueParams.documentType;
      let toAddress: string | undefined;

      if (!documentType) {
        // Documented rule: a buyer VKN/TCKN registered in the e-Fatura inbox
        // directory must receive an e-Fatura; everyone else gets an e-Arşiv.
        const taxNumber = issueParams.buyer.taxNumber?.trim();
        toAddress = taxNumber ? await findEfaturaInbox(taxNumber) : undefined;
        documentType = toAddress ? 'efatura' : 'earsiv';
      } else if (documentType === 'efatura') {
        const taxNumber = issueParams.buyer.taxNumber?.trim();
        toAddress = taxNumber ? await findEfaturaInbox(taxNumber) : undefined;
        if (!toAddress) {
          throw new Error(
            'parasut: e-Fatura issuance was forced but the buyer has no registered e-Fatura inbox'
          );
        }
      }

      const job =
        documentType === 'efatura'
          ? await issueEfatura(issueParams, toAddress)
          : await issueEArchive(issueParams);
      const outcome = jobOutcome(job, `e-${documentType} issuance`);
      if (outcome.status === 'failed') {
        throw new Error(`parasut: issuance job failed: ${outcome.error ?? 'unknown error'}`);
      }
      if (!outcome.jobId) {
        throw new Error('parasut: issuance response did not include a trackable job id');
      }
      return {
        status: outcome.status === 'issued' ? 'issued' : 'pending',
        documentType,
        jobId: outcome.jobId,
        rawResponse: job,
      };
    },

    async checkIssuance(jobId: string): Promise<IssuanceCheckResult> {
      const doc = await request(`/trackable_jobs/${encodeURIComponent(jobId)}`);
      const outcome = jobOutcome(doc, `trackable job ${jobId}`);
      return { status: outcome.status, error: outcome.error };
    },

    async cancelInvoice(invoiceId: string): Promise<void> {
      // Documented cancel flow is DELETE /sales_invoices/{id}/cancel without a
      // body; Paraşüt has no cancel reason field, so `reason` is not sent.
      await request(`/sales_invoices/${encodeURIComponent(invoiceId)}/cancel`, {
        method: 'DELETE',
      });
    },

    async createReturnInvoice(
      invoiceId: string,
      params: CreateInvoiceParams
    ): Promise<InvoiceResult> {
      return createSalesInvoice(params, 'refund', 'return invoice creation', {
        returnOfInvoiceId: invoiceId,
      });
    },
  };

  async function issueEfatura(
    issueParams: IssueInvoiceParams,
    toAddress?: string
  ): Promise<ParasutDocument | undefined> {
    const payload = {
      data: {
        type: 'e_invoices',
        attributes: {
          scenario: options.efaturaScenario ?? 'basic',
          ...(toAddress ? { to: toAddress } : {}),
        },
        relationships: {
          invoice: { data: { type: 'sales_invoices', id: issueParams.invoiceId } },
        },
      },
    };
    return request('/e_invoices', { method: 'POST', body: JSON.stringify(payload) });
  }

  async function issueEArchive(
    issueParams: IssueInvoiceParams
  ): Promise<ParasutDocument | undefined> {
    const internetSale =
      options.eArchiveInternetSaleUrl || issueParams.paymentPlatform || issueParams.paymentDate
        ? {
            ...(options.eArchiveInternetSaleUrl ? { url: options.eArchiveInternetSaleUrl } : {}),
            payment_type: options.eArchivePaymentType ?? 'KREDIKARTI/BANKAKARTI',
            ...(issueParams.paymentPlatform
              ? { payment_platform: issueParams.paymentPlatform }
              : {}),
            ...(issueParams.paymentDate ? { payment_date: issueParams.paymentDate } : {}),
          }
        : undefined;

    const payload = {
      data: {
        type: 'e_archives',
        attributes: internetSale ? { internet_sale: internetSale } : {},
        relationships: {
          // The e-archive endpoint links through `sales_invoice`, unlike the
          // e-invoice endpoint that links through `invoice`.
          sales_invoice: { data: { type: 'sales_invoices', id: issueParams.invoiceId } },
        },
      },
    };
    return request('/e_archives', { method: 'POST', body: JSON.stringify(payload) });
  }
}
