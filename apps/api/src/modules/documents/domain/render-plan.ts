import { pdfDesignSchema, PdfDesignInvalidError } from '@procesabpm/shared';
import type { DesignJob, TemplateJob } from '../../../infrastructure/pdf/pdf-renderer.js';
import type { WorkflowDocumentSource } from '../data/document-source.repository.js';
import { documentsEs as es } from '../i18n/es.js';
import { DesignResolver } from './design-resolver.js';
import { generatedFileName } from './generated-file-name.js';
import type { RenderFacts } from './render-facts.js';
import { resolveTemplateFields, resolveTemplateSignatures } from './template-resolver.js';

/** Everything to draw one document except the bytes (images, the template PDF) and the deadline, which the renderer step adds. */
export type RenderPlan = {
  readonly fileName: string;
  /** Image keys the job refers to (`logo`, `sig:<user>`): the caller supplies their bytes. */
  readonly imageKeys: ReadonlySet<string>;
} & (
  | { readonly kind: 'DESIGN'; readonly job: Omit<DesignJob, 'images' | 'deadlineAt' | 'meta'> }
  | { readonly kind: 'TEMPLATE'; readonly templateStorageKey: string; readonly job: Pick<TemplateJob, 'fields' | 'signatures'> }
);

/** Evaluates a workflow document's source against a ticket's facts. Throws `PdfDesignInvalidError` when the stored design is unusable. */
export function planRender(source: WorkflowDocumentSource, facts: RenderFacts): RenderPlan {
  const resolver = new DesignResolver(facts);
  if (source.kind === 'DESIGNED' && source.format !== null) {
    const design = pdfDesignSchema.safeParse(source.format.design);
    if (!design.success) throw new PdfDesignInvalidError(design.error.issues.map((issue) => ({ code: 'DESIGN_SCHEMA', path: issue.path.join('.'), detail: issue.message })));
    const resolved = resolver.resolve(design.data);
    const fileName = fileNameOf(source.format.fileNamePattern, source.format.name, resolver, facts);
    return {
      kind: 'DESIGN',
      fileName,
      imageKeys: imageKeysOf(facts, resolved.usesLogo),
      job: { page: resolved.page, defaultFontSize: resolved.defaultFontSize, body: resolved.body, header: resolved.header, footer: resolved.footer },
    };
  }
  const template = source.template!;
  return {
    kind: 'TEMPLATE',
    fileName: fileNameOf(null, template.name, resolver, facts),
    imageKeys: imageKeysOf(facts, false),
    templateStorageKey: template.storageKey,
    job: { fields: resolveTemplateFields(template.fields, resolver), signatures: resolveTemplateSignatures(template.signatures, resolver) },
  };
}

function fileNameOf(pattern: string | null, sourceName: string, resolver: DesignResolver, facts: RenderFacts): string {
  const fallback = es.defaultFileName(facts.ticket.number);
  const base = pattern === null ? `${fallback}-${sourceName}` : resolver.evaluate(pattern, 'fileNamePattern');
  return generatedFileName(base, fallback);
}

const imageKeysOf = (facts: RenderFacts, logo: boolean): ReadonlySet<string> =>
  new Set([...(logo ? ['logo'] : []), ...[...facts.signers.values()].flatMap((records) => records.flatMap((record) => (record.imageKey === null ? [] : [record.imageKey])))]);
