/**
 * `better-payment init`
 *
 * Detects the framework and package manager, asks for the providers, and writes
 * three files: the lazy `lib/payment.ts`, the framework route and `.env.example`.
 * Existing files are never overwritten without `--force`, and no credential value
 * is ever written: `.env.example` only contains variable names.
 */
import { join } from 'node:path';
import { boolOption, parseArgs, stringOption, type OptionSpec } from '../args';
import { detectProject, FRAMEWORK_CHOICES, targetPaths, type Framework } from '../detect';
import { mountHint, renderConfig, renderEnvExample, renderRoute } from '../templates';
import {
  KNOWN_PROVIDER_IDS,
  parseProviderList,
  PROVIDER_SPECS,
  unknownProviders,
} from '../provider-specs';
import type { CliIo, CommandResult } from '../types';

export const INIT_OPTIONS: Record<string, OptionSpec> = {
  framework: {
    type: 'string',
    alias: 'f',
    choices: FRAMEWORK_CHOICES,
    description: 'Framework to generate the route for',
    placeholder: 'next-app|express|fastify|hono',
  },
  provider: {
    type: 'string',
    alias: 'p',
    description: 'Comma-separated providers',
    placeholder: 'iyzico,paytr',
  },
  providers: {
    type: 'string',
    description: 'Comma-separated providers (alias of --provider)',
    placeholder: 'iyzico,paytr',
  },
  'base-path': {
    type: 'string',
    description: 'Handler base path',
    default: '/api/pay',
  },
  yes: { type: 'boolean', alias: 'y', description: 'Accept the detected defaults' },
  install: { type: 'boolean', description: 'Install better-payment after writing the files' },
  'no-install': { type: 'boolean', description: 'Never run a package manager (default)' },
  force: { type: 'boolean', description: 'Overwrite generated files that already exist' },
};

function normalizeFramework(value: string | undefined): Framework | undefined {
  if (!value) return undefined;
  if (value === 'next') return 'next-app';
  return FRAMEWORK_CHOICES.includes(value as Framework) ? (value as Framework) : undefined;
}

export async function runInit(io: CliIo, argv: string[]): Promise<CommandResult> {
  const args = parseArgs(argv, INIT_OPTIONS);
  if (args.errors.length > 0) {
    for (const error of args.errors) io.stderr(`error: ${error}`);
    return { code: 2 };
  }

  const frameworkFlag = normalizeFramework(stringOption(args, 'framework'));
  if (stringOption(args, 'framework') && !frameworkFlag) {
    io.stderr(`error: --framework must be one of: ${FRAMEWORK_CHOICES.join(', ')}`);
    return { code: 2 };
  }

  const project = detectProject(io, frameworkFlag);
  const basePath =
    stringOption(args, 'base-path', '/api/pay')!
      .replace(/\/+$/, '')
      .replace(/^([^/])/, '/$1') || '/api/pay';
  if (!basePath.startsWith('/') || basePath.includes('..')) {
    io.stderr('error: --base-path must be an absolute path without ".."');
    return { code: 2 };
  }

  const given = parseProviderList(
    stringOption(args, 'provider') ?? stringOption(args, 'providers')
  );
  const unknown = unknownProviders(given);
  if (unknown.length > 0) {
    io.stderr(
      `error: unknown provider(s): ${unknown.join(', ')} (supported: ${KNOWN_PROVIDER_IDS.join(', ')})`
    );
    return { code: 2 };
  }

  const yes = boolOption(args, 'yes');
  let providers = given;
  if (providers.length === 0) {
    if (!yes) {
      const answer = await io.prompt(
        `Providers (comma-separated: ${KNOWN_PROVIDER_IDS.join(', ')})`,
        'iyzico'
      );
      providers = parseProviderList(answer);
    }
    if (providers.length === 0) providers = ['iyzico'];
  }
  const unsupported = unknownProviders(parseProviderList(providers.join(',')));
  if (unsupported.length > 0) {
    io.stderr(`error: unknown provider(s): ${unsupported.join(', ')}`);
    return { code: 2 };
  }

  const targets = targetPaths(project, basePath);
  const files: { path: string; content: string; label: string }[] = [
    {
      path: targets.config,
      content: renderConfig({
        project,
        providers,
        basePath,
        configPath: targets.config,
        routePath: targets.route,
      }),
      label: 'payment config',
    },
    {
      path: targets.route,
      content: renderRoute({
        project,
        providers,
        basePath,
        configPath: targets.config,
        routePath: targets.route,
      }),
      label: 'route handler',
    },
    {
      path: '.env.example',
      content: renderEnvExample({
        project,
        providers,
        basePath,
        configPath: targets.config,
        routePath: targets.route,
      }),
      label: 'env template',
    },
  ];

  const existing = files.filter((file) => io.fs.exists(join(io.cwd, file.path)));
  if (existing.length > 0 && !boolOption(args, 'force')) {
    io.stderr('error: refusing to overwrite existing files:');
    for (const file of existing) io.stderr(`  ${file.path}`);
    io.stderr('Re-run with --force to overwrite them.');
    return { code: 1 };
  }

  for (const file of files) io.fs.writeFile(join(io.cwd, file.path), file.content);

  const context = {
    project,
    providers,
    basePath,
    configPath: targets.config,
    routePath: targets.route,
  };
  io.stdout(`better-payment init · ${project.framework} · ${project.packageManager}`);
  io.stdout('');
  for (const file of files) io.stdout(`created  ${file.path}  (${file.label})`);
  io.stdout('');
  io.stdout(`health   ${basePath}/health`);
  io.stdout(`callback ${basePath}/<provider>/payment/complete-3ds`);
  io.stdout(mountHint(context));
  io.stdout('');
  io.stdout('Next steps:');
  io.stdout('  1. Copy .env.example to .env.local (Next.js) or .env, then paste the');
  io.stdout('     sandbox credentials from each provider panel into that file.');
  io.stdout(
    `     The generated code reads: ${providers
      .map((id) => `${id} (${PROVIDER_SPECS[id].fields.map((field) => field.env).join(', ')})`)
      .join('; ')}`
  );
  io.stdout('  2. Credentials live only in the env file; .env.example keeps placeholders.');
  io.stdout(`  3. Install the library with: ${project.installCommand}`);
  if (boolOption(args, 'install')) {
    const command = project.installCommand.split(' ');
    const result = await io.run(command[0], command.slice(1));
    io.stdout(result.code === 0 ? 'installed better-payment' : `install failed: ${result.output}`);
    return { code: result.code === 0 ? 0 : 1 };
  }
  if (!boolOption(args, 'no-install')) {
    io.stdout('     (init does not run installs; pass --install to run it now)');
  }
  if (project.packageJson === undefined) {
    io.stdout('  note: no package.json here; run init from your project root.');
  }
  return { code: 0 };
}
