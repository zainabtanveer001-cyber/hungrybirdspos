import { useState } from 'react';
import { Modal } from './Modal';
import { composeModifiedItem } from '../lib/cart';
import { formatAmount } from '../lib/format';
import type { CartItem, MenuItem, ModifierSelection } from '../lib/db/types';

export function ModifierModal({ item, onCancel, onAdd, notify }: {
  item: MenuItem;
  onCancel: () => void;
  onAdd: (cartItem: CartItem) => void;
  notify: (message: string) => void;
}) {
  const groups = item.modifierGroups ?? [];
  const [picked, setPicked] = useState<Record<string, number[]>>({});

  function toggle(groupId: string, index: number, multiple: boolean) {
    setPicked((current) => {
      const existing = current[groupId] ?? [];
      const next = multiple
        ? existing.includes(index)
          ? existing.filter((i) => i !== index)
          : [...existing, index]
        : [index];
      return { ...current, [groupId]: next };
    });
  }

  const selections: ModifierSelection[] = groups.flatMap((group) =>
    (picked[group.id] ?? []).map((index) => {
      const option = group.options[index];
      return { group: group.name, name: option.name, price: Number(option.price) || 0 };
    }),
  );

  const total = composeModifiedItem(item, selections).price;

  function confirm() {
    const missing = groups.find((g) => g.required && !(picked[g.id] ?? []).length);
    if (missing) {
      notify(`Please select an option for "${missing.name}".`);
      return;
    }

    onAdd(composeModifiedItem(item, selections));
  }

  return (
    <Modal
      title={`Customize: ${item.name}`}
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
            Add — {formatAmount(total)}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {groups.map((group) => (
          <fieldset key={group.id} className="space-y-2">
            <legend className="text-xs font-semibold text-[#273238] mb-1.5">
              {group.name} {group.required && <span className="text-red-700">*</span>}
            </legend>
            {group.options.map((option, index) => {
              const checked = (picked[group.id] ?? []).includes(index);
              return (
                <label
                  key={option.name}
                  className={`flex items-center justify-between gap-2 px-3 min-h-10 border rounded-[10px] text-sm cursor-pointer transition ${
                    checked
                      ? 'border-[#2941e0] bg-[#eff6ff] text-[#000000]'
                      : 'border-[#e0edff] bg-[#f8fafd] text-[#273238] hover:bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type={group.multiple ? 'checkbox' : 'radio'}
                      name={`modgroup_${group.id}`}
                      checked={checked}
                      onChange={() => toggle(group.id, index, !!group.multiple)}
                      className="accent-[#2941e0] w-4 h-4"
                    />
                    <span>{option.name}</span>
                  </span>
                  <span className={`font-semibold tabular-nums text-xs ${option.price >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                    {option.price >= 0 ? '+' : ''}
                    {formatAmount(option.price)}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}
