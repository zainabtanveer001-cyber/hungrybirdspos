/**
 * ESC/POS (Epson Standard Code for POS) encoder.
 * Converts formatting commands and text into a Uint8Array for thermal printers.
 */
export class EscPosEncoder {
  private bytes: Uint8Array[] = [];
  private currentSize = 0;

  private append(bytes: number[] | Uint8Array) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.currentSize += arr.length;
    this.bytes.push(arr);
  }

  /** Resets printer to default settings. */
  initialize() {
    this.append([0x1B, 0x40]);
  }

  /** Sets text alignment. */
  align(position: 'left' | 'center' | 'right') {
    const map = { left: 0, center: 1, right: 2 };
    this.append([0x1B, 0x61, map[position]]);
  }

  /** Sets bold mode. */
  bold(on: boolean) {
    this.append([0x1B, 0x45, on ? 1 : 0]);
  }

  /** Sets text size (width/height multiplier). */
  setSize(width: number, height: number) {
    this.append([0x1D, 0x21, (width << 0) | (height << 4)]);
  }

  /** Appends a string of text. */
  text(str: string) {
    this.append(new TextEncoder().encode(str + '\n'));
  }

  /** Feeds a few lines of paper. */
  feed(lines: number = 1) {
    this.append([0x1B, 0x64, lines]);
  }

  /** Full cut command. */
  cut() {
    this.append([0x1D, 0x56, 0x00]);
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
