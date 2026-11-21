import { normalizeCharge } from './format';
import type { PaymentDetail, PaymentMethod } from './db/types';

const STANDARD_PKR_BILLS = [500, 1000, 2000, 5000] as const;
const SPLIT_METHOD_ORDER: PaymentMethod[] = ['Cash', 'Card', 'Online'];

function roundMoney(value: number): number {
  return Math.round(normalizeCharge(value) * 100) / 100;
}

export interface SplitPaymentDraft {
  Cash: number;
  Card: number;
  Online: number;
  cashGiven: number;
}

export interface SplitTenderSummary {
  cash: number;
  card: number;
  online: number;
  allocated: number;
  remainingToAllocate: number;
  overAllocated: number;
  cashGiven: number;
  cashShort: number;
  change: number;
  valid: boolean;
  payments: PaymentDetail[];
}

/**
 * Evaluates a split-tender draft across Cash, Card, and Online against `total`,
 * computing remaining/over-allocated amounts, cash change, and final `PaymentDetail[]`.
 */
export function computeSplitTenderSummary(
  total: number,
  draft: SplitPaymentDraft,
): SplitTenderSummary {
  const cleanTotal = roundMoney(total);
  const cash = roundMoney(draft.Cash);
  const card = roundMoney(draft.Card);
  const online = roundMoney(draft.Online);
  const cashGiven = roundMoney(draft.cashGiven);

  const allocated = roundMoney(cash + card + online);
  const remainingToAllocate = roundMoney(Math.max(0, cleanTotal - allocated));
  const overAllocated = roundMoney(Math.max(0, allocated - cleanTotal));

  const cashShort = cash > 0 ? roundMoney(Math.max(0, cash - cashGiven)) : 0;
  const change = cash > 0 ? roundMoney(Math.max(0, cashGiven - cash)) : 0;

  const valid =
    cleanTotal > 0 &&
    remainingToAllocate === 0 &&
    overAllocated === 0 &&
    cashShort === 0 &&
    (cash > 0 || card > 0 || online > 0);

  const amountsByMethod: Record<PaymentMethod, number> = {
    Cash: cash,
    Card: card,
    Online: online,
  };

  const payments: PaymentDetail[] = [];
  for (const m of SPLIT_METHOD_ORDER) {
    const amount = amountsByMethod[m];
    if (amount <= 0) continue;
    if (m === 'Cash') {
      payments.push({ method: m, amount, cashGiven, change });
    } else {
      payments.push({ method: m, amount });
    }
  }

  return {
    cash,
    card,
    online,
    allocated,
    remainingToAllocate,
    overAllocated,
    cashGiven,
    cashShort,
    change,
    valid,
    payments,
  };
}

/** Fills `method` with whatever portion of `total` is not yet covered by the other two methods. */
export function fillRemainingForMethod(
  total: number,
  draft: SplitPaymentDraft,
  method: PaymentMethod,
): SplitPaymentDraft {
  const cleanTotal = roundMoney(total);
  const otherTotal = SPLIT_METHOD_ORDER.reduce(
    (sum, m) => (m === method ? sum : roundMoney(sum + roundMoney(draft[m]))),
    0,
  );
  const rest = roundMoney(Math.max(0, cleanTotal - otherTotal));
  return {
    ...draft,
    [method]: rest,
    cashGiven: method === 'Cash' ? rest : draft.cashGiven,
  };
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
