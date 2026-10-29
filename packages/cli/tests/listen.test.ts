import { describe, expect, it } from 'vitest';
import { runListen } from '../src/commands/listen';
import type { TunnelHandlers, TunnelSpawner } from '../src/tunnel';
import { fakeIo } from './helpers';

function spawnerThat(run: (handlers: TunnelHandlers) => void): TunnelSpawner {
  return {
    spawn(_command, _args, handlers) {
      run(handlers);
      return { stop: () => undefined };
    },
  };
}

const urlSpawner = spawnerThat((handlers) => {
  handlers.onLine('2026-01-01 INFO |  https://listen-test.trycloudflare.com |');
});

describe('runListen argument validation', () => {
  it('rejects a bad port', async () => {
    const io = fakeIo({});
    expect((await runListen(io, ['--port', '70000'])).code).toBe(2);
    expect((await runListen(io, ['--port', 'abc'])).code).toBe(2);
  });

  it('rejects a bad proxy port', async () => {
    const io = fakeIo({});
    expect((await runListen(io, ['--proxy-port', '-1'])).code).toBe(2);
  });

  it('rejects a non-https --url', async () => {
    const io = fakeIo({});
    expect((await runListen(io, ['--url', 'http://insecure.example.com'])).code).toBe(2);
    expect(io.err.join('\n')).toContain('https://');
  });
});

describe('runListen with an existing tunnel', () => {
  it('prints the callback urls and stops on an aborted signal', async () => {
    const io = fakeIo({});
    const result = await runListen(io, ['--url', 'https://my-tunnel.example.com/'], {
      signal: AbortSignal.abort(),
    });
    expect(result.code).toBe(0);
    const out = io.out.join('\n');
    expect(out).toContain('existing, cloudflared not started');
    expect(out).toContain('https://my-tunnel.example.com/api/pay/health');
    expect(out).toContain('/api/pay/<provider>/payment/complete-3ds');
    expect(out).toContain('/api/pay/paytr/callback');
    expect(out).toContain('never logged');
  });
});

describe('runListen with the fake cloudflared spawner', () => {
  it('starts cloudflared against the proxy port and reports the url', async () => {
    const io = fakeIo({});
    const controller = new AbortController();
    let readyInfo: { url: string; proxyPort: number } | undefined;
    const result = await runListen(io, ['--port', '3999'], {
      spawner: urlSpawner,
      signal: controller.signal,
      onReady: (info) => {
        readyInfo = info;
        controller.abort();
      },
    });
    expect(result.code).toBe(0);
    expect(readyInfo?.url).toBe('https://listen-test.trycloudflare.com');
    expect(readyInfo?.proxyPort).toBeGreaterThan(0);
    expect(io.out.join('\n')).toContain('https://listen-test.trycloudflare.com');
    expect(io.out.at(-1)).toBe('stopped');
  });

  it('prints the install hint when cloudflared is missing', async () => {
    const io = fakeIo({});
    const result = await runListen(io, [], {
      spawner: spawnerThat((handlers) =>
        handlers.onError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
      ),
      signal: AbortSignal.abort(),
    });
    expect(result.code).toBe(1);
    expect(io.err.join('\n')).toContain('Install cloudflared');
    expect(io.err.join('\n')).toContain('winget install --id Cloudflare.cloudflared');
  });

  it('shows the tunnel output for other failures', async () => {
    const io = fakeIo({});
    const result = await runListen(io, [], {
      spawner: spawnerThat((handlers) => handlers.onExit(3)),
      signal: AbortSignal.abort(),
    });
    expect(result.code).toBe(1);
    const err = io.err.join('\n');
    expect(err).toContain('exited before printing a URL');
    expect(err).toContain('--url https://your-existing-tunnel');
  });
});
