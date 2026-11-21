import { describe, it, expect } from 'vitest';
import { composeModifiedItem, replaceCartLineModifiers } from '../src/lib/cart';
import { normalizePhone } from '../src/lib/customers';
import {
  collectModifierIngredientUsage,
  createStarterExtrasGroup,
  resolveDishModifierGroups,
  sanitizeModifierGroups,
} from '../src/lib/modifiers';
import { computeSaleLiveCost, computeShiftUsage } from '../src/lib/shift';
import type { CartItem, InventoryItem, MenuItem, ModifierGroup, Sale } from '../src/lib/db/types';

const zinger: MenuItem = { id: 'm1', categoryId: 'cat_burgers', name: 'Zinger Burger', price: 650 };

describe('composeModifiedItem', () => {
  it('adds option prices to the base price', () => {
    const line = composeModifiedItem(zinger, [
      { group: 'Size', name: 'Large', price: 200 },
      { group: 'Extras', name: 'Cheese', price: 80 },
    ]);
    expect(line.price).toBe(930);
    expect(line.name).toBe('Zinger Burger (Large, Cheese)');
    expect(line.qty).toBe(1);
  });

  it('keys the same combination identically regardless of pick order', () => {
    const a = composeModifiedItem(zinger, [
      { group: 'Size', name: 'Large', price: 200 },
      { group: 'Extras', name: 'Cheese', price: 80 },
    ]);
    const b = composeModifiedItem(zinger, [
      { group: 'Extras', name: 'Cheese', price: 80 },
      { group: 'Size', name: 'Large', price: 200 },
    ]);
    expect(a.id).toBe(b.id);
    expect(a.id).toBe('m1::Extras:Cheese|Size:Large');
  });

  it('keeps different combinations and kitchen notes as separate cart lines', () => {
    const large = composeModifiedItem(zinger, [{ group: 'Size', name: 'Large', price: 200 }]);
    const regular = composeModifiedItem(zinger, [{ group: 'Size', name: 'Regular', price: 0 }]);
    const noted = composeModifiedItem(zinger, [{ group: 'Size', name: 'Large', price: 200 }], 'No mayo');
    expect(large.id).not.toBe(regular.id);
    expect(noted.id).not.toBe(large.id);
    expect(noted.note).toBe('No mayo');
  });

  it('falls back to the plain id when nothing is selected and preserves inventory metadata', () => {
    expect(composeModifiedItem(zinger, [])).toMatchObject({ id: 'm1', name: 'Zinger Burger', price: 650 });
    const withInv = composeModifiedItem(zinger, [
      { group: 'Extras', name: 'Cheese Slice', price: 80, inventoryId: 'inv_cheese', qtyRequired: 1 },
    ]);
    expect(withInv.modifiers?.[0]).toMatchObject({ inventoryId: 'inv_cheese', qtyRequired: 1 });
  });
});

describe('modifier library resolution & cart line replacement', () => {
  const extras = createStarterExtrasGroup();
  const burgerSpice: ModifierGroup = {
    id: 'mod_spice',
    name: 'Spice Level',
    required: true,
    multiple: false,
    global: false,
    categoryIds: ['cat_burgers'],
    promptOnPick: true,
    options: [
      { name: 'Mild', price: 0 },
      { name: 'Spicy', price: 0 },
    ],
  };

  it('includes Starter Extras options (Olives, Cheese Slice, Extra Cheese, Jalapenos)', () => {
    expect(extras.options.map((o) => o.name)).toEqual([
      'Extra Olives',
      'Cheese Slice',
      'Extra Cheese',
      'Extra Jalapenos',
    ]);
    expect(extras.global).toBe(true);
    expect(extras.multiple).toBe(true);
  });

  it('resolves pick vs edit groups cleanly for global, category, and per-dish rules', () => {
    const pickGroups = resolveDishModifierGroups(zinger, [extras, burgerSpice], 'pick');
    expect(pickGroups.map((g) => g.name)).toEqual(['Spice Level']);

    const editGroups = resolveDishModifierGroups(zinger, [extras, burgerSpice], 'edit');
    expect(editGroups.map((g) => g.name)).toEqual(['Extras', 'Spice Level']);

    const fries: MenuItem = { id: 'm2', categoryId: 'cat_sides', name: 'Fries', price: 300 };
    expect(resolveDishModifierGroups(fries, [extras, burgerSpice], 'pick')).toEqual([]);
    expect(resolveDishModifierGroups(fries, [extras, burgerSpice], 'edit').map((g) => g.name)).toEqual(['Extras']);
  });

  it('supports apply-to-all, split-one, and duplicate merging when editing cart line modifiers', () => {
    const plainTwo: CartItem = { id: 'm1', menuItemId: 'm1', name: 'Zinger Burger', price: 650, qty: 2 };
    const extraCheese = composeModifiedItem(zinger, [{ group: 'Extras', name: 'Extra Cheese', price: 120 }]);

    // Split 1 unit off qty=2
    const splitCart = replaceCartLineModifiers([plainTwo], 'm1', extraCheese, true);
    expect(splitCart).toEqual([
      { ...plainTwo, qty: 1 },
      { ...extraCheese, qty: 1 },
    ]);

    // Apply same modifier to remaining plain unit -> merges into the existing Extra Cheese line!
    const mergedCart = replaceCartLineModifiers(splitCart, 'm1', extraCheese, false);
    expect(mergedCart).toEqual([{ ...extraCheese, qty: 2 }]);
  });

  it('sanitizes blank groups/options and computes modifier-linked live shift COGS', () => {
    const cleaned = sanitizeModifierGroups([
      {
        id: 'g1',
        name: ' Extras ',
        multiple: true,
        options: [
          { name: 'Cheese Slice', price: 80, inventoryId: 'inv_cheese', qtyRequired: 1 },
          { name: '   ', price: 50 },
        ],
      },
      { id: 'empty', name: '', options: [{ name: 'Ignored', price: 10 }] },
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].options).toEqual([
      { name: 'Cheese Slice', price: 80, inventoryId: 'inv_cheese', qtyRequired: 1 },
    ]);

    const inv: InventoryItem[] = [
      { id: 'inv_cheese', name: 'Cheese Slice', stock: 20, unit: 'pcs', cost: 45 },
    ];
    const saleLine = {
      ...composeModifiedItem(zinger, [
        { group: 'Extras', name: 'Cheese Slice', price: 80, inventoryId: 'inv_cheese', qtyRequired: 1 },
      ]),
      qty: 3,
      refundedQty: 1,
    };
    const sale = {
      id: 1,
      timestamp: new Date().toISOString(),
      orderType: 'DINE_IN',
      serverUser: 'owner',
      items: [saleLine],
      subtotal: 2190,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      total: 2190,
      payments: [{ method: 'Cash', amount: 2190 }],
    } as Sale;

    // 3 sold - 1 refunded = 2 effective units × 1 slice × Rs 45 = Rs 90
    expect(collectModifierIngredientUsage([saleLine], true).get('inv_cheese')).toBe(2);
    expect(computeSaleLiveCost(sale, [], new Map(inv.map((i) => [i.id, i])))).toBe(90);
    const usage = computeShiftUsage([sale], [], inv, {});
    expect(usage.consumedCost).toBe(90);
    expect(usage.ingredients[0]).toMatchObject({ name: 'Cheese Slice', qtyConsumed: 2, costConsumed: 90 });
  });
});

describe('normalizePhone', () => {
  it('accepts 5–15 digits and rejects anything else', () => {
    expect(normalizePhone('03001234567')).toBe('03001234567');
    expect(normalizePhone(' 03001234567 ')).toBe('03001234567');
    expect(normalizePhone('1234')).toBe('');
    expect(normalizePhone('0300-1234567')).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });
});
