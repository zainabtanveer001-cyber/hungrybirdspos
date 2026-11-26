import { describe, it, expect } from 'vitest';
import {
  addToCart,
  calculateCartTotals,
  cartItemCount,
  composeModifiedItem,
  composeWeightedItem,
  computeWeightedPrice,
  countCartByMenuId,
  decrementByMenuId,
  formatWeightKg,
  formatWeightShort,
  parseWeightInput,
  recipeMultiplierForLine,
  replaceCartLineModifiers,
  setQty,
  updateCartLineWeight,
} from '../src/lib/cart';
import type { CartItem, MenuItem } from '../src/lib/db/types';

const item = (id: string, price: number, qty = 1): CartItem => ({
  id, menuItemId: id, name: id, price, qty,
});

const charges = {
  orderType: 'DINE_IN' as const,
  discountPercent: 0,
  deliveryCharge: 0,
  packingCharge: 0,
  taxPercent: 0,
  otherCharge: 0,
  loyaltyPoints: 0,
};

describe('calculateCartTotals', () => {
  it('sums line items', () => {
    expect(calculateCartTotals([item('a', 650, 2), item('b', 1450)], charges).subtotal).toBe(2750);
  });

  it('applies discount, charges and tax in the app.js order', () => {
    const totals = calculateCartTotals([item('a', 1000)], {
      ...charges, discountPercent: 10, deliveryCharge: 100, packingCharge: 50, taxPercent: 5,
    });
    // (1000 - 100 + 0 + 50) * 1.05 — delivery only counts for DELIVERY orders
    expect(totals.taxAmount).toBeCloseTo(950 * 0.05);
    expect(totals.grandTotal).toBeCloseTo(997.5);
  });

  it('counts delivery charge only for DELIVERY orders', () => {
    expect(calculateCartTotals([item('a', 1000)], { ...charges, deliveryCharge: 200 }).deliveryCharge).toBe(0);
    expect(
      calculateCartTotals([item('a', 1000)], { ...charges, orderType: 'DELIVERY', deliveryCharge: 200 }).grandTotal,
    ).toBe(1200);
  });

  it('caps loyalty redemption at the discounted subtotal', () => {
    const totals = calculateCartTotals([item('a', 100)], { ...charges, loyaltyPoints: 500 });
    expect(totals.loyaltyDiscount).toBe(100);
    expect(totals.grandTotal).toBe(0);
  });

  it('never returns a negative total', () => {
    expect(calculateCartTotals([], charges).grandTotal).toBe(0);
  });
});

describe('cart mutations', () => {
  it('increments qty for a duplicate line', () => {
    expect(addToCart([item('a', 100)], item('a', 100))).toEqual([{ ...item('a', 100), qty: 2 }]);
  });

  it('removes a line when qty drops to zero', () => {
    expect(setQty([item('a', 100), item('b', 200)], 'a', 0)).toEqual([item('b', 200)]);
  });

  it('aggregates cart quantities per canonical menuItemId (including modified variants)', () => {
    const lines: CartItem[] = [
      { id: 'm1::Size:Large', menuItemId: 'm1', name: 'Burger (Large)', price: 750, qty: 2 },
      { id: 'm1::Size:Regular', menuItemId: 'm1', name: 'Burger (Regular)', price: 650, qty: 1 },
      { id: 'm2', menuItemId: 'm2', name: 'Cola', price: 150, qty: 3 },
    ];
    expect(countCartByMenuId(lines)).toEqual({ m1: 3, m2: 3 });
    expect(cartItemCount(lines)).toBe(6);
  });

  it('decrements plain items and removes them when qty reaches zero', () => {
    const start = [item('a', 100, 2), item('b', 200, 1)];
    const afterOne = decrementByMenuId(start, 'a');
    expect(afterOne).toEqual([item('a', 100, 1), item('b', 200, 1)]);
    const afterTwo = decrementByMenuId(afterOne, 'a');
    expect(afterTwo).toEqual([item('b', 200, 1)]);
    expect(decrementByMenuId(afterTwo, 'missing')).toEqual([item('b', 200, 1)]);
  });

  it('decrements the most recently added matching modified line first', () => {
    const lines: CartItem[] = [
      { id: 'm1::Spice:Mild', menuItemId: 'm1', name: 'Burger (Mild)', price: 650, qty: 2 },
      { id: 'm2', menuItemId: 'm2', name: 'Fries', price: 250, qty: 1 },
      { id: 'm1::Spice:Hot', menuItemId: 'm1', name: 'Burger (Hot)', price: 700, qty: 1 },
    ];
    const step1 = decrementByMenuId(lines, 'm1');
    expect(step1).toEqual([
      { id: 'm1::Spice:Mild', menuItemId: 'm1', name: 'Burger (Mild)', price: 650, qty: 2 },
      { id: 'm2', menuItemId: 'm2', name: 'Fries', price: 250, qty: 1 },
    ]);
    const step2 = decrementByMenuId(step1, 'm1');
    expect(step2).toEqual([
      { id: 'm1::Spice:Mild', menuItemId: 'm1', name: 'Burger (Mild)', price: 650, qty: 1 },
      { id: 'm2', menuItemId: 'm2', name: 'Fries', price: 250, qty: 1 },
    ]);
  });
});

describe('weight-based menu item helpers (per kg)', () => {
  const fish: MenuItem = {
    id: 'fish_1',
    categoryId: 'cat_bbq',
    name: 'Grilled Fish',
    price: 1800,
    soldByWeight: true,
  };

  it('normalizes comma and dot decimals in kg/g and formats weight labels cleanly', () => {
    expect(parseWeightInput('2,4', 'kg')).toBe(2.4);
    expect(parseWeightInput('2400', 'g')).toBe(2.4);
    expect(parseWeightInput('0', 'kg')).toBe(0);
    expect(parseWeightInput('-1.5', 'kg')).toBe(0);
    expect(parseWeightInput('abc', 'g')).toBe(0);
    expect(formatWeightKg(2.4)).toBe('2.4 kg');
    expect(formatWeightShort(2.4)).toBe('2.4kg');
    expect(formatWeightKg(1)).toBe('1 kg');
  });

  it('rounds weighted line totals to nearest whole rupee and adds flat modifiers per fish', () => {
    expect(computeWeightedPrice(2.4, 1800)).toBe(4320);
    expect(computeWeightedPrice(1.35, 1850)).toBe(2498); // 2497.5 -> 2498
    expect(computeWeightedPrice(2.4, 1800, 100)).toBe(4420); // flat Rs 100 sauce
  });

  it('keeps multiple weighed portions distinct, updates weight in place, and scales recipe multipliers', () => {
    const fishA = composeWeightedItem(fish, 2.4);
    const fishB = composeWeightedItem(fish, 1.8);
    expect(fishA.id).not.toBe(fishB.id);
    expect(fishA).toMatchObject({ qty: 1, weightKg: 2.4, unitRate: 1800, price: 4320 });
    expect(fishB).toMatchObject({ qty: 1, weightKg: 1.8, unitRate: 1800, price: 3240 });

    const cart = [fishA, fishB];
    expect(countCartByMenuId(cart)).toEqual({ fish_1: 2 });

    // Adding a flat Rs 100 modifier on fishA keeps fishB untouched and updates in place.
    const modifiedFishA = composeModifiedItem(
      fish,
      [{ group: 'Extras', name: 'Garlic Sauce', price: 100 }],
      'Extra crispy',
      { weightKg: 2.4, unitRate: 1800, lineId: fishA.id },
    );
    const withMod = replaceCartLineModifiers(cart, fishA.id, modifiedFishA);
    expect(withMod).toHaveLength(2);
    expect(withMod[0]).toMatchObject({ id: fishA.id, price: 4420, note: 'Extra crispy', weightKg: 2.4 });
    expect(withMod[1]).toMatchObject({ id: fishB.id, price: 3240, weightKg: 1.8 });

    // Editing fishA weight to 2.0 kg recalculates base price (3600) + preserved flat modifier (100).
    const reweighed = updateCartLineWeight(withMod, fishA.id, 2.0);
    expect(reweighed[0]).toMatchObject({ weightKg: 2, unitRate: 1800, price: 3700 });
    expect(recipeMultiplierForLine(reweighed[0])).toBe(2);
    expect(recipeMultiplierForLine({ ...reweighed[0], refundedQty: 1 }, true)).toBe(0);
  });
});
