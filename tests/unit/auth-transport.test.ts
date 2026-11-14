import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverClientOptions } from '../../server/auth/session.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('server database transport deadlines', () => {
  it.each(['inspect', 'register', 'review', 'commit'])(
    'allows bounded transport time for %s import requests',
    async (action) => {
      const deadline = vi.spyOn(AbortSignal, 'timeout');
      const transport = vi.fn().mockResolvedValue(Response.json({}));
      vi.stubGlobal('fetch', transport);
      await serverClientOptions.global.fetch(
        `http://127.0.0.1:54321/rest/v1/rpc/${action}_import_v2`,
        { method: 'POST', body: '{}' },
      );
      expect(deadline).toHaveBeenCalledWith(45_000);
      expect(transport.mock.calls[0]![1].redirect).toBe('error');
    },
  );

  it.each([
    '/auth/v1/user',
    '/rest/v1/profiles',
    '/rest/v1/rpc/read_import_status_v2',
    '/rest/v1/rpc/commit_import_v2_extra',
    '/rest/v1/rpc/commit_import_v1',
  ])('retains the default deadline for %s', async (path) => {
    const deadline = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
    await serverClientOptions.global.fetch(
      new URL('http://127.0.0.1:54321' + path),
    );
    expect(deadline).toHaveBeenCalledWith(10_000);
  });

  it('preserves caller cancellation during an import request', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input, init) => {
        signal = init.signal;
        return Promise.resolve(Response.json({}));
      }),
    );
    const caller = new AbortController();
    await serverClientOptions.global.fetch(
      new Request('http://127.0.0.1:54321/rest/v1/rpc/commit_import_v2'),
      { signal: caller.signal },
    );
    expect(signal?.aborted).toBe(false);
    caller.abort();
    expect(signal?.aborted).toBe(true);
  });
});
