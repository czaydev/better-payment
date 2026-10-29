/**
 * Zero-dependency argument parsing.
 *
 * The CLI deliberately does not pull in a command framework: a hand-rolled parser
 * keeps `better-payment-cli` dependency-free apart from `better-payment` itself,
 * which is what the repository's `no-runtime-deps` review feedback asks for.
 *
 * Supported forms: `--name value`, `--name=value`, `--flag`, `-n value`, `-nf`
 * (combined short flags), `--` (everything after it is passed through in `rest`).
 */

export interface OptionSpec {
  /** `string` options take a value; `boolean` options are flags. Default: string */
  type?: 'string' | 'boolean';
  /** Single-letter alias, without the dash */
  alias?: string;
  /** Restricts the value; the error message lists them */
  choices?: readonly string[];
  /** Shown in `--help` */
  description: string;
  /** Shown in `--help` for string options */
  placeholder?: string;
  default?: string;
}

export interface ParsedArgs {
  /** First positional argument: the command name */
  command?: string;
  /** Remaining positionals */
  positionals: string[];
  /** Values by long option name (`true` for flags) */
  options: Record<string, string | boolean>;
  /** Usage errors; when non-empty the command must not run */
  errors: string[];
  /** `-h` / `--help` anywhere in the arguments */
  help: boolean;
  /** Arguments after `--`, passed through untouched */
  rest: string[];
}

function optionIndex(specs: Record<string, OptionSpec>): Map<string, string> {
  const byName = new Map<string, string>();
  for (const [name, spec] of Object.entries(specs)) {
    byName.set(name, name);
    if (spec.alias) byName.set(spec.alias, name);
  }
  return byName;
}

export function parseArgs(argv: string[], specs: Record<string, OptionSpec>): ParsedArgs {
  const byName = optionIndex(specs);
  const result: ParsedArgs = {
    positionals: [],
    options: {},
    errors: [],
    help: false,
    rest: [],
  };

  /** Stores a value, or records a `choices` violation */
  const store = (name: string, value: string): void => {
    const spec = specs[name];
    if (spec.choices && !spec.choices.includes(value)) {
      result.errors.push(`--${name} must be one of: ${spec.choices.join(', ')}`);
      return;
    }
    result.options[name] = value;
  };

  let noMoreOptions = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];

    if (noMoreOptions) {
      result.rest.push(token);
      continue;
    }
    if (token === '--') {
      noMoreOptions = true;
      continue;
    }

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const rawName = eq === -1 ? token.slice(2) : token.slice(2, eq);
      if (rawName === 'help') {
        result.help = true;
        continue;
      }
      const name = byName.get(rawName);
      if (!name) {
        result.errors.push(`Unknown option --${rawName}`);
        continue;
      }
      const spec = specs[name];
      if (eq !== -1) {
        if (spec.type === 'boolean') {
          result.errors.push(`--${name} is a flag and takes no value`);
          continue;
        }
        store(name, token.slice(eq + 1));
        continue;
      }
      if (spec.type === 'boolean') {
        result.options[name] = true;
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        result.errors.push(`--${name} needs a value`);
        continue;
      }
      store(name, value);
      index++;
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const letters = token.slice(1);
      for (let i = 0; i < letters.length; i++) {
        const letter = letters[i];
        if (letter === 'h') {
          result.help = true;
          continue;
        }
        const name = byName.get(letter);
        if (!name) {
          result.errors.push(`Unknown option -${letter}`);
          continue;
        }
        const spec = specs[name];
        if (spec.type === 'boolean') {
          result.options[name] = true;
          continue;
        }
        // `-p3000` and `-p 3000` both work
        const inline = letters.slice(i + 1);
        const value = inline || argv[index + 1];
        if (!value || (!inline && value.startsWith('-'))) {
          result.errors.push(`-${letter} needs a value`);
          break;
        }
        store(name, value);
        if (inline) break;
        index++;
        break;
      }
      continue;
    }

    if (result.command === undefined) result.command = token;
    else result.positionals.push(token);
  }

  for (const [name, spec] of Object.entries(specs)) {
    if (result.options[name] === undefined && spec.default !== undefined) {
      result.options[name] = spec.default;
    }
  }
  return result;
}

/** Reads a string option, falling back to `fallback` */
export function stringOption(
  args: ParsedArgs,
  name: string,
  fallback?: string
): string | undefined {
  const value = args.options[name];
  return typeof value === 'string' && value !== '' ? value : fallback;
}

/** Reads a boolean flag */
export function boolOption(args: ParsedArgs, name: string): boolean {
  return args.options[name] === true;
}

/** Reads an integer option; `undefined` when absent or not a number */
export function intOption(args: ParsedArgs, name: string): number | undefined {
  const value = args.options[name];
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Renders the `Options:` block of a help screen */
export function describeOptions(specs: Record<string, OptionSpec>): string[] {
  return Object.entries(specs).map(([name, spec]) => {
    const left = `  --${name}${spec.alias ? `, -${spec.alias}` : ''}${
      spec.type === 'boolean' ? '' : ` <${spec.placeholder ?? 'value'}>`
    }`;
    const right = `${spec.description}${
      spec.default !== undefined ? ` (default: ${spec.default})` : ''
    }${spec.choices ? ` [${spec.choices.join(', ')}]` : ''}`;
    return `${left.padEnd(28)}${right}`;
  });
}
