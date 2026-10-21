import { type CompanyResponse, companyResponseSchema } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminList } from '@/shared/admin/AdminList';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { AdminError } from '@/shared/admin/AdminError';
import { currentUserQueryKey, useApiClient, usePermissions } from '@/shared/session';
import { Badge, Button } from '@/shared/ui';
import { countriesQueryOptions, makeCompanyDefault } from '../api/organization-api';
import { CompanyDialog } from './CompanyDialog';
import styles from './Organization.module.css';

type Editing = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly record: CompanyResponse } | null;

/** The person's own companies come with their profile: a change to a company is read there again. */
const COMPANY_DEPENDENTS = [currentUserQueryKey];

/** The companies of the organization: each ticket belongs to one, with its country, currency, time zone and calendar. */
export function CompaniesTab() {
  const { t } = useTranslation(['organization', 'admin']);
  const { can } = usePermissions();
  const [editing, setEditing] = useState<Editing>(null);
  const countries = useQuery(countriesQueryOptions(useApiClient()));
  const countryName = (code: string) => countries.data?.find((country) => country.code === code)?.name ?? code;
  const makeDefault = useAdminMutation((client, companyId: string) => makeCompanyDefault(client, companyId), COMPANY_DEPENDENTS);
  return (
    <div className={styles.stack}>
      <AdminError error={makeDefault.error} />
      <AdminList
        label={t('companies.title')}
        path="/companies"
        item={companyResponseSchema}
        alsoInvalidates={COMPANY_DEPENDENTS}
        columns={[
          {
            key: 'name',
            header: t('admin:fields.name'),
            cell: (row) => (
              <span className={styles.name}>
                {row.name}
                {row.isDefault && <Badge tone="accent">{t('companies.default')}</Badge>}
              </span>
            ),
          },
          { key: 'taxId', header: t('companies.taxId'), width: '150px', code: true, cell: (row) => row.taxId ?? '—' },
          { key: 'country', header: t('companies.country'), width: '150px', cell: (row) => countryName(row.countryCode) },
          { key: 'currency', header: t('companies.currency'), width: '90px', code: true, cell: (row) => row.currencyCode },
          { key: 'timeZone', header: t('companies.timeZone'), width: '190px', cell: (row) => row.timeZone },
        ]}
        empty={t('companies.empty')}
        {...(can('create', 'Company') ? { create: { label: t('companies.new'), onClick: () => setEditing({ mode: 'create' }) } } : {})}
        {...(can('update', 'Company') ? { onEdit: (record: CompanyResponse) => setEditing({ mode: 'edit', record }) } : {})}
        canToggle={can('update', 'Company') && can('delete', 'Company')}
        rowAction={(row) =>
          can('update', 'Company') && !row.isDefault && row.isActive ? (
            <Button variant="ghost" aria-label={t('companies.makeDefaultNamed', { name: row.name })} disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(row.id)}>
              {t('companies.makeDefault')}
            </Button>
          ) : null
        }
      />
      {editing !== null && <CompanyDialog record={editing.mode === 'edit' ? editing.record : undefined} onClose={() => setEditing(null)} />}
    </div>
  );
}
