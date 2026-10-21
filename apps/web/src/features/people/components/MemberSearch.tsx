import type { MemberResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { useApiClient } from '@/shared/session';
import { Button, TextField } from '@/shared/ui';
import { membersQueryOptions } from '../api/people-api';
import { memberName } from '../lib/member-name';
import styles from './People.module.css';

const SEARCH_DELAY_MS = 300;
/** Enough results to find someone by name; more means the search should be more precise. */
const SEARCH_RESULTS = 8;

export interface MemberSearchProps {
  readonly label: string;
  /** The button of each result, such as "Agregar"; its accessible name adds the person's name. */
  readonly actionLabel: string;
  readonly actionLabelNamed: (name: string) => string;
  /** People already chosen: shown with `takenLabel` instead of the button. */
  readonly taken?: ReadonlySet<string>;
  readonly takenLabel?: string;
  readonly pending?: boolean;
  readonly onPick: (member: MemberResponse) => void;
}

/** Finds an active member by name or e-mail and acts on them (add to a group, choose as approver…). */
export function MemberSearch({ label, actionLabel, actionLabelNamed, taken = new Set(), takenLabel, pending = false, onPick }: MemberSearchProps) {
  const { t } = useTranslation('people');
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const candidates = useQuery({ ...membersQueryOptions(useApiClient(), { page: 1, search: settled, roleId: '', status: 'ACTIVE' }), enabled: settled !== '' });
  return (
    <div className={styles.stack}>
      <TextField label={label} hint={t('groups.searchHint')} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      {settled !== '' && candidates.data !== undefined && (
        <ul className={styles.people} aria-label={label}>
          {candidates.data.items.length === 0 && <li className={styles.note}>{t('groups.noResults')}</li>}
          {candidates.data.items.slice(0, SEARCH_RESULTS).map((candidate) => (
            <li key={candidate.userId} className={styles.person}>
              <span>
                {memberName(candidate)} <span className={styles.secondary}>{candidate.email}</span>
              </span>
              {taken.has(candidate.userId) ? (
                <span className={styles.secondary}>{takenLabel}</span>
              ) : (
                <Button variant="ghost" aria-label={actionLabelNamed(memberName(candidate))} disabled={pending} onClick={() => onPick(candidate)}>
                  {actionLabel}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
