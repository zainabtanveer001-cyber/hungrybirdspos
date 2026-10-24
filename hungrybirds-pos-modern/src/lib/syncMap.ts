import type { OnlineOrder, OnlineOrderStatus, Sale } from './db/types';

// Firestore REST values are typed wrappers; everything the POS owns is plain JSON.
// Pure (no db, no network) so the mapping can be unit-tested without IndexedDB.

export type FirestoreFields = Record<string, unknown>;

export function decodeValue(value: any): any {
  if (!value || typeof value !== 'object') return undefined;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  return undefined;
}

export function decodeFields(fields: FirestoreFields): Record<string, any> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([key, value]) => [key, decodeValue(value)]));
}

export function encodeValue(value: unknown): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  return { nullValue: null };
}

/** Undefined fields are dropped: Firestore would reject them as null writes. */
export function encodeFields(values: Record<string, unknown>): FirestoreFields {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeValue(value)]),
  );
}

export function documentId(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

export function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Milliseconds since epoch, or 0 for a missing/unparseable stamp. */
export function stampMs(value: unknown): number {
  const iso = toIso(value);
  return iso ? Date.parse(iso) : 0;
}

/**
 * The POS may only update an order — create and delete are 403 in the deployed
 * rules, because the website owns that collection.
 */
const CLOUD_TIMESTAMP: Partial<Record<OnlineOrderStatus, [keyof OnlineOrder, string]>> = {
  ACCEPTED: ['acceptedAt', 'acceptedAt'],
  PREPARING: ['preparingAt', 'preparingAt'],
  OUT_FOR_DELIVERY: ['dispatchedAt', 'out_for_deliveryAt'],
  COMPLETED: ['completedAt', 'completedAt'],
  REJECTED: ['rejectedAt', 'rejectedAt'],
};

const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const;

export function cloudOrderToLocal(cloudId: string, data: Record<string, any>): OnlineOrder {
  const order: OnlineOrder = {
    cloudId,
    createdAt: toIso(data.createdAt) ?? new Date().toISOString(),
    customer: {
      name: data.customer?.name || '',
      phone: data.customer?.phone || '',
      address: data.customer?.address || '',
    },
    orderType: ORDER_TYPES.includes(data.orderType) ? data.orderType : 'DELIVERY',
    items: (data.items || []).map((line: any, index: number) => {
      const menuItemId = String(line.menuItemId || line.id || '');
      return {
        id: menuItemId || `CUSTOM_${index}`,
        menuItemId,
        name: line.name || 'Item',
        price: Number(line.price) || 0,
        qty: Number(line.qty) || 1,
      };
    }),
    total: Number(data.total) || 0,
    status: (data.status || 'PENDING') as OnlineOrderStatus,
  };
  for (const [local, cloud] of Object.values(CLOUD_TIMESTAMP)) {
    const iso = toIso(data[cloud]);
    if (iso) (order as any)[local] = iso;
  }
  if (data.rejectionReason) order.rejectReason = String(data.rejectionReason);
  if (data.note) order.note = String(data.note);
  if (Number(data.saleId)) order.saleId = Number(data.saleId);
  return order;
}

/** Masked PATCH payload: only the lifecycle fields the POS is allowed to touch. */
export function localOrderPatch(order: OnlineOrder): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: order.status };
  const timestamp = CLOUD_TIMESTAMP[order.status];
  if (timestamp) {
    const [localField, cloudField] = timestamp;
    const iso = toIso(order[localField]);
    if (iso) patch[cloudField] = iso;
  }
  if (order.rejectReason) patch.rejectionReason = order.rejectReason;
  if (order.saleId) patch.saleId = order.saleId;
  return patch;
}

export function cloudSaleToLocal(cloudId: string, data: Record<string, any>): Sale {
  return {
    ...data,
    id: undefined,
    cloudId,
    localId: Number(data.localId) || undefined,
    timestamp: toIso(data.createdAt) ?? toIso(data.timestamp) ?? new Date().toISOString(),
  } as Sale;
}
