import {
  BetterPaymentError,
  ConfigurationError,
  definePlugin,
  PaymentStatus,
  randomHex,
  type BetterPaymentPlugin,
  type BetterPaymentRequest,
  type EndpointContext,
  type CancelRequest,
  type CancelResponse,
  type PluginContext,
  type RefundRequest,
  type RefundResponse,
} from 'better-payment';

/**
 * Who created, approved or rejected an approval request: the caller can pass a
 * user id string or the user object itself. The plugin never trusts it for
 * authorization on its own (see the `approvers` option), it only reads an id out
 * of it for the separation-of-duties check.
 */
export type RefundApprovalActor = string | Record<string, unknown>;

/**
 * Marks a request this plugin replays after approval. A symbol key cannot come
 * from a JSON body or from a caller outside this module, and object spread keeps
 * it when another plugin's before hook copies the request.
 */
const APPROVED = Symbol('refundApproval.approved');

type ApprovedRequest = (RefundRequest | CancelRequest) & { [APPROVED]?: true };

/**
 * How the `before` hook reads an incoming refund/cancel request. `ctx.request` is
 * `unknown` there, and callers pass the plugin-specific extras this queue needs
 * (`amount` as an alias of `price`, and the requester identity) next to the
 * shared request fields.
 */
interface ApprovalRequestView {
  paymentId?: string;
  price?: string;
  amount?: string | number;
  currency?: string;
  conversationId?: string;
  requestedBy?: RefundApprovalActor;
  by?: RefundApprovalActor;
  userId?: RefundApprovalActor;
}

export interface RefundApprovalRequest {
  id: string;
  operation: 'refund' | 'cancel';
  provider: string;
  paymentId: string;
  amount: number;
  currency: string;
  requestedBy?: RefundApprovalActor;
  status: 'pending' | 'approved' | 'rejected';
  request: RefundRequest | CancelRequest;
  createdAt: number;
  approvedAt?: number;
  approvedBy?: RefundApprovalActor;
  rejectedAt?: number;
  rejectedBy?: RefundApprovalActor;
  rejectionReason?: string;
}

export interface RefundApprovalStore {
  save(request: RefundApprovalRequest): Promise<void> | void;
  get(id: string): Promise<RefundApprovalRequest | undefined> | RefundApprovalRequest | undefined;
  list(filter?: {
    status?: 'pending' | 'approved' | 'rejected';
  }): Promise<RefundApprovalRequest[]> | RefundApprovalRequest[];
  delete(id: string): Promise<void> | void;
}

export class MemoryRefundApprovalStore implements RefundApprovalStore {
  private readonly items = new Map<string, RefundApprovalRequest>();

  save(request: RefundApprovalRequest): void {
    this.items.set(request.id, { ...request });
  }

  get(id: string): RefundApprovalRequest | undefined {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  list(filter?: { status?: 'pending' | 'approved' | 'rejected' }): RefundApprovalRequest[] {
    let all = Array.from(this.items.values());
    if (filter?.status) {
      all = all.filter((r) => r.status === filter.status);
    }
    return all.map((r) => ({ ...r }));
  }

  delete(id: string): void {
    this.items.delete(id);
  }
}

export interface RefundApprovalOptions {
  /** Monetary threshold above which refunds require approval (in primary currency units, e.g. 1000) */
  threshold: number;
  /** Custom storage for approval requests. Default: in-memory store */
  store?: RefundApprovalStore;
  /** Function determining whether a user is authorized to approve refunds */
  approvers?: (user: unknown) => boolean | Promise<boolean>;
  /**
   * Resolves the signed-in user of an HTTP request from your session or token.
   * The `/refunds/approve` and `/refunds/reject` endpoints take the approver from
   * here, never from the request body, and answer 403 without it.
   */
  getActor?: (
    request: BetterPaymentRequest
  ) => RefundApprovalActor | undefined | Promise<RefundApprovalActor | undefined>;
  /**
   * Amount of the payment a cancellation voids, looked up in your own records.
   * A cancel request carries no amount, so without this option, or when it
   * returns undefined, every cancellation waits for approval.
   */
  cancelAmount?: (
    request: CancelRequest,
    provider: string
  ) => number | string | undefined | Promise<number | string | undefined>;
  /** Optional notification hook called when a new approval request is created */
  notify?: (request: RefundApprovalRequest) => Promise<void> | void;
}

/** A strictly parsed amount: '1,000.00', '' or 'abc' give undefined, not 1 or 0 */
function parseAmount(value: unknown): number | undefined {
  const amount =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.trim())
        : NaN;
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function getUserId(user: RefundApprovalActor | undefined): string | undefined {
  if (!user) return undefined;
  if (typeof user === 'string') return user;
  return (
    (user.id as string) ??
    (user.userId as string) ??
    (user.username as string) ??
    (user.email as string)
  );
}

/**
 * Refund approval workflow plugin for better-payment.
 *
 * Holds refunds and cancellations above a specified threshold in a pending queue
 * until reviewed and approved by an authorized manager or finance teammate.
 * Enforces separation of duties so requesters cannot approve their own refunds.
 *
 * @example
 * ```ts
 * import { refundApproval } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     refundApproval({
 *       threshold: 1000,
 *       approvers: (user) => user.role === 'finance',
 *       notify: async (req) => notifySlack(req),
 *     }),
 *   ],
 * });
 *
 * // Approve:
 * await payment.refunds.approve(approvalId, { by: currentUser });
 * ```
 */
export function refundApproval(options: RefundApprovalOptions): BetterPaymentPlugin {
  if (typeof options.threshold !== 'number' || options.threshold < 0) {
    throw new ConfigurationError(
      `refundApproval: threshold must be a non-negative number, got ${options.threshold}`
    );
  }

  const store = options.store ?? new MemoryRefundApprovalStore();
  const threshold = options.threshold;
  let pluginCtx: PluginContext;

  // The HTTP endpoints act as the signed-in user only: an approver named in the
  // request body would let anyone with handler access approve their own refund
  const actorOf = async (request: BetterPaymentRequest) =>
    options.getActor ? await options.getActor(request) : undefined;
  const forbidden = (ctx: EndpointContext) =>
    ctx.json(
      {
        status: 'error',
        errorMessage: options.getActor
          ? 'No signed-in approver for this request'
          : "refundApproval: set the 'getActor' option to use the HTTP endpoints",
      },
      403
    );
  // A refused approval is the caller's error, not the server's
  const respond = async (ctx: EndpointContext, run: () => Promise<unknown>) => {
    try {
      return ctx.json(await run());
    } catch (error) {
      if (!(error instanceof BetterPaymentError)) throw error;
      const status = error.code === 'INVALID_REQUEST' ? 400 : 403;
      return ctx.json(
        { status: 'error', errorCode: error.code, errorMessage: error.message },
        status
      );
    }
  };

  // Requests being approved or rejected in this process. Two approvals of the
  // same request read it as pending at the same time, so without this both would
  // refund. (A shared store across instances needs its own compare-and-set.)
  const inFlight = new Set<string>();
  const exclusive = async <T>(id: string, run: () => Promise<T>): Promise<T> => {
    if (inFlight.has(id)) {
      throw new BetterPaymentError(
        `Approval request '${id}' is already being processed`,
        'INVALID_REQUEST'
      );
    }
    inFlight.add(id);
    try {
      return await run();
    } finally {
      inFlight.delete(id);
    }
  };

  const approve = (
    id: string,
    actionOptions: { by: RefundApprovalActor }
  ): Promise<RefundResponse | CancelResponse> => exclusive(id, () => runApprove(id, actionOptions));

  const reject = (
    id: string,
    actionOptions: { by: RefundApprovalActor; reason?: string }
  ): Promise<RefundApprovalRequest> => exclusive(id, () => runReject(id, actionOptions));

  const runApprove = async (
    id: string,
    actionOptions: { by: RefundApprovalActor }
  ): Promise<RefundResponse | CancelResponse> => {
    const item = await store.get(id);
    if (!item) {
      throw new BetterPaymentError(`Approval request '${id}' not found`, 'INVALID_REQUEST');
    }
    if (item.status !== 'pending') {
      throw new BetterPaymentError(
        `Approval request '${id}' is already ${item.status}`,
        'INVALID_REQUEST'
      );
    }

    const requesterId = getUserId(item.requestedBy);
    const approverId = getUserId(actionOptions.by);

    if (requesterId && approverId && requesterId === approverId) {
      throw new BetterPaymentError(
        'Requester cannot approve their own refund request',
        'REFUND_SELF_APPROVAL_FORBIDDEN'
      );
    }

    if (options.approvers && !(await options.approvers(actionOptions.by))) {
      throw new BetterPaymentError(
        'User is not authorized to approve refunds',
        'REFUND_NOT_AUTHORIZED'
      );
    }

    // Saved before the provider call, so a second approval of the same request
    // finds it already approved instead of refunding twice
    item.status = 'approved';
    item.approvedAt = Date.now();
    item.approvedBy = actionOptions.by;
    await store.save(item);

    const provider = pluginCtx.use(item.provider);
    // The APPROVED marker is what makes this plugin's own `before` hook let the
    // request through; without it the approved refund would queue again.
    const request: ApprovedRequest = { ...item.request, [APPROVED]: true };
    return item.operation === 'refund'
      ? await provider.refund(request as RefundRequest)
      : await provider.cancel(request as CancelRequest);
  };

  const runReject = async (
    id: string,
    actionOptions: { by: RefundApprovalActor; reason?: string }
  ): Promise<RefundApprovalRequest> => {
    const item = await store.get(id);
    if (!item) {
      throw new BetterPaymentError(`Approval request '${id}' not found`, 'INVALID_REQUEST');
    }
    if (item.status !== 'pending') {
      throw new BetterPaymentError(
        `Approval request '${id}' is already ${item.status}`,
        'INVALID_REQUEST'
      );
    }

    if (options.approvers && !(await options.approvers(actionOptions.by))) {
      throw new BetterPaymentError(
        'User is not authorized to reject refunds',
        'REFUND_NOT_AUTHORIZED'
      );
    }

    item.status = 'rejected';
    item.rejectedAt = Date.now();
    item.rejectedBy = actionOptions.by;
    item.rejectionReason = actionOptions.reason;
    await store.save(item);

    return item;
  };

  return definePlugin({
    id: 'refund-approval',
    options,
    $ERROR_CODES: {
      REFUND_APPROVAL_REQUIRED: 'Refund requires approval from an authorized manager',
      REFUND_SELF_APPROVAL_FORBIDDEN: 'Requester cannot approve their own refund request',
      REFUND_NOT_AUTHORIZED: 'User is not authorized to approve refunds',
    },
    init: (ctx) => {
      pluginCtx = ctx;
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.operation === 'refund' || ctx.operation === 'cancel',
          handler: async (ctx) => {
            const req = ctx.request as ApprovalRequestView;
            if ((ctx.request as ApprovedRequest)[APPROVED]) {
              return;
            }

            // A cancellation carries no amount: only the merchant's own records
            // know what it voids. An amount that cannot be read waits for approval.
            const rawAmount =
              ctx.operation === 'cancel'
                ? await options.cancelAmount?.(ctx.request, ctx.provider ?? 'default')
                : (req.price ?? req.amount);
            const amount = parseAmount(rawAmount);

            if (amount !== undefined && amount <= threshold) {
              return;
            }

            const id = `apr_${randomHex(12)}`;
            const requestedBy = req.requestedBy ?? req.by ?? req.userId;

            const approvalRecord: RefundApprovalRequest = {
              id,
              operation: ctx.operation as 'refund' | 'cancel',
              provider: ctx.provider ?? 'default',
              paymentId: req.paymentId ?? '',
              amount: amount ?? 0,
              currency: req.currency ?? 'TRY',
              requestedBy,
              status: 'pending',
              request: ctx.request as RefundRequest | CancelRequest,
              createdAt: Date.now(),
            };

            await store.save(approvalRecord);

            if (options.notify) {
              try {
                await options.notify(approvalRecord);
              } catch (notifyErr) {
                pluginCtx.logger?.error(
                  'refundApproval: notify callback failed',
                  notifyErr as Error
                );
              }
            }

            return {
              result: {
                status: PaymentStatus.PENDING,
                code: 'REFUND_APPROVAL_REQUIRED',
                errorCode: 'REFUND_APPROVAL_REQUIRED',
                errorMessage: 'Refund requires approval from an authorized manager',
                approvalId: id,
                paymentId: req.paymentId,
                conversationId: req.conversationId,
              },
            };
          },
        },
      ],
    },
    methods: (ctx) => {
      pluginCtx = ctx;
      return {
        refunds: {
          /** Approves a pending refund request and executes the refund on the provider */
          approve,
          /** Rejects and drops a pending refund request */
          reject,
          /** Lists refund approval requests */
          list: (filter?: { status?: 'pending' | 'approved' | 'rejected' }) => store.list(filter),
          /** Retrieves a specific approval request */
          get: (id: string) => store.get(id),
          /** The storage backend */
          store,
        },
      };
    },
    endpoints: {
      pendingRefunds: {
        method: 'GET',
        path: '/refunds/pending',
        privileged: true,
        handler: async (ctx) => {
          pluginCtx = ctx;
          return await store.list({ status: 'pending' });
        },
      },
      approveRefund: {
        method: 'POST',
        path: '/refunds/approve',
        privileged: true,
        handler: async (ctx) => {
          pluginCtx = ctx;
          const body = (ctx.body ?? {}) as { id?: unknown };
          if (typeof body.id !== 'string' || !body.id) {
            return ctx.json({ status: 'error', errorMessage: 'Missing required field: id' }, 400);
          }
          const by = await actorOf(ctx.request);
          if (by === undefined) return forbidden(ctx);
          return respond(ctx, () => approve(body.id as string, { by }));
        },
      },
      rejectRefund: {
        method: 'POST',
        path: '/refunds/reject',
        privileged: true,
        handler: async (ctx) => {
          pluginCtx = ctx;
          const body = (ctx.body ?? {}) as { id?: unknown; reason?: unknown };
          if (typeof body.id !== 'string' || !body.id) {
            return ctx.json({ status: 'error', errorMessage: 'Missing required field: id' }, 400);
          }
          const by = await actorOf(ctx.request);
          if (by === undefined) return forbidden(ctx);
          const reason = typeof body.reason === 'string' ? body.reason : undefined;
          return respond(ctx, () => reject(body.id as string, { by, reason }));
        },
      },
    },
  });
}
