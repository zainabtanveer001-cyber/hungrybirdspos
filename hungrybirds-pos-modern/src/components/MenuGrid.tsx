import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import type { Category, MenuItem } from '../lib/db/types';

const ALL = 'ALL';

interface MenuGridProps {
  onPick: (item: MenuItem) => void;
}

export function MenuGrid({ onPick }: MenuGridProps) {
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
      <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu items..."
            className="w-full pl-10 pr-4 py-2.5 text-sm border-0 ring-1 ring-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50/50 focus:bg-white transition-all shadow-inner"
          />
        </div>
      </div>

      <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100">
        <h3 className="text-xs font-black uppercase tracking-widest text-gray-800 mb-3">Menu Categories</h3>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none" role="tablist" aria-label="Menu categories">
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

      <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100">
        {grouped.length === 0 ? (
          <p className="text-center text-gray-400 py-6">
            {search.trim()
              ? `No items match "${search.trim()}".`
              : 'No dishes available. Add some in Owner Admin.'}
          </p>
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
              <section key={group.category.id}>
                <h4 className="text-sm font-bold uppercase tracking-wide text-gray-600 mb-2">
                  {group.category.name}{' '}
                  <span className="text-xs font-normal text-gray-400">({group.items.length})</span>
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onPick(item)}
                      title={`Add ${item.name} to the order`}
                      className="menu-item-card w-full text-left rounded-2xl shadow-sm border overflow-hidden transition-all focus-visible:ring-2 focus-visible:ring-blue-300"
                    >
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          loading="lazy"
                          className="w-full h-24 object-cover border-b border-gray-200"
                        />
                      ) : (
                        <div className="h-24 bg-gray-100 flex items-center justify-center text-xs font-bold uppercase tracking-widest text-gray-400">
                          Menu
                        </div>
                      )}
                      <div className="p-3">
                        <h3 className="font-semibold text-sm text-gray-800 leading-snug line-clamp-2 min-h-10">
                          {item.name}
                        </h3>
                        <p className="text-blue-700 font-bold text-sm mt-2">{formatAmount(item.price)}</p>
                      </div>
                    </button>
                  ))}
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
      className={`px-4 py-2 rounded-lg whitespace-nowrap font-semibold border transition-all duration-200 flex items-center ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200'
      }`}
    >
      {label}
      {count > 0 && (
        <span className="ml-1 text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full font-mono">{count}</span>
      )}
    </button>
  );
}
