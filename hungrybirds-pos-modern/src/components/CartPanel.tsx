import { useId, useState } from 'react';
import { Minus, Plus, Trash2, Pause, Printer, UtensilsCrossed, Check } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { calculateCartTotals, cartItemCount } from '../lib/cart';
import type { CartCharges } from '../lib/cart';
import { formatAmount } from '../lib/format';
import { CustomerPanel } from './CustomerPanel';
import type { CartItem, CustomerInfo, OrderType, UserRole } from '../lib/db/types';

const ORDER_TYPES: Array<{ value: OrderType; label: string }> = [
  { value: 'DINE_IN', label: 'Dine In' },
  { value: 'TAKEAWAY', label: 'Takeaway' },
  { value: 'DELIVERY', label: 'Delivery' },
];

const TABLES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];

export function CartPanel({
  items, role, charges, customer, loyaltyBalance, lastAddedLineId = null, onChange, onCustomerChange,
  onQtyChange, onRemove, onClear, onCheckout, onHold, notify,
}: {
  items: CartItem[];
  role: UserRole;
  charges: CartCharges;
  customer: CustomerInfo;
  loyaltyBalance: number;
  lastAddedLineId?: string | null;
  onChange: (charges: CartCharges) => void;
  onCustomerChange: (customer: CustomerInfo) => void;
  onQtyChange: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onCheckout: () => void;
  onHold: () => void;
  notify: (message: string) => void;
}) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const tableSelectId = useId();
  const totals = calculateCartTotals(items, charges);
  const totalUnits = cartItemCount(items);
  const { orderType, tableNumber, discountPercent, deliveryCharge } = charges;

  const heldOrders = useLive(() => db.heldOrders.toArray(), []) ?? [];
  const occupiedTables = new Set(
    heldOrders
      .filter((h) => h.orderType === 'DINE_IN' && h.tableNumber)
      .map((h) => h.tableNumber as string),
  );

  const selectedTableOccupied = Boolean(tableNumber && occupiedTables.has(tableNumber));
  const showClearConfirm = confirmingClear && items.length > 0;

  return (
    <div className="bg-white p-4 sm:p-5 rounded-2xl border border-[#e0edff] flex flex-col lg:max-h-[calc(100vh-5.75rem)]">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 gap-2">
        <div className="flex items-center justify-between sm:justify-start gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-medium text-[#000000]">Current Order</h3>
            {totalUnits > 0 && (
              <span
                className={`px-2.5 py-0.5 rounded-[88px] text-xs font-semibold tabular-nums transition-colors ${
                  lastAddedLineId
                    ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-700/40 animate-cart-pop'
                    : 'bg-[#eff6ff] text-[#2941e0]'
                }`}
              >
                {totalUnits} {totalUnits === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>
          {items.length > 0 && !showClearConfirm && (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              aria-label="Clear cart"
              className="text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 min-h-8 rounded-[8px] flex items-center gap-1 transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden /> Clear
            </button>
          )}
        </div>
        <div
          role="group"
          aria-label="Order type"
          className="grid grid-cols-3 w-full sm:w-auto sm:flex bg-[#eff6ff] p-1 rounded-[10px] border border-[#e0edff] text-xs font-medium gap-1"
        >
          {ORDER_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() =>
                onChange({
                  ...charges,
                  orderType: t.value,
                  deliveryCharge: t.value === 'DELIVERY' ? deliveryCharge : 0,
                })
              }
              aria-pressed={orderType === t.value}
              className={`px-2 sm:px-3 py-1.5 min-h-9 rounded-[8px] whitespace-nowrap transition-all duration-150 ${
                orderType === t.value
                  ? 'bg-[#2941e0] text-white font-medium'
                  : 'text-[#273238] hover:bg-white hover:text-[#2941e0]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {showClearConfirm && (
        <div
          role="alert"
          className="mb-3 p-3 rounded-[10px] bg-red-50 border border-red-200 flex flex-wrap items-center justify-between gap-2"
        >
          <span className="text-xs font-semibold text-red-800">
            Clear entire order?
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              className="px-3 min-h-9 rounded-[8px] text-xs font-semibold border border-[#788991] bg-white text-[#273238] hover:bg-[#eff6ff] transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingClear(false);
                onClear();
              }}
              className="px-3 min-h-9 rounded-[8px] text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition"
            >
              Confirm Clear
            </button>
          </div>
        </div>
      )}

      {orderType === 'DINE_IN' && (
        <div className="mb-3 px-3 py-2 rounded-[10px] bg-[#eff6ff]/70 border border-[#e0edff] flex items-center gap-2">
          <label
            htmlFor={tableSelectId}
            className="text-xs font-semibold text-[#273238] flex items-center gap-1.5 shrink-0"
          >
            <UtensilsCrossed className="w-3.5 h-3.5 text-[#2941e0]" aria-hidden />
            <span>Table</span>
          </label>
          <select
            id={tableSelectId}
            value={tableNumber ?? ''}
            onChange={(e) => onChange({ ...charges, tableNumber: e.target.value || undefined })}
            className="flex-1 min-w-0 h-9 px-2.5 text-xs font-medium text-[#000000] bg-white border border-[#788991] rounded-[8px] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
          >
            <option value="">Counter (No table)</option>
            {TABLES.map((t) => (
              <option key={t} value={t}>
                {occupiedTables.has(t) ? `${t} — Occupied (Held)` : t}
              </option>
            ))}
          </select>
          {selectedTableOccupied && (
            <span className="px-2 py-0.5 rounded-[88px] bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-semibold shrink-0">
              Held
            </span>
          )}
        </div>
      )}

      <CustomerPanel
        orderType={orderType}
        customer={customer}
        loyaltyBalance={loyaltyBalance}
        loyaltyPoints={charges.loyaltyPoints}
        onChange={onCustomerChange}
        onRedeem={(points) => onChange({ ...charges, loyaltyPoints: points })}
      />

      {orderType === 'DELIVERY' && (
        <div className="mb-3">
          <label htmlFor="deliveryCharge" className="block text-xs font-medium text-[#273238] mb-1">
            Delivery Charge (Rs)
          </label>
          <input
            id="deliveryCharge"
            type="number"
            min={0}
            step={0.01}
            value={deliveryCharge || 0}
            onChange={(e) => onChange({ ...charges, deliveryCharge: Math.max(0, Number(e.target.value) || 0) })}
            className="w-full px-3 py-2 h-10 border border-[#788991] rounded-[10px] bg-white text-sm font-medium text-[#000000] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
          />
        </div>
      )}

      <div className="space-y-2 mb-3 flex-1 overflow-y-auto custom-scrollbar min-h-[150px]">
        {items.length === 0 ? (
          <p className="text-center text-[#616f75] py-6 text-xs">Cart is empty — tap any dish to start an order</p>
        ) : (
          items.map((item) => {
            const justAdded = lastAddedLineId === item.id;
            return (
              <div
                key={item.id}
                className={`border rounded-2xl p-2.5 flex justify-between items-center gap-2 transition-all ${
                  justAdded
                    ? 'border-emerald-700 bg-emerald-50 ring-2 ring-emerald-700/25 animate-cart-pop'
                    : 'border-[#e0edff] bg-white'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm text-[#000000] truncate">{item.name}</div>
                  <div className="text-xs text-[#526066] flex items-center gap-1.5 tabular-nums">
                    <span>{formatAmount(item.price)}</span>
                    {justAdded && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                        <Check className="w-3 h-3" aria-hidden /> Added
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onQtyChange(item.id, item.qty - 1)}
                      className="w-9 h-9 rounded-[8px] bg-red-600 text-white hover:bg-red-700 flex items-center justify-center transition-colors"
                      aria-label={`Decrease ${item.name}`}
                    >
                      <Minus className="w-4 h-4" aria-hidden />
                    </button>
                    <span className="font-semibold min-w-6 text-center text-sm tabular-nums text-[#000000]">{item.qty}</span>
                    <button
                      type="button"
                      onClick={() => onQtyChange(item.id, item.qty + 1)}
                      className="w-9 h-9 rounded-[8px] bg-emerald-700 text-white hover:bg-emerald-800 flex items-center justify-center transition-colors"
                      aria-label={`Increase ${item.name}`}
                    >
                      <Plus className="w-4 h-4" aria-hidden />
                    </button>
                  </div>
                  <div className="font-semibold text-xs sm:text-sm min-w-14 sm:min-w-16 text-right text-[#000000] tabular-nums">
                    {formatAmount(item.price * item.qty)}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    className="w-9 h-9 rounded-[8px] text-[#526066] hover:text-red-700 hover:bg-red-50 flex items-center justify-center transition-colors"
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-[#e0edff] pt-3 space-y-2.5">
        <div className="flex justify-between items-center text-sm text-[#526066]">
          <span>Subtotal:</span>
          <span className="font-semibold text-[#000000] tabular-nums">{formatAmount(totals.subtotal)}</span>
        </div>

        <div className="flex justify-between items-center gap-2 bg-[#eff6ff] border border-[#e0edff] px-3 py-2 rounded-2xl">
          <label htmlFor="discountInput" className="text-xs font-medium text-[#273238]">
            Discount:
          </label>
          <div className="flex items-center gap-1 bg-white rounded-[10px] border border-[#788991] px-2">
            <input
              id="discountInput"
              type="number"
              min={0}
              max={100}
              value={discountPercent}
              onChange={(e) =>
                onChange({ ...charges, discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })
              }
              className="w-14 py-1 min-h-8 text-right font-semibold text-sm border-0 focus:outline-none text-[#000000] bg-transparent tabular-nums"
            />
            <span className="text-xs font-medium text-[#526066]">%</span>
          </div>
        </div>

        {totals.discountAmount > 0 && (
          <div className="flex justify-between items-center text-xs text-red-700 font-medium bg-red-50 border border-red-200 p-2 rounded-[10px] tabular-nums">
            <span>Saved:</span>
            <span>-{formatAmount(totals.discountAmount)} ({discountPercent}%)</span>
          </div>
        )}

        {totals.deliveryCharge > 0 && (
          <div className="flex justify-between items-center text-xs text-[#2941e0] font-medium bg-[#eff6ff] p-2 rounded-[10px] tabular-nums">
            <span>Delivery:</span>
            <span>{formatAmount(totals.deliveryCharge)}</span>
          </div>
        )}

        {totals.loyaltyDiscount > 0 && (
          <div className="flex justify-between items-center text-xs text-[#5b3ee0] font-medium bg-[#eff6ff] p-2 rounded-[10px] tabular-nums">
            <span>Points ({charges.loyaltyPoints}):</span>
            <span>-{formatAmount(totals.loyaltyDiscount)}</span>
          </div>
        )}

        <div className="flex justify-between items-end font-display font-semibold text-2xl text-[#000000] border-t border-[#d4d4d8] pt-3 pb-0.5">
          <span className="text-sm font-sans font-medium text-[#526066] mb-0.5">Total Due</span>
          <span className="text-[#2941e0] tabular-nums">{formatAmount(totals.grandTotal)}</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2.5 mt-4">
        <button
          type="button"
          onClick={onHold}
          disabled={!items.length}
          title="Hold Order (F4)"
          className="col-span-1 h-11 bg-white border border-[#788991] text-[#000000] rounded-[8px] font-medium hover:bg-[#eff6ff] hover:border-[#2941e0] disabled:opacity-45 transition flex items-center justify-center gap-1 text-xs sm:text-sm"
        >
          <Pause className="w-4 h-4 shrink-0 text-[#2941e0]" aria-hidden /> Hold
        </button>
        <button
          type="button"
          onClick={() => {
            if (role === 'WAITER') {
              notify('Waiters cannot take payments. Ask a cashier or manager.');
              return;
            }
            onCheckout();
          }}
          disabled={!items.length}
          title="Checkout & Print (F2)"
          className="col-span-3 h-11 bg-[#2941e0] text-white rounded-[8px] font-medium tracking-[0.3px] hover:bg-[#1f35c4] disabled:opacity-45 transition flex items-center justify-center gap-2 text-sm"
        >
          <Printer className="w-4 h-4 shrink-0" aria-hidden /> Checkout & Print
        </button>
      </div>
    </div>
  );
}
