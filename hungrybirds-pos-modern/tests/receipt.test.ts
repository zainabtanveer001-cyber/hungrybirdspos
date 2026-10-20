import { describe, expect, it } from 'vitest';
import { receiptDocument, receiptLines, receiptText } from '../src/lib/receipt';
import type { Sale } from '../src/lib/db/types';

const sale: Sale = {
  id: 42,
  timestamp: '2026-10-20T12:00:00.000Z',
  orderType: 'DELIVERY',
  serverUser: 'owner',
  items: [
    { id: 'm1', menuItemId: 'm1', name: 'Zinger Burger', price: 650, qty: 2 },
    { id: 'm2', menuItemId: 'm2', name: 'Cola <500ml>', price: 150, qty: 1, refundedQty: 1 },
  ],
  subtotal: 1450,
  discountPercent: 10,
  discountAmount: 145,
  deliveryCharge: 100,
  packingCharge: 0,
  taxPercent: 0,
  taxAmount: 0,
  otherCharge: 0,
  total: 1405,
  payments: [{ method: 'Cash', amount: 1500, cashGiven: 1500, change: 95 }],
  totalReceived: 1500,
  totalChange: 95,
  deliveryInfo: { name: 'Ayesha', phone: '03001234567', address: 'Model Town' },
};

const settings = { receiptFontSize: 'normal' as const, receiptLogo: true, paperWidth: '80mm' as const };

describe('receipt', () => {
  it('lists items, charges and payments in print order', () => {
    // Intl puts a non-breaking space after "Rs"; compare with plain spaces.
    const lines = receiptLines(sale).map((line) => line.replace(/ /g, ' '));
    expect(lines[0]).toBe('Order #42');
    expect(lines).toContain('Zinger Burger x2  Rs 1,300');
    expect(lines).toContain('  (refunded 1)');
    expect(lines).toContain('Discount 10%: -Rs 145');
    expect(lines).toContain('TOTAL: Rs 1,405');
    expect(lines).toContain('  Change: Rs 95');
  });

  it('shares a WhatsApp-ready message', () => {
    const text = receiptText(sale);
    expect(text.startsWith('*HUNGRY BIRDS RESTAURANT*')).toBe(true);
    expect(text).toContain('Address: Model Town');
  });

  it('escapes item names and sizes the page to the paper', () => {
    const html58 = receiptDocument(sale, { ...settings, paperWidth: '58mm' });
    expect(html58).toContain('Cola &lt;500ml&gt;');
    expect(html58).not.toContain('Cola <500ml>');
    expect(html58).toContain('@page { size: 58mm auto;');
    expect(receiptDocument(sale, settings)).toContain('@page { size: 80mm auto;');
  });
});
