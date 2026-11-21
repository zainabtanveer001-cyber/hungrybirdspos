import { describe, it, expect } from 'vitest';
import { addToCart, calculateCartTotals, cartItemCount, countCartByMenuId, decrementByMenuId, setQty } from '../src/lib/cart';
import type { CartItem } from '../src/lib/db/types';

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
