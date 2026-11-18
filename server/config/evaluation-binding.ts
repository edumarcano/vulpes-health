import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HashSchema, ISOInstantSchema } from '../../shared/primitives.js';
import { evaluationCandidates, type EvaluationCandidateId } from './models.js';
import {
  everydayAdapterVersion,
  everydayTemplateVersion,
} from './everyday-versions.js';
import { openRouterPolicyHash } from './everyday-production.js';
import { providerPolicies } from '../security/consent.js';
import {
  assessEverydayPreflight,
  LiveCapabilityEvidenceSchema,
  priceFingerprint,
} from '../ai/live-preflight.js';

export const EvaluationPrivacyEvidenceSchema = z.strictObject({
  version: z.literal(1),
  provider: z.literal('openrouter'),
  model: z.string().min(1),
  effort: z.enum(['low', 'medium', 'high']),
  policyVersion: z.string().min(1),
  policyHash: HashSchema,
  checkedAt: ISOInstantSchema,
  sourceURL: z.url(),
  safetyRetention: z.literal('excluded'),
  guard: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('endpoint_allowlist'),
      endpoints: z.array(z.string().min(1).max(200)).min(1),
    }),
    z.strictObject({
      kind: z.literal('account_guardrail'),
      safetyRetentionDisabled: z.literal(true),
      evidenceHash: HashSchema,
    }),
  ]),
});

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function materialize(
  candidateId: EvaluationCandidateId,
  evidence: { capabilities?: unknown; privacy?: unknown },
) {
  if (!Object.hasOwn(evaluationCandidates, candidateId))
    throw new Error('evaluation_candidate_unknown');
  const config = structuredClone(evaluationCandidates[candidateId]);
  const capabilities = evidence.capabilities
    ? LiveCapabilityEvidenceSchema.parse(evidence.capabilities)
    : null;
  const privacy = evidence.privacy
    ? EvaluationPrivacyEvidenceSchema.parse(evidence.privacy)
    : null;
  const fields = {
    candidateId,
    config,
    configurationHash: hash(config),
    priceHash:
      config.price.status === 'verified'
        ? priceFingerprint(config.price)
        : null,
    adapterVersion: everydayAdapterVersion,
    templateVersion: everydayTemplateVersion,
    policyVersion: providerPolicies.openrouter.version,
    policyHash: openRouterPolicyHash(),
    capabilities,
    privacy,
  };
  return { ...fields, bindingHash: hash(fields) };
}
type Immutable<T> = T extends object
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T;
export type EvaluationBinding = Immutable<ReturnType<typeof materialize>>;

export function createEvaluationBinding(
  candidateId: EvaluationCandidateId,
  evidence: { capabilities?: unknown; privacy?: unknown } = {},
): EvaluationBinding {
  return freeze(materialize(candidateId, evidence));
}
export function assertEvaluationBinding(binding: EvaluationBinding): void {
  const expected = materialize(binding.candidateId, {
    capabilities: binding.capabilities,
    privacy: binding.privacy,
  });
  if (JSON.stringify(binding) !== JSON.stringify(expected))
    throw new Error('evaluation_binding_mismatch');
}
export function assessEvaluationBinding(
  binding: EvaluationBinding,
  enabled: boolean,
  ceiling: string,
) {
  assertEvaluationBinding(binding);
  const config = binding.config;
  const readiness = assessEverydayPreflight({
    enabled,
    mode: 'verification',
    model: config.modelId,
    effort: config.reasoning.effort,
    adapterVersion: binding.adapterVersion,
    templateVersion: binding.templateVersion,
    maxInputTokens: config.maxInputTokens,
    maxOutputTokens: config.maxOutputTokens,
    price: config.price,
    capabilities: binding.capabilities,
    smoke: null,
    maxCostUSD: ceiling,
  });
  if (readiness.state !== 'ready') return readiness;
  const privacy = binding.privacy;
  if (
    !privacy ||
    privacy.model !== config.modelId ||
    privacy.effort !== config.reasoning.effort ||
    privacy.policyVersion !== binding.policyVersion ||
    privacy.policyHash !== binding.policyHash ||
    !config.price.checkedAt ||
    Date.parse(privacy.checkedAt) < Date.parse(config.price.checkedAt)
  )
    return {
      state: 'unavailable' as const,
      reason: 'evaluation_privacy_unverified',
    };
  return readiness;
}

export function evaluationProviderSettings(binding: EvaluationBinding) {
  assertEvaluationBinding(binding);
  return {
    zdr: true,
    data_collection: 'deny',
    require_parameters: true,
    ...(binding.config.price.status === 'verified'
      ? {
          max_price: {
            prompt: Number(binding.config.price.inputPerMillion),
            completion: Number(binding.config.price.outputPerMillion),
          },
        }
      : {}),
    ...(binding.privacy?.guard.kind === 'endpoint_allowlist'
      ? { only: binding.privacy.guard.endpoints, allow_fallbacks: false }
      : {}),
  };
}

export function assertEvaluationBody(
  binding: EvaluationBinding,
  bytes: Uint8Array,
): void {
  assertEvaluationBinding(binding);
  const body = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<
    string,
    unknown
  >;
  if (
    bytes.byteLength > binding.config.maxInputTokens ||
    !Array.isArray(body.input) ||
    body.input.length === 0 ||
    !Array.isArray(body.tools) ||
    Object.keys(body).some(
      (key) =>
        ![
          'model',
          'input',
          'tools',
          'stream',
          'store',
          'reasoning',
          'max_output_tokens',
          'provider',
          'plugins',
          'parallel_tool_calls',
        ].includes(key),
    ) ||
    body.model !== binding.config.modelId ||
    JSON.stringify(body.reasoning) !==
      JSON.stringify(binding.config.reasoning) ||
    body.max_output_tokens !== binding.config.maxOutputTokens ||
    JSON.stringify(body.provider) !==
      JSON.stringify(evaluationProviderSettings(binding)) ||
    body.stream !== true ||
    body.store !== false ||
    body.parallel_tool_calls !== false ||
    JSON.stringify(body.plugins) !== '[]'
  )
    throw new Error('evaluation_request_mismatch');
}
