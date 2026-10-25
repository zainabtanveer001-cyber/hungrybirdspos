import { db } from './db';
import { configManager } from './config';
import {
  cloudOrderToLocal, cloudSaleToLocal, decodeFields, documentId, encodeFields,
  localOrderPatch, toIso,
} from './syncMap';
import type { Category, InventoryItem, MenuItem, OnlineOrder } from './db/types';

// Firestore REST, same reasoning as auth.ts: the `firebase` package broke the
// Vercel/Rolldown build, and polling a tiny metadata projection is cheap.
const TOKEN_KEY = 'hb.syncToken';
const SNAPSHOT_KEY = 'sync.snapshot';
const POLL_MS = 25_000;
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
  if (!res?.ok) {
    forgetToken();
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

/* ---------------------------------------------------------------- snapshot */

type Snapshot = Record<string, Record<string, string>>;

async function readSnapshot(): Promise<Snapshot> {
  const setting = await db.settings.get(SNAPSHOT_KEY);
  if (!setting) return {};
  try {
    return JSON.parse(setting.value) as Snapshot;
  } catch {
    return {};
  }
}

async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  await db.settings.put({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) });
}

let snapshot: Snapshot | null = null;

async function getSnapshot(): Promise<Snapshot> {
  snapshot ??= await readSnapshot();
  return snapshot;
}

/* -------------------------------------------------------------------- pull */

/** `{docId: updateTime}` plus the docs themselves, from one list per collection. */
async function metadata(collection: string): Promise<{ times: Record<string, string>; docs: any[] }> {
  const docs = await listAll(collection);
  const times: Record<string, string> = {};
  for (const doc of docs) times[documentId(doc.name)] = doc.updateTime ?? '';
  return { times, docs };
}

async function listAll(collection: string): Promise<any[]> {
  const config = await configManager.getConfig();
  const base = await getBaseUrl();
  if (!config || !base) return [];
  const docs: any[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ key: config.apiKey, pageSize: '1000' });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await rest('GET', `${base}/${collection}?${query}`);
    if (!page) break;
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

async function pullCollection(collection: string, snap: Snapshot): Promise<boolean> {
  const { times: remote, docs } = await metadata(collection);
  const seen = snap[collection] ?? {};
  const changed = Object.keys(remote).filter((id) => remote[id] !== seen[id]);
  const removed = Object.keys(seen).filter((id) => !(id in remote));
  if (!changed.length && !removed.length) return false;

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
  // Add tombstones on the cloud side when cross-till deletion matters.

  snap[collection] = remote;
  return true;
}

let inFlight: Promise<boolean> | null = null;

/** Pulls every collection once. Returns true when something changed. */
export function syncNow(): Promise<boolean> {
  inFlight ??= (async () => {
    if (!isSyncEnabled()) {
      setStatus({ state: 'off' });
      return false;
    }
    setStatus({ state: 'syncing', error: undefined });
    const snap = await getSnapshot();
    let changed = false;
    for (const collection of COLLECTIONS) {
      try {
        if (await pullCollection(collection, snap)) changed = true;
      } catch (err) {
        setStatus({ state: 'error', error: err instanceof Error ? err.message : 'pull failed' });
      }
    }
    if (changed) await writeSnapshot(snap);
    setStatus({ state: 'idle', lastSync: Date.now() });
    return changed;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSync(): void {
  if (timer) return;
  if (!isSyncEnabled()) {
    setStatus({ state: 'off' });
    return;
  }
  void syncNow();
  timer = setInterval(() => void syncNow(), POLL_MS);
  window.addEventListener('online', wake);
}

export function stopSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener('online', wake);
}

function wake(): void {
  void syncNow();
}

/* -------------------------------------------------------------------- push */

const pushes = new Map<string, Promise<void>>();

/** Serialises pushes per document so a burst of edits cannot land out of order. */
function enqueue(key: string, task: () => Promise<void>): void {
  const previous = pushes.get(key) ?? Promise.resolve();
  const next = previous.then(task).catch(() => undefined);
  pushes.set(key, next);
  void next.finally(() => {
    if (pushes.get(key) === next) pushes.delete(key);
  });
}

async function rememberPush(collection: string, id: string, response: any): Promise<void> {
  if (!response?.updateTime) return;
  const snap = await getSnapshot();
  snap[collection] = { ...(snap[collection] ?? {}), [id]: response.updateTime };
  await writeSnapshot(snap);
}

export function pushMenu(id: string): void {
  enqueue(`menu/${id}`, async () => {
    const item = await db.menu.get(id);
    if (!item) {
      await rest('DELETE', url(`menu/${encodeURIComponent(id)}`));
      return;
    }
    const recipes = await db.recipes.where('menuItemId').equals(id).toArray();
    const payload: Record<string, unknown> = {
      ...item,
      recipes: recipes.map((row) => ({ inventoryId: row.inventoryId, qtyRequired: row.qtyRequired })),
    };
    // Same guard as the legacy app: a huge data-URL image would reject the whole write.
    if (typeof payload.imageUrl === 'string' && payload.imageUrl.length > MAX_SYNCED_IMAGE_BYTES) {
      delete payload.imageUrl;
    }
    await rememberPush('menu', id, await rest('PATCH', url(`menu/${encodeURIComponent(id)}`), { fields: encodeFields(payload) }));
  });
}

export function pushCategory(id: string): void {
  enqueue(`categories/${id}`, async () => {
    const category = await db.categories.get(id);
    await rememberPush(
      'categories', id,
      category
        ? await rest('PATCH', url(`categories/${encodeURIComponent(id)}`), { fields: encodeFields({ ...category }) })
        : await rest('DELETE', url(`categories/${encodeURIComponent(id)}`)),
    );
  });
}

export function pushInventory(id: string): void {
  enqueue(`inventory/${id}`, async () => {
    const item = await db.inventory.get(id);
    await rememberPush(
      'inventory', id,
      item
        ? await rest('PATCH', url(`inventory/${encodeURIComponent(id)}`), { fields: encodeFields({ ...item }) })
        : await rest('DELETE', url(`inventory/${encodeURIComponent(id)}`)),
    );
  });
}

/** Sales are append-only in the cloud; the local numeric id rides along as `localId`. */
export function pushSale(localId: number): void {
  enqueue(`sales/${localId}`, async () => {
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

export function pushOrder(order: OnlineOrder): void {
  if (!order.cloudId) return;
  enqueue(`onlineOrders/${order.cloudId}`, async () => {
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

export function deleteSale(cloudId: string): void {
  enqueue(`sales/${cloudId}`, async () => {
    if (await rest('DELETE', url(`sales/${encodeURIComponent(cloudId)}`)) === null) return;
    const snap = await getSnapshot();
    if (snap.sales) delete snap.sales[cloudId];
    await writeSnapshot(snap);
  });
}

export function pushStock(ids: Iterable<string>): void {
  for (const id of ids) pushInventory(id);
}
