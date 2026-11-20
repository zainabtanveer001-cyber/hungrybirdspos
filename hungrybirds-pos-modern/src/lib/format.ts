const currencyFormatter = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  // Pin the digits: PKR's default minor digits differ between ICU/CLDR
  // versions (Node 22.14 printed "Rs 1,300.00", newer runtimes "Rs 1,300"),
  // so receipts and screens must not depend on the runtime's ICU build.
  // Whole rupees print bare; fractional amounts always show two decimals.
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  trailingZeroDisplay: 'stripIfInteger',
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
