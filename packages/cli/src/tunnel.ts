/**
 * Cloudflare quick tunnels, with zero npm dependencies: `cloudflared` is spawned
 * as a child process and its hostname is read from stdout.
 *
 * `listen` also runs a small local proxy in front of the app. The tunnel points
 * at the proxy, so every callback can be logged as provider + route + status
 * without touching the app. The proxy forwards the request body untouched and
 * never reads or prints it.
 */
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { describeCallback, formatCallback, type CallbackLogEntry } from './callback-log';

export const CLOUDFLARED_INSTALL = [
  'Install cloudflared, then re-run listen:',
  '  macOS:   brew install cloudflared',
  '  Windows: winget install --id Cloudflare.cloudflared',
  '  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  'Or keep your own tunnel and pass --url https://your-tunnel.example.com',
].join('\n');

export class TunnelError extends Error {
  constructor(
    message: string,
    readonly code: 'MISSING_CLOUDFLARED' | 'TUNNEL_EXITED' | 'TUNNEL_TIMEOUT' | 'SPAWN_FAILED',
    readonly output: string[] = []
  ) {
    super(message);
    this.name = 'TunnelError';
  }
}

/** `https://random-words.trycloudflare.com` out of a cloudflared log line */
export function extractTunnelUrl(line: string): string | undefined {
  const match = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i.exec(line);
  return match ? match[0] : undefined;
}

export interface TunnelProcess {
  stop(): void;
}

export interface TunnelHandlers {
  onLine(line: string): void;
  onError(error: NodeJS.ErrnoException): void;
  onExit(code: number | null): void;
}

export interface TunnelSpawner {
  spawn(command: string, args: string[], handlers: TunnelHandlers): TunnelProcess;
}

/** The real spawner: `cloudflared tunnel --url http://localhost:<port>` */
export const cloudflaredSpawner: TunnelSpawner = {
  spawn(command, args, handlers) {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const lines: string[] = [];
    const forward = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        lines.push(line);
        // Keep a bounded history for the timeout message
        if (lines.length > 50) lines.shift();
        handlers.onLine(line);
      }
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.once('error', (error) => handlers.onError(error as NodeJS.ErrnoException));
    child.once('exit', (code) => handlers.onExit(code));
    return {
      stop: () => {
        try {
          child.kill();
        } catch {
          // already gone
        }
      },
    };
  },
};

export interface QuickTunnel {
  url: string;
  stop(): void;
}

/** Starts a quick tunnel and resolves with its public URL */
export function startCloudflared(options: {
  port: number;
  spawner?: TunnelSpawner;
  timeoutMs?: number;
}): Promise<QuickTunnel> {
  const spawner = options.spawner ?? cloudflaredSpawner;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const output: string[] = [];
    // `let`, not `const`: the spawner may call the handlers synchronously from
    // spawn(), before the assignment completes — a const would be in its TDZ.
    // eslint-disable-next-line prefer-const
    let process: TunnelProcess | undefined;

    const finish = (error?: TunnelError, tunnel?: QuickTunnel): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        process?.stop();
        reject(error);
      } else if (tunnel) {
        resolve(tunnel);
      }
    };

    const timer = setTimeout(() => {
      finish(
        new TunnelError(
          `cloudflared did not print a public URL within ${Math.round(timeoutMs / 1000)}s`,
          'TUNNEL_TIMEOUT',
          output
        )
      );
    }, timeoutMs);
    timer.unref?.();

    process = spawner.spawn(
      'cloudflared',
      ['tunnel', '--url', `http://localhost:${options.port}`, '--no-autoupdate'],
      {
        onLine(line) {
          output.push(line);
          const url = extractTunnelUrl(line);
          if (url) {
            finish(undefined, {
              url,
              stop: () => process?.stop(),
            });
          }
        },
        onError(error) {
          if (error.code === 'ENOENT') {
            finish(new TunnelError('cloudflared is not installed', 'MISSING_CLOUDFLARED', output));
          } else {
            finish(new TunnelError(error.message, 'SPAWN_FAILED', output));
          }
        },
        onExit(code) {
          finish(
            new TunnelError(
              `cloudflared exited before printing a URL (exit code ${code ?? 'unknown'})`,
              'TUNNEL_EXITED',
              output
            )
          );
        },
      }
    );
  });
}

export interface ProxyHandle {
  port: number;
  close(): Promise<void>;
}

/**
 * Transparent HTTP proxy to the local app. The body is piped through; only the
 * provider, route, method, status and duration are logged.
 */
export function startProxy(options: {
  targetPort: number;
  port?: number;
  host?: string;
  basePath?: string;
  onCallback?: (entry: CallbackLogEntry) => void;
  now?: () => number;
}): Promise<ProxyHandle> {
  const now = options.now ?? (() => Date.now());
  const basePath = options.basePath ?? '/api/pay';
  const server: Server = createServer((request, response) => {
    const started = now();
    const target = describeCallback(request.url, basePath);
    const log = (status: number): void => {
      options.onCallback?.({
        provider: target.provider,
        route: target.route,
        method: request.method ?? 'GET',
        status,
        durationMs: now() - started,
        hadQuery: target.hadQuery,
      });
    };

    const upstream = httpRequest(
      {
        host: options.host ?? '127.0.0.1',
        port: options.targetPort,
        path: request.url,
        method: request.method,
        headers: {
          ...request.headers,
          host: `${options.host ?? '127.0.0.1'}:${options.targetPort}`,
        },
      },
      (upstreamResponse) => {
        log(upstreamResponse.statusCode ?? 502);
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      }
    );

    upstream.on('error', () => {
      log(502);
      if (!response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      response.end('Bad gateway: the local server is not reachable');
    });

    request.pipe(upstream);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

/** The log line format, re-exported for the command */
export function callbackLine(entry: CallbackLogEntry): string {
  return formatCallback({
    ...entry,
    provider: entry.provider,
    route: entry.route,
  });
}
