import { db } from './db';
import { logAudit } from './audit';
import { pushCategory, pushMenu } from './sync';
import { sanitizeModifierGroups } from './modifiers';
import type { Category, MenuItem, ModifierGroup, Recipe } from './db/types';

export const MAX_IMAGE_DIMENSION = 800;
export const IMAGE_JPEG_QUALITY = 0.72;
export const MAX_COMPRESSED_IMAGE_BYTES = 650 * 1024;

/** Scales image dimensions to fit within `maxDimension` while preserving aspect ratio. */
export function scaleImageDimensions(
  width: number,
  height: number,
  maxDimension = MAX_IMAGE_DIMENSION,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  if (w <= maxDimension && h <= maxDimension) return { width: w, height: h };
  const scale = maxDimension / Math.max(w, h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * Reads a local image file, downscales it on an offscreen canvas, and encodes
 * a compressed JPEG data URL that stays under Firestore's per-field size cap.
 */
export function compressImageFile(
  file: File,
  maxDimension = MAX_IMAGE_DIMENSION,
  initialQuality = IMAGE_JPEG_QUALITY,
): Promise<string> {
  if (!file || !file.type.startsWith('image/')) {
    return Promise.reject(new Error('Please choose a valid image file.'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image file.'));
      img.onload = () => {
        const { width, height } = scaleImageDimensions(img.width, img.height, maxDimension);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable for image compression.'));
          return;
        }
        // Fill white background so transparent PNGs do not render black in JPEG.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const qualities = [initialQuality, 0.55, 0.4];
        let dataUrl = canvas.toDataURL('image/jpeg', initialQuality);
        for (const q of qualities) {
          dataUrl = canvas.toDataURL('image/jpeg', q);
          if (dataUrl.length <= MAX_COMPRESSED_IMAGE_BYTES) break;
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export function newCategoryId(): string {
  return `CAT_${Date.now()}`;
}

export function newMenuItemId(): string {
  return `MENU_${Date.now()}`;
}

export async function saveCategory(name: string, user: string): Promise<Category> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a category name.');
  const category = { id: newCategoryId(), name: trimmed };
  await db.categories.put(category);
  await pushCategory(category.id);
  await logAudit('CATEGORY_ADDED', `Category "${trimmed}" added`, user);
  return category;
}

/** Items fall back to "Uncategorized" rather than being deleted with their category. */
export async function deleteCategory(id: string, user: string): Promise<number> {
  const category = await db.categories.get(id);
  if (!category) return 0;
  const affected = await db.menu.where('categoryId').equals(id).count();
  await db.categories.delete(id);
  await pushCategory(id);
  await logAudit('CATEGORY_DELETED', `Category "${category.name}" deleted (${affected} items moved to Uncategorized)`, user);
  return affected;
}

export async function usedInSales(menuItemId: string): Promise<number> {
  const sales = await db.sales.toArray();
  return sales.filter((sale) => (sale.items || []).some((line) => line.menuItemId === menuItemId)).length;
}

export interface MenuItemDraft {
  name: string;
  price: string | number;
  categoryId: string;
  imageUrl?: string;
  description?: string;
  available?: boolean;
  soldByWeight?: boolean;
  modifierGroups?: ModifierGroup[];
}

export interface RecipeDraft {
  inventoryId: string;
  qtyRequired: string | number;
}

/** Writes the item and replaces its recipe rows in one transaction. */
export async function saveMenuItem(
  draft: MenuItemDraft,
  recipeRows: RecipeDraft[],
  user: string,
  existingId?: string,
): Promise<string> {
  const name = draft.name.trim();
  const price = parseFloat(String(draft.price));
  if (!name) throw new Error('Enter a dish name.');
  if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be a positive number.');
  if (!draft.categoryId) throw new Error('Choose a category.');

  const id = existingId || newMenuItemId();
  const cleanRecipes = recipeRows
    .map((row) => ({ inventoryId: row.inventoryId, qtyRequired: parseFloat(String(row.qtyRequired)) }))
    .filter((row) => row.inventoryId && Number.isFinite(row.qtyRequired) && row.qtyRequired > 0);

  await db.transaction('rw', db.menu, db.recipes, async () => {
    const existing = existingId ? await db.menu.get(existingId) : undefined;
    const cleanedGroups =
      draft.modifierGroups !== undefined ? sanitizeModifierGroups(draft.modifierGroups) : undefined;
    const merged: MenuItem = {
      ...(existing ?? {}),
      id,
      name,
      price,
      categoryId: draft.categoryId,
      imageUrl: draft.imageUrl !== undefined ? draft.imageUrl.trim() : (existing?.imageUrl || ''),
      modifierGroups:
        cleanedGroups !== undefined
          ? cleanedGroups.length > 0
            ? cleanedGroups
            : undefined
          : existing?.modifierGroups,
    };
    if (draft.description !== undefined) merged.description = draft.description.trim();
    merged.available = draft.available ?? existing?.available ?? true;
    merged.soldByWeight = draft.soldByWeight ? true : undefined;

    await db.menu.put(merged);
    await db.recipes.where('menuItemId').equals(id).delete();
    if (cleanRecipes.length) {
      await db.recipes.bulkAdd(cleanRecipes.map((row) => ({ ...row, menuItemId: id })) as Recipe[]);
    }
  });

  await pushMenu(id);
  await logAudit(
    existingId ? 'MENU_ITEM_UPDATED' : 'MENU_ITEM_ADDED',
    `${existingId ? 'Updated' : 'Added'} "${name}" at ${price}${draft.soldByWeight ? '/kg' : ''} with ${cleanRecipes.length} recipe line(s)`,
    user,
  );
  return id;
}

export async function deleteMenuItem(id: string, user: string, force = false): Promise<void> {
  const item = await db.menu.get(id);
  if (!item) return;
  if (!force) {
    const sales = await usedInSales(id);
    if (sales > 0) throw new Error(`${item.name} appears in ${sales} sale(s). Deleting it keeps those sales but breaks reporting by item.`);
  }
  await db.transaction('rw', db.menu, db.recipes, async () => {
    await db.recipes.where('menuItemId').equals(id).delete();
    await db.menu.delete(id);
  });
  await pushMenu(id);
  await logAudit('MENU_ITEM_DELETED', `Deleted "${item.name}" and its recipe`, user);
}
