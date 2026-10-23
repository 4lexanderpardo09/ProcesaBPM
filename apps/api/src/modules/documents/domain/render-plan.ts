import { anyPdfDesignSchema, PdfDesignInvalidError } from '@procesabpm/shared';
import type { CanvasJob, DesignJob, TemplateJob } from '../../../infrastructure/pdf/pdf-renderer.js';
import type { WorkflowDocumentSource } from '../data/document-source.repository.js';
import { documentsEs as es } from '../i18n/es.js';
import { CanvasResolver } from './canvas-resolver.js';
import { DesignResolver } from './design-resolver.js';
import { generatedFileName } from './generated-file-name.js';
import { type ApproverAsk, approverKey, type RenderFacts } from './render-facts.js';
import { resolveTemplateFields, resolveTemplateSignatures } from './template-resolver.js';

/** Everything to draw one document except the bytes (images, the template PDF) and the deadline, which the renderer step adds. */
export type RenderPlan = {
  readonly fileName: string;
  /** Image keys the job refers to (`logo`, `img:<image id>`, `sig:<user>`): the caller supplies their bytes. */
  readonly imageKeys: ReadonlySet<string>;
} & (
  | { readonly kind: 'DESIGN'; readonly job: Omit<DesignJob, 'images' | 'deadlineAt' | 'meta'> }
  | { readonly kind: 'CANVAS'; readonly job: Omit<CanvasJob, 'images' | 'deadlineAt' | 'meta'> }
  | { readonly kind: 'TEMPLATE'; readonly templateStorageKey: string; readonly job: Pick<TemplateJob, 'fields' | 'signatures'> }
);

/** The approvers the source's signature boxes keep, so the facts can bring them; none when the design does not parse. */
export function approverAsksOf(source: WorkflowDocumentSource): ApproverAsk[] {
  if (source.kind !== 'DESIGNED' || source.format === null) return [];
  const design = anyPdfDesignSchema.safeParse(source.format.design);
  if (!design.success || design.data.version !== 2) return [];
  const asks = design.data.elements.flatMap((element) => (element.type === 'signature' && element.approverOf !== undefined ? [element.approverOf] : []));
  return [...new Map(asks.map((ask) => [approverKey(ask), ask])).values()];
}

/** Evaluates a workflow document's source against a ticket's facts. Throws `PdfDesignInvalidError` when the stored design is unusable. */
export function planRender(source: WorkflowDocumentSource, facts: RenderFacts): RenderPlan {
  const resolver = new DesignResolver(facts);
  if (source.kind === 'DESIGNED' && source.format !== null) {
    const design = anyPdfDesignSchema.safeParse(source.format.design);
    if (!design.success) throw new PdfDesignInvalidError(design.error.issues.map((issue) => ({ code: 'DESIGN_SCHEMA', path: issue.path.join('.'), detail: issue.message })));
    if (design.data.version === 2) {
      const canvas = new CanvasResolver(facts).resolve(design.data);
      return { kind: 'CANVAS', fileName: fileNameOf(source.format.fileNamePattern, source.format.name, canvas.texts, facts), imageKeys: imageKeysOf(facts, canvas.imageKeys), job: canvas.content };
    }
    const resolved = resolver.resolve(design.data);
    const fileName = fileNameOf(source.format.fileNamePattern, source.format.name, resolver, facts);
    return {
      kind: 'DESIGN',
      fileName,
      imageKeys: imageKeysOf(facts, resolved.usesLogo ? ['logo'] : []),
      job: { page: resolved.page, defaultFontSize: resolved.defaultFontSize, body: resolved.body, header: resolved.header, footer: resolved.footer },
    };
  }
  const template = source.template!;
  return {
    kind: 'TEMPLATE',
    fileName: fileNameOf(null, template.name, resolver, facts),
    imageKeys: imageKeysOf(facts, []),
    templateStorageKey: template.storageKey,
    job: { fields: resolveTemplateFields(template.fields, resolver), signatures: resolveTemplateSignatures(template.signatures, resolver) },
  };
}

function fileNameOf(pattern: string | null, sourceName: string, resolver: DesignResolver, facts: RenderFacts): string {
  const fallback = es.defaultFileName(facts.ticket.number);
  const base = pattern === null ? `${fallback}-${sourceName}` : resolver.evaluate(pattern, 'fileNamePattern');
  return generatedFileName(base, fallback);
}

const imageKeysOf = (facts: RenderFacts, shown: Iterable<string>): ReadonlySet<string> =>
  new Set([...shown, ...[...facts.signers.values()].flatMap((records) => records.flatMap((record) => (record.imageKey === null ? [] : [record.imageKey])))]);
