import { useTranslation } from 'react-i18next';
import styles from '../Builder.module.css';

/** Formulas for what other systems hard-code as fixed calculators: each organization writes its own with its field codes. */
export const FORMULA_EXAMPLES = [
  ['total', 'SUM(GASTOS.VALOR)'],
  ['balance', 'ANTICIPO - SUM(GASTOS.VALOR)'],
  ['label', 'IF(SALDO > 0, "Devuelve a la empresa", IF(SALDO < 0, "La empresa le debe", "Sin saldo"))'],
  ['percent', 'ROUND(MONTO * 0.19, 0)'],
  ['days', 'DAYS_BETWEEN(FECHA_INICIO, FECHA_FIN) + 1'],
  ['due', 'ADD_BUSINESS_DAYS(TODAY(), 5)'],
  ['cap', 'MIN(SOLICITADO, TOPE)'],
] as const;

/** Worked examples and the functions a formula can use, folded under the expression. */
export function FormulaGuide() {
  const { t } = useTranslation('workflows');
  return (
    <details className={styles.note}>
      <summary>{t('builder.fields.formulaGuide.title')}</summary>
      <dl>
        {FORMULA_EXAMPLES.map(([key, expression]) => (
          <div key={key}>
            <dt>{t(`builder.fields.formulaGuide.examples.${key}`)}</dt>
            <dd>
              <code>{expression}</code>
            </dd>
          </div>
        ))}
      </dl>
      <p>{t('builder.fields.formulaGuide.functions')}</p>
    </details>
  );
}
