import { db } from './db';
import { sha256 } from './crypto';
import type { User, UserRole } from './db/types';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

// Initialize Firebase app – replace with your project's config.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'YOUR_API_KEY',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'YOUR_AUTH_DOMAIN',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'YOUR_PROJECT_ID',
  // Add other fields as needed, e.g., storageBucket, messagingSenderId, appId
};

const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);


export const SESSION_KEY = 'loggedUser';

export function normalizeUsername(value: string): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * Seeds the four default role accounts on a fresh install.
 * ponytail: passwords are stored as SHA-256, not bcrypt — matches the
 * "no new dependency for a few lines" rule. Upgrade to bcrypt (or Firebase
 * auth) when real credential hardening is required.
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

export async function signIn(username: string, password: string): Promise<User> {
  const normalized = normalizeUsername(username);
  // First try Firebase authentication
  try {
    const firebaseResult = await signInWithEmailAndPassword(firebaseAuth, username, password);
    // Firebase succeeded – ensure a local user record exists
    let user = await db.users.where('username').equals(normalized).first();
    if (!user) {
      // Create a local user with default role WAITER
      const id = await db.users.add({ username: normalized, passwordHash: await sha256(password), role: 'WAITER', active: true });
      user = await db.users.get(id);
    }
    // Set session and return the user
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username, role: user.role }));
    return user;
  } catch (firebaseErr) {
    // If Firebase fails, fall back to local DB auth (legacy behavior)
    const user = await db.users.where('username').equals(normalized).first();
    if (!user) throw new Error('Username not found.');
    if (user.active === false) throw new Error('This account is disabled. Contact the Owner.');
    const enteredHash = await sha256(password);
    const matches = user.passwordHash ? user.passwordHash === enteredHash : false;
    if (!matches) throw new Error('Incorrect password.');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username, role: user.role }));
    return user;
  }
}


export function signOut(): void {
  sessionStorage.removeItem(SESSION_KEY);
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
