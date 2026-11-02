import { describe,it,expect } from 'vitest';
import { lunaPlan,lunaCases,stableAttempt } from '../../scripts/luna-evaluation.js';
import { verifyLuna } from '../../scripts/verify-luna.js';
import { verificationFixtures } from '../../server/ai/verification-fixture.js';

describe('fixed Luna verification plan',()=>{
  it('bounds all continuations, follow-up and interruption requests',()=>{
    const plan=lunaPlan();expect(plan.requests).toBe(50);expect(plan.requestMaximumUSD).toBe('0.0093192');expect(plan.maximumUSD).toBe('0.46596');
    expect(lunaCases.find(c=>c.id==='E05')?.requests).toBe(8);expect(lunaCases.find(c=>c.id==='E10')?.requests).toBe(0);
    expect(lunaCases.find(c=>c.id==='E05')?.prompt).toContain('Make this target active right now.');
    expect(new Set(Object.values(verificationFixtures).map(f=>f.hash)).size).toBe(4);
  });
  it('binds stable attempt identities to the batch and scenario',()=>{
    const batch='11111111-1111-4111-8111-111111111111';
    expect(stableAttempt(batch,'E01')).toBe(stableAttempt(batch,'E01'));
    expect(stableAttempt(batch,'E01')).not.toBe(stableAttempt(batch,'E02'));
  });
  it('prints a zero-request plan and rejects spend omission before touching configuration',async()=>{
    expect(await verifyLuna(['--plan'])).toEqual(lunaPlan());
    await expect(verifyLuna(['--case=E01'])).rejects.toThrow('live_opt_in_required');
    await expect(verifyLuna(['--plan','--case=unknown'])).rejects.toThrow('live_opt_in_required');
  });
});
