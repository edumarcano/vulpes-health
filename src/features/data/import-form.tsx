import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  completeImport,
  consumeShare,
  pendingImport,
  saveImportRecovery,
  checkShareClaim,
  ImportStorageError,
  type ImportRecovery,
} from '@/lib/import-handoff';
import {
  HANDOFF_PROTOCOL,
  RECOVERY_LIFETIME,
} from '../../../shared/import-handoff';
import { savedMapping } from './import-settings';
import { Button } from '@/components/ui/button';
import { ApiError, ownedJson } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { successEnvelopeSchema } from '../../../shared/api';
import { measurementRegistry, type Source } from '../../../shared/data';
import {
  CSV_LIMIT_BYTES,
  isRenphoHeader,
  ImportResultSchema,
  type ImportResult,
  type ImportSelection,
  ImportPreviewV2Schema,
  ImportStatusSchema,
  ImportItemsSchema,
  PreviewCsvWireSchema,
  type ImportPreviewV2 as ImportPreview,
  type ImportReview,
  type ImportMapping,
  type PreviewCsvWire,
} from '../../../shared/imports';
import { z } from 'zod';
import { SourceImportDefaults } from './source-import-defaults';
import type {
  MetricKey,
  Granularity,
  MeasurementMethod,
} from '../../../shared/domain';

type Stage =
  | { kind: 'restoring' }
  | { kind: 'clearing_recovery' }
  | { kind: 'editing' }
  | { kind: 'previewing' }
  | { kind: 'uncertain_preview'; requestId: string }
  | { kind: 'review'; preview: ImportPreview; requestId: string }
  | {
      kind: 'reviewing' | 'discarding' | 'uncertain';
      preview: ImportPreview;
      requestId: string;
    }
  | { kind: 'stale'; preview: ImportPreview; requestId: string }
  | { kind: 'committing'; preview: ImportPreview; requestId: string }
  | {
      kind: 'done';
      result: ImportResult;
      selections: ImportSelection[];
      historical?: boolean;
    };
type ColumnMapping = {
  metric: MetricKey;
  unit: string;
  method: MeasurementMethod;
};
export function ImportForm({
  sources,
  timezone,
  dataRevision,
  onSaved,
  onView,
  sharedFile,
  onSharedConsumed,
}: {
  sources: Source[];
  timezone: string;
  dataRevision: number;
  onSaved: (result: ImportResult) => void;
  onView: (sourceId: string, selection: ImportSelection) => void;
  sharedFile?: {
    file: File;
    ref: string;
    consumer: string;
    generation: number;
    previewId: string;
  } | null;
  onSharedConsumed?: () => void;
}) {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const userId = session?.user.id ?? null;
  const epoch = scope.epoch;
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState<'canonical' | 'wide' | 'renpho'>(
    'canonical',
  );
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  const [source, setSource] = useState('new');
  const [label, setLabel] = useState('');
  const [app, setApp] = useState('');
  const [device, setDevice] = useState('');
  const [zone, setZone] = useState(timezone);
  const [sourceLabel, setSourceLabel] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [localDate, setLocalDate] = useState('');
  const [externalId, setExternalId] = useState('');
  const [profileColumn, setProfileColumn] = useState('');
  const [profileValue, setProfileValue] = useState('');
  const [single, setSingle] = useState(false);
  const [flag, setFlag] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>('instant');
  const [columns, setColumns] = useState<Record<string, ColumnMapping>>({});
  const [stage, setStage] = useState<Stage>({ kind: 'restoring' });
  const [usingSaved, setUsingSaved] = useState(false);
  const [settingsMode, setSettingsMode] = useState<'saved' | 'confirm'>(
    'saved',
  );
  const recovery = useRef<ImportRecovery | null>(null);
  const identityGeneration = useRef(0);
  const incoming = useRef<File | null>(null);
  const sourceChosen = useRef(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<z.infer<
    typeof ImportItemsSchema
  > | null>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(stage.kind);
  const fileSequence = useRef(0);
  const previewIdentity = useRef<{ hash: string; requestId: string } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    if (!userId) return;
    void pendingImport(userId)
      .then(({ operation, generation }) => {
        if (!active) return;
        recovery.current = operation;
        identityGeneration.current = generation ?? 0;
        setStage(
          operation
            ? { kind: 'uncertain_preview', requestId: operation.previewId }
            : { kind: 'editing' },
        );
      })
      .catch(() => {
        if (active) {
          setStage({ kind: 'editing' });
          setError(
            'Temporary recovery storage is unavailable. Reopening this import will require selecting the file again.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [userId, epoch]);
  useEffect(() => {
    if (
      stage.kind === 'editing' &&
      sharedFile &&
      incoming.current !== sharedFile.file
    ) {
      incoming.current = sharedFile.file;
      void loadFile(sharedFile.file);
    }
  });
  useEffect(() => {
    if (!sharedFile || !userId) return;
    const timer = window.setInterval(() => {
      void checkShareClaim(
        sharedFile.ref,
        userId,
        sharedFile.consumer,
        sharedFile.generation,
      ).catch(() => {
        scope.commit(epoch, () => {
          setCsv('');
          setError(
            'The shared file expired or another window took over. Share it again.',
          );
          onSharedConsumed?.();
        });
      });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [sharedFile, userId, scope, epoch, onSharedConsumed]);
  useEffect(() => {
    if (
      stage.kind === 'editing' ||
      stage.kind === 'done' ||
      stage.kind === 'restoring'
    )
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [stage.kind]);
  function applyMapping(mapping: ImportMapping) {
    setFormat(mapping.format);
    setZone(mapping.timezone);
    setSingle(mapping.single_profile);
    setProfileColumn(mapping.profile?.column ?? '');
    setProfileValue(mapping.profile?.value ?? '');
    setFlag(mapping.review_requested);
    setZoneConfirmed(mapping.format === 'renpho');
    if (mapping.format === 'canonical') setSourceLabel(mapping.source_label);
    if (mapping.format === 'wide') {
      setTimestamp(mapping.timestamp_column);
      setLocalDate(mapping.local_date_column ?? '');
      setExternalId(mapping.external_id_column ?? '');
      setGranularity(mapping.granularity);
      setColumns(
        Object.fromEntries(
          mapping.metrics.map(({ column, ...value }) => [column, value]),
        ),
      );
    }
    setUsingSaved(true);
  }
  async function remember(
    phase: ImportRecovery['phase'],
    previewId: string,
    commitId: string,
    p?: ImportPreview,
  ) {
    if (!session || scope.epoch !== epoch)
      throw new Error('The account changed.');
    const operation: ImportRecovery = {
      protocol: HANDOFF_PROTOCOL,
      owner: session.user.id,
      generation: sharedFile?.generation ?? identityGeneration.current,
      previewId,
      commitId,
      phase,
      sourceId: p?.source_id ?? (source === 'new' ? null : source),
      settingsVersion:
        sources.find((s) => s.id === source)?.settingsVersion ?? null,
      ...(recovery.current?.requestHash
        ? { requestHash: recovery.current.requestHash }
        : {}),
      expiresAt: Math.min(
        recovery.current?.expiresAt ?? Date.now() + RECOVERY_LIFETIME,
        p ? Date.parse(p.expires_at) : Infinity,
      ),
      ...(p ? { batchId: p.batch_id, hash: p.payload_hash } : {}),
    };
    try {
      await saveImportRecovery(operation);
    } catch (error) {
      if (sharedFile || !(error instanceof ImportStorageError)) throw error;
      setError(
        'Reload recovery is unavailable in this browser. Keep this page open until the import outcome is confirmed.',
      );
    }
    recovery.current = operation;
  }
  async function finished() {
    if (session && recovery.current)
      await completeImport(session.user.id, recovery.current.previewId).catch(
        (error) => {
          if (!(error instanceof ImportStorageError)) throw error;
        },
      );
    recovery.current = null;
    onSharedConsumed?.();
  }
  async function clearRecovery() {
    if (!session || !recovery.current) return;
    setStage({ kind: 'clearing_recovery' });
    try {
      await completeImport(session.user.id, recovery.current.previewId);
      scope.commit(epoch, () => {
        recovery.current = null;
        previewIdentity.current = null;
        fileSequence.current++;
        setCsv('');
        setHeaders([]);
        setFileName('');
        setSettingsMode('confirm');
        onSharedConsumed?.();
        setStage({ kind: 'editing' });
        setError(
          'Local recovery was cleared. Check Data for any server result before starting another import.',
        );
      });
    } catch {
      scope.commit(epoch, () => {
        setStage({ kind: 'editing' });
        setError(
          'Local recovery could not be cleared. Retry before starting another import.',
        );
      });
    }
  }
  useEffect(() => {
    if (stage.kind === 'review') {
      if (stage.preview.ready_to_commit) confirm.current?.focus();
      else reviewHeading.current?.focus();
    } else if (stage.kind === 'done') resultHeading.current?.focus();
    else if (stage.kind === 'editing' && previous.current === 'review')
      previewButton.current?.focus();
    previous.current = stage.kind;
  }, [stage]);
  async function loadFile(file: File | undefined) {
    if (!file) return;
    const sequence = ++fileSequence.current;
    previewIdentity.current = null;
    if (fileInput.current) fileInput.current.value = '';
    setError('');
    const owner = scope.capture();
    setCsv('');
    setHeaders([]);
    try {
      if (file.size > CSV_LIMIT_BYTES)
        throw new Error('Choose a UTF-8 CSV file of at most 1 MiB.');
      const bytes = await file.arrayBuffer();
      if (!owner.current()) return;
      const text = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
      const { parse } = await import('csv-parse/browser/esm/sync');
      const first: unknown = parse(text, {
        bom: true,
        to: 1,
        max_record_size: 65536,
      });
      if (
        !Array.isArray(first) ||
        !Array.isArray(first[0]) ||
        first[0].length > 100 ||
        first[0].some((h) => typeof h !== 'string' || h.length > 200) ||
        (!isRenphoHeader(first[0] as string[]) && first[0].some((h) => !h)) ||
        new Set(first[0]).size !== first[0].length
      )
        throw new Error('Use unique, nonblank CSV column names (maximum 100).');
      const found = first[0] as string[];
      const detected = isRenphoHeader(found)
        ? 'renpho'
        : [
              'observed_at',
              'metric',
              'value',
              'unit',
              'source',
              'granularity',
            ].every((h) => found.includes(h))
          ? 'canonical'
          : 'wide';
      const encoded = btoa(
        Array.from(new Uint8Array(bytes), (byte) =>
          String.fromCharCode(byte),
        ).join(''),
      );
      const matches = sources.filter((s) => savedMapping(s, detected, found));
      const selected =
        sources.find((s) => s.id === source) ??
        (source === 'new' && !sourceChosen.current && matches.length === 1
          ? matches[0]
          : undefined);
      const saved = savedMapping(selected, detected, found);
      if (sequence === fileSequence.current)
        scope.commit(epoch, () => {
          // Keep RENPHO file bytes for hashing without changing generic CSV identities.
          setCsv(encoded);
          setHeaders(found.filter(Boolean));
          setZoneConfirmed(false);
          setFileName(file.name);
          setFormat(detected);
          setTimestamp(found[0] ?? '');
          setColumns({});
          setProfileColumn('');
          setSingle(false);
          setUsingSaved(false);
          if (saved && selected) {
            setSource(selected.id);
            applyMapping(saved);
            if (settingsMode === 'confirm') {
              setUsingSaved(false);
              setSingle(false);
              setZoneConfirmed(false);
            }
          }
        });
      if (
        sequence === fileSequence.current &&
        owner.current() &&
        settingsMode === 'saved' &&
        saved &&
        selected
      )
        await sendPreview({
          schema_version: 2,
          action: 'preview_csv',
          client_request_id: sharedFile?.previewId ?? crypto.randomUUID(),
          csv_base64: encoded,
          source: { kind: 'existing', id: selected.id },
          mapping: saved,
        });
    } catch (e) {
      if (sequence === fileSequence.current)
        scope.commit(epoch, () =>
          setError(
            e instanceof Error ? e.message : 'The file could not be read.',
          ),
        );
    } finally {
      owner.release();
    }
  }
  async function preview(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setError('');
    const common = {
      schema_version: 1 as const,
      timezone: zone,
      profile: profileColumn
        ? { column: profileColumn, value: profileValue }
        : null,
      single_profile: single,
      review_requested: flag,
    };
    const mapping: unknown =
      format === 'canonical'
        ? { ...common, format, source_label: sourceLabel }
        : format === 'renpho'
          ? {
              ...common,
              format,
              profile: null,
              timezone_confirmed: zoneConfirmed,
            }
          : {
              ...common,
              format,
              timestamp_column: timestamp,
              local_date_column: localDate || null,
              external_id_column: externalId || null,
              granularity,
              metrics: Object.entries(columns).map(([column, v]) => ({
                column,
                ...v,
              })),
            };
    const request = PreviewCsvWireSchema.safeParse({
      schema_version: 2,
      action: 'preview_csv',
      client_request_id: crypto.randomUUID(),
      csv_base64: csv,
      source:
        source === 'new'
          ? {
              kind: 'new',
              label,
              origin_app: app.trim() || null,
              device_label: device.trim() || null,
            }
          : { kind: 'existing', id: source },
      mapping,
    });
    if (!request.success) {
      setError(
        format === 'renpho'
          ? 'Choose a source and valid IANA timezone. Confirm the timezone for RENPHO and a single-profile file.'
          : 'Choose a source, timezone, mapping and a single-profile declaration or exact profile filter.',
      );
      return;
    }
    await sendPreview(request.data);
  }
  async function sendPreview(request: PreviewCsvWire) {
    if (!session || scope.epoch !== epoch) return;
    setDetails(null);
    setStage({ kind: 'previewing' });
    let sent = false;
    try {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify([request.csv_base64, request.source, request.mapping]),
        ),
      );
      const hash = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      if (recovery.current) {
        if (recovery.current.requestHash !== hash)
          throw new Error(
            'The previous preview is still unresolved. Recover its status before changing the file or settings.',
          );
        request.client_request_id = recovery.current.previewId;
      }
      if (previewIdentity.current?.hash !== hash)
        previewIdentity.current = {
          hash,
          requestId: sharedFile?.previewId ?? request.client_request_id,
        };
      request.client_request_id = previewIdentity.current.requestId;
      if (!recovery.current)
        recovery.current = {
          protocol: HANDOFF_PROTOCOL,
          owner: session.user.id,
          generation: sharedFile?.generation ?? identityGeneration.current,
          previewId: request.client_request_id,
          commitId: crypto.randomUUID(),
          phase: 'previewing',
          expiresAt: Date.now() + RECOVERY_LIFETIME,
          sourceId:
            request.source.kind === 'existing' ? request.source.id : null,
          settingsVersion: null,
          requestHash: hash,
        };
      const commitId = crypto.randomUUID();
      await remember('previewing', request.client_request_id, commitId);
      if (sharedFile)
        await checkShareClaim(
          sharedFile.ref,
          session.user.id,
          sharedFile.consumer,
          sharedFile.generation,
        );
      sent = true;
      const p = successEnvelopeSchema(ImportPreviewV2Schema).parse(
        await ownedJson('/api/data', session.access_token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify(request),
        }),
      ).data;
      if (scope.epoch !== epoch) return;
      if (sharedFile) {
        await consumeShare(sharedFile.ref, session.user.id);
        onSharedConsumed?.();
      }
      await remember('review', request.client_request_id, commitId, p);
      if (p.historical_result) await finished();
      scope.commit(epoch, () => {
        setCsv('');
        if (p.historical_result) {
          setStage({
            kind: 'done',
            result: p.historical_result,
            historical: true,
            selections: p.selections,
          });
          onSaved(p.historical_result);
        } else
          setStage({
            kind: 'review',
            preview: p,
            requestId: commitId,
          });
      });
    } catch (e) {
      if (sent && e instanceof ApiError && [400, 413].includes(e.status))
        await finished();
      scope.commit(epoch, () => {
        setStage(
          !sent || (e instanceof ApiError && [400, 413].includes(e.status))
            ? { kind: 'editing' }
            : {
                kind: 'uncertain_preview',
                requestId:
                  previewIdentity.current?.requestId ??
                  request.client_request_id,
              },
        );
        setError(
          e instanceof Error
            ? e.message
            : 'Preview failed. No measurements were saved.',
        );
      });
    }
  }
  async function commit() {
    if (
      stage.kind !== 'review' ||
      !session ||
      stage.preview.dataRevision !== dataRevision
    )
      return;
    const pending = stage;
    setError('');
    setStage({ ...pending, kind: 'committing' });
    try {
      await remember(
        'committing',
        recovery.current!.previewId,
        pending.requestId,
        pending.preview,
      );
      const r = successEnvelopeSchema(ImportResultSchema).parse(
        await ownedJson('/api/data', session.access_token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify({
            schema_version: 2,
            action: 'commit_import',
            batch_id: pending.preview.batch_id,
            payload_hash: pending.preview.payload_hash,
            client_request_id: pending.requestId,
          }),
        }),
      ).data;
      if (scope.epoch !== epoch) return;
      await finished();
      scope.commit(epoch, () => {
        setStage({
          kind: 'done',
          result: r,
          selections: pending.preview.selections,
        });
        setSource(r.source_id);
        onSaved(r);
      });
    } catch (e) {
      scope.commit(epoch, () => {
        const invalidated = e instanceof ApiError && e.status === 409;
        if (invalidated) {
          setStage({ ...pending, kind: 'stale' });
          setError(e.message);
        } else {
          setStage({ ...pending, kind: 'uncertain' });
          setError(
            e instanceof Error
              ? e.message
              : 'Import failed. Retry to check its recorded outcome.',
          );
        }
      });
    }
  }
  async function reconcile(batchId: string | null, requestId: string) {
    if (!session) return;
    setError('');
    try {
      const status = successEnvelopeSchema(ImportStatusSchema).parse(
        await ownedJson(
          '/api/data?' +
            new URLSearchParams({
              view: 'import_status',
              ...(batchId
                ? { batch_id: batchId }
                : { client_request_id: requestId }),
            }),
          session.access_token,
          scope,
          epoch,
        ),
      ).data;
      if (scope.epoch !== epoch) return;
      if (status.status === 'committed' || !status.preview) await finished();
      else {
        if (status.preview.confirmed_mapping)
          applyMapping(status.preview.confirmed_mapping);
        const commitId = recovery.current?.commitId ?? crypto.randomUUID();
        await remember(
          'review',
          recovery.current?.previewId ?? requestId,
          commitId,
          status.preview,
        );
        if (sharedFile) {
          await consumeShare(sharedFile.ref, session.user.id);
          onSharedConsumed?.();
        }
      }
      scope.commit(epoch, () => {
        if (status.status === 'committed' && status.result) {
          setStage({
            kind: 'done',
            result: status.result,
            selections:
              'preview' in stage
                ? stage.preview.selections
                : (status.preview?.selections ?? []),
          });
          onSaved(status.result);
        } else if (status.preview)
          setStage({
            kind: 'review',
            preview: status.preview,
            requestId:
              recovery.current?.commitId ??
              (batchId ? requestId : crypto.randomUUID()),
          });
        else {
          setStage({ kind: 'editing' });
          setError(
            'The server reports this import as ' +
              status.status +
              '. Choose a file for a new preview.',
          );
        }
      });
    } catch (e) {
      scope.commit(epoch, () => {
        if (e instanceof ApiError && e.status === 404) {
          setStage({ kind: 'editing' });
          setError(
            'The server has no saved preview for this request yet. Retry the same file and settings, or clear local recovery after checking Data.',
          );
        } else
          setError(
            'Import status is unavailable. Check status again before retrying or discarding.',
          );
      });
    }
  }
  async function discard() {
    if (!session || !('preview' in stage)) return;
    const pending = stage;
    setStage({ ...pending, kind: 'discarding' });
    try {
      const status = successEnvelopeSchema(ImportStatusSchema).parse(
        await ownedJson('/api/data', session.access_token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify({
            action: 'discard_import',
            batch_id: pending.preview.batch_id,
          }),
        }),
      ).data;
      if (scope.epoch !== epoch) return;
      await finished();
      scope.commit(epoch, () => {
        if (status.status === 'committed' && status.result) {
          setStage({
            kind: 'done',
            result: status.result,
            selections: pending.preview.selections,
          });
          onSaved(status.result);
        } else {
          setStage({ kind: 'editing' });
          setCsv('');
          setFileName('');
          setSettingsMode('confirm');
          setError('Server confirmed preview ' + status.status + '.');
        }
      });
    } catch {
      scope.commit(epoch, () => {
        setStage({ ...pending, kind: 'uncertain' });
        setError('Discard was not confirmed. Check server status.');
      });
    }
  }
  async function reviewExclusions(review: ImportReview) {
    if (!session || stage.kind !== 'review') return;
    const pending = stage;
    setStage({
      ...pending,
      kind: 'reviewing',
      preview: { ...pending.preview, review },
    });
    try {
      const preview = successEnvelopeSchema(ImportPreviewV2Schema).parse(
        await ownedJson('/api/data', session.access_token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify({
            action: 'review_import',
            batch_id: pending.preview.batch_id,
            payload_hash: pending.preview.payload_hash,
            review,
          }),
        }),
      ).data;
      scope.commit(epoch, () => {
        setStage({ ...pending, preview });
        setDetails(null);
      });
    } catch {
      scope.commit(epoch, () => {
        setStage({ ...pending, kind: 'uncertain' });
        setError(
          'Review was not confirmed. Check server status before continuing.',
        );
      });
    }
  }
  async function loadDetails(offset: number) {
    if (!session || !('preview' in stage)) return;
    try {
      const page = successEnvelopeSchema(ImportItemsSchema).parse(
        await ownedJson(
          '/api/data?' +
            new URLSearchParams({
              view: 'import_items',
              batch_id: stage.preview.batch_id,
              payload_hash: stage.preview.payload_hash,
              offset: String(offset),
              limit: '100',
            }),
          session.access_token,
          scope,
          epoch,
        ),
      ).data;
      scope.commit(epoch, () => setDetails(page));
    } catch (e) {
      scope.commit(epoch, () =>
        setError(e instanceof Error ? e.message : 'Details unavailable.'),
      );
    }
  }
  function columnSelect(
    name: string,
    value: string,
    change: (value: string) => void,
    optional = true,
  ) {
    return (
      <label>
        {name}
        <select value={value} onChange={(e) => change(e.target.value)}>
          {optional && <option value="">None</option>}
          {headers.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </label>
    );
  }
  const locked = stage.kind !== 'editing';
  const p = 'preview' in stage ? stage.preview : null;
  return (
    <section className="data-panel" aria-label="CSV import">
      <h2>Import CSV</h2>
      <p>
        Import a canonical CSV, a mapped wide-column CSV, or the supported
        English RENPHO Health CSV layout in lb. RENPHO imports preserve all
        supported numeric fields and annotations. Importing does not use AI.
      </p>
      <p>
        Vulpes is independent and is not affiliated with, sponsored by, or
        endorsed by RENPHO.
      </p>
      {stage.kind === 'restoring' && (
        <p role="status">Checking for a pending import…</p>
      )}
      {stage.kind === 'clearing_recovery' && (
        <p role="status">Clearing local recovery…</p>
      )}
      <details open={stage.kind === 'editing'}>
        <summary>File and source settings</summary>
        <form className="settings-form data-form" onSubmit={preview}>
          <fieldset className="settings-form" disabled={locked}>
            <legend>File, source and mapping</legend>
            <label>
              Preview settings
              <select
                value={settingsMode}
                onChange={(e) =>
                  setSettingsMode(e.target.value as typeof settingsMode)
                }
              >
                <option value="saved">Use compatible saved settings</option>
                <option value="confirm">Review settings before preview</option>
              </select>
            </label>
            <label>
              CSV file
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void loadFile(e.target.files?.[0])}
              />
            </label>
            <p>
              {fileName
                ? `Selected: ${fileName}`
                : 'Maximum 1 MiB UTF-8; 10,000 rows; 25,000 observations.'}
            </p>
            <label>
              Import source
              <select
                value={source}
                onChange={(e) => {
                  sourceChosen.current = true;
                  setSettingsMode('confirm');
                  setSource(e.target.value);
                  setUsingSaved(false);
                  setSingle(false);
                  setZoneConfirmed(false);
                  const saved = savedMapping(
                    sources.find((s) => s.id === e.target.value),
                    format,
                    headers,
                  );
                  if (saved) {
                    applyMapping(saved);
                    setUsingSaved(false);
                    setSingle(false);
                    setZoneConfirmed(false);
                  }
                }}
              >
                <option value="new">New CSV source</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} · {s.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {source === 'new' && (
              <>
                <label>
                  Import source label
                  <input
                    value={label}
                    maxLength={200}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </label>
                <label>
                  Import origin app
                  <input
                    value={app}
                    maxLength={200}
                    onChange={(e) => setApp(e.target.value)}
                  />
                </label>
                <label>
                  Import device label
                  <input
                    value={device}
                    maxLength={200}
                    onChange={(e) => setDevice(e.target.value)}
                  />
                </label>
              </>
            )}
            {source !== 'new' && sources.find((s) => s.id === source) && (
              <SourceImportDefaults
                key={`${source}:${sources.find((s) => s.id === source)?.settingsVersion}`}
                source={sources.find((s) => s.id === source)!}
                onSaved={(mapping) => {
                  setSettingsMode('confirm');
                  applyMapping(mapping);
                  setUsingSaved(false);
                  setSingle(false);
                  setZoneConfirmed(false);
                }}
              />
            )}
            <label>
              CSV format
              <select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as typeof format);
                  setUsingSaved(false);
                  setSingle(false);
                  setZoneConfirmed(false);
                }}
              >
                <option value="canonical">Canonical long form</option>
                <option value="wide">Mapped wide columns</option>
                <option value="renpho">RENPHO Health (English, lb)</option>
              </select>
            </label>
            <label>
              Import timezone
              <input
                value={zone}
                onChange={(e) => {
                  setZone(e.target.value);
                  setZoneConfirmed(false);
                  setUsingSaved(false);
                }}
              />
            </label>
            {format === 'canonical' ? (
              <label>
                CSV source label to include
                <input
                  aria-label="CSV source label to include"
                  aria-describedby="csv-source-hint"
                  value={sourceLabel}
                  maxLength={200}
                  onChange={(e) => setSourceLabel(e.target.value)}
                />
                <span id="csv-source-hint">
                  Exact value in the source column; other sources are excluded.
                </span>
              </label>
            ) : format === 'wide' ? (
              <>
                {columnSelect(
                  'Timestamp column',
                  timestamp,
                  setTimestamp,
                  false,
                )}
                {columnSelect('Local date column', localDate, setLocalDate)}
                {columnSelect(
                  'External record ID column',
                  externalId,
                  setExternalId,
                )}
                <label>
                  Import granularity
                  <select
                    value={granularity}
                    onChange={(e) =>
                      setGranularity(e.target.value as Granularity)
                    }
                  >
                    <option value="instant">Instant</option>
                    <option value="daily_total">Daily total</option>
                    <option value="session_total">Session total</option>
                  </select>
                </label>
                {headers.map((column) => (
                  <fieldset key={column}>
                    <legend>{column}</legend>
                    <label>
                      Metric for {column}
                      <select
                        value={columns[column]?.metric ?? ''}
                        onChange={(e) => {
                          const metric = e.target.value as MetricKey | '';
                          setColumns((current) => {
                            const next = { ...current };
                            if (!metric) delete next[column];
                            else
                              next[column] = {
                                metric,
                                unit: measurementRegistry[metric].units[0],
                                method: 'unknown',
                              };
                            return next;
                          });
                        }}
                      >
                        <option value="">Ignore</option>
                        {Object.entries(measurementRegistry).map(([key, v]) => (
                          <option key={key} value={key}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {columns[column] && (
                      <>
                        <label>
                          Unit for {column}
                          <select
                            value={columns[column].unit}
                            onChange={(e) =>
                              setColumns({
                                ...columns,
                                [column]: {
                                  ...columns[column]!,
                                  unit: e.target.value,
                                },
                              })
                            }
                          >
                            {measurementRegistry[
                              columns[column].metric
                            ].units.map((unit) => (
                              <option key={unit}>{unit}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Method for {column}
                          <select
                            value={columns[column].method}
                            onChange={(e) =>
                              setColumns({
                                ...columns,
                                [column]: {
                                  ...columns[column]!,
                                  method: e.target.value as MeasurementMethod,
                                },
                              })
                            }
                          >
                            {[
                              'unknown',
                              'device_reported',
                              'device_estimate',
                              'user_reported',
                            ].map((method) => (
                              <option key={method}>{method}</option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </fieldset>
                ))}
              </>
            ) : null}
            {usingSaved && (
              <p role="status">
                Using saved source settings: {zone}.{' '}
                {single
                  ? 'Confirmed single-profile history.'
                  : `Exact profile: ${profileValue}.`}{' '}
                Change the source or settings if this file belongs to a
                different context.
              </p>
            )}
            {format === 'renpho' && !usingSaved && (
              <>
                <p>
                  Imports supported values and annotations as linked weigh-ins.
                  Estimates are manufacturer-reported. Date and Time use the
                  confirmed timezone; ambiguous or missing DST times are
                  invalid. No. is provenance, not identity. Select the same
                  source for overlapping exports.
                </p>
                <label className="data-checkbox">
                  <input
                    type="checkbox"
                    checked={zoneConfirmed}
                    onChange={(e) => setZoneConfirmed(e.target.checked)}
                  />
                  I confirm the import timezone matches this RENPHO file
                </label>
              </>
            )}
            {format !== 'renpho' &&
              columnSelect('Profile column', profileColumn, setProfileColumn)}
            {format !== 'renpho' && profileColumn ? (
              <label>
                Profile value to include
                <input
                  aria-label="Profile value to include"
                  aria-describedby="csv-profile-hint"
                  value={profileValue}
                  maxLength={200}
                  onChange={(e) => setProfileValue(e.target.value)}
                />
                <span id="csv-profile-hint">
                  Exact match. Other profiles are counted separately.
                </span>
              </label>
            ) : !usingSaved ? (
              <label className="data-checkbox">
                <input
                  type="checkbox"
                  checked={single}
                  onChange={(e) => setSingle(e.target.checked)}
                />
                I confirm this file contains one profile
              </label>
            ) : null}
            <label className="data-checkbox">
              <input
                type="checkbox"
                checked={flag}
                onChange={(e) => setFlag(e.target.checked)}
              />
              Flag imported readings for review
            </label>
            <Button ref={previewButton} type="submit" disabled={!csv}>
              Preview CSV
            </Button>
          </fieldset>
        </form>
      </details>
      {stage.kind === 'editing' && recovery.current && (
        <section aria-label="Unresolved local recovery">
          <p>
            Clearing local recovery does not cancel a server request that may
            still finish. Check Data for an existing result before starting
            another import.
          </p>
          <Button variant="outline" onClick={() => void clearRecovery()}>
            Clear local recovery
          </Button>
        </section>
      )}
      {stage.kind === 'editing' && sharedFile && (
        <Button
          variant="outline"
          onClick={() => {
            if (!session) return;
            void consumeShare(sharedFile.ref, session.user.id)
              .then(() => {
                scope.commit(epoch, () => {
                  setCsv('');
                  setFileName('');
                  setHeaders([]);
                  onSharedConsumed?.();
                  setError(
                    'The local file was discarded. Choose a file or share again.',
                  );
                });
              })
              .catch(() =>
                setError(
                  'Discard could not be confirmed. Retry or close Vulpes.',
                ),
              );
          }}
        >
          Discard received file
        </Button>
      )}
      {stage.kind === 'previewing' && (
        <p role="status">
          Validating and encrypting the preview. No measurements saved.
        </p>
      )}
      {(stage.kind === 'uncertain_preview' || stage.kind === 'uncertain') && (
        <section role="status">
          <p>
            The response is uncertain. Check the server before another action.
          </p>
          <Button
            onClick={() =>
              void reconcile(
                'preview' in stage ? stage.preview.batch_id : null,
                stage.requestId,
              )
            }
          >
            Check import status
          </Button>
        </section>
      )}
      {p && (
        <section aria-label="Confirm CSV import">
          <h3 ref={reviewHeading} tabIndex={-1}>
            Review import preview
          </h3>
          <p>
            Source: {sources.find((s) => s.id === p.source_id)?.label ?? label}{' '}
            · {p.source_id}
          </p>
          {p.confirmed_mapping && (
            <p>
              Import timezone: {p.confirmed_mapping.timezone}.{' '}
              {p.confirmed_mapping.single_profile
                ? 'Confirmed single-profile history.'
                : `Exact profile: ${p.confirmed_mapping.profile?.value}.`}
            </p>
          )}
          <p>
            {p.counts.new} new; {p.counts.duplicate} duplicates;{' '}
            {p.counts.conflict} conflicts requiring review; {p.counts.invalid}{' '}
            invalid; {p.counts.blank} blank cells skipped.
          </p>
          <p>
            {p.counts.profileExcluded} profile-excluded rows;{' '}
            {p.counts.sourceExcluded} source-excluded rows.
          </p>
          <p>
            Ignored columns: {p.ignored_columns.join(', ') || 'None'}. Expires{' '}
            {p.expires_at}. Revision {p.dataRevision}.
          </p>
          <p>
            {p.source_rows} source rows; {p.events.total} weigh-ins;{' '}
            {p.counts.observations} numeric observations; {p.enrichment_count}{' '}
            missing metrics added; {p.annotation_additions} annotation
            additions; {p.annotation_conflicts} annotation conflicts.{' '}
            {p.unavailable_cells} unavailable cells; {p.empty_events} rows
            without readings. Range: {p.observed_from ?? 'none'} to{' '}
            {p.observed_to ?? 'none'}.
          </p>
          <p>
            Absent supported columns: {p.absent_columns.join(', ') || 'None'}.
            Populated unsupported columns:{' '}
            {p.populated_unknown_columns.join(', ') || 'None'}.
          </p>
          <fieldset disabled={stage.kind !== 'review'}>
            <legend>Review exclusions</legend>
            {(
              [
                'exclude_invalid',
                'exclude_conflicts',
                'acknowledge_unknown',
              ] as const
            ).map((key) => (
              <label className="data-checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={p.review[key]}
                  onChange={(e) =>
                    void reviewExclusions({
                      ...p.review,
                      [key]: e.target.checked,
                    })
                  }
                />
                {key === 'exclude_invalid'
                  ? 'Exclude invalid entries shown in the details'
                  : key === 'exclude_conflicts'
                    ? 'Exclude conflicts and preserve existing values'
                    : 'Acknowledge that populated unsupported columns will not be imported'}
              </label>
            ))}
          </fieldset>
          <Button variant="outline" onClick={() => void loadDetails(0)}>
            Review all import details
          </Button>
          {details && (
            <section aria-label="Import detail page">
              <p>
                {details.total} total detail items; showing{' '}
                {details.items.length}.
              </p>
              <ul>
                {details.items.map((item, i) => (
                  <li key={i}>
                    Row {item.row}, {item.column}:{' '}
                    {item.message ??
                      (item.original_value
                        ? item.original_value + ' ' + item.original_unit + ' ? '
                        : '') +
                        (item.value ?? '') +
                        ' ' +
                        (item.unit ?? '') +
                        ' ' +
                        (item.classification ?? '') +
                        ' ' +
                        (item.observed_at ?? '')}
                  </li>
                ))}
              </ul>
              {details.next_offset !== null && (
                <Button onClick={() => void loadDetails(details.next_offset!)}>
                  Next import details
                </Button>
              )}
            </section>
          )}
          <ul>
            {p.errors.map((e, i) => (
              <li key={i}>
                Row {e.row}, {e.column}: {e.message}
              </li>
            ))}
          </ul>
          {p.errors_omitted > 0 && (
            <p>
              {p.errors_omitted} more errors available through Review all import
              details.
            </p>
          )}
          <p>First {p.preview.length} normalized observations (maximum 20):</p>
          <div
            className="data-table-scroll"
            role="region"
            aria-label="CSV preview table"
            tabIndex={0}
          >
            <table>
              <caption>Normalized import preview</caption>
              <thead>
                <tr>
                  <th scope="col">Row / metric</th>
                  <th scope="col">Value</th>
                  <th scope="col">Time</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {p.preview.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.row} · {r.metric}
                    </td>
                    <td>
                      {r.value} {r.unit}
                    </td>
                    <td>{r.observed_at}</td>
                    <td>{r.classification}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            New observations and missing metrics are inserted; reviewed
            annotation additions are retained. Existing values are preserved. A
            change to your data requires a fresh preview.
          </p>
          <p>
            To change the mapping or timezone, discard this preview and select
            the file again. The next selection will wait for your settings
            review.
          </p>
          {stage.kind === 'stale' ? (
            <p role="alert">
              {error ||
                'This preview is no longer current. Discard it and create a fresh preview.'}
            </p>
          ) : p.dataRevision !== dataRevision ? (
            <p role="alert">
              Your data changed. Discard this preview and create a fresh one
              before importing.
            </p>
          ) : null}
          <Button
            ref={confirm}
            disabled={
              stage.kind !== 'review' ||
              !p.ready_to_commit ||
              Date.parse(p.expires_at) <= Date.now() ||
              p.dataRevision !== dataRevision
            }
            onClick={() => void commit()}
          >
            Confirm import
          </Button>
          <Button
            variant="outline"
            disabled={stage.kind !== 'review' && stage.kind !== 'stale'}
            onClick={() => void discard()}
          >
            Discard preview and choose file
          </Button>
        </section>
      )}
      {stage.kind === 'done' && (
        <section>
          <h3 ref={resultHeading} tabIndex={-1}>
            Import recorded
          </h3>
          {stage.historical && (
            <p>Already recorded. No new readings were added.</p>
          )}
          <p role="status">
            Historical batch outcome: {stage.result.inserted} inserted,{' '}
            {stage.result.duplicate} duplicates, {stage.result.conflict}{' '}
            conflicts excluded; revision {stage.result.dataRevision}. Replaying
            this batch adds nothing.
          </p>
          {stage.selections.length > 0 && (
            <section aria-label="View imported readings">
              <h4>View imported readings</h4>
              <p>
                Choose a series. Each range shows up to 366 days ending with its
                latest imported reading.
              </p>
              {stage.selections.map((selection) => (
                <Button
                  key={JSON.stringify(selection)}
                  variant="outline"
                  onClick={() => onView(stage.result.source_id, selection)}
                >
                  {measurementRegistry[selection.metric].label} ·{' '}
                  {selection.method.replaceAll('_', ' ')} ·{' '}
                  {selection.granularity.replaceAll('_', ' ')} ·{' '}
                  {selection.from} to {selection.to}
                </Button>
              ))}
            </section>
          )}
          <Button
            onClick={() => {
              setStage({ kind: 'editing' });
              setError('');
              setFileName('');
              setSettingsMode('saved');
            }}
          >
            Import another file
          </Button>
        </section>
      )}
      {error && stage.kind !== 'stale' && <p role="alert">{error}</p>}
    </section>
  );
}
