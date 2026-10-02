const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
/** Decoding a bitmap takes about four bytes a pixel: this many pixels is some 64 MB. */
export const MAX_IMAGE_PIXELS = 4096 * 4096;

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean => prefix.every((byte, index) => bytes[index] === byte);

export type ImageKind = 'png' | 'jpeg';
export interface ImageInfo {
  readonly kind: ImageKind;
  readonly width: number;
  readonly height: number;
}

/** Reads the size from the header, without decoding: a small file can declare billions of pixels. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (startsWith(bytes, PNG_SIGNATURE) && bytes.length >= 24) return { kind: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  if (!startsWith(bytes, JPEG_SIGNATURE)) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { kind: 'jpeg', height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
}

/** A PNG or JPEG that is safe to decode: it has a size and the size is reasonable. */
export function isSafeImage(bytes: Uint8Array): boolean {
  const info = readImageInfo(bytes);
  return info !== undefined && info.width > 0 && info.height > 0 && info.width * info.height <= MAX_IMAGE_PIXELS;
}
