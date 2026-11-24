import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StoreState {
  users: Map<number, any>;
  settings: Map<string, { key: string; value: any }>;
  categories: Map<string, any>;
}

let state: StoreState;

function createState(): StoreState {
  return {
    users: new Map(),
    settings: new Map(),
    categories: new Map(),
  };
}

const mockDb = {
  users: {
    count: async () => state.users.size,
    toArray: async () => [...state.users.values()],
    add: async (row: any) => {
      const keys = [...state.users.keys()];
      const id = row.id ?? (keys.length ? Math.max(...keys) + 1 : 1);
      state.users.set(id, { ...row, id });
      return id;
    },
    update: async (id: number, patch: any) => {
      const cur = state.users.get(id);
      if (cur) state.users.set(id, { ...cur, ...patch });
    },
    where: (field: string) => ({
      equals: (val: any) => ({
        first: async () => [...state.users.values()].find((u) => u[field] === val),
      }),
    }),
  },
  settings: {
    get: async (key: string) => state.settings.get(key),
    put: async (row: any) => {
      state.settings.set(row.key, { ...row });
      return row.key;
    },
  },
  categories: {
    count: async () => state.categories.size,
    bulkAdd: async (rows: any[]) => {
      for (const row of rows) state.categories.set(row.id, { ...row });
    },
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
}

function createAuthAndFirestoreMock() {
  let firestoreStatus: number | null = null;
  let offlineAll = false;

  const directory = new Map<string, { authEmail: string; active: boolean }>([
    ['rehan919', { authEmail: 'owner@hungrybirds.com', active: true }],
    ['cashier1', { authEmail: 'cashier1@hungrybirds-pos.local', active: true }],
  ]);

  const authUsers = new Map<string, { uid: string; password: string }>([
    ['owner@hungrybirds.com', { uid: 'UID_OWNER', password: 'secret-owner-pass' }],
    ['cashier1@hungrybirds-pos.local', { uid: 'UID_CASHIER', password: 'secret-cashier-pass' }],
    ['customer@example.com', { uid: 'UID_CUST', password: 'secret-customer-pass' }],
  ]);

  const userProfiles = new Map<string, { username: string; role?: string; active: boolean }>([
    ['UID_OWNER', { username: 'rehan919', role: 'OWNER', active: true }],
    ['UID_CASHIER', { username: 'cashier1', role: 'CASHIER', active: true }],
    ['UID_CUST', { username: 'cust', active: true }],
  ]);

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (offlineAll) throw new TypeError('Failed to fetch');
    const urlStr = String(input);

    if (urlStr.includes('identitytoolkit.googleapis.com') && urlStr.includes('signInWithPassword')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const found = authUsers.get(String(body.email).toLowerCase());
      if (!found || found.password !== body.password) {
        return new Response(JSON.stringify({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }), { status: 400 });
      }
      return new Response(
        JSON.stringify({
          localId: found.uid,
          idToken: `id-token-${found.uid}`,
          refreshToken: `refresh-token-${found.uid}`,
          expiresIn: '3600',
        }),
        { status: 200 },
      );
    }

    if (urlStr.includes('firestore.googleapis.com')) {
      if (firestoreStatus !== null) {
        return new Response(JSON.stringify({ error: { code: firestoreStatus } }), { status: firestoreStatus });
      }
      const parsed = new URL(urlStr);
      const marker = '/documents/';
      const tail = parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length);
      const [col, docId] = tail.split('/');

      if (col === 'usernameDirectory') {
        const entry = directory.get(decodeURIComponent(docId));
        if (!entry) return new Response('{}', { status: 404 });
        return new Response(
          JSON.stringify({
            fields: {
              authEmail: { stringValue: entry.authEmail },
              active: { booleanValue: entry.active },
            },
          }),
          { status: 200 },
        );
      }

      if (col === 'users') {
        const profile = userProfiles.get(decodeURIComponent(docId));
        if (!profile) return new Response('{}', { status: 404 });
        return new Response(
          JSON.stringify({
            fields: {
              username: { stringValue: profile.username },
              ...(profile.role ? { role: { stringValue: profile.role } } : {}),
              active: { booleanValue: profile.active },
            },
          }),
          { status: 200 },
        );
      }
    }

    return new Response('{}', { status: 404 });
  });

  return {
    fetchMock,
    setFirestoreStatus(code: number | null) {
      firestoreStatus = code;
    },
    setOfflineAll(value: boolean) {
      offlineAll = value;
    },
  };
}

let local: MemoryStorage;
let session: MemoryStorage;

beforeEach(() => {
  vi.resetModules();
  state = createState();
  local = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('auth & login resilience during Firestore 429 quota exhaustion (BUG-015)', () => {
  it('caches authEmail, cloudUid, and passwordHash on cloud login and works offline afterwards', async () => {
    const cloud = createAuthAndFirestoreMock();
    vi.stubGlobal('fetch', cloud.fetchMock);
    const auth = await import('../src/lib/auth');

    const signed = await auth.signIn('rehan919', 'secret-owner-pass');
    expect(signed).toMatchObject({
      username: 'rehan919',
      role: 'OWNER',
      authEmail: 'owner@hungrybirds.com',
      cloudUid: 'UID_OWNER',
    });
    expect(signed.passwordHash).toBeTruthy();

    auth.signOut();
    cloud.setOfflineAll(true);
    const offline = await auth.signIn('rehan919', 'secret-owner-pass');
    expect(offline.username).toBe('rehan919');
    expect(offline.role).toBe('OWNER');
  });

  it('never reports "Username not found" on Firestore 429 and surfaces clear quota guidance on an unprimed device', async () => {
    const cloud = createAuthAndFirestoreMock();
    cloud.setFirestoreStatus(429);
    vi.stubGlobal('fetch', cloud.fetchMock);
    const auth = await import('../src/lib/auth');

    let message = '';
    try {
      await auth.signIn('rehan919', 'secret-owner-pass');
    } catch (err) {
      message = err instanceof Error ? err.message : '';
    }
    expect(message).not.toContain('Username not found');
    expect(message).toContain('429');
    expect(message).toContain('owner@hungrybirds.com');
  });

  it('allows returning staff (rehan919) to sign in during Firestore 429 via cached authEmail + Identity Toolkit', async () => {
    const cloud = createAuthAndFirestoreMock();
    vi.stubGlobal('fetch', cloud.fetchMock);
    const auth = await import('../src/lib/auth');

    await auth.signIn('rehan919', 'secret-owner-pass');
    auth.signOut();

    cloud.setFirestoreStatus(429);
    const user = await auth.signIn('rehan919', 'secret-owner-pass');
    expect(user.username).toBe('rehan919');
    expect(user.role).toBe('OWNER');
    expect(local.getItem('hb.syncToken')).toBeTruthy();
  });

  it('allows owner@hungrybirds.com to sign in during Firestore 429 even without prior local login', async () => {
    const cloud = createAuthAndFirestoreMock();
    cloud.setFirestoreStatus(429);
    vi.stubGlobal('fetch', cloud.fetchMock);
    const auth = await import('../src/lib/auth');

    const user = await auth.signIn('owner@hungrybirds.com', 'secret-owner-pass');
    expect(user.role).toBe('OWNER');
    expect(user.authEmail).toBe('owner@hungrybirds.com');
    expect(user.cloudUid).toBe('UID_OWNER');
    expect(local.getItem('hb.syncToken')).toBeTruthy();
  });

  it('rejects non-staff customer emails during Firestore 429 without privilege escalation', async () => {
    const cloud = createAuthAndFirestoreMock();
    cloud.setFirestoreStatus(429);
    vi.stubGlobal('fetch', cloud.fetchMock);
    const auth = await import('../src/lib/auth');

    await expect(auth.signIn('customer@example.com', 'secret-customer-pass')).rejects.toThrow(
      /Cannot verify staff role on this device until quota resets/,
    );
  });

  it('still throws "Username not found or account is not configured." on genuine 404', async () => {
    const cloud = createAuthAndFirestoreMock();
    vi.stubGlobal('fetch', cloud.fetchMock);
    const auth = await import('../src/lib/auth');

    await expect(auth.signIn('nonexistent_user', 'anything')).rejects.toThrow(
      'Username not found or account is not configured.',
    );
  });

  it('never leaves hb.syncToken in localStorage when a non-staff customer login is rejected', async () => {
    const cloud = createAuthAndFirestoreMock();
    vi.stubGlobal('fetch', cloud.fetchMock);
    const auth = await import('../src/lib/auth');

    await expect(auth.signIn('customer@example.com', 'secret-customer-pass')).rejects.toThrow(
      /does not have POS access/,
    );
    expect(local.getItem('hb.syncToken')).toBeNull();
  });

  it('verifies sessionStorage role against local user record and signs out locally disabled users', async () => {
    const cloud = createAuthAndFirestoreMock();
    vi.stubGlobal('fetch', cloud.fetchMock);
    const auth = await import('../src/lib/auth');

    await auth.signIn('cashier1', 'secret-cashier-pass');
    // Simulate manual sessionStorage role elevation in devtools.
    session.setItem(auth.SESSION_KEY, JSON.stringify({ id: 1, username: 'cashier1', role: 'OWNER' }));

    const verified = await auth.verifyStoredSession();
    expect(verified?.role).toBe('CASHIER');
    expect(auth.readSession()?.role).toBe('CASHIER');

    // Disable locally and re-verify -> should force signOut.
    const stored = [...state.users.values()].find((u) => u.username === 'cashier1');
    stored.active = false;
    expect(await auth.verifyStoredSession()).toBeNull();
    expect(session.getItem(auth.SESSION_KEY)).toBeNull();
    expect(local.getItem('hb.syncToken')).toBeNull();
  });
});
