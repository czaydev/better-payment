import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init';
import { fakeIo, makeTempDir, realDirIo, removeTempDir } from './helpers';

const ENV_KEYS = [
  'IYZICO_API_KEY',
  'IYZICO_SECRET_KEY',
  'PAYTR_MERCHANT_ID',
  'PAYTR_MERCHANT_KEY',
  'PAYTR_MERCHANT_SALT',
];
const savedEnv: [string, string | undefined][] = [];

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.push([key, process.env[key]]);
  process.env.IYZICO_API_KEY = 'sandbox-test-key';
  process.env.IYZICO_SECRET_KEY = 'sandbox-test-secret';
  process.env.PAYTR_MERCHANT_ID = '123456';
  process.env.PAYTR_MERCHANT_KEY = 'sandbox-test-key';
  process.env.PAYTR_MERCHANT_SALT = 'sandbox-test-salt';
});

afterAll(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function nextProject(dir: string): void {
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'shop', dependencies: { next: '15.0.0' } })
  );
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
}

describe('runInit (end to end in a real directory)', () => {
  it('writes the config, the route and .env.example for a next-app project', async () => {
    const dir = makeTempDir('init-next');
    mkdirSync(dir, { recursive: true });
    nextProject(dir);
    try {
      const result = await runInit(realDirIo(dir), ['-p', 'iyzico,paytr', '--no-install']);
      expect(result.code).toBe(0);

      const config = readFileSync(join(dir, 'lib', 'payment.ts'), 'utf8');
      expect(config).toContain('getBetterPayment');
      expect(config).toContain('iyzico({');
      expect(config).toContain('paytr({');

      const route = readFileSync(
        join(dir, 'app', 'api', 'pay', '[...payment]', 'route.ts'),
        'utf8'
      );
      expect(route).toContain("from 'better-payment/next'");
      expect(route).toContain("from '@/lib/payment'");

      const env = readFileSync(join(dir, '.env.example'), 'utf8');
      expect(env).toContain('IYZICO_API_KEY=your-iyzico-api-key');
      expect(env).toContain('PAYTR_MERCHANT_ID=your-paytr-merchant-id');
      expect(env).not.toContain('sandbox-test-key');
    } finally {
      removeTempDir(dir);
    }
  });

  it('the generated config imports, exposes providers and answers /health', async () => {
    const dir = makeTempDir('init-import');
    mkdirSync(dir, { recursive: true });
    nextProject(dir);
    try {
      const result = await runInit(realDirIo(dir), ['-p', 'iyzico', '--no-install']);
      expect(result.code).toBe(0);

      const module = (await import(pathToFileURL(join(dir, 'lib', 'payment.ts')).href)) as {
        mode: string;
        handlerOptions: Record<string, unknown>;
        getBetterPayment: () => {
          getEnabledProviders(): string[];
          handler: {
            handle(request: {
              method: string;
              url: string;
              headers: object;
            }): Promise<{ status: number }>;
          };
        };
      };
      expect(module.mode).toBe('sandbox');
      expect(module.handlerOptions.allowedActions).toContain('callback');

      const payment = module.getBetterPayment();
      expect(payment.getEnabledProviders()).toEqual(['iyzico']);
      const health = await payment.handler.handle({
        method: 'GET',
        url: '/api/pay/health',
        headers: {},
      });
      expect(health.status).toBe(200);
    } finally {
      removeTempDir(dir);
    }
  });

  it('refuses to overwrite and does so only with --force', async () => {
    const dir = makeTempDir('init-overwrite');
    mkdirSync(dir, { recursive: true });
    nextProject(dir);
    try {
      const io = realDirIo(dir);
      expect((await runInit(io, ['-p', 'iyzico', '--no-install'])).code).toBe(0);
      expect((await runInit(io, ['-p', 'iyzico', '--no-install'])).code).toBe(1);
      expect((await runInit(io, ['-p', 'iyzico', '--no-install', '--force'])).code).toBe(0);
    } finally {
      removeTempDir(dir);
    }
  });

  it('runs the package manager only with --install', async () => {
    const dir = makeTempDir('init-install');
    mkdirSync(dir, { recursive: true });
    nextProject(dir);
    const runs: { command: string; args: string[] }[] = [];
    try {
      const result = await runInit(realDirIo(dir, { runs }), ['-p', 'iyzico', '--install']);
      expect(result.code).toBe(0);
      expect(runs).toEqual([{ command: 'npm', args: ['install', 'better-payment'] }]);
    } finally {
      removeTempDir(dir);
    }
  });

  it('rejects unknown providers and frameworks with usage code 2', async () => {
    const dir = makeTempDir('init-bad');
    mkdirSync(dir, { recursive: true });
    try {
      const io = realDirIo(dir);
      expect((await runInit(io, ['-p', 'stripe'])).code).toBe(2);
      expect((await runInit(io, ['-f', 'vue'])).code).toBe(2);
      expect(existsSync(join(dir, 'lib/payment.ts'))).toBe(false);
    } finally {
      removeTempDir(dir);
    }
  });

  it('uses pnpm from the lockfile and src/ when it exists', async () => {
    const dir = makeTempDir('init-src');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { express: '4.0.0' } })
    );
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    try {
      const result = await runInit(realDirIo(dir), ['-p', 'iyzico', '--no-install']);
      expect(result.code).toBe(0);
      expect(existsSync(join(dir, 'src', 'lib', 'payment.ts'))).toBe(true);
      expect(existsSync(join(dir, 'src', 'routes', 'payment.ts'))).toBe(true);
      const route = readFileSync(join(dir, 'src', 'routes', 'payment.ts'), 'utf8');
      expect(route).toContain("from '../lib/payment'");
    } finally {
      removeTempDir(dir);
    }
  });

  it('normalizes the base path and uses it in the route path', async () => {
    const dir = makeTempDir('init-base');
    mkdirSync(dir, { recursive: true });
    nextProject(dir);
    try {
      const result = await runInit(realDirIo(dir), [
        '-p',
        'iyzico',
        '--base-path',
        'api/odeme',
        '--no-install',
      ]);
      expect(result.code).toBe(0);
      expect(existsSync(join(dir, 'app', 'api', 'odeme', '[...payment]', 'route.ts'))).toBe(true);
    } finally {
      removeTempDir(dir);
    }
  });
});

describe('runInit against the fake io', () => {
  it('asks for providers and falls back to iyzico', async () => {
    const io = fakeIo({
      files: {
        'package.json': JSON.stringify({ dependencies: { express: '4' } }),
        'tsconfig.json': '{}',
      },
    });
    const result = await runInit(io, []);
    expect(result.code).toBe(0);
    expect([...io.files.keys()]).toContain('lib/payment.ts');
    expect(io.files.get('lib/payment.ts')).toContain('iyzico({');
  });

  it('accepts the prompt answer', async () => {
    const custom = fakeIo({ files: { 'tsconfig.json': '{}' } });
    custom.prompt = async (question) =>
      question.startsWith('Providers') ? 'paytr,parampos' : 'iyzico';
    const result = await runInit(custom, []);
    expect(result.code).toBe(0);
    expect(custom.files.get('lib/payment.ts')).toContain('paytr({');
    expect(custom.files.get('lib/payment.ts')).toContain('parampos({');
  });

  it('notes a missing package.json', async () => {
    const io = fakeIo({ files: { 'tsconfig.json': '{}' } });
    const result = await runInit(io, ['-p', 'iyzico', '-f', 'node']);
    expect(result.code).toBe(0);
    expect(io.out.join('\n')).toContain('no package.json here');
    expect(io.files.has('payment-server.ts')).toBe(true);
  });

  it('prints the env var names in the next steps', async () => {
    const io = fakeIo({ files: { 'package.json': '{}' } });
    await runInit(io, ['-p', 'iyzico', '-y']);
    expect(io.out.join('\n')).toContain('IYZICO_API_KEY');
  });
});
