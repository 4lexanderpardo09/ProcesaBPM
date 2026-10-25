import type { CalculatorResponse } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Alert, Badge, Button, Card, TextField } from '@/shared/ui';
import { calculatorsQueryOptions, configureCalculator, disableCalculator, settingsQueryKeys } from '../api/settings-api';
import { SettingsError } from './SettingsError';
import styles from './Settings.module.css';

const MEAL_ALLOWANCE = 'MEAL_ALLOWANCE';
const TRAVEL_BALANCE = 'TRAVEL_BALANCE';
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const MAX_MEALS = 10;

interface Meal {
  readonly code: string;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
}

const EMPTY_MEAL: Meal = { code: '', from: '', to: '', amount: '' };

/** The meals of a stored configuration; anything that is not one is left out (the API validated what it kept). */
function mealsOf(config: Record<string, unknown> | null): Meal[] {
  const meals = config?.meals;
  if (!Array.isArray(meals)) return [];
  return meals.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { code, from, to, amount } = entry as Record<string, unknown>;
    return typeof code === 'string' && typeof from === 'string' && typeof to === 'string' && typeof amount === 'string' ? [{ code, from, to, amount }] : [];
  });
}

/** Why a meal row would be refused, in the order a person reads it; `null` when it is fine. */
function mealProblem(meal: Meal, index: number, meals: readonly Meal[]): 'code' | 'duplicate' | 'time' | 'order' | 'amount' | null {
  if (meal.code.trim() === '') return 'code';
  if (meals.findIndex((other) => other.code.trim() === meal.code.trim()) !== index) return 'duplicate';
  if (!TIME.test(meal.from) || !TIME.test(meal.to)) return 'time';
  if (meal.from >= meal.to) return 'order';
  return AMOUNT.test(meal.amount.trim()) ? null : 'amount';
}

/**
 * The built-in calculations a workflow field can use (a CALCULATOR field). Each one is off until the organization
 * configures it; turning one off makes the fields that use it fail until it is configured again.
 */
export function CalculatorsTab() {
  const { t } = useTranslation('settings');
  const calculators = useQuery(calculatorsQueryOptions(useApiClient()));
  if (calculators.data === undefined) return <p className={styles.note}>{calculators.isError ? t('loadFailed') : t('loading')}</p>;
  return (
    <div className={styles.stack}>
      {calculators.data.map((calculator) => (
        <CalculatorCard key={calculator.code} calculator={calculator} />
      ))}
    </div>
  );
}

function CalculatorCard({ calculator }: { readonly calculator: CalculatorResponse }) {
  const { t } = useTranslation('settings');
  const title = calculator.code === MEAL_ALLOWANCE ? t('calculators.mealAllowance.title') : calculator.code === TRAVEL_BALANCE ? t('calculators.travelBalance.title') : calculator.code;
  return (
    <Card title={title} actions={<Badge tone={calculator.configured ? 'ok' : 'neutral'}>{calculator.configured ? t('calculators.on') : t('calculators.off')}</Badge>}>
      {calculator.code === MEAL_ALLOWANCE ? (
        <MealAllowanceEditor calculator={calculator} />
      ) : calculator.code === TRAVEL_BALANCE ? (
        <TravelBalanceSwitch calculator={calculator} />
      ) : (
        <p className={styles.note}>{t('calculators.unknown')}</p>
      )}
    </Card>
  );
}

/** The travel balance has nothing to tune: it is only switched on or off. */
function TravelBalanceSwitch({ calculator }: { readonly calculator: CalculatorResponse }) {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: settingsQueryKeys.calculators });
  const turnOn = useMutation({ mutationFn: () => configureCalculator(client, calculator.code, {}), onSuccess: refresh });
  const turnOff = useMutation({ mutationFn: () => disableCalculator(client, calculator.code), onSuccess: refresh });
  return (
    <div className={styles.stack}>
      <p className={styles.note}>{t('calculators.travelBalance.hint')}</p>
      <div className={styles.buttons}>
        {calculator.configured ? (
          <Button variant="ghost" disabled={turnOff.isPending} onClick={() => turnOff.mutate()}>
            {t('calculators.turnOff')}
          </Button>
        ) : (
          <Button variant="brand" disabled={turnOn.isPending} onClick={() => turnOn.mutate()}>
            {t('calculators.turnOn')}
          </Button>
        )}
      </div>
      {calculator.configured && <p className={styles.note}>{t('calculators.offHint')}</p>}
      <SettingsError error={turnOn.error ?? turnOff.error} />
    </div>
  );
}

function MealAllowanceEditor({ calculator }: { readonly calculator: CalculatorResponse }) {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [meals, setMeals] = useState<Meal[]>(() => {
    const stored = mealsOf(calculator.config);
    return stored.length > 0 ? stored : [EMPTY_MEAL];
  });
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: settingsQueryKeys.calculators });
  const save = useMutation({
    mutationFn: (rows: readonly Meal[]) => configureCalculator(client, calculator.code, { meals: rows.map((meal) => ({ ...meal, code: meal.code.trim(), amount: meal.amount.trim() })) }),
    onSuccess: async () => {
      setSaved(true);
      await refresh();
    },
  });
  const disable = useMutation({ mutationFn: () => disableCalculator(client, calculator.code), onSuccess: refresh });
  const problems = meals.map((meal, index) => mealProblem(meal, index, meals));
  const change = (index: number, patch: Partial<Meal>) => {
    setSaved(false);
    setMeals((current) => current.map((meal, at) => (at === index ? { ...meal, ...patch } : meal)));
  };

  return (
    <form
      className={styles.stack}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (problems.every((problem) => problem === null)) save.mutate(meals);
      }}
    >
      <p className={styles.note}>{t('calculators.mealAllowance.hint')}</p>
      {meals.map((meal, index) => {
        const problem = submitted ? problems[index] : null;
        return (
          <fieldset key={index} className={styles.row} aria-label={t('calculators.mealAllowance.meal', { number: index + 1 })}>
            <TextField label={t('calculators.mealAllowance.code')} value={meal.code} maxLength={50} error={problem === 'code' ? t('calculators.problems.code') : problem === 'duplicate' ? t('calculators.problems.duplicate') : undefined} onChange={(event) => change(index, { code: event.target.value })} />
            <TextField label={t('calculators.mealAllowance.from')} type="time" value={meal.from} error={problem === 'time' ? t('calculators.problems.time') : problem === 'order' ? t('calculators.problems.order') : undefined} onChange={(event) => change(index, { from: event.target.value })} />
            <TextField label={t('calculators.mealAllowance.to')} type="time" value={meal.to} onChange={(event) => change(index, { to: event.target.value })} />
            <TextField label={t('calculators.mealAllowance.amount')} inputMode="decimal" value={meal.amount} error={problem === 'amount' ? t('calculators.problems.amount') : undefined} onChange={(event) => change(index, { amount: event.target.value })} />
            <Button variant="ghost" disabled={meals.length === 1} aria-label={t('calculators.mealAllowance.remove', { number: index + 1 })} onClick={() => setMeals((current) => current.filter((_, at) => at !== index))}>
              {t('calculators.mealAllowance.removeShort')}
            </Button>
          </fieldset>
        );
      })}
      <div className={styles.buttons}>
        <Button disabled={meals.length >= MAX_MEALS} onClick={() => setMeals((current) => [...current, EMPTY_MEAL])}>
          {t('calculators.mealAllowance.add')}
        </Button>
        <Button type="submit" variant="brand" disabled={save.isPending}>
          {save.isPending ? t('saving') : calculator.configured ? t('calculators.save') : t('calculators.turnOn')}
        </Button>
        {calculator.configured && (
          <Button variant="ghost" disabled={disable.isPending} onClick={() => disable.mutate()}>
            {t('calculators.turnOff')}
          </Button>
        )}
      </div>
      {saved && <Alert tone="ok">{t('calculators.saved')}</Alert>}
      {calculator.configured && <p className={styles.note}>{t('calculators.offHint')}</p>}
      <SettingsError error={save.error ?? disable.error} />
    </form>
  );
}
