import { useEffect, useId, useState } from 'react';
import { UserRound, X } from 'lucide-react';
import { getCustomer, normalizePhone } from '../lib/customers';
import { formatAmount } from '../lib/format';
import type { Customer, CustomerInfo, OrderType } from '../lib/db/types';

export function CustomerPanel({
  orderType,
  customer,
  loyaltyBalance,
  loyaltyPoints,
  onChange,
  onRedeem,
}: {
  orderType: OrderType;
  customer: CustomerInfo;
  loyaltyBalance: number;
  loyaltyPoints: number;
  onChange: (customer: CustomerInfo) => void;
  onRedeem: (points: number) => void;
}) {
  const [lookup, setLookup] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState(false);
  const idPrefix = useId();
  const phoneId = `${idPrefix}-phone`;
  const nameId = `${idPrefix}-name`;
  const addressId = `${idPrefix}-address`;
  const redeemId = `${idPrefix}-redeem`;

  const phone = customer.phone ?? '';

  useEffect(() => {
    let active = true;
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setLookup(null);
      setNewCustomer(false);
      return;
    }
    getCustomer(normalized).then((found) => {
      if (!active) return;
      setLookup(found ?? null);
      setNewCustomer(!found);
      if (found && !customer.name) onChange({ ...customer, name: found.name });
    });
    return () => {
      active = false;
    };
    // Only re-look up when the phone changes; name edits must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const isDelivery = orderType === 'DELIVERY';
  const valid = !!normalizePhone(phone);
  const hasAnyValue = Boolean(phone || customer.name || customer.address || loyaltyPoints > 0);
  const inputCls =
    'w-full px-3 h-10 border border-[#788991] rounded-[10px] bg-white text-sm text-[#000000] placeholder:text-[#616f75] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] transition';

  return (
    <div className="mb-3 p-3.5 rounded-2xl border border-[#e0edff] bg-[#eff6ff]/70 space-y-2.5 text-sm">
      <div className="flex justify-between items-center gap-2 border-b border-[#e0edff] pb-2">
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[#273238]">
          <UserRound className="w-3.5 h-3.5 text-[#2941e0] shrink-0" aria-hidden />
          <span>{isDelivery ? 'Delivery Info' : 'Customer / Loyalty'}</span>
          {isDelivery && (
            <span className="text-[11px] bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-semibold">
              Min Rs 500
            </span>
          )}
        </span>
        {hasAnyValue && (
          <button
            type="button"
            onClick={() => {
              onChange({});
              onRedeem(0);
            }}
            className="text-xs font-medium text-[#273238] hover:text-red-700 hover:border-red-300 bg-white px-2.5 min-h-9 rounded-[8px] border border-[#788991] flex items-center gap-1 shrink-0 transition-colors"
          >
            <X className="w-3.5 h-3.5" aria-hidden /> Clear
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label htmlFor={phoneId} className="block text-xs font-medium text-[#273238] mb-1">
            Phone Number{isDelivery ? ' *' : ''}
          </label>
          <input
            id={phoneId}
            type="tel"
            value={phone}
            onChange={(e) => onChange({ ...customer, phone: e.target.value })}
            placeholder="0300 1234567"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor={nameId} className="block text-xs font-medium text-[#273238] mb-1">
            Customer Name
          </label>
          <input
            id={nameId}
            type="text"
            value={customer.name ?? ''}
            onChange={(e) => onChange({ ...customer, name: e.target.value })}
            placeholder="Optional"
            className={inputCls}
          />
        </div>
      </div>

      {isDelivery && (
        <div>
          <label htmlFor={addressId} className="block text-xs font-medium text-[#273238] mb-1">
            Delivery Address / Landmark
          </label>
          <input
            id={addressId}
            type="text"
            value={customer.address ?? ''}
            onChange={(e) => onChange({ ...customer, address: e.target.value })}
            placeholder="Street, block, or nearest landmark"
            className={inputCls}
          />
        </div>
      )}

      {valid && lookup && (
        <div className="text-xs font-medium bg-white border border-[#e0edff] text-[#273238] p-2.5 rounded-[10px] tabular-nums">
          Returning customer: <strong>{lookup.totalOrders || 0} orders</strong> · Spent{' '}
          <strong>{formatAmount(lookup.totalSpent || 0)}</strong> ·{' '}
          <strong className="text-[#2941e0]">{lookup.loyaltyPoints || 0} pts</strong>
        </div>
      )}

      {valid && newCustomer && (
        <div className="text-xs font-medium bg-white border border-[#e0edff] text-[#526066] p-2.5 rounded-[10px]">
          New customer — profile will be saved automatically on checkout.
        </div>
      )}

      {valid && loyaltyBalance > 0 && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-300 p-2.5 rounded-[10px]">
          <label htmlFor={redeemId} className="text-xs font-semibold text-amber-900">
            Redeem Points (max {loyaltyBalance}):
          </label>
          <input
            id={redeemId}
            type="number"
            min={0}
            max={loyaltyBalance}
            value={loyaltyPoints || ''}
            placeholder="0"
            onChange={(e) => onRedeem(Math.min(loyaltyBalance, Math.max(0, Number(e.target.value) || 0)))}
            className="w-20 sm:w-24 px-2.5 h-9 border border-amber-400 rounded-[8px] text-sm font-semibold text-right bg-white focus:outline-none focus:ring-2 focus:ring-[#2941e0] text-amber-950 tabular-nums"
          />
        </div>
      )}
    </div>
  );
}
