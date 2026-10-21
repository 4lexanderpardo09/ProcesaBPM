import type { ApprovalGroupResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Dialog } from '@/shared/ui';
import { addApprovalMember, approvalMembersQueryOptions, approversQueryOptions, removeApprovalMember, replaceApprovers } from '../api/people-api';
import { useMembersById } from '../hooks/use-members-by-id';
import { memberName } from '../lib/member-name';
import { MemberSearch } from './MemberSearch';
import { PeopleError } from './PeopleError';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './People.module.css';

/** The API takes at most this many approvers in a group. */
const MAX_APPROVERS = 50;

export interface ApprovalGroupPeopleDialogProps {
  readonly group: ApprovalGroupResponse;
  readonly typeName: string;
  readonly companyName: string;
  readonly canEdit: boolean;
  readonly onClose: () => void;
}

/**
 * The approvers of a group, in order (saved together: the order is who decides first), and its members, the people
 * whose requests they approve (each change saved at once). A person is a member of one group per type and company.
 */
export function ApprovalGroupPeopleDialog({ group, typeName, companyName, canEdit, onClose }: ApprovalGroupPeopleDialogProps) {
  const { t } = useTranslation(['people', 'admin']);
  const client = useApiClient();
  const savedApprovers = useQuery(approversQueryOptions(client, group.id));
  const memberIds = useQuery(approvalMembersQueryOptions(client, group.id));
  const [draft, setDraft] = useState<readonly string[]>();
  const [justSaved, setJustSaved] = useState(false);
  const approvers = draft ?? savedApprovers.data ?? [];
  const people = useMembersById([...approvers, ...(memberIds.data ?? [])]);
  const saveApprovers = useAdminMutation((c, userIds: readonly string[]) => replaceApprovers(c, group.id, userIds));
  const add = useAdminMutation((c, userId: string) => addApprovalMember(c, group.id, userId));
  const remove = useAdminMutation((c, userId: string) => removeApprovalMember(c, group.id, userId));
  const changed = draft !== undefined && savedApprovers.data !== undefined && draft.join() !== savedApprovers.data.join();
  const nameOf = (userId: string) => {
    const member = people.byId.get(userId);
    return member === undefined ? '…' : memberName(member);
  };
  const edit = (next: readonly string[]) => {
    setJustSaved(false);
    setDraft(next);
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...approvers];
    const [moved] = next.splice(index, 1);
    if (moved !== undefined) next.splice(index + by, 0, moved);
    edit(next);
  };
  const members = (memberIds.data ?? []).map((userId) => ({ userId, name: nameOf(userId) })).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return (
    <Dialog open title={t('approvals.peopleTitle', { name: group.name })} closeLabel={t('admin:dialog.close')} onClose={onClose} footer={<Button onClick={onClose}>{t('permissions.close')}</Button>}>
      <div className={adminStyles.dialogFields}>
        <p className={styles.note}>{t('approvals.scope', { type: typeName, company: companyName })}</p>

        <section className={styles.stack} aria-labelledby={`approvers-${group.id}`}>
          <h3 id={`approvers-${group.id}`} className={styles.sectionTitle}>
            {t('approvals.approvers')}
          </h3>
          <p className={styles.note}>{t('approvals.approversHint')}</p>
          {savedApprovers.data === undefined ? (
            <p className={styles.note}>{savedApprovers.isError ? t('admin:list.failed') : t('admin:list.loading')}</p>
          ) : approvers.length === 0 ? (
            <p className={styles.note}>{t('approvals.noApprovers')}</p>
          ) : (
            <ol className={styles.people} aria-label={t('approvals.approvers')}>
              {approvers.map((userId, index) => (
                <li key={userId} className={styles.person}>
                  <span className={styles.name}>
                    {nameOf(userId)}
                    <span className={styles.secondary}>{index === 0 ? t('approvals.primary') : t('approvals.substitute', { number: index })}</span>
                  </span>
                  {canEdit && (
                    <div className={adminStyles.rowActions}>
                      <Button variant="ghost" aria-label={t('approvals.moveUpNamed', { name: nameOf(userId) })} disabled={index === 0} onClick={() => move(index, -1)}>
                        {t('approvals.moveUp')}
                      </Button>
                      <Button variant="ghost" aria-label={t('approvals.moveDownNamed', { name: nameOf(userId) })} disabled={index === approvers.length - 1} onClick={() => move(index, 1)}>
                        {t('approvals.moveDown')}
                      </Button>
                      <Button variant="ghost" aria-label={t('groups.removeNamed', { name: nameOf(userId) })} onClick={() => edit(approvers.filter((id) => id !== userId))}>
                        {t('groups.remove')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {canEdit && savedApprovers.data !== undefined && (
            <>
              {approvers.length < MAX_APPROVERS && (
                <MemberSearch
                  label={t('approvals.searchApprover')}
                  actionLabel={t('groups.add')}
                  actionLabelNamed={(name) => t('approvals.addApproverNamed', { name })}
                  taken={new Set(approvers)}
                  takenLabel={t('groups.alreadyIn')}
                  onPick={(candidate) => edit([...approvers, candidate.userId])}
                />
              )}
              <PeopleError error={saveApprovers.error} context="approvalMember" />
              {justSaved && !changed && <Alert tone="ok">{t('approvals.approversSaved')}</Alert>}
              <div className={styles.footer}>
                <Button disabled={!changed || saveApprovers.isPending} onClick={() => setDraft(undefined)}>
                  {t('permissions.discard')}
                </Button>
                <Button
                  variant="brand"
                  disabled={!changed || saveApprovers.isPending}
                  onClick={() =>
                    saveApprovers.mutate(approvers, {
                      onSuccess: () => {
                        setDraft(undefined);
                        setJustSaved(true);
                      },
                    })
                  }
                >
                  {t('approvals.saveApprovers')}
                </Button>
              </div>
            </>
          )}
        </section>

        <section className={styles.stack} aria-labelledby={`members-${group.id}`}>
          <h3 id={`members-${group.id}`} className={styles.sectionTitle}>
            {t('approvals.members')}
          </h3>
          <p className={styles.note}>{t('approvals.membersHint')}</p>
          {memberIds.data === undefined ? (
            <p className={styles.note}>{memberIds.isError ? t('admin:list.failed') : t('admin:list.loading')}</p>
          ) : members.length === 0 ? (
            <p className={styles.note}>{t('approvals.noMembers')}</p>
          ) : (
            <ul className={styles.people} aria-label={t('approvals.members')}>
              {members.map((member) => (
                <li key={member.userId} className={styles.person}>
                  <span>{member.name}</span>
                  {canEdit && (
                    <Button variant="ghost" aria-label={t('groups.removeNamed', { name: member.name })} disabled={remove.isPending} onClick={() => remove.mutate(member.userId)}>
                      {t('groups.remove')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <PeopleError error={add.error ?? remove.error} context="approvalMember" />
          {canEdit && (
            <MemberSearch
              label={t('approvals.searchMember')}
              actionLabel={t('groups.add')}
              actionLabelNamed={(name) => t('approvals.addMemberNamed', { name })}
              taken={new Set(memberIds.data ?? [])}
              takenLabel={t('groups.alreadyIn')}
              pending={add.isPending}
              onPick={(candidate) => add.mutate(candidate.userId)}
            />
          )}
        </section>
      </div>
    </Dialog>
  );
}
