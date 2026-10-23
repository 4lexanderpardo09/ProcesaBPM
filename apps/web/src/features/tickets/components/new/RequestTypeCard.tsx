import type { AvailableCategory, PriorityResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Card, Select } from '@/shared/ui';
import styles from './NewTicket.module.css';

export interface RequestType {
  readonly companyId: string;
  readonly categoryId: string;
  readonly subcategoryId: string;
  /** `undefined` until the person picks one: the subcategory's default applies. */
  readonly priorityId: string | undefined;
}

export interface RequestTypeCardProps {
  readonly companies: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** `undefined` while the catalog loads. */
  readonly categories: readonly AvailableCategory[] | undefined;
  readonly catalogFailed: boolean;
  /** Subcategories of the person's latest tickets, the most recent first: one click picks one. */
  readonly recent?: readonly string[];
  readonly priorities: readonly PriorityResponse[];
  /** The priority shown as chosen: the person's pick, or the subcategory's default. */
  readonly priorityId: string | null;
  readonly value: RequestType;
  readonly onChange: (value: RequestType) => void;
}

/** Step 1: what is being asked for. The subcategory decides the workflow, so choosing another one resets the form below. */
export function RequestTypeCard({ companies, categories, catalogFailed, recent = [], priorities, priorityId, value, onChange }: RequestTypeCardProps) {
  const { t } = useTranslation('tickets');
  const subcategories = categories?.find((category) => category.id === value.categoryId)?.subcategories ?? [];
  const catalogStatus = catalogFailed ? t('new.type.catalogFailed') : categories === undefined ? t('new.type.loading') : categories.length === 0 ? t('new.type.noCategories') : undefined;
  const shortcuts = recent.flatMap((subcategoryId) => {
    const category = categories?.find((candidate) => candidate.subcategories.some((subcategory) => subcategory.id === subcategoryId));
    const subcategory = category?.subcategories.find((candidate) => candidate.id === subcategoryId);
    return category === undefined || subcategory === undefined ? [] : [{ category, subcategory }];
  });
  return (
    <Card title={<SectionTitle number={1} title={t('new.type.title')} />} actions={<span className={styles.hint}>{t('new.type.hint')}</span>}>
      {shortcuts.length > 0 && (
        <div className={styles.recent} role="group" aria-label={t('new.type.recent')}>
          <span className={styles.recentLabel}>{t('new.type.recent')}</span>
          {shortcuts.map(({ category, subcategory }) => (
            <button
              key={subcategory.id}
              type="button"
              className={styles.recentChip}
              aria-pressed={value.subcategoryId === subcategory.id}
              onClick={() => onChange({ ...value, categoryId: category.id, subcategoryId: subcategory.id, priorityId: undefined })}
            >
              {t('new.type.recentItem', { category: category.name, subcategory: subcategory.name })}
            </button>
          ))}
        </div>
      )}
      <div className={styles.grid}>
        {companies.length > 1 && (
          <Select
            label={t('new.type.company')}
            value={value.companyId}
            options={companies.map((company) => ({ value: company.id, label: company.name }))}
            onChange={(event) => onChange({ companyId: event.target.value, categoryId: '', subcategoryId: '', priorityId: undefined })}
          />
        )}
        <Select
          label={t('new.type.category')}
          required
          value={value.categoryId}
          placeholder={catalogStatus ?? t('advance.choose')}
          options={(categories ?? []).map((category) => ({ value: category.id, label: category.name }))}
          disabled={categories === undefined || categories.length === 0}
          onChange={(event) => onChange({ ...value, categoryId: event.target.value, subcategoryId: '', priorityId: undefined })}
        />
        <Select
          label={t('new.type.subcategory')}
          required
          value={value.subcategoryId}
          placeholder={t('advance.choose')}
          options={subcategories.map((subcategory) => ({ value: subcategory.id, label: subcategory.name }))}
          disabled={subcategories.length === 0}
          onChange={(event) => onChange({ ...value, subcategoryId: event.target.value, priorityId: undefined })}
        />
      </div>
      {priorities.length > 0 && (
        <fieldset className={styles.priorities}>
          <legend className="text-label">{t('new.type.priority')}</legend>
          {priorities.map((priority) => (
            <label key={priority.id} className={styles.priority} data-checked={priority.id === priorityId}>
              <input type="radio" name="priority" value={priority.id} checked={priority.id === priorityId} onChange={() => onChange({ ...value, priorityId: priority.id })} />
              {priority.name}
            </label>
          ))}
        </fieldset>
      )}
    </Card>
  );
}

export function SectionTitle({ number, title }: { readonly number: number; readonly title: string }) {
  return (
    <span className={styles.sectionTitle}>
      <span className={styles.sectionNumber} aria-hidden="true">
        {number}
      </span>
      {title}
    </span>
  );
}
