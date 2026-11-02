import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { closeoutFixture } from '../../scripts/closeout-fixture.js';
import { verifyHostedCloseout } from '../../scripts/verify-hosted-closeout.js';
import { verifyCloseoutBrowser } from '../../scripts/verify-closeout-browser.js';
it('refuses hosted checks without explicit approval before any network request', async () => {
  const key = randomBytes(32),
    fixture = closeoutFixture(randomUUID(), 0, {
      activeId: 'synthetic',
      keys: new Map([['synthetic', key]]),
    }),
    send = vi.fn();
  await expect(
    verifyHostedCloseout(
      {
        target: {
          version: 1,
          purpose: 'synthetic-only',
          supabaseProjectRef: 'abcdefghijklmnopqrst',
          recoveryProjectRef: null,
          databaseRegion: 'us-east-1',
          vercelProjectId: 'prj_SyntheticCloseout',
          appOrigin: 'https://vulpes-synthetic.vercel.app',
        },
        publishableKey: 'synthetic',
        actors: [
          { fixture, token: 'synthetic' },
          { fixture, token: 'synthetic' },
        ],
        approved: false,
      },
      send,
    ),
  ).rejects.toThrow('approval_required');
  expect(send).not.toHaveBeenCalled();
  key.fill(0);
});
it('refuses unapproved browser checks before opening a browser or accessing a remote origin', async () => {
  await expect(
    verifyCloseoutBrowser({
      appOrigin: 'https://vulpes-synthetic.vercel.app',
      sourceOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
      users: [] as never,
      approved: false,
    }),
  ).rejects.toThrow('approval_required');
});
