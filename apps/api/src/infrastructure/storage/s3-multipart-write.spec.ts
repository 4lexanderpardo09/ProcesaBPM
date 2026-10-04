import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import { StorageUnavailableError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { S3MultipartWrite } from './s3-multipart-write.js';

const TARGET = { bucket: 'b', key: 'tenants/t/exports/e.zip', uploadId: 'u1' };
const PART = 10;

/** Records the commands; each part upload resolves only when the test releases it. */
class FakeClient {
  readonly commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  readonly pending: Array<() => void> = [];
  maxConcurrentParts = 0;
  private uploading = 0;
  failParts = false;
  autoRelease = true;

  async send(command: unknown): Promise<Record<string, unknown>> {
    const { input } = command as { input: Record<string, unknown> };
    const name = command instanceof UploadPartCommand ? 'UploadPart' : command instanceof CompleteMultipartUploadCommand ? 'Complete' : command instanceof AbortMultipartUploadCommand ? 'Abort' : 'Other';
    this.commands.push({ name, input });
    if (name !== 'UploadPart') return {};
    this.uploading += 1;
    this.maxConcurrentParts = Math.max(this.maxConcurrentParts, this.uploading);
    if (!this.autoRelease) await new Promise<void>((resolve) => this.pending.push(resolve));
    else await Promise.resolve();
    this.uploading -= 1;
    if (this.failParts) throw new Error('network down');
    return { ETag: `"etag-${String(input.PartNumber)}"` };
  }

  parts(): Array<{ number: unknown; size: number }> {
    return this.commands.filter((command) => command.name === 'UploadPart').map((command) => ({ number: command.input.PartNumber, size: (command.input.Body as Buffer).length }));
  }
}

const bytes = (count: number, fill = 1) => new Uint8Array(count).fill(fill);

describe('S3MultipartWrite', () => {
  it('cuts the stream into fixed-size parts, sends the remainder last and completes with every part in order', async () => {
    const client = new FakeClient();
    const upload = new S3MultipartWrite(client, TARGET, PART);
    for (const size of [4, 9, 12, 3]) await upload.write(bytes(size));
    expect(await upload.complete()).toEqual({ sizeBytes: 28 });
    expect(client.parts()).toEqual([
      { number: 1, size: 10 },
      { number: 2, size: 10 },
      { number: 3, size: 8 },
    ]);
    const complete = client.commands.at(-1)!;
    expect(complete.name).toBe('Complete');
    expect(complete.input).toMatchObject({ Bucket: 'b', Key: TARGET.key, UploadId: 'u1', MultipartUpload: { Parts: [1, 2, 3].map((n) => ({ PartNumber: n, ETag: `"etag-${n}"` })) } });
  });

  it('keeps at most one part in flight: a write waits while the next part is full', async () => {
    const client = new FakeClient();
    client.autoRelease = false;
    const upload = new S3MultipartWrite(client, TARGET, PART);
    await upload.write(bytes(PART));
    let secondDone = false;
    const second = upload.write(bytes(PART)).then(() => {
      secondDone = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(secondDone).toBe(false);
    expect(client.parts()).toHaveLength(1);
    client.pending.shift()!();
    await second;
    expect(client.parts()).toHaveLength(2);
    client.pending.shift()!();
    const completing = upload.complete();
    await completing;
    expect(client.maxConcurrentParts).toBe(1);
  });

  it('uploads one empty part for an empty object', async () => {
    const client = new FakeClient();
    const upload = new S3MultipartWrite(client, TARGET, PART);
    await upload.complete();
    expect(client.parts()).toEqual([{ number: 1, size: 0 }]);
  });

  it('reports a failed part as unavailable storage, and abort discards the upload once', async () => {
    const client = new FakeClient();
    client.failParts = true;
    const upload = new S3MultipartWrite(client, TARGET, PART);
    await upload.write(bytes(PART));
    await expect(upload.write(bytes(PART))).rejects.toBeInstanceOf(StorageUnavailableError);
    await upload.abort();
    await upload.abort();
    expect(client.commands.filter((command) => command.name === 'Abort')).toHaveLength(1);
    await expect(upload.write(bytes(1))).rejects.toThrow('aborted');
  });

  it('abort after complete does nothing', async () => {
    const client = new FakeClient();
    const upload = new S3MultipartWrite(client, TARGET, PART);
    await upload.write(bytes(3));
    await upload.complete();
    await upload.abort();
    expect(client.commands.some((command) => command.name === 'Abort')).toBe(false);
  });
});
