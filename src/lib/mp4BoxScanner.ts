/**
 * Walks the top-level boxes of an MP4/MOV file without loading any payloads.
 * Reads only 16 bytes per box (the box header) and seeks past the body using
 * the size field.
 *
 * MP4 box header format:
 *   [4 bytes BE] size      (1 = read 64-bit largesize from next 8 bytes)
 *   [4 bytes  ] type       ('ftyp', 'moov', 'mdat', etc.)
 *   [optional 8 bytes BE] largesize (only when size === 1)
 *
 * Sony cameras produce moov-at-end files; this scanner finds moov in O(N_boxes)
 * regardless of file size — a 100GB capture costs the same as a 1GB one.
 */
export interface BoxLocation {
  type: string;
  /** Absolute byte offset where the box starts (size field). */
  start: number;
  /** Total box size in bytes including header. */
  size: number;
}

const HEADER_BYTES = 16;
const TD = new TextDecoder("ascii");

export async function findTopLevelBoxes(file: File): Promise<BoxLocation[]> {
  const boxes: BoxLocation[] = [];
  let offset = 0;
  while (offset < file.size) {
    const remaining = file.size - offset;
    if (remaining < 8) break;
    const headerSlice = file.slice(offset, offset + Math.min(HEADER_BYTES, remaining));
    const headerBuf = await headerSlice.arrayBuffer();
    const dv = new DataView(headerBuf);
    let size = dv.getUint32(0);
    const type = TD.decode(new Uint8Array(headerBuf, 4, 4));
    if (size === 1) {
      if (headerBuf.byteLength < 16) break;
      // 64-bit largesize spans the next 8 bytes
      size = Number(dv.getBigUint64(8));
    } else if (size === 0) {
      // Box extends to end-of-file
      size = file.size - offset;
    }
    if (size < 8 || offset + size > file.size) {
      // Malformed or truncated; bail with what we have
      break;
    }
    boxes.push({ type, start: offset, size });
    offset += size;
  }
  return boxes;
}
