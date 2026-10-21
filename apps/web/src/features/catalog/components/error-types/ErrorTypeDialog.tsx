import { type ErrorTypeResponse, errorTypeResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, TextArea, TextField } from '@/shared/ui';
import { saveCatalogItem } from '../../api/catalog-api';
import { useCatalogMutation } from '../../hooks/use-catalog-mutation';
import { CatalogDialog } from '../CatalogDialog';
import styles from '../Catalog.module.css';

const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

/**
 * An error type: a reopening type is offered when a closed ticket is reopened; one that forces the close ends the
 * ticket when it is reported. A type cannot be both (the API refuses it), so choosing one clears the other.
 */
export function ErrorTypeDialog({ record, onClose }: { readonly record: ErrorTypeResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation('catalog');
  const [name, setName] = useState(record?.name ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [isReopening, setIsReopening] = useState(record?.isReopening ?? false);
  const [forcesClose, setForcesClose] = useState(record?.forcesClose ?? false);
  const [isProcessError, setIsProcessError] = useState(record?.isProcessError ?? false);
  const [submitted, setSubmitted] = useState(false);
  const save = useCatalogMutation((client, body: Record<string, unknown>) => saveCatalogItem(client, '/error-types', errorTypeResponseSchema, record?.id, body));

  const submit = () => {
    setSubmitted(true);
    if (name.trim() === '') return;
    const text = description.trim();
    const flags = { isReopening, forcesClose, isProcessError };
    const body = record === undefined ? { name: name.trim(), ...(text === '' ? {} : { description: text }), ...flags } : { name: name.trim(), description: text === '' ? null : text, ...flags };
    save.mutate(body, { onSuccess: onClose });
  };

  return (
    <CatalogDialog title={record === undefined ? t('errorTypes.new') : t('errorTypes.edit')} submitLabel={t('dialog.save')} pending={save.isPending} error={save.error} onClose={onClose} onSubmit={submit}>
      <TextField label={t('fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <TextArea label={t('fields.description')} value={description} maxLength={DESCRIPTION_MAX} rows={3} onChange={(event) => setDescription(event.target.value)} />
      <fieldset className={styles.flags}>
        <legend className="text-label">{t('errorTypes.kind')}</legend>
        <Checkbox
          label={t('errorTypes.reopeningHelp')}
          checked={isReopening}
          onChange={(event) => {
            setIsReopening(event.target.checked);
            if (event.target.checked) setForcesClose(false);
          }}
        />
        <Checkbox
          label={t('errorTypes.forcesCloseHelp')}
          checked={forcesClose}
          onChange={(event) => {
            setForcesClose(event.target.checked);
            if (event.target.checked) setIsReopening(false);
          }}
        />
        <Checkbox label={t('errorTypes.processErrorHelp')} checked={isProcessError} onChange={(event) => setIsProcessError(event.target.checked)} />
      </fieldset>
    </CatalogDialog>
  );
}
