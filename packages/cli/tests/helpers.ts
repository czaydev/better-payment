/**
 * Test doubles for `CliIo`: an in-memory filesystem plus recorders, so the
 * commands run deterministically without touching global state.
 *
 * The fake filesystem keys files by their project-relative path: the commands
 * build absolute paths with `join(io.cwd, ...)`, so the keys are normalized by
 * stripping the cwd prefix.
 */
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { CliFileSystem, CliIo } from '../src/types';

export interface FakeIoOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  files?: Record<string, string>;
  dirs?: string[];
  fetch?: typeof fetch;
  now?: () => number;
}

export interface FakeIo extends CliIo {
  out: string[];
  err: string[];
  runs: { command: string; args: string[] }[];
  files: Map<string, string>;
}

export function fakeIo(options: FakeIoOptions = {}): FakeIo {
  const out: string[] = [];
  const err: string[] = [];
  const runs: { command: string; args: string[] }[] = [];
  const cwd = (options.cwd ?? '/project').replace(/\\/g, '/').replace(/\/+$/, '');
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const toKey = (path: string): string => {
    const normalized = path.replace(/\\/g, '/');
    return normalized.startsWith(`${cwd}/`) ? normalized.slice(cwd.length + 1) : normalized;
  };
  for (const [path, content] of Object.entries(options.files ?? {}))
    files.set(toKey(path), content);
  for (const dir of options.dirs ?? []) dirs.add(toKey(dir));

  const fs: CliFileSystem = {
    exists: (path) => files.has(toKey(path)) || dirs.has(toKey(path)),
    isDirectory: (path) => dirs.has(toKey(path)),
    readFile: (path) => files.get(toKey(path)),
    writeFile: (path, content) => void files.set(toKey(path), content),
    readDir: (path) =>
      [...files.keys(), ...dirs]
        .filter((entry) => entry.startsWith(`${toKey(path)}/`))
        .map((entry) => entry.slice(toKey(path).length + 1).split('/')[0])
        .filter(Boolean),
  };

  return {
    fs,
    env: options.env ?? {},
    cwd: options.cwd ?? '/project',
    nodeVersion: 'v24.18.0',
    dependencyVersion: () => undefined,
    stdout: (line) => void out.push(line),
    stderr: (line) => void err.push(line),
    loadModule: async () => {
      throw new Error('loadModule is not available in the fake io');
    },
    run: async (command, args) => {
      runs.push({ command, args });
      return { code: 0, output: 'installed' };
    },
    fetch: options.fetch ?? (async () => new Response('{}', { status: 200 })),
    prompt: async (_question, fallback) => fallback,
    now: options.now ?? (() => 1_700_000_000_000),
    out,
    err,
    runs,
    files,
  };
}

/**
 * A real-directory io for the end-to-end tests: a real fs under
 * `packages/cli/.tmp`, so the generated files resolve `better-payment` through
 * the vitest alias and can be imported.
 */
export function realDirIo(
  dir: string,
  options: {
    env?: Record<string, string | undefined>;
    runs?: { command: string; args: string[] }[];
  } = {}
): CliIo {
  const runs = options.runs ?? [];
  return {
    fs: {
      exists: (path) => existsSync(path),
      isDirectory: (path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      },
      readFile: (path) => {
        try {
          return readFileSync(path, 'utf8');
        } catch {
          return undefined;
        }
      },
      writeFile: (path, content) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      },
      readDir: () => [],
    },
    env: options.env ?? {},
    cwd: dir,
    nodeVersion: process.version,
    dependencyVersion: () => undefined,
    stdout: () => undefined,
    stderr: () => undefined,
    loadModule: async (path) => (await import(path)) as Record<string, unknown>,
    run: async (command, args) => {
      runs.push({ command, args });
      return { code: 0, output: 'ok' };
    },
    fetch: async () => new Response('{}', { status: 200 }),
    prompt: async (_question, fallback) => fallback,
    now: () => Date.now(),
  };
}

export function makeTempDir(prefix: string): string {
  return join(
    process.cwd(),
    '.tmp',
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** A Response with headers, for the fetch fakes */
export function httpResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, { status, headers });
}
