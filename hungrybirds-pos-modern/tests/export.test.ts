import { describe, expect, it } from 'vitest';
import { sanitizeCsvCell } from '../src/lib/export';
import { parseLocalDateBoundary } from '../src/lib/analytics';
import { composeModifiedItem } from '../src/lib/cart';
import type { MenuItem } from '../src/lib/db/types';

describe('sanitizeCsvCell (AUD-001 CSV formula injection)', () => {
  it('prefixes formula-triggering strings with a single quote', () => {
    expect(sanitizeCsvCell('=CMD|\'/C calc\'!A0')).toBe('\'=CMD|\'/C calc\'!A0');
    expect(sanitizeCsvCell('+SUM(A1:A2)')).toBe('\'+SUM(A1:A2)');
    expect(sanitizeCsvCell('-2+3+cmd')).toBe('\'-2+3+cmd');
    expect(sanitizeCsvCell('@SUM(1+1)')).toBe('\'@SUM(1+1)');
    expect(sanitizeCsvCell('\t=1+1')).toBe('\'\t=1+1');
    expect(sanitizeCsvCell('\r=1+1')).toBe('\'\r=1+1');
  });

  it('leaves plain numbers and normal text untouched', () => {
    expect(sanitizeCsvCell(1405)).toBe('1405');
    expect(sanitizeCsvCell('-145.50')).toBe('-145.50');
    expect(sanitizeCsvCell('1300.00')).toBe('1300.00');
    expect(sanitizeCsvCell('Zinger Burger x2')).toBe('Zinger Burger x2');
  });
});

describe('parseLocalDateBoundary (BUG-008 local date range)', () => {
  it('parses YYYY-MM-DD at local start-of-day and end-of-day without UTC day shift', () => {
    const start = new Date(parseLocalDateBoundary('2026-11-21', false));
    const end = new Date(parseLocalDateBoundary('2026-11-21', true));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(10); // November (0-indexed)
    expect(start.getDate()).toBe(21);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);

    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(10);
    expect(end.getDate()).toBe(21);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });
});

describe('modified item recipe resolution (BUG-006)', () => {
  it('preserves canonical menuItemId when modifiers change line.id', () => {
    const burger: MenuItem = {
      id: 'MENU_1',
      name: 'Zinger Burger',
      price: 650,
      categoryId: 'cat_burgers',
    };
    const line = composeModifiedItem(burger, [{ group: 'Add-ons', name: 'Extra Cheese', price: 80 }]);
    expect(line.id).toBe('MENU_1::Add-ons:Extra Cheese');
    expect(line.menuItemId).toBe('MENU_1');
    expect(line.menuItemId || line.id).toBe('MENU_1');
  });
});
