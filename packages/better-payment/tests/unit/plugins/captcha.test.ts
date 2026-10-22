import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  ProviderType,
  PaymentStatus,
  type PaymentResponse,
} from '../../../src';
import { MockProvider } from '../../../src/testing';
import { captcha, type CaptchaOptions } from '../../../src/plugins/captcha';
import { mockPaymentRequest } from '../../fixtures/payment-data';

function createMockFetch(responseBody: Record<string, unknown>, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(responseBody),
  } as unknown as Response);
}

function buildPayment(captchaOpts: Partial<CaptchaOptions>) {
  const mockProvider = new MockProvider();
  const plugin = captcha({
    provider: 'cloudflare-turnstile',
    secretKey: 'mock-secret-key',
    ...captchaOpts,
  });

  const payment = betterPayment({
    providers: {
      [ProviderType.MOCK]: mockProvider,
    },
    defaultProvider: ProviderType.MOCK,
    plugins: [plugin],
  });

  return { payment, mockProvider };
}

describe('captcha plugin', () => {
  it('throws on invalid configuration', () => {
    expect(() => captcha({} as any)).toThrow('invalid or missing provider');
    expect(() => captcha({ provider: 'invalid' as any, secretKey: 'sec' })).toThrow('invalid or missing provider');
    expect(() => captcha({ provider: 'cloudflare-turnstile', secretKey: '' })).toThrow('secretKey is required');
  });

  it('fails with CAPTCHA_MISSING when no token is present', async () => {
    const mockFetch = createMockFetch({ success: true });
    const { payment, mockProvider } = buildPayment({ fetch: mockFetch });
    const providerSpy = vi.spyOn(mockProvider, 'createPayment');

    const result = await payment.createPayment({
      ...mockPaymentRequest,
    });

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect((result as any).errorCode).toBe('CAPTCHA_MISSING');
    expect((result as any).errorMessage).toBe('Captcha token is required');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('verifies Cloudflare Turnstile token successfully', async () => {
    const mockFetch = createMockFetch({ success: true });
    const { payment, mockProvider } = buildPayment({
      provider: 'cloudflare-turnstile',
      secretKey: 'cf-secret',
      fetch: mockFetch,
    });
    const providerSpy = vi.spyOn(mockProvider, 'createPayment');

    const result = await payment.createPayment({
      ...mockPaymentRequest,
      captchaToken: 'valid-turnstile-token',
    } as any);

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('response=valid-turnstile-token'),
      })
    );
    expect(providerSpy).toHaveBeenCalledTimes(1);
  });

  it('fails with CAPTCHA_INVALID when Turnstile verification fails', async () => {
    const mockFetch = createMockFetch({
      success: false,
      'error-codes': ['invalid-input-response'],
    });
    const { payment, mockProvider } = buildPayment({
      provider: 'cloudflare-turnstile',
      fetch: mockFetch,
    });
    const providerSpy = vi.spyOn(mockProvider, 'createPayment');

    const result = await payment.createPayment({
      ...mockPaymentRequest,
      captchaToken: 'bad-token',
    } as any);

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect((result as any).errorCode).toBe('CAPTCHA_INVALID');
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('verifies Google reCAPTCHA v3 with score threshold', async () => {
    // 1. Success with score 0.9 >= 0.5
    const successFetch = createMockFetch({ success: true, score: 0.9 });
    const { payment: p1 } = buildPayment({
      provider: 'google-recaptcha',
      minScore: 0.5,
      fetch: successFetch,
    });

    const res1 = await p1.createPayment({
      ...mockPaymentRequest,
      'g-recaptcha-response': 'token-high-score',
    } as any);
    expect(res1.status).toBe(PaymentStatus.SUCCESS);

    // 2. Failure with score 0.3 < 0.5
    const lowScoreFetch = createMockFetch({ success: true, score: 0.3 });
    const { payment: p2, mockProvider } = buildPayment({
      provider: 'google-recaptcha',
      minScore: 0.5,
      fetch: lowScoreFetch,
    });
    const spy = vi.spyOn(mockProvider, 'createPayment');

    const res2 = await p2.createPayment({
      ...mockPaymentRequest,
      'g-recaptcha-response': 'token-bot-score',
    } as any);
    expect(res2.status).toBe(PaymentStatus.FAILURE);
    expect((res2 as any).errorCode).toBe('CAPTCHA_INVALID');
    expect(spy).not.toHaveBeenCalled();
  });

  it('verifies hCaptcha tokens', async () => {
    const mockFetch = createMockFetch({ success: true });
    const { payment } = buildPayment({
      provider: 'hcaptcha',
      secretKey: 'hcaptcha-secret',
      fetch: mockFetch,
    });

    const res = await payment.createPayment({
      ...mockPaymentRequest,
      'h-captcha-response': 'valid-hcaptcha-token',
    } as any);

    expect(res.status).toBe(PaymentStatus.SUCCESS);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.hcaptcha.com/siteverify',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('response=valid-hcaptcha-token'),
      })
    );
  });

  it('supports custom getToken extractor and request headers', async () => {
    const mockFetch = createMockFetch({ success: true });
    const customGetToken = vi.fn((req: any) => req.customSecurityToken);

    const { payment } = buildPayment({
      fetch: mockFetch,
      getToken: customGetToken,
    });

    const res = await payment.createPayment({
      ...mockPaymentRequest,
      customSecurityToken: 'extracted-token-123',
    } as any);

    expect(res.status).toBe(PaymentStatus.SUCCESS);
    expect(customGetToken).toHaveBeenCalled();
  });

  it('never intercepts callback operations like completeThreeDSPayment', async () => {
    const mockFetch = createMockFetch({ success: false });
    const { payment, mockProvider } = buildPayment({ fetch: mockFetch });
    const spy = vi.spyOn(mockProvider, 'completeThreeDSPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'PMT-3DS-OK',
    } as PaymentResponse);

    // Call completeThreeDSPayment without any captcha token
    const res = await payment.completeThreeDSPayment({
      paymentId: 'PMT-3DS-OK',
      status: 'success',
    });

    expect(res.status).toBe(PaymentStatus.SUCCESS);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('handles network failures to captcha siteverify gracefully by failing the payment', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('Connection refused to cloudflare.com'));
    const { payment, mockProvider } = buildPayment({ fetch: failingFetch });
    const spy = vi.spyOn(mockProvider, 'createPayment');

    const res = await payment.createPayment({
      ...mockPaymentRequest,
      captchaToken: 'some-token',
    } as any);

    expect(res.status).toBe(PaymentStatus.FAILURE);
    expect((res as any).errorCode).toBe('CAPTCHA_INVALID');
    expect(spy).not.toHaveBeenCalled();
  });
});
