import { Inject, Injectable } from '@nestjs/common';
import { AttachmentsInvalidError } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { FileAttachmentService } from '../../files/application/file-attachment.service.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';

/** A signature image goes in a PDF: PNG and JPEG are what the renderer embeds. */
const SIGNATURE_MIME_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg']);

export interface CapturedSignature {
  readonly ticketId: string;
  readonly companyId: string;
  readonly stepId: string;
  readonly loop: number;
  readonly userId: string;
  readonly fileId: string;
  readonly isParallel: boolean;
  readonly at: Date;
}

/**
 * The signature drawn (or chosen) when answering a step, as the help desk asks for it: the person's own confirmed PNG
 * or JPEG upload, locked so it cannot be attached elsewhere, marked in use and recorded for the step and loop. The
 * documents of the step show it instead of the profile signature.
 */
@Injectable()
export class SignatureCapture {
  constructor(
    @Inject(FileAttachmentService) private readonly files: FileAttachmentService,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
  ) {}

  async record(tx: TenantTransaction, tenantId: string, signature: CapturedSignature): Promise<void> {
    const [file] = await this.files.lockAttachable(tx, tenantId, signature.userId, [signature.fileId]);
    if (file === undefined) throw new AttachmentsInvalidError([{ fileId: signature.fileId, code: 'FILE_NOT_ATTACHABLE' }]);
    if (!SIGNATURE_MIME_TYPES.has(file.mimeType)) throw new AttachmentsInvalidError([{ fileId: signature.fileId, code: 'FILE_TYPE_NOT_ACCEPTED' }]);
    await this.files.linkStandalone(tx, tenantId, [file.id], signature.companyId, signature.at);
    const { companyId: _company, at, ...row } = signature;
    await this.writes.insertSignature(tx, tenantId, { ...row, signedAt: at });
  }
}
