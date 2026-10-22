import { db } from './db';
import { sha256 } from './crypto';
import { forgetToken, rememberToken } from './sync';
import type { User, UserRole } from './db/types';

// Firebase REST instead of the SDK: the legacy app only needs three calls
// (username lookup, sign-in, profile read), and this keeps the bundle small.
// The web config is public by design (it ships in the legacy app.js too), so the
// defaults let a deploy work without env vars; VITE_* wins when it is set.
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'hungry-birds-3e16f';
const API_KEY = import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyAIibLNTusvBFOEcExpdb1tYQh_1rv2q7k';
const AUTH_EMAIL_DOMAIN = 'hungrybirds-pos.local';

export const SESSION_KEY = 'loggedUser';

export function normalizeUsername(value: string): string {
  return String(value || '').trim().toLowerCase();
}

type FirestoreDoc = Record<string, any> | null;

async function firestoreGet(path: string, idToken?: string): Promise<FirestoreDoc> {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}?key=${API_KEY}`,
    { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {}, signal: AbortSignal.timeout(6000) },
  );
  if (!res.ok) return null;
  const fields = (await res.json()).fields ?? {};
  return Object.fromEntries(Object.entries(fields).map(([k, v]: [string, any]) => [k, v.stringValue ?? v.booleanValue]));
}

/** Signs in with the Firebase REST API; returns the auth uid and token pair. */
async function firebaseSignIn(
  email: string,
  password: string,
): Promise<{ uid: string; idToken: string; refreshToken?: string; expiresIn?: string }> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    signal: AbortSignal.timeout(6000),
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

export async function ensureDefaultCategories(): Promise<void> {
  if ((await db.categories.count()) > 0) return;
  await db.categories.bulkAdd([
    { id: 'cat_burgers', name: 'Burgers' },
    { id: 'cat_pizza', name: 'Pizza' },
    { id: 'cat_wraps', name: 'Wraps' },
    { id: 'cat_bowls', name: 'Rice & Bowls' },
    { id: 'cat_drinks', name: 'Drinks' },
    { id: 'cat_desserts', name: 'Desserts' },
  ]);
}

let bootstrap: Promise<void> | null = null;

/** Idempotent across StrictMode double-mounts and HMR. */
export function initializeApp(): Promise<void> {
  bootstrap ??= (async () => {
    await ensureDefaultUsers();
    await ensureDefaultCategories();
  })();
  return bootstrap;
}

/**
 * Legacy cloud login, as the original app did it: username -> auth email via
 * `usernameDirectory`, sign in, then read the role from `users/{uid}`.
 * Throws when the cloud is unconfigured or the account/password is wrong.
 */
async function cloudSignIn(input: string, password: string): Promise<User> {
  // The sign-in field accepts either the username or the auth email.
  let email: string;
  if (input.includes('@')) {
    email = input.trim();
  } else {
    const dir = await firestoreGet(`usernameDirectory/${encodeURIComponent(input)}`);
    if (!dir) throw new Error('Username not found or account is not configured.');
    if (dir.active === false) throw new Error('This account is disabled. Contact the Owner.');
    email = dir.authEmail ?? `${input}@${AUTH_EMAIL_DOMAIN}`;
  }

  const { uid, idToken, refreshToken, expiresIn } = await firebaseSignIn(email, password);
  rememberToken(idToken, refreshToken, Number(expiresIn));
  const profile = (await firestoreGet(`users/${uid}`, idToken)) ?? {};
  if (profile.active === false) throw new Error('This account is disabled. Contact the Owner.');

  const username = (profile.username as string) ?? input.split('@')[0];
  const user: User = {
    username,
    role: (profile.role as UserRole) ?? 'WAITER',
    active: true,
  };
  const existing = await db.users.where('username').equals(username).first();
  if (existing?.id) {
    await db.users.update(existing.id, { role: user.role, active: true });
    user.id = existing.id;
  } else {
    user.id = await db.users.add(user);
  }
  return user;
}

export async function signIn(username: string, password: string): Promise<User> {
  const normalized = normalizeUsername(username);

  let cloudError: unknown = null;
  try {
    const user = await cloudSignIn(normalized, password);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username, role: user.role }));
    return user;
  } catch (err) {
    // Fall through to the local DB so the app still works offline, but keep
    // the cloud's message so a rejected password isn't reported as a missing user.
    cloudError = err;
  }

  const user = await db.users.where('username').equals(normalized).first();
  if (!user) throw cloudError instanceof Error ? cloudError : new Error('Username not found.');
  if (user.active === false) throw new Error('This account is disabled. Contact the Owner.');
  const enteredHash = await sha256(password);
  if (!user.passwordHash || user.passwordHash !== enteredHash)
    throw cloudError instanceof Error ? cloudError : new Error('Incorrect password.');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username, role: user.role }));
  return user;
}

export function signOut(): void {
  sessionStorage.removeItem(SESSION_KEY);
  forgetToken();
}

export function readSession(): { id?: number; username: string; role: UserRole } | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
