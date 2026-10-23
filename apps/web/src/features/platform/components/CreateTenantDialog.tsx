import { TENANT_SLUG_PATTERN } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Select, TextField } from '@/shared/ui';
import { countriesQueryOptions, createTenant, plansQueryOptions, platformQueryKeys } from '../api/platform-api';
import { usePlatformClient } from '../session/PlatformSessionContext';
import { PlatformError } from './PlatformError';
import styles from '../pages/Platform.module.css';

/** The identifier a name suggests: lowercase, accents gone, words joined by hyphens. */
const slugOf = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');

/** A new organization with its plan, its country and the owner who is invited to set it up. */
export function CreateTenantDialog({ onClose, onCreated }: { readonly onClose: () => void; readonly onCreated: (tenantId: string) => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const plans = useQuery(plansQueryOptions(client));
  const countries = useQuery(countriesQueryOptions(client));
  const [form, setForm] = useState({ name: '', slug: '', planCode: '', countryCode: '', email: '', firstName: '', lastName: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const activePlans = (plans.data ?? []).filter((plan) => plan.isActive);
  const planCode = form.planCode || (activePlans[0]?.code ?? '');
  const countryCode = form.countryCode || (countries.data?.[0]?.code ?? '');
  const create = useMutation({
    mutationFn: () =>
      createTenant(client, { name: form.name.trim(), slug: form.slug, planCode, countryCode, owner: { email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim() } }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.all });
      onCreated(created.tenantId);
    },
  });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const missing = (value: string) => (submitted && value.trim() === '' ? t('create.required') : undefined);
  const slugError = submitted && !TENANT_SLUG_PATTERN.test(form.slug) ? t('create.badSlug') : undefined;
  const valid = [form.name, form.email, form.firstName, form.lastName, planCode, countryCode].every((value) => value.trim() !== '') && TENANT_SLUG_PATTERN.test(form.slug);

  return (
    <Dialog
      open
      title={t('create.title')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (valid && !create.isPending) create.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? t('create.creating') : t('create.create')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <TextField
          label={t('create.name')}
          required
          maxLength={200}
          error={missing(form.name)}
          value={form.name}
          onChange={(event) => {
            set('name', event.target.value);
            if (!slugTouched) set('slug', slugOf(event.target.value));
          }}
        />
        <TextField
          label={t('create.slug')}
          hint={t('create.slugHint')}
          required
          maxLength={63}
          error={slugError}
          value={form.slug}
          onChange={(event) => {
            setSlugTouched(true);
            set('slug', event.target.value.toLowerCase());
          }}
        />
        <Select label={t('create.plan')} required options={activePlans.map((plan) => ({ value: plan.code, label: plan.name }))} value={planCode} onChange={(event) => set('planCode', event.target.value)} />
        <Select label={t('create.country')} required options={(countries.data ?? []).map((country) => ({ value: country.code, label: country.name }))} value={countryCode} onChange={(event) => set('countryCode', event.target.value)} />
        <fieldset className={styles.group}>
          <legend>{t('create.owner')}</legend>
          <p className={styles.note}>{t('create.ownerHint')}</p>
          <TextField label={t('create.email')} type="email" required maxLength={254} error={missing(form.email)} value={form.email} onChange={(event) => set('email', event.target.value)} />
          <TextField label={t('create.firstName')} required maxLength={100} error={missing(form.firstName)} value={form.firstName} onChange={(event) => set('firstName', event.target.value)} />
          <TextField label={t('create.lastName')} required maxLength={100} error={missing(form.lastName)} value={form.lastName} onChange={(event) => set('lastName', event.target.value)} />
        </fieldset>
        {(plans.isError || countries.isError) && <PlatformError error={plans.error ?? countries.error} />}
        {create.isError && <PlatformError error={create.error} />}
      </div>
    </Dialog>
  );
}
