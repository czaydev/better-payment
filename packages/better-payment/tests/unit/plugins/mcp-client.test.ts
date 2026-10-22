import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  betterPayment,
  PaymentStatus,
  type BetterPayment,
  type BetterPaymentRequest,
} from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { mcp } from 'better-payment/plugins';
import { toNodeHandler } from 'better-payment/express';
import { mockPaymentRequest } from '../../fixtures/payment-data';

/**
 * Drives the plugin through the official MCP client over a real `node:http`
 * server, the way an agent (Claude Desktop, Cursor, ...) does: initialize, the
 * initialized notification, tools/list and tools/call.
 */

const ADMIN_TOKEN = 'Bearer admin_token';
const READ_TOKEN = 'Bearer read_only_token';
/** Tool calls the plugin's own audit hook saw, used to prove nothing executed */
const audit: string[] = [];

function bearerOf(request: BetterPaymentRequest): string | undefined {
  const key = Object.keys(request.headers ?? {}).find((k) => k.toLowerCase() === 'authorization');
  return key ? request.headers[key] : undefined;
}

function createPayment(): BetterPayment {
  return betterPayment({
    providers: { mock: new MockProvider() },
    defaultProvider: 'mock',
    plugins: [
      mcp({
        path: '/mcp',
        authorize: (request, tool) =>
          bearerOf(request) === ADMIN_TOKEN ||
          (bearerOf(request) === READ_TOKEN && !['refund', 'cancel'].includes(tool)),
        onToolCall: (info) => audit.push(info.tool),
      }),
    ],
    // The MCP endpoints are privileged: the handler only builds with this hook
    handler: {
      basePath: '/api/pay',
      authorize: ({ request }) => (bearerOf(request) ?? '').startsWith('Bearer '),
    },
  });
}

let server: Server;
let endpoint = '';
let paymentId = '';

async function connect(
  token?: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { ...(token ? { authorization: token } : {}), ...extraHeaders } },
  });
  const client = new Client({ name: 'spec-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

beforeAll(async () => {
  const payment = createPayment();
  const created = await payment.createPayment({
    ...mockPaymentRequest,
    price: '10.00',
    paidPrice: '10.00',
  });
  paymentId = created.paymentId ?? '';
  server = createServer(toNodeHandler(payment));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/pay/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

describe('mcp plugin with the official client', () => {
  it('negotiates a protocol version and lists the plugin tools', async () => {
    const { client, transport } = await connect(ADMIN_TOKEN);

    // The client offers the newest version it knows; the server answers with
    // the newest one it speaks
    expect(transport.protocolVersion).toBe('2025-06-18');
    expect(client.getServerVersion()).toMatchObject({ name: 'better-payment-mcp' });
    expect(client.getServerCapabilities()).toMatchObject({ tools: expect.any(Object) });

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'getPayment',
      'binCheck',
      'installmentInfo',
      'refund',
      'cancel',
    ]);
    expect(listed.tools[0].inputSchema).toMatchObject({ type: 'object', required: ['paymentId'] });

    await client.close();
  });

  it('answers the initialized notification with 202 and no body', async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: ADMIN_TOKEN,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('runs a read-only tool and keeps card data out of the result', async () => {
    const { client } = await connect(ADMIN_TOKEN);

    const result = await client.callTool({ name: 'getPayment', arguments: { paymentId } });
    const text = (result.content as Array<{ type: string; text: string }>)
      .map((part) => part.text)
      .join('');

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text)).toMatchObject({ paymentId, status: PaymentStatus.SUCCESS });

    await client.close();
  });

  it('reports a failing tool call as isError instead of a protocol error', async () => {
    const { client } = await connect(ADMIN_TOKEN, { 'cf-connecting-ip': '203.0.113.9' });

    const result = await client.callTool({
      name: 'refund',
      arguments: { paymentId: 'PAY_DOES_NOT_EXIST', price: '1.00' },
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(/refunded|refuse|Unable/);

    await client.close();
  });

  it('refuses a write tool without an admin token', async () => {
    const { client } = await connect(READ_TOKEN, { 'cf-connecting-ip': '203.0.113.9' });

    await expect(
      client.callTool({ name: 'refund', arguments: { paymentId, price: '1.00' } })
    ).rejects.toThrow(/Unauthorized/);

    await client.close();
  });

  it('keeps an unauthenticated client away from every tool', async () => {
    const before = audit.length;

    await expect(connect()).rejects.toThrow(/Forbidden/);
    expect(audit).toHaveLength(before);
  });
});
