import { BetterPaymentError, definePlugin } from 'better-payment';
import { createReconciliation } from './create';
import { reconciliationSupport } from './support';
import type { Reconciliation } from './create';
import type { ReconciliationSource } from '../types/reconciliation';

export interface ReconciliationPluginOptions {
  /**
   * The provider sources, built with `paytrReconciliation()`,
   * `iyzicoReconciliation()`, ... Each source's `provider` must match the id of
   * the payment provider it belongs to (`providers: { paytr: paytr(...) }`).
   */
  sources: readonly ReconciliationSource[];
}

function notSupported(provider: string): BetterPaymentError {
  const support = reconciliationSupport(provider);
  const detail =
    support?.status === 'not-supported'
      ? `: ${support.reason}`
      : ': no reconciliation source is configured for it';
  return new BetterPaymentError(
    `Daily transaction lists are not supported for provider '${provider}'${detail}`,
    'NOT_SUPPORTED',
    provider
  );
}

/**
 * Adds the reconciliation API to the payment object:
 *
 * ```ts
 * const payment = betterPayment({
 *   providers: { paytr: paytr(config) },
 *   plugins: [reconciliationPlugin({ sources: [paytrReconciliation(config)] })],
 * });
 *
 * await payment.listTransactions({ from: '2026-10-01', to: '2026-10-01' });
 * await payment.reconcile({ orders, from: '2026-10-01', to: '2026-10-01' });
 * ```
 *
 * The plugin answers the `listTransactions` and `reconcile` operations from the
 * configured sources instead of a payment provider, so plugin hooks and the
 * `reconciliation.completed` event see them like any other operation. Both are
 * read-only; a provider without a source answers NOT_SUPPORTED.
 */
export function reconciliationPlugin(options: ReconciliationPluginOptions) {
  const reconciliation: Reconciliation = createReconciliation({ sources: options.sources });
  const allowed = new Set(options.sources.map((source) => source.provider));

  const select = (
    requestProvider: string | undefined,
    ctxProvider: string | undefined,
    routable: boolean
  ): string | undefined => {
    // An explicit provider always wins. A call on the payment object asks every
    // source; a call on a provider asks only that provider.
    const provider = requestProvider ?? (routable ? undefined : ctxProvider);
    if (provider !== undefined && !allowed.has(provider)) throw notSupported(provider);
    return provider;
  };

  return definePlugin({
    id: 'reconciliation',
    options,
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.operation === 'listTransactions' || ctx.operation === 'reconcile',
          handler: async (ctx) => {
            if (ctx.operation === 'listTransactions') {
              const provider = select(ctx.request.provider, ctx.provider, ctx.routable);
              return {
                result: await reconciliation.listTransactions({
                  from: ctx.request.from,
                  to: ctx.request.to,
                  ...(provider !== undefined ? { provider } : {}),
                }),
              };
            }
            if (ctx.operation === 'reconcile') {
              const provider = select(ctx.request.provider, ctx.provider, ctx.routable);
              return {
                result: await reconciliation.reconcile(
                  ctx.request.orders,
                  {
                    from: ctx.request.from,
                    to: ctx.request.to,
                    ...(provider !== undefined ? { provider } : {}),
                  },
                  ctx.request.options
                ),
              };
            }
            return;
          },
        },
      ],
    },
  });
}
