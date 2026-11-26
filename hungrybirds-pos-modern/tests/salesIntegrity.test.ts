import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { adjustCustomerForRefund, reverseCustomerSale } from '../src/lib/customers';
import { restoreInventory, verifyStock } from '../src/lib/sales';
import type { CartItem, Customer, Sale } from '../src/lib/db/types';

describe('inventory restoration & customer CRM reversal integrity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores only unrefunded recipe and modifier quantities when voiding or reopening a partially refunded sale', async () => {
    const stock = new Map<string, number>([
      ['bun', 10],
      ['cheese', 10],
    ]);
    const recipes = [{ id: 1, menuItemId: 'burger', inventoryId: 'bun', qtyRequired: 1 }];

    vi.spyOn(db.recipes, 'where').mockImplementation((() => ({
      equals: (menuId: string) => ({
        toArray: async () => recipes.filter((r) => r.menuItemId === menuId),
      }),
    })) as any);
    vi.spyOn(db.inventory, 'get').mockImplementation(async (id: string) =>
      stock.has(id) ? ({ id, name: id, stock: stock.get(id)!, unit: 'pcs', cost: 10 } as any) : undefined,
    );
    vi.spyOn(db.inventory, 'update').mockImplementation(async (id: string, patch: any) => {
      stock.set(id, patch.stock);
      return 1;
    });

    const items: CartItem[] = [
      {
        id: 'burger::Extra Cheese',
        menuItemId: 'burger',
        name: 'Burger (Extra Cheese)',
        price: 550,
        qty: 3,
        refundedQty: 2,
        modifiers: [{ group: 'Extras', name: 'Extra Cheese', price: 50, inventoryId: 'cheese', qtyRequired: 1 }],
      },
    ];

    await restoreInventory(items);
    // 3 ordered - 2 already refunded = only 1 unit's recipe and modifier stock should return.
    expect(stock.get('bun')).toBe(11);
    expect(stock.get('cheese')).toBe(11);
  });

  it('telescopes customer spend, order count, and loyalty points back to exact baseline after partial refund and void', async () => {
    let stored: Customer = {
      id: '03001234567',
      phone: '03001234567',
      name: 'Ali',
      totalOrders: 1,
      totalSpent: 1000,
      loyaltyPoints: 18, // Started at 10, redeemed 2, earned 10 on Rs 1,000 sale.
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };

    vi.spyOn(db.customers, 'get').mockImplementation(async (phone: string) =>
      phone === stored.phone ? { ...stored } : undefined,
    );
    vi.spyOn(db.customers, 'put').mockImplementation(async (next: Customer) => {
      stored = { ...next };
      return next.id;
    });

    const baseSale: Sale = {
      id: 10,
      timestamp: '2026-11-24T12:00:00.000Z',
      orderType: 'DINE_IN',
      serverUser: 'cashier',
      customer: { phone: '03001234567', name: 'Ali' },
      items: [],
      subtotal: 1000,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      loyaltyRedeemPoints: 2,
      loyaltyDiscount: 2,
      total: 1000,
      payments: [{ method: 'Cash', amount: 1000 }],
      totalReceived: 1000,
      totalChange: 0,
    };

    // Partial refund of Rs 350 reduces net spend 1000 -> 650 (earned points drop 10 -> 6, clawback 4).
    await adjustCustomerForRefund(baseSale, 350);
    expect(stored.totalSpent).toBe(650);
    expect(stored.loyaltyPoints).toBe(14);

    // Later voiding the partially refunded sale reverses remaining 650 spend, 6 earned pts, and restores 2 redeemed pts.
    await reverseCustomerSale({ ...baseSale, refundedAmount: 350, refundStatus: 'PARTIAL' });
    expect(stored.totalOrders).toBe(0);
    expect(stored.totalSpent).toBe(0);
    expect(stored.loyaltyPoints).toBe(10);
  });

  it('scales recipe stock verification and restoration by weightKg while keeping modifier stock flat per fish', async () => {
    const stock = new Map<string, number>([
      ['raw_fish', 5],
      ['sauce_cup', 3],
    ]);
    const recipes = [{ id: 1, menuItemId: 'fish_1', inventoryId: 'raw_fish', qtyRequired: 1 }];

    vi.spyOn(db.recipes, 'where').mockImplementation((() => ({
      equals: (menuId: string) => ({
        toArray: async () => recipes.filter((r) => r.menuItemId === menuId),
      }),
    })) as any);
    vi.spyOn(db.inventory, 'get').mockImplementation(async (id: string) =>
      stock.has(id) ? ({ id, name: id, stock: stock.get(id)!, unit: 'kg', cost: 1000 } as any) : undefined,
    );
    vi.spyOn(db.inventory, 'update').mockImplementation(async (id: string, patch: any) => {
      stock.set(id, patch.stock);
      return 1;
    });

    const fishLine: CartItem = {
      id: 'fish_1::wt:2.4:1',
      menuItemId: 'fish_1',
      name: 'Grilled Fish (Garlic Sauce)',
      price: 4420,
      qty: 1,
      weightKg: 2.4,
      unitRate: 1800,
      modifiers: [{ group: 'Extras', name: 'Garlic Sauce', price: 100, inventoryId: 'sauce_cup', qtyRequired: 1 }],
    };

    // 2.4 kg needed <= 5 kg available -> passes
    expect(await verifyStock([fishLine])).toBeNull();
    // 6.0 kg needed > 5 kg available -> blocked
    expect(await verifyStock([{ ...fishLine, weightKg: 6 }])).toContain('raw_fish');

    // Void/reopen restores 2.4 kg raw_fish and 1 flat sauce_cup.
    await restoreInventory([fishLine]);
    expect(stock.get('raw_fish')).toBe(7.4);
    expect(stock.get('sauce_cup')).toBe(4);
  });
});
