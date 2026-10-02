import { Inject, Injectable } from '@nestjs/common';
import { PDF_LIMITS } from '@procesabpm/shared';
import { isSafeImage } from '../../../infrastructure/pdf/image-size.js';
import type { ImageBytes } from '../../../infrastructure/pdf/pdf-renderer.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';

/**
 * Reads the images a document shows (the tenant logo, signatures). A missing, oversized or suspicious image is left out:
 * a document must not fail, or take the worker down, because of somebody's picture.
 */
@Injectable()
export class ImageLoader {
  constructor(@Inject(ObjectStorage) private readonly storage: ObjectStorage) {}

  async load(wanted: ReadonlySet<string>, storageKeys: ReadonlyMap<string, string>): Promise<Map<string, ImageBytes>> {
    const images = new Map<string, ImageBytes>();
    for (const key of wanted) {
      const storageKey = storageKeys.get(key);
      if (storageKey === undefined) continue;
      const stored = await this.storage.head(storageKey);
      if (stored === null || stored.sizeBytes > PDF_LIMITS.maxSignatureImageBytes) continue;
      const bytes = await this.storage.read(storageKey, PDF_LIMITS.maxSignatureImageBytes);
      if (isSafeImage(bytes)) images.set(key, { bytes });
    }
    return images;
  }
}
