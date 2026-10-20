import { db } from './db';

export type ReceiptFontSize = 'small' | 'normal' | 'large';

export interface PrinterSettings {
  receiptFontSize: ReceiptFontSize;
  receiptLogo: boolean;
  paperWidth: '58mm' | '80mm';
}

export const PRINTER_SETTINGS_KEY = 'printerSettings';

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  receiptFontSize: 'normal',
  receiptLogo: true,
  paperWidth: '80mm',
};

const FONT_CLASS: Record<ReceiptFontSize, string> = {
  small: 'text-[8px]',
  normal: 'text-[10px]',
  large: 'text-[12px]',
};

export function receiptFontClass(size: ReceiptFontSize): string {
  return FONT_CLASS[size] ?? FONT_CLASS.normal;
}

/**
 * Legacy stored this in localStorage as JSON; it is read through the settings
 * table too so a migration of an existing install keeps the shop's choice.
 */
export async function getPrinterSettings(): Promise<PrinterSettings> {
  const stored = await db.settings.get(PRINTER_SETTINGS_KEY);
  const merged = { ...DEFAULT_PRINTER_SETTINGS, ...(stored?.value as Partial<PrinterSettings> | undefined) };
  return merged;
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  await db.settings.put({ key: PRINTER_SETTINGS_KEY, value: settings });
}
