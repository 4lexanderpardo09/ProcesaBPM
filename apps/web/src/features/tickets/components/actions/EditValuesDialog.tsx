import { correctableFields, type TicketFormResponse, type TicketValueNamesResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { editTicket } from '../../api/ticket-actions-api';
import { typedFields, useStepFields } from '../../hooks/use-step-fields';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { StepFieldInput } from '../advance/StepFieldInput';
import { ActionDialog } from './ActionDialog';

export interface EditValuesDialogProps {
  readonly ticketId: string;
  readonly form: TicketFormResponse;
  readonly values: Readonly<Record<string, unknown>>;
  readonly valueNames: TicketValueNamesResponse;
  readonly fileNames: Readonly<Record<string, string>>;
  readonly onClose: () => void;
}

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/**
 * Corrects the values recorded so far («Editar datos registrados»), whatever step captured them: the typed ones that
 * have a value (computed fields follow, files are replaced by answering again). Only what changed is sent, it is
 * validated like an answer, and the previous values stay in the activity.
 */
export function EditValuesDialog({ ticketId, form, values, valueNames, fileNames, onClose }: EditValuesDialogProps) {
  const { t } = useTranslation('tickets');
  const fields = correctableFields(typedFields(form.fields), values);
  const edit = useTicketMutation((client, changed: Record<string, unknown>) => editTicket(client, ticketId, { values: changed }));
  const stepFields = useStepFields(fields, values, edit.error);
  const knownLabels = Object.assign({}, ...Object.values(valueNames)) as Record<string, string>;

  const submit = () => {
    const collected = stepFields.collect();
    if (!collected.ok) return;
    const changed = Object.fromEntries(Object.entries(collected.values).filter(([code, value]) => !sameValue(value, values[code])));
    if (Object.keys(changed).length === 0) onClose();
    else edit.mutate(changed, { onSuccess: onClose });
  };

  return (
    <ActionDialog open title={t('actions.editValues.title')} submitLabel={t('actions.editValues.submit')} pending={edit.isPending || stepFields.busy} error={stepFields.rejected ? null : edit.error} onClose={onClose} onSubmit={submit}>
      <p>{t('actions.editValues.body')}</p>
      {fields.length === 0 ? (
        <p>{t('actions.editValues.none')}</p>
      ) : (
        fields.map((field) => <StepFieldInput key={field.id} field={field} knownLabels={knownLabels} knownFiles={fileNames} {...stepFields.inputProps(field)} />)
      )}
    </ActionDialog>
  );
}
