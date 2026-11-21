/**
 * ESC/POS (Epson Standard Code for POS) encoder.
 * Converts formatting commands, text, QR codes, and raster bitmaps into a Uint8Array for thermal printers.
 */
export class EscPosEncoder {
  private bytes: Uint8Array[] = [];
  private currentSize = 0;

  private append(bytes: number[] | Uint8Array) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.currentSize += arr.length;
    this.bytes.push(arr);
  }

  private sanitizeAscii(str: string): string {
    return str
      .replace(/\u00A0/g, ' ')
      .replace(/[–—]/g, '-')
      .replace(/[•·]/g, '-')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/×/g, 'x')
      .replace(/★/g, '*');
  }

  /** Resets printer to default settings. */
  initialize() {
    this.append([0x1b, 0x40]);
  }

  /** Sets text alignment. */
  align(position: 'left' | 'center' | 'right') {
    const map = { left: 0, center: 1, right: 2 };
    this.append([0x1b, 0x61, map[position]]);
  }

  /** Sets bold mode (ESC E n). */
  bold(on: boolean) {
    this.append([0x1b, 0x45, on ? 1 : 0]);
  }

  /** Sets white-on-black inverted print mode (GS B n) for premium thermal highlight bars. */
  invert(on: boolean) {
    this.append([0x1d, 0x42, on ? 1 : 0]);
  }

  /** Sets underline mode (ESC - n): 0 = off, 1 = 1-dot, 2 = 2-dot. */
  underline(mode: 0 | 1 | 2) {
    this.append([0x1b, 0x2d, mode]);
  }

  /**
   * Sets character size multiplier via GS ! n.
   * width: 0 = 1x (normal), 1 = 2x (double width)
   * height: 0 = 1x (normal), 1 = 2x (double height)
   * Note: GS ! uses bits 4..6 for width and bits 0..2 for height.
   */
  setSize(width: number, height: number) {
    const w = Math.max(0, Math.min(7, width));
    const h = Math.max(0, Math.min(7, height));
    this.append([0x1d, 0x21, (w << 4) | h]);
  }

  /** Appends text without a trailing newline (useful for inline size/style changes on the same line). */
  rawText(str: string) {
    this.append(new TextEncoder().encode(this.sanitizeAscii(str)));
  }

  /** Appends a line of text with a trailing newline. */
  text(str: string) {
    this.append(new TextEncoder().encode(this.sanitizeAscii(str) + '\n'));
  }

  /**
   * Encodes a native ESC/POS Model 2 QR Code (GS ( k) with Medium error correction.
   * Supported natively by Epson, Xprinter, Rongta, Sunmi, Goojprt, MTP, and Star ESC/POS printers.
   */
  qrCode(data: string, moduleSize = 5) {
    const payload = data.trim();
    if (!payload) return;
    const encoded = new TextEncoder().encode(payload);
    const size = Math.max(3, Math.min(8, Math.round(moduleSize)));
    const storeLen = encoded.length + 3;
    const pL = storeLen & 0xff;
    const pH = (storeLen >> 8) & 0xff;

    // Select QR Code Model 2
    this.append([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // Set module dot size (3..8)
    this.append([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]);
    // Set error correction level M (15%)
    this.append([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);
    // Store data in symbol storage area
    this.append([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]);
    this.append(encoded);
    // Print stored QR symbol
    this.append([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
  }

  /**
   * Appends a monochrome 1-bit raster image using GS v 0 in 24-row strips
   * so Bluetooth / Serial thermal printers never overflow their receive buffer.
   */
  rasterImage(widthPx: number, heightPx: number, packedBytes: Uint8Array) {
    const bytesPerRow = Math.ceil(widthPx / 8);
    const bandHeight = 24;
    for (let y = 0; y < heightPx; y += bandHeight) {
      const rows = Math.min(bandHeight, heightPx - y);
      const xL = bytesPerRow & 0xff;
      const xH = (bytesPerRow >> 8) & 0xff;
      const yL = rows & 0xff;
      const yH = (rows >> 8) & 0xff;
      this.append([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
      const start = y * bytesPerRow;
      const end = start + rows * bytesPerRow;
      this.append(packedBytes.slice(start, end));
    }
  }

  /** Feeds a few lines of paper. */
  feed(lines: number = 1) {
    this.append([0x1b, 0x64, lines]);
  }

  /** Full/partial cut command. */
  cut() {
    this.append([0x1d, 0x56, 0x00]);
  }

  /** Combines all segments into a single Uint8Array. */
  build(): Uint8Array {
    const result = new Uint8Array(this.currentSize);
    let offset = 0;
    for (const chunk of this.bytes) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}
