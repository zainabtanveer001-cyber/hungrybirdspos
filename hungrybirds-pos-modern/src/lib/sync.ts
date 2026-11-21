import { db } from './db';
import { configManager } from './config';
import {
  cloudOrderToLocal, cloudSaleToLocal, decodeFields, documentId, encodeFields,
  localOrderPatch, mergePulledSnapshot, reconcileMirrorCollection, toIso,
} from './syncMap';
import type { Category, InventoryItem, MenuItem, OnlineOrder } from './db/types';

// Firestore REST, same reasoning as auth.ts: the `firebase` package broke the
// Vercel/Rolldown build, and polling a tiny metadata projection is cheap.
const TOKEN_KEY = 'hb.syncToken';
const SNAPSHOT_KEY = 'sync.snapshot';
const OUTBOX_KEY = 'sync.outbox';
const CATEGORIES_INITIALIZED_KEY = 'categoriesInitialized';
const POLL_MS = 15_000;
const WAKE_MIN_INTERVAL_MS = 3_000;
const MAX_SYNCED_IMAGE_BYTES = 700 * 1024;

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
  return Boolean(localStorage.getItem(TOKEN_KEY)) && configManager.isConfigured();
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
  if (!refreshToken) return;
  const token: Token = {
    idToken,
    refreshToken,
    expiresAt: Date.now() + (Number(expiresIn) || 3600) * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function forgetToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  setStatus({ state: 'off', error: undefined });
}

async function accessToken(): Promise<string | null> {
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
type MirrorCollection = 'categories' | 'menu' | 'inventory';

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

async function markOutbox(collection: MirrorCollection, id: string, kind: 'upsert' | 'delete'): Promise<void> {
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

async function clearOutbox(collection: MirrorCollection, id: string, kind: 'upsert' | 'delete'): Promise<void> {
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

/* -------------------------------------------------------------------- pull */

/** `{docId: updateTime}` plus the docs themselves, or `null` if the cloud fetch failed. */
async function metadata(collection: string): Promise<{ times: Record<string, string>; docs: any[] } | null> {
  const docs = await listAll(collection);
  if (docs === null) return null;
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

async function applyMenu(doc: any, updateTime: string): Promise<void> {
  const id = documentId(doc.name);
  const data: any = decodeFields(doc.fields ?? {});
  const { recipes, ...item } = data;
  await db.menu.put({ ...item, id, updatedAt: toIso(updateTime) } as unknown as MenuItem);
  await db.recipes.where('menuItemId').equals(id).delete();
  for (const row of recipes ?? []) {
    if (!row?.inventoryId) continue;
    await db.recipes.add({
      menuItemId: id,
      inventoryId: row.inventoryId,
      qtyRequired: Number(row.qtyRequired) || 0,
    });
  }
}

async function applyCategory(doc: any, updateTime: string): Promise<void> {
  const id = documentId(doc.name);
  await db.categories.put({ ...decodeFields(doc.fields ?? {}), id, updatedAt: toIso(updateTime) } as unknown as Category);
}

async function applyInventory(doc: any, updateTime: string): Promise<void> {
  const id = documentId(doc.name);
  await db.inventory.put({ ...decodeFields(doc.fields ?? {}), id, updatedAt: toIso(updateTime) } as unknown as InventoryItem);
}

async function applySale(doc: any): Promise<void> {
  const cloudId = documentId(doc.name);
  const data = decodeFields(doc.fields ?? {});
  if (await db.sales.where('cloudId').equals(cloudId).first()) return;

  // A poll can overtake the push's `cloudId` write-back. The local row is the
  // same sale when the ids collide *and* the figures agree — another till can
  // legitimately hold a different sale under the same numeric id.
  const known = Number(data.localId) ? await db.sales.get(Number(data.localId)) : undefined;
  if (known?.id && known.timestamp === toIso(data.createdAt) && Number(known.total) === Number(data.total ?? known.total)) {
    if (!known.cloudId) await db.sales.update(known.id, { cloudId });
    return;
  }

  await db.sales.add({ ...cloudSaleToLocal(cloudId, data), id: undefined });
}

async function applyOnlineOrder(doc: any): Promise<void> {
  const cloudId = documentId(doc.name);
  const order = cloudOrderToLocal(cloudId, decodeFields(doc.fields ?? {}));
  const local = await db.onlineOrders.where('cloudId').equals(cloudId).first();
  if (local?.id) {
    await db.onlineOrders.put({ ...order, id: local.id });
  } else {
    await db.onlineOrders.add(order);
  }
}

const APPLY: Record<string, (doc: any, updateTime: string) => Promise<void>> = {
  menu: applyMenu,
  categories: applyCategory,
  inventory: applyInventory,
  sales: applySale,
  onlineOrders: applyOnlineOrder,
};

const COLLECTIONS = Object.keys(APPLY);

function isMirrorCollection(collection: string): collection is MirrorCollection {
  return collection === 'categories' || collection === 'menu' || collection === 'inventory';
}

async function localPrimaryKeys(collection: MirrorCollection): Promise<string[]> {
  if (collection === 'categories') return (await db.categories.toCollection().primaryKeys()).map(String);
  if (collection === 'menu') return (await db.menu.toCollection().primaryKeys()).map(String);
  return (await db.inventory.toCollection().primaryKeys()).map(String);
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

async function pullCollection(collection: string, snap: Snapshot): Promise<'changed' | 'unchanged' | 'error'> {
  const pullStartEpoch = pushEpoch;
  const preInFlight = inFlightKeys(collection);
  const meta = await metadata(collection);
  if (!meta) return 'error';
  const { times: remote, docs } = meta;
  const seen = snap[collection];
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

  if (isMirrorCollection(collection)) {
    localKeys = await localPrimaryKeys(collection);
    const reconciled = reconcileMirrorCollection({
      remoteIds: Object.keys(remote),
      seenIds: seen !== undefined ? Object.keys(seen) : undefined,
      localIds: localKeys,
      pendingUpsertIds: pendingUpserts,
    });
    removed = reconciled.toDelete;
    shouldBootstrapCloud = reconciled.shouldBootstrapCloud;
  }

  if (collection === 'categories') {
    await db.settings.put({ key: CATEGORIES_INITIALIZED_KEY, value: 'true' });
  }

  if (shouldBootstrapCloud && isMirrorCollection(collection)) {
    snap[collection] = mergePulledSnapshot(remote, snap[collection], protectedIds);
    const bootstrapTasks = localKeys.map((id) =>
      collection === 'categories'
        ? pushCategory(id)
        : collection === 'menu'
          ? pushMenu(id)
          : pushInventory(id),
    );
    if (bootstrapTasks.length) await Promise.all(bootstrapTasks);
    const afterBox = await getOutbox();
    const hasPending =
      (afterBox.upserts[collection]?.length ?? 0) > 0 || (afterBox.deletes[collection]?.length ?? 0) > 0;
    return hasPending ? 'error' : 'changed';
  }

  const snapshotInitialized = seen === undefined;
  if (!changed.length && !removed.length && !snapshotInitialized) return 'unchanged';

  const apply = APPLY[collection];
  const byId = new Map(docs.map((d) => [documentId(d.name), d]));

  for (const id of changed) {
    const doc = byId.get(id) ?? (await fetchDoc(collection, id));
    if (doc?.fields) await apply(doc, remote[id]);
  }

  if (collection === 'menu') {
    for (const id of removed) {
      await db.menu.delete(id);
      await db.recipes.where('menuItemId').equals(id).delete();
    }
  } else if (collection === 'categories') {
    for (const id of removed) await db.categories.delete(id);
  } else if (collection === 'inventory') {
    for (const id of removed) await db.inventory.delete(id);
  }
  // Sales and onlineOrders are never deleted locally: the POS holds sales the
  // cloud may not, and the website owns the order collection (no delete rule).

  snap[collection] = mergePulledSnapshot(remote, snap[collection], protectedIds);
  return changed.length > 0 || removed.length > 0 || snapshotInitialized ? 'changed' : 'unchanged';
}

/** Retries any pending offline/failed mirror pushes; returns true if anything still failed to send. */
async function flushOutbox(): Promise<boolean> {
  const box = await getOutbox();
  const tasks: Promise<void>[] = [];
  for (const collection of ['categories', 'menu', 'inventory'] as const) {
    const ids = new Set([...(box.deletes[collection] ?? []), ...(box.upserts[collection] ?? [])]);
    for (const id of ids) {
      if (collection === 'categories') tasks.push(pushCategory(id));
      else if (collection === 'menu') tasks.push(pushMenu(id));
      else tasks.push(pushInventory(id));
    }
  }
  if (tasks.length) await Promise.all(tasks);
  const remaining = await getOutbox();
  return (['categories', 'menu', 'inventory'] as const).some(
    (c) => (remaining.deletes[c]?.length ?? 0) > 0 || (remaining.upserts[c]?.length ?? 0) > 0,
  );
}

let inFlight: Promise<boolean> | null = null;

/** Flushes queued local edits/deletes, then pulls every collection once. Returns true when something changed. */
export function syncNow(): Promise<boolean> {
  inFlight ??= (async () => {
    if (!isSyncEnabled()) {
      setStatus({ state: 'off' });
      return false;
    }
    setStatus({ state: 'syncing', error: undefined });
    let hadError = await flushOutbox();

    const snap = await getSnapshot();
    let changed = false;
    for (const collection of COLLECTIONS) {
      try {
        const outcome = await pullCollection(collection, snap);
        if (outcome === 'changed') changed = true;
        else if (outcome === 'error') hadError = true;
      } catch (err) {
        hadError = true;
        setStatus({ state: 'error', error: err instanceof Error ? err.message : 'pull failed' });
      }
    }
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

let timer: ReturnType<typeof setInterval> | null = null;

function wakeIfStale(): void {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (status.lastSync && Date.now() - status.lastSync < WAKE_MIN_INTERVAL_MS) return;
  void syncNow();
}

export function startSync(): void {
  if (timer) return;
  if (!isSyncEnabled()) {
    setStatus({ state: 'off' });
    return;
  }
  void syncNow();
  timer = setInterval(() => void syncNow(), POLL_MS);
  window.addEventListener('online', wake);
  window.addEventListener('focus', wakeIfStale);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', wakeIfStale);
  }
}

export function stopSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener('online', wake);
  window.removeEventListener('focus', wakeIfStale);
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', wakeIfStale);
  }
}

function wake(): void {
  void syncNow();
}

/* -------------------------------------------------------------------- push */

const pushes = new Map<string, Promise<void>>();
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

export function pushMenu(id: string): Promise<void> {
  return enqueue(`menu/${id}`, async () => {
    if (!isSyncEnabled()) return;
    const item = await db.menu.get(id);
    if (!item) {
      await markOutbox('menu', id, 'delete');
      const res = await rest('DELETE', url(`menu/${encodeURIComponent(id)}`));
      if (res !== null) {
        await clearOutbox('menu', id, 'delete');
        await forgetPush('menu', id);
      }
      return;
    }
    await markOutbox('menu', id, 'upsert');
    const recipes = await db.recipes.where('menuItemId').equals(id).toArray();
    const payload: Record<string, unknown> = {
      ...item,
      recipes: recipes.map((row) => ({ inventoryId: row.inventoryId, qtyRequired: row.qtyRequired })),
    };
    // Same guard as the legacy app: a huge data-URL image would reject the whole write.
    if (typeof payload.imageUrl === 'string' && payload.imageUrl.length > MAX_SYNCED_IMAGE_BYTES) {
      delete payload.imageUrl;
    }
    const res = await rest('PATCH', url(`menu/${encodeURIComponent(id)}`), { fields: encodeFields(payload) });
    if (res !== null) {
      await clearOutbox('menu', id, 'upsert');
      await rememberPush('menu', id, res);
    }
  });
}

export function pushCategory(id: string): Promise<void> {
  return enqueue(`categories/${id}`, async () => {
    if (!isSyncEnabled()) return;
    const category = await db.categories.get(id);
    if (!category) {
      await markOutbox('categories', id, 'delete');
      const res = await rest('DELETE', url(`categories/${encodeURIComponent(id)}`));
      if (res !== null) {
        await clearOutbox('categories', id, 'delete');
        await forgetPush('categories', id);
      }
      return;
    }
    await markOutbox('categories', id, 'upsert');
    const res = await rest('PATCH', url(`categories/${encodeURIComponent(id)}`), { fields: encodeFields({ ...category }) });
    if (res !== null) {
      await clearOutbox('categories', id, 'upsert');
      await rememberPush('categories', id, res);
    }
  });
}

export function pushInventory(id: string): Promise<void> {
  return enqueue(`inventory/${id}`, async () => {
    if (!isSyncEnabled()) return;
    const item = await db.inventory.get(id);
    if (!item) {
      await markOutbox('inventory', id, 'delete');
      const res = await rest('DELETE', url(`inventory/${encodeURIComponent(id)}`));
      if (res !== null) {
        await clearOutbox('inventory', id, 'delete');
        await forgetPush('inventory', id);
      }
      return;
    }
    await markOutbox('inventory', id, 'upsert');
    const res = await rest('PATCH', url(`inventory/${encodeURIComponent(id)}`), { fields: encodeFields({ ...item }) });
    if (res !== null) {
      await clearOutbox('inventory', id, 'upsert');
      await rememberPush('inventory', id, res);
    }
  });
}

/** Sales are append-only in the cloud; the local numeric id rides along as `localId`. */
export function pushSale(localId: number): Promise<void> {
  return enqueue(`sales/${localId}`, async () => {
    const sale = await db.sales.get(localId);
    if (!sale || sale.cloudId) return;
    const { id: _id, cloudId: _cloudId, ...payload } = sale;
    const response = await rest('POST', url('sales'), {
      fields: encodeFields({
        ...payload,
        localId,
        createdAt: sale.createdAt ?? sale.timestamp,
      }),
    });
    const newCloudId = response?.name ? documentId(response.name) : null;
    if (!newCloudId) return;
    await db.sales.update(localId, { cloudId: newCloudId });
    await rememberPush('sales', newCloudId, response);
  });
}

export function pushOrder(order: OnlineOrder): Promise<void> | void {
  if (!order.cloudId) return;
  return enqueue(`onlineOrders/${order.cloudId}`, async () => {
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
  return enqueue(`sales/${cloudId}`, async () => {
    if (await rest('DELETE', url(`sales/${encodeURIComponent(cloudId)}`)) === null) return;
    await forgetPush('sales', cloudId);
  });
}

export function pushStock(ids: Iterable<string>): void {
  for (const id of ids) void pushInventory(id);
}
