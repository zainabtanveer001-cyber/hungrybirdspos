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
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
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

export interface MirrorReconcileInput {
  remoteIds: Iterable<string>;
  /** Previously synced remote IDs from `sync.snapshot`, or `undefined` if never synced yet. */
  seenIds: Iterable<string> | undefined;
  /** All primary keys currently stored in local IndexedDB for this collection. */
  localIds: Iterable<string>;
  /** Local IDs with an unsynced create/update still queued for push (must never be pruned). */
  pendingUpsertIds?: Iterable<string>;
}

export interface MirrorReconcileResult {
  /** Local IDs that should be deleted because they no longer exist in the cloud. */
  toDelete: string[];
  /**
   * True only on first-ever sync (`seenIds === undefined`) when the cloud collection is
   * completely empty (`remoteIds` empty) while the device has local rows to seed the cloud.
   */
  shouldBootstrapCloud: boolean;
}

/**
 * Computes which local rows to prune when mirroring an authoritative cloud collection
 * (`categories`, `menu`, `inventory`). Unlike snapshot-only diffing, this also removes
 * stale local-only rows (such as pre-seeded default categories) on other devices once
 * the cloud collection is authoritative, while protecting any unsynced local writes.
 */
export function reconcileMirrorCollection({
  remoteIds,
  seenIds,
  localIds,
  pendingUpsertIds = [],
}: MirrorReconcileInput): MirrorReconcileResult {
  const remote = new Set(remoteIds);
  const local = new Set(localIds);
  const pending = new Set(pendingUpsertIds);

  if (seenIds === undefined && remote.size === 0) {
    return { toDelete: [], shouldBootstrapCloud: local.size > 0 };
  }

  const candidates = new Set<string>(local);
  if (seenIds !== undefined) {
    for (const id of seenIds) candidates.add(id);
  }

  const toDelete: string[] = [];
  for (const id of candidates) {
    if (!remote.has(id) && !pending.has(id)) {
      toDelete.push(id);
    }
  }
  return { toDelete, shouldBootstrapCloud: false };
}

/**
 * Merges freshly pulled remote timestamps into the local snapshot without clobbering
 * IDs that were concurrently pushed or deleted while the pull request was in flight.
 */
export function mergePulledSnapshot(
  remote: Record<string, string>,
  current: Record<string, string> | undefined,
  protectedIds: Iterable<string>,
): Record<string, string> {
  const next: Record<string, string> = { ...remote };
  for (const id of protectedIds) {
    if (current && id in current) {
      next[id] = current[id];
    } else {
      delete next[id];
    }
  }
  return next;
}

export type SyncVersionsMap = Record<string, Record<string, string>>;

/** Parses `tableOrders/sync_versions_v1` into per-collection device stamps and voided sale tombstones. */
export function parseSyncVersionsDoc(doc: any): { collections: SyncVersionsMap; voidedSaleIds: string[] } {
  if (!doc?.fields || typeof doc.fields !== 'object') {
    return { collections: {}, voidedSaleIds: [] };
  }
  const decoded = decodeFields(doc.fields);
  const collections: SyncVersionsMap = {};
  const voidSet = new Set<string>();

  for (const [key, value] of Object.entries(decoded)) {
    if (key.startsWith('c_') && value && typeof value === 'object' && !Array.isArray(value)) {
      const colName = key.slice(2);
      const deviceStamps: Record<string, string> = {};
      for (const [deviceId, stamp] of Object.entries(value)) {
        if (typeof stamp === 'string') deviceStamps[deviceId] = stamp;
      }
      collections[colName] = deviceStamps;
    } else if (key === 'v_voids' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const rawList of Object.values(value)) {
        let parsed: unknown = rawList;
        if (typeof rawList === 'string') {
          try {
            parsed = JSON.parse(rawList);
          } catch {
            parsed = null;
          }
        }
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string' && id) voidSet.add(id);
          }
        }
      }
    }
  }

  return { collections, voidedSaleIds: [...voidSet] };
}

/** Returns collections modified by any remote device (`deviceId !== selfDeviceId`) since `seen`. */
export function diffRemoteVersions(
  remote: SyncVersionsMap,
  seen: SyncVersionsMap,
  selfDeviceId: string,
  collections: readonly string[],
): string[] {
  const dirty: string[] = [];
  for (const collection of collections) {
    const remoteMap = remote[collection];
    if (!remoteMap) continue;
    const seenMap = seen[collection] ?? {};
    for (const [deviceId, stamp] of Object.entries(remoteMap)) {
      if (deviceId === selfDeviceId) continue;
      if (stamp !== seenMap[deviceId]) {
        dirty.push(collection);
        break;
      }
    }
  }
  return dirty;
}

/** Updates seen per-collection remote versions only for collections that were pulled cleanly. */
export function mergeSeenVersions(
  seen: SyncVersionsMap,
  remote: SyncVersionsMap,
  syncedCollections: Iterable<string>,
): SyncVersionsMap {
  const next: SyncVersionsMap = { ...seen };
  for (const collection of syncedCollections) {
    next[collection] = { ...(remote[collection] ?? {}) };
  }
  return next;
}

/** Computes 429 cooldown duration (exponential 30s -> 300s, honoring `Retry-After` up to 900s). */
export function computeBackoffMs(streak: number, retryAfterHeader?: string | null): number {
  const expMs = Math.min(300_000, 30_000 * 2 ** Math.max(0, streak - 1));
  const raw = retryAfterHeader?.trim();
  if (!raw) return expMs;

  let headerMs = 0;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    headerMs = Math.round(Number(raw) * 1000);
  } else {
    const until = Date.parse(raw);
    if (!Number.isNaN(until)) headerMs = until - Date.now();
  }
  if (headerMs > 0) return Math.min(900_000, Math.max(expMs, headerMs));
  return expMs;
}

/** Subtracts an overlap safety window from an ISO watermark so clock skew never skips updates. */
export function computeWatermarkQueryFloor(watermarkIso: string, overlapMs: number): string {
  const ms = Date.parse(watermarkIso);
  if (Number.isNaN(ms)) return watermarkIso;
  return new Date(Math.max(0, ms - overlapMs)).toISOString();
}

const ACTIVE_ONLINE_STATUSES = ['PENDING', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'] as const;

export function buildActiveOnlineOrdersQuery(): Record<string, unknown> {
  return {
    from: [{ collectionId: 'onlineOrders' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'status' },
        op: 'IN',
        value: {
          arrayValue: {
            values: ACTIVE_ONLINE_STATUSES.map((status) => ({ stringValue: status })),
          },
        },
      },
    },
  };
}

export function buildIncrementalQuery(collectionId: string, fieldPath: string, sinceIso: string): Record<string, unknown> {
  return {
    from: [{ collectionId }],
    where: {
      fieldFilter: {
        field: { fieldPath },
        op: 'GREATER_THAN_OR_EQUAL',
        value: { stringValue: sinceIso },
      },
    },
  };
}
