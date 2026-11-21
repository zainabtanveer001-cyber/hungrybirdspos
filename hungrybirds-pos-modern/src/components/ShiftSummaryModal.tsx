import { useState } from 'react';
import {
  buildShiftReport,
  closeShift,
  computeDrawerVariance,
  getClosedShiftReports,
} from '../lib/shift';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';
import type { UserRole } from '../lib/db/types';

export function ShiftSummaryModal({
  username,
  role,
  onClose,
  notify,
  onClosed,
}: {
  username: string;
  role?: UserRole;
  onClose: () => void;
  notify: (message: string) => void;
  onClosed: () => void;
}) {
  const report = useLive(() => buildShiftReport(), []) ?? null;
  const closedReports = useLive(() => getClosedShiftReports(), []) ?? [];
  const [fallbackTime] = useState(() => Date.now());
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [countedInput, setCountedInput] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [closing, setClosing] = useState(false);

  async function handleConfirmClose() {
    setClosing(true);
    try {
      const hasCount = countedInput.trim() !== '' && Number.isFinite(Number(countedInput)) && Number(countedInput) >= 0;
      const blindInput =
        hasCount || closeNote.trim()
          ? {
              countedCash: hasCount ? Number(countedInput) : (report?.expectedDrawerCash ?? 0),
              note: closeNote.trim() || undefined,
            }
          : undefined;
      await closeShift(username, blindInput, role);
      notify('Shift closed. Set opening cash for the new shift.');
      onClose();
      onClosed();
    } finally {
      setClosing(false);
    }
  }

  return (
    <Modal
      title="Shift Summary"
      onClose={onClose}
      wide
      closeDisabled={closing}
      footer={
        confirmingClose ? (
          <div className="space-y-2.5">
            <p className="text-xs font-medium text-[#273238]">
              End the current shift? Active-shift ingredient costs will lock permanently and opening cash will reset.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label htmlFor="ownerCloseCounted" className="block text-[11px] font-semibold text-[#273238] mb-1">
                  Counted drawer cash (optional)
                </label>
                <input
                  id="ownerCloseCounted"
                  type="number"
                  min={0}
                  step="any"
                  disabled={closing}
                  value={countedInput}
                  placeholder={`Default: ${Math.round(report?.expectedDrawerCash ?? 0)}`}
                  onChange={(e) => setCountedInput(e.target.value)}
                  className="w-full px-2.5 h-9 text-xs font-semibold border border-[#788991] rounded-[8px] bg-white text-[#000000] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </div>
              <div>
                <label htmlFor="ownerCloseNote" className="block text-[11px] font-semibold text-[#273238] mb-1">
                  Closing note (optional)
                </label>
                <input
                  id="ownerCloseNote"
                  type="text"
                  disabled={closing}
                  value={closeNote}
                  placeholder="Handover note…"
                  onChange={(e) => setCloseNote(e.target.value)}
                  className="w-full px-2.5 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={closing}
                onClick={() => setConfirmingClose(false)}
                className="flex-1 h-10 rounded-[8px] border border-[#788991] bg-white text-[#000000] hover:bg-[#eff6ff] text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={closing}
                onClick={() => void handleConfirmClose()}
                className="flex-[2] h-10 rounded-[8px] bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50 transition"
              >
                {closing ? 'Closing shift…' : 'Confirm Close Shift'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingClose(true)}
            className="w-full h-11 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-[8px] transition"
          >
            Close Shift &amp; Start New
          </button>
        )
      }
    >
      <div className="space-y-3.5">
        <section className="p-3.5 rounded-2xl bg-[#f8fafd] border border-[#e0edff] text-xs text-[#526066] space-y-1">
          <Row label="Opened by" value={username} />
          <Row label="Shift start" value={new Date(report?.startedAt ?? fallbackTime).toLocaleString()} />
          <Row label="Opening cash" value={formatAmount(report?.openingCash ?? 0)} />
          <Row label="Cash from customers" value={formatAmount(report?.cashCollected ?? 0)} />
          <Row label="Change given back" value={`-${formatAmount(report?.changeGiven ?? 0)}`} />
          <Row label="Net cash received" value={formatAmount(report?.netCash ?? 0)} />
          <Row label="Expected drawer cash" value={formatAmount(report?.expectedDrawerCash ?? 0)} strong />
        </section>

        <section className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center">
          <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Total shift revenue (after discounts)</p>
          <p className="font-display text-2xl font-bold text-emerald-800 tabular-nums mt-0.5">{formatAmount(report?.totalSales ?? 0)}</p>
          <p className="text-xs text-emerald-800 mt-0.5">
            {report?.orderCount ?? 0} {report?.orderCount === 1 ? 'order' : 'orders'} completed
          </p>
        </section>

        <section>
          <Caption>Payment modes collected</Caption>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Tile label="Net Cash" value={report?.netCash ?? 0} tone="bg-emerald-50 border-emerald-200 text-emerald-900" />
            <Tile label="Card" value={report?.cardCollected ?? 0} tone="bg-[#eff6ff] border-[#e0edff] text-[#2941e0]" />
            <Tile label="Online" value={report?.onlineCollected ?? 0} tone="bg-amber-50 border-amber-200 text-amber-900" />
          </div>
        </section>

        <section>
          <Caption>Revenue breakdown</Caption>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Tile label="Dine in" value={report?.dineIn ?? 0} tone="bg-[#eff6ff] border-[#e0edff] text-[#2941e0]" />
            <Tile label="Takeaway" value={report?.takeaway ?? 0} tone="bg-amber-50 border-amber-200 text-amber-900" />
            <Tile label="Delivery" value={report?.delivery ?? 0} tone="bg-[#f8fafd] border-[#e0edff] text-[#273238]" />
          </div>
        </section>

        <section className="pt-3 border-t border-[#e0edff] space-y-2">
          <Caption>Sales by food category</Caption>
          {!report?.categorySales.length ? (
            <p className="text-xs text-[#616f75] py-2">No food category sales recorded this shift.</p>
          ) : (
            <ul className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
              {report.categorySales.map((cat) => (
                <li key={cat.categoryId} className="p-2.5 bg-[#f8fafd] border border-[#e0edff] rounded-[10px] text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#000000] truncate">{cat.categoryName}</span>
                    <div className="flex items-center gap-2 shrink-0 tabular-nums">
                      <span className="text-[11px] font-semibold text-[#2941e0]">{cat.sharePercent}%</span>
                      <strong className="text-[#000000]">{formatAmount(cat.netRevenue)}</strong>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#e0edff] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#2941e0]"
                      style={{ width: `${cat.netRevenue > 0 ? Math.max(4, cat.sharePercent) : 0}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#526066] tabular-nums">
                    {cat.unitsSold} {cat.unitsSold === 1 ? 'item' : 'items'} sold · {cat.orderCount} {cat.orderCount === 1 ? 'order' : 'orders'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pt-3 border-t border-[#e0edff] space-y-1 text-xs text-[#526066]">
          <Caption>Checkout charges collected</Caption>
          <Row label="Packing charges" value={formatAmount(report?.packingCharges ?? 0)} />
          <Row label="Tax" value={formatAmount(report?.tax ?? 0)} />
          <Row label="Other charges" value={formatAmount(report?.otherCharges ?? 0)} />
        </section>

        <section className="pt-3 border-t border-[#e0edff] space-y-2">
          <Caption>Inventory consumed this shift</Caption>
          {!report?.ingredients.length ? (
            <p className="text-xs text-[#616f75] py-2">No ingredient consumption recorded this shift.</p>
          ) : (
            <ul className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
              {report.ingredients.map((row) => (
                <li key={row.name} className="p-2.5 bg-white border border-[#e0edff] rounded-[10px] flex justify-between items-center text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#000000] truncate">{row.name}</p>
                    <p className="text-xs text-[#526066] tabular-nums">
                      {row.qtyConsumed.toFixed(2)} {row.unit}
                      {row.manualQty > 0
                        ? ` (recipe ${row.recipeQty.toFixed(2)}, manual ${row.manualQty.toFixed(2)})`
                        : ''}{' '}
                      · {formatAmount(row.costPerUnit)}/unit
                    </p>
                  </div>
                  <span className={`font-bold shrink-0 tabular-nums ${row.costConsumed > 0 ? 'text-red-700' : 'text-emerald-800'}`}>
                    {formatAmount(row.costConsumed)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pt-3 border-t border-[#e0edff] space-y-1.5 text-xs text-[#526066]">
          <Row label="Discounted orders" value={String(report?.discountedOrderCount ?? 0)} />
          <div className="bg-[#f8fafd] p-3 rounded-[10px] border border-[#e0edff] space-y-1">
            <p className="font-semibold text-[#273238]">Discounts by staff</p>
            {!report?.discountsByStaff.length ? (
              <p className="text-[#616f75]">No discounts were applied during this shift.</p>
            ) : (
              report.discountsByStaff.map((row) => (
                <div key={row.user} className="flex justify-between">
                  <span className="text-[#273238]">{row.user}</span>
                  <strong className="text-red-700 tabular-nums">{formatAmount(row.amount)}</strong>
                </div>
              ))
            )}
          </div>
          <Row label="Total discounts given" value={`- ${formatAmount(report?.totalDiscounts ?? 0)}`} valueClass="text-red-700" />
          <Row label="Raw material cost consumed (live)" value={formatAmount(report?.consumedCost ?? 0)} valueClass="text-red-700" />
          <div className={`flex justify-between text-xs font-bold pt-1 ${(report?.grossProfit ?? 0) >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
            <span>Gross profit / (loss)</span>
            <strong className="tabular-nums">{formatAmount(report?.grossProfit ?? 0)}</strong>
          </div>
          <Row label="Approved shift expenses" value={`- ${formatAmount(report?.shiftExpenses ?? 0)}`} valueClass="text-amber-900" />
          <div className={`flex justify-between text-sm font-bold pt-2 border-t border-[#e0edff] ${(report?.netProfit ?? 0) >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
            <span>Net shift profit / (loss)</span>
            <strong className="tabular-nums">{formatAmount(report?.netProfit ?? 0)}</strong>
          </div>
        </section>

        <section className="pt-3 border-t border-[#e0edff] space-y-2">
          <Caption>Blind Cash Drops &amp; Closed Shift History</Caption>
          {closedReports.length === 0 ? (
            <p className="text-xs text-[#616f75] py-2">No closed shift drawer counts recorded yet.</p>
          ) : (
            <ul className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
              {closedReports.slice(0, 12).map((entry) => {
                const { status, variance } = computeDrawerVariance(entry.expectedDrawerCash, entry.countedCash);
                const badgeClass =
                  status === 'EXACT'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : status === 'OVER'
                      ? 'bg-[#eff6ff] text-[#2941e0] border-[#e0edff]'
                      : 'bg-red-50 text-red-700 border-red-200';
                const badgeLabel =
                  status === 'EXACT'
                    ? 'Exact match'
                    : status === 'OVER'
                      ? `+${formatAmount(variance)} Over`
                      : `-${formatAmount(Math.abs(variance))} Short`;
                return (
                  <li key={entry.id} className="p-3 bg-[#f8fafd] border border-[#e0edff] rounded-[12px] text-xs space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-[#000000]">{entry.closedBy}</span>
                        {entry.role && <span className="text-[#526066]"> ({entry.role})</span>}
                        <span className="text-[#526066]"> · {new Date(entry.closedAt).toLocaleString()}</span>
                      </div>
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-[88px] border tabular-nums ${badgeClass}`}>
                        {badgeLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-[#526066] tabular-nums">
                      <div>Expected: <strong className="text-[#000000]">{formatAmount(entry.expectedDrawerCash)}</strong></div>
                      <div>Counted: <strong className="text-[#000000]">{formatAmount(entry.countedCash)}</strong></div>
                      <div>Sales ({entry.orderCount}): <strong className="text-[#000000]">{formatAmount(entry.totalSales)}</strong></div>
                    </div>
                    {entry.denominations && Object.keys(entry.denominations).length > 0 && (
                      <p className="text-[11px] text-[#526066] tabular-nums">
                        Notes: {Object.entries(entry.denominations)
                          .map(([d, q]) => `Rs ${d}×${q}`)
                          .join(', ')}
                        {entry.looseCoins ? ` + Rs ${entry.looseCoins} coins` : ''}
                      </p>
                    )}
                    {entry.note && (
                      <p className="text-[11px] text-[#273238] italic">Note: {entry.note}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-wide text-[#273238] mb-1.5">{children}</p>;
}

function Row({ label, value, strong, valueClass }: {
  label: string;
  value: string;
  strong?: boolean;
  valueClass?: string;
}) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? 'font-bold text-[#000000] pt-1 border-t border-[#e0edff]' : ''}`}>
      <span>{label}:</span>
      <strong className={`tabular-nums ${valueClass ?? 'text-[#000000]'}`}>{value}</strong>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`border rounded-[10px] p-2.5 ${tone}`}>
      <span className="block text-xs text-[#526066]">{label}</span>
      <strong className="tabular-nums text-sm font-bold">{formatAmount(value)}</strong>
    </div>
  );
}
