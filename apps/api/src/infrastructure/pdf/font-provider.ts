import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The embedded fonts (Noto Sans, OFL): they cover Spanish accents, ñ, ¿ ¡ and the euro sign. Read once, then cached. */
export abstract class FontProvider {
  abstract regular(): Promise<Uint8Array>;
  abstract bold(): Promise<Uint8Array>;
}

const DEFAULT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');

export class FileFontProvider extends FontProvider {
  private regularBytes: Promise<Uint8Array> | undefined;
  private boldBytes: Promise<Uint8Array> | undefined;

  constructor(private readonly directory: string = process.env.PDF_FONT_DIR ?? DEFAULT_DIRECTORY) {
    super();
  }

  regular(): Promise<Uint8Array> {
    this.regularBytes ??= readFile(join(this.directory, 'NotoSans-Regular.ttf'));
    return this.regularBytes;
  }

  bold(): Promise<Uint8Array> {
    this.boldBytes ??= readFile(join(this.directory, 'NotoSans-Bold.ttf'));
    return this.boldBytes;
  }
}
