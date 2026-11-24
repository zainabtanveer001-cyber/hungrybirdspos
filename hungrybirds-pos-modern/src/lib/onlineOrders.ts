import { db } from './db';
import { logAudit } from './audit';
import { roundAmount } from './format';
import { pushOrder } from './sync';
import type { CartCharges } from './cart';
import type { CartItem, OnlineOrder, OnlineOrderStatus } from './db/types';

/** Lifecycle for delivery orders; takeaway/dine-in stop at COMPLETED. */
export const NEXT_STATUS: Partial<Record<OnlineOrderStatus, OnlineOrderStatus>> = {
  ACCEPTED: 'PREPARING',
  PREPARING: 'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'COMPLETED',
};

export const STATUS_LABEL: Record<OnlineOrderStatus, string> = {
  PENDING: 'Awaiting acceptance',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  OUT_FOR_DELIVERY: 'Out for delivery',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
};

const ACTIVE: OnlineOrderStatus[] = ['PENDING', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'];

export function isActive(order: OnlineOrder): boolean {
  return ACTIVE.includes(order.status);
}

/**
 * Next state for an order. Delivery runs the full chain; anything else is
 * accepted straight to PREPARING and completed by the cashier.
 */
export function nextStatus(order: OnlineOrder): OnlineOrderStatus | null {
  if (order.status === 'PENDING') return 'ACCEPTED';
  if (order.status === 'PREPARING' && order.orderType !== 'DELIVERY') return 'COMPLETED';
  return NEXT_STATUS[order.status] ?? null;
}

const TIMESTAMP_FIELD: Partial<Record<OnlineOrderStatus, keyof OnlineOrder>> = {
  ACCEPTED: 'acceptedAt',
  PREPARING: 'preparingAt',
  OUT_FOR_DELIVERY: 'dispatchedAt',
  COMPLETED: 'completedAt',
  REJECTED: 'rejectedAt',
};

/** Mirrors the legacy `syncOrderStatusToFirestore`; the cloud hop is fire-and-forget. */
export async function setOrderStatus(
  id: number,
  status: OnlineOrderStatus,
  user: string,
  extra: { rejectReason?: string } = {},
): Promise<void> {
  const field = TIMESTAMP_FIELD[status];
  await db.onlineOrders.update(id, {
    status,
    ...(field ? { [field]: new Date().toISOString() } : {}),
    ...extra,
  });
  const order = await db.onlineOrders.get(id);
  if (order) pushOrder(order);
  const who = order?.customer?.name ? ` for ${order.customer.name}` : '';
  const why = extra.rejectReason ? ` — ${extra.rejectReason}` : '';
  await logAudit(`ONLINE_ORDER_${status}`, `Website order #${id}${who} → ${STATUS_LABEL[status]}${why}`, user);
}

export async function rejectOrder(id: number, reason: string, user: string): Promise<void> {
  await setOrderStatus(id, 'REJECTED', user, { rejectReason: reason.trim() || 'Rejected by staff' });
}

/**
 * Resolves website lines against the local menu so stock deduction and recipe
 * lookups keep working; an unknown dish still goes to the cart, just without
 * a recipe behind it.
 */
export async function resolveOrderToCart(order: OnlineOrder): Promise<CartItem[]> {
  const resolved: CartItem[] = [];
  for (const line of order.items || []) {
    const canonicalId = line.menuItemId || line.id;
    const menuItem = canonicalId ? await db.menu.get(canonicalId) : undefined;
    resolved.push({
      ...line,
      id: menuItem ? menuItem.id : line.id || `CUSTOM_${Date.now()}_${resolved.length}`,
      menuItemId: menuItem ? menuItem.id : '',
      name: menuItem?.name || line.name,
      price: Number(menuItem?.price) || Number(line.price) || 0,
      qty: Number(line.qty) || 1,
    });
  }
  return resolved;
}

/**
 * Reconstructs CartCharges (orderType, discountPercent, deliveryCharge) from an accepted
 * website order so loaded POS totals match the customer's quoted order total.
 */
export function deriveOnlineOrderCharges(items: CartItem[], order: OnlineOrder): CartCharges {
  const itemsSubtotal = (items || []).reduce(
    (sum, line) => sum + (Number(line.price) || 0) * (Number(line.qty) || 0),
    0,
  );
  const orderTotal = Number(order.total) || 0;

  let discountPercent = 0;
  if (Number(order.discountPercent) > 0) {
    discountPercent = Math.min(100, Number(order.discountPercent));
  } else if (Number(order.discountAmount) > 0 && itemsSubtotal > 0) {
    discountPercent = Math.min(100, roundAmount((Number(order.discountAmount) / itemsSubtotal) * 100));
  }

  const discountedItems = itemsSubtotal * (1 - discountPercent / 100);
  let deliveryCharge = 0;
  if (order.orderType === 'DELIVERY') {
    if (Number(order.deliveryCharge) > 0) {
      deliveryCharge = Number(order.deliveryCharge);
    } else if (orderTotal > discountedItems) {
      deliveryCharge = roundAmount(orderTotal - discountedItems);
    }
  }

  if (discountPercent === 0 && itemsSubtotal > 0 && orderTotal > 0 && orderTotal < itemsSubtotal) {
    discountPercent = roundAmount(((itemsSubtotal - orderTotal) / itemsSubtotal) * 100);
  }

  return {
    orderType: order.orderType || 'DELIVERY',
    tableNumber: undefined,
    discountPercent,
    deliveryCharge,
    packingCharge: 0,
    taxPercent: 0,
    otherCharge: 0,
    loyaltyPoints: 0,
  };
}
