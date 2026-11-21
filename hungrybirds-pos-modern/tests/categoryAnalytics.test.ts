import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeCategoryBreakdown, computeSaleCategoryShares } from '../src/lib/categoryAnalytics';
import { getAnalytics, getPeriodSummary } from '../src/lib/analytics';
import { buildShiftReport } from '../src/lib/shift';
import { db } from '../src/lib/db';
import type { Category, MenuItem, Sale } from '../src/lib/db/types';

const categories: Category[] = [
  { id: 'cat_ff', name: 'Fast Food' },
  { id: 'cat_karahi', name: 'Karahi' },
  { id: 'cat_bbq', name: 'BBQ' },
  { id: 'cat_drinks', name: 'Drinks' },
  { id: 'cat_dessert', name: 'Desserts' },
];

const menu: MenuItem[] = [
  { id: 'm_zinger', categoryId: 'cat_ff', name: 'Zinger Burger', price: 600 },
  { id: 'm_karahi', categoryId: 'cat_karahi', name: 'Chicken Karahi', price: 1800 },
  { id: 'm_tikka', categoryId: 'cat_bbq', name: 'Chicken Tikka', price: 500 },
  { id: 'm_cola', categoryId: 'cat_drinks', name: 'Mint Margarita', price: 300 },
];

function makeSale(partial: Partial<Sale> & Pick<Sale, 'id' | 'items' | 'subtotal' | 'total'>): Sale {
  return {
    timestamp: new Date().toISOString(),
    orderType: 'DINE_IN',
    serverUser: 'owner',
    discountPercent: 0,
    discountAmount: 0,
    deliveryCharge: 0,
    packingCharge: 0,
    taxPercent: 0,
    taxAmount: 0,
    otherCharge: 0,
    payments: [{ method: 'Cash', amount: partial.total }],
    totalReceived: partial.total,
    totalChange: 0,
    ...partial,
  };
}

describe('category sales breakdown & analytics filtering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('distinguishes revenue, units sold, order counts, and % share across Fast Food, Karahi, BBQ, and Drinks', () => {
    const sales: Sale[] = [
      makeSale({
        id: 1,
        items: [
          { id: 'm_karahi', menuItemId: 'm_karahi', name: 'Chicken Karahi', price: 1800, qty: 1 },
          { id: 'm_cola', menuItemId: 'm_cola', name: 'Mint Margarita', price: 300, qty: 2 },
        ],
        subtotal: 2400,
        total: 2400,
      }),
      makeSale({
        id: 2,
        items: [
          { id: 'm_zinger', menuItemId: 'm_zinger', name: 'Zinger Burger', price: 600, qty: 2 },
          { id: 'm_tikka', menuItemId: 'm_tikka', name: 'Chicken Tikka', price: 500, qty: 1 },
        ],
        subtotal: 1700,
        total: 1700,
      }),
    ];

    const breakdown = computeCategoryBreakdown(sales, menu, categories);
    expect(breakdown.map((r) => [r.categoryName, r.netRevenue, r.unitsSold, r.orderCount])).toEqual([
      ['Karahi', 1800, 1, 1],
      ['Fast Food', 1200, 2, 1],
      ['Drinks', 600, 2, 1],
      ['BBQ', 500, 1, 1],
      ['Desserts', 0, 0, 0],
    ]);

    const totalShare = breakdown.reduce((sum, r) => sum + r.sharePercent, 0);
    expect(totalShare).toBeCloseTo(100, 0);
  });

  it('distributes order and loyalty discounts proportionally and excludes refunded item quantities', () => {
    const sale = makeSale({
      id: 3,
      items: [
        { id: 'm_karahi', menuItemId: 'm_karahi', name: 'Chicken Karahi', price: 1800, qty: 1 },
        { id: 'm_cola', menuItemId: 'm_cola', name: 'Mint Margarita', price: 300, qty: 4, refundedQty: 2 },
      ],
      // Original gross = 1800 + 4*300 = 3000; 10% discount (300) + Rs 300 loyalty = 600 discount (20% off)
      subtotal: 3000,
      discountPercent: 10,
      discountAmount: 300,
      loyaltyDiscount: 300,
      total: 2400,
      refundedAmount: 480,
      refundStatus: 'PARTIAL',
    });

    const menuById = new Map(menu.map((m) => [m.id, m]));
    const catNameById = new Map(categories.map((c) => [c.id, c.name]));
    const shares = computeSaleCategoryShares(sale, menuById, catNameById);

    // Multiplier = (3000 - 600) / 3000 = 0.8
    // Karahi: 1 * 1800 * 0.8 = 1440
    // Drinks: (4 - 2) * 300 * 0.8 = 480
    expect(shares).toEqual([
      { categoryId: 'cat_karahi', categoryName: 'Karahi', unitsSold: 1, grossRevenue: 1800, netRevenue: 1440 },
      { categoryId: 'cat_drinks', categoryName: 'Drinks', unitsSold: 2, grossRevenue: 600, netRevenue: 480 },
    ]);

    // Full refund removes order from category totals completely
    const fullRefund = makeSale({
      id: 4,
      items: [{ id: 'm_zinger', menuItemId: 'm_zinger', name: 'Zinger', price: 600, qty: 2, refundedQty: 2 }],
      subtotal: 1200,
      total: 1200,
      refundedAmount: 1200,
      refundStatus: 'FULL',
    });
    expect(computeSaleCategoryShares(fullRefund, menuById, catNameById)).toEqual([]);
  });

  it('preserves historical category snapshot on CartItem even after dish or category deletion', () => {
    const legacyDeletedDishSale = makeSale({
      id: 5,
      items: [
        {
          id: 'old_dish',
          menuItemId: 'old_dish',
          name: 'Special Platter',
          price: 2200,
          qty: 1,
          categoryId: 'cat_old',
          categoryName: 'Seasonal BBQ',
        },
      ],
      subtotal: 2200,
      total: 2200,
    });

    const breakdown = computeCategoryBreakdown([legacyDeletedDishSale], [], []);
    expect(breakdown).toEqual([
      {
        categoryId: 'cat_old',
        categoryName: 'Seasonal BBQ',
        unitsSold: 1,
        orderCount: 1,
        grossRevenue: 2200,
        netRevenue: 2200,
        sharePercent: 100,
      },
    ]);
  });

  it('filters Sales Analytics, Period Summary, and Shift Report accurately by category', async () => {
    const nowIso = new Date().toISOString();
    const mockSales: Sale[] = [
      makeSale({
        id: 10,
        timestamp: nowIso,
        items: [
          { id: 'm_karahi', menuItemId: 'm_karahi', name: 'Chicken Karahi', price: 1800, qty: 1 },
          { id: 'm_cola', menuItemId: 'm_cola', name: 'Mint Margarita', price: 300, qty: 2 },
        ],
        subtotal: 2400,
        total: 2400,
        customer: { name: 'Ali', phone: '03001112233' },
      }),
      makeSale({
        id: 11,
        timestamp: nowIso,
        items: [{ id: 'm_zinger', menuItemId: 'm_zinger', name: 'Zinger Burger', price: 600, qty: 2 }],
        subtotal: 1200,
        total: 1200,
      }),
    ];

    vi.spyOn(db.sales, 'toArray').mockResolvedValue(mockSales);
    vi.spyOn(db.customers, 'toArray').mockResolvedValue([]);
    vi.spyOn(db.menu, 'toArray').mockResolvedValue(menu);
    vi.spyOn(db.categories, 'toArray').mockResolvedValue(categories);
    vi.spyOn(db.inventory, 'toArray').mockResolvedValue([]);
    vi.spyOn(db.recipes, 'toArray').mockResolvedValue([]);
    vi.spyOn(db.expenses, 'toArray').mockResolvedValue([]);
    vi.spyOn(db.settings, 'get').mockImplementation(async (key: string) =>
      key === 'shiftStartTime'
        ? { key: 'shiftStartTime', value: new Date(Date.now() - 3_600_000).toISOString() }
        : undefined,
    );

    const drinksAnalytics = await getAnalytics('day', 'cat_drinks');
    expect(drinksAnalytics.orderCount).toBe(1);
    expect(drinksAnalytics.buckets.reduce((s, b) => s + b.amount, 0)).toBe(600);
    expect(drinksAnalytics.topItems).toEqual([{ name: 'Mint Margarita', metric: 2, detail: 600 }]);
    expect(drinksAnalytics.topCustomers).toEqual([{ name: 'Ali', metric: 1, detail: 600 }]);
    expect(drinksAnalytics.categoryBreakdown.find((c) => c.categoryId === 'cat_karahi')?.netRevenue).toBe(1800);

    const drinksPeriod = await getPeriodSummary('cat_drinks');
    expect(drinksPeriod.todaySales).toBe(600);
    expect(drinksPeriod.todayCount).toBe(1);
    expect(drinksPeriod.totalOverallSales).toBe(600);

    const shiftReport = await buildShiftReport();
    expect(shiftReport.categorySales.find((c) => c.categoryId === 'cat_karahi')?.netRevenue).toBe(1800);
    expect(shiftReport.categorySales.find((c) => c.categoryId === 'cat_ff')?.netRevenue).toBe(1200);
    expect(shiftReport.categorySales.find((c) => c.categoryId === 'cat_drinks')?.netRevenue).toBe(600);
  });
});
