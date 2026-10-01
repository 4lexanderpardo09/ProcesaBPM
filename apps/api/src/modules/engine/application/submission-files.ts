import { Inject, Injectable } from '@nestjs/common';
import { AttachmentsInvalidError, type FieldValueIssue, type FileKind, kindOfMime, type ReferenceToVerify } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { FileAttachmentService } from '../../files/application/file-attachment.service.js';
import type { AttachmentsPlan } from '../domain/plan.js';
import { diffFieldFiles, type FieldFileChange, findRepeatedFiles } from '../domain/field-file-changes.js';

export interface SubmissionFiles {
  readonly attachmentIds: readonly string[];
  readonly fieldFiles: readonly FieldFileChange[];
}

export interface FilesCheckRequest {
  readonly tenantId: string;
  readonly uploaderId: string;
  readonly attachmentIds: readonly string[];
  readonly fileFieldCodes: readonly string[];
  readonly capturedValues: Readonly<Record<string, unknown>>;
  readonly existing: Readonly<Record<string, unknown>>;
  /** The FILE references `validateCapturedValues` produced: they carry each field's accepted kinds. */
  readonly references: readonly ReferenceToVerify[];
}

/**
 * The files part of a submission: which uploads it adds to FILE fields and as loose attachments, and whether
 * this person may attach each one (their own, confirmed, never attached, accepted kinds). The rows are locked
 * until the transaction ends, so the same upload cannot be attached twice by two submissions.
 */
@Injectable()
export class SubmissionFilesChecker {
  constructor(@Inject(FileAttachmentService) private readonly attachments: FileAttachmentService) {}

  async check(tx: TenantTransaction, request: FilesCheckRequest): Promise<{ files: SubmissionFiles; issues: FieldValueIssue[] }> {
    const fieldFiles = diffFieldFiles(request.fileFieldCodes, request.capturedValues, request.existing);
    const repeated = findRepeatedFiles(fieldFiles, request.attachmentIds);
    if (repeated.length > 0) return { files: { attachmentIds: request.attachmentIds, fieldFiles }, issues: repeated };

    const wanted = [...request.attachmentIds, ...fieldFiles.flatMap((change) => change.added)];
    const found = new Map((await this.attachments.lockAttachable(tx, request.tenantId, request.uploaderId, wanted)).map((file) => [file.id, file]));

    const missing = request.attachmentIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw new AttachmentsInvalidError(missing.map((fileId) => ({ fileId, code: 'FILE_NOT_ATTACHABLE' })));

    const issues: FieldValueIssue[] = [];
    for (const change of fieldFiles) {
      for (const id of change.added) {
        const file = found.get(id);
        if (file === undefined) issues.push({ code: 'FILE_NOT_ATTACHABLE', fieldCode: change.fieldCode });
        else if (!this.accepts(request.references, change.fieldCode, id, kindOfMime(file.mimeType))) issues.push({ code: 'FILE_TYPE_NOT_ACCEPTED', fieldCode: change.fieldCode });
      }
    }
    return { files: { attachmentIds: request.attachmentIds, fieldFiles }, issues };
  }

  private accepts(references: readonly ReferenceToVerify[], fieldCode: string, fileId: string, kind: FileKind | undefined): boolean {
    const accept = references.find((reference) => reference.fieldCode === fieldCode && reference.value === fileId)?.config.accept;
    return !Array.isArray(accept) || accept.length === 0 || (kind !== undefined && accept.includes(kind));
  }
}

/** The plan for the event a submission produces; nothing when it attaches and retires nothing. */
export function attachmentsPlanOf(files: SubmissionFiles, stepId: string | null, role: AttachmentsPlan['role']): AttachmentsPlan | undefined {
  return files.attachmentIds.length === 0 && files.fieldFiles.length === 0 ? undefined : { stepId, role, attachmentIds: files.attachmentIds, fieldFiles: files.fieldFiles };
}
