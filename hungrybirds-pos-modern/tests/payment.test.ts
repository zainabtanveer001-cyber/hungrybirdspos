import { describe, expect, it } from 'vitest';
import {
  computeCashBalance,
  computeQuickTenderAmounts,
  computeSplitTenderSummary,
  fillRemainingForMethod,
} from '../src/lib/payment';

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

  it('validates 2-way and 3-way split tender with cash change calculation', () => {
    const twoWay = computeSplitTenderSummary(2500, {
      Cash: 1000,
      Card: 1500,
      Online: 0,
      cashGiven: 1500,
    });
    expect(twoWay.valid).toBe(true);
    expect(twoWay.change).toBe(500);
    expect(twoWay.payments).toEqual([
      { method: 'Cash', amount: 1000, cashGiven: 1500, change: 500 },
      { method: 'Card', amount: 1500 },
    ]);

    const threeWay = computeSplitTenderSummary(3000.5, {
      Cash: 1000,
      Card: 1000.25,
      Online: 1000.25,
      cashGiven: 1000,
    });
    expect(threeWay.valid).toBe(true);
    expect(threeWay.payments).toHaveLength(3);
  });

  it('rejects under-allocated, over-allocated, or short-cash split payments', () => {
    const under = computeSplitTenderSummary(1500, {
      Cash: 500,
      Card: 500,
      Online: 0,
      cashGiven: 500,
    });
    expect(under.valid).toBe(false);
    expect(under.remainingToAllocate).toBe(500);

    const over = computeSplitTenderSummary(1500, {
      Cash: 1000,
      Card: 700,
      Online: 0,
      cashGiven: 1000,
    });
    expect(over.valid).toBe(false);
    expect(over.overAllocated).toBe(200);

    const shortCash = computeSplitTenderSummary(1500, {
      Cash: 1000,
      Card: 500,
      Online: 0,
      cashGiven: 800,
    });
    expect(shortCash.valid).toBe(false);
    expect(shortCash.cashShort).toBe(200);
  });

  it('fills remaining balance for any target payment method cleanly', () => {
    const step1 = fillRemainingForMethod(
      2000,
      { Cash: 800, Card: 0, Online: 0, cashGiven: 800 },
      'Card',
    );
    expect(step1).toEqual({ Cash: 800, Card: 1200, Online: 0, cashGiven: 800 });

    const step2 = fillRemainingForMethod(
      2000,
      { Cash: 0, Card: 500, Online: 250, cashGiven: 0 },
      'Cash',
    );
    expect(step2).toEqual({ Cash: 1250, Card: 500, Online: 250, cashGiven: 1250 });
  });
});
