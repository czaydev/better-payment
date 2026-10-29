import { describe, expect, it } from 'vitest';
import { PROVIDER_SPECS } from '../src/provider-specs';
import { mountHint, renderConfig, renderEnvExample, renderRoute } from '../src/templates';
import { detectProject } from '../src/detect';
import { fakeIo } from './helpers';

function contextFor(
  files: Record<string, string>,
  dirs: string[],
  providers: string[],
  basePath = '/api/pay'
) {
  const project = detectProject(fakeIo({ files, dirs }));
  const configPath = project.hasSrcDir ? 'src/lib/payment.ts' : 'lib/payment.ts';
  const routePath = `${project.hasSrcDir ? 'src/' : ''}app${basePath}/[...payment]/route.ts`;
  return { project, providers, basePath, configPath, routePath };
}

const NEXT_PROJECT = {
  files: { 'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }) },
  dirs: ['app'],
};

describe('renderConfig', () => {
  it('imports the library and every provider factory', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico', 'paytr']);
    const config = renderConfig(context);
    expect(config).toContain('import {\n  betterPayment,\n  iyzico,\n  paytr,');
    expect(config).toContain("from 'better-payment';");
  });

  it('creates every provider with env vars, never literal secrets', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico']);
    const config = renderConfig(context);
    expect(config).toContain('apiKey: process.env.IYZICO_API_KEY!');
    expect(config).toContain('secretKey: process.env.IYZICO_SECRET_KEY!');
    expect(config).not.toMatch(/apiKey: '[^']/);
  });

  it('exports mode, handlerOptions and a lazy singleton', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico']);
    const config = renderConfig(context);
    expect(config).toContain('export const mode');
    expect(config).toContain('export const handlerOptions');
    expect(config).toContain('export const getBetterPayment');
    expect(config).toContain('instance ??= createPayment()');
  });

  it('keeps callbacks reachable in allowedActions', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico']);
    expect(renderConfig(context)).toContain(
      "allowedActions: ['payment/init-3ds', 'payment/complete-3ds', 'callback']"
    );
  });

  it('is a server-only file', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico']);
    expect(renderConfig(context)).toContain('Server-only');
  });
});

describe('renderRoute', () => {
  it('next-app uses the docs alias and toNextJsHandler', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico']);
    const route = renderRoute(context);
    expect(route).toContain("import { toNextJsHandler } from 'better-payment/next';");
    expect(route).toContain("import { getBetterPayment } from '@/lib/payment';");
  });

  it('express imports the config with a relative path', () => {
    const io = fakeIo({ files: { 'tsconfig.json': '{}' }, dirs: ['src'] });
    const project = detectProject(io, 'express');
    const route = renderRoute({
      project,
      providers: ['iyzico'],
      basePath: '/api/pay',
      configPath: 'src/lib/payment.ts',
      routePath: 'src/routes/payment.ts',
    });
    expect(route).toContain("import { getBetterPayment } from '../lib/payment'");
    expect(route).toContain("from 'better-payment/express'");
    expect(route).toContain(".all('/api/pay/*path'");
  });

  it('fastify registers a plugin with the base path prefix', () => {
    const io = fakeIo({ files: { 'tsconfig.json': '{}' }, dirs: ['src'] });
    const project = detectProject(io, 'fastify');
    const route = renderRoute({
      project,
      providers: ['iyzico'],
      basePath: '/api/pay',
      configPath: 'src/lib/payment.ts',
      routePath: 'src/routes/payment.ts',
    });
    expect(route).toContain("toFastifyPlugin(getBetterPayment), { prefix: '/api/pay' }");
  });

  it('hono mounts with app.route', () => {
    const io = fakeIo({});
    const project = detectProject(io, 'hono');
    const route = renderRoute({
      project,
      providers: ['iyzico'],
      basePath: '/api/pay',
      configPath: 'lib/payment.ts',
      routePath: 'routes/payment.ts',
    });
    expect(route).toContain("from 'better-payment/hono'");
    expect(route).toContain("paymentRoutes.all('/api/pay/*'");
  });

  it('elysia disables parsing', () => {
    const io = fakeIo({});
    const project = detectProject(io, 'elysia');
    expect(
      renderRoute({
        project,
        providers: ['iyzico'],
        basePath: '/api/pay',
        configPath: 'lib/payment.ts',
        routePath: 'routes/payment.ts',
      })
    ).toContain("parse: 'none'");
  });

  it('react-router exports loader and action', () => {
    const io = fakeIo({});
    const project = detectProject(io, 'react-router');
    const route = renderRoute({
      project,
      providers: ['iyzico'],
      basePath: '/api/pay',
      configPath: 'lib/payment.ts',
      routePath: 'app/routes/api.pay.$.ts',
    });
    expect(route).toContain('toReactRouterHandler');
    expect(route).toContain('export const { loader, action }');
  });

  it('node prints the health url', () => {
    const io = fakeIo({});
    const project = detectProject(io, 'node');
    const route = renderRoute({
      project,
      providers: ['iyzico'],
      basePath: '/api/pay',
      configPath: 'lib/payment.ts',
      routePath: 'payment-server.ts',
    });
    expect(route).toContain('http://localhost:${port}/api/pay/health');
  });

  it('next-pages uses the node handler', () => {
    const io = fakeIo({
      files: { 'package.json': JSON.stringify({ dependencies: { next: '15' } }) },
      dirs: ['pages'],
    });
    const project = detectProject(io, 'next-pages');
    const route = renderRoute({
      project,
      providers: ['iyzico'],
      basePath: '/api/pay',
      configPath: 'lib/payment.ts',
      routePath: 'pages/api/pay/[...payment].ts',
    });
    expect(route).toContain('toNodeHandler');
  });
});

describe('renderEnvExample', () => {
  it('lists names only, with generated placeholders', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico', 'paytr']);
    const env = renderEnvExample(context);
    expect(env).toContain('PAYMENT_MODE=sandbox');
    expect(env).toContain('IYZICO_API_KEY=your-iyzico-api-key');
    expect(env).toContain('IYZICO_SECRET_KEY=your-iyzico-secret-key');
    expect(env).toContain('PAYTR_MERCHANT_ID=your-paytr-merchant-id');
    expect(env).not.toMatch(/=[A-Za-z0-9]{20,}$/m);
  });

  it('has a per-provider section comment', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico']);
    const env = renderEnvExample(context);
    expect(env).toContain('# iyzico');
  });
});

describe('mountHint', () => {
  it('points express at the router export', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico']);
    expect(
      mountHint({ ...context, project: { ...context.project, framework: 'express' } })
    ).toContain('app.use(paymentRoutes)');
  });

  it('tells next-app nothing else is needed', () => {
    const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, ['iyzico']);
    expect(mountHint(context)).toContain('automatically');
  });
});

describe('every spec renders a complete config', () => {
  it('one config per provider compiles its own factory call', () => {
    for (const id of Object.keys(PROVIDER_SPECS)) {
      const context = contextFor(NEXT_PROJECT.files, NEXT_PROJECT.dirs, [id]);
      const config = renderConfig(context);
      expect(config, id).toContain(
        `${PROVIDER_SPECS[id].factory}: ${PROVIDER_SPECS[id].factory}({`
      );
    }
  });
});
