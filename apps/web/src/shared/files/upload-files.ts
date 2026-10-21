import { storedFileResponseSchema, uploadsResponseSchema } from '@procesabpm/shared';
import type { HttpClient } from '@/shared/api';

export interface UploadedFile {
  readonly id: string;
  readonly name: string;
  readonly sizeBytes: number;
}

/** Storage refused the content (expired link, a file already there, network): nothing was confirmed for it. */
export class StorageUploadError extends Error {
  constructor(readonly status: number | undefined) {
    super(`Storage refused the upload${status === undefined ? '' : ` (${status})`}`);
    this.name = 'StorageUploadError';
  }
}

/** `content-length` is the browser's to set (a forbidden header for `fetch`); it sends the real one, which was signed. */
const BROWSER_SET_HEADERS = new Set(['content-length']);

/**
 * Uploads files in the API's two phases: declare them (name, size and SHA-256, so the server can compare the content),
 * send each one straight to storage with its presigned URL, then confirm it. Only confirmed files can be attached.
 */
export async function uploadFiles(client: HttpClient, files: readonly File[], fetchFn: typeof fetch = fetch): Promise<UploadedFile[]> {
  const declared = await Promise.all(files.map(async (file) => ({ name: file.name, sizeBytes: file.size, sha256: await sha256Of(file) })));
  const { uploads } = await client.request('/files/uploads', { method: 'POST', body: { files: declared }, schema: uploadsResponseSchema });
  const uploaded: UploadedFile[] = [];
  for (const [index, slot] of uploads.entries()) {
    const file = files[index]!;
    const headers = Object.fromEntries(Object.entries(slot.headers).filter(([name]) => !BROWSER_SET_HEADERS.has(name.toLowerCase())));
    let response: Response;
    try {
      response = await fetchFn(slot.url, { method: slot.method, headers, body: file });
    } catch {
      throw new StorageUploadError(undefined);
    }
    if (!response.ok) throw new StorageUploadError(response.status);
    const stored = await client.request(`/files/${encodeURIComponent(slot.fileId)}/confirm`, { method: 'POST', schema: storedFileResponseSchema });
    uploaded.push({ id: stored.id, name: stored.name, sizeBytes: stored.sizeBytes });
  }
  return uploaded;
}

async function sha256Of(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
