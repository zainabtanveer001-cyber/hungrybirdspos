import { db } from './db';
import { EscPosEncoder } from './escpos';

export type ReceiptFontSize = 'small' | 'normal' | 'large';
export type DateFormat = 'locale' | 'iso' | 'dmy' | 'mdy' | 'time';

export type BluetoothCharacteristicLike = {
  uuid?: string;
  properties?: {
    write?: boolean;
    writeWithoutResponse?: boolean;
  };
  writeValue?(value: BufferSource): Promise<void>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
};

export type BluetoothServiceLike = {
  uuid?: string;
  getCharacteristic(characteristic: string): Promise<BluetoothCharacteristicLike>;
  getCharacteristics?(): Promise<BluetoothCharacteristicLike[]>;
};

export type BluetoothGattServerLike = {
  connected: boolean;
  connect(): Promise<BluetoothGattServerLike>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothServiceLike>;
  getPrimaryServices?(): Promise<BluetoothServiceLike[]>;
};

export type BluetoothDeviceLike = {
  id: string;
  name?: string;
  gatt?: BluetoothGattServerLike;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
};

type BluetoothLike = {
  requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BluetoothDeviceLike>;
  getDevices?(): Promise<BluetoothDeviceLike[]>;
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

// Common BLE service/characteristic UUIDs for ESC/POS thermal printers
// (Xprinter, Goojprt, MTP-II, PT-210, Rongta, Sunmi, HM-10/HM-16, ISSC, Nordic UART, Star).
export const PRINTER_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const PRINTER_CHARACTERISTIC = '0000ffe1-0000-1000-8000-00805f9b34fb';

export const PRINTER_SERVICES: string[] = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-41a5-8b53-07423c5a2253',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

const KNOWN_SERVICE_CHARACTERISTICS: Array<[string, string]> = [
  ['000018f0-0000-1000-8000-00805f9b34fb', '00002af1-0000-1000-8000-00805f9b34fb'],
  ['0000ffe0-0000-1000-8000-00805f9b34fb', '0000ffe1-0000-1000-8000-00805f9b34fb'],
  ['49535343-fe7d-41a5-8b53-07423c5a2253', '49535343-8841-43f4-a8d4-ecbe34729bb3'],
  ['0000ff00-0000-1000-8000-00805f9b34fb', '0000ff02-0000-1000-8000-00805f9b34fb'],
  ['e7810a71-73ae-499d-8c15-faa9aef0c3f2', 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f'],
  ['6e400001-b5a3-f393-e0a9-e50e24dcca9e', '6e400002-b5a3-f393-e0a9-e50e24dcca9e'],
];

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

/** Global reference to the paired Bluetooth device and its resolved writable characteristic. */
let activeDevice: BluetoothDeviceLike | null = null;
let activeCharacteristic: BluetoothCharacteristicLike | null = null;

function handleDisconnected() {
  // Keep activeDevice so the next print can automatically reconnect to the same device via device.gatt.connect(),
  // only clearing the cached GATT characteristic handle.
  activeCharacteristic = null;
}

export async function setPrinterDevice(device: BluetoothDeviceLike | null): Promise<void> {
  if (activeDevice && activeDevice !== device) {
    activeDevice.removeEventListener?.('gattserverdisconnected', handleDisconnected);
  }
  activeDevice = device;
  activeCharacteristic = null;
  if (device) {
    device.addEventListener('gattserverdisconnected', handleDisconnected);
    try {
      await db.settings.put({ key: PRINTER_DEVICE_KEY, value: device.id });
    } catch {
      // Ignore storage errors if IndexedDB is unavailable.
    }
  } else {
    try {
      await db.settings.delete(PRINTER_DEVICE_KEY);
    } catch {
      // Ignore storage errors if IndexedDB is unavailable.
    }
  }
}

export async function disconnectPrinterDevice(): Promise<void> {
  const device = activeDevice;
  activeDevice = null;
  activeCharacteristic = null;
  if (device) {
    device.removeEventListener?.('gattserverdisconnected', handleDisconnected);
    if (device.gatt?.connected) {
      device.gatt.disconnect();
    }
  }
  try {
    await db.settings.delete(PRINTER_DEVICE_KEY);
  } catch {
    // Ignore storage errors if IndexedDB is unavailable.
  }
}

export function getPrinterDevice(): BluetoothDeviceLike | null {
  return activeDevice;
}

/**
 * Resolves a writable BLE characteristic on an active GATT server by scanning
 * all exposed primary services first, then falling back to known ESC/POS UUID pairs.
 */
async function resolveWritableCharacteristic(server: BluetoothGattServerLike): Promise<BluetoothCharacteristicLike> {
  // 1. Try scanning all primary services exposed by the printer for a writable characteristic.
  if (typeof server.getPrimaryServices === 'function') {
    try {
      const services = await server.getPrimaryServices();
      for (const service of services) {
        if (typeof service.getCharacteristics !== 'function') continue;
        try {
          const characteristics = await service.getCharacteristics();
          const writable = characteristics.find(
            (c) => c.properties?.write || c.properties?.writeWithoutResponse,
          );
          if (writable) return writable;
        } catch {
          // Continue checking remaining services.
        }
      }
    } catch {
      // Fall through to explicit UUID lookup below.
    }
  }

  // 2. Try known [serviceUUID, characteristicUUID] pairs directly.
  for (const [serviceUuid, charUuid] of KNOWN_SERVICE_CHARACTERISTICS) {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      if (typeof service.getCharacteristics === 'function') {
        try {
          const chars = await service.getCharacteristics();
          const writable = chars.find(
            (c) => c.properties?.write || c.properties?.writeWithoutResponse,
          );
          if (writable) return writable;
        } catch {
          // Fall through to specific characteristic UUID.
        }
      }
      const characteristic = await service.getCharacteristic(charUuid);
      if (characteristic) return characteristic;
    } catch {
      // Service not present on this printer; try next UUID pair.
    }
  }

  throw new Error(
    'No writable BLE printer characteristic found. Make sure your printer supports Bluetooth Low Energy (BLE) ESC/POS.',
  );
}

/**
 * Prompts the user to pick a Bluetooth thermal printer, connects to its GATT
 * server, and verifies that a writable printer characteristic is available.
 */
export async function pairPrinterDevice(): Promise<BluetoothDeviceLike> {
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
  if (!bluetooth?.requestDevice) {
    throw new Error('Web Bluetooth needs Chrome or Edge on desktop, or Android.');
  }

  const picked = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES,
  });

  if (!picked.gatt) {
    throw new Error('Selected Bluetooth device does not support GATT connections.');
  }

  const server = picked.gatt.connected ? picked.gatt : await picked.gatt.connect();
  const characteristic = await resolveWritableCharacteristic(server);
  await setPrinterDevice(picked);
  activeCharacteristic = characteristic;
  return picked;
}

/**
 * Reconnects to a previously permitted Bluetooth printer using
 * navigator.bluetooth.getDevices() (which does not require a user gesture).
 */
export async function restorePrinterDevice(): Promise<void> {
  if (activeDevice) return;
  let deviceId: string | undefined;
  try {
    const stored = await db.settings.get(PRINTER_DEVICE_KEY);
    deviceId = stored?.value as string | undefined;
  } catch {
    return;
  }
  if (!deviceId) return;

  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
  if (!bluetooth?.getDevices) return;

  try {
    const devices = await bluetooth.getDevices();
    const matched = devices.find((d) => d.id === deviceId) ?? devices[0];
    if (!matched) return;

    matched.addEventListener('gattserverdisconnected', handleDisconnected);
    activeDevice = matched;
    if (matched.gatt && !matched.gatt.connected) {
      const server = await matched.gatt.connect();
      activeCharacteristic = await resolveWritableCharacteristic(server);
    }
  } catch {
    // Printer out of range or asleep — keep activeDevice if found so printRaw can retry on demand.
  }
}

async function writeChunks(
  characteristic: BluetoothCharacteristicLike,
  bytes: Uint8Array,
  chunkSize: number,
  delayMs: number,
): Promise<void> {
  const writeFn =
    characteristic.writeValueWithResponse?.bind(characteristic) ??
    characteristic.writeValue?.bind(characteristic) ??
    characteristic.writeValueWithoutResponse?.bind(characteristic);

  if (!writeFn) {
    throw new Error('Printer characteristic does not support write operations.');
  }

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    await writeFn(chunk);
    if (delayMs > 0 && i + chunkSize < bytes.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Sends raw ESC/POS bytes to the paired Bluetooth printer.
 * Keeps the GATT connection alive and falls back to 20-byte BLE ATT packets if
 * the printer rejects larger chunks.
 */
export async function printRaw(bytes: Uint8Array): Promise<void> {
  if (!activeDevice) {
    await restorePrinterDevice();
  }
  const device = activeDevice;
  if (!device) {
    throw new Error('No Bluetooth printer paired. Please pair a printer in settings.');
  }
  if (!device.gatt) {
    throw new Error('Selected device does not expose a Bluetooth GATT server.');
  }

  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  if (!server) {
    throw new Error('Could not connect to printer GATT server.');
  }

  if (!activeCharacteristic) {
    activeCharacteristic = await resolveWritableCharacteristic(server);
  }

  try {
    await writeChunks(activeCharacteristic, bytes, 64, 15);
  } catch {
    // Re-resolve characteristic and fall back to strict 20-byte BLE default MTU chunks.
    const freshServer = device.gatt.connected ? device.gatt : await device.gatt.connect();
    activeCharacteristic = await resolveWritableCharacteristic(freshServer);
    await writeChunks(activeCharacteristic, bytes, 20, 20);
  }
}

/**
 * Sends a short ESC/POS test slip to verify the paired thermal printer immediately.
 */
export async function printTestReceipt(headerText = 'Hungry Birds Restaurant'): Promise<void> {
  const encoder = new EscPosEncoder();
  encoder.initialize();
  encoder.align('center');
  encoder.bold(true);
  encoder.text(headerText);
  encoder.bold(false);
  encoder.text('--------------------------------');
  encoder.text('Bluetooth Thermal Printer Test');
  encoder.text(new Date().toLocaleString());
  encoder.text('Status: CONNECTED & READY');
  encoder.text('--------------------------------');
  encoder.feed(3);
  encoder.cut();
  await printRaw(encoder.build());
}

export async function getPrinterSettings(): Promise<PrinterSettings> {
  const stored = await db.settings.get(PRINTER_SETTINGS_KEY);
  const merged = { ...DEFAULT_PRINTER_SETTINGS, ...(stored?.value as Partial<PrinterSettings> | undefined) };
  return merged;
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  await db.settings.put({ key: PRINTER_SETTINGS_KEY, value: settings });
}
