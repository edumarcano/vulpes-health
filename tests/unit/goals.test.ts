import { it,expect } from 'vitest';
import { GoalMutationSchema,goalTransitions } from '../../shared/goals.js';
import { goalPolicyAllows } from '../../server/security/goal-policy.js';
import { goalDraft } from '../fixtures/contracts.js';
const definition={...goalDraft,method:'device_reported',granularity:'instant',currentMethod:'daily_median_mean_7d'};
it('validates complete direct proposals and refuses user-supplied authority',()=>{
 const request={action:'propose_create',client_request_id:'11111111-1111-4111-8111-111111111111',definition};
 expect(GoalMutationSchema.safeParse(request).success).toBe(true);
 for(const extra of [{user_id:'11111111-1111-4111-8111-111111111111'},{state:'active'},{payload_hash:'a'.repeat(64)}])expect(GoalMutationSchema.safeParse({...request,...extra}).success).toBe(false);
 expect(GoalMutationSchema.safeParse({...request,definition:{...definition,currentMethod:'latest_value'}}).success).toBe(false);
});
it('keeps archive terminal and completion explicitly reversible',()=>{expect(goalTransitions.archived).toEqual([]);expect(goalTransitions.completed).toContain('active');expect(goalTransitions.needs_data).not.toContain('active');});
it('shares the treatment boundary without inventing numerical clinical limits',()=>{expect(goalPolicyAllows({title:'Stop my medication'})).toBe(false);expect(goalPolicyAllows({title:'Lowest body-fat as fast as possible'})).toBe(false);expect(goalPolicyAllows({title:'Synthetic requested target',target:68})).toBe(true);});
