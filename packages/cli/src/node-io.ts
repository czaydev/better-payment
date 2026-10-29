/**
 * The real `CliIo`: Node's filesystem, environment and module loader.
 *
 * Everything else in the CLI talks to the `CliIo` interface, so tests inject an
 * in-memory filesystem, a fake environment and a fake module loader instead of
 * touching global state.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CliFileSystem, CliIo, RunResult } from './types';

/** Handles `\` and `/` alike, which matters when comparing paths on Windows */
function normalize(path: string): string {
  return path.replace(/\\/g, '/');
}

export const nodeFileSystem: CliFileSystem = {
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
    writeFileSync(path, content, 'utf8');
  },
  readDir: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
};

/** Reads `<cwd>/node_modules/<name>/package.json` without resolving through Node */
function dependencyVersionOf(cwd: string) {
  return (name: string): string | undefined => {
    const raw = nodeFileSystem.readFile(normalize(join(cwd, 'node_modules', name, 'package.json')));
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      const version = (parsed as { version?: unknown }).version;
      return typeof version === 'string' ? version : undefined;
    } catch {
      return undefined;
    }
  };
}

/**
 * Imports a config module. `.ts` files work on Node 22.18+ / 23+ (type stripping is
 * on by default); older runtimes raise `ERR_UNKNOWN_FILE_EXTENSION`, which the
 * caller turns into an actionable message.
 */
export async function loadModuleByPath(path: string): Promise<Record<string, unknown>> {
  const imported = (await import(pathToFileURL(resolve(path)).href)) as unknown;
  return (imported ?? {}) as Record<string, unknown>;
}

async function runCommand(command: string, args: string[]): Promise<RunResult> {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  if (result.error) {
    return { code: 1, output: result.error.message };
  }
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

async function askQuestion(question: string, fallback: string): Promise<string> {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [${fallback}] `);
    return answer.trim() === '' ? fallback : answer.trim();
  } finally {
    rl.close();
  }
}

/** Everything except `loadModule`/`run`/`prompt` is synchronous and cheap */
export function createNodeIo(cwd: string = process.cwd()): CliIo {
  const absolute = resolve(cwd);
  return {
    fs: nodeFileSystem,
    env: process.env as Record<string, string | undefined>,
    cwd: absolute,
    nodeVersion: process.version,
    dependencyVersion: dependencyVersionOf(absolute),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
    loadModule: loadModuleByPath,
    run: runCommand,
    fetch: (input, init) => globalThis.fetch(input, init),
    prompt: askQuestion,
    now: () => Date.now(),
  };
}

/** Absolute path of this CLI's own directory (`dist` or `src`), for `--version` */
export function cliDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export { normalize as normalizePath };
