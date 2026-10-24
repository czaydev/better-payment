import { describe, it, expect, vi } from 'vitest';
import { betterPayment, PaymentStatus, Currency } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { currencyConversion } from '../../../src/plugins/currency-conversion';
import { mockPaymentRequest, mockRefundRequest } from '../../fixtures/payment-data';

const MOCK_TCMB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="18.10.2026" Date="10/18/2026">
  <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
    <Unit>1</Unit>
    <Isim>ABD DOLARI</Isim>
    <CurrencyName>US DOLLAR</CurrencyName>
    <ForexBuying>34.0000</ForexBuying>
    <ForexSelling>34.5000</ForexSelling>
    <BanknoteBuying>33.8000</BanknoteBuying>
    <BanknoteSelling>34.7000</BanknoteSelling>
  </Currency>
  <Currency CrossOrder="1" Kod="EUR" CurrencyCode="EUR">
    <Unit>1</Unit>
    <Isim>EURO</Isim>
    <CurrencyName>EURO</CurrencyName>
    <ForexBuying>37.0000</ForexBuying>
    <ForexSelling>37.5000</ForexSelling>
    <BanknoteBuying>36.8000</BanknoteBuying>
    <BanknoteSelling>37.8000</BanknoteSelling>
  </Currency>
</Tarih_Date>`;

function createMockFetch(xml = MOCK_TCMB_XML) {
  let callCount = 0;
  const fn = vi.fn(async () => {
    callCount++;
    return new Response(xml, { status: 200 });
  });
  return {
    fetch: fn as unknown as typeof globalThis.fetch,
    getCallCount: () => callCount,
  };
}

describe('currencyConversion plugin', () => {
  it('parses TCMB XML and calculates exchange rates and fx quotes', async () => {
    const { fetch, getCallCount } = createMockFetch();
    const plugin = currencyConversion({
      fetch,
      rate: 'forex-selling',
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
    });

    // USD to TRY rate: 34.5
    const quote = await payment.fx.quote({ amount: 100, from: 'USD', to: 'TRY' });
    expect(quote.amount).toBe(100);
    expect(quote.convertedAmount).toBe(3450);
    expect(quote.exchangeRate).toBe(34.5);
    expect(quote.from).toBe('USD');
    expect(quote.to).toBe('TRY');
    expect(getCallCount()).toBe(1);

    // Cached call should not fetch again
    const rate = await payment.fx.getRate('USD', 'TRY');
    expect(rate).toBe(34.5);
    expect(getCallCount()).toBe(1);
  });

  it('supports markup percentage margin', async () => {
    const { fetch } = createMockFetch();
    const plugin = currencyConversion({
      fetch,
      rate: 'forex-selling', // 34.5
      markup: 0.01, // +1% -> 34.5 * 1.01 = 34.845
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
    });

    const quote = await payment.fx.quote({ amount: 100, from: 'USD', to: 'TRY' });
    expect(quote.exchangeRate).toBeCloseTo(34.845, 4);
    expect(quote.convertedAmount).toBe(3484.5);
  });

  it('converts payment request when provider does not accept request currency', async () => {
    const { fetch } = createMockFetch();
    const plugin = currencyConversion({
      fetch,
      target: {
        mock: 'TRY', // mock provider only accepts TRY
      },
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
    });

    const request = {
      ...mockPaymentRequest,
      price: '50.00',
      paidPrice: '50.00',
      currency: Currency.USD,
      basketItems: [
        { id: '1', name: 'Item 1', price: '20.00', category1: 'C1', itemType: 'PHYSICAL' },
        { id: '2', name: 'Item 2', price: '30.00', category1: 'C2', itemType: 'PHYSICAL' },
      ],
      conversationId: 'order-conv-123',
    };

    const result = await payment.mock.createPayment(request);

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    // Rate is 34.5 -> 50 * 34.5 = 1725.00 TRY
    expect((result as any).originalAmount).toBe('50.00');
    expect((result as any).originalCurrency).toBe('USD');
    expect((result as any).exchangeRate).toBe(34.5);
  });

  it('skips conversion when provider already supports the currency', async () => {
    const { fetch, getCallCount } = createMockFetch();
    const plugin = currencyConversion({
      fetch,
      target: {
        mock: ['USD', 'TRY'], // supports both USD and TRY
      },
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
    });

    const request = {
      ...mockPaymentRequest,
      price: '50.00',
      paidPrice: '50.00',
      currency: Currency.USD,
    };

    const result = await payment.mock.createPayment(request);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    // Did not need to fetch or convert
    expect((result as any).originalCurrency).toBeUndefined();
    expect(getCallCount()).toBe(0);
  });

  it('preserves the original exchange rate during refunds instead of using new rate', async () => {
    let currentXml = MOCK_TCMB_XML;
    const fetchFn = vi.fn(async () => new Response(currentXml, { status: 200 }));

    const plugin = currencyConversion({
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      target: { mock: 'TRY' },
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
    });

    // 1. Initial payment in USD at 34.5 rate
    const payResult = await payment.mock.createPayment({
      ...mockPaymentRequest,
      price: '100.00',
      paidPrice: '100.00',
      currency: Currency.USD,
      conversationId: 'order-refund-test',
    });
    expect(payResult.status).toBe(PaymentStatus.SUCCESS);

    // 2. Clear cache and simulate exchange rate jumping to 40.0 tomorrow
    payment.fx.clearCache();
    currentXml = MOCK_TCMB_XML.replace('<ForexSelling>34.5000</ForexSelling>', '<ForexSelling>40.0000</ForexSelling>');

    // 3. Issue a refund for the order in the customer's currency (USD)
    const refundResult = await payment.mock.refund({
      ...mockRefundRequest,
      paymentId: payResult.paymentId!,
      price: '50.00', // partial refund of 50 USD
      currency: Currency.USD,
      conversationId: 'order-refund-test',
    });

    expect(refundResult.status).toBe(PaymentStatus.SUCCESS);
    // Must use original 34.5 rate -> 50 * 34.5 = 1725 TRY, NOT 50 * 40 = 2000 TRY!
    expect((refundResult as any).exchangeRate).toBe(34.5);
    expect((refundResult as any).originalAmount).toBe('50.00');
    expect((refundResult as any).originalCurrency).toBe('USD');
  });

  it('supports custom rate source function', async () => {
    const plugin = currencyConversion({
      source: async (from, to) => {
        if (from === 'EUR' && to === 'TRY') return 36.8;
        return 1;
      },
      target: { mock: 'TRY' },
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
    });

    const quote = await payment.fx.quote({ amount: 10, from: 'EUR', to: 'TRY' });
    expect(quote.convertedAmount).toBe(368);
    expect(quote.exchangeRate).toBe(36.8);
  });

  it('calculates cross rates between foreign currencies (EUR to USD)', async () => {
    const { fetch } = createMockFetch();
    const plugin = currencyConversion({
      fetch,
      rate: 'forex-selling', // EUR: 37.5, USD: 34.5
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
    });

    // 100 EUR in USD: 100 * (37.5 / 34.5) = 108.6956... -> 108.70
    const quote = await payment.fx.quote({ amount: 100, from: 'EUR', to: 'USD' });
    expect(quote.convertedAmount).toBe(108.7);
    expect(quote.exchangeRate).toBeCloseTo(37.5 / 34.5, 4);
  });

  it('preserves kuruş sum equality across converted basket items', async () => {
    const { fetch } = createMockFetch();
    const plugin = currencyConversion({
      fetch,
      target: { mock: 'TRY' },
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
    });

    // 3 items with prices that don't convert neatly
    const request = {
      ...mockPaymentRequest,
      price: '10.00',
      paidPrice: '10.00',
      currency: Currency.USD,
      basketItems: [
        { id: '1', name: 'Item 1', price: '3.33', category1: 'C1', itemType: 'PHYSICAL' },
        { id: '2', name: 'Item 2', price: '3.33', category1: 'C2', itemType: 'PHYSICAL' },
        { id: '3', name: 'Item 3', price: '3.34', category1: 'C3', itemType: 'PHYSICAL' },
      ],
    };

    const spy = vi.spyOn(payment.mock, 'createPayment');
    await payment.mock.createPayment(request);

    const calledRequest = spy.mock.calls[0][0];
    expect(calledRequest.currency).toBe('TRY');
    expect(calledRequest.price).toBe('345.00'); // 10 * 34.5

    const sumBasket = calledRequest.basketItems!.reduce((acc, item) => acc + Number(item.price), 0);
    expect(sumBasket).toBeCloseTo(345.0, 2);
  });

  it('supports banknote rate types', async () => {
    const { fetch } = createMockFetch();
    const plugin = currencyConversion({
      fetch,
      rate: 'banknote-selling', // BanknoteSelling for USD is 34.7
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
    });

    const quote = await payment.fx.quote({ amount: 100, from: 'USD', to: 'TRY' });
    expect(quote.exchangeRate).toBe(34.7);
    expect(quote.convertedAmount).toBe(3470);
  });
});

