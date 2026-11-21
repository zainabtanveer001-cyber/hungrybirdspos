import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { getAnalytics, getPeriodSummary } from '../lib/analytics';
import type { AnalyticsReport, Period } from '../lib/analytics';
import { datedFilename, downloadCsv } from '../lib/export';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

export function SalesAnalyticsModal({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<Period>('week');
  const [category, setCategory] = useState<string>('');
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getPeriodSummary>> | null>(null);
  const categories = useLive(() => db.categories.toArray(), []) ?? [];

  useEffect(() => {
    let active = true;
    const filterId = category || undefined;
    Promise.all([getAnalytics(period, filterId), getPeriodSummary(filterId)]).then(([nextReport, nextSummary]) => {
      if (!active) return;
      setReport(nextReport);
      setSummary(nextSummary);
    });
    return () => {
      active = false;
    };
  }, [period, category]);

  const activeCategoryName = category
    ? categories.find((c) => c.id === category)?.name ??
      report?.categoryBreakdown.find((c) => c.categoryId === category)?.categoryName ??
      category
    : '';

  function exportCategoryCsv() {
    const rows = report?.categoryBreakdown ?? [];
    downloadCsv(
      datedFilename('Category_Sales_Analytics'),
      ['Category', 'Period', 'Net Revenue (Rs)', 'Gross Revenue (Rs)', 'Units Sold', 'Orders', 'Share %'],
      rows.map((row) => [
        row.categoryName,
        PERIODS.find((p) => p.key === period)?.label ?? period,
        row.netRevenue.toFixed(2),
        row.grossRevenue.toFixed(2),
        row.unitsSold,
        row.orderCount,
        `${row.sharePercent}%`,
      ]),
    );
  }

  return (
    <Modal title="Sales Analytics" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat label={activeCategoryName ? `Today · ${activeCategoryName}` : 'Today'} value={summary?.todaySales} note={`${summary?.todayCount ?? 0} orders`} />
          <Stat
            label={activeCategoryName ? `This week · ${activeCategoryName}` : 'This week'}
            value={summary?.weekSales}
            note={`${summary?.weekCount ?? 0} orders · ${formatAmount(summary?.weekDiscounts ?? 0)} off`}
          />
          <Stat
            label={activeCategoryName ? `This month · ${activeCategoryName}` : 'This month'}
            value={summary?.monthSales}
            note={`${summary?.monthCount ?? 0} orders · ${formatAmount(summary?.monthDiscounts ?? 0)} off`}
          />
          <Stat
            label={activeCategoryName ? `All time · ${activeCategoryName}` : 'All time'}
            value={summary?.totalOverallSales}
            note={`${summary?.totalCount ?? 0} orders · ${formatAmount(summary?.totalDiscounts ?? 0)} off`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              aria-pressed={period === key}
              className={`text-xs font-semibold px-3 min-h-9 rounded-[8px] border transition ${
                period === key
                  ? 'bg-[#2941e0] text-white border-[#2941e0]'
                  : 'bg-white text-[#273238] border-[#788991] hover:bg-[#eff6ff]'
              }`}
            >
              {label}
            </button>
          ))}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by category"
            className="text-xs font-semibold px-3 min-h-9 rounded-[8px] border border-[#788991] bg-white text-[#273238] focus:border-[#2941e0] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {category && (
            <button
              type="button"
              onClick={() => setCategory('')}
              className="text-xs font-semibold px-2.5 min-h-9 rounded-[8px] bg-[#eff6ff] text-[#2941e0] border border-[#e0edff] hover:bg-[#e0edff] flex items-center gap-1 transition"
            >
              <span>{activeCategoryName}</span>
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </div>

        <section className="p-3.5 bg-white rounded-2xl border border-[#e0edff]">
          <p className="text-xs font-semibold text-[#526066] mb-1">
            {report?.caption ?? 'Loading…'}
            {activeCategoryName ? ` · ${activeCategoryName}` : ''}
          </p>
          {report && report.orderCount > 0 ? (
            <TrendChart buckets={report.buckets} period={period} />
          ) : (
            <div className="min-h-[180px] flex items-center justify-center text-xs text-[#616f75]">
              No sales recorded for this {activeCategoryName ? `${activeCategoryName} filter` : 'period'}
            </div>
          )}
        </section>

        <section className="p-3.5 bg-white rounded-2xl border border-[#e0edff] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#273238]">
                Sales by Food Category
              </h4>
              <p className="text-[11px] text-[#526066]">
                Net item sales after discounts &amp; refunds · click a category to filter charts and rankings
              </p>
            </div>
            {(report?.categoryBreakdown?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={exportCategoryCsv}
                className="px-3 min-h-8 text-xs font-semibold rounded-[8px] bg-white text-[#273238] border border-[#788991] hover:bg-[#eff6ff] hover:border-[#2941e0] flex items-center gap-1.5 transition"
              >
                <Download className="w-3.5 h-3.5" aria-hidden /> Category CSV
              </button>
            )}
          </div>

          {!report?.categoryBreakdown?.length ? (
            <p className="py-4 text-center text-xs text-[#616f75]">No category sales data in this period.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {report.categoryBreakdown.map((row) => {
                const isSelected = category === row.categoryId;
                return (
                  <button
                    key={row.categoryId}
                    type="button"
                    onClick={() => setCategory((prev) => (prev === row.categoryId ? '' : row.categoryId))}
                    aria-pressed={isSelected}
                    className={`text-left p-3 rounded-xl border transition space-y-1.5 ${
                      isSelected
                        ? 'bg-[#eff6ff] border-[#2941e0] ring-1 ring-[#2941e0]'
                        : 'bg-[#f8fafd] border-[#e0edff] hover:border-[#2941e0]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-[#000000] truncate">{row.categoryName}</span>
                      <span className="font-display font-bold text-xs text-[#2941e0] tabular-nums shrink-0">
                        {formatAmount(row.netRevenue)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white border border-[#e0edff] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#2941e0]"
                        style={{ width: `${row.netRevenue > 0 ? Math.max(4, row.sharePercent) : 0}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#526066] tabular-nums">
                      <span>{row.unitsSold} sold · {row.orderCount} {row.orderCount === 1 ? 'order' : 'orders'}</span>
                      <span className="font-semibold text-[#273238]">{row.sharePercent}% share</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Rankings
            title={activeCategoryName ? `Top items · ${activeCategoryName}` : 'Top items'}
            rows={report?.topItems ?? []}
            empty="No item sales in this period"
            metric={(row) => `${row.metric} sold`}
            detail={(row) => formatAmount(row.detail)}
          />
          <Rankings
            title={activeCategoryName ? `Top customers · ${activeCategoryName}` : 'Top customers'}
            rows={report?.topCustomers ?? []}
            empty="No identified customer orders in this period"
            metric={(row) => `${row.metric} ${row.metric === 1 ? 'order' : 'orders'}`}
            detail={(row) => formatAmount(row.detail)}
          />
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, note }: { label: string; value?: number; note: string }) {
  return (
    <div className="p-3 rounded-xl bg-[#f8fafd] border border-[#e0edff]">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[#526066] truncate">{label}</p>
      <p className="font-display text-base font-bold text-[#000000] tabular-nums mt-0.5">{formatAmount(value ?? 0)}</p>
      <p className="text-[11px] text-[#526066] tabular-nums">{note}</p>
    </div>
  );
}

function TrendChart({ buckets, period }: { buckets: AnalyticsReport['buckets']; period: Period }) {
  const width = 760;
  const height = 240;
  const pad = { top: 18, right: 18, bottom: 34, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(0, ...buckets.map((b) => b.amount)) || 1;

  const points = buckets.map((bucket, index) => ({
    x: pad.left + (buckets.length === 1 ? plotW / 2 : (index * plotW) / (buckets.length - 1)),
    y: pad.top + plotH - (bucket.amount / max) * plotH,
    bucket,
  }));
  const line = points.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `${pad.left},${pad.top + plotH} ${line} ${pad.left + plotW},${pad.top + plotH}`;
  const step = period === 'month' ? 5 : period === 'day' ? 3 : 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Sales trend chart">
      <title>{`Sales trend, total ${formatAmount(buckets.reduce((sum, b) => sum + b.amount, 0))}`}</title>
      {[0, 1, 2, 3].map((index) => {
        const y = pad.top + (index * plotH) / 3;
        const value = max * (1 - index / 3);
        return (
          <g key={index}>
            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#cbd5e1" strokeDasharray="3 5" />
            <text x={pad.left - 8} y={y + 4} fill="#526066" textAnchor="end" fontSize={10}>
              {value >= 1000 ? `Rs ${(value / 1000).toFixed(1)}k` : `Rs ${Math.round(value)}`}
            </text>
          </g>
        );
      })}
      <polygon points={area} fill="#2941e0" opacity={0.12} />
      <polyline points={line} fill="none" stroke="#2941e0" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {points.map(({ x, y, bucket }, index) => (
        <g key={bucket.start}>
          <circle cx={x} cy={y} r={3.5} fill="#2941e0">
            <title>{`${bucket.label}: ${formatAmount(bucket.amount)}`}</title>
          </circle>
          {(index % step === 0 || index === points.length - 1) && (
            <text x={x} y={height - 8} fill="#526066" textAnchor="middle" fontSize={10}>
              {bucket.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function Rankings({ title, rows, empty, metric, detail }: {
  title: string;
  rows: AnalyticsReport['topItems'];
  empty: string;
  metric: (row: AnalyticsReport['topItems'][number]) => string;
  detail: (row: AnalyticsReport['topItems'][number]) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.metric));
  return (
    <section className="p-3.5 bg-white rounded-2xl border border-[#e0edff]">
      <h4 className="text-xs font-bold uppercase tracking-wider text-[#273238] mb-2.5">{title}</h4>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-[#616f75]">{empty}</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row, index) => (
            <div key={row.name}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-4 text-xs font-semibold text-[#526066] tabular-nums">{index + 1}.</span>
                  <span className="truncate text-xs font-semibold text-[#000000]" title={row.name}>{row.name}</span>
                </span>
                <span className="shrink-0 text-xs font-bold text-[#2941e0] tabular-nums">{metric(row)}</span>
              </div>
              <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-[#e0edff]">
                <div className="h-full rounded-full bg-[#2941e0]" style={{ width: `${Math.max(6, (row.metric / max) * 100)}%` }} />
              </div>
              <p className="ml-6 mt-0.5 text-[11px] text-[#526066] tabular-nums">{detail(row)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
