import type { AddObserverRequest } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { groupsQueryOptions, positionsQueryOptions } from '@/features/people';
import { directoryNamesQueryOptions, PersonPicker } from '@/features/profile';
import { useApiClient } from '@/shared/session';
import { Button, Card, Dialog, PlusIcon, Select } from '@/shared/ui';
import { addObserver, type Observer, observersQueryOptions, removeObserver, workflowQueryKeys } from '../api/workflows-api';
import { WorkflowError } from './WorkflowError';
import styles from './Workflows.module.css';

type ObserverType = Observer['participantType'];
const TYPES: readonly ObserverType[] = ['USER', 'POSITION', 'GROUP'];

/** The names behind observers: people from the directory, positions and groups from their lists. */
function useObserverNames(observers: readonly Observer[]) {
  const client = useApiClient();
  const people = useQuery(directoryNamesQueryOptions(client, observers.flatMap((observer) => (observer.userId === null ? [] : [observer.userId]))));
  const positions = useQuery(positionsQueryOptions(client));
  const groups = useQuery(groupsQueryOptions(client));
  const names = new Map<string, string>();
  for (const person of people.data ?? []) names.set(person.userId, `${person.firstName} ${person.lastName}`);
  for (const position of positions.data ?? []) names.set(position.id, position.name);
  for (const group of groups.data ?? []) names.set(group.id, group.name);
  return (observer: Observer) => names.get(observer.userId ?? observer.positionId ?? observer.groupId ?? '');
}

/** Who sees every ticket of this workflow and hears of its changes, besides the people working on it. */
export function ObserversCard({ workflowId, canEdit }: { readonly workflowId: string; readonly canEdit: boolean }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const observers = useQuery(observersQueryOptions(client, workflowId));
  const nameOf = useObserverNames(observers.data ?? []);
  const [adding, setAdding] = useState(false);
  const remove = useMutation({
    mutationFn: (observerId: string) => removeObserver(client, workflowId, observerId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workflowQueryKeys.observers(workflowId) }),
  });

  return (
    <Card
      title={t('observers.title')}
      actions={
        canEdit ? (
          <Button icon={<PlusIcon size={15} />} onClick={() => setAdding(true)}>
            {t('observers.add')}
          </Button>
        ) : undefined
      }
    >
      <div className={styles.fields}>
        <p className={styles.note}>{t('observers.hint')}</p>
        <WorkflowError error={remove.error} context="observer" />
        {observers.data === undefined ? (
          <p className={styles.note}>{observers.isError ? t('loadFailed') : t('loading')}</p>
        ) : observers.data.length === 0 ? (
          <p className={styles.note}>{t('observers.empty')}</p>
        ) : (
          <ul className={styles.list} aria-label={t('observers.label')}>
            {observers.data.map((observer) => {
              const name = nameOf(observer) ?? t('observers.unknown');
              return (
                <li key={observer.id} className={styles.row}>
                  <span>
                    {name} <span className={styles.secondary}>· {t(`observers.types.${observer.participantType}`)}</span>
                  </span>
                  {canEdit && (
                    <Button variant="ghost" aria-label={t('observers.removeNamed', { name })} disabled={remove.isPending} onClick={() => remove.mutate(observer.id)}>
                      {t('remove')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {adding && <AddObserverDialog workflowId={workflowId} observers={observers.data ?? []} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddObserverDialog({ workflowId, observers, onClose }: { readonly workflowId: string; readonly observers: readonly Observer[]; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [type, setType] = useState<ObserverType>('USER');
  const [recordId, setRecordId] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const positions = useQuery({ ...positionsQueryOptions(client), enabled: type === 'POSITION' });
  const groups = useQuery({ ...groupsQueryOptions(client), enabled: type === 'GROUP' });
  const add = useMutation({
    mutationFn: (request: AddObserverRequest) => addObserver(client, workflowId, request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.observers(workflowId) });
      onClose();
    },
  });
  const taken = new Set(observers.flatMap((observer) => [observer.userId, observer.positionId, observer.groupId]).filter((id): id is string => id !== null));
  const records = (type === 'POSITION' ? positions.data : groups.data)?.filter((record) => record.isActive && !taken.has(record.id)) ?? [];
  const submit = () => {
    setSubmitted(true);
    if (recordId === '' || add.isPending) return;
    add.mutate(type === 'POSITION' ? { participantType: 'POSITION', positionId: recordId } : { participantType: 'GROUP', groupId: recordId });
  };

  return (
    <Dialog
      open
      title={t('observers.addTitle')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          {type !== 'USER' && (
            <Button type="submit" variant="brand" disabled={add.isPending}>
              {add.isPending ? t('saving') : t('observers.submit')}
            </Button>
          )}
        </>
      }
    >
      <div className={styles.fields}>
        <Select
          label={t('observers.type')}
          options={TYPES.map((value) => ({ value, label: t(`observers.types.${value}`) }))}
          value={type}
          onChange={(event) => {
            setType(event.target.value as ObserverType);
            setRecordId('');
            setSubmitted(false);
          }}
        />
        {type === 'USER' ? (
          <PersonPicker
            label={t('observers.person')}
            actionLabel={t('observers.pick')}
            actionLabelNamed={(name) => t('observers.pickNamed', { name })}
            taken={taken}
            onPick={(person) => add.mutate({ participantType: 'USER', userId: person.userId })}
          />
        ) : (
          <Select
            label={t(type === 'POSITION' ? 'observers.position' : 'observers.group')}
            required
            error={submitted && recordId === '' ? t('observers.mustChoose') : undefined}
            placeholder={t('observers.choose')}
            options={records.map((record) => ({ value: record.id, label: record.name }))}
            value={recordId}
            onChange={(event) => setRecordId(event.target.value)}
          />
        )}
        <WorkflowError error={add.error} context="observer" />
      </div>
    </Dialog>
  );
}
