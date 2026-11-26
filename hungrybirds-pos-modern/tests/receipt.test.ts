import { describe, expect, it } from 'vitest';
import {
  buildLogoRaster,
  buildQrRaster,
  buildQrSvg,
  buildTestReceiptDocument,
  formatDate,
  generateEscPosReceipt,
  normalizeQrUrl,
  receiptDocument,
  receiptLines,
  receiptText,
  splitItemDisplay,
  wrapWords,
} from '../src/lib/receipt';
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

const settings = {
  connectionType: 'bluetooth' as const,
  receiptFontSize: 'normal' as const,
  paperWidth: '80mm' as const,
  autoPrint: true,
  printKitchenTicket: true,
  printOrderDetails: true,
  printDeliveryDetails: true,
  printItemPrices: true,
  printTotals: true,
  printPayments: true,
  printFooter: true,
  headerText: 'Hungry Birds Restaurant',
  footerText: '',
  dateFormat: 'locale' as const,
  lanIp: '',
  lanPort: 9100,
  lanProtocol: 'http' as const,
  serialBaudRate: 9600,
};

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
    expect(text.startsWith('*Hungry Birds Restaurant*')).toBe(true);
    expect(text).toContain('Address: Model Town');
  });

  it('escapes item names and sizes the page to the paper', () => {
    const html58 = receiptDocument(sale, { ...settings, paperWidth: '58mm' });
    expect(html58).toContain('Cola &lt;500ml&gt;');
    expect(html58).not.toContain('Cola <500ml>');
    expect(html58).toContain('@page { size: 58mm auto;');
    expect(receiptDocument(sale, settings)).toContain('@page { size: 80mm auto;');
  });

  it('prints the restaurant name as the receipt header', () => {
    const html = receiptDocument(sale, settings);
    expect(html).toContain('<h1>Hungry Birds Restaurant</h1>');
    expect(html).not.toContain('HUNGRY BIRDS RESTAURANT');
  });

  it('prints a kitchen ticket above the customer copy, with a gap to tear on', () => {
    const html = receiptDocument(sale, settings);
    expect(html).toContain('KITCHEN ORDER');
    expect(html.indexOf('KITCHEN ORDER')).toBeLessThan(html.indexOf('ORDER RECEIPT'));
    // The cut line is padded so the two slips do not touch.
    expect(html).toMatch(/\.cut \{[^}]*margin: (?:12mm 0 10mm|20mm 0 15mm)/);
  });

  it('leaves the kitchen ticket off when the shop turns it off', () => {
    const html = receiptDocument(sale, { ...settings, printKitchenTicket: false });
    expect(html).not.toContain('KITCHEN ORDER');
    expect(html).toContain('ORDER RECEIPT');
  });

  it('uses the custom header and footer text', () => {
    const html = receiptDocument(sale, { ...settings, headerText: 'HB Grill', footerText: 'Call again!' });
    expect(html).toContain('<h1>HB Grill</h1>');
    expect(html).toContain('Call again!');
    expect(html).not.toContain('Thank you for dining with us!');
  });

  it('drops the sections the shop turns off', () => {
    const html = receiptDocument(sale, {
      ...settings,
      printOrderDetails: false,
      printDeliveryDetails: false,
      printItemPrices: false,
      printTotals: false,
      printPayments: false,
      printFooter: false,
    });
    expect(html).not.toContain('DELIVERY DETAILS');
    expect(html).not.toContain('GRAND TOTAL');
    expect(html).not.toContain('PAYMENTS');
    expect(html).not.toContain('Server:');
    expect(html).toContain('ITEMS');
    expect(html).toContain('Zinger Burger');
  });

  it('formats the date the way the shop asked', () => {
    // Local time, so the assertion does not depend on the machine's timezone.
    const stamp = new Date(2026, 9, 20, 12, 0, 0);
    expect(formatDate(stamp, 'iso')).toBe('2026-10-20');
    expect(formatDate(stamp, 'dmy')).toBe('20/10/2026');
    expect(formatDate(stamp, 'mdy')).toBe('10/20/2026');
    expect(receiptDocument(sale, { ...settings, dateFormat: 'iso' })).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
  });

  it('discovers writable BLE characteristics across thermal printer services and keeps pairing across disconnects', async () => {
    const { setPrinterDevice, getPrinterDevice, printRaw, disconnectPrinterDevice } = await import('../src/lib/printer');
    const writtenChunks: Uint8Array[] = [];
    const listeners: Record<string, Array<() => void>> = {};

    const mockChar = {
      properties: { write: true, writeWithoutResponse: true },
      writeValueWithResponse: async (buf: BufferSource) => {
        writtenChunks.push(new Uint8Array(buf as ArrayBuffer));
      },
    };

    const mockServer = {
      connected: false,
      connect: async () => {
        mockServer.connected = true;
        return mockServer;
      },
      disconnect: () => {
        mockServer.connected = false;
        for (const fn of listeners['gattserverdisconnected'] || []) fn();
      },
      getPrimaryServices: async () => [
        {
          uuid: '000018f0-0000-1000-8000-00805f9b34fb',
          getCharacteristic: async () => mockChar,
          getCharacteristics: async () => [mockChar],
        },
      ],
      getPrimaryService: async () => ({
        getCharacteristic: async () => mockChar,
      }),
    };

    const mockDevice = {
      id: 'printer-18f0',
      name: 'XP-80C',
      gatt: mockServer,
      addEventListener: (type: string, fn: () => void) => {
        (listeners[type] ||= []).push(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners[type] = (listeners[type] || []).filter((l) => l !== fn);
      },
    };

    await setPrinterDevice(mockDevice);
    await printRaw(new Uint8Array([0x1b, 0x40, 0x48, 0x69, 0x0a]));
    expect(writtenChunks.length).toBe(1);

    // Simulate printer sleeping / disconnecting GATT between prints — device must remain paired!
    mockServer.disconnect();
    expect(getPrinterDevice()?.id).toBe('printer-18f0');

    // Next print automatically reconnects and prints again
    await printRaw(new Uint8Array([0x1b, 0x40, 0x4f, 0x4b, 0x0a]));
    expect(writtenChunks.length).toBe(2);

    // Multi-chunk payloads are strictly capped at 20 bytes to honor universal BLE ATT MTU limits
    const beforeLarge = writtenChunks.length;
    await printRaw(new Uint8Array(55).fill(0x41));
    const largeChunks = writtenChunks.slice(beforeLarge);
    expect(largeChunks.length).toBe(3);
    expect(largeChunks.every((c) => c.byteLength <= 20)).toBe(true);

    await disconnectPrinterDevice();
    expect(getPrinterDevice()).toBeNull();
  });

  it('encodes white-background ESC/POS receipt with cashier, split delivery info, payments, totals, raster QR, and zero non-ASCII text artifacts', () => {
    const richSale: Sale = {
      ...sale,
      items: [
        {
          id: 'm1::Extras:Extra Cheese',
          menuItemId: 'm1',
          name: 'Zinger Burger (Extra Cheese)',
          price: 770,
          qty: 2,
          modifiers: [{ group: 'Extras', name: 'Extra Cheese', price: 120 }],
          note: 'No onions',
        },
        { id: 'm2', menuItemId: 'm2', name: 'Cola <500ml>', price: 150, qty: 1, refundedQty: 1 },
      ],
      loyaltyRedeemPoints: 50,
      loyaltyDiscount: 50,
    };

    const bytes = generateEscPosReceipt(richSale, {
      ...settings,
      showLogo: false,
      printKitchenTicket: false,
      qrUrl: 'https://maps.app.goo.gl/hb12345?g_st=aw',
      qrLabel: 'Scan to leave a review',
    });
    const decoded = new TextDecoder().decode(bytes);

    expect(decoded).toContain('Hungry Birds Restaurant');
    expect(decoded).toContain('DELIVERY ORDER');
    expect(decoded).toContain('Customer Copy');
    expect(decoded).toContain('Dubai park stop, near Dera Gujjran station');
    expect(decoded).toContain('G.T Road Lahore');
    expect(decoded).toContain('Bill #HBR-42');
    expect(decoded).toContain('Cashier: owner');
    expect(decoded).toContain('DELIVERY DETAILS');
    expect(decoded).toContain('Customer: Ayesha');
    expect(decoded).toContain('Phone:    03001234567');
    expect(decoded).toContain('Address:  Model Town');
    expect(decoded).toMatch(/Item\s+Rate\s+Qty\s+Amount/);
    expect(decoded).toMatch(/Zinger Burger\s+770\.00\s+2\s+1,540\.00/);
    // Modifiers appear cleanly once on an indented sub-line (never duplicated)
    expect(decoded).toContain('  + Extra Cheese');
    expect(decoded).not.toContain('(Extra Cheese) (Extra Cheese)');
    expect(decoded).toContain('  * Note: No onions');
    expect(decoded).toContain('Loyalty (50 pts)');
    expect(decoded).toContain('TOTAL AMOUNT');
    expect(decoded).toContain('Rs 1,405.00');
    expect(decoded).toContain('Total Items: 2');
    expect(decoded).toContain('Total Qty: 3');
    expect(decoded).toContain('PAYMENT DETAILS');
    expect(decoded).toContain('Paid (Cash)');
    expect(decoded).toContain('Cash Received');
    expect(decoded).toContain('Change Returned');
    expect(decoded).toContain('*** PAID ***');
    expect(decoded).toContain('ONLINE PAYMENT');
    expect(decoded).toContain('Zeeshan Shafiq');
    expect(decoded).toContain('Jazzcash/Easypaisa');
    expect(decoded).toContain('Scan to leave a review');
    expect(decoded).toContain('For Delivery Contact: 0325-7867774');
    expect(decoded).not.toContain('Order & Support');

    // Pure-text ESC/POS receipt must not contain UTF-8 NBSP (\u00A0),
    // and every line must remain bold (ESC E 1 on, ESC E 0 never emitted)
    const textOnlyCustomerBytes = generateEscPosReceipt(richSale, {
      ...settings,
      showLogo: false,
      printKitchenTicket: false,
      qrUrl: '',
    });
    const textOnlyKotBytes = generateEscPosReceipt(richSale, {
      ...settings,
      showLogo: false,
      printKitchenTicket: true,
      qrUrl: '',
    });
    expect(new TextDecoder().decode(textOnlyKotBytes)).not.toContain('\u00A0');

    // Verify inverted black background command (GS B 1 -> 0x1d 0x42 0x01) is removed,
    // including when KOT is enabled, and QR is emitted as universal GS v 0 raster (not GS ( k)
    const withKotBytes = generateEscPosReceipt(richSale, {
      ...settings,
      showLogo: false,
      printKitchenTicket: true,
      qrUrl: 'https://maps.app.goo.gl/hb12345',
    });
    const hasSeq = (buf: Uint8Array, seq: number[]) => {
      for (let i = 0; i <= buf.length - seq.length; i += 1) {
        if (seq.every((b, offset) => buf[i + offset] === b)) return true;
      }
      return false;
    };
    expect(hasSeq(textOnlyCustomerBytes, [0x1b, 0x45, 0x01])).toBe(true);
    expect(hasSeq(textOnlyCustomerBytes, [0x1b, 0x45, 0x00])).toBe(false);
    expect(hasSeq(textOnlyKotBytes, [0x1b, 0x45, 0x01])).toBe(true);
    expect(hasSeq(textOnlyKotBytes, [0x1b, 0x45, 0x00])).toBe(false);
    expect(hasSeq(bytes, [0x1d, 0x42, 0x01])).toBe(false);
    expect(hasSeq(withKotBytes, [0x1d, 0x42, 0x01])).toBe(false);
    expect(hasSeq(bytes, [0x1d, 0x76, 0x30])).toBe(true);
    expect(hasSeq(bytes, [0x1d, 0x28, 0x6b])).toBe(false);
  });

  it('word-wraps long dish names cleanly without mid-word breaks and renders offline QR SVG in HTML receipt', () => {
    expect(wrapWords('Crispy Zinger Burger Deluxe', 12)).toEqual(['Crispy', 'Zinger', 'Burger', 'Deluxe']);
    expect(
      splitItemDisplay({
        id: 'm1::Extras:Extra Olives',
        menuItemId: 'm1',
        name: 'Zinger Burger (Extra Olives)',
        price: 700,
        qty: 1,
        modifiers: [{ group: 'Extras', name: 'Extra Olives', price: 50 }],
        note: 'Cut in half',
      }),
    ).toEqual({
      baseName: 'Zinger Burger',
      modifiers: ['Extra Olives'],
      note: 'Cut in half',
    });

    const html = receiptDocument(sale, {
      ...settings,
      qrUrl: 'https://hungrybirds.pk',
      qrLabel: 'Order online',
    });
    expect(html).toContain('DELIVERY ORDER');
    expect(html).toContain('Cashier: owner');
    expect(html).toContain('ONLINE PAYMENT');
    expect(html).toContain('Order online');
    expect(html).toContain('<svg ');
  });

  it('embeds compact B&W line-art chef logo raster (<= 2 KB) in ESC/POS and B&W PNG in HTML receipt when showLogo is enabled', () => {
    const raster80 = buildLogoRaster('80mm');
    const raster58 = buildLogoRaster('58mm');
    expect(raster80).not.toBeNull();
    expect(raster58).not.toBeNull();
    expect(raster80!.width).toBe(96);
    expect(raster80!.height).toBe(112);
    expect(raster80!.bytes.length).toBe(12 * 112);
    expect(raster80!.bytes.length).toBeLessThanOrEqual(2048);
    expect(raster58!.width).toBe(96);
    expect(raster58!.height).toBe(112);
    expect(raster58!.bytes.length).toBe(12 * 112);

    // Line-art B&W conversion stays light (< 35% black ink coverage) so BLE thermal heads don't stall
    let setBits = 0;
    for (const byte of raster80!.bytes) {
      for (let bit = 0; bit < 8; bit += 1) {
        if ((byte >> bit) & 1) setBits += 1;
      }
    }
    const inkCoverage = setBits / (raster80!.bytes.length * 8);
    expect(inkCoverage).toBeGreaterThan(0.08);
    expect(inkCoverage).toBeLessThan(0.35);

    const hasCmd = (buf: Uint8Array, seq: number[]) => {
      for (let i = 0; i <= buf.length - seq.length; i += 1) {
        if (seq.every((b, offset) => buf[i + offset] === b)) return true;
      }
      return false;
    };

    const withLogo = generateEscPosReceipt(sale, { ...settings, showLogo: true });
    const withoutLogo = generateEscPosReceipt(sale, { ...settings, showLogo: false });
    expect(hasCmd(withLogo, [0x1b, 0x61, 0x01])).toBe(true);
    expect(hasCmd(withLogo, [0x1d, 0x76, 0x30])).toBe(true);
    expect(hasCmd(withoutLogo, [0x1d, 0x76, 0x30])).toBe(false);

    const htmlWithLogo = receiptDocument(sale, { ...settings, showLogo: true });
    const htmlWithoutLogo = receiptDocument(sale, { ...settings, showLogo: false });
    expect(htmlWithLogo).toContain('<img src="data:image/png;base64,');
    expect(htmlWithLogo).toContain('class="receipt-logo"');
    expect(htmlWithoutLogo).not.toContain('class="receipt-logo"');
  });

  it('normalizes Google Maps share URLs, builds byte-aligned QR bitmaps, and removes black backgrounds from HTML receipts', () => {
    expect(normalizeQrUrl('Hungry Birds Restaurant\nhttps://maps.app.goo.gl/abc123?g_st=aw.')).toBe(
      'https://maps.app.goo.gl/abc123',
    );
    expect(normalizeQrUrl('maps.app.goo.gl/xyz789')).toBe('https://maps.app.goo.gl/xyz789');

    const longMapsUrl =
      'https://www.google.com/maps/place/Hungry+Birds+Restaurant/@31.5924782,74.4123456,17z/data=!3m1!4b1!4m6!3m5!1s0x391911c123456789:0xabcdef1234567890!8m2!3d31.5924782!4d74.4149205?cid=987654321&entry=ttu&g_ep=EgoyMDI2MTExMS4wIKXMDSoASAFQAw%3D%3D';
    const normalizedLong = normalizeQrUrl(longMapsUrl);
    expect(normalizedLong).toContain('/data=!3m1!4b1!');
    expect(normalizedLong).toContain('cid=987654321');
    expect(normalizedLong).not.toContain('entry=');
    expect(normalizedLong).not.toContain('g_ep=');

    const shortRaster = buildQrRaster('https://maps.app.goo.gl/abc123', '58mm');
    expect(shortRaster).not.toBeNull();
    expect(shortRaster!.width % 8).toBe(0);
    expect(shortRaster!.width).toBeLessThanOrEqual(352);
    expect(shortRaster!.bytes.length).toBe((shortRaster!.width / 8) * shortRaster!.height);
    expect(shortRaster!.bytes.some((b) => b !== 0)).toBe(true);

    const longRaster58 = buildQrRaster(longMapsUrl, '58mm');
    expect(longRaster58).not.toBeNull();
    expect(longRaster58!.width % 8).toBe(0);
    expect(longRaster58!.width).toBeLessThanOrEqual(352);
    expect(longRaster58!.bytes.length).toBe((longRaster58!.width / 8) * longRaster58!.height);

    const svg = buildQrSvg(longMapsUrl, 132);
    expect(svg).toContain('<svg ');
    expect(svg).toContain('shape-rendering="crispEdges"');

    const html = receiptDocument(sale, {
      ...settings,
      qrUrl: 'https://maps.app.goo.gl/abc123?g_st=aw',
    });
    expect(html).not.toContain('background: #000');
    expect(html).toContain('.inv-banner { background: #fff; color: #000;');
    expect(html).toContain('.grand-bar { display: flex;');
    expect(html).toContain('background: #fff; color: #000; border-top: 2px solid #000;');
  });

  it('translates WebUSB Access denied errors into UsbAccessDeniedError and closes leaked handles on claim failure', async () => {
    const { pairUsbPrinter, isUsbAccessDeniedError, UsbAccessDeniedError, disconnectUsbPrinter } = await import(
      '../src/lib/printer'
    );
    const origUsb = Object.getOwnPropertyDescriptor(navigator, 'usb');

    try {
      let closeCalls = 0;
      const accessDeniedDev = {
        vendorId: 0x0483,
        productId: 0x5743,
        opened: false,
        open: async () => {
          const err = new Error("Failed to execute 'open' on 'USBDevice': Access denied.");
          err.name = 'SecurityError';
          throw err;
        },
        close: async () => {
          closeCalls += 1;
        },
        selectConfiguration: async () => {},
        claimInterface: async () => {},
        transferOut: async () => ({ status: 'ok' }),
      };

      Object.defineProperty(navigator, 'usb', {
        configurable: true,
        value: { requestDevice: async () => accessDeniedDev },
      });

      let captured: unknown = null;
      try {
        await pairUsbPrinter();
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(UsbAccessDeniedError);
      expect(isUsbAccessDeniedError(captured)).toBe(true);
      expect((captured as Error).message).toContain('System / Windows (USB)');
      expect(closeCalls).toBe(0);

      // Simulate open() succeeding but Windows rejecting claimInterface() -> must close opened handle cleanly
      let leakedCloseCalls = 0;
      const claimDeniedDev = {
        vendorId: 0x0483,
        productId: 0x5743,
        opened: false,
        configuration: {
          interfaces: [
            {
              interfaceNumber: 0,
              alternate: {
                interfaceClass: 7,
                endpoints: [{ endpointNumber: 1, direction: 'out' as const, type: 'bulk' as const }],
              },
              alternates: [],
            },
          ],
        },
        open: async () => {
          claimDeniedDev.opened = true;
        },
        close: async () => {
          claimDeniedDev.opened = false;
          leakedCloseCalls += 1;
        },
        selectConfiguration: async () => {},
        claimInterface: async () => {
          throw new Error('Unable to claim interface.');
        },
        transferOut: async () => ({ status: 'ok' }),
      };

      Object.defineProperty(navigator, 'usb', {
        configurable: true,
        value: { requestDevice: async () => claimDeniedDev },
      });

      let claimErr: unknown = null;
      try {
        await pairUsbPrinter();
      } catch (err) {
        claimErr = err;
      }
      expect(claimErr).toBeInstanceOf(UsbAccessDeniedError);
      expect(leakedCloseCalls).toBe(1);
    } finally {
      await disconnectUsbPrinter();
      if (origUsb) Object.defineProperty(navigator, 'usb', origUsb);
      else delete (navigator as { usb?: unknown }).usb;
    }
  });

  it('claims Printer Class (0x07) interface on composite USB printers, chunks 4KB transfers, and clears endpoint stalls', async () => {
    const { pairUsbPrinter, printRaw, getUsbPrinterDevice, disconnectUsbPrinter } = await import('../src/lib/printer');
    const origUsb = Object.getOwnPropertyDescriptor(navigator, 'usb');

    try {
      const claimed: number[] = [];
      const selectedAlt: Array<[number, number]> = [];
      const clearHalts: Array<[string, number]> = [];
      const transferredSizes: number[] = [];
      let stallOnce = true;

      const compositeDev = {
        productName: 'XP-80 Composite USB',
        vendorId: 0x0416,
        productId: 0x5011,
        opened: false,
        configuration: {
          interfaces: [
            {
              interfaceNumber: 0,
              alternate: {
                alternateSetting: 0,
                interfaceClass: 3, // HID interface claimed by OS
                endpoints: [{ endpointNumber: 1, direction: 'out' as const, type: 'interrupt' as const }],
              },
              alternates: [],
            },
            {
              interfaceNumber: 1,
              alternate: {
                alternateSetting: 1,
                interfaceClass: 7, // USB Printer Class
                endpoints: [{ endpointNumber: 2, direction: 'out' as const, type: 'bulk' as const }],
              },
              alternates: [],
            },
          ],
        },
        open: async () => {
          compositeDev.opened = true;
        },
        close: async () => {
          compositeDev.opened = false;
        },
        selectConfiguration: async () => {},
        claimInterface: async (ifaceNum: number) => {
          if (ifaceNum === 0) throw new Error('Unable to claim interface.');
          claimed.push(ifaceNum);
        },
        selectAlternateInterface: async (ifaceNum: number, alt: number) => {
          selectedAlt.push([ifaceNum, alt]);
        },
        clearHalt: async (dir: 'in' | 'out', ep: number) => {
          clearHalts.push([dir, ep]);
        },
        transferOut: async (_ep: number, data: BufferSource) => {
          if (stallOnce) {
            stallOnce = false;
            return { status: 'stall' };
          }
          transferredSizes.push((data as ArrayBufferView).byteLength);
          return { status: 'ok' };
        },
      };

      Object.defineProperty(navigator, 'usb', {
        configurable: true,
        value: { requestDevice: async () => compositeDev },
      });

      const paired = await pairUsbPrinter();
      expect(paired.productName).toBe('XP-80 Composite USB');
      expect(getUsbPrinterDevice()).toBe(compositeDev);
      expect(claimed).toEqual([1]);
      expect(selectedAlt).toEqual([[1, 1]]);

      await printRaw(new Uint8Array(10000).fill(0x55), 'usb');
      expect(clearHalts).toEqual([['out', 2]]);
      expect(transferredSizes).toEqual([4096, 4096, 1808]);
    } finally {
      await disconnectUsbPrinter();
      if (origUsb) Object.defineProperty(navigator, 'usb', origUsb);
      else delete (navigator as { usb?: unknown }).usb;
    }
  });

  it('builds a clean white-background HTML test slip for System / Windows Printer mode', () => {
    const html = buildTestReceiptDocument({
      ...settings,
      connectionType: 'browser',
      qrUrl: 'https://maps.app.goo.gl/abc123?g_st=aw',
    });

    expect(html).toContain('PRINTER TEST SLIP');
    expect(html).toContain('SYSTEM PRINTER');
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain('<svg ');
    expect(html).toContain('font-weight: 700;');
    expect(html).not.toContain('background: #000');

    const fullHtml = receiptDocument(sale, {
      ...settings,
      connectionType: 'browser',
      qrUrl: 'https://maps.app.goo.gl/abc123',
    });
    expect(fullHtml).toContain('* { box-sizing: border-box; font-weight: 700; }');
    expect(fullHtml).toContain('font-weight: 700;');
    expect(fullHtml).toContain('For Delivery Contact: 0325-7867774');
    expect(fullHtml).not.toContain('Order &amp; Support');
  });

  it('formats weighted items clearly across 80mm/58mm ESC/POS, KOT, HTML receipt, and WhatsApp text', () => {
    const weightedSale: Sale = {
      ...sale,
      items: [
        {
          id: 'fish_1::wt:2.4:1',
          menuItemId: 'fish_1',
          name: 'Grilled Fish',
          price: 4320,
          qty: 1,
          weightKg: 2.4,
          unitRate: 1800,
        },
        { id: 'm1', menuItemId: 'm1', name: 'Zinger Burger', price: 650, qty: 1 },
      ],
      subtotal: 4970,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      total: 4970,
    };

    const esc80 = new TextDecoder('latin1').decode(
      generateEscPosReceipt(weightedSale, { ...settings, showLogo: false, qrUrl: '' }),
    );
    expect(esc80).toContain('2.4kg Grilled Fish');
    expect(esc80).toContain('2.4 kg x Rs 1,800.00/kg');
    expect(esc80).toContain('4,320.00');
    expect(esc80).toContain('Total Qty: 2');

    const esc58 = new TextDecoder('latin1').decode(
      generateEscPosReceipt(weightedSale, { ...settings, paperWidth: '58mm', showLogo: false, qrUrl: '' }),
    );
    expect(esc58).toContain('2.4kg Grilled Fish');
    expect(esc58).toContain('2.4 kg x Rs 1,800.00/kg');
    expect(esc58).toContain('4,320.00');

    const html = receiptDocument(weightedSale, { ...settings, showLogo: false, qrUrl: '' });
    expect(html).toMatch(/2\.4 kg &times; Rs[\s\u00a0]1,800\/kg/);
    expect(html).toContain('>1,800.00<');
    expect(html).toContain('>2.4kg<');
    expect(html).toContain('>4,320.00<');
    expect(html).toContain('Total Qty: 2');

    const plainLines = receiptLines(weightedSale, settings);
    expect(
      plainLines.some((l) => /2\.4 kg x Rs[\s\u00a0]1,800\/kg/.test(l) && /Rs[\s\u00a0]4,320/.test(l)),
    ).toBe(true);
  });
});
