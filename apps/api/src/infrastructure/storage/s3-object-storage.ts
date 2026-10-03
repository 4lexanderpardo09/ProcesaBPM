import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageUnavailableError } from '@procesabpm/shared';
import { contentDisposition } from './content-disposition.js';
import { ObjectStorage, type PresignDownloadInput, type PresignedDownload, type PresignedUpload, type PresignUploadInput, type PutObjectInput } from './object-storage.js';

export interface S3StorageSettings {
  readonly endpoint: string;
  /** Host the browsers reach; defaults to `endpoint`. */
  readonly publicEndpoint?: string | undefined;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

const DELETE_BATCH = 1000;

const isNotFound = (error: unknown): boolean => {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
};

/** Adapter for any S3-compatible service (SeaweedFS, MinIO, Cloudflare R2, AWS S3). */
export class S3ObjectStorage extends ObjectStorage {
  private readonly client: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly settings: S3StorageSettings) {
    super();
    const common = { region: settings.region, requestChecksumCalculation: 'WHEN_REQUIRED' as const, responseChecksumValidation: 'WHEN_REQUIRED' as const, forcePathStyle: settings.forcePathStyle, credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } };
    this.client = new S3Client({ ...common, endpoint: settings.endpoint });
    // The URL's host is part of the signature, so signing happens with the host the browser will use.
    this.signer = new S3Client({ ...common, endpoint: settings.publicEndpoint ?? settings.endpoint });
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    const command = new PutObjectCommand({ Bucket: this.settings.bucket, Key: input.key, ContentType: input.contentType, ContentLength: input.contentLength, IfNoneMatch: '*' });
    const url = await getSignedUrl(this.signer, command, { expiresIn: input.expiresInSeconds, signingDate: input.now, signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']) });
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': input.contentType, 'content-length': String(input.contentLength), 'if-none-match': '*' },
      expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1000),
    };
  }

  async presignDownload(input: PresignDownloadInput): Promise<PresignedDownload> {
    const command = new GetObjectCommand({
      Bucket: this.settings.bucket,
      Key: input.key,
      ResponseContentType: input.contentType,
      // The uploader chose these headers when sending the bytes (they are not signed): never let them reach the browser.
      ResponseContentEncoding: 'identity',
      ResponseCacheControl: 'private, no-store',
      ResponseContentDisposition: contentDisposition(input.disposition, input.fileName),
    });
    const url = await getSignedUrl(this.signer, command, { expiresIn: input.expiresInSeconds, signingDate: input.now });
    return { url, expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1000) };
  }

  async put(input: PutObjectInput): Promise<'created' | 'exists'> {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: input.key, Body: input.body, ContentType: input.contentType, ContentLength: input.body.length, IfNoneMatch: '*' }));
      return 'created';
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412) return 'exists';
      throw new StorageUnavailableError({ cause: error });
    }
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      return { sizeBytes: result.ContentLength ?? 0 };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new StorageUnavailableError({ cause: error });
    }
  }

  async read(key: string, maxBytes: number): Promise<Uint8Array> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key, Range: `bytes=0-${maxBytes}` }));
      const content = await result.Body!.transformToByteArray();
      if (content.length > maxBytes) throw new RangeError(`Object ${key} is larger than ${maxBytes} bytes`);
      return content;
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw new StorageUnavailableError({ cause: error });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }

  async listKeys(prefix: string, limit: number): Promise<string[]> {
    try {
      const result = await this.client.send(new ListObjectsV2Command({ Bucket: this.settings.bucket, Prefix: prefix, MaxKeys: Math.min(limit, DELETE_BATCH) }));
      return (result.Contents ?? []).flatMap((entry) => (entry.Key === undefined ? [] : [entry.Key]));
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }

  async deleteMany(keys: readonly string[]): Promise<{ failed: readonly string[] }> {
    const failed: string[] = [];
    for (let start = 0; start < keys.length; start += DELETE_BATCH) {
      const batch = keys.slice(start, start + DELETE_BATCH);
      try {
        const result = await this.client.send(new DeleteObjectsCommand({ Bucket: this.settings.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
        failed.push(...(result.Errors ?? []).flatMap((entry) => (entry.Key === undefined ? [] : [entry.Key])));
      } catch {
        failed.push(...batch);
      }
    }
    return { failed };
  }
}
