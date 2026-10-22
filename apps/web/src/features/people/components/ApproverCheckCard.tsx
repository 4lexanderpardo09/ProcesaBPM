import { type ApproverOutcome, MAX_APPROVAL_LEVEL, type MemberResponse } from '@procesabpm/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { directoryNamesQueryOptions, personName } from '@/features/profile';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Card, Select } from '@/shared/ui';
import { approvalTypesQueryOptions, companiesQueryOptions } from '../api/people-api';
import { memberName } from '../lib/member-name';
import { MemberSearch } from './MemberSearch';
import styles from './People.module.css';

/** Checked by its shape only: the trace is shown as it comes. */
const outcomeSchema = z.custom<ApproverOutcome>((value) => typeof value === 'object' && value !== null && 'found' in value && 'chain' in value);

/**
 * Who would approve a person's request today, for a type of approval and a company, at a level ("the approver of the
 * approver"): the same search the engine does, with every group tried and why each candidate was passed over.
 */
export function ApproverCheckCard() {
  const { t } = useTranslation('people');
  const client = useApiClient();
  const types = useQuery(approvalTypesQueryOptions(client));
  const companies = useQuery(companiesQueryOptions(client));
  const [person, setPerson] = useState<MemberResponse>();
  const [typeId, setTypeId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [level, setLevel] = useState('1');
  const check = useMutation({
    mutationFn: () => client.request(`/approvals/resolve?${new URLSearchParams({ userId: person!.userId, typeId, companyId, level }).toString()}`, { schema: outcomeSchema }),
  });
  const outcome = check.data;
  const ids = outcome === undefined ? [] : [...outcome.chain.flatMap((step) => [step.subjectId, ...step.groupsTried.flatMap((group) => group.skipped.map((skip) => skip.userId)), ...(step.resolved === null ? [] : [step.resolved.approverId, ...(step.resolved.onBehalfOfId === null ? [] : [step.resolved.onBehalfOfId])])])];
  const names = useQuery(directoryNamesQueryOptions(client, ids));
  const nameOf = (userId: string) => {
    const found = names.data?.find((candidate) => candidate.userId === userId);
    return found === undefined ? '…' : personName(found);
  };
  const ready = person !== undefined && typeId !== '' && companyId !== '';

  return (
    <Card title={t('approvals.check.title')}>
      <div className={styles.stack}>
        <p className={styles.note}>{t('approvals.check.hint')}</p>
        {person === undefined ? (
          <MemberSearch label={t('approvals.check.person')} actionLabel={t('approvals.check.choose')} actionLabelNamed={(name) => t('approvals.check.chooseNamed', { name })} onPick={setPerson} />
        ) : (
          <p className={styles.note}>
            {t('approvals.check.for', { name: memberName(person) })}{' '}
            <Button variant="ghost" onClick={() => setPerson(undefined)}>
              {t('approvals.check.change')}
            </Button>
          </p>
        )}
        <div className={styles.filter}>
          <Select label={t('approvals.type')} placeholder={t('approvals.check.pickType')} options={(types.data ?? []).map((type) => ({ value: type.id, label: type.name }))} value={typeId} onChange={(event) => setTypeId(event.target.value)} />
          <Select label={t('approvals.check.company')} placeholder={t('approvals.check.pickCompany')} options={(companies.data ?? []).filter((company) => company.isActive).map((company) => ({ value: company.id, label: company.name }))} value={companyId} onChange={(event) => setCompanyId(event.target.value)} />
          <Select label={t('approvals.check.level')} options={Array.from({ length: MAX_APPROVAL_LEVEL }, (_unused, index) => ({ value: String(index + 1), label: t('approvals.check.levelValue', { level: index + 1 }) }))} value={level} onChange={(event) => setLevel(event.target.value)} />
        </div>
        <div>
          <Button variant="brand" disabled={!ready || check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? t('approvals.check.checking') : t('approvals.check.submit')}
          </Button>
        </div>
        {check.isError && <Alert tone="danger">{t('approvals.check.failed')}</Alert>}
        {outcome !== undefined &&
          (outcome.found ? (
            <Alert tone="ok">{outcome.onBehalfOfId === null ? t('approvals.check.found', { name: nameOf(outcome.approverId) }) : t('approvals.check.foundDelegate', { name: nameOf(outcome.approverId), nominal: nameOf(outcome.onBehalfOfId) })}</Alert>
          ) : (
            <Alert tone="warn">{t(`approvals.check.notFound.${outcome.reason}`)}</Alert>
          ))}
        {outcome !== undefined && (
          <ol className={styles.trace} aria-label={t('approvals.check.trace')}>
            {outcome.chain.map((step) => (
              <li key={step.level}>
                <strong>{t('approvals.check.levelOf', { level: step.level, name: nameOf(step.subjectId) })}</strong>
                {step.groupsTried.length === 0 ? (
                  <p className={styles.note}>{t('approvals.check.noGroups')}</p>
                ) : (
                  <ul>
                    {step.groupsTried.map((group) => (
                      <li key={group.groupId}>
                        {t(`approvals.check.scope.${group.scope}`)}
                        {group.skipped.map((skip) => (
                          <span key={skip.userId} className={styles.note}>
                            {' '}
                            · {t(`approvals.check.skipped.${skip.reason}`, { name: nameOf(skip.userId) })}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                {step.resolved !== null && <p className={styles.note}>{t('approvals.check.resolved', { name: nameOf(step.resolved.approverId) })}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
