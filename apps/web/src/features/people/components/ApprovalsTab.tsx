import { type ApprovalGroupResponse, approvalGroupResponseSchema } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { AdminList } from '@/shared/admin/AdminList';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useApiClient, usePermissions } from '@/shared/session';
import { Button, Select, TextField } from '@/shared/ui';
import { approvalTypesQueryOptions, companiesQueryOptions } from '../api/people-api';
import { ApprovalGroupPeopleDialog } from './ApprovalGroupPeopleDialog';
import { ApprovalTypesCard } from './ApprovalTypesCard';
import { ApproverCheckCard } from './ApproverCheckCard';
import styles from './People.module.css';

const NAME_MAX = 200;

type Dialog = { readonly kind: 'create' } | { readonly kind: 'edit' | 'people'; readonly group: ApprovalGroupResponse } | null;

/**
 * Who approves whom: each group has approvers in order (the primary and their substitutes) and the members whose
 * requests they approve, for one type of approval ("Jefe inmediato", "Gerencia"…) and one company or all of them.
 */
export function ApprovalsTab() {
  const { t } = useTranslation(['people', 'admin']);
  const { can } = usePermissions();
  const client = useApiClient();
  const types = useQuery(approvalTypesQueryOptions(client));
  const companies = useQuery(companiesQueryOptions(client));
  const [typeId, setTypeId] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const typeName = (id: string) => types.data?.find((type) => type.id === id)?.name ?? '—';
  const companyName = (id: string | null) => (id === null ? t('approvals.allCompanies') : (companies.data?.find((company) => company.id === id)?.name ?? '—'));

  return (
    <div className={styles.stack}>
      <ApprovalTypesCard canCreate={can('create', 'ApprovalGroup')} canUpdate={can('update', 'ApprovalGroup')} canDelete={can('delete', 'ApprovalGroup')} />
      <div className={styles.filter}>
        <Select label={t('approvals.type')} value={typeId} placeholder={t('approvals.allTypes')} options={(types.data ?? []).map((type) => ({ value: type.id, label: type.name }))} onChange={(event) => setTypeId(event.target.value)} />
      </div>
      <AdminList
        label={t('approvals.title')}
        path="/approval-groups"
        item={approvalGroupResponseSchema}
        {...(typeId === '' ? {} : { filter: { typeId } })}
        columns={[
          { key: 'name', header: t('admin:fields.name'), cell: (row) => row.name },
          { key: 'type', header: t('approvals.type'), width: '180px', cell: (row) => typeName(row.typeId) },
          { key: 'company', header: t('approvals.company'), width: '180px', cell: (row) => companyName(row.companyId) },
        ]}
        empty={t('approvals.empty')}
        {...(can('create', 'ApprovalGroup') ? { create: { label: t('approvals.new'), onClick: () => setDialog({ kind: 'create' }) } } : {})}
        {...(can('update', 'ApprovalGroup') ? { onEdit: (group: ApprovalGroupResponse) => setDialog({ kind: 'edit', group }) } : {})}
        canToggle={can('update', 'ApprovalGroup') && can('delete', 'ApprovalGroup')}
        rowAction={(row) => (
          <Button variant="ghost" aria-label={t('approvals.peopleNamed', { name: row.name })} onClick={() => setDialog({ kind: 'people', group: row })}>
            {t('approvals.people')}
          </Button>
        )}
      />
      {dialog?.kind === 'create' && <ApprovalGroupDialog record={undefined} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <ApprovalGroupDialog record={dialog.group} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'people' && <ApprovalGroupPeopleDialog group={dialog.group} typeName={typeName(dialog.group.typeId)} companyName={companyName(dialog.group.companyId)} canEdit={can('update', 'ApprovalGroup')} onClose={() => setDialog(null)} />}
      <ApproverCheckCard />
    </div>
  );
}

/** A new group chooses its type and company once (they cannot change); afterwards only its name changes. */
function ApprovalGroupDialog({ record, onClose }: { readonly record: ApprovalGroupResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['people', 'admin']);
  const client = useApiClient();
  const types = useQuery(approvalTypesQueryOptions(client));
  const companies = useQuery(companiesQueryOptions(client));
  const [name, setName] = useState(record?.name ?? '');
  const [chosenType, setChosenType] = useState<string>();
  const [companyId, setCompanyId] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const typeId = chosenType ?? types.data?.find((type) => type.isDefault)?.id ?? '';
  const save = useAdminMutation((c, body: Record<string, unknown>) => saveAdminItem(c, '/approval-groups', approvalGroupResponseSchema, record?.id, body));

  return (
    <AdminDialog
      title={record === undefined ? t('approvals.new') : t('approvals.edit')}
      submitLabel={t('admin:dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim() === '' || (record === undefined && typeId === '')) return;
        save.mutate(record === undefined ? { name: name.trim(), typeId, ...(companyId === '' ? {} : { companyId }) } : { name: name.trim() }, { onSuccess: onClose });
      }}
    >
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} placeholder={t('approvals.namePlaceholder')} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      {record === undefined && (
        <>
          <Select
            label={t('approvals.type')}
            required
            value={typeId}
            placeholder={types.data?.length === 0 ? t('approvals.noTypes') : t('approvals.chooseType')}
            options={(types.data ?? []).map((type) => ({ value: type.id, label: type.name }))}
            error={submitted && typeId === '' ? t('approvals.typeRequired') : undefined}
            onChange={(event) => setChosenType(event.target.value)}
          />
          <Select
            label={t('approvals.company')}
            hint={t('approvals.companyHint')}
            value={companyId}
            placeholder={t('approvals.allCompanies')}
            options={(companies.data ?? []).filter((company) => company.isActive).map((company) => ({ value: company.id, label: company.name }))}
            onChange={(event) => setCompanyId(event.target.value)}
          />
          <p className={styles.note}>{t('approvals.fixedHint')}</p>
        </>
      )}
    </AdminDialog>
  );
}
