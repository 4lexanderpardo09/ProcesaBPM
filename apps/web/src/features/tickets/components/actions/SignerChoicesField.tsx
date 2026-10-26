import { useTranslation } from 'react-i18next';
import { Select } from '@/shared/ui';
import { SKIP_SIGNATURE, type SignerChoicesState } from '../../hooks/use-signer-choices';
import styles from './SignerChoicesField.module.css';

/**
 * As in the help desk: for each signer of the next step that resolved to nobody (a position without holders, no
 * approver...), or every signer when the step asks to choose them (the suggested person comes chosen), who signs among
 * the company's members, or that signature left out.
 */
export function SignerChoicesField({ choices }: { readonly choices: SignerChoicesState }) {
  const { t } = useTranslation('tickets');
  if (choices.signers.length === 0) return null;
  return (
    <fieldset className={styles.group}>
      <legend className="text-label">{t('actions.signerChoices.title')}</legend>
      <p className={styles.hint}>{t('actions.signerChoices.hint')}</p>
      {choices.signers.map((signer) => {
        const value = choices.answerOf(signer);
        return (
          <Select
            key={signer.signerId}
            label={signer.label ?? t(`actions.signerChoices.type.${signer.signerType}`)}
            required
            value={value}
            placeholder={t('actions.people.placeholder')}
            options={[{ value: SKIP_SIGNATURE, label: t('actions.signerChoices.skip') }, ...signer.candidates.map((candidate) => ({ value: candidate.id, label: candidate.name }))]}
            error={choices.missing && value === '' ? t('actions.signerChoices.required') : undefined}
            onChange={(event) => choices.answer(signer.signerId, event.target.value)}
          />
        );
      })}
    </fieldset>
  );
}
