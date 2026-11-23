import { useMemo, useState } from 'react';
import { Check, Inbox, Plus, RefreshCw, X } from 'lucide-react';
import { db } from '../lib/db';
import { syncNow } from '../lib/sync';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import { STATUS_LABEL, isActive, nextStatus, rejectOrder, resolveOrderToCart, setOrderStatus } from '../lib/onlineOrders';
import { Modal } from './Modal';
import type { CartItem, OnlineOrder, OnlineOrderStatus, OrderType } from '../lib/db/types';

const STATUS_TONE: Record<OnlineOrderStatus, string> = {
  PENDING: 'bg-[#eff6ff] text-[#5b3ee0] border-[#c5b9fa]',
  ACCEPTED: 'bg-amber-50 text-amber-900 border-amber-300',
  PREPARING: 'bg-amber-50 text-amber-900 border-amber-300',
  OUT_FOR_DELIVERY: 'bg-[#eff6ff] text-[#2941e0] border-[#e0edff]',
  COMPLETED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

export function OnlineOrdersModal({
  username,
  notify,
  onClose,
  onAccept,
  hasCartItems = false,
}: {
  username: string;
  notify: (message: string) => void;
  onClose: () => void;
  onAccept: (items: CartItem[], order: OnlineOrder) => void;
  hasCartItems?: boolean;
}) {
  const orders = useLive(() => db.onlineOrders.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const [showHistory, setShowHistory] = useState(false);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmOverwriteId, setConfirmOverwriteId] = useState<number | null>(null);

  const { pending, inProgress, closed } = useMemo(() => ({
    pending: orders.filter((o) => o.status === 'PENDING'),
    inProgress: orders.filter((o) => isActive(o) && o.status !== 'PENDING'),
    closed: orders.filter((o) => !isActive(o)),
  }), [orders]);

  async function accept(order: OnlineOrder, force = false) {
    if (!order.id) return;
    if (hasCartItems && !force) {
      setConfirmOverwriteId(order.id);
      return;
    }
    const items = await resolveOrderToCart(order);
    onAccept(items, order);
    await setOrderStatus(order.id, 'ACCEPTED', username);
    setConfirmOverwriteId(null);
    notify(`Order #${order.id} loaded into the cart.`);
    onClose();
  }

  async function advance(order: OnlineOrder) {
    if (!order.id) return;
    const next = nextStatus(order);
    if (!next) return;
    await setOrderStatus(order.id, next, username);
    notify(`Order #${order.id}: ${STATUS_LABEL[next]}.`);
  }

  async function reject(order: OnlineOrder, reason: string) {
    if (!order.id) return;
    await rejectOrder(order.id, reason.trim(), username);
    notify(`Order #${order.id} rejected.`);
  }

  return (
    <Modal
      title="Online Orders"
      onClose={onClose}
      wide
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#2941e0] bg-[#eff6ff] border border-[#e0edff] px-3 min-h-9 rounded-[8px] hover:bg-[#e0edff] transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden /> {adding ? 'Hide form' : 'Record website order'}
            </button>
            <button
              type="button"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  const changed = await syncNow({ collections: ['onlineOrders'], manual: true });
                  notify(changed ? 'Online order inbox refreshed.' : 'Everything is already up to date.');
                } finally {
                  setSyncing(false);
                }
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#273238] bg-white border border-[#788991] px-3 min-h-9 rounded-[8px] hover:bg-[#eff6ff] disabled:opacity-50 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs font-semibold text-[#273238] bg-white border border-[#788991] px-3 min-h-9 rounded-[8px] hover:bg-[#eff6ff] transition tabular-nums"
          >
            {showHistory ? 'Hide' : 'Show'} history ({closed.length})
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {adding && (
          <NewOrderForm
            onCreate={async (order) => {
              const id = await db.onlineOrders.add(order);
              notify(`Website order #${id} recorded.`);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {pending.length === 0 && inProgress.length === 0 ? (
          <div className="text-center py-8 space-y-1.5">
            <Inbox className="w-8 h-8 text-[#616f75] mx-auto" aria-hidden />
            <p className="text-[#273238] text-sm font-medium">No active online orders.</p>
            <p className="text-xs text-[#616f75] max-w-sm mx-auto">
              Website orders arrive here automatically. Use “Record website order” for one that came in by phone.
            </p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <section className="space-y-2.5">
                <SectionTitle className="text-[#5b3ee0]">New orders ({pending.length})</SectionTitle>
                {pending.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    confirmOverwrite={confirmOverwriteId === order.id}
                    onCancelOverwrite={() => setConfirmOverwriteId(null)}
                    onAccept={(o, force) => void accept(o, force)}
                    onReject={(o, reason) => void reject(o, reason)}
                  />
                ))}
              </section>
            )}
            {inProgress.length > 0 && (
              <section className="space-y-2.5">
                <SectionTitle className="text-amber-900">In progress ({inProgress.length})</SectionTitle>
                {inProgress.map((order) => (
                  <OrderCard key={order.id} order={order} onAdvance={(o) => void advance(o)} />
                ))}
              </section>
            )}
          </>
        )}

        {showHistory && (
          <section className="space-y-2 pt-3 border-t border-[#e0edff]">
            <SectionTitle>History ({closed.length})</SectionTitle>
            {closed.length === 0 ? (
              <p className="text-xs text-[#616f75]">Nothing completed or rejected yet.</p>
            ) : (
              <ul className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                {closed.map((order) => (
                  <li key={order.id} className="p-2.5 bg-white border border-[#e0edff] rounded-[10px] flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#000000] truncate">
                        #{order.id} · {order.customer?.name || 'Website customer'}
                      </p>
                      <p className="text-xs text-[#526066] tabular-nums">
                        {order.items?.length || 0} item(s) · {formatAmount(order.total)}
                        {order.rejectReason ? ` · ${order.rejectReason}` : ''}
                      </p>
                    </div>
                    <span className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded-[88px] border shrink-0 ${STATUS_TONE[order.status]}`}>
                      {STATUS_LABEL[order.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

function OrderCard({
  order,
  confirmOverwrite = false,
  onCancelOverwrite,
  onAccept,
  onAdvance,
  onReject,
}: {
  order: OnlineOrder;
  confirmOverwrite?: boolean;
  onCancelOverwrite?: () => void;
  onAccept?: (order: OnlineOrder, force?: boolean) => void;
  onAdvance?: (order: OnlineOrder) => void;
  onReject?: (order: OnlineOrder, reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const next = nextStatus(order);
  const isPending = order.status === 'PENDING';

  return (
    <article
      className={`p-3.5 rounded-2xl border space-y-2.5 ${
        isPending ? 'bg-[#eff6ff]/70 border-[#5b3ee0]' : 'bg-amber-50/70 border-amber-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#000000] flex flex-wrap items-center gap-1.5">
            <span className="tabular-nums">#{order.id}</span>
            <span>{order.customer?.name || 'Website customer'}</span>
            <span className="text-[11px] font-semibold bg-white border border-[#e0edff] text-[#273238] px-2 py-0.5 rounded-[88px]">
              {order.orderType.replace('_', ' ')}
            </span>
          </p>
          <p className="text-xs text-[#526066] mt-0.5 tabular-nums">
            {order.customer?.phone || 'No phone'} · {new Date(order.createdAt).toLocaleTimeString()}
          </p>
        </div>
        <span className={`text-[11px] font-semibold uppercase px-2.5 py-0.5 rounded-[88px] border shrink-0 ${STATUS_TONE[order.status]}`}>
          {STATUS_LABEL[order.status]}
        </span>
      </div>

      <ul className="bg-white border border-[#e0edff] rounded-[10px] p-2.5 space-y-1">
        {(order.items || []).map((line, index) => (
          <li key={`${line.id}-${index}`} className="flex justify-between gap-2 text-xs text-[#273238]">
            <span className="truncate">{line.name}{line.note ? ` — ${line.note}` : ''}</span>
            <span className="tabular-nums font-semibold shrink-0">×{line.qty}</span>
          </li>
        ))}
      </ul>

      {order.customer?.address && <p className="text-xs text-[#526066]">{order.customer.address}</p>}
      {order.note && <p className="text-xs text-[#526066] italic">{order.note}</p>}

      {rejecting ? (
        <div className="pt-2 border-t border-[#e0edff] flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (optional)"
            aria-label={`Rejection reason for order #${order.id}`}
            autoFocus
            className="flex-1 px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] placeholder:text-[#616f75] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
          />
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setRejecting(false);
                setRejectReason('');
              }}
              className="px-3 min-h-9 rounded-[8px] text-xs font-semibold border border-[#788991] bg-white text-[#273238] hover:bg-[#eff6ff]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onReject?.(order, rejectReason);
                setRejecting(false);
                setRejectReason('');
              }}
              className="px-3 min-h-9 rounded-[8px] text-xs font-semibold bg-red-600 hover:bg-red-700 text-white"
            >
              Confirm Reject
            </button>
          </div>
        </div>
      ) : confirmOverwrite ? (
        <div className="pt-2 border-t border-[#e0edff] flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#273238]">
            Replace existing items in your cart?
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onCancelOverwrite}
              className="px-3 min-h-9 rounded-[8px] text-xs font-semibold border border-[#788991] bg-white text-[#273238] hover:bg-[#eff6ff]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onAccept?.(order, true)}
              className="px-3 min-h-9 rounded-[8px] text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white"
            >
              Yes, load order
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="font-display text-sm font-bold text-[#2941e0] tabular-nums">{formatAmount(order.total)}</span>
          <div className="flex gap-2">
            {isPending && onAccept && (
              <button
                type="button"
                onClick={() => onAccept(order, false)}
                className="text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white px-3 min-h-9 rounded-[8px] flex items-center gap-1.5 transition"
              >
                <Check className="w-3.5 h-3.5" aria-hidden /> Accept to cart
              </button>
            )}
            {isPending && onReject && (
              <button
                type="button"
                onClick={() => setRejecting(true)}
                className="text-xs font-semibold bg-red-50 text-red-700 border border-red-300 hover:bg-red-100 px-3 min-h-9 rounded-[8px] transition"
              >
                Reject
              </button>
            )}
            {!isPending && next && onAdvance && (
              <button
                type="button"
                onClick={() => onAdvance(order)}
                className="text-xs font-semibold bg-[#2941e0] hover:bg-[#1f35c4] text-white px-3 min-h-9 rounded-[8px] transition"
              >
                {next === 'PREPARING' ? 'Start preparing'
                  : next === 'OUT_FOR_DELIVERY' ? 'Assign to rider'
                  : 'Mark delivered'}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

const INPUT =
  'px-3 h-10 text-xs border border-[#788991] rounded-[10px] bg-white text-[#000000] placeholder:text-[#616f75] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] min-w-0';

function NewOrderForm({ onCreate, onCancel }: {
  onCreate: (order: OnlineOrder) => Promise<void>;
  onCancel: () => void;
}) {
  const menu = useLive(() => db.menu.toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('DELIVERY');
  const [picked, setPicked] = useState<Array<{ menuItemId: string; qty: string }>>([{ menuItemId: '', qty: '1' }]);

  const lines: CartItem[] = picked
    .map((row) => {
      const item = menu.find((m) => m.id === row.menuItemId);
      const qty = Number(row.qty) || 0;
      if (!item || qty <= 0) return null;
      return { id: item.id, menuItemId: item.id, name: item.name, price: item.price, qty };
    })
    .filter((line): line is CartItem => line !== null);

  const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);

  async function submit() {
    if (!lines.length) return;
    await onCreate({
      createdAt: new Date().toISOString(),
      customer: { name: name.trim(), phone: phone.trim(), address: address.trim() },
      orderType,
      items: lines,
      total,
      status: 'PENDING',
    });
  }

  return (
    <section className="p-3.5 rounded-2xl border border-[#e0edff] bg-[#eff6ff]/60 space-y-2.5">
      <SectionTitle className="text-[#2941e0]">Record a website order</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block">
          <span className="block text-xs font-medium text-[#273238] mb-1">Customer name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" className={`${INPUT} w-full`} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-[#273238] mb-1">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300 1234567" className={`${INPUT} w-full`} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-[#273238] mb-1">Order type</span>
          <select value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)} className={`${INPUT} w-full`}>
            <option value="DELIVERY">Delivery</option>
            <option value="TAKEAWAY">Takeaway</option>
            <option value="DINE_IN">Dine in</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="block text-xs font-medium text-[#273238] mb-1">Delivery address (optional)</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, block, or landmark" className={`${INPUT} w-full`} />
      </label>

      {picked.map((row, index) => (
        <div key={index} className="flex gap-1.5">
          <select
            value={row.menuItemId}
            onChange={(e) => setPicked((rows) => rows.map((r, i) => (i === index ? { ...r, menuItemId: e.target.value } : r)))}
            aria-label={`Item ${index + 1}`}
            className={`${INPUT} flex-1`}
          >
            <option value="">Select dish...</option>
            {menu.map((item) => (
              <option key={item.id} value={item.id}>{item.name} — {formatAmount(item.price)}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={row.qty}
            onChange={(e) => setPicked((rows) => rows.map((r, i) => (i === index ? { ...r, qty: e.target.value } : r)))}
            aria-label={`Item ${index + 1} quantity`}
            className={`${INPUT} w-16 text-right tabular-nums`}
          />
          <button
            type="button"
            onClick={() => setPicked((rows) => (rows.length === 1 ? [{ menuItemId: '', qty: '1' }] : rows.filter((_, i) => i !== index)))}
            aria-label={`Remove item ${index + 1}`}
            className="w-10 h-10 bg-white border border-[#788991] text-[#526066] hover:text-red-700 hover:border-red-300 rounded-[10px] flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setPicked((rows) => [...rows, { menuItemId: '', qty: '1' }])}
          className="text-xs font-semibold text-[#2941e0] hover:underline py-1"
        >
          + Add line
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[#000000] tabular-nums">{formatAmount(total)}</span>
          <button type="button" onClick={onCancel} className="text-xs font-semibold text-[#273238] border border-[#788991] bg-white px-3 min-h-9 rounded-[8px] hover:bg-[#eff6ff]">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!lines.length}
            className="text-xs font-semibold bg-[#2941e0] hover:bg-[#1f35c4] text-white px-3.5 min-h-9 rounded-[8px] disabled:opacity-45 transition"
          >
            Record order
          </button>
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ children, className = 'text-[#273238]' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs font-bold uppercase tracking-wide ${className}`}>{children}</p>;
}
