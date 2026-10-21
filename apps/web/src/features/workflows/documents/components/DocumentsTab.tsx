import { usePermissions } from '@/shared/session';
import { FormatsCard } from './FormatsCard';
import { GeneratedDocumentsCard } from './GeneratedDocumentsCard';
import { TemplatesCard } from './TemplatesCard';
import styles from './Documents.module.css';

/** The PDFs of a workflow: which ones its tickets get and when, and the formats and templates they come from. */
export function DocumentsTab({ workflowId }: { readonly workflowId: string }) {
  const { can } = usePermissions();
  const permissions = { create: can('create', 'PdfDocument'), update: can('update', 'PdfDocument'), remove: can('delete', 'PdfDocument') };
  return (
    <div className={styles.cards}>
      <GeneratedDocumentsCard workflowId={workflowId} can={permissions} />
      <FormatsCard workflowId={workflowId} can={permissions} />
      <TemplatesCard workflowId={workflowId} can={permissions} />
    </div>
  );
}
