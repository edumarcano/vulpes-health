import { z } from 'zod';
import { VulpesCardSchema as LegacyCardSchema } from './domain.js';
import { GoalProposalReferenceSchema } from './goals.js';
import { GoalProgressResultSchema } from './goal-progress.js';
import { UUIDSchema } from './primitives.js';

export const VulpesCardSchema=z.union([
  LegacyCardSchema,
  z.strictObject({type:z.literal('goal_proposal'),reference:GoalProposalReferenceSchema}),
  z.strictObject({type:z.literal('goal_progress'),goalId:UUIDSchema,result:GoalProgressResultSchema}),
]);
