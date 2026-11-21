import { db } from './db';
import { logAudit } from './audit';
import type { CartItem, MenuItem, ModifierGroup, ModifierOption } from './db/types';

export const MODIFIER_LIBRARY_KEY = 'modifierGroupsLibrary';

export function createStarterExtrasGroup(): ModifierGroup {
  return {
    id: `MOD_${Date.now()}`,
    name: 'Extras',
    required: false,
    multiple: true,
    global: true,
    categoryIds: [],
    promptOnPick: false,
    options: [
      { name: 'Extra Olives', price: 50 },
      { name: 'Cheese Slice', price: 80 },
      { name: 'Extra Cheese', price: 120 },
      { name: 'Extra Jalapenos', price: 50 },
    ],
  };
}

export function sanitizeModifierOptions(options: ModifierOption[]): ModifierOption[] {
  const cleaned: ModifierOption[] = [];
  for (const opt of options || []) {
    const name = String(opt.name || '').trim();
    if (!name) continue;
    const rawPrice = Number(opt.price);
    const price = Number.isFinite(rawPrice) ? rawPrice : 0;
    const clean: ModifierOption = { name, price };
    const invId = typeof opt.inventoryId === 'string' ? opt.inventoryId.trim() : '';
    const qty = Number(opt.qtyRequired);
    if (invId && Number.isFinite(qty) && qty > 0) {
      clean.inventoryId = invId;
      clean.qtyRequired = qty;
    }
    cleaned.push(clean);
  }
  return cleaned;
}

export function sanitizeModifierGroups(groups: ModifierGroup[]): ModifierGroup[] {
  const result: ModifierGroup[] = [];
  for (let i = 0; i < (groups || []).length; i += 1) {
    const group = groups[i];
    const name = String(group.name || '').trim();
    const options = sanitizeModifierOptions(group.options || []);
    if (!name || options.length === 0) continue;
    const categoryIds = Array.isArray(group.categoryIds)
      ? Array.from(new Set(group.categoryIds.filter((c) => typeof c === 'string' && c.trim())))
      : [];
    result.push({
      id: String(group.id || `MOD_${Date.now()}_${i}`),
      name,
      required: Boolean(group.required),
      multiple: group.multiple !== false,
      global: Boolean(group.global),
      categoryIds,
      promptOnPick: Boolean(group.promptOnPick),
      options,
    });
  }
  return result;
}

/** Strictly read-only: safe inside Dexie `liveQuery`. */
export async function getModifierLibrary(): Promise<ModifierGroup[]> {
  const stored = await db.settings.get(MODIFIER_LIBRARY_KEY);
  if (!stored?.value) return [];
  try {
    const parsed = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
    return Array.isArray(parsed) ? sanitizeModifierGroups(parsed as ModifierGroup[]) : [];
  } catch {
    return [];
  }
}

export async function saveModifierLibraryGroup(
  draft: ModifierGroup,
  user: string,
): Promise<ModifierGroup> {
  const name = String(draft.name || '').trim();
  if (!name) throw new Error('Enter a modifier group name (e.g. Extras).');
  const options = sanitizeModifierOptions(draft.options || []);
  if (options.length === 0) throw new Error('Add at least one option (e.g. Extra Cheese).');

  const id = draft.id?.trim() || `MOD_${Date.now()}`;
  const cleanGroup: ModifierGroup = {
    id,
    name,
    required: Boolean(draft.required),
    multiple: draft.multiple !== false,
    global: Boolean(draft.global),
    categoryIds: Array.isArray(draft.categoryIds) ? Array.from(new Set(draft.categoryIds.filter(Boolean))) : [],
    promptOnPick: Boolean(draft.promptOnPick),
    options,
  };

  const current = await getModifierLibrary();
  const exists = current.some((g) => g.id === id);
  const next = exists ? current.map((g) => (g.id === id ? cleanGroup : g)) : [...current, cleanGroup];
  await db.settings.put({ key: MODIFIER_LIBRARY_KEY, value: JSON.stringify(next) });
  await logAudit(
    exists ? 'MODIFIER_GROUP_UPDATED' : 'MODIFIER_GROUP_ADDED',
    `${exists ? 'Updated' : 'Added'} modifier group "${name}" (${options.length} option(s))`,
    user,
  );
  return cleanGroup;
}

export async function deleteModifierLibraryGroup(id: string, user: string): Promise<void> {
  const current = await getModifierLibrary();
  const target = current.find((g) => g.id === id);
  if (!target) return;
  const next = current.filter((g) => g.id !== id);
  await db.settings.put({ key: MODIFIER_LIBRARY_KEY, value: JSON.stringify(next) });
  await logAudit('MODIFIER_GROUP_DELETED', `Deleted modifier group "${target.name}"`, user);
}

/**
 * Resolves all modifier groups applicable to a dish.
 * - `pick`: groups that should open the modifier modal automatically when tapping the dish
 *   (all dish-specific groups + category/global library groups marked `promptOnPick` or `required`).
 * - `edit`: all groups available when clicking "Extras" on a cart item
 *   (dish-specific + category-linked + all `global` library groups).
 */
export function resolveDishModifierGroups(
  item: Pick<MenuItem, 'categoryId' | 'modifierGroups'>,
  library: ModifierGroup[],
  mode: 'pick' | 'edit',
): ModifierGroup[] {
  const out: ModifierGroup[] = [];
  const seen = new Set<string>();

  const pushUnique = (group: ModifierGroup) => {
    if (!group.options?.length) return;
    const key = group.id || group.name;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(group);
  };

  for (const dishGroup of item.modifierGroups ?? []) {
    pushUnique(dishGroup);
  }

  for (const libGroup of library ?? []) {
    const matchesCategory = Boolean(
      item.categoryId && libGroup.categoryIds?.includes(item.categoryId),
    );
    const matchesGlobal = Boolean(libGroup.global);
    if (!matchesCategory && !matchesGlobal) continue;

    if (mode === 'edit') {
      pushUnique(libGroup);
    } else if (libGroup.promptOnPick || libGroup.required) {
      pushUnique(libGroup);
    }
  }

  return out;
}

/**
 * Aggregates raw inventory quantities required by selected modifiers across cart/sale lines.
 * When `excludeRefunded` is true, uses `max(0, qty - refundedQty)` for live COGS accuracy.
 */
export function collectModifierIngredientUsage(
  items: CartItem[],
  excludeRefunded = false,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of items || []) {
    const effectiveQty = excludeRefunded
      ? Math.max(0, (Number(line.qty) || 0) - (Number(line.refundedQty) || 0))
      : Math.max(0, Number(line.qty) || 0);
    if (effectiveQty <= 0) continue;
    for (const mod of line.modifiers || []) {
      if (!mod.inventoryId) continue;
      const perUnit = Number(mod.qtyRequired) || 0;
      if (perUnit <= 0) continue;
      totals.set(mod.inventoryId, (totals.get(mod.inventoryId) || 0) + perUnit * effectiveQty);
    }
  }
  return totals;
}
