import { describe, it, expect, vi } from 'vitest';
import { ConfigurationError, hmac, toBase64 } from 'better-payment';
import {
  akbankReconciliation,
  iyzicoReconciliation,
  paramposReconciliation,
  paytrReconciliation,
  ReconciliationError,
} from 'better-payment/reconciliation';

/**
 * Every fixture below follows the shape documented on the provider's own site
 * or integration repository (linked in each source's header). None of them is a
 * live-sandbox recording: the sources have not been exercised against a real
 * merchant account in this environment.
 */
type FetchCall = { url: string; init: RequestInit };

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const config = init ?? {};
    calls.push({ url, init: config });
    return handler(url, config);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const text = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/xml' } });

describe('paytrReconciliation', () => {
  it('signs each 3-day window and normalizes the documented sale and return fields', async () => {
    const saleRow = {
      islem_tipi: 'S',
      siparis_no: 'ORD-1',
      odeme_tutari: '100.50',
      kesinti_tutari: '2.10',
      para_birimi: 'TL',
      islem_tarihi: '01.10.2026 10:00:00',
    };
    const refundRow = {
      islem_tipi: 'I',
      siparis_no: 'ORD-1',
      odeme_tutari: '100,50',
      kesinti_tutari: '0',
      para_birimi: 'TRY',
      islem_tarihi: '04.10.2026 11:00:00',
    };
    const { fetch, calls } = mockFetch((_url, init) => {
      const form = new URLSearchParams(String(init.body));
      const start = form.get('start_date') ?? '';
      // The sale row is delivered again in the second window: one entry only.
      return json({
        status: 'success',
        data: start.startsWith('2026-10-04') ? [saleRow, refundRow] : [saleRow],
      });
    });

    const source = paytrReconciliation({
      merchantId: '123456',
      merchantKey: 'merchant-key',
      merchantSalt: 'merchant-salt',
      fetch,
    });
    const rows = await source.listTransactions({ from: '2026-10-01', to: '2026-10-04' });

    expect(calls).toHaveLength(2);
    const first = new URLSearchParams(String(calls[0].init.body));
    expect(calls[0].url).toBe('https://www.paytr.com/rapor/islem-dokumu');
    expect(first.get('merchant_id')).toBe('123456');
    expect(first.get('start_date')).toBe('2026-10-01 00:00:00');
    expect(first.get('end_date')).toBe('2026-10-03 23:59:59');
    const signed = '1234562026-10-01 00:00:002026-10-03 23:59:59merchant-salt';
    expect(first.get('paytr_token')).toBe(toBase64(await hmac('SHA-256', 'merchant-key', signed)));
    expect(new URLSearchParams(String(calls[1].init.body)).get('start_date')).toBe(
      '2026-10-04 00:00:00'
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      provider: 'paytr',
      transactionId: 'paytr|ORD-1|01.10.2026 10:00:00|S|100.50',
      orderId: 'ORD-1',
      type: 'sale',
      amount: '100.50',
      fee: '2.10',
      currency: 'TRY',
      status: 'success',
      date: '2026-10-01T10:00:00',
    });
    expect(rows[1]).toMatchObject({
      transactionId: 'paytr|ORD-1|04.10.2026 11:00:00|I|100.50',
      type: 'refund',
      amount: '100.50',
      status: 'success',
      date: '2026-10-04T11:00:00',
    });
  });

  it('treats the documented "failed" report status as an empty day', async () => {
    const { fetch } = mockFetch(() => json({ status: 'failed' }));
    const source = paytrReconciliation({
      merchantId: '1',
      merchantKey: 'k',
      merchantSalt: 's',
      fetch,
    });
    await expect(
      source.listTransactions({ from: '2026-10-01', to: '2026-10-01' })
    ).resolves.toEqual([]);
  });

  it('raises the error code without leaking the response body', async () => {
    const { fetch } = mockFetch(() =>
      json({ status: 'error', err_no: '006', err_msg: 'MERCHANT-SECRET-DETAIL' })
    );
    const source = paytrReconciliation({
      merchantId: '1',
      merchantKey: 'k',
      merchantSalt: 's',
      fetch,
    });
    const error = await source
      .listTransactions({ from: '2026-10-01', to: '2026-10-01' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReconciliationError);
    expect((error as Error).message).toContain('006');
    expect((error as Error).message).not.toContain('MERCHANT-SECRET-DETAIL');
  });

  it('rejects incomplete configuration', () => {
    expect(() =>
      paytrReconciliation({ merchantId: '1', merchantKey: '', merchantSalt: 's' })
    ).toThrow(ConfigurationError);
  });
});

describe('iyzicoReconciliation', () => {
  const row = (overrides: Record<string, unknown>) => ({
    transactionType: 'PAYMENT',
    transactionCurrency: 'TRY',
    transactionDate: '2026-10-19 10:00:00',
    transactionStatus: '2',
    conversationId: 'ORD-1',
    ...overrides,
  });

  it('pages a day, signs with IYZWSv2 and sums basket-item rows per payment id', async () => {
    const { fetch, calls } = mockFetch((url) => {
      const page = new URL(url).searchParams.get('page');
      if (page === '1') {
        return json({
          status: 'success',
          currentPage: '1',
          totalPageCount: '2',
          transactions: [
            row({
              transactionId: 'item-1',
              paymentId: 'pay-1',
              paidPrice: '100.00',
              iyzicoFee: '2.00',
            }),
            row({
              transactionId: 'item-2',
              paymentId: 'pay-1',
              paidPrice: '50.25',
              iyzicoFee: '1.00',
            }),
          ],
        });
      }
      return json({
        status: 'success',
        currentPage: '2',
        totalPageCount: '2',
        transactions: [
          row({
            transactionId: 'item-3',
            paymentId: 'pay-1',
            paidPrice: '25.25',
            iyzicoFee: '0.50',
          }),
        ],
      });
    });

    const source = iyzicoReconciliation({
      apiKey: 'api-key',
      secretKey: 'secret-key',
      mode: 'sandbox',
      statusMap: { '2': 'success' },
      fetch,
    });
    const rows = await source.listTransactions({ from: '2026-10-19', to: '2026-10-19' });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(
      'https://sandbox-api.iyzipay.com/v2/reporting/payment/transactions?transactionDate=2026-10-19&page=1'
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^IYZWSv2 /);
    expect(headers['x-iyzi-rnd']).toBeTruthy();
    expect(calls[0].init.body).toBeUndefined();

    expect(rows).toEqual([
      {
        provider: 'iyzico',
        transactionId: 'pay-1:sale',
        orderId: 'ORD-1',
        type: 'sale',
        amount: '175.50',
        fee: '3.50',
        currency: 'TRY',
        status: 'success',
        date: '2026-10-19T10:00:00',
      },
    ]);
  });

  it('marks undocumented status codes unknown unless statusMap maps them', async () => {
    const body = {
      status: 'success',
      currentPage: '1',
      totalPageCount: '1',
      transactions: [row({ transactionId: 'item-1', paymentId: 'pay-1', paidPrice: '10.00' })],
    };
    const unknown = mockFetch(() => json(body));
    const source = iyzicoReconciliation({
      apiKey: 'k',
      secretKey: 's',
      fetch: unknown.fetch,
    });
    const rows = await source.listTransactions({ from: '2026-10-19', to: '2026-10-19' });
    expect(rows[0].status).toBe('unknown');

    const mapped = mockFetch(() => json(body));
    const sourceWithMap = iyzicoReconciliation({
      apiKey: 'k',
      secretKey: 's',
      statusMap: { '2': 'success' },
      aggregateByPayment: false,
      fetch: mapped.fetch,
    });
    const raw = await sourceWithMap.listTransactions({ from: '2026-10-19', to: '2026-10-19' });
    expect(raw[0]).toMatchObject({
      transactionId: 'item-1',
      amount: '10.00',
      status: 'success',
    });
  });

  it('reports the provider error code without the response body', async () => {
    const { fetch } = mockFetch(() =>
      json({ status: 'failure', errorCode: '5001', errorMessage: 'CUSTOMER-DETAIL' })
    );
    const source = iyzicoReconciliation({ apiKey: 'k', secretKey: 's', fetch });
    const error = await source
      .listTransactions({ from: '2026-10-19', to: '2026-10-19' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReconciliationError);
    expect((error as Error).message).toContain('5001');
    expect((error as Error).message).not.toContain('CUSTOMER-DETAIL');
  });

  it('rejects incomplete configuration', () => {
    expect(() => iyzicoReconciliation({ apiKey: '', secretKey: 's' })).toThrow(ConfigurationError);
  });
});

describe('akbankReconciliation', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    bankId: 'B-1',
    orderId: 'ORD-1',
    amount: 100.5,
    merchantFee: 2.1,
    currencyLabel: 'TRY',
    txnDateTime: '2026-10-19T10:00:00.000',
    txnCode: '1000',
    txnStatus: 'Başarılı',
    ...overrides,
  });

  const config = (fetch: typeof globalThis.fetch) => ({
    merchantSafeId: 'merchant-safe',
    terminalSafeId: 'terminal-safe',
    secretKey: 'secret-key',
    baseUrl: 'https://akbank.test',
    fetch,
  });

  it('sends txnCode 1009 with an auth-hash and normalizes history rows', async () => {
    const { fetch, calls } = mockFetch(() =>
      json({
        responseCode: 'VPS-0000',
        data: {
          txnDetailList: [
            row(),
            row({
              bankId: 'B-2',
              orderId: 'ORD-2',
              amount: 50,
              txnCode: '1002',
              txnStatus: undefined,
              responseCode: 'VPS-0001',
            }),
          ],
        },
      })
    );
    const source = akbankReconciliation(config(fetch));
    const rows = await source.listTransactions({ from: '2026-10-19', to: '2026-10-19' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://akbank.test/transaction/process');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      version: '1.00',
      txnCode: '1009',
      terminal: { merchantSafeId: 'merchant-safe', terminalSafeId: 'terminal-safe' },
      report: {
        startDateTime: '2026-10-19T00:00:00.000',
        endDateTime: '2026-10-19T23:59:59.999',
      },
    });
    expect((calls[0].init.headers as Record<string, string>)['auth-hash']).toBe(
      toBase64(await hmac('SHA-512', 'secret-key', String(calls[0].init.body)))
    );

    expect(rows[0]).toEqual({
      provider: 'akbank',
      transactionId: 'B-1',
      orderId: 'ORD-1',
      type: 'sale',
      amount: '100.50',
      fee: '2.10',
      currency: 'TRY',
      status: 'success',
      date: '2026-10-19T10:00:00',
    });
    expect(rows[1]).toMatchObject({
      transactionId: 'B-2',
      type: 'refund',
      amount: '50.00',
      status: 'failure',
    });
  });

  it('requests one window per day and continues a VPS-2235 day by batch number', async () => {
    const { fetch, calls } = mockFetch((_url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.report.startDateTime === '2026-10-20T00:00:00.000') {
        return json({
          responseCode: 'VPS-0000',
          data: { txnDetailList: [row({ bankId: 'B-3' })] },
        });
      }
      if (body.report.batchNumber === undefined) {
        return json({ responseCode: 'VPS-2235' });
      }
      return json({ responseCode: 'VPS-0000', data: { txnDetailList: [row()] } });
    });
    const source = akbankReconciliation({ ...config(fetch), batchStep: 1 });
    const rows = await source.listTransactions({ from: '2026-10-19', to: '2026-10-20' });

    // Day 1 is retried with batch 1; day 2 needs its own first request.
    expect(calls).toHaveLength(3);
    expect(JSON.parse(String(calls[0].init.body)).report.batchNumber).toBeUndefined();
    expect(JSON.parse(String(calls[1].init.body)).report.batchNumber).toBe(1);
    expect(JSON.parse(String(calls[2].init.body)).report.startDateTime).toBe(
      '2026-10-20T00:00:00.000'
    );
    expect(rows).toHaveLength(2);
  });

  it('refuses to silently truncate a day when VPS-2235 is not handled', async () => {
    const { fetch } = mockFetch(() => json({ responseCode: 'VPS-2235' }));
    const source = akbankReconciliation(config(fetch));
    await expect(source.listTransactions({ from: '2026-10-19', to: '2026-10-19' })).rejects.toThrow(
      /VPS-2235/
    );
  });

  it('rejects incomplete configuration', () => {
    expect(() =>
      akbankReconciliation({ merchantSafeId: '', terminalSafeId: 't', secretKey: 's' })
    ).toThrow(ConfigurationError);
  });
});

describe('paramposReconciliation', () => {
  const envelope = (body: string) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    `<TP_Islem_IzlemeResponse xmlns="https://turkpos.com.tr/"><TP_Islem_IzlemeResult>${body}` +
    '</TP_Islem_IzlemeResult></TP_Islem_IzlemeResponse></soap:Body></soap:Envelope>';

  const soapRows = envelope(
    '<Sonuc>1</Sonuc><Sonuc_Str>Başarılı</Sonuc_Str><DT_Bilgi><diffgr:diffgram><NewDataSet>' +
      '<Temp><SanalPOS_Islem_ID>1001</SanalPOS_Islem_ID><ORJ_ORDER_ID>ORD-1</ORJ_ORDER_ID>' +
      '<Tip_Str>Satış</Tip_Str><Tarih>01.10.2026 10:00:00</Tarih><Tutar>100,50</Tutar>' +
      '<Komisyon_Tutar>2,10</Komisyon_Tutar><PB>949</PB><Sonuc>1</Sonuc>' +
      '<Sonuc_Str>Başarılı</Sonuc_Str></Temp>' +
      '<Temp><SanalPOS_Islem_ID>1002</SanalPOS_Islem_ID><ORJ_ORDER_ID>ORD-1</ORJ_ORDER_ID>' +
      '<Tip_Str>İade</Tip_Str><Tarih>02.10.2026 12:00:00</Tarih><Tutar>100,50</Tutar>' +
      '<PB>TRY</PB><Sonuc>1</Sonuc><Sonuc_Str>Başarılı</Sonuc_Str></Temp>' +
      '</NewDataSet></diffgr:diffgram></DT_Bilgi>'
  );

  const config = (fetch: typeof globalThis.fetch) => ({
    clientCode: 'client-code',
    clientUsername: 'client-user',
    clientPassword: 'client-pass',
    guid: 'merchant-guid',
    baseUrl: 'https://param.test/service.asmx',
    fetch,
  });

  it('sends the documented TP_Islem_Izleme window and normalizes dotted dates and commas', async () => {
    const { fetch, calls } = mockFetch(() => text(soapRows));
    const source = paramposReconciliation(config(fetch));
    const rows = await source.listTransactions({ from: '2026-10-01', to: '2026-10-02' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://param.test/service.asmx');
    expect((calls[0].init.headers as Record<string, string>).SOAPAction).toBe(
      'https://turkpos.com.tr/TP_Islem_Izleme'
    );
    const xml = String(calls[0].init.body);
    expect(xml).toContain('<TP_Islem_Izleme');
    expect(xml).toContain('<Tarih_Bas>01.10.2026 00:00:00</Tarih_Bas>');
    expect(xml).toContain('<Tarih_Bit>02.10.2026 23:59:59</Tarih_Bit>');

    expect(rows).toEqual([
      {
        provider: 'parampos',
        transactionId: '1001',
        orderId: 'ORD-1',
        type: 'sale',
        amount: '100.50',
        fee: '2.10',
        currency: 'TRY',
        status: 'success',
        date: '2026-10-01T10:00:00',
      },
      {
        provider: 'parampos',
        transactionId: '1002',
        orderId: 'ORD-1',
        type: 'refund',
        amount: '100.50',
        currency: 'TRY',
        status: 'success',
        date: '2026-10-02T12:00:00',
      },
    ]);
  });

  it('throws a result code instead of returning an empty day on failure', async () => {
    const { fetch } = mockFetch(() =>
      text(envelope('<Sonuc>0</Sonuc><Sonuc_Str>Başarısız</Sonuc_Str>'))
    );
    const source = paramposReconciliation(config(fetch));
    await expect(source.listTransactions({ from: '2026-10-01', to: '2026-10-01' })).rejects.toThrow(
      /Sonuc 0/
    );
  });

  it('rejects incomplete configuration', () => {
    expect(() =>
      paramposReconciliation({
        clientCode: 'c',
        clientUsername: 'u',
        clientPassword: '',
        guid: 'g',
      })
    ).toThrow(ConfigurationError);
  });
});
