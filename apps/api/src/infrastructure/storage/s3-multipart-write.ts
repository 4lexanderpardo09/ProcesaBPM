import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, type S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { StorageUnavailableError } from '@procesabpm/shared';
import type { MultipartWrite } from './object-storage.js';

/** 16 MiB parts: 10 000 parts (the S3 limit) hold 156 GiB, above the export size cap. */
export const MULTIPART_PART_BYTES = 16 * 1024 * 1024;
export const MULTIPART_MAX_PARTS = 10_000;

export interface MultipartTarget {
  readonly bucket: string;
  readonly key: string;
  readonly uploadId: string;
}

type Sender = Pick<S3Client, 'send'>;

/**
 * One multipart upload. At most one part is in flight while the next one fills, so the memory held is about two parts
 * whatever the object's size; `write` waits for the part in flight when the next one is full.
 */
export class S3MultipartWrite implements MultipartWrite {
  private buffered: Buffer[] = [];
  private bufferedBytes = 0;
  private totalBytes = 0;
  private nextPartNumber = 1;
  private readonly parts: Array<{ ETag: string; PartNumber: number }> = [];
  private inFlight: Promise<void> | undefined;
  private state: 'open' | 'completed' | 'aborted' = 'open';

  constructor(
    private readonly client: Sender,
    private readonly target: MultipartTarget,
    private readonly partBytes = MULTIPART_PART_BYTES,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    this.assertOpen();
    this.buffered.push(Buffer.from(chunk));
    this.bufferedBytes += chunk.byteLength;
    this.totalBytes += chunk.byteLength;
    while (this.bufferedBytes >= this.partBytes) {
      const part = this.take(this.partBytes);
      await this.inFlight;
      this.assertOpen();
      this.startPart(part);
    }
  }

  async complete(): Promise<{ sizeBytes: number }> {
    this.assertOpen();
    await this.inFlight;
    // S3 needs at least one part; the last one may be smaller than the minimum part size.
    if (this.bufferedBytes > 0 || this.parts.length === 0) {
      this.startPart(this.take(this.bufferedBytes));
      await this.inFlight;
    }
    try {
      await this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.target.bucket, Key: this.target.key, UploadId: this.target.uploadId, MultipartUpload: { Parts: [...this.parts].sort((a, b) => a.PartNumber - b.PartNumber) } }));
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
    this.state = 'completed';
    return { sizeBytes: this.totalBytes };
  }

  async abort(): Promise<void> {
    if (this.state !== 'open') return;
    this.state = 'aborted';
    this.buffered = [];
    await this.inFlight?.catch(() => undefined);
    try {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.target.bucket, Key: this.target.key, UploadId: this.target.uploadId }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) return;
      throw new StorageUnavailableError({ cause: error });
    }
  }

  private startPart(body: Buffer): void {
    const partNumber = this.nextPartNumber;
    if (partNumber > MULTIPART_MAX_PARTS) throw new RangeError('The object needs more parts than a multipart upload allows');
    this.nextPartNumber += 1;
    const upload = this.uploadPart(partNumber, body);
    // Rejections surface when the part is awaited (next part, complete or abort), never as unhandled.
    upload.catch(() => undefined);
    this.inFlight = upload;
  }

  private async uploadPart(partNumber: number, body: Buffer): Promise<void> {
    try {
      const result = await this.client.send(new UploadPartCommand({ Bucket: this.target.bucket, Key: this.target.key, UploadId: this.target.uploadId, PartNumber: partNumber, Body: body, ContentLength: body.length }));
      if (result.ETag === undefined) throw new Error('The storage did not return the part ETag');
      this.parts.push({ ETag: result.ETag, PartNumber: partNumber });
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }

  /** The first `bytes` buffered bytes as one buffer; the rest stays buffered (copied, so the big buffer can be freed). */
  private take(bytes: number): Buffer {
    const all = Buffer.concat(this.buffered, this.bufferedBytes);
    const rest = all.subarray(bytes);
    this.buffered = rest.length > 0 ? [Buffer.from(rest)] : [];
    this.bufferedBytes = rest.length;
    return all.subarray(0, bytes);
  }

  private assertOpen(): void {
    if (this.state !== 'open') throw new Error(`The multipart upload is ${this.state}`);
  }
}
