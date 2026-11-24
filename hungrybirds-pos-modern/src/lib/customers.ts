import { db } from './db';
import { roundAmount } from './format';
import type { Customer, Sale } from './db/types';

export const LOYALTY_EARN_RATE = 100; // Rs spent per point earned

/** The POS only accepts 5–15 digit phone numbers as customer ids. */
export function normalizePhone(phone: string | undefined): string {
  const str = String(phone || '').trim();
  return /^\d{5,15}$/.test(str) ? str : '';
}

function saleCustomerPhone(sale: Sale): string {
  return normalizePhone(sale.customer?.phone || (sale.orderType === 'DELIVERY' ? sale.deliveryInfo?.phone : undefined));
}

export function getCustomer(phone: string | undefined): Promise<Customer | undefined> {
  const id = normalizePhone(phone);
  return id ? db.customers.get(id) : Promise.resolve(undefined);
}

/** Port of upsertCustomerRecord — earns points on the paid total, minus what was redeemed. */
export async function upsertCustomer(
  customer: { phone?: string; name?: string } | undefined,
  saleTotal: number,
  redeemedPoints = 0,
): Promise<void> {
  const phone = normalizePhone(customer?.phone);
  if (!phone) return;

  const existing = await db.customers.get(phone);
  const earned = Math.floor((Number(saleTotal) || 0) / LOYALTY_EARN_RATE);
  const now = new Date().toISOString();

  await db.customers.put({
    id: phone,
    phone,
    name: customer?.name || existing?.name || '',
    totalOrders: (existing?.totalOrders || 0) + 1,
    totalSpent: (existing?.totalSpent || 0) + (Number(saleTotal) || 0),
    loyaltyPoints: Math.max(0, (existing?.loyaltyPoints || 0) - (Number(redeemedPoints) || 0) + earned),
    lastVisit: now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
}

/**
 * Claws back spent total and loyalty points when a sale receives a partial or full refund.
 * Call before updating `sale.refundedAmount` so the incremental net spend delta stays accurate.
 */
export async function adjustCustomerForRefund(sale: Sale, refundAmount: number): Promise<void> {
  const phone = saleCustomerPhone(sale);
  const amount = Number(refundAmount) || 0;
  if (!phone || amount <= 0) return;

  const existing = await db.customers.get(phone);
  if (!existing) return;

  const prevNet = Math.max(0, (Number(sale.total) || 0) - (Number(sale.refundedAmount) || 0));
  const nextNet = Math.max(0, prevNet - amount);
  const spentDelta = prevNet - nextNet;
  const pointsClawback = Math.max(
    0,
    Math.floor(prevNet / LOYALTY_EARN_RATE) - Math.floor(nextNet / LOYALTY_EARN_RATE),
  );

  await db.customers.put({
    ...existing,
    totalSpent: Math.max(0, roundAmount((existing.totalSpent || 0) - spentDelta)),
    loyaltyPoints: Math.max(0, (existing.loyaltyPoints || 0) - pointsClawback),
    updatedAt: new Date().toISOString(),
  });
}

/** Reverses a voided or re-opened sale's remaining spend, order count, and redeemed/earned points. */
export async function reverseCustomerSale(sale: Sale): Promise<void> {
  const phone = saleCustomerPhone(sale);
  if (!phone) return;

  const existing = await db.customers.get(phone);
  if (!existing) return;

  const remainingNet = Math.max(0, (Number(sale.total) || 0) - (Number(sale.refundedAmount) || 0));
  const remainingEarned = Math.floor(remainingNet / LOYALTY_EARN_RATE);
  const redeemed = Math.max(0, Number(sale.loyaltyRedeemPoints) || 0);

  await db.customers.put({
    ...existing,
    totalOrders: Math.max(0, (existing.totalOrders || 0) - 1),
    totalSpent: Math.max(0, roundAmount((existing.totalSpent || 0) - remainingNet)),
    loyaltyPoints: Math.max(0, (existing.loyaltyPoints || 0) - remainingEarned + redeemed),
    updatedAt: new Date().toISOString(),
  });
}
