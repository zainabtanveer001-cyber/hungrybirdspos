import { db } from './db';
import { logAudit } from './audit';
import { pushInventory } from './sync';
import type { InventoryItem } from './db/types';

const THRESHOLD_KEY = 'lowStockThreshold';
const DEFAULT_THRESHOLD = 5;
export const SHIFT_STOCK_DELTAS_KEY = 'shiftStockDeltas';

/**
 * Pure helper: updates the active shift's net manual stock reduction map when an
 * ingredient's stock changes by `stockChange` (`newStock - oldStock`) outside of a sale.
 * - Negative `stockChange` (manual deduction / wastage) increases consumed quantity.
 * - Positive `stockChange` (manual addition) offsets any prior manual deduction in the
 *   same shift down to 0, without ever making consumed quantity negative.
 */
export function applyStockDelta(
  current: Record<string, number>,
  inventoryId: string,
  stockChange: number,
): Record<string, number> {
  const delta = Number(stockChange) || 0;
  if (!inventoryId || delta === 0) return { ...current };
  const prev = Number(current[inventoryId]) || 0;
  const nextQty = Math.max(0, Math.round((prev - delta) * 10000) / 10000);
  const next = { ...current };
  if (nextQty > 0) next[inventoryId] = nextQty;
  else delete next[inventoryId];
  return next;
}

export async function getShiftStockDeltas(): Promise<Record<string, number>> {
  const stored = await db.settings.get(SHIFT_STOCK_DELTAS_KEY);
  if (!stored?.value) return {};
  try {
    const parsed = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function recordShiftStockDelta(inventoryId: string, stockChange: number): Promise<void> {
  if (!inventoryId || !Number.isFinite(stockChange) || stockChange === 0) return;
  const current = await getShiftStockDeltas();
  const updated = applyStockDelta(current, inventoryId, stockChange);
  await db.settings.put({ key: SHIFT_STOCK_DELTAS_KEY, value: JSON.stringify(updated) });
}

export async function clearShiftStockDeltas(): Promise<void> {
  await db.settings.delete(SHIFT_STOCK_DELTAS_KEY);
}

export async function getLowStockThreshold(): Promise<number> {
  const stored = await db.settings.get(THRESHOLD_KEY);
  const value = stored ? Number(stored.value) : DEFAULT_THRESHOLD;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_THRESHOLD;
}

export async function setLowStockThreshold(value: number): Promise<void> {
  await db.settings.put({ key: THRESHOLD_KEY, value: String(value) });
}

export function newInventoryId(): string {
  return `INV_${Date.now()}`;
}

/** Clamps free-typed stock/cost, which come straight from number inputs. */
export function normalizeQuantity(value: string | number): number | null {
  const amount = parseFloat(String(value));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export async function adjustStock(item: InventoryItem, delta: number, user: string): Promise<void> {
  const prevStock = Number(item.stock) || 0;
  const updated = Math.max(0, prevStock + delta);
  const actualChange = updated - prevStock;
  await db.inventory.update(item.id, { stock: updated });
  await recordShiftStockDelta(item.id, actualChange);
  pushInventory(item.id);
  await logAudit('STOCK_ADJUST', `${delta > 0 ? 'Added' : 'Removed'} ${Math.abs(delta)} units of "${item.name}" (now ${updated})`, user);
}
