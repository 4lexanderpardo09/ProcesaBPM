import { useTranslation } from 'react-i18next';
import { Button, PlusIcon, TextField } from '@/shared/ui';
import styles from '../Builder.module.css';

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

/** The options of a list: what is stored (value) and what is shown (label); the value starts as the label. */
export function OptionsEditor({ options, onChange }: { readonly options: readonly FieldOption[]; readonly onChange: (options: FieldOption[]) => void }) {
  const { t } = useTranslation('workflows');
  const replace = (index: number, option: FieldOption) => onChange(options.map((current, at) => (at === index ? option : current)));
  return (
    <fieldset className={styles.choices}>
      <legend>{t('builder.fields.config.options')}</legend>
      <ol className={styles.rules}>
        {options.map((option, index) => (
          <li key={index} className={styles.ruleCompact}>
            <span className={styles.ruleTitle}>{t('builder.fields.config.optionRow', { index: index + 1 })}</span>
            <div className={styles.pair}>
              <TextField
                label={t('builder.fields.config.optionLabel')}
                maxLength={200}
                value={option.label}
                onChange={(event) => replace(index, { label: event.target.value, value: option.value === option.label ? event.target.value : option.value })}
              />
              <TextField label={t('builder.fields.config.optionValue')} maxLength={200} value={option.value} onChange={(event) => replace(index, { ...option, value: event.target.value })} />
            </div>
            <Button variant="ghost" onClick={() => onChange(options.filter((_option, at) => at !== index))}>
              {t('builder.fields.config.removeOption', { index: index + 1 })}
            </Button>
          </li>
        ))}
      </ol>
      <Button icon={<PlusIcon size={14} />} onClick={() => onChange([...options, { value: '', label: '' }])}>
        {t('builder.fields.config.addOption')}
      </Button>
    </fieldset>
  );
}
