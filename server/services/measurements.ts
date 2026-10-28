import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { DataSummarySchema, MeasurementsPageSchema, MutationResultSchema, MeasurementMutationResultSchema, SourceSchema, SourcesPageSchema, type AddMeasurement, type DataQuery, type DataSelection, type MeasurementMutation } from '../../shared/data.js';
import { UUIDSchema } from '../../shared/primitives.js';
import type { AuthContext } from '../auth/session.js';
import { measurementDTO, normalizeObservation, type StoredObservation } from '../analytics/measurements.js';
import { selectionWindows, summarizeMeasurements } from '../analytics/summary.js';
import { HttpFailure } from '../http/failure.js';

const snapshotSchema = z.object({ revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), timezone:z.string(), sources:z.array(SourceSchema), rows:z.array(z.object({ id:UUIDSchema,source_id:UUIDSchema,canonical_value:z.string(),metric_key:z.string(),canonical_unit:z.string(),original_value:z.string(),original_unit:z.string(),observed_at:z.string(),original_offset_minutes:z.number().nullable(),timezone:z.string().nullable(),local_date:z.string().nullable(),granularity:z.string(),measurement_method:z.string(),quality_flags:z.array(z.string()),external_record_id:z.string().nullable(),version:z.number() })) });
function databaseFailure(message: string): never {
  if (message === 'data_not_found') throw new HttpFailure(404,'not_found','The source or reading was not found.');
  if (message === 'data_conflict') throw new HttpFailure(409,'data_conflict','The data changed or this reading conflicts with an existing record. Refresh and review.');
  if (message === 'invalid_measurement') throw new HttpFailure(400,'invalid_input','Choose valid measurement fields.');
  if (message === 'account_unavailable') throw new HttpFailure(403,'account_unavailable','This account is not available.');
  throw new HttpFailure(503,'data_unavailable','Your data could not be loaded or saved.');
}
export async function addMeasurement(context: AuthContext, request: AddMeasurement) {
  let normalized;
  try { normalized = normalizeObservation(request.observation); }
  catch { throw new HttpFailure(400,'invalid_input','Check the value, unit, granularity, date and timezone. Ambiguous or nonexistent local times require correction or an explicit offset.'); }
  const offset = normalized.original_offset_minutes;
  const offsetString = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}`;
  // The direct RPC requires an offset, so it never applies PostgreSQL's implicit
  // DST choice. The public API resolves unique naive times before this boundary.
  const observation = { ...request.observation, observed_at: /(?:Z|[+-]\d{2}:\d{2})$/.test(request.observation.observed_at) ? request.observation.observed_at : request.observation.observed_at+offsetString };
  const { data,error } = await context.db.rpc('add_measurement_v1',{ p_request:{ ...request,observation } });
  if (error) databaseFailure(error.message);
  return MutationResultSchema.parse(data);
}
export async function mutateMeasurement(context:AuthContext,request:MeasurementMutation) {
  let input=request;
  if(request.action==='correct_measurement') {
    try {
      const value=request.changes.observed_at;
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value))throw new Error();
      const explicit=/(?:Z|[+-]\d{2}:\d{2})$/.test(value);
      const zoned=explicit ? Temporal.Instant.from(value).toZonedDateTimeISO(request.changes.timezone) : Temporal.PlainDateTime.from(value,{overflow:'reject'}).toZonedDateTime(request.changes.timezone,{disambiguation:'reject'});
      if(!explicit && zoned.offsetNanoseconds%60_000_000_000!==0)throw new Error();
      input={...request,changes:{...request.changes,observed_at:explicit ? value : value+zoned.offset}};
    }catch{throw new HttpFailure(400,'invalid_input','Check the observation time and timezone. Ambiguous or nonexistent local times require an explicit offset.');}
  }
  const {data,error}=await context.db.rpc('mutate_measurement_v1',{p_request:input});
  if(error)databaseFailure(error.message);
  return MeasurementMutationResultSchema.parse(data);
}
async function snapshot(context: AuthContext, query: Record<string, string | number>) {
  const { data,error } = await context.db.rpc('read_data_v1',{ p_query:query });
  if (error || data === null) databaseFailure(error?.message ?? 'account_unavailable');
  return snapshotSchema.parse(data);
}
function filterKey(query: DataQuery) {
  return query.view === 'sources' ? 'sources' : JSON.stringify([query.metric,query.source_id,query.from,query.to,query.timezone,query.method,query.granularity]);
}
function cursor(context: AuthContext, query: DataQuery, revision: number, id: string) {
  return Buffer.from(JSON.stringify({ owner:context.userId,filter:filterKey(query),revision,id })).toString('base64url');
}
async function readCursor(context: AuthContext, query: Extract<DataQuery,{view:'sources'|'measurements'}>) {
  if (!query.cursor) return null;
  try {
    const value = z.strictObject({ owner:UUIDSchema,filter:z.string(),revision:z.number().int().nonnegative(),id:UUIDSchema }).parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')));
    if (value.owner !== context.userId || value.filter !== filterKey(query) || (query.data_revision !== undefined && query.data_revision !== value.revision)) throw new Error();
    const table = query.view === 'sources' ? 'data_sources' : 'measurements';
    const anchor = await context.db.from(table).select('*').eq('user_id',context.userId).eq('id',value.id).maybeSingle();
    if (anchor.error) throw new HttpFailure(503,'data_unavailable','Pagination could not be checked.');
    if (!anchor.data) throw new Error();
    if (query.view === 'measurements') {
      const row = anchor.data as { source_id?:string; metric_key?:string; observed_at?:string; measurement_method?:string; granularity?:string; deleted_at?:string|null;local_date?:string|null };
      const inRange = row.granularity === 'daily_total'
        ? row.local_date! >= Temporal.Instant.from(query.from).toZonedDateTimeISO(query.timezone).toPlainDate().toString() && row.local_date! < Temporal.Instant.from(query.to).toZonedDateTimeISO(query.timezone).toPlainDate().toString()
        : Temporal.Instant.compare(Temporal.Instant.from(row.observed_at!),Temporal.Instant.from(query.from))>=0 && Temporal.Instant.compare(Temporal.Instant.from(row.observed_at!),Temporal.Instant.from(query.to))<0;
      if (row.source_id !== query.source_id || row.metric_key !== query.metric || row.measurement_method !== query.method || row.granularity !== query.granularity || row.deleted_at || !inRange) throw new Error();
    }
    return value;
  } catch (error) {
    if (error instanceof HttpFailure) throw error;
    throw new HttpFailure(400,'invalid_cursor','Refresh this selection to restart pagination.');
  }
}
function checkRevision(actual: number, expected: number | undefined) {
  if (expected !== undefined && expected !== actual) throw new HttpFailure(409,'data_changed','Your data changed. Refresh this selection.');
}
async function requireSource(context: AuthContext, id: string) {
  const { data,error } = await context.db.from('data_sources').select('id').eq('user_id',context.userId).eq('id',id).maybeSingle();
  if (error) databaseFailure(error.message);
  if (!data) databaseFailure('data_not_found');
}
function selection(query: Exclude<DataQuery,{view:'sources'}>): DataSelection {
  return { metric:query.metric,source_id:query.source_id,from:query.from,to:query.to,timezone:query.timezone,method:query.method,granularity:query.granularity };
}
export async function readData(context: AuthContext, query: DataQuery) {
  if (query.view !== 'sources') {
    await requireSource(context,query.source_id);
    try { selectionWindows(selection(query)); }
    catch { throw new HttpFailure(400,'invalid_interval','Select 1–366 complete local calendar days with an explicit timezone.'); }
  }
  if(query.view==='export') throw new Error('Use the CSV export service.');
  if (query.view === 'summary') {
    const chosen = selection(query); const windows = selectionWindows(chosen);
    const rows: StoredObservation[] = []; let after: string | undefined; let revision: number | undefined;
    do {
      const result = await snapshot(context,{ ...chosen,view:'measurements',from:windows.readFrom.toInstant().toString(),limit:200,...(after ? { after_id:after } : {}) });
      checkRevision(result.revision,revision); revision = result.revision;
      rows.push(...result.rows as StoredObservation[]);
      after = result.rows.length === 200 ? result.rows.at(-1)!.id : undefined;
    } while (after);
    const end = await snapshot(context,{ view:'sources',limit:1 }); checkRevision(end.revision,revision);
    return DataSummarySchema.parse(summarizeMeasurements(rows,chosen,revision!));
  }
  const anchor = await readCursor(context,query);
  const result = await snapshot(context,{ ...(query.view === 'sources' ? {} : selection(query)),view:query.view,limit:query.page_size,...(anchor ? { after_id:anchor.id } : {}) });
  checkRevision(result.revision,anchor?.revision ?? query.data_revision);
  if (query.view === 'sources') return SourcesPageSchema.parse({ items:result.sources,nextCursor:result.sources.length === query.page_size ? cursor(context,query,result.revision,result.sources.at(-1)!.id) : null,dataRevision:result.revision,timezone:result.timezone });
  return MeasurementsPageSchema.parse({ items:(result.rows as StoredObservation[]).map(measurementDTO),nextCursor:result.rows.length === query.page_size ? cursor(context,query,result.revision,result.rows.at(-1)!.id) : null,dataRevision:result.revision });
}

export async function goalObservations(context:AuthContext,selection:DataSelection){
  const rows:StoredObservation[]=[];let after:string|undefined;let revision:number|undefined;
  do {const page=await snapshot(context,{...selection,view:'measurements',limit:200,...(after?{after_id:after}:{})});checkRevision(page.revision,revision);revision=page.revision;rows.push(...page.rows as StoredObservation[]);after=page.rows.length===200?page.rows.at(-1)!.id:undefined;}while(after);
  const end=await snapshot(context,{view:'sources',limit:1});checkRevision(end.revision,revision);return {rows,revision:revision!};
}
