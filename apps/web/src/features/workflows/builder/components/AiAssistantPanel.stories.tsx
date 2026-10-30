import type { AiJobHistoryItem } from '@procesabpm/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { AiDraft } from '../hooks/use-ai-draft';
import { AiAssistantPanel } from './AiAssistantPanel';

/** A request in some state; the overrides pick the stage so each story shows one point of the run. */
function job(over: Partial<AiJobHistoryItem>): AiJobHistoryItem {
  return {
    id: 'j1',
    kind: 'WORKFLOW_DRAFT_REVISION',
    status: 'RUNNING',
    stage: 'DESIGNING',
    round: 1,
    problems: null,
    errorCode: null,
    result: null,
    preview: null,
    createdAt: '2026-10-30T15:00:00Z',
    startedAt: '2026-10-30T15:00:05Z',
    completedAt: null,
    description: 'Agrega un paso de revisión jurídica después de la aprobación de gerencia.',
    requestedById: 'u1',
    requesterName: 'Ana Gómez',
    cancelledByName: null,
    tokens: 0,
    ...over,
  };
}

/** The draft the panel reads. Only the fields the panel touches are real; the mutations are inert stubs. */
function draft(jobs: readonly AiJobHistoryItem[], loading = false): AiDraft {
  const inert = { isPending: false, mutate: () => undefined, error: null };
  return {
    available: true,
    remainingToday: 9,
    jobs,
    loading,
    active: jobs.findLast((candidate) => candidate.status === 'PENDING' || candidate.status === 'RUNNING'),
    live: true,
    request: inert,
    cancel: inert,
  } as unknown as AiDraft;
}

const meta = {
  title: 'Workflows/AiAssistantPanel',
  component: AiAssistantPanel,
  args: { revision: 3, hasContent: true, dirty: false, onClose: () => undefined },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', width: 440, height: 660, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AiAssistantPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** First use: Jiro greets and invites, instead of a wall of instructions. */
export const PrimerUso: Story = { name: 'Primer uso', args: { ai: draft([]), hasContent: false } };

/** Queued before the run starts. */
export const EnCola: Story = { name: 'En cola', args: { ai: draft([job({ id: 'q', status: 'PENDING', stage: null, round: null })]) } };

export const Leyendo: Story = { args: { ai: draft([job({ stage: 'READING', round: null })]) } };

export const Disenando: Story = { name: 'Diseñando', args: { ai: draft([job({ stage: 'DESIGNING', round: 1 })]) } };

export const Revisando: Story = { args: { ai: draft([job({ stage: 'REVIEWING', round: 1, problems: 2 })]) } };

export const Escribiendo: Story = { args: { ai: draft([job({ stage: 'WRITING', round: null })]) } };
