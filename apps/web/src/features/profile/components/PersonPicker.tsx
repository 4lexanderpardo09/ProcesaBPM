import type { DirectoryPerson } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { useApiClient } from '@/shared/session';
import { Button, TextField } from '@/shared/ui';
import { directorySearchQueryOptions } from '../api/profile-api';
import styles from './Profile.module.css';

const SEARCH_DELAY_MS = 300;

export const personName = (person: Pick<DirectoryPerson, 'firstName' | 'lastName'>) => `${person.firstName} ${person.lastName}`.trim();

export interface PersonPickerProps {
  readonly label: string;
  readonly actionLabel: string;
  readonly actionLabelNamed: (name: string) => string;
  /** People already chosen (and oneself): shown without the button. */
  readonly taken?: ReadonlySet<string>;
  readonly onPick: (person: DirectoryPerson) => void;
}

/** Finds an active colleague by name in the directory every member can read (names only). */
export function PersonPicker({ label, actionLabel, actionLabelNamed, taken = new Set(), onPick }: PersonPickerProps) {
  const { t } = useTranslation('profile');
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const found = useQuery(directorySearchQueryOptions(useApiClient(), settled));
  const results = (found.data ?? []).filter((person) => !taken.has(person.userId));
  return (
    <div className={styles.form}>
      <TextField label={label} hint={t('people.searchHint')} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      {settled.length >= 2 && found.data !== undefined && (
        <ul className={styles.list} aria-label={label}>
          {results.length === 0 && <li className={styles.note}>{t('people.noResults')}</li>}
          {results.map((person) => (
            <li key={person.userId} className={styles.row}>
              <span>{personName(person)}</span>
              <Button variant="ghost" aria-label={actionLabelNamed(personName(person))} onClick={() => onPick(person)}>
                {actionLabel}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
