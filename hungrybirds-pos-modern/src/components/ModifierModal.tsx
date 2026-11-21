import { useState } from 'react';
import { Modal } from './Modal';
import { composeModifiedItem } from '../lib/cart';
import { formatAmount } from '../lib/format';
import type { CartItem, MenuItem, ModifierGroup, ModifierSelection } from '../lib/db/types';

function buildInitialPicked(
  groups: ModifierGroup[],
  initialSelections: ModifierSelection[] = [],
): Record<string, number[]> {
  const map: Record<string, number[]> = {};
  for (const group of groups) {
    const indices: number[] = [];
    group.options.forEach((opt, index) => {
      const matched = initialSelections.some(
        (sel) => sel.group === group.name && sel.name === opt.name,
      );
      if (matched) indices.push(index);
    });
    if (indices.length) map[group.id] = indices;
  }
  return map;
}

export function ModifierModal({
  item,
  groups,
  mode = 'add',
  initialSelections = [],
  initialNote = '',
  currentQty = 1,
  onCancel,
  onConfirm,
  notify,
}: {
  item: MenuItem;
  groups: ModifierGroup[];
  mode?: 'add' | 'edit';
  initialSelections?: ModifierSelection[];
  initialNote?: string;
  currentQty?: number;
  onCancel: () => void;
  onConfirm: (cartItem: CartItem, splitOne: boolean) => void;
  notify: (message: string) => void;
}) {
  const [picked, setPicked] = useState<Record<string, number[]>>(() =>
    buildInitialPicked(groups, initialSelections),
  );
  const [note, setNote] = useState(initialNote);
  const [splitOne, setSplitOne] = useState(false);

  function toggle(groupId: string, index: number, multiple: boolean) {
    setPicked((current) => {
      const existing = current[groupId] ?? [];
      const next = multiple
        ? existing.includes(index)
          ? existing.filter((i) => i !== index)
          : [...existing, index]
        : existing.includes(index)
          ? []
          : [index];
      return { ...current, [groupId]: next };
    });
  }

  const selections: ModifierSelection[] = groups.flatMap((group) =>
    (picked[group.id] ?? []).map((index) => {
      const option = group.options[index];
      const sel: ModifierSelection = {
        group: group.name,
        name: option.name,
        price: Number(option.price) || 0,
      };
      if (option.inventoryId && Number(option.qtyRequired) > 0) {
        sel.inventoryId = option.inventoryId;
        sel.qtyRequired = Number(option.qtyRequired);
      }
      return sel;
    }),
  );

  const composed = composeModifiedItem(item, selections, note);
  const showSplitToggle = mode === 'edit' && currentQty > 1;

  function confirm() {
    const missing = groups.find((g) => g.required && !(picked[g.id] ?? []).length);
    if (missing) {
      notify(`Please select an option for "${missing.name}".`);
      return;
    }
    onConfirm(composed, showSplitToggle && splitOne);
  }

  return (
    <Modal
      title={mode === 'edit' ? `Extras & Note: ${item.name}` : `Customize: ${item.name}`}
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
            onClick={confirm}
            className="flex-[2] h-11 rounded-[8px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition text-sm tabular-nums"
          >
            {mode === 'edit'
              ? `Save — ${formatAmount(composed.price)}`
              : `Add — ${formatAmount(composed.price)}`}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {showSplitToggle && (
          <div className="p-3 rounded-xl bg-[#eff6ff] border border-[#e0edff] space-y-2">
            <p className="text-xs font-semibold text-[#273238]">
              This cart line has {currentQty} units. How should extras apply?
            </p>
            <div role="group" aria-label="Modifier quantity scope" className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                aria-pressed={!splitOne}
                onClick={() => setSplitOne(false)}
                className={`min-h-9 px-2.5 rounded-[8px] text-xs font-semibold border transition ${
                  !splitOne
                    ? 'bg-[#2941e0] text-white border-[#2941e0]'
                    : 'bg-white text-[#273238] border-[#788991] hover:bg-[#eff6ff]'
                }`}
              >
                Apply to all {currentQty}
              </button>
              <button
                type="button"
                aria-pressed={splitOne}
                onClick={() => setSplitOne(true)}
                className={`min-h-9 px-2.5 rounded-[8px] text-xs font-semibold border transition ${
                  splitOne
                    ? 'bg-[#2941e0] text-white border-[#2941e0]'
                    : 'bg-white text-[#273238] border-[#788991] hover:bg-[#eff6ff]'
                }`}
              >
                Customize 1 only
              </button>
            </div>
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-xs text-[#526066] bg-[#f8fafd] border border-[#e0edff] rounded-xl p-3 leading-relaxed">
            No modifier groups configured yet. The Owner can add reusable Extras (Extra Olives, Cheese Slice, Extra Cheese, Extra Jalapenos) in{' '}
            <strong className="text-[#273238]">Admin Settings → Modifiers &amp; Extras Library</strong>. You can still add a kitchen note below.
          </p>
        ) : (
          groups.map((group) => (
            <fieldset key={group.id} className="space-y-2">
              <legend className="text-xs font-semibold text-[#273238] mb-1.5 flex items-center gap-1.5">
                <span>{group.name}</span>
                {group.required && (
                  <span className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-[88px]">
                    Required
                  </span>
                )}
                {group.multiple !== false && (
                  <span className="text-[11px] font-normal text-[#526066]">(pick any)</span>
                )}
              </legend>
              {group.options.map((option, index) => {
                const checked = (picked[group.id] ?? []).includes(index);
                return (
                  <label
                    key={`${group.id}-${option.name}-${index}`}
                    className={`flex items-center justify-between gap-2 px-3 min-h-10 border rounded-[10px] text-sm cursor-pointer transition ${
                      checked
                        ? 'border-[#2941e0] bg-[#eff6ff] text-[#000000]'
                        : 'border-[#e0edff] bg-[#f8fafd] text-[#273238] hover:bg-white'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <input
                        type={group.multiple !== false ? 'checkbox' : 'radio'}
                        name={`modgroup_${group.id}`}
                        checked={checked}
                        onChange={() => toggle(group.id, index, group.multiple !== false)}
                        className="accent-[#2941e0] w-4 h-4"
                      />
                      <span>{option.name}</span>
                    </span>
                    <span className={`font-semibold tabular-nums text-xs ${option.price >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                      {option.price > 0 ? `+${formatAmount(option.price)}` : option.price < 0 ? formatAmount(option.price) : 'Free'}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ))
        )}

        <div>
          <label htmlFor="modifierKitchenNote" className="block text-xs font-semibold text-[#273238] mb-1.5">
            Kitchen Note (optional — printed on KDS &amp; KOT)
          </label>
          <input
            id="modifierKitchenNote"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. No onions, less spicy, cut in half"
            className="w-full px-3 h-10 text-sm border border-[#788991] rounded-[10px] bg-white text-[#000000] placeholder:text-[#616f75] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0]"
          />
        </div>
      </div>
    </Modal>
  );
}
