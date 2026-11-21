import { useMemo, useState } from 'react';
import { Download, Pencil, Printer, RotateCcw, Search, Share2, Trash2 } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { logAudit } from '../lib/audit';
import { restoreInventory } from '../lib/sales';
import { deleteSale } from '../lib/sync';
import { formatAmount } from '../lib/format';
import { refundableTotal } from '../lib/refunds';
import { printReceipt, shareReceipt } from '../lib/receipt';
import { downloadCsv, datedFilename } from '../lib/export';
import { Modal } from './Modal';
import { OwnerPinModal } from './OwnerPinModal';
import { RefundModal } from './RefundModal';
import type { Sale, UserRole } from '../lib/db/types';

const VISIBLE = 20;

export function SalesHistoryModal({ role, username, onClose, onReopen, notify, hasCartItems = false }: {
  role: UserRole;
  username: string;
  onClose: () => void;
  onReopen: (sale: Sale) => void;
  notify: (message: string) => void;
  hasCartItems?: boolean;
}) {
  const sales = useLive(() => db.sales.toArray(), []) ?? [];
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<number | null>(null);
  const [confirmReopen, setConfirmReopen] = useState<number | null>(null);
  const [returnStock, setReturnStock] = useState(true);
  const [pinFor, setPinFor] = useState<(() => void) | null>(null);
  const [refundFor, setRefundFor] = useState<Sale | null>(null);

  const canVoid = role === 'OWNER' || role === 'MANAGER';
  const canRefund = canVoid;

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase().replace(/^order\s*#?|^#/, '');
    return sales
      .filter((s) => {
        if (!query) return true;
        return [String(s.id), s.customer?.name, s.customer?.phone, s.deliveryInfo?.phone, (s.items || []).map((i) => i.name).join(' ')]
          .some((value) => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, VISIBLE);
  }, [sales, search]);

  const [pendingAction, setPendingAction] = useState('This action needs owner authorization.');

  function withOwnerPin(action: () => void, prompt = 'This action needs owner authorization.') {
    if (role === 'OWNER') action();
    else {
      setPendingAction(prompt);
      setPinFor(() => action);
    }
  }

  async function voidSales(ids: number[]) {
    const voided: Sale[] = [];
    await db.transaction('rw', db.sales, db.inventory, db.recipes, db.deliveries, async () => {
      for (const id of ids) {
        const sale = await db.sales.get(id);
        if (!sale) continue;
        if (returnStock) await restoreInventory(sale.items);
        await db.sales.delete(id);
        await db.deliveries.where('saleId').equals(id).delete();
        voided.push(sale);
      }
    });
    // Outside the transaction: Dexie forbids writing a table the rw scope doesn't include.
    for (const sale of voided) {
      if (sale.cloudId) deleteSale(sale.cloudId);
      await logAudit('SALE_DELETE', `Order #${sale.id} deleted (${formatAmount(sale.total)})`, username, sale.id);
    }
    setSelected(new Set());
    setConfirming(null);
    notify(`${ids.length} order${ids.length === 1 ? '' : 's'} deleted.`);
  }

  function requestVoid(ids: number[]) {
    withOwnerPin(() => void voidSales(ids));
  }

  async function print(sale: Sale) {
    try {
      const how = await printReceipt(sale);
      if (how === 'browser') notify('Printer unavailable — printing from the browser instead.');
    } catch (err) {
      notify((err as Error).message);
    }
  }

  async function share(sale: Sale) {
    await shareReceipt(sale);
    await logAudit('RECEIPT_SHARED', `Receipt for Order #${sale.id} shared`, username, sale.id);
  }

  function exportCsv() {
    const rows = [...sales]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((sale) => [
        sale.id ?? '',
        new Date(sale.timestamp).toLocaleString(),
        sale.serverUser || '',
        sale.orderType,
        (sale.items || []).map((i) => `${i.name} x${i.qty}`).join('; '),
        sale.subtotal.toFixed(2),
        sale.discountPercent || 0,
        sale.discountAmount.toFixed(2),
        sale.deliveryCharge.toFixed(2),
        sale.packingCharge.toFixed(2),
        sale.taxPercent || 0,
        sale.taxAmount.toFixed(2),
        sale.otherCharge.toFixed(2),
        sale.total.toFixed(2),
        (sale.refundedAmount || 0).toFixed(2),
        sale.refundStatus || '',
        (sale.payments || []).map((p) => `${p.method}: ${p.amount.toFixed(2)}`).join('; '),
      ]);
    downloadCsv(
      datedFilename('Sales_Export'),
      ['Order ID', 'Date', 'Server', 'Order Type', 'Items', 'Subtotal', 'Discount %', 'Discount Amount',
        'Delivery Charge', 'Packing Charge', 'Tax %', 'Tax Amount', 'Other Charges', 'Total',
        'Refunded Amount', 'Refund Status', 'Payment Methods'],
      rows,
    );
    notify(`${rows.length} orders exported.`);
  }

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <Modal title="Sales History" onClose={onClose} wide>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#526066]" aria-hidden />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order #, customer or item..."
                aria-label="Search sales"
                className="w-full pl-10 pr-4 h-10 text-sm border border-[#788991] rounded-[10px] bg-white text-[#000000] placeholder:text-[#616f75] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
              />
            </div>
            <button
              type="button"
              onClick={exportCsv}
              className="shrink-0 px-3.5 h-10 text-xs font-semibold rounded-[8px] bg-white text-[#273238] border border-[#788991] hover:bg-[#eff6ff] hover:border-[#2941e0] flex items-center gap-1.5 transition"
              title="Download all orders as a spreadsheet"
            >
              <Download className="w-3.5 h-3.5" aria-hidden /> CSV
            </button>
          </div>

          {canVoid && visible.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-2 font-semibold text-[#273238]">
                <input
                  type="checkbox"
                  checked={selected.size === visible.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((s) => s.id!)) : new Set())}
                  className="rounded accent-[#2941e0] w-4 h-4"
                />
                Select all
              </label>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => requestVoid([...selected])}
                  className="ml-auto bg-red-600 text-white font-semibold px-3 min-h-9 rounded-[8px] hover:bg-red-700 flex items-center gap-1.5 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden /> Void {selected.size}
                </button>
              )}
            </div>
          )}

          {visible.length === 0 ? (
            <p className="text-[#616f75] text-sm text-center py-8">No matching sales.</p>
          ) : (
            <div className="space-y-2.5 max-h-[55vh] overflow-y-auto custom-scrollbar pr-1">
              {visible.map((sale) => (
                <article key={sale.id} className="p-3.5 bg-[#f8fafd] border border-[#e0edff] rounded-2xl space-y-2.5">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      {canVoid && (
                        <input
                          type="checkbox"
                          checked={selected.has(sale.id!)}
                          onChange={() => toggle(sale.id!)}
                          aria-label={`Select order ${sale.id}`}
                          className="mt-1 rounded accent-[#2941e0] w-4 h-4"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-[#000000] flex flex-wrap items-center gap-1.5">
                          <span className="tabular-nums">Order #{sale.id}</span>
                          <span className="text-[11px] text-[#2941e0] font-semibold bg-[#eff6ff] px-2 py-0.5 rounded-[88px]">
                            {sale.orderType.replace('_', ' ')}
                          </span>
                          {!!sale.discountPercent && (
                            <span className="text-[11px] text-red-700 font-semibold tabular-nums">-{sale.discountPercent}%</span>
                          )}
                          {sale.refundStatus && (
                            <span className="text-[11px] text-amber-900 font-semibold bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-[88px] tabular-nums">
                              {sale.refundStatus === 'FULL'
                                ? `Refunded ${formatAmount(sale.refundedAmount ?? 0)}`
                                : `Part refunded (${formatAmount(sale.refundedAmount ?? 0)})`}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-[#526066] mt-0.5">
                          By: {sale.serverUser || 'Staff'} · {new Date(sale.timestamp).toLocaleString()}
                        </p>
                        <p className="text-xs text-[#526066] truncate mt-0.5">
                          {sale.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}
                        </p>
                      </div>
                    </div>
                    <p className="font-display font-bold text-emerald-800 text-sm shrink-0 tabular-nums">{formatAmount(sale.total)}</p>
                  </div>

                  {confirming === sale.id ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#e0edff]">
                      <label className="flex items-center gap-2 text-xs font-medium text-[#273238] mr-auto">
                        <input
                          type="checkbox"
                          checked={returnStock}
                          onChange={(e) => setReturnStock(e.target.checked)}
                          className="rounded accent-emerald-700 w-4 h-4"
                        />
                        Return ingredients to stock
                      </label>
                      <button
                        type="button"
                        onClick={() => requestVoid([sale.id!])}
                        className="text-xs bg-red-600 hover:bg-red-700 text-white font-semibold px-3 min-h-9 rounded-[8px] transition"
                      >
                        Confirm void
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="text-xs bg-white border border-[#788991] text-[#273238] hover:bg-[#eff6ff] font-semibold px-3 min-h-9 rounded-[8px] transition"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : confirmReopen === sale.id ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#e0edff]">
                      <span className="text-xs font-semibold text-[#273238] mr-auto">
                        Your cart is not empty. Overwrite it with Order #{sale.id}?
                      </span>
                      <button
                        type="button"
                        onClick={() => setConfirmReopen(null)}
                        className="text-xs bg-white border border-[#788991] text-[#273238] hover:bg-[#eff6ff] font-semibold px-3 min-h-9 rounded-[8px] transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmReopen(null);
                          withOwnerPin(() => onReopen(sale));
                        }}
                        className="text-xs bg-amber-700 hover:bg-amber-800 text-white font-semibold px-3 min-h-9 rounded-[8px] transition"
                      >
                        Overwrite &amp; Edit
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-[#e0edff]">
                      <button
                        type="button"
                        onClick={() => print(sale)}
                        className="text-xs bg-white border border-[#788991] text-[#273238] hover:bg-[#eff6ff] font-semibold px-2.5 min-h-9 rounded-[8px] flex items-center gap-1 mr-auto transition"
                        title="Print this receipt"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden /> Print
                      </button>
                      <button
                        type="button"
                        onClick={() => share(sale)}
                        className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 font-semibold px-2.5 min-h-9 rounded-[8px] flex items-center gap-1 transition"
                        title="Send the receipt on WhatsApp"
                      >
                        <Share2 className="w-3.5 h-3.5" aria-hidden /> Share
                      </button>
                      {canVoid && (
                        <button
                          type="button"
                          onClick={() => {
                            if (hasCartItems) setConfirmReopen(sale.id!);
                            else withOwnerPin(() => onReopen(sale));
                          }}
                          className="text-xs bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100 font-semibold px-2.5 min-h-9 rounded-[8px] flex items-center gap-1 transition"
                          title="Re-open into the cart for editing"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden /> Edit
                        </button>
                      )}
                      {canRefund && refundableTotal(sale) > 0 && (
                        <button
                          type="button"
                          onClick={() => withOwnerPin(() => setRefundFor(sale), 'Refunding a completed sale needs owner authorization.')}
                          className="text-xs bg-[#eff6ff] border border-[#e0edff] text-[#2941e0] hover:bg-[#e0edff] font-semibold px-2.5 min-h-9 rounded-[8px] flex items-center gap-1 transition"
                          title="Refund items from this order"
                        >
                          <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Refund
                        </button>
                      )}
                      {canVoid && (
                        <button
                          type="button"
                          onClick={() => setConfirming(sale.id!)}
                          className="text-xs bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 font-semibold px-2.5 min-h-9 rounded-[8px] flex items-center gap-1 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden /> Void
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {pinFor && (
        <OwnerPinModal
          action={pendingAction}
          onClose={() => setPinFor(null)}
          onAuthorized={() => {
            const action = pinFor;
            setPinFor(null);
            action();
          }}
        />
      )}

      {refundFor && (
        <RefundModal
          sale={refundFor}
          username={username}
          notify={notify}
          onClose={() => setRefundFor(null)}
          onDone={() => { setRefundFor(null); }}
        />
      )}
    </>
  );
}
