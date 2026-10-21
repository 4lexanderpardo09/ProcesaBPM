import type { MemberResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useApiClient } from '@/shared/session';
import { Checkbox, Select, TextField } from '@/shared/ui';
import { companiesQueryOptions, departmentsQueryOptions, inviteMember, positionsQueryOptions, rolesQueryOptions, sitesQueryOptions, updateMember } from '../api/people-api';
import { memberName } from '../lib/member-name';
import { peopleErrorKey } from '../lib/people-error';
import { PeopleError } from './PeopleError';
import styles from './People.module.css';

const NAME_MAX = 100;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Option {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

/** The active options, plus the one the member already has even if it was deactivated since. */
function optionsOf(list: readonly Option[] | undefined, current: string, inactiveLabel: (name: string) => string) {
  return (list ?? []).filter((item) => item.isActive || item.id === current).map((item) => ({ value: item.id, label: item.isActive ? item.name : inactiveLabel(item.name) }));
}

export interface MemberDialogProps {
  /** Without a member, a new invitation. */
  readonly member: MemberResponse | undefined;
  readonly onClose: () => void;
  readonly onInvited: (member: MemberResponse) => void;
}

/**
 * Invites a person (e-mail and name, which they cannot be invited without) or edits a member. The role decides what
 * they can do; position, department and site decide which steps they can be assigned; the companies, which tickets
 * they can create and see.
 */
export function MemberDialog({ member, onClose, onInvited }: MemberDialogProps) {
  const { t } = useTranslation(['people', 'admin']);
  const client = useApiClient();
  const companiesHintId = useId();
  const roles = useQuery(rolesQueryOptions(client));
  const positions = useQuery(positionsQueryOptions(client));
  const departments = useQuery(departmentsQueryOptions(client));
  const sites = useQuery(sitesQueryOptions(client));
  const companies = useQuery(companiesQueryOptions(client));
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [roleId, setRoleId] = useState(member?.roleId ?? '');
  const [positionId, setPositionId] = useState(member?.positionId ?? '');
  const [departmentId, setDepartmentId] = useState(member?.departmentId ?? '');
  const [siteId, setSiteId] = useState(member?.siteId ?? '');
  const [chosenCompanies, setChosenCompanies] = useState<readonly string[]>();
  const [submitted, setSubmitted] = useState(false);
  // A new person starts in the default company; until the companies load, nothing is chosen.
  const companyIds = chosenCompanies ?? member?.companyIds ?? (companies.data ?? []).filter((company) => company.isDefault).map((company) => company.id);
  const save = useAdminMutation((c, _: undefined) => {
    const placement = { roleId, ...(positionId === '' ? {} : { positionId }), ...(departmentId === '' ? {} : { departmentId }), ...(siteId === '' ? {} : { siteId }), companyIds: [...companyIds] };
    return member === undefined
      ? inviteMember(c, { email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), ...placement })
      : updateMember(c, member.userId, { roleId, positionId: positionId === '' ? null : positionId, departmentId: departmentId === '' ? null : departmentId, siteId: siteId === '' ? null : siteId, companyIds: [...companyIds] });
  });
  const inactive = (name: string) => t('members.inactiveOption', { name });
  const required = (value: string) => (submitted && value.trim() === '' ? t('members.required') : undefined);
  const emailInvalid = submitted && email.trim() !== '' && !EMAIL.test(email.trim());
  const missing = (member === undefined && (!EMAIL.test(email.trim()) || firstName.trim() === '' || lastName.trim() === '')) || roleId === '' || companyIds.length === 0;
  const contextOfError = member === undefined ? 'invite' : 'member';

  return (
    <AdminDialog
      title={member === undefined ? t('members.invite') : t('members.edit')}
      submitLabel={member === undefined ? t('members.invite') : t('admin:dialog.save')}
      pending={save.isPending}
      // The reasons only this dialog has are shown below; the shared ones by the dialog itself.
      error={peopleErrorKey(save.error, contextOfError) === undefined ? save.error : null}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (!missing)
          save.mutate(undefined, {
            onSuccess: (saved) => {
              if (member === undefined) onInvited(saved);
              onClose();
            },
          });
      }}
    >
      {member === undefined ? (
        <>
          <TextField label={t('members.email')} type="email" required value={email} autoComplete="off" error={emailInvalid ? t('members.emailInvalid') : required(email)} onChange={(event) => setEmail(event.target.value)} />
          <div className={styles.names}>
            <TextField label={t('members.firstName')} required value={firstName} maxLength={NAME_MAX} error={required(firstName)} onChange={(event) => setFirstName(event.target.value)} />
            <TextField label={t('members.lastName')} required value={lastName} maxLength={NAME_MAX} error={required(lastName)} onChange={(event) => setLastName(event.target.value)} />
          </div>
        </>
      ) : (
        <p className={styles.note}>
          {memberName(member) === member.email ? member.email : `${memberName(member)} · ${member.email}`}
        </p>
      )}
      <Select
        label={t('members.role')}
        required
        value={roleId}
        placeholder={t('members.chooseRole')}
        options={(roles.data ?? [])
          .filter((role) => role.isActive || role.id === member?.roleId)
          .map((role) => ({ value: role.id, label: role.isAdmin ? t('members.adminRole', { name: role.name }) : role.isActive ? role.name : inactive(role.name) }))}
        error={submitted && roleId === '' ? t('members.roleRequired') : undefined}
        onChange={(event) => setRoleId(event.target.value)}
      />
      <div className={styles.names}>
        <Select label={t('members.position')} value={positionId} placeholder={t('members.none')} options={optionsOf(positions.data, positionId, inactive)} onChange={(event) => setPositionId(event.target.value)} />
        <Select label={t('members.department')} value={departmentId} placeholder={t('members.none')} options={optionsOf(departments.data, departmentId, inactive)} onChange={(event) => setDepartmentId(event.target.value)} />
      </div>
      <Select label={t('members.site')} value={siteId} placeholder={t('members.noneSite')} options={optionsOf(sites.data, siteId, inactive)} onChange={(event) => setSiteId(event.target.value)} />
      <fieldset className={styles.choices} aria-describedby={companiesHintId}>
        <legend>{t('members.companies')}</legend>
        <p id={companiesHintId} className={styles.note}>
          {submitted && companyIds.length === 0 ? t('members.companiesRequired') : t('members.companiesHint')}
        </p>
        {(companies.data ?? [])
          .filter((company) => company.isActive || companyIds.includes(company.id))
          .map((company) => (
            <Checkbox
              key={company.id}
              label={company.name}
              checked={companyIds.includes(company.id)}
              onChange={(event) => setChosenCompanies(event.target.checked ? [...companyIds, company.id] : companyIds.filter((id) => id !== company.id))}
            />
          ))}
      </fieldset>
      <PeopleError error={peopleErrorKey(save.error, contextOfError) === undefined ? null : save.error} context={contextOfError} />
    </AdminDialog>
  );
}
