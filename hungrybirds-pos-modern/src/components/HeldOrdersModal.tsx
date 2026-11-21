import { useState } from 'react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { readHeldOrder } from '../lib/held';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';
import type { CartCharges } from '../lib/cart';
import type { CartItem, CustomerInfo } from '../lib/db/types';

export function HeldOrdersModal({ onClose, onRestore }: {
  onClose: () => void;
  onRestore: (order: { items: CartItem[]; charges: CartCharges; customer?: CustomerInfo }) => void;
}) {
  const orders = useLive(() => db.heldOrders.orderBy('id').reverse().toArray(), []) ?? [];
  const [confirming, setConfirming] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);

  async function restore(id: number) {
    const order = await readHeldOrder(id);
    if (!order) return;
    await db.heldOrders.delete(id);
    onRestore(order);
  }

  return (
    <Modal title="Held Orders" onClose={onClose} wide>
      {orders.length === 0 ? (
        <p className="text-[#616f75] text-sm text-center py-8">No held orders right now.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <div key={order.id} className="p-3.5 bg-amber-50/70 border border-amber-300 rounded-2xl space-y-2.5">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-semibold text-sm text-[#000000] flex flex-wrap items-center gap-1.5">
                    <span className="tabular-nums">Held Order #{order.id}</span>
                    <span className="text-[11px] text-amber-900 font-semibold bg-white border border-amber-300 px-2 py-0.5 rounded-[88px]">
                      {order.orderType.replace('_', ' ')}
                    </span>
                    {order.tableNumber && (
                      <span className="text-[11px] text-white font-semibold bg-[#000524] px-2 py-0.5 rounded-[88px]">
                        Table {order.tableNumber}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#526066] mt-0.5">
                    By: {order.serverUser} · {new Date(order.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                <div className="font-display font-bold text-[#2941e0] text-sm shrink-0 tabular-nums">{formatAmount(order.total)}</div>
              </div>

              <div className="text-xs text-[#273238] bg-white p-2.5 rounded-[10px] border border-[#e0edff]">
                {order.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {replacing === order.id ? (
                  <>
                    <span className="text-xs text-[#273238] font-semibold mr-auto">Replace items in the cart?</span>
                    <button
                      type="button"
                      onClick={() => restore(order.id!)}
                      className="text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-semibold px-3 min-h-9 rounded-[8px] transition"
                    >
                      Yes, restore
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplacing(null)}
                      className="text-xs bg-white border border-[#788991] text-[#273238] hover:bg-[#eff6ff] font-semibold px-3 min-h-9 rounded-[8px] transition"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReplacing(order.id!)}
                    className="text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-semibold px-3 min-h-9 rounded-[8px] transition"
                  >
                    Restore to Cart
                  </button>
                )}
                {confirming === order.id ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await db.heldOrders.delete(order.id!);
                      setConfirming(null);
                    }}
                    className="text-xs bg-red-600 hover:bg-red-700 text-white font-semibold px-3 min-h-9 rounded-[8px] transition"
                  >
                    Confirm discard
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(order.id!)}
                    className="text-xs bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 font-semibold px-3 min-h-9 rounded-[8px] transition"
                  >
                    Discard
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
