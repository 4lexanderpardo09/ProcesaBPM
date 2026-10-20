import type { TicketCandidatesQuery } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Select } from '@/shared/ui';
import { ticketCandidatesQueryOptions } from '../../api/ticket-actions-api';

export interface PersonSelectProps {
  readonly ticketId: string;
  readonly purpose: TicketCandidatesQuery['for'];
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (userId: string) => void;
}

/** The people the API offers for this ticket and purpose; nobody else can be picked. */
export function PersonSelect({ ticketId, purpose, label, value, error, onChange }: PersonSelectProps) {
  const { t } = useTranslation('tickets');
  const candidates = useQuery(ticketCandidatesQueryOptions(useApiClient(), ticketId, purpose));
  const people = candidates.data ?? [];
  const status = candidates.isError ? t('actions.people.failed') : candidates.data === undefined ? t('actions.people.loading') : people.length === 0 ? t('actions.people.none') : undefined;
  return (
    <Select
      label={label}
      required
      value={value}
      placeholder={status ?? t('actions.people.placeholder')}
      options={people.map((person) => ({ value: person.id, label: person.name }))}
      disabled={people.length === 0}
      error={error}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
