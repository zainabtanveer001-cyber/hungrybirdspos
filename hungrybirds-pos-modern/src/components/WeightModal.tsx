import { useState } from 'react';
import { Scale } from 'lucide-react';
import { computeWeightedPrice, formatWeightKg, parseWeightInput } from '../lib/cart';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';
import type { MenuItem } from '../lib/db/types';

const QUICK_KG_PRESETS = [0.5, 1, 1.5, 2] as const;

export function WeightModal({
  item,
  mode = 'add',
  initialWeightKg,
  modifierSum = 0,
  onCancel,
  onConfirm,
}: {
  item: MenuItem;
  mode?: 'add' | 'edit';
  initialWeightKg?: number;
  modifierSum?: number;
  onCancel: () => void;
  onConfirm: (weightKg: number) => void;
}) {
  const [unit, setUnit] = useState<'kg' | 'g'>('kg');
  const [rawWeight, setRawWeight] = useState<string>(() =>
    initialWeightKg && initialWeightKg > 0 ? String(Number(initialWeightKg.toFixed(3))) : '',
  );

  const unitRate = Number(item.price) || 0;
  const parsedKg = parseWeightInput(rawWeight, unit);
  const baseTotal = computeWeightedPrice(parsedKg, unitRate, 0);
  const finalTotal = computeWeightedPrice(parsedKg, unitRate, modifierSum);
  const highWeightWarning = unit === 'kg' && parsedKg > 25;

  function switchUnit(nextUnit: 'kg' | 'g') {
    if (nextUnit === unit) return;
    const currentKg = parseWeightInput(rawWeight, unit);
    setUnit(nextUnit);
    if (currentKg > 0) {
      setRawWeight(
        nextUnit === 'g'
          ? String(Math.round(currentKg * 1000))
          : String(Number(currentKg.toFixed(3))),
      );
    }
  }

  function submit() {
    if (parsedKg <= 0) return;
    onConfirm(parsedKg);
  }

  return (
    <Modal
      title={mode === 'edit' ? `Update Weight: ${item.name}` : `Enter Weight: ${item.name}`}
      onClose={onCancel}
      footer={
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-11 rounded-[8px] font-medium border border-[#788991] bg-white text-[#000000] hover:bg-[#eff6ff] transition text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={parsedKg <= 0}
            className="flex-[2] h-11 rounded-[8px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-45 transition text-sm tabular-nums"
          >
            {parsedKg > 0
              ? `${mode === 'edit' ? 'Update' : 'Add'} — ${formatAmount(finalTotal)}`
              : 'Enter weight'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-[#eff6ff] border border-[#e0edff]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-[10px] bg-white border border-[#e0edff] flex items-center justify-center shrink-0">
              <Scale className="w-4 h-4 text-[#2941e0]" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#526066]">Selling rate (locked)</p>
              <p className="font-display text-sm font-bold text-[#2941e0] tabular-nums">
                {formatAmount(unitRate)} / kg
              </p>
            </div>
          </div>

          <div
            role="group"
            aria-label="Weight unit"
            className="grid grid-cols-2 bg-white p-1 rounded-[10px] border border-[#e0edff] text-xs font-semibold shrink-0"
          >
            <button
              type="button"
              onClick={() => switchUnit('kg')}
              aria-pressed={unit === 'kg'}
              className={`px-3 min-h-8 rounded-[8px] transition ${
                unit === 'kg' ? 'bg-[#2941e0] text-white' : 'text-[#273238] hover:bg-[#eff6ff]'
              }`}
            >
              kg
            </button>
            <button
              type="button"
              onClick={() => switchUnit('g')}
              aria-pressed={unit === 'g'}
              className={`px-3 min-h-8 rounded-[8px] transition ${
                unit === 'g' ? 'bg-[#2941e0] text-white' : 'text-[#273238] hover:bg-[#eff6ff]'
              }`}
            >
              g
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="posWeightInput" className="block text-xs font-semibold text-[#273238] mb-1.5">
            Weight ({unit === 'kg' ? 'kilograms — e.g. 2.4 or 2,4' : 'grams — e.g. 2400'})
          </label>
          <div className="flex items-center border border-[#788991] rounded-[12px] bg-white px-3 focus-within:ring-2 focus-within:ring-[#2941e0] focus-within:border-[#2941e0]">
            <input
              id="posWeightInput"
              type="text"
              inputMode="decimal"
              autoFocus
              value={rawWeight}
              onChange={(e) => setRawWeight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={unit === 'kg' ? 'e.g. 2.4' : 'e.g. 2400'}
              className="w-full py-2.5 text-xl font-bold text-[#000000] placeholder:text-[#616f75] bg-transparent border-0 focus:outline-none tabular-nums text-right pr-2"
            />
            <span className="text-sm font-bold text-[#526066] shrink-0">{unit}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#526066]">
            Quick weights
          </span>
          <div className="grid grid-cols-4 gap-2">
            {QUICK_KG_PRESETS.map((preset) => {
              const selected = Math.abs(parsedKg - preset) < 0.0005;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setUnit('kg');
                    setRawWeight(String(preset));
                  }}
                  aria-pressed={selected}
                  className={`min-h-9 rounded-[8px] text-xs font-semibold border transition tabular-nums ${
                    selected
                      ? 'bg-[#2941e0] text-white border-[#2941e0]'
                      : 'bg-white text-[#273238] border-[#788991] hover:bg-[#eff6ff] hover:border-[#2941e0]'
                  }`}
                >
                  {preset} kg
                </button>
              );
            })}
          </div>
        </div>

        {highWeightWarning && (
          <p className="text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-[10px] px-3 py-2">
            Over 25 kg — switch unit to <strong>g</strong> if you meant grams.
          </p>
        )}

        <div className="p-3 rounded-2xl bg-[#f8fafd] border border-[#e0edff] space-y-1">
          <div className="flex items-center justify-between text-xs text-[#273238] tabular-nums">
            <span>
              {parsedKg > 0 ? `${formatWeightKg(parsedKg)} × ${formatAmount(unitRate)}/kg` : 'Calculated price'}
            </span>
            <span className="font-bold text-[#000000]">
              {parsedKg > 0 ? formatAmount(baseTotal) : '—'}
            </span>
          </div>
          {modifierSum > 0 && parsedKg > 0 && (
            <div className="flex items-center justify-between text-xs text-[#526066] tabular-nums">
              <span>+ Extras (flat per fish)</span>
              <span className="font-semibold text-[#000000]">+{formatAmount(modifierSum)}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
