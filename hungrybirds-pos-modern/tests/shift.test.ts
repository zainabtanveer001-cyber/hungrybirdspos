import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import {
  buildShiftReport,
  closeShift,
  CLOSED_SHIFT_REPORTS_KEY,
  computeDenominationTotal,
  computeDrawerVariance,
  getClosedShiftReports,
} from '../src/lib/shift';

describe('blind cash drawer & payment-mode shift helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('totals PKR currency note counts and loose coins accurately', () => {
    const total = computeDenominationTotal(
      { '5000': 2, '1000': 3, '500': 1, '100': 4, '50': 1, '20': 2, '10': 1 },
      15,
    );
    // 10000 + 3000 + 500 + 400 + 50 + 40 + 10 + 15 = 14015
    expect(total).toBe(14015);
  });

  it('computes exact, over, and short cash drawer variance without floating-point drift', () => {
    expect(computeDrawerVariance(12500, 12500)).toEqual({ variance: 0, status: 'EXACT' });
    expect(computeDrawerVariance(12500.25, 12700.75)).toEqual({ variance: 200.5, status: 'OVER' });
    expect(computeDrawerVariance(12500, 12150.2)).toEqual({ variance: -349.8, status: 'SHORT' });
  });

  it('breaks down split-tender Cash, Card, and Online totals cleanly in shift report and blind close records', async () => {
    const settingsMap = new Map<string, any>([
      ['shiftStartTime', { key: 'shiftStartTime', value: '2026-11-21T08:00:00.000Z' }],
      ['shiftOpeningCash', { key: 'shiftOpeningCash', value: '2000' }],
    ]);

    const mockSales = [
      {
        id: 1,
        timestamp: '2026-11-21T10:00:00.000Z',
        orderType: 'DINE_IN',
        serverUser: 'cashier1',
        items: [],
        subtotal: 2500,
        discountPercent: 0,
        discountAmount: 0,
        deliveryCharge: 0,
        packingCharge: 0,
        taxPercent: 0,
        taxAmount: 0,
        otherCharge: 0,
        total: 2500,
        payments: [
          { method: 'Cash', amount: 1000, cashGiven: 1500, change: 500 },
          { method: 'Card', amount: 1000 },
          { method: 'Online', amount: 500 },
        ],
        totalReceived: 3000,
        totalChange: 500,
      },
    ];

    vi.spyOn(db.settings, 'get').mockImplementation(async (k: string) => settingsMap.get(k));
    vi.spyOn(db.settings, 'put').mockImplementation(async (row: any) => {
      settingsMap.set(row.key, row);
      return row.key;
    });
    vi.spyOn(db.settings, 'delete').mockImplementation(async (k: string) => {
      settingsMap.delete(k);
    });
    vi.spyOn(db.sales, 'toArray').mockResolvedValue(mockSales as any);
    vi.spyOn(db.sales, 'update').mockResolvedValue(1);
    vi.spyOn(db.inventory, 'toArray').mockResolvedValue([]);
    vi.spyOn(db.recipes, 'toArray').mockResolvedValue([]);
    vi.spyOn(db.expenses, 'toArray').mockResolvedValue([]);
    vi.spyOn(db.menu, 'toArray').mockResolvedValue([]);
    vi.spyOn(db.categories, 'toArray').mockResolvedValue([]);
    vi.spyOn(db.auditLogs, 'add').mockResolvedValue(1);
    vi.spyOn(db, 'transaction').mockImplementation((async (...args: any[]) => {
      const fn = args[args.length - 1];
      return fn();
    }) as any);

    const report = await buildShiftReport();
    expect(report.netCash).toBe(1000);
    expect(report.cardCollected).toBe(1000);
    expect(report.onlineCollected).toBe(500);
    // Opening 2000 + Net Cash 1000 = 3000
    expect(report.expectedDrawerCash).toBe(3000);

    const closed = await closeShift('cashier1', {
      countedCash: 2850,
      denominations: { '1000': 2, '500': 1, '100': 3, '50': 1 },
      note: 'Missing Rs 150 coin change',
    }, 'CASHIER');

    expect(closed.expectedDrawerCash).toBe(3000);
    expect(closed.countedCash).toBe(2850);
    expect(closed.variance).toBe(-150);
    expect(closed.cardCollected).toBe(1000);
    expect(closed.onlineCollected).toBe(500);
    expect(settingsMap.has('shiftOpeningCash')).toBe(false);
    expect(settingsMap.has(CLOSED_SHIFT_REPORTS_KEY)).toBe(true);

    const savedList = await getClosedShiftReports();
    expect(savedList).toHaveLength(1);
    expect(savedList[0].closedBy).toBe('cashier1');
  });
});
