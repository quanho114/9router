import { describe, it, expect } from 'vitest';
import { calculatePercentage, getRemainingPercentage, normalizeQuotaPercentage } from '@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js';
describe('quota percentage precision',()=>{
 it('shows consumed quota instead of rounding back to full',()=>{
   expect(calculatePercentage(5,1000)).toBe(99.5);
   expect(getRemainingPercentage({used:5,total:1000,remainingPercentage:99.5})).toBe(99.5);
   expect(calculatePercentage(59,1000)).toBe(94.1);
 });
 it('uses the authoritative percentage even when normalized units are rounded',()=>{
   expect(getRemainingPercentage({used:0,total:1000,remainingPercentage:99.98})).toBe(99.9);
 });
 it('handles remaining and used percentage formats consistently',()=>{
   expect(getRemainingPercentage({percentage:0.5,percentageIsUsed:true})).toBe(99.5);
   expect(getRemainingPercentage({remaining:99.5})).toBe(99.5);
 });
 it('reserves endpoints for truly empty or full readings',()=>{
   expect(normalizeQuotaPercentage(0)).toBe(0);
   expect(normalizeQuotaPercentage(100)).toBe(100);
   expect(normalizeQuotaPercentage(0.01)).toBe(0.1);
   expect(normalizeQuotaPercentage(99.99)).toBe(99.9);
   expect(normalizeQuotaPercentage(-3)).toBe(0);
   expect(normalizeQuotaPercentage(150)).toBe(100);
   expect(normalizeQuotaPercentage(NaN)).toBe(0);
 });
});
