import { describe, expect, it, vi } from 'vitest';
import { createFakeTransport } from '@/test/fake-transport';
import { StorageUploadError, uploadFiles } from './upload-files';

const FILE_ID = '018f0000-0000-7000-8000-000000000001';
const at = '2026-10-20T15:00:00.000Z';
const slot = { fileId: FILE_ID, url: 'http://storage.test/bucket/key?sig=1', method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '4', 'if-none-match': '*' }, expiresAt: at };
const stored = { id: FILE_ID, name: 'acta.pdf', kind: 'PDF', mimeType: 'application/pdf', sizeBytes: 4, status: 'CONFIRMED', createdAt: at, confirmedAt: at };

describe('uploadFiles', () => {
  it('declares the file with its SHA-256, sends it to storage without content-length, then confirms it', async () => {
    const fake = createFakeTransport({ '/files/uploads': () => ({ uploads: [slot], quota: { overLimit: false } }), [`/files/${FILE_ID}/confirm`]: () => stored });
    const put = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
    const file = new File(['%PDF'], 'acta.pdf', { type: 'application/pdf' });

    expect(await uploadFiles(fake.transport, [file], put)).toEqual([{ id: FILE_ID, name: 'acta.pdf', sizeBytes: 4 }]);
    expect(fake.callsTo('/files/uploads')[0]?.options.body).toEqual({ files: [{ name: 'acta.pdf', sizeBytes: 4, sha256: '315d429b7714cedb6ad04ac31240145257692630457f3c88253c5beceac76027' }] });
    expect(put).toHaveBeenCalledWith(slot.url, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'if-none-match': '*' }, body: file });
    expect(fake.callsTo(`/files/${FILE_ID}/confirm`)).toHaveLength(1);
  });

  it('stops without confirming when storage refuses the content', async () => {
    const fake = createFakeTransport({ '/files/uploads': () => ({ uploads: [slot], quota: { overLimit: false } }), [`/files/${FILE_ID}/confirm`]: () => stored });
    const refused = () => Promise.resolve(new Response(null, { status: 403 }));

    await expect(uploadFiles(fake.transport, [new File(['%PDF'], 'acta.pdf')], refused)).rejects.toEqual(new StorageUploadError(403));
    expect(fake.callsTo(`/files/${FILE_ID}/confirm`)).toHaveLength(0);
  });
});
