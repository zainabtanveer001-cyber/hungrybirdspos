import { Minus, Plus, Trash2, Pause, Printer } from 'lucide-react';
import { calculateCartTotals } from '../lib/cart';
import type { CartCharges } from '../lib/cart';
import { formatAmount } from '../lib/format';
import { CustomerPanel } from './CustomerPanel';
import type { CartItem, CustomerInfo, OrderType, UserRole } from '../lib/db/types';

const ORDER_TYPES: Array<{ value: OrderType; label: string }> = [
  { value: 'DINE_IN', label: 'Dine In' },
  { value: 'TAKEAWAY', label: 'Takeaway' },
  { value: 'DELIVERY', label: 'Delivery' },
];

export function CartPanel({
  items, role, charges, customer, loyaltyBalance, onChange, onCustomerChange,
  onQtyChange, onRemove, onCheckout, onHold, notify,
}: {
  items: CartItem[];
  role: UserRole;
  charges: CartCharges;
  customer: CustomerInfo;
  loyaltyBalance: number;
  onChange: (charges: CartCharges) => void;
  onCustomerChange: (customer: CustomerInfo) => void;
  onQtyChange: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
  onHold: () => void;
  notify: (message: string) => void;
}) {
  const totals = calculateCartTotals(items, charges);
  const { orderType, discountPercent, deliveryCharge } = charges;

  return (
    <div className="bg-white p-4 sm:p-5 rounded-3xl shadow-sm border border-gray-100 flex flex-col">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-3">
        <h3 className="text-base font-black text-gray-900 tracking-tight">Current Order</h3>
        <div className="flex bg-gray-50/80 p-1.5 rounded-2xl border border-gray-200 text-xs font-bold gap-1 shadow-inner">
          {ORDER_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => onChange({ ...charges, orderType: t.value, deliveryCharge: t.value === 'DELIVERY' ? deliveryCharge : 0 })}
              aria-pressed={orderType === t.value}
              className={`px-3 sm:px-4 py-2 min-h-11 rounded-xl whitespace-nowrap transition-all duration-300 ${
                orderType === t.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-indigo-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <CustomerPanel
        orderType={orderType}
        customer={customer}
        loyaltyBalance={loyaltyBalance}
        loyaltyPoints={charges.loyaltyPoints}
        onChange={onCustomerChange}
        onRedeem={(points) => onChange({ ...charges, loyaltyPoints: points })}
      />

      {orderType === 'DELIVERY' && (
        <div className="mb-4">
          <label htmlFor="deliveryCharge" className="block text-xs font-bold text-blue-900 mb-1.5">
            Delivery Charge (Rs)
          </label>
          <input
            id="deliveryCharge"
            type="number"
            min={0}
            step={0.01}
            value={deliveryCharge || 0}
            onChange={(e) => onChange({ ...charges, deliveryCharge: Math.max(0, Number(e.target.value) || 0) })}
            className="w-full p-2.5 min-h-11 border-0 ring-1 ring-blue-200 rounded-xl bg-white text-sm font-bold text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      <div className="space-y-2 mb-4 flex-1 overflow-y-auto custom-scrollbar min-h-[100px]">
        {items.length === 0 ? (
          <p className="text-center text-gray-400 py-6">Cart is empty</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="border border-gray-200 rounded-xl p-3 bg-white flex justify-between items-center shadow-sm gap-3"
            >
              <div className="min-w-0">
                <div className="font-semibold text-gray-800">{item.name}</div>
                <div className="text-xs text-gray-500">{formatAmount(item.price)}</div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onQtyChange(item.id, item.qty - 1)}
                    className="p-1 rounded bg-red-500 text-white hover:bg-red-600"
                    aria-label={`Decrease ${item.name}`}
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-bold px-2 text-sm tabular-nums">{item.qty}</span>
                  <button
                    type="button"
                    onClick={() => onQtyChange(item.id, item.qty + 1)}
                    className="p-1 rounded bg-green-500 text-white hover:bg-green-600"
                    aria-label={`Increase ${item.name}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="font-bold text-sm w-20 text-right text-gray-800 tabular-nums">
                  {formatAmount(item.price * item.qty)}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                  aria-label={`Remove ${item.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex justify-between items-center text-sm text-gray-500 font-medium">
          <span>Subtotal:</span>
          <span className="font-extrabold text-gray-800">{formatAmount(totals.subtotal)}</span>
        </div>

        <div className="flex justify-between items-center gap-2 bg-amber-50 border border-amber-200 p-3 rounded-2xl shadow-sm">
          <label htmlFor="discountInput" className="text-sm font-bold text-amber-900">
            Discount:
          </label>
          <div className="flex items-center gap-2 bg-white rounded-xl ring-1 ring-amber-300 p-1 shadow-inner">
            <input
              id="discountInput"
              type="number"
              min={0}
              max={100}
              value={discountPercent}
              onChange={(e) =>
                onChange({ ...charges, discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })
              }
              className="w-16 p-1.5 min-h-11 text-right font-black text-sm border-0 rounded-lg focus:outline-none text-amber-900 bg-transparent"
            />
            <span className="text-sm font-black text-amber-900 pr-2">%</span>
          </div>
        </div>

        {totals.discountAmount > 0 && (
          <div className="flex justify-between items-center text-sm text-red-500 font-bold bg-red-50/50 p-2 rounded-xl">
            <span>Saved:</span>
            <span>-{formatAmount(totals.discountAmount)} ({discountPercent}%)</span>
          </div>
        )}

        {totals.deliveryCharge > 0 && (
          <div className="flex justify-between items-center text-sm text-blue-700 font-bold bg-blue-50/50 p-2 rounded-xl">
            <span>Delivery:</span>
            <span>{formatAmount(totals.deliveryCharge)}</span>
          </div>
        )}

        {totals.loyaltyDiscount > 0 && (
          <div className="flex justify-between items-center text-sm text-purple-700 font-bold bg-purple-50/50 p-2 rounded-xl">
            <span>Points ({charges.loyaltyPoints}):</span>
            <span>-{formatAmount(totals.loyaltyDiscount)}</span>
          </div>
        )}

        <div className="flex justify-between items-end font-black text-2xl text-gray-900 border-t border-gray-200 pt-4 pb-1">
          <span className="text-base text-gray-500 uppercase tracking-widest mb-1">Total Due</span>
          <span className="text-emerald-600">{formatAmount(totals.grandTotal)}</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mt-5">
        <button
          type="button"
          onClick={onHold}
          disabled={!items.length}
          className="col-span-1 bg-amber-400 text-amber-950 rounded-xl py-3 font-bold hover:bg-amber-300 disabled:opacity-40 transition flex items-center justify-center gap-1.5"
        >
          <Pause className="w-4 h-4" /> Hold
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
          className="col-span-3 bg-emerald-500 text-white rounded-xl py-3 font-bold hover:bg-emerald-600 disabled:opacity-40 transition flex items-center justify-center gap-2"
        >
          <Printer className="w-5 h-5" /> Checkout & Print
        </button>
      </div>
    </div>
  );
}
