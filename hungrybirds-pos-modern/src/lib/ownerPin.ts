import { db } from './db';
import { sha256 } from './crypto';

export const DEFAULT_OWNER_PIN = '7774';

/** Owner authorization PIN, stored hashed in settings (port of getOwnerPinHash). */
export async function getOwnerPinHash(): Promise<string> {
  const setting = await db.settings.get('ownerPinHash');
  return setting ? String(setting.value) : sha256(DEFAULT_OWNER_PIN);
}

export async function verifyOwnerPin(pin: string): Promise<boolean> {
  return (await sha256(String(pin).trim())) === (await getOwnerPinHash());
}

export async function setOwnerPin(pin: string): Promise<void> {
  await db.settings.put({ key: 'ownerPinHash', value: await sha256(String(pin)) });
}
