import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { formatAmount } from '../lib/format';
import { computeRefund, recordRefund, remainingQty } from '../lib/refunds';
import type { RefundLine } from '../lib/refunds';
import { Modal } from './Modal';
import type { Sale } from '../lib/db/types';

export function RefundModal({ sale, username, notify, onClose, onDone }: {
  sale: Sale;
  username: string;
  notify: (message: string) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const lines: RefundLine[] = useMemo(
    () => Object.entries(qty).map(([index, value]) => ({ index: Number(index), qty: Number(value) || 0 })),
    [qty],
  );
  const preview = useMemo(() => computeRefund(sale, lines), [sale, lines]);

  async function submit() {
    setBusy(true);
    try {
      const result = await recordRefund(sale.id!, lines, reason, username);
      notify(
        `${result.status === 'FULL' ? 'Full' : 'Partial'} refund of ${formatAmount(result.amount)} on order #${sale.id}.`,
      );
      onClose();
      onDone();
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Refund Order #${sale.id}`}
      onClose={onClose}
      wide
      closeDisabled={busy}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[#526066]">
            Refund total:{' '}
            <strong className={`tabular-nums ${preview.amount > 0 ? 'text-red-700' : 'text-[#616f75]'}`}>
              {formatAmount(preview.amount)}
            </strong>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 h-10 rounded-[8px] text-xs font-semibold border border-[#788991] bg-white text-[#000000] hover:bg-[#eff6ff] disabled:opacity-45 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || preview.amount <= 0 || !reason.trim()}
              className="flex items-center gap-1.5 px-4 h-10 rounded-[8px] text-xs font-semibold bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-45 transition tabular-nums"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden /> {busy ? 'Refunding…' : `Refund ${formatAmount(preview.amount)}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3.5">
        <p className="text-xs text-[#526066]">
          Original total <strong className="text-[#000000] tabular-nums">{formatAmount(sale.total)}</strong>
          {!!sale.refundedAmount && ` · already refunded ${formatAmount(sale.refundedAmount)}`}
          {sale.refundStatus && ` (${sale.refundStatus})`}. Refunded quantities return to stock automatically.
        </p>

        <ul className="space-y-2">
          {(sale.items || []).map((line, index) => {
            const left = remainingQty(line);
            return (
              <li
                key={`${line.id}-${index}`}
                className={`flex items-center gap-2.5 p-2.5 rounded-[10px] border ${left === 0 ? 'bg-[#f8fafd] border-[#e0edff]' : 'bg-white border-[#e0edff]'}`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${left === 0 ? 'text-[#616f75] line-through' : 'text-[#000000]'}`}>
                    {line.name}
                  </p>
                  <p className="text-xs text-[#526066] tabular-nums">
                    {formatAmount(preview.units[index])} each
                    {preview.units[index] !== line.price && ' after discount'} ·{' '}
                    {left === 0 ? 'fully refunded' : `${left} of ${line.qty} refundable`}
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={left}
                  value={qty[index] ?? ''}
                  onChange={(e) => setQty((current) => ({ ...current, [index]: e.target.value }))}
                  disabled={left === 0 || busy}
                  placeholder="0"
                  aria-label={`Refund quantity for ${line.name}`}
                  className="w-20 px-2.5 h-10 text-sm text-right border border-[#788991] rounded-[10px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] disabled:opacity-45 tabular-nums"
                />
              </li>
            );
          })}
        </ul>

        <label className="block">
          <span className="block text-xs font-medium text-[#273238] mb-1">
            Reason (required)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            disabled={busy}
            placeholder="e.g. Wrong item delivered"
            className="w-full p-2.5 text-sm border border-[#788991] rounded-[10px] bg-white text-[#000000] placeholder:text-[#616f75] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] resize-none"
          />
        </label>

        {preview.fullyRefunded && preview.amount > 0 && (
          <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-[10px] px-3 py-2">
            This will fully refund the remaining balance of the order.
          </p>
        )}
      </div>
    </Modal>
  );
}
