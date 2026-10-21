import { useTranslation } from 'react-i18next';
import { Select } from '@/shared/ui';
import type { NextAssignee } from '../../hooks/use-next-assignee';

/** Who receives the next step, shown only once the API asks for it (a manual-selection step with several candidates). */
export function NextAssigneeField({ next }: { readonly next: NextAssignee }) {
  const { t } = useTranslation('tickets');
  if (next.choices === undefined) return null;
  const none = next.choices.length === 0;
  return (
    <Select
      label={t('actions.nextAssignee.label')}
      hint={t('actions.nextAssignee.hint')}
      required
      value={next.assigneeId}
      placeholder={none ? t('actions.people.none') : t('actions.people.placeholder')}
      options={next.choices.map((choice) => ({ value: choice.id, label: choice.name }))}
      disabled={none}
      error={next.missing ? t('actions.nextAssignee.required') : undefined}
      onChange={(event) => next.select(event.target.value)}
    />
  );
}
