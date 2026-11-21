import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ALL_COLLECTION_NAMES = [
  'categories',
  'menu',
  'inventory',
  'suppliers',
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
  'tableOrders',
] as const;

interface StoreState {
  categories: Map<string, any>;
  menu: Map<string, any>;
  inventory: Map<string, any>;
  suppliers: Map<string, any>;
  heldOrders: Map<number, any>;
  deliveries: Map<number, any>;
  expenses: Map<number, any>;
  staff: Map<number, any>;
  attendance: Map<number, any>;
  leaves: Map<number, any>;
  salaryPayments: Map<number, any>;
  advancePayments: Map<number, any>;
  stockIn: Map<number, any>;
  supplierPayments: Map<number, any>;
  auditLogs: Map<number, any>;
  recipes: any[];
  sales: Map<number, any>;
  onlineOrders: Map<number, any>;
  settings: Map<string, { key: string; value: any }>;
  users: Map<number, any>;
}

function createDeviceStore(): StoreState {
  return {
    categories: new Map(),
    menu: new Map(),
    inventory: new Map(),
    suppliers: new Map(),
    heldOrders: new Map(),
    deliveries: new Map(),
    expenses: new Map(),
    staff: new Map(),
    attendance: new Map(),
    leaves: new Map(),
    salaryPayments: new Map(),
    advancePayments: new Map(),
    stockIn: new Map(),
    supplierPayments: new Map(),
    auditLogs: new Map(),
    recipes: [],
    sales: new Map(),
    onlineOrders: new Map(),
    settings: new Map(),
    users: new Map(),
  };
}

let activeStore: StoreState = createDeviceStore();

function makeKeyedTable(getter: () => Map<any, any>, keyField = 'id') {
  return {
    get: async (id: any) => getter().get(id),
    put: async (row: any) => {
      getter().set(row[keyField], { ...row });
      return row[keyField];
    },
    add: async (row: any) => {
      const numericKeys = [...getter().keys()].filter((k): k is number => typeof k === 'number');
      const nextId = row.id ?? (numericKeys.length ? Math.max(...numericKeys) + 1 : 1);
      getter().set(nextId, { ...row, [keyField]: nextId });
      return nextId;
    },
    update: async (id: any, patch: any) => {
      const cur = getter().get(id);
      if (cur) getter().set(id, { ...cur, ...patch });
    },
    delete: async (id: any) => {
      getter().delete(id);
    },
    bulkAdd: async (rows: any[]) => {
      for (const row of rows) getter().set(row[keyField], { ...row });
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
  suppliers: makeKeyedTable(() => activeStore.suppliers),
  heldOrders: makeKeyedTable(() => activeStore.heldOrders),
  deliveries: makeKeyedTable(() => activeStore.deliveries),
  expenses: makeKeyedTable(() => activeStore.expenses),
  staff: makeKeyedTable(() => activeStore.staff),
  attendance: makeKeyedTable(() => activeStore.attendance),
  leaves: makeKeyedTable(() => activeStore.leaves),
  salaryPayments: makeKeyedTable(() => activeStore.salaryPayments),
  advancePayments: makeKeyedTable(() => activeStore.advancePayments),
  stockIn: makeKeyedTable(() => activeStore.stockIn),
  supplierPayments: makeKeyedTable(() => activeStore.supplierPayments),
  auditLogs: makeKeyedTable(() => activeStore.auditLogs),
  settings: makeKeyedTable(() => activeStore.settings, 'key'),
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
      const numericKeys = [...activeStore.sales.keys()];
      const id = row.id ?? (numericKeys.length ? Math.max(...numericKeys) + 1 : 1);
      activeStore.sales.set(id, { ...row, id });
      return id;
    },
    update: async (id: number, patch: any) => {
      const cur = activeStore.sales.get(id);
      if (cur) activeStore.sales.set(id, { ...cur, ...patch });
    },
    toArray: async () => [...activeStore.sales.values()],
    where: (field: string) => ({
      equals: (val: string) => ({
        first: async () => [...activeStore.sales.values()].find((s) => s[field] === val),
        delete: async () => {
          for (const [k, s] of activeStore.sales.entries()) {
            if (s[field] === val) activeStore.sales.delete(k);
          }
        },
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
    sales: new Map(),
    onlineOrders: new Map(),
  };
  for (const name of ALL_COLLECTION_NAMES) {
    collections[name] = new Map();
  }

  let tick = 1;
  let saleSeq = 1;
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

    if (method === 'POST' && !docId) {
      const newId = `CLOUD_${saleSeq++}`;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const doc: CloudDoc = {
        name: `projects/test-proj/databases/(default)/documents/${col}/${newId}`,
        fields: body.fields ?? {},
        updateTime: nextTime(),
      };
      store.set(newId, doc);
      return new Response(JSON.stringify(doc), { status: 200 });
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

    // On Device A: delete BOTH default `cat_burgers` and custom `CAT_BBQ`
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

    vi.stubGlobal('navigator', { onLine: false });
    activeStore.categories.delete('CAT_1');
    await sync.pushCategory('CAT_1');

    expect(cloud.collections.categories.has('CAT_1')).toBe(true);
    const outboxRaw = activeStore.settings.get('sync.outbox')?.value;
    expect(JSON.parse(outboxRaw!).deletes.categories).toEqual(['CAT_1']);

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

describe('live multi-device operational sync (held orders, sale updates, shift settings)', () => {
  it('syncs held orders / table occupancy and KDS status across Device A and Device B', async () => {
    const cloud = createMockCloud();
    vi.stubGlobal('fetch', cloud.fetchMock);

    const deviceA = createDeviceStore();
    deviceA.heldOrders.set(1, {
      id: 1,
      timestamp: '2026-11-21T10:00:00Z',
      serverUser: 'waiter',
      orderType: 'DINE_IN',
      tableNumber: 'T4',
      kitchenStatus: 'PREPARING',
      items: [{ id: 'm1', menuItemId: 'm1', name: 'Zinger', price: 650, qty: 1 }],
      subtotal: 650,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      total: 650,
    });
    activeStore = deviceA;
    const syncA = await loadSyncWithToken();
    await syncA.syncNow();
    expect(cloud.collections.heldOrders.has('1')).toBe(true);

    // Device B (counter / KDS) pulls held order #1 on Table T4
    const deviceB = createDeviceStore();
    activeStore = deviceB;
    vi.resetModules();
    const syncB = await loadSyncWithToken();
    await syncB.syncNow();
    expect(deviceB.heldOrders.get(1)?.tableNumber).toBe('T4');
    expect(deviceB.heldOrders.get(1)?.kitchenStatus).toBe('PREPARING');

    // Device B marks held order READY and pushes via sync
    deviceB.heldOrders.set(1, { ...deviceB.heldOrders.get(1), kitchenStatus: 'READY' });
    await syncB.syncNow();
    // Simulate direct pushSetting / outbox or direct mutation + cloud updateTime bump
    const curDoc = cloud.collections.heldOrders.get('1')!;
    cloud.collections.heldOrders.set('1', {
      ...curDoc,
      fields: {
        ...curDoc.fields,
        kitchenStatus: { stringValue: 'READY' },
      },
      updateTime: '2026-11-21T10:05:00Z',
    });

    activeStore = deviceA;
    vi.resetModules();
    const syncA2 = await loadSyncWithToken();
    await syncA2.syncNow();
    expect(deviceA.heldOrders.get(1)?.kitchenStatus).toBe('READY');
  });

  it('updates synced sales across devices (KDS status, refunds, voids) while keeping offline unsynced sales intact', async () => {
    const cloud = createMockCloud();
    vi.stubGlobal('fetch', cloud.fetchMock);

    const deviceA = createDeviceStore();
    activeStore = deviceA;
    deviceA.sales.set(1, {
      id: 1,
      timestamp: '2026-11-21T10:00:00Z',
      orderType: 'DINE_IN',
      tableNumber: 'T2',
      kitchenStatus: 'PREPARING',
      serverUser: 'cashier',
      items: [{ id: 'm1', menuItemId: 'm1', name: 'Burger', price: 500, qty: 1 }],
      subtotal: 500,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      total: 500,
      payments: [{ method: 'Cash', amount: 500, cashGiven: 500, change: 0 }],
      totalReceived: 500,
      totalChange: 0,
    });

    const syncA = await loadSyncWithToken();
    await syncA.pushSale(1);
    const assignedCloudId = deviceA.sales.get(1)?.cloudId;
    expect(assignedCloudId).toBe('CLOUD_1');

    // Device B pulls the sale + also has its own offline unsynced sale (no cloudId)
    const deviceB = createDeviceStore();
    deviceB.sales.set(99, {
      id: 99,
      timestamp: '2026-11-21T10:01:00Z',
      orderType: 'TAKEAWAY',
      serverUser: 'cashier',
      items: [],
      subtotal: 300,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      total: 300,
      payments: [{ method: 'Card', amount: 300 }],
      totalReceived: 300,
      totalChange: 0,
    });
    activeStore = deviceB;
    vi.resetModules();
    const syncB = await loadSyncWithToken();
    await syncB.syncNow();
    expect([...deviceB.sales.values()].some((s) => s.cloudId === 'CLOUD_1')).toBe(true);
    expect(deviceB.sales.has(99)).toBe(true);

    // Device A refunds / updates Sale #1 and pushes PATCH
    activeStore = deviceA;
    vi.resetModules();
    const syncA2 = await loadSyncWithToken();
    deviceA.sales.set(1, {
      ...deviceA.sales.get(1),
      kitchenStatus: 'SERVED',
      refundStatus: 'FULL',
      refundedAmount: 500,
      updatedAt: '2026-11-21T10:02:00Z',
    });
    await syncA2.pushSale(1);

    // Device B sees refund & SERVED status, while unsynced sale #99 remains untouched
    activeStore = deviceB;
    vi.resetModules();
    const syncB2 = await loadSyncWithToken();
    await syncB2.syncNow();
    const syncedOnB = [...deviceB.sales.values()].find((s) => s.cloudId === 'CLOUD_1');
    expect(syncedOnB?.kitchenStatus).toBe('SERVED');
    expect(syncedOnB?.refundStatus).toBe('FULL');
    expect(syncedOnB?.refundedAmount).toBe(500);
    expect(deviceB.sales.has(99)).toBe(true);

    // Device A voids Sale #1 -> Device B removes Sale #1 but keeps #99
    activeStore = deviceA;
    vi.resetModules();
    const syncA3 = await loadSyncWithToken();
    deviceA.sales.delete(1);
    await syncA3.deleteSale('CLOUD_1');

    activeStore = deviceB;
    vi.resetModules();
    const syncB3 = await loadSyncWithToken();
    await syncB3.syncNow();
    expect([...deviceB.sales.values()].some((s) => s.cloudId === 'CLOUD_1')).toBe(false);
    expect(deviceB.sales.has(99)).toBe(true);
  });

  it('syncs shared shop settings (opening cash, blind shift reports) and deletes across devices', async () => {
    const cloud = createMockCloud();
    vi.stubGlobal('fetch', cloud.fetchMock);

    const deviceA = createDeviceStore();
    activeStore = deviceA;
    const syncA = await loadSyncWithToken();
    deviceA.settings.set('shiftOpeningCash', { key: 'shiftOpeningCash', value: '5000' });
    await syncA.pushSetting('shiftOpeningCash');
    expect(cloud.collections.tableOrders.has('setting_shiftOpeningCash')).toBe(true);

    const deviceB = createDeviceStore();
    activeStore = deviceB;
    vi.resetModules();
    const syncB = await loadSyncWithToken();
    await syncB.syncNow();
    expect(deviceB.settings.get('shiftOpeningCash')?.value).toBe('5000');

    // Blind shift close on Device A deletes shiftOpeningCash and writes closedShiftReports
    activeStore = deviceA;
    vi.resetModules();
    const syncA2 = await loadSyncWithToken();
    deviceA.settings.delete('shiftOpeningCash');
    deviceA.settings.set('closedShiftReports', {
      key: 'closedShiftReports',
      value: JSON.stringify([{ id: 'SHIFT_1', closedBy: 'cashier', countedCash: 4800, expectedDrawerCash: 5000, variance: -200 }]),
    });
    await syncA2.pushSetting('shiftOpeningCash');
    await syncA2.pushSetting('closedShiftReports');

    activeStore = deviceB;
    vi.resetModules();
    const syncB2 = await loadSyncWithToken();
    await syncB2.syncNow();
    expect(deviceB.settings.has('shiftOpeningCash')).toBe(false);
    const reports = JSON.parse(deviceB.settings.get('closedShiftReports')?.value);
    expect(reports[0]).toMatchObject({ id: 'SHIFT_1', closedBy: 'cashier', variance: -200 });
  });
});
