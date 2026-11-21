import { useState } from 'react';
import { Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import {
  createStarterExtrasGroup,
  deleteModifierLibraryGroup,
  getModifierLibrary,
  saveModifierLibraryGroup,
} from '../lib/modifiers';
import type { Category, InventoryItem, ModifierGroup, ModifierOption } from '../lib/db/types';

interface OptionDraft {
  name: string;
  price: string;
  inventoryId: string;
  qtyRequired: string;
}

interface GroupDraft {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  global: boolean;
  categoryIds: string[];
  promptOnPick: boolean;
  options: OptionDraft[];
}

const BLANK_OPTION: OptionDraft = { name: '', price: '0', inventoryId: '', qtyRequired: '' };

const BLANK_GROUP = (): GroupDraft => ({
  id: '',
  name: '',
  required: false,
  multiple: true,
  global: true,
  categoryIds: [],
  promptOnPick: false,
  options: [{ ...BLANK_OPTION }],
});

const INPUT =
  'px-2.5 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] placeholder:text-[#616f75] focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] min-w-0';

function toDraft(group: ModifierGroup): GroupDraft {
  return {
    id: group.id,
    name: group.name,
    required: Boolean(group.required),
    multiple: group.multiple !== false,
    global: Boolean(group.global),
    categoryIds: [...(group.categoryIds ?? [])],
    promptOnPick: Boolean(group.promptOnPick),
    options: (group.options?.length ? group.options : [{ name: '', price: 0 }]).map((opt) => ({
      name: opt.name,
      price: String(opt.price ?? 0),
      inventoryId: opt.inventoryId ?? '',
      qtyRequired: opt.qtyRequired != null ? String(opt.qtyRequired) : '',
    })),
  };
}

function fromDraft(draft: GroupDraft, fallbackId?: string): ModifierGroup {
  const options: ModifierOption[] = draft.options
    .map((o) => {
      const parsedPrice = parseFloat(o.price);
      const parsedQty = parseFloat(o.qtyRequired);
      const opt: ModifierOption = {
        name: o.name.trim(),
        price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
      };
      if (o.inventoryId && Number.isFinite(parsedQty) && parsedQty > 0) {
        opt.inventoryId = o.inventoryId;
        opt.qtyRequired = parsedQty;
      }
      return opt;
    })
    .filter((o) => o.name.length > 0);

  return {
    id: draft.id || fallbackId || `MOD_${Date.now()}`,
    name: draft.name.trim(),
    required: draft.required,
    multiple: draft.multiple,
    global: draft.global,
    categoryIds: draft.categoryIds,
    promptOnPick: draft.promptOnPick,
    options,
  };
}

/** Reusable Modifier Groups Library in Admin Settings (e.g. Extras: Olives, Cheese Slice, Extra Cheese, Jalapenos). */
export function ModifierLibrarySection({
  username,
  notify,
}: {
  username: string;
  notify: (message: string) => void;
}) {
  const library = useLive(() => getModifierLibrary(), []) ?? [];
  const categories = useLive(() => db.categories.toArray(), []) ?? [];
  const inventory = useLive(() => db.inventory.toArray(), []) ?? [];

  const [draft, setDraft] = useState<GroupDraft>(BLANK_GROUP);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function loadStarterExtras() {
    const starter = createStarterExtrasGroup();
    setEditingId(null);
    setDraft({ ...toDraft(starter), id: '' });
    notify('Starter Extras loaded — review prices or link inventory, then click Save Group.');
  }

  function startEdit(group: ModifierGroup) {
    setEditingId(group.id);
    setDraft(toDraft(group));
  }

  function reset() {
    setEditingId(null);
    setDraft(BLANK_GROUP());
  }

  function toggleCategory(catId: string) {
    setDraft((d) => ({
      ...d,
      categoryIds: d.categoryIds.includes(catId)
        ? d.categoryIds.filter((id) => id !== catId)
        : [...d.categoryIds, catId],
    }));
  }

  async function save() {
    try {
      const saved = await saveModifierLibraryGroup(fromDraft(draft, editingId ?? undefined), username);
      notify(`Modifier group "${saved.name}" saved.`);
      reset();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save modifier group.');
    }
  }

  async function remove(id: string, name: string) {
    await deleteModifierLibraryGroup(id, username);
    if (editingId === id) reset();
    setConfirmDeleteId(null);
    notify(`Modifier group "${name}" deleted.`);
  }

  const categoryMap = new Map<string, Category>(categories.map((c) => [c.id, c]));

  return (
    <section className="p-3.5 rounded-2xl border border-[#e0edff] bg-white space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#273238]">
            Modifiers &amp; Extras Library
          </p>
          <p className="text-xs text-[#526066] mt-0.5">
            Create reusable add-ons (Extra Olives, Cheese Slice, Extra Cheese, Extra Jalapenos) once and reuse across dishes.
          </p>
        </div>
        <button
          type="button"
          onClick={loadStarterExtras}
          className="text-xs font-semibold text-[#2941e0] bg-[#eff6ff] hover:bg-[#e0edff] border border-[#e0edff] px-3 min-h-9 rounded-[8px] flex items-center gap-1.5 transition shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden /> Load Starter Extras
        </button>
      </div>

      <div className="p-3 rounded-xl border border-[#e0edff] bg-[#f8fafd] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#273238]">
            {editingId ? `Editing "${draft.name || 'group'}"` : 'New modifier group'}
          </span>
          {editingId && (
            <button type="button" onClick={reset} className="text-xs font-medium text-[#526066] hover:text-[#2941e0]">
              Cancel edit
            </button>
          )}
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-[#273238] mb-1">Group Name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Extras, Toppings, Spice Level"
            className={`${INPUT} w-full`}
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#273238]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.multiple}
              onChange={(e) => setDraft({ ...draft, multiple: e.target.checked })}
              className="accent-[#2941e0] w-4 h-4"
            />
            <span>Allow multiple selections (checkboxes)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.required}
              onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
              className="accent-[#2941e0] w-4 h-4"
            />
            <span>Required choice</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.global}
              onChange={(e) => setDraft({ ...draft, global: e.target.checked })}
              className="accent-[#2941e0] w-4 h-4"
            />
            <span>Global (available on all items in Cart Extras)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.promptOnPick}
              onChange={(e) => setDraft({ ...draft, promptOnPick: e.target.checked })}
              className="accent-[#2941e0] w-4 h-4"
            />
            <span>Auto-open popup when tapping matching dish</span>
          </label>
        </div>

        {categories.length > 0 && (
          <div>
            <span className="block text-xs font-medium text-[#273238] mb-1.5">
              Attach to categories (optional)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => {
                const selected = draft.categoryIds.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleCategory(cat.id)}
                    className={`px-2.5 min-h-8 rounded-[88px] text-xs font-medium border transition ${
                      selected
                        ? 'bg-[#2941e0] text-white border-[#2941e0]'
                        : 'bg-white text-[#273238] border-[#788991] hover:bg-[#eff6ff]'
                    }`}
                  >
                    {cat.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <OptionRowsEditor
          options={draft.options}
          inventory={inventory}
          onChange={(options) => setDraft({ ...draft, options })}
        />

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            className="bg-[#2941e0] hover:bg-[#1f35c4] text-white text-xs font-semibold px-4 min-h-9 rounded-[8px] transition"
          >
            {editingId ? 'Save Modifier Group' : 'Add Modifier Group'}
          </button>
        </div>
      </div>

      {library.length === 0 ? (
        <p className="text-xs text-[#616f75] py-1">
          No modifier groups yet — click “Load Starter Extras” above or create your own.
        </p>
      ) : (
        <ul className="space-y-2">
          {library.map((group) => (
            <li
              key={group.id}
              className="p-3 rounded-xl border border-[#e0edff] bg-white space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-[#000000]">{group.name}</span>
                    {group.global && (
                      <span className="text-[11px] font-semibold bg-[#eff6ff] text-[#2941e0] px-2 py-0.5 rounded-[88px]">
                        Global
                      </span>
                    )}
                    {group.promptOnPick && (
                      <span className="text-[11px] font-semibold bg-amber-50 border border-amber-200 text-amber-900 px-2 py-0.5 rounded-[88px]">
                        Auto-popup
                      </span>
                    )}
                    {group.required && (
                      <span className="text-[11px] font-semibold bg-red-50 border border-red-200 text-red-700 px-2 py-0.5 rounded-[88px]">
                        Required
                      </span>
                    )}
                    {(group.categoryIds ?? []).map((cid) => (
                      <span
                        key={cid}
                        className="text-[11px] font-medium bg-[#f8fafd] border border-[#e0edff] text-[#526066] px-2 py-0.5 rounded-[88px]"
                      >
                        {categoryMap.get(cid)?.name ?? cid}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-[#526066] mt-1">
                    {group.options
                      .map((o) => `${o.name}${o.price > 0 ? ` (+${formatAmount(o.price)})` : ''}`)
                      .join(' · ')}
                  </p>
                </div>

                {confirmDeleteId === group.id ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs font-semibold border border-[#788991] bg-white text-[#273238] px-2.5 min-h-8 rounded-[8px]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(group.id, group.name)}
                      className="text-xs font-semibold bg-red-600 hover:bg-red-700 text-white px-2.5 min-h-8 rounded-[8px]"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(group)}
                      aria-label={`Edit ${group.name}`}
                      className="w-8 h-8 rounded-[8px] bg-[#eff6ff] hover:bg-[#e0edff] text-[#2941e0] flex items-center justify-center transition"
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(group.id)}
                      aria-label={`Delete ${group.name}`}
                      className="w-8 h-8 rounded-[8px] bg-red-50 hover:bg-red-100 text-red-700 flex items-center justify-center transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Per-dish modifier groups editor embedded inside AdminSettingsModal's Add/Edit Dish form. */
export function DishModifierEditor({
  groups,
  onChange,
}: {
  groups: ModifierGroup[];
  onChange: (groups: ModifierGroup[]) => void;
}) {
  const inventory = useLive(() => db.inventory.toArray(), []) ?? [];

  function addGroup() {
    onChange([
      ...groups,
      {
        id: `DMOD_${Date.now()}_${groups.length}`,
        name: '',
        required: false,
        multiple: true,
        options: [{ name: '', price: 0 }],
      },
    ]);
  }

  function updateGroup(index: number, patch: Partial<ModifierGroup>) {
    onChange(groups.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function removeGroup(index: number) {
    onChange(groups.filter((_, i) => i !== index));
  }

  return (
    <div className="border-t border-[#e0edff] pt-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-[#273238]">
          Dish-specific modifiers (optional)
        </span>
        <button
          type="button"
          onClick={addGroup}
          className="text-xs font-semibold text-[#2941e0] bg-[#eff6ff] border border-[#e0edff] px-2.5 min-h-8 rounded-[8px] hover:bg-[#e0edff] flex items-center gap-1 transition"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden /> Add group
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="text-xs text-[#616f75]">
          None — Global library extras still apply via Cart “Extras”. Add a group here for dish-only choices (e.g. Size, Spice Level).
        </p>
      ) : (
        <div className="space-y-2.5">
          {groups.map((group, idx) => {
            const optionDrafts: OptionDraft[] = (group.options.length ? group.options : [{ name: '', price: 0 }]).map(
              (o) => ({
                name: o.name,
                price: String(o.price ?? 0),
                inventoryId: o.inventoryId ?? '',
                qtyRequired: o.qtyRequired != null ? String(o.qtyRequired) : '',
              }),
            );
            return (
              <div key={group.id} className="p-2.5 rounded-xl border border-[#e0edff] bg-[#f8fafd] space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={group.name}
                    onChange={(e) => updateGroup(idx, { name: e.target.value })}
                    placeholder="Group name (e.g. Size, Extras)"
                    aria-label={`Dish modifier group ${idx + 1} name`}
                    className={`${INPUT} flex-1`}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-[#273238]">
                    <input
                      type="checkbox"
                      checked={group.multiple !== false}
                      onChange={(e) => updateGroup(idx, { multiple: e.target.checked })}
                      className="accent-[#2941e0] w-4 h-4"
                    />
                    Multi
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[#273238]">
                    <input
                      type="checkbox"
                      checked={Boolean(group.required)}
                      onChange={(e) => updateGroup(idx, { required: e.target.checked })}
                      className="accent-[#2941e0] w-4 h-4"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => removeGroup(idx)}
                    aria-label={`Remove modifier group ${idx + 1}`}
                    className="w-8 h-8 rounded-[8px] bg-red-50 hover:bg-red-100 text-red-700 flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </div>

                <OptionRowsEditor
                  options={optionDrafts}
                  inventory={inventory}
                  onChange={(nextDrafts) =>
                    updateGroup(idx, {
                      options: nextDrafts.map((o) => {
                        const parsedPrice = parseFloat(o.price);
                        const parsedQty = parseFloat(o.qtyRequired);
                        const opt: ModifierOption = {
                          name: o.name,
                          price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
                        };
                        if (o.inventoryId && Number.isFinite(parsedQty) && parsedQty > 0) {
                          opt.inventoryId = o.inventoryId;
                          opt.qtyRequired = parsedQty;
                        }
                        return opt;
                      }),
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OptionRowsEditor({
  options,
  inventory,
  onChange,
}: {
  options: OptionDraft[];
  inventory: InventoryItem[];
  onChange: (next: OptionDraft[]) => void;
}) {
  function setRow(index: number, patch: Partial<OptionDraft>) {
    onChange(options.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#526066]">Options (price &amp; optional inventory link)</span>
        <button
          type="button"
          onClick={() => onChange([...options, { ...BLANK_OPTION }])}
          className="text-xs font-semibold text-[#2941e0] hover:underline"
        >
          + Add option
        </button>
      </div>
      {options.map((row, idx) => (
        <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1.4fr_0.7fr_1.2fr_0.6fr_auto] gap-1.5 items-center">
          <input
            type="text"
            value={row.name}
            onChange={(e) => setRow(idx, { name: e.target.value })}
            placeholder="Option (e.g. Extra Cheese)"
            aria-label={`Option ${idx + 1} name`}
            className={INPUT}
          />
          <input
            type="number"
            step="0.01"
            value={row.price}
            onChange={(e) => setRow(idx, { price: e.target.value })}
            placeholder="Price (Rs)"
            aria-label={`Option ${idx + 1} price`}
            className={`${INPUT} text-right tabular-nums`}
          />
          <select
            value={row.inventoryId}
            onChange={(e) =>
              setRow(idx, {
                inventoryId: e.target.value,
                qtyRequired: e.target.value && !row.qtyRequired ? '1' : row.qtyRequired,
              })
            }
            aria-label={`Option ${idx + 1} inventory ingredient`}
            className={INPUT}
          >
            <option value="">No stock link (price only)</option>
            {inventory.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.name} ({inv.unit})
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step="0.01"
            disabled={!row.inventoryId}
            value={row.inventoryId ? row.qtyRequired : ''}
            onChange={(e) => setRow(idx, { qtyRequired: e.target.value })}
            placeholder="Qty"
            aria-label={`Option ${idx + 1} ingredient qty`}
            className={`${INPUT} text-right tabular-nums disabled:opacity-45`}
          />
          <button
            type="button"
            onClick={() =>
              onChange(options.length === 1 ? [{ ...BLANK_OPTION }] : options.filter((_, i) => i !== idx))
            }
            aria-label={`Remove option ${idx + 1}`}
            className="w-9 h-9 rounded-[8px] bg-white border border-[#788991] text-[#526066] hover:text-red-700 hover:border-red-300 flex items-center justify-center shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
