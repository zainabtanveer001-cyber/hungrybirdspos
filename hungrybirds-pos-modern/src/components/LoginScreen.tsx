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
      className="fixed inset-0 flex items-center justify-center z-50 p-4 overflow-y-auto"
      style={{
        background:
          'radial-gradient(circle at 50% 20%, rgba(91, 62, 224, 0.38) 0%, rgba(7, 16, 60, 0.92) 55%, #000524 100%)',
      }}
    >
      <div className="bg-white rounded-2xl border border-[#c5b9fa] p-6 sm:p-10 w-full max-w-md shadow-[0_24px_60px_rgba(0,5,36,0.55)] my-auto">
        <div className="flex justify-center mb-3">
          <img src="/logo.svg" alt="" className="w-14 h-14" />
        </div>
        <div className="flex justify-center mb-2">
          <span className="inline-block rounded-[88px] bg-[#eff6ff] text-[#2941e0] px-4 py-1 text-xs font-semibold">
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
              className="border border-[#788991] px-3.5 py-2.5 h-11 rounded-[10px] w-full text-sm text-[#000000] placeholder:text-[#616f75] bg-white focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] transition-all"
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
              className="border border-[#788991] px-3.5 py-2.5 h-11 rounded-[10px] w-full text-sm text-[#000000] placeholder:text-[#616f75] bg-white focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] transition-all"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-[10px] px-3 py-2 text-center">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="bg-[#2941e0] text-white w-full h-11 px-6 rounded-[8px] text-sm font-medium tracking-[0.3px] hover:bg-[#1f35c4] disabled:opacity-60 transition"
          >
            {busy ? 'Signing in…' : 'Secure Login'}
          </button>
          <p className="text-xs text-center text-[#526066] mt-5">
            Authorized Personnel Only.
            <br />
            Accounts are created by the System Administrator.
          </p>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowSetup(true)}
              className="text-xs font-medium text-[#2941e0] hover:underline underline-offset-2 py-1"
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
    'border border-[#788991] px-3 py-2 h-10 rounded-[10px] w-full text-sm text-[#000000] placeholder:text-[#616f75] bg-white focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]';

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
      className="fixed inset-0 bg-[#000524]/70 flex items-center justify-center z-[60] p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ownerSetupHeading"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose();
      }}
    >
      <form onSubmit={submit} className="bg-white rounded-2xl border border-[#c5b9fa] p-6 w-full max-w-sm shadow-2xl space-y-3 my-auto">
        <h3 id="ownerSetupHeading" className="font-display text-lg font-medium text-[#000000]">
          Create the owner account
        </h3>
        <p className="text-xs text-[#526066] leading-relaxed">
          One-time setup. Use the admin email listed in your Firestore rules
          (<span className="font-mono text-[#273238]">owner@hungrybirds.com</span>). This only works once, for the project admin.
        </p>
        <div>
          <label htmlFor="setupAdminEmail" className="block text-xs font-medium text-[#273238] mb-1">
            Admin Email
          </label>
          <input id="setupAdminEmail" type="email" required autoComplete="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="owner@hungrybirds.com" className={field} />
        </div>
        <div>
          <label htmlFor="setupDisplayName" className="block text-xs font-medium text-[#273238] mb-1">
            Your Name
          </label>
          <input id="setupDisplayName" type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Full name" className={field} />
        </div>
        <div>
          <label htmlFor="setupUsername" className="block text-xs font-medium text-[#273238] mb-1">
            Owner Username
          </label>
          <input id="setupUsername" type="text" required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. owner" className={field} />
        </div>
        <div>
          <label htmlFor="setupPassword" className="block text-xs font-medium text-[#273238] mb-1">
            Password (min 6 characters)
          </label>
          <input id="setupPassword" type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" className={field} />
        </div>
        {error && (
          <p role="alert" className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-[10px] px-3 py-2">
            {error}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 h-10 rounded-[8px] font-medium border border-[#788991] text-[#000000] hover:bg-[#eff6ff] text-sm disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex-1 h-10 rounded-[8px] font-medium bg-[#2941e0] text-white hover:bg-[#1f35c4] text-sm disabled:opacity-60">
            {busy ? 'Creating…' : 'Create owner'}
          </button>
        </div>
      </form>
    </div>
  );
}
