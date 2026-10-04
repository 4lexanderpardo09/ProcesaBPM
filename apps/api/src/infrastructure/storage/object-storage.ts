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
 * A large object written in parts, front to back, with bounded memory. Each `write` resolves when more can be sent
 * (backpressure). The object only appears on `complete`; `abort` discards every part already sent (idempotent, and a
 * no-op once completed). Completing replaces an object left at the key by an earlier attempt.
 */
export interface MultipartWrite {
  write(chunk: Uint8Array): Promise<void>;
  complete(): Promise<{ readonly sizeBytes: number }>;
  abort(): Promise<void>;
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
  /** Up to `limit` keys that start with `prefix` (S3 lists in key order). Used to empty a tenant's area when it is purged. */
  abstract listKeys(prefix: string, limit: number): Promise<string[]>;
  /** Returns the keys it could not delete. */
  abstract deleteMany(keys: readonly string[]): Promise<{ readonly failed: readonly string[] }>;
  /** Starts a multipart upload for what the system produces in a stream (the organization data export). */
  abstract openMultipartWrite(key: string, contentType: string): Promise<MultipartWrite>;
}
