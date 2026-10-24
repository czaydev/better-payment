import { describe, it, expect, vi } from 'vitest';
import { betterPayment, ConfigurationError, PaymentStatus } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import {
  invoicing,
  parasut,
  type InvoicingAdapter,
  type InvoicingRecord,
  type InvoicingStore,
  type InvoiceResult,
  type ParasutOptions,
} from 'better-payment/invoicing';
import { mockPaymentRequest } from '../../fixtures/payment-data';

const FAKE_CREDENTIALS = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  username: 'accounting@example.invalid',
  password: 'fake-password-not-real',
  companyId: '12345',
};

function parasutWith(overrides: Partial<ParasutOptions>): ReturnType<typeof parasut> {
  return parasut({ ...FAKE_CREDENTIALS, ...overrides });
}

interface FetchCall {
  url: string;
  method: string;
  body?: string;
}

function collectCalls(mockFetch: ReturnType<typeof vi.fn>): FetchCall[] {
  return mockFetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: String((init as RequestInit | undefined)?.method ?? 'GET'),
    body: (init as RequestInit | undefined)?.body as string | undefined,
  }));
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

const SALES_INVOICE_PARAMS = {
  paymentId: 'pay-parasut-1',
  total: '150.00',
  currency: 'TRY',
  buyer: { name: 'Ahmet Yilmaz', contactId: '55001', taxNumber: '1234567890' },
  items: [{ name: 'Test Product', unitPrice: '150.00', quantity: 1, productId: '77001' }],
};

describe('invoicing plugin', () => {
  it('creates an invoice automatically on payment.succeeded', async () => {
    const createInvoice = vi.fn().mockResolvedValue({
      id: 'inv-123',
      invoiceNumber: 'EF202600000001',
      status: 'created',
    } satisfies InvoiceResult);

    const mockAdapter: InvoicingAdapter = {
      name: 'mock-invoicing',
      createInvoice,
    };

    const onInvoiceCreated = vi.fn();
    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-777',
      conversationId: 'order-999',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          onInvoiceCreated,
        }),
      ],
    });

    const res = await payment.createPayment(mockPaymentRequest);
    expect(res.status).toBe(PaymentStatus.SUCCESS);

    expect(createInvoice).toHaveBeenCalledOnce();
    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay-777',
        conversationId: 'order-999',
        buyer: expect.objectContaining({
          name: `${mockPaymentRequest.buyer.name} ${mockPaymentRequest.buyer.surname}`,
          email: mockPaymentRequest.buyer.email,
        }),
        items: expect.arrayContaining([
          expect.objectContaining({
            name: mockPaymentRequest.basketItems[0].name,
            unitPrice: mockPaymentRequest.basketItems[0].price,
          }),
        ]),
      })
    );

    expect(onInvoiceCreated).toHaveBeenCalledOnce();
    expect(await payment.invoicing.get('pay-777')).toMatchObject({
      paymentId: 'pay-777',
      invoiceId: 'inv-123',
      invoiceNumber: 'EF202600000001',
      status: 'created',
    });
  });

  it('keeps one invoice when payment.succeeded is redelivered', async () => {
    const createInvoice = vi
      .fn()
      .mockResolvedValue({ id: 'inv-redelivered', status: 'created' } satisfies InvoiceResult);
    const mockAdapter: InvoicingAdapter = {
      name: 'mock-invoicing',
      createInvoice,
    };

    const onInvoiceCreated = vi.fn();
    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-redelivered',
      conversationId: 'order-redelivered',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          onInvoiceCreated,
        }),
      ],
    });

    // The gateway re-sends its notification after the first one already won.
    await payment.createPayment(mockPaymentRequest);
    await payment.createPayment(mockPaymentRequest);

    expect(createInvoice).toHaveBeenCalledOnce();
    expect(onInvoiceCreated).toHaveBeenCalledOnce();
    expect(await payment.invoicing.list()).toHaveLength(1);
  });

  it('keeps one invoice when two copies arrive while the first is still running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const createInvoice = vi.fn(async () => {
      await gate;
      return { id: 'inv-concurrent', status: 'created' } satisfies InvoiceResult;
    });
    const mockAdapter: InvoicingAdapter = {
      name: 'mock-invoicing',
      createInvoice,
    };

    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-concurrent',
      conversationId: 'order-concurrent',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
        }),
      ],
    });

    const first = payment.createPayment(mockPaymentRequest);
    // Park the first delivery inside the provider call, so the second one lands
    // while the invoice POST is still open.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = payment.createPayment(mockPaymentRequest);
    release();
    await Promise.all([first, second]);

    expect(createInvoice).toHaveBeenCalledOnce();
    expect((await payment.invoicing.get('pay-concurrent'))?.invoiceId).toBe('inv-concurrent');
  });

  it('retries on transient failure and records failure when retries exhausted', async () => {
    let callCount = 0;
    const createInvoice = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.reject(new Error('Gateway timeout (504)'));
    });

    const mockAdapter: InvoicingAdapter = {
      name: 'mock-failing',
      createInvoice,
    };

    const onInvoiceFailed = vi.fn();
    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-err-1',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          retry: { attempts: 2, delay: 10 },
          onInvoiceFailed,
        }),
      ],
    });

    await payment.createPayment(mockPaymentRequest);

    expect(callCount).toBe(2);
    expect(onInvoiceFailed).toHaveBeenCalledOnce();
    const failedList = await payment.invoicing.getFailed();
    expect(failedList).toHaveLength(1);
    expect(failedList[0].paymentId).toBe('pay-err-1');
    expect(failedList[0].error).toContain('Gateway timeout');
  });

  it('allows manual retry of failed invoices from the saved snapshot', async () => {
    let attempt = 0;
    const createInvoice = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        return Promise.reject(new Error('Temporary network error'));
      }
      return Promise.resolve({
        id: 'inv-recovered-456',
        invoiceNumber: 'EF202600000002',
        status: 'created',
      } satisfies InvoiceResult);
    });

    const mockAdapter: InvoicingAdapter = {
      name: 'mock-adapter',
      createInvoice,
    };

    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-manual-retry',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          retry: { attempts: 1, delay: 0 },
        }),
      ],
    });

    await payment.createPayment(mockPaymentRequest);
    expect((await payment.invoicing.get('pay-manual-retry'))?.status).toBe('failed');

    const record = await payment.invoicing.retry('pay-manual-retry');
    expect(record.invoiceId).toBe('inv-recovered-456');
    expect(record.status).toBe('created');
    expect(await payment.invoicing.getFailed()).toHaveLength(0);
    // The retry must rebuild the real invoice, not a placeholder
    expect(createInvoice).toHaveBeenCalledTimes(2);
    expect(createInvoice.mock.calls[1][0]).toEqual(createInvoice.mock.calls[0][0]);
  });

  it('handles refund.succeeded by cancelling the invoice', async () => {
    const cancelInvoice = vi.fn().mockResolvedValue(undefined);
    const mockAdapter: InvoicingAdapter = {
      name: 'mock-cancelling',
      createInvoice: vi.fn().mockResolvedValue({ id: 'inv-to-cancel', status: 'created' }),
      cancelInvoice,
    };

    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-refundable',
    });
    vi.spyOn(provider, 'refund').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-refundable',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          onRefund: 'cancel',
        }),
      ],
    });

    await payment.createPayment(mockPaymentRequest);
    await payment.refund({ paymentId: 'pay-refundable', amount: '100.00' });

    expect(cancelInvoice).toHaveBeenCalledWith('inv-to-cancel');
    expect((await payment.invoicing.get('pay-refundable'))?.status).toBe('cancelled');
  });

  it('keeps one return invoice when refund.succeeded is redelivered', async () => {
    const createReturnInvoice = vi
      .fn()
      .mockResolvedValue({ id: 'inv-return-once', status: 'created' } satisfies InvoiceResult);
    const mockAdapter: InvoicingAdapter = {
      name: 'mock-returning',
      createInvoice: vi
        .fn()
        .mockResolvedValue({ id: 'inv-sale-once', status: 'created' } satisfies InvoiceResult),
      createReturnInvoice,
    };

    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-refund-twice',
    });
    vi.spyOn(provider, 'refund').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-refund-twice',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          onRefund: 'return-invoice',
        }),
      ],
    });

    await payment.createPayment(mockPaymentRequest);
    await payment.refund({ paymentId: 'pay-refund-twice', amount: '40.00' });
    await payment.refund({ paymentId: 'pay-refund-twice', amount: '40.00' });

    expect(createReturnInvoice).toHaveBeenCalledOnce();
    expect((await payment.invoicing.get('pay-refund-twice'))?.returnInvoiceId).toBe(
      'inv-return-once'
    );
  });

  describe('e-document issuance step', () => {
    function issuingAdapter(
      issueImpl: ReturnType<typeof vi.fn>,
      checkImpl?: ReturnType<typeof vi.fn>
    ): InvoicingAdapter {
      return {
        name: 'mock-issuing',
        createInvoice: vi.fn().mockResolvedValue({
          id: 'inv-issue-1',
          invoiceNumber: 'EF-1',
          status: 'created',
        }),
        issueInvoice: issueImpl,
        checkIssuance: checkImpl,
      };
    }

    async function paidPayment(
      adapter: InvoicingAdapter,
      options?: {
        onInvoiceIssued?: (record: InvoicingRecord, event?: unknown) => void;
        onInvoiceIssuanceFailed?: (error: Error, record: InvoicingRecord) => void;
      }
    ) {
      const provider = new MockProvider();
      vi.spyOn(provider, 'createPayment').mockResolvedValue({
        status: PaymentStatus.SUCCESS,
        paymentId: 'pay-issue-1',
      });
      const payment = betterPayment({
        providers: { mock: provider },
        defaultProvider: 'mock',
        plugins: [
          invoicing({
            adapter,
            issuance: { mode: 'manual', pollAttempts: 2, pollIntervalMs: 0 },
            ...options,
          }),
        ],
      });
      await payment.createPayment(mockPaymentRequest);
      return payment;
    }

    it('does not mark an invoice issued without provider confirmation', async () => {
      const issueInvoice = vi
        .fn()
        .mockResolvedValue({ status: 'pending', documentType: 'earsiv', jobId: 'job-1' });
      const checkIssuance = vi.fn().mockResolvedValue({ status: 'pending' });
      const onInvoiceIssued = vi.fn();

      const payment = await paidPayment(issuingAdapter(issueInvoice, checkIssuance), {
        onInvoiceIssued,
      });

      // Sales invoice creation alone never touches the e-document step
      expect(issueInvoice).not.toHaveBeenCalled();
      expect((await payment.invoicing.get('pay-issue-1'))?.status).toBe('created');

      const record = await payment.invoicing.issue('pay-issue-1');
      expect(issueInvoice).toHaveBeenCalledOnce();
      expect(record.status).toBe('pending');
      expect(record.issuanceJobId).toBe('job-1');
      expect(onInvoiceIssued).not.toHaveBeenCalled();

      // Re-issuing a pending record checks the job instead of re-submitting
      await payment.invoicing.issue('pay-issue-1');
      expect(issueInvoice).toHaveBeenCalledOnce();
      expect(checkIssuance).toHaveBeenCalledWith('job-1');
    });

    it('marks issued only when the provider job confirms it', async () => {
      const issueInvoice = vi
        .fn()
        .mockResolvedValue({ status: 'pending', documentType: 'efatura', jobId: 'job-2' });
      const checkIssuance = vi.fn().mockResolvedValue({ status: 'issued' });
      const onInvoiceIssued = vi.fn();

      const payment = await paidPayment(issuingAdapter(issueInvoice, checkIssuance), {
        onInvoiceIssued,
      });
      const record = await payment.invoicing.issue('pay-issue-1');

      expect(record.status).toBe('issued');
      expect(record.documentType).toBe('efatura');
      expect(onInvoiceIssued).toHaveBeenCalledOnce();
    });

    it('surfaces issuance failure through the failure hook so retry can fire', async () => {
      const issueInvoice = vi.fn().mockRejectedValue(new Error('GIB connection refused'));
      const onInvoiceIssuanceFailed = vi.fn();

      const payment = await paidPayment(issuingAdapter(issueInvoice), {
        onInvoiceIssuanceFailed,
      });
      const record = await payment.invoicing.issue('pay-issue-1');

      expect(record.status).toBe('failed');
      expect(record.error).toContain('GIB connection refused');
      expect(onInvoiceIssuanceFailed).toHaveBeenCalledOnce();
      expect((await payment.invoicing.getFailed()).map((r) => r.paymentId)).toContain(
        'pay-issue-1'
      );
    });

    it('queues issuance in the background in auto mode', async () => {
      const issueInvoice = vi
        .fn()
        .mockResolvedValue({ status: 'pending', documentType: 'earsiv', jobId: 'job-auto' });
      const provider = new MockProvider();
      vi.spyOn(provider, 'createPayment').mockResolvedValue({
        status: PaymentStatus.SUCCESS,
        paymentId: 'pay-auto-1',
      });

      const payment = betterPayment({
        providers: { mock: provider },
        defaultProvider: 'mock',
        plugins: [
          invoicing({
            adapter: issuingAdapter(issueInvoice, vi.fn().mockResolvedValue({ status: 'pending' })),
            issuance: { pollAttempts: 1, pollIntervalMs: 0 },
          }),
        ],
      });

      await payment.createPayment(mockPaymentRequest);
      await vi.waitFor(async () => {
        expect(issueInvoice).toHaveBeenCalledOnce();
      });
      expect((await payment.invoicing.get('pay-auto-1'))?.status).toBe('pending');
    });
  });

  describe('pluggable store', () => {
    it('persists records through a custom async store instead of the memory Map', async () => {
      const rows = new Map<string, InvoicingRecord>();
      const setSpy = vi.fn();
      const customStore: InvoicingStore = {
        get: async (paymentId) => rows.get(paymentId),
        set: async (paymentId, record) => {
          setSpy(paymentId, record);
          rows.set(paymentId, record);
        },
        list: async () => [...rows.values()],
      };

      const mockAdapter: InvoicingAdapter = {
        name: 'mock-store-adapter',
        createInvoice: vi.fn().mockResolvedValue({ id: 'inv-stored', status: 'created' }),
      };

      const provider = new MockProvider();
      vi.spyOn(provider, 'createPayment').mockResolvedValue({
        status: PaymentStatus.SUCCESS,
        paymentId: 'pay-stored',
      });

      const payment = betterPayment({
        providers: { mock: provider },
        defaultProvider: 'mock',
        plugins: [invoicing({ adapter: mockAdapter, store: customStore })],
      });

      await payment.createPayment(mockPaymentRequest);

      expect(setSpy).toHaveBeenCalledWith(
        'pay-stored',
        expect.objectContaining({ invoiceId: 'inv-stored', status: 'created' })
      );
      expect(rows.get('pay-stored')?.invoiceId).toBe('inv-stored');
      expect((await payment.invoicing.get('pay-stored'))?.invoiceId).toBe('inv-stored');
      expect(await payment.invoicing.list()).toHaveLength(1);
    });
  });

  describe('parasut adapter', () => {
    it('rejects construction without the required password-grant credentials', () => {
      expect(() =>
        parasut({
          clientId: 'c',
          clientSecret: 's',
          companyId: '1',
        } as ParasutOptions)
      ).toThrow(ConfigurationError);
      expect(() =>
        parasut({ ...FAKE_CREDENTIALS, password: undefined } as unknown as ParasutOptions)
      ).toThrow(/password/);
      expect(() => parasut({ ...FAKE_CREDENTIALS, username: '   ' })).toThrow(/username/);
    });

    it('uses the password grant with the documented parameters and links contact and products', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/oauth/token')) {
          return jsonResponse(200, {
            access_token: 'fake-access-token',
            expires_in: 7200,
            refresh_token: 'fake-refresh-token',
          });
        }
        if (url.includes('/sales_invoices')) {
          return jsonResponse(201, {
            data: {
              id: '987654',
              type: 'sales_invoices',
              attributes: { invoice_no: 'PRS202600000009' },
            },
          });
        }
        return jsonResponse(404, { errors: [{ title: 'Not Found' }] });
      });

      const adapter = parasutWith({ fetch: mockFetch as unknown as typeof fetch });
      const result = await adapter.createInvoice(SALES_INVOICE_PARAMS);

      expect(result.id).toBe('987654');
      expect(result.invoiceNumber).toBe('PRS202600000009');

      const calls = collectCalls(mockFetch);
      const oauthBody = decodeURIComponent(
        calls.find((c) => c.url.includes('/oauth/token'))?.body ?? ''
      );
      expect(oauthBody).toContain('grant_type=password');
      expect(oauthBody).toContain('username=accounting@example.invalid');
      expect(oauthBody).toContain('redirect_uri=urn:ietf:wg:oauth:2.0:oob');

      const invoiceCall = calls.find((c) => c.url.endsWith('/sales_invoices'));
      const payload = JSON.parse(invoiceCall?.body ?? '{}');
      expect(payload.data.attributes.item_type).toBe('invoice');
      // net_total is read-only in Paraşüt and must not be sent
      expect(payload.data.attributes.net_total).toBeUndefined();
      expect(payload.data.attributes.currency).toBe('TRL');
      expect(payload.data.relationships.contact).toEqual({
        data: { type: 'contacts', id: '55001' },
      });
      expect(payload.data.relationships.details.data[0]).toEqual({
        type: 'sales_invoice_details',
        attributes: { quantity: 1, unit_price: 150, vat_rate: 20, description: 'Test Product' },
        relationships: { product: { data: { type: 'products', id: '77001' } } },
      });
    });

    it('requires the Paraşüt contact and product ids instead of dropping relationships', async () => {
      const mockFetch = vi.fn(async () =>
        jsonResponse(200, { access_token: 't', expires_in: 7200 })
      );
      const adapter = parasutWith({ fetch: mockFetch as unknown as typeof fetch });

      await expect(
        adapter.createInvoice({
          ...SALES_INVOICE_PARAMS,
          buyer: { name: 'Ahmet Yilmaz' },
        })
      ).rejects.toThrow(/contactId/);

      await expect(
        adapter.createInvoice({
          ...SALES_INVOICE_PARAMS,
          items: [{ name: 'No Product', unitPrice: '10' }],
        })
      ).rejects.toThrow(/productId/);
      // No request was ever sent with an invented relationship
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });

    it('refuses to invent invoice ids when Paraşüt returns no id', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/oauth/token')) {
          return jsonResponse(200, { access_token: 'fake-access-token', expires_in: 7200 });
        }
        return jsonResponse(201, { data: { attributes: {} } });
      });

      const adapter = parasutWith({ fetch: mockFetch as unknown as typeof fetch });
      await expect(adapter.createInvoice(SALES_INVOICE_PARAMS)).rejects.toThrow(/invoice id/);
    });

    it('cancels through the documented DELETE endpoint without a body', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/oauth/token')) {
          return jsonResponse(200, { access_token: 'fake-access-token', expires_in: 7200 });
        }
        return jsonResponse(200, { data: { id: '987654', attributes: {} } });
      });

      const adapter = parasutWith({ fetch: mockFetch as unknown as typeof fetch });
      await adapter.cancelInvoice?.('987654', 'customer returned the goods');

      const calls = collectCalls(mockFetch);
      const cancelCall = calls.find((c) => c.url.includes('/cancel'));
      expect(cancelCall?.method).toBe('DELETE');
      expect(cancelCall?.url).toContain('/v4/12345/sales_invoices/987654/cancel');
      expect(cancelCall?.body).toBeUndefined();
    });

    it('issues e-Fatura when the buyer has a registered inbox, e-Arşiv otherwise', async () => {
      const inboxFetch = vi.fn(async (url: string) => {
        if (url.includes('/oauth/token')) {
          return jsonResponse(200, { access_token: 'fake-access-token', expires_in: 7200 });
        }
        if (url.includes('/e_invoice_inboxes')) {
          return jsonResponse(200, {
            data: [
              {
                id: '1',
                type: 'e_invoice_inboxes',
                attributes: { vkn: '1234567890', e_invoice_address: 'VKN1234567890@pts.com.tr' },
              },
            ],
          });
        }
        if (url.includes('/e_invoices')) {
          return jsonResponse(201, {
            data: { id: 'job-500', type: 'trackable_jobs', attributes: { status: 'running' } },
          });
        }
        return jsonResponse(404, { errors: [{ title: 'Not Found' }] });
      });

      const efaturaAdapter = parasutWith({ fetch: inboxFetch as unknown as typeof fetch });
      const issuance = await efaturaAdapter.issueInvoice?.({
        invoiceId: '987654',
        buyer: SALES_INVOICE_PARAMS.buyer,
      });
      expect(issuance).toMatchObject({
        status: 'pending',
        documentType: 'efatura',
        jobId: 'job-500',
      });
      const invoiceBody = JSON.parse(
        collectCalls(inboxFetch).find((c) => c.url.includes('/e_invoices'))?.body ?? '{}'
      );
      expect(invoiceBody.data.relationships.invoice).toEqual({
        data: { type: 'sales_invoices', id: '987654' },
      });
      expect(invoiceBody.data.attributes.to).toBe('VKN1234567890@pts.com.tr');

      const archiveFetch = vi.fn(async (url: string) => {
        if (url.includes('/oauth/token')) {
          return jsonResponse(200, { access_token: 'fake-access-token', expires_in: 7200 });
        }
        if (url.includes('/e_invoice_inboxes')) {
          return jsonResponse(200, { data: [] });
        }
        if (url.includes('/e_archives')) {
          return jsonResponse(201, {
            data: { id: 'job-501', type: 'trackable_jobs', attributes: { status: 'running' } },
          });
        }
        return jsonResponse(404, { errors: [{ title: 'Not Found' }] });
      });

      const earsivAdapter = parasutWith({
        fetch: archiveFetch as unknown as typeof fetch,
        eArchiveInternetSaleUrl: 'https://shop.example.invalid',
      });
      const earsiv = await earsivAdapter.issueInvoice?.({
        invoiceId: '987655',
        buyer: { name: 'Ayse Demir' },
        paymentPlatform: 'iyzico',
        paymentDate: '2026-10-19',
      });
      expect(earsiv).toMatchObject({ status: 'pending', documentType: 'earsiv', jobId: 'job-501' });
      const archiveBody = JSON.parse(
        collectCalls(archiveFetch).find((c) => c.url.includes('/e_archives'))?.body ?? '{}'
      );
      expect(archiveBody.data.relationships.sales_invoice).toEqual({
        data: { type: 'sales_invoices', id: '987655' },
      });
      expect(archiveBody.data.attributes.internet_sale).toEqual({
        url: 'https://shop.example.invalid',
        payment_type: 'KREDIKARTI/BANKAKARTI',
        payment_platform: 'iyzico',
        payment_date: '2026-10-19',
      });
    });

    it('maps the trackable job status for checkIssuance', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/oauth/token')) {
          return jsonResponse(200, { access_token: 'fake-access-token', expires_in: 7200 });
        }
        if (url.includes('/trackable_jobs/done-job')) {
          return jsonResponse(200, {
            data: { id: 'done-job', type: 'trackable_jobs', attributes: { status: 'done' } },
          });
        }
        return jsonResponse(200, {
          data: {
            id: 'bad-job',
            type: 'trackable_jobs',
            attributes: { status: 'error', errors: ['GIB rejected the document'] },
          },
        });
      });

      const adapter = parasutWith({ fetch: mockFetch as unknown as typeof fetch });
      await expect(adapter.checkIssuance?.('done-job')).resolves.toEqual({ status: 'issued' });
      await expect(adapter.checkIssuance?.('bad-job')).resolves.toMatchObject({
        status: 'failed',
        error: 'GIB rejected the document',
      });
    });

    it('creates return invoices with the documented refund item type via the same builder', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/oauth/token')) {
          return jsonResponse(200, { access_token: 'fake-access-token', expires_in: 7200 });
        }
        return jsonResponse(201, {
          data: { id: '987660', type: 'sales_invoices', attributes: {} },
        });
      });

      const adapter = parasutWith({ fetch: mockFetch as unknown as typeof fetch });
      const result = await adapter.createReturnInvoice?.('987654', SALES_INVOICE_PARAMS);
      expect(result?.id).toBe('987660');

      const body = JSON.parse(
        collectCalls(mockFetch).find((c) => c.url.endsWith('/sales_invoices'))?.body ?? '{}'
      );
      expect(body.data.attributes.item_type).toBe('refund');
      expect(body.data.attributes.description).toContain('Return for invoice 987654');
      expect(body.data.relationships.contact.data.id).toBe('55001');
    });

    it('rejects unusable token responses instead of caching garbage', async () => {
      const mockFetch = vi.fn(async () => jsonResponse(200, { expires_in: 7200 }));
      const adapter = parasutWith({ fetch: mockFetch as unknown as typeof fetch });
      await expect(adapter.createInvoice(SALES_INVOICE_PARAMS)).rejects.toThrow(/access_token/);
    });
  });
});
