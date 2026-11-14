import { useEffect, useRef, useState, type SubmitEvent } from 'react';
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
} from '../../../shared/imports';
import { z } from 'zod';
import { SourceImportDefaults } from './source-import-defaults';
import type {
  MetricKey,
  Granularity,
  MeasurementMethod,
} from '../../../shared/domain';

type Stage =
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
  | { kind: 'done'; result: ImportResult; selections: ImportSelection[] };
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
}: {
  sources: Source[];
  timezone: string;
  dataRevision: number;
  onSaved: (result: ImportResult) => void;
  onView: (sourceId: string, selection: ImportSelection) => void;
}) {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
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
  const [stage, setStage] = useState<Stage>({ kind: 'editing' });
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
      if (sequence === fileSequence.current)
        scope.commit(epoch, () => {
          // Keep RENPHO file bytes for hashing without changing generic CSV identities.
          setCsv(
            btoa(
              Array.from(new Uint8Array(bytes), (byte) =>
                String.fromCharCode(byte),
              ).join(''),
            ),
          );
          setHeaders(found.filter(Boolean));
          setZoneConfirmed(false);
          setFileName(file.name);
          setFormat(
            isRenphoHeader(found)
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
                : 'wide',
          );
          setTimestamp(found[0] ?? '');
          setColumns({});
          setProfileColumn('');
          setSingle(false);
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
    setDetails(null);
    setStage({ kind: 'previewing' });
    try {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify([
            request.data.csv_base64,
            request.data.source,
            request.data.mapping,
          ]),
        ),
      );
      const hash = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      if (previewIdentity.current?.hash !== hash)
        previewIdentity.current = {
          hash,
          requestId: request.data.client_request_id,
        };
      request.data.client_request_id = previewIdentity.current.requestId;
      const p = successEnvelopeSchema(ImportPreviewV2Schema).parse(
        await ownedJson('/api/data', session.access_token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify(request.data),
        }),
      ).data;
      scope.commit(epoch, () => {
        setCsv('');
        if (p.historical_result) {
          setStage({
            kind: 'done',
            result: p.historical_result,
            selections: p.selections,
          });
          onSaved(p.historical_result);
        } else
          setStage({
            kind: 'review',
            preview: p,
            requestId: crypto.randomUUID(),
          });
      });
    } catch (e) {
      scope.commit(epoch, () => {
        setStage(
          e instanceof ApiError && [400, 413].includes(e.status)
            ? { kind: 'editing' }
            : {
                kind: 'uncertain_preview',
                requestId: previewIdentity.current!.requestId,
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
            requestId: batchId ? requestId : crypto.randomUUID(),
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
            'No saved preview was found. Choose the file and preview again.',
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
      <form className="settings-form data-form" onSubmit={preview}>
        <fieldset className="settings-form" disabled={locked}>
          <legend>File, source and mapping</legend>
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
            <select value={source} onChange={(e) => setSource(e.target.value)}>
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
            />
          )}
          <label>
            CSV format
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
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
              {columnSelect('Timestamp column', timestamp, setTimestamp, false)}
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
          {format === 'renpho' && (
            <>
              <p>
                Imports supported values and annotations as linked weigh-ins.
                Estimates are manufacturer-reported. Date and Time use the
                confirmed timezone; ambiguous or missing DST times are invalid.
                No. is provenance, not identity. Select the same source for
                overlapping exports.
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
          ) : (
            <label className="data-checkbox">
              <input
                type="checkbox"
                checked={single}
                onChange={(e) => setSingle(e.target.checked)}
              />
              I confirm this file contains one profile
            </label>
          )}
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
            {p.enrichment_count} missing metrics added; {p.annotation_additions}{' '}
            annotation additions; {p.annotation_conflicts} annotation conflicts.{' '}
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
