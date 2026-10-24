/**
 * `better-payment listen --port 3000`
 *
 * Opens a Cloudflare quick tunnel to a local proxy in front of the app and prints
 * the URL to use as `callbackUrl` (and as the PayTR notification URL).
 *
 * The proxy logs each callback as provider + route + status only. Bodies,
 * headers, cookies, query strings and signatures are never logged.
 */
import { intOption, parseArgs, stringOption, type OptionSpec } from '../args';
import { formatCallback } from '../callback-log';
import { CLOUDFLARED_INSTALL, startCloudflared, startProxy, TunnelError } from '../tunnel';
import type { TunnelSpawner } from '../tunnel';
import type { CliIo, CommandResult } from '../types';

export const LISTEN_OPTIONS: Record<string, OptionSpec> = {
  port: {
    type: 'string',
    alias: 'p',
    description: 'Local port your app listens on',
    placeholder: '3000',
    default: '3000',
  },
  url: {
    type: 'string',
    description: 'Use an existing public HTTPS tunnel instead of spawning cloudflared',
    placeholder: 'https://your-tunnel.example.com',
  },
  'proxy-port': {
    type: 'string',
    description: 'Local port for the logging proxy',
    placeholder: '0',
    default: '0',
  },
  'base-path': {
    type: 'string',
    description: 'Handler base path',
    default: '/api/pay',
  },
};

export interface ListenDeps {
  spawner?: TunnelSpawner;
  /** Tests abort this instead of pressing Ctrl+C */
  signal?: AbortSignal;
  /** Called once the tunnel URL is known (tests) */
  onReady?: (info: { url: string; proxyPort: number }) => void;
}

function stopSignal(signal?: AbortSignal): Promise<void> {
  if (signal) {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true })
    );
  }
  return new Promise((resolve) => {
    const done = (): void => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

function validPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export async function runListen(
  io: CliIo,
  argv: string[],
  deps: ListenDeps = {}
): Promise<CommandResult> {
  const args = parseArgs(argv, LISTEN_OPTIONS);
  if (args.errors.length > 0) {
    for (const error of args.errors) io.stderr(`error: ${error}`);
    return { code: 2 };
  }

  const port = intOption(args, 'port');
  if (port === undefined || port < 1 || port > 65535) {
    io.stderr('error: --port must be an integer between 1 and 65535');
    return { code: 2 };
  }
  const proxyPort = intOption(args, 'proxy-port') ?? 0;
  if (proxyPort < 0 || proxyPort > 65535) {
    io.stderr('error: --proxy-port must be an integer between 0 and 65535');
    return { code: 2 };
  }
  const basePath = (stringOption(args, 'base-path', '/api/pay') ?? '/api/pay').replace(/\/+$/, '');
  const existingUrl = stringOption(args, 'url');
  if (existingUrl && !validPublicUrl(existingUrl)) {
    io.stderr('error: --url must be an https:// URL of an existing tunnel');
    return { code: 2 };
  }

  const proxy = await startProxy({
    targetPort: port,
    port: proxyPort,
    basePath,
    now: io.now,
    onCallback: (entry) => io.stdout(formatCallback(entry)),
  });

  let tunnelUrl: string;
  let stopTunnel = (): void => undefined;
  if (existingUrl) {
    tunnelUrl = existingUrl.replace(/\/+$/, '');
    io.stdout(`tunnel   ${tunnelUrl} (existing, cloudflared not started)`);
  } else {
    try {
      const tunnel = await startCloudflared({ port: proxy.port, spawner: deps.spawner });
      tunnelUrl = tunnel.url;
      stopTunnel = tunnel.stop;
    } catch (error) {
      await proxy.close();
      if (error instanceof TunnelError && error.code === 'MISSING_CLOUDFLARED') {
        io.stderr(CLOUDFLARED_INSTALL);
        return { code: 1 };
      }
      io.stderr(
        `error: ${error instanceof Error ? error.message : String(error)}. ` +
          'Pass --url https://your-existing-tunnel to skip cloudflared.'
      );
      if (error instanceof TunnelError && error.output.length > 0) {
        io.stderr('cloudflared said:');
        for (const line of error.output.slice(-10)) io.stderr(`  ${line}`);
      }
      return { code: 1 };
    }
  }

  io.stdout(`local    http://localhost:${port} (proxy 127.0.0.1:${proxy.port})`);
  io.stdout(`health   ${tunnelUrl}${basePath}/health`);
  io.stdout('');
  io.stdout(`callbackUrl (3D Secure): ${tunnelUrl}${basePath}/<provider>/payment/complete-3ds`);
  io.stdout(`PayTR notification URL:  ${tunnelUrl}${basePath}/paytr/callback`);
  io.stdout('');
  io.stdout('Callbacks are logged as provider, route, status and duration only.');
  io.stdout('Bodies, headers, card data, signatures and query strings are never logged.');
  io.stdout('Press Ctrl+C to stop.');

  deps.onReady?.({ url: tunnelUrl, proxyPort: proxy.port });

  await stopSignal(deps.signal);
  stopTunnel();
  await proxy.close();
  io.stdout('stopped');
  return { code: 0 };
}
