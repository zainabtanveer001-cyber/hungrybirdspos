import type { CartItem, Category, MenuItem, Sale } from './db/types';

export const UNCATEGORIZED_ID = 'uncategorized';

export interface SaleCategoryShare {
  categoryId: string;
  categoryName: string;
  unitsSold: number;
  grossRevenue: number;
  netRevenue: number;
}

export interface CategorySalesRow {
  categoryId: string;
  categoryName: string;
  unitsSold: number;
  orderCount: number;
  grossRevenue: number;
  netRevenue: number;
  sharePercent: number;
}

function roundMoney(value: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

/** Resolves an order line's category ID and display name using item snapshot first, then live menu/categories. */
export function resolveLineCategory(
  line: CartItem,
  menuById: Map<string, MenuItem>,
  categoryNameById: Map<string, string>,
): { categoryId: string; categoryName: string } {
  const menuCat = menuById.get(line.menuItemId || line.id)?.categoryId;
  const categoryId = line.categoryId || menuCat || UNCATEGORIZED_ID;
  const liveName = categoryNameById.get(categoryId);
  const categoryName =
    liveName ||
    line.categoryName ||
    (categoryId === UNCATEGORIZED_ID ? 'Uncategorized' : categoryId);
  return { categoryId, categoryName };
}

/**
 * Computes the proportional net-multiplier (`(originalGross - discounts) / originalGross`)
 * for a sale so order-level and loyalty discounts distribute evenly across mixed-category items.
 */
export function computeSaleNetMultiplier(sale: Sale): number {
  const originalGross = (sale.items || []).reduce(
    (sum, line) => sum + (Number(line.qty) || 0) * (Number(line.price) || 0),
    0,
  );
  if (originalGross <= 0) return 1;
  const subtotalBase = Number(sale.subtotal) || originalGross;
  const orderDiscount =
    Number(sale.discountAmount) ||
    (subtotalBase * (Number(sale.discountPercent) || 0)) / 100;
  const totalDiscounts = Math.max(0, orderDiscount + (Number(sale.loyaltyDiscount) || 0));
  return Math.max(0, (originalGross - totalDiscounts) / originalGross);
}

/**
 * Breaks a single sale down into its constituent food categories using unrefunded quantities
 * and net item revenue after proportional order/loyalty discounts.
 */
export function computeSaleCategoryShares(
  sale: Sale,
  menuById: Map<string, MenuItem>,
  categoryNameById: Map<string, string>,
): SaleCategoryShare[] {
  const multiplier = computeSaleNetMultiplier(sale);
  const byCategory = new Map<string, SaleCategoryShare>();

  for (const line of sale.items || []) {
    const effectiveQty = Math.max(0, (Number(line.qty) || 0) - (Number(line.refundedQty) || 0));
    if (effectiveQty <= 0) continue;

    const { categoryId, categoryName } = resolveLineCategory(line, menuById, categoryNameById);
    const gross = effectiveQty * (Number(line.price) || 0);
    const net = gross * multiplier;

    const existing = byCategory.get(categoryId) ?? {
      categoryId,
      categoryName,
      unitsSold: 0,
      grossRevenue: 0,
      netRevenue: 0,
    };
    existing.unitsSold += effectiveQty;
    existing.grossRevenue += gross;
    existing.netRevenue += net;
    byCategory.set(categoryId, existing);
  }

  return [...byCategory.values()]
    .map((row) => ({
      ...row,
      grossRevenue: roundMoney(row.grossRevenue),
      netRevenue: roundMoney(row.netRevenue),
    }))
    .sort((a, b) => b.netRevenue - a.netRevenue || b.unitsSold - a.unitsSold || a.categoryName.localeCompare(b.categoryName));
}

/**
 * Aggregates sales across every food category, including configured categories with zero sales,
 * computing net revenue, gross revenue, units sold, order counts, and `% share`.
 */
export function computeCategoryBreakdown(
  sales: Sale[],
  menu: MenuItem[],
  categories: Category[],
): CategorySalesRow[] {
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const rows = new Map<string, CategorySalesRow>();

  for (const cat of categories) {
    rows.set(cat.id, {
      categoryId: cat.id,
      categoryName: cat.name,
      unitsSold: 0,
      orderCount: 0,
      grossRevenue: 0,
      netRevenue: 0,
      sharePercent: 0,
    });
  }

  for (const sale of sales) {
    const shares = computeSaleCategoryShares(sale, menuById, categoryNameById);
    for (const share of shares) {
      const target = rows.get(share.categoryId) ?? {
        categoryId: share.categoryId,
        categoryName: share.categoryName,
        unitsSold: 0,
        orderCount: 0,
        grossRevenue: 0,
        netRevenue: 0,
        sharePercent: 0,
      };
      target.unitsSold += share.unitsSold;
      target.orderCount += 1;
      target.grossRevenue += share.grossRevenue;
      target.netRevenue += share.netRevenue;
      rows.set(share.categoryId, target);
    }
  }

  const list = [...rows.values()].filter(
    (row) => row.categoryId !== UNCATEGORIZED_ID || row.unitsSold > 0 || row.orderCount > 0,
  );
  const totalNet = list.reduce((sum, row) => sum + row.netRevenue, 0);

  return list
    .map((row) => {
      const netRevenue = roundMoney(row.netRevenue);
      const grossRevenue = roundMoney(row.grossRevenue);
      const sharePercent = totalNet > 0 ? Math.round((netRevenue / totalNet) * 1000) / 10 : 0;
      return {
        ...row,
        grossRevenue,
        netRevenue,
        sharePercent,
      };
    })
    .sort((a, b) => b.netRevenue - a.netRevenue || b.unitsSold - a.unitsSold || a.categoryName.localeCompare(b.categoryName));
}
