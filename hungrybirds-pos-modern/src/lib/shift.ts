import { db } from './db';
import { logAudit } from './audit';
import { clearShiftStockDeltas, getShiftStockDeltas } from './inventory';
import { collectModifierIngredientUsage } from './modifiers';
import { isApproved } from './suppliers';
import type { Expense, InventoryItem, Recipe, Sale } from './db/types';

const SHIFT_START = 'shiftStartTime';
const OPENING_CASH = 'shiftOpeningCash';
export const CLOSED_SHIFT_MANUAL_COSTS_KEY = 'closedShiftManualCosts';
export const CLOSED_SHIFT_REPORTS_KEY = 'closedShiftReports';

export const PKR_DENOMINATIONS = [5000, 1000, 500, 100, 50, 20, 10] as const;

export interface ClosedShiftManualCost {
  closedAt: string;
  cost: number;
}

export interface BlindCloseInput {
  countedCash: number;
  denominations?: Record<string, number>;
  looseCoins?: number;
  note?: string;
}

export interface ClosedShiftRecord {
  id: string;
  startedAt: string;
  closedAt: string;
  closedBy: string;
  role?: string;
  openingCash: number;
  expectedDrawerCash: number;
  countedCash: number;
  variance: number;
  netCash: number;
  cardCollected: number;
  onlineCollected: number;
  totalSales: number;
  orderCount: number;
  denominations?: Record<string, number>;
  looseCoins?: number;
  note?: string;
}

function roundTwo(value: number): number {
  const clean = Number(value);
  if (!Number.isFinite(clean)) return 0;
  return Math.round(clean * 100) / 100;
}

/** Sums PKR note counts across denominations plus optional loose coins. */
export function computeDenominationTotal(
  counts: Record<string, number>,
  looseCoins = 0,
): number {
  let total = Math.max(0, roundTwo(looseCoins));
  for (const denom of PKR_DENOMINATIONS) {
    const qty = Math.max(0, Math.floor(Number(counts[String(denom)]) || 0));
    total = roundTwo(total + qty * denom);
  }
  return total;
}

/** Computes drawer cash variance (`counted - expected`) and status without FP drift. */
export function computeDrawerVariance(
  expectedDrawerCash: number,
  countedCash: number,
): { variance: number; status: 'EXACT' | 'OVER' | 'SHORT' } {
  const variance = roundTwo(roundTwo(countedCash) - roundTwo(expectedDrawerCash));
  if (variance > 0) return { variance, status: 'OVER' };
  if (variance < 0) return { variance, status: 'SHORT' };
  return { variance: 0, status: 'EXACT' };
}

export async function getClosedShiftReports(): Promise<ClosedShiftRecord[]> {
  const stored = await db.settings.get(CLOSED_SHIFT_REPORTS_KEY);
  if (!stored?.value) return [];
  try {
    const parsed = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
    return Array.isArray(parsed) ? (parsed as ClosedShiftRecord[]) : [];
  } catch {
    return [];
  }
}

export async function getClosedShiftManualCosts(): Promise<ClosedShiftManualCost[]> {
  const stored = await db.settings.get(CLOSED_SHIFT_MANUAL_COSTS_KEY);
  if (!stored?.value) return [];
  try {
    const parsed = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
    return Array.isArray(parsed) ? (parsed as ClosedShiftManualCost[]) : [];
  } catch {
    return [];
  }
}

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/** Initializes `shiftStartTime` once during app startup (outside Dexie `liveQuery`). */
export async function ensureShiftStart(): Promise<string> {
  const stored = await db.settings.get(SHIFT_START);
  if (stored?.value) return String(stored.value);
  const start = startOfTodayIso();
  await db.settings.put({ key: SHIFT_START, value: start });
  return start;
}

/**
 * Strictly read-only: safe to call inside Dexie `liveQuery` callbacks (never writes
 * to IndexedDB, avoiding `ReadOnlyError` on fresh installs).
 */
export async function getShiftStart(): Promise<string> {
  const stored = await db.settings.get(SHIFT_START);
  if (stored?.value) return String(stored.value);
  return startOfTodayIso();
}

export async function getOpeningCash(): Promise<number> {
  const stored = await db.settings.get(OPENING_CASH);
  const value = stored ? Number(stored.value) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function setOpeningCash(amount: number): Promise<number> {
  const value = Math.max(0, Number(amount) || 0);
  await db.settings.put({ key: OPENING_CASH, value: String(value) });
  return value;
}

export interface IngredientUsage {
  name: string;
  unit: string;
  recipeQty: number;
  manualQty: number;
  qtyConsumed: number;
  costPerUnit: number;
  costConsumed: number;
}

/**
 * Computes a single sale's ingredient cost at the current live inventory unit prices.
 * Excludes refunded quantities (`qty - refundedQty`) that were returned to stock.
 */
export function computeSaleLiveCost(
  sale: Sale,
  recipes: Recipe[],
  inventoryById: Map<string, InventoryItem>,
): number {
  let cost = 0;
  for (const line of sale.items || []) {
    const effectiveQty = Math.max(0, (Number(line.qty) || 0) - (Number(line.refundedQty) || 0));
    if (effectiveQty <= 0) continue;
    const itemId = line.menuItemId || line.id;
    for (const recipe of recipes) {
      if (recipe.menuItemId !== itemId) continue;
      const item = inventoryById.get(recipe.inventoryId);
      const unitCost = Number(item?.cost) || 0;
      cost += (Number(recipe.qtyRequired) || 0) * effectiveQty * unitCost;
    }
  }
  for (const [inventoryId, modQty] of collectModifierIngredientUsage(sale.items || [], true)) {
    const item = inventoryById.get(inventoryId);
    const unitCost = Number(item?.cost) || 0;
    cost += modQty * unitCost;
  }
  return cost;
}

/**
 * Aggregates live ingredient usage and cost across shift sales and net manual stock
 * reductions during the active shift, priced at each ingredient's current unit cost.
 */
export function computeShiftUsage(
  shiftSales: Sale[],
  recipes: Recipe[],
  inventory: InventoryItem[],
  manualDeltas: Record<string, number> = {},
): { ingredients: IngredientUsage[]; consumedCost: number; manualCost: number } {
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const usage = new Map<string, IngredientUsage>();
  let consumedCost = 0;
  let manualCost = 0;

  const ensureRow = (inventoryId: string): IngredientUsage => {
    const existing = usage.get(inventoryId);
    if (existing) return existing;
    const item = inventoryById.get(inventoryId);
    const row: IngredientUsage = {
      name: item?.name || inventoryId,
      unit: item?.unit || '',
      recipeQty: 0,
      manualQty: 0,
      qtyConsumed: 0,
      costPerUnit: Number(item?.cost) || 0,
      costConsumed: 0,
    };
    usage.set(inventoryId, row);
    return row;
  };

  for (const sale of shiftSales) {
    for (const line of sale.items || []) {
      const effectiveQty = Math.max(0, (Number(line.qty) || 0) - (Number(line.refundedQty) || 0));
      if (effectiveQty <= 0) continue;
      const itemId = line.menuItemId || line.id;
      for (const recipe of recipes.filter((r) => r.menuItemId === itemId)) {
        const row = ensureRow(recipe.inventoryId);
        const qty = (Number(recipe.qtyRequired) || 0) * effectiveQty;
        row.recipeQty += qty;
        row.qtyConsumed += qty;
        const addedCost = qty * row.costPerUnit;
        row.costConsumed += addedCost;
        consumedCost += addedCost;
      }
    }
    for (const [inventoryId, modQty] of collectModifierIngredientUsage(sale.items || [], true)) {
      const row = ensureRow(inventoryId);
      row.recipeQty += modQty;
      row.qtyConsumed += modQty;
      const addedCost = modQty * row.costPerUnit;
      row.costConsumed += addedCost;
      consumedCost += addedCost;
    }
  }

  for (const [inventoryId, rawManualQty] of Object.entries(manualDeltas)) {
    const manualQty = Math.max(0, Number(rawManualQty) || 0);
    if (manualQty <= 0) continue;
    const row = ensureRow(inventoryId);
    row.manualQty += manualQty;
    row.qtyConsumed += manualQty;
    const addedCost = manualQty * row.costPerUnit;
    row.costConsumed += addedCost;
    consumedCost += addedCost;
    manualCost += addedCost;
  }

  return { ingredients: [...usage.values()], consumedCost, manualCost };
}

/**
 * Ends the shift: snapshots (locks) current ingredient costs onto the shift's sales
 * and manual stock usage so future inventory price edits only affect new shifts,
 * records the closed shift cash drawer variance (for blind closes & audits),
 * then resets the shift start time and opening cash.
 */
export async function closeShift(
  user: string,
  blindInput?: BlindCloseInput,
  role?: string,
): Promise<ClosedShiftRecord> {
  const now = new Date().toISOString();
  const [report, sales, inventory, recipes, stockDeltas, closedManual, existingReports] = await Promise.all([
    buildShiftReport(),
    db.sales.toArray(),
    db.inventory.toArray(),
    db.recipes.toArray(),
    getShiftStockDeltas(),
    getClosedShiftManualCosts(),
    getClosedShiftReports(),
  ]);

  const from = new Date(report.startedAt).getTime();
  const shiftSales = sales.filter((s: Sale) => new Date(s.timestamp).getTime() >= from);
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const { manualCost } = computeShiftUsage(shiftSales, recipes, inventory, stockDeltas);

  const countedCash =
    blindInput?.countedCash !== undefined
      ? Math.max(0, roundTwo(blindInput.countedCash))
      : roundTwo(report.expectedDrawerCash);
  const { variance } = computeDrawerVariance(report.expectedDrawerCash, countedCash);

  const record: ClosedShiftRecord = {
    id: `SHIFT_${Date.now()}`,
    startedAt: report.startedAt,
    closedAt: now,
    closedBy: user,
    role,
    openingCash: roundTwo(report.openingCash),
    expectedDrawerCash: roundTwo(report.expectedDrawerCash),
    countedCash,
    variance,
    netCash: roundTwo(report.netCash),
    cardCollected: roundTwo(report.cardCollected),
    onlineCollected: roundTwo(report.onlineCollected),
    totalSales: roundTwo(report.totalSales),
    orderCount: report.orderCount,
    denominations: blindInput?.denominations,
    looseCoins: blindInput?.looseCoins ? Math.max(0, roundTwo(blindInput.looseCoins)) : undefined,
    note: blindInput?.note?.trim() || undefined,
  };

  await db.transaction('rw', db.sales, db.settings, async () => {
    for (const sale of shiftSales) {
      if (sale.id != null && sale.lockedCost === undefined) {
        const lockedCost = computeSaleLiveCost(sale, recipes, inventoryById);
        await db.sales.update(sale.id, { lockedCost });
      }
    }
    if (manualCost > 0) {
      await db.settings.put({
        key: CLOSED_SHIFT_MANUAL_COSTS_KEY,
        value: JSON.stringify([...closedManual, { closedAt: now, cost: manualCost }]),
      });
    }
    await db.settings.put({
      key: CLOSED_SHIFT_REPORTS_KEY,
      value: JSON.stringify([record, ...existingReports].slice(0, 50)),
    });
    await clearShiftStockDeltas();
    await db.settings.put({ key: SHIFT_START, value: now });
    await db.settings.delete(OPENING_CASH);
  });

  await logAudit(
    'SHIFT_CLOSE',
    `Shift closed by ${user}: counted ${countedCash}, expected ${roundTwo(report.expectedDrawerCash)}, variance ${variance >= 0 ? `+${variance}` : variance}`,
    user,
  );
  return record;
}

export interface ShiftReport {
  startedAt: string;
  openingCash: number;
  totalSales: number;
  orderCount: number;
  packingCharges: number;
  tax: number;
  otherCharges: number;
  dineIn: number;
  takeaway: number;
  delivery: number;
  cashCollected: number;
  changeGiven: number;
  netCash: number;
  cardCollected: number;
  onlineCollected: number;
  expectedDrawerCash: number;
  discountsByStaff: Array<{ user: string; amount: number }>;
  totalDiscounts: number;
  discountedOrderCount: number;
  ingredients: IngredientUsage[];
  consumedCost: number;
  grossProfit: number;
  shiftExpenses: number;
  netProfit: number;
}

export async function buildShiftReport(): Promise<ShiftReport> {
  const [startedAt, openingCash, sales, inventory, recipes, expenses, stockDeltas] = await Promise.all([
    getShiftStart(),
    getOpeningCash(),
    db.sales.toArray(),
    db.inventory.toArray(),
    db.recipes.toArray(),
    db.expenses.toArray(),
    getShiftStockDeltas(),
  ]);

  const from = new Date(startedAt).getTime();
  const shiftSales = sales.filter((s: Sale) => new Date(s.timestamp).getTime() >= from);
  const sum = (pick: (sale: Sale) => number) => shiftSales.reduce((total, sale) => total + pick(sale), 0);

  const totalSales = sum((s) => Math.max(0, (Number(s.total) || 0) - (Number(s.refundedAmount) || 0)));
  const cashCollected = sum((sale) =>
    (sale.payments || []).reduce((total, payment) => {
      if ((payment.method || 'Cash') !== 'Cash') return total;
      return total + (Number(payment.cashGiven ?? payment.amount ?? 0) || 0);
    }, 0),
  );
  const changeGiven = sum((s) => Number(s.totalChange) || 0);
  const cardCollected = sum((sale) =>
    (sale.payments || []).reduce((total, payment) => {
      if (payment.method !== 'Card') return total;
      return total + (Number(payment.amount) || 0);
    }, 0),
  );
  const onlineCollected = sum((sale) =>
    (sale.payments || []).reduce((total, payment) => {
      if (payment.method !== 'Online') return total;
      return total + (Number(payment.amount) || 0);
    }, 0),
  );

  const staffDiscounts = new Map<string, number>();
  let totalDiscounts = 0;
  let discountedOrderCount = 0;
  for (const sale of shiftSales) {
    const amount = Number(sale.discountAmount) || ((Number(sale.subtotal) || 0) * (Number(sale.discountPercent) || 0)) / 100;
    totalDiscounts += amount;
    if (amount <= 0) continue;
    discountedOrderCount++;
    const user = sale.serverUser || 'Staff';
    staffDiscounts.set(user, (staffDiscounts.get(user) || 0) + amount);
  }

  const { ingredients, consumedCost } = computeShiftUsage(shiftSales, recipes, inventory, stockDeltas);
  const shiftExpenses = expenses
    .filter((e: Expense) => isApproved(e) && new Date(e.timestamp).getTime() >= from)
    .reduce((total, e) => total + (Number(e.amount) || 0), 0);
  const grossProfit = totalSales - consumedCost;
  const netProfit = grossProfit - shiftExpenses;

  return {
    startedAt,
    openingCash,
    totalSales,
    orderCount: shiftSales.length,
    packingCharges: sum((s) => Number(s.packingCharge) || 0),
    tax: sum((s) => Number(s.taxAmount) || 0),
    otherCharges: sum((s) => Number(s.otherCharge) || 0),
    dineIn: sum((s) => (s.orderType === 'DINE_IN' ? Math.max(0, (Number(s.total) || 0) - (Number(s.refundedAmount) || 0)) : 0)),
    takeaway: sum((s) => (s.orderType === 'TAKEAWAY' ? Math.max(0, (Number(s.total) || 0) - (Number(s.refundedAmount) || 0)) : 0)),
    delivery: sum((s) => (s.orderType === 'DELIVERY' ? Math.max(0, (Number(s.total) || 0) - (Number(s.refundedAmount) || 0)) : 0)),
    cashCollected,
    changeGiven,
    netCash: cashCollected - changeGiven,
    cardCollected,
    onlineCollected,
    expectedDrawerCash: openingCash + cashCollected - changeGiven,
    discountsByStaff: [...staffDiscounts].map(([user, amount]) => ({ user, amount })),
    totalDiscounts,
    discountedOrderCount,
    ingredients,
    consumedCost,
    grossProfit,
    shiftExpenses,
    netProfit,
  };
}
