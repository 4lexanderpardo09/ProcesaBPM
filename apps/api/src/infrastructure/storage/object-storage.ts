export interface PutObjectInput {
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface PresignedUpload {
  readonly url: string;
  readonly method: 'PUT';
  /** Headers the browser must send exactly as given: they are part of the signature. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface PresignedDownload {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface PresignUploadInput {
  readonly key: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly expiresInSeconds: number;
  readonly now: Date;
}

export interface PresignDownloadInput {
  readonly key: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly disposition: 'inline' | 'attachment';
  readonly expiresInSeconds: number;
  readonly now: Date;
}

/**
 * Port of the S3-compatible object storage. Signing a URL is local computation; every other method is a
 * network call and must never run inside a database transaction.
 */
export abstract class ObjectStorage {
  /** The signature fixes the length and forbids overwriting (`If-None-Match: *`), so an object is written once. */
  abstract presignUpload(input: PresignUploadInput): Promise<PresignedUpload>;
  abstract presignDownload(input: PresignDownloadInput): Promise<PresignedDownload>;
  /** Server-side write for what the system itself produces. Never overwrites: `'exists'` when the key is taken. */
  abstract put(input: PutObjectInput): Promise<'created' | 'exists'>;
  /** `null` when the object does not exist. */
  abstract head(key: string): Promise<{ readonly sizeBytes: number } | null>;
  /** The whole object; throws when it is larger than `maxBytes`. */
  abstract read(key: string, maxBytes: number): Promise<Uint8Array>;
  /** Idempotent: deleting a missing object is not an error. */
  abstract delete(key: string): Promise<void>;
  /** Returns the keys it could not delete. */
  abstract deleteMany(keys: readonly string[]): Promise<{ readonly failed: readonly string[] }>;
}
