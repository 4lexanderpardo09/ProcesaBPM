import { checkFieldDataSource, FIELD_CODE_PATTERN, type FieldType, parseFieldConfig } from '@procesabpm/shared';

/** Why a field's settings would be refused, as keys of `builder.fields.problems`. */
export type FieldConfigProblem =
  | 'needsOptions'
  | 'optionIncomplete'
  | 'optionRepeated'
  | 'needsColumns'
  | 'columnIncomplete'
  | 'columnRepeated'
  | 'columnOptions'
  | 'needsExpression'
  | 'needsCalculator'
  | 'datasetIncomplete'
  | 'minMax'
  | 'needsFileKind'
  | 'configInvalid';

type Row = { readonly value?: unknown; readonly label?: unknown; readonly code?: unknown; readonly type?: unknown; readonly options?: unknown };

const blank = (value: unknown) => typeof value !== 'string' || value.trim() === '';
const repeated = (values: readonly unknown[]) => new Set(values).size !== values.length;

/**
 * The checks the API's schemas make, said so a person can fix them; anything else the schema refuses ends in
 * `configInvalid`. An empty list means the field can be saved.
 */
export function fieldConfigProblems(type: FieldType, config: Readonly<Record<string, unknown>>, dataSource: Readonly<Record<string, unknown>> | null): FieldConfigProblem[] {
  const problems: FieldConfigProblem[] = [];
  const options = Array.isArray(config.options) ? (config.options as Row[]) : undefined;
  if ((type === 'SELECT' || type === 'MULTI_SELECT') && dataSource === null) {
    if (options === undefined || options.length === 0) problems.push('needsOptions');
    else if (options.some((option) => blank(option.value) || blank(option.label))) problems.push('optionIncomplete');
    else if (repeated(options.map((option) => option.value))) problems.push('optionRepeated');
  }
  if (dataSource?.kind === 'DATASET' && (blank(dataSource.datasetId) || blank(dataSource.column))) problems.push('datasetIncomplete');
  if (type === 'TABLE') {
    const columns = Array.isArray(config.columns) ? (config.columns as Row[]) : [];
    if (columns.length === 0) problems.push('needsColumns');
    else if (columns.some((column) => blank(column.label) || typeof column.code !== 'string' || !FIELD_CODE_PATTERN.test(column.code))) problems.push('columnIncomplete');
    else if (repeated(columns.map((column) => column.code))) problems.push('columnRepeated');
    else if (columns.some((column) => column.type === 'SELECT' && (!Array.isArray(column.options) || column.options.length === 0))) problems.push('columnOptions');
  }
  if (type === 'FORMULA' && blank(config.expression)) problems.push('needsExpression');
  if (type === 'CALCULATOR' && blank(config.calculatorCode)) problems.push('needsCalculator');
  if (type === 'FILE' && Array.isArray(config.accept) && config.accept.length === 0) problems.push('needsFileKind');
  const min = config.min;
  const max = config.max;
  if (typeof min === 'number' && typeof max === 'number' && min > max) problems.push('minMax');
  if (problems.length > 0) return problems;

  const parsed = parseFieldConfig(type, config, dataSource);
  const source = checkFieldDataSource(type, dataSource);
  return parsed.valid && source.valid ? [] : ['configInvalid'];
}
