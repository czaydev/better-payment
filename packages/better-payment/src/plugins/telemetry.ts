import {
  ConfigurationError,
  definePlugin,
  PAYMENT_OPERATIONS,
  PaymentStatus,
  type BetterPaymentLogger,
  type OperationResultContext,
  type PaymentOperation,
} from 'better-payment';

// ---------------------------------------------------------------------------
// The parts of the OpenTelemetry API this plugin uses, declared structurally.
// There is no dependency on `@opentelemetry/api`: pass your own
// `trace.getTracer(...)` and `metrics.getMeter(...)`, and the shapes match.
// ---------------------------------------------------------------------------

/** An attribute value an OpenTelemetry span or metric accepts */
export type TelemetryAttributeValue = string | number | boolean;

/** Attributes as OpenTelemetry sees them */
export type TelemetryAttributes = Record<string, TelemetryAttributeValue>;

/** The span methods this plugin calls (a subset of the OpenTelemetry `Span`) */
export interface TelemetrySpan {
  setAttribute(key: string, value: TelemetryAttributeValue): void;
  /** `code`: 0 unset, 1 ok, 2 error (OpenTelemetry `SpanStatusCode`) */
  setStatus(status: { code: number; message?: string }): void;
  /** `endTime` in milliseconds since the epoch */
  end(endTime?: number): void;
}

/** `startSpan` options this plugin uses (a subset of the OpenTelemetry `SpanOptions`) */
export interface TelemetrySpanOptions {
  attributes?: TelemetryAttributes;
  /** Start timestamp in milliseconds since the epoch */
  startTime?: number;
}

/** The tracer this plugin needs (a subset of the OpenTelemetry `Tracer`) */
export interface TelemetryTracer {
  startSpan(name: string, options?: TelemetrySpanOptions): TelemetrySpan;
}

/** The counter this plugin needs (a subset of the OpenTelemetry `Counter`) */
export interface TelemetryCounter {
  add(value: number, attributes?: TelemetryAttributes): void;
}

/** The histogram this plugin needs (a subset of the OpenTelemetry `Histogram`) */
export interface TelemetryHistogram {
  record(value: number, attributes?: TelemetryAttributes): void;
}

/** The meter this plugin needs (a subset of the OpenTelemetry `Meter`) */
export interface TelemetryMeter {
  createCounter(name: string): TelemetryCounter;
  createHistogram(name: string): TelemetryHistogram;
}

export interface TelemetryOptions {
  /** Default: true. With `false`, no hook does any work. */
  enabled?: boolean;
  /** Your tracer: `trace.getTracer('better-payment')` from `@opentelemetry/api` */
  tracer?: TelemetryTracer;
  /** Your meter: `metrics.getMeter('better-payment')` from `@opentelemetry/api` */
  meter?: TelemetryMeter;
  /** Operations to report. Default: all. */
  operations?: PaymentOperation | PaymentOperation[];
  /**
   * Drop the start time of a call whose after hooks never ran (a provider that
   * threw), so an aborted call cannot leak. Default: 300000 ms.
   */
  pendingTimeoutMs?: number;
  /** Cap on concurrently open calls per operation. Default: 512. */
  maxPending?: number;
}

/** OpenTelemetry `SpanStatusCode`, without depending on the package */
const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

/**
 * The attributes this plugin can produce, by construction. Values never come from
 * the request or the provider response body: only from the operation name, the
 * provider id, the normalized result fields (`status`, `code`) and the transport
 * metadata (`httpStatus`, `attempts`).
 */
const ALLOWED_ATTRIBUTES = [
  'payment.provider',
  'payment.operation',
  'payment.result',
  'payment.code',
  'payment.http.status',
  'payment.retry.count',
  'payment.duration_ms',
] as const;

type AttributeName = (typeof ALLOWED_ATTRIBUTES)[number];

/** Longest string attribute value; provider codes are far shorter */
const MAX_TEXT_LENGTH = 64;

const field = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

/** Keeps the attribute set inside the allow-list and drops anything non-primitive */
function pickAttributes(attributes: Partial<Record<AttributeName, unknown>>): TelemetryAttributes {
  const out: TelemetryAttributes = {};
  for (const name of ALLOWED_ATTRIBUTES) {
    const value = attributes[name];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[name] = value;
    } else if (typeof value === 'boolean') {
      out[name] = value;
    } else if (typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH) {
      out[name] = value;
    }
  }
  return out;
}

const list = <T>(value: T | T[] | undefined): T[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

/**
 * Reports every provider call to your OpenTelemetry tracer and meter.
 *
 * One span per call, named `payment.<operation>`, carrying only these attributes:
 * `payment.provider`, `payment.operation`, `payment.result` (`success`, `pending`,
 * `failure`), `payment.code` (normalized [error code](/docs/reference/error-codes)),
 * `payment.http.status`, `payment.retry.count` and `payment.duration_ms`. No card
 * data, credentials, tokens, conversation ids or request and response bodies are
 * ever read, so nothing sensitive can reach an attribute.
 *
 * Metrics: counter `payment.calls` (one per call, with the same attributes minus
 * the duration) and histogram `payment.duration` (milliseconds).
 *
 * @example
 * ```ts
 * import { trace, metrics } from '@opentelemetry/api';
 * import { telemetry } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     telemetry({ tracer: trace.getTracer('better-payment'), meter: metrics.getMeter('better-payment') }),
 *   ],
 * });
 * ```
 */
export const telemetry = (options: TelemetryOptions = {}) => {
  let enabled = options.enabled ?? true;
  const { tracer, meter } = options;
  const operations = list(options.operations);
  if (operations) {
    for (const operation of operations) {
      if (!PAYMENT_OPERATIONS.includes(operation)) {
        throw new ConfigurationError(
          `telemetry: unknown operation '${operation}'. Use one of: ${PAYMENT_OPERATIONS.join(', ')}.`
        );
      }
    }
  }
  const pendingTimeoutMs = options.pendingTimeoutMs ?? 300_000;
  const maxPending = options.maxPending ?? 512;

  /** Start times of calls that have not been reported yet, oldest first, per operation */
  const started = new Map<PaymentOperation, number[]>();
  let counter: TelemetryCounter | undefined;
  let duration: TelemetryHistogram | undefined;
  let logger: BetterPaymentLogger | undefined;

  /** True when there is anything to report to, for this operation */
  const reports = (operation: PaymentOperation) =>
    enabled && (!!tracer || !!meter) && (!operations || operations.includes(operation));

  const report = (error: unknown) => {
    // Telemetry must never change the outcome of a payment, and a broken logger
    // must not break it either.
    try {
      logger?.error('telemetry: reporting failed', error instanceof Error ? error : undefined);
    } catch {
      /* ignored on purpose */
    }
  };

  const safely = (task: () => void) => {
    try {
      task();
    } catch (error) {
      report(error);
    }
  };

  const startCall = (operation: PaymentOperation) => {
    const now = Date.now();
    let opens = started.get(operation);
    if (!opens) started.set(operation, (opens = []));
    // A call whose after hooks never ran (a provider that threw) must not hold
    // its slot forever, and the queue must stay bounded.
    while (opens.length > 0 && now - opens[0] > pendingTimeoutMs) opens.shift();
    if (opens.length >= maxPending) opens.shift();
    opens.push(now);
  };

  const finishCall = (ctx: OperationResultContext) => {
    if (!reports(ctx.operation)) return;
    const opens = started.get(ctx.operation);
    // A before hook of another plugin may have returned the result before this
    // plugin's before hook ran: report the call without a measured duration.
    const start = opens?.shift();
    const now = Date.now();
    const status = field(ctx.result, 'status');
    const attributes = pickAttributes({
      'payment.provider': ctx.provider,
      'payment.operation': ctx.operation,
      'payment.result': typeof status === 'string' ? status : undefined,
      'payment.code': field(ctx.result, 'code'),
      'payment.http.status': field(ctx.result, 'httpStatus'),
      'payment.retry.count': field(ctx.result, 'attempts'),
      ...(start === undefined ? {} : { 'payment.duration_ms': now - start }),
    });

    safely(() => {
      if (!tracer) return;
      const span = tracer.startSpan(`payment.${ctx.operation}`, { startTime: start ?? now });
      for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
      if (status === PaymentStatus.FAILURE) span.setStatus({ code: SpanStatusCode.ERROR });
      else if (status === PaymentStatus.SUCCESS) span.setStatus({ code: SpanStatusCode.OK });
      span.end(now);
    });

    safely(() => {
      if (!meter) return;
      counter ??= meter.createCounter('payment.calls');
      duration ??= meter.createHistogram('payment.duration');
      const metricAttributes = { ...attributes };
      delete metricAttributes['payment.duration_ms'];
      counter.add(1, metricAttributes);
      if (start !== undefined) duration.record(now - start, metricAttributes);
    });
  };

  const plugin = definePlugin({
    id: 'telemetry',
    options,
    init: (ctx) => {
      logger = ctx.logger;
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => reports(ctx.operation),
          handler: (ctx) => {
            startCall(ctx.operation);
          },
        },
      ],
      after: [{ matcher: (ctx) => reports(ctx.operation), handler: (ctx) => finishCall(ctx) }],
    },
    methods: () => ({
      telemetry: {
        /** Start reporting calls again */
        enable: () => {
          enabled = true;
        },
        /** Stop reporting: the hooks do no work at all */
        disable: () => {
          enabled = false;
          started.clear();
        },
        /** Whether calls are being reported */
        get enabled() {
          return enabled && (!!tracer || !!meter);
        },
      },
    }),
  });

  return plugin;
};
