import { describe, expect, it } from 'vitest';
import { isSafeImage, readImageInfo } from './image-size.js';

const png = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};
const jpeg = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  new DataView(bytes.buffer).setUint16(13, height);
  new DataView(bytes.buffer).setUint16(15, width);
  return bytes;
};

describe('readImageInfo', () => {
  it('reads PNG and JPEG sizes from the header', () => {
    expect(readImageInfo(png(300, 120))).toEqual({ kind: 'png', width: 300, height: 120 });
    expect(readImageInfo(jpeg(640, 480))).toEqual({ kind: 'jpeg', width: 640, height: 480 });
  });

  it('knows nothing about other bytes or truncated files', () => {
    expect(readImageInfo(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(readImageInfo(png(1, 1).slice(0, 10))).toBeUndefined();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4]))).toBeUndefined();
  });
});

describe('isSafeImage', () => {
  it('accepts ordinary sizes and refuses a bitmap that would take gigabytes to decode', () => {
    expect(isSafeImage(png(1000, 400))).toBe(true);
    expect(isSafeImage(png(30000, 30000))).toBe(false);
    expect(isSafeImage(jpeg(20000, 20000))).toBe(false);
    expect(isSafeImage(png(0, 10))).toBe(false);
  });
});
