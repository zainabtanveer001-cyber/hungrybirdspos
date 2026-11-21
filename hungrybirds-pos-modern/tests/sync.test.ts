import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StoreState {
  categories: Map<string, any>;
  menu: Map<string, any>;
  inventory: Map<string, any>;
  recipes: any[];
  sales: Map<number, any>;
  onlineOrders: Map<number, any>;
  settings: Map<string, { key: string; value: string }>;
  users: Map<number, any>;
}

function createDeviceStore(): StoreState {
  return {
    categories: new Map(),
    menu: new Map(),
    inventory: new Map(),
    recipes: [],
    sales: new Map(),
    onlineOrders: new Map(),
    settings: new Map(),
    users: new Map(),
  };
}

let activeStore: StoreState = createDeviceStore();

function makeKeyedTable(getter: () => Map<string, any>) {
  return {
    get: async (id: string) => getter().get(id),
    put: async (row: any) => {
      getter().set(row.id ?? row.key, { ...row });
      return row.id ?? row.key;
    },
    delete: async (id: string) => {
      getter().delete(id);
    },
    bulkAdd: async (rows: any[]) => {
      for (const row of rows) getter().set(row.id, { ...row });
    },
    count: async () => getter().size,
    toArray: async () => [...getter().values()],
    toCollection: () => ({
      primaryKeys: async () => [...getter().keys()],
    }),
  };
}

const mockDb = {
  categories: makeKeyedTable(() => activeStore.categories),
  menu: makeKeyedTable(() => activeStore.menu),
  inventory: makeKeyedTable(() => activeStore.inventory),
  settings: makeKeyedTable(() => activeStore.settings),
  recipes: {
    where: () => ({
      equals: (menuItemId: string) => ({
        toArray: async () => activeStore.recipes.filter((r) => r.menuItemId === menuItemId),
        delete: async () => {
          activeStore.recipes = activeStore.recipes.filter((r) => r.menuItemId !== menuItemId);
        },
      }),
    }),
    add: async (row: any) => {
      activeStore.recipes.push(row);
    },
  },
  sales: {
    get: async (id: number) => activeStore.sales.get(id),
    add: async (row: any) => {
      const id = activeStore.sales.size + 1;
      activeStore.sales.set(id, { ...row, id });
      return id;
    },
    update: async (id: number, patch: any) => {
      const cur = activeStore.sales.get(id);
      if (cur) activeStore.sales.set(id, { ...cur, ...patch });
    },
    where: () => ({
      equals: (cloudId: string) => ({
        first: async () => [...activeStore.sales.values()].find((s) => s.cloudId === cloudId),
      }),
    }),
  },
  onlineOrders: {
    get: async (id: number) => activeStore.onlineOrders.get(id),
    add: async (row: any) => {
      const id = activeStore.onlineOrders.size + 1;
      activeStore.onlineOrders.set(id, { ...row, id });
      return id;
    },
    put: async (row: any) => {
      activeStore.onlineOrders.set(row.id, { ...row });
    },
    where: () => ({
      equals: (cloudId: string) => ({
        first: async () => [...activeStore.onlineOrders.values()].find((o) => o.cloudId === cloudId),
      }),
    }),
  },
  users: {
    count: async () => activeStore.users.size,
  },
};

vi.mock('../src/lib/db', () => ({ db: mockDb }));
vi.mock('../src/lib/config', () => ({
  configManager: {
    isConfigured: () => true,
    getConfig: async () => ({ projectId: 'test-proj', apiKey: 'test-key' }),
  },
}));

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

interface CloudDoc {
  name: string;
  fields: Record<string, any>;
  updateTime: string;
}

function createMockCloud() {
  const collections: Record<string, Map<string, CloudDoc>> = {
    categories: new Map(),
    menu: new Map(),
    inventory: new Map(),
    sales: new Map(),
    onlineOrders: new Map(),
  };
  let tick = 1;
  let failDeletesWith: number | null = null;
  let failGets = false;
  let failRefresh = false;

  const nextTime = () => `2026-11-21T10:00:${String(tick++).padStart(2, '0')}Z`;

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const urlStr = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (urlStr.includes('securetoken.googleapis.com')) {
      if (failRefresh) throw new TypeError('Failed to fetch');
      return new Response(
        JSON.stringify({ id_token: 'refreshed-id', refresh_token: 'refreshed-rt', expires_in: '3600' }),
        { status: 200 },
      );
    }

    const parsed = new URL(urlStr);
    const marker = '/documents/';
    const idx = parsed.pathname.indexOf(marker);
    const relPath = idx >= 0 ? parsed.pathname.slice(idx + marker.length) : '';
    const [col, rawDocId] = relPath.split('/');
    const docId = rawDocId ? decodeURIComponent(rawDocId) : undefined;
    const store = collections[col];

    if (!store) return new Response(JSON.stringify({}), { status: 404 });

    if (method === 'GET' && !docId) {
      if (failGets) throw new TypeError('Network unreachable');
      return new Response(JSON.stringify({ documents: [...store.values()] }), { status: 200 });
    }

    if (method === 'GET' && docId) {
      if (failGets) throw new TypeError('Network unreachable');
      const found = store.get(docId);
      return found ? new Response(JSON.stringify(found), { status: 200 }) : new Response('{}', { status: 404 });
    }

    if (method === 'PATCH' && docId) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const doc: CloudDoc = {
        name: `projects/test-proj/databases/(default)/documents/${col}/${docId}`,
        fields: body.fields ?? {},
        updateTime: nextTime(),
      };
      store.set(docId, doc);
      return new Response(JSON.stringify(doc), { status: 200 });
    }

    if (method === 'DELETE' && docId) {
      if (failDeletesWith !== null) {
        return new Response(JSON.stringify({ error: { code: failDeletesWith } }), { status: failDeletesWith });
      }
      store.delete(docId);
      return new Response(JSON.stringify({}), { status: 200 });
    }

    return new Response('{}', { status: 400 });
  });

  return {
    collections,
    fetchMock,
    setFailDeletes(status: number | null) {
      failDeletesWith = status;
    },
    setFailGets(value: boolean) {
      failGets = value;
    },
    setFailRefresh(value: boolean) {
      failRefresh = value;
    },
  };
}

let storage: MemoryStorage;

beforeEach(() => {
  vi.resetModules();
  activeStore = createDeviceStore();
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadSyncWithToken(expiresAt = Date.now() + 3_600_000) {
  storage.setItem(
    'hb.syncToken',
    JSON.stringify({ idToken: 'valid-token', refreshToken: 'refresh-token', expiresAt }),
  );
  return import('../src/lib/sync');
}

describe('cross-device category deletion sync (end-to-end with mock Firestore)', () => {
  it('propagates deletion of both default and custom categories from Device A to Device B', async () => {
    const cloud = createMockCloud();
    vi.stubGlobal('fetch', cloud.fetchMock);

    // Seed Device A with default categories + 1 custom category
    const deviceA = createDeviceStore();
    activeStore = deviceA;
    const authA = await import('../src/lib/auth');
    await authA.ensureDefaultCategories();
    deviceA.categories.set('CAT_BBQ', { id: 'CAT_BBQ', name: 'BBQ' });

    const syncA = await loadSyncWithToken();
    // Initial sync bootstraps cloud with Device A's categories
    await syncA.syncNow();
    expect(cloud.collections.categories.has('cat_burgers')).toBe(true);
    expect(cloud.collections.categories.has('CAT_BBQ')).toBe(true);

    // Seed Device B as a second browser with the default categories too, then sync
    const deviceB = createDeviceStore();
    activeStore = deviceB;
    vi.resetModules();
    const authB = await import('../src/lib/auth');
    await authB.ensureDefaultCategories();
    const syncB = await loadSyncWithToken();
    await syncB.syncNow();
    expect(deviceB.categories.has('cat_burgers')).toBe(true);
    expect(deviceB.categories.has('CAT_BBQ')).toBe(true);

    // Now on Device A: delete BOTH default `cat_burgers` and custom `CAT_BBQ`
    activeStore = deviceA;
    vi.resetModules();
    const syncA2 = await loadSyncWithToken();
    deviceA.categories.delete('cat_burgers');
    await syncA2.pushCategory('cat_burgers');
    deviceA.categories.delete('CAT_BBQ');
    await syncA2.pushCategory('CAT_BBQ');

    expect(cloud.collections.categories.has('cat_burgers')).toBe(false);
    expect(cloud.collections.categories.has('CAT_BBQ')).toBe(false);

    // Device B polls Firestore -> BOTH deleted categories disappear on Device B
    activeStore = deviceB;
    vi.resetModules();
    const syncB2 = await loadSyncWithToken();
    await syncB2.syncNow();

    expect(deviceB.categories.has('cat_burgers')).toBe(false);
    expect(deviceB.categories.has('CAT_BBQ')).toBe(false);
    expect(deviceB.categories.has('cat_pizza')).toBe(true);
  });

  it('prunes local-only default categories on Device B even when they were never in Device B snapshot', async () => {
    const cloud = createMockCloud();
    vi.stubGlobal('fetch', cloud.fetchMock);
    // Simulate legacy state: cloud only has CAT_CUSTOM (defaults were never uploaded or were deleted)
    cloud.collections.categories.set('CAT_CUSTOM', {
      name: 'projects/test-proj/databases/(default)/documents/categories/CAT_CUSTOM',
      fields: { id: { stringValue: 'CAT_CUSTOM' }, name: { stringValue: 'Karahi' } },
      updateTime: '2026-11-21T09:00:00Z',
    });

    const deviceB = createDeviceStore();
    activeStore = deviceB;
    const auth = await import('../src/lib/auth');
    await auth.ensureDefaultCategories();
    deviceB.categories.set('CAT_CUSTOM', { id: 'CAT_CUSTOM', name: 'Karahi' });
    // Old snapshot only tracked CAT_CUSTOM (never cat_burgers..cat_desserts)
    deviceB.settings.set('sync.snapshot', {
      key: 'sync.snapshot',
      value: JSON.stringify({ categories: { CAT_CUSTOM: '2026-11-21T09:00:00Z' } }),
    });

    const syncB = await loadSyncWithToken();
    await syncB.syncNow();

    expect([...deviceB.categories.keys()]).toEqual(['CAT_CUSTOM']);
  });

  it('does not resurrect default categories on reload after all categories are deleted', async () => {
    const auth = await import('../src/lib/auth');
    await auth.ensureDefaultCategories();
    expect(activeStore.categories.size).toBe(6);

    activeStore.categories.clear();
    await auth.ensureDefaultCategories();
    expect(activeStore.categories.size).toBe(0);
  });

  it('queues offline deletes in sync.outbox and flushes them when reconnected without resurrecting', async () => {
    const cloud = createMockCloud();
    vi.stubGlobal('fetch', cloud.fetchMock);
    cloud.collections.categories.set('CAT_1', {
      name: 'projects/test-proj/databases/(default)/documents/categories/CAT_1',
      fields: { id: { stringValue: 'CAT_1' }, name: { stringValue: 'Drinks' } },
      updateTime: '2026-11-21T09:00:00Z',
    });

    const sync = await loadSyncWithToken();
    await sync.syncNow();
    expect(activeStore.categories.has('CAT_1')).toBe(true);

    // Go offline and delete CAT_1
    vi.stubGlobal('navigator', { onLine: false });
    activeStore.categories.delete('CAT_1');
    await sync.pushCategory('CAT_1');

    // Still exists in cloud because we were offline, and tombstone is in outbox
    expect(cloud.collections.categories.has('CAT_1')).toBe(true);
    const outboxRaw = activeStore.settings.get('sync.outbox')?.value;
    expect(JSON.parse(outboxRaw!).deletes.categories).toEqual(['CAT_1']);

    // Reconnect and syncNow -> flushes DELETE to cloud and does not resurrect CAT_1
    vi.stubGlobal('navigator', { onLine: true });
    await sync.syncNow();

    expect(cloud.collections.categories.has('CAT_1')).toBe(false);
    expect(activeStore.categories.has('CAT_1')).toBe(false);
    expect(sync.getSyncStatus().state).toBe('idle');
  });

  it('surfaces Firestore 403 delete failures instead of masking them as idle when GET succeeds', async () => {
    const cloud = createMockCloud();
    vi.stubGlobal('fetch', cloud.fetchMock);
    cloud.collections.categories.set('CAT_1', {
      name: 'projects/test-proj/databases/(default)/documents/categories/CAT_1',
      fields: { id: { stringValue: 'CAT_1' }, name: { stringValue: 'Pizza' } },
      updateTime: '2026-11-21T09:00:00Z',
    });

    const sync = await loadSyncWithToken();
    await sync.syncNow();

    cloud.setFailDeletes(403);
    activeStore.categories.delete('CAT_1');
    await sync.pushCategory('CAT_1');
    await sync.syncNow();

    expect(sync.getSyncStatus().state).toBe('error');
    expect(sync.getSyncStatus().error).toContain('403');
    // Must not resurrect locally while delete is pending
    expect(activeStore.categories.has('CAT_1')).toBe(false);
  });

  it('never wipes local categories when Firestore GET fails during a network outage', async () => {
    const cloud = createMockCloud();
    vi.stubGlobal('fetch', cloud.fetchMock);

    activeStore.categories.set('CAT_1', { id: 'CAT_1', name: 'Burgers' });
    activeStore.settings.set('sync.snapshot', {
      key: 'sync.snapshot',
      value: JSON.stringify({ categories: { CAT_1: '2026-11-21T09:00:00Z' } }),
    });

    cloud.setFailGets(true);
    const sync = await loadSyncWithToken();
    await sync.syncNow();

    expect(activeStore.categories.has('CAT_1')).toBe(true);
    expect(sync.getSyncStatus().state).toBe('error');
  });

  it('keeps cloud sync token intact when token refresh fails due to transient network error', async () => {
    const cloud = createMockCloud();
    cloud.setFailRefresh(true);
    vi.stubGlobal('fetch', cloud.fetchMock);

    const sync = await loadSyncWithToken(Date.now() - 10_000);
    await sync.syncNow();

    expect(sync.isSyncEnabled()).toBe(true);
    expect(sync.getSyncStatus().state).toBe('error');
  });
});
