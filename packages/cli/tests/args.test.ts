import { describe, expect, it } from 'vitest';
import { boolOption, describeOptions, intOption, parseArgs, stringOption } from '../src/args';
import { INIT_OPTIONS } from '../src/commands/init';

describe('parseArgs', () => {
  it('reads --name value and --name=value', () => {
    const args = parseArgs(['--framework', 'express', '--base-path=/api/pay'], INIT_OPTIONS);
    expect(args.errors).toEqual([]);
    expect(stringOption(args, 'framework')).toBe('express');
    expect(stringOption(args, 'base-path')).toBe('/api/pay');
  });

  it('reads short options with a space and inline', () => {
    const args = parseArgs(['-f', 'hono', '-p', 'iyzico,paytr'], INIT_OPTIONS);
    expect(stringOption(args, 'framework')).toBe('hono');
    expect(stringOption(args, 'provider')).toBe('iyzico,paytr');

    const inline = parseArgs(['-fexpress'], INIT_OPTIONS);
    expect(stringOption(inline, 'framework')).toBe('express');
  });

  it('reads boolean flags and combined short flags', () => {
    const args = parseArgs(['--yes', '--no-install'], INIT_OPTIONS);
    expect(boolOption(args, 'yes')).toBe(true);
    expect(boolOption(args, 'no-install')).toBe(true);

    const combined = parseArgs(['-y'], INIT_OPTIONS);
    expect(boolOption(combined, 'yes')).toBe(true);
  });

  it('reports unknown options and missing values', () => {
    const unknown = parseArgs(['--nope', 'x'], INIT_OPTIONS);
    expect(unknown.errors).toEqual(['Unknown option --nope']);

    const missing = parseArgs(['--framework'], INIT_OPTIONS);
    expect(missing.errors).toEqual(['--framework needs a value']);
  });

  it('rejects a value for a boolean flag', () => {
    const args = parseArgs(['--yes=1'], INIT_OPTIONS);
    expect(args.errors).toEqual(['--yes is a flag and takes no value']);
  });

  it('enforces choices', () => {
    const args = parseArgs(['--framework', 'angular'], INIT_OPTIONS);
    expect(args.errors[0]).toContain('--framework must be one of');
  });

  it('applies defaults and honours --', () => {
    const args = parseArgs([], { port: { type: 'string', description: 'port', default: '3000' } });
    expect(stringOption(args, 'port')).toBe('3000');

    const rest = parseArgs(['a', 'b', '--', '--flag', 'c'], {
      port: { type: 'string', description: 'port' },
    });
    expect(rest.command).toBe('a');
    expect(rest.positionals).toEqual(['b']);
    expect(rest.rest).toEqual(['--flag', 'c']);
  });

  it('marks --help and -h', () => {
    expect(parseArgs(['--help'], INIT_OPTIONS).help).toBe(true);
    expect(parseArgs(['-h'], INIT_OPTIONS).help).toBe(true);
    expect(parseArgs(['init', '-h'], INIT_OPTIONS).help).toBe(true);
  });

  it('parses integer options', () => {
    const args = parseArgs(['--port', '3000', '--proxy-port', 'x'], {
      port: { type: 'string', description: 'p' },
      'proxy-port': { type: 'string', description: 'pp' },
    });
    expect(intOption(args, 'port')).toBe(3000);
    expect(intOption(args, 'proxy-port')).toBeUndefined();
    expect(intOption(args, 'absent')).toBeUndefined();
  });

  it('renders the help block', () => {
    const lines = describeOptions(INIT_OPTIONS);
    expect(lines.some((line) => line.includes('--framework') && line.includes('next-app'))).toBe(
      true
    );
  });
});
