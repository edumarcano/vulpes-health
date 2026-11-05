import type {
  GenerationAdapter,
  GenerationRequest,
} from '../server/ai/contracts.js';
import { OpenRouterResponsesAdapter } from '../server/ai/providers/openrouter.js';
import {
  ToolErrorResultSchema,
  ToolValidationFailure,
  executeReadTool,
} from '../server/ai/tools.js';
import type { AuthContext } from '../server/auth/session.js';

// Verification fixture only: this is not a claim that the provider emitted a
// rejected call. The real tool validator supplies the feedback sent upstream.
export async function toolErrorProbeAdapter(
  context: AuthContext,
): Promise<GenerationAdapter> {
  let feedback;
  try {
    await executeReadTool(context, 'list_metrics', {
      compatibility_probe: true,
    });
    throw new Error('probe_arguments_were_not_rejected');
  } catch (error) {
    if (!(error instanceof ToolValidationFailure)) throw error;
    feedback = ToolErrorResultSchema.parse({
      kind: 'tool_error',
      code: error.code,
      recoverable: true,
      hint: error.hint,
    });
  }
  const adapter = new OpenRouterResponsesAdapter();
  let used = false;
  return {
    family: adapter.family,
    capabilities: adapter.capabilities,
    generate(request, options) {
      if (used) throw new Error('protocol_probe_single_request_only');
      used = true;
      const callId = 'synthetic-rejected-list-metrics-v1';
      const probe: GenerationRequest = {
        ...request,
        tools: [],
        continuation: null,
        turns: [
          ...request.turns,
          {
            type: 'tool_call',
            callId,
            name: 'list_metrics',
            arguments: { compatibility_probe: true },
          },
          {
            type: 'tool_result',
            callId,
            name: 'list_metrics',
            result: { result: feedback },
          },
        ],
      };
      return adapter.generate(probe, options);
    },
  };
}
