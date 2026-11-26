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

/** Normalizes weight text (supports `.` or `,` decimal separators) into positive kg rounded to 3 decimals. */
export function parseWeightInput(raw: string, unit: 'kg' | 'g' = 'kg'): number {
  const normalized = String(raw || '').trim().replace(',', '.');
  if (!normalized) return 0;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  const kg = unit === 'g' ? parsed / 1000 : parsed;
  return Math.round(kg * 1000) / 1000;
}

/** Formats kg weight cleanly without trailing zeroes (e.g. `2.4 kg`, `1 kg`). */
export function formatWeightKg(weightKg: number): string {
  const clean = Math.max(0, Number(weightKg) || 0);
  return `${Number(clean.toFixed(3))} kg`;
}

/** Compact weight badge form (e.g. `2.4kg`) for KOT, pills, and tight tables. */
export function formatWeightShort(weightKg: number): string {
  const clean = Math.max(0, Number(weightKg) || 0);
  return `${Number(clean.toFixed(3))}kg`;
}

/** Rounds weighted item amount (`weightKg * unitRate`) to nearest whole rupee, then adds flat modifiers. */
export function computeWeightedPrice(weightKg: number, unitRate: number, modifierSum = 0): number {
  const base = Math.round((Number(weightKg) || 0) * (Number(unitRate) || 0));
  return Math.max(0, base + (Number(modifierSum) || 0));
}

/**
 * Multiplier applied to base recipe ingredients: for weighed items returns sold kg
 * (`qty * weightKg`), otherwise returns unit count `qty`.
 */
export function recipeMultiplierForLine(line: CartItem, excludeRefunded = false): number {
  const effectiveQty = excludeRefunded
    ? Math.max(0, (Number(line.qty) || 0) - (Number(line.refundedQty) || 0))
    : Math.max(0, Number(line.qty) || 0);
  if (effectiveQty <= 0) return 0;
  const weight = Number(line.weightKg);
  return Number.isFinite(weight) && weight > 0 ? effectiveQty * weight : effectiveQty;
}

/** Builds a standalone weighted cart line (`qty: 1`) so multiple weighed portions remain separate lines. */
export function composeWeightedItem(
  item: MenuItem,
  weightKg: number,
  selections: ModifierSelection[] = [],
  note?: string,
  existingLineId?: string,
): CartItem {
  const cleanKg = Math.round((Number(weightKg) || 0) * 1000) / 1000;
  const unitRate = Number(item.price) || 0;
  const modSum = selections.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  const trimmedNote = (note || '').trim();
  const id =
    existingLineId ??
    `${item.id}::wt:${cleanKg}:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const line: CartItem = {
    id,
    menuItemId: item.id,
    name: selections.length ? `${item.name} (${selections.map((m) => m.name).join(', ')})` : item.name,
    price: computeWeightedPrice(cleanKg, unitRate, modSum),
    qty: 1,
    weightKg: cleanKg,
    unitRate,
    modifiers: selections.length ? selections : undefined,
  };
  if (item.categoryId) line.categoryId = item.categoryId;
  if (trimmedNote) line.note = trimmedNote;
  return line;
}

/** Recalculates an existing weighed cart line when its weight changes while preserving extras & note. */
export function updateCartLineWeight(items: CartItem[], lineId: string, weightKg: number): CartItem[] {
  const target = items.find((i) => i.id === lineId);
  if (!target) return items;
  if (weightKg <= 0) return items.filter((i) => i.id !== lineId);
  const cleanKg = Math.round(weightKg * 1000) / 1000;
  const modSum = (target.modifiers || []).reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  const unitRate = target.unitRate ?? Math.max(0, (Number(target.price) || 0) - modSum);
  return items.map((i) =>
    i.id === lineId
      ? {
          ...i,
          weightKg: cleanKg,
          unitRate,
          price: computeWeightedPrice(cleanKg, unitRate, modSum),
        }
      : i,
  );
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
  weightContext?: { weightKg: number; unitRate: number; lineId?: string },
): CartItem {
  if (weightContext && weightContext.weightKg > 0) {
    return composeWeightedItem(
      { ...item, price: weightContext.unitRate },
      weightContext.weightKg,
      selections,
      note,
      weightContext.lineId,
    );
  }
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
 * - Weighted lines always update in place so two weighed fish remain separate lines.
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

  if (target.weightKg && target.weightKg > 0) {
    return items.map((i) => (i.id === targetLineId ? { ...updatedLine, id: target.id, qty: 1 } : i));
  }

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
