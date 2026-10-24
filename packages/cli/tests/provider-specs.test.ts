import { describe, expect, it } from 'vitest';
import {
  KNOWN_PROVIDER_IDS,
  looksLikePlaceholder,
  parseProviderList,
  PROVIDER_SPECS,
  unknownProviders,
} from '../src/provider-specs';
import * as library from 'better-payment';

describe('parseProviderList', () => {
  it('splits on commas and trims', () => {
    expect(parseProviderList('iyzico, paytr')).toEqual(['iyzico', 'paytr']);
  });

  it('lowercases and deduplicates', () => {
    expect(parseProviderList('IYZICO,iyzico,PAYTR')).toEqual(['iyzico', 'paytr']);
  });

  it('drops empty parts', () => {
    expect(parseProviderList('iyzico,,paytr,')).toEqual(['iyzico', 'paytr']);
  });

  it('returns an empty list for undefined', () => {
    expect(parseProviderList(undefined)).toEqual([]);
  });
});

describe('unknownProviders', () => {
  it('reports ids that are not in the table, in order', () => {
    expect(unknownProviders(['iyzico', 'stripe', 'paypal'])).toEqual(['stripe', 'paypal']);
  });

  it('returns nothing for known ids', () => {
    expect(unknownProviders(KNOWN_PROVIDER_IDS)).toEqual([]);
  });
});

describe('looksLikePlaceholder', () => {
  it('recognises the generated .env.example placeholders', () => {
    expect(looksLikePlaceholder('your-iyzico-api-key')).toBe(true);
    expect(looksLikePlaceholder('YOUR_SECRET_KEY')).toBe(true);
  });

  it('recognises common copy leftovers', () => {
    expect(looksLikePlaceholder('changeme')).toBe(true);
    expect(looksLikePlaceholder('CHANGE_ME')).toBe(true);
    expect(looksLikePlaceholder('placeholder')).toBe(true);
    expect(looksLikePlaceholder('example_key')).toBe(true);
    expect(looksLikePlaceholder('TODO')).toBe(true);
    expect(looksLikePlaceholder('xxxx')).toBe(true);
    expect(looksLikePlaceholder('<api-key>')).toBe(true);
    expect(looksLikePlaceholder('${IYZICO_API_KEY}')).toBe(true);
    expect(looksLikePlaceholder('')).toBe(true);
    expect(looksLikePlaceholder('   ')).toBe(true);
  });

  it('accepts real-looking values', () => {
    expect(looksLikePlaceholder('sandbox-kX9m2...')).toBe(false);
    expect(looksLikePlaceholder('123456')).toBe(false);
    expect(looksLikePlaceholder(undefined)).toBe(false);
  });
});

describe('PROVIDER_SPECS', () => {
  it('keys match the ids', () => {
    for (const [key, spec] of Object.entries(PROVIDER_SPECS)) {
      expect(spec.id).toBe(key);
    }
    expect(KNOWN_PROVIDER_IDS).toEqual(Object.keys(PROVIDER_SPECS));
  });

  it('every factory is exported by better-payment', () => {
    for (const spec of Object.values(PROVIDER_SPECS)) {
      expect(library, spec.factory).toHaveProperty(spec.factory);
      expect(typeof (library as unknown as Record<string, unknown>)[spec.factory]).toBe('function');
    }
  });

  it('every env var is unique within a provider and non-empty', () => {
    for (const spec of Object.values(PROVIDER_SPECS)) {
      const envs = spec.fields.map((field) => field.env);
      expect(new Set(envs).size).toBe(envs.length);
      for (const env of envs) {
        expect(env).toMatch(new RegExp(`^${spec.id.toUpperCase().replace(/-/g, '_')}_`));
      }
    }
  });

  it('iyzico verifies callbacks remotely, the others locally', () => {
    expect(PROVIDER_SPECS.iyzico.callbackVerification).toBe('remote');
    expect(PROVIDER_SPECS.paytr.callbackVerification).toBe('hash');
    expect(PROVIDER_SPECS.parampos.callbackVerification).toBe('guid');
    expect(PROVIDER_SPECS.akbank.callbackVerification).toBe('hmac');
  });

  it('every provider has a docs path', () => {
    for (const spec of Object.values(PROVIDER_SPECS)) {
      expect(spec.docs).toMatch(/^\//);
    }
  });
});
