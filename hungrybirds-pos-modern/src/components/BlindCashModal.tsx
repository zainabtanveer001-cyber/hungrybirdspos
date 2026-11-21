import { useMemo, useState } from 'react';
import { Banknote, EyeOff, ShieldCheck } from 'lucide-react';
import { formatAmount } from '../lib/format';
import {
  closeShift,
  computeDenominationTotal,
  getShiftStart,
  PKR_DENOMINATIONS,
} from '../lib/shift';
import { useLive } from '../lib/useLive';
import { Modal } from './Modal';
import type { UserRole } from '../lib/db/types';

export function BlindCashModal({
  username,
  role,
  onClose,
  notify,
}: {
  username: string;
  role: UserRole;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const shiftStart = useLive(() => getShiftStart(), []);
  const [mode, setMode] = useState<'direct' | 'denominations'>('direct');
  const [directAmount, setDirectAmount] = useState<string>('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [looseCoins, setLooseCoins] = useState<string>('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const coinsNum = Math.max(0, Number(looseCoins) || 0);
  const denomTotal = useMemo(
    () => computeDenominationTotal(counts, coinsNum),
    [counts, coinsNum],
  );

  const hasValidDirect =
    directAmount.trim() !== '' &&
    Number.isFinite(Number(directAmount)) &&
    Number(directAmount) >= 0;

  const countedCash =
    mode === 'denominations'
      ? denomTotal
      : hasValidDirect
        ? Number(directAmount)
        : 0;

  const canContinue = mode === 'denominations' || hasValidDirect;

  function updateCount(denom: number, raw: string) {
    const qty = Math.max(0, Math.floor(Number(raw) || 0));
    setCounts((prev) => ({ ...prev, [String(denom)]: qty }));
    setError('');
  }

  function handleReview() {
    if (!canContinue) {
      setError('Enter the counted cash amount (or switch to the PKR note counter).');
      return;
    }
    setError('');
    setConfirming(true);
  }

  async function handleConfirmClose() {
    if (busy) return;
    setBusy(true);
    try {
      const usedDenominations = mode === 'denominations'
        ? Object.fromEntries(
            PKR_DENOMINATIONS.map((d) => [String(d), Math.max(0, Math.floor(Number(counts[String(d)]) || 0))])
              .filter(([, qty]) => Number(qty) > 0),
          )
        : undefined;

      await closeShift(
        username,
        {
          countedCash,
          denominations: usedDenominations,
          looseCoins: mode === 'denominations' && coinsNum > 0 ? coinsNum : undefined,
          note: note.trim() || undefined,
        },
        role,
      );
      notify('Blind cash count submitted and shift closed.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close shift.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Blind Cash Drop / Close Shift"
      onClose={onClose}
      closeDisabled={busy}
      footer={
        confirming ? (
          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-[#273238]">
              Submit blind count of <span className="text-[#2941e0] tabular-nums">{formatAmount(countedCash)}</span> and close the current shift? Only Owner/Manager can view the variance.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="flex-1 h-10 rounded-[8px] border border-[#788991] bg-white text-[#000000] hover:bg-[#eff6ff] text-xs font-semibold transition"
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirmClose()}
                className="flex-[2] h-10 rounded-[8px] bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50 transition"
              >
                {busy ? 'Submitting…' : 'Confirm Close Shift'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 h-11 rounded-[8px] border border-[#788991] bg-white text-[#000000] hover:bg-[#eff6ff] text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canContinue || busy}
              onClick={handleReview}
              className="flex-[2] h-11 rounded-[8px] bg-[#2941e0] hover:bg-[#1f35c4] disabled:opacity-45 text-white text-sm font-semibold transition"
            >
              Submit Blind Count &amp; Close Shift
            </button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <div className="p-3 rounded-2xl bg-[#eff6ff] border border-[#e0edff] flex items-start gap-2.5 text-xs text-[#273238]">
          <EyeOff className="w-4 h-4 text-[#2941e0] shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="font-semibold text-[#000000]">Blind Drawer Reconciliation</p>
            <p className="text-[#526066] mt-0.5">
              Count the physical cash in your drawer and submit below. Expected drawer totals and sales figures are kept hidden during blind close.
            </p>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-[#f8fafd] border border-[#e0edff] text-xs text-[#526066] space-y-1">
          <div className="flex justify-between gap-2">
            <span>Cashier / Staff:</span>
            <strong className="text-[#000000]">{username} ({role})</strong>
          </div>
          <div className="flex justify-between gap-2">
            <span>Shift started:</span>
            <strong className="text-[#000000] tabular-nums">
              {shiftStart ? new Date(shiftStart).toLocaleString() : 'Loading…'}
            </strong>
          </div>
        </div>

        <div
          role="group"
          aria-label="Cash count input method"
          className="grid grid-cols-2 gap-1.5 bg-[#f8fafd] p-1 rounded-[10px] border border-[#e0edff]"
        >
          <button
            type="button"
            disabled={busy || confirming}
            onClick={() => {
              setMode('direct');
              setConfirming(false);
            }}
            aria-pressed={mode === 'direct'}
            className={`min-h-9 rounded-[8px] text-xs font-semibold transition ${
              mode === 'direct'
                ? 'bg-[#000524] text-white shadow-xs'
                : 'text-[#273238] hover:bg-white'
            }`}
          >
            Enter Total Cash
          </button>
          <button
            type="button"
            disabled={busy || confirming}
            onClick={() => {
              setMode('denominations');
              setConfirming(false);
            }}
            aria-pressed={mode === 'denominations'}
            className={`min-h-9 rounded-[8px] text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
              mode === 'denominations'
                ? 'bg-[#000524] text-white shadow-xs'
                : 'text-[#273238] hover:bg-white'
            }`}
          >
            <Banknote className="w-3.5 h-3.5" aria-hidden /> PKR Note Counter
          </button>
        </div>

        {mode === 'direct' ? (
          <div>
            <label htmlFor="blindDirectCash" className="block text-xs font-semibold text-[#273238] mb-1.5">
              Counted Cash in Drawer (Rs)
            </label>
            <input
              id="blindDirectCash"
              type="number"
              min={0}
              step="any"
              autoFocus
              disabled={busy || confirming}
              value={directAmount}
              placeholder="0"
              onChange={(e) => {
                setDirectAmount(e.target.value);
                setError('');
              }}
              className="w-full px-3.5 h-11 text-right font-display font-bold text-lg border border-[#788991] rounded-[10px] bg-white text-[#000000] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
            />
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              {PKR_DENOMINATIONS.map((denom) => {
                const qty = counts[String(denom)] ?? 0;
                return (
                  <div
                    key={denom}
                    className="flex items-center justify-between gap-2 p-2 rounded-[10px] bg-[#f8fafd] border border-[#e0edff]"
                  >
                    <label htmlFor={`denom-${denom}`} className="text-xs font-semibold text-[#273238] tabular-nums shrink-0">
                      Rs {denom.toLocaleString()} ×
                    </label>
                    <input
                      id={`denom-${denom}`}
                      type="number"
                      min={0}
                      step={1}
                      disabled={busy || confirming}
                      value={qty || ''}
                      placeholder="0"
                      onChange={(e) => updateCount(denom, e.target.value)}
                      className="w-20 px-2 h-9 text-right text-sm font-bold border border-[#788991] rounded-[8px] bg-white text-[#000000] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                    />
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-2 p-2 rounded-[10px] bg-[#f8fafd] border border-[#e0edff]">
                <label htmlFor="denom-coins" className="text-xs font-semibold text-[#273238] shrink-0">
                  Coins (Rs)
                </label>
                <input
                  id="denom-coins"
                  type="number"
                  min={0}
                  step="any"
                  disabled={busy || confirming}
                  value={looseCoins}
                  placeholder="0"
                  onChange={(e) => {
                    setLooseCoins(e.target.value);
                    setError('');
                  }}
                  className="w-20 px-2 h-9 text-right text-sm font-bold border border-[#788991] rounded-[8px] bg-white text-[#000000] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </div>
            </div>

            <div className="flex justify-between items-center rounded-[10px] px-3.5 py-2.5 bg-[#eff6ff] border border-[#e0edff] text-sm font-semibold">
              <span className="text-[#273238]">Counted Cash Total</span>
              <span className="font-display text-lg font-bold text-[#2941e0] tabular-nums">
                {formatAmount(denomTotal)}
              </span>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="blindNote" className="block text-xs font-medium text-[#273238] mb-1.5">
            Handover / Drawer Note (optional)
          </label>
          <input
            id="blindNote"
            type="text"
            disabled={busy || confirming}
            value={note}
            placeholder="e.g. Rs 500 paid to rider from drawer"
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 h-10 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-[10px] px-3 py-2 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        )}
      </div>
    </Modal>
  );
}
