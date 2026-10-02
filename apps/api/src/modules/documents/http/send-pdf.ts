import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { contentDisposition } from '../../../infrastructure/storage/s3-object-storage.js';
import type { PreviewPdf } from '../application/pdf-preview.service.js';

/** A generated PDF as the response body: shown in the browser, never cached, never sniffed as something else. */
export function sendPdf(response: Response, pdf: PreviewPdf): StreamableFile {
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', contentDisposition('inline', pdf.fileName));
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(pdf.bytes);
}
