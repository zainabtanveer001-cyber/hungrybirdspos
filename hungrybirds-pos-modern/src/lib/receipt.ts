import { formatAmount } from './format';
import { DEFAULT_PRINTER_SETTINGS, getPrinterSettings, printRaw } from './printer';
import type { PrinterSettings } from './printer';
import type { CartItem, Sale } from './db/types';
import { EscPosEncoder } from './escpos';

export const RESTAURANT = {
  name: 'Hungry Birds Restaurant',
  phone: '0325-7867774',
  address: 'Dubai Park Stop, Main GT Road Lahore',
};

/**
 * Encodes the sale into raw ESC/POS bytes for thermal printers.
 */
export function generateEscPosReceipt(sale: Sale, settings: PrinterSettings): Uint8Array {
  const encoder = new EscPosEncoder();
  encoder.initialize();

  if (settings.printKitchenTicket) {
    encoder.align('center');
    encoder.bold(true);
    encoder.text('KITCHEN ORDER');
    encoder.bold(false);
    encoder.align('center');
    encoder.text(`Order: #${sale.id}`);
    encoder.text(`By: ${sale.serverUser || 'Staff'}`);
    encoder.text(`Time: ${new Date(sale.timestamp).toLocaleTimeString()}`);
    encoder.text(`Type: ${sale.orderType}`);
    encoder.text('--------------------------------');
    encoder.align('left');
    for (const item of sale.items || []) {
      const modifiers = (item.modifiers || []).map((m) => m.name).join(', ');
      const name = modifiers ? `${item.name} (${modifiers})` : item.name;
      encoder.text(`${item.qty}x ${name}${item.note ? ` - ${item.note}` : ''}`);
    }
    encoder.text('--------------------------------');
    encoder.feed(5);
    encoder.cut();
  }

  // Customer Copy
  encoder.align('center');
  encoder.bold(true);
  encoder.setSize(2, 2);
  encoder.text(settings.headerText || RESTAURANT.name);
  encoder.setSize(0, 0);
  encoder.bold(false);
  encoder.text(`Ph: ${RESTAURANT.phone}`);
  encoder.text(RESTAURANT.address);
  encoder.text(' ');
  encoder.bold(true);
  encoder.text('ORDER RECEIPT');
  encoder.bold(false);
  encoder.text(' ');

  encoder.align('left');
  if (settings.printOrderDetails) {
    encoder.text(`Order ID: #${sale.id}`);
    encoder.text(`Date: ${formatDate(sale.timestamp, settings.dateFormat)}`);
    encoder.text(`Server: ${sale.serverUser || 'Staff'}`);
    encoder.text(`Type: ${sale.orderType}`);
  }

  if (settings.printDeliveryDetails && sale.orderType === 'DELIVERY' && sale.deliveryInfo) {
    encoder.text(' ');
    encoder.bold(true);
    encoder.text('DELIVERY DETAILS');
    encoder.bold(false);
    encoder.text(`Name: ${sale.deliveryInfo.name || 'N/A'}`);
    encoder.text(`Phone: ${sale.deliveryInfo.phone || 'N/A'}`);
    encoder.text(`Address: ${sale.deliveryInfo.address || 'N/A'}`);
  }

  encoder.text(' ');
  encoder.bold(true);
  encoder.text('ITEMS');
  encoder.bold(false);

  for (const item of sale.items || []) {
    const modifiers = (item.modifiers || []).map((m) => m.name).join(', ');
    const name = modifiers ? `${item.name} (${modifiers})` : item.name;
    if (settings.printItemPrices) {
      const price = formatAmount(item.price * item.qty);
      const line = `${name}`.padEnd(20, ' ') + price;
      encoder.text(line.slice(0, 32));
    } else {
      encoder.text(`${item.qty}x ${name}`);
    }
  }

  if (settings.printTotals) {
    encoder.text('--------------------------------');
    const totalRow = (label: string, amount: number, sign = '') => {
      if (!amount) return;
      const line = `${label}`.padEnd(20, ' ') + `${sign}${formatAmount(amount)}`;
      encoder.text(line.slice(0, 32));
    };
    totalRow('Subtotal', sale.subtotal);
    if (sale.discountAmount) totalRow(`Discount ${sale.discountPercent || 0}%`, sale.discountAmount, '-');
    totalRow('Delivery charge', sale.deliveryCharge);
    totalRow('Packing charge', sale.packingCharge);
    totalRow(`Tax ${sale.taxPercent || 0}%`, sale.taxAmount);
    totalRow('Other charges', sale.otherCharge);

    encoder.bold(true);
    const grandLine = `GRAND TOTAL`.padEnd(20, ' ') + formatAmount(sale.total);
    encoder.text(grandLine.slice(0, 32));
    encoder.bold(false);

    if (settings.printPayments) {
      encoder.text(' ');
      encoder.bold(true);
      encoder.text('PAYMENTS');
      encoder.bold(false);
      for (const p of sale.payments || []) {
        const line = `${p.method}`.padEnd(20, ' ') + formatAmount(p.amount);
        encoder.text(line.slice(0, 32));
      }
      if (sale.totalChange) {
        const changeLine = `Change`.padEnd(20, ' ') + formatAmount(sale.totalChange);
        encoder.text(changeLine.slice(0, 32));
      }
    }
  }

  if (settings.printFooter) {
    encoder.text(' ');
    encoder.align('center');
    encoder.text(settings.footerText || (sale.orderType === 'DELIVERY' ? 'Thank you for ordering delivery!' : sale.orderType === 'TAKEAWAY' ? 'Thank you for choosing takeaway!' : 'Thank you for dining with us!'));
  }

  encoder.feed(3);
  encoder.cut();
  return encoder.build();
}

/**
 * Prints through a hidden iframe: the POS tab keeps its cart and open modals,
 * unlike a new window.
 */
export async function printReceipt(sale: Sale): Promise<void> {
  const settings = await getPrinterSettings();

  try {
    const bytes = generateEscPosReceipt(sale, settings);
    await printRaw(bytes);
    return;
  } catch (e) {
    console.warn('Bluetooth print failed, falling back to browser print:', e);
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  frame.srcdoc = receiptDocument(sale, settings);
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
  cleanUp();
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

/** Everything a thermal printer receives, kept as text so a share message is one line per item. */
export function receiptLines(sale: Sale, settings: PrinterSettings = DEFAULT_PRINTER_SETTINGS): string[] {
  const lines: string[] = [`Order #${sale.id}`, formatDate(sale.timestamp, settings.dateFormat)];
  lines.push(`Server: ${sale.serverUser || 'Staff'}`, `Type: ${sale.orderType}`);
  if (sale.orderType === 'DELIVERY' && sale.deliveryInfo) {
    lines.push(
      `Name: ${sale.deliveryInfo.name || '—'}`,
      `Phone: ${sale.deliveryInfo.phone || '—'}`,
      `Address: ${sale.deliveryInfo.address || '—'}`,
    );
  }
  for (const item of sale.items || []) {
    lines.push(`${item.name} x${item.qty}  ${formatAmount(item.price * item.qty)}`);
    if (item.refundedQty) lines.push(`  (refunded ${item.refundedQty})`);
  }
  const rows: [string, number][] = [
    ['Subtotal', sale.subtotal],
    ...(sale.discountAmount ? [[`Discount ${sale.discountPercent || 0}%`, -sale.discountAmount] as [string, number]] : []),
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
  lines.push(sale.orderType === 'DELIVERY' ? 'Thank you for ordering!' : 'Thank you for dining with us!');
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
  small: '10pt',
  normal: '12pt',
  large: '14pt',
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

function itemLine(item: CartItem): string {
  const modifiers = (item.modifiers || []).map((m) => m.name).join(', ');
  return modifiers ? `${item.name} (${modifiers})` : item.name;
}

/**
 * Standalone receipt document, sized to the configured paper. Printed into a
 * hidden iframe rather than a new window so the POS tab keeps its state.
 *
 * The kitchen ticket and the customer copy sit on one sheet with a wide gap
 * between them, so the cook's slip can be torn off without cutting into the
 * receipt.
 */
export function receiptDocument(sale: Sale, settings: PrinterSettings): string {
  const width = settings.paperWidth === '58mm' ? '54mm' : '76mm';
  const items = (sale.items || [])
    .map(
      (item) => `<section class="item">
    <div class="name">${escapeHtml(itemLine(item))}</div>
    ${item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : ''}
    ${
      settings.printItemPrices
        ? `<div class="row"><span>${escapeHtml(item.qty)} x ${escapeHtml(formatAmount(item.price))}</span><strong>${escapeHtml(formatAmount(item.price * item.qty))}</strong></div>`
        : `<div class="row"><span>${escapeHtml(item.qty)} x</span></div>`
    }
  </section>`,
    )
    .join('');
  const payments = (sale.payments || [])
    .map(
      (payment) => `<div class="row"><span>${escapeHtml(payment.method)}</span><span>${escapeHtml(formatAmount(payment.amount))}</span></div>
    ${payment.method === 'Cash' && payment.cashGiven != null ? `<div class="row muted"><span>Given</span><span>${escapeHtml(formatAmount(payment.cashGiven))}</span></div>` : ''}
    ${Number(payment.change) > 0 ? `<div class="row muted"><span>Change</span><span>${escapeHtml(formatAmount(Number(payment.change)))}</span></div>` : ''}`,
    )
    .join('');
  const totalRow = (label: string, amount: number, sign = '') =>
    amount ? `<div class="row"><span>${label}</span><span>${sign}${escapeHtml(formatAmount(amount))}</span></div>` : '';

  const kitchen = settings.printKitchenTicket
    ? `<section class="kitchen">
      <h1>KITCHEN ORDER</h1>
      <div class="k-meta">
        <p>Order: #${escapeHtml(sale.id)}</p>
        <p>By: ${escapeHtml(sale.serverUser || 'Staff')}</p>
        <p>Time: ${escapeHtml(new Date(sale.timestamp).toLocaleTimeString())}</p>
        <p>Type: ${escapeHtml(sale.orderType)}</p>
      </div>
      <div class="k-rule"></div>
      ${(sale.items || [])
        .map(
          (item) => `<div class="k-item">
            <span class="k-qty">${escapeHtml(item.qty)}x</span>
            <span class="k-name">${escapeHtml(itemLine(item))}${item.note ? ` — ${escapeHtml(item.note)}` : ''}</span>
          </div>`,
        )
        .join('')}
      <div class="k-rule"></div>
    </section>
    <div class="cut"></div>`
    : '';

  const orderDetails = settings.printOrderDetails
    ? `<div>
    <div>Order ID: #${escapeHtml(sale.id)}</div>
    <div>Date: ${escapeHtml(formatDate(sale.timestamp, settings.dateFormat))}</div>
    <div>Server: ${escapeHtml(sale.serverUser || 'Staff')}</div>
    <div>Type: ${escapeHtml(sale.orderType)}</div>
    ${sale.orderType === 'DINE_IN' ? '<div>Table: Counter Service</div>' : ''}
  </div>`
    : '';

  const deliveryDetails =
    settings.printDeliveryDetails && sale.orderType === 'DELIVERY' && sale.deliveryInfo
      ? `<div class="rule"></div><strong>DELIVERY DETAILS</strong>
          <div>Name: ${escapeHtml(sale.deliveryInfo.name || 'N/A')}</div>
          <div>Phone: ${escapeHtml(sale.deliveryInfo.phone || 'N/A')}</div>
          <div>Address: ${escapeHtml(sale.deliveryInfo.address || 'N/A')}</div>`
      : '';

  const totals = settings.printTotals
    ? `<div>
    ${totalRow('Subtotal', sale.subtotal)}
    ${totalRow(`Discount ${sale.discountPercent || 0}%`, sale.discountAmount, '-')}
    ${totalRow('Delivery charge', sale.deliveryCharge)}
    ${totalRow('Packing charge', sale.packingCharge)}
    ${totalRow(`Tax ${sale.taxPercent || 0}%`, sale.taxAmount)}
    ${totalRow('Other charges', sale.otherCharge)}
    <div class="row grand"><span>GRAND TOTAL</span><span>${escapeHtml(formatAmount(sale.total))}</span></div>
    ${settings.printPayments && payments ? `<div class="rule"></div><strong>PAYMENTS</strong>${payments}` : ''}
    ${totalRow('Change to return', sale.totalChange)}
  </div>`
    : '';

  const footer = settings.printFooter
    ? `<footer><p>${escapeHtml(
        settings.footerText ||
          (sale.orderType === 'DELIVERY'
            ? 'Thank you for ordering delivery!'
            : sale.orderType === 'TAKEAWAY'
              ? 'Thank you for choosing takeaway!'
              : 'Thank you for dining with us!'),
      )}</p></footer>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${escapeHtml(sale.id)}</title><style>
  @page { size: ${settings.paperWidth} auto; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body { width: ${width}; margin: 0; padding: 0; color: #000; background: #fff; }
  body { font: ${FONT_PT[settings.receiptFontSize] ?? '12pt'}/1.3 "Courier New", monospace; }
  main { width: ${width}; padding: 0 1mm 3mm; }
  header { text-align: center; padding-bottom: 2mm; border-bottom: 1px dashed #000; }
  header h1 { margin: 0 0 1mm; font-size: 1.6em; }
  p { margin: 0; }
  .title { margin: 2mm 0; text-align: center; font-weight: bold; }
  .rule { margin: 2mm 0; border-top: 1px dashed #000; }
  .item { padding: 1.5mm 0; border-bottom: 1px dashed #777; }
  .name { overflow-wrap: anywhere; font-weight: bold; }
  .note { font-size: 0.9em; font-style: italic; }
  .row { display: flex; justify-content: space-between; gap: 2mm; margin: 1mm 0; }
  .row span:last-child, .row strong { white-space: nowrap; }
  .grand { margin-top: 2mm; padding: 2mm 0; border-top: 1px solid #000; border-bottom: 1px solid #000; font-size: 1.2em; font-weight: bold; }
  .muted { font-size: 0.9em; }
  footer { margin-top: 3mm; text-align: center; }
  .kitchen h1 { margin: 0 0 1mm; font-size: 1.3em; text-align: center; }
  .k-meta { text-align: center; margin-bottom: 1.5mm; }
  .k-rule { border-top: 1px dashed #000; margin: 1.5mm 0; }
  .k-item { display: flex; gap: 1.5mm; padding: 0.8mm 0; overflow-wrap: anywhere; }
  .k-qty { font-weight: bold; min-width: 5mm; }
  .k-name { font-weight: bold; }
  .cut { border-top: 1px dashed #000; margin: 20mm 0 15mm; }
  </style></head><body><main>
  ${kitchen}
  <header><h1>${escapeHtml(settings.headerText || RESTAURANT.name)}</h1><p>Ph: ${escapeHtml(RESTAURANT.phone)}</p><p>${escapeHtml(RESTAURANT.address)}</p></header>
  <div class="title">ORDER RECEIPT</div>
  ${orderDetails}
  ${deliveryDetails}
  <div class="rule"></div><strong>ITEMS</strong>${items}
  ${totals}
  ${footer}
  </main></body></html>`;
}
