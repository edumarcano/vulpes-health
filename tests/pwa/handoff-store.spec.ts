import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    importStore: typeof import('../../src/lib/import-handoff');
  }
}
const compile = (path: string) =>
  ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const sources = {
  limits: compile('shared/import-limits.ts'),
  protocol: compile('shared/import-handoff.ts'),
  store: compile('src/lib/import-handoff.ts'),
};
test.use({ bypassCSP: true });
test.beforeEach(async ({ page }) => {
  await page.goto('/offline.html');
  await page.evaluate(async (sources) => {
    const moduleURL = (source: string) =>
      URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const limits = moduleURL(sources.limits);
    const protocol = moduleURL(
      sources.protocol.replace('./import-limits.js', limits),
    );
    const store = moduleURL(
      sources.store.replace('../../shared/import-handoff', protocol),
    );
    window.importStore = await import(/* @vite-ignore */ store);
    for (const url of [limits, protocol, store]) URL.revokeObjectURL(url);
  }, sources);
});

test('real IndexedDB serializes receive/claim/takeover and fences the previous consumer', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.importStore,
      now = Date.now(),
      owner = crypto.randomUUID();
    await h.syncImportIdentity(owner);
    const receives = await Promise.allSettled([
      h.receiveShare(new File(['synthetic'], 'x.csv'), now),
      h.receiveShare(new File(['other'], 'y.csv'), now),
    ]);
    const ref = (await h.pendingImport(owner, now)).reference!;
    const claims = await Promise.allSettled([
      h.claimShare(ref, owner, 'one', now),
      h.claimShare(ref, owner, 'two', now),
    ]);
    const winning = claims[0]!.status === 'fulfilled' ? 'one' : 'two';
    const previous = await h.claimShare(ref, owner, winning, now);
    await h.claimShare(ref, owner, 'takeover', now + 30_000);
    const old = await h
      .checkShareClaim(ref, owner, winning, previous.generation, now + 30_001)
      .then(
        () => 'allowed',
        () => 'denied',
      );
    return {
      receives: receives.map((v) => v.status),
      claims: claims.map((v) => v.status),
      old,
    };
  });
  expect(result.receives.sort()).toEqual(['fulfilled', 'rejected']);
  expect(result.claims.sort()).toEqual(['fulfilled', 'rejected']);
  expect(result.old).toBe('denied');
});

test('raw expiry is immutable, denied at the boundary and physically swept on failed access', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.importStore,
      owner = crypto.randomUUID(),
      now = Date.now();
    await h.syncImportIdentity(owner);
    const ref = await h.receiveShare(new File(['synthetic'], 'x.csv'), now);
    const file = await h.claimShare(ref, owner, 'tab', now + 899_999);
    const denied = await h.claimShare(ref, owner, 'tab', now + 900_000).then(
      () => false,
      () => true,
    );
    const request = indexedDB.open('vulpes-import-handoff', 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const count = await new Promise<number>((resolve) => {
      const read = database.transaction('files').objectStore('files').count();
      read.onsuccess = () => resolve(read.result);
    });
    database.close();
    return { text: await file.body.text(), denied, count };
  });
  expect(result).toEqual({ text: 'synthetic', denied: true, count: 0 });
});

test('a new unbound share survives initial signed-out restoration but explicit logout clears it', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.importStore,
      owner = crypto.randomUUID();
    await h.syncImportIdentity(owner);
    const ref = await h.receiveShare(new File(['synthetic'], 'x.csv'));
    await h.syncImportIdentity(null);
    await h.syncImportIdentity(owner);
    const pending = await h.pendingImport(owner);
    await h.syncImportIdentity(null, true);
    return {
      preserved: pending.reference === ref,
      cleared: (await h.pendingImport(owner)).reference === null,
    };
  });
  expect(result).toEqual({ preserved: true, cleared: true });
});

test('raw consumption leaves only bounded recovery metadata and old generations cannot resurrect it', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.importStore,
      owner = crypto.randomUUID(),
      now = Date.now();
    const identity = await h.syncImportIdentity(owner);
    const ref = await h.receiveShare(
      new File(['private-synthetic-canary'], 'private-synthetic.csv'),
      now,
    );
    const claimed = await h.claimShare(ref, owner, 'tab', now);
    const operation = {
      protocol: 1,
      owner,
      generation: identity.generation,
      previewId: claimed.previewId,
      commitId: crypto.randomUUID(),
      expiresAt: now + 86_400_000,
      sourceId: null,
      settingsVersion: null,
      phase: 'review' as const,
    };
    await h.saveImportRecovery(operation, now);
    await h.consumeShare(ref, owner);
    const metadata = await h.pendingImport(owner, now);
    const second = await h
      .receiveShare(new File(['other'], 'other.csv'), now)
      .then(
        () => 'allowed',
        () => 'denied',
      );
    await h.syncImportIdentity(null, true);
    await h.syncImportIdentity(owner);
    const stale = await h.saveImportRecovery(operation).then(
      () => 'allowed',
      () => 'denied',
    );
    return {
      file: metadata.reference,
      operation: JSON.stringify(metadata.operation),
      second,
      stale,
      final: await h.pendingImport(owner),
    };
  });
  expect(result.file).toBeNull();
  expect(result.operation).not.toContain('private-synthetic');
  expect(result.second).toBe('denied');
  expect(result.stale).toBe('denied');
  expect(result.final.operation).toBeNull();
});

test('an incompatible file is cleared while an uncertain operation retains only its common status locator', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.importStore,
      owner = crypto.randomUUID(),
      now = Date.now();
    const identity = await h.syncImportIdentity(owner);
    const ref = await h.receiveShare(new File(['synthetic'], 'x.csv'));
    const file = await h.claimShare(ref, owner, 'tab');
    await h.saveImportRecovery({
      protocol: 1,
      owner,
      generation: identity.generation,
      previewId: file.previewId,
      commitId: crypto.randomUUID(),
      sourceId: null,
      settingsVersion: null,
      phase: 'committing',
      expiresAt: now + 600_000,
    });
    const request = indexedDB.open('vulpes-import-handoff', 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = database.transaction(['files', 'operations'], 'readwrite');
      for (const name of ['files', 'operations']) {
        const store = tx.objectStore(name);
        const read = store.get('active');
        read.onsuccess = () =>
          store.put(
            {
              ...read.result,
              protocol: 99,
              csv: 'synthetic-unexpected-private-field',
            },
            'active',
          );
      }
      tx.oncomplete = () => resolve();
    });
    database.close();
    const pending = await h.pendingImport(owner);
    return {
      reference: pending.reference,
      previewId: pending.operation?.previewId,
      expected: file.previewId,
      serialized: JSON.stringify(pending.operation),
    };
  });
  expect(result.reference).toBeNull();
  expect(result.previewId).toBe(result.expected);
  expect(result.serialized).not.toContain('synthetic-unexpected-private-field');
});

test('a failed storage write rolls back receipt and leaves the slot usable', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.importStore;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'files')
        throw new DOMException('Synthetic quota limit', 'QuotaExceededError');
      return put.apply(this, args);
    };
    let rejected: boolean;
    try {
      rejected = await h.receiveShare(new File(['synthetic'], 'x.csv')).then(
        () => false,
        () => true,
      );
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const owner = crypto.randomUUID();
    await h.syncImportIdentity(owner);
    const afterFailure = await h.pendingImport(owner);
    const ref = await h.receiveShare(new File(['second'], 'y.csv'));
    return {
      rejected,
      empty: afterFailure.reference === null,
      received: (await h.pendingImport(owner)).reference === ref,
    };
  });
  expect(result).toEqual({ rejected: true, empty: true, received: true });
});

test('a picker preview cannot occupy the single operation slot reserved by a received share', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.importStore;
    const owner = crypto.randomUUID();
    const identity = await h.syncImportIdentity(owner);
    const ref = await h.receiveShare(new File(['synthetic'], 'x.csv'));
    const rejected = await h
      .saveImportRecovery({
        protocol: 1,
        owner,
        generation: identity.generation,
        previewId: crypto.randomUUID(),
        commitId: crypto.randomUUID(),
        sourceId: null,
        settingsVersion: null,
        phase: 'previewing',
        expiresAt: Date.now() + 600_000,
      })
      .then(
        () => false,
        () => true,
      );
    const pending = await h.pendingImport(owner);
    return {
      rejected,
      preserved: pending.reference === ref,
      operation: pending.operation,
    };
  });
  expect(result).toEqual({ rejected: true, preserved: true, operation: null });
});
