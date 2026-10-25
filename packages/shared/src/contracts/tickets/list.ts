import { z } from 'zod';
import { pageQuerySchema } from '../common.js';
import { FIELD_CODE_PATTERN } from '../../workflow/constants.js';
import { uuidSchema } from '../ids.js';
import { TICKET_VIEWS, ticketStatusSchema } from './schemas.js';

export type TicketView = (typeof TICKET_VIEWS)[number];

/**
 * The filters the ticket inbox shares between its listing and its counts. `search` matches the ticket number,
 * the title or the requester's name; `categoryId` keeps the tickets whose subcategory belongs to that category;
 * `tagId` is one of the caller's own tags (tags are personal); `assigneeId` is whoever holds the ticket now;
 * `createdFrom` and `createdTo` are instants (the client turns the person's dates into them), `createdTo` excluded.
 *
 * `fieldCode` filters by a field of the form in every workflow that has one with that code, with `fieldOperator`:
 * `contains` (text, ignoring case) or `equals` (text or number) `fieldValue`; `between` `fieldValue` and
 * `fieldValueTo`, both included and either one optional, both dates (`YYYY-MM-DD`) or both numbers; `filled` or
 * `empty`. "Overdue" or "in the next days" are a `between` the client builds from the person's today.
 */
export const FIELD_FILTER_OPERATORS = ['contains', 'equals', 'between', 'filled', 'empty'] as const;
export type FieldFilterOperator = (typeof FIELD_FILTER_OPERATORS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d{1,15}(\.\d{1,6})?$/;

/**
 * What a `between` compares: dates or numbers, never one of each, with the lower bound first; `undefined` when
 * the bounds do not make a range.
 */
export function fieldRangeKind(from: string | undefined, to: string | undefined): 'date' | 'number' | undefined {
  const bounds = [from, to].filter((bound) => bound !== undefined);
  if (bounds.length === 0) return undefined;
  const kind = bounds.every((bound) => DAY.test(bound) && !Number.isNaN(Date.parse(bound))) ? 'date' : bounds.every((bound) => NUMBER.test(bound)) ? 'number' : undefined;
  if (kind === undefined || from === undefined || to === undefined) return kind;
  const inOrder = kind === 'date' ? from <= to : Number(from) <= Number(to);
  return inOrder ? kind : undefined;
}

const ticketFiltersObject = z.object({
  status: ticketStatusSchema.optional(),
  search: pageQuerySchema.shape.search,
  /** `true`: the search also looks in the description and the comments (slower: plain text search over every message). */
  searchMessages: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  /** The requester's priority. */
  priorityId: uuidSchema.optional(),
  /** The workflow's priority (the subcategory's), filtered apart from the requester's as in the help desk. */
  workflowPriorityId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  subcategoryId: uuidSchema.optional(),
  companyId: uuidSchema.optional(),
  siteId: uuidSchema.optional(),
  creatorId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
  tagId: uuidSchema.optional(),
  createdFrom: z.iso.datetime({ offset: true }).optional(),
  createdTo: z.iso.datetime({ offset: true }).optional(),
  fieldCode: z.string().regex(FIELD_CODE_PATTERN).optional(),
  fieldOperator: z.enum(FIELD_FILTER_OPERATORS).optional(),
  fieldValue: z.string().trim().min(1).max(200).optional(),
  fieldValueTo: z.string().trim().min(1).max(200).optional(),
});
const datesInOrder = (query: { createdFrom?: string | undefined; createdTo?: string | undefined }) =>
  query.createdFrom === undefined || query.createdTo === undefined || Date.parse(query.createdFrom) < Date.parse(query.createdTo);
const DATES_IN_ORDER = { message: 'createdFrom must be before createdTo', path: ['createdTo'] };

type FieldFilterInput = Partial<Pick<z.infer<typeof ticketFiltersObject>, 'fieldCode' | 'fieldOperator' | 'fieldValue' | 'fieldValueTo'>>;

/** Whether the field filter is whole: a code with its operator, and the values that operator needs. */
function fieldFilterComplete(query: FieldFilterInput): boolean {
  const { fieldCode, fieldOperator, fieldValue, fieldValueTo } = query;
  if (fieldCode === undefined || fieldOperator === undefined) return fieldCode === undefined && fieldOperator === undefined && fieldValue === undefined && fieldValueTo === undefined;
  switch (fieldOperator) {
    case 'contains':
    case 'equals':
      return fieldValue !== undefined && fieldValueTo === undefined;
    case 'between':
      return fieldRangeKind(fieldValue, fieldValueTo) !== undefined;
    case 'filled':
    case 'empty':
      return fieldValue === undefined && fieldValueTo === undefined;
  }
}
const FIELD_FILTER_COMPLETE = { message: 'fieldCode, fieldOperator and the values the operator needs go together', path: ['fieldOperator'] };

export const ticketFiltersQuerySchema = ticketFiltersObject.refine(datesInOrder, DATES_IN_ORDER).refine(fieldFilterComplete, FIELD_FILTER_COMPLETE);
export type TicketFiltersQuery = z.infer<typeof ticketFiltersQuerySchema>;

/**
 * How the inbox sorts, as in the help desk: by default the latest activity first (`lastActivity`, the last event of the
 * ticket). `requester` sorts by the requester's name; the priorities by their place in the catalog.
 */
export const TICKET_SORTS = ['lastActivity', 'number', 'title', 'status', 'requester', 'priority', 'workflowPriority', 'createdAt'] as const;
export type TicketSort = (typeof TICKET_SORTS)[number];
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const listTicketsQuerySchema = pageQuerySchema
  .pick({ page: true, pageSize: true })
  .extend({ view: z.enum(TICKET_VIEWS).default('assigned'), sort: z.enum(TICKET_SORTS).default('lastActivity'), direction: z.enum(SORT_DIRECTIONS).default('desc') })
  .extend(ticketFiltersObject.shape)
  .refine(datesInOrder, DATES_IN_ORDER)
  .refine(fieldFilterComplete, FIELD_FILTER_COMPLETE);
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

/** `GET /tickets/counts`: how many tickets each view holds under the same filters as the listing. */
export type TicketCountsResponse = Readonly<Record<TicketView, number>>;

const countSchema = z.number().int().min(0);

/** Parses `TicketCountsResponse` (for the web client). */
export const ticketCountsResponseSchema = z.object({
  assigned: countSchema,
  created: countSchema,
  observed: countSchema,
  all: countSchema,
  history: countSchema,
  reopened: countSchema,
  errors_reported: countSchema,
  errors_received: countSchema,
}) satisfies z.ZodType<TicketCountsResponse>;

/** The field types the inbox can filter by: one value each, text, number or date (no tables, files nor people). */
export const FILTERABLE_FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DAYS', 'FORMULA', 'DATE', 'DATETIME', 'SELECT'] as const;
export type FilterableFieldType = (typeof FILTERABLE_FIELD_TYPES)[number];

/**
 * `GET /tickets/filter-fields`: one entry per field code of the published versions of the active workflows, with
 * the label and type of its most recently published version. `options` are the fixed options of a `SELECT`
 * (`null` for any other field, or a `SELECT` fed by a dataset or a preset).
 */
export interface TicketFilterFieldResponse {
  readonly code: string;
  readonly label: string;
  readonly type: FilterableFieldType;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }> | null;
}

export const ticketFilterFieldsResponseSchema = z.array(
  z.object({
    code: z.string(),
    label: z.string(),
    type: z.enum(FILTERABLE_FIELD_TYPES),
    options: z.array(z.object({ value: z.string(), label: z.string() })).nullable(),
  }) satisfies z.ZodType<TicketFilterFieldResponse>,
);
