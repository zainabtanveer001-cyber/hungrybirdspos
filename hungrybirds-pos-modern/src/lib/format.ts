const currencyFormatter = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  maximumFractionDigits: 2,
});

export function formatAmount(amount: number): string {
  return currencyFormatter.format(Number(amount) || 0);
}

/** Currency for money that is written back to the database, so paid amounts stay whole rupees. */
export function roundAmount(amount: number): number {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

/** Clamps a user-entered charge to a non-negative number. */
export function normalizeCharge(value: number | string, maximum = Infinity): number {
  const amount = parseFloat(String(value));
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.min(amount, maximum);
}
