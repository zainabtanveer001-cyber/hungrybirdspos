import { useMemo, useState } from 'react';
import { formatAmount } from '../lib/format';
import { computeCashBalance, computeQuickTenderAmounts } from '../lib/payment';
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
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [cashGiven, setCashGiven] = useState<number>(total);
  const [busy, setBusy] = useState(false);

  const quickAmounts = useMemo(() => computeQuickTenderAmounts(total), [total]);
  const balance = computeCashBalance(total, cashGiven);
  const short = method === 'Cash' && balance.short;

  async function handleSubmit() {
    if (short || busy) return;
    setBusy(true);
    try {
      await onConfirm([
        method === 'Cash'
          ? { method, amount: total, cashGiven, change: balance.change }
          : { method, amount: total },
      ]);
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
            disabled={short || busy}
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
                  if (e.key === 'Enter' && !short && !busy) void handleSubmit();
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
                short
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : balance.change > 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-[#f8fafd] border-[#e0edff] text-[#526066]'
              }`}
            >
              <span>{short ? 'Still owed' : 'Change'}</span>
              <span className="font-display text-base font-bold tabular-nums">
                {formatAmount(short ? balance.remaining : balance.change)}
              </span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
