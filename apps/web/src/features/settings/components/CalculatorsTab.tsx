import type { CalculatorResponse } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Alert, Badge, Button, Card, TextField } from '@/shared/ui';
import { calculatorsQueryOptions, configureCalculator, disableCalculator, settingsQueryKeys } from '../api/settings-api';
import { SettingsError } from './SettingsError';
import styles from './Settings.module.css';

const TIME_SLOTS = 'TIME_SLOTS';
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const TABLE_CODE = /^[A-Z][A-Z0-9_]{0,49}$/;
const MAX_TABLES = 20;
const MAX_SLOTS = 24;

interface Slot {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
}

interface RateTable {
  readonly code: string;
  readonly name: string;
  readonly slots: readonly Slot[];
  /** Stored already: flows may use its code, so it is not rewritten from the name. */
  readonly saved: boolean;
}

const EMPTY_SLOT: Slot = { name: '', from: '', to: '', amount: '' };
const newTable = (): RateTable => ({ code: '', name: '', slots: [EMPTY_SLOT], saved: false });

/** A table code from its name: capitals, digits and _, starting with a letter. */
export function tableCodeOf(name: string): string {
  const code = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return code === '' || /^[A-Z]/.test(code) ? code : `T_${code}`.slice(0, 50);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The rate tables of a stored configuration; anything that is not one is left out (the API validated what it kept). */
function tablesOf(config: Record<string, unknown> | null): RateTable[] {
  const tables = config?.tables;
  if (!Array.isArray(tables)) return [];
  return tables.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { code, name, slots } = entry as Record<string, unknown>;
    if (typeof code !== 'string' || typeof name !== 'string' || !Array.isArray(slots)) return [];
    const rows = slots.flatMap((slot: unknown) => {
      if (typeof slot !== 'object' || slot === null) return [];
      const row = slot as Record<string, unknown>;
      return [{ name: text(row.name), from: text(row.from), to: text(row.to), amount: text(row.amount) }];
    });
    return [{ code, name, slots: rows, saved: true }];
  });
}

type TableProblem = 'name' | 'code' | 'duplicateCode' | null;
type SlotProblem = 'name' | 'duplicate' | 'time' | 'same' | 'amount' | null;

function tableProblem(table: RateTable, index: number, tables: readonly RateTable[]): TableProblem {
  if (table.name.trim() === '') return 'name';
  if (!TABLE_CODE.test(table.code)) return 'code';
  return tables.findIndex((other) => other.code === table.code) !== index ? 'duplicateCode' : null;
}

function slotProblem(slot: Slot, index: number, slots: readonly Slot[]): SlotProblem {
  if (slot.name.trim() === '') return 'name';
  if (slots.findIndex((other) => other.name.trim() === slot.name.trim()) !== index) return 'duplicate';
  if (!TIME.test(slot.from) || !TIME.test(slot.to)) return 'time';
  if (slot.from === slot.to) return 'same';
  return AMOUNT.test(slot.amount.trim()) ? null : 'amount';
}

/**
 * The built-in calculations a workflow field or block can use. Each one is off until the organization configures it;
 * turning one off makes the fields that use it fail until it is configured again. Nothing in them is tied to one
 * process: the organization names and fills in what each calculation works with.
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
  const known = calculator.code === TIME_SLOTS;
  return (
    <Card title={known ? t('calculators.timeSlots.title') : calculator.code} actions={<Badge tone={calculator.configured ? 'ok' : 'neutral'}>{calculator.configured ? t('calculators.on') : t('calculators.off')}</Badge>}>
      {known ? <TimeSlotsEditor calculator={calculator} /> : <p className={styles.note}>{t('calculators.unknown')}</p>}
    </Card>
  );
}

function TimeSlotsEditor({ calculator }: { readonly calculator: CalculatorResponse }) {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [tables, setTables] = useState<RateTable[]>(() => {
    const stored = tablesOf(calculator.config);
    return stored.length > 0 ? stored : [newTable()];
  });
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: settingsQueryKeys.calculators });
  const save = useMutation({
    mutationFn: (rows: readonly RateTable[]) =>
      configureCalculator(client, calculator.code, {
        tables: rows.map((table) => ({ code: table.code, name: table.name.trim(), slots: table.slots.map((slot) => ({ ...slot, name: slot.name.trim(), amount: slot.amount.trim() })) })),
      }),
    onSuccess: async () => {
      setSaved(true);
      setTables((current) => current.map((table) => ({ ...table, saved: true })));
      await refresh();
    },
  });
  const disable = useMutation({ mutationFn: () => disableCalculator(client, calculator.code), onSuccess: refresh });
  const tableProblems = tables.map((table, index) => tableProblem(table, index, tables));
  const slotProblems = tables.map((table) => table.slots.map((slot, index) => slotProblem(slot, index, table.slots)));
  const valid = tableProblems.every((problem) => problem === null) && slotProblems.every((row) => row.every((problem) => problem === null));

  const changeTable = (index: number, patch: Partial<RateTable>) => {
    setSaved(false);
    setTables((current) => current.map((table, at) => (at === index ? { ...table, ...patch } : table)));
  };
  const rename = (index: number, name: string) => {
    const table = tables[index]!;
    // A new table takes its code from its name until someone writes one; a stored one keeps it (flows may use it).
    const followsName = !table.saved && (table.code === '' || table.code === tableCodeOf(table.name));
    changeTable(index, { name, ...(followsName ? { code: tableCodeOf(name) } : {}) });
  };
  const changeSlot = (tableIndex: number, slotIndex: number, patch: Partial<Slot>) =>
    changeTable(tableIndex, { slots: tables[tableIndex]!.slots.map((slot, at) => (at === slotIndex ? { ...slot, ...patch } : slot)) });

  return (
    <form
      className={styles.stack}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (valid) save.mutate(tables);
      }}
    >
      <p className={styles.note}>{t('calculators.timeSlots.hint')}</p>
      {tables.map((table, tableIndex) => {
        const problem = submitted ? tableProblems[tableIndex] : null;
        return (
          <fieldset key={tableIndex} className={styles.stack} aria-label={t('calculators.timeSlots.table', { number: tableIndex + 1 })}>
            <div className={styles.row}>
              <TextField
                label={t('calculators.timeSlots.tableName')}
                placeholder={t('calculators.timeSlots.tableNamePlaceholder')}
                value={table.name}
                maxLength={100}
                error={problem === 'name' ? t('calculators.problems.tableName') : undefined}
                onChange={(event) => rename(tableIndex, event.target.value)}
              />
              <TextField
                label={t('calculators.timeSlots.tableCode')}
                hint={table.saved ? t('calculators.timeSlots.tableCodeSaved') : t('calculators.timeSlots.tableCodeHint')}
                value={table.code}
                maxLength={50}
                readOnly={table.saved}
                error={problem === 'code' ? t('calculators.problems.tableCode') : problem === 'duplicateCode' ? t('calculators.problems.duplicateCode') : undefined}
                onChange={(event) => changeTable(tableIndex, { code: event.target.value.toUpperCase() })}
              />
              <Button variant="ghost" disabled={tables.length === 1} aria-label={t('calculators.timeSlots.removeTable', { number: tableIndex + 1 })} onClick={() => setTables((current) => current.filter((_, at) => at !== tableIndex))}>
                {t('calculators.timeSlots.removeTableShort')}
              </Button>
            </div>
            {table.slots.map((slot, slotIndex) => {
              const slotError = submitted ? slotProblems[tableIndex]![slotIndex] : null;
              return (
                <fieldset key={slotIndex} className={styles.row} aria-label={t('calculators.timeSlots.slot', { table: table.name === '' ? tableIndex + 1 : table.name, number: slotIndex + 1 })}>
                  <TextField
                    label={t('calculators.timeSlots.slotName')}
                    value={slot.name}
                    maxLength={100}
                    error={slotError === 'name' ? t('calculators.problems.slotName') : slotError === 'duplicate' ? t('calculators.problems.duplicateSlot') : undefined}
                    onChange={(event) => changeSlot(tableIndex, slotIndex, { name: event.target.value })}
                  />
                  <TextField
                    label={t('calculators.timeSlots.from')}
                    type="time"
                    value={slot.from}
                    error={slotError === 'time' ? t('calculators.problems.time') : slotError === 'same' ? t('calculators.problems.same') : undefined}
                    onChange={(event) => changeSlot(tableIndex, slotIndex, { from: event.target.value })}
                  />
                  <TextField label={t('calculators.timeSlots.to')} type="time" value={slot.to} onChange={(event) => changeSlot(tableIndex, slotIndex, { to: event.target.value })} />
                  <TextField
                    label={t('calculators.timeSlots.amount')}
                    inputMode="decimal"
                    value={slot.amount}
                    error={slotError === 'amount' ? t('calculators.problems.amount') : undefined}
                    onChange={(event) => changeSlot(tableIndex, slotIndex, { amount: event.target.value })}
                  />
                  <Button
                    variant="ghost"
                    disabled={table.slots.length === 1}
                    aria-label={t('calculators.timeSlots.removeSlot', { number: slotIndex + 1 })}
                    onClick={() => changeTable(tableIndex, { slots: table.slots.filter((_, at) => at !== slotIndex) })}
                  >
                    {t('calculators.timeSlots.removeSlotShort')}
                  </Button>
                </fieldset>
              );
            })}
            <div className={styles.buttons}>
              <Button disabled={table.slots.length >= MAX_SLOTS} onClick={() => changeTable(tableIndex, { slots: [...table.slots, EMPTY_SLOT] })}>
                {t('calculators.timeSlots.addSlot')}
              </Button>
            </div>
          </fieldset>
        );
      })}
      <div className={styles.buttons}>
        <Button disabled={tables.length >= MAX_TABLES} onClick={() => setTables((current) => [...current, newTable()])}>
          {t('calculators.timeSlots.addTable')}
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
