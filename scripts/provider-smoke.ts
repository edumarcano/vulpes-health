import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readServerEnvironment } from '../server/config/environment.js';
import { getRoleAvailability, models } from '../server/config/models.js';
import { DecimalUSDSchema, ModelRoleSchema } from '../shared/primitives.js';
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
      mode: { type: 'string' }, role: { type: 'string' }, scenario: { type: 'string' }, 'allow-spend': { type: 'boolean' }, 'max-cost-usd': { type: 'string' }, 'write-report': { type: 'boolean' },
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
    if(selectedRole.data!=='everyday')throw new SmokeDenied('live_role_unavailable');
    const scenario=values.scenario ?? 'tool_loop';if(scenario!=='tool_loop' && scenario!=='cancel')throw new SmokeDenied('invalid_scenario');
    const config=models.everyday;
    const readiness=assessEverydayPreflight({enabled:environment.liveAiRequested,mode:'verification',model:config.modelId,effort:config.reasoning.effort,
      adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,
      maxInputTokens:config.maxInputTokens,maxOutputTokens:config.maxOutputTokens,price:config.price,capabilities:everydayCapabilityEvidence,smoke:null,maxCostUSD:ceiling.data});
    if(readiness.state==='unavailable')throw new SmokeDenied(readiness.reason);
    return {report:await runLiveEveryday(ceiling.data,values['allow-spend'],env,fetch,scenario),writeReport:values['write-report'] ?? false};
  }
  if (values['allow-spend'] || values['max-cost-usd'] !== undefined || values.scenario!==undefined) throw new SmokeDenied('spend_flags_require_live_mode');

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
    rows.push({ role: config.role, model: config.modelId, family: config.apiFamily, synthetic: 'passed', syntheticTransportRequests: requests, liveSmoke: 'not_run', availability: getRoleAvailability(config.role) });
  }
  return { report: { mode: 'synthetic', checkedAt: new Date().toISOString(), rows, actualProviderRequests: 0, inferenceSpendUSD: '0' }, writeReport: values['write-report'] ?? false };
}

export function renderSmokeReport(report: SmokeReport): string {
  return [
    '# Provider smoke evidence', '', `Generated by \`npm run test:providers -- --write-report\` at ${report.checkedAt}.`, '',
    'Synthetic normalized-protocol fixtures only. This command checks no public documentation, credentials, account access, region, pricing, or live privacy route.', '',
    '| Role | Model | API family | Synthetic | Fixture requests | Live smoke | Live availability |',
    '|---|---|---|---|---|---|---|',
    ...report.rows.map((row) => `| ${row.role} | \`${row.model}\` | ${row.family} | ${row.synthetic} | ${row.syntheticTransportRequests} | ${row.liveSmoke} | ${row.availability.state}: ${row.availability.reason} |`), '',
    `Actual provider requests: **${report.actualProviderRequests}**. Inference spend: **$${report.inferenceSpendUSD}**.`, '',
    'Generation fixtures exercise a read-tool continuation with opaque state; decision fixtures exercise keyed finite scores. They do not establish vendor wire compatibility or model quality. The guarded live verification transport has not been exercised against a provider.', '',
    '## Live verification blockers', '',
    '- All prices remain unverified, including applicable cache/reasoning/tool categories and conservative output bounds.',
    '- Account/model access, enforced OpenRouter ZDR, and accepted Google location/retention are unverified.',
    '- Production inference remains unavailable; an authorized verification uses a local synthetic account and a persistent capped allocation through the execution ledger.',
    '- Decision scoring remains disabled; vendor score-range mapping and comparative evaluations belong to PR 14.', '',
    '## Guard verification', '',
    '`npm run test:providers -- --mode=live --role=everyday` must exit 1 with `live_opt_in_required` before credential discovery.', '',
    'Even with `--allow-spend --max-cost-usd=0.01` and a true live-AI switch, live mode exits with `price_unverified` before credential discovery. These flags do not authorize inference.', '',
    'The report contains no prompts, raw provider payloads, credentials, or health records. See [PR 02 evidence](pr02-contracts.md) for public documentation review, local checks, and acceptance boundaries.', '',
  ].join('\n');
}

async function main(): Promise<void> {
  try {
    const { report, writeReport } = await runSmoke(process.argv.slice(2), process.env);
    if (writeReport && report.mode==='synthetic') await writeFile(new URL('../docs/evidence/PROVIDER_SMOKE_TESTS.md', import.meta.url), renderSmokeReport(report), 'utf8');
    console.info(JSON.stringify(report, null, 2));
    if (writeReport && report.mode==='live') {
      const name=`live-everyday-${report.batchId}-${report.scenario}-${report.runId ?? randomUUID()}.json`;
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
