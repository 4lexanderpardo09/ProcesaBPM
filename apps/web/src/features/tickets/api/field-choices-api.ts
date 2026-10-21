import { datasetOptionsResponseSchema, fieldOptionsResponseSchema } from '@procesabpm/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import type { ChoiceSource, Option } from '../lib/step-values';

/** The most choices the API gives per search; a longer list is narrowed by typing. */
export const CHOICES_LIMIT = 50;

/**
 * The choices of a field whose list lives in the API: people, sites and preset entries by id, or the values of a
 * dataset column (the value is its own label). Asked by the field, so its own filters apply.
 */
export function fieldChoicesQueryOptions(client: HttpClient, fieldId: string, source: ChoiceSource, search: string) {
  const query = new URLSearchParams({ q: search, limit: String(CHOICES_LIMIT) });
  const field = `/fields/${encodeURIComponent(fieldId)}`;
  return queryOptions({
    queryKey: ['fields', fieldId, 'choices', source, search] as const,
    queryFn: async ({ signal }): Promise<readonly Option[]> => {
      if (source === 'DATASET') {
        const page = await client.request(`${field}/dataset-options?${query.toString()}`, { schema: datasetOptionsResponseSchema, signal });
        return page.values.map((value) => ({ value, label: value }));
      }
      return (await client.request(`${field}/options?${query.toString()}`, { schema: fieldOptionsResponseSchema, signal })).options;
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
