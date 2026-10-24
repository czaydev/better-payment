import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import {
  callbackLine,
  extractTunnelUrl,
  startCloudflared,
  startProxy,
  TunnelError,
  type QuickTunnel,
  type TunnelHandlers,
  type TunnelProcess,
  type TunnelSpawner,
} from '../src/tunnel';
import type { CallbackLogEntry } from '../src/callback-log';

function spawnerThat(run: (handlers: TunnelHandlers) => void): TunnelSpawner {
  return {
    spawn(_command, _args, handlers): TunnelProcess {
      run(handlers);
      return { stop: () => undefined };
    },
  };
}

describe('extractTunnelUrl', () => {
  it('reads the trycloudflare hostname out of a log line', () => {
    expect(extractTunnelUrl('2026-01-01 INFO |  https://random-words-here.trycloudflare.com')).toBe(
      'https://random-words-here.trycloudflare.com'
    );
  });

  it('ignores unrelated lines', () => {
    expect(extractTunnelUrl('cloudflared v2026.1.0 starting')).toBeUndefined();
    expect(extractTunnelUrl('https://evil.example.com')).toBeUndefined();
  });
});

describe('startCloudflared', () => {
  it('resolves with the url from stdout', async () => {
    let tunnel: QuickTunnel | undefined;
    await startCloudflared({
      port: 3000,
      spawner: spawnerThat((handlers) => {
        handlers.onLine('|  https://example-tunnel.trycloudflare.com |');
      }),
    }).then((value) => {
      tunnel = value;
    });
    expect(tunnel?.url).toBe('https://example-tunnel.trycloudflare.com');
    tunnel?.stop();
  });

  it('invokes cloudflared with the tunnel arguments', async () => {
    const calls: { command: string; args: string[] }[] = [];
    await startCloudflared({
      port: 4321,
      spawner: {
        spawn(command, args, handlers) {
          calls.push({ command, args });
          handlers.onLine('https://x.trycloudflare.com');
          return { stop: () => undefined };
        },
      },
    });
    expect(calls[0].command).toBe('cloudflared');
    expect(calls[0].args).toContain('--url');
    expect(calls[0].args).toContain('http://localhost:4321');
  });

  it('fails with TUNNEL_EXITED when the process dies first', async () => {
    await expect(
      startCloudflared({
        port: 3000,
        spawner: spawnerThat((handlers) => handlers.onExit(1)),
      })
    ).rejects.toMatchObject({ code: 'TUNNEL_EXITED' });
  });

  it('fails with MISSING_CLOUDFLARED on ENOENT', async () => {
    await expect(
      startCloudflared({
        port: 3000,
        spawner: spawnerThat((handlers) =>
          handlers.onError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
        ),
      })
    ).rejects.toMatchObject({ code: 'MISSING_CLOUDFLARED' });
  });

  it('fails with TUNNEL_TIMEOUT when no url appears', async () => {
    await expect(
      startCloudflared({ port: 3000, timeoutMs: 20, spawner: spawnerThat(() => undefined) })
    ).rejects.toMatchObject({ code: 'TUNNEL_TIMEOUT' });
  });

  it('keeps the last output lines for the timeout message', async () => {
    const caught: unknown = await startCloudflared({
      port: 3000,
      timeoutMs: 20,
      spawner: spawnerThat((handlers) => {
        for (let index = 0; index < 60; index++) handlers.onLine(`noise ${index}`);
      }),
    }).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(TunnelError);
    const error = caught as TunnelError;
    expect(error.output.length).toBeGreaterThan(0);
    expect(error.output.at(-1)).toBe('noise 59');
  });

  it('stops the process once the url was found', async () => {
    let stopped = 0;
    const tunnel = await startCloudflared({
      port: 3000,
      spawner: {
        spawn(_command, _args, handlers) {
          handlers.onLine('https://stop-me.trycloudflare.com');
          return { stop: () => void stopped++ };
        },
      },
    });
    tunnel.stop();
    expect(stopped).toBe(1);
  });
});

function listenOn(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function requestVia(
  port: number,
  path: string,
  method = 'POST'
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const upstream = httpRequest({ host: '127.0.0.1', port, path, method }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => void (body += chunk.toString('utf8')));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    upstream.on('error', reject);
    upstream.end(method === 'POST' ? 'payload' : undefined);
  });
}

describe('startProxy', () => {
  const servers: Server[] = [];

  afterAll(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it('forwards the request and logs provider, route and status', async () => {
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('upstream-ok');
    });
    servers.push(upstream);
    const upstreamPort = await listenOn(upstream);

    const entries: CallbackLogEntry[] = [];
    const proxy = await startProxy({
      targetPort: upstreamPort,
      basePath: '/api/pay',
      onCallback: (entry) => entries.push(entry),
    });

    const result = await requestVia(proxy.port, '/api/pay/iyzico/payment/complete-3ds?token=x');
    expect(result.status).toBe(200);
    expect(result.body).toBe('upstream-ok');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      provider: 'iyzico',
      route: 'payment/complete-3ds',
      method: 'POST',
      status: 200,
      hadQuery: true,
    });
    expect(JSON.stringify(entries[0])).not.toContain('token=x');

    await proxy.close();
  });

  it('logs health requests outside a callback route', async () => {
    const upstream = createServer((_request, response) => response.end('ok'));
    servers.push(upstream);
    const upstreamPort = await listenOn(upstream);

    const entries: CallbackLogEntry[] = [];
    const proxy = await startProxy({
      targetPort: upstreamPort,
      basePath: '/api/pay',
      onCallback: (entry) => entries.push(entry),
    });

    const result = await requestVia(proxy.port, '/api/pay/health', 'GET');
    expect(result.status).toBe(200);
    // The first path segment after the base path is treated as the provider, so
    // /api/pay/health logs as provider "health" with an unknown route.
    expect(entries[0]).toMatchObject({ provider: 'health', route: 'unknown', method: 'GET' });

    await proxy.close();
  });

  it('answers 502 when the app is not reachable', async () => {
    const open = createServer(() => undefined);
    servers.push(open);
    const deadPort = await listenOn(open);
    await new Promise<void>((done) => open.close(() => done()));

    const entries: CallbackLogEntry[] = [];
    const proxy = await startProxy({
      targetPort: deadPort,
      basePath: '/api/pay',
      onCallback: (entry) => entries.push(entry),
    });

    const result = await requestVia(proxy.port, '/api/pay/paytr/callback');
    expect(result.status).toBe(502);
    expect(result.body).toContain('Bad gateway');
    expect(entries[0].status).toBe(502);

    await proxy.close();
  });

  it('renders the callback line through the re-export', () => {
    expect(
      callbackLine({
        provider: 'paytr',
        route: 'callback',
        method: 'POST',
        status: 200,
        durationMs: 5,
        hadQuery: true,
      })
    ).toContain('(query masked)');
  });
});
