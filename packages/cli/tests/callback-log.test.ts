import { describe, expect, it } from 'vitest';
import { describeCallback, formatCallback, isCallbackRoute } from '../src/callback-log';

describe('describeCallback', () => {
  it('splits a provider callback into provider and route', () => {
    const route = describeCallback('/api/pay/iyzico/payment/complete-3ds');
    expect(route).toEqual({ provider: 'iyzico', route: 'payment/complete-3ds', hadQuery: false });
  });

  it('marks a query string without showing it', () => {
    const route = describeCallback('/api/pay/paytr/callback?hash=secret&merchant=x');
    expect(route.provider).toBe('paytr');
    expect(route.route).toBe('callback');
    expect(route.hadQuery).toBe(true);
    expect(JSON.stringify(route)).not.toContain('secret');
  });

  it('reports paths outside the base path', () => {
    expect(describeCallback('/health', '/api/pay')).toEqual({
      provider: '-',
      route: 'outside the handler base path',
      hadQuery: false,
    });
  });

  it('handles a missing url', () => {
    expect(describeCallback(undefined)).toEqual({
      provider: '-',
      route: 'unknown',
      hadQuery: false,
    });
  });

  it('uses the given base path', () => {
    const route = describeCallback('/pay/akbank/payment/complete-3ds', '/pay');
    expect(route.provider).toBe('akbank');
  });

  it('returns unknown for a bare base path', () => {
    expect(describeCallback('/api/pay/').route).toBe('unknown');
    expect(describeCallback('/api/pay/').provider).toBe('-');
  });
});

describe('formatCallback', () => {
  it('renders one fixed-width line without body data', () => {
    const line = formatCallback({
      provider: 'iyzico',
      route: 'payment/complete-3ds',
      method: 'post',
      status: 200,
      durationMs: 12,
      hadQuery: false,
    });
    expect(line).toBe('callback  iyzico      payment/complete-3ds        POST 200  12ms');
  });

  it('appends the query marker only when a query was present', () => {
    const base = {
      provider: 'paytr',
      route: 'callback',
      method: 'POST',
      status: 500,
      durationMs: 3,
    };
    expect(formatCallback({ ...base, hadQuery: true })).toContain('(query masked)');
    expect(formatCallback({ ...base, hadQuery: false })).not.toContain('(query masked)');
  });

  it('truncates long provider and route names', () => {
    const line = formatCallback({
      provider: 'a-very-long-provider-name',
      route: 'a-very-long-route-name-that-should-be-truncated-here',
      method: 'GET',
      status: 200,
      durationMs: 1,
      hadQuery: false,
    });
    expect(line.split('\n')).toHaveLength(1);
  });
});

describe('isCallbackRoute', () => {
  it('is true for the two callback routes', () => {
    expect(isCallbackRoute({ provider: 'paytr', route: 'callback', hadQuery: false })).toBe(true);
    expect(
      isCallbackRoute({ provider: 'iyzico', route: 'payment/complete-3ds', hadQuery: false })
    ).toBe(true);
  });

  it('is false for health, unknown providers and other routes', () => {
    expect(isCallbackRoute({ provider: 'iyzico', route: 'health', hadQuery: false })).toBe(false);
    expect(isCallbackRoute({ provider: '-', route: 'callback', hadQuery: false })).toBe(false);
    expect(isCallbackRoute({ provider: 'iyzico', route: 'payment/init', hadQuery: false })).toBe(
      false
    );
  });
});
