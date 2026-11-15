import { z } from 'zod';
import type { AuthContext } from '../auth/session.js';
import {
  METRIC_CONTENT_VERSION,
  metricContent,
  metricDisplayGroups,
  metricEstimateCaution,
  metricGoalCaution,
  metricRegistry,
} from '../../shared/metrics.js';
import {
  MetricReferenceResultSchema,
  REFERENCE_RESOLVER_VERSION,
  ReferenceQuerySchema,
  type ReferenceBasis,
} from '../../shared/references.js';
import {
  REFERENCE_REGISTRY_VERSION,
  manufacturerReferenceRules,
} from '../config/metric-references.js';
import {
  referenceResultId,
  resolveManufacturerReference,
} from '../analytics/references.js';
import { readAnalysis } from './analysis.js';
import { analysisWindow } from '../analytics/analysis.js';
import { HttpFailure } from '../http/failure.js';

export async function readMetricReference(
  context: AuthContext,
  input: z.input<typeof ReferenceQuerySchema>,
  evaluatedAt = new Date().toISOString(),
) {
  const request = ReferenceQuerySchema.parse(input);
  const { expected_result_id, data_revision, ...originalSelection } = request;
  const selection = { ...originalSelection };
  if (request.from && request.to) {
    try {
      const window = analysisWindow(
        { from: request.from, to: request.to },
        request.timezone,
      ).window;
      selection.from = window.from;
      selection.to = window.to;
    } catch {
      throw new HttpFailure(
        400,
        'invalid_interval',
        'Select 1–366 complete local calendar days.',
      );
    }
  }
  const source = await context.db
    .from('data_sources')
    .select('id')
    .eq('user_id', context.userId)
    .eq('id', request.source_id)
    .maybeSingle();
  if (source.error)
    throw new HttpFailure(
      503,
      'data_unavailable',
      'The reference source could not be verified.',
    );
  if (!source.data)
    throw new HttpFailure(404, 'not_found', 'The owned source was not found.');
  const profile = await context.db
    .from('profiles')
    .select('data_revision')
    .eq('user_id', context.userId)
    .eq('account_state', 'active')
    .maybeSingle();
  if (profile.error)
    throw new HttpFailure(
      503,
      'data_unavailable',
      'The reference revision could not be verified.',
    );
  if (!profile.data)
    throw new HttpFailure(
      403,
      'account_unavailable',
      'This account is not available.',
    );
  const revision = profile.data.data_revision;
  if (data_revision !== undefined && data_revision !== revision)
    throw new HttpFailure(
      410,
      'result_unavailable',
      'The original reference result is unavailable. Request current data separately.',
    );
  const registry = metricRegistry[request.metric];
  const content = metricContent[request.metric];
  const batch = registry.analyticsOperand
    ? await readAnalysis(
        context,
        {
          action: 'analyze',
          operations: [
            {
              operation: 'latest_per_metric',
              series: {
                metric: request.metric,
                source_id: request.source_id,
                method: request.method,
                granularity: request.granularity,
              },
              timezone: request.timezone,
              ...(request.from && request.to
                ? { window: { from: request.from, to: request.to } }
                : {}),
            },
          ],
        },
        evaluatedAt,
      )
    : null;
  const analysis = batch?.results[0] ?? null;
  if (analysis && analysis.kind !== 'series_analysis')
    throw new HttpFailure(
      503,
      'data_unavailable',
      'The reference reading could not be verified.',
    );
  if (analysis && analysis.dataRevision !== revision)
    throw new HttpFailure(
      409,
      'data_changed',
      'Your data changed. Refresh this selection.',
    );
  // No verified rule currently requires profile collection. Source labels do
  // not establish a manufacturer, model or device mode.
  const basis: ReferenceBasis = {
    kind: 'current_guidance',
    profileVersion: null,
    attributes: {},
  };
  const classification = resolveManufacturerReference(
    {
      metric: request.metric,
      unit: registry.canonicalUnit,
      value: analysis?.current.value ?? null,
      scope: { app: null, appVersion: null, model: null, mode: null },
      basis,
    },
    manufacturerReferenceRules,
  );
  const id = referenceResultId({
    owner: context.userId,
    selection,
    analysisResultId: analysis?.id ?? null,
    dataRevision: revision,
    referenceRegistryVersion: REFERENCE_REGISTRY_VERSION,
    basis,
  });
  if (expected_result_id !== undefined && expected_result_id !== id)
    throw new HttpFailure(
      410,
      'result_unavailable',
      'This reference content or selection no longer matches. Request current data separately.',
    );
  const end = await context.db
    .from('profiles')
    .select('data_revision')
    .eq('user_id', context.userId)
    .eq('account_state', 'active')
    .maybeSingle();
  if (end.error)
    throw new HttpFailure(
      503,
      'data_unavailable',
      'The reference revision could not be verified.',
    );
  if (!end.data || end.data.data_revision !== revision)
    throw new HttpFailure(
      409,
      'data_changed',
      'Your data changed. Refresh this selection.',
    );
  return MetricReferenceResultSchema.parse({
    schemaVersion: 1,
    id,
    contentVersion: METRIC_CONTENT_VERSION,
    referenceRegistryVersion: REFERENCE_REGISTRY_VERSION,
    resolverVersion: REFERENCE_RESOLVER_VERSION,
    dataRevision: revision,
    evaluatedAt,
    selection,
    definition: {
      metric: request.metric,
      label: registry.label,
      unit: registry.canonicalUnit,
      definition: content.definition,
      displayGroup: content.displayGroup,
      displayGroupLabel: metricDisplayGroups[content.displayGroup],
      analyticsEligible: registry.analyticsOperand,
      goalEligible: content.goalEligible,
      limitations: [
        registry.limitation,
        ...(registry.method === 'device_estimate'
          ? [metricEstimateCaution]
          : []),
        metricGoalCaution,
      ],
    },
    analysis,
    classification,
    evidence: {
      analysisResultId: analysis?.id ?? null,
      referenceResultId: id,
      dataRevision: revision,
    },
  });
}
