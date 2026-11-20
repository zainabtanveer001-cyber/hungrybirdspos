import { describe, expect, it } from 'vitest';
import { compressImageFile, scaleImageDimensions } from '../src/lib/menu';
import { applyStockDelta } from '../src/lib/inventory';
import { computeSaleLiveCost, computeShiftUsage } from '../src/lib/shift';
import type { InventoryItem, Recipe, Sale } from '../src/lib/db/types';

describe('menu image upload & compression helpers', () => {
  it('keeps dimensions unchanged when within maxDimension', () => {
    expect(scaleImageDimensions(640, 480, 800)).toEqual({ width: 640, height: 480 });
  });

  it('scales down oversized landscape and portrait images preserving aspect ratio', () => {
    expect(scaleImageDimensions(1600, 1200, 800)).toEqual({ width: 800, height: 600 });
    expect(scaleImageDimensions(1000, 2000, 800)).toEqual({ width: 400, height: 800 });
  });

  it('rejects non-image files before reading', async () => {
    const fakeFile = { name: 'notes.txt', type: 'text/plain' } as unknown as File;
    await expect(compressImageFile(fakeFile)).rejects.toThrow('Please choose a valid image file.');
  });
});

describe('live shift inventory costing & manual stock deltas', () => {
  it('tracks manual stock reductions and offsets them on manual restock without going negative', () => {
    let deltas: Record<string, number> = {};
    deltas = applyStockDelta(deltas, 'inv_patty', -3);
    expect(deltas.inv_patty).toBe(3);

    // Correcting a -1 tap with +1 reduces manual consumption from 3 to 2
    deltas = applyStockDelta(deltas, 'inv_patty', 1);
    expect(deltas.inv_patty).toBe(2);

    // Adding 10 new units onto the shelf clears manual consumption to 0 (never negative)
    deltas = applyStockDelta(deltas, 'inv_patty', 10);
    expect(deltas.inv_patty).toBeUndefined();
  });

  it('dynamically updates shift consumed cost and P&L as inventory unit cost or stock changes', () => {
    const recipes: Recipe[] = [
      { menuItemId: 'm_burger', inventoryId: 'inv_patty', qtyRequired: 1 },
      { menuItemId: 'm_burger', inventoryId: 'inv_bun', qtyRequired: 1 },
    ];
    const sale: Sale = {
      id: 1,
      timestamp: '2026-11-21T10:00:00.000Z',
      orderType: 'DINE_IN',
      serverUser: 'owner',
      items: [
        {
          id: 'm_burger::Add-ons:Cheese',
          menuItemId: 'm_burger',
          name: 'Burger (Cheese)',
          price: 650,
          qty: 2,
        },
      ],
      subtotal: 1300,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      total: 1300,
      payments: [{ method: 'Cash', amount: 1300 }],
      totalReceived: 1300,
      totalChange: 0,
    };

    const initialInventory: InventoryItem[] = [
      { id: 'inv_patty', name: 'Chicken Patty', stock: 20, unit: 'pcs', cost: 150 },
      { id: 'inv_bun', name: 'Burger Bun', stock: 20, unit: 'pcs', cost: 30 },
    ];

    // 2 burgers = 2 patties (300) + 2 buns (60) = Rs 360
    const firstPass = computeShiftUsage([sale], recipes, initialInventory, {});
    expect(firstPass.consumedCost).toBe(360);

    // Mid-shift: owner updates patty cost from 150 -> 180 and records 1 manual patty reduction (-1)
    const updatedInventory: InventoryItem[] = [
      { id: 'inv_patty', name: 'Chicken Patty', stock: 17, unit: 'pcs', cost: 180 },
      { id: 'inv_bun', name: 'Burger Bun', stock: 18, unit: 'pcs', cost: 30 },
    ];
    const deltas = applyStockDelta({}, 'inv_patty', -1);

    // Live recalculation: (2 recipe + 1 manual) * 180 + 2 * 30 = 540 + 60 = Rs 600
    const secondPass = computeShiftUsage([sale], recipes, updatedInventory, deltas);
    expect(secondPass.consumedCost).toBe(600);
    expect(secondPass.manualCost).toBe(180);
    const pattyRow = secondPass.ingredients.find((r) => r.name === 'Chicken Patty');
    expect(pattyRow?.recipeQty).toBe(2);
    expect(pattyRow?.manualQty).toBe(1);
    expect(pattyRow?.qtyConsumed).toBe(3);
  });

  it('excludes refunded item quantities from live sale cost', () => {
    const recipes: Recipe[] = [{ menuItemId: 'm_burger', inventoryId: 'inv_patty', qtyRequired: 1 }];
    const inventoryById = new Map<string, InventoryItem>([
      ['inv_patty', { id: 'inv_patty', name: 'Chicken Patty', stock: 10, unit: 'pcs', cost: 200 }],
    ]);
    const partiallyRefundedSale: Sale = {
      id: 2,
      timestamp: '2026-11-21T11:00:00.000Z',
      orderType: 'DINE_IN',
      serverUser: 'owner',
      items: [{ id: 'm_burger', menuItemId: 'm_burger', name: 'Burger', price: 650, qty: 3, refundedQty: 1 }],
      subtotal: 1950,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      total: 1950,
      refundedAmount: 650,
      refundStatus: 'PARTIAL',
      payments: [{ method: 'Cash', amount: 1950 }],
      totalReceived: 1950,
      totalChange: 0,
    };

    expect(computeSaleLiveCost(partiallyRefundedSale, recipes, inventoryById)).toBe(400);
  });
});
