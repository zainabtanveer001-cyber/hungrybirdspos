import { db } from './db';
import { logAudit } from './audit';
import { recipeMultiplierForLine } from './cart';
import { adjustCustomerForRefund } from './customers';
import { roundAmount } from './format';
import { collectModifierIngredientUsage } from './modifiers';
import type { CartItem, PaymentMethod, Sale } from './db/types';

export interface RefundLine {
  index: number;
  qty: number;
}

export interface RefundPreview {
  /** Effective quantity of a line that is still refundable, after earlier refunds. */
  remaining: number[];
  /** Per-unit amount actually paid, after any order-level discount. */
  units: number[];
  amount: number;
  fullyRefunded: boolean;
}

export function remainingQty(line: CartItem): number {
  return Math.max(0, (Number(line.qty) || 0) - (Number(line.refundedQty) || 0));
}

/** Picks the dominant tender method on the sale (defaults to `'Cash'`) for drawer reconciliation. */
export function primaryRefundMethod(sale: Sale): PaymentMethod {
  let bestMethod: PaymentMethod = 'Cash';
  let bestAmount = -1;
  for (const payment of sale.payments || []) {
    const amt = Number(payment.amount) || 0;
    const method: PaymentMethod = payment.method === 'Card' || payment.method === 'Online' ? payment.method : 'Cash';
    if (amt > bestAmount) {
      bestAmount = amt;
      bestMethod = method;
    }
  }
  return bestMethod;
}

/**
 * Share of each line's menu price the customer actually paid. Discounts and redeemed
 * loyalty points reduce item revenue, whereas extra fees (delivery, packing, tax) do not
 * inflate what each food item is worth on a refund.
 */
function paidRatio(sale: Sale): number {
  const gross = (sale.items || []).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.price) || 0), 0);
  if (gross <= 0) return 1;

  const pctDiscount = (gross * (Number(sale.discountPercent) || 0)) / 100;
  const orderDiscount = Number(sale.discountAmount) > 0 ? Number(sale.discountAmount) : pctDiscount;
  const explicitDiscount = orderDiscount + (Number(sale.loyaltyDiscount) || 0);
  if (explicitDiscount > 0) {
    return Math.min(1, Math.max(0, (gross - explicitDiscount) / gross));
  }

  const total = Number(sale.total) || 0;
  const extras =
    (Number(sale.deliveryCharge) || 0) +
    (Number(sale.packingCharge) || 0) +
    (Number(sale.otherCharge) || 0) +
    (Number(sale.taxAmount) || 0);
  const effectiveItemPaid = total - extras;

  if (total > 0 && effectiveItemPaid >= 0 && effectiveItemPaid < gross) {
    return effectiveItemPaid / gross;
  }
  if (total <= 0 && (Number(sale.subtotal) || 0) > 0) {
    return 0;
  }
  return 1;
}

export function refundableTotal(sale: Sale): number {
  const everything = (sale.items || []).map((line, index) => ({ index, qty: remainingQty(line) }));
  return computeRefund(sale, everything).amount;
}

/**
 * Prices a refund from the sale's own line prices, so a later menu price change
 * cannot alter what a past order refunds for. Quantities are clamped to what
 * is actually left on each line.
 */
export function computeRefund(sale: Sale, lines: RefundLine[]): RefundPreview {
  const items = sale.items || [];
  const remaining = items.map(remainingQty);
  const ratio = paidRatio(sale);
  let amount = 0;
  const taken = new Map<number, number>();

  for (const line of lines) {
    const index = Number(line.index);
    const available = remaining[index];
    if (available === undefined) continue;
    const qty = Math.min(Math.max(0, Number(line.qty) || 0), available, available - (taken.get(index) ?? 0));
    if (qty <= 0) continue;
    taken.set(index, (taken.get(index) ?? 0) + qty);
    amount += qty * (Number(items[index].price) || 0) * ratio;
  }

  const after = remaining.map((qty, index) => qty - (taken.get(index) ?? 0));
  return {
    remaining: after,
    units: items.map((line) => roundAmount((Number(line.price) || 0) * ratio)),
    amount: roundAmount(amount),
    fullyRefunded: after.every((qty) => qty <= 0),
  };
}

/**
 * Records a refund against a sale and puts the ingredients back in stock.
 *
 * `qty` is deliberately left untouched — `refundedQty` is added alongside it so
 * the original bill, the shift report and historical receipts keep reading the
 * same numbers they did before the refund.
 */
export async function recordRefund(
  saleId: number,
  lines: RefundLine[],
  reason: string,
  user: string,
  method?: PaymentMethod,
): Promise<{ amount: number; status: 'FULL' | 'PARTIAL' }> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('A refund needs a reason.');

  const preview = await db.transaction('rw', db.sales, db.inventory, db.recipes, db.customers, async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new Error('Sale record not found.');

    const result = computeRefund(sale, lines);
    if (result.amount <= 0) throw new Error('Select at least one item quantity to refund.');

    const refundMethod: PaymentMethod = method ?? primaryRefundMethod(sale);
    const items = (sale.items || []).map((line, index) => {
      const taken = remainingQty(line) - result.remaining[index];
      return taken > 0 ? { ...line, refundedQty: (Number(line.refundedQty) || 0) + taken } : line;
    });

    const refundedItems = (sale.items || [])
      .map((line, index) => ({ ...line, refundedQty: undefined, qty: remainingQty(line) - result.remaining[index] }))
      .filter((line) => line.qty > 0);

    const status: 'FULL' | 'PARTIAL' = result.fullyRefunded ? 'FULL' : 'PARTIAL';
    const patch: Partial<Sale> = {
      items,
      refundedAmount: Number(sale.refundedAmount || 0) + result.amount,
      refundStatus: status,
      refunds: [
        ...(sale.refunds || []),
        {
          timestamp: new Date().toISOString(),
          by: user,
          reason: trimmedReason,
          amount: result.amount,
          method: refundMethod,
          items: refundedItems,
        },
      ],
    };
    // If this sale's ingredient cost was already locked at shift close, scale down
    // the locked cost proportionally to the remaining unrefunded item value.
    if (sale.lockedCost !== undefined) {
      const beforeVal = (sale.items || []).reduce(
        (sum, line) => sum + remainingQty(line) * (Number(line.price) || 0),
        0,
      );
      const afterVal = items.reduce(
        (sum, line) => sum + remainingQty(line) * (Number(line.price) || 0),
        0,
      );
      patch.lockedCost =
        status === 'FULL' || beforeVal <= 0
          ? 0
          : roundAmount((Number(sale.lockedCost) || 0) * (afterVal / beforeVal));
    }
    await adjustCustomerForRefund(sale, result.amount);
    await db.sales.update(saleId, patch);

    for (const line of refundedItems) {
      const mult = recipeMultiplierForLine(line, false);
      for (const recipe of await db.recipes.where('menuItemId').equals(line.menuItemId || line.id).toArray()) {
        const ingredient = await db.inventory.get(recipe.inventoryId);
        if (!ingredient) continue;
        const nextStock = Math.round(((Number(ingredient.stock) || 0) + recipe.qtyRequired * mult) * 1000) / 1000;
        await db.inventory.update(recipe.inventoryId, { stock: nextStock });
      }
    }
    for (const [inventoryId, modQty] of collectModifierIngredientUsage(refundedItems, false)) {
      const ingredient = await db.inventory.get(inventoryId);
      if (!ingredient) continue;
      await db.inventory.update(inventoryId, {
        stock: (Number(ingredient.stock) || 0) + modQty,
      });
    }

    return { ...result, status };
  });

  await logAudit(
    'REFUND',
    `Refunded ${preview.amount} from Order #${saleId} (${preview.status}): ${trimmedReason}`,
    user,
    saleId,
  );
  return { amount: preview.amount, status: preview.status };
}
