import { useEffect, useState } from 'react';
import { CheckCircle2, ChefHat, Clock, Flame, Printer } from 'lucide-react';
import { db } from '../lib/db';
import { formatWeightShort } from '../lib/cart';
import { useLive } from '../lib/useLive';
import { EscPosEncoder } from '../lib/escpos';
import { printRaw } from '../lib/printer';
import { Modal } from './Modal';
import type { CartItem, HeldOrder, KitchenStatus, Sale } from '../lib/db/types';

interface KitchenTicket {
  key: string;
  source: 'held' | 'sale';
  id: number;
  orderType: string;
  tableNumber?: string;
  serverUser: string;
  timestamp: string;
  status: KitchenStatus;
  items: CartItem[];
}

export function KitchenDisplayModal({ onClose, notify }: {
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [filter, setFilter] = useState<'ACTIVE' | 'SERVED'>('ACTIVE');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const heldOrders = useLive(() => db.heldOrders.toArray(), []) ?? [];
  const recentSales = useLive(() => {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    return db.sales.where('timestamp').above(cutoff).reverse().toArray();
  }, []) ?? [];

  const tickets: KitchenTicket[] = [
    ...heldOrders
      .filter((h): h is HeldOrder & { id: number } => h.id != null)
      .map((h) => ({
        key: `held-${h.id}`,
        source: 'held' as const,
        id: h.id,
        orderType: h.orderType,
        tableNumber: h.tableNumber,
        serverUser: h.serverUser || 'Staff',
        timestamp: h.timestamp,
        status: h.kitchenStatus || 'PREPARING',
        items: h.items || [],
      })),
    ...recentSales
      .filter((s): s is Sale & { id: number } => s.id != null && !s.refundStatus)
      .map((s) => ({
        key: `sale-${s.id}`,
        source: 'sale' as const,
        id: s.id,
        orderType: s.orderType,
        tableNumber: s.tableNumber,
        serverUser: s.serverUser || 'Staff',
        timestamp: s.timestamp,
        status: s.kitchenStatus || 'PREPARING',
        items: s.items || [],
      })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const activeCount = tickets.filter((t) => t.status !== 'SERVED').length;
  const servedCount = tickets.filter((t) => t.status === 'SERVED').length;
  const visible = tickets.filter((t) =>
    filter === 'ACTIVE' ? t.status !== 'SERVED' : t.status === 'SERVED',
  );

  async function updateStatus(ticket: KitchenTicket, status: KitchenStatus) {
    if (ticket.source === 'held') {
      await db.heldOrders.update(ticket.id, { kitchenStatus: status });
    } else {
      await db.sales.update(ticket.id, { kitchenStatus: status });
    }
    notify(`Order #${ticket.id} marked ${status.toLowerCase()}.`);
  }

  async function printKot(ticket: KitchenTicket) {
    try {
      const encoder = new EscPosEncoder();
      encoder.initialize();
      encoder.align('center');
      encoder.bold(true);
      encoder.setSize(1, 1);
      encoder.text('KITCHEN ORDER');
      encoder.setSize(0, 0);
      encoder.bold(false);
      encoder.text(`Order: #${ticket.id} (${ticket.source === 'held' ? 'HELD' : 'PAID'})`);
      encoder.text(
        `Type: ${ticket.orderType}${ticket.tableNumber ? ` · Table ${ticket.tableNumber}` : ''}`,
      );
      encoder.text(`By: ${ticket.serverUser} · ${new Date(ticket.timestamp).toLocaleTimeString()}`);
      encoder.text('--------------------------------');
      encoder.align('left');
      for (const item of ticket.items) {
        const mods = (item.modifiers || []).map((m) => m.name).join(', ');
        const name = mods && !item.name.includes(`(${mods})`) ? `${item.name} (${mods})` : item.name;
        const lead = item.weightKg ? formatWeightShort(item.weightKg) : `${item.qty}x`;
        encoder.text(`${lead} ${name}${item.note ? ` - ${item.note}` : ''}`);
      }
      encoder.text('--------------------------------');
      encoder.feed(4);
      encoder.cut();
      await printRaw(encoder.build());
      notify(`Kitchen ticket #${ticket.id} sent to printer.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not print KOT to thermal printer.');
    }
  }

  return (
    <Modal title="Kitchen Display System (KDS)" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#eff6ff] p-2.5 rounded-2xl border border-[#e0edff]">
          <div className="flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-[#2941e0]" aria-hidden />
            <span className="text-xs font-semibold text-[#273238] tabular-nums">
              {activeCount} active kitchen {activeCount === 1 ? 'ticket' : 'tickets'}
            </span>
          </div>
          <div role="group" aria-label="Kitchen ticket filter" className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('ACTIVE')}
              aria-pressed={filter === 'ACTIVE'}
              className={`px-3 min-h-9 rounded-[8px] text-xs font-semibold transition tabular-nums ${
                filter === 'ACTIVE'
                  ? 'bg-[#2941e0] text-white'
                  : 'bg-white text-[#273238] border border-[#788991] hover:bg-[#eff6ff]'
              }`}
            >
              Active ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('SERVED')}
              aria-pressed={filter === 'SERVED'}
              className={`px-3 min-h-9 rounded-[8px] text-xs font-semibold transition tabular-nums ${
                filter === 'SERVED'
                  ? 'bg-[#2941e0] text-white'
                  : 'bg-white text-[#273238] border border-[#788991] hover:bg-[#eff6ff]'
              }`}
            >
              Completed ({servedCount})
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="text-center py-12 text-[#616f75] text-sm">
            No {filter === 'ACTIVE' ? 'active' : 'completed'} kitchen tickets right now.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[65vh] overflow-y-auto pr-1 custom-scrollbar">
            {visible.map((ticket) => {
              const elapsedMin = Math.max(0, Math.floor((now - new Date(ticket.timestamp).getTime()) / 60000));
              const urgent = elapsedMin >= 15 && ticket.status !== 'SERVED';
              const ready = ticket.status === 'READY';

              return (
                <article
                  key={ticket.key}
                  className={`rounded-2xl border p-3.5 flex flex-col justify-between gap-3 ${
                    ready
                      ? 'bg-emerald-50/80 border-emerald-700'
                      : urgent
                        ? 'bg-red-50/80 border-red-600'
                        : 'bg-white border-[#e0edff]'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 border-b border-[#e0edff] pb-2.5 mb-2.5">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-display font-bold text-sm text-[#000000] tabular-nums">#{ticket.id}</span>
                          <span className="px-2 py-0.5 rounded-[88px] text-[11px] font-semibold uppercase bg-[#eff6ff] text-[#2941e0]">
                            {ticket.orderType.replace('_', ' ')}
                          </span>
                          {ticket.tableNumber && (
                            <span className="px-2 py-0.5 rounded-[88px] text-[11px] font-semibold bg-[#000524] text-white">
                              Table {ticket.tableNumber}
                            </span>
                          )}
                          {ticket.source === 'held' && (
                            <span className="px-2 py-0.5 rounded-[88px] text-[11px] font-semibold bg-amber-50 border border-amber-300 text-amber-900">
                              Running Tab
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#526066] mt-1">
                          Server: {ticket.serverUser} · {new Date(ticket.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[88px] text-[11px] font-bold tabular-nums shrink-0 ${
                          urgent
                            ? 'bg-red-600 text-white'
                            : elapsedMin >= 8
                              ? 'bg-amber-50 border border-amber-300 text-amber-900'
                              : 'bg-[#eff6ff] text-[#273238]'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5" aria-hidden />
                        {urgent ? `${elapsedMin}m+` : `${elapsedMin}m`}
                      </span>
                    </div>

                    <ul className="space-y-1.5 text-sm">
                      {ticket.items.map((item, idx) => (
                        <li key={`${item.id}-${idx}`} className="flex items-start gap-2 font-medium text-[#000000]">
                          <span className="inline-flex items-center justify-center min-w-7 px-1.5 py-0.5 rounded-[6px] bg-[#000524] text-white text-xs font-bold tabular-nums shrink-0">
                            {item.weightKg ? formatWeightShort(item.weightKg) : `${item.qty}×`}
                          </span>
                          <div className="min-w-0">
                            <div>{item.name}</div>
                            {item.note && <div className="text-xs italic text-red-700">Note: {item.note}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#e0edff]">
                    <button
                      type="button"
                      onClick={() => printKot(ticket)}
                      className="px-3 min-h-9 rounded-[8px] text-xs font-semibold border border-[#788991] bg-white hover:bg-[#eff6ff] text-[#273238] inline-flex items-center gap-1.5 transition"
                    >
                      <Printer className="w-3.5 h-3.5" aria-hidden /> KOT
                    </button>

                    <div className="flex gap-1.5">
                      {ticket.status !== 'READY' && ticket.status !== 'SERVED' && (
                        <button
                          type="button"
                          onClick={() => updateStatus(ticket, 'READY')}
                          className="px-3 min-h-9 rounded-[8px] text-xs font-semibold bg-amber-700 hover:bg-amber-800 text-white inline-flex items-center gap-1.5 transition"
                        >
                          <Flame className="w-3.5 h-3.5" aria-hidden /> Mark Ready
                        </button>
                      )}
                      {ticket.status !== 'SERVED' ? (
                        <button
                          type="button"
                          onClick={() => updateStatus(ticket, 'SERVED')}
                          className="px-3 min-h-9 rounded-[8px] text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white inline-flex items-center gap-1.5 transition"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Bump / Served
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => updateStatus(ticket, 'PREPARING')}
                          className="px-3 min-h-9 rounded-[8px] text-xs font-semibold border border-[#788991] bg-white hover:bg-[#eff6ff] text-[#273238] transition"
                        >
                          Recall
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
