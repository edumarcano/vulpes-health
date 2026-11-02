import {assessVertex,vertexEvidence} from '../server/ai/vertex-readiness.js';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readServerEnvironment } from '../server/config/environment.js';
import { getRoleAvailability, models } from '../server/config/models.js';
import { DecimalUSDSchema, ModelRoleSchema,UUIDSchema } from '../shared/primitives.js';
import { assessEverydayPreflight } from '../server/ai/live-preflight.js';
import { everydayCapabilityEvidence } from '../server/config/everyday-verification.js';
import { everydayAdapterVersion,everydayTemplateVersion } from '../server/config/everyday-versions.js';
import { runLiveEveryday,type LiveSmokeReport } from './live-everyday.js';
import type { ModelRole } from '../shared/primitives.js';
import {
  exerciseGeneration, generationReplies, SyntheticDecisionAdapter, SyntheticDecisionTransport,
  SyntheticGenerationAdapter, SyntheticGenerationTransport, syntheticDecisionRequest, syntheticDecisionResult, syntheticUsage,
} from '../tests/helpers/synthetic-providers.js';

interface SmokeRow {
  role: ModelRole;
  model: string;
  family: string;
  synthetic: 'passed';
  syntheticTransportRequests: number;
  liveSmoke: 'not_run';
  availability: ReturnType<typeof getRoleAvailability>;
}
export interface SmokeReport {
  mode: 'synthetic';
  checkedAt: string;
  rows: SmokeRow[];
  actualProviderRequests: 0;
  inferenceSpendUSD: '0';
}
class SmokeDenied extends Error {}

function smokeArguments(args: string[]) {
  try {
    return parseArgs({ args, strict: true, allowPositionals: false, options: {
      mode: { type: 'string' }, role: { type: 'string' }, scenario: { type: 'string' }, 'attempt-id':{type:'string'}, 'allow-spend': { type: 'boolean' }, 'max-cost-usd': { type: 'string' }, 'write-report': { type: 'boolean' },
    } }).values;
  } catch { throw new SmokeDenied('invalid_arguments'); }
}

export async function runSmoke(args: string[], env: NodeJS.ProcessEnv): Promise<{ report: SmokeReport | LiveSmokeReport; writeReport: boolean }> {
  const values = smokeArguments(args);
  const mode = values.mode ?? 'synthetic';
  if (mode !== 'synthetic' && mode !== 'live') throw new SmokeDenied('invalid_arguments');
  const selectedRole = values.role === undefined ? undefined : ModelRoleSchema.safeParse(values.role);
  if (selectedRole && !selectedRole.success) throw new SmokeDenied('invalid_role');
  if (mode === 'live') {
    if (!selectedRole || !values['allow-spend'] || values['max-cost-usd'] === undefined) throw new SmokeDenied('live_opt_in_required');
    const ceiling = DecimalUSDSchema.safeParse(values['max-cost-usd']);
    if (!ceiling.success || !/[1-9]/.test(ceiling.data)) throw new SmokeDenied('invalid_spend_limit');
    let environment;
    try { environment = readServerEnvironment(env); } catch { throw new SmokeDenied('invalid_live_switch'); }
    if (!environment.liveAiRequested) throw new SmokeDenied('live_ai_disabled');
    if(selectedRole.data==='decision')throw new SmokeDenied('live_role_unavailable');
    if(selectedRole.data!=='everyday'){
      const role=selectedRole.data;const ready=assessVertex(role,{enabled:environment.liveAiRequested,project:env.GOOGLE_CLOUD_PROJECT,location:env.GOOGLE_CLOUD_LOCATION,ceiling:ceiling.data,evidence:vertexEvidence[role]});
      if(ready.state!=='ready')throw new SmokeDenied(ready.reason);
      const attempt=UUIDSchema.safeParse(values['attempt-id']);if(!attempt.success)throw new SmokeDenied('verification_attempt_required');
      const scenario=values.scenario??'tool_loop';if(!['tool_loop','cancel','disconnect'].includes(scenario))throw new SmokeDenied('invalid_scenario');
      return {report:await runLiveEveryday(ceiling.data,true,env,fetch,scenario as 'tool_loop'|'cancel'|'disconnect',attempt.data,role),writeReport:values['write-report']??false};
    }
    const scenario=values.scenario ?? 'tool_loop';if(scenario!=='tool_loop' && scenario!=='cancel' && scenario!=='disconnect')throw new SmokeDenied('invalid_scenario');
    const config=models.everyday;
    const readiness=assessEverydayPreflight({enabled:environment.liveAiRequested,mode:'verification',model:config.modelId,effort:config.reasoning.effort,
      adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,
      maxInputTokens:config.maxInputTokens,maxOutputTokens:config.maxOutputTokens,price:config.price,capabilities:everydayCapabilityEvidence,smoke:null,maxCostUSD:ceiling.data});
    if(readiness.state==='unavailable')throw new SmokeDenied(readiness.reason);
    const attempt=UUIDSchema.safeParse(values['attempt-id']);if(!attempt.success)throw new SmokeDenied('verification_attempt_required');
    return {report:await runLiveEveryday(ceiling.data,values['allow-spend'],env,fetch,scenario,attempt.data),writeReport:values['write-report'] ?? false};
  }
  if (values['allow-spend'] || values['max-cost-usd'] !== undefined || values.scenario!==undefined || values['attempt-id']!==undefined) throw new SmokeDenied('spend_flags_require_live_mode');

  const rows: SmokeRow[] = [];
  for (const config of Object.values(models)) {
    if (selectedRole?.success && selectedRole.data !== config.role) continue;
    let requests: number;
    if (config.apiFamily === 'openrouter_decisions') {
      const transport = new SyntheticDecisionTransport(syntheticDecisionResult);
      const adapter = new SyntheticDecisionAdapter(transport);
      assert.deepEqual(await adapter.score(syntheticDecisionRequest, { signal: new AbortController().signal }), syntheticDecisionResult);
      requests = transport.requests.length;
      assert.equal(requests, 1);
    } else {
      const transport: SyntheticGenerationTransport = new SyntheticGenerationTransport(generationReplies(config.apiFamily));
      const adapter = new SyntheticGenerationAdapter(config.apiFamily, config.capabilities, transport);
      const result = await exerciseGeneration(adapter, new AbortController().signal);
      assert.equal(result.second.filter((event) => event.type === 'text.delta').map((event) => event.text).join(''), 'The synthetic mean is 69.7 kg.');
      assert.deepEqual(result.second.filter((event) => event.type === 'usage'), [{ type: 'usage', usage: syntheticUsage }]);
      requests = transport.requests.length;
      assert.equal(requests, 2);
      assert.deepEqual(transport.requests[1]!.continuation, { family: config.apiFamily, data: { signature: 'synthetic-opaque-do-not-rewrite', callId: 'synthetic-call-1' } });
    }
    rows.push({ role: config.role, model: config.modelId, family: config.apiFamily, synthetic: 'passed', syntheticTransportRequests: requests, liveSmoke: 'not_run', availability: getRoleAvailability(config.role,readServerEnvironment(env).liveAiRequested) });
  }
  return { report: { mode: 'synthetic', checkedAt: new Date().toISOString(), rows, actualProviderRequests: 0, inferenceSpendUSD: '0' }, writeReport: values['write-report'] ?? false };
}

export function renderSmokeReport(report: SmokeReport): string {
  return [
    '# Provider smoke evidence', '', `Generated by \`npm run test:providers -- --write-report\` at ${report.checkedAt}.`, '',
    'Synthetic normalized-protocol fixtures only. This command checks no public documentation, credentials, account access, region, pricing, or live privacy route.', '',
    '| Role | Model | API family | Synthetic | Fixture requests | Live smoke in this invocation | Live availability |',
    '|---|---|---|---|---|---|---|',
    ...report.rows.map((row) => `| ${row.role} | \`${row.model}\` | ${row.family} | ${row.synthetic} | ${row.syntheticTransportRequests} | ${row.liveSmoke} | ${row.availability.state}: ${row.availability.reason} |`), '',
    `Actual provider requests: **${report.actualProviderRequests}**. Inference spend: **$${report.inferenceSpendUSD}**.`, '',
    'Generation fixtures exercise a read-tool continuation with opaque state; decision fixtures exercise keyed finite scores. They do not establish vendor wire compatibility or model quality. See the [first live attempt](m3-live-everyday.md) and [M3 re-verification](m3-live-reverification.md) for separately observed provider evidence.', '',
    '## Live verification status', '',
    '- Everyday has a conservative verified price snapshot and matching public capability/privacy evidence. Other role prices remain unverified.',
    '- The M3 verification evidence does not activate production: its approved production smoke binding remains absent. Accepted Google location/retention remains unverified.',
    '- Production inference requires its approved catalog evidence, explicit live switch, private credentials, consent and durable budgets; this synthetic invocation does not activate it.',
    '- Decision scoring remains disabled; vendor score-range mapping and comparative evaluations belong to PR 14.', '',
    '## Guard verification', '',
    '`npm run test:providers -- --mode=live --role=everyday` must exit 1 with `live_opt_in_required` before credential discovery.', '',
    'With the current static Everyday evidence, explicit spend flags and a true live switch still require a valid immutable local synthetic batch, encryption, consent, account/application budgets and credentials. The flags alone do not authorize inference.', '',
    'The report contains no prompts, raw provider payloads, credentials, or health records. See [PR 02 evidence](pr02-contracts.md) for public documentation review, local checks, and acceptance boundaries.', '',
  ].join('\n');
}

async function main(): Promise<void> {
  try {
    const { report, writeReport } = await runSmoke(process.argv.slice(2), process.env);
    if (writeReport && report.mode==='synthetic') await writeFile(new URL('../docs/evidence/PROVIDER_SMOKE_TESTS.md', import.meta.url), renderSmokeReport(report), 'utf8');
    console.info(JSON.stringify(report, null, 2));
    if (writeReport && report.mode==='live') {
      const name=`live-${report.requested.provider==='vertex_ai'?'vertex':'everyday'}-${report.batchId}-${report.scenario}-${report.runId ?? randomUUID()}.json`;
      try {await writeFile(new URL(`../docs/evidence/${name}`,import.meta.url),JSON.stringify(report,null,2)+'\n',{encoding:'utf8',flag:'wx'});}
      catch {console.error(JSON.stringify({code:'evidence_write_failed',actualProviderRequests:report.actualProviderRequests,costUSD:report.costUSD,costStatus:report.costStatus}));process.exitCode=1;return;}
    }
    if(report.mode==='live' && report.result==='failed')process.exitCode=1;
  } catch (error) {
    const safeLive=['invalid_verification_batch','verification_app_budget_unconfigured','verification_allocation_unavailable','verification_allocation_mismatch','verification_account_unavailable','verification_fixture_invalid','verification_requires_local_database','verification_consent_missing','provider_credential_unavailable'];
    const code = error instanceof SmokeDenied ? error.message : error instanceof Error && safeLive.includes(error.message) ? error.message : 'synthetic_contract_failed';
    console.error(JSON.stringify({ mode: 'blocked', code, actualProviderRequests: 0, inferenceSpendUSD: '0' }));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
