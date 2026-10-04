import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readZip } from '../../../test/support/zip-reader.js';
import { YazlZipArchiveFactory, type ZipSink } from './zip-archive.js';

const MTIME = new Date('2026-10-04T12:00:00Z');

class CollectingSink implements ZipSink {
  readonly chunks: Uint8Array[] = [];
  constructor(
    private readonly delayMs = 0,
    private readonly failAfterBytes = Number.POSITIVE_INFINITY,
  ) {}
  get bytes(): number {
    return this.chunks.reduce((total, chunk) => total + chunk.length, 0);
  }
  async write(chunk: Uint8Array): Promise<void> {
    if (this.bytes + chunk.length > this.failAfterBytes) throw new Error('sink refused');
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.chunks.push(Buffer.from(chunk));
  }
  get content(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

describe('YazlZipArchive', () => {
  it('writes the entries in order, readable by another implementation', async () => {
    const sink = new CollectingSink();
    const zip = new YazlZipArchiveFactory().open(sink, { mtime: MTIME });
    await zip.addBytes('manifest.json', Buffer.from('{"a":1}'));
    await zip.addStreamed('data/rows.jsonl', async (entry) => {
      for (let line = 0; line < 3; line += 1) await entry.write(`{"line":${line}}\n`);
    });
    await zip.addBytes('files/ñandú.txt', Buffer.from('señal'));
    await zip.finish();

    const entries = await readZip(sink.content);
    expect(entries.map((entry) => entry.name)).toEqual(['manifest.json', 'data/rows.jsonl', 'files/ñandú.txt']);
    expect(entries[1]!.content.toString()).toBe('{"line":0}\n{"line":1}\n{"line":2}\n');
    expect(entries[2]!.content.toString()).toBe('señal');
  });

  it('streams an entry larger than the buffers through a slow sink without losing bytes', async () => {
    const sink = new CollectingSink(1);
    const zip = new YazlZipArchiveFactory().open(sink, { mtime: MTIME });
    const parts = Array.from({ length: 40 }, () => randomBytes(64 * 1024));
    await zip.addStreamed('big.bin', async (entry) => {
      for (const part of parts) await entry.write(part);
    });
    await zip.finish();
    const [entry] = await readZip(sink.content);
    expect(entry!.content.equals(Buffer.concat(parts))).toBe(true);
  });

  it('rejects the pending write and every later call when the sink fails', async () => {
    const sink = new CollectingSink(0, 10_000);
    const zip = new YazlZipArchiveFactory().open(sink, { mtime: MTIME });
    const writing = zip.addStreamed('random.bin', async (entry) => {
      for (let part = 0; part < 100; part += 1) await entry.write(randomBytes(32 * 1024));
    });
    await expect(writing).rejects.toThrow('sink refused');
    await expect(zip.addBytes('later.txt', Buffer.from('x'))).rejects.toThrow('sink refused');
    await expect(zip.finish()).rejects.toThrow('sink refused');
  });

  it('stops at once when destroyed: nothing more reaches the sink', async () => {
    const sink = new CollectingSink();
    const zip = new YazlZipArchiveFactory().open(sink, { mtime: MTIME });
    await zip.addBytes('first.txt', Buffer.from('first'));
    zip.destroy(new Error('lease lost'));
    const written = sink.bytes;
    await expect(zip.addBytes('second.txt', Buffer.from('second'))).rejects.toThrow('lease lost');
    await expect(zip.finish()).rejects.toThrow('lease lost');
    expect(sink.bytes).toBe(written);
  });

  it('refuses an entry name that escapes the archive', async () => {
    const zip = new YazlZipArchiveFactory().open(new CollectingSink(), { mtime: MTIME });
    await expect(zip.addBytes('../evil.txt', Buffer.from('x'))).rejects.toThrow();
  });
});
