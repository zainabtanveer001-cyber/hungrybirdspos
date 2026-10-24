import { db } from './db';
import { sha256 } from './crypto';

const MAX_FAILS = 5;
const LOCK_MS = 5 * 60_000;

async function hashPin(pin: string, salt: string): Promise<string> {
  return `${salt}:${await sha256(`${salt}:${pin}`)}`;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/** There is deliberately no default PIN: the Owner must create one before it can authorize anything. */
export async function hasOwnerPin(): Promise<boolean> {
  return Boolean(await db.settings.get('ownerPinHash'));
}

export async function setOwnerPin(pin: string): Promise<void> {
  const trimmed = String(pin).trim();
  if (!isValidPin(trimmed)) throw new Error('PIN must be 4–8 digits.');
  const salt = crypto.randomUUID();
  await db.settings.put({ key: 'ownerPinHash', value: await hashPin(trimmed, salt) });
  await db.settings.delete('ownerPinLock');
}

/** Seconds left on a lockout, or 0. */
export async function pinLockSeconds(): Promise<number> {
  const lock = (await db.settings.get('ownerPinLock'))?.value as { until?: number } | undefined;
  return Math.max(0, Math.ceil(((lock?.until ?? 0) - Date.now()) / 1000));
}

/** Throws while locked out; five wrong PINs lock verification for five minutes. */
export async function verifyOwnerPin(pin: string): Promise<boolean> {
  const wait = await pinLockSeconds();
  if (wait > 0) throw new Error(`Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`);

  const stored = await db.settings.get('ownerPinHash');
  if (!stored) return false;
  const [salt] = String(stored.value).split(':');
  const ok = (await hashPin(String(pin).trim(), salt)) === String(stored.value);

  if (ok) {
    await db.settings.delete('ownerPinLock');
    return true;
  }
  const fails = (((await db.settings.get('ownerPinLock'))?.value as { fails?: number } | undefined)?.fails ?? 0) + 1;
  await db.settings.put({
    key: 'ownerPinLock',
    value: fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MS } : { fails },
  });
  return false;
}
