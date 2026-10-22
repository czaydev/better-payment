import {
  definePlugin,
  PaymentStatus,
  VERSION,
  type BetterPaymentPlugin,
  type BetterPaymentRequest,
  type EndpointContext,
} from 'better-payment';

export type McpToolName = 'getPayment' | 'binCheck' | 'installmentInfo' | 'refund' | 'cancel';

export const ALL_MCP_TOOLS: readonly McpToolName[] = [
  'getPayment',
  'binCheck',
  'installmentInfo',
  'refund',
  'cancel',
];

export const WRITE_MCP_TOOLS: readonly McpToolName[] = ['refund', 'cancel'];

/**
 * Protocol versions this server answers `initialize` with, newest first.
 * The client's version is echoed when it is in this list.
 */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26', '2024-11-05'];

const DEFAULT_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];
const SERVER_NAME = 'better-payment-mcp';

/** JSON-RPC 2.0 error codes (and the MCP-specific one this server adds) */
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const UNAUTHORIZED = -32001;

export interface McpToolCallInfo {
  tool: string;
  /** Sanitized arguments: card-shaped keys are removed before the hook sees them */
  args: Record<string, unknown>;
  /** Sanitized tool result, absent when the tool failed */
  result?: unknown;
  /** The failure message, set when `isError` is true */
  error?: string;
  isError: boolean;
  /** Milliseconds spent in the provider call */
  durationMs: number;
  /** Provider the operation ran on */
  provider: string;
  /** Client IP resolved for the request, when one was available */
  ip?: string;
  timestamp: number;
}

export interface McpOptions {
  /**
   * Endpoint path relative to the handler basePath. Default: '/mcp'
   */
  path?: string;
  /**
   * List of tools exposed by the MCP server. Default: all available tools.
   */
  tools?: McpToolName[];
  /**
   * Authorizes an agent request for a tool. Runs before every tool call, so a
   * request without a valid token never reaches a tool. Write tools
   * (`refund`, `cancel`) also need this option: without it they are refused.
   * The MCP endpoints are privileged, so the handler's own `authorize` hook is
   * required as well and runs first.
   */
  authorize?: (request: BetterPaymentRequest, tool: McpToolName) => boolean | Promise<boolean>;
  /**
   * When true, only read-only tools ('getPayment', 'binCheck', 'installmentInfo') are exposed.
   * Default: false
   */
  readOnly?: boolean;
  /** Server name reported in `serverInfo` during initialization. Default: 'better-payment-mcp' */
  serverName?: string;
  /** Server version reported in `serverInfo`. Default: the better-payment version */
  serverVersion?: string;
  /**
   * Resolves the IP handed to provider write operations (`refund`, `cancel`) and
   * recorded in the audit trail. Defaults to `cf-connecting-ip`, then `x-real-ip`:
   * headers an edge overwrites rather than appends to. `x-forwarded-for` is not
   * read by default because a client can put whatever it likes in it; if your
   * proxy sets it authoritatively (and strips incoming copies), resolve the IP
   * from it here. That trust decision is yours, not the library's.
   */
  getClientIp?: (request: BetterPaymentRequest) => string | undefined;
  /**
   * Callback invoked on every tool call for audit logging and observability.
   * Tool calls also run through the provider proxy, so `refund` and `cancel`
   * emit the normal payment events for `payment.on()` listeners.
   */
  onToolCall?: (info: McpToolCallInfo) => void;
}

const TOOL_DEFINITIONS: Record<
  McpToolName,
  {
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  }
> = {
  getPayment: {
    description: 'Look up payment details and status by payment ID',
    inputSchema: {
      type: 'object',
      properties: {
        paymentId: {
          type: 'string',
          description: 'The provider payment ID returned during checkout',
        },
        provider: {
          type: 'string',
          description: 'Payment provider ID (e.g. iyzico, paytr). Defaults to default provider',
        },
      },
      required: ['paymentId'],
    },
  },
  binCheck: {
    description:
      'Query card issuer bank, card family, card type and brand from first 6-8 digits of a card',
    inputSchema: {
      type: 'object',
      properties: {
        binNumber: { type: 'string', description: 'The first 6 to 8 digits of the payment card' },
        provider: { type: 'string', description: 'Payment provider ID' },
      },
      required: ['binNumber'],
    },
  },
  installmentInfo: {
    description:
      'Query available installment counts and bank campaign commission rates for card BIN and amount',
    inputSchema: {
      type: 'object',
      properties: {
        binNumber: { type: 'string', description: 'Card BIN number (first 6-8 digits)' },
        price: { type: 'string', description: 'Transaction amount (e.g. "100.00")' },
        currency: { type: 'string', description: 'Currency code (e.g. TRY, USD)' },
        provider: { type: 'string', description: 'Payment provider ID' },
      },
      required: ['binNumber', 'price'],
    },
  },
  refund: {
    description: 'Issue a partial or full refund for a captured payment transaction',
    inputSchema: {
      type: 'object',
      properties: {
        paymentId: { type: 'string', description: 'Payment ID to refund' },
        price: { type: 'string', description: 'Amount to refund' },
        currency: { type: 'string', description: 'Currency code (default: TRY)' },
        conversationId: { type: 'string', description: 'Merchant reference or ticket ID' },
        provider: { type: 'string', description: 'Payment provider ID' },
      },
      required: ['paymentId', 'price'],
    },
  },
  cancel: {
    description: 'Void / cancel an unsettled transaction on the same day before batch settlement',
    inputSchema: {
      type: 'object',
      properties: {
        paymentId: { type: 'string', description: 'Payment ID to void/cancel' },
        conversationId: { type: 'string', description: 'Merchant reference or ticket ID' },
        provider: { type: 'string', description: 'Payment provider ID' },
      },
      required: ['paymentId'],
    },
  },
};

const SENSITIVE_CARD_KEYS = new Set([
  'card',
  'cardNumber',
  'cvv',
  'securityCode',
  'expireMonth',
  'expireYear',
  'expiryMonth',
  'expiryYear',
  'cardHolderName',
  'pan',
]);

/** Maximal digit run, card-style separators included */
const DIGIT_RUN = /\d[\d -]*\d/g;

/**
 * Masks every 16-19 digit run inside a string, keeping the last four digits.
 * Length-only (no Luhn check): a long numeric id in a tool result is masked too,
 * which is the safe direction for a response an LLM reads.
 */
function maskPanRuns(value: string): string {
  return value.replace(DIGIT_RUN, (run) => {
    const digits = run.replace(/\D/g, '');
    if (digits.length < 16 || digits.length > 19) return run;
    return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
  });
}

function sanitizeOutput(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskPanRuns(value);
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeOutput);
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_CARD_KEYS.has(k)) continue;
    clean[k] = sanitizeOutput(v);
  }
  return clean;
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

/** A provider result that reports a failed operation */
function isFailureResult(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { status?: unknown }).status === PaymentStatus.FAILURE
  );
}

function failureMessage(value: unknown): string {
  const message = (value as { errorMessage?: unknown }).errorMessage;
  return typeof message === 'string' && message ? message : 'The provider rejected the operation';
}

function readHeader(request: BetterPaymentRequest, name: string): string | undefined {
  const headers = request.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

const CLIENT_IP_HEADERS = ['cf-connecting-ip', 'x-real-ip'];

function defaultClientIp(request: BetterPaymentRequest): string | undefined {
  for (const header of CLIENT_IP_HEADERS) {
    const first = readHeader(request, header)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return undefined;
}

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

type RequestId = string | number;

function result(id: RequestId, value: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result: value };
}

function rpcError(id: RequestId | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Model Context Protocol (MCP) server plugin for better-payment.
 *
 * Exposes payment queries (getPayment, binCheck, installmentInfo) and write operations (refund, cancel)
 * as standard MCP tools over HTTP for AI agents (Cursor, Claude Desktop, OpenAI Assistants, LangChain).
 *
 * Both endpoints are privileged: the HTTP handler only serves them when it is
 * built with an `authorize` hook, and the plugin's own `authorize` option runs
 * before every tool call on top of that.
 *
 * @example
 * ```ts
 * import { mcp } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { iyzico: iyzico({ ... }) },
 *   plugins: [
 *     mcp({
 *       path: '/mcp',
 *       tools: ['getPayment', 'binCheck', 'installmentInfo', 'refund'],
 *       authorize: (req, tool) =>
 *         req.headers['authorization'] === 'Bearer agent_secret' &&
 *         !['refund', 'cancel'].includes(tool),
 *       readOnly: false,
 *     }),
 *   ],
 *   // Required because the MCP endpoints are privileged
 *   handler: { authorize: ({ request }) => isAgentRequest(request) },
 * });
 * ```
 */
export function mcp(options: McpOptions = {}): BetterPaymentPlugin {
  const mcpPath = '/' + trimSlashes(options.path ?? '/mcp');
  const serverName = options.serverName ?? SERVER_NAME;
  const serverVersion = options.serverVersion ?? VERSION;
  const allowedTools = new Set<McpToolName>(
    (options.tools ?? ALL_MCP_TOOLS).filter((t) => {
      if (options.readOnly && WRITE_MCP_TOOLS.includes(t)) {
        return false;
      }
      return true;
    })
  );

  const serverInfo = () => ({
    name: serverName,
    version: serverVersion,
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    status: 'running',
    tools: Array.from(allowedTools),
  });

  const callTool = async (ctx: EndpointContext, id: RequestId, params: Record<string, unknown>) => {
    const toolName = typeof params.name === 'string' ? (params.name as McpToolName) : undefined;
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const safeArgs = sanitizeOutput(args) as Record<string, unknown>;
    const ip = (options.getClientIp ?? defaultClientIp)(ctx.request);
    const started = Date.now();

    if (!toolName || !ALL_MCP_TOOLS.includes(toolName)) {
      return ctx.json(
        rpcError(id, METHOD_NOT_FOUND, `Tool '${String(params.name)}' is not defined`)
      );
    }
    if (!allowedTools.has(toolName)) {
      return ctx.json(
        rpcError(id, METHOD_NOT_FOUND, `Tool '${toolName}' is not exposed by this server`)
      );
    }

    const providerId =
      (typeof args.provider === 'string' && args.provider) ||
      ctx.defaultProvider ||
      ctx.providerIds[0] ||
      'default';

    // Denied and failed calls are audit events too: the hook and the log line
    // name the attempt without ever carrying the request or the result
    const record = (outcome: 'denied' | 'failed', message: string) => {
      options.onToolCall?.({
        tool: toolName,
        args: safeArgs,
        error: message,
        isError: true,
        durationMs: Date.now() - started,
        provider: providerId,
        ...(ip ? { ip } : {}),
        timestamp: Date.now(),
      });
      ctx.logger?.info(`mcp: tool '${toolName}' ${outcome}`, {
        tool: toolName,
        provider: providerId,
        durationMs: Date.now() - started,
      });
    };

    // A failing tool answers with `isError`, not with a JSON-RPC error: that is
    // how MCP clients show the failure to the model instead of dropping the call.
    const fail = (message: string, data?: unknown) => {
      record('failed', message);
      return ctx.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: data === undefined ? message : `${message}\n${JSON.stringify(data, null, 2)}`,
            },
          ],
          isError: true,
        },
      });
    };

    const deny = (message: string) => {
      record('denied', message);
      return ctx.json(rpcError(id, UNAUTHORIZED, message), 401);
    };

    // Write tools need an authorizer of their own, on top of the handler hook
    // that `privileged` already forces.
    const isWrite = WRITE_MCP_TOOLS.includes(toolName);
    if (isWrite && !options.authorize) {
      return deny(
        `Tool '${toolName}' is a write operation: the mcp plugin needs an 'authorize' option`
      );
    }
    if (options.authorize && !(await options.authorize(ctx.request, toolName))) {
      return deny(`Unauthorized: access to tool '${toolName}' was denied`);
    }

    const missing = TOOL_DEFINITIONS[toolName].inputSchema.required.filter(
      (key) => args[key] === undefined || args[key] === ''
    );

    if (missing.length > 0) {
      return fail(`Missing required argument(s): ${missing.join(', ')}`);
    }
    if (isWrite && !ip) {
      return fail(
        "No client IP for this request: set the mcp plugin's getClientIp option or a forwarding header your edge controls"
      );
    }

    try {
      // The proxied provider runs the plugin hooks and emits the payment events
      // of write operations, so refunds and cancellations reach `payment.on()`
      const provider = ctx.use(providerId);
      let executionResult: unknown;
      switch (toolName) {
        case 'getPayment': {
          executionResult = await provider.getPayment(String(args.paymentId));
          break;
        }
        case 'binCheck': {
          executionResult = await provider.binCheck(String(args.binNumber));
          break;
        }
        case 'installmentInfo': {
          executionResult = await provider.installmentInfo({
            binNumber: String(args.binNumber),
            price: String(args.price),
            conversationId: args.conversationId ? String(args.conversationId) : undefined,
          });
          break;
        }
        case 'refund': {
          executionResult = await provider.refund({
            paymentId: String(args.paymentId),
            price: String(args.price),
            currency: (args.currency as string) ?? 'TRY',
            conversationId: args.conversationId as string | undefined,
            ip: ip as string,
          });
          break;
        }
        case 'cancel': {
          executionResult = await provider.cancel({
            paymentId: String(args.paymentId),
            conversationId: args.conversationId as string | undefined,
            ip: ip as string,
          });
          break;
        }
      }

      const safeResult = sanitizeOutput(executionResult);
      // A provider answer that says `failure` is a failed call, not a successful
      // one that happens to carry a reason
      if (isFailureResult(executionResult)) {
        return fail(failureMessage(executionResult), safeResult);
      }
      options.onToolCall?.({
        tool: toolName,
        args: safeArgs,
        result: safeResult,
        isError: false,
        durationMs: Date.now() - started,
        provider: providerId,
        ...(ip ? { ip } : {}),
        timestamp: Date.now(),
      });
      // Never the request or the result: an audit line names the call only
      ctx.logger?.info(`mcp: tool '${toolName}' called`, {
        tool: toolName,
        provider: providerId,
        durationMs: Date.now() - started,
      });

      return ctx.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(safeResult, null, 2) }],
        },
      });
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };

  const rpc = async (ctx: EndpointContext) => {
    const body = ctx.body as JsonRpcMessage | undefined;
    if (!body || typeof body !== 'object') {
      return ctx.json(rpcError(null, INVALID_REQUEST, 'Expected a single JSON-RPC 2.0 object'));
    }

    const id = body.id;
    const isRequest = typeof id === 'string' || typeof id === 'number';
    const method = typeof body.method === 'string' ? body.method : undefined;

    // Notifications carry no id: answer 202 with an empty body, as the
    // Streamable HTTP transport of the MCP spec requires.
    if (!isRequest) {
      return ctx.json(undefined, 202);
    }
    if (body.jsonrpc !== '2.0' || !method) {
      return ctx.json(rpcError(id, INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request'));
    }

    if (method === 'initialize') {
      const params = (body.params ?? {}) as Record<string, unknown>;
      const requested = params.protocolVersion;
      // Echo the client's version when we speak it, otherwise our newest one
      const protocolVersion =
        typeof requested === 'string' && MCP_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : DEFAULT_PROTOCOL_VERSION;
      return ctx.json(
        result(id, {
          protocolVersion,
          serverInfo: { name: serverName, version: serverVersion },
          capabilities: { tools: { listChanged: false } },
        })
      );
    }

    if (method === 'ping') {
      return ctx.json(result(id, {}));
    }

    if (method === 'tools/list') {
      const tools = Array.from(allowedTools).map((name) => ({
        name,
        description: TOOL_DEFINITIONS[name].description,
        inputSchema: TOOL_DEFINITIONS[name].inputSchema,
      }));
      return ctx.json(result(id, { tools }));
    }

    if (method === 'tools/call') {
      return callTool(ctx, id, (body.params ?? {}) as Record<string, unknown>);
    }

    return ctx.json(rpcError(id, METHOD_NOT_FOUND, `Method '${method}' not found`));
  };

  return definePlugin({
    id: 'mcp',
    options,
    endpoints: {
      mcpInfo: {
        method: 'GET',
        path: `${mcpPath}/info`,
        privileged: true,
        handler: () => serverInfo(),
      },
      mcpRpc: {
        method: 'POST',
        path: mcpPath,
        privileged: true,
        handler: rpc,
      },
    },
  });
}
