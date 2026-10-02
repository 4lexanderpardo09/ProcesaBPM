import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from './in-memory-object-storage.js';

describe('InMemoryObjectStorage', () => {
  const content = new Uint8Array([1, 2, 3]);

  it('reports the size of what was put and null for what was not', async () => {
    const storage = new InMemoryObjectStorage();
    storage.seed('a', content);
    expect(await storage.head('a')).toEqual({ sizeBytes: 3 });
    expect(await storage.head('b')).toBeNull();
  });

  it('never overwrites an object', () => {
    const storage = new InMemoryObjectStorage();
    storage.seed('a', content);
    expect(() => storage.seed('a', content)).toThrow();
  });

  it('put creates once and reports an existing key without overwriting', async () => {
    const storage = new InMemoryObjectStorage();
    expect(await storage.put({ key: 'k', body: content, contentType: 'application/pdf' })).toBe('created');
    expect(await storage.put({ key: 'k', body: new Uint8Array([9]), contentType: 'application/pdf' })).toBe('exists');
    expect(await storage.read('k', 10)).toEqual(content);
  });

  it('refuses to read more than the limit', async () => {
    const storage = new InMemoryObjectStorage();
    storage.seed('a', content);
    expect(await storage.read('a', 3)).toEqual(content);
    await expect(storage.read('a', 2)).rejects.toThrow();
  });

  it('deletes idempotently, one key or many', async () => {
    const storage = new InMemoryObjectStorage();
    storage.seed('a', content);
    storage.seed('b', content);
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
