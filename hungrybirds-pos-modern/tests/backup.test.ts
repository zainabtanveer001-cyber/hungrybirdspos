import { describe, it, expect, vi, afterEach } from 'vitest';
import { db } from '../src/lib/db';
import {
  BACKUP_FORMAT,
  PROTECTED_SETTING_KEYS,
  collectBackup,
  parseBackup,
  sanitizeTableRows,
  translateLegacyPassword,
} from '../src/lib/backup';

const backup = (tables: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: BACKUP_FORMAT, version: 1, tables, ...extra });

describe('parseBackup', () => {
  it('rejects anything that is not a POS backup', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/);
    expect(() => parseBackup('{}')).toThrow(/not a Hungry Birds POS backup/);
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, tables: {} })))
      .toThrow(/newer version/);
  });

  it('keeps only real rows and drops non-array tables', () => {
    const parsed = parseBackup(backup({ menu: [{ id: 'm1' }, null, 'x'], sales: 'nope' }));
    expect(parsed.tables.menu).toEqual([{ id: 'm1' }]);
    expect(parsed.tables.sales).toBeUndefined();
  });

  it('tells a legacy export apart from this app’s own backup', () => {
    expect(parseBackup(backup({}, { source: 'legacy' })).legacy).toBe(true);
    // This app stores hashes directly, so its rows must not be run through the plaintext hash again.
    expect(parseBackup(backup({}, { source: 'modern' })).legacy).toBe(false);
  });

  it('reads Firestore staff profiles when present', () => {
    const parsed = parseBackup(backup({}, { firebaseStaff: [{ username: 'ali', role: 'CASHIER' }, 3] }));
    expect(parsed.firebaseStaff).toEqual([{ username: 'ali', role: 'CASHIER' }]);
  });
});

describe('translateLegacyPassword', () => {
  it('hashes plaintext so the legacy account can sign in', async () => {
    const result = await translateLegacyPassword('shop1234');
    expect(result.passwordHash).toBe(await translateLegacyPassword('shop1234').then((r) => r.passwordHash));
    expect(result.passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.note).toBe('password kept');
  });

  it('keeps an already-hashed password as-is', async () => {
    const hash = 'a'.repeat(64);
    expect((await translateLegacyPassword(hash)).passwordHash).toBe(hash);
  });

  it('flags bcrypt instead of pretending it can verify it', async () => {
    const result = await translateLegacyPassword('$2b$10$abcdefghijklmnopqrstuv');
    expect(result.passwordHash).toBeUndefined();
    expect(result.note).toMatch(/bcrypt/);
  });

  it('handles a missing password', async () => {
    expect((await translateLegacyPassword(undefined)).note).toBe('no password on file');
  });
});

describe('backup sanitization & secret redaction (SEC-04)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips protected setting keys and malformed rows during import sanitization', () => {
    const cleanedSettings = sanitizeTableRows('settings', [
      { key: 'ownerPinHash', value: 'forged-hash' },
      { key: 'sync.outbox', value: '{}' },
      { key: 'receiptSettings', value: '{"header":"Hungry Birds"}' },
      { key: '', value: 'ignored' },
    ]);
    expect(cleanedSettings).toEqual([{ key: 'receiptSettings', value: '{"header":"Hungry Birds"}' }]);
    expect(PROTECTED_SETTING_KEYS.has('ownerPinHash')).toBe(true);

    const cleanedMenu = sanitizeTableRows('menu', [
      { id: '', name: 'Bad row', price: 100 },
      { id: 'm1', name: 'Burger', price: -50 },
      { id: 'm2', name: 'Fries', price: 'not-a-number' },
    ]);
    expect(cleanedMenu).toEqual([
      { id: 'm1', name: 'Burger', price: 0 },
      { id: 'm2', name: 'Fries', price: 0 },
    ]);
  });

  it('redacts ownerPinHash, sync state, and user passwordHash from collectBackup exports', async () => {
    vi.spyOn(db, 'tables', 'get').mockReturnValue([
      {
        name: 'settings',
        toArray: async () => [
          { key: 'ownerPinHash', value: 'secret-pin-hash' },
          { key: 'sync.versions', value: '{}' },
          { key: 'lowStockThreshold', value: '5' },
        ],
      },
      {
        name: 'users',
        toArray: async () => [
          { id: 1, username: 'owner', role: 'OWNER', active: true, passwordHash: 'deadbeef' },
        ],
      },
    ] as any);

    const exported = JSON.parse(await collectBackup());
    expect(exported.tables.settings).toEqual([{ key: 'lowStockThreshold', value: '5' }]);
    expect(exported.tables.users).toEqual([{ id: 1, username: 'owner', role: 'OWNER', active: true }]);
  });
});
