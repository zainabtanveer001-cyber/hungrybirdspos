import { describe, expect, it } from 'vitest';
import { formatAmount } from '../src/lib/format';

// Intl separates "Rs" from the number with a non-breaking space.
const plain = (s: string) => s.replace(/\u00a0/g, ' ');

describe('formatAmount (BUG-001)', () => {
  it('prints whole rupees without decimals on every ICU build', () => {
    expect(plain(formatAmount(1300))).toBe('Rs 1,300');
    expect(plain(formatAmount(0))).toBe('Rs 0');
  });

  it('prints fractional amounts with exactly two decimals', () => {
    expect(plain(formatAmount(12.5))).toBe('Rs 12.50');
    expect(plain(formatAmount(1170.456))).toBe('Rs 1,170.46');
  });

  it('treats junk as zero', () => {
    expect(plain(formatAmount(Number.NaN))).toBe('Rs 0');
  });
});
