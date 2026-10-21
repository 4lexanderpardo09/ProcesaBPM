import { type ReplaceSlaOverridesRequest, SLA_UNITS, type SlaOverrideDocument } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select } from '@/shared/ui';
import { useRecordNames } from '../../hooks/use-record-names';
import { WholeNumberField } from '../WholeNumberField';
import styles from '../Builder.module.css';

type Override = ReplaceSlaOverridesRequest['overrides'][number];

/** A deadline of its own for the tickets of some companies; the others keep the step's. */
export function SlaOverridesEditor({ overrides, readOnly, pending, onChange }: { readonly overrides: readonly SlaOverrideDocument[]; readonly readOnly: boolean; readonly pending: boolean; readonly onChange: (overrides: Override[]) => void }) {
  const { t } = useTranslation('workflows');
  const { records, nameOf } = useRecordNames(new Set(['COMPANY']), []);
  const [companyId, setCompanyId] = useState('');
  const [value, setValue] = useState<number | null>(null);
  const [unit, setUnit] = useState<Override['slaUnit']>('BUSINESS_DAYS');
  const current: Override[] = overrides.map((override) => ({ companyId: override.companyId, slaValue: override.slaValue, slaUnit: override.slaUnit }));
  const taken = new Set(current.map((override) => override.companyId));
  return (
    <div className={styles.participants}>
      {current.length === 0 ? (
        <p className={styles.note}>{t('builder.participants.slaEmpty')}</p>
      ) : (
        <ul className={styles.fieldList} aria-label={t('builder.participants.sla')}>
          {current.map((override) => {
            const company = nameOf(override.companyId) ?? t('builder.participants.unknown');
            return (
              <li key={override.companyId} className={styles.fieldRow}>
                <span className={styles.fieldName}>{t('builder.participants.slaRow', { company, value: override.slaValue, unit: t(`builder.sla.units.${override.slaUnit}`) })}</span>
                {!readOnly && (
                  <Button variant="ghost" aria-label={t('builder.participants.removeNamed', { name: company })} disabled={pending} onClick={() => onChange(current.filter((other) => other.companyId !== override.companyId))}>
                    {t('builder.participants.remove')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div className={styles.addParticipant}>
          <Select
            label={t('builder.participants.company')}
            placeholder={t('builder.participants.companyPlaceholder')}
            options={records.COMPANY.filter((record) => record.isActive && !taken.has(record.id)).map((record) => ({ value: record.id, label: record.name }))}
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          />
          <div className={styles.pair}>
            <WholeNumberField label={t('builder.participants.slaValue')} min={1} value={value} onChange={setValue} />
            <Select label={t('builder.participants.slaUnit')} options={SLA_UNITS.map((option) => ({ value: option, label: t(`builder.sla.units.${option}`) }))} value={unit} onChange={(event) => setUnit(event.target.value as Override['slaUnit'])} />
          </div>
          <div>
            <Button
              disabled={companyId === '' || value === null || value < 1 || pending}
              onClick={() => {
                if (value === null) return;
                onChange([...current, { companyId, slaValue: value, slaUnit: unit }]);
                setCompanyId('');
                setValue(null);
              }}
            >
              {t('builder.participants.add')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
