import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  PaymentStatus,
  type BetterPayment,
  type BetterPaymentRequest,
  type PaymentResponse,
  type RefundRequest,
} from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { mcp, type McpOptions } from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

const TOKEN = 'Bearer agent_secret';
const MCP_URL = 'http://localhost/api/pay/mcp';
/** Any 16-19 digit run, card-style separators included, is a possible PAN */
const PAN_RUN = /\d(?:[ -]?\d){15,18}/;

interface RpcBody {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
}

/** `BetterPaymentRequest.headers` keeps the client's own key casing */
function headerOf(request: BetterPaymentRequest, name: string): string | undefined {
  const key = Object.keys(request.headers ?? {}).find((k) => k.toLowerCase() === name);
  return key ? request.headers[key] : undefined;
}

const bearerOf = (request: BetterPaymentRequest) => headerOf(request, 'authorization') === TOKEN;

function createPayment(
  options: McpOptions = {},
  authorize: (request: BetterPaymentRequest) => boolean = () => true
): BetterPayment {
  return betterPayment({
    providers: { mock: new MockProvider() },
    defaultProvider: 'mock',
    plugins: [mcp({ path: '/mcp', ...options })],
    // The MCP endpoints are privileged, so the handler will not build without this hook
    handler: { basePath: '/api/pay', authorize: ({ request }) => authorize(request) },
  });
}

function post(payment: BetterPayment, body: RpcBody, headers: Record<string, string> = {}) {
  return payment.handler.handle({
    method: 'POST',
    url: MCP_URL,
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

function callTool(
  payment: BetterPayment,
  name: string,
  args: Record<string, unknown>,
  id = 1,
  headers: Record<string, string> = {}
) {
  return post(
    payment,
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    headers
  );
}

function envelope(response: { body: unknown }): Record<string, unknown> {
  return (response.body ?? {}) as Record<string, unknown>;
}

function rpcResult(response: { body: unknown }): Record<string, unknown> {
  return (envelope(response).result ?? {}) as Record<string, unknown>;
}

function rpcErrorOf(response: { body: unknown }): Record<string, unknown> | undefined {
  return envelope(response).error as Record<string, unknown> | undefined;
}

/** The text content of a `tools/call` result */
function contentText(result: Record<string, unknown>): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content.map((part) => part.text).join('\n');
}

/** Answers `getPayment` with what the test needs, for the masking and throwing cases */
class ScriptedProvider extends MockProvider {
  private left: number;

  constructor(
    private readonly answer: PaymentResponse | Error,
    times = 1
  ) {
    super();
    this.left = times;
  }

  override async getPayment(paymentId: string): Promise<PaymentResponse> {
    if (this.left <= 0) return super.getPayment(paymentId);
    this.left--;
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

class RecordingProvider extends MockProvider {
  readonly refundRequests: RefundRequest[] = [];

  override async refund(request: RefundRequest) {
    this.refundRequests.push(request);
    return super.refund(request);
  }
}

describe('mcp plugin', () => {
  describe('authorization', () => {
    it('refuses to build a handler for the privileged endpoints without an authorize hook', () => {
      const payment = betterPayment({
        providers: { mock: new MockProvider() },
        plugins: [mcp({ path: '/mcp' })],
        handler: { basePath: '/api/pay' },
      });

      expect(() => payment.handler).toThrow(/authorize/);
    });

    it('keeps a request without a valid token away from every tool', async () => {
      const onToolCall = vi.fn();
      const payment = createPayment({ authorize: bearerOf, onToolCall }, bearerOf);

      const requests: RpcBody[] = [
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'refund', arguments: { paymentId: 'pay_1', price: '1.00' } },
        },
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'getPayment', arguments: { paymentId: 'pay_1' } },
        },
      ];
      for (const body of requests) {
        expect((await post(payment, body)).status).toBe(403);
      }
      const info = await payment.handler.handle({
        method: 'GET',
        url: 'http://localhost/api/pay/mcp/info',
        headers: {},
      });
      expect(info.status).toBe(403);
      expect(onToolCall).not.toHaveBeenCalled();
    });

    it('answers 401 with a JSON-RPC error when the tool authorizer denies the call', async () => {
      const onToolCall = vi.fn();
      const payment = createPayment(
        {
          authorize: (_request, tool) => !['refund', 'cancel'].includes(tool),
          onToolCall,
        },
        bearerOf
      );

      const response = await callTool(payment, 'refund', { paymentId: 'pay_1', price: '1.00' }, 7, {
        authorization: TOKEN,
      });

      expect(response.status).toBe(401);
      expect(rpcErrorOf(response)).toMatchObject({ code: -32001 });
      expect(envelope(response).id).toBe(7);
      // A denial is audit-worthy even though no tool ever ran
      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall.mock.calls[0][0]).toMatchObject({ tool: 'refund', isError: true });
      expect(onToolCall.mock.calls[0][0].error).toMatch(/denied/);
    });

    it('requires an authorize option for write tools', async () => {
      const payment = createPayment();

      const response = await callTool(payment, 'cancel', { paymentId: 'pay_1' }, 8, {
        authorization: TOKEN,
        'cf-connecting-ip': '203.0.113.9',
      });

      expect(response.status).toBe(401);
      expect(rpcErrorOf(response)?.message).toMatch(/write operation/);
    });

    it('hides write tools in readOnly mode and refuses to run them', async () => {
      const payment = createPayment({ readOnly: true });

      const list = await post(payment, { jsonrpc: '2.0', id: 6, method: 'tools/list' });
      const tools = (rpcResult(list).tools as Array<{ name: string }>).map((tool) => tool.name);
      expect(tools).toContain('getPayment');
      expect(tools).not.toContain('refund');

      // A tool this server does not expose is a JSON-RPC error, not an HTTP error
      const call = await callTool(payment, 'refund', { paymentId: 'pay_1', price: '1.00' }, 7);
      expect(call.status).toBe(200);
      expect(rpcErrorOf(call)).toMatchObject({ code: -32601 });
    });

    it('exposes only the configured tools', async () => {
      const payment = createPayment({ tools: ['binCheck'] });

      const list = await post(payment, { jsonrpc: '2.0', id: 1, method: 'tools/list' });

      expect((rpcResult(list).tools as Array<{ name: string }>).map((t) => t.name)).toEqual([
        'binCheck',
      ]);
    });
  });

  describe('protocol', () => {
    it('echoes a protocol version the client asks for', async () => {
      const payment = createPayment();

      for (const [index, version] of ['2025-06-18', '2025-03-26', '2024-11-05'].entries()) {
        const response = await post(payment, {
          jsonrpc: '2.0',
          id: index,
          method: 'initialize',
          params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'cursor' } },
        });
        expect(rpcResult(response).protocolVersion).toBe(version);
      }
    });

    it('falls back to the server version for a version it does not speak', async () => {
      const payment = createPayment();

      const response = await post(payment, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '1999-01-01' },
      });

      const result = rpcResult(response);
      expect(result.protocolVersion).toBe('2025-06-18');
      expect(result.serverInfo).toMatchObject({ name: 'better-payment-mcp' });
      expect(result.capabilities).toMatchObject({ tools: expect.any(Object) });
    });

    it('answers a notification with 202 and no body', async () => {
      const payment = createPayment();

      for (const method of ['notifications/initialized', 'notifications/cancelled', 'nope']) {
        const response = await post(payment, { jsonrpc: '2.0', method });
        expect(response.status).toBe(202);
        expect(response.body).toBeUndefined();
      }
    });

    it('answers JSON-RPC errors with HTTP 200', async () => {
      const payment = createPayment();

      const unknownMethod = await post(payment, {
        jsonrpc: '2.0',
        id: 3,
        method: 'resources/list',
      });
      expect(unknownMethod.status).toBe(200);
      expect(rpcErrorOf(unknownMethod)).toMatchObject({ code: -32601, message: /not found/ });

      const invalidRequest = await post(payment, { id: 4, method: 'initialize' });
      expect(invalidRequest.status).toBe(200);
      expect(rpcErrorOf(invalidRequest)).toMatchObject({ code: -32600 });
      expect(envelope(invalidRequest).id).toBe(4);
    });

    it('reports a tool failure as a result with isError', async () => {
      // A provider that answers with a failure result
      const payment = createPayment({ authorize: () => true });
      const refused = await callTool(
        payment,
        'refund',
        { paymentId: 'PAY_UNKNOWN', price: '1.00' },
        5,
        { 'cf-connecting-ip': '203.0.113.9' }
      );
      expect(refused.status).toBe(200);
      expect(rpcErrorOf(refused)).toBeUndefined();
      expect(rpcResult(refused).isError).toBe(true);
      expect(contentText(rpcResult(refused))).toMatch(/Only a successful payment can be refunded/);

      // A provider that throws
      const throwing = betterPayment({
        providers: { mock: new ScriptedProvider(new Error('provider unreachable')) },
        defaultProvider: 'mock',
        plugins: [mcp({ path: '/mcp' })],
        handler: { basePath: '/api/pay', authorize: () => true },
      });
      const failed = await callTool(throwing, 'getPayment', { paymentId: 'PAY1' }, 6);
      expect(failed.status).toBe(200);
      expect(rpcResult(failed).isError).toBe(true);
      expect(contentText(rpcResult(failed))).toBe('provider unreachable');

      // Missing arguments
      const incomplete = await callTool(payment, 'installmentInfo', { binNumber: '540667' }, 7);
      expect(incomplete.status).toBe(200);
      expect(rpcResult(incomplete).isError).toBe(true);
      expect(contentText(rpcResult(incomplete))).toMatch(/price/);
    });
  });

  describe('client identity', () => {
    it('passes the request IP to write operations instead of a fixed address', async () => {
      const provider = new RecordingProvider();
      const payment = betterPayment({
        providers: { mock: provider },
        defaultProvider: 'mock',
        plugins: [mcp({ path: '/mcp', authorize: () => true })],
        handler: { basePath: '/api/pay', authorize: () => true },
      });
      const created = await payment.createPayment({
        ...mockPaymentRequest,
        price: '10.00',
        paidPrice: '10.00',
      });

      await callTool(payment, 'refund', { paymentId: created.paymentId, price: '5.00' }, 1, {
        'cf-connecting-ip': '203.0.113.9',
      });
      expect(provider.refundRequests[0].ip).toBe('203.0.113.9');

      await callTool(payment, 'refund', { paymentId: created.paymentId, price: '5.00' }, 2, {
        'x-real-ip': '198.51.100.7',
      });
      expect(provider.refundRequests[1].ip).toBe('198.51.100.7');

      // x-forwarded-for is client-appendable: it is never trusted by default
      const spoofed = await callTool(
        payment,
        'refund',
        { paymentId: created.paymentId, price: '5.00' },
        3,
        { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }
      );
      expect(rpcResult(spoofed).isError).toBe(true);
      expect(contentText(rpcResult(spoofed))).toMatch(/getClientIp/);
      expect(provider.refundRequests).toHaveLength(2);

      // With no IP to read, the write is refused instead of attributed to a fake address
      const refused = await callTool(
        payment,
        'refund',
        { paymentId: created.paymentId, price: '5.00' },
        4
      );
      expect(rpcResult(refused).isError).toBe(true);
      expect(contentText(rpcResult(refused))).toMatch(/getClientIp/);
      expect(provider.refundRequests).toHaveLength(2);
      expect(JSON.stringify(provider.refundRequests)).not.toContain('127.0.0.1');
    });

    it('lets the host app resolve the IP itself', async () => {
      const provider = new RecordingProvider();
      const payment = betterPayment({
        providers: { mock: provider },
        defaultProvider: 'mock',
        plugins: [
          mcp({
            path: '/mcp',
            authorize: () => true,
            getClientIp: (request) => headerOf(request, 'x-agent-ip'),
          }),
        ],
        handler: { basePath: '/api/pay', authorize: () => true },
      });
      const created = await payment.createPayment({
        ...mockPaymentRequest,
        price: '10.00',
        paidPrice: '10.00',
      });

      const response = await callTool(payment, 'cancel', { paymentId: created.paymentId }, 1, {
        'cf-connecting-ip': '203.0.113.9',
        'x-agent-ip': '192.0.2.10',
      });

      expect(rpcResult(response).isError).toBeUndefined();
      expect(provider.getRecord(created.paymentId)?.state).toBe('cancelled');
    });

    it('records the resolved IP in the audit hook', async () => {
      const onToolCall = vi.fn();
      const payment = createPayment({ onToolCall });

      await callTool(payment, 'binCheck', { binNumber: '540667' }, 1, {
        'x-real-ip': '203.0.113.42',
      });

      expect(onToolCall.mock.calls[0][0]).toMatchObject({ tool: 'binCheck', ip: '203.0.113.42' });
    });
  });

  describe('card data safety', () => {
    const PAN = '4111111111111111';
    it('never returns a full PAN in a tool result', async () => {
      const leaky = new ScriptedProvider({
        status: PaymentStatus.SUCCESS,
        paymentId: 'MOCK1',
        errorMessage: `card ${PAN} declined by the issuer`,
        rawResponse: {
          cardNumber: PAN,
          maskedCardNumber: '4111 1111 1111 1111',
          lastFourDigits: '1111',
          cvv: '123',
          cards: [{ number: '4111-1111-1111-1111' }],
        },
      } as PaymentResponse);
      const payment = betterPayment({
        providers: { mock: leaky },
        defaultProvider: 'mock',
        plugins: [mcp({ path: '/mcp' })],
        handler: { basePath: '/api/pay', authorize: () => true },
      });

      const response = await callTool(payment, 'getPayment', { paymentId: 'MOCK1' }, 1);

      const text = contentText(rpcResult(response));
      expect(text).not.toMatch(PAN_RUN);
      expect(text).not.toContain(PAN);
      expect(text).not.toContain('4111');
      // The masked form keeps the last four digits, dropped keys keep nothing
      expect(text).toContain('*******1111');
      expect(text).not.toContain('"cardNumber"');
      expect(text).not.toContain('"cvv"');
    });

    it('sanitizes the arguments handed to the audit hook', async () => {
      const calls: unknown[] = [];
      const payment = createPayment({ onToolCall: (info) => calls.push(info) });

      await callTool(payment, 'binCheck', { binNumber: '540667', cardNumber: PAN }, 1);

      expect(JSON.stringify(calls[0])).not.toMatch(PAN_RUN);
      expect(JSON.stringify(calls[0])).not.toContain('cardNumber');
    });
  });

  describe('audit trail', () => {
    it('names every tool call in the library logger, without bodies', async () => {
      const info = vi.fn();
      const payment = betterPayment({
        providers: { mock: new MockProvider() },
        defaultProvider: 'mock',
        logger: { debug: vi.fn(), info, error: vi.fn() },
        plugins: [mcp({ path: '/mcp' })],
        handler: { basePath: '/api/pay', authorize: () => true },
      });

      await callTool(payment, 'binCheck', { binNumber: '540667' }, 1);

      expect(info).toHaveBeenCalledWith(
        "mcp: tool 'binCheck' called",
        expect.objectContaining({ tool: 'binCheck', provider: 'mock' })
      );
      expect(JSON.stringify(info.mock.calls)).not.toContain('540667');
    });

    it('pushes write tools through the normal payment event pipeline', async () => {
      const seen: string[] = [];
      const provider = new MockProvider();
      const payment = betterPayment({
        providers: { mock: provider },
        defaultProvider: 'mock',
        plugins: [mcp({ path: '/mcp', authorize: () => true })],
        handler: { basePath: '/api/pay', authorize: () => true },
      });
      const stop = payment.on('refund.succeeded', (event) => {
        seen.push(event.paymentId ?? '');
      });
      const created = await payment.createPayment({
        ...mockPaymentRequest,
        price: '10.00',
        paidPrice: '10.00',
      });

      await callTool(payment, 'refund', { paymentId: created.paymentId, price: '4.00' }, 1, {
        'cf-connecting-ip': '203.0.113.9',
      });
      stop();

      expect(seen).toEqual([created.paymentId]);
      expect(provider.getRecord(created.paymentId)?.refundedAmount).toBe(400);
    });

    it('keeps the onToolCall hook for both outcomes', async () => {
      const onToolCall = vi.fn();
      const payment = createPayment({ onToolCall, authorize: () => true });
      const created = await payment.createPayment(mockPaymentRequest);

      await callTool(payment, 'getPayment', { paymentId: created.paymentId }, 1);
      await callTool(payment, 'getPayment', { paymentId: 'PAY_MISSING' }, 2);

      expect(onToolCall).toHaveBeenCalledTimes(2);
      expect(onToolCall.mock.calls[0][0]).toMatchObject({
        tool: 'getPayment',
        isError: false,
        provider: 'mock',
      });
      expect((onToolCall.mock.calls[0][0].result as PaymentResponse).paymentId).toBe(
        created.paymentId
      );
      expect(onToolCall.mock.calls[1][0]).toMatchObject({ isError: true });
      expect(onToolCall.mock.calls[1][0].error).toEqual(expect.any(String));
    });
  });

  describe('tools', () => {
    it('lists the exposed tools with their input schemas', async () => {
      const payment = createPayment();

      const response = await post(payment, { jsonrpc: '2.0', id: 2, method: 'tools/list' });

      const tools = rpcResult(response).tools as Array<{
        name: string;
        description: string;
        inputSchema: { type: string; required: string[] };
      }>;
      expect(tools.map((tool) => tool.name)).toEqual([
        'getPayment',
        'binCheck',
        'installmentInfo',
        'refund',
        'cancel',
      ]);
      expect(tools[0].description).toMatch(/payment/i);
      expect(tools[0].inputSchema.required).toEqual(['paymentId']);
    });

    it('runs the read-only query tools', async () => {
      const payment = createPayment();
      const created = await payment.createPayment(mockPaymentRequest);

      const getPayment = await callTool(payment, 'getPayment', { paymentId: created.paymentId }, 3);
      expect(getPayment.status).toBe(200);
      expect(JSON.parse(contentText(rpcResult(getPayment)))).toMatchObject({
        paymentId: created.paymentId,
        status: PaymentStatus.SUCCESS,
      });

      const binCheck = await callTool(payment, 'binCheck', { binNumber: '540667' }, 4);
      expect(JSON.parse(contentText(rpcResult(binCheck)))).toMatchObject({ bankName: 'Mock Bank' });

      const installments = await callTool(
        payment,
        'installmentInfo',
        { binNumber: '540667', price: '1000.00' },
        5
      );
      expect(rpcResult(installments).isError).toBeUndefined();
    });

    it('answers ping and serves the info endpoint', async () => {
      const payment = createPayment({ serverName: 'shop-mcp', serverVersion: '3.1.0' });

      const ping = await post(payment, { jsonrpc: '2.0', id: 9, method: 'ping' });
      expect(ping.status).toBe(200);
      expect(rpcResult(ping)).toEqual({});

      const info = await payment.handler.handle({
        method: 'GET',
        url: 'http://localhost/api/pay/mcp/info',
        headers: {},
      });
      expect(info.status).toBe(200);
      expect(info.body).toMatchObject({
        name: 'shop-mcp',
        version: '3.1.0',
        protocolVersion: '2025-06-18',
        tools: ['getPayment', 'binCheck', 'installmentInfo', 'refund', 'cancel'],
      });
    });
  });
});
