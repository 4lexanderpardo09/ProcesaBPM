import type { AiDraftNotRevisableDetails } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import styles from './Builder.module.css';

type Loss = AiDraftNotRevisableDetails['losses'][number];

/** How each property the spec cannot carry reads to the person; several properties share one label. */
const LABEL_OF = {
  type: 'type',
  removed: 'removed',
  incomplete: 'incomplete',
  description: 'instructions',
  instructions: 'instructions',
  'config.instructions': 'instructions',
  name: 'name',
  label: 'name',
  siteScope: 'siteScope',
  closeRule: 'closeRule',
  manualSelection: 'manualSelection',
  allowsBatch: 'batch',
  'config.batch': 'batch',
  deadlineType: 'deadline',
  deadlineFieldCode: 'deadline',
  deadlineBusinessDays: 'deadline',
  dispatchIntervalMin: 'dispatch',
  slaOverrides: 'slaOverrides',
  files: 'files',
  candidates: 'candidates',
  initiators: 'initiators',
  signers: 'signers',
  positionId: 'position',
  approvalGroupTypeId: 'approval',
  approvalLevel: 'approval',
  assignmentMode: 'assignment',
  'config.requiredExportId': 'requiredExport',
  'config.rejectRequiresComment': 'rejectComment',
  'config.body': 'notification',
  'config.subject': 'notification',
  'config.recipients': 'notification',
  'config.channels': 'notification',
  'config.mode': 'wait',
  'config.options': 'options',
  'config.columns': 'columns',
  isReadOnly: 'readOnly',
  isImmutable: 'immutable',
  dataSource: 'dataSource',
  companyId: 'company',
  rowTypeValue: 'rowType',
  typeColumn: 'rowType',
  isActive: 'inactive',
  condition: 'condition',
  requiresComment: 'comment',
  count: 'count',
} as const;
type LabelKey = (typeof LABEL_OF)[keyof typeof LABEL_OF] | 'other';

const labelOf = (property: string): LabelKey => (LABEL_OF as Readonly<Record<string, LabelKey>>)[property] ?? 'other';

/** What of the draft a revision would lose, so the person can edit it by hand or start over. */
export function AiDraftLosses({ losses }: { readonly losses: readonly Loss[] }) {
  const { t } = useTranslation('workflows');
  return (
    <ul className={styles.aiList}>
      {losses.map((loss) => (
        <li key={`${loss.subject}-${loss.name}`}>
          {t(`builder.ai.losses.subjects.${loss.subject}`, { name: loss.name })}: {[...new Set(loss.properties.map(labelOf))].map((key) => t(`builder.ai.losses.properties.${key}`)).join(', ')}
        </li>
      ))}
    </ul>
  );
}
