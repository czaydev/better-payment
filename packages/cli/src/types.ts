/**
 * Shared types for the `better-payment` CLI.
 *
 * Every command runs against an injected `CliIo`: the filesystem, the environment,
 * the module loader and the process spawner are passed in, so the commands are
 * deterministic and unit-testable without touching real global state.
 */
import type { BetterPaymentHandler, BetterPaymentHandlerOptions } from 'better-payment';

/** Result status of one `doctor` check */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface Check {
  /** Stable identifier, e.g. `node-version`. Used by `--json` output and tests. */
  id: string;
  status: CheckStatus;
  /** One-line summary. Never contains a secret value. */
  message: string;
  details?: string[];
  /** What to do about it */
  hint?: string;
}

export interface CommandResult {
  /** Process exit code: 0 ok, 1 a check or step failed, 2 bad usage */
  code: number;
  checks?: Check[];
}

export interface CliFileSystem {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  /** `undefined` when the file is missing or unreadable */
  readFile(path: string): string | undefined;
  writeFile(path: string, content: string): void;
  /** Entry names of a directory; empty when it does not exist */
  readDir(path: string): string[];
}

export interface RunResult {
  code: number;
  /** Combined stdout and stderr of the command */
  output: string;
}

export interface CliIo {
  fs: CliFileSystem;
  /** The environment the commands read. Never printed; only `set` / `missing` / masked. */
  env: Record<string, string | undefined>;
  /** Absolute project directory */
  cwd: string;
  /** `process.version`, e.g. `v22.11.0` */
  nodeVersion: string;
  /** `node_modules` lookup of a dependency's installed version, or undefined */
  dependencyVersion(name: string): string | undefined;
  stdout(line: string): void;
  stderr(line: string): void;
  /** Imports a config module (`.ts`, `.js`, `.mjs`, `.cjs`) by absolute path */
  loadModule(path: string): Promise<Record<string, unknown>>;
  /** Runs an external command (`npm`, `pnpm`, ...) */
  run(command: string, args: string[]): Promise<RunResult>;
  /**
   * `fetch` used by `doctor` for the provider probes. Tests inject a fake so no
   * request ever leaves the process.
   */
  fetch: typeof fetch;
  /** Interactive question with a default answer */
  prompt(question: string, fallback: string): Promise<string>;
  /** Epoch milliseconds, for durations in the `listen` log */
  now(): number;
}

/** A payment instance, as produced by `betterPayment()` (structurally typed) */
export interface PaymentLike {
  getEnabledProviders(): string[];
  createHandler(options?: BetterPaymentHandlerOptions): BetterPaymentHandler;
  readonly handler: BetterPaymentHandler;
  readonly context?: { readonly mode?: 'sandbox' | 'production' };
}

/** The parts of a config module the CLI uses */
export interface LoadedConfig {
  path: string;
  payment: PaymentLike;
  /** Handler options from `export const handlerOptions` or `config.handler` */
  handlerOptions?: BetterPaymentHandlerOptions;
  /** The `mode` literal of `export const config`, when the module exports it */
  mode?: 'sandbox' | 'production';
  /** Exported names, for error messages */
  exported: string[];
}

export interface ConfigLoadError {
  path: string;
  /** Short reason shown to the user */
  message: string;
  /** `NodeError.code` when the failure comes from the loader itself */
  nodeCode?: string;
  exported?: string[];
}
