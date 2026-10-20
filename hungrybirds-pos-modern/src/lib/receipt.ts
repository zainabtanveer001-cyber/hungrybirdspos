import { formatAmount } from './format';
import { getPrinterSettings } from './printer';
import type { PrinterSettings } from './printer';
import type { Sale } from './db/types';

/**
 * Prints through a hidden iframe: the POS tab keeps its cart and open modals,
 * unlike a new window.
 */
export async function printReceipt(sale: Sale): Promise<void> {
  const settings = await getPrinterSettings();
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error('Could not prepare the receipt for printing.');
  }
  doc.open();
  doc.write(receiptDocument(sale, settings));
  doc.close();
  const cleanUp = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow?.addEventListener('afterprint', cleanUp, { once: true });
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  // Safari does not fire afterprint for iframes.
  cleanUp();
}

/** Native share sheet on mobile, WhatsApp web otherwise. */
export async function shareReceipt(sale: Sale): Promise<void> {
  const text = receiptText(sale);
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

export const RESTAURANT = {
  name: 'HUNGRY BIRDS RESTAURANT',
  phone: '0325-7867774',
  address: 'Dubai Park Stop, Main GT Road Lahore',
};

/** Everything a thermal printer receives, kept as text so a share message is one line per item. */
export function receiptLines(sale: Sale): string[] {
  const lines: string[] = [`Order #${sale.id}`, new Date(sale.timestamp).toLocaleString()];
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
export function receiptText(sale: Sale): string {
  return [`*${RESTAURANT.name}*`, ...receiptLines(sale)].join('\n');
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
  small: '8pt',
  normal: '10pt',
  large: '12pt',
};

/**
 * Standalone receipt document, sized to the configured paper. Printed into a
 * hidden iframe rather than a new window so the POS tab keeps its state.
 */
export function receiptDocument(sale: Sale, settings: PrinterSettings): string {
  const width = settings.paperWidth === '58mm' ? '54mm' : '76mm';
  const items = (sale.items || [])
    .map(
      (item) => `<section class="item">
    <div class="name">${escapeHtml(item.name)}</div>
    <div class="row"><span>${escapeHtml(item.qty)} x ${escapeHtml(formatAmount(item.price))}</span><strong>${escapeHtml(formatAmount(item.price * item.qty))}</strong></div>
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

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${escapeHtml(sale.id)}</title><style>
  @page { size: ${settings.paperWidth} auto; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body { width: ${width}; margin: 0; padding: 0; color: #000; background: #fff; }
  body { font: ${FONT_PT[settings.receiptFontSize] ?? '10pt'}/1.3 "Courier New", monospace; }
  main { width: ${width}; padding: 0 1mm 3mm; }
  header { text-align: center; padding-bottom: 2mm; border-bottom: 1px dashed #000; }
  header h1 { margin: 0 0 1mm; font-size: 1.35em; }
  p { margin: 0; }
  .title { margin: 2mm 0; text-align: center; font-weight: bold; }
  .rule { margin: 2mm 0; border-top: 1px dashed #000; }
  .item { padding: 1.5mm 0; border-bottom: 1px dashed #777; }
  .name { overflow-wrap: anywhere; font-weight: bold; }
  .row { display: flex; justify-content: space-between; gap: 2mm; margin: 1mm 0; }
  .row span:last-child, .row strong { white-space: nowrap; }
  .grand { margin-top: 2mm; padding: 2mm 0; border-top: 1px solid #000; border-bottom: 1px solid #000; font-size: 1.2em; font-weight: bold; }
  .muted { font-size: 0.9em; }
  footer { margin-top: 3mm; text-align: center; }
  </style></head><body><main>
  <header>${settings.receiptLogo ? '' : `<h1>${escapeHtml(RESTAURANT.name)}</h1>`}<p>Ph: ${escapeHtml(RESTAURANT.phone)}</p><p>${escapeHtml(RESTAURANT.address)}</p></header>
  <div class="title">ORDER RECEIPT</div>
  <div>
    <div>Order ID: #${escapeHtml(sale.id)}</div>
    <div>Date: ${escapeHtml(new Date(sale.timestamp).toLocaleString())}</div>
    <div>Server: ${escapeHtml(sale.serverUser || 'Staff')}</div>
    <div>Type: ${escapeHtml(sale.orderType)}</div>
    ${sale.orderType === 'DINE_IN' ? '<div>Table: Counter Service</div>' : ''}
    ${
      sale.orderType === 'DELIVERY' && sale.deliveryInfo
        ? `<div class="rule"></div><strong>DELIVERY DETAILS</strong>
          <div>Name: ${escapeHtml(sale.deliveryInfo.name || 'N/A')}</div>
          <div>Phone: ${escapeHtml(sale.deliveryInfo.phone || 'N/A')}</div>
          <div>Address: ${escapeHtml(sale.deliveryInfo.address || 'N/A')}</div>`
        : ''
    }
  </div>
  <div class="rule"></div><strong>ITEMS</strong>${items}
  <div>
    ${totalRow('Subtotal', sale.subtotal)}
    ${totalRow(`Discount ${sale.discountPercent || 0}%`, sale.discountAmount, '-')}
    ${totalRow('Delivery charge', sale.deliveryCharge)}
    ${totalRow('Packing charge', sale.packingCharge)}
    ${totalRow(`Tax ${sale.taxPercent || 0}%`, sale.taxAmount)}
    ${totalRow('Other charges', sale.otherCharge)}
    <div class="row grand"><span>GRAND TOTAL</span><span>${escapeHtml(formatAmount(sale.total))}</span></div>
    ${payments ? `<div class="rule"></div><strong>PAYMENTS</strong>${payments}` : ''}
    ${totalRow('Change to return', sale.totalChange)}
  </div>
  <footer><p>${sale.orderType === 'DELIVERY' ? 'Thank you for ordering delivery!' : sale.orderType === 'TAKEAWAY' ? 'Thank you for choosing takeaway!' : 'Thank you for dining with us!'}</p></footer>
  </main></body></html>`;
}
