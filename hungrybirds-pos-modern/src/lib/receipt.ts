import { formatAmount } from './format';
import { formatWeightKg, formatWeightShort } from './cart';
import { DEFAULT_PRINTER_SETTINGS, getPrinterSettings, printRaw } from './printer';
import type { PrinterSettings } from './printer';
import type { CartItem, Sale } from './db/types';
import { EscPosEncoder } from './escpos';
import { buildCenteredLogoRaster, RECEIPT_LOGO_DATA_URI } from './receiptLogo';
import { buildQrRaster, buildQrSvg, normalizeQrUrl } from './receiptQr';

export { buildQrRaster, buildQrSvg, normalizeQrUrl };

export const RESTAURANT = {
  name: 'Hungry Birds Restaurant',
  tagline: 'Fresh · Crispy · Made to Order',
  phone: '0325-7867774',
  addressLine1: 'Dubai park stop, near Dera Gujjran station',
  addressLine2: 'G.T Road Lahore',
  address: 'Dubai park stop, near Dera Gujjran station, G.T Road Lahore',
  accountTitle: 'Zeeshan Shafiq',
  accountMethod: 'Jazzcash/Easypaisa',
  accountNumber: '0325-7867774',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats a number as 2,000.00 (pure ASCII, always 2 decimals). */
export function formatDecimal(value: number): string {
  const num = Number(value) || 0;
  const [intPart, decPart] = Math.abs(num).toFixed(2).split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${num < 0 ? '-' : ''}${withCommas}.${decPart}`;
}

/** Formats timestamp as "05 Nov 2026 20:54" matching the thermal bill format. */
export function formatBillTimestamp(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value ?? '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const mon = MONTHS[d.getMonth()] || 'Jan';
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${day} ${mon} ${year} ${hours}:${mins}`;
}

/** Word-wraps text cleanly to `maxWidth` columns without splitting words mid-letter unless a single word exceeds `maxWidth`. */
export function wrapWords(text: string, maxWidth: number): string[] {
  const limit = Math.max(4, maxWidth);
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      if (word.length <= limit) {
        current = word;
      } else {
        for (let i = 0; i < word.length; i += limit) {
          const chunk = word.slice(i, i + limit);
          if (i + limit < word.length) lines.push(chunk);
          else current = chunk;
        }
      }
      continue;
    }

    if (current.length + 1 + word.length <= limit) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      if (word.length <= limit) {
        current = word;
      } else {
        current = '';
        for (let i = 0; i < word.length; i += limit) {
          const chunk = word.slice(i, i + limit);
          if (i + limit < word.length) lines.push(chunk);
          else current = chunk;
        }
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Formats a left + right pair cleanly aligned within `cols` columns. */
export function formatTwoCol(left: string, right: string, cols: number): string {
  const gap = cols - left.length - right.length;
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  const maxLeft = Math.max(4, cols - right.length - 1);
  return `${left.slice(0, maxLeft)} ${right}`;
}

/** Formats the order type banner text (e.g. "DINE IN - TABLE T4", "DELIVERY ORDER", "TAKEAWAY ORDER"). */
export function formatOrderBadge(orderType: Sale['orderType'], tableNumber?: string): string {
  if (orderType === 'DINE_IN') {
    return tableNumber ? `DINE IN - TABLE ${tableNumber}` : 'DINE IN - COUNTER';
  }
  if (orderType === 'TAKEAWAY') return 'TAKEAWAY ORDER';
  return 'DELIVERY ORDER';
}

/**
 * Separates a cart item into its clean base dish name, deduplicated modifier labels, and optional kitchen note.
 * Avoids printing "(Extra Cheese) (Extra Cheese)" when `item.name` already contains modifier text.
 */
export function splitItemDisplay(item: CartItem): {
  baseName: string;
  modifiers: string[];
  note?: string;
} {
  const modifiers = (item.modifiers || []).map((m) => m.name.trim()).filter(Boolean);
  let baseName = String(item.name || '').trim();
  if (modifiers.length > 0) {
    const suffix = `(${modifiers.join(', ')})`;
    if (baseName.endsWith(suffix)) {
      baseName = baseName.slice(0, -suffix.length).trim();
    }
  }
  const note = item.note?.trim() || undefined;
  return { baseName: baseName || item.name, modifiers, note };
}

/** Resolves effective store/payment/QR display details, merging saved settings over defaults. */
export function resolveReceiptProfile(settings: PrinterSettings) {
  return {
    name: settings.headerText?.trim() || RESTAURANT.name,
    tagline: settings.tagline !== undefined ? settings.tagline.trim() : RESTAURANT.tagline,
    addressLine1: settings.addressLine1 !== undefined ? settings.addressLine1.trim() : RESTAURANT.addressLine1,
    addressLine2: settings.addressLine2 !== undefined ? settings.addressLine2.trim() : RESTAURANT.addressLine2,
    phone: settings.phone !== undefined ? settings.phone.trim() : RESTAURANT.phone,
    accountTitle: settings.accountTitle !== undefined ? settings.accountTitle.trim() : RESTAURANT.accountTitle,
    accountMethod: settings.accountMethod !== undefined ? settings.accountMethod.trim() : RESTAURANT.accountMethod,
    accountNumber: settings.accountNumber !== undefined ? settings.accountNumber.trim() : RESTAURANT.accountNumber,
    qrUrl: normalizeQrUrl(settings.qrUrl || ''),
    qrLabel: (settings.qrLabel || '').trim() || 'Scan to order or leave a review',
    showLogo: settings.showLogo !== false,
  };
}

/**
 * Returns the compact 1-bit monochrome B&W line-art raster bitmap of the Hungry Birds chef logo
 * for centered ESC/POS GS v 0 printing (96x112 px / 12 bytes/row = 1,344 bytes on 58mm and 80mm).
 */
export function buildLogoRaster(
  paperWidth: '58mm' | '80mm' = '80mm',
): { width: number; height: number; bytes: Uint8Array } | null {
  return buildCenteredLogoRaster(paperWidth);
}

function defaultThankYou(orderType: Sale['orderType']): string {
  if (orderType === 'DELIVERY') return 'Thank you for ordering delivery!';
  if (orderType === 'TAKEAWAY') return 'Thank you for choosing takeaway!';
  return 'Thank you for dining with us!';
}

/**
 * Encodes the sale into raw ESC/POS bytes (80mm = 47 cols, 58mm = 31 cols)
 * with clean white-background typography, ruled order-type & total sections,
 * word-wrapped items with indented modifiers/notes, payment & change details,
 * framed digital payment info, and universal 1-bit raster QR codes.
 */
export function generateEscPosReceipt(sale: Sale, settings: PrinterSettings): Uint8Array {
  const encoder = new EscPosEncoder();
  encoder.initialize();
  encoder.bold(true);

  const profile = resolveReceiptProfile(settings);
  const cols = settings.paperWidth === '80mm' ? 47 : 31;
  const heavyRule = '='.repeat(cols);
  const lightRule = '-'.repeat(cols);
  const orderBadge = formatOrderBadge(sale.orderType, sale.tableNumber);

  // 0. Optional Kitchen Order Ticket (KOT)
  if (settings.printKitchenTicket) {
    encoder.align('center');
    encoder.text(heavyRule);
    encoder.setSize(0, 1);
    encoder.text('KITCHEN ORDER (KOT)');
    encoder.setSize(0, 0);
    encoder.text(orderBadge);
    encoder.text(`Bill #HBR-${sale.id ?? ''}  |  ${formatBillTimestamp(sale.timestamp)}`);
    encoder.text(`By: ${sale.serverUser || 'Staff'}`);
    encoder.text(heavyRule);
    encoder.align('left');
    for (const item of sale.items || []) {
      const { baseName, modifiers, note } = splitItemDisplay(item);
      const lead = item.weightKg ? formatWeightShort(item.weightKg) : `${item.qty}x`;
      encoder.setSize(0, 1);
      for (const wrapped of wrapWords(`${lead} ${baseName}`, cols)) {
        encoder.text(wrapped);
      }
      encoder.setSize(0, 0);
      if (modifiers.length) {
        for (const modLine of wrapWords(`+ ${modifiers.join(', ')}`, cols - 3)) {
          encoder.text(`   ${modLine}`);
        }
      }
      if (note) {
        for (const noteLine of wrapWords(`* Note: ${note}`, cols - 3)) {
          encoder.text(`   ${noteLine}`);
        }
      }
    }
    encoder.text(heavyRule);
    encoder.feed(4);
    encoder.cut();
    encoder.bold(true);
  }

  // 1. Centered Rooster Stamp Logo
  if (profile.showLogo) {
    const logo = buildLogoRaster(settings.paperWidth);
    if (logo) {
      encoder.align('center');
      encoder.rasterImage(logo.width, logo.height, logo.bytes);
      encoder.bold(true);
      encoder.text('');
    }
  }

  // 2. Bold Brand Header + Tagline + Contact
  encoder.align('center');
  encoder.setSize(0, 1);
  for (const nameLine of wrapWords(profile.name, cols)) {
    encoder.text(nameLine);
  }
  encoder.setSize(0, 0);

  if (profile.tagline) {
    encoder.text(profile.tagline);
  }
  if (profile.addressLine1) {
    for (const line of wrapWords(profile.addressLine1, cols)) encoder.text(line);
  }
  if (profile.addressLine2) {
    for (const line of wrapWords(profile.addressLine2, cols)) encoder.text(line);
  }
  if (profile.phone) {
    encoder.text(`Tel: ${profile.phone}`);
  }

  encoder.text('');
  // 3. Framed White-Background Order-Type Section + Copy Label
  encoder.text(lightRule);
  encoder.text(orderBadge);
  encoder.text('*** Customer Copy ***');

  // 4. Order Metadata Block
  encoder.align('left');
  encoder.text(heavyRule);
  if (settings.printOrderDetails) {
    const billNo = `Bill #HBR-${sale.id ?? ''}`;
    const dateStr = formatBillTimestamp(sale.timestamp);
    encoder.text(formatTwoCol(billNo, dateStr, cols));

    const cashierLeft = `Cashier: ${sale.serverUser || 'Staff'}`;
    const rightMeta =
      sale.orderType === 'DINE_IN'
        ? `Table: ${sale.tableNumber || 'Counter'}`
        : `Type: ${sale.orderType.replace('_', ' ')}`;
    encoder.text(formatTwoCol(cashierLeft, rightMeta, cols));
    encoder.text(lightRule);
  }

  // 5. Split Customer / Delivery Details
  const cust = sale.deliveryInfo?.phone || sale.deliveryInfo?.name || sale.deliveryInfo?.address
    ? sale.deliveryInfo
    : sale.customer;
  if (settings.printDeliveryDetails && cust && (cust.name || cust.address || cust.phone)) {
    encoder.text(sale.orderType === 'DELIVERY' ? 'DELIVERY DETAILS' : 'CUSTOMER DETAILS');
    if (cust.name) {
      for (const [idx, l] of wrapWords(cust.name, cols - 10).entries()) {
        encoder.text(`${idx === 0 ? 'Customer: ' : '          '}${l}`);
      }
    }
    if (cust.phone) {
      encoder.text(`Phone:    ${cust.phone}`);
    }
    if (cust.address) {
      for (const [idx, l] of wrapWords(cust.address, cols - 10).entries()) {
        encoder.text(`${idx === 0 ? 'Address:  ' : '          '}${l}`);
      }
    }
    encoder.text(lightRule);
  }

  // 6. Crisp Itemized Table (Word-wrapped + Indented Modifiers & Notes)
  const itemW = settings.paperWidth === '80mm' ? 21 : 12;
  const rateW = settings.paperWidth === '80mm' ? 9 : 7;
  const qtyW = settings.paperWidth === '80mm' ? 5 : 4;
  const amtW = settings.paperWidth === '80mm' ? 12 : 8;

  if (settings.printItemPrices) {
    encoder.text(
      'Item'.padEnd(itemW, ' ') +
      'Rate'.padStart(rateW, ' ') +
      'Qty'.padStart(qtyW, ' ') +
      'Amount'.padStart(amtW, ' '),
    );
  } else {
    encoder.text(formatTwoCol('Item', 'Qty', cols));
  }
  encoder.text(lightRule);

  let totalUnits = 0;
  for (const item of sale.items || []) {
    totalUnits += Number(item.qty) || 0;
    const { baseName, modifiers, note } = splitItemDisplay(item);
    const isWeighted = Boolean(item.weightKg && item.unitRate);
    const weightShort = isWeighted ? formatWeightShort(item.weightKg!) : '';
    const rateStr = formatDecimal(isWeighted ? item.unitRate! : item.price);
    const qtyStr = isWeighted ? weightShort : String(item.qty);
    const amtStr = formatDecimal(item.price * item.qty);
    const wrappedName = wrapWords(
      baseName,
      settings.printItemPrices
        ? settings.paperWidth === '80mm' || !isWeighted
          ? itemW - 1
          : cols - amtStr.length - 1
        : cols - (isWeighted ? Math.max(6, weightShort.length + 1) : 6),
    );

    if (settings.printItemPrices) {
      if (isWeighted && settings.paperWidth === '58mm') {
        encoder.text(formatTwoCol(wrappedName[0], amtStr, cols));
      } else if (isWeighted) {
        const fitCols = qtyStr.length <= qtyW && rateStr.length <= rateW;
        encoder.text(
          wrappedName[0].padEnd(itemW, ' ') +
          (fitCols ? rateStr.padStart(rateW, ' ') : ''.padStart(rateW, ' ')) +
          (fitCols ? qtyStr.padStart(qtyW, ' ') : `${item.qty}x`.padStart(qtyW, ' ')) +
          amtStr.padStart(amtW, ' '),
        );
      } else {
        encoder.text(
          wrappedName[0].padEnd(itemW, ' ') +
          rateStr.padStart(rateW, ' ') +
          qtyStr.padStart(qtyW, ' ') +
          amtStr.padStart(amtW, ' '),
        );
      }
    } else {
      encoder.text(formatTwoCol(wrappedName[0], isWeighted ? weightShort : `${qtyStr}x`, cols));
    }

    for (let i = 1; i < wrappedName.length; i += 1) {
      encoder.text(wrappedName[i]);
    }
    if (isWeighted) {
      for (const wtLine of wrapWords(
        `${formatWeightKg(item.weightKg!)} x Rs ${formatDecimal(item.unitRate!)}/kg`,
        cols - 2,
      )) {
        encoder.text(`  ${wtLine}`);
      }
    }
    if (modifiers.length) {
      for (const modLine of wrapWords(`+ ${modifiers.join(', ')}`, cols - 2)) {
        encoder.text(`  ${modLine}`);
      }
    }
    if (note) {
      for (const noteLine of wrapWords(`* Note: ${note}`, cols - 2)) {
        encoder.text(`  ${noteLine}`);
      }
    }
    if (item.refundedQty) {
      encoder.text(`  [Refunded: ${item.refundedQty}]`);
    }
  }

  encoder.text(heavyRule);

  // 7. Financial Breakdown & Grand Total
  if (settings.printTotals) {
    const moneyRow = (label: string, amount: number, sign = '') => {
      const val = `${sign}Rs ${formatDecimal(amount)}`;
      encoder.text(formatTwoCol(label, val, cols));
    };

    const hasAdjustments = Boolean(
      sale.discountAmount ||
      sale.loyaltyDiscount ||
      sale.deliveryCharge ||
      sale.packingCharge ||
      sale.taxAmount ||
      sale.otherCharge,
    );

    if (hasAdjustments) {
      moneyRow('Subtotal', sale.subtotal);
      if (sale.discountAmount) moneyRow(`Discount (${sale.discountPercent || 0}%)`, sale.discountAmount, '-');
      if (sale.loyaltyDiscount) {
        moneyRow(
          sale.loyaltyRedeemPoints ? `Loyalty (${sale.loyaltyRedeemPoints} pts)` : 'Loyalty Discount',
          sale.loyaltyDiscount,
          '-',
        );
      }
      if (sale.deliveryCharge) moneyRow('Delivery Charge', sale.deliveryCharge);
      if (sale.packingCharge) moneyRow('Packing Charge', sale.packingCharge);
      if (sale.taxAmount) moneyRow(`Tax (${sale.taxPercent || 0}%)`, sale.taxAmount);
      if (sale.otherCharge) moneyRow('Other Charges', sale.otherCharge);
      encoder.text(lightRule);
    }

    const totalLeft = 'TOTAL AMOUNT';
    const totalRight = `Rs ${formatDecimal(sale.total)}`;
    encoder.setSize(0, 1);
    encoder.text(formatTwoCol(totalLeft, totalRight, cols));
    encoder.setSize(0, 0);

    if (sale.refundedAmount) {
      moneyRow(`Refunded (${sale.refundStatus || 'PARTIAL'})`, sale.refundedAmount, '-');
    }

    encoder.text(lightRule);
    const lineCount = (sale.items || []).length;
    encoder.text(formatTwoCol(`Total Items: ${lineCount}`, `Total Qty: ${totalUnits}`, cols));
    encoder.text(lightRule);
  }

  // 8. Payment Receipt Block
  if (settings.printPayments && sale.payments?.length) {
    encoder.text('PAYMENT DETAILS');
    for (const payment of sale.payments) {
      encoder.text(formatTwoCol(`Paid (${payment.method})`, `Rs ${formatDecimal(payment.amount)}`, cols));
      if (payment.method === 'Cash' && payment.cashGiven != null) {
        encoder.text(formatTwoCol('Cash Received', `Rs ${formatDecimal(payment.cashGiven)}`, cols));
      }
      if (Number(payment.change) > 0) {
        encoder.text(formatTwoCol('Change Returned', `Rs ${formatDecimal(Number(payment.change))}`, cols));
      }
    }
    encoder.align('center');
    encoder.text(sale.refundStatus === 'FULL' ? '*** REFUNDED ***' : '*** PAID ***');
    encoder.align('left');
    encoder.text(lightRule);
  }

  // 9. Framed Online Payment Info, Optional QR Code, & Warm Footer
  if (settings.printFooter) {
    if (profile.accountTitle || profile.accountMethod || profile.accountNumber) {
      encoder.align('center');
      encoder.text('ONLINE PAYMENT');
      encoder.align('left');
      if (profile.accountMethod) encoder.text(formatTwoCol('Method:', profile.accountMethod, cols));
      if (profile.accountTitle) encoder.text(formatTwoCol('Title:', profile.accountTitle, cols));
      if (profile.accountNumber) encoder.text(formatTwoCol('Account:', profile.accountNumber, cols));
      encoder.text(lightRule);
    }

    if (profile.qrUrl) {
      const qr = buildQrRaster(profile.qrUrl, settings.paperWidth);
      if (qr) {
        encoder.align('center');
        encoder.text('');
        encoder.rasterImage(qr.width, qr.height, qr.bytes);
        encoder.bold(true);
        encoder.text('');
        encoder.text(profile.qrLabel);
        encoder.text(lightRule);
      }
    }

    encoder.align('center');
    const thanks = settings.footerText?.trim() || defaultThankYou(sale.orderType);
    for (const line of wrapWords(thanks, cols)) encoder.text(line);
    encoder.text('Please visit us again!');
    if (profile.phone) {
      for (const line of wrapWords(`For Delivery Contact: ${profile.phone}`, cols)) encoder.text(line);
    }
  }

  encoder.feed(4);
  encoder.cut();
  return encoder.build();
}

async function printHtmlViaFrame(html: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  frame.srcdoc = html;
  await new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    setTimeout(resolve, 2000);
  });

  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    throw new Error('Could not prepare the receipt for printing.');
  }
  const cleanUp = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener('afterprint', cleanUp, { once: true });
  win.focus();
  win.print();
}

/**
 * Builds a clean white-background 58mm/80mm test receipt HTML document
 * for System / Windows Printer (USB) test printing without raw ESC/POS commands.
 */
export function buildTestReceiptDocument(settings: PrinterSettings): string {
  const profile = resolveReceiptProfile(settings);
  const width = settings.paperWidth === '58mm' ? '54mm' : '76mm';
  const qrSvg = profile.qrUrl ? buildQrSvg(profile.qrUrl, settings.paperWidth === '58mm' ? 112 : 132) : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Printer Test Slip</title><style>
  @page { size: ${settings.paperWidth} auto; margin: 2mm; }
  * { box-sizing: border-box; font-weight: 700; }
  html, body { width: 100%; max-width: ${width}; margin: 0 auto; padding: 0; color: #000; background: #fff; }
  body { font: 700 ${FONT_PT[settings.receiptFontSize] ?? '10.5pt'}/1.35 "Courier New", Courier, monospace; font-weight: 700; }
  main { width: 100%; max-width: ${width}; margin: 0 auto; padding: 1mm 1.5mm 4mm; text-align: center; }
  .stamp-wrap { width: 100%; display: flex; justify-content: center; margin: 0 auto 1.5mm; }
  .stamp-wrap img.receipt-logo { display: block; margin: 0 auto; width: ${settings.paperWidth === '58mm' ? '15mm' : '18mm'}; max-width: 100%; height: auto; }
  h1 { margin: 1mm 0 0.5mm; font-size: 1.25em; font-weight: 900; }
  .banner { background: #fff; color: #000; border-top: 1px solid #000; border-bottom: 1px solid #000; font-weight: 900; padding: 1.2mm 2mm; margin: 2mm 0; letter-spacing: 0.06em; }
  .heavy-rule { margin: 2mm 0; border-top: 2px solid #000; }
  .rule { margin: 1.8mm 0; border-top: 1px dashed #000; }
  .status { font-weight: 900; margin: 1.2mm 0; }
  .qr-wrap { padding: 1.5mm 0; }
  .qr-label { font-size: 0.85em; margin-top: 1mm; }
  </style></head><body><main>
  ${
    profile.showLogo
      ? `<div class="stamp-wrap"><img src="${RECEIPT_LOGO_DATA_URI}" alt="${escapeHtml(profile.name)}" class="receipt-logo" /></div>`
      : ''
  }
  <h1>${escapeHtml(profile.name)}</h1>
  <div class="banner">PRINTER TEST SLIP</div>
  <div class="heavy-rule"></div>
  <p>Mode: SYSTEM PRINTER | Paper: ${escapeHtml(settings.paperWidth)}</p>
  <p>${escapeHtml(formatBillTimestamp(new Date()))}</p>
  <p class="status">Status: CONNECTED &amp; READY</p>
  <div class="rule"></div>
  ${
    qrSvg
      ? `<div class="qr-wrap">${qrSvg}<p class="qr-label">${escapeHtml(profile.qrLabel)}</p></div><div class="rule"></div>`
      : ''
  }
  <p>Configured for Windows / macOS printer spooler.</p>
  </main></body></html>`;
}

/** Sends a test slip through the OS / browser print dialog for System Printer mode. */
export async function printBrowserTestReceipt(settings: PrinterSettings): Promise<void> {
  await printHtmlViaFrame(buildTestReceiptDocument(settings));
}

/**
 * Prints to the configured system printer when `connectionType === 'browser'`,
 * otherwise sends raw ESC/POS to the paired thermal printer and falls back to the
 * browser's print dialog via a hidden iframe (the POS tab keeps its cart and open modals).
 */
export async function printReceipt(sale: Sale): Promise<'thermal' | 'system' | 'browser'> {
  const settings = await getPrinterSettings();

  if (settings.connectionType === 'browser') {
    await printHtmlViaFrame(receiptDocument(sale, settings));
    return 'system';
  }

  try {
    const bytes = generateEscPosReceipt(sale, settings);
    await printRaw(bytes);
    return 'thermal';
  } catch (e) {
    console.warn('Direct thermal print failed, falling back to browser print:', e);
  }

  await printHtmlViaFrame(receiptDocument(sale, settings));
  return 'browser';
}

/** Native share sheet on mobile, WhatsApp web otherwise. */
export async function shareReceipt(sale: Sale): Promise<void> {
  const text = receiptText(sale, await getPrinterSettings());
  if (navigator.share) {
    try {
      await navigator.share({ title: `Receipt #${sale.id}`, text });
      return;
    } catch {
      // The user dismissed the sheet, or the platform refused — fall through to WhatsApp.
    }
  }
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

/** Plain-text receipt lines used for WhatsApp sharing and unit testing. */
export function receiptLines(sale: Sale, settings: PrinterSettings = DEFAULT_PRINTER_SETTINGS): string[] {
  const lines: string[] = [`Order #${sale.id}`, formatDate(sale.timestamp, settings.dateFormat)];
  lines.push(
    `Server: ${sale.serverUser || 'Staff'}`,
    `Type: ${sale.orderType}${sale.tableNumber ? ` (${sale.tableNumber})` : ''}`,
  );
  if (sale.orderType === 'DELIVERY' && sale.deliveryInfo) {
    lines.push(
      `Name: ${sale.deliveryInfo.name || '—'}`,
      `Phone: ${sale.deliveryInfo.phone || '—'}`,
      `Address: ${sale.deliveryInfo.address || '—'}`,
    );
  }
  for (const item of sale.items || []) {
    const qtyLabel = item.weightKg && item.unitRate
      ? `(${formatWeightKg(item.weightKg)} x ${formatAmount(item.unitRate)}/kg)`
      : `x${item.qty}`;
    lines.push(`${item.name} ${qtyLabel}  ${formatAmount(item.price * item.qty)}`);
    if (item.note) lines.push(`  Note: ${item.note}`);
    if (item.refundedQty) lines.push(`  (refunded ${item.refundedQty})`);
  }
  const rows: [string, number][] = [
    ['Subtotal', sale.subtotal],
    ...(sale.discountAmount ? [[`Discount ${sale.discountPercent || 0}%`, -sale.discountAmount] as [string, number]] : []),
    ...(sale.loyaltyDiscount ? [['Loyalty Discount', -sale.loyaltyDiscount] as [string, number]] : []),
    ...(sale.deliveryCharge ? [['Delivery', sale.deliveryCharge] as [string, number]] : []),
    ...(sale.packingCharge ? [['Packing', sale.packingCharge] as [string, number]] : []),
    ...(sale.taxAmount ? [[`Tax ${sale.taxPercent || 0}%`, sale.taxAmount] as [string, number]] : []),
    ...(sale.otherCharge ? [['Other', sale.otherCharge] as [string, number]] : []),
  ];
  for (const [label, amount] of rows) lines.push(`${label}: ${formatAmount(amount)}`);
  lines.push(`TOTAL: ${formatAmount(sale.total)}`);
  for (const payment of sale.payments || []) {
    lines.push(`${payment.method}: ${formatAmount(payment.amount)}`);
    if (payment.method === 'Cash' && payment.cashGiven != null) lines.push(`  Given: ${formatAmount(payment.cashGiven)}`);
    if (Number(payment.change) > 0) lines.push(`  Change: ${formatAmount(Number(payment.change))}`);
  }
  if (sale.refundedAmount) lines.push(`Refunded: ${formatAmount(sale.refundedAmount)} (${sale.refundStatus})`);
  lines.push(settings.footerText?.trim() || defaultThankYou(sale.orderType));
  return lines;
}

/** Plain text for navigator.share, which WhatsApp renders as a message. */
export function receiptText(sale: Sale, settings: PrinterSettings = DEFAULT_PRINTER_SETTINGS): string {
  return [`*${settings.headerText || RESTAURANT.name}*`, ...receiptLines(sale, settings)].join('\n');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT_PT: Record<PrinterSettings['receiptFontSize'], string> = {
  small: '9.5pt',
  normal: '10.5pt',
  large: '12.5pt',
};

/** The shop picks the date style; the format list doubles as the label. */
export function formatDate(value: string | number | Date, format: PrinterSettings['dateFormat']): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? '');
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (format) {
    case 'iso':
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    case 'dmy':
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    case 'mdy':
      return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
    case 'time':
      return date.toLocaleTimeString();
    default:
      return date.toLocaleString();
  }
}

/**
 * Standalone HTML receipt document matching the Executive Thermal Receipt layout
 * for browser print fallback while preserving every settings toggle & test contract.
 */
export function receiptDocument(sale: Sale, settings: PrinterSettings): string {
  const profile = resolveReceiptProfile(settings);
  const width = settings.paperWidth === '58mm' ? '54mm' : '76mm';
  const orderBadge = formatOrderBadge(sale.orderType, sale.tableNumber);
  const totalUnits = (sale.items || []).reduce((sum, i) => sum + (Number(i.qty) || 0), 0);

  const items = (sale.items || [])
    .map((item) => {
      const { baseName, modifiers, note } = splitItemDisplay(item);
      const isWeighted = Boolean(item.weightKg && item.unitRate);
      const rateDisplay = formatDecimal(isWeighted ? item.unitRate! : item.price);
      const qtyDisplay = isWeighted ? formatWeightShort(item.weightKg!) : String(item.qty);
      return `<tr class="item">
        <td class="name">
          <div class="dish-name">${escapeHtml(baseName)}</div>
          ${isWeighted ? `<div class="mods">${escapeHtml(formatWeightKg(item.weightKg!))} &times; ${escapeHtml(formatAmount(item.unitRate!))}/kg</div>` : ''}
          ${modifiers.length ? `<div class="mods">+ ${escapeHtml(modifiers.join(', '))}</div>` : ''}
          ${note ? `<div class="note">* Note: ${escapeHtml(note)}</div>` : ''}
          ${item.refundedQty ? `<div class="refund-tag">[Refunded: ${escapeHtml(item.refundedQty)}]</div>` : ''}
        </td>
        ${
          settings.printItemPrices
            ? `<td class="num">${escapeHtml(rateDisplay)}</td>
               <td class="num">${escapeHtml(qtyDisplay)}</td>
               <td class="num amt">${escapeHtml(formatDecimal(item.price * item.qty))}</td>`
            : `<td class="num amt" colspan="3">${escapeHtml(isWeighted ? qtyDisplay : `${item.qty}x`)}</td>`
        }
      </tr>`;
    })
    .join('');

  const paymentsHtml = (sale.payments || [])
    .map(
      (payment) => `<div class="row"><span>Paid (${escapeHtml(payment.method)})</span><span>Rs ${escapeHtml(formatDecimal(payment.amount))}</span></div>
    ${payment.method === 'Cash' && payment.cashGiven != null ? `<div class="row muted"><span>Cash Received</span><span>Rs ${escapeHtml(formatDecimal(payment.cashGiven))}</span></div>` : ''}
    ${Number(payment.change) > 0 ? `<div class="row strong"><span>Change Returned</span><span>Rs ${escapeHtml(formatDecimal(Number(payment.change)))}</span></div>` : ''}`,
    )
    .join('');

  const totalRow = (label: string, amount: number, sign = '') =>
    amount ? `<div class="row"><span>${escapeHtml(label)}</span><span>${sign}Rs ${escapeHtml(formatDecimal(amount))}</span></div>` : '';

  const kitchen = settings.printKitchenTicket
    ? `<section class="kitchen">
      <div class="inv-banner">KITCHEN ORDER (KOT)</div>
      <div class="k-badge">${escapeHtml(orderBadge)}</div>
      <div class="k-meta">
        <p>Bill #HBR-${escapeHtml(sale.id)} | ${escapeHtml(formatBillTimestamp(sale.timestamp))}</p>
        <p>By: ${escapeHtml(sale.serverUser || 'Staff')}</p>
      </div>
      <div class="heavy-rule"></div>
      ${(sale.items || [])
        .map((item) => {
          const { baseName, modifiers, note } = splitItemDisplay(item);
          return `<div class="k-item">
            <span class="k-qty">${escapeHtml(item.weightKg ? formatWeightShort(item.weightKg) : `${item.qty}x`)}</span>
            <div class="k-body">
              <div class="k-name">${escapeHtml(baseName)}</div>
              ${modifiers.length ? `<div class="k-mod">+ ${escapeHtml(modifiers.join(', '))}</div>` : ''}
              ${note ? `<div class="k-note">* Note: ${escapeHtml(note)}</div>` : ''}
            </div>
          </div>`;
        })
        .join('')}
      <div class="heavy-rule"></div>
    </section>
    <div class="cut"></div>`
    : '';

  const orderDetails = settings.printOrderDetails
    ? `<div class="meta-block">
    <div class="row strong"><span>Bill #HBR-${escapeHtml(sale.id)}</span><span>${escapeHtml(formatBillTimestamp(sale.timestamp))}</span></div>
    <div class="row"><span>Cashier: ${escapeHtml(sale.serverUser || 'Staff')}</span><span>${
      sale.orderType === 'DINE_IN'
        ? `Table: ${escapeHtml(sale.tableNumber || 'Counter')}`
        : `Type: ${escapeHtml(sale.orderType.replace('_', ' '))}`
    }</span></div>
    <div class="sr-only">Order ID: #${escapeHtml(sale.id)} | Date: ${escapeHtml(formatDate(sale.timestamp, settings.dateFormat))} | Server: ${escapeHtml(sale.serverUser || 'Staff')} | Type: ${escapeHtml(sale.orderType)}</div>
  </div>`
    : '';

  const cust = sale.deliveryInfo?.phone || sale.deliveryInfo?.name || sale.deliveryInfo?.address
    ? sale.deliveryInfo
    : sale.customer;
  const deliveryDetails =
    settings.printDeliveryDetails && cust && (cust.name || cust.address || cust.phone)
      ? `<div class="rule"></div>
         <div class="cust-block">
           <div class="sec-title">${sale.orderType === 'DELIVERY' ? 'DELIVERY DETAILS' : 'CUSTOMER DETAILS'}</div>
           ${cust.name ? `<div><span class="lbl">Customer:</span> ${escapeHtml(cust.name)}</div>` : ''}
           ${cust.phone ? `<div><span class="lbl">Phone:</span> ${escapeHtml(cust.phone)}</div>` : ''}
           ${cust.address ? `<div><span class="lbl">Address:</span> ${escapeHtml(cust.address)}</div>` : ''}
         </div>`
      : '';

  const hasAdjustments = Boolean(
    sale.discountAmount ||
    sale.loyaltyDiscount ||
    sale.deliveryCharge ||
    sale.packingCharge ||
    sale.taxAmount ||
    sale.otherCharge,
  );

  const totals = settings.printTotals
    ? `<div class="totals-block">
    ${hasAdjustments ? totalRow('Subtotal', sale.subtotal) : ''}
    ${totalRow(`Discount (${sale.discountPercent || 0}%)`, sale.discountAmount, '-')}
    ${totalRow(sale.loyaltyRedeemPoints ? `Loyalty (${sale.loyaltyRedeemPoints} pts)` : 'Loyalty Discount', sale.loyaltyDiscount ?? 0, '-')}
    ${totalRow('Delivery Charge', sale.deliveryCharge)}
    ${totalRow('Packing Charge', sale.packingCharge)}
    ${totalRow(`Tax (${sale.taxPercent || 0}%)`, sale.taxAmount)}
    ${totalRow('Other Charges', sale.otherCharge)}
    <div class="grand-bar"><span>TOTAL AMOUNT <span class="sr-only">GRAND TOTAL</span></span><span class="grand-amt">Rs ${escapeHtml(formatDecimal(sale.total))}</span></div>
    ${sale.refundedAmount ? `<div class="row strong"><span>Refunded (${escapeHtml(sale.refundStatus || 'PARTIAL')})</span><span>-Rs ${escapeHtml(formatDecimal(sale.refundedAmount))}</span></div>` : ''}
    <div class="rule"></div>
    <div class="row count-row"><span>Total Items: ${escapeHtml((sale.items || []).length)}</span><span>Total Qty: ${escapeHtml(totalUnits)}</span></div>
  </div>`
    : '';

  const paymentsBlock =
    settings.printPayments && paymentsHtml
      ? `<div class="rule"></div>
         <div class="pay-block">
           <div class="sec-title">PAYMENTS</div>
           ${paymentsHtml}
           <div class="paid-stamp">${sale.refundStatus === 'FULL' ? '*** REFUNDED ***' : '*** PAID ***'}</div>
         </div>`
      : '';

  const qrSvg = profile.qrUrl ? buildQrSvg(profile.qrUrl, settings.paperWidth === '58mm' ? 112 : 132) : '';
  const hasAccount = Boolean(profile.accountTitle || profile.accountMethod || profile.accountNumber);

  const footer = settings.printFooter
    ? `<footer>
        ${
          hasAccount
            ? `<div class="rule"></div>
               <div class="acct-box">
                 <div class="sec-title center">ONLINE PAYMENT</div>
                 ${profile.accountMethod ? `<div class="row"><span>Method</span><span>${escapeHtml(profile.accountMethod)}</span></div>` : ''}
                 ${profile.accountTitle ? `<div class="row"><span>Title</span><span>${escapeHtml(profile.accountTitle)}</span></div>` : ''}
                 ${profile.accountNumber ? `<div class="row"><span>Account</span><span>${escapeHtml(profile.accountNumber)}</span></div>` : ''}
               </div>`
            : ''
        }
        ${
          qrSvg
            ? `<div class="rule"></div>
               <div class="qr-wrap">
                 ${qrSvg}
                 <p class="qr-label">${escapeHtml(profile.qrLabel)}</p>
               </div>`
            : ''
        }
        <div class="rule"></div>
        <p class="thanks">${escapeHtml(settings.footerText?.trim() || defaultThankYou(sale.orderType))}</p>
        <p class="sub-thanks">Please visit us again!</p>
        ${profile.phone ? `<p class="support">For Delivery Contact: ${escapeHtml(profile.phone)}</p>` : ''}
      </footer>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${escapeHtml(sale.id)}</title><style>
  @page { size: ${settings.paperWidth} auto; margin: 2mm; }
  * { box-sizing: border-box; font-weight: 700; }
  html, body { width: 100%; max-width: ${width}; margin: 0 auto; padding: 0; color: #000; background: #fff; }
  body { font: 700 ${FONT_PT[settings.receiptFontSize] ?? '10.5pt'}/1.35 "Courier New", Courier, monospace; font-weight: 700; }
  main { width: 100%; max-width: ${width}; margin: 0 auto; padding: 1mm 1.5mm 4mm; }
  header { width: 100%; text-align: center; padding-bottom: 1.5mm; }
  .stamp-wrap { width: 100%; display: flex; justify-content: center; margin: 0 auto 1.5mm; }
  .stamp-wrap img.receipt-logo { display: block; margin: 0 auto; width: ${settings.paperWidth === '58mm' ? '15mm' : '18mm'}; max-width: 100%; height: auto; }
  header h1 { margin: 1mm 0 0.5mm; font-size: 1.3em; font-weight: 900; letter-spacing: 0.02em; text-align: center; }
  .tagline { font-size: 0.85em; font-style: italic; margin-bottom: 1mm; }
  .addr { font-size: 0.88em; line-height: 1.25; }
  .tel { font-weight: bold; font-size: 0.92em; margin-top: 0.5mm; }
  .inv-banner { background: #fff; color: #000; border-top: 1px solid #000; border-bottom: 1px solid #000; font-weight: 900; text-align: center; padding: 1.2mm 2mm; margin: 2mm 0 1mm; letter-spacing: 0.06em; font-size: 0.95em; }
  .copy-tag { font-size: 0.85em; letter-spacing: 0.05em; text-align: center; }
  p { margin: 0; }
  .title { display: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
  .heavy-rule { margin: 2mm 0; border-top: 2px solid #000; }
  .rule { margin: 1.8mm 0; border-top: 1px dashed #000; }
  .sec-title { font-weight: 900; font-size: 0.88em; letter-spacing: 0.04em; margin-bottom: 1mm; }
  .center { text-align: center; }
  .lbl { font-weight: bold; }
  table.items-tbl { width: 100%; border-collapse: collapse; font-size: 0.92em; }
  table.items-tbl th { text-align: left; font-weight: 900; padding-bottom: 1.2mm; border-bottom: 1px dashed #000; }
  table.items-tbl th.num, table.items-tbl td.num { text-align: right; white-space: nowrap; padding-left: 1.5mm; }
  table.items-tbl td { padding: 1.2mm 0; vertical-align: top; }
  .name { overflow-wrap: break-word; }
  .dish-name { font-weight: bold; }
  .mods { font-size: 0.86em; padding-left: 2mm; }
  .note { font-size: 0.85em; font-style: italic; padding-left: 2mm; }
  .refund-tag { font-size: 0.82em; font-weight: bold; padding-left: 2mm; }
  .amt { font-weight: bold; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; margin: 0.8mm 0; font-size: 0.92em; }
  .row span:last-child { white-space: nowrap; }
  .strong { font-weight: bold; }
  .muted { font-size: 0.88em; }
  .grand-bar { display: flex; justify-content: space-between; align-items: center; gap: 2mm; background: #fff; color: #000; border-top: 2px solid #000; border-bottom: 2px solid #000; font-weight: 900; padding: 1.6mm 0.5mm; margin: 1.5mm 0 1mm; font-size: 1.08em; }
  .grand-amt { font-size: 1.15em; white-space: nowrap; }
  .count-row { font-size: 0.88em; font-weight: bold; }
  .paid-stamp { text-align: center; font-weight: 900; letter-spacing: 0.08em; margin-top: 1.2mm; font-size: 0.9em; }
  .acct-box { border: 1px solid #000; padding: 1.5mm 2mm; margin: 1mm 0; }
  .qr-wrap { text-align: center; padding: 1mm 0; }
  .qr-label { font-size: 0.82em; margin-top: 1mm; }
  footer { margin-top: 1.5mm; text-align: center; }
  .thanks { font-weight: 900; font-size: 0.95em; margin-top: 1mm; }
  .sub-thanks { font-size: 0.88em; margin-top: 0.5mm; }
  .support { font-size: 0.85em; margin-top: 0.8mm; }
  .k-badge { text-align: center; font-weight: 900; font-size: 0.95em; margin-bottom: 1mm; }
  .k-meta { text-align: center; font-size: 0.88em; margin-bottom: 1.5mm; }
  .k-item { display: flex; gap: 2mm; padding: 1mm 0; overflow-wrap: break-word; }
  .k-qty { font-weight: 900; font-size: 1.1em; min-width: 6mm; }
  .k-name { font-weight: 900; font-size: 1.05em; }
  .k-mod { font-size: 0.9em; padding-left: 1mm; }
  .k-note { font-size: 0.88em; font-style: italic; padding-left: 1mm; }
  .cut { border-top: 1px dashed #000; margin: 20mm 0 15mm; }
  </style></head><body><main>
  ${kitchen}
  <header>
    ${
      profile.showLogo
        ? `<div class="stamp-wrap">
      <img src="${RECEIPT_LOGO_DATA_URI}" alt="${escapeHtml(profile.name)}" class="receipt-logo" />
    </div>`
        : ''
    }
    <h1>${escapeHtml(profile.name)}</h1>
    ${profile.tagline ? `<p class="tagline">${escapeHtml(profile.tagline)}</p>` : ''}
    ${profile.addressLine1 ? `<p class="addr">${escapeHtml(profile.addressLine1)}</p>` : ''}
    ${profile.addressLine2 ? `<p class="addr">${escapeHtml(profile.addressLine2)}</p>` : ''}
    ${profile.phone ? `<p class="tel">Tel: ${escapeHtml(profile.phone)}</p>` : ''}
    <div class="inv-banner">${escapeHtml(orderBadge)}</div>
    <div class="copy-tag">*** Customer Copy ***</div>
  </header>
  <div class="title">ORDER RECEIPT</div>
  <div class="heavy-rule"></div>
  ${orderDetails}
  ${deliveryDetails}
  <div class="rule"></div>
  <span class="sr-only">ITEMS</span>
  <table class="items-tbl">
    <thead>
      ${
        settings.printItemPrices
          ? '<tr><th>Item</th><th class="num">Rate</th><th class="num">Qty</th><th class="num">Amount</th></tr>'
          : '<tr><th>Item</th><th class="num" colspan="3">Qty</th></tr>'
      }
    </thead>
    <tbody>
      ${items}
    </tbody>
  </table>
  <div class="heavy-rule"></div>
  ${totals}
  ${paymentsBlock}
  ${footer}
  </main></body></html>`;
}
