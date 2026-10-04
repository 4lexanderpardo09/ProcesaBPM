import { type MultipartWrite, ObjectStorage, type PresignDownloadInput, type PresignedDownload, type PresignedUpload, type PresignUploadInput, type PutObjectInput } from './object-storage.js';

/** Test double: keeps objects in memory. */
export class InMemoryObjectStorage extends ObjectStorage {
  private readonly objects = new Map<string, Uint8Array>();
  readonly presignedUploads: PresignUploadInput[] = [];
  /** Multipart uploads by state, for the tests that check what was left behind. */
  readonly multipart = { opened: 0, completed: 0, aborted: 0 };

  /** Stands in for the browser's PUT in tests. */
  seed(key: string, content: Uint8Array): void {
    if (this.objects.has(key)) throw new Error(`Object ${key} already exists`);
    this.objects.set(key, content);
  }

  async put(input: PutObjectInput): Promise<'created' | 'exists'> {
    if (this.objects.has(input.key)) return 'exists';
    this.objects.set(input.key, input.body);
    return 'created';
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  get keys(): string[] {
    return [...this.objects.keys()];
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    this.presignedUploads.push(input);
    const expiresAt = new Date(input.now.getTime() + input.expiresInSeconds * 1000);
    return { url: `memory://upload/${input.key}`, method: 'PUT', headers: { 'content-type': input.contentType }, expiresAt };
  }

  async presignDownload(input: PresignDownloadInput): Promise<PresignedDownload> {
    return { url: `memory://download/${input.key}?disposition=${input.disposition}`, expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1000) };
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    const object = this.objects.get(key);
    return object === undefined ? null : { sizeBytes: object.length };
  }

  async read(key: string, maxBytes: number): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (object === undefined) throw new Error(`Object ${key} does not exist`);
    if (object.length > maxBytes) throw new Error(`Object ${key} is larger than ${maxBytes} bytes`);
    return object;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async listKeys(prefix: string, limit: number): Promise<string[]> {
    return this.keys.filter((key) => key.startsWith(prefix)).sort().slice(0, limit);
  }

  async deleteMany(keys: readonly string[]): Promise<{ failed: readonly string[] }> {
    for (const key of keys) this.objects.delete(key);
    return { failed: [] };
  }

  async openMultipartWrite(key: string): Promise<MultipartWrite> {
    this.multipart.opened += 1;
    const chunks: Uint8Array[] = [];
    let state: 'open' | 'completed' | 'aborted' = 'open';
    const assertOpen = () => {
      if (state !== 'open') throw new Error(`The multipart upload is ${state}`);
    };
    return {
      write: async (chunk) => {
        assertOpen();
        chunks.push(Buffer.from(chunk));
      },
      complete: async () => {
        assertOpen();
        state = 'completed';
        this.multipart.completed += 1;
        const body = Buffer.concat(chunks);
        // Like S3: completing replaces what an earlier attempt left at the key.
        this.objects.set(key, body);
        return { sizeBytes: body.length };
      },
      abort: async () => {
        if (state !== 'open') return;
        state = 'aborted';
        this.multipart.aborted += 1;
      },
    };
  }
}
