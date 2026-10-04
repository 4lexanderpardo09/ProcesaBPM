import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { ZipFile } from 'yazl';

/** Where the archive's bytes go, in order. A rejected write stops the archive. */
export interface ZipSink {
  write(chunk: Uint8Array): Promise<void>;
}

/** The content of one streamed entry: each write resolves when the archive can take more (backpressure). */
export interface ZipEntryWriter {
  write(chunk: string | Uint8Array): Promise<void>;
}

/**
 * A zip written front to back into a sink, one entry at a time, without holding the whole archive anywhere: the memory
 * in use is one entry's pending chunk plus the compressor's buffers. ZIP64 records are used when an entry or the archive
 * needs them (more than 4 GiB or 65 535 entries). Entries must be added one after the other (await each call).
 */
export interface ZipArchive {
  addBytes(path: string, content: Uint8Array): Promise<void>;
  addStreamed(path: string, produce: (entry: ZipEntryWriter) => Promise<void>): Promise<void>;
  /** Writes the central directory and resolves once every byte reached the sink. */
  finish(): Promise<void>;
  /** Stops at once: nothing more reaches the sink and every pending or later call rejects with `reason`. */
  destroy(reason: Error): void;
}

export interface ZipArchiveOptions {
  /** The modification time of every entry. */
  readonly mtime: Date;
}

/** Port: opens an archive that writes into a sink. */
export abstract class ZipArchiveFactory {
  abstract open(sink: ZipSink, options: ZipArchiveOptions): ZipArchive;
}

export class YazlZipArchiveFactory extends ZipArchiveFactory {
  open(sink: ZipSink, options: ZipArchiveOptions): ZipArchive {
    return new YazlZipArchive(sink, options);
  }
}

/** yazl adapter: every entry is a lazy stream, so yazl asks for an entry only when the previous one is written. */
class YazlZipArchive implements ZipArchive {
  private readonly zip = new ZipFile();
  private readonly output = this.zip.outputStream as PassThrough;
  private readonly pumped: Promise<void>;
  private failure: Error | undefined;
  private rejectFailed!: (error: Error) => void;
  private readonly failed = new Promise<never>((_resolve, reject) => {
    this.rejectFailed = reject;
  });
  private current: PassThrough | undefined;

  constructor(
    private readonly sink: ZipSink,
    private readonly options: ZipArchiveOptions,
  ) {
    this.failed.catch(() => undefined);
    // Once destroyed, late writes of yazl into its output must not crash the process.
    this.output.on('error', () => undefined);
    this.zip.on('error', (error: Error) => this.destroy(error));
    this.pumped = this.pump();
    this.pumped.catch(() => undefined);
  }

  addBytes(path: string, content: Uint8Array): Promise<void> {
    return this.addStreamed(path, (entry) => entry.write(content));
  }

  async addStreamed(path: string, produce: (entry: ZipEntryWriter) => Promise<void>): Promise<void> {
    this.throwIfFailed();
    const stream = new PassThrough();
    stream.on('error', () => undefined);
    const requested = new Promise<void>((resolve) => {
      this.zip.addReadStreamLazy(path, { mtime: this.options.mtime, compress: true }, (callback) => {
        this.current = stream;
        callback(null, stream);
        resolve();
      });
    });
    await this.untilFailure(requested);
    await produce({ write: (chunk) => this.writeTo(stream, chunk) });
    this.throwIfFailed();
    const consumed = once(stream, 'end');
    stream.end();
    await this.untilFailure(consumed);
  }

  async finish(): Promise<void> {
    this.throwIfFailed();
    this.zip.end();
    await this.untilFailure(this.pumped);
    this.throwIfFailed();
  }

  destroy(reason: Error): void {
    if (this.failure !== undefined) return;
    this.failure = reason;
    this.rejectFailed(reason);
    this.current?.destroy();
    this.output.destroy();
  }

  private async pump(): Promise<void> {
    try {
      for await (const chunk of this.output) {
        this.throwIfFailed();
        await this.sink.write(chunk as Uint8Array);
      }
    } catch (error) {
      this.destroy(error instanceof Error ? error : new Error('The archive could not be written'));
      throw this.failure;
    }
  }

  private async writeTo(stream: PassThrough, chunk: string | Uint8Array): Promise<void> {
    this.throwIfFailed();
    if (!stream.write(chunk)) await this.untilFailure(once(stream, 'drain'));
  }

  private untilFailure<T>(work: Promise<T>): Promise<T> {
    return Promise.race([work, this.failed]);
  }

  private throwIfFailed(): void {
    if (this.failure !== undefined) throw this.failure;
  }
}
