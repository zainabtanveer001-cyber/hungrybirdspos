import { normalizeCharge } from './format';

const STANDARD_PKR_BILLS = [500, 1000, 2000, 5000] as const;

function roundMoney(value: number): number {
  return Math.round(normalizeCharge(value) * 100) / 100;
}

/**
 * Returns sorted unique cash tender presets for a PKR total:
 * always starts with the exact amount, followed by standard PKR notes and convenient rounded bills >= total.
 */
export function computeQuickTenderAmounts(total: number): number[] {
  const exact = roundMoney(total);
  if (exact <= 0) return [0];

  const options = new Set<number>([exact]);
  const next500 = Math.ceil(exact / 500) * 500;
  if (next500 > exact) options.add(next500);

  for (const bill of STANDARD_PKR_BILLS) {
    if (bill > exact) options.add(bill);
  }

  if (exact >= 5000) {
    const next1000 = Math.ceil((exact + 1) / 1000) * 1000;
    const next5000 = Math.ceil((exact + 1) / 5000) * 5000;
    options.add(next1000);
    options.add(next5000);
  }

  return Array.from(options)
    .sort((a, b) => a - b)
    .slice(0, 5);
}

/** Computes cash change or remaining shortfall rounded cleanly to 2 decimals. */
export function computeCashBalance(total: number, cashGiven: number): {
  short: boolean;
  change: number;
  remaining: number;
} {
  const due = roundMoney(total);
  const tendered = roundMoney(cashGiven);
  if (tendered < due) {
    return { short: true, change: 0, remaining: roundMoney(due - tendered) };
  }
  return { short: false, change: roundMoney(tendered - due), remaining: 0 };
}
