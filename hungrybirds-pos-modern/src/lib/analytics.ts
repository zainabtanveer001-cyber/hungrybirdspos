import { db } from './db';
import { getShiftStockDeltas } from './inventory';
import { computeSaleLiveCost, getClosedShiftManualCosts, getShiftStart } from './shift';
import { isApproved } from './suppliers';
import {
  computeCategoryBreakdown,
  computeSaleCategoryShares,
  computeSaleNetMultiplier,
  resolveLineCategory,
} from './categoryAnalytics';
import type { CategorySalesRow, SaleCategoryShare } from './categoryAnalytics';
import type { Expense, Sale } from './db/types';

export type { CategorySalesRow, SaleCategoryShare };
export { computeCategoryBreakdown, computeSaleCategoryShares, resolveLineCategory };

export type Period = 'day' | 'week' | 'month';

export interface PeriodSummary {
  todaySales: number;
  todayCount: number;
  weekSales: number;
  weekCount: number;
  weekDiscounts: number;
  monthSales: number;
  monthCount: number;
  monthDiscounts: number;
  totalOverallSales: number;
  totalCount: number;
  totalDiscounts: number;
}

const amount = (sale: Sale) => Number(sale.total) || 0;

export async function getPeriodSummary(categoryId?: string): Promise<PeriodSummary> {
  const [sales, menu, categories] = await Promise.all([
    db.sales.toArray(),
    categoryId ? Promise.resolve().then(() => db.menu.toArray()).catch(() => []) : Promise.resolve([]),
    categoryId ? Promise.resolve().then(() => db.categories.toArray()).catch(() => []) : Promise.resolve([]),
  ]);
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekday = new Date(startOfDay).getDay();
  const startOfWeek = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (weekday === 0 ? 6 : weekday - 1),
  ).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const summary: PeriodSummary = {
    todaySales: 0, todayCount: 0,
    weekSales: 0, weekCount: 0, weekDiscounts: 0,
    monthSales: 0, monthCount: 0, monthDiscounts: 0,
    totalOverallSales: 0, totalCount: 0, totalDiscounts: 0,
  };

  for (const sale of sales) {
    const at = new Date(sale.timestamp).getTime();
    if (!Number.isFinite(at)) continue;

    let total = Math.max(0, amount(sale) - (Number(sale.refundedAmount) || 0));
    let discount = Number(sale.discountAmount) || 0;

    if (categoryId) {
      const share = computeSaleCategoryShares(sale, menuById, categoryNameById).find(
        (s) => s.categoryId === categoryId,
      );
      if (!share || share.unitsSold <= 0) continue;
      total = share.netRevenue;
      discount = Math.max(0, Math.round((share.grossRevenue - share.netRevenue) * 100) / 100);
    }

    summary.totalOverallSales += total;
    summary.totalDiscounts += discount;
    summary.totalCount++;
    if (at >= startOfDay) {
      summary.todaySales += total;
      summary.todayCount++;
    }
    if (at >= startOfWeek) {
      summary.weekSales += total;
      summary.weekDiscounts += discount;
      summary.weekCount++;
    }
    if (at >= startOfMonth) {
      summary.monthSales += total;
      summary.monthDiscounts += discount;
      summary.monthCount++;
    }
  }
  return summary;
}

export interface Bucket {
  start: number;
  end: number;
  label: string;
  amount: number;
  orders: number;
}

/** Hourly buckets for today, daily buckets for this week or this month. */
export function getBuckets(period: Period, now = new Date()): { buckets: Bucket[]; caption: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hourly = period === 'day';
  const days = period === 'month' ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() : 7;
  let caption: string;

  if (hourly) {
    caption = `Hourly revenue · ${now.toLocaleDateString('en-PK', { day: 'numeric', month: 'long' })}`;
  } else if (period === 'month') {
    start.setDate(1);
    caption = `Daily revenue · ${now.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })}`;
  } else {
    const weekday = start.getDay();
    start.setDate(start.getDate() + (weekday === 0 ? -6 : 1 - weekday));
    caption = 'Daily revenue · this week';
  }

  const count = hourly ? 24 : days;
  const buckets = Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    if (hourly) date.setHours(index);
    else date.setDate(date.getDate() + index);
    return {
      start: date.getTime(),
      end: hourly
        ? date.getTime() + 3_600_000
        : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime(),
      label: hourly
        ? date.toLocaleTimeString('en-PK', { hour: 'numeric' })
        : date.toLocaleDateString('en-PK', { weekday: period === 'week' ? 'short' : undefined, day: 'numeric' }),
      amount: 0,
      orders: 0,
    };
  });
  return { buckets, caption };
}

export interface Ranking {
  name: string;
  metric: number;
  detail: number;
}

export interface AnalyticsReport {
  buckets: Bucket[];
  caption: string;
  orderCount: number;
  topItems: Ranking[];
  topCustomers: Ranking[];
  categoryBreakdown: CategorySalesRow[];
}

export async function getAnalytics(period: Period, categoryId?: string): Promise<AnalyticsReport> {
  const [sales, customers, menu, categories] = await Promise.all([
    db.sales.toArray(),
    db.customers.toArray(),
    db.menu.toArray(),
    Promise.resolve().then(() => db.categories.toArray()).catch(() => []),
  ]);
  const { buckets, caption } = getBuckets(period);
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;
  const inPeriod = sales.filter((sale) => {
    const at = new Date(sale.timestamp).getTime();
    return Number.isFinite(at) && at >= from && at < to;
  });

  const items = new Map<string, Ranking>();
  const people = new Map<string, Ranking>();
  const profiles = new Map(customers.map((c) => [c.phone || c.id, c.name]));
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const categoryBreakdown = computeCategoryBreakdown(inPeriod, menu, categories);

  let matchedOrders = 0;

  for (const sale of inPeriod) {
    const at = new Date(sale.timestamp).getTime();
    const saleShares = computeSaleCategoryShares(sale, menuById, categoryNameById);
    const activeShare = categoryId ? saleShares.find((s) => s.categoryId === categoryId) : undefined;
    if (categoryId && (!activeShare || activeShare.unitsSold <= 0)) continue;

    matchedOrders++;
    const saleContribution = activeShare
      ? activeShare.netRevenue
      : Math.max(0, amount(sale) - (Number(sale.refundedAmount) || 0));

    const bucket = buckets.find((b) => at >= b.start && at < b.end);
    if (bucket) {
      bucket.amount += saleContribution;
      bucket.orders++;
    }

    const netMultiplier = computeSaleNetMultiplier(sale);
    for (const item of sale.items || []) {
      const effectiveQty = Math.max(0, (Number(item.qty) || 0) - (Number(item.refundedQty) || 0));
      if (effectiveQty <= 0) continue;
      if (categoryId !== undefined && resolveLineCategory(item, menuById, categoryNameById).categoryId !== categoryId) {
        continue;
      }
      const name = item.name || 'Unnamed item';
      const row = items.get(name) || { name, metric: 0, detail: 0 };
      row.metric += effectiveQty;
      row.detail += Math.round(effectiveQty * (Number(item.price) || 0) * netMultiplier * 100) / 100;
      items.set(name, row);
    }

    const buyer = sale.customer?.phone ? sale.customer : sale.deliveryInfo;
    const phone = buyer?.phone?.replace(/\D/g, '');
    if (!phone) continue;
    const row = people.get(phone) || { name: buyer?.name || profiles.get(phone) || 'Customer', metric: 0, detail: 0 };
    if (buyer?.name) row.name = buyer.name;
    row.metric++;
    row.detail += saleContribution;
    people.set(phone, row);
  }

  return {
    buckets,
    caption,
    orderCount: matchedOrders,
    topItems: [...items.values()].sort((a, b) => b.metric - a.metric || b.detail - a.detail).slice(0, 5),
    topCustomers: [...people.values()].sort((a, b) => b.metric - a.metric || b.detail - a.detail).slice(0, 5),
    categoryBreakdown,
  };
}

export interface PnlReport {
  sales: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  net: number;
  orderCount: number;
}

export function parseLocalDateBoundary(dateStr: string, endOfDay = false): number {
  if (!dateStr) return endOfDay ? Infinity : -Infinity;
  const parts = dateStr.split('-').map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    const [y, m, d] = parts;
    return endOfDay
      ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
      : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  }
  return endOfDay ? new Date(dateStr).setHours(23, 59, 59, 999) : new Date(dateStr).setHours(0, 0, 0, 0);
}

export async function getPnl(startDate: string, endDate: string): Promise<PnlReport> {
  const [sales, expenses, inventory, recipes, shiftStart, stockDeltas, closedManual] = await Promise.all([
    db.sales.toArray(),
    db.expenses.toArray(),
    db.inventory.toArray(),
    db.recipes.toArray(),
    getShiftStart(),
    getShiftStockDeltas(),
    getClosedShiftManualCosts(),
  ]);
  const from = parseLocalDateBoundary(startDate, false);
  const to = parseLocalDateBoundary(endDate, true);
  const between = (stamp: string) => {
    const at = new Date(stamp).getTime();
    return at >= from && at <= to;
  };

  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const inRange = sales.filter((s) => between(s.timestamp));
  const totalSales = inRange.reduce(
    (sum, s) => sum + Math.max(0, amount(s) - (Number(s.refundedAmount) || 0)),
    0,
  );

  // Closed-shift sales use their locked cost snapshot; live-shift sales dynamically
  // recalculate from the latest inventory unit costs until the shift ends.
  let cogs = inRange.reduce((sum, sale) => {
    if (sale.lockedCost !== undefined) return sum + (Number(sale.lockedCost) || 0);
    return sum + computeSaleLiveCost(sale, recipes, inventoryById);
  }, 0);

  // Add locked manual stock costs from closed shifts in the date range.
  for (const record of closedManual) {
    if (between(record.closedAt)) {
      cogs += Number(record.cost) || 0;
    }
  }

  // Add live manual stock reductions from the currently open shift if it overlaps [from, to].
  const shiftStartMs = new Date(shiftStart).getTime();
  if (Date.now() >= from && shiftStartMs <= to) {
    for (const [inventoryId, rawQty] of Object.entries(stockDeltas)) {
      const qty = Math.max(0, Number(rawQty) || 0);
      if (qty <= 0) continue;
      const unitCost = Number(inventoryById.get(inventoryId)?.cost) || 0;
      cogs += qty * unitCost;
    }
  }

  const totalExpenses = expenses
    .filter((e: Expense) => isApproved(e) && between(e.timestamp))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const grossProfit = totalSales - cogs;
  return {
    sales: totalSales,
    cogs,
    grossProfit,
    expenses: totalExpenses,
    net: grossProfit - totalExpenses,
    orderCount: inRange.length,
  };
}
