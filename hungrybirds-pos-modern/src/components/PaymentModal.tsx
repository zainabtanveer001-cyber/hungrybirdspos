import { useMemo, useState } from 'react';
import { formatAmount } from '../lib/format';
import {
  computeCashBalance,
  computeQuickTenderAmounts,
  computeSplitTenderSummary,
  fillRemainingForMethod,
} from '../lib/payment';
import type { SplitPaymentDraft } from '../lib/payment';
import { Modal } from './Modal';
import type { PaymentDetail, PaymentMethod } from '../lib/db/types';

const METHODS: PaymentMethod[] = ['Cash', 'Card', 'Online'];

export function PaymentModal({
  total,
  onCancel,
  onConfirm,
}: {
  total: number;
  onCancel: () => void;
  onConfirm: (payments: PaymentDetail[]) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [cashGiven, setCashGiven] = useState<number>(total);
  const [splitDraft, setSplitDraft] = useState<SplitPaymentDraft>({
    Cash: 0,
    Card: 0,
    Online: 0,
    cashGiven: 0,
  });
  const [busy, setBusy] = useState(false);

  const quickAmounts = useMemo(() => computeQuickTenderAmounts(total), [total]);
  const balance = computeCashBalance(total, cashGiven);
  const splitSummary = useMemo(() => computeSplitTenderSummary(total, splitDraft), [total, splitDraft]);
  const splitCashQuick = useMemo(
    () => computeQuickTenderAmounts(splitSummary.cash),
    [splitSummary.cash],
  );

  const canSubmit =
    mode === 'single'
      ? !(method === 'Cash' && balance.short)
      : splitSummary.valid;

  function switchMode(nextMode: 'single' | 'split') {
    if (nextMode === mode) return;
    if (nextMode === 'split') {
      // Seed the split with whatever single method was selected so the cashier only edits one leg.
      setSplitDraft({
        Cash: method === 'Cash' ? Math.min(total, Math.max(0, total)) : 0,
        Card: method === 'Card' ? total : 0,
        Online: method === 'Online' ? total : 0,
        cashGiven: method === 'Cash' ? Math.max(total, cashGiven) : 0,
      });
    }
    setMode(nextMode);
  }

  function updateSplitLeg(target: PaymentMethod, rawValue: number) {
    const clean = Math.max(0, Number(rawValue) || 0);
    setSplitDraft((prev) => {
      if (target === 'Cash') {
        const nextCashGiven = prev.cashGiven < clean || prev.cashGiven === prev.Cash ? clean : prev.cashGiven;
        return { ...prev, Cash: clean, cashGiven: nextCashGiven };
      }
      return { ...prev, [target]: clean };
    });
  }

  async function handleSubmit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      if (mode === 'single') {
        await onConfirm([
          method === 'Cash'
            ? { method, amount: total, cashGiven, change: balance.change }
            : { method, amount: total },
        ]);
      } else {
        await onConfirm(splitSummary.payments);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Take Payment"
      onClose={onCancel}
      closeDisabled={busy}
      footer={
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 h-11 rounded-[8px] font-medium border border-[#788991] bg-white text-[#000000] hover:bg-[#eff6ff] disabled:opacity-45 transition text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={() => void handleSubmit()}
            className="flex-[2] h-11 rounded-[8px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition disabled:opacity-45 disabled:cursor-not-allowed text-sm"
          >
            {busy ? 'Completing…' : 'Complete Sale'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 bg-[#eff6ff] border border-[#e0edff] rounded-2xl px-4 py-3.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#526066]">Total Due</span>
          <span className="font-display text-2xl font-bold text-[#2941e0] tabular-nums">
            {formatAmount(total)}
          </span>
        </div>

        <div
          role="group"
          aria-label="Checkout payment mode"
          className="grid grid-cols-2 gap-1.5 bg-[#f8fafd] p-1 rounded-[10px] border border-[#e0edff]"
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => switchMode('single')}
            aria-pressed={mode === 'single'}
            className={`min-h-9 rounded-[8px] text-xs font-semibold transition ${
              mode === 'single'
                ? 'bg-[#000524] text-white shadow-xs'
                : 'text-[#273238] hover:bg-white'
            }`}
          >
            Single Payment
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => switchMode('split')}
            aria-pressed={mode === 'split'}
            className={`min-h-9 rounded-[8px] text-xs font-semibold transition ${
              mode === 'split'
                ? 'bg-[#000524] text-white shadow-xs'
                : 'text-[#273238] hover:bg-white'
            }`}
          >
            Split Payment
          </button>
        </div>

        {mode === 'single' ? (
          <>
            <div
              role="group"
              aria-label="Payment method"
              className="grid grid-cols-3 gap-1.5 bg-[#eff6ff] p-1 rounded-[10px] border border-[#e0edff]"
            >
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => setMethod(m)}
                  aria-pressed={method === m}
                  className={`min-h-10 rounded-[8px] text-sm font-semibold transition ${
                    method === m
                      ? 'bg-[#2941e0] text-white shadow-xs'
                      : 'text-[#273238] hover:bg-white hover:text-[#2941e0]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {method === 'Cash' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="cashGiven" className="block text-xs font-medium text-[#273238] mb-1.5">
                    Cash Received (Rs)
                  </label>
                  <input
                    id="cashGiven"
                    type="number"
                    min={0}
                    step="any"
                    autoFocus
                    disabled={busy}
                    value={cashGiven}
                    onChange={(e) => setCashGiven(Math.max(0, Number(e.target.value) || 0))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canSubmit && !busy) void handleSubmit();
                    }}
                    className="w-full px-3.5 h-11 text-right font-display font-bold text-lg border border-[#788991] rounded-[10px] bg-white text-[#000000] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
                  />
                </div>

                <div role="group" aria-label="Quick cash amounts" className="flex flex-wrap gap-1.5">
                  {quickAmounts.map((amount, index) => {
                    const active = cashGiven === amount;
                    return (
                      <button
                        key={amount}
                        type="button"
                        disabled={busy}
                        onClick={() => setCashGiven(amount)}
                        aria-pressed={active}
                        className={`px-3 min-h-9 rounded-[8px] text-xs font-semibold border tabular-nums transition ${
                          active
                            ? 'bg-[#2941e0] text-white border-[#2941e0]'
                            : 'bg-white text-[#273238] border-[#788991] hover:bg-[#eff6ff] hover:border-[#2941e0]'
                        }`}
                      >
                        {index === 0 ? 'Exact' : formatAmount(amount)}
                      </button>
                    );
                  })}
                </div>

                <div
                  className={`flex justify-between items-center rounded-[10px] px-3.5 py-2.5 text-sm font-semibold border ${
                    balance.short
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : balance.change > 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-[#f8fafd] border-[#e0edff] text-[#526066]'
                  }`}
                >
                  <span>{balance.short ? 'Still owed' : 'Change'}</span>
                  <span className="font-display text-base font-bold tabular-nums">
                    {formatAmount(balance.short ? balance.remaining : balance.change)}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              {METHODS.map((m) => (
                <div key={m} className="p-2.5 rounded-[12px] bg-[#f8fafd] border border-[#e0edff]">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label htmlFor={`split-${m}`} className="text-xs font-semibold text-[#273238]">
                      {m} portion (Rs)
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setSplitDraft((prev) => fillRemainingForMethod(total, prev, m))}
                      className="text-[11px] font-semibold px-2.5 min-h-7 rounded-[6px] bg-[#eff6ff] text-[#2941e0] hover:bg-[#e0edff] transition"
                    >
                      Fill rest
                    </button>
                  </div>
                  <input
                    id={`split-${m}`}
                    type="number"
                    min={0}
                    step="any"
                    disabled={busy}
                    value={splitDraft[m] || ''}
                    placeholder="0"
                    onChange={(e) => updateSplitLeg(m, Number(e.target.value))}
                    className="w-full px-3 h-10 text-right font-display font-bold text-base border border-[#788991] rounded-[8px] bg-white text-[#000000] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
                  />
                </div>
              ))}
            </div>

            {splitSummary.cash > 0 && (
              <div className="p-3 rounded-[12px] bg-[#eff6ff]/70 border border-[#e0edff] space-y-2">
                <label htmlFor="splitCashGiven" className="block text-xs font-semibold text-[#273238]">
                  Cash Received from Customer (for {formatAmount(splitSummary.cash)} Cash leg)
                </label>
                <input
                  id="splitCashGiven"
                  type="number"
                  min={0}
                  step="any"
                  disabled={busy}
                  value={splitDraft.cashGiven || ''}
                  placeholder="0"
                  onChange={(e) =>
                    setSplitDraft((prev) => ({
                      ...prev,
                      cashGiven: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-full px-3 h-10 text-right font-display font-bold text-base border border-[#788991] rounded-[8px] bg-white text-[#000000] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
                />
                <div role="group" aria-label="Quick cash amounts for split" className="flex flex-wrap gap-1.5">
                  {splitCashQuick.map((amount, index) => {
                    const active = splitDraft.cashGiven === amount;
                    return (
                      <button
                        key={amount}
                        type="button"
                        disabled={busy}
                        onClick={() => setSplitDraft((prev) => ({ ...prev, cashGiven: amount }))}
                        aria-pressed={active}
                        className={`px-2.5 min-h-8 rounded-[6px] text-xs font-semibold border tabular-nums transition ${
                          active
                            ? 'bg-[#2941e0] text-white border-[#2941e0]'
                            : 'bg-white text-[#273238] border-[#788991] hover:bg-[#eff6ff] hover:border-[#2941e0]'
                        }`}
                      >
                        {index === 0 ? 'Exact Cash' : formatAmount(amount)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              role="status"
              aria-live="polite"
              className={`flex justify-between items-center rounded-[10px] px-3.5 py-2.5 text-sm font-semibold border ${
                !splitSummary.valid
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : splitSummary.change > 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              <span>
                {splitSummary.remainingToAllocate > 0
                  ? 'Still to allocate'
                  : splitSummary.overAllocated > 0
                    ? 'Over-allocated by'
                    : splitSummary.cashShort > 0
                      ? 'Cash received is short by'
                      : splitSummary.change > 0
                        ? 'Split complete · Cash change'
                        : 'Split complete · Allocated'}
              </span>
              <span className="font-display text-base font-bold tabular-nums">
                {splitSummary.remainingToAllocate > 0
                  ? formatAmount(splitSummary.remainingToAllocate)
                  : splitSummary.overAllocated > 0
                    ? formatAmount(splitSummary.overAllocated)
                    : splitSummary.cashShort > 0
                      ? formatAmount(splitSummary.cashShort)
                      : splitSummary.change > 0
                        ? formatAmount(splitSummary.change)
                        : formatAmount(splitSummary.allocated)}
              </span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
