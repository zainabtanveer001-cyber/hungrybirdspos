function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Neutralizes spreadsheet formula injection (CSV injection) when an exported
 * CSV is opened in Excel or Google Sheets: any string cell starting with a
 * formula trigger (`=`, `+`, `-`, `@`, tab, CR) — other than a plain signed
 * number — is prefixed with a single quote.
 */
export function sanitizeCsvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const str = String(value ?? '');
  if (/^[\t\r]/.test(str)) return `'${str}`;
  if (/^\s*[=+\-@]/.test(str) && !/^\s*[+-]?\d+(\.\d+)?\s*$/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/** Minimal CSV download — quoting the way the legacy exporter did, with formula-injection protection. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const cell = (value: string | number) => `"${sanitizeCsvCell(value).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
  download(filename, new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
}

export function downloadJson(filename: string, json: string): void {
  download(filename, new Blob([json], { type: 'application/json' }));
}

export function datedFilename(prefix: string): string {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
}
