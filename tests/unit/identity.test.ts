import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { IdentityScope } from '../../src/lib/auth/identity.js';
import { ownedJson } from '../../src/lib/api.js';
afterEach(() => vi.unstubAllGlobals());
describe('account identity epoch and cleanup', () => {
  it('does not start an old render request after the account has changed', async () => {
    const scope = new IdentityScope(() => {}); scope.transition('A'); const epoch = scope.epoch;
    scope.transition('B'); const transport = vi.fn().mockResolvedValue(Response.json({ synthetic:'A' })); vi.stubGlobal('fetch',transport);
    await expect(ownedJson('/api/settings','synthetic-A-token',scope,epoch)).rejects.toMatchObject({ name:'AbortError' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('aborts pending reads/stream consumers and clears queries and mutations on owner change', () => {
    const cache = new QueryClient(); const scope = new IdentityScope(() => { void cache.cancelQueries(); cache.clear(); });
    scope.transition('A'); cache.setQueryData(['history','A'],{ synthetic:'A' });
    cache.getMutationCache().build(cache,{ mutationFn:async () => 'A' });
    const stream = scope.capture(); const query = scope.capture(); const epoch = scope.epoch;
    scope.transition('A'); expect(scope.epoch).toBe(epoch); expect(stream.current()).toBe(true);
    scope.transition('B'); expect(stream.signal.aborted).toBe(true); expect(query.current()).toBe(false);
    expect(cache.getQueryCache().getAll()).toHaveLength(0); expect(cache.getMutationCache().getAll()).toHaveLength(0);
    scope.transition(null); expect(scope.userId).toBeNull();
  });
  it('prevents a completed mutation callback from rebuilding a cleared foreign cache', () => {
    const cache = new QueryClient(); const scope = new IdentityScope(() => cache.clear());
    scope.transition('A'); const epoch = scope.epoch;
    expect(scope.commit(epoch,() => cache.setQueryData(['settings','A'],'Synthetic A'))).toBe(true);
    scope.transition('B');
    expect(scope.commit(epoch,() => cache.setQueryData(['settings','A'],'Late synthetic A'))).toBe(false);
    expect(cache.getQueryCache().getAll()).toHaveLength(0);
  });
  it.each(['GET','PATCH'])('discards a late %s response even if transport ignores abort', async (method) => {
    const scope = new IdentityScope(() => {}); scope.transition('A');
    let release!: (value: Response) => void;
    vi.stubGlobal('fetch',vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const pending = ownedJson('/api/settings','synthetic-token',scope,scope.epoch,{ method });
    const rejection = expect(pending).rejects.toMatchObject({ name:'AbortError' });
    scope.transition('B'); release(Response.json({ synthetic:'A' })); await rejection;
  });
});
