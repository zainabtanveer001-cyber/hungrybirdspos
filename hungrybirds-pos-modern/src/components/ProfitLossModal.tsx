import { useState } from 'react';
import { getPnl } from '../lib/analytics';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function ProfitLossModal({ onClose }: { onClose: () => void }) {
  const [start, setStart] = useState(() => iso(new Date()));
  const [end, setEnd] = useState(() => iso(new Date()));
  const report = useLive(() => getPnl(start, end), [start, end]) ?? null;

  function preset(range: 'today' | 'month') {
    const now = new Date();
    setStart(range === 'today' ? iso(now) : iso(new Date(now.getFullYear(), now.getMonth(), 1)));
    setEnd(iso(now));
  }

  const net = report?.net ?? 0;

  return (
    <Modal title="Profit & Loss" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="block">
            <span className="block text-xs font-medium text-[#273238] mb-1">From</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              aria-label="Report start date"
              className="px-3 h-10 text-xs border border-[#788991] rounded-[10px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[#273238] mb-1">To</span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              aria-label="Report end date"
              className="px-3 h-10 text-xs border border-[#788991] rounded-[10px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
            />
          </label>
          <button
            type="button"
            onClick={() => preset('today')}
            className="px-3.5 h-10 text-xs font-semibold rounded-[8px] border border-[#788991] bg-white text-[#273238] hover:bg-[#eff6ff] hover:border-[#2941e0] transition"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => preset('month')}
            className="px-3.5 h-10 text-xs font-semibold rounded-[8px] border border-[#788991] bg-white text-[#273238] hover:bg-[#eff6ff] hover:border-[#2941e0] transition"
          >
            This month
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Sales</p>
            <p className="font-display text-lg font-bold text-emerald-900 tabular-nums mt-0.5">{formatAmount(report?.sales ?? 0)}</p>
            <p className="text-xs text-emerald-800 mt-0.5 tabular-nums">{report?.orderCount ?? 0} orders</p>
          </div>
          <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200">
            <p className="text-[11px] font-bold uppercase tracking-wide text-red-800">Inventory cost (COGS)</p>
            <p className="font-display text-lg font-bold text-red-800 tabular-nums mt-0.5">{formatAmount(report?.cogs ?? 0)}</p>
            <p className="text-xs text-red-700 mt-0.5">Live in shift · locked at close</p>
          </div>
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300">
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">Approved expenses</p>
            <p className="font-display text-lg font-bold text-amber-900 tabular-nums mt-0.5">{formatAmount(report?.expenses ?? 0)}</p>
            <p className="text-xs text-amber-900 mt-0.5">Pending excluded</p>
          </div>
          <div className={`p-3.5 rounded-2xl border ${net < 0 ? 'bg-red-50 border-red-300' : 'bg-[#eff6ff] border-[#e0edff]'}`}>
            <p className={`text-[11px] font-bold uppercase tracking-wide ${net < 0 ? 'text-red-800' : 'text-[#2941e0]'}`}>
              Net {net < 0 ? 'loss' : 'profit'}
            </p>
            <p className={`font-display text-lg font-bold tabular-nums mt-0.5 ${net < 0 ? 'text-red-700' : 'text-[#000000]'}`}>
              {formatAmount(net)}
            </p>
            <p className={`text-xs mt-0.5 ${net < 0 ? 'text-red-700' : 'text-[#526066]'}`}>Sales − COGS − expenses</p>
          </div>
        </div>

        <p className="text-xs text-[#526066] leading-relaxed">
          Ingredient costs for the active shift update live on the go whenever you update inventory unit costs
          or reduce stock, and lock automatically when the shift is closed.
        </p>
      </div>
    </Modal>
  );
}
