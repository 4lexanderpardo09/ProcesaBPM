import { ApiError, type GenericErrorMessage, genericErrorMessage } from '@/shared/api';
import { StorageUploadError } from '@/shared/files/upload-files';

const FORBIDDEN = 403;
const NOT_FOUND = 404;

export const TEMPLATE_REJECTIONS = ['NOT_PDF', 'ENCRYPTED', 'TOO_MANY_PAGES', 'TOO_COMPLEX', 'MALFORMED', 'PAGE_SIZE'] as const;
type TemplateRejection = (typeof TEMPLATE_REJECTIONS)[number];

/** What was being removed: a source in use is a format or template a document (or a DOCUMENT block) still points at. */
export type DocumentErrorContext = 'source' | 'document' | 'other';

export type DocumentErrorKey =
  | `documents.errors.template.${TemplateRejection}`
  | 'documents.errors.sourceInUse'
  | 'documents.errors.documentInUse'
  | 'documents.errors.imageInUse'
  | 'documents.errors.designInvalid'
  | 'documents.errors.mappingInvalid'
  | 'documents.errors.nameTaken'
  | 'documents.errors.uploadFailed'
  | 'documents.errors.fileRejected'
  | 'documents.errors.notFound'
  | 'documents.errors.forbidden';

export type DocumentErrorMessage = { readonly namespace: 'workflows'; readonly key: DocumentErrorKey } | ({ readonly namespace: 'common' } & GenericErrorMessage);

const reasonOf = (error: ApiError): unknown => (typeof error.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>)['reason'] : undefined);

/** Never the API's own text: a key of the `workflows` namespace, or the generic message. */
export function documentErrorMessage(error: unknown, context: DocumentErrorContext = 'other'): DocumentErrorMessage {
  if (error instanceof StorageUploadError) return { namespace: 'workflows', key: 'documents.errors.uploadFailed' };
  if (error instanceof ApiError) {
    if (error.code === 'PDF_TEMPLATE_INVALID') {
      const reason = TEMPLATE_REJECTIONS.find((candidate) => candidate === reasonOf(error));
      if (reason !== undefined) return { namespace: 'workflows', key: `documents.errors.template.${reason}` };
    }
    if (error.code === 'DOCUMENT_SOURCE_IN_USE') return { namespace: 'workflows', key: context === 'document' ? 'documents.errors.documentInUse' : 'documents.errors.sourceInUse' };
    if (error.code === 'PDF_IMAGE_IN_USE') return { namespace: 'workflows', key: 'documents.errors.imageInUse' };
    if (error.code === 'PDF_DESIGN_INVALID') return { namespace: 'workflows', key: 'documents.errors.designInvalid' };
    if (error.code === 'PDF_MAPPING_INVALID') return { namespace: 'workflows', key: 'documents.errors.mappingInvalid' };
    if (error.code === 'DUPLICATE') return { namespace: 'workflows', key: 'documents.errors.nameTaken' };
    if (error.code === 'FILE_REJECTED') return { namespace: 'workflows', key: 'documents.errors.fileRejected' };
    if (error.status === FORBIDDEN) return { namespace: 'workflows', key: 'documents.errors.forbidden' };
    if (error.status === NOT_FOUND) return { namespace: 'workflows', key: 'documents.errors.notFound' };
  }
  return { namespace: 'common', ...genericErrorMessage(error) };
}
