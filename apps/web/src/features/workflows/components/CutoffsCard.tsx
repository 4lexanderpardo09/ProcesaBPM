import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Button, Card, Checkbox, Dialog, PlusIcon, Select, TextField } from '@/shared/ui';
import { companiesQueryOptions, createCutoff, type Cutoff, cutoffsQueryOptions, removeCutoff, updateCutoff, workflowQueryKeys } from '../api/workflows-api';
import { WholeNumberField } from '../builder/components/WholeNumberField';
import { WorkflowError } from './WorkflowError';
import styles from './Workflows.module.css';

/**
 * The monthly cutoff days of each company for this workflow: a step with a deadline by cutoff never goes past the next
 * one, and a WAIT block on the company cutoff holds tickets until it passes. Grace days push a deadline that lands on
 * the cutoff a few business days later.
 */
export function CutoffsCard({ workflowId, canEdit }: { readonly workflowId: string; readonly canEdit: boolean }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const cutoffs = useQuery(cutoffsQueryOptions(client, workflowId));
  const companies = useQuery(companiesQueryOptions(client));
  const [editing, setEditing] = useState<Cutoff | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (cutoffId: string) => removeCutoff(client, workflowId, cutoffId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workflowQueryKeys.cutoffs(workflowId) }),
  });
  const companyName = (companyId: string) => companies.data?.find((company) => company.id === companyId)?.name ?? t('cutoffs.unknownCompany');
  const rows = [...(cutoffs.data ?? [])].sort((left, right) => companyName(left.companyId).localeCompare(companyName(right.companyId)) || left.cutoffDay - right.cutoffDay);

  return (
    <Card
      title={t('cutoffs.title')}
      actions={
        canEdit ? (
          <Button icon={<PlusIcon size={15} />} onClick={() => setEditing('new')}>
            {t('cutoffs.add')}
          </Button>
        ) : undefined
      }
    >
      <div className={styles.fields}>
        <p className={styles.note}>{t('cutoffs.hint')}</p>
        <WorkflowError error={remove.error} context="cutoff" />
        {cutoffs.data === undefined ? (
          <p className={styles.note}>{cutoffs.isError ? t('loadFailed') : t('loading')}</p>
        ) : rows.length === 0 ? (
          <p className={styles.note}>{t('cutoffs.empty')}</p>
        ) : (
          <ul className={styles.list} aria-label={t('cutoffs.label')}>
            {rows.map((cutoff) => {
              const name = t('cutoffs.rowName', { company: companyName(cutoff.companyId), day: cutoff.cutoffDay });
              return (
                <li key={cutoff.id} className={styles.row}>
                  <span>
                    {name}
                    <span className={styles.secondary}>
                      {cutoff.graceBusinessDays > 0 && ` · ${t('cutoffs.grace', { count: cutoff.graceBusinessDays })}`}
                      {!cutoff.isActive && ` · ${t('cutoffs.inactive')}`}
                      {cutoff.description !== null && ` · ${cutoff.description}`}
                    </span>
                  </span>
                  {canEdit && (
                    <span>
                      <Button variant="ghost" aria-label={t('cutoffs.editNamed', { name })} onClick={() => setEditing(cutoff)}>
                        {t('cutoffs.edit')}
                      </Button>
                      <Button variant="ghost" aria-label={t('cutoffs.removeNamed', { name })} disabled={remove.isPending} onClick={() => remove.mutate(cutoff.id)}>
                        {t('remove')}
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {editing !== null && <CutoffDialog workflowId={workflowId} cutoff={editing === 'new' ? undefined : editing} companies={companies.data ?? []} onClose={() => setEditing(null)} />}
    </Card>
  );
}

interface CutoffDialogProps {
  readonly workflowId: string;
  /** `undefined` for a new one. */
  readonly cutoff: Cutoff | undefined;
  readonly companies: ReadonlyArray<{ readonly id: string; readonly name: string; readonly isActive: boolean }>;
  readonly onClose: () => void;
}

function CutoffDialog({ workflowId, cutoff, companies, onClose }: CutoffDialogProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(cutoff?.companyId ?? (companies.length === 1 ? companies[0]!.id : ''));
  const [day, setDay] = useState<number | null>(cutoff?.cutoffDay ?? null);
  const [grace, setGrace] = useState<number | null>(cutoff?.graceBusinessDays ?? 0);
  const [description, setDescription] = useState(cutoff?.description ?? '');
  const [isActive, setIsActive] = useState(cutoff?.isActive ?? true);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const common = { cutoffDay: day!, graceBusinessDays: grace ?? 0, description: description.trim() === '' ? null : description.trim(), isActive };
      return cutoff === undefined ? createCutoff(client, workflowId, { companyId, ...common }) : updateCutoff(client, workflowId, cutoff.id, common);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.cutoffs(workflowId) });
      onClose();
    },
  });
  const valid = companyId !== '' && day !== null && day >= 1 && day <= 31;

  return (
    <Dialog
      open
      title={cutoff === undefined ? t('cutoffs.addTitle') : t('cutoffs.editTitle')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (valid && !save.isPending) save.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={save.isPending}>
            {save.isPending ? t('saving') : t('cutoffs.submit')}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <Select
          label={t('cutoffs.company')}
          required
          disabled={cutoff !== undefined}
          placeholder={t('cutoffs.chooseCompany')}
          options={companies.filter((company) => company.isActive || company.id === companyId).map((company) => ({ value: company.id, label: company.name }))}
          value={companyId}
          error={submitted && companyId === '' ? t('cutoffs.companyRequired') : undefined}
          onChange={(event) => setCompanyId(event.target.value)}
        />
        <WholeNumberField label={t('cutoffs.day')} hint={t('cutoffs.dayHint')} min={1} max={31} value={day} onChange={setDay} />
        {submitted && day === null && <p className={styles.error}>{t('cutoffs.dayRequired')}</p>}
        <WholeNumberField label={t('cutoffs.graceLabel')} hint={t('cutoffs.graceHint')} min={0} max={30} value={grace} onChange={setGrace} />
        <TextField label={t('cutoffs.description')} value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
        <Checkbox label={t('cutoffs.active')} checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
        <WorkflowError error={save.error} context="cutoff" />
      </div>
    </Dialog>
  );
}
