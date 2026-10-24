import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  ConfigurationError,
  HttpError,
  PaymentErrorCode,
  PaymentStatus,
} from 'better-payment';
import type { BetterPaymentLogger, PaymentRequest, PaymentResponse } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import {
  telemetry,
  type TelemetryAttributes,
  type TelemetryMeter,
  type TelemetrySpan,
  type TelemetryTracer,
} from 'better-payment/plugins';
import { failureResult } from '../../../src/core/failure';
import { mockPaymentRequest } from '../../fixtures/payment-data';

/** A span as the fake tracer records it */
interface CapturedSpan {
  name: string;
  attributes: TelemetryAttributes;
  status?: { code: number; message?: string };
  startTime?: number;
  endTime?: number;
}

/** A tracer with the exact shape `better-payment/plugins` expects */
function fakeTracer() {
  const spans: CapturedSpan[] = [];
  const tracer: TelemetryTracer = {
    startSpan: (name, options) => {
      const span: CapturedSpan = { name, attributes: {}, startTime: options?.startTime };
      spans.push(span);
      const captured: TelemetrySpan = {
        setAttribute: (key, value) => {
          span.attributes[key] = value;
        },
        setStatus: (status) => {
          span.status = status;
        },
        end: (endTime) => {
          span.endTime = endTime;
        },
      };
      return captured;
    },
  };
  return { tracer, spans };
}

interface CapturedMetric {
  value: number;
  attributes?: TelemetryAttributes;
}

function fakeMeter() {
  const counters = new Map<string, CapturedMetric[]>();
  const histograms = new Map<string, CapturedMetric[]>();
  const created = { counters: [] as string[], histograms: [] as string[] };
  const meter: TelemetryMeter = {
    createCounter: (name) => {
      created.counters.push(name);
      const calls: CapturedMetric[] = [];
      counters.set(name, calls);
      return {
        add: (value, attributes) => {
          calls.push({ value, attributes });
        },
      };
    },
    createHistogram: (name) => {
      created.histograms.push(name);
      const calls: CapturedMetric[] = [];
      histograms.set(name, calls);
      return {
        record: (value, attributes) => {
          calls.push({ value, attributes });
        },
      };
    },
  };
  return { meter, counters, histograms, created };
}

const quietLogger = (): BetterPaymentLogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
});

/** Answers like a provider whose HTTP call failed, built through `failureResult` */
class HttpFailProvider extends MockProvider {
  /** The error body carries card data on purpose: spans must never pick it up */
  override async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const body = {
      errorCode: 'GATEWAY_DOWN',
      errorMessage:
        `Card ${request.paymentCard.cardNumber} cvc ${request.paymentCard.cvc} ` +
        `email ${request.buyer.email} ip ${request.buyer.ip}`,
      token: 'tok_5528790000000008',
    };
    const error = new HttpError(
      'Bad gateway',
      { method: 'POST', url: 'https://provider.example/pay' },
      { response: { status: 502, data: body, headers: {} } }
    );
    error.attempts = 3;
    return failureResult<PaymentResponse>('httpfail', error, 'Payment failed');
  }
}

/** Throws out of the operation, so no after hook runs for that call */
class ThrowingProvider extends MockProvider {
  override async createPayment(): Promise<PaymentResponse> {
    throw new Error('provider exploded');
  }
}

describe('telemetry', () => {
  it('emits one span per provider call with the low-cardinality attributes', async () => {
    const { tracer, spans } = fakeTracer();
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      defaultProvider: 'mock',
      mode: 'sandbox',
      plugins: [telemetry({ tracer })],
    });

    const created = await payment.createPayment(mockPaymentRequest);
    await payment.getPayment(created.paymentId ?? 'unknown');

    expect(spans.map((s) => s.name)).toEqual(['payment.createPayment', 'payment.getPayment']);
    const first = spans[0];
    expect(first.attributes).toMatchObject({
      'payment.provider': 'mock',
      'payment.operation': 'createPayment',
      'payment.result': PaymentStatus.SUCCESS,
    });
    expect(first.status).toEqual({ code: 1 }); // SpanStatusCode.OK
    expect(first.endTime).toBeTypeOf('number');
    expect(first.attributes['payment.duration_ms']).toBeTypeOf('number');
    expect(first.attributes['payment.duration_ms']).toBeGreaterThanOrEqual(0);
    expect(spans[1].attributes['payment.operation']).toBe('getPayment');
  });

  it('marks failures with the error status and the normalized code', async () => {
    const { tracer, spans } = fakeTracer();
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      defaultProvider: 'mock',
      mode: 'sandbox',
      plugins: [telemetry({ tracer })],
    });

    mock.failNext('payment', PaymentErrorCode.INSUFFICIENT_FUNDS);
    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.FAILURE);

    expect(spans).toHaveLength(1);
    expect(spans[0].attributes['payment.result']).toBe(PaymentStatus.FAILURE);
    expect(spans[0].attributes['payment.code']).toBe('INSUFFICIENT_FUNDS');
    expect(spans[0].status).toEqual({ code: 2 }); // SpanStatusCode.ERROR
  });

  it('reports a lost response as pending with NETWORK_ERROR and no span status', async () => {
    const { tracer, spans } = fakeTracer();
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      defaultProvider: 'mock',
      mode: 'sandbox',
      plugins: [telemetry({ tracer })],
    });

    mock.networkErrorNext('payment');
    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.PENDING);

    expect(spans).toHaveLength(1);
    expect(spans[0].attributes['payment.result']).toBe(PaymentStatus.PENDING);
    expect(spans[0].attributes['payment.code']).toBe('NETWORK_ERROR');
    expect(spans[0].status).toBeUndefined();
  });

  it('carries the HTTP status and the retry count into the span', async () => {
    const { tracer, spans } = fakeTracer();
    const payment = betterPayment({
      providers: { httpfail: new HttpFailProvider() },
      defaultProvider: 'httpfail',
      mode: 'sandbox',
      plugins: [telemetry({ tracer })],
    });

    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result).toMatchObject({ httpStatus: 502, attempts: 3 });

    expect(spans).toHaveLength(1);
    expect(spans[0].attributes['payment.http.status']).toBe(502);
    expect(spans[0].attributes['payment.retry.count']).toBe(3);
    expect(spans[0].attributes['payment.code']).toBeUndefined();
  });

  it('never puts card data, tokens, emails, IPs or bodies into attributes', async () => {
    const { tracer, spans } = fakeTracer();
    const { meter, counters } = fakeMeter();
    const payment = betterPayment({
      providers: { httpfail: new HttpFailProvider() },
      defaultProvider: 'httpfail',
      mode: 'sandbox',
      plugins: [telemetry({ tracer, meter })],
    });

    await payment.createPayment(mockPaymentRequest);
    expect(spans).toHaveLength(1);

    const allowed = new Set([
      'payment.provider',
      'payment.operation',
      'payment.result',
      'payment.code',
      'payment.http.status',
      'payment.retry.count',
      'payment.duration_ms',
    ]);
    const sensitive = [
      '5528790000000008',
      'john.doe@example.com',
      '85.34.78.112',
      'tok_5528790000000008',
      'GATEWAY_DOWN',
      'Bad gateway',
      'John Doe',
      'B67832',
      '74300864791',
    ];
    const seen = [
      ...spans.map((s) => s.attributes),
      ...counters.get('payment.calls')!.map((m) => m.attributes ?? {}),
    ];
    for (const attributes of seen) {
      for (const [key, value] of Object.entries(attributes)) {
        expect(allowed.has(key), `unexpected attribute ${key}`).toBe(true);
        for (const needle of sensitive) {
          expect(String(value), `${key} contains ${needle}`).not.toContain(needle);
        }
      }
    }
  });

  it('a throwing tracer or meter never changes the payment outcome', async () => {
    const logger = quietLogger();
    const bomb = (): never => {
      throw new Error('tracer exploded');
    };
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      defaultProvider: 'mock',
      mode: 'sandbox',
      logger,
      plugins: [
        telemetry({
          tracer: { startSpan: bomb },
          meter: { createCounter: bomb, createHistogram: bomb },
        }),
      ],
    });

    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.code).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();

    // A tracer that survives startSpan but fails on every other call too
    const halfBroken = betterPayment({
      providers: { mock: new MockProvider() },
      defaultProvider: 'mock',
      mode: 'sandbox',
      logger,
      plugins: [
        telemetry({
          tracer: {
            startSpan: () => ({ setAttribute: bomb, setStatus: bomb, end: bomb }),
          },
        }),
      ],
    });
    expect((await halfBroken.createPayment(mockPaymentRequest)).status).toBe(PaymentStatus.SUCCESS);

    // A meter whose instruments throw when recorded to
    const brokenMeter = betterPayment({
      providers: { mock: new MockProvider() },
      defaultProvider: 'mock',
      mode: 'sandbox',
      logger,
      plugins: [
        telemetry({
          meter: {
            createCounter: () => ({ add: bomb }),
            createHistogram: () => ({ record: bomb }),
          },
        }),
      ],
    });
    expect((await brokenMeter.createPayment(mockPaymentRequest)).status).toBe(
      PaymentStatus.SUCCESS
    );
  });

  it('reports metrics: one counter increment and one duration sample per call', async () => {
    const { tracer, spans } = fakeTracer();
    const { meter, counters, histograms, created } = fakeMeter();
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      defaultProvider: 'mock',
      mode: 'sandbox',
      plugins: [telemetry({ tracer, meter })],
    });

    await payment.createPayment(mockPaymentRequest);
    await payment.createPayment(mockPaymentRequest);

    expect(created.counters).toEqual(['payment.calls']);
    expect(created.histograms).toEqual(['payment.duration']);
    expect(counters.get('payment.calls')).toHaveLength(2);
    expect(histograms.get('payment.duration')).toHaveLength(2);
    const call = counters.get('payment.calls')![0];
    expect(call.value).toBe(1);
    expect(call.attributes).toMatchObject({
      'payment.provider': 'mock',
      'payment.result': PaymentStatus.SUCCESS,
    });
    expect(call.attributes).not.toHaveProperty('payment.duration_ms');
    expect(spans).toHaveLength(2);

    // Metrics-only mode emits no spans
    const metricsOnly = fakeMeter();
    const meterOnly = betterPayment({
      providers: { mock: new MockProvider() },
      defaultProvider: 'mock',
      mode: 'sandbox',
      plugins: [telemetry({ meter: metricsOnly.meter })],
    });
    await meterOnly.createPayment(mockPaymentRequest);
    expect(metricsOnly.counters.get('payment.calls')).toHaveLength(1);
  });

  it('filters operations, and refuses unknown ones', async () => {
    const { tracer, spans } = fakeTracer();
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      defaultProvider: 'mock',
      mode: 'sandbox',
      plugins: [telemetry({ tracer, operations: ['createPayment'] })],
    });

    await payment.createPayment(mockPaymentRequest);
    await payment.use('mock').binCheck('552879');
    expect(spans.map((s) => s.name)).toEqual(['payment.createPayment']);

    expect(() => telemetry({ operations: ['nope' as never] })).toThrow(ConfigurationError);
  });

  it('can be disabled at runtime', async () => {
    const { tracer, spans } = fakeTracer();
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      defaultProvider: 'mock',
      mode: 'sandbox',
      plugins: [telemetry({ tracer })],
    });

    expect(payment.telemetry.enabled).toBe(true);
    await payment.createPayment(mockPaymentRequest);
    expect(spans).toHaveLength(1);

    payment.telemetry.disable();
    expect(payment.telemetry.enabled).toBe(false);
    await payment.createPayment(mockPaymentRequest);
    expect(spans).toHaveLength(1);

    payment.telemetry.enable();
    await payment.createPayment(mockPaymentRequest);
    expect(spans).toHaveLength(2);
  });

  it('survives a call whose after hooks never ran', async () => {
    const { tracer, spans } = fakeTracer();
    const payment = betterPayment({
      providers: { bad: new ThrowingProvider(), mock: new MockProvider() },
      mode: 'sandbox',
      plugins: [telemetry({ tracer })],
    });

    await expect(payment.use('bad').createPayment(mockPaymentRequest)).rejects.toThrow(
      'provider exploded'
    );
    expect(spans).toHaveLength(0);

    // The abandoned start time is paired with the next call, not leaked or crashed
    const result = await payment.use('mock').createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes['payment.duration_ms']).toBeTypeOf('number');
  });

  it('accepts OpenTelemetry-shaped objects (structural compatibility, no dependency)', async () => {
    // Mirrors the shapes of `@opentelemetry/api`: richer attribute unions, extra
    // span members, `this` returns, extra parameters. Nothing here imports OTel.
    type OtelAttributeValue = string | number | boolean | readonly (number | string | boolean)[];
    type OtelAttributes = Record<string, OtelAttributeValue | undefined>;
    class OtelLikeSpan {
      attributes: TelemetryAttributes = {};
      status?: { code: number };
      ended?: number;
      setAttribute(key: string, value: OtelAttributeValue): this {
        this.attributes[key] = Array.isArray(value) ? String(value.length) : value;
        return this;
      }
      addEvent(): void {}
      setStatus(status: { code: number; message?: string }): this {
        this.status = { code: status.code };
        return this;
      }
      end(endTime?: number): void {
        this.ended = endTime;
      }
      isRecording(): boolean {
        return true;
      }
    }
    const spans: OtelLikeSpan[] = [];
    const otelTracer = {
      startSpan(
        name: string,
        options?: { attributes?: OtelAttributes; startTime?: number }
      ): OtelLikeSpan {
        const span = new OtelLikeSpan();
        span.attributes = { ...(options?.attributes ?? {}) } as TelemetryAttributes;
        spans.push(span);
        return span;
      },
    };
    class OtelLikeCounter {
      calls: number[] = [];
      add(value: number): void {
        this.calls.push(value);
      }
    }
    const counter = new OtelLikeCounter();
    const otelMeter = {
      createCounter(): OtelLikeCounter {
        return counter;
      },
      createHistogram() {
        return { record: (_value: number): void => {} };
      },
    };

    // The compile-time part of the proof: OTel-shaped objects satisfy the interfaces
    const tracer: TelemetryTracer = otelTracer;
    const meter: TelemetryMeter = otelMeter;

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      defaultProvider: 'mock',
      mode: 'sandbox',
      plugins: [telemetry({ tracer, meter })],
    });
    const result = await payment.createPayment(mockPaymentRequest);

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes['payment.operation']).toBe('createPayment');
    expect(spans[0].status).toEqual({ code: 1 });
    expect(counter.calls).toEqual([1]);
  });

  it('does nothing at all without a tracer and a meter', async () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      defaultProvider: 'mock',
      mode: 'sandbox',
      plugins: [telemetry({})],
    });
    expect(payment.telemetry.enabled).toBe(false);
    expect((await payment.createPayment(mockPaymentRequest)).status).toBe(PaymentStatus.SUCCESS);
  });
});
