import type { CreationCheckResponse, DirectoryPerson } from '@procesabpm/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { companiesQueryOptions } from '@/features/people';
import { PersonPicker } from '@/features/profile';
import { useApiClient } from '@/shared/session';
import { Badge, Button, Card, Select } from '@/shared/ui';
import { checkCreation } from '../api/workflows-api';
import { type RecordKind, useRecordNames } from '../builder/hooks/use-record-names';
import { WorkflowError } from './WorkflowError';
import styles from './Workflows.module.css';

const RULE_KINDS: ReadonlySet<RecordKind> = new Set(['POSITION', 'GROUP', 'DEPARTMENT', 'COMPANY', 'SITE']);

/** "Why can't she open a ticket here?": a person and a company, and the answer of each check and each rule of the START blocks. */
export function CreationCheckCard({ workflowId }: { readonly workflowId: string }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const companies = useQuery(companiesQueryOptions(client));
  const [person, setPerson] = useState<DirectoryPerson>();
  const [chosenCompany, setChosenCompany] = useState('');
  const active = (companies.data ?? []).filter((company) => company.isActive);
  const companyId = chosenCompany !== '' ? chosenCompany : (active.find((company) => company.isDefault)?.id ?? active[0]?.id ?? '');
  const check = useMutation({ mutationFn: () => checkCreation(client, workflowId, person!.userId, companyId) });

  return (
    <Card title={t('creationCheck.title')}>
      <div className={styles.stack}>
        <p className={styles.note}>{t('creationCheck.hint')}</p>
        {person === undefined ? (
          <PersonPicker label={t('creationCheck.person')} actionLabel={t('creationCheck.pick')} actionLabelNamed={(name) => t('creationCheck.pickNamed', { name })} onPick={(picked) => (setPerson(picked), check.reset())} />
        ) : (
          <div className={styles.checkPerson}>
            <span>
              {t('creationCheck.chosen')} <strong>{`${person.firstName} ${person.lastName}`}</strong>
            </span>
            <Button variant="ghost" onClick={() => (setPerson(undefined), check.reset())}>
              {t('creationCheck.change')}
            </Button>
          </div>
        )}
        <Select label={t('creationCheck.company')} options={active.map((company) => ({ value: company.id, label: company.name }))} value={companyId} onChange={(event) => (setChosenCompany(event.target.value), check.reset())} />
        <div>
          <Button variant="brand" disabled={person === undefined || companyId === '' || check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? t('creationCheck.checking') : t('creationCheck.run')}
          </Button>
        </div>
        <WorkflowError error={check.error} context="content" />
        {check.data !== undefined && person !== undefined && <CheckResult result={check.data} name={`${person.firstName} ${person.lastName}`} />}
      </div>
    </Card>
  );
}

function Verdict({ ok, label }: { readonly ok: boolean; readonly label: string }) {
  const { t } = useTranslation('workflows');
  return (
    <li className={styles.checkRow}>
      <Badge tone={ok ? 'ok' : 'danger'}>{ok ? t('creationCheck.yes') : t('creationCheck.no')}</Badge>
      <span>{label}</span>
    </li>
  );
}

function CheckResult({ result, name }: { readonly result: CreationCheckResponse; readonly name: string }) {
  const { t } = useTranslation('workflows');
  const userIds = result.starts.flatMap((start) => start.rules.filter((rule) => rule.kind === 'USER').map((rule) => rule.targetId));
  const { nameOf } = useRecordNames(RULE_KINDS, userIds);
  return (
    <section className={styles.stack} aria-label={t('creationCheck.result')}>
      <p className={styles.checkVerdict} role="status">
        {result.canCreate ? t('creationCheck.can', { name }) : t('creationCheck.cannot', { name })}
      </p>
      <ul className={styles.checkList}>
        <Verdict ok={result.activeMember} label={t('creationCheck.checks.activeMember')} />
        <Verdict ok={result.companyAllowed} label={t('creationCheck.checks.companyAllowed')} />
        <Verdict ok={result.subcategoryVisible} label={t('creationCheck.checks.subcategoryVisible')} />
        <Verdict ok={result.published} label={t('creationCheck.checks.published')} />
      </ul>
      {result.starts.map((start) => (
        <div key={start.stepId} className={styles.stack}>
          <ul className={styles.checkList}>
            <Verdict ok={start.allowed} label={t('creationCheck.start', { name: start.name })} />
          </ul>
          {start.rules.length === 0 ? (
            <p className={styles.note}>{t('creationCheck.open')}</p>
          ) : (
            <ul className={styles.checkRules} aria-label={t('creationCheck.rulesOf', { name: start.name })}>
              {start.rules.map((rule, index) => (
                <Verdict key={`${rule.kind}-${rule.targetId}-${String(index)}`} ok={rule.matches} label={`${t(`builder.participants.kinds.${rule.kind}`)}: ${nameOf(rule.targetId) ?? t('builder.participants.unknown')}`} />
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className={styles.note}>{t('creationCheck.roleNote')}</p>
    </section>
  );
}
