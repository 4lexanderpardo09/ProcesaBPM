import { Module } from '@nestjs/common';
import { FileFontProvider, FontProvider } from './font-provider.js';
import { PdfLibInspector } from './pdf-lib-inspector.js';
import { PdfLibRenderer } from './pdf-lib-renderer.js';
import { PdfInspector, PdfRenderer } from './pdf-renderer.js';

/** The pdf engine behind its ports: pdf-lib with the embedded Noto Sans fonts. */
@Module({
  providers: [
    { provide: FontProvider, useFactory: (): FontProvider => new FileFontProvider() },
    { provide: PdfRenderer, inject: [FontProvider], useFactory: (fonts: FontProvider): PdfRenderer => new PdfLibRenderer(fonts) },
    { provide: PdfInspector, useClass: PdfLibInspector },
  ],
  exports: [PdfRenderer, PdfInspector],
})
export class PdfModule {}
