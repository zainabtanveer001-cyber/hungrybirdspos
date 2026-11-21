import { useState } from 'react';
import { AlertTriangle, Boxes, Lock, Plus, Minus } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { adjustStock, getLowStockThreshold } from '../lib/inventory';
import { buildShiftReport } from '../lib/shift';
import { formatAmount, normalizeCharge } from '../lib/format';
import { OwnerPinModal } from './OwnerPinModal';
import type { InventoryItem } from '../lib/db/types';

/**
 * Mirrors the old "Live Stock" card: hidden behind the owner PIN until unlocked.
 * ponytail: unlock lives in component state, so a page reload re-locks — that is
 * safer than persisting it, and matches "authenticate to view".
 */
export function LiveStockPanel({ canManage, username, onManage }: {
  canManage: boolean;
  username: string;
  onManage: () => void;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const items = useLive(() => db.inventory.toArray(), []);
  const threshold = useLive(() => getLowStockThreshold(), []) ?? 5;
  const shift = useLive(() => buildShiftReport(), []);

  const lowStock = (items ?? []).filter((i) => Number(i.stock) <= threshold);

  async function bump(item: InventoryItem, delta: number) {
    await adjustStock(item, delta, username);
  }

  return (
    <>
      <section className="bg-white p-4 rounded-2xl border border-[#e0edff]">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-display text-sm font-medium text-[#273238] flex items-center gap-1.5">
            <Boxes className="w-4 h-4 text-[#2941e0]" aria-hidden /> Live Stock
          </h3>
          <div className="flex items-center gap-1.5">
            {unlocked && (
              <button
                type="button"
                onClick={() => setUnlocked(false)}
                className="text-xs bg-red-50 text-red-700 px-3 min-h-9 rounded-[8px] font-semibold border border-red-200 hover:bg-red-100 transition"
              >
                Lock
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={onManage}
                className="text-xs text-[#2941e0] bg-[#eff6ff] hover:bg-[#e0edff] px-3 min-h-9 rounded-[8px] font-semibold transition"
              >
                Manage
              </button>
            )}
          </div>
        </div>

        {!unlocked ? (
          <div className="text-center py-6 border border-[#e0edff] rounded-2xl bg-[#eff6ff]/40 space-y-2.5">
            <Lock className="w-6 h-6 mx-auto text-[#526066]" aria-hidden />
            <p className="text-xs font-medium text-[#526066]">Stock Protected</p>
            <button
              type="button"
              onClick={() => setPrompting(true)}
              className="bg-[#2941e0] text-white px-4 h-10 rounded-[8px] text-xs font-semibold hover:bg-[#1f35c4] transition"
            >
              Authenticate to View
            </button>
          </div>
        ) : (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-3 gap-1.5 p-2.5 rounded-xl bg-[#eff6ff]/70 border border-[#e0edff] text-center">
              <div>
                <span className="block text-[11px] font-medium text-[#526066]">Shift Sales</span>
                <strong className="font-bold text-xs text-[#000000] tabular-nums">
                  {formatAmount(shift?.totalSales ?? 0)}
                </strong>
              </div>
              <div>
                <span className="block text-[11px] font-medium text-[#526066]">Live Cost</span>
                <strong className="font-bold text-xs text-red-700 tabular-nums">
                  {formatAmount(shift?.consumedCost ?? 0)}
                </strong>
              </div>
              <div>
                <span className="block text-[11px] font-medium text-[#526066]">Live P&amp;L</span>
                <strong
                  className={`font-bold text-xs tabular-nums ${
                    (shift?.netProfit ?? 0) >= 0 ? 'text-emerald-800' : 'text-red-700'
                  }`}
                >
                  {formatAmount(shift?.netProfit ?? 0)}
                </strong>
              </div>
            </div>

            <div className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
              {!items?.length ? (
                <p className="text-[#616f75] text-center py-3">No raw inventory found.</p>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="p-2.5 bg-[#f8fafd] rounded-[10px] border border-[#e0edff]">
                    <div className="flex justify-between items-center gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#000000] truncate">{item.name}</p>
                        <p className="text-xs text-[#526066] tabular-nums">
                          Cost/unit: Rs {normalizeCharge(item.cost || 0).toFixed(2)} · Unit: {item.unit}
                        </p>
                      </div>
                      <span className={`font-bold text-xs shrink-0 tabular-nums ${Number(item.stock) <= threshold ? 'text-red-700' : 'text-emerald-800'}`}>
                        {Number(item.stock).toFixed(2)} {item.unit}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                      <button
                        type="button"
                        onClick={() => bump(item, 1)}
                        aria-label={`Add 1 ${item.unit} of ${item.name}`}
                        className="bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold px-3 min-h-10 rounded-[8px] hover:bg-emerald-100 flex items-center gap-1 transition"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden />1
                      </button>
                      <button
                        type="button"
                        onClick={() => bump(item, -1)}
                        aria-label={`Subtract 1 ${item.unit} of ${item.name}`}
                        className="bg-red-50 border border-red-300 text-red-700 text-xs font-semibold px-3 min-h-10 rounded-[8px] hover:bg-red-100 flex items-center gap-1 transition"
                      >
                        <Minus className="w-3.5 h-3.5" aria-hidden />1
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {unlocked && lowStock.length > 0 && (
          <p className="mt-2.5 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-[10px] px-2.5 py-2 flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
            <span>
              {lowStock.length} item{lowStock.length === 1 ? '' : 's'} low on stock: {lowStock.slice(0, 3).map((i) => i.name).join(', ')}
              {lowStock.length > 3 ? ` +${lowStock.length - 3} more` : ''}
            </span>
          </p>
        )}
      </section>

      {prompting && (
        <OwnerPinModal
          action="Enter the owner PIN to view live stock levels."
          onClose={() => setPrompting(false)}
          onAuthorized={() => {
            setPrompting(false);
            setUnlocked(true);
          }}
        />
      )}
    </>
  );
}
