import { db } from './db';

export type ReceiptFontSize = 'small' | 'normal' | 'large';
export type DateFormat = 'locale' | 'iso' | 'dmy' | 'mdy' | 'time';

type BluetoothDeviceLike = {
  id: string;
  name?: string;
  gatt?: { connect(): Promise<unknown>; connected: boolean; disconnect(): void; mtu?: number };
  addEventListener(type: string, listener: () => void): void;
}
type BluetoothLike = {
  requestDevice(options: { acceptAllDevices: boolean; deviceId?: string; optionalServices: string[] }): Promise<BluetoothDeviceLike>;
};

export interface PrinterSettings {
  receiptFontSize: ReceiptFontSize;
  paperWidth: '58mm' | '80mm';
  /** Print the receipt by itself as soon as a sale is completed. */
  autoPrint: boolean;
  /** Print a kitchen ticket above the customer copy. */
  printKitchenTicket: boolean;
  /** What the receipt shows. */
  printOrderDetails: boolean;
  printDeliveryDetails: boolean;
  printItemPrices: boolean;
  printTotals: boolean;
  printPayments: boolean;
  printFooter: boolean;
  /** What the receipt says. */
  headerText: string;
  footerText: string;
  dateFormat: DateFormat;
}

export const PRINTER_SETTINGS_KEY = 'printerSettings';
const PRINTER_DEVICE_KEY = 'printerDeviceId';
// Common BLE service/characteristic UUIDs for ESC/POS thermal printers.
// Most printers expose the HM-10 / HM-16 style UART bridge.
export const PRINTER_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const PRINTER_CHARACTERISTIC = '0000ffe1-0000-1000-8000-00805f9b34fb';

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  receiptFontSize: 'normal',
  paperWidth: '80mm',
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
  dateFormat: 'locale',
};

const FONT_CLASS: Record<ReceiptFontSize, string> = {
  small: 'text-[10px]',
  normal: 'text-[12px]',
  large: 'text-[14px]',
};

export function receiptFontClass(size: ReceiptFontSize): string {
  return FONT_CLASS[size] ?? FONT_CLASS.normal;
}

/** Global reference to the paired Bluetooth device. */
let activeDevice: any | null = null;

export async function setPrinterDevice(device: any | null): Promise<void> {
  activeDevice = device;
  if (device) {
    await db.settings.put({ key: PRINTER_DEVICE_KEY, value: device.id });
  } else {
    await db.settings.delete(PRINTER_DEVICE_KEY);
  }
}

export function getPrinterDevice() {
  return activeDevice;
}

/**
 * Reconnects to the last-paired Bluetooth printer using the device id
 * persisted in IndexedDB. Call on app startup and before printing so the
 * pairing survives a page reload.
 */
export async function restorePrinterDevice(): Promise<void> {
  if (activeDevice) return;
  const stored = await db.settings.get(PRINTER_DEVICE_KEY);
  const deviceId = stored?.value as string | undefined;
  if (!deviceId) return;

  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
  if (!bluetooth?.requestDevice) return;

  try {
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      deviceId,
      optionalServices: [PRINTER_SERVICE],
    }) as any;
    device.addEventListener('gattserverdisconnected', () => {
      activeDevice = null;
      setPrinterDevice(null).catch(() => {});
    });
    await device.gatt?.connect();
    activeDevice = device;
  } catch {
    // Printer out of range / permissions lost / user gesture required —
    // degrade gracefully and leave activeDevice null so browser fallback works.
  }
}

/**
 * Sends raw bytes to the paired Bluetooth printer. Chunks stay within the
 * negotiated MTU; many thermal printers reject the BLE default of 20 bytes.
 */
export async function printRaw(bytes: Uint8Array): Promise<void> {
  const device = activeDevice;
  if (!device) throw new Error('No Bluetooth printer paired. Please pair a printer in settings.');

  const server = await device.gatt?.connect();
  if (!server) throw new Error('Could not connect to printer GATT server.');

  try {
    const service = await server.getPrimaryService(PRINTER_SERVICE);
    const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC);

    const mtu = (device as { gatt?: { mtu?: number } }).gatt?.mtu ?? 512;
    const CHUNK_SIZE = Math.min(182, Math.max(20, mtu - 3));
    const write = characteristic.writeValueWithoutResponse?.bind(characteristic) ?? characteristic.writeValue.bind(characteristic);
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      await write(bytes.slice(i, i + CHUNK_SIZE));
    }
  } finally {
    await server.disconnect();
  }
}

export async function getPrinterSettings(): Promise<PrinterSettings> {
  const stored = await db.settings.get(PRINTER_SETTINGS_KEY);
  const merged = { ...DEFAULT_PRINTER_SETTINGS, ...(stored?.value as Partial<PrinterSettings> | undefined) };
  return merged;
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  await db.settings.put({ key: PRINTER_SETTINGS_KEY, value: settings });
}
