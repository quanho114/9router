import { describe, it, expect } from 'vitest';
import { reconcileAntigravityQuotaReadings, getRemainingPercentage } from '@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js';
const now = Date.parse('2026-11-12T00:00:00Z');
const row = (used, resetAt = '2026-11-13T00:00:00Z') => ({modelKey:'gemini_weekly', used, total:1000, remainingPercentage:(1000-used)/10, resetAt});
describe('Antigravity active-window reconciliation',()=>{
 it('does not bounce 500 -> 497 -> 500 -> 497 within the same period',()=>{
   let state=[row(500)];
   const balances=[];
   for(const used of [503,500,503,500,503]){
     state=reconcileAntigravityQuotaReadings(state,[row(used)],now);
     balances.push(1000-state[0].used);
   }
   expect(balances).toEqual([497,497,497,497,497]);
   expect(getRemainingPercentage(state[0])).toBe(49.7);
 });
 it('accepts further real consumption',()=>{
   expect(reconcileAntigravityQuotaReadings([row(503)],[row(510)],now)[0].used).toBe(510);
 });
 it('accepts replenishment when the reset period or allowance changes',()=>{
   expect(reconcileAntigravityQuotaReadings([row(503)],[row(0,'2026-11-20T00:00:00Z')],now)[0].used).toBe(0);
   expect(reconcileAntigravityQuotaReadings([row(503)],[{...row(0),total:2000}],now)[0].used).toBe(0);
 });
 it('does not lock expired, unknown or non-recurring periods',()=>{
   for(const resetAt of [null,'2026-11-11T00:00:00Z'])expect(reconcileAntigravityQuotaReadings([row(503,resetAt)],[row(0,resetAt)],now)[0].used).toBe(0);
   expect(reconcileAntigravityQuotaReadings([row(503)],[{...row(0),recurring:false}],now)[0].used).toBe(0);
 });
 it('does not mutate source snapshots or cross model buckets',()=>{
   const old=row(503), incoming=row(500);
   reconcileAntigravityQuotaReadings([old],[incoming],now);
   expect(incoming.used).toBe(500);
   expect(reconcileAntigravityQuotaReadings([old],[{...incoming,modelKey:'claude_weekly'}],now)[0].used).toBe(500);
 });
});
