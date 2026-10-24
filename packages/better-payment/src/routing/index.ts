// routing: picks the provider of a routable payment from rules the merchant
// writes, sends follow-up operations back to the provider that handled the
// payment, and explains every decision. See
// apps/web/content/docs/plugins/routing.mdx for the guide.
import {
  ConfigurationError,
  definePlugin,
  type OperationContext,
  type OperationResultContext,
  type PaymentOperation,
  type PluginContext,
} from 'better-payment';
import {
  RoutingEngine,
  isChargeOperation,
  isFollowUpOperation,
  validateRoutingOptions,
} from './engine';
import { MemoryRoutingStore, ROUTING_TTL_SECONDS } from './store';
import type {
  RoutingDecision,
  RoutingDecisionListener,
  RoutingExplainOptions,
  RoutingOptions,
  RoutingRequest,
  RoutingStatus,
  RoutingStore,
} from './types';

export type {
  RoutingBinInfo,
  RoutingCardOrigin,
  RoutingCardType,
  RoutingChargeOperation,
  RoutingContext,
  RoutingDecision,
  RoutingDecisionListener,
  RoutingExplainOptions,
  RoutingFollowUpOperation,
  RoutingHealth,
  RoutingOptions,
  RoutingReason,
  RoutingRequest,
  RoutingRule,
  RoutingSkip,
  RoutingSkipReason,
  RoutingStatus,
  RoutingStore,
  RoutingStrategy,
  RoutingStrategyContext,
  RoutingTarget,
  RoutingWhen,
} from './types';
export { MemoryRoutingStore, ROUTING_TTL_SECONDS, type MemoryRoutingStoreOptions } from './store';

const PAYMENT_KEY = 'routing:pay:';
const CONVERSATION_KEY = 'routing:conv:';
const ATTEMPT_KEY = 'routing:attempt:';

interface RequestIds {
  paymentId?: string;
  conversationId?: string;
  /** The key a charge is pinned to: the order id, never a card field */
  attempt?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function idsOf(request: unknown): RequestIds {
  if (typeof request === 'string') return { paymentId: request.trim() || undefined };
  const record = asRecord(request);
  const paymentId = text(record?.paymentId);
  const conversationId = text(record?.conversationId);
  return {
    paymentId,
    conversationId,
    attempt: conversationId ?? text(record?.basketId),
  };
}

/**
 * Rule-based provider routing. It runs in a before hook, so it only moves calls
 * made on the payment object (`payment.createPayment()`); calls made on a
 * provider (`payment.iyzico.createPayment()`) and provider routes of the HTTP
 * handler are never re-routed.
 *
 * @example
 * ```ts
 * import { routing } from 'better-payment/routing';
 *
 * routing({
 *   rules: [
 *     { name: 'Bonus installments', when: { cardFamily: 'Bonus', installment: { min: 2 } }, use: 'garanti' },
 *     { name: 'Foreign cards', when: { cardOrigin: 'foreign' }, use: ['iyzico', 'paytr'] },
 *   ],
 *   default: { weights: { iyzico: 70, paytr: 30 } },
 * });
 * ```
 */
export function routing(options: RoutingOptions = {}) {
  validateRoutingOptions(options);
  const store: RoutingStore = options.store ?? new MemoryRoutingStore();
  const listeners = new Set<RoutingDecisionListener>();
  const counts = new Map<string, number>();
  let engine: RoutingEngine | undefined;
  let context: PluginContext | undefined;
  let lastDecision: RoutingDecision | undefined;

  function bind(ctx: PluginContext): void {
    context = ctx;
    if (!engine) {
      engine = new RoutingEngine(options, {
        providerIds: ctx.providerIds,
        defaultProvider: ctx.defaultProvider,
        logger: ctx.logger,
      });
    }
  }

  function runtime(): { engine: RoutingEngine; context: PluginContext } {
    if (!engine || !context) {
      throw new ConfigurationError('routing: the plugin is not initialized');
    }
    return { engine, context };
  }

  function logError(message: string, cause: unknown): void {
    context?.logger?.error(message, cause instanceof Error ? cause : new Error(String(cause)));
  }

  async function read(key: string): Promise<string | undefined> {
    try {
      return (await store.get(key)) ?? undefined;
    } catch (cause) {
      logError('[routing] routing store lookup failed; the payment is treated as unknown', cause);
      return undefined;
    }
  }

  async function remember(key: string, provider: string): Promise<void> {
    try {
      await store.set(key, provider, ROUTING_TTL_SECONDS);
    } catch (cause) {
      logError(
        '[routing] routing store write failed; a follow-up may not find its provider',
        cause
      );
    }
  }

  async function publish(decision: RoutingDecision): Promise<void> {
    lastDecision = decision;
    if (decision.provider && isChargeOperation(decision.operation)) {
      counts.set(decision.provider, (counts.get(decision.provider) ?? 0) + 1);
    }
    for (const listener of [...listeners]) {
      try {
        await listener(decision);
      } catch (cause) {
        // Audit logging must never change where a payment goes
        logError('[routing] an onDecision listener failed', cause);
      }
    }
  }

  /** Rule-based decision for a new charge, pinned by the order id when possible */
  async function chargeDecision(
    operation: PaymentOperation,
    request: unknown
  ): Promise<RoutingDecision> {
    const { engine: rules, context: ctx } = runtime();
    const ids = idsOf(request);
    if (ids.attempt) {
      const pinned = await read(ATTEMPT_KEY + ids.attempt);
      if (pinned) {
        if (!ctx.providerIds.includes(pinned)) {
          throw new ConfigurationError(
            `routing: this order was already routed to '${pinned}', which is not enabled. ` +
              'Refusing to move a possible charge to another provider.'
          );
        }
        return {
          provider: pinned,
          rule: null,
          ruleIndex: null,
          reason: 'pinned',
          operation,
          skipped: [],
          detail: `this order was already routed to '${pinned}'; retries never move providers`,
        };
      }
    }
    return rules.decide(operation, request);
  }

  /** Refunds and the like go to the provider that took the payment */
  async function followUpDecision(
    operation: PaymentOperation,
    request: unknown
  ): Promise<RoutingDecision> {
    const { engine: rules, context: ctx } = runtime();
    const ids = idsOf(request);
    let handledBy: string | undefined;
    if (ids.paymentId) handledBy = await read(PAYMENT_KEY + ids.paymentId);
    if (!handledBy && ids.conversationId) {
      handledBy = await read(CONVERSATION_KEY + ids.conversationId);
    }
    if (handledBy) {
      if (!ctx.providerIds.includes(handledBy)) {
        throw new ConfigurationError(
          `routing: the payment was handled by '${handledBy}', which is not enabled. ` +
            `Refusing to route the ${operation} to another provider.`
        );
      }
      return {
        provider: handledBy,
        rule: null,
        ruleIndex: null,
        reason: 'follow-up',
        operation,
        skipped: [],
        detail: `the payment was handled by '${handledBy}'`,
      };
    }
    // Unknown payment: use the default, but never invent a provider to make the
    // call succeed. Health only keeps new charges away, so it is not applied to
    // a refund or a status call of a payment whose provider is unknown.
    return rules.fallback(operation, request, [], 'unknown-payment', false);
  }

  async function decide(operation: PaymentOperation, request: unknown): Promise<RoutingDecision> {
    return isFollowUpOperation(operation)
      ? followUpDecision(operation, request)
      : chargeDecision(operation, request);
  }

  async function explain(
    request: RoutingRequest,
    explainOptions: RoutingExplainOptions = {}
  ): Promise<RoutingDecision> {
    runtime();
    const operation = explainOptions.operation ?? 'createPayment';
    if (!isChargeOperation(operation) && !isFollowUpOperation(operation)) {
      throw new ConfigurationError(
        `routing: explain() does not route '${operation}'. Use a charge or a follow-up operation.`
      );
    }
    return decide(operation, request);
  }

  function status(): RoutingStatus {
    return {
      counts: Object.fromEntries(counts),
      total: [...counts.values()].reduce((a, b) => a + b, 0),
    };
  }

  return definePlugin({
    id: 'routing',
    options,
    init: (ctx) => {
      bind(ctx);
    },
    hooks: {
      before: [
        {
          // Only operations that can move: new charges by rule, follow-ups by
          // mapping. Card saves, BIN checks and installment queries stay put.
          matcher: (ctx: OperationContext) =>
            ctx.routable &&
            (isChargeOperation(ctx.operation) || isFollowUpOperation(ctx.operation)),
          handler: async (ctx: OperationContext) => {
            const decision = await decide(ctx.operation, ctx.request);
            if (decision.provider && isChargeOperation(ctx.operation)) {
              // Pin before the provider call: if the call throws, the outcome is
              // unknown and a retry of the same order must not move.
              const attempt = idsOf(ctx.request).attempt;
              if (attempt) await remember(ATTEMPT_KEY + attempt, decision.provider);
            }
            await publish(decision);
            if (!decision.provider) {
              // Never let a rejected provider be used through the library's
              // default: fail before the charge instead.
              if (context?.defaultProvider) {
                const reasons = decision.skipped
                  .map((skip) => `${skip.provider} (${skip.reason})`)
                  .join(', ');
                throw new ConfigurationError(
                  `routing: no provider is eligible for this ${ctx.operation}` +
                    (reasons ? `: ${reasons}` : '')
                );
              }
              return undefined;
            }
            if (decision.provider === ctx.provider) return undefined;
            context?.logger?.info(
              `[routing] ${ctx.operation} is routed to '${decision.provider}' (${decision.reason})`
            );
            return { provider: decision.provider };
          },
        },
      ],
      after: [
        {
          matcher: (ctx: OperationResultContext) =>
            ctx.routable && isChargeOperation(ctx.operation),
          handler: async (ctx: OperationResultContext) => {
            // Remember the provider even when the result is a decline or a lost
            // response: a refund of a payment id that may exist must reach it.
            const provider = ctx.provider;
            if (!provider) return undefined;
            const result = asRecord(ctx.result);
            const paymentId = text(result?.paymentId);
            const conversationId =
              text(result?.conversationId) ?? idsOf(ctx.request).conversationId;
            if (paymentId) await remember(PAYMENT_KEY + paymentId, provider);
            if (conversationId) await remember(CONVERSATION_KEY + conversationId, provider);
            return undefined;
          },
        },
      ],
    },
    methods: (ctx: PluginContext) => {
      bind(ctx);
      return {
        routing: {
          explain,
          onDecision(listener: RoutingDecisionListener): () => void {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
          get decision(): RoutingDecision | undefined {
            return lastDecision;
          },
          status,
        },
      };
    },
  });
}
