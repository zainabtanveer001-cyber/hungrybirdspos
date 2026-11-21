import type { Table, Transaction } from 'dexie';
import { db } from './db';
import { configManager } from './config';
import {
  cloudOrderToLocal, cloudSaleToLocal, decodeFields, documentId, encodeFields,
  localOrderPatch, mergePulledSnapshot, reconcileMirrorCollection, toIso,
} from './syncMap';
import type { OnlineOrder, Sale } from './db/types';

// Firestore REST, same reasoning as auth.ts: the `firebase` package broke the
// Vercel/Rolldown build, and polling a tiny metadata projection is cheap.
const TOKEN_KEY = 'hb.syncToken';
const SNAPSHOT_KEY = 'sync.snapshot';
const OUTBOX_KEY = 'sync.outbox';
const CATEGORIES_INITIALIZED_KEY = 'categoriesInitialized';
const SETTING_PREFIX = 'setting_';
const POLL_MS = 4_000;
const TIER2_EVERY_TICKS = 3;
const WAKE_MIN_INTERVAL_MS = 1_500;
const MAX_SYNCED_IMAGE_BYTES = 700 * 1024;
const BROADCAST_CHANNEL_NAME = 'hb-pos-sync';

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

export type SyncState = 'off' | 'idle' | 'syncing' | 'error';
export interface SyncStatus {
  state: SyncState;
  lastSync: number | null;
  error?: string;
}

/* ------------------------------------------------------------------ status */

let status: SyncStatus = { state: 'off', lastSync: null };
const listeners = new Set<() => void>();

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
  setStatus({ state: 'off', error: undefined });
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
    setStatus({ state: 'error', error: 'Offline — retrying sync' });
    return null;
  }
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      forgetToken();
    } else {
      setStatus({ state: 'error', error: `Auth refresh ${res.status}` });
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

async function rest(method: string, target: string | Promise<string | null>, body?: unknown): Promise<any | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (isSyncEnabled()) setStatus({ state: 'error', error: 'Offline — queued for sync' });
    return null;
  }
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
    if (!res.ok) {
      if (res.status === 401) forgetToken();
      setStatus({ state: 'error', error: `Firestore ${res.status}` });
      return null;
    }
    return res.status === 204 ? {} : await res.json();
  } catch (err) {
    setStatus({ state: 'error', error: err instanceof Error ? err.message : 'network error' });
    return null;
  }
}

/** Authenticated Firestore REST call for one-off writes outside the sync queue. */
export function restWrite(method: string, target: string, body?: unknown): Promise<any | null> {
  return rest(method, target, body);
}

/* --------------------------------------------------------- snapshot/outbox */

type Snapshot = Record<string, Record<string, string>>;

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

  if (collection === 'categories') {
    await db.settings.put({ key: CATEGORIES_INITIALIZED_KEY, value: 'true' });
  }

  if (shouldBootstrapCloud && mirrorLike) {
    snap[collection] = mergePulledSnapshot(remote, snap[collection], protectedIds);
    const target = collection as MirrorCollection | 'tableOrders';
    const bootstrapTasks = localKeys.map((id) => pushByCollection(target, id));
    if (bootstrapTasks.length) await Promise.all(bootstrapTasks);
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
    if (doc?.fields) await applyDoc(collection, doc, remote[id]);
  }

  if (mirrorLike && removed.length > 0) {
    await deleteRemovedLocal(collection as MirrorCollection | 'tableOrders', removed);
  }

  snap[collection] = mergePulledSnapshot(remote, snap[collection], protectedIds);
  return changed.length > 0 || removed.length > 0 || snapshotInitialized ? 'changed' : 'unchanged';
}

/** Retries any pending offline/failed pushes; returns true if anything still failed to send. */
async function flushOutbox(): Promise<{ hadError: boolean; flushedTier2: boolean }> {
  const box = await getOutbox();
  const tasks: Promise<void>[] = [];
  let flushedTier2 = false;

  for (const collection of MIRROR_COLLECTIONS) {
    const ids = new Set([...(box.deletes[collection] ?? []), ...(box.upserts[collection] ?? [])]);
    if (ids.size > 0 && (TIER2_COLLECTIONS as readonly string[]).includes(collection)) {
      flushedTier2 = true;
    }
    for (const id of ids) {
      tasks.push(pushByCollection(collection, id));
    }
  }

  for (const docId of new Set([...(box.deletes.tableOrders ?? []), ...(box.upserts.tableOrders ?? [])])) {
    tasks.push(pushByCollection('tableOrders', docId));
  }

  for (const localIdStr of box.upserts.sales ?? []) {
    const localId = Number(localIdStr);
    if (Number.isFinite(localId) && localId > 0) tasks.push(pushSale(localId));
  }

  for (const cloudId of box.deletes.sales ?? []) {
    tasks.push(deleteSale(cloudId));
  }

  if (tasks.length) await Promise.all(tasks);
  const remaining = await getOutbox();
  const hadError = OUTBOX_COLLECTIONS.some(
    (c) => (remaining.deletes[c]?.length ?? 0) > 0 || (remaining.upserts[c]?.length ?? 0) > 0,
  );
  return { hadError, flushedTier2 };
}

let inFlight: Promise<boolean> | null = null;
let tier2Initialized = false;

/** Flushes queued local edits/deletes, then pulls synced collections in parallel. Returns true when something changed. */
export function syncNow(includeTier2 = true): Promise<boolean> {
  inFlight ??= (async () => {
    if (!isSyncEnabled()) {
      setStatus({ state: 'off' });
      return false;
    }
    setStatus({ state: 'syncing', error: undefined });
    const outboxResult = await flushOutbox();
    let hadError = outboxResult.hadError;

    const pullTier2 = includeTier2 || !tier2Initialized || outboxResult.flushedTier2;
    const collectionsToPull = pullTier2 ? ALL_COLLECTIONS : TIER1_COLLECTIONS;

    const snap = await getSnapshot();
    let changed = false;
    const results = await Promise.all(
      collectionsToPull.map(async (collection) => {
        try {
          const outcome = await pullCollection(collection, snap);
          return { collection, outcome, err: undefined };
        } catch (err) {
          return { collection, outcome: 'error' as const, err };
        }
      }),
    );

    for (const result of results) {
      if (result.outcome === 'changed') changed = true;
      else if (result.outcome === 'error') {
        hadError = true;
        if (result.err) {
          setStatus({ state: 'error', error: result.err instanceof Error ? result.err.message : 'pull failed' });
        }
      }
    }

    if (pullTier2 && !hadError) tier2Initialized = true;
    if (changed) await writeSnapshot(snap);
    if (!hadError && isSyncEnabled()) {
      setStatus({ state: 'idle', lastSync: Date.now(), error: undefined });
    } else if (hadError && isSyncEnabled() && status.state === 'syncing') {
      setStatus({ state: 'error', error: status.error ?? 'Pending changes could not sync' });
    }
    return changed;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/* ----------------------------------------------------------- hooks & timer */

let timer: ReturnType<typeof setInterval> | null = null;
let pollTicks = 0;
let broadcastChannel: BroadcastChannel | null = null;
let hooksInstalled = false;
const txPending = new WeakMap<object, Map<string, () => void>>();

function notifyBroadcast(): void {
  try {
    broadcastChannel?.postMessage({ type: 'local-write', at: Date.now() });
  } catch {
    // BroadcastChannel can throw if closing during teardown.
  }
}

function queueAfterCommit(tx: Transaction | undefined, dedupeKey: string, action: () => void): void {
  if (!tx || typeof tx.on !== 'function') {
    setTimeout(() => {
      if (isSyncEnabled()) {
        action();
        notifyBroadcast();
      }
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
      notifyBroadcast();
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

function wakeIfStale(): void {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (status.lastSync && Date.now() - status.lastSync < WAKE_MIN_INTERVAL_MS) return;
  void syncNow(true);
}

export function startSync(): void {
  if (timer) return;
  if (!isSyncEnabled()) {
    setStatus({ state: 'off' });
    return;
  }
  installSyncHooks();
  pollTicks = 0;
  tier2Initialized = false;
  void syncNow(true);

  timer = setInterval(() => {
    pollTicks += 1;
    void syncNow(pollTicks % TIER2_EVERY_TICKS === 0);
  }, POLL_MS);

  if (typeof window !== 'undefined') {
    window.addEventListener('online', wake);
    window.addEventListener('focus', wakeIfStale);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', wakeIfStale);
  }
  if (typeof BroadcastChannel !== 'undefined' && !broadcastChannel) {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.onmessage = () => wakeIfStale();
  }
}

export function stopSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wakeIfStale);
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', wakeIfStale);
  }
  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
  }
}

function wake(): void {
  void syncNow(true);
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
      updatedAt: sale.updatedAt ?? new Date().toISOString(),
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
  });
}

export function pushOrder(order: OnlineOrder): Promise<void> | void {
  if (!order.cloudId) return;
  return enqueue(`onlineOrders/${order.cloudId}`, async () => {
    if (!isSyncEnabled()) return;
    const current = order.id ? await db.onlineOrders.get(order.id) : order;
    if (!current) return;
    const patch = localOrderPatch(current);
    await rememberPush(
      'onlineOrders', current.cloudId!,
      await rest('PATCH', url(`onlineOrders/${encodeURIComponent(current.cloudId!)}`, Object.keys(patch)), {
        fields: encodeFields(patch),
      }),
    );
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
  });
}

export function pushStock(ids: Iterable<string>): void {
  for (const id of ids) void pushInventory(id);
}
