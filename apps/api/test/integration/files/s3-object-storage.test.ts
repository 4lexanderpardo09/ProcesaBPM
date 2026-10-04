import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { StorageUnavailableError } from '@procesabpm/shared';
import { S3ObjectStorage } from '../../../src/infrastructure/storage/s3-object-storage.js';
import { expectStatus } from '../../support/supertest-diagnostics.js';

describe('S3ObjectStorage against a real S3 server', () => {
  const settings = inject('storage');
  const storage = new S3ObjectStorage({ ...settings, forcePathStyle: true });
  const pdf = new TextEncoder().encode('%PDF-1.4 hello');
  const now = () => new Date();
  const keys: string[] = [];
  const newKey = () => {
    const key = `tenants/t/2026/10/${randomUUID()}`;
    keys.push(key);
    return key;
  };

  /** The browser sets Content-Length from the body itself, so the signed one is only sent when `declared` is omitted. */
  const upload = async (key: string, content: Uint8Array, declared: number = content.length) => {
    const signed = await storage.presignUpload({ key, contentType: 'application/pdf', contentLength: declared, expiresInSeconds: 600, now: now() });
    const { 'content-length': _fixedByTheBody, ...headers } = signed.headers;
    return fetch(signed.url, { method: signed.method, headers, body: Buffer.from(content) });
  };

  afterAll(async () => {
    await storage.deleteMany(keys);
  });
  beforeAll(() => expect(settings.bucket).toBeTruthy());

  it('accepts the browser upload with the signed headers, and head reports its size', async () => {
    const key = newKey();
    expect((await upload(key, pdf)).status).toBe(200);
    expect(await storage.head(key)).toEqual({ sizeBytes: pdf.length });
    expect(Buffer.from(await storage.read(key, 1000)).toString()).toBe('%PDF-1.4 hello');
  });

  it('refuses a second upload to the same key: an object is written once', async () => {
    const key = newKey();
    expect((await upload(key, pdf)).status).toBe(200);
    expect((await upload(key, new TextEncoder().encode('%PDF-evil'))).status).toBe(412);
    expect(Buffer.from(await storage.read(key, 1000)).toString()).toBe('%PDF-1.4 hello');
  });

  it('put writes server-side once and reports an existing key without overwriting it', async () => {
    const key = newKey();
    expect(await storage.put({ key, body: pdf, contentType: 'application/pdf' })).toBe('created');
    expect(await storage.put({ key, body: new TextEncoder().encode('%PDF-other'), contentType: 'application/pdf' })).toBe('exists');
    expect(Buffer.from(await storage.read(key, 1000)).toString()).toBe('%PDF-1.4 hello');
  });

  it('refuses an upload whose length differs from the signed one', async () => {
    const key = newKey();
    const response = await upload(key, new TextEncoder().encode('%PDF-1.4 hello, but much longer'), pdf.length);
    expectStatus(response, 403);
    expect(await storage.head(key)).toBeNull();
  });

  it('returns null for a missing object and refuses to read more than the limit', async () => {
    expect(await storage.head(`tenants/t/missing/${randomUUID()}`)).toBeNull();
    const key = newKey();
    await upload(key, pdf);
    await expect(storage.read(key, 5)).rejects.toThrow(/larger/);
  });

  it('serves the object through a signed download URL with the requested disposition', async () => {
    const key = newKey();
    await upload(key, pdf);
    const signed = await storage.presignDownload({ key, fileName: 'informe año.pdf', contentType: 'application/pdf', disposition: 'attachment', expiresInSeconds: 120, now: now() });
    const response = await fetch(signed.url);
    expectStatus(response, 200);
    expect(response.headers.get('content-disposition')).toContain(`filename*=UTF-8''informe%20a%C3%B1o.pdf`);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(createHash('sha256').update(pdf).digest('hex'));
  });

  it('stops serving an expired download URL', async () => {
    const key = newKey();
    await upload(key, pdf);
    const signed = await storage.presignDownload({ key, fileName: 'a.pdf', contentType: 'application/pdf', disposition: 'inline', expiresInSeconds: 60, now: new Date(Date.now() - 3_600_000) });
    expect((await fetch(signed.url)).status).toBe(403);
  });

  it('deletes idempotently and reports nothing failed', async () => {
    const [first, second] = [newKey(), newKey()];
    await upload(first, pdf);
    await upload(second, pdf);
    await storage.delete(first);
    await storage.delete(first);
    expect(await storage.deleteMany([second, `tenants/t/missing/${randomUUID()}`])).toEqual({ failed: [] });
    expect(await storage.head(first)).toBeNull();
    expect(await storage.head(second)).toBeNull();
  });

  describe('multipart writes', () => {
    it('writes an object larger than one part, in chunks, and nothing is visible before complete', async () => {
      const key = newKey();
      const content = randomBytes(17 * 1024 * 1024 + 123);
      const upload = await storage.openMultipartWrite(key, 'application/zip');
      for (let offset = 0; offset < content.length; offset += 1024 * 1024) await upload.write(content.subarray(offset, offset + 1024 * 1024));
      expect(await storage.head(key)).toBeNull();
      expect(await upload.complete()).toEqual({ sizeBytes: content.length });
      expect(Buffer.from(await storage.read(key, content.length)).equals(content)).toBe(true);
    });

    it('abort leaves no object, and completing replaces what an earlier attempt left at the key', async () => {
      const key = newKey();
      const aborted = await storage.openMultipartWrite(key, 'application/zip');
      await aborted.write(randomBytes(1000));
      await aborted.abort();
      await aborted.abort();
      expect(await storage.head(key)).toBeNull();

      await upload(key, pdf);
      const retry = await storage.openMultipartWrite(key, 'application/zip');
      await retry.write(new TextEncoder().encode('second attempt'));
      await retry.complete();
      expect(Buffer.from(await storage.read(key, 100)).toString()).toBe('second attempt');
    });
  });

  it('reports an unreachable storage as unavailable', async () => {
    const broken = new S3ObjectStorage({ ...settings, endpoint: 'http://127.0.0.1:1', forcePathStyle: true });
    await expect(broken.head('k')).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
