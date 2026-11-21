import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { hasOwnerPin, isValidPin, setOwnerPin, verifyOwnerPin } from '../lib/ownerPin';
import { readSession } from '../lib/auth';

/** Gate for actions a Manager is not allowed to take unaided (delete/edit/refund sales). */
export function OwnerPinModal({ action, onClose, onAuthorized }: {
  action: string;
  onClose: () => void;
  onAuthorized: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pinExists, setPinExists] = useState<boolean | null>(null);
  const isOwner = readSession()?.role === 'OWNER';

  useEffect(() => {
    void hasOwnerPin().then(setPinExists);
  }, []);

  async function submit() {
    setBusy(true);
    try {
      if (!pinExists) {
        if (!isOwner) return setError('The Owner must create an owner PIN first.');
        if (!isValidPin(pin.trim())) return setError('PIN must be 4–8 digits.');
        await setOwnerPin(pin);
        onAuthorized();
      } else if (await verifyOwnerPin(pin)) onAuthorized();
      else setError('Incorrect owner PIN.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify PIN.');
    } finally {
      setBusy(false);
    }
  }

  const blockedNoPin = pinExists === false && !isOwner;

  return (
    <Modal
      title="Owner Authorization"
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 h-11 rounded-[8px] font-medium border border-[#788991] bg-white text-[#000000] hover:bg-[#eff6ff] disabled:opacity-45 transition text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || pinExists === null || blockedNoPin || !pin.trim()}
            className="flex-1 h-11 rounded-[8px] font-semibold bg-[#2941e0] text-white hover:bg-[#1f35c4] disabled:opacity-45 transition text-sm"
          >
            {busy ? 'Checking…' : 'Authorize'}
          </button>
        </div>
      }
    >
      <p className="text-sm text-[#526066] mb-4 leading-relaxed">
        {pinExists === false
          ? isOwner
            ? 'No owner PIN is set yet. Create one now (4–8 digits).'
            : 'No owner PIN has been configured yet. An Owner must sign in and set an owner PIN in Admin Settings before this action can be authorized.'
          : action}
      </p>
      {!blockedNoPin && (
        <>
          <label htmlFor="ownerPin" className="block text-xs font-semibold uppercase tracking-wide text-[#273238] mb-1.5">
            {pinExists === false ? 'Create owner PIN' : 'Enter owner PIN'}
          </label>
          <input
            id="ownerPin"
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="w-full px-3 h-11 text-center tracking-[0.4em] font-bold text-lg border border-[#788991] rounded-[10px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
          />
        </>
      )}
      {error && (
        <p role="alert" className="mt-2.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-[10px] px-3 py-2">
          {error}
        </p>
      )}
    </Modal>
  );
}
