import { createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { PayTR } from '../../../../src/providers/paytr';
import { PaymentStatus } from '../../../../src/types';
import { mockThreeDSPaymentRequest } from '../../../fixtures/payment-data';

const config = {
  merchantId: '123456',
  merchantKey: 'test-key',
  merchantSalt: 'test-salt',
  testMode: true,
};

// Include characters that must survive both URL encoding and HTML attributes,
// including a literal entity that must not be decoded twice.
const productName = `Türkçe "çay" & <ürün> 'özel' &quot;`;
const request = {
  ...mockThreeDSPaymentRequest,
  conversationId: 'BASKET1',
  basketItems: mockThreeDSPaymentRequest.basketItems.map((item, index) =>
    index === 0 ? { ...item, name: productName, quantity: 2 } : { ...item }
  ),
};
const expectedBasket = [
  [productName, '0.30', 2],
  ['Game code', '0.50', 1],
  ['Usb', '0.20', 1],
];
const expectedJson = JSON.stringify(expectedBasket);
const storedCard = { customerToken: 'U1', cardToken: 'C1' };

function setup(threeDSMode?: 'iframe' | 'direct') {
  const paytr = new PayTR({ ...config, threeDSMode });
  // Mock the transport for every case, including browser-only form generation.
  const post = vi.spyOn(paytr['client'], 'post').mockResolvedValue({
    data: { status: 'success', token: 'IFRAME1' },
  });
  return { paytr, post };
}

function htmlBasket(html: string): string {
  const value = html.match(/name="user_basket" value="([^"]*)"/)?.[1];
  expect(value).toBeDefined();
  // Equivalent to one HTML attribute decoding pass, not recursive decoding.
  return value!.replace(/&(quot|#39|lt|gt|amp);/g, (entity) => {
    const decoded: Record<string, string> = {
      '&quot;': '"',
      '&#39;': "'",
      '&lt;': '<',
      '&gt;': '>',
      '&amp;': '&',
    };
    return decoded[entity];
  });
}

function expectJsonBasket(value: string) {
  expect(value).toBe(expectedJson);
  expect(JSON.parse(value)).toEqual(expectedBasket);
}

describe('PayTR endpoint-specific basket encoding', () => {
  it('posts JSON from the new-card Direct 3DS browser form', async () => {
    const { paytr, post } = setup('direct');
    const result = await paytr.initThreeDSPayment(request);

    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.threeDSHtmlContent).toContain('action="https://www.paytr.com/odeme"');
    expect(result.threeDSHtmlContent).toContain('&lt;ürün&gt;');
    expectJsonBasket(htmlBasket(result.threeDSHtmlContent!));
    expect(post).not.toHaveBeenCalled();
  });

  it('posts JSON from the stored-card Direct 3DS browser form', async () => {
    const { paytr, post } = setup();
    const result = await paytr.createPaymentWithToken({
      utoken: storedCard.customerToken,
      ctoken: storedCard.cardToken,
      price: request.paidPrice!,
      callbackUrl: request.callbackUrl,
      conversationId: request.conversationId,
      buyer: request.buyer,
      basketItems: request.basketItems,
    });

    expect(result.status).toBe(PaymentStatus.PENDING);
    expectJsonBasket(htmlBasket(result.threeDSHtmlContent!));
    expect(post).not.toHaveBeenCalled();
  });

  it('uses Direct JSON when the unified 3DS method receives a stored card', async () => {
    const { paytr, post } = setup();
    const result = await paytr.initThreeDSPayment({
      ...request,
      paymentCard: undefined,
      storedCard,
    });

    expect(result.status).toBe(PaymentStatus.PENDING);
    expectJsonBasket(htmlBasket(result.threeDSHtmlContent!));
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['new', 'stored'] as const)('sends JSON for non-3D %s-card payments', async (card) => {
    const { paytr, post } = setup();
    const result = await paytr.createPayment({
      ...request,
      ...(card === 'stored' ? { paymentCard: undefined, storedCard } : {}),
    });

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/odeme');
    const form = new URLSearchParams(post.mock.calls[0][1] as string);
    expectJsonBasket(form.get('user_basket')!);
  });

  it.each([undefined, 'iframe'] as const)(
    'preserves Base64 JSON and its signed value for iFrame mode %s',
    async (mode) => {
      const { paytr, post } = setup(mode);
      const result = await paytr.initThreeDSPayment(request);

      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][0]).toBe('/odeme/api/get-token');
      const form = Object.fromEntries(new URLSearchParams(post.mock.calls[0][1] as string));
      const expectedBase64 = Buffer.from(expectedJson, 'utf8').toString('base64');
      expect(form.user_basket).toBe(expectedBase64);
      expect(JSON.parse(Buffer.from(form.user_basket, 'base64').toString('utf8'))).toEqual(
        expectedBasket
      );

      // Independent reference calculation: sign the same Base64 string sent to PayTR.
      const signatureInput =
        config.merchantId +
        request.buyer.ip +
        request.conversationId +
        request.buyer.email +
        '120' +
        expectedBase64 +
        '0' +
        '0' +
        'TL' +
        '1' +
        config.merchantSalt;
      expect(form.paytr_token).toBe(
        createHmac('sha256', config.merchantKey).update(signatureInput).digest('base64')
      );
    }
  );
});
