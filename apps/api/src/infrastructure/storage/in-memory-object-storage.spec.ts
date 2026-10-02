import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from './in-memory-object-storage.js';

describe('InMemoryObjectStorage', () => {
  const content = new Uint8Array([1, 2, 3]);

  it('reports the size of what was put and null for what was not', async () => {
    const storage = new InMemoryObjectStorage();
    storage.put('a', content);
    expect(await storage.head('a')).toEqual({ sizeBytes: 3 });
    expect(await storage.head('b')).toBeNull();
  });

  it('never overwrites an object', () => {
    const storage = new InMemoryObjectStorage();
    storage.put('a', content);
    expect(() => storage.put('a', content)).toThrow();
  });

  it('refuses to read more than the limit', async () => {
    const storage = new InMemoryObjectStorage();
    storage.put('a', content);
    expect(await storage.read('a', 3)).toEqual(content);
    await expect(storage.read('a', 2)).rejects.toThrow();
  });

  it('deletes idempotently, one key or many', async () => {
    const storage = new InMemoryObjectStorage();
    storage.put('a', content);
    storage.put('b', content);
    await storage.delete('a');
    await storage.delete('a');
    expect(await storage.deleteMany(['b', 'missing'])).toEqual({ failed: [] });
    expect(storage.keys).toEqual([]);
  });

  it('signs uploads that expire after the requested time', async () => {
    const storage = new InMemoryObjectStorage();
    const now = new Date('2026-10-01T10:00:00Z');
    const upload = await storage.presignUpload({ key: 'k', contentType: 'application/pdf', contentLength: 3, expiresInSeconds: 600, now });
    expect(upload.expiresAt).toEqual(new Date('2026-10-01T10:10:00Z'));
  });
});
