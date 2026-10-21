import { pageResponseSchema, priorityResponseSchema } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import { adminQueryKeys } from '@/shared/admin/admin-api';

const ALL = 100;

/** Every active priority in its order, to choose a subcategory's default (a short list: one page). */
export function activePrioritiesQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, 'priorities', 'active'] as const,
    queryFn: ({ signal }) => client.request(`/priorities?pageSize=${ALL}`, { schema: pageResponseSchema(priorityResponseSchema), signal }),
    select: (page) => page.items.filter((priority) => priority.isActive).sort((left, right) => left.sortOrder - right.sortOrder),
  });
}
