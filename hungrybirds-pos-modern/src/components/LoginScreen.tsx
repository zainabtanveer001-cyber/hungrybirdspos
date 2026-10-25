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
    <div className="fixed inset-0 bg-gray-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white/95 backdrop-blur-sm rounded-3xl p-8 sm:p-10 w-full max-w-md shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
        <div className="flex justify-center mb-4">
          <img src="/logo.svg" alt="" className="w-16 h-16" />
        </div>
        <h2 className="text-3xl font-black mb-1 text-center text-gray-900 tracking-tight">Hungry Birds</h2>
        <p className="text-sm text-center text-indigo-600 font-medium mb-8 uppercase tracking-widest">
          Point of Sale
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="loginUsername" className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
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
              className="border border-gray-200 p-3.5 rounded-2xl w-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50 focus:bg-white transition-all shadow-inner"
            />
          </div>
          <div>
            <label htmlFor="loginPassword" className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
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
              className="border border-gray-200 p-3.5 rounded-2xl w-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50 focus:bg-white transition-all shadow-inner"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-bold text-red-600 text-center">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="bg-blue-600 text-white w-full p-4 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-60 transition shadow-sm"
          >
            {busy ? 'Signing in…' : 'Secure Login'}
          </button>
          <p className="text-[11px] text-center text-gray-400 mt-6">
            Authorized Personnel Only.
            <br />
            Accounts are created by the System Administrator.
          </p>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowSetup(true)}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
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

  const field = 'border border-gray-200 p-3 rounded-xl w-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 focus:bg-white';

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-label="Create the owner account">
      <form onSubmit={submit} className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-3">
        <h3 className="text-lg font-black text-gray-900">Create the owner account</h3>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          One-time setup. Use the admin email listed in your Firestore rules
          (<span className="font-mono">owner@hungrybirds.com</span>). This only works once, for the project admin.
        </p>
        <input type="email" required autoComplete="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Admin email" aria-label="Admin email" className={field} />
        <input type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" aria-label="Display name" className={field} />
        <input type="text" required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Owner username (login)" aria-label="Owner username" className={field} />
        <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 6 chars)" aria-label="Password" className={field} />
        {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 text-sm disabled:opacity-60">
            {busy ? 'Creating…' : 'Create owner'}
          </button>
        </div>
      </form>
    </div>
  );
}
