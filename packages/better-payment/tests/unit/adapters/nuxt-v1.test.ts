import { describe, expect, it, vi } from 'vitest';

vi.mock('h3', () => ({
  toWebRequest: (event: { legacyRequest: Request }) => event.legacyRequest,
}));

import { toH3Handler, type H3EventLike, type HandlerSource } from 'better-payment/nuxt';

describe('Nuxt/Nitro h3 v1 Node compatibility', () => {
  it('uses h3 to convert a legacy event without a web request', async () => {
    const handle = vi.fn(async (request: { url: string }) => ({
      status: 200,
      headers: {},
      body: { url: request.url },
    }));
    const handler = toH3Handler({ handle } as unknown as HandlerSource);
    const legacyRequest = new Request('https://shop.test/api/pay/health');

    const response = await handler({ legacyRequest } as unknown as H3EventLike);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ url: legacyRequest.url }));
    expect(await response.json()).toEqual({ url: legacyRequest.url });
  });
});
