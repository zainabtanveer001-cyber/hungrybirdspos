const { calculateCartTotals, normalizeCharge, formatAmount } = require('./test-utils');

describe('Cart Calculations', () => {
  describe('calculateCartTotals', () => {
    test('returns zero totals for empty cart', () => {
      const result = calculateCartTotals([]);
      expect(result.subtotal).toBe(0);
      expect(result.grandTotal).toBe(0);
    });

    test('calculates subtotal correctly for single item', () => {
      const cart = [{ price: 100, qty: 2 }];
      const result = calculateCartTotals(cart);
      expect(result.subtotal).toBe(200);
    });

    test('calculates subtotal correctly for multiple items', () => {
      const cart = [
        { price: 100, qty: 2 },
        { price: 50.5, qty: 3 },
        { price: 25.25, qty: 1 },
      ];
      const result = calculateCartTotals(cart);
      expect(result.subtotal).toBe(376.75);
    });

    test('applies percentage discount correctly', () => {
      const cart = [{ price: 100, qty: 1 }];
      const result = calculateCartTotals(cart, 10);
      expect(result.discountAmount).toBe(10);
      expect(result.grandTotal).toBe(90);
    });

    test('applies delivery charge for DELIVERY order type', () => {
      const cart = [{ price: 100, qty: 1 }];
      const result = calculateCartTotals(cart, 0, 25, 'DELIVERY');
      expect(result.deliveryCharge).toBe(25);
      expect(result.grandTotal).toBe(125);
    });

    test('does not apply delivery charge for DINE_IN', () => {
      const cart = [{ price: 100, qty: 1 }];
      const result = calculateCartTotals(cart, 0, 25, 'DINE_IN');
      expect(result.deliveryCharge).toBe(0);
      expect(result.grandTotal).toBe(100);
    });

    test('applies tax on the correct taxable amount', () => {
      const cart = [{ price: 100, qty: 1 }];
      const result = calculateCartTotals(cart, 0, 0, 'DINE_IN', 5, 0, 10);
      // subtotal=100, packing=5, taxable=105, tax=10.5, total=115.5
      expect(result.packingCharge).toBe(5);
      expect(result.taxAmount).toBe(10.5);
      expect(result.grandTotal).toBe(115.5);
    });

    test('applies loyalty discount up to subtotal', () => {
      const cart = [{ price: 100, qty: 1 }];
      const result = calculateCartTotals(cart, 0, 0, 'DINE_IN', 0, 0, 0, 50);
      // 50 points * Rs 1/point = 50 discount
      expect(result.loyaltyDiscount).toBe(50);
      expect(result.grandTotal).toBe(50);
    });

    test('caps loyalty discount at subtotal minus percentage discount', () => {
      const cart = [{ price: 100, qty: 1 }];
      const result = calculateCartTotals(cart, 20, 0, 'DINE_IN', 0, 0, 0, 100);
      // subtotal=100, discount=20, max loyalty = 100 - 20 = 80
      // loyalty points = 100 * 1 = 100, capped at 80
      expect(result.loyaltyDiscount).toBe(80);
      expect(result.grandTotal).toBe(0);
    });

    test('grand total never goes below zero even with excessive discounts', () => {
      const cart = [{ price: 10, qty: 1 }];
      // 100% discount + max loyalty points would try to make total negative
      const result = calculateCartTotals(cart, 100, 0, 'DINE_IN', 0, 0, 0, 100);
      expect(result.grandTotal).toBe(0);
    });

    test('handles string price values', () => {
      const cart = [{ price: '100', qty: '2' }];
      const result = calculateCartTotals(cart);
      expect(result.subtotal).toBe(200);
    });
  });

  describe('normalizeCharge', () => {
    test('returns 0 for non-numeric input', () => {
      expect(normalizeCharge('abc')).toBe(0);
    });

    test('returns 0 for negative values', () => {
      expect(normalizeCharge(-10)).toBe(0);
    });

    test('returns 0 for NaN', () => {
      expect(normalizeCharge(NaN)).toBe(0);
    });

    test('returns 0 for Infinity', () => {
      expect(normalizeCharge(Infinity)).toBe(0);
    });

    test('clamps to maximum', () => {
      expect(normalizeCharge(150, 100)).toBe(100);
    });

    test('returns valid numeric input', () => {
      expect(normalizeCharge(42.5)).toBe(42.5);
    });

    test('converts string numbers', () => {
      expect(normalizeCharge('42.5')).toBe(42.5);
    });
  });

  describe('formatAmount', () => {
    test('formats number as PKR currency', () => {
      const formatted = formatAmount(1000);
      expect(formatted).toContain('Rs');
      expect(formatted).toContain('1,000');
    });

    test('handles zero', () => {
      expect(formatAmount(0)).toContain('Rs');
    });

    test('handles null gracefully (Intl formats as zero)', () => {
      const formatted = formatAmount(null);
      expect(formatted).toContain('Rs');
      // Intl.NumberFormat('en-PK').format(null) => "Rs 0"
      expect(formatted).toMatch(/Rs\s*0/);
    });

    test('handles undefined without crashing', () => {
      // Intl.NumberFormat can't throw for undefined — it just produces "Rs NaN"
      const formatted = formatAmount(undefined);
      expect(formatted).toContain('Rs');
      // The function should not throw even for undefined
    });
  });
});
