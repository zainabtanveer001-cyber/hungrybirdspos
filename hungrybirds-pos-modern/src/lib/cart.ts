import type { CartItem, MenuItem, ModifierSelection, OrderType } from './db/types';
import { normalizeCharge, roundAmount } from './format';

export const LOYALTY_POINT_VALUE = 1;

export interface CartCharges {
  orderType: OrderType;
  tableNumber?: string;
  discountPercent: number;
  deliveryCharge: number;
  packingCharge: number;
  taxPercent: number;
  otherCharge: number;
  loyaltyPoints: number;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  deliveryCharge: number;
  packingCharge: number;
  otherCharge: number;
  taxAmount: number;
  loyaltyDiscount: number;
  grandTotal: number;
}

export function calculateCartTotals(items: CartItem[], charges: CartCharges): CartTotals {
  const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const discountAmount = subtotal * (charges.discountPercent / 100);
  const deliveryCharge = charges.orderType === 'DELIVERY' ? normalizeCharge(charges.deliveryCharge) : 0;
  const packingCharge = normalizeCharge(charges.packingCharge);
  const otherCharge = normalizeCharge(charges.otherCharge);
  const taxableAmount = subtotal - discountAmount + deliveryCharge + packingCharge + otherCharge;
  const taxAmount = taxableAmount * (charges.taxPercent / 100);
  const loyaltyDiscount = Math.min(
    (Number(charges.loyaltyPoints) || 0) * LOYALTY_POINT_VALUE,
    Math.max(0, subtotal - discountAmount),
  );
  const grandTotal = roundAmount(Math.max(0, taxableAmount + taxAmount - loyaltyDiscount));

  return { subtotal, discountAmount, deliveryCharge, packingCharge, otherCharge, taxAmount, loyaltyDiscount, grandTotal };
}

/** Adds a menu item or increments its qty if already in the cart. */
export function addToCart(items: CartItem[], item: CartItem): CartItem[] {
  const existing = items.find((i) => i.id === item.id);
  if (existing) {
    return items.map((i) => (i.id === item.id ? { ...i, qty: i.qty + 1 } : i));
  }
  return [...items, item];
}

export function setQty(items: CartItem[], id: string, qty: number): CartItem[] {
  if (qty <= 0) return items.filter((i) => i.id !== id);
  return items.map((i) => (i.id === id ? { ...i, qty } : i));
}

/**
 * Decrements the most recently added cart line matching `menuItemId` by 1,
 * removing that line if its quantity drops to 0.
 */
export function decrementByMenuId(items: CartItem[], menuItemId: string): CartItem[] {
  let targetIndex = -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if ((items[i].menuItemId || items[i].id) === menuItemId) {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) return items;
  const target = items[targetIndex];
  if (target.qty <= 1) {
    return items.filter((_, idx) => idx !== targetIndex);
  }
  return items.map((item, idx) => (idx === targetIndex ? { ...item, qty: item.qty - 1 } : item));
}

/** Sums cart quantities by canonical `menuItemId` (merging modified variants of the same dish). */
export function countCartByMenuId(items: CartItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = item.menuItemId || item.id;
    counts[key] = (counts[key] || 0) + (Number(item.qty) || 0);
  }
  return counts;
}

/** Total unit count across all lines in the cart. */
export function cartItemCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}

/**
 * Builds the cart line for a customized menu item. The id embeds the sorted
 * selection (and optional kitchen note) so identical customizations merge into
 * one line while different combinations stay separate.
 */
export function composeModifiedItem(
  item: MenuItem,
  selections: ModifierSelection[],
  note?: string,
): CartItem {
  const key = selections.map((m) => `${m.group}:${m.name}`).sort().join('|');
  const trimmedNote = (note || '').trim();
  const baseId = key ? `${item.id}::${key}` : item.id;
  const id = trimmedNote ? `${baseId}::note:${trimmedNote}` : baseId;
  const line: CartItem = {
    id,
    menuItemId: item.id,
    name: selections.length ? `${item.name} (${selections.map((m) => m.name).join(', ')})` : item.name,
    price: (Number(item.price) || 0) + selections.reduce((sum, m) => sum + (Number(m.price) || 0), 0),
    qty: 1,
    modifiers: selections.length ? selections : undefined,
  };
  if (item.categoryId) line.categoryId = item.categoryId;
  if (trimmedNote) line.note = trimmedNote;
  return line;
}

/**
 * Replaces a cart line with updated modifiers/note.
 * - When `splitOne` is true and the target line has `qty > 1`, decrements the target
 *   by 1 and adds/merges 1 unit of `updatedLine`.
 * - Otherwise applies the updated modifiers to the entire target line's quantity,
 *   merging into an existing identical line if one is already present.
 */
export function replaceCartLineModifiers(
  items: CartItem[],
  targetLineId: string,
  updatedLine: CartItem,
  splitOne = false,
): CartItem[] {
  const target = items.find((i) => i.id === targetLineId);
  if (!target) return items;

  if (splitOne && target.qty > 1) {
    const decremented = items.map((i) => (i.id === targetLineId ? { ...i, qty: i.qty - 1 } : i));
    const existing = decremented.find((i) => i.id === updatedLine.id);
    if (existing) {
      return decremented.map((i) => (i.id === updatedLine.id ? { ...i, qty: i.qty + 1 } : i));
    }
    return [...decremented, { ...updatedLine, qty: 1 }];
  }

  const nextQty = target.qty;
  const withoutTarget = items.filter((i) => i.id !== targetLineId);
  const duplicate = withoutTarget.find((i) => i.id === updatedLine.id);
  if (duplicate) {
    return withoutTarget.map((i) =>
      i.id === updatedLine.id ? { ...i, qty: i.qty + nextQty } : i,
    );
  }

  return items.map((i) => (i.id === targetLineId ? { ...updatedLine, qty: nextQty } : i));
}
