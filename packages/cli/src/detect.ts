/**
 * Project detection: framework, adapter, package manager, TypeScript and where to
 * put the generated files. Pure functions over `CliIo`, so tests use an in-memory
 * filesystem.
 */
import { join } from 'node:path';
import type { CliIo } from './types';

export type Framework =
  'next-app' | 'next-pages' | 'express' | 'fastify' | 'hono' | 'elysia' | 'react-router' | 'node';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** `better-payment` subpath an adapter is imported from, and its handler factory */
export interface AdapterInfo {
  framework: Framework;
  subpath: string;
  factory: string;
}

export const FRAMEWORK_CHOICES: readonly Framework[] = [
  'next-app',
  'next-pages',
  'express',
  'fastify',
  'hono',
  'elysia',
  'react-router',
  'node',
];

export const ADAPTERS: Record<Framework, AdapterInfo> = {
  'next-app': { framework: 'next-app', subpath: 'better-payment/next', factory: 'toNextJsHandler' },
  'next-pages': {
    framework: 'next-pages',
    subpath: 'better-payment/express',
    factory: 'toNodeHandler',
  },
  express: { framework: 'express', subpath: 'better-payment/express', factory: 'toExpressHandler' },
  fastify: { framework: 'fastify', subpath: 'better-payment/fastify', factory: 'toFastifyPlugin' },
  hono: { framework: 'hono', subpath: 'better-payment/hono', factory: 'toHonoHandler' },
  elysia: { framework: 'elysia', subpath: 'better-payment/elysia', factory: 'toElysiaHandler' },
  'react-router': {
    framework: 'react-router',
    subpath: 'better-payment/react-router',
    factory: 'toReactRouterHandler',
  },
  node: { framework: 'node', subpath: 'better-payment/express', factory: 'toNodeHandler' },
};

interface PackageJsonShape {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  packageManager?: string;
}

export interface ProjectInfo {
  dir: string;
  /** `undefined` when there is no package.json (or it is not readable) */
  packageJson?: PackageJsonShape;
  /** Parse error text, kept for the doctor report */
  packageJsonError?: string;
  allDependencies: Record<string, string>;
  framework: Framework;
  /** How the framework was chosen */
  frameworkSource: 'flag' | 'package.json' | 'default';
  packageManager: PackageManager;
  /** `pnpm add better-payment` style install command */
  installCommand: string;
  isTypeScript: boolean;
  /** `ts` or `js`, from the project's own tooling */
  ext: 'ts' | 'js';
  /** The project has a top level `src` directory */
  hasSrcDir: boolean;
  /** Directory the generated route lives in, relative to `dir` (no leading slash) */
  appDir: string;
}

function depsOf(packageJson: PackageJsonShape | undefined): Record<string, string> {
  return {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
    ...(packageJson?.peerDependencies ?? {}),
  };
}

function exists(io: CliIo, relative: string): boolean {
  return io.fs.exists(join(io.cwd, relative));
}

function dirExists(io: CliIo, relative: string): boolean {
  return io.fs.isDirectory(join(io.cwd, relative));
}

/** Any of these directories exists in the project */
function hasAnyDir(io: CliIo, candidates: string[]): boolean {
  return candidates.some((candidate) => dirExists(io, candidate));
}

/**
 * Next.js ships two routing systems. A project with a `pages` directory and no
 * `app` directory uses the Pages Router (which gives Node.js `req`/`res` objects,
 * so it takes the `toNodeHandler` adapter); everything else is the App Router.
 */
function nextRouter(io: CliIo): 'next-app' | 'next-pages' {
  const appRouter = hasAnyDir(io, ['app', 'src/app']);
  const pagesRouter = hasAnyDir(io, ['pages', 'src/pages']);
  return pagesRouter && !appRouter ? 'next-pages' : 'next-app';
}

/** Detects the package manager from `packageManager`, then from lockfiles */
export function detectPackageManager(
  io: CliIo,
  packageJson: PackageJsonShape | undefined
): PackageManager {
  const declared = packageJson?.packageManager?.split('@')[0]?.trim();
  if (declared === 'pnpm' || declared === 'npm' || declared === 'yarn' || declared === 'bun') {
    return declared;
  }
  if (exists(io, 'pnpm-lock.yaml')) return 'pnpm';
  if (exists(io, 'bun.lockb') || exists(io, 'bun.lock')) return 'bun';
  if (exists(io, 'yarn.lock')) return 'yarn';
  return 'npm';
}

const ADD: Record<PackageManager, string> = {
  npm: 'npm install',
  pnpm: 'pnpm add',
  yarn: 'yarn add',
  bun: 'bun add',
};

/** Framework by dependency, then by the files that exist on disk */
export function detectFramework(io: CliIo, allDependencies: Record<string, string>): Framework {
  if (allDependencies.next) return nextRouter(io);
  if (allDependencies.hono) return 'hono';
  if (allDependencies.fastify) return 'fastify';
  if (allDependencies.express) return 'express';
  if (allDependencies.elysia) return 'elysia';
  if (
    allDependencies['react-router'] ||
    allDependencies['react-router-dom'] ||
    allDependencies['@react-router/node']
  ) {
    return 'react-router';
  }
  // No known framework: a plain node:http server (works with toNodeHandler)
  return 'node';
}

export function readPackageJson(io: CliIo): {
  packageJson?: PackageJsonShape;
  error?: string;
} {
  const raw = io.fs.readFile(join(io.cwd, 'package.json'));
  if (raw === undefined) return {};
  try {
    return { packageJson: JSON.parse(raw) as PackageJsonShape };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function detectProject(io: CliIo, frameworkFlag?: string): ProjectInfo {
  const { packageJson, error } = readPackageJson(io);
  const allDependencies = depsOf(packageJson);
  const packageManager = detectPackageManager(io, packageJson);
  const isTypeScript =
    Boolean(allDependencies.typescript) ||
    exists(io, 'tsconfig.json') ||
    exists(io, 'tsconfig.base.json');

  let framework: Framework;
  let frameworkSource: ProjectInfo['frameworkSource'] = 'default';
  if (frameworkFlag) {
    framework = frameworkFlag as Framework;
    frameworkSource = 'flag';
  } else {
    framework = detectFramework(io, allDependencies);
    frameworkSource = framework === 'node' ? 'default' : 'package.json';
  }

  return {
    dir: io.cwd,
    packageJson,
    packageJsonError: error,
    allDependencies,
    framework,
    frameworkSource,
    packageManager,
    installCommand: `${ADD[packageManager]} better-payment`,
    isTypeScript,
    ext: isTypeScript ? 'ts' : 'js',
    hasSrcDir: dirExists(io, 'src'),
    appDir: dirExists(io, 'src') ? 'src' : '',
  };
}

/** Where each generated file goes for this project (paths relative to the project) */
export function targetPaths(project: ProjectInfo, basePath: string): Record<string, string> {
  const src = project.hasSrcDir ? 'src/' : '';
  const ext = project.ext;
  const configPath = `${src}lib/payment.${ext}`;
  const routePaths: Record<Framework, string> = {
    'next-app': `${src}app${basePath}/[...payment]/route.${ext}`,
    'next-pages': `${src}pages${basePath}/[...payment].${ext}`,
    express: `${src}routes/payment.${ext}`,
    fastify: `${src}routes/payment.${ext}`,
    hono: `${src}routes/payment.${ext}`,
    elysia: `${src}routes/payment.${ext}`,
    'react-router': `${src}app/routes/api.pay.$.${ext}`,
    node: `${src}payment-server.${ext}`,
  };
  return { config: configPath, route: routePaths[project.framework] };
}

/** `/api/pay` -> `../../..` style import prefix from `fromDir` to `toPath` */
export function relativeImport(fromDir: string, toPath: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const to = toPath.split('/').filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  const up = from.length - common;
  const target = to.slice(common).join('/');
  const prefix = up === 0 ? './' : '../'.repeat(up);
  return `${prefix}${target}`;
}

/** Extension-free path of a module the CLI should import (`lib/payment.ts` -> abs path) */
export function resolveConfigPath(io: CliIo, given: string): string {
  return join(io.cwd, given);
}
