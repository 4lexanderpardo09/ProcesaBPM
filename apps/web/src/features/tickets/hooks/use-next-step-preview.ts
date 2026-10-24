import type { TransitionPreviewResponse } from '@procesabpm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import type { AssigneeChoice } from '../lib/assignee-choices';

/** How long the typing settles before the preview is asked again: the conditions on the way read what was typed. */
const TYPING_DELAY_MS = 400;

/**
 * Where an answer (or a new ticket) would go, asked again as the values typed change: `key` names what is previewed
 * (the ticket and decision, or the subcategory) and `values` are the ones typed so far. The last answer stays shown
 * while the next one loads.
 */
export function useNextStepPreview(key: readonly unknown[], values: Readonly<Record<string, unknown>>, fetch: (values: Readonly<Record<string, unknown>>) => Promise<TransitionPreviewResponse>, enabled = true) {
  const settled = useDebouncedValue(JSON.stringify(values), TYPING_DELAY_MS);
  return useQuery({
    queryKey: ['tickets', 'next-step', ...key, settled],
    queryFn: () => fetch(JSON.parse(settled) as Record<string, unknown>),
    placeholderData: keepPreviousData,
    retry: false,
    enabled,
  });
}

/** The people to choose from when the preview says the next step asks for it. */
export function choicesOfPreview(preview: TransitionPreviewResponse | undefined): readonly AssigneeChoice[] | undefined {
  return preview?.assignment === 'CHOOSE' ? preview.people : undefined;
}
