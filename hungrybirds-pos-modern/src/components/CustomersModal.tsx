import { useMemo, useState } from 'react';
import { ChevronLeft, Search } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';
import type { Customer } from '../lib/db/types';

export function CustomersModal({ onClose }: { onClose: () => void }) {
  const customers = useLive(() => db.customers.toArray(), []) ?? [];
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers
      .filter((c) => !query || c.name.toLowerCase().includes(query) || c.phone.includes(query))
      .sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || ''));
  }, [customers, search]);

  return (
    <Modal title={selected ? 'Customer History' : 'Customer CRM'} onClose={onClose} wide>
      {selected ? (
        <CustomerHistory customer={selected} onBack={() => setSelected(null)} />
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone..."
              aria-label="Search customers"
              className="w-full pl-10 pr-4 py-2.5 text-sm ring-1 ring-gray-200 rounded-2xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-6">
              No customers found. Enter a customer phone during checkout to save them here.
            </p>
          ) : (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto custom-scrollbar pr-1">
              {filtered.map((c) => (
                <button
                  key={c.phone}
                  type="button"
                  onClick={() => setSelected(c)}
                  className="w-full p-3 bg-white rounded-xl border border-gray-200 shadow-sm flex justify-between items-center gap-3 text-left hover:bg-purple-50 transition"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-gray-800 truncate">{c.name || 'Unnamed Customer'}</p>
                    <p className="text-[11px] text-gray-500">
                      {c.phone} • Last visit: {c.lastVisit ? new Date(c.lastVisit).toLocaleDateString() : '—'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-purple-700 text-xs">{formatAmount(c.totalSpent || 0)}</p>
                    <p className="text-[10px] text-gray-500">
                      {c.totalOrders || 0} orders • {c.loyaltyPoints || 0} pts
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function CustomerHistory({ customer, onBack }: { customer: Customer; onBack: () => void }) {
  const sales = useLive(() => db.sales.toArray(), []) ?? [];

  const orders = useMemo(
    () =>
      sales
        .filter((s) => (s.customer?.phone || s.deliveryInfo?.phone) === customer.phone)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [sales, customer.phone],
  );

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-xs text-purple-700 font-bold hover:underline flex items-center gap-1">
        <ChevronLeft className="w-3.5 h-3.5" aria-hidden /> Back to customer list
      </button>

      <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl">
        <p className="font-bold text-sm text-gray-800">{customer.name || 'Unnamed Customer'}</p>
        <p className="text-xs text-gray-600">{customer.phone}</p>
        <div className="flex gap-4 mt-2 text-xs">
          <span>
            <strong className="text-purple-700">{customer.totalOrders || 0}</strong> orders
          </span>
          <span>
            <strong className="text-purple-700">{formatAmount(customer.totalSpent || 0)}</strong> spent
          </span>
          <span>
            <strong className="text-purple-700">{customer.loyaltyPoints || 0}</strong> points
          </span>
        </div>
      </div>

      <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider pt-2 border-t border-gray-100">
        Past Orders
      </h4>
      {orders.length === 0 ? (
        <p className="text-gray-400 text-xs text-center py-4">No past orders found for this customer.</p>
      ) : (
        <ul className="space-y-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
          {orders.map((sale) => (
            <li key={sale.id} className="p-2 bg-white rounded-lg border border-gray-200 flex justify-between items-center text-xs">
              <div>
                <p className="font-bold text-gray-800">Order #{sale.id}</p>
                <p className="text-[10px] text-gray-500">{new Date(sale.timestamp).toLocaleString()}</p>
              </div>
              <p className="font-bold text-emerald-700">{formatAmount(sale.total || 0)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
