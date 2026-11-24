import { db } from './db';
import { sha256 } from './crypto';
import { forgetToken, rememberToken } from './sync';
import { configManager } from './config';
import { ensureShiftStart } from './shift';
import type { User, UserRole } from './db/types';

// Firebase REST instead of the SDK: the legacy app only needs three calls
// (username lookup, sign-in, profile read), and this keeps the bundle small.
// The web config is public by design (it ships in the legacy app.js too), so the
// defaults let a deploy work without env vars; VITE_* wins when it is set.
const AUTH_EMAIL_DOMAIN = 'hungrybirds-pos.local';
const ADMIN_FALLBACK_EMAILS = new Set(['owner@hungrybirds.com']);

const ROLES: UserRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER'];

export const SESSION_KEY = 'loggedUser';

export function normalizeUsername(value: string): string {
  return String(value || '').trim().toLowerCase();
}

/** Network/server failure: the only case where the local accounts may stand in for the cloud. */
class OfflineError extends Error {}

/** Firestore daily Spark quota / rate limit (429); Identity Toolkit auth may still be healthy. */
class CloudQuotaError extends OfflineError {}

async function cloudFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(6000) });
    if (res.status === 429) {
      throw new CloudQuotaError('Cloud database daily quota limit reached (Firestore 429).');
    }
    if (res.status >= 500) throw new OfflineError('Cloud unavailable.');
    return res;
  } catch (err) {
    throw err instanceof OfflineError ? err : new OfflineError('Cloud unreachable. Check your connection.');
  }
}

type FirestoreDoc = Record<string, any> | null;

async function firestoreGet(path: string, idToken?: string): Promise<FirestoreDoc> {
  const config = await configManager.getConfig();
  if (!config) return null;

  const res = await cloudFetch(
    `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/${path}?key=${config.apiKey}`,
    { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Cloud lookup failed (HTTP ${res.status}).`);
  const fields = (await res.json()).fields ?? {};
  return Object.fromEntries(Object.entries(fields).map(([k, v]: [string, any]) => [k, v.stringValue ?? v.booleanValue]));
}

/** Signs in with the Firebase REST API; returns the auth uid and token pair. */
async function firebaseSignIn(
  email: string,
  password: string,
): Promise<{ uid: string; idToken: string; refreshToken?: string; expiresIn?: string }> {
  const config = await configManager.getConfig();
  if (!config) throw new Error('Cloud not configured. Please run Setup Wizard.');

  const res = await cloudFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: {} }));
    const code = error?.message ?? '';
    if (code === 'INVALID_LOGIN_CREDENTIALS' || code === 'EMAIL_NOT_FOUND' || code === 'INVALID_PASSWORD')
      throw new Error('Incorrect password.');
    throw new Error('Login failed. Check your connection and try again.');
  }
  const { localId, idToken, refreshToken, expiresIn } = await res.json();
  return { uid: localId, idToken, refreshToken, expiresIn };
}

/**
 * Seeds the four default role accounts on a fresh install.
 * ponytail: passwords are stored as SHA-256, not bcrypt — matches the
 * "no new dependency for a few lines" rule. Upgrade to bcrypt when real
 * credential hardening is required.
 */
async function ensureDefaultUsers(): Promise<void> {
  if ((await db.users.count()) > 0) return;
  const defaults: Array<{ username: string; password: string; role: UserRole }> = [
    { username: 'owner', password: '1234', role: 'OWNER' },
    { username: 'manager', password: '1234', role: 'MANAGER' },
    { username: 'cashier', password: '1234', role: 'CASHIER' },
    { username: 'waiter', password: '1234', role: 'WAITER' },
  ];
  for (const { username, password, role } of defaults) {
    await db.users.add({ username, passwordHash: await sha256(password), role, active: true });
  }
}

export const CATEGORIES_INITIALIZED_KEY = 'categoriesInitialized';

export async function ensureDefaultCategories(): Promise<void> {
  const initialized = await db.settings.get(CATEGORIES_INITIALIZED_KEY);
  if (initialized?.value === 'true') return;
  if ((await db.categories.count()) > 0) {
    await db.settings.put({ key: CATEGORIES_INITIALIZED_KEY, value: 'true' });
    return;
  }
  await db.categories.bulkAdd([
    { id: 'cat_burgers', name: 'Burgers' },
    { id: 'cat_pizza', name: 'Pizza' },
    { id: 'cat_wraps', name: 'Wraps' },
    { id: 'cat_bowls', name: 'Rice & Bowls' },
    { id: 'cat_drinks', name: 'Drinks' },
    { id: 'cat_desserts', name: 'Desserts' },
  ]);
  await db.settings.put({ key: CATEGORIES_INITIALIZED_KEY, value: 'true' });
}

let bootstrap: Promise<void> | null = null;

/** Idempotent across StrictMode double-mounts and HMR. */
export function initializeApp(): Promise<void> {
  bootstrap ??= (async () => {
    await ensureDefaultUsers();
    await ensureDefaultCategories();
    await ensureShiftStart();
  })();
  return bootstrap;
}

async function findLocalUser(input: string): Promise<User | undefined> {
  if (input.includes('@')) {
    const all = await db.users.toArray();
    return all.find((u) => u.authEmail?.toLowerCase() === input.toLowerCase());
  }
  return db.users.where('username').equals(input).first();
}

async function upsertVerifiedUser(user: User, extra: { authEmail?: string; cloudUid?: string; passwordHash?: string }): Promise<User> {
  const fields: Partial<User> = {
    role: user.role,
    active: true,
    ...(extra.authEmail ? { authEmail: extra.authEmail } : {}),
    ...(extra.cloudUid ? { cloudUid: extra.cloudUid } : {}),
    ...(extra.passwordHash ? { passwordHash: extra.passwordHash } : {}),
  };
  const existing = user.id
    ? user
    : await db.users.where('username').equals(user.username).first();
  if (existing?.id) {
    await db.users.update(existing.id, fields);
    return { ...existing, ...fields, id: existing.id };
  }
  const id = await db.users.add({ ...user, ...fields });
  return { ...user, ...fields, id };
}

async function resolveQuotaFallbackUser(
  uid: string,
  email: string,
  input: string,
  passwordHash: string,
): Promise<User> {
  const allLocal = await db.users.toArray();
  const normalizedEmail = email.toLowerCase();
  let matched =
    allLocal.find((u) => u.cloudUid === uid) ??
    allLocal.find((u) => u.authEmail?.toLowerCase() === normalizedEmail) ??
    (!input.includes('@') ? allLocal.find((u) => u.username === input) : undefined);

  if (!matched && ADMIN_FALLBACK_EMAILS.has(normalizedEmail)) {
    const owners = allLocal.filter((u) => u.role === 'OWNER');
    matched =
      owners.find((u) => u.username !== 'owner') ??
      owners[0] ?? { username: normalizedEmail.split('@')[0], role: 'OWNER' as UserRole, active: true };
  }

  if (!matched) {
    throw new Error('Cloud database quota limit reached (Firestore 429). Cannot verify staff role on this device until quota resets.');
  }
  if (matched.active === false) {
    throw new Error('This account is disabled. Contact the Owner.');
  }
  if (!ROLES.includes(matched.role)) {
    throw new Error('This account does not have POS access.');
  }
  return upsertVerifiedUser(matched, { authEmail: email, cloudUid: uid, passwordHash });
}

/**
 * Legacy cloud login, as the original app did it: username -> auth email via
 * `usernameDirectory`, sign in, then read the role from `users/{uid}`.
 * Gracefully degrades when Firestore returns 429 (Spark daily quota) while
 * Identity Toolkit auth (`firebaseSignIn`) or local cached credentials remain valid.
 */
async function cloudSignIn(input: string, password: string): Promise<User> {
  const localUser = await findLocalUser(input);
  let firestoreQuotaHit = false;
  let usedGuessedEmail = false;
  let email: string;

  if (input.includes('@')) {
    email = input.trim();
  } else {
    try {
      const dir = await firestoreGet(`usernameDirectory/${encodeURIComponent(input)}`);
      if (!dir) throw new Error('Username not found or account is not configured.');
      if (dir.active === false) throw new Error('This account is disabled. Contact the Owner.');
      email = dir.authEmail ?? `${input}@${AUTH_EMAIL_DOMAIN}`;
    } catch (err) {
      if (!(err instanceof CloudQuotaError)) throw err;
      firestoreQuotaHit = true;
      usedGuessedEmail = !localUser?.authEmail;
      email = localUser?.authEmail ?? `${input}@${AUTH_EMAIL_DOMAIN}`;
    }
  }

  let authResult: { uid: string; idToken: string; refreshToken?: string; expiresIn?: string };
  try {
    authResult = await firebaseSignIn(email, password);
  } catch (err) {
    if (err instanceof Error && err.message === 'Incorrect password.' && firestoreQuotaHit && usedGuessedEmail) {
      if (localUser && localUser.active !== false && localUser.passwordHash && localUser.passwordHash === (await sha256(password))) {
        return localUser;
      }
      throw new Error(
        'Cloud database quota limit reached (Firestore 429). Try signing in with your full email address (e.g. owner@hungrybirds.com) or retry after quota resets.',
      );
    }
    throw err;
  }

  const { uid, idToken, refreshToken, expiresIn } = authResult;
  const passwordHash = await sha256(password);
  let profile: FirestoreDoc = null;
  if (!firestoreQuotaHit) {
    try {
      profile = await firestoreGet(`users/${uid}`, idToken);
    } catch (err) {
      if (!(err instanceof CloudQuotaError)) throw err;
      firestoreQuotaHit = true;
    }
  }

  if (firestoreQuotaHit) {
    const user = await resolveQuotaFallbackUser(uid, email, input, passwordHash);
    rememberToken(idToken, refreshToken, Number(expiresIn));
    return user;
  }

  const resolvedProfile = profile ?? {};
  if (resolvedProfile.active === false) {
    forgetToken();
    throw new Error('This account is disabled. Contact the Owner.');
  }

  // Customer accounts sign in to the same Firebase project but have no staff role.
  if (!ROLES.includes(resolvedProfile.role as UserRole)) {
    forgetToken();
    throw new Error('This account does not have POS access.');
  }

  const username = (resolvedProfile.username as string) ?? input.split('@')[0];
  rememberToken(idToken, refreshToken, Number(expiresIn));
  return upsertVerifiedUser(
    { username, role: resolvedProfile.role as UserRole, active: true },
    { authEmail: email, cloudUid: uid, passwordHash },
  );
}

export async function signIn(username: string, password: string): Promise<User> {
  const normalized = normalizeUsername(username);

  try {
    const user = await cloudSignIn(normalized, password);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username, role: user.role }));
    return user;
  } catch (err) {
    // A definitive cloud answer (wrong password, unknown/disabled user) must not be
    // overridden by the seeded local accounts; only an unreachable cloud may.
    if (!(err instanceof OfflineError)) throw err;

    const user = await findLocalUser(normalized);
    if (!user || !user.passwordHash) {
      if (err instanceof CloudQuotaError) {
        throw new Error(
          'Cloud database quota limit reached (Firestore 429). Try signing in with your full email address (e.g. owner@hungrybirds.com) or retry after the daily quota resets.',
        );
      }
      if (!user) throw new Error('Cloud unreachable and no local account for this username.');
    }
    if (user.active === false) throw new Error('This account is disabled. Contact the Owner.');
    if (!user.passwordHash || user.passwordHash !== (await sha256(password))) throw new Error('Incorrect password.');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username, role: user.role }));
    return user;
  }
}

export function signOut(): void {
  sessionStorage.removeItem(SESSION_KEY);
  forgetToken();
}

export function readSession(): { id?: number; username: string; role: UserRole } | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.username !== 'string' || !ROLES.includes(parsed.role)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Re-validates the stored session against local verified user records on startup. */
export async function verifyStoredSession(): Promise<{ id?: number; username: string; role: UserRole } | null> {
  const current = readSession();
  if (!current) return null;
  const localUser = await findLocalUser(normalizeUsername(current.username));
  if (localUser) {
    if (localUser.active === false) {
      signOut();
      return null;
    }
    if (localUser.role !== current.role) {
      const corrected = { id: localUser.id, username: localUser.username, role: localUser.role };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(corrected));
      return corrected;
    }
  }
  return current;
}
