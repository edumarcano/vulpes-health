import {
  CLAIM_LIFETIME,
  HANDOFF_LIFETIME,
  HANDOFF_PROTOCOL,
  RECOVERY_LIFETIME,
} from '../../shared/import-handoff';

export const HANDOFF_DATABASE = 'vulpes-import-handoff';
export type ImportIdentity = { owner: string | null; generation: number };
export type ImportRecovery = {
  protocol: number;
  owner: string;
  generation: number;
  previewId: string;
  commitId: string;
  expiresAt: number;
  sourceId: string | null;
  settingsVersion: number | null;
  requestHash?: string;
  batchId?: string;
  hash?: string;
  phase: 'previewing' | 'review' | 'committing';
};
type PendingFile = {
  protocol: number;
  ref: string;
  body: Blob;
  name: string;
  receivedAt: number;
  expiresAt: number;
  owner: string | null;
  consumer: string | null;
  leaseUntil: number;
  generation: number;
  previewId: string;
};
type State = {
  file?: PendingFile;
  operation?: ImportRecovery;
  identity?: ImportIdentity;
};
const stores = ['files', 'operations', 'identity'] as const;
export class ImportStorageError extends Error {}

function recoveryLocator(
  value: unknown,
  now: number,
): ImportRecovery | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<ImportRecovery>;
  const uuid = (text: unknown): text is string =>
    typeof text === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      text,
    );
  const hash = (text: unknown): text is string =>
    typeof text === 'string' && /^[0-9a-f]{64}$/.test(text);
  if (
    !uuid(v.owner) ||
    !uuid(v.previewId) ||
    !uuid(v.commitId) ||
    !Number.isSafeInteger(v.generation) ||
    v.generation! < 0 ||
    !Number.isFinite(v.expiresAt) ||
    v.expiresAt! <= now ||
    v.expiresAt! > now + RECOVERY_LIFETIME
  )
    return;
  return {
    protocol: HANDOFF_PROTOCOL,
    owner: v.owner,
    previewId: v.previewId,
    commitId: v.commitId,
    generation: v.generation!,
    expiresAt: v.expiresAt!,
    sourceId: uuid(v.sourceId) ? v.sourceId : null,
    settingsVersion: Number.isSafeInteger(v.settingsVersion)
      ? v.settingsVersion!
      : null,
    phase:
      v.protocol === HANDOFF_PROTOCOL &&
      (v.phase === 'review' || v.phase === 'committing')
        ? v.phase
        : 'previewing',
    ...(uuid(v.batchId) ? { batchId: v.batchId } : {}),
    ...(hash(v.hash) ? { hash: v.hash } : {}),
    ...(hash(v.requestHash) ? { requestHash: v.requestHash } : {}),
  };
}

async function transaction<T>(
  change: (state: State) => T,
  now = Date.now(),
): Promise<T> {
  if (typeof indexedDB === 'undefined')
    throw new ImportStorageError(
      'Temporary import storage is unavailable. Use the file picker.',
    );
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open(HANDOFF_DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const store of stores) request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      if (abandoned) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () =>
      reject(
        new ImportStorageError(
          'Temporary import storage is unavailable. Use the file picker.',
        ),
      );
    request.onblocked = () => {
      abandoned = true;
      reject(
        new ImportStorageError('Close other Vulpes windows and try again.'),
      );
    };
  });
  db.onversionchange = () => db.close();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([...stores], 'readwrite');
      const state: State = {};
      const keys = ['file', 'operation', 'identity'] as const;
      let remaining = stores.length,
        result: T,
        failure: unknown;
      stores.forEach((store, index) => {
        const read = tx.objectStore(store).get('active');
        read.onsuccess = () => {
          Object.assign(state, { [keys[index]!]: read.result });
          if (--remaining) return;
          if (
            state.file &&
            (state.file.protocol !== HANDOFF_PROTOCOL ||
              state.file.expiresAt <= now)
          )
            delete state.file;
          const locator = recoveryLocator(state.operation, now);
          if (locator) state.operation = locator;
          else delete state.operation;
          const original = structuredClone(state);
          try {
            result = change(state);
          } catch (error) {
            failure = error;
            for (const key of keys) delete state[key];
            Object.assign(state, original);
          }
          stores.forEach((name, i) => {
            const value = state[keys[i]!];
            if (value) tx.objectStore(name).put(value, 'active');
            else tx.objectStore(name).delete('active');
          });
        };
      });
      tx.oncomplete = () => (failure ? reject(failure) : resolve(result));
      tx.onabort = tx.onerror = () =>
        reject(
          failure ??
            new ImportStorageError(
              'Temporary import storage could not be saved. Use the file picker.',
            ),
        );
    });
  } finally {
    db.close();
  }
}

export async function receiveShare(file: File, now = Date.now()) {
  return transaction((state) => {
    if (state.file || state.operation)
      throw new Error(
        'Finish or discard the pending import in Vulpes, then share again.',
      );
    const ref = crypto.randomUUID();
    state.file = {
      protocol: HANDOFF_PROTOCOL,
      ref,
      body: file,
      name: file.name,
      receivedAt: now,
      expiresAt: now + HANDOFF_LIFETIME,
      owner: null,
      consumer: null,
      leaseUntil: 0,
      generation: state.identity?.generation ?? 0,
      previewId: crypto.randomUUID(),
    };
    return ref;
  }, now);
}

export async function syncImportIdentity(
  owner: string | null,
  clear = false,
  expected?: ImportIdentity,
) {
  return transaction((state) => {
    const previous = state.identity ?? { owner: null, generation: 0 };
    if (
      expected &&
      (previous.owner !== expected.owner ||
        previous.generation !== expected.generation)
    )
      return previous;
    if (clear || (previous.owner !== null && previous.owner !== owner)) {
      if (clear || state.file?.owner) delete state.file;
      delete state.operation;
    }
    state.identity = {
      owner,
      generation:
        previous.generation + Number(clear || previous.owner !== owner),
    };
    return state.identity;
  });
}

export async function pendingImport(owner: string, now = Date.now()) {
  return transaction(
    (state) => ({
      reference:
        state.file && (!state.file.owner || state.file.owner === owner)
          ? state.file.ref
          : null,
      operation: state.operation?.owner === owner ? state.operation : null,
      generation:
        state.identity?.owner === owner ? state.identity.generation : null,
    }),
    now,
  );
}

export async function claimShare(
  ref: string,
  owner: string,
  consumer: string,
  now = Date.now(),
) {
  return transaction((state) => {
    const file = state.file;
    if (!file || file.ref !== ref)
      throw new Error(
        'This shared file expired or was cleared. Share it again or choose a file.',
      );
    if (state.identity?.owner !== owner || (file.owner && file.owner !== owner))
      throw new Error('The account changed. Share the file again.');
    if (file.consumer && file.consumer !== consumer && file.leaseUntil > now)
      throw new Error(
        'This import is open in another Vulpes window. Try again after closing it.',
      );
    file.owner = owner;
    file.consumer = consumer;
    file.leaseUntil = now + CLAIM_LIFETIME;
    file.generation = state.identity.generation;
    return {
      body: file.body,
      name: file.name,
      previewId: file.previewId,
      generation: file.generation,
    };
  }, now);
}

export async function checkShareClaim(
  ref: string,
  owner: string,
  consumer: string,
  generation: number,
  now = Date.now(),
) {
  return transaction((state) => {
    const file = state.file;
    if (
      !file ||
      file.ref !== ref ||
      file.owner !== owner ||
      file.consumer !== consumer ||
      file.generation !== generation ||
      state.identity?.owner !== owner ||
      state.identity.generation !== generation
    )
      throw new Error(
        'The shared file expired or the account changed. Share it again.',
      );
    file.leaseUntil = now + CLAIM_LIFETIME;
  }, now);
}

export async function saveImportRecovery(
  operation: ImportRecovery,
  now = Date.now(),
) {
  return transaction((state) => {
    if (
      state.identity?.owner !== operation.owner ||
      state.identity.generation !== operation.generation
    )
      throw new Error('The account changed.');
    if (
      (state.file && state.file.previewId !== operation.previewId) ||
      (state.operation &&
        (state.operation.owner !== operation.owner ||
          state.operation.previewId !== operation.previewId))
    )
      throw new Error('Finish or discard the pending import first.');
    state.operation = {
      ...operation,
      protocol: HANDOFF_PROTOCOL,
      expiresAt: Math.min(
        operation.expiresAt,
        state.operation?.expiresAt ?? now + RECOVERY_LIFETIME,
      ),
    };
  }, now);
}

export async function consumeShare(ref: string, owner: string) {
  return transaction((state) => {
    if (state.file?.ref === ref && state.file.owner === owner)
      delete state.file;
  });
}

export async function clearImport(owner: string, ref?: string) {
  return transaction((state) => {
    if (state.identity?.owner !== owner) return;
    if (
      state.file &&
      (!state.file.owner || state.file.owner === owner) &&
      (!ref || state.file.ref === ref)
    )
      delete state.file;
    if (!ref && state.operation?.owner === owner) delete state.operation;
  });
}

export async function completeImport(owner: string, previewId: string) {
  return transaction((state) => {
    if (
      state.operation?.owner !== owner ||
      state.operation.previewId !== previewId
    )
      return;
    delete state.operation;
    if (state.file?.previewId === previewId && state.file.owner === owner)
      delete state.file;
  });
}

export async function sweepImports() {
  await transaction(() => undefined);
}
