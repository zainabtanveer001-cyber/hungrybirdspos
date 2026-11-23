import type { Table, Transaction } from 'dexie';
import { db } from './db';
import { configManager } from './config';
import {
  buildActiveOnlineOrdersQuery,
  buildIncrementalQuery,
  cloudOrderToLocal,
  cloudSaleToLocal,
  computeBackoffMs,
  computeWatermarkQueryFloor,
  decodeFields,
  decodeValue,
  diffRemoteVersions,
  documentId,
  encodeFields,
  localOrderPatch,
  mergePulledSnapshot,
  mergeSeenVersions,
  parseSyncVersionsDoc,
  reconcileMirrorCollection,
  toIso,
} from './syncMap';
import type { SyncVersionsMap } from './syncMap';
import type { OnlineOrder, Sale } from './db/types';

// Firestore REST, same reasoning as auth.ts: the `firebase` package broke the
// Vercel/Rolldown build. Using a tiny `tableOrders/sync_versions_v1` manifest +
// incremental `:runQuery` watermarks avoids polling unchanged collections.
const TOKEN_KEY = 'hb.syncToken';
const SNAPSHOT_KEY = 'sync.snapshot';
const OUTBOX_KEY = 'sync.outbox';
const VERSIONS_KEY = 'sync.versions';
const WATERMARKS_KEY = 'sync.watermarks';
const DEVICE_ID_KEY = 'sync.deviceId';
const LOCAL_VOIDS_KEY = 'sync.localVoids';
const CATEGORIES_INITIALIZED_KEY = 'categoriesInitialized';
const SETTING_PREFIX = 'setting_';
const SYNC_VERSIONS_DOC_ID = 'sync_versions_v1';

const LEADER_KEY = 'hb.syncLeader';
const LEADER_TTL_MS = 25_000;

const ACTIVE_POLL_MS = 15_000;
const IDLE_POLL_MS = 60_000;
const IDLE_AFTER_MS = 3 * 60_000;
const ONLINE_ORDERS_MIN_INTERVAL_MS = 25_000;
const WAKE_MIN_INTERVAL_MS = 10_000;
const MANIFEST_DEBOUNCE_MS = 600;
const INCREMENTAL_OVERLAP_MS = 10 * 60_000;
const PULL_CONCURRENCY = 3;
const OUTBOX_CONCURRENCY = 2;
const MAX_LOCAL_VOIDS = 30;
const MAX_SYNCED_IMAGE_BYTES = 700 * 1024;

const STRING_MIRROR_COLLECTIONS = ['categories', 'menu', 'inventory', 'suppliers'] as const;
const NUMERIC_MIRROR_COLLECTIONS = [
  'heldOrders',
  'deliveries',
  'expenses',
  'staff',
  'attendance',
  'leaves',
  'salaryPayments',
  'advancePayments',
  'stockIn',
  'supplierPayments',
  'auditLogs',
] as const;

const NUMERIC_COLLECTION_SET = new Set<string>(NUMERIC_MIRROR_COLLECTIONS);
const MIRROR_COLLECTIONS = [
  ...STRING_MIRROR_COLLECTIONS,
  ...NUMERIC_MIRROR_COLLECTIONS,
] as const;

type MirrorCollection = (typeof MIRROR_COLLECTIONS)[number];
type OutboxCollection = MirrorCollection | 'sales' | 'tableOrders';

export const SYNCED_SETTING_KEYS = new Set([
  'modifierGroupsLibrary',
  'shiftStartTime',
  'shiftOpeningCash',
  'shiftStockDeltas',
  'closedShiftReports',
  'closedShiftManualCosts',
  'lowStockThreshold',
  'printerSettings',
  'receiptSettings',
  'ownerPinHash',
]);

const TIER1_COLLECTIONS = [
  'categories',
  'menu',
  'inventory',
  'sales',
  'onlineOrders',
  'heldOrders',
  'deliveries',
  'tableOrders',
] as const;

const TIER2_COLLECTIONS = [
  'suppliers',
  'expenses',
  'stockIn',
  'supplierPayments',
  'staff',
  'attendance',
  'leaves',
  'salaryPayments',
  'advancePayments',
  'auditLogs',
] as const;

const ALL_COLLECTIONS = [...TIER1_COLLECTIONS, ...TIER2_COLLECTIONS] as const;

const OUTBOX_COLLECTIONS: OutboxCollection[] = [
  ...MIRROR_COLLECTIONS,
  'sales',
  'tableOrders',
];

const ACTIVE_ONLINE_STATUS_SET = new Set<string>([
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
]);

export type SyncState = 'off' | 'idle' | 'syncing' | 'error';
export interface SyncStatus {
  state: SyncState;
  lastSync: number | null;
  error?: string;
  retryAt?: number;
  rateLimited?: boolean;
}

export interface SyncOptions {
  mode?: 'poll' | 'full';
  includeTier2?: boolean;
  collections?: readonly string[];
  manual?: boolean;
}

/* ------------------------------------------------------------------ status */

let status: SyncStatus = { state: 'off', lastSync: null };
const listeners = new Set<() => void>();

let rateLimitUntil = 0;
let rateLimitStreak = 0;
let lastRateLimitAt = 0;

export function isRateLimited(): boolean {
  return Date.now() < rateLimitUntil;
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeToSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function isSyncEnabled(): boolean {
  return typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(TOKEN_KEY)) && configManager.isConfigured();
}

/* ------------------------------------------------------------- remote guard */

let remoteApplyDepth = 0;

/** Wraps pulled remote IndexedDB writes so Dexie hooks never echo them back to Firestore. */
async function runAsRemoteApply<T>(fn: () => Promise<T>): Promise<T> {
  remoteApplyDepth += 1;
  try {
    return await fn();
  } finally {
    remoteApplyDepth -= 1;
  }
}

/* ------------------------------------------------------------------- token */

/** Caller's cloud id token, refreshed when needed; null when offline/local. */
export function getAccessToken(): Promise<string | null> {
  return accessToken();
}

interface Token {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function rememberToken(idToken: string, refreshToken?: string, expiresIn?: number): void {
  if (!refreshToken || typeof localStorage === 'undefined') return;
  const token: Token = {
    idToken,
    refreshToken,
    expiresAt: Date.now() + (Number(expiresIn) || 3600) * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function forgetToken(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
  }
  rateLimitUntil = 0;
  rateLimitStreak = 0;
  lastRateLimitAt = 0;
  setStatus({ state: 'off', error: undefined, rateLimited: false, retryAt: undefined });
}

async function accessToken(): Promise<string | null> {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  let token: Token;
  try {
    token = JSON.parse(raw);
  } catch {
    forgetToken();
    return null;
  }
  if (token.expiresAt - 60_000 > Date.now()) return token.idToken;

  const config = await configManager.getConfig();
  if (!config) return null;

  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: token.refreshToken }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res) {
    setStatus({ state: 'error', rateLimited: false, retryAt: undefined, error: 'Offline — retrying sync' });
    return null;
  }
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      forgetToken();
    } else {
      setStatus({ state: 'error', rateLimited: false, retryAt: undefined, error: `Auth refresh ${res.status}` });
    }
    return null;
  }
  const next = await res.json();
  rememberToken(next.id_token, next.refresh_token, next.expires_in);
  return next.id_token as string;
}

/* -------------------------------------------------------------------- rest */

async function getBaseUrl(): Promise<string | null> {
  const config = await configManager.getConfig();
  if (!config) return null;
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
}

function url(path: string, mask: string[] = []): Promise<string | null> {
  return (async () => {
    const config = await configManager.getConfig();
    const base = await getBaseUrl();
    if (!config || !base) return null;
    const query = new URLSearchParams({ key: config.apiKey });
    for (const field of mask) query.append('updateMask.fieldPaths', field);
    return `${base}/${path}?${query}`;
  })();
}

async function rest(
  method: string,
  target: string | Promise<string | null>,
  body?: unknown,
  opts?: { allowNotFound?: boolean },
): Promise<any | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (isSyncEnabled()) {
      setStatus({ state: 'error', rateLimited: false, retryAt: undefined, error: 'Offline — queued for sync' });
    }
    return null;
  }
  if (isRateLimited()) return null;

  const token = await accessToken();
  if (!token) return null;
  const resolvedTarget = typeof target === 'string' ? target : await target;
  if (!resolvedTarget) return null;
  try {
    const res = await fetch(resolvedTarget, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 404 && opts?.allowNotFound) {
      rateLimitStreak = 0;
      rateLimitUntil = 0;
      return { __notFound: true };
    }
    if (res.status === 429) {
      rateLimitStreak += 1;
      const backoffMs = computeBackoffMs(rateLimitStreak, res.headers?.get?.('Retry-After'));
      lastRateLimitAt = Date.now();
      rateLimitUntil = lastRateLimitAt + backoffMs;
      const retryLabel = new Date(rateLimitUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus({
        state: 'error',
        rateLimited: true,
        retryAt: rateLimitUntil,
        error: `Firestore quota / rate limit (429) — paused until ${retryLabel}. Local POS keeps working.`,
      });
      return null;
    }
    if (!res.ok) {
      if (res.status === 401) forgetToken();
      const errJson = await res.json().catch(() => null);
      const rawDetail = typeof errJson?.error?.message === 'string' ? errJson.error.message.trim() : '';
      const shortDetail = rawDetail.length > 140 ? `${rawDetail.slice(0, 140)}...` : rawDetail;
      if (shortDetail) {
        console.warn(`Firestore ${res.status} (${method}): ${shortDetail}`);
      }
      setStatus({
        state: 'error',
        rateLimited: false,
        retryAt: undefined,
        error: shortDetail ? `Firestore ${res.status}: ${shortDetail}` : `Firestore ${res.status}`,
      });
      return null;
    }
    rateLimitStreak = 0;
    rateLimitUntil = 0;
    return res.status === 204 ? {} : await res.json();
  } catch (err) {
    setStatus({
      state: 'error',
      rateLimited: false,
      retryAt: undefined,
      error: err instanceof Error ? err.message : 'network error',
    });
    return null;
  }
}

/** Authenticated Firestore REST call for one-off writes outside the sync queue. */
export function restWrite(method: string, target: string, body?: unknown): Promise<any | null> {
  return rest(method, target, body);
}

/* ----------------------------------------------------- concurrency helper */

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  let index = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!isRateLimited()) {
        const current = index;
        if (current >= items.length) break;
        index += 1;
        await worker(items[current]);
      }
    }),
  );
}

/* -------------------------------------------- snapshot / outbox / metadata */

type Snapshot = Record<string, Record<string, string>>;
type Watermarks = Record<string, string>;

interface SyncOutbox {
  upserts: Record<string, string[]>;
  deletes: Record<string, string[]>;
}

const EMPTY_OUTBOX = (): SyncOutbox => ({ upserts: {}, deletes: {} });

async function readSnapshot(): Promise<Snapshot> {
  const setting = await db.settings.get(SNAPSHOT_KEY);
  if (!setting) return {};
  try {
    return JSON.parse(setting.value) as Snapshot;
  } catch {
    return {};
  }
}

async function writeSnapshot(next: Snapshot): Promise<void> {
  await db.settings.put({ key: SNAPSHOT_KEY, value: JSON.stringify(next) });
}

let snapshot: Snapshot | null = null;

async function getSnapshot(): Promise<Snapshot> {
  snapshot ??= await readSnapshot();
  return snapshot;
}

async function readOutbox(): Promise<SyncOutbox> {
  const setting = await db.settings.get(OUTBOX_KEY);
  if (!setting) return EMPTY_OUTBOX();
  try {
    const parsed = JSON.parse(setting.value) as Partial<SyncOutbox>;
    return {
      upserts: parsed.upserts ?? {},
      deletes: parsed.deletes ?? {},
    };
  } catch {
    return EMPTY_OUTBOX();
  }
}

let outboxCache: SyncOutbox | null = null;

async function getOutbox(): Promise<SyncOutbox> {
  outboxCache ??= await readOutbox();
  return outboxCache;
}

async function writeOutbox(next: SyncOutbox): Promise<void> {
  outboxCache = next;
  await db.settings.put({ key: OUTBOX_KEY, value: JSON.stringify(next) });
}

function hasPendingOutbox(box: SyncOutbox): boolean {
  return OUTBOX_COLLECTIONS.some(
    (c) => (box.deletes[c]?.length ?? 0) > 0 || (box.upserts[c]?.length ?? 0) > 0,
  );
}

async function markOutbox(collection: OutboxCollection, id: string, kind: 'upsert' | 'delete'): Promise<void> {
  const box = await getOutbox();
  const up = new Set(box.upserts[collection] ?? []);
  const del = new Set(box.deletes[collection] ?? []);
  if (kind === 'upsert') {
    up.add(id);
    del.delete(id);
  } else {
    del.add(id);
    up.delete(id);
  }
  await writeOutbox({
    upserts: { ...box.upserts, [collection]: [...up] },
    deletes: { ...box.deletes, [collection]: [...del] },
  });
}

async function clearOutbox(collection: OutboxCollection, id: string, kind: 'upsert' | 'delete'): Promise<void> {
  const box = await getOutbox();
  const list = (kind === 'upsert' ? box.upserts[collection] : box.deletes[collection]) ?? [];
  if (!list.includes(id)) return;
  const filtered = list.filter((entry) => entry !== id);
  await writeOutbox(
    kind === 'upsert'
      ? { ...box, upserts: { ...box.upserts, [collection]: filtered } }
      : { ...box, deletes: { ...box.deletes, [collection]: filtered } },
  );
}

let seenVersionsCache: SyncVersionsMap | null = null;

async function getSeenVersions(): Promise<SyncVersionsMap> {
  if (seenVersionsCache) return seenVersionsCache;
  const row = await db.settings.get(VERSIONS_KEY);
  if (!row) {
    seenVersionsCache = {};
    return seenVersionsCache;
  }
  try {
    seenVersionsCache = JSON.parse(row.value) as SyncVersionsMap;
  } catch {
    seenVersionsCache = {};
  }
  return seenVersionsCache;
}

async function writeSeenVersions(next: SyncVersionsMap): Promise<void> {
  seenVersionsCache = next;
  await db.settings.put({ key: VERSIONS_KEY, value: JSON.stringify(next) });
}

let watermarksCache: Watermarks | null = null;

async function getWatermarks(): Promise<Watermarks> {
  if (watermarksCache) return watermarksCache;
  const row = await db.settings.get(WATERMARKS_KEY);
  if (!row) {
    watermarksCache = {};
    return watermarksCache;
  }
  try {
    watermarksCache = JSON.parse(row.value) as Watermarks;
  } catch {
    watermarksCache = {};
  }
  return watermarksCache;
}

async function writeWatermarks(next: Watermarks): Promise<void> {
  watermarksCache = next;
  await db.settings.put({ key: WATERMARKS_KEY, value: JSON.stringify(next) });
}

let deviceIdCache: string | null = null;

async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  const row = await db.settings.get(DEVICE_ID_KEY);
  if (typeof row?.value === 'string' && /^d_[a-z0-9]{6,16}$/.test(row.value)) {
    deviceIdCache = row.value;
    return deviceIdCache;
  }
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0').slice(0, 8);
  const nextId = `d_${random}`;
  deviceIdCache = nextId;
  await db.settings.put({ key: DEVICE_ID_KEY, value: nextId });
  return nextId;
}

async function readLocalVoids(): Promise<string[]> {
  const row = await db.settings.get(LOCAL_VOIDS_KEY);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function recordLocalVoid(cloudId: string): Promise<void> {
  const existing = await readLocalVoids();
  const deduped = [...existing.filter((id) => id !== cloudId), cloudId].slice(-MAX_LOCAL_VOIDS);
  await db.settings.put({ key: LOCAL_VOIDS_KEY, value: JSON.stringify(deduped) });
}

/* --------------------------------------------------------- version manifest */

let versionSeq = 0;
let lastActivityAt = Date.now();
const pendingDirtyCollections = new Set<string>();
let pendingVoidManifestFlush = false;
let manifestTimer: ReturnType<typeof setTimeout> | null = null;
let manifestInFlight: Promise<void> | null = null;
const appliedVoidIds = new Set<string>();

function markCollectionDirty(collection: string): void {
  pendingDirtyCollections.add(collection);
  lastActivityAt = Date.now();
  if (!isSyncEnabled()) return;
  if (!manifestTimer) {
    manifestTimer = setTimeout(() => {
      manifestTimer = null;
      void flushVersionManifest();
    }, MANIFEST_DEBOUNCE_MS);
  }
}

async function runFlushVersionManifest(): Promise<void> {
  if (manifestTimer) {
    clearTimeout(manifestTimer);
    manifestTimer = null;
  }
  if ((pendingDirtyCollections.size === 0 && !pendingVoidManifestFlush) || !isSyncEnabled() || isRateLimited()) {
    return;
  }

  const dirty = [...pendingDirtyCollections];
  const includeVoids = pendingVoidManifestFlush;
  pendingDirtyCollections.clear();
  pendingVoidManifestFlush = false;

  const deviceId = await getDeviceId();
  const stamp = `${Date.now()}_${++versionSeq}`;
  const maskSet = new Set(dirty.map((col) => `c_${col}.${deviceId}`));
  const fields: Record<string, unknown> = {};

  for (const col of dirty) {
    fields[`c_${col}`] = { [deviceId]: stamp };
  }

  if (includeVoids) {
    const voids = await readLocalVoids();
    maskSet.add(`v_voids.${deviceId}`);
    maskSet.add(`c_sales.${deviceId}`);
    fields.v_voids = { [deviceId]: JSON.stringify(voids) };
    fields.c_sales = { [deviceId]: stamp };
  }

  const res = await rest(
    'PATCH',
    url(`tableOrders/${SYNC_VERSIONS_DOC_ID}`, [...maskSet]),
    { fields: encodeFields(fields) },
  );

  if (res === null) {
    for (const col of dirty) pendingDirtyCollections.add(col);
    if (includeVoids) pendingVoidManifestFlush = true;
  }
}

/** Publishes pending per-collection device version stamps to `tableOrders/sync_versions_v1`. */
export function flushVersionManifest(): Promise<void> {
  if (manifestInFlight) {
    return manifestInFlight.then(() => {
      if (pendingDirtyCollections.size > 0 || pendingVoidManifestFlush) {
        return flushVersionManifest();
      }
    });
  }
  manifestInFlight = runFlushVersionManifest().finally(() => {
    manifestInFlight = null;
  });
  return manifestInFlight;
}

async function fetchSyncVersions(): Promise<{ collections: SyncVersionsMap; voidedSaleIds: string[] } | null> {
  const doc = await rest('GET', url(`tableOrders/${SYNC_VERSIONS_DOC_ID}`), undefined, { allowNotFound: true });
  if (doc === null) return null;
  if (doc.__notFound) return { collections: {}, voidedSaleIds: [] };
  return parseSyncVersionsDoc(doc);
}

/* ---------------------------------------------------------- table helpers */

function mirrorTable(collection: MirrorCollection): Table<any, any> | undefined {
  return (db as unknown as Record<string, Table<any, any> | undefined>)[collection];
}

function isMirrorCollection(collection: string): collection is MirrorCollection {
  return (MIRROR_COLLECTIONS as readonly string[]).includes(collection);
}

function isNumericCollection(collection: MirrorCollection): boolean {
  return NUMERIC_COLLECTION_SET.has(collection);
}

function isSyncedSettingDocId(docId: string): boolean {
  return docId.startsWith(SETTING_PREFIX) && SYNCED_SETTING_KEYS.has(docId.slice(SETTING_PREFIX.length));
}

function localMirrorKey(collection: MirrorCollection, id: string): string | number | null {
  if (!isNumericCollection(collection)) return id;
  const num = Number(id);
  return Number.isInteger(num) && num > 0 ? num : null;
}

async function localPrimaryKeys(collection: MirrorCollection): Promise<string[]> {
  const table = mirrorTable(collection);
  if (!table) return [];
  return (await table.toCollection().primaryKeys()).map(String);
}

async function localSettingDocIds(): Promise<string[]> {
  const rows = await db.settings.toArray();
  return rows
    .filter((row) => SYNCED_SETTING_KEYS.has(row.key))
    .map((row) => `${SETTING_PREFIX}${row.key}`);
}

/* -------------------------------------------------------------------- pull */

/** `{docId: updateTime}` plus the docs themselves, or `null` if the cloud fetch failed. */
async function metadata(collection: string): Promise<{ times: Record<string, string>; docs: any[] } | null> {
  const allDocs = await listAll(collection);
  if (allDocs === null) return null;
  const docs =
    collection === 'tableOrders'
      ? allDocs.filter((doc) => isSyncedSettingDocId(documentId(doc.name)))
      : allDocs;
  const times: Record<string, string> = {};
  for (const doc of docs) times[documentId(doc.name)] = doc.updateTime ?? '';
  return { times, docs };
}

/** Returns `null` on network/HTTP error so callers never mistake an outage for an empty collection. */
async function listAll(collection: string): Promise<any[] | null> {
  const config = await configManager.getConfig();
  const base = await getBaseUrl();
  if (!config || !base) return null;
  const docs: any[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ key: config.apiKey, pageSize: '1000' });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await rest('GET', `${base}/${collection}?${query}`);
    if (page === null) return null;
    docs.push(...(page.documents ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

async function runStructuredQuery(structuredQuery: Record<string, unknown>): Promise<any[] | null> {
  const config = await configManager.getConfig();
  const base = await getBaseUrl();
  if (!config || !base) return null;
  const res = await rest('POST', `${base}:runQuery?key=${config.apiKey}`, { structuredQuery });
  if (res === null) return null;
  if (!Array.isArray(res)) return null;
  return res.map((row: any) => row?.document).filter(Boolean);
}

async function fetchDoc(collection: string, id: string): Promise<any | null> {
  return rest('GET', url(`${collection}/${encodeURIComponent(id)}`));
}

async function applyMenuDoc(doc: any, updateTime: string): Promise<void> {
  const id = documentId(doc.name);
  const data: any = decodeFields(doc.fields ?? {});
  const { recipes, ...item } = data;
  await runAsRemoteApply(async () => {
    await db.menu.put({ ...item, id, updatedAt: toIso(updateTime) });
    await db.recipes.where('menuItemId').equals(id).delete();
    for (const row of recipes ?? []) {
      if (!row?.inventoryId) continue;
      await db.recipes.add({
        menuItemId: id,
        inventoryId: row.inventoryId,
        qtyRequired: Number(row.qtyRequired) || 0,
      });
    }
  });
  lastSentSig.delete(`menu/${id}`);
}

async function applyMirrorDoc(collection: MirrorCollection, doc: any, updateTime: string): Promise<void> {
  if (collection === 'menu') {
    await applyMenuDoc(doc, updateTime);
    return;
  }
  const table = mirrorTable(collection);
  if (!table) return;
  const rawId = documentId(doc.name);
  const id = localMirrorKey(collection, rawId);
  if (id === null) return;
  const data = decodeFields(doc.fields ?? {});
  await runAsRemoteApply(async () => {
    await table.put({ ...data, id, updatedAt: toIso(updateTime) });
  });
  lastSentSig.delete(`${collection}/${rawId}`);
}

async function applySyncedSetting(doc: any): Promise<void> {
  const docId = documentId(doc.name);
  if (!isSyncedSettingDocId(docId)) return;
  const data = decodeFields(doc.fields ?? {});
  const key = String(data.key || docId.slice(SETTING_PREFIX.length));
  if (!SYNCED_SETTING_KEYS.has(key)) return;
  await runAsRemoteApply(async () => {
    await db.settings.put({ key, value: data.value });
  });
  lastSentSig.delete(`tableOrders/${docId}`);
}

async function applySale(doc: any, updateTime: string): Promise<void> {
  const cloudId = documentId(doc.name);
  const data = decodeFields(doc.fields ?? {});
  const box = await getOutbox();
  const pendingLocalIds = new Set(box.upserts.sales ?? []);

  const existingByCloud = await db.sales.where('cloudId').equals(cloudId).first();
  if (existingByCloud?.id) {
    if (pendingLocalIds.has(String(existingByCloud.id)) || pushes.has(`sales/${existingByCloud.id}`)) {
      return;
    }
    await runAsRemoteApply(async () => {
      const patch: Partial<Sale> = {
        kitchenStatus: data.kitchenStatus,
        deliveryStatus: data.deliveryStatus,
        refundedAmount: data.refundedAmount,
        refundStatus: data.refundStatus,
        refunds: data.refunds,
        lockedCost: data.lockedCost,
        updatedAt: toIso(data.updatedAt) ?? toIso(updateTime),
      };
      if (Array.isArray(data.items)) patch.items = data.items;
      await db.sales.update(existingByCloud.id!, patch);
    });
    return;
  }

  // A poll can overtake the push's `cloudId` write-back. The local row is the
  // same sale when the ids collide *and* the figures agree — another till can
  // legitimately hold a different sale under the same numeric id.
  const known = Number(data.localId) ? await db.sales.get(Number(data.localId)) : undefined;
  if (known?.id && known.timestamp === toIso(data.createdAt) && Number(known.total) === Number(data.total ?? known.total)) {
    if (!known.cloudId) {
      await runAsRemoteApply(() => db.sales.update(known.id!, { cloudId }));
    }
    return;
  }

  await runAsRemoteApply(async () => {
    await db.sales.add({ ...cloudSaleToLocal(cloudId, data), id: undefined });
  });
}

async function applyOnlineOrder(doc: any): Promise<void> {
  const cloudId = documentId(doc.name);
  const order = cloudOrderToLocal(cloudId, decodeFields(doc.fields ?? {}));
  const local = await db.onlineOrders.where('cloudId').equals(cloudId).first();
  await runAsRemoteApply(async () => {
    if (local?.id) {
      await db.onlineOrders.put({ ...order, id: local.id });
    } else {
      await db.onlineOrders.add(order);
    }
  });
}

function inFlightKeys(collection: string): string[] {
  const prefix = `${collection}/`;
  const ids: string[] = [];
  for (const key of pushes.keys()) {
    if (key.startsWith(prefix)) ids.push(key.slice(prefix.length));
  }
  return ids;
}

function touchedSince(collection: string, sinceEpoch: number): string[] {
  const prefix = `${collection}/`;
  const ids: string[] = [];
  for (const [key, epoch] of recentlyPushed.entries()) {
    if (epoch > sinceEpoch && key.startsWith(prefix)) {
      ids.push(key.slice(prefix.length));
    }
  }
  return ids;
}

async function pushByCollection(collection: MirrorCollection | 'tableOrders', docId: string): Promise<void> {
  if (collection === 'tableOrders') {
    if (docId.startsWith(SETTING_PREFIX)) {
      await pushSetting(docId.slice(SETTING_PREFIX.length));
    }
    return;
  }
  if (collection === 'categories') return pushCategory(docId);
  if (collection === 'menu') return pushMenu(docId);
  if (collection === 'inventory') return pushInventory(docId);
  return pushMirrorDoc(collection, docId);
}

async function deleteRemovedLocal(collection: MirrorCollection | 'tableOrders', removed: string[]): Promise<void> {
  if (!removed.length) return;
  await runAsRemoteApply(async () => {
    if (collection === 'tableOrders') {
      for (const docId of removed) {
        if (isSyncedSettingDocId(docId)) {
          await db.settings.delete(docId.slice(SETTING_PREFIX.length));
          lastSentSig.delete(`tableOrders/${docId}`);
        }
      }
      return;
    }
    const table = mirrorTable(collection);
    if (!table) return;
    for (const rawId of removed) {
      const key = localMirrorKey(collection, rawId);
      if (key === null) continue;
      await table.delete(key);
      if (collection === 'menu') {
        await db.recipes.where('menuItemId').equals(rawId).delete();
      }
      lastSentSig.delete(`${collection}/${rawId}`);
    }
  });
}

async function applyDoc(collection: string, doc: any, updateTime: string): Promise<void> {
  if (collection === 'sales') return applySale(doc, updateTime);
  if (collection === 'onlineOrders') return applyOnlineOrder(doc);
  if (collection === 'tableOrders') return applySyncedSetting(doc);
  if (isMirrorCollection(collection)) return applyMirrorDoc(collection, doc, updateTime);
}

async function applyVoidedSales(voidedSaleIds: string[], snap: Snapshot): Promise<boolean> {
  const freshIds = voidedSaleIds.filter((id) => !appliedVoidIds.has(id));
  if (!freshIds.length) return false;

  const box = await getOutbox();
  const protectedIds = new Set<string>([
    ...(box.upserts.sales ?? []),
    ...(box.deletes.sales ?? []),
    ...inFlightKeys('sales'),
  ]);

  let removed = false;
  await runAsRemoteApply(async () => {
    for (const cloudId of freshIds) {
      if (protectedIds.has(cloudId)) continue;
      const existing = await db.sales.where('cloudId').equals(cloudId).first();
      if (existing) {
        if (existing.id && (protectedIds.has(String(existing.id)) || pushes.has(`sales/${existing.id}`))) {
          continue;
        }
        await db.sales.where('cloudId').equals(cloudId).delete();
        removed = true;
      }
      appliedVoidIds.add(cloudId);
      if (snap.sales && cloudId in snap.sales) {
        delete snap.sales[cloudId];
        removed = true;
      }
    }
  });
  return removed;
}

function docFieldStamp(doc: any, fieldPath: string): string | undefined {
  const raw = decodeValue(doc?.fields?.[fieldPath]);
  return toIso(raw) ?? (fieldPath === 'updatedAt' ? toIso(decodeValue(doc?.fields?.createdAt)) : undefined) ?? toIso(doc?.updateTime);
}

function maxIsoStamp(docs: any[], fieldPath: string, current?: string): string {
  let maxMs = current ? Date.parse(current) : Number.NaN;
  let best = Number.isNaN(maxMs) ? '' : current!;
  for (const doc of docs) {
    const stamp = docFieldStamp(doc, fieldPath);
    if (!stamp) continue;
    const ms = Date.parse(stamp);
    if (!Number.isNaN(ms) && (Number.isNaN(maxMs) || ms > maxMs)) {
      maxMs = ms;
      best = stamp;
    }
  }
  return best || current || new Date().toISOString();
}

async function pullOnlineOrders(snap: Snapshot): Promise<'changed' | 'unchanged' | 'error'> {
  const pullStartEpoch = pushEpoch;
  const preInFlight = inFlightKeys('onlineOrders');
  const preSnap = snap.onlineOrders;
  const docs = await runStructuredQuery(buildActiveOnlineOrdersQuery());
  if (docs === null) return 'error';

  const box = await getOutbox();
  const touched = new Set([
    ...preInFlight,
    ...inFlightKeys('onlineOrders'),
    ...touchedSince('onlineOrders', pullStartEpoch),
  ]);
  const protectedIds = new Set([...(box.deletes.onlineOrders ?? []), ...(box.upserts.onlineOrders ?? []), ...touched]);

  const seenMap = preSnap ?? {};
  const remote: Record<string, string> = {};
  for (const doc of docs) {
    remote[documentId(doc.name)] = doc.updateTime ?? '';
  }

  const changed = Object.keys(remote).filter(
    (id) => remote[id] !== seenMap[id] && !protectedIds.has(id),
  );

  const byId = new Map(docs.map((d) => [documentId(d.name), d]));
  let didChange = changed.length > 0;
  for (const id of changed) {
    const doc = byId.get(id) ?? (await fetchDoc('onlineOrders', id));
    if (isRateLimited()) return 'error';
    if (doc?.fields) await applyOnlineOrder(doc);
  }

  // If a locally active order no longer matches the active status query, fetch that single
  // document so transitions to COMPLETED or REJECTED propagate without scanning history.
  const localOrders = typeof db.onlineOrders?.toArray === 'function' ? await db.onlineOrders.toArray() : [];
  const returnedIds = new Set(Object.keys(remote));
  for (const local of localOrders) {
    if (!local.cloudId || !ACTIVE_ONLINE_STATUS_SET.has(local.status) || returnedIds.has(local.cloudId)) continue;
    if (protectedIds.has(local.cloudId)) continue;
    const doc = await rest('GET', url(`onlineOrders/${encodeURIComponent(local.cloudId)}`), undefined, {
      allowNotFound: true,
    });
    if (doc === null) return 'error';
    if (doc.__notFound) continue;
    if (doc?.fields) {
      await applyOnlineOrder(doc);
      remote[local.cloudId] = doc.updateTime ?? '';
      didChange = true;
    }
  }

  const snapshotInitialized = preSnap === undefined;
  if (!didChange && !snapshotInitialized) return 'unchanged';

  const nextSnap: Record<string, string> = { ...(preSnap ?? {}) };
  for (const [id, time] of Object.entries(remote)) {
    if (!protectedIds.has(id)) nextSnap[id] = time;
  }
  snap.onlineOrders = nextSnap;
  return 'changed';
}

async function pullIncrementalCollection(
  collection: 'sales' | 'auditLogs',
  fieldPath: string,
  snap: Snapshot,
  watermarks: Watermarks,
): Promise<{ outcome: 'changed' | 'unchanged' | 'error'; watermarkUpdated: boolean }> {
  const pullStartEpoch = pushEpoch;
  const preInFlight = inFlightKeys(collection);
  const preSnap = snap[collection];
  const preWatermark = watermarks[collection];

  if (preWatermark && preSnap !== undefined) {
    const sinceIso = computeWatermarkQueryFloor(preWatermark, INCREMENTAL_OVERLAP_MS);
    const docs = await runStructuredQuery(buildIncrementalQuery(collection, fieldPath, sinceIso));
    if (docs === null) return { outcome: 'error', watermarkUpdated: false };

    const box = await getOutbox();
    const touched = new Set([
      ...preInFlight,
      ...inFlightKeys(collection),
      ...touchedSince(collection, pullStartEpoch),
    ]);
    const protectedIds = new Set([
      ...(box.deletes[collection] ?? []),
      ...(box.upserts[collection] ?? []),
      ...touched,
    ]);

    const remote: Record<string, string> = {};
    for (const doc of docs) {
      remote[documentId(doc.name)] = doc.updateTime ?? '';
    }

    const changed = Object.keys(remote).filter(
      (id) => remote[id] !== preSnap[id] && !protectedIds.has(id),
    );
    const byId = new Map(docs.map((d) => [documentId(d.name), d]));
    for (const id of changed) {
      const doc = byId.get(id);
      if (doc?.fields) await applyDoc(collection, doc, remote[id]);
    }

    const nextWatermark = maxIsoStamp(docs, fieldPath, preWatermark);
    const watermarkUpdated = nextWatermark !== preWatermark;
    if (watermarkUpdated) watermarks[collection] = nextWatermark;

    if (!changed.length) {
      return { outcome: 'unchanged', watermarkUpdated };
    }

    const nextSnap: Record<string, string> = { ...preSnap };
    for (const [id, time] of Object.entries(remote)) {
      if (!protectedIds.has(id)) nextSnap[id] = time;
    }
    snap[collection] = nextSnap;
    return { outcome: 'changed', watermarkUpdated };
  }

  // First sync on this device: do one full pull to initialize snapshot + watermark.
  const preSeenKeys = preSnap !== undefined ? Object.keys(preSnap) : undefined;
  const meta = await metadata(collection);
  if (!meta) return { outcome: 'error', watermarkUpdated: false };

  const { times: remote, docs } = meta;
  const seenMap = preSnap ?? {};
  const box = await getOutbox();
  const touched = new Set([
    ...preInFlight,
    ...inFlightKeys(collection),
    ...touchedSince(collection, pullStartEpoch),
  ]);
  const protectedIds = new Set([
    ...(box.deletes[collection] ?? []),
    ...(box.upserts[collection] ?? []),
    ...touched,
  ]);

  const changed = Object.keys(remote).filter(
    (id) => remote[id] !== seenMap[id] && !protectedIds.has(id),
  );

  let removed: string[] = [];
  let shouldBootstrapCloud = false;
  let localKeys: string[] = [];

  if (collection === 'auditLogs') {
    localKeys = await localPrimaryKeys('auditLogs');
    const reconciled = reconcileMirrorCollection({
      remoteIds: Object.keys(remote),
      seenIds: preSeenKeys,
      localIds: localKeys,
      pendingUpsertIds: new Set([...(box.upserts.auditLogs ?? []), ...touched]),
    });
    removed = reconciled.toDelete;
    shouldBootstrapCloud = reconciled.shouldBootstrapCloud;
  } else if (collection === 'sales' && preSeenKeys !== undefined) {
    const voidedCloudIds = preSeenKeys.filter(
      (cloudId) => !(cloudId in remote) && !protectedIds.has(cloudId),
    );
    if (voidedCloudIds.length > 0) {
      await runAsRemoteApply(async () => {
        for (const cloudId of voidedCloudIds) {
          await db.sales.where('cloudId').equals(cloudId).delete();
        }
      });
      removed = voidedCloudIds;
    }
  }

  if (shouldBootstrapCloud && collection === 'auditLogs') {
    snap.auditLogs = mergePulledSnapshot(remote, snap.auditLogs, protectedIds);
    await runWithConcurrency(localKeys, PULL_CONCURRENCY, (id) => pushByCollection('auditLogs', id));
    const afterBox = await getOutbox();
    const hasPending =
      (afterBox.upserts.auditLogs?.length ?? 0) > 0 || (afterBox.deletes.auditLogs?.length ?? 0) > 0;
    watermarks.auditLogs = new Date().toISOString();
    return { outcome: hasPending ? 'error' : 'changed', watermarkUpdated: true };
  }

  const snapshotInitialized = preSnap === undefined;
  const byId = new Map(docs.map((d) => [documentId(d.name), d]));
  for (const id of changed) {
    const doc = byId.get(id) ?? (await fetchDoc(collection, id));
    if (isRateLimited()) return { outcome: 'error', watermarkUpdated: false };
    if (doc?.fields) await applyDoc(collection, doc, remote[id]);
  }

  if (collection === 'auditLogs' && removed.length > 0) {
    await deleteRemovedLocal('auditLogs', removed);
  }

  snap[collection] = mergePulledSnapshot(remote, snap[collection], protectedIds);
  const nextWatermark = maxIsoStamp(docs, fieldPath, preWatermark);
  const watermarkUpdated = nextWatermark !== preWatermark;
  watermarks[collection] = nextWatermark;

  const didChange = changed.length > 0 || removed.length > 0 || snapshotInitialized;
  return { outcome: didChange ? 'changed' : 'unchanged', watermarkUpdated };
}

async function pullCollection(collection: string, snap: Snapshot): Promise<'changed' | 'unchanged' | 'error'> {
  const pullStartEpoch = pushEpoch;
  const preInFlight = inFlightKeys(collection);
  const preSnap = snap[collection];
  const preSeenKeys = preSnap !== undefined ? Object.keys(preSnap) : undefined;
  const meta = await metadata(collection);
  if (!meta) return 'error';
  const { times: remote, docs } = meta;
  const seen = preSnap;
  const seenMap = seen ?? {};
  const box = await getOutbox();
  const pendingDeletes = new Set(box.deletes[collection] ?? []);
  const touched = new Set([
    ...preInFlight,
    ...inFlightKeys(collection),
    ...touchedSince(collection, pullStartEpoch),
  ]);
  const pendingUpserts = new Set([...(box.upserts[collection] ?? []), ...touched]);
  const protectedIds = new Set([...pendingDeletes, ...pendingUpserts]);

  const changed = Object.keys(remote).filter(
    (id) => remote[id] !== seenMap[id] && !protectedIds.has(id),
  );

  let removed: string[] = [];
  let shouldBootstrapCloud = false;
  let localKeys: string[] = [];
  const mirrorLike = isMirrorCollection(collection) || collection === 'tableOrders';

  if (mirrorLike) {
    localKeys =
      collection === 'tableOrders'
        ? await localSettingDocIds()
        : await localPrimaryKeys(collection as MirrorCollection);
    const reconciled = reconcileMirrorCollection({
      remoteIds: Object.keys(remote),
      seenIds: preSeenKeys,
      localIds: localKeys,
      pendingUpsertIds: pendingUpserts,
    });
    removed = reconciled.toDelete;
    shouldBootstrapCloud = reconciled.shouldBootstrapCloud;
  }

  if (collection === 'categories') {
    await db.settings.put({ key: CATEGORIES_INITIALIZED_KEY, value: 'true' });
  }

  if (shouldBootstrapCloud && mirrorLike) {
    snap[collection] = mergePulledSnapshot(remote, snap[collection], protectedIds);
    const target = collection as MirrorCollection | 'tableOrders';
    await runWithConcurrency(localKeys, PULL_CONCURRENCY, (id) => pushByCollection(target, id));
    const afterBox = await getOutbox();
    const hasPending =
      (afterBox.upserts[collection]?.length ?? 0) > 0 || (afterBox.deletes[collection]?.length ?? 0) > 0;
    return hasPending ? 'error' : 'changed';
  }

  const snapshotInitialized = seen === undefined;
  if (!changed.length && !removed.length && !snapshotInitialized) return 'unchanged';

  const byId = new Map(docs.map((d) => [documentId(d.name), d]));

  for (const id of changed) {
    const doc = byId.get(id) ?? (await fetchDoc(collection, id));
    if (isRateLimited()) return 'error';
    if (doc?.fields) await applyDoc(collection, doc, remote[id]);
  }

  if (mirrorLike && removed.length > 0) {
    await deleteRemovedLocal(collection as MirrorCollection | 'tableOrders', removed);
  }

  snap[collection] = mergePulledSnapshot(remote, snap[collection], protectedIds);
  return changed.length > 0 || removed.length > 0 || snapshotInitialized ? 'changed' : 'unchanged';
}

/** Retries any pending offline/failed pushes with bounded concurrency; stops early on 429. */
async function flushOutbox(): Promise<{ hadError: boolean; flushedTier2: boolean }> {
  const box = await getOutbox();
  if (!hasPendingOutbox(box)) return { hadError: false, flushedTier2: false };

  const jobs: Array<() => Promise<void>> = [];
  let flushedTier2 = false;

  for (const collection of MIRROR_COLLECTIONS) {
    const ids = new Set([...(box.deletes[collection] ?? []), ...(box.upserts[collection] ?? [])]);
    if (ids.size > 0 && (TIER2_COLLECTIONS as readonly string[]).includes(collection)) {
      flushedTier2 = true;
    }
    for (const id of ids) {
      jobs.push(() => pushByCollection(collection, id));
    }
  }

  for (const docId of new Set([...(box.deletes.tableOrders ?? []), ...(box.upserts.tableOrders ?? [])])) {
    jobs.push(() => pushByCollection('tableOrders', docId));
  }

  for (const localIdStr of box.upserts.sales ?? []) {
    const localId = Number(localIdStr);
    if (Number.isFinite(localId) && localId > 0) jobs.push(() => pushSale(localId));
  }

  for (const cloudId of box.deletes.sales ?? []) {
    jobs.push(() => deleteSale(cloudId));
  }

  await runWithConcurrency(jobs, OUTBOX_CONCURRENCY, (run) => run());

  const remaining = await getOutbox();
  return { hadError: hasPendingOutbox(remaining), flushedTier2 };
}

let inFlight: Promise<boolean> | null = null;
let tier2Initialized = false;
let lastOnlineOrdersPullAt = 0;

function normalizeSyncArgs(arg: boolean | SyncOptions): Required<Pick<SyncOptions, 'mode' | 'includeTier2' | 'manual'>> & {
  collections?: readonly string[];
} {
  if (typeof arg === 'boolean') {
    return { mode: 'full', includeTier2: arg, manual: false };
  }
  return {
    mode: arg.mode ?? 'full',
    includeTier2: arg.includeTier2 ?? true,
    collections: arg.collections,
    manual: arg.manual ?? false,
  };
}

/** Flushes queued local writes, polls `tableOrders/sync_versions_v1`, and pulls only dirty/due collections. */
export function syncNow(options: boolean | SyncOptions = true): Promise<boolean> {
  const opts = normalizeSyncArgs(options);
  inFlight ??= (async () => {
    if (!isSyncEnabled()) {
      setStatus({ state: 'off', rateLimited: false, retryAt: undefined });
      return false;
    }

    if (isRateLimited()) {
      if (opts.manual && Date.now() - lastRateLimitAt >= 5_000) {
        // Allow one explicit manual probe after 5s while preserving streak for exponential backoff.
        rateLimitUntil = 0;
      } else {
        return false;
      }
    }

    setStatus({ state: 'syncing', error: undefined, rateLimited: false, retryAt: undefined });

    const outboxResult = await flushOutbox();
    let hadError = outboxResult.hadError;
    if (isRateLimited()) return false;

    if (pendingDirtyCollections.size > 0 || pendingVoidManifestFlush) {
      await flushVersionManifest();
    }
    if (isRateLimited()) return false;

    const manifest = await fetchSyncVersions();
    if (manifest === null) {
      return false;
    }

    const snap = await getSnapshot();
    const watermarks = await getWatermarks();
    const seenVersions = await getSeenVersions();
    const deviceId = await getDeviceId();

    const voidsRemoved = await applyVoidedSales(manifest.voidedSaleIds, snap);
    let changed = voidsRemoved;
    let watermarksChanged = false;

    let collectionsToPull: string[];
    const pullTier2 = opts.includeTier2 || !tier2Initialized || outboxResult.flushedTier2;
    if (opts.collections?.length) {
      collectionsToPull = [...new Set(opts.collections)];
    } else if (opts.mode === 'poll') {
      const pullSet = new Set(diffRemoteVersions(manifest.collections, seenVersions, deviceId, ALL_COLLECTIONS));
      if (opts.manual || Date.now() - lastOnlineOrdersPullAt >= ONLINE_ORDERS_MIN_INTERVAL_MS) {
        pullSet.add('onlineOrders');
      }
      collectionsToPull = [...pullSet];
    } else {
      collectionsToPull = [...(pullTier2 ? ALL_COLLECTIONS : TIER1_COLLECTIONS)];
    }

    const succeededCollections: string[] = [];

    await runWithConcurrency(collectionsToPull, PULL_CONCURRENCY, async (collection) => {
      try {
        let outcome: 'changed' | 'unchanged' | 'error';
        if (collection === 'onlineOrders') {
          outcome = await pullOnlineOrders(snap);
          if (outcome !== 'error') lastOnlineOrdersPullAt = Date.now();
        } else if (collection === 'sales') {
          const res = await pullIncrementalCollection('sales', 'updatedAt', snap, watermarks);
          outcome = res.outcome;
          if (res.watermarkUpdated) watermarksChanged = true;
        } else if (collection === 'auditLogs') {
          const res = await pullIncrementalCollection('auditLogs', 'timestamp', snap, watermarks);
          outcome = res.outcome;
          if (res.watermarkUpdated) watermarksChanged = true;
        } else {
          outcome = await pullCollection(collection, snap);
        }

        if (outcome === 'changed') {
          changed = true;
          succeededCollections.push(collection);
        } else if (outcome === 'unchanged') {
          succeededCollections.push(collection);
        } else {
          hadError = true;
        }
      } catch (err) {
        hadError = true;
        if (!isRateLimited()) {
          setStatus({
            state: 'error',
            rateLimited: false,
            retryAt: undefined,
            error: err instanceof Error ? err.message : 'pull failed',
          });
        }
      }
    });

    // If initial cloud seeding dirtied collections during pull, publish manifest right away.
    if ((pendingDirtyCollections.size > 0 || pendingVoidManifestFlush) && !isRateLimited()) {
      await flushVersionManifest();
    }

    if (opts.mode === 'full' && pullTier2 && !hadError) tier2Initialized = true;
    if (changed) {
      lastActivityAt = Date.now();
      await writeSnapshot(snap);
    }
    if (watermarksChanged) {
      await writeWatermarks(watermarks);
    }
    if (succeededCollections.length > 0 || !(await db.settings.get(VERSIONS_KEY))) {
      const nextSeen = mergeSeenVersions(seenVersions, manifest.collections, succeededCollections);
      if (
        succeededCollections.length > 0 ||
        JSON.stringify(nextSeen) !== JSON.stringify(seenVersions)
      ) {
        await writeSeenVersions(nextSeen);
      }
    }

    if (isRateLimited()) return changed;

    if (!hadError && isSyncEnabled()) {
      setStatus({ state: 'idle', lastSync: Date.now(), error: undefined, rateLimited: false, retryAt: undefined });
    } else if (hadError && isSyncEnabled() && status.state === 'syncing') {
      setStatus({
        state: 'error',
        rateLimited: false,
        retryAt: undefined,
        error: status.error ?? 'Pending changes could not sync',
      });
    }
    return changed;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/* ------------------------------------------- leader lease, hooks & scheduler */

const tabId = `t_${Math.random().toString(36).slice(2, 10)}`;

function isTabHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true;
}

function tryAcquireLeaderLease(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    const raw = localStorage.getItem(LEADER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabId?: string; expiresAt?: number };
      if (parsed.tabId && parsed.tabId !== tabId && Number(parsed.expiresAt) > Date.now()) {
        return false;
      }
    }
    localStorage.setItem(LEADER_KEY, JSON.stringify({ tabId, expiresAt: Date.now() + LEADER_TTL_MS }));
    return true;
  } catch {
    return true;
  }
}

function releaseLeaderLease(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(LEADER_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { tabId?: string };
    if (parsed.tabId === tabId) localStorage.removeItem(LEADER_KEY);
  } catch {
    // Ignore malformed lease.
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let syncRunning = false;
let syncSessionSeq = 0;
let hooksInstalled = false;
const txPending = new WeakMap<object, Map<string, () => void>>();

function queueAfterCommit(tx: Transaction | undefined, dedupeKey: string, action: () => void): void {
  if (!tx || typeof tx.on !== 'function') {
    setTimeout(() => {
      if (isSyncEnabled()) action();
    }, 0);
    return;
  }
  let jobs = txPending.get(tx);
  if (!jobs) {
    jobs = new Map();
    txPending.set(tx, jobs);
    tx.on('complete', () => {
      const queued = txPending.get(tx);
      txPending.delete(tx);
      if (!queued || !isSyncEnabled()) return;
      for (const fn of queued.values()) fn();
    });
  }
  jobs.set(dedupeKey, action);
}

/** Attaches idempotent Dexie hooks so every local CRUD write pushes immediately to Firestore. */
export function installSyncHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  for (const collection of MIRROR_COLLECTIONS) {
    const table = mirrorTable(collection);
    if (!table || typeof table.hook !== 'function') continue;

    table.hook('creating', function (primKey, _obj, transaction) {
      if (remoteApplyDepth > 0 || !isSyncEnabled()) return;
      this.onsuccess = (resolvedKey) => {
        const key = resolvedKey ?? primKey;
        if (key === undefined || key === null) return;
        const id = String(key);
        queueAfterCommit(transaction, `${collection}/${id}`, () => {
          void pushByCollection(collection, id);
        });
      };
    });

    table.hook('updating', function (_mods, primKey, _obj, transaction) {
      if (remoteApplyDepth > 0 || !isSyncEnabled()) return;
      this.onsuccess = () => {
        if (primKey === undefined || primKey === null) return;
        const id = String(primKey);
        queueAfterCommit(transaction, `${collection}/${id}`, () => {
          void pushByCollection(collection, id);
        });
      };
    });

    table.hook('deleting', function (primKey, _obj, transaction) {
      if (remoteApplyDepth > 0 || !isSyncEnabled()) return;
      this.onsuccess = () => {
        if (primKey === undefined || primKey === null) return;
        const id = String(primKey);
        queueAfterCommit(transaction, `${collection}/${id}`, () => {
          void pushByCollection(collection, id);
        });
      };
    });
  }

  if (typeof db.sales?.hook === 'function') {
    db.sales.hook('creating', function (primKey, _obj, transaction) {
      if (remoteApplyDepth > 0 || !isSyncEnabled()) return;
      this.onsuccess = (resolvedKey) => {
        const numKey = Number(resolvedKey ?? primKey);
        if (!Number.isFinite(numKey) || numKey <= 0) return;
        queueAfterCommit(transaction, `sales/${numKey}`, () => {
          void pushSale(numKey);
        });
      };
    });

    db.sales.hook('updating', function (_mods, primKey, _obj, transaction) {
      if (remoteApplyDepth > 0 || !isSyncEnabled()) return;
      this.onsuccess = () => {
        const numKey = Number(primKey);
        if (!Number.isFinite(numKey) || numKey <= 0) return;
        queueAfterCommit(transaction, `sales/${numKey}`, () => {
          void pushSale(numKey);
        });
      };
    });

    db.sales.hook('deleting', function (_primKey, obj, transaction) {
      if (remoteApplyDepth > 0 || !isSyncEnabled()) return;
      const cloudId = obj?.cloudId;
      if (!cloudId) return;
      this.onsuccess = () => {
        queueAfterCommit(transaction, `sales/del/${cloudId}`, () => {
          void deleteSale(cloudId);
        });
      };
    });
  }

  if (typeof db.settings?.hook === 'function') {
    const scheduleSetting = (key: string, transaction: Transaction | undefined) => {
      if (!SYNCED_SETTING_KEYS.has(key)) return;
      queueAfterCommit(transaction, `tableOrders/${SETTING_PREFIX}${key}`, () => {
        void pushSetting(key);
      });
    };

    db.settings.hook('creating', function (primKey, obj, transaction) {
      if (remoteApplyDepth > 0 || !isSyncEnabled()) return;
      const key = String(primKey ?? obj?.key ?? '');
      this.onsuccess = () => scheduleSetting(key, transaction);
    });

    db.settings.hook('updating', function (_mods, primKey, obj, transaction) {
      if (remoteApplyDepth > 0 || !isSyncEnabled()) return;
      const key = String(primKey ?? obj?.key ?? '');
      this.onsuccess = () => scheduleSetting(key, transaction);
    });

    db.settings.hook('deleting', function (primKey, obj, transaction) {
      if (remoteApplyDepth > 0 || !isSyncEnabled()) return;
      const key = String(primKey ?? obj?.key ?? '');
      this.onsuccess = () => scheduleSetting(key, transaction);
    });
  }
}

function nextPollDelayMs(): number {
  if (isRateLimited()) {
    return Math.max(1_000, rateLimitUntil - Date.now() + 500);
  }
  const idleFor = Date.now() - lastActivityAt;
  return idleFor >= IDLE_AFTER_MS ? IDLE_POLL_MS : ACTIVE_POLL_MS;
}

function scheduleNextPoll(): void {
  if (!syncRunning) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runScheduledPoll();
  }, nextPollDelayMs());
}

async function runScheduledPoll(): Promise<void> {
  if (!syncRunning) return;
  if (!isTabHidden() && tryAcquireLeaderLease()) {
    await syncNow({ mode: 'poll' });
  }
  scheduleNextPoll();
}

function wakeIfStale(): void {
  if (isTabHidden() || isRateLimited()) return;
  if (status.lastSync && Date.now() - status.lastSync < WAKE_MIN_INTERVAL_MS) return;
  if (!tryAcquireLeaderLease()) return;
  void syncNow({ mode: 'poll' });
}

function wake(): void {
  if (isTabHidden() || isRateLimited()) return;
  if (!tryAcquireLeaderLease()) return;
  void syncNow({ mode: 'poll' });
}

function handlePageHide(): void {
  if (pendingDirtyCollections.size > 0 || pendingVoidManifestFlush) {
    void flushVersionManifest();
  }
  releaseLeaderLease();
}

export function startSync(): void {
  if (syncRunning) return;
  if (!isSyncEnabled()) {
    setStatus({ state: 'off', rateLimited: false, retryAt: undefined });
    return;
  }
  installSyncHooks();
  syncRunning = true;
  tier2Initialized = false;
  lastActivityAt = Date.now();
  const sessionSeq = ++syncSessionSeq;

  scheduleNextPoll();

  if (typeof window !== 'undefined') {
    window.addEventListener('online', wake);
    window.addEventListener('focus', wakeIfStale);
    window.addEventListener('pagehide', handlePageHide);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', wakeIfStale);
  }

  void (async () => {
    const [hasSnap, hasVer] = await Promise.all([db.settings.get(SNAPSHOT_KEY), db.settings.get(VERSIONS_KEY)]);
    if (!syncRunning || sessionSeq !== syncSessionSeq) return;
    if (isTabHidden()) return;
    const returningDevice = Boolean(hasSnap?.value && hasVer?.value);
    if (returningDevice) {
      await syncNow({ mode: 'poll' });
    } else {
      await syncNow({ mode: 'full', includeTier2: true });
    }
  })();
}

export function stopSync(): void {
  syncRunning = false;
  syncSessionSeq += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  if (manifestTimer) clearTimeout(manifestTimer);
  manifestTimer = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wakeIfStale);
    window.removeEventListener('pagehide', handlePageHide);
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', wakeIfStale);
  }
  releaseLeaderLease();
}

/* -------------------------------------------------------------------- push */

const pushes = new Map<string, Promise<void>>();
const lastSentSig = new Map<string, string>();
let pushEpoch = 0;
const recentlyPushed = new Map<string, number>();

function recordPushTouch(key: string): void {
  recentlyPushed.set(key, ++pushEpoch);
  if (recentlyPushed.size > 500) {
    const oldest = recentlyPushed.keys().next().value;
    if (oldest !== undefined) recentlyPushed.delete(oldest);
  }
}

/** Serialises pushes per document so a burst of edits cannot land out of order. */
function enqueue(key: string, task: () => Promise<void>): Promise<void> {
  recordPushTouch(key);
  const previous = pushes.get(key) ?? Promise.resolve();
  const next = previous.then(task).catch(() => undefined);
  pushes.set(key, next);
  void next.finally(() => {
    recordPushTouch(key);
    if (pushes.get(key) === next) pushes.delete(key);
  });
  return next;
}

async function rememberPush(collection: string, id: string, response: any): Promise<void> {
  if (!response?.updateTime) return;
  const snap = await getSnapshot();
  snap[collection] = { ...(snap[collection] ?? {}), [id]: response.updateTime };
  await writeSnapshot(snap);
}

async function forgetPush(collection: string, id: string): Promise<void> {
  const snap = await getSnapshot();
  if (snap[collection] && id in snap[collection]) {
    const nextCol = { ...snap[collection] };
    delete nextCol[id];
    snap[collection] = nextCol;
    await writeSnapshot(snap);
  }
}

function stripOversizedImages(payload: Record<string, unknown>): void {
  for (const field of ['imageUrl', 'receiptImage'] as const) {
    if (typeof payload[field] === 'string' && (payload[field] as string).length > MAX_SYNCED_IMAGE_BYTES) {
      delete payload[field];
    }
  }
}

function pushMirrorDoc(collection: MirrorCollection, id: string): Promise<void> {
  const queueKey = `${collection}/${id}`;
  return enqueue(queueKey, async () => {
    if (!isSyncEnabled()) return;
    const table = mirrorTable(collection);
    if (!table) return;

    const lookupKey = localMirrorKey(collection, id);
    const row = lookupKey === null ? undefined : await table.get(lookupKey);
    const box = await getOutbox();

    if (!row) {
      const pendingDel = (box.deletes[collection] ?? []).includes(id);
      if (lastSentSig.get(queueKey) === '__DELETED__' && !pendingDel) return;
      await markOutbox(collection, id, 'delete');
      const res = await rest('DELETE', url(`${collection}/${encodeURIComponent(id)}`));
      if (res !== null) {
        lastSentSig.set(queueKey, '__DELETED__');
        await clearOutbox(collection, id, 'delete');
        await forgetPush(collection, id);
        markCollectionDirty(collection);
      }
      return;
    }

    const payload: Record<string, unknown> = { ...row };
    if (collection === 'menu') {
      const recipes = await db.recipes.where('menuItemId').equals(id).toArray();
      payload.recipes = recipes.map((r) => ({ inventoryId: r.inventoryId, qtyRequired: r.qtyRequired }));
    }
    stripOversizedImages(payload);

    const sig = JSON.stringify(payload);
    const pendingUp = (box.upserts[collection] ?? []).includes(id);
    if (lastSentSig.get(queueKey) === sig && !pendingUp) return;

    await markOutbox(collection, id, 'upsert');
    const res = await rest('PATCH', url(`${collection}/${encodeURIComponent(id)}`), { fields: encodeFields(payload) });
    if (res !== null) {
      lastSentSig.set(queueKey, sig);
      await clearOutbox(collection, id, 'upsert');
      await rememberPush(collection, id, res);
      markCollectionDirty(collection);
    }
  });
}

export function pushMenu(id: string): Promise<void> {
  return pushMirrorDoc('menu', id);
}

export function pushCategory(id: string): Promise<void> {
  return pushMirrorDoc('categories', id);
}

export function pushInventory(id: string): Promise<void> {
  return pushMirrorDoc('inventory', id);
}

/** Syncs a shared shop setting document under `tableOrders/setting_<key>`. */
export function pushSetting(key: string): Promise<void> {
  if (!SYNCED_SETTING_KEYS.has(key)) return Promise.resolve();
  const docId = `${SETTING_PREFIX}${key}`;
  const queueKey = `tableOrders/${docId}`;
  return enqueue(queueKey, async () => {
    if (!isSyncEnabled()) return;
    const row = await db.settings.get(key);
    const box = await getOutbox();

    if (!row) {
      const pendingDel = (box.deletes.tableOrders ?? []).includes(docId);
      if (lastSentSig.get(queueKey) === '__DELETED__' && !pendingDel) return;
      await markOutbox('tableOrders', docId, 'delete');
      const res = await rest('DELETE', url(`tableOrders/${encodeURIComponent(docId)}`));
      if (res !== null) {
        lastSentSig.set(queueKey, '__DELETED__');
        await clearOutbox('tableOrders', docId, 'delete');
        await forgetPush('tableOrders', docId);
        markCollectionDirty('tableOrders');
      }
      return;
    }

    const payload = { key: row.key, value: row.value };
    const sig = JSON.stringify(payload);
    const pendingUp = (box.upserts.tableOrders ?? []).includes(docId);
    if (lastSentSig.get(queueKey) === sig && !pendingUp) return;

    await markOutbox('tableOrders', docId, 'upsert');
    const res = await rest('PATCH', url(`tableOrders/${encodeURIComponent(docId)}`), {
      fields: encodeFields({ ...payload, updatedAt: new Date().toISOString() }),
    });
    if (res !== null) {
      lastSentSig.set(queueKey, sig);
      await clearOutbox('tableOrders', docId, 'upsert');
      await rememberPush('tableOrders', docId, res);
      markCollectionDirty('tableOrders');
    }
  });
}

/** Pushes a new sale (`POST`) or updates an existing cloud sale (`PATCH`, e.g. KDS status, refund, lockedCost). */
export function pushSale(localId: number): Promise<void> {
  const queueKey = `sales/${localId}`;
  return enqueue(queueKey, async () => {
    if (!isSyncEnabled()) return;
    const sale = await db.sales.get(localId);
    if (!sale) {
      await clearOutbox('sales', String(localId), 'upsert');
      return;
    }

    const { id: _id, cloudId, ...payload } = sale;
    const bodyPayload = {
      ...payload,
      localId,
      createdAt: sale.createdAt ?? sale.timestamp,
      updatedAt: new Date().toISOString(),
    };
    const sig = JSON.stringify({ ...payload, cloudId: cloudId ?? '' });
    const box = await getOutbox();
    const pendingUp = (box.upserts.sales ?? []).includes(String(localId));
    if (cloudId && lastSentSig.get(queueKey) === sig && !pendingUp) return;

    await markOutbox('sales', String(localId), 'upsert');

    if (cloudId) {
      recordPushTouch(`sales/${cloudId}`);
      const response = await rest('PATCH', url(`sales/${encodeURIComponent(cloudId)}`), {
        fields: encodeFields(bodyPayload),
      });
      if (!response) return;
      recordPushTouch(`sales/${cloudId}`);
      lastSentSig.set(queueKey, sig);
      await clearOutbox('sales', String(localId), 'upsert');
      await rememberPush('sales', cloudId, response);
      markCollectionDirty('sales');
      return;
    }

    const response = await rest('POST', url('sales'), {
      fields: encodeFields(bodyPayload),
    });
    const newCloudId = response?.name ? documentId(response.name) : null;
    if (!newCloudId) return;
    recordPushTouch(`sales/${newCloudId}`);
    lastSentSig.set(queueKey, JSON.stringify({ ...payload, cloudId: newCloudId }));
    await clearOutbox('sales', String(localId), 'upsert');
    await runAsRemoteApply(() => db.sales.update(localId, { cloudId: newCloudId }));
    await rememberPush('sales', newCloudId, response);
    markCollectionDirty('sales');
  });
}

export function pushOrder(order: OnlineOrder): Promise<void> | void {
  if (!order.cloudId) return;
  return enqueue(`onlineOrders/${order.cloudId}`, async () => {
    if (!isSyncEnabled()) return;
    const current = order.id ? await db.onlineOrders.get(order.id) : order;
    if (!current) return;
    const patch = localOrderPatch(current);
    const res = await rest('PATCH', url(`onlineOrders/${encodeURIComponent(current.cloudId!)}`, Object.keys(patch)), {
      fields: encodeFields(patch),
    });
    if (res !== null) {
      await rememberPush('onlineOrders', current.cloudId!, res);
      markCollectionDirty('onlineOrders');
    }
  });
}

export function deleteSale(cloudId: string): Promise<void> {
  const queueKey = `sales/del/${cloudId}`;
  return enqueue(queueKey, async () => {
    if (!isSyncEnabled()) return;
    const box = await getOutbox();
    const pendingDel = (box.deletes.sales ?? []).includes(cloudId);
    if (lastSentSig.get(queueKey) === '__DELETED__' && !pendingDel) return;
    await markOutbox('sales', cloudId, 'delete');
    const res = await rest('DELETE', url(`sales/${encodeURIComponent(cloudId)}`));
    if (res === null) return;
    lastSentSig.set(queueKey, '__DELETED__');
    await clearOutbox('sales', cloudId, 'delete');
    await forgetPush('sales', cloudId);
    await recordLocalVoid(cloudId);
    pendingVoidManifestFlush = true;
    pendingDirtyCollections.add('sales');
    lastActivityAt = Date.now();
    await flushVersionManifest();
  });
}

export function pushStock(ids: Iterable<string>): void {
  for (const id of ids) void pushInventory(id);
}
