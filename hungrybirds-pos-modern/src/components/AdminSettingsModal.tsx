import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImagePlus, Pencil, Plus, Search, Trash2, Upload, X, Cloud } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import { compressImageFile, deleteCategory, deleteMenuItem, saveCategory, saveMenuItem, usedInSales } from '../lib/menu';
import type { RecipeDraft } from '../lib/menu';
import { collectBackup, importBackup } from '../lib/backup';
import { downloadJson } from '../lib/export';
import { Modal } from './Modal';
import { CloudSetupModal } from './CloudSetupModal';
import { StaffAccountsSection } from './StaffAccountsSection';
import { LoyaltyRewardsSection } from './LoyaltyRewardsSection';
import { readSession } from '../lib/auth';
import { hasOwnerPin, isValidPin, setOwnerPin } from '../lib/ownerPin';
import { logAudit } from '../lib/audit';
import type { Category, MenuItem, Recipe } from '../lib/db/types';

const INPUT = 'p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner min-w-0';
const PRIMARY = 'bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl';
const DANGER = 'bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1.5 rounded-lg';

interface Draft {
  name: string;
  price: string;
  categoryId: string;
  imageUrl: string;
}

const BLANK: Draft = { name: '', price: '', categoryId: '', imageUrl: '' };

export function AdminSettingsModal({ username, notify, onClose }: {
  username: string;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const categories = useLive(() => db.categories.toArray(), []) ?? [];
  const menu = useLive(() => db.menu.toArray(), []) ?? [];
  const recipes = useLive(() => db.recipes.toArray(), []) ?? [];

  const [newCategory, setNewCategory] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recipeRows, setRecipeRows] = useState<RecipeDraft[]>([]);
  const [importReport, setImportReport] = useState<string[] | null>(null);
  const [showCloudSetup, setShowCloudSetup] = useState(false);
  const [compressingImage, setCompressingImage] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  async function handleDishImageFile(file: File | undefined) {
    if (!file) return;
    setCompressingImage(true);
    try {
      const compressed = await compressImageFile(file);
      setDraft((d) => ({ ...d, imageUrl: compressed }));
      const approxKb = Math.max(1, Math.round((compressed.length * 0.75) / 1024));
      notify(`Photo compressed (~${approxKb} KB) and ready for "${draft.name.trim() || 'dish'}".`);
    } catch (err) {
      notify((err as Error).message || 'Could not process that image.');
    } finally {
      setCompressingImage(false);
      if (imageInput.current) imageInput.current.value = '';
    }
  }

  const categoryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return menu
      .filter((i) => !query || i.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [menu, search]);

  const recipesByItem = useMemo(() => {
    const map = new Map<string, Recipe[]>();
    for (const r of recipes) map.set(r.menuItemId, [...(map.get(r.menuItemId) || []), r]);
    return map;
  }, [recipes]);

  function resetForm() {
    setDraft(BLANK);
    setEditingId(null);
    setRecipeRows([]);
  }

  function startEdit(item: MenuItem) {
    setEditingId(item.id);
    setDraft({
      name: item.name,
      price: String(item.price ?? ''),
      categoryId: item.categoryId || categories[0]?.id || '',
      imageUrl: item.imageUrl || '',
    });
    setRecipeRows((recipesByItem.get(item.id) || []).map((r) => ({ inventoryId: r.inventoryId, qtyRequired: String(r.qtyRequired) })));
  }

  async function addCategory() {
    try {
      await saveCategory(newCategory, username);
      setNewCategory('');
      notify('Category added.');
    } catch (err) {
      notify((err as Error).message);
    }
  }

  async function removeCategory(category: Category) {
    const affected = menu.filter((i) => i.categoryId === category.id).length;
    const warning = affected ? ` ${affected} item(s) will move to Uncategorized.` : '';
    if (!window.confirm(`Delete category "${category.name}"?${warning}`)) return;
    await deleteCategory(category.id, username);
    if (draft.categoryId === category.id) setDraft((d) => ({ ...d, categoryId: '' }));
    notify(`Category "${category.name}" deleted.`);
  }

  async function submit() {
    try {
      await saveMenuItem(draft, recipeRows, username, editingId ?? undefined);
      notify(editingId ? `${draft.name.trim()} updated.` : `${draft.name.trim()} added to the menu.`);
      resetForm();
    } catch (err) {
      notify((err as Error).message);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const summary = await importBackup(await file.text(), username);
      const counts = Object.entries(summary.counts).map(([table, count]) => `${table}: ${count}`);
      const notes = summary.staff
        .filter((member) => !/password kept/.test(member.note))
        .map((member) => `${member.username} (${member.role}) — ${member.note}`);
      setImportReport([
        `Imported ${counts.join(', ') || 'nothing — the file had no rows'}.`,
        ...(summary.skipped.length ? [`Ignored unknown table(s): ${summary.skipped.join(', ')}.`] : []),
        ...(notes.length ? ['Staff accounts that need attention:', ...notes] : []),
      ]);
      notify(`Backup imported from ${file.name}.`);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(item: MenuItem) {
    const sales = await usedInSales(item.id);
    const warning = sales ? `\n\nIt appears in ${sales} recorded sale(s).` : '';
    if (!window.confirm(`Delete "${item.name}" and its recipe?${warning}`)) return;
    try {
      await deleteMenuItem(item.id, username, true);
      if (editingId === item.id) resetForm();
      notify(`${item.name} deleted.`);
    } catch (err) {
      notify((err as Error).message);
    }
  }

  return (
    <>
      <Modal title="Admin Settings" onClose={onClose} wide>
        <div className="space-y-4">
        <section className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-2">
          <SectionTitle>Cloud Setup & Data</SectionTitle>
          <p className="text-[11px] text-gray-600 leading-relaxed">
            Configure your Firebase project to enable multi-device sync and website orders.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowCloudSetup(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl flex items-center gap-1.5"
            >
              <Cloud className="w-3.5 h-3.5" aria-hidden /> Cloud Setup
            </button>
            <div className="h-8 w-px bg-indigo-200 mx-1" />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden /> Import backup
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => importFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={async () => {
                downloadJson(`HungryBirds_Modern_Backup_${new Date().toISOString().slice(0, 10)}.json`, await collectBackup());
                notify('Full backup downloaded.');
              }}
              className="bg-white text-gray-700 text-xs font-bold px-3 py-2.5 rounded-xl ring-1 ring-gray-200 hover:bg-gray-50 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" aria-hidden /> Backup this app
            </button>
          </div>
          {importReport && (
            <ul className="bg-white rounded-xl border border-indigo-100 p-2.5 text-[11px] text-gray-700 space-y-1">
              {importReport.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </section>

        <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
          <SectionTitle>Food categories</SectionTitle>
          <div className="flex gap-2">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCategory()}
              placeholder="New category name"
              aria-label="New category name"
              className={`${INPUT} flex-1`}
            />
            <button type="button" onClick={addCategory} className={`${PRIMARY} flex items-center gap-1`}>
              <Plus className="w-3.5 h-3.5" aria-hidden /> Add
            </button>
          </div>
          {categories.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-1">No categories yet — add one before creating dishes.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {categories.map((category) => (
                <span key={category.id} className="inline-flex items-center gap-1 bg-purple-100 text-purple-900 px-2 py-1 rounded-full text-[11px] font-bold">
                  {category.name}
                  <button
                    type="button"
                    onClick={() => removeCategory(category)}
                    aria-label={`Delete category ${category.name}`}
                    className="text-red-600 hover:text-red-800"
                  >
                    <X className="w-3 h-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
          <div className="flex items-center justify-between">
            <SectionTitle>{editingId ? `Editing "${draft.name}"` : 'Add a menu item'}</SectionTitle>
            {editingId && (
              <button type="button" onClick={resetForm} className="text-[10px] font-bold text-gray-500 hover:text-purple-700">
                Cancel edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Dish name"
              aria-label="Dish name"
              className={INPUT}
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              placeholder="Price (Rs)"
              aria-label="Dish price"
              className={`${INPUT} font-bold text-purple-800`}
            />
            <select
              value={draft.categoryId}
              onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
              aria-label="Dish category"
              className={INPUT}
            >
              <option value="">Select category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => imageInput.current?.click()}
              disabled={compressingImage}
              className="bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 text-xs font-bold px-3 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              <ImagePlus className="w-3.5 h-3.5" aria-hidden />
              {compressingImage ? 'Compressing…' : draft.imageUrl ? 'Change Photo' : 'Upload Photo'}
            </button>
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Upload dish photo from device"
              onChange={(e) => void handleDishImageFile(e.target.files?.[0])}
            />
            <input
              type="url"
              value={draft.imageUrl.startsWith('data:image/') ? '' : draft.imageUrl}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
              placeholder={
                draft.imageUrl.startsWith('data:image/')
                  ? 'Compressed local photo attached (paste a web URL to replace)'
                  : 'Or paste an image URL (optional)'
              }
              aria-label="Dish image URL"
              className={`${INPUT} flex-1`}
            />
          </div>

          {draft.imageUrl && (
            <div className="flex items-center gap-2.5 p-2 rounded-xl bg-purple-50/60 border border-purple-200">
              <img
                src={draft.imageUrl}
                alt="Dish preview"
                className="w-12 h-12 rounded-lg object-cover border border-purple-200 shrink-0 bg-white"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-purple-900 truncate">
                  {draft.imageUrl.startsWith('data:image/')
                    ? `Compressed local photo (~${Math.max(1, Math.round((draft.imageUrl.length * 0.75) / 1024))} KB)`
                    : 'External image URL'}
                </p>
                <p className="text-[10px] text-purple-700 truncate">
                  Shown in place of the Menu card placeholder
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, imageUrl: '' }))}
                className="text-[10px] font-bold text-red-600 hover:bg-red-100 px-2.5 py-1.5 rounded-lg shrink-0"
              >
                Remove photo
              </button>
            </div>
          )}

          <div className="border-t border-gray-100 pt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-700">Ingredient deductions</span>
              <button
                type="button"
                onClick={() => setRecipeRows((rows) => [...rows, { inventoryId: '', qtyRequired: '' }])}
                className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-100"
              >
                + Add ingredient
              </button>
            </div>
            <RecipeRows rows={recipeRows} onChange={setRecipeRows} />
          </div>

          <div className="flex justify-end pt-1">
            <button type="button" onClick={submit} className={PRIMARY}>
              {editingId ? 'Save Changes' : 'Add to Menu'}
            </button>
          </div>
        </section>

        {readSession()?.role === 'OWNER' && <OwnerPinSection username={username} notify={notify} />}

        {readSession()?.role === 'OWNER' && <StaffAccountsSection username={username} notify={notify} />}

        {readSession()?.role === 'OWNER' && (
          <section className="p-3 rounded-xl border border-gray-200 bg-white">
            <LoyaltyRewardsSection username={username} notify={notify} />
          </section>
        )}

        <section className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the menu..."
              aria-label="Search menu"
              className="w-full pl-10 pr-4 py-2.5 text-sm ring-1 ring-gray-200 rounded-2xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-6">
              {menu.length === 0 ? 'No dishes yet. Add the first one above.' : 'No dishes match that search.'}
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
              {filtered.map((item) => {
                const lines = recipesByItem.get(item.id) || [];
                return (
                  <li key={item.id} className="p-2.5 bg-white rounded-xl border border-gray-200 flex items-center gap-2">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-400 text-[9px] font-bold flex items-center justify-center shrink-0">
                        MENU
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-gray-800 truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-500">
                        {formatAmount(item.price)}
                        {' · '}
                        {categoryName.get(item.categoryId) || 'Uncategorized'}
                        {' · '}
                        {lines.length} ingredient{lines.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        aria-label={`Edit ${item.name}`}
                        className="bg-amber-50 hover:bg-amber-100 text-amber-700 px-2 py-1.5 rounded-lg"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(item)}
                        aria-label={`Delete ${item.name}`}
                        className={DANGER}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Modal>
    {showCloudSetup && (
      <CloudSetupModal
        username={username}
        notify={notify}
        onClose={() => setShowCloudSetup(false)}
      />
    )}
    </>
  );
}

function RecipeRows({ rows, onChange }: {
  rows: RecipeDraft[];
  onChange: (rows: RecipeDraft[]) => void;
}) {
  const inventory = useLive(() => db.inventory.toArray(), []) ?? [];

  if (rows.length === 0) {
    return <p className="text-[10px] text-gray-400">No ingredients — this dish will not deduct stock when sold.</p>;
  }

  function update(index: number, patch: Partial<RecipeDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <ul className="space-y-1.5">
      {rows.map((row, index) => (
        <li key={index} className="flex gap-1.5">
          <select
            value={row.inventoryId}
            onChange={(e) => update(index, { inventoryId: e.target.value })}
            aria-label={`Ingredient ${index + 1}`}
            className={`${INPUT} flex-1`}
          >
            <option value="">Select ingredient...</option>
            {inventory.map((item) => (
              <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step="0.01"
            value={row.qtyRequired}
            onChange={(e) => update(index, { qtyRequired: e.target.value })}
            placeholder="Qty"
            aria-label={`Ingredient ${index + 1} quantity`}
            className={`${INPUT} w-24`}
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            aria-label={`Remove ingredient ${index + 1}`}
            className={DANGER}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function OwnerPinSection({ username, notify }: { username: string; notify: (m: string) => void }) {
  const [pin, setPin] = useState('');
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    void hasOwnerPin().then(setConfigured);
  }, []);

  async function savePin() {
    const trimmed = pin.trim();
    if (!isValidPin(trimmed)) {
      notify('Owner PIN must be 4–8 digits.');
      return;
    }
    await setOwnerPin(trimmed);
    await logAudit('OWNER_PIN_UPDATED', 'Owner authorization PIN updated', username);
    setConfigured(true);
    setPin('');
    notify('Owner authorization PIN saved.');
  }

  return (
    <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>Owner authorization PIN</SectionTitle>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {configured ? 'Configured' : 'Not set'}
        </span>
      </div>
      <p className="text-[11px] text-gray-500">
        Required when a Manager voids, refunds, or edits a completed sale, and to unlock Live Stock.
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void savePin()}
          placeholder={configured ? 'New PIN (4–8 digits)' : 'Create PIN (4–8 digits)'}
          aria-label="Owner authorization PIN"
          className={`${INPUT} flex-1`}
        />
        <button type="button" onClick={savePin} className={PRIMARY}>
          {configured ? 'Update PIN' : 'Set PIN'}
        </button>
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-wider text-gray-700">{children}</p>;
}
