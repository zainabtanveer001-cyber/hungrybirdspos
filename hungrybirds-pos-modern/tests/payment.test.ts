import { describe, expect, it } from 'vitest';
import { computeCashBalance, computeQuickTenderAmounts } from '../src/lib/payment';

describe('payment helpers', () => {
  it('returns Exact plus relevant PKR quick-tender bills without duplicates', () => {
    expect(computeQuickTenderAmounts(350)).toEqual([350, 500, 1000, 2000, 5000]);
    expect(computeQuickTenderAmounts(1000)).toEqual([1000, 2000, 5000]);
    expect(computeQuickTenderAmounts(1300)).toEqual([1300, 1500, 2000, 5000]);
    expect(computeQuickTenderAmounts(5000)).toEqual([5000, 6000, 10000]);
    expect(computeQuickTenderAmounts(6200)).toEqual([6200, 6500, 7000, 10000]);
  });

  it('handles zero or negative totals safely', () => {
    expect(computeQuickTenderAmounts(0)).toEqual([0]);
    expect(computeQuickTenderAmounts(-50)).toEqual([0]);
  });

  it('computes change and shortfall without floating-point drift', () => {
    expect(computeCashBalance(1300, 2000)).toEqual({ short: false, change: 700, remaining: 0 });
    expect(computeCashBalance(1300, 1000)).toEqual({ short: true, change: 0, remaining: 300 });
    expect(computeCashBalance(12.3, 20)).toEqual({ short: false, change: 7.7, remaining: 0 });
    expect(computeCashBalance(100, 100)).toEqual({ short: false, change: 0, remaining: 0 });
  });
});
