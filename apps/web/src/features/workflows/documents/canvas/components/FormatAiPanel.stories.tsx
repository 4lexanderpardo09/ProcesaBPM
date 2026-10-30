import type { Meta, StoryObj } from '@storybook/react-vite';
import { designed, finishedJob, formatAi, formatJob } from './format-ai-fixtures';
import { FormatAiPanel } from './FormatAiPanel';

const meta = {
  title: 'Workflows/FormatAiPanel',
  component: FormatAiPanel,
  args: { design: designed, onApply: () => undefined, onClose: () => undefined },
} satisfies Meta<typeof FormatAiPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** First use: Jiro greets and gives an example of what to ask. */
export const PrimerUso: Story = { name: 'Primer uso', args: { ai: formatAi([]), design: { ...designed, elements: [] } } };

export const Disenando: Story = { name: 'Diseñando', args: { ai: formatAi([formatJob({})]) } };

export const Revisando: Story = { args: { ai: formatAi([formatJob({ stage: 'REVIEWING', round: 1, problems: 2 })]) } };

/** Done: what it decided and assumed, and the design can be put back on the canvas. */
export const Listo: Story = { args: { ai: formatAi([finishedJob]) } };

export const Fallido: Story = { args: { ai: formatAi([formatJob({ status: 'FAILED', errorCode: 'AI_DRAFT_INVALID', completedAt: '2026-10-30T15:00:30Z' })]) } };
