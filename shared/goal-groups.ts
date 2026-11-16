import { z } from 'zod';
import {
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
  GoalProposalReferenceSchema,
} from './goals.js';
import { GoalProgressResultSchema } from './goal-progress.js';
import { GoalRowSchema } from './goal-views.js';
import { GoalStateSchema } from './domain.js';
import {
  CountSchema,
  HashSchema,
  ISOInstantSchema,
  PageSizeSchema,
  UUIDSchema,
  VersionSchema,
} from './primitives.js';

const id = UUIDSchema.transform((value) => value.toLowerCase());
export const GoalGroupMemberInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('existing'),
    goal_id: id,
    expected_version: VersionSchema,
  }),
  z.strictObject({
    kind: z.literal('create'),
    definition: GoalDefinitionSchema,
  }),
  z.strictObject({
    kind: z.literal('revise'),
    goal_id: id,
    expected_version: VersionSchema,
    definition: GoalDefinitionSchema,
    baseline_resolution: z.enum(['retain', 'replace']),
  }),
]);
const memberInputs = z
  .array(GoalGroupMemberInputSchema)
  .min(1)
  .max(4)
  .superRefine((members, ctx) => {
    const existing = members.flatMap((member) =>
      member.kind === 'create' ? [] : [member.goal_id],
    );
    if (new Set(existing).size !== existing.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Each goal can appear only once in a group.',
      });
  });
const name = z.string().trim().min(1).max(200);
export const GoalGroupMutationSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('propose_group_create'),
    client_request_id: id,
    name,
    members: memberInputs,
  }),
  z.strictObject({
    action: z.literal('propose_group_revision'),
    client_request_id: id,
    group_id: id,
    expected_version: VersionSchema,
    name,
    members: memberInputs,
  }),
  z.strictObject({
    action: z.literal('propose_group_state'),
    client_request_id: id,
    group_id: id,
    expected_version: VersionSchema,
    state: z.literal('archived'),
  }),
]);
export const PreparedGroupMemberSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('existing'),
    goalId: id,
    expectedVersion: VersionSchema,
    revisionId: id,
    payload: GoalRevisionPayloadSchema,
  }),
  z.strictObject({
    kind: z.literal('create'),
    payload: GoalRevisionPayloadSchema,
  }),
  z.strictObject({
    kind: z.literal('revise'),
    goalId: id,
    expectedVersion: VersionSchema,
    revisionId: id,
    payload: GoalRevisionPayloadSchema,
  }),
]);
export const GoalGroupProposalPayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    name,
    state: z.enum(['active', 'archived']),
    members: z.array(PreparedGroupMemberSchema).min(1).max(4),
    reviewedDataRevision: CountSchema,
  })
  .superRefine((payload, ctx) => {
    const goalIds = payload.members.flatMap((member) =>
      member.kind === 'create' ? [] : [member.goalId],
    );
    if (new Set(goalIds).size !== goalIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Each goal can appear only once in a group.',
      });
    if (
      payload.state === 'active' &&
      payload.members.some(
        (member) =>
          member.kind !== 'existing' &&
          member.payload.reviewedDataRevision !== payload.reviewedDataRevision,
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['reviewedDataRevision'],
        message: 'Prepare every changed child against the same data revision.',
      });
  });
export const GoalGroupProposalReferenceSchema = GoalProposalReferenceSchema;
export const GoalGroupProposalToolResultSchema = z.strictObject({
  kind: z.literal('goal_group_proposal'),
  request: GoalGroupMutationSchema,
  payload: GoalGroupProposalPayloadSchema,
});
export const GoalGroupRowSchema = z.object({
  id,
  name,
  state: z.enum(['active', 'archived']),
  version: VersionSchema,
  review_status: z.enum(['clear', 'needs_review']),
  current_approval_id: id.nullable(),
  created_at: ISOInstantSchema,
  updated_at: ISOInstantSchema,
});
export const GoalGroupMembershipSchema = z.object({
  id,
  group_id: id,
  goal_id: id,
  position: z.number().int().min(1).max(4),
  reviewed_goal_version: VersionSchema,
  reviewed_revision_id: id,
});
export const GoalGroupProposalRowSchema = z.object({
  id,
  kind: z.enum(['goal_group.create', 'goal_group.revise', 'goal_group.state']),
  state: z.enum(['pending', 'approved', 'rejected', 'expired', 'conflicted']),
  summary: z.string(),
  expires_at: ISOInstantSchema,
  group_target_id: id.nullable(),
  target_id: z.null(),
  target_version: VersionSchema.nullable(),
  payload_hash: HashSchema,
  canonical_payload: z.json(),
  result: z.json(),
  private_content_removed_at: ISOInstantSchema.nullable().optional(),
});
export const GoalGroupDecisionSchema = z.discriminatedUnion('outcome', [
  z.object({ proposalId: id, outcome: z.literal('rejected') }),
  z.object({
    proposalId: id,
    outcome: z.literal('approved'),
    groupId: id,
    version: VersionSchema,
    members: z
      .array(
        z.object({
          goalId: id,
          revisionId: id,
          version: VersionSchema,
          revisionNumber: VersionSchema.optional(),
          position: z.number().int().min(1).max(4),
        }),
      )
      .min(1)
      .max(4),
  }),
]);
export const GoalGroupListQuerySchema = z.strictObject({
  page_size: PageSizeSchema.default(50),
  cursor: id.optional(),
  state: z.enum(['active', 'archived']).optional(),
});
export const GoalGroupsPageSchema = z.strictObject({
  items: z.array(GoalGroupRowSchema).max(200),
  nextCursor: id.nullable(),
});
export const GoalGroupProposalListQuerySchema = GoalGroupListQuerySchema.pick({
  page_size: true,
  cursor: true,
});
export const GoalGroupProposalsPageSchema = z.strictObject({
  items: z.array(GoalGroupProposalRowSchema).max(200),
  nextCursor: id.nullable(),
});
export const GoalGroupProgressMemberSchema = z.strictObject({
  position: z.number().int().min(1).max(4),
  goalId: id,
  reviewedVersion: VersionSchema,
  reviewedRevisionId: id,
  currentVersion: VersionSchema.nullable(),
  currentRevisionId: id.nullable(),
  state: GoalStateSchema.nullable(),
  title: z.string(),
  outcome: z.enum([
    'met',
    'not_met',
    'needs_data',
    'needs_review',
    'stale',
    'archived',
    'unavailable',
  ]),
  progress: GoalProgressResultSchema.nullable(),
});
export const GoalGroupProgressSchema = z.strictObject({
  kind: z.literal('group_progress'),
  groupId: id,
  groupVersion: VersionSchema,
  dataRevision: CountSchema,
  evaluatedAt: ISOInstantSchema,
  administrativeState: z.enum(['active', 'archived']),
  conditionStatus: z.enum([
    'meeting_conditions',
    'not_meeting_conditions',
    'unavailable',
  ]),
  members: z.array(GoalGroupProgressMemberSchema).min(1).max(4),
});
export const GoalGroupDetailSchema = z.strictObject({
  group: GoalGroupRowSchema,
  members: z
    .array(
      z.strictObject({
        membership: GoalGroupMembershipSchema,
        reviewedPayload: GoalRevisionPayloadSchema.nullable(),
        goal: GoalRowSchema.nullable(),
        currentRevisionId: id.nullable(),
      }),
    )
    .min(1)
    .max(4),
  progress: GoalGroupProgressSchema,
});
export type GoalGroupMutation = z.infer<typeof GoalGroupMutationSchema>;
export type GoalGroupMemberInput = z.infer<typeof GoalGroupMemberInputSchema>;
export type PreparedGroupMember = z.infer<typeof PreparedGroupMemberSchema>;
export type GoalGroupProposalPayload = z.infer<
  typeof GoalGroupProposalPayloadSchema
>;
export type GoalGroupRow = z.infer<typeof GoalGroupRowSchema>;
export type GoalGroupMembership = z.infer<typeof GoalGroupMembershipSchema>;
export type GoalGroupProgress = z.infer<typeof GoalGroupProgressSchema>;
export type GoalGroupProgressMember = z.infer<
  typeof GoalGroupProgressMemberSchema
>;
