import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CartPanel } from '../src/components/CartPanel';
import type { CartCharges } from '../src/lib/cart';
import type { CartItem, CustomerInfo } from '../src/lib/db/types';

const NOOP = () => {};

const DELIVERY_CHARGES: CartCharges = {
  orderType: 'DELIVERY',
  discountPercent: 0,
  deliveryCharge: 150,
  packingCharge: 0,
  taxPercent: 0,
  otherCharge: 0,
  loyaltyPoints: 0,
};

const WEBSITE_CUSTOMER: CustomerInfo = {
  name: 'Ayesha Khan',
  phone: '03001234567',
  address: 'House 12, Street 4, Model Town, Lahore',
};

const WEBSITE_ITEMS: CartItem[] = [
  { id: 'item-1', menuItemId: 'item-1', name: 'Crispy Zinger Burger', price: 650, qty: 2 },
  { id: 'item-2', menuItemId: 'item-2', name: 'Loaded Fries', price: 450, qty: 1 },
  { id: 'item-3', menuItemId: 'item-3', name: 'Chicken Strips (4 pcs)', price: 520, qty: 1 },
];

describe('CartPanel layout for loaded website delivery orders', () => {
  it('keeps Hold and Checkout & Print pinned in a shrink-0 footer while customer, delivery charge, and items scroll independently', () => {
    const html = renderToStaticMarkup(
      <CartPanel
        items={WEBSITE_ITEMS}
        role="OWNER"
        charges={DELIVERY_CHARGES}
        customer={WEBSITE_CUSTOMER}
        loyaltyBalance={0}
        onChange={NOOP}
        onCustomerChange={NOOP}
        onQtyChange={NOOP}
        onRemove={NOOP}
        onClear={NOOP}
        onCheckout={NOOP}
        onHold={NOOP}
        notify={NOOP}
      />,
    );

    expect(html).toContain('lg:max-h-[calc(100vh-5.75rem)] lg:overflow-hidden');
    expect(html).toContain('flex-1 min-h-0 lg:overflow-y-auto');
    expect(html).toContain('Delivery Info');
    expect(html).toContain('Delivery Charge (Rs)');
    expect(html).toContain('Crispy Zinger Burger');
    expect(html).toContain('Total Due');

    const footerStart = html.indexOf('border-t border-[#d4d4d8] bg-white shrink-0');
    expect(footerStart).toBeGreaterThan(-1);
    const footerHtml = html.slice(footerStart);
    expect(footerHtml).toContain('Hold');
    expect(footerHtml).toContain('Checkout &amp; Print');
    expect(footerHtml).not.toContain('disabled=""');
  });

  it('disables Hold and Checkout & Print when the cart is empty', () => {
    const html = renderToStaticMarkup(
      <CartPanel
        items={[]}
        role="CASHIER"
        charges={DELIVERY_CHARGES}
        customer={{}}
        loyaltyBalance={0}
        onChange={NOOP}
        onCustomerChange={NOOP}
        onQtyChange={NOOP}
        onRemove={NOOP}
        onClear={NOOP}
        onCheckout={NOOP}
        onHold={NOOP}
        notify={NOOP}
      />,
    );

    const disabledMatches = html.match(/disabled=""/g) ?? [];
    expect(disabledMatches.length).toBeGreaterThanOrEqual(2);
  });
});
