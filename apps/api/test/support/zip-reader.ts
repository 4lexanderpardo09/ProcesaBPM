import { type Entry, fromBufferPromise, type ZipFile } from 'yauzl';

export interface ZipEntry {
  readonly name: string;
  readonly content: Buffer;
}

/** Every entry of a zip, in archive order, read with an independent implementation (yauzl). */
export async function readZip(archive: Uint8Array): Promise<ZipEntry[]> {
  const zip = await fromBufferPromise(Buffer.from(archive), { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
  const entries: ZipEntry[] = [];
  try {
    for (;;) {
      const entry = await nextEntry(zip);
      if (entry === null) return entries;
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      entries.push({ name: entry.fileName, content: Buffer.concat(chunks) });
    }
  } finally {
    zip.close();
  }
}

function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      zip.off('entry', onEntry);
      zip.off('end', onEnd);
      zip.off('error', onError);
    };
    zip.once('entry', onEntry);
    zip.once('end', onEnd);
    zip.once('error', onError);
    zip.readEntry();
  });
}
