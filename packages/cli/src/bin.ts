/**
 * The `better-payment` binary.
 *
 * The command surfaces are deliberately small and flag-driven so that they can be
 * scripted (`init --framework next-app --provider iyzico --yes --no-install`) and
 * tested without a terminal.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeOptions } from './args';
import { DOCTOR_OPTIONS, runDoctor } from './commands/doctor';
import { INIT_OPTIONS, runInit } from './commands/init';
import { LISTEN_OPTIONS, runListen } from './commands/listen';
import { createNodeIo } from './node-io';
import type { CliIo, CommandResult } from './types';

const COMMANDS = {
  init: {
    run: runInit,
    options: INIT_OPTIONS,
    summary: 'Generate the payment config, route and .env.example',
  },
  doctor: {
    run: runDoctor,
    options: DOCTOR_OPTIONS,
    summary: 'Check sandbox credentials, mode/base URL and the handler setup',
  },
  listen: {
    run: runListen,
    options: LISTEN_OPTIONS,
    summary: 'Open a public HTTPS tunnel and log callbacks safely',
  },
} as const;

type CommandName = keyof typeof COMMANDS;

function usage(name?: CommandName): string {
  const lines = ['better-payment · CLI for the better-payment library', ''];
  if (name) {
    lines.push(`Usage: better-payment ${name} [options]`, '');
    lines.push(...describeOptions(COMMANDS[name].options));
    return lines.join('\n');
  }
  lines.push('Usage: better-payment <command> [options]', '', 'Commands:');
  for (const [command, info] of Object.entries(COMMANDS)) {
    lines.push(`  ${command.padEnd(8)}${info.summary}`);
  }
  lines.push('', 'Run `better-payment <command> --help` for the options.', '');
  lines.push('Docs: https://better-payment.czaylabs.com/docs/guides/cli');
  return lines.join('\n');
}

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
      join(here, '..', 'package.json'),
      join(here, '..', '..', 'package.json'),
    ]) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (parsed.name === 'better-payment-cli' && parsed.version) return parsed.version;
      } catch {
        // try the next location
      }
    }
  } catch {
    // fall through
  }
  return '0.0.0';
}

export async function main(
  argv: string[],
  io: CliIo = createNodeIo(),
  overrides: Partial<
    Record<CommandName, (io: CliIo, args: string[]) => Promise<CommandResult>>
  > = {}
): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.stdout(usage());
    return 0;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    io.stdout(version());
    return 0;
  }
  if (!(command in COMMANDS)) {
    io.stderr(`error: unknown command '${command}'`);
    io.stderr(usage());
    return 2;
  }
  const name = command as CommandName;
  if (rest.includes('--help') || rest.includes('-h')) {
    io.stdout(usage(name));
    return 0;
  }
  const run = overrides[name] ?? COMMANDS[name].run;
  const result = await run(io, rest);
  return result.code;
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('/bin.js') ?? false;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
