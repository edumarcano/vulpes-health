/** Vulpes SSE v1 contract. Runtime validation is mandatory in the implementation. */
import type { UUID, ModelRole, UsageSummary, VulpesCard } from './domain';

type EventMap = {
  'run.started': { assistant_message_id: UUID };
  'route.selected': {
    role: ModelRole;
    model: string;
    provider: string;
    effort: string | null;
    reason: string;
  };
  'step.started': {
    step_id: UUID;
    step_type: 'generation' | 'decision' | 'tool';
    label: string;
  };
  'tool.result': {
    step_id: UUID;
    tool_name: string;
    result_reference: string;
    summary: string;
  };
  'card.ready': { message_id: UUID; card: VulpesCard };
  'text.delta': { message_id: UUID; text: string };
  'run.usage': UsageSummary;
  'run.completed': { message_id: UUID };
  'run.failed': {
    code: string;
    message: string;
    partial_output: boolean;
    retryable: boolean;
  };
  'run.cancelled': {
    partial_output: boolean;
    cost_status: UsageSummary['costStatus'];
  };
};
export type StreamEvent = {
  [K in keyof EventMap]: {
    v: 1;
    type: K;
    run_id: UUID;
    seq: number;
    payload: EventMap[K];
  };
}[keyof EventMap];

export function isTerminalEvent(event: StreamEvent): boolean {
  return (
    event.type === 'run.completed' ||
    event.type === 'run.failed' ||
    event.type === 'run.cancelled'
  );
}
