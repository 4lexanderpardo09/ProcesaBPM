import { pageResponseSchema, type SaveGraphRequest, type WorkflowProblem, type WorkflowValidation, type WorkflowVersionDocument } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';
import { versionSummarySchema, workflowQueryKeys } from '../../api/workflows-api';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The version document is checked by its shape; its parts are the shared contract the validator itself reads. */
const documentSchema = z.custom<WorkflowVersionDocument>(
  (value) => isObject(value) && Array.isArray(value.steps) && Array.isArray(value.transitions) && Array.isArray(value.fields) && Array.isArray(value.amountRules),
  'Not a workflow version document',
);
const problemShape = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  stepId: z.string().optional(),
  transitionId: z.string().optional(),
  fieldId: z.string().optional(),
  amountRuleId: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())])).optional(),
});
/** Checked by its shape, typed as the shared problem (its optional keys are absent, never `undefined`). */
const problemSchema = z.custom<WorkflowProblem>((value) => problemShape.safeParse(value).success, 'Not a workflow problem');
export const validationSchema = z.custom<WorkflowValidation>(
  (value) => isObject(value) && Array.isArray(value.errors) && Array.isArray(value.warnings) && [...value.errors, ...value.warnings].every((problem) => problemShape.safeParse(problem).success),
  'Not a workflow validation',
);

const versionDetailSchema = z.object({
  workflow: z.object({ id: z.string(), name: z.string(), subcategoryId: z.string() }),
  version: versionSummarySchema,
  document: documentSchema,
  validation: validationSchema.nullable(),
});
export type VersionDetail = z.infer<typeof versionDetailSchema>;

const saveGraphResponseSchema = z.object({ revision: z.number().int(), idMap: z.record(z.string(), z.string()), document: documentSchema, validation: validationSchema });

const versionUrl = (workflowId: string, versionId: string) => `/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}`;

export const builderQueryKeys = {
  version: (workflowId: string, versionId: string) => [...workflowQueryKeys.detail(workflowId), 'version', versionId] as const,
  documents: (workflowId: string) => [...workflowQueryKeys.detail(workflowId), 'documents'] as const,
};

export function versionDetailQueryOptions(client: HttpClient, workflowId: string, versionId: string) {
  return queryOptions({
    queryKey: builderQueryKeys.version(workflowId, versionId),
    queryFn: ({ signal }) => client.request(versionUrl(workflowId, versionId), { schema: versionDetailSchema, signal }),
    // The canvas holds the person's unsaved work: it is never replaced behind their back.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

/** The whole canvas; refused (409 `STALE_REVISION`) when someone saved since `revision` was read. */
export function saveGraph(client: HttpClient, workflowId: string, versionId: string, request: SaveGraphRequest) {
  return client.request(`${versionUrl(workflowId, versionId)}/graph`, { method: 'PUT', body: request, schema: saveGraphResponseSchema });
}

/** Refused (422 `WORKFLOW_NOT_PUBLISHABLE`, the problems in `details`) while the draft has errors. */
export function publishVersion(client: HttpClient, workflowId: string, versionId: string, notes: string | undefined) {
  return client.request(`${versionUrl(workflowId, versionId)}/publish`, {
    method: 'POST',
    body: notes === undefined ? {} : { notes },
    schema: z.object({ version: versionSummarySchema, warnings: z.array(problemSchema) }),
  });
}

const workflowDocumentSchema = z.object({ id: z.string(), kind: z.enum(['DESIGNED', 'TEMPLATE']), formatId: z.string().nullable(), templateId: z.string().nullable(), isActive: z.boolean() });
const namedSchema = z.object({ id: z.string(), name: z.string() });

export interface DocumentChoice {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

/** The workflow's documents, named after the format or template each one prints. */
export function documentChoicesQueryOptions(client: HttpClient, workflowId: string) {
  const base = `/workflows/${encodeURIComponent(workflowId)}`;
  return queryOptions({
    queryKey: builderQueryKeys.documents(workflowId),
    queryFn: async ({ signal }): Promise<DocumentChoice[]> => {
      const [documents, formats, templates] = await Promise.all([
        client.request(`${base}/documents?pageSize=100&includeInactive=true`, { schema: pageResponseSchema(workflowDocumentSchema), signal }),
        client.request(`${base}/pdf-formats?pageSize=100&includeInactive=true`, { schema: pageResponseSchema(namedSchema), signal }),
        client.request(`${base}/pdf-templates?pageSize=100&includeInactive=true`, { schema: pageResponseSchema(namedSchema), signal }),
      ]);
      const names = new Map([...formats.items, ...templates.items].map((item) => [item.id, item.name]));
      return documents.items.map((document) => ({ id: document.id, name: names.get(document.formatId ?? document.templateId ?? '') ?? document.id, isActive: document.isActive }));
    },
  });
}
