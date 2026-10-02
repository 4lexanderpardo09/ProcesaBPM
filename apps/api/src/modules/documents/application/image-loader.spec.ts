import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from '../../../infrastructure/storage/in-memory-object-storage.js';
import { ImageLoader } from './image-loader.js';

const png = (width: number, height: number, extra = 0): Uint8Array => {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};

describe('ImageLoader', () => {
  const storage = new InMemoryObjectStorage();
  storage.seed('ok', png(100, 40));
  storage.seed('huge-pixels', png(30000, 30000));
  storage.seed('big-file', png(10, 10, 1024 * 1024 + 1));
  storage.seed('not-image', new Uint8Array([1, 2, 3]));
  const loader = new ImageLoader(storage);

  it('loads what is safe and leaves out the missing, the oversized and the suspicious', async () => {
    const keys = new Map([['logo', 'ok'], ['sig:a', 'huge-pixels'], ['sig:b', 'big-file'], ['sig:c', 'not-image'], ['sig:d', 'gone']]);
    const loaded = await loader.load(new Set(['logo', 'sig:a', 'sig:b', 'sig:c', 'sig:d', 'sig:unknown']), keys);
    expect([...loaded.keys()]).toEqual(['logo']);
  });
});
