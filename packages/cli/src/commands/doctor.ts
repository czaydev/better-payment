/**
 * `better-payment doctor`
 *
 * Loads `lib/payment.ts` (or reads the environment), runs one harmless sandbox
 * query per provider, and reports whether the credentials were accepted, which
 * mode and base URL were used, and the clock skew for providers that sign a
 * timestamp. It also checks the handler: exposed actions, the `authorize` hook
 * for privileged actions, and in-memory callback deduplication.
 *
 * It never sends a payment, never sends card data, and never prints a secret.
 */
import { join } from 'node:path';
import { boolOption, parseArgs, stringOption, type OptionSpec } from '../args';
import {
  CALLBACK_HANDLER_ACTIONS,
  DEFAULT_HANDLER_ACTIONS,
  PRIVILEGED_HANDLER_ACTIONS,
  type BetterPaymentHandler,
  type BetterPaymentHandlerOptions,
} from 'better-payment';
import {
  classifyProbe,
  clockSkewSeconds,
  probeProvider,
  resolveProvider,
  sanitizeMessage,
  signsTimestamp,
  type ResolvedProvider,
} from '../probes';
import { KNOWN_PROVIDER_IDS, parseProviderList, unknownProviders } from '../provider-specs';
import { countStatuses, exitCodeFor, writeCheck } from '../output';
import type { Check, CliIo, CommandResult } from '../types';

export const DOCTOR_OPTIONS: Record<string, OptionSpec> = {
  config: {
    type: 'string',
    alias: 'c',
    description: 'Config module that exports getBetterPayment/handlerOptions',
    placeholder: 'lib/payment.ts',
  },
  provider: {
    type: 'string',
    alias: 'p',
    description: 'Comma-separated providers to check',
    placeholder: 'iyzico,paytr',
  },
  mode: {
    type: 'string',
    description: 'Mode to probe',
    choices: ['sandbox', 'production'],
  },
  json: { type: 'boolean', description: 'Print the checks as JSON' },
};

interface LoadedDoctorConfig {
  path?: string;
  mode?: 'sandbox' | 'production';
  providers?: string[];
  handlerOptions?: BetterPaymentHandlerOptions;
  handler?: BetterPaymentHandler;
  handlerWarnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHandlerOptions(value: unknown): value is BetterPaymentHandlerOptions {
  return isRecord(value);
}

function modeOf(value: unknown): 'sandbox' | 'production' | undefined {
  return value === 'sandbox' || value === 'production' ? value : undefined;
}

/** Extracts the mode, handler options and handler from a config module */
export async function loadDoctorConfig(
  io: CliIo,
  configPath?: string
): Promise<{ config: LoadedDoctorConfig; error?: string }> {
  const config: LoadedDoctorConfig = {
    handlerWarnings: [],
    ...(configPath ? { path: configPath } : {}),
  };
  if (!configPath) {
    const envMode = modeOf(io.env.PAYMENT_MODE);
    if (envMode) config.mode = envMode;
    return { config };
  }

  let exports: Record<string, unknown>;
  try {
    exports = await io.loadModule(join(io.cwd, configPath));
  } catch (error) {
    const nodeError = error as { code?: unknown; message?: unknown };
    const code = typeof nodeError.code === 'string' ? nodeError.code : undefined;
    const hint =
      code === 'ERR_UNKNOWN_FILE_EXTENSION'
        ? 'Use Node.js >= 22.18 (TypeScript type stripping) or point --config at the built .js file.'
        : undefined;
    return {
      config,
      error: `${configPath} could not be imported: ${
        typeof nodeError.message === 'string' ? nodeError.message : String(error)
      }${hint ? ` — ${hint}` : ''}`,
    };
  }

  const paymentConfig = isRecord(exports.paymentConfig) ? exports.paymentConfig : undefined;
  const legacyConfig = isRecord(exports.config) ? exports.config : undefined;
  config.mode =
    modeOf(exports.mode) ??
    modeOf(paymentConfig?.mode) ??
    modeOf(legacyConfig?.mode) ??
    modeOf(io.env.PAYMENT_MODE);

  const options = exports.handlerOptions ?? legacyConfig?.handler ?? paymentConfig?.handler;
  if (isHandlerOptions(options)) config.handlerOptions = options;

  const direct = exports.payment;
  if (
    isRecord(direct) &&
    typeof (direct as { getEnabledProviders?: unknown }).getEnabledProviders === 'function' &&
    typeof (direct as { createHandler?: unknown }).createHandler === 'function'
  ) {
    const payment = direct as {
      getEnabledProviders(): string[];
      createHandler(options?: BetterPaymentHandlerOptions): BetterPaymentHandler;
      handler: BetterPaymentHandler;
      context?: { mode?: 'sandbox' | 'production' };
    };
    config.handler = payment.handler ?? payment.createHandler(config.handlerOptions);
    config.providers = payment.getEnabledProviders();
    config.mode = config.mode ?? modeOf(payment.context?.mode);
  } else {
    const factory = [exports.getBetterPayment, exports.getPayment, exports.createPayment].find(
      (value): value is () => unknown => typeof value === 'function'
    );
    if (factory) {
      try {
        const created = factory();
        if (
          isRecord(created) &&
          typeof (created as { getEnabledProviders?: unknown }).getEnabledProviders === 'function'
        ) {
          const payment = created as {
            getEnabledProviders(): string[];
            handler: BetterPaymentHandler;
            context?: { mode?: 'sandbox' | 'production' };
          };
          config.handler = payment.handler;
          config.providers = payment.getEnabledProviders();
          config.mode = config.mode ?? modeOf(payment.context?.mode);
        } else {
          config.handlerWarnings.push(
            'getBetterPayment() did not return a payment object; handler checks were skipped'
          );
        }
      } catch (error) {
        config.handlerWarnings.push(
          `getBetterPayment() threw while loading the config: ${sanitizeMessage(
            error instanceof Error ? error.message : String(error),
            []
          )}`
        );
      }
    }
  }

  const providerKeys = isRecord(paymentConfig?.providers)
    ? Object.keys(paymentConfig.providers)
    : undefined;
  config.providers = config.providers ?? providerKeys;

  return { config };
}

function isPrivileged(action: string): boolean {
  return (PRIVILEGED_HANDLER_ACTIONS as string[]).includes(action);
}

/** Checks `allowedActions`, `authorize` and callback dedup, without sending requests */
export function handlerChecks(options: BetterPaymentHandlerOptions | undefined): Check[] {
  if (!options) {
    return [
      {
        id: 'handler-options',
        status: 'warn',
        message: 'config does not export handlerOptions, so the handler cannot be inspected safely',
        hint: 'Export `handlerOptions` (init generates it) and run doctor with --config.',
      },
      {
        id: 'handler-idempotency',
        status: 'warn',
        message: 'callback deduplication cannot be verified without handlerOptions',
        hint: 'The handler default is an in-memory store, per process.',
      },
    ];
  }

  const checks: Check[] = [];
  const allowed =
    options.allowedActions === 'all' ? 'all' : (options.allowedActions ?? DEFAULT_HANDLER_ACTIONS);
  const privileged =
    allowed === 'all'
      ? (PRIVILEGED_HANDLER_ACTIONS as string[])
      : allowed.filter((action) => isPrivileged(action));
  const callbacks = (allowed === 'all' ? CALLBACK_HANDLER_ACTIONS : allowed).filter((action) =>
    (CALLBACK_HANDLER_ACTIONS as string[]).includes(action)
  );

  if (allowed === 'all') {
    checks.push({
      id: 'handler-actions',
      status: options.authorize ? 'warn' : 'fail',
      message: options.authorize
        ? "allowedActions is 'all'; every privileged action is exposed behind authorize"
        : "allowedActions is 'all' without an authorize hook",
      hint: 'List the actions you need instead of exposing everything.',
    });
  } else if (privileged.length > 0) {
    checks.push({
      id: 'handler-actions',
      status: options.authorize ? 'pass' : 'fail',
      message: `privileged actions enabled: ${privileged.join(', ')}`,
      ...(options.authorize
        ? { details: ['authorize is set, so callers must be authenticated before these run.'] }
        : {
            hint: 'Refund, cancel and card actions need an authorize hook; the handler refuses to start without one.',
          }),
    });
  } else {
    checks.push({
      id: 'handler-actions',
      status: 'pass',
      message: 'only callback and read-only actions are exposed',
    });
  }

  checks.push({
    id: 'handler-authorize',
    status: options.authorize
      ? 'pass'
      : privileged.length > 0 || allowed === 'all'
        ? 'fail'
        : 'pass',
    message: options.authorize
      ? 'authorize hook is set'
      : 'no authorize hook; privileged actions are not exposed, so this is safe',
    ...(options.authorize
      ? {
          details: [
            `Callbacks (${callbacks.join(', ') || 'none'}) are public by design; let them through in the hook and verify the provider signature downstream, which the handler already does.`,
          ],
        }
      : {}),
  });

  const idempotency = options.idempotency;
  if (idempotency === false) {
    checks.push({
      id: 'handler-idempotency',
      status: 'warn',
      message: 'callback deduplication is disabled',
      hint: 'Repeated PayTR notifications would be processed again. Turn idempotency on.',
    });
  } else if (idempotency?.store) {
    checks.push({
      id: 'handler-idempotency',
      status: 'pass',
      message: 'callbacks deduplicate through the configured shared store',
    });
  } else {
    checks.push({
      id: 'handler-idempotency',
      status: 'warn',
      message: 'callback deduplication uses the in-memory store (per process)',
      hint: 'With more than one instance, use a shared store (Redis/DB) for idempotency.store.',
    });
  }

  return checks;
}

function providerCheckBase(resolved: ResolvedProvider): Check {
  return resolved.modeMismatch
    ? {
        id: `${resolved.spec.id}-mode`,
        status: 'fail',
        message: `mode is '${resolved.mode}' but the base URL is the ${resolved.modeMismatch} host`,
        details: [resolved.baseUrl],
        hint: `Set PAYMENT_MODE=${resolved.modeMismatch} or fix ${resolved.spec.baseUrlEnv}.`,
      }
    : {
        id: `${resolved.spec.id}-mode`,
        status: 'pass',
        message: `${resolved.mode} · ${resolved.baseUrl}`,
      };
}

/** Blocking credential problem, or undefined when the probe can run */
function credentialProblem(resolved: ResolvedProvider): Check | undefined {
  const { spec, missing, placeholders } = resolved;
  if (missing.length > 0) {
    return {
      id: `${spec.id}-credentials`,
      status: 'skip',
      message: `missing ${missing.join(', ')}`,
      hint: 'Set the variables in .env (see .env.example) and load them before running doctor.',
    };
  }
  if (placeholders.length > 0) {
    return {
      id: `${spec.id}-credentials`,
      status: 'fail',
      message: `placeholder values: ${placeholders.join(', ')}`,
      hint: 'Paste the sandbox credentials from the provider panel.',
    };
  }
  return undefined;
}

export async function runDoctor(io: CliIo, argv: string[]): Promise<CommandResult> {
  const args = parseArgs(argv, DOCTOR_OPTIONS);
  if (args.errors.length > 0) {
    for (const error of args.errors) io.stderr(`error: ${error}`);
    return { code: 2 };
  }

  const loaded = await loadDoctorConfig(io, stringOption(args, 'config'));
  const checks: Check[] = [];

  if (loaded.error) {
    checks.push({ id: 'config', status: 'fail', message: loaded.error });
  } else if (loaded.config.path) {
    checks.push({ id: 'config', status: 'pass', message: `loaded ${loaded.config.path}` });
  } else {
    checks.push({
      id: 'config',
      status: 'pass',
      message: 'no --config; reading credentials, mode and base URLs from the environment',
    });
  }

  const mode =
    modeOf(stringOption(args, 'mode')) ??
    loaded.config.mode ??
    modeOf(io.env.PAYMENT_MODE) ??
    'sandbox';

  const requested = parseProviderList(
    stringOption(args, 'provider') ?? stringOption(args, 'providers')
  );
  const unknown = unknownProviders(requested);
  if (unknown.length > 0) {
    io.stderr(`error: unknown provider(s): ${unknown.join(', ')}`);
    return { code: 2 };
  }
  let ids = requested.length > 0 ? requested : (loaded.config.providers ?? []);
  if (ids.length === 0) {
    // Providers whose variables are at least partly present, otherwise all four
    const configured = KNOWN_PROVIDER_IDS.filter((id) =>
      (Object.keys(io.env) as string[]).some((name) =>
        name.startsWith(id.toUpperCase().replace(/-/g, '_'))
      )
    );
    ids = configured.length > 0 ? configured : KNOWN_PROVIDER_IDS;
  }
  ids = [...new Set(ids.filter((id) => KNOWN_PROVIDER_IDS.includes(id)))];

  for (const id of ids) {
    const resolved = resolveProvider(io, id, mode);
    checks.push(providerCheckBase(resolved));
    const problem = credentialProblem(resolved);
    if (problem) {
      checks.push(problem);
      continue;
    }

    const observation = await probeProvider(io, resolved);
    const classification = classifyProbe(observation);
    checks.push({
      id: `${id}-credentials`,
      status: classification.status,
      message: classification.message,
      ...(classification.details.length ? { details: classification.details } : {}),
    });

    if (signsTimestamp(id)) {
      const last = observation.http[observation.http.length - 1];
      const skew = clockSkewSeconds(last?.date, io.now());
      if (skew === undefined) {
        checks.push({
          id: `${id}-clock`,
          status: 'skip',
          message: 'no Date header from the provider; clock skew unknown',
        });
      } else if (Math.abs(skew) > 60) {
        checks.push({
          id: `${id}-clock`,
          status: 'warn',
          message: `provider clock differs by ${skew}s`,
          hint: 'Akbank signs requestDateTime; sync the machine clock (NTP) before testing 3D Secure.',
        });
      } else {
        checks.push({
          id: `${id}-clock`,
          status: 'pass',
          message: `clock skew ${skew}s (signed requestDateTime)`,
        });
      }
    }
  }

  checks.push(...handlerChecks(loaded.config.handlerOptions));
  for (const warning of loaded.config.handlerWarnings) {
    checks.push({ id: 'handler', status: 'warn', message: warning });
  }

  if (loaded.config.handler) {
    const basePath = loaded.config.handlerOptions?.basePath ?? '/api/pay';
    try {
      const response = await loaded.config.handler.handle({
        method: 'GET',
        url: `${basePath.replace(/\/+$/, '')}/health`,
        headers: {},
      });
      checks.push(
        response.status === 200
          ? { id: 'handler-health', status: 'pass', message: `GET ${basePath}/health answered 200` }
          : {
              id: 'handler-health',
              status: 'fail',
              message: `GET ${basePath}/health answered ${response.status}`,
            }
      );
    } catch (error) {
      checks.push({
        id: 'handler-health',
        status: 'fail',
        message: `health route threw: ${sanitizeMessage(
          error instanceof Error ? error.message : String(error),
          []
        )}`,
      });
    }
  } else {
    checks.push({
      id: 'handler-health',
      status: 'skip',
      message: 'no handler instance was exported by the config',
      hint: 'Export a lazy getBetterPayment() (init generates it) to check the health route.',
    });
  }

  if (boolOption(args, 'json')) {
    io.stdout(JSON.stringify({ mode, checks }, null, 2));
  } else {
    for (const check of checks) writeCheck(io, check);
    const counts = countStatuses(checks);
    io.stdout('');
    io.stdout(
      `${counts.pass} passed, ${counts.warn} warned, ${counts.fail} failed, ${counts.skip} skipped`
    );
  }

  return { code: exitCodeFor(checks), checks };
}
