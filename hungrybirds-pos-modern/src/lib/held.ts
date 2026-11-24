import { db } from './db';
import { calculateCartTotals } from './cart';
import type { CartCharges } from './cart';
import type { CartItem, CustomerInfo } from './db/types';

export async function holdOrder(
  items: CartItem[],
  charges: CartCharges,
  customer: CustomerInfo | undefined,
  serverUser: string,
  onlineRef?: { onlineOrderId?: number; onlineOrderCloudId?: string | null },
): Promise<number> {
  const totals = calculateCartTotals(items, charges);
  return (await db.heldOrders.add({
    items: structuredClone(items),
    orderType: charges.orderType,
    tableNumber: charges.orderType === 'DINE_IN' ? charges.tableNumber : undefined,
    kitchenStatus: 'PREPARING',
    subtotal: totals.subtotal,
    discountPercent: charges.discountPercent,
    discountAmount: totals.discountAmount,
    deliveryCharge: totals.deliveryCharge,
    packingCharge: totals.packingCharge,
    taxPercent: charges.taxPercent,
    taxAmount: totals.taxAmount,
    otherCharge: charges.otherCharge,
    loyaltyRedeemPoints: charges.loyaltyPoints,
    loyaltyDiscount: totals.loyaltyDiscount,
    total: totals.grandTotal,
    customer,
    serverUser,
    timestamp: new Date().toISOString(),
    ...(onlineRef?.onlineOrderId !== undefined ? { onlineOrderId: onlineRef.onlineOrderId } : {}),
    ...(onlineRef?.onlineOrderCloudId !== undefined ? { onlineOrderCloudId: onlineRef.onlineOrderCloudId } : {}),
  })) as number;
}

/** Reads a held order without consuming it — the caller deletes it after applying. */
export async function readHeldOrder(id: number): Promise<{
  items: CartItem[];
  charges: CartCharges;
  customer: CustomerInfo | undefined;
  onlineOrderId?: number;
  onlineOrderCloudId?: string | null;
} | null> {
  const order = await db.heldOrders.get(id);
  if (!order) return null;

  return {
    items: order.items,
    customer: order.customer,
    onlineOrderId: order.onlineOrderId,
    onlineOrderCloudId: order.onlineOrderCloudId,
    charges: {
      orderType: order.orderType || 'DINE_IN',
      tableNumber: order.tableNumber,
      discountPercent: Number(order.discountPercent) || 0,
      deliveryCharge: Number(order.deliveryCharge) || 0,
      packingCharge: Number(order.packingCharge) || 0,
      taxPercent: Number(order.taxPercent) || 0,
      otherCharge: Number(order.otherCharge) || 0,
      loyaltyPoints: Number(order.loyaltyRedeemPoints) || 0,
    },
  };
}
