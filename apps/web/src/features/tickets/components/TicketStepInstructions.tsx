import type { TicketFormResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { textAsHtml } from '@/shared/lib/text-as-html';
import { Card, RichText } from '@/shared/ui';

/** What the workflow asks of whoever handles the step the ticket is on; nothing when the step has no instructions. */
export function TicketStepInstructions({ form }: { readonly form: TicketFormResponse | undefined }) {
  const { t } = useTranslation('tickets');
  const step = form?.step;
  if (step === undefined || step === null || step.description === null) return null;
  const html = textAsHtml(step.description);
  if (html === '') return null;
  return (
    <Card title={t('detail.instructions.title', { step: step.name })}>
      <RichText html={html} />
    </Card>
  );
}
