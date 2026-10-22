import { db } from './db';
import { EscPosEncoder } from './escpos';

export type ReceiptFontSize = 'small' | 'normal' | 'large';
export type DateFormat = 'locale' | 'iso' | 'dmy' | 'mdy' | 'time';

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
export const PRINTER_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb';

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
let activeDevice: BluetoothDevice | null = null;

export function setPrinterDevice(device: BluetoothDevice | null) {
  activeDevice = device;
}

export function getPrinterDevice() {
  return activeDevice;
}

/**
 * Sends raw bytes to the paired Bluetooth printer.
 */
export async function printRaw(bytes: Uint8Array): Promise<void> {
  const device = activeDevice;
  if (!device) throw new Error('No Bluetooth printer paired. Please pair a printer in settings.');

  const server = await device.gatt?.connect();
  if (!server) throw new Error('Could not connect to printer GATT server.');

  try {
    const service = await server.getPrimaryService(PRINTER_SERVICE);
    const characteristic = await service.getCharacteristic('00002a37-0000-1000-8000-00805f9b34fb');

    const CHUNK_SIZE = 20;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      await characteristic.writeValue(bytes.slice(i, i + CHUNK_SIZE));
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
