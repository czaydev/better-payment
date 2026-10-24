import {
  definePlugin,
  ConfigurationError,
  type BetterPaymentPlugin,
  type EndpointContext,
  type PluginContext,
  type PaymentRequest,
  type PaymentResponse,
  type ThreeDSPaymentRequest,
  type Buyer,
  type Address,
  type PaymentCard,
} from 'better-payment';
import { hmac, toHex, safeEqual, randomHex } from '../core/crypto';
import { parseAmount, formatDecimal } from '../core/utils';

export type PaymentLinkStatus = 'open' | 'paid' | 'expired' | 'cancelled';

export interface PaymentLink {
  id: string;
  amount: string;
  currency: string;
  description?: string;
  url: string;
  signature: string;
  createdAt: number;
  expiresAt?: number;
  status: PaymentLinkStatus;
  singleUse: boolean;
  useCount: number;
  /**
   * Provider this link is paid with. Chosen when the link is created (or by the
   * plugin option); the pay endpoint never takes a provider from the request.
   */
  provider?: string;
  /** Payment attempts made against this link, capped by `maxAttempts` */
  attempts?: number;
  /** Conversation id of the last payment attempt, `LINK_<id>#<attempt>` */
  conversationId?: string;
  /** Highest number of successful payments this link accepts */
  maxUses?: number;
  paidAt?: number;
  paymentId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentLinkOptions {
  id?: string;
  amount: string | number;
  currency?: string;
  description?: string;
  expiresIn?: number | string | Date;
  singleUse?: boolean;
  /** Successful payments allowed. Defaults to 1 for a single-use link, unlimited otherwise. */
  maxUses?: number;
  /** Provider to pay with. Defaults to the plugin option, then the configured default provider. */
  provider?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentLinkStore {
  get(id: string): Promise<PaymentLink | undefined> | PaymentLink | undefined;
  set(link: PaymentLink): Promise<void> | void;
  update(
    id: string,
    patch: Partial<PaymentLink>
  ): Promise<PaymentLink | undefined> | PaymentLink | undefined;
  /**
   * Compares the record against `expect` and applies `patch` only if it still matches,
   * as one atomic step. Only the fields present in `expect` are compared. Optional: a
   * store without it is guarded per process only, so implement it when several
   * instances share one backend.
   */
  claim?(
    id: string,
    patch: Partial<PaymentLink>,
    expect: Partial<Pick<PaymentLink, 'status' | 'useCount' | 'attempts'>>
  ): Promise<PaymentLink | undefined> | PaymentLink | undefined;
}

export class MemoryPaymentLinkStore implements PaymentLinkStore {
  private readonly items = new Map<string, PaymentLink>();

  async get(id: string): Promise<PaymentLink | undefined> {
    return this.items.get(id);
  }

  async set(link: PaymentLink): Promise<void> {
    this.items.set(link.id, link);
  }

  async update(id: string, patch: Partial<PaymentLink>): Promise<PaymentLink | undefined> {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.items.set(id, updated);
    return updated;
  }

  async claim(
    id: string,
    patch: Partial<PaymentLink>,
    expect: Partial<Pick<PaymentLink, 'status' | 'useCount' | 'attempts'>>
  ): Promise<PaymentLink | undefined> {
    // Map reads and writes are synchronous, so no other task can settle between them.
    const existing = this.items.get(id);
    if (!existing) return undefined;
    if (expect.status !== undefined && existing.status !== expect.status) return undefined;
    if (expect.useCount !== undefined && existing.useCount !== expect.useCount) {
      return undefined;
    }
    if (expect.attempts !== undefined && (existing.attempts ?? 0) !== expect.attempts) {
      return undefined;
    }
    const updated = { ...existing, ...patch };
    this.items.set(id, updated);
    return updated;
  }
}

export interface PaymentLinksOptions {
  /** Secret key used to generate and verify HMAC signatures on links */
  secret: string;
  /**
   * Base URL where the pay page / endpoints are mounted, e.g. `'https://shop.example.com/api/payment'`.
   */
  baseUrl: string;
  /** Storage backend for links. Defaults to in-memory store */
  store?: PaymentLinkStore;
  /** Default expiration duration (e.g. `'7d'`, `'24h'`, or ms). Defaults to `'7d'` */
  defaultExpiresIn?: number | string;
  /**
   * Provider that runs link payments, used unless the link carries its own. Never
   * taken from the pay request: the customer must not choose whose acquirer is used.
   */
  provider?: string;
  /**
   * Where the bank returns the customer after 3D Secure, e.g.
   * `'https://shop.example.com/api/pay/iyzico/payment/complete-3ds'`. Required
   * because `/links/pay` starts a 3D Secure payment by default.
   */
  threeDSCallbackUrl?: string;
  /**
   * Charges the card in the pay request directly, without 3D Secure. Off by default:
   * `/links/pay` is served to unauthenticated visitors, so with this on anyone who
   * holds a link id and its signature can attempt payments with any card. Turn it on
   * only behind your own authentication, and read the note in the docs.
   */
  allowDirectPayment?: boolean;
  /** Successful payments per link when the link does not set its own `maxUses` */
  maxUses?: number;
  /** Payment attempts per link before the endpoint refuses. Defaults to 5. */
  maxAttempts?: number;
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** Link ids travel inside a conversation id, so they keep a conservative charset. */
const LINK_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

function parseDuration(val: number | string | Date | undefined, fallback: number): number {
  if (val === undefined) return fallback;
  if (val instanceof Date) return val.getTime() - Date.now();
  if (typeof val === 'number') return val;
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(val.trim());
  if (!match) {
    throw new ConfigurationError(
      `paymentLinks: invalid duration '${val}'. Use milliseconds or '60s', '24h', '7d'.`
    );
  }
  return Number(match[1]) * DURATION_UNITS[match[2].toLowerCase()];
}

function conversationIdOf(id: string, attempt: number): string {
  return `LINK_${id}#${attempt}`;
}

/** The link id a payment's conversation id belongs to, or undefined for other payments */
export function linkIdFromConversation(conversationId: unknown): string | undefined {
  if (typeof conversationId !== 'string' || !conversationId.startsWith('LINK_')) return undefined;
  const hash = conversationId.lastIndexOf('#');
  if (hash <= 5) return undefined;
  const id = conversationId.slice(5, hash);
  return /^\d+$/.test(conversationId.slice(hash + 1)) && LINK_ID_PATTERN.test(id) ? id : undefined;
}

export function paymentLinks(options: PaymentLinksOptions): BetterPaymentPlugin {
  if (!options.secret || typeof options.secret !== 'string') {
    throw new ConfigurationError('paymentLinks: a secret string is required');
  }
  if (!options.baseUrl || typeof options.baseUrl !== 'string') {
    throw new ConfigurationError('paymentLinks: baseUrl string is required');
  }
  if (options.provider !== undefined && typeof options.provider !== 'string') {
    throw new ConfigurationError('paymentLinks: provider must be a provider id string');
  }
  if (!options.allowDirectPayment && !options.threeDSCallbackUrl) {
    throw new ConfigurationError(
      'paymentLinks: threeDSCallbackUrl is required, because /links/pay starts a 3D Secure ' +
        'payment. Set allowDirectPayment only if you serve that endpoint behind your own auth.'
    );
  }
  const maxAttempts = options.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new ConfigurationError(
      `paymentLinks: maxAttempts must be a positive integer, got ${maxAttempts}`
    );
  }

  const store = options.store ?? new MemoryPaymentLinkStore();
  const cleanBaseUrl = options.baseUrl.replace(/\/$/, '');
  const defaultDurationMs = parseDuration(options.defaultExpiresIn, 7 * 24 * 60 * 60 * 1000);

  async function computeSignature(
    id: string,
    amount: string,
    currency: string,
    expiresAt: number | undefined,
    singleUse: boolean
  ): Promise<string> {
    const payload = `${id}:${amount}:${currency}:${expiresAt ?? 0}:${singleUse ? 1 : 0}`;
    const hash = await hmac('SHA-256', options.secret, payload);
    return toHex(hash);
  }

  async function verifySignature(link: PaymentLink): Promise<boolean> {
    const expected = await computeSignature(
      link.id,
      link.amount,
      link.currency,
      link.expiresAt,
      link.singleUse
    );
    return safeEqual(link.signature, expected);
  }

  /**
   * True when the signature handed to an endpoint is the one this secret mints for
   * the stored record. The stored signature alone proves nothing: it is recomputed
   * from the same record it came from.
   */
  async function presentedSignatureMatches(link: PaymentLink, presented: string): Promise<boolean> {
    const expected = await computeSignature(
      link.id,
      link.amount,
      link.currency,
      link.expiresAt,
      link.singleUse
    );
    return safeEqual(presented, expected);
  }

  function checkStatus(link: PaymentLink): PaymentLinkStatus {
    if (link.status === 'cancelled' || link.status === 'paid') {
      return link.status;
    }
    if (link.expiresAt && Date.now() > link.expiresAt) {
      return 'expired';
    }
    return link.status;
  }

  function useLimit(link: PaymentLink): number {
    const limit = link.maxUses ?? options.maxUses;
    if (limit !== undefined) return limit;
    return link.singleUse ? 1 : Number.POSITIVE_INFINITY;
  }

  /**
   * Takes one payment slot of a link before it is charged. `undefined` means another
   * payment already holds it.
   */
  async function claimUse(link: PaymentLink): Promise<PaymentLink | undefined> {
    const expect = { status: link.status, useCount: link.useCount };
    const patch = { useCount: link.useCount + 1 };
    if (store.claim) return store.claim(link.id, patch, expect);
    const updated = await store.update(link.id, patch);
    return updated && updated.useCount === patch.useCount ? updated : undefined;
  }

  /**
   * Counts one payment attempt against the link. The limit is a card-testing control,
   * so the increment is a compare-and-set on `attempts`: visitors whose requests overlap
   * cannot all be admitted against the value they each read. `undefined` means the link
   * is at its limit, so the caller must refuse.
   */
  async function claimAttempt(link: PaymentLink): Promise<PaymentLink | undefined> {
    if (!store.claim) {
      const attempts = (link.attempts ?? 0) + 1;
      const updated = await store.update(link.id, { attempts });
      return updated && updated.attempts === attempts ? updated : undefined;
    }
    let current: PaymentLink | undefined = link;
    for (let round = 0; round < 3 && current; round++) {
      const attempts = current.attempts ?? 0;
      if (attempts >= maxAttempts) return undefined;
      const claimed = await store.claim(current.id, { attempts: attempts + 1 }, { attempts });
      if (claimed) return claimed;
      current = await store.get(current.id);
    }
    return undefined;
  }

  async function settle(
    link: PaymentLink,
    claimed: PaymentLink,
    paymentId?: string
  ): Promise<void> {
    const patch: Partial<PaymentLink> = {
      paidAt: Date.now(),
      useCount: claimed.useCount,
      status: link.singleUse ? 'paid' : link.status,
    };
    if (paymentId) patch.paymentId = paymentId;
    await store.update(link.id, patch);
  }

  /** Gives the slot back after a payment attempt the provider refused */
  async function releaseUse(link: PaymentLink): Promise<void> {
    await store.update(link.id, { useCount: link.useCount });
  }

  function buildRequest(
    link: PaymentLink,
    body: Record<string, unknown> | undefined,
    conversationId: string
  ): PaymentRequest {
    return {
      price: link.amount,
      paidPrice: link.amount,
      currency: link.currency,
      basketId: `LINK_${link.id}`,
      conversationId,
      buyer: body?.buyer as unknown as Buyer,
      shippingAddress: body?.shippingAddress as unknown as Address,
      billingAddress: body?.billingAddress as unknown as Address,
      paymentCard: body?.paymentCard as unknown as PaymentCard,
      basketItems: [
        {
          id: link.id,
          name: link.description || `Payment link ${link.id}`,
          category1: 'General',
          itemType: 'VIRTUAL',
          price: link.amount,
        },
      ],
    };
  }

  /** The provider of a link, decided on the server and validated against the configuration */
  function providerOf(ctx: PluginContext, link?: PaymentLink): string | undefined {
    const wanted = link?.provider ?? options.provider ?? ctx.defaultProvider ?? ctx.providerIds[0];
    return ctx.providerIds.includes(wanted ?? '') ? wanted : undefined;
  }

  return definePlugin({
    id: 'payment-links',
    version: '0.12.0',
    options,

    endpoints: {
      resolve: {
        method: 'GET',
        path: '/links/resolve',
        handler: async (ctx: EndpointContext) => {
          const id = ctx.query.get('id');
          if (!id) {
            return ctx.json({ error: true, message: 'Missing link id' }, 400);
          }
          const presentedSig = ctx.query.get('sig');
          if (!presentedSig) {
            return ctx.json({ error: true, message: 'Missing link signature' }, 400);
          }

          const link = await store.get(id);
          if (!link) {
            return ctx.json({ error: true, message: 'Payment link not found' }, 404);
          }

          if (!(await presentedSignatureMatches(link, presentedSig))) {
            return ctx.json({ error: true, message: 'Invalid payment link signature' }, 400);
          }

          const status = checkStatus(link);
          return {
            id: link.id,
            amount: link.amount,
            currency: link.currency,
            description: link.description,
            status,
            expiresAt: link.expiresAt,
            singleUse: link.singleUse,
          };
        },
      },
      pay: {
        method: 'POST',
        path: '/links/pay',
        handler: async (ctx: EndpointContext) => {
          const body = ctx.body;
          const linkId = typeof body?.linkId === 'string' ? body.linkId : undefined;
          if (!linkId) {
            return ctx.json({ error: true, message: 'Missing linkId' }, 400);
          }
          const presentedSig = typeof body?.sig === 'string' ? body.sig : undefined;
          if (!presentedSig) {
            return ctx.json({ error: true, message: 'Missing link signature' }, 400);
          }

          const link = await store.get(linkId);
          if (!link) {
            return ctx.json({ error: true, message: 'Payment link not found' }, 404);
          }

          if (!(await presentedSignatureMatches(link, presentedSig))) {
            return ctx.json({ error: true, message: 'Invalid payment link signature' }, 400);
          }

          const status = checkStatus(link);
          if (status === 'expired') {
            return ctx.json({ error: true, message: 'This payment link has expired' }, 410);
          }
          if (status === 'paid' && link.singleUse) {
            return ctx.json(
              { error: true, message: 'This payment link has already been paid' },
              410
            );
          }
          if (status === 'cancelled') {
            return ctx.json({ error: true, message: 'This payment link was cancelled' }, 410);
          }
          if (link.useCount >= useLimit(link)) {
            return ctx.json(
              { error: true, message: 'This payment link reached its payment limit' },
              410
            );
          }

          const counted = await claimAttempt(link);
          if (!counted) {
            return ctx.json(
              {
                error: true,
                message: `This payment link reached its attempt limit (${maxAttempts})`,
              },
              429
            );
          }

          const provider = providerOf(ctx, link);
          if (!provider) {
            return ctx.json({ error: true, message: 'No payment provider available' }, 500);
          }

          const target = ctx.use(provider);
          const conversationId = conversationIdOf(link.id, counted.attempts ?? 1);
          const paymentRequest = buildRequest(link, body, conversationId);

          if (!options.allowDirectPayment) {
            const init = await target.initThreeDSPayment({
              ...paymentRequest,
              callbackUrl: options.threeDSCallbackUrl as string,
            } as ThreeDSPaymentRequest);
            await store.update(link.id, { conversationId });
            return init;
          }

          const claimed = await claimUse(link);
          if (!claimed) {
            return ctx.json(
              { error: true, message: 'Another payment is already in progress for this link' },
              409
            );
          }

          try {
            const result: PaymentResponse = await target.createPayment(paymentRequest);
            if (result.status === 'success') {
              await settle(link, claimed, result.paymentId);
            } else {
              await releaseUse(link);
            }
            return result;
          } catch (error) {
            await releaseUse(link);
            throw error;
          }
        },
      },
    },

    hooks: {
      after: [
        {
          // A 3D Secure payment started from /links/pay is completed on the handler's
          // own callback route, so the link is settled here instead.
          matcher: (ctx) => ctx.operation === 'completeThreeDSPayment',
          handler: async (ctx) => {
            const result = ctx.result as PaymentResponse;
            const id = linkIdFromConversation(result?.conversationId);
            if (!id || result?.status !== 'success') return;
            const link = await store.get(id);
            if (!link || link.paymentId === result.paymentId) return;
            if (link.useCount >= useLimit(link)) return;
            const claimed = await claimUse(link);
            if (!claimed) return;
            await settle(link, claimed, result.paymentId);
          },
        },
      ],
    },

    methods: (ctx) => ({
      links: {
        create: async (opts: CreatePaymentLinkOptions): Promise<PaymentLink> => {
          const numAmount = parseAmount(opts.amount, 'amount');
          const amountStr = formatDecimal(numAmount);
          const currency = (opts.currency || 'TRY').toUpperCase();
          const id = opts.id || randomHex(8);
          if (!LINK_ID_PATTERN.test(id)) {
            throw new ConfigurationError(
              `paymentLinks: link id '${id}' must be 4-64 characters of A-Z, a-z, 0-9, '-' or '_'`
            );
          }
          const singleUse = opts.singleUse !== false;
          const maxUses = opts.maxUses;
          if (maxUses !== undefined && (!Number.isInteger(maxUses) || maxUses < 1)) {
            throw new ConfigurationError(
              `paymentLinks: maxUses must be a positive integer, got ${maxUses}`
            );
          }

          const provider = opts.provider ?? providerOf(ctx);
          if (provider && !ctx.providerIds.includes(provider)) {
            throw new ConfigurationError(
              `paymentLinks: provider '${provider}' is not configured on this payment instance`
            );
          }

          let expiresAt: number | undefined;
          if (opts.expiresIn !== undefined) {
            const duration = parseDuration(opts.expiresIn, defaultDurationMs);
            expiresAt = Date.now() + duration;
          } else if (defaultDurationMs > 0) {
            expiresAt = Date.now() + defaultDurationMs;
          }

          const signature = await computeSignature(id, amountStr, currency, expiresAt, singleUse);
          const url = `${cleanBaseUrl}/links/resolve?id=${id}&sig=${signature}`;

          const link: PaymentLink = {
            id,
            amount: amountStr,
            currency,
            description: opts.description,
            url,
            signature,
            createdAt: Date.now(),
            expiresAt,
            status: 'open',
            singleUse,
            useCount: 0,
            attempts: 0,
            maxUses,
            provider,
            metadata: opts.metadata,
          };

          await store.set(link);
          return link;
        },

        get: async (id: string): Promise<PaymentLink | undefined> => {
          const link = await store.get(id);
          if (!link) return undefined;
          const status = checkStatus(link);
          if (status !== link.status) {
            await store.update(id, { status });
            link.status = status;
          }
          return link;
        },

        cancel: async (id: string): Promise<PaymentLink | undefined> => {
          return store.update(id, { status: 'cancelled' });
        },

        verify: async (link: PaymentLink): Promise<boolean> => {
          return verifySignature(link);
        },
      },
    }),
  });
}
