import { type AiFormatJob, emptyCanvasDesign, type PdfCanvasDesign } from '@procesabpm/shared';
import type { FormatAi } from '../../lib/use-format-ai';

/** A request in some state, for the panel's stories and tests. */
export function formatJob(over: Partial<AiFormatJob>): AiFormatJob {
  return {
    id: 'j1',
    kind: 'PDF_FORMAT_DRAFT',
    status: 'RUNNING',
    stage: 'DESIGNING',
    round: 1,
    problems: null,
    errorCode: null,
    result: null,
    createdAt: '2026-10-30T15:00:00Z',
    startedAt: '2026-10-30T15:00:05Z',
    completedAt: null,
    description: 'Acta de entrega con el logo, la tabla de artículos y las firmas de quien entrega y quien recibe.',
    requestedById: 'u1',
    requesterName: 'Ana Gómez',
    cancelledByName: null,
    tokens: 0,
    images: 0,
    ...over,
  };
}

export const designed: PdfCanvasDesign = emptyCanvasDesign();

export const finishedJob = formatJob({
  status: 'SUCCEEDED',
  stage: 'WRITING',
  completedAt: '2026-10-30T15:01:10Z',
  tokens: 9_400,
  result: { design: designed, assumptions: ['Supuse tamaño carta.'], decisions: [{ topic: 'SIGNATURES', text: 'Dos firmas abajo: quien entrega y quien recibe.' }], corrections: 1, rounds: 2, errors: 0, warnings: 0 },
});

/** The hook's shape with inert mutations: only the fields the panel reads are real. */
export function formatAi(jobs: readonly AiFormatJob[], mutate: (body: unknown) => void = () => undefined): FormatAi {
  const inert = { isPending: false, mutate: () => undefined, error: null };
  return {
    available: true,
    remainingToday: 9,
    jobs,
    loading: false,
    active: jobs.findLast((job) => job.status === 'PENDING' || job.status === 'RUNNING'),
    request: { ...inert, mutate },
    cancel: inert,
  } as unknown as FormatAi;
}
