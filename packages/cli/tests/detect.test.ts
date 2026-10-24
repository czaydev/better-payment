import { describe, expect, it } from 'vitest';
import {
  detectFramework,
  detectPackageManager,
  detectProject,
  relativeImport,
  targetPaths,
  type Framework,
  type ProjectInfo,
} from '../src/detect';
import { fakeIo } from './helpers';

function projectWith(
  files: Record<string, string>,
  dirs: string[] = []
): { allDependencies: Record<string, string>; project: ProjectInfo } {
  const io = fakeIo({ files, dirs });
  const project = detectProject(io);
  return { allDependencies: project.allDependencies, project };
}

describe('detectProject', () => {
  it('falls back to a plain node project without package.json', () => {
    const { project } = projectWith({});
    expect(project.framework).toBe('node');
    expect(project.frameworkSource).toBe('default');
    expect(project.packageManager).toBe('npm');
    expect(project.isTypeScript).toBe(false);
    expect(project.ext).toBe('js');
    expect(project.hasSrcDir).toBe(false);
    expect(project.installCommand).toBe('npm install better-payment');
    expect(project.packageJson).toBeUndefined();
  });

  it('detects next-app from the next dependency', () => {
    const { project } = projectWith(
      {
        'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }),
      },
      ['app']
    );
    expect(project.framework).toBe('next-app');
    expect(project.frameworkSource).toBe('package.json');
  });

  it('detects next-pages when pages exists but app does not', () => {
    const { project } = projectWith(
      {
        'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }),
      },
      ['pages']
    );
    expect(project.framework).toBe('next-pages');
  });

  it('prefers app over pages when both exist', () => {
    const { project } = projectWith(
      {
        'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }),
      },
      ['app', 'pages']
    );
    expect(project.framework).toBe('next-app');
  });

  it('detects the other frameworks by dependency', () => {
    for (const [dependency, framework] of [
      ['hono', 'hono'],
      ['fastify', 'fastify'],
      ['express', 'express'],
      ['elysia', 'elysia'],
      ['react-router-dom', 'react-router'],
      ['@react-router/node', 'react-router'],
    ] as const) {
      const { project } = projectWith({
        'package.json': JSON.stringify({ dependencies: { [dependency]: '1.0.0' } }),
      });
      expect(project.framework, dependency).toBe(framework);
    }
  });

  it('merges dependencies, devDependencies and peerDependencies', () => {
    const { allDependencies } = projectWith({
      'package.json': JSON.stringify({
        dependencies: { express: '4.0.0' },
        devDependencies: { typescript: '5.0.0' },
      }),
    });
    expect(allDependencies.express).toBe('4.0.0');
    expect(allDependencies.typescript).toBe('5.0.0');
  });

  it('flags TypeScript from tsconfig.json', () => {
    const { project } = projectWith({ 'tsconfig.json': '{}' });
    expect(project.isTypeScript).toBe(true);
    expect(project.ext).toBe('ts');
  });

  it('keeps a package.json parse error for the report', () => {
    const io = fakeIo({ files: { 'package.json': '{ not json' } });
    expect(detectProject(io).packageJsonError).toBeTruthy();
  });

  it('marks a src directory', () => {
    const { project } = projectWith({}, ['src']);
    expect(project.hasSrcDir).toBe(true);
    expect(project.appDir).toBe('src');
  });

  it('the framework flag wins over detection', () => {
    const io = fakeIo({
      files: { 'package.json': JSON.stringify({ dependencies: { express: '4.0.0' } }) },
    });
    expect(detectProject(io, 'hono').framework).toBe('hono');
    expect(detectProject(io, 'hono').frameworkSource).toBe('flag');
  });
});

describe('detectPackageManager', () => {
  it('reads the packageManager field first', () => {
    const io = fakeIo({ files: { 'pnpm-lock.yaml': '' } });
    expect(detectPackageManager(io, { packageManager: 'pnpm@10.0.0' })).toBe('pnpm');
  });

  it('then the lockfiles', () => {
    expect(detectPackageManager(fakeIo({ files: { 'pnpm-lock.yaml': '' } }), {})).toBe('pnpm');
    expect(detectPackageManager(fakeIo({ files: { 'bun.lock': '' } }), {})).toBe('bun');
    expect(detectPackageManager(fakeIo({ files: { 'yarn.lock': '' } }), {})).toBe('yarn');
    expect(detectPackageManager(fakeIo({ files: { 'package-lock.json': '' } }), {})).toBe('npm');
  });

  it('knows every manager for the install command', () => {
    for (const [manager, command] of [
      ['pnpm', 'pnpm add better-payment'],
      ['yarn', 'yarn add better-payment'],
      ['bun', 'bun add better-payment'],
      ['npm', 'npm install better-payment'],
    ] as const) {
      const io = fakeIo({
        files: { 'package.json': JSON.stringify({ packageManager: `${manager}@1.0.0` }) },
      });
      expect(detectProject(io).installCommand, manager).toBe(command);
    }
  });
});

describe('detectFramework without package.json', () => {
  it('returns node', () => {
    expect(detectFramework(fakeIo({}), {})).toBe('node');
  });
});

describe('targetPaths', () => {
  const projectOf = (files: Record<string, string>, dirs: string[], framework: Framework) =>
    detectProject(fakeIo({ files, dirs }), framework);

  it('next-app with src', () => {
    const project = projectOf({ 'tsconfig.json': '{}' }, ['src'], 'next-app');
    expect(targetPaths(project, '/api/pay')).toEqual({
      config: 'src/lib/payment.ts',
      route: 'src/app/api/pay/[...payment]/route.ts',
    });
  });

  it('next-pages without src, javascript', () => {
    const project = projectOf({}, ['pages'], 'next-pages');
    expect(targetPaths(project, '/api/pay')).toEqual({
      config: 'lib/payment.js',
      route: 'pages/api/pay/[...payment].js',
    });
  });

  it('express routes live in routes/', () => {
    const project = projectOf({ 'tsconfig.json': '{}' }, ['src'], 'express');
    expect(targetPaths(project, '/api/pay').route).toBe('src/routes/payment.ts');
  });

  it('react-router uses the dot splat name', () => {
    const project = projectOf({ 'tsconfig.json': '{}' }, ['src'], 'react-router');
    expect(targetPaths(project, '/api/pay').route).toBe('src/app/routes/api.pay.$.ts');
  });

  it('node puts the server at the root', () => {
    const project = projectOf({}, [], 'node');
    const paths = targetPaths(project, '/api/pay');
    expect(paths.config).toBe('lib/payment.js');
    expect(paths.route).toBe('payment-server.js');
  });
});

describe('relativeImport', () => {
  it('walks up from a nested route', () => {
    expect(relativeImport('app/api/pay/[...payment]', 'lib/payment.ts')).toBe(
      '../../../../lib/payment.ts'
    );
  });

  it('stays relative in the same directory', () => {
    expect(relativeImport('routes', 'routes/payment.ts')).toBe('./payment.ts');
  });

  it('handles the no-directory case', () => {
    expect(relativeImport('', 'lib/payment.ts')).toBe('./lib/payment.ts');
  });
});
