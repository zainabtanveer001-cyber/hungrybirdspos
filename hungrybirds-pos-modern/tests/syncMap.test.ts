import { describe, expect, it } from 'vitest';
import {
  cloudOrderToLocal, cloudSaleToLocal, decodeFields, documentId, encodeFields,
  localOrderPatch,
} from '../src/lib/syncMap';

describe('firestore value codec', () => {
  it('round-trips nested maps, arrays, timestamps, ints and doubles', () => {
    const source = {
      name: 'Chicken Karrahi',
      price: 2100,
      ratio: 0.15,
      available: true,
      couponCode: null,
      items: [{ id: 'MENU_1', qty: 2, note: 'no onion' }],
      createdAt: '2026-10-18T16:40:57.934Z',
      customer: { name: 'Ali', phone: '0300' },
    };

    const decoded = decodeFields(encodeFields(source));

    expect(decoded).toEqual(source);
    expect(Number.isInteger(decoded.price)).toBe(true);
  });

  it('drops undefined but keeps explicit null', () => {
    const fields = encodeFields({ a: 1, b: undefined, c: null });
    expect(Object.keys(fields)).toEqual(['a', 'c']);
    expect(fields.c).toEqual({ nullValue: null });
  });

  it('reads the document id off a full resource name', () => {
    expect(documentId('projects/p/databases/(default)/documents/menu/MENU_1')).toBe('MENU_1');
  });
});

describe('online order mapping', () => {
  const cloud = {
    status: 'OUT_FOR_DELIVERY',
    orderType: 'DELIVERY',
    total: 4200,
    saleId: 17,
    createdAt: '2026-09-18T23:17:49.568Z',
    out_for_deliveryAt: '2026-09-18T23:20:00.000Z',
    rejectionReason: 'Kitchen closed',
    customer: { name: 'Ali', phone: '03001234567', address: 'Street 4' },
    items: [{ id: 'MENU_1', menuItemId: 'MENU_1', name: 'Karrahi', price: 2100, qty: 2 }],
  };

  it('maps the website fields onto the local shape', () => {
    const order = cloudOrderToLocal('ORDER_9', cloud);

    expect(order.cloudId).toBe('ORDER_9');
    expect(order.status).toBe('OUT_FOR_DELIVERY');
    expect(order.orderType).toBe('DELIVERY');
    expect(order.total).toBe(4200);
    expect(order.saleId).toBe(17);
    expect(order.customer).toEqual({ name: 'Ali', phone: '03001234567', address: 'Street 4' });
    expect(order.items[0]).toMatchObject({ menuItemId: 'MENU_1', qty: 2, price: 2100 });
    // Cloud name differs from the local name for dispatch and rejection.
    expect(order.dispatchedAt).toBe('2026-09-18T23:20:00.000Z');
    expect(order.rejectReason).toBe('Kitchen closed');
  });

  it('defaults an unknown order type instead of losing the order', () => {
    expect(cloudOrderToLocal('X', { orderType: 'WHATEVER' }).orderType).toBe('DELIVERY');
  });

  it('patches only lifecycle fields, under their cloud names', () => {
    const order = cloudOrderToLocal('ORDER_9', {
      ...cloud,
      status: 'REJECTED',
      rejectedAt: '2026-09-18T23:21:00.000Z',
    });
    const patch = localOrderPatch(order);

    expect(patch).toEqual({
      status: 'REJECTED',
      rejectedAt: '2026-09-18T23:21:00.000Z',
      rejectionReason: 'Kitchen closed',
      saleId: 17,
    });
    // The POS must never rewrite owned-by-website fields such as items or customer.
    expect(patch).not.toHaveProperty('items');
    expect(patch).not.toHaveProperty('customer');
  });

  it('maps a cloud sale to a local sale with no local id', () => {
    const sale = cloudSaleToLocal('SALE_1', {
      localId: 12,
      total: 500,
      createdAt: '2026-09-02T12:24:39.118Z',
      items: [],
    });
    expect(sale.cloudId).toBe('SALE_1');
    expect(sale.localId).toBe(12);
    expect(sale.id).toBeUndefined();
    expect(sale.timestamp).toBe('2026-09-02T12:24:39.118Z');
  });
});
