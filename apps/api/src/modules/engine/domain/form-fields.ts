import type { FieldDocument, FormFieldResponse } from '@procesabpm/shared';

/** The fields as a form draws them, in the order the workflow gives them (then by code, so the order is stable). */
export function formFieldsOf(fields: readonly FieldDocument[]): FormFieldResponse[] {
  return [...fields]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map((field) => ({
      id: field.id,
      stepId: field.stepId,
      code: field.code,
      label: field.label,
      type: field.type,
      isRequired: field.isRequired,
      isReadOnly: field.isReadOnly,
      sortOrder: field.sortOrder,
      config: field.config,
      dataSource: field.dataSource,
    }));
}
