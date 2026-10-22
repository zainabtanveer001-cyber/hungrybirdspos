import { useEffect, useState } from 'react';
import { Bluetooth, Check, X } from 'lucide-react';
import { getPrinterSettings, receiptFontClass, savePrinterSettings } from '../lib/printer';
import type { DateFormat, PrinterSettings, ReceiptFontSize } from '../lib/printer';
import { logAudit } from '../lib/audit';
import { formatAmount } from '../lib/format';
import { formatDate, RESTAURANT } from '../lib/receipt';
import { Modal } from './Modal';

// Web Bluetooth is Chromium-only and absent from lib.dom for the parts we need.
interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: { connected: boolean; disconnect(): void };
  addEventListener(type: string, listener: () => void): void;
}
type BluetoothLike = {
  requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BluetoothDeviceLike>;
};

const PRINTER_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb';

const FONT_OPTIONS: Array<{ value: ReceiptFontSize; label: string }> = [
  { value: 'small', label: 'Small (compact)' },
  { value: 'normal', label: 'Normal (default)' },
  { value: 'large', label: 'Large (readable)' },
];

const DATE_OPTIONS: Array<{ value: DateFormat; label: string }> = [
  { value: 'locale', label: 'Local (22/10/2026, 5:04 pm)' },
  { value: 'iso', label: 'ISO (2026-10-22)' },
  { value: 'dmy', label: 'Day/Month/Year (22/10/2026)' },
  { value: 'mdy', label: 'Month/Day/Year (10/22/2026)' },
  { value: 'time', label: 'Time only (5:04:22 pm)' },
];

/** The "what to print" switches, in the order they appear on the receipt. */
const PRINT_OPTIONS: Array<[keyof PrinterSettings, string]> = [
  ['printOrderDetails', 'Order details (ID, date, server, order type)'],
  ['printDeliveryDetails', 'Delivery details (name, phone, address)'],
  ['printItemPrices', 'Item prices on every line'],
  ['printTotals', 'Subtotal, discounts, charges and grand total'],
  ['printPayments', 'Payment methods and change'],
  ['printFooter', 'Footer message'],
];

export function PrinterSettingsModal({ username, notify, preview, onClose }: {
  username: string;
  notify: (message: string) => void;
  preview: { title: string; lines: Array<[string, string]>; total: number } | null;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<PrinterSettings | null>(null);
  const [device, setDevice] = useState<BluetoothDeviceLike | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    getPrinterSettings().then(setSettings);
  }, []);

  useEffect(() => () => device?.gatt?.disconnect(), [device]);

  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;

  async function connect() {
    if (!bluetooth) {
      notify('Web Bluetooth needs Chrome or Edge on desktop, or Android.');
      return;
    }
    setConnecting(true);
    try {
      const picked = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [PRINTER_SERVICE] });
      picked.addEventListener('gattserverdisconnected', () => setDevice(null));
      setDevice(picked);
      notify(`Paired with ${picked.name || 'thermal printer'}.`);
    } catch (err) {
      // Cancelling the chooser rejects with NotFoundError — not an error worth a toast.
      if ((err as DOMException)?.name !== 'NotFoundError') notify('Could not pair the printer.');
    } finally {
      setConnecting(false);
    }
  }

  async function save() {
    if (!settings) return;
    await savePrinterSettings(settings);
    await logAudit('PRINTER_SETTINGS_UPDATED', `Receipt ${settings.receiptFontSize}, ${settings.paperWidth}, auto-print ${settings.autoPrint ? 'on' : 'off'}, kitchen ticket ${settings.printKitchenTicket ? 'on' : 'off'}`, username);
    notify('Printer settings saved.');
    onClose();
  }

  return (
    <Modal
      title="Printer & Receipt Settings"
      onClose={onClose}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={!settings} className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            Save Settings
          </button>
        </div>
      }
    >
      {!settings ? (
        <p className="text-xs text-gray-400 text-center py-8">Loading settings...</p>
      ) : (
        <div className="space-y-3">
          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>Receipt appearance</SectionTitle>
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Font size</span>
              <select
                value={settings.receiptFontSize}
                onChange={(e) => setSettings({ ...settings, receiptFontSize: e.target.value as ReceiptFontSize })}
                className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Paper width</span>
              <select
                value={settings.paperWidth}
                onChange={(e) => setSettings({ ...settings, paperWidth: e.target.value as PrinterSettings['paperWidth'] })}
                className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="58mm">58mm (32 chars)</option>
                <option value="80mm">80mm (48 chars)</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoPrint}
                onChange={(e) => setSettings({ ...settings, autoPrint: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Print the receipt automatically when a sale is completed
            </label>

            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.printKitchenTicket}
                onChange={(e) => setSettings({ ...settings, printKitchenTicket: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Print a kitchen ticket above the customer copy
            </label>
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>What to print</SectionTitle>
            {PRINT_OPTIONS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(settings[key])}
                  onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {label}
              </label>
            ))}
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>Receipt text</SectionTitle>
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Header text</span>
              <input
                type="text"
                value={settings.headerText}
                onChange={(e) => setSettings({ ...settings, headerText: e.target.value })}
                placeholder={RESTAURANT.name}
                className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Footer text</span>
              <input
                type="text"
                value={settings.footerText}
                onChange={(e) => setSettings({ ...settings, footerText: e.target.value })}
                placeholder="Thank you for dining with us!"
                className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="block text-[10px] text-gray-500 mt-1">Leave empty to use the built-in thank-you line.</span>
            </label>
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Date format</span>
              <select
                value={settings.dateFormat}
                onChange={(e) => setSettings({ ...settings, dateFormat: e.target.value as DateFormat })}
                className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {DATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </section>

          {preview && (
            <section className="p-3 rounded-xl border border-dashed border-gray-300 bg-gray-50">
              <SectionTitle>Preview · {settings.paperWidth}</SectionTitle>
              <div
                className={`bg-white border border-gray-200 rounded-lg p-3 ${receiptFontClass(settings.receiptFontSize)} font-mono text-gray-800`}
                style={{ width: settings.paperWidth === '58mm' ? 220 : 300 }}
              >
                {settings.printKitchenTicket && (
                  <>
                    <div className="text-center font-black">KITCHEN ORDER</div>
                    <div className="text-center text-gray-500">Order #42 · By: staff</div>
                    <div className="border-t border-dashed border-gray-300 my-1" />
                    <div className="font-bold">2x Zinger Burger</div>
                    <div className="border-t border-dashed border-gray-300 my-1" />
                    <div className="my-3 border-t border-dashed border-gray-400" />
                  </>
                )}
                <div className="text-center font-black pb-1 border-b border-dashed border-gray-300 mb-1">
                  {settings.headerText || RESTAURANT.name}
                </div>
                <p className="text-center font-bold">{preview.title}</p>
                {settings.printOrderDetails && (
                  <p className="text-center text-gray-500 pb-1 border-b border-dashed border-gray-300 mb-1">
                    {formatDate(Date.now(), settings.dateFormat)}
                  </p>
                )}
                {preview.lines.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <span className="truncate">{label}</span>
                    <span className="tabular-nums shrink-0">{value}</span>
                  </div>
                ))}
                {settings.printTotals && (
                  <div className="flex justify-between font-black border-t border-dashed border-gray-300 mt-1 pt-1">
                    <span>TOTAL</span>
                    <span className="tabular-nums">{formatAmount(preview.total)}</span>
                  </div>
                )}
                {settings.printFooter && (
                  <p className="text-center text-gray-500 mt-2">
                    {settings.footerText || 'Thank you for dining with us!'}
                  </p>
                )}
              </div>
            </section>
          )}

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>Bluetooth printer</SectionTitle>
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${device ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden />
              <span className="text-gray-600">{device ? `Connected to ${device.name || device.id.slice(0, 8)}` : 'Not connected'}</span>
              {device && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={connect}
                disabled={connecting || !bluetooth}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Bluetooth className="w-3.5 h-3.5" aria-hidden />
                {connecting ? 'Pairing...' : 'Pair Printer'}
              </button>
              {device && (
                <button
                  type="button"
                  onClick={() => { device.gatt?.disconnect(); setDevice(null); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  <X className="w-3.5 h-3.5" aria-hidden /> Disconnect
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-500">
              The pairing is remembered for this browser tab only. ESC/POS printing is not ported yet — this
              stores the printer choice and receipt layout for when it is.
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-wider text-gray-700">{children}</p>;
}
