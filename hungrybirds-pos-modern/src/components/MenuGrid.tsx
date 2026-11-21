import { useMemo, useState } from 'react';
import { Check, Minus, Plus, Search, X } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import type { Category, MenuItem } from '../lib/db/types';

const ALL = 'ALL';

interface MenuGridProps {
  onPick: (item: MenuItem) => void;
  onDecrement?: (item: MenuItem) => void;
  hasAutoModifiers?: (item: MenuItem) => boolean;
  cartQtyByMenuId?: Record<string, number>;
  lastAddedMenuId?: string | null;
}

export function MenuGrid({
  onPick,
  onDecrement,
  hasAutoModifiers,
  cartQtyByMenuId = {},
  lastAddedMenuId = null,
}: MenuGridProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(ALL);

  const categories = useLive(() => db.categories.toArray(), []) ?? [];
  const menu = useLive(() => db.menu.toArray(), []) ?? [];

  const countByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of menu) counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
    return counts;
  }, [menu]);

  const grouped = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = query ? menu.filter((i) => (i.name || '').toLowerCase().includes(query)) : menu;
    const known = new Set(categories.map((c) => c.id));

    const groups = categories
      .filter((c) => query || selectedCategory === ALL || c.id === selectedCategory)
      .map((category) => ({ category, items: matches.filter((i) => i.categoryId === category.id) }))
      .filter((g) => g.items.length > 0);

    const orphans = matches.filter((i) => !i.categoryId || !known.has(i.categoryId));
    if (orphans.length) {
      groups.push({ category: { id: 'UNCATEGORIZED', name: 'Uncategorized' } as Category, items: orphans });
    }
    return groups;
  }, [categories, menu, search, selectedCategory]);

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-[#e0edff]">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#526066]" aria-hidden />
          <input
            id="posMenuSearchInput"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu items... (Press / to focus)"
            aria-label="Search menu items"
            className="w-full pl-10 pr-10 h-10 text-sm text-[#000000] placeholder:text-[#616f75] border border-[#788991] rounded-[10px] bg-white focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear menu search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-[8px] flex items-center justify-center text-[#526066] hover:bg-[#eff6ff] hover:text-[#2941e0] transition-colors"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-[#e0edff]">
        <h3 className="font-display text-xs font-medium uppercase tracking-normal text-[#526066] mb-3">
          Menu Categories
        </h3>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="Menu categories">
          <CategoryButton
            label="All Items"
            count={menu.length}
            active={selectedCategory === ALL}
            onClick={() => setSelectedCategory(ALL)}
          />
          {categories.map((cat) => (
            <CategoryButton
              key={cat.id}
              label={cat.name}
              count={countByCategory[cat.id] || 0}
              active={selectedCategory === cat.id}
              onClick={() => setSelectedCategory(cat.id)}
            />
          ))}
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-[#e0edff]">
        {grouped.length === 0 ? (
          <div className="text-center py-6 space-y-2.5">
            <p className="text-[#616f75] text-sm">
              {search.trim()
                ? `No items match "${search.trim()}".`
                : 'No dishes available. Add some in Admin Settings.'}
            </p>
            {search.trim() && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="px-4 h-9 rounded-[8px] border border-[#788991] bg-white text-xs font-medium text-[#273238] hover:bg-[#eff6ff] hover:text-[#2941e0] transition"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
              <section key={group.category.id}>
                <h4 className="font-display text-base font-medium text-[#273238] mb-2.5 flex items-center gap-2">
                  <span>{group.category.name}</span>
                  <span className="text-xs font-medium text-[#2941e0] bg-[#eff6ff] px-2.5 py-0.5 rounded-[88px] tabular-nums">
                    {group.items.length}
                  </span>
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {group.items.map((item) => {
                    const inCartQty = cartQtyByMenuId[item.id] || 0;
                    const justAdded = lastAddedMenuId === item.id;
                    const hasModifiers = hasAutoModifiers
                      ? hasAutoModifiers(item)
                      : Boolean(item.modifierGroups?.length);
                    return (
                      <article
                        key={item.id}
                        className={`menu-item-card relative w-full text-left rounded-2xl border bg-white overflow-hidden flex flex-col transition-all ${
                          justAdded
                            ? '!border-emerald-700 ring-2 ring-emerald-700/35 animate-cart-pop'
                            : inCartQty > 0
                              ? '!border-[#2941e0] ring-1 ring-[#2941e0]/30'
                              : 'border-[#e0edff]'
                        }`}
                      >
                        {justAdded && (
                          <span
                            role="status"
                            className="pointer-events-none absolute top-2 left-2 z-10 inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[11px] font-bold shadow-sm"
                          >
                            <Check className="w-3 h-3" aria-hidden /> Added
                          </span>
                        )}
                        {inCartQty > 0 && (
                          <span
                            aria-label={`${inCartQty} in cart`}
                            className={`pointer-events-none absolute top-2 right-2 z-10 inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-sm tabular-nums ${
                              justAdded ? 'bg-emerald-700 text-white' : 'bg-[#2941e0] text-white'
                            }`}
                          >
                            ×{inCartQty} in cart
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => onPick(item)}
                          title={hasModifiers ? `Customize & add ${item.name}` : `Add ${item.name} to the order`}
                          className="w-full text-left flex-1 flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2941e0]"
                        >
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt=""
                              loading="lazy"
                              className="w-full h-24 object-cover border-b border-[#e0edff]"
                            />
                          ) : (
                            <div className="w-full h-24 bg-[#eff6ff] flex items-center justify-center text-xs font-medium text-[#526066]">
                              Menu
                            </div>
                          )}
                          <div className="p-3 pb-1.5 flex-1">
                            <h3 className="font-sans font-medium text-sm text-[#000000] leading-snug line-clamp-2 min-h-10">
                              {item.name}
                            </h3>
                          </div>
                        </button>

                        <div className="px-3 pb-3 pt-1 space-y-2">
                          {inCartQty > 0 ? (
                            <>
                              <p className="text-[#2941e0] font-semibold text-sm tabular-nums">
                                {formatAmount(item.price)}
                              </p>
                              <div
                                role="group"
                                aria-label={`Quantity in cart for ${item.name}`}
                                className="flex items-center justify-between gap-1 bg-[#eff6ff] border border-[#e0edff] rounded-[10px] p-1"
                              >
                                <button
                                  type="button"
                                  onClick={() => onDecrement?.(item)}
                                  aria-label={`Decrease ${item.name}`}
                                  className="w-9 h-9 rounded-[8px] bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-colors shrink-0"
                                >
                                  <Minus className="w-4 h-4" aria-hidden />
                                </button>
                                <span className="font-display font-bold text-sm text-[#000000] tabular-nums text-center min-w-6">
                                  {inCartQty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onPick(item)}
                                  aria-label={
                                    hasModifiers
                                      ? `Customize and add another ${item.name}`
                                      : `Increase ${item.name}`
                                  }
                                  className="w-9 h-9 rounded-[8px] bg-emerald-700 hover:bg-emerald-800 text-white flex items-center justify-center transition-colors shrink-0"
                                >
                                  <Plus className="w-4 h-4" aria-hidden />
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[#2941e0] font-semibold text-sm tabular-nums">
                                {formatAmount(item.price)}
                              </p>
                              <button
                                type="button"
                                onClick={() => onPick(item)}
                                aria-label={`Add ${item.name} to cart`}
                                className="inline-flex items-center gap-0.5 px-2.5 min-h-8 rounded-[8px] text-xs font-semibold bg-[#eff6ff] hover:bg-[#2941e0] text-[#2941e0] hover:text-white transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" aria-hidden /> Add
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryButton({ label, count, active, onClick }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-4 h-10 rounded-[8px] text-sm whitespace-nowrap font-medium border transition-all duration-150 flex items-center gap-1.5 ${
        active
          ? 'bg-[#2941e0] text-white border-[#2941e0]'
          : 'bg-white text-[#273238] border-[#788991] hover:bg-[#eff6ff] hover:text-[#2941e0] hover:border-[#2941e0]'
      }`}
    >
      <span>{label}</span>
      {count > 0 && (
        <span
          className={`text-xs px-2 py-0.5 rounded-[88px] font-mono tabular-nums ${
            active ? 'bg-white/20 text-white' : 'bg-[#eff6ff] text-[#2941e0]'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
