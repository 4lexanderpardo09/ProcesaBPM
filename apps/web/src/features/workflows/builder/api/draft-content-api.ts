import type {
  AmountRuleDocument,
  CreateAmountRuleRequest,
  CreateFieldRequest,
  FieldDocument,
  ReplaceCandidatesRequest,
  ReplaceInitiatorsRequest,
  ReplaceSignersRequest,
  ReplaceSlaOverridesRequest,
  ReplaceStepFilesRequest,
  StepDocument,
  UpdateAmountRuleRequest,
  UpdateFieldRequest,
} from '@procesabpm/shared';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const fieldSchema = z.custom<FieldDocument>((value) => isObject(value) && typeof value.id === 'string' && typeof value.code === 'string' && typeof value.stepId === 'string', 'Not a field');
const amountRuleSchema = z.custom<AmountRuleDocument>((value) => isObject(value) && typeof value.id === 'string' && typeof value.fieldCode === 'string', 'Not an amount rule');

/** What hangs off a block, as the API keeps it after any of its lists changes. */
export type StepChildren = Pick<StepDocument, 'candidates' | 'initiators' | 'signers' | 'slaOverrides' | 'files'>;
const childrenSchema = z.custom<StepChildren>(
  (value) => isObject(value) && ['candidates', 'initiators', 'signers', 'slaOverrides', 'files'].every((key) => Array.isArray(value[key])),
  'Not the lists of a block',
);

/** The draft's own content, edited piece by piece (each edit bumps the draft's revision by one). */
export function draftContentApi(client: HttpClient, workflowId: string, versionId: string) {
  const base = `/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}`;
  const step = (stepId: string, list: string) => `${base}/steps/${encodeURIComponent(stepId)}/${list}`;
  return {
    createField: (body: CreateFieldRequest) => client.request(`${base}/fields`, { method: 'POST', body, schema: fieldSchema }),
    updateField: (fieldId: string, body: UpdateFieldRequest) => client.request(`${base}/fields/${encodeURIComponent(fieldId)}`, { method: 'PATCH', body, schema: fieldSchema }),
    deleteField: (fieldId: string) => client.request(`${base}/fields/${encodeURIComponent(fieldId)}`, { method: 'DELETE' }),
    createAmountRule: (body: CreateAmountRuleRequest) => client.request(`${base}/amount-rules`, { method: 'POST', body, schema: amountRuleSchema }),
    updateAmountRule: (ruleId: string, body: UpdateAmountRuleRequest) => client.request(`${base}/amount-rules/${encodeURIComponent(ruleId)}`, { method: 'PATCH', body, schema: amountRuleSchema }),
    deleteAmountRule: (ruleId: string) => client.request(`${base}/amount-rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' }),
    replaceCandidates: (stepId: string, body: ReplaceCandidatesRequest) => client.request(step(stepId, 'candidates'), { method: 'PUT', body, schema: childrenSchema }),
    replaceInitiators: (stepId: string, body: ReplaceInitiatorsRequest) => client.request(step(stepId, 'initiators'), { method: 'PUT', body, schema: childrenSchema }),
    replaceSigners: (stepId: string, body: ReplaceSignersRequest) => client.request(step(stepId, 'signers'), { method: 'PUT', body, schema: childrenSchema }),
    replaceSlaOverrides: (stepId: string, body: ReplaceSlaOverridesRequest) => client.request(step(stepId, 'sla-overrides'), { method: 'PUT', body, schema: childrenSchema }),
    replaceFiles: (stepId: string, body: ReplaceStepFilesRequest) => client.request(step(stepId, 'files'), { method: 'PUT', body, schema: childrenSchema }),
  };
}

export type DraftContentApi = ReturnType<typeof draftContentApi>;
