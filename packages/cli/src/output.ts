/**
 * Plain-text terminal output. No colours, no ANSI, no dependencies: the output is
 * meant to be read in a terminal, in CI logs and by `grep`.
 */
import type { Check, CheckStatus, CliIo } from './types';

const MARK: Record<CheckStatus, string> = {
  pass: 'ok  ',
  warn: 'warn',
  fail: 'FAIL',
  skip: 'skip',
};

export class Report {
  private readonly lines: string[] = [];

  log(message: string): void {
    this.lines.push(message);
  }

  section(title: string): void {
    this.lines.push(`# ${title}`);
  }

  item(prefix: string, message: string): void {
    this.lines.push(`${prefix} ${message}`);
  }

  /** Renders the collected lines. Empty sections stay out. */
  toString(): string {
    return this.lines.join('\n');
  }

  write(io: CliIo): void {
    const text = this.toString();
    if (text) for (const line of text.split('\n')) io.stdout(line);
  }
}

/** Writes one check in the `ok  node-version  ...` shape used by `doctor` */
export function writeCheck(io: CliIo, check: Check): void {
  io.stdout(`${MARK[check.status]} ${check.id}  ${check.message}`);
  for (const detail of check.details ?? []) io.stdout(`       ${detail}`);
  if (check.hint) io.stdout(`       hint: ${check.hint}`);
}

/** Counts used for the summary line and the exit code */
export function countStatuses(checks: Check[]): Record<CheckStatus, number> {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

/** Exit code 1 when any check failed, so CI can gate on `doctor` */
export function exitCodeFor(checks: Check[]): number {
  return checks.some((check) => check.status === 'fail') ? 1 : 0;
}
