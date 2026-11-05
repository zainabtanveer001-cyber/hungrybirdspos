import { useState } from 'react';
import { signIn } from '../lib/auth';
import { bootstrapOwnerAccount } from '../lib/staffAccounts';
import type { User } from '../lib/db/types';

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      onSignedIn(await signIn(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{
        background:
          'radial-gradient(circle at 50% 20%, rgba(121, 90, 250, 0.35) 0%, rgba(7, 16, 60, 0.92) 55%, #000524 100%)',
      }}
    >
      <div className="bg-white rounded-2xl border border-[#c5b9fa] p-8 sm:p-10 w-full max-w-md shadow-[0_24px_60px_rgba(0,5,36,0.55)]">
        <div className="flex justify-center mb-3">
          <img src="/logo.svg" alt="" className="w-14 h-14" />
        </div>
        <div className="flex justify-center mb-2">
          <span className="inline-block rounded-[88px] bg-[#eff6ff] text-[#2941e0] px-4 py-1 text-xs font-medium">
            Point of Sale
          </span>
        </div>
        <h2 className="font-display text-3xl font-medium mb-6 text-center text-[#000000] tracking-normal">
          Hungry Birds
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="loginUsername" className="block text-xs font-medium text-[#273238] mb-1.5">
              Username
            </label>
            <input
              id="loginUsername"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              className="border border-[#b4c4cc] px-3.5 py-2.5 h-10 rounded-[10px] w-full text-sm text-[#000000] bg-white focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] transition-all"
            />
          </div>
          <div>
            <label htmlFor="loginPassword" className="block text-xs font-medium text-[#273238] mb-1.5">
              Password
            </label>
            <input
              id="loginPassword"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="border border-[#b4c4cc] px-3.5 py-2.5 h-10 rounded-[10px] w-full text-sm text-[#000000] bg-white focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] transition-all"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-red-600 text-center">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="bg-[#2941e0] text-white w-full h-11 px-6 rounded-[8px] text-sm font-medium tracking-[0.5px] hover:bg-[#1f35c4] disabled:opacity-60 transition"
          >
            {busy ? 'Signing in…' : 'Secure Login'}
          </button>
          <p className="text-xs text-center text-[#616f75] mt-5">
            Authorized Personnel Only.
            <br />
            Accounts are created by the System Administrator.
          </p>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowSetup(true)}
              className="text-xs font-medium text-[#2941e0] hover:underline underline-offset-2"
            >
              First time? Create the owner account
            </button>
          </div>
        </form>
      </div>
      {showSetup && (
        <OwnerSetupModal
          onClose={() => setShowSetup(false)}
          onDone={(u) => onSignedIn(u)}
        />
      )}
    </div>
  );
}

/** One-time, signed-out bootstrap of the first OWNER account (admin email only). */
function OwnerSetupModal({ onClose, onDone }: {
  onClose: () => void;
  onDone: (user: User) => void;
}) {
  const [adminEmail, setAdminEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const field =
    'border border-[#b4c4cc] px-3 py-2 h-10 rounded-[10px] w-full text-sm text-[#000000] bg-white focus:outline-none focus:ring-2 focus:ring-[#2941e0]';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await bootstrapOwnerAccount({ adminEmail, displayName, username, password });
      onDone(await signIn(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[#000524]/70 flex items-center justify-center z-[60] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create the owner account"
    >
      <form onSubmit={submit} className="bg-white rounded-2xl border border-[#c5b9fa] p-6 w-full max-w-sm shadow-2xl space-y-3">
        <h3 className="font-display text-lg font-medium text-[#000000]">Create the owner account</h3>
        <p className="text-xs text-[#526066] leading-relaxed">
          One-time setup. Use the admin email listed in your Firestore rules
          (<span className="font-mono">owner@hungrybirds.com</span>). This only works once, for the project admin.
        </p>
        <input type="email" required autoComplete="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Admin email" aria-label="Admin email" className={field} />
        <input type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" aria-label="Display name" className={field} />
        <input type="text" required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Owner username (login)" aria-label="Owner username" className={field} />
        <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 6 chars)" aria-label="Password" className={field} />
        {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-9 rounded-[8px] font-medium border border-[#b4c4cc] text-[#000000] hover:bg-[#eff6ff] text-sm">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex-1 h-9 rounded-[8px] font-medium bg-[#2941e0] text-white hover:bg-[#1f35c4] text-sm disabled:opacity-60">
            {busy ? 'Creating…' : 'Create owner'}
          </button>
        </div>
      </form>
    </div>
  );
}
