import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bluetooth, Cable, Check, Cpu, Printer, Wifi, X } from 'lucide-react';
import { encodeQrMatrix, normalizeQrUrl } from '../lib/receiptQr';
import {
  disconnectPrinterDevice,
  disconnectSerialPrinter,
  disconnectUsbPrinter,
  getPrinterDevice,
  getPrinterSettings,
  getSerialPrinterPort,
  getUsbPrinterDevice,
  isUsbAccessDeniedError,
  pairPrinterDevice,
  pairSerialPrinter,
  pairUsbPrinter,
  printTestReceipt,
  receiptFontClass,
  restorePrinterDevice,
  savePrinterSettings,
} from '../lib/printer';
import type {
  BluetoothDeviceLike,
  DateFormat,
  PrinterConnectionType,
  PrinterSettings,
  ReceiptFontSize,
  SerialPortLike,
  UsbDeviceLike,
} from '../lib/printer';
import { logAudit } from '../lib/audit';
import { formatAmount } from '../lib/format';
import { formatBillTimestamp, formatDecimal, printBrowserTestReceipt, resolveReceiptProfile, RESTAURANT } from '../lib/receipt';
import { RECEIPT_LOGO_DATA_URI } from '../lib/receiptLogo';
import { Modal } from './Modal';

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

const CONNECTION_TYPES: Array<{ value: PrinterConnectionType; label: string; icon: typeof Bluetooth }> = [
  { value: 'browser', label: 'System / Windows (USB)', icon: Printer },
  { value: 'bluetooth', label: 'Bluetooth (BLE)', icon: Bluetooth },
  { value: 'usb', label: 'USB Cable (Raw)', icon: Cable },
  { value: 'serial', label: 'Serial / COM Port', icon: Cpu },
  { value: 'lan', label: 'LAN / Wi-Fi IP', icon: Wifi },
];

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

/** The "what to print" switches, in the order they appear on the receipt. */
const PRINT_OPTIONS: Array<[keyof PrinterSettings, string]> = [
  ['showLogo', 'Hungry Birds B&W logo at top'],
  ['printOrderDetails', 'Order details (Bill #, date, cashier, order type/table)'],
  ['printDeliveryDetails', 'Customer & delivery details (name, phone, address)'],
  ['printItemPrices', 'Item rate, qty, and amount columns'],
  ['printTotals', 'Subtotal, discounts, loyalty, charges & total amount'],
  ['printPayments', 'Payment method, cash received, change & PAID stamp'],
  ['printFooter', 'Online payment box, QR code & thank-you footer'],
];

export function PrinterSettingsModal({ username, notify, preview, onClose }: {
  username: string;
  notify: (message: string) => void;
  preview: { title: string; lines: Array<[string, string]>; total: number } | null;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<PrinterSettings | null>(null);
  const [btDevice, setBtDevice] = useState<BluetoothDeviceLike | null>(() => getPrinterDevice());
  const [usbDevice, setUsbDevice] = useState<UsbDeviceLike | null>(() => getUsbPrinterDevice());
  const [serialPort, setSerialPort] = useState<SerialPortLike | null>(() => getSerialPrinterPort());
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [usbAccessDenied, setUsbAccessDenied] = useState(false);
  const [previewTime] = useState(() => Date.now());

  useEffect(() => {
    getPrinterSettings().then(setSettings);
    restorePrinterDevice().then(() => {
      setBtDevice(getPrinterDevice());
      setUsbDevice(getUsbPrinterDevice());
      setSerialPort(getSerialPrinterPort());
    });
  }, []);

  const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const hasUsb = typeof navigator !== 'undefined' && 'usb' in navigator;
  const hasSerial = typeof navigator !== 'undefined' && 'serial' in navigator;

  async function connectBluetooth() {
    if (!hasBluetooth) {
      notify('Web Bluetooth needs Chrome or Edge on desktop, or Android.');
      return;
    }
    setConnecting(true);
    try {
      const picked = await pairPrinterDevice();
      setBtDevice(picked);
      notify(`Connected to ${picked.name || 'Bluetooth thermal printer'}.`);
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') {
        notify(err instanceof Error ? err.message : 'Could not pair the Bluetooth printer.');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function connectUsb() {
    if (!hasUsb) {
      notify('WebUSB needs Chrome or Edge on desktop or Android.');
      return;
    }
    setConnecting(true);
    setUsbAccessDenied(false);
    try {
      const picked = await pairUsbPrinter();
      setUsbDevice(picked);
      notify(`Connected to ${picked.productName || 'USB thermal printer'}.`);
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') {
        if (isUsbAccessDeniedError(err)) {
          setUsbAccessDenied(true);
        }
        notify(err instanceof Error ? err.message : 'Could not connect USB printer.');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function connectSerial() {
    if (!hasSerial) {
      notify('WebSerial needs Chrome or Edge on desktop.');
      return;
    }
    setConnecting(true);
    try {
      const port = await pairSerialPrinter();
      setSerialPort(port);
      notify('Serial / COM printer port selected.');
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') {
        notify(err instanceof Error ? err.message : 'Could not open Serial/COM port.');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function testPrint() {
    if (!settings) return;
    setTesting(true);
    try {
      await savePrinterSettings(settings);
      if (settings.connectionType === 'browser') {
        await printBrowserTestReceipt(settings);
        notify('Test receipt opened for your system printer.');
      } else {
        await printTestReceipt(settings.headerText || RESTAURANT.name);
        notify(`Test receipt sent via ${settings.connectionType.toUpperCase()}.`);
      }
    } catch (err) {
      if (isUsbAccessDeniedError(err)) {
        setUsbAccessDenied(true);
      }
      const message = err instanceof Error ? err.message : 'Test print failed.';
      notify(message);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!settings) return;
    await savePrinterSettings(settings);
    await logAudit(
      'PRINTER_SETTINGS_UPDATED',
      `Mode ${settings.connectionType}, Receipt ${settings.receiptFontSize}, ${settings.paperWidth}, auto-print ${settings.autoPrint ? 'on' : 'off'}, kitchen ticket ${settings.printKitchenTicket ? 'on' : 'off'}`,
      username,
    );
    notify('Printer settings saved.');
    onClose();
  }

  const connectionType = settings?.connectionType || 'bluetooth';
  const rawQrUrl = settings?.qrUrl ?? '';
  const normalizedQrUrl = useMemo(() => normalizeQrUrl(rawQrUrl), [rawQrUrl]);

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
          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-3">
            <SectionTitle>Thermal Printer Connection</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {CONNECTION_TYPES.map((item) => {
                const Icon = item.icon;
                const active = connectionType === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => {
                      setUsbAccessDenied(false);
                      setSettings({ ...settings, connectionType: item.value });
                    }}
                    className={`flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-xl text-xs font-bold border transition ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            {connectionType === 'browser' && (
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                  <span className="text-gray-800 font-medium">
                    Uses your installed Windows / macOS USB or network printer driver (no WebUSB Access Denied error)
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={testPrint}
                    disabled={testing}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Printer className="w-3.5 h-3.5" aria-hidden />
                    {testing ? 'Opening...' : 'Test Print'}
                  </button>
                </div>
                <p className="text-[11px] text-gray-700 leading-relaxed">
                  Select your USB thermal printer once in the Chrome/Edge print dialog and uncheck headers &amp; footers.
                  For <strong>1-click silent printing</strong> without the popup, launch Chrome or Edge with{' '}
                  <code className="px-1 py-0.5 bg-white border border-emerald-200 rounded text-[10px]">--kiosk-printing</code>.
                </p>
              </div>
            )}

            {connectionType === 'bluetooth' && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${btDevice ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden />
                  <span className="text-gray-700 font-medium">
                    {btDevice ? `Paired with ${btDevice.name || btDevice.id.slice(0, 8)}` : 'No Bluetooth printer paired'}
                  </span>
                  {btDevice && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={connectBluetooth}
                    disabled={connecting || !hasBluetooth}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Bluetooth className="w-3.5 h-3.5" aria-hidden />
                    {connecting ? 'Pairing...' : btDevice ? 'Change Printer' : 'Pair Bluetooth Printer'}
                  </button>
                  {btDevice && (
                    <>
                      <button
                        type="button"
                        onClick={testPrint}
                        disabled={testing}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden />
                        {testing ? 'Printing...' : 'Test Print'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          disconnectPrinterDevice().catch(() => {});
                          setBtDevice(null);
                          notify('Bluetooth printer disconnected.');
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden /> Disconnect
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-gray-500">
                  Works with BLE ESC/POS printers (58mm &amp; 80mm). If your Bluetooth printer is paired in Windows as a COM port (Bluetooth Classic SPP), choose <strong>Serial / COM Port</strong> above.
                </p>
              </div>
            )}

            {connectionType === 'usb' && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${usbDevice ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden />
                  <span className="text-gray-700 font-medium">
                    {usbDevice
                      ? `Connected to ${usbDevice.productName || `USB (${usbDevice.vendorId.toString(16)}:${usbDevice.productId.toString(16)})`}`
                      : 'No USB printer connected'}
                  </span>
                  {usbDevice && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={connectUsb}
                    disabled={connecting || !hasUsb}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Cable className="w-3.5 h-3.5" aria-hidden />
                    {connecting ? 'Connecting...' : usbDevice ? 'Change USB Printer' : 'Connect USB Printer'}
                  </button>
                  {usbDevice && (
                    <>
                      <button
                        type="button"
                        onClick={testPrint}
                        disabled={testing}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden />
                        {testing ? 'Printing...' : 'Test Print'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          disconnectUsbPrinter().catch(() => {});
                          setUsbDevice(null);
                          setUsbAccessDenied(false);
                          notify('USB printer disconnected.');
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden /> Disconnect
                      </button>
                    </>
                  )}
                </div>

                {usbAccessDenied && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 space-y-2 text-xs"
                  >
                    <div className="flex items-start gap-2 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden />
                      <span>
                        Windows blocked WebUSB (<code>Access denied</code>) because your printer’s Windows driver (<code>usbprint.sys</code>) is holding the USB port.
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setUsbAccessDenied(false);
                          setSettings({ ...settings, connectionType: 'browser' });
                          notify('Switched to System / Windows (USB) mode. Click Save Settings or Test Print.');
                        }}
                        className="px-3 py-2 rounded-lg text-xs font-bold bg-[#2941e0] text-white hover:bg-[#1f35c4] transition"
                      >
                        Use System / Windows Printer (Recommended)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUsbAccessDenied(false);
                          setSettings({ ...settings, connectionType: 'serial' });
                          notify('Switched to Serial / COM Port mode.');
                        }}
                        className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-amber-400 text-amber-950 hover:bg-amber-100 transition"
                      >
                        Try Serial / COM Port
                      </button>
                    </div>
                    <details className="text-[11px] text-amber-900">
                      <summary className="cursor-pointer font-semibold underline">
                        Advanced: Enable raw WebUSB on Windows (Zadig) or Linux
                      </summary>
                      <ul className="list-disc pl-4 mt-1.5 space-y-1">
                        <li>
                          <strong>Windows (Zadig):</strong> Download Zadig → Options → List All Devices → select your thermal printer → replace driver with <strong>WinUSB</strong>. (Note: replacing the driver stops regular Windows apps like Notepad/Word from seeing that printer until reverted.)
                        </li>
                        <li>
                          <strong>Linux:</strong> Add a <code>udev</code> rule granting user read/write permission to the printer’s USB vendor/product ID.
                        </li>
                      </ul>
                    </details>
                  </div>
                )}

                <p className="text-[10px] text-gray-500">
                  Direct WebUSB ESC/POS requires <strong>WinUSB</strong> on Windows (or Android OTG). If you installed the standard Windows printer driver, switch to <strong>System / Windows (USB)</strong> or <strong>Serial / COM Port</strong>.
                </p>
              </div>
            )}

            {connectionType === 'serial' && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full ${serialPort ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden />
                    <span className="text-gray-700 font-medium">
                      {serialPort ? 'Serial / COM port ready' : 'No Serial / COM port selected'}
                    </span>
                    {serialPort && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="font-bold text-[10px] uppercase">Baud Rate:</span>
                    <select
                      value={settings.serialBaudRate || 9600}
                      onChange={(e) => setSettings({ ...settings, serialBaudRate: Number(e.target.value) || 9600 })}
                      className="p-1.5 text-xs rounded-lg border border-gray-200 bg-white font-semibold"
                    >
                      {BAUD_RATES.map((rate) => (
                        <option key={rate} value={rate}>{rate}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={connectSerial}
                    disabled={connecting || !hasSerial}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Cpu className="w-3.5 h-3.5" aria-hidden />
                    {connecting ? 'Opening...' : serialPort ? 'Change COM Port' : 'Select Serial / COM Port'}
                  </button>
                  {serialPort && (
                    <>
                      <button
                        type="button"
                        onClick={testPrint}
                        disabled={testing}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden />
                        {testing ? 'Printing...' : 'Test Print'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          disconnectSerialPrinter().catch(() => {});
                          setSerialPort(null);
                          notify('Serial printer disconnected.');
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden /> Disconnect
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-gray-500">
                  Ideal for <strong>USB-Serial</strong> printers and <strong>Bluetooth Classic (SPP)</strong> thermal printers paired in Windows/macOS as a COM port.
                </p>
              </div>
            )}

            {connectionType === 'lan' && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="sm:col-span-2 block">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
                      Printer IP / Hostname
                    </span>
                    <input
                      type="text"
                      value={settings.lanIp || ''}
                      onChange={(e) => setSettings({ ...settings, lanIp: e.target.value })}
                      placeholder="192.168.1.200"
                      className="w-full p-2 text-xs ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
                      Port
                    </span>
                    <input
                      type="number"
                      value={settings.lanPort || 9100}
                      onChange={(e) => setSettings({ ...settings, lanPort: Number(e.target.value) || 9100 })}
                      placeholder="9100"
                      className="w-full p-2 text-xs ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <span className="text-[10px] font-bold uppercase text-gray-600">Protocol:</span>
                    <select
                      value={settings.lanProtocol || 'http'}
                      onChange={(e) =>
                        setSettings({ ...settings, lanProtocol: e.target.value as 'http' | 'websocket' })
                      }
                      className="p-1.5 text-xs rounded-lg border border-gray-200 bg-white font-semibold"
                    >
                      <option value="http">HTTP POST (Direct / Print Bridge)</option>
                      <option value="websocket">WebSocket (ws://IP:Port)</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={testPrint}
                    disabled={testing || !settings.lanIp?.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Printer className="w-3.5 h-3.5" aria-hidden />
                    {testing ? 'Sending...' : 'Test LAN Print'}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500">
                  Sends raw ESC/POS bytes over Wi-Fi / Ethernet to network thermal printers or a local print relay. If unreachable, receipts automatically fall back to the browser print dialog.
                </p>
              </div>
            )}
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>Receipt appearance</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
            </div>

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

          <section className="p-3.5 rounded-2xl border border-[#e0edff] bg-white space-y-2.5">
            <SectionTitle>Store Header &amp; Contact</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">Restaurant name</span>
                <input
                  type="text"
                  value={settings.headerText}
                  onChange={(e) => setSettings({ ...settings, headerText: e.target.value })}
                  placeholder={RESTAURANT.name}
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">Tagline (optional)</span>
                <input
                  type="text"
                  value={settings.tagline ?? RESTAURANT.tagline}
                  onChange={(e) => setSettings({ ...settings, tagline: e.target.value })}
                  placeholder={RESTAURANT.tagline}
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">Address line 1</span>
                <input
                  type="text"
                  value={settings.addressLine1 ?? RESTAURANT.addressLine1}
                  onChange={(e) => setSettings({ ...settings, addressLine1: e.target.value })}
                  placeholder={RESTAURANT.addressLine1}
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">Address line 2</span>
                <input
                  type="text"
                  value={settings.addressLine2 ?? RESTAURANT.addressLine2}
                  onChange={(e) => setSettings({ ...settings, addressLine2: e.target.value })}
                  placeholder={RESTAURANT.addressLine2}
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">Phone / Hotline</span>
                <input
                  type="text"
                  value={settings.phone ?? RESTAURANT.phone}
                  onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                  placeholder={RESTAURANT.phone}
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">Date format</span>
                <select
                  value={settings.dateFormat}
                  onChange={(e) => setSettings({ ...settings, dateFormat: e.target.value as DateFormat })}
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                >
                  {DATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="p-3.5 rounded-2xl border border-[#e0edff] bg-white space-y-2.5">
            <SectionTitle>Online Payment Box, QR Code &amp; Footer</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">Payment method</span>
                <input
                  type="text"
                  value={settings.accountMethod ?? RESTAURANT.accountMethod}
                  onChange={(e) => setSettings({ ...settings, accountMethod: e.target.value })}
                  placeholder="Jazzcash/Easypaisa"
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">Account title</span>
                <input
                  type="text"
                  value={settings.accountTitle ?? RESTAURANT.accountTitle}
                  onChange={(e) => setSettings({ ...settings, accountTitle: e.target.value })}
                  placeholder={RESTAURANT.accountTitle}
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">Account number</span>
                <input
                  type="text"
                  value={settings.accountNumber ?? RESTAURANT.accountNumber}
                  onChange={(e) => setSettings({ ...settings, accountNumber: e.target.value })}
                  placeholder={RESTAURANT.accountNumber}
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">
                  QR Code URL (optional — reviews, menu, or WhatsApp)
                </span>
                <input
                  type="text"
                  inputMode="url"
                  value={settings.qrUrl ?? ''}
                  onChange={(e) => setSettings({ ...settings, qrUrl: e.target.value })}
                  placeholder="https://maps.app.goo.gl/... or https://wa.me/923257867774"
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
                {normalizedQrUrl && normalizedQrUrl !== rawQrUrl.trim() && (
                  <span className="block text-[11px] text-[#273238] mt-1 break-all">
                    Encoded URL: {normalizedQrUrl}
                  </span>
                )}
                {normalizedQrUrl.length > 120 && (
                  <span className="block text-[11px] text-[#616f75] mt-0.5">
                    Tip: For fastest scanning on small thermal paper, use Google Maps → Share → Copy link (maps.app.goo.gl/...).
                  </span>
                )}
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-[#273238] mb-1">QR caption</span>
                <input
                  type="text"
                  value={settings.qrLabel ?? 'Scan to order or leave a review'}
                  onChange={(e) => setSettings({ ...settings, qrLabel: e.target.value })}
                  placeholder="Scan to order or leave a review"
                  className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-xs font-medium text-[#273238] mb-1">Custom thank-you footer</span>
              <input
                type="text"
                value={settings.footerText}
                onChange={(e) => setSettings({ ...settings, footerText: e.target.value })}
                placeholder="Thank you for dining with us!"
                className="w-full px-3 h-9 text-xs border border-[#788991] rounded-[8px] bg-white text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
              />
              <span className="block text-xs text-[#616f75] mt-1">
                Leave empty to use the order-type thank-you message automatically.
              </span>
            </label>
          </section>

          <LiveReceiptPreview
            settings={settings}
            username={username}
            preview={preview}
            previewTime={previewTime}
          />
        </div>
      )}
    </Modal>
  );
}

function LiveReceiptPreview({
  settings,
  username,
  preview,
  previewTime,
}: {
  settings: PrinterSettings;
  username: string;
  preview: { title: string; lines: Array<[string, string]>; total: number } | null;
  previewTime: number;
}) {
  const profile = resolveReceiptProfile(settings);
  const qrMatrix = useMemo(() => encodeQrMatrix(profile.qrUrl, 4), [profile.qrUrl]);

  const sampleLines: Array<[string, string]> = preview?.lines.length
    ? preview.lines
    : [
        ['2 × Crispy Zinger Burger (+ Extra Cheese)', formatAmount(1540)],
        ['1 × Loaded Fries', formatAmount(450)],
      ];
  const sampleTotal = preview?.total ?? 1990;
  const sampleBadge = preview ? preview.title.toUpperCase() : 'DINE IN - TABLE T4';

  return (
    <section className="p-3.5 rounded-2xl border border-dashed border-[#788991] bg-[#f8fafd]">
      <SectionTitle>Live Thermal Receipt Preview · {settings.paperWidth}</SectionTitle>
      <div
        className={`mx-auto mt-2 bg-white border border-[#d4d4d8] rounded-xl p-3.5 shadow-sm ${receiptFontClass(settings.receiptFontSize)} font-mono text-[#000000]`}
        style={{ width: settings.paperWidth === '58mm' ? 236 : 316 }}
      >
        {settings.printKitchenTicket && (
          <>
            <div className="border-y-2 border-black text-black text-center font-black py-1 px-2 text-[11px] tracking-wider">
              KITCHEN ORDER (KOT)
            </div>
            <div className="text-center font-bold text-[11px] mt-1">{sampleBadge}</div>
            <div className="text-center text-[10px] text-[#526066]">
              Bill #HBR-42 · Server: {username}
            </div>
            <div className="border-t-2 border-black my-1.5" />
            <div className="font-bold text-xs">2x Crispy Zinger Burger</div>
            <div className="text-[10px] pl-3 text-[#273238]">+ Extra Cheese, Extra Jalapenos</div>
            <div className="border-t-2 border-black my-1.5" />
            <div className="my-3 border-t border-dashed border-[#788991]" />
          </>
        )}

        {profile.showLogo && (
          <div className="flex justify-center mb-1.5">
            <img
              src={RECEIPT_LOGO_DATA_URI}
              alt={profile.name}
              className="block mx-auto h-auto"
              style={{ width: settings.paperWidth === '58mm' ? 56 : 68 }}
            />
          </div>
        )}

        <div className="text-center font-black text-sm tracking-tight">{profile.name}</div>
        {profile.tagline && <div className="text-center text-[10px] italic text-[#273238]">{profile.tagline}</div>}
        <div className="text-center text-[10px] text-[#273238] leading-tight mt-0.5">
          {profile.addressLine1 && <div>{profile.addressLine1}</div>}
          {profile.addressLine2 && <div>{profile.addressLine2}</div>}
          {profile.phone && <div className="font-bold mt-0.5">Tel: {profile.phone}</div>}
        </div>

        <div className="border-y border-black text-black text-center font-black py-1 px-2 mt-2 text-[11px] tracking-wider">
          {sampleBadge}
        </div>
        <div className="text-center text-[10px] text-[#526066] mt-0.5">*** Customer Copy ***</div>

        <div className="border-t-2 border-black my-1.5" />

        {settings.printOrderDetails && (
          <div className="text-[10px] pb-1.5 border-b border-dashed border-black mb-1.5 space-y-0.5">
            <div className="flex justify-between font-bold">
              <span>Bill #HBR-42</span>
              <span>{formatBillTimestamp(previewTime)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cashier: {username}</span>
              <span>Table: T4</span>
            </div>
          </div>
        )}

        {settings.printDeliveryDetails && (
          <div className="text-[10px] pb-1.5 border-b border-dashed border-black mb-1.5 space-y-0.5">
            <div className="font-bold">CUSTOMER DETAILS</div>
            <div>Customer: Ayesha Khan</div>
            <div>Phone: 0300-1234567</div>
          </div>
        )}

        <div className="flex justify-between text-[10px] font-bold border-b border-dashed border-black pb-0.5 mb-1">
          <span>Item</span>
          <span>{settings.printItemPrices ? 'Rate · Qty · Amt' : 'Qty'}</span>
        </div>

        <div className="space-y-1">
          {sampleLines.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2 text-[11px]">
              <span className="font-semibold break-words">{label}</span>
              <span className="tabular-nums font-bold shrink-0">{settings.printItemPrices ? value : '1x'}</span>
            </div>
          ))}
        </div>

        {settings.printTotals && (
          <>
            <div className="mt-2 border-y-2 border-black text-black flex justify-between items-center font-black py-1.5 text-xs">
              <span>TOTAL AMOUNT</span>
              <span className="tabular-nums">Rs {formatDecimal(sampleTotal)}</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold border-b border-dashed border-black py-1 mt-0.5">
              <span>Total Items: {sampleLines.length}</span>
              <span>Total Qty: {sampleLines.length}</span>
            </div>
          </>
        )}

        {settings.printPayments && (
          <div className="text-[10px] py-1.5 border-b border-dashed border-black space-y-0.5">
            <div className="font-bold">PAYMENTS</div>
            <div className="flex justify-between">
              <span>Paid (Cash)</span>
              <span className="tabular-nums">Rs {formatDecimal(sampleTotal)}</span>
            </div>
            <div className="text-center font-black tracking-widest pt-0.5">*** PAID ***</div>
          </div>
        )}

        {settings.printFooter && (
          <div className="mt-1.5 text-[10px] space-y-1.5">
            {(profile.accountMethod || profile.accountTitle || profile.accountNumber) && (
              <div className="border border-black p-1.5 space-y-0.5">
                <div className="text-center font-bold">ONLINE PAYMENT</div>
                {profile.accountMethod && (
                  <div className="flex justify-between">
                    <span>Method</span>
                    <span>{profile.accountMethod}</span>
                  </div>
                )}
                {profile.accountTitle && (
                  <div className="flex justify-between">
                    <span>Title</span>
                    <span>{profile.accountTitle}</span>
                  </div>
                )}
                {profile.accountNumber && (
                  <div className="flex justify-between">
                    <span>Account</span>
                    <span>{profile.accountNumber}</span>
                  </div>
                )}
              </div>
            )}

            {qrMatrix && (
              <div className="text-center pt-1">
                <svg
                  width={settings.paperWidth === '58mm' ? 104 : 124}
                  height={settings.paperWidth === '58mm' ? 104 : 124}
                  viewBox={`0 0 ${qrMatrix.size} ${qrMatrix.size}`}
                  shapeRendering="crispEdges"
                  className="block mx-auto bg-white"
                  role="img"
                  aria-label="Receipt QR code preview"
                >
                  <rect width={qrMatrix.size} height={qrMatrix.size} fill="#ffffff" />
                  {qrMatrix.data.map((row, y) =>
                    row.map((dark, x) =>
                      dark ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000000" /> : null,
                    ),
                  )}
                </svg>
                <p className="text-[9px] text-[#273238] mt-1">{profile.qrLabel}</p>
              </div>
            )}

            <div className="text-center border-t border-dashed border-black pt-1.5">
              <p className="font-bold">{settings.footerText?.trim() || 'Thank you for dining with us!'}</p>
              <p className="text-[10px]">Please visit us again!</p>
              {profile.phone && <p className="text-[10px] mt-0.5">Order &amp; Support: {profile.phone}</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-wide text-[#273238]">{children}</p>;
}
