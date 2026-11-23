import { encode, renderSVG } from 'uqr';

const TRACKING_QUERY_PARAMS = new Set([
  'entry',
  'g_ep',
  'coh',
  'g_st',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
]);

/**
 * Cleans pasted QR links (including multi-line Google Maps share text, scheme-less URLs,
 * and Google Maps tracking parameters) while preserving all functional place/coordinate params.
 */
export function normalizeQrUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  const embeddedUrlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  let candidate = embeddedUrlMatch ? embeddedUrlMatch[0].replace(/[.,;]+$/, '') : trimmed;

  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      for (const param of TRACKING_QUERY_PARAMS) {
        parsed.searchParams.delete(param);
      }
      return parsed.toString();
    }
  } catch {
    // Non-URL payloads (e.g. Wi-Fi or plain text) pass through trimmed.
  }

  return trimmed;
}

/** Encodes a normalized QR payload into a boolean module matrix (level L for long URLs to keep modules readable). */
export function encodeQrMatrix(rawUrl: string, border = 4) {
  const clean = normalizeQrUrl(rawUrl);
  if (!clean) return null;
  try {
    const ecc = clean.length > 80 ? 'L' : 'M';
    return encode(clean, { ecc, border });
  } catch {
    return null;
  }
}

/** Generates a crisp offline SVG QR code for browser printing and live preview. */
export function buildQrSvg(rawUrl: string, sizePx = 120): string {
  const clean = normalizeQrUrl(rawUrl);
  if (!clean) return '';
  try {
    const ecc = clean.length > 80 ? 'L' : 'M';
    const raw = renderSVG(clean, { ecc, border: 4, pixelSize: 4 });
    return raw.replace(
      '<svg ',
      `<svg width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges" style="display:block;margin:0 auto;" `,
    );
  } catch {
    return '';
  }
}

/**
 * Renders the QR code into a byte-aligned 1-bit monochrome bitmap for universal ESC/POS GS v 0 printing.
 * Works reliably on portable Bluetooth printers whose firmware drops or corrupts native GS ( k QR commands.
 */
export function buildQrRaster(
  rawUrl: string,
  paperWidth: '58mm' | '80mm' = '80mm',
): { width: number; height: number; bytes: Uint8Array } | null {
  const matrix = encodeQrMatrix(rawUrl, 1);
  if (!matrix) return null;

  const maxPaperDots = paperWidth === '58mm' ? 352 : 512;
  let scale = 0;
  if (matrix.size <= 43 && matrix.size * 4 <= maxPaperDots) {
    scale = 4;
  } else if (matrix.size <= 75 && matrix.size * 3 <= maxPaperDots) {
    scale = 3;
  } else if (matrix.size * 2 <= maxPaperDots) {
    scale = 2;
  } else if (matrix.size <= maxPaperDots) {
    scale = 1;
  } else {
    return null;
  }

  const rawPx = matrix.size * scale;
  const width = Math.ceil(rawPx / 8) * 8;
  const bytesPerRow = width / 8;
  const height = rawPx;
  const offsetX = Math.floor((width - rawPx) / 2);
  const bytes = new Uint8Array(bytesPerRow * height);

  for (let my = 0; my < matrix.size; my += 1) {
    const row = matrix.data[my];
    for (let mx = 0; mx < matrix.size; mx += 1) {
      if (!row[mx]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        const py = my * scale + dy;
        const rowBase = py * bytesPerRow;
        for (let dx = 0; dx < scale; dx += 1) {
          const px = offsetX + mx * scale + dx;
          bytes[rowBase + (px >> 3)] |= 0x80 >> (px & 7);
        }
      }
    }
  }

  return { width, height, bytes };
}
