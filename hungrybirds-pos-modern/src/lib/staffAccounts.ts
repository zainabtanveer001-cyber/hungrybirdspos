import { configManager } from './config';
import { normalizeUsername } from './auth';
import { getAccessToken, rememberToken, restWrite } from './sync';
import type { UserRole } from './db/types';

/**
 * Staff account provisioning over the Firebase REST API — the POS port of the
 * legacy app's owner-only employee screen (app.js createEmployee). The account
 * is created with the project's public API key, then the caller's staff token
 * writes the profile and username-directory docs, both of which the Firestore
 * rules restrict to staff/admin.
 */

const AUTH_EMAIL_DOMAIN = 'hungrybirds-pos.local';

const USERNAME_RE = /^[a-z0-9._-]+$/;

export interface StaffAccount {
  uid: string;
  username: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

function authEmail(username: string): string {
  return `${username}@${AUTH_EMAIL_DOMAIN}`;
}

async function firestoreBase(): Promise<{ base: string; key: string }> {
  const config = await configManager.getConfig();
  if (!config) throw new Error('Cloud is not configured. Run Cloud Setup first.');
  return {
    base: `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`,
    key: config.apiKey,
  };
}

/** Public Firestore read (usernameDirectory is world-readable by design). */
async function directoryGet(username: string): Promise<Record<string, unknown> | null> {
  const { base, key } = await firestoreBase();
  const res = await fetch(`${base}/usernameDirectory/${encodeURIComponent(username)}?key=${key}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Could not reach the cloud. Check your connection.');
  return (await res.json()).fields ?? {};
}

/** Creates the Firebase Auth account; returns its uid. Fails loudly on duplicates. */
async function createAuthUser(email: string, password: string): Promise<string> {
  const { key } = await firestoreBase();
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: {} }));
    if (error?.message === 'EMAIL_EXISTS') throw new Error('That username is already in use.');
    if (error?.message?.startsWith('WEAK_PASSWORD')) throw new Error('Password must be at least 6 characters.');
    throw new Error('Account creation failed. Check your connection and try again.');
  }
  return (await res.json()).localId as string;
}

export async function listStaffAccounts(): Promise<StaffAccount[]> {
  const { base } = await firestoreBase();
  const res = await restWrite('POST', `${base}:runQuery`, {
    structuredQuery: { from: [{ collectionId: 'users' }] },
  });
  if (!Array.isArray(res)) throw new Error('Could not load staff accounts.');
  const out: StaffAccount[] = [];
  for (const row of res) {
    const doc = row.document;
    if (!doc) continue;
    const f = doc.fields ?? {};
    if (!f.role?.stringValue) continue; // customer loyalty docs have no role
    out.push({
      uid: doc.name.split('/').pop(),
      username: f.username?.stringValue ?? '',
      displayName: f.displayName?.stringValue ?? '',
      role: f.role.stringValue as UserRole,
      active: f.active?.booleanValue !== false,
    });
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

export async function createStaffAccount(input: {
  displayName: string;
  username: string;
  password: string;
  role: UserRole;
}): Promise<void> {
  const username = normalizeUsername(input.username);
  if (!input.displayName.trim()) throw new Error('Enter a display name.');
  if (!USERNAME_RE.test(username)) throw new Error('Username may only use lowercase letters, numbers, dots, underscores and hyphens.');
  if (input.password.length < 6) throw new Error('Password must be at least 6 characters.');

  const existing = await directoryGet(username);
  if (existing && Object.keys(existing).length > 0) throw new Error('That username is already in use.');

  const uid = await createAuthUser(authEmail(username), input.password);
  const email = authEmail(username);

  const { base } = await firestoreBase();
  const profile = await restWrite('PATCH', `${base}/users/${uid}`, {
    fields: {
      username: { stringValue: username },
      usernameLower: { stringValue: username },
      displayName: { stringValue: input.displayName.trim() },
      role: { stringValue: input.role },
      active: { booleanValue: true },
      authEmail: { stringValue: email },
    },
  });
  if (!profile) throw new Error('Account created but the profile write was rejected. Publish the latest Firestore rules.');

  const directory = await restWrite('PATCH', `${base}/usernameDirectory/${encodeURIComponent(username)}`, {
    fields: { authEmail: { stringValue: email }, active: { booleanValue: true } },
  });
  if (!directory) throw new Error('Profile saved but the username directory write was rejected. Publish the latest Firestore rules.');
}

export async function setStaffActive(account: StaffAccount, active: boolean): Promise<void> {
  const { base } = await firestoreBase();
  const mask = 'updateMask.fieldPaths=active';
  const profile = await restWrite('PATCH', `${base}/users/${account.uid}?${mask}`, {
    fields: { active: { booleanValue: active } },
  });
  if (!profile) throw new Error('Could not update the account.');
  await restWrite('PATCH', `${base}/usernameDirectory/${encodeURIComponent(account.username)}?${mask}`, {
    fields: { active: { booleanValue: active } },
  });
}

/** Resolves true when the session holds a usable cloud token (staff actions need it). */
export async function cloudSessionAvailable(): Promise<boolean> {
  return (await getAccessToken()) !== null;
}

/* --------------------------------------------------------- first-run owner */

/**
 * One-time bootstrap: sign in (or create) the Firebase auth account whose
 * email is on the admin allowlist in the Firestore rules, then write the
 * OWNER profile and username-directory entry. Only the allowlisted admin
 * email may attach a role, so this is the first-run path and fails loudly for
 * anyone who is not the project admin. Returns the signed-in identity.
 */
export async function bootstrapOwnerAccount(input: {
  adminEmail: string;
  displayName: string;
  username: string;
  password: string;
}): Promise<{ uid: string; idToken: string }> {
  const username = normalizeUsername(input.username);
  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (!adminEmail.includes('@')) throw new Error('Enter the admin email listed in the Firestore rules.');
  if (!input.displayName.trim()) throw new Error('Enter a display name.');
  if (!USERNAME_RE.test(username)) throw new Error('Username may only use lowercase letters, numbers, dots, underscores and hyphens.');
  if (input.password.length < 6) throw new Error('Password must be at least 6 characters.');

  const existing = await directoryGet(username);
  if (existing && Object.keys(existing).length > 0) throw new Error('That username is already in use.');

  const { key } = await firestoreBase();

  // Try to create the admin auth account; if it already exists, sign in.
  let uid: string;
  let idToken: string;
  let refreshToken: string | undefined;
  let expiresIn: string | undefined;
  const body = JSON.stringify({ email: adminEmail, password: input.password, returnSecureToken: true });
  const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(8000),
  });
  if (signUp.ok) {
    ({ localId: uid, idToken, refreshToken, expiresIn } = await signUp.json());
  } else {
    const { error } = await signUp.json().catch(() => ({ error: {} }));
    if (error?.message !== 'EMAIL_EXISTS') throw new Error('Could not create the account. Check your connection.');
    const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(8000),
    });
    if (!signIn.ok) throw new Error('That admin email already exists and the password is wrong.');
    ({ localId: uid, idToken, refreshToken, expiresIn } = await signIn.json());
  }

  // Use THIS account's token — the Firestore rules only allow an admin email
  // to attach a role, and a self-create may not carry one.
  const { base } = await firestoreBase();
  const authz = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
  const write = async (path: string, fields: Record<string, unknown>, mask?: string) => {
    const res = await fetch(`${base}/${path}${mask ? `?${mask}&` : '?'}key=${key}`, {
      method: 'PATCH',
      headers: authz,
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('The owner profile write was rejected. Is this email on the admin allowlist in the Firestore rules?');
  };

  await write(`users/${uid}`, {
    username: { stringValue: username },
    usernameLower: { stringValue: username },
    displayName: { stringValue: input.displayName.trim() },
    role: { stringValue: 'OWNER' },
    active: { booleanValue: true },
    authEmail: { stringValue: adminEmail },
  });
  await write(`usernameDirectory/${encodeURIComponent(username)}`, {
    authEmail: { stringValue: adminEmail },
    active: { booleanValue: true },
  });

  // The writes above only succeed when the rules accepted this account as
  // admin; keep its token so the app treats this as a real cloud session.
  rememberToken(idToken, refreshToken, Number(expiresIn));
  return { uid, idToken };
}
