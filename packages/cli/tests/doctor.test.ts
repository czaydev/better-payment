import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROVIDER_DEFAULT_URLS } from 'better-payment';
import type { BetterPaymentHandlerOptions } from 'better-payment';
import { handlerChecks, loadDoctorConfig, runDoctor } from '../src/commands/doctor';
import {
  fakeIo,
  httpResponse,
  makeTempDir,
  realDirIo,
  removeTempDir,
  type FakeIo,
} from './helpers';

const options = (overrides: BetterPaymentHandlerOptions): BetterPaymentHandlerOptions => overrides;

describe('handlerChecks', () => {
  it('warns twice without handlerOptions', () => {
    const checks = handlerChecks(undefined);
    expect(checks.map((check) => check.id).sort()).toEqual([
      'handler-idempotency',
      'handler-options',
    ]);
    expect(checks.every((check) => check.status === 'warn')).toBe(true);
  });

  it('fails when privileged actions are exposed without authorize', () => {
    const checks = handlerChecks(options({ allowedActions: ['callback', 'refund'] }));
    const actions = checks.find((check) => check.id === 'handler-actions');
    expect(actions?.status).toBe('fail');
    expect(actions?.message).toContain('refund');
    const authorize = checks.find((check) => check.id === 'handler-authorize');
    expect(authorize?.status).toBe('fail');
  });

  it('passes when privileged actions sit behind authorize', () => {
    const checks = handlerChecks(
      options({
        allowedActions: ['callback', 'refund'],
        authorize: (ctx) => ctx.action === 'callback',
      })
    );
    const actions = checks.find((check) => check.id === 'handler-actions');
    expect(actions?.status).toBe('pass');
    expect(actions?.details?.[0]).toContain('authorize is set');
  });

  it('passes with only callback and read-only actions', () => {
    const checks = handlerChecks(options({ allowedActions: ['callback', 'payment/complete-3ds'] }));
    expect(checks.find((check) => check.id === 'handler-actions')?.status).toBe('pass');
    expect(checks.find((check) => check.id === 'handler-authorize')?.status).toBe('pass');
  });

  it("warns on allowedActions: 'all' without authorize and fails hard", () => {
    const checks = handlerChecks(options({ allowedActions: 'all' }));
    const actions = checks.find((check) => check.id === 'handler-actions');
    expect(actions?.status).toBe('fail');
    expect(actions?.message).toContain("'all'");
  });

  it('warns when idempotency is disabled', () => {
    const checks = handlerChecks(options({ allowedActions: ['callback'], idempotency: false }));
    expect(checks.find((check) => check.id === 'handler-idempotency')?.status).toBe('warn');
  });

  it('passes with a shared idempotency store', () => {
    const store = {
      get: () => undefined,
      set: () => undefined,
      setIfAbsent: () => true,
      delete: () => undefined,
    };
    const checks = handlerChecks(options({ allowedActions: ['callback'], idempotency: { store } }));
    expect(checks.find((check) => check.id === 'handler-idempotency')?.status).toBe('pass');
  });
});

describe('loadDoctorConfig', () => {
  const dir = makeTempDir('doctor-config');

  beforeAll(() => {
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(
      join(dir, 'lib', 'payment.ts'),
      [
        "import { betterPayment, iyzico } from 'better-payment';",
        'export const mode = "sandbox" as const;',
        'export const handlerOptions = { allowedActions: ["callback", "payment/complete-3ds"] };',
        'export const getBetterPayment = () =>',
        '  betterPayment({',
        '    mode,',
        '    providers: { iyzico: iyzico({ apiKey: "k", secretKey: "s" }) },',
        '    handler: handlerOptions,',
        '  });',
      ].join('\n')
    );
  });

  afterAll(() => {
    removeTempDir(dir);
  });

  it('loads mode, providers, handler options and the handler itself', async () => {
    const io = realDirIo(dir);
    const { config, error } = await loadDoctorConfig(io, 'lib/payment.ts');
    expect(error).toBeUndefined();
    expect(config.mode).toBe('sandbox');
    expect(config.providers).toEqual(['iyzico']);
    expect(config.handlerOptions?.allowedActions).toEqual(['callback', 'payment/complete-3ds']);
    expect(config.handler).toBeDefined();
  });

  it('reads PAYMENT_MODE without --config', async () => {
    const io = fakeIo({ env: { PAYMENT_MODE: 'production' } });
    const { config } = await loadDoctorConfig(io);
    expect(config.mode).toBe('production');
    expect(config.path).toBeUndefined();
  });

  it('reports an import error with the path', async () => {
    const io = realDirIo(dir);
    const { error } = await loadDoctorConfig(io, 'lib/does-not-exist.ts');
    expect(error).toContain('could not be imported');
  });
});

function successFetch(): typeof fetch {
  return (async () => httpResponse(200, JSON.stringify({ status: 'success' }))) as typeof fetch;
}

function doctorIo(overrides: Partial<FakeIo['env']> = {}, fetch?: FakeIo['fetch']): FakeIo {
  return fakeIo({
    env: {
      IYZICO_API_KEY: 'sandbox-key',
      IYZICO_SECRET_KEY: 'sandbox-secret',
      ...overrides,
    },
    fetch: fetch ?? successFetch(),
  });
}

describe('runDoctor', () => {
  it('probes iyzico and passes when the provider answers', async () => {
    const io = doctorIo();
    const result = await runDoctor(io, ['-p', 'iyzico']);
    expect(result.code).toBe(0);
    const credentials = result.checks?.find((check) => check.id === 'iyzico-credentials');
    expect(credentials?.status).toBe('pass');
    expect(credentials?.message).toContain('accepted');
    expect(io.out.join('\n')).not.toContain('sandbox-secret');
  });

  it('fails with exit code 1 when the provider rejects the key', async () => {
    const io = doctorIo({}, (async () =>
      httpResponse(401, '{"errorMessage":"Invalid authorization"}')) as typeof fetch);
    const result = await runDoctor(io, ['-p', 'iyzico']);
    expect(result.code).toBe(1);
    const credentials = result.checks?.find((check) => check.id === 'iyzico-credentials');
    expect(credentials?.status).toBe('fail');
    expect(credentials?.message).toContain('rejected');
  });

  it('flags a base URL from the other mode', async () => {
    const io = doctorIo({ IYZICO_BASE_URL: PROVIDER_DEFAULT_URLS.iyzico.production });
    const result = await runDoctor(io, ['-p', 'iyzico']);
    const mode = result.checks?.find((check) => check.id === 'iyzico-mode');
    expect(mode?.status).toBe('fail');
    expect(mode?.message).toContain('production host');
    expect(result.code).toBe(1);
  });

  it('skips providers whose variables are missing', async () => {
    const io = fakeIo({ env: {}, fetch: successFetch() });
    const result = await runDoctor(io, ['-p', 'iyzico']);
    const credentials = result.checks?.find((check) => check.id === 'iyzico-credentials');
    expect(credentials?.status).toBe('skip');
    expect(result.code).toBe(0);
  });

  it('fails on generated placeholder values', async () => {
    const io = fakeIo({
      env: { IYZICO_API_KEY: 'your-iyzico-api-key', IYZICO_SECRET_KEY: 'real-secret' },
      fetch: successFetch(),
    });
    const result = await runDoctor(io, ['-p', 'iyzico']);
    const credentials = result.checks?.find((check) => check.id === 'iyzico-credentials');
    expect(credentials?.status).toBe('fail');
    expect(credentials?.message).toContain('placeholder');
  });

  it('reports the handler checks and health from a real config', async () => {
    const dir = makeTempDir('doctor-run');
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(
      join(dir, 'lib', 'payment.ts'),
      [
        "import { betterPayment, iyzico } from 'better-payment';",
        'export const handlerOptions = { allowedActions: ["callback", "payment/complete-3ds"] };',
        'export const getBetterPayment = () =>',
        '  betterPayment({',
        '    mode: "sandbox",',
        '    providers: { iyzico: iyzico({ apiKey: "k", secretKey: "s" }) },',
        '    handler: handlerOptions,',
        '  });',
      ].join('\n')
    );
    try {
      const io = fakeIo({
        cwd: dir,
        env: { IYZICO_API_KEY: 'k', IYZICO_SECRET_KEY: 's' },
        fetch: successFetch(),
      });
      io.loadModule = async (path) => (await import(path)) as Record<string, unknown>;
      const result = await runDoctor(io, ['--config', 'lib/payment.ts', '-p', 'iyzico', '--json']);
      expect(result.code).toBe(0);
      const payload = JSON.parse(io.out.join('\n')) as {
        mode: string;
        checks: { id: string; status: string }[];
      };
      expect(payload.mode).toBe('sandbox');
      const byId = Object.fromEntries(payload.checks.map((check) => [check.id, check.status]));
      expect(byId['config']).toBe('pass');
      expect(byId['handler-actions']).toBe('pass');
      expect(byId['handler-health']).toBe('pass');
    } finally {
      removeTempDir(dir);
    }
  });

  it('prints a summary line in text mode', async () => {
    const io = doctorIo();
    await runDoctor(io, ['-p', 'iyzico']);
    expect(io.out.at(-2)).toBe('');
    expect(io.out.at(-1)).toMatch(/3 passed, 2 warned, 0 failed, 1 skipped/);
  });

  it('rejects unknown providers with usage code 2', async () => {
    const io = doctorIo();
    expect((await runDoctor(io, ['-p', 'stripe'])).code).toBe(2);
    expect(io.err.join('\n')).toContain('unknown provider');
  });
});
