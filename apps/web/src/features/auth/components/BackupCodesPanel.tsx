import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DownloadIcon } from '@/shared/ui';
import { CopyButton } from './CopyButton';
import styles from './auth-forms.module.css';
import panel from './BackupCodesPanel.module.css';
import { StepHeading } from './StepHeading';

export interface BackupCodesPanelProps {
  readonly codes: readonly string[];
  readonly onContinue: () => void;
}

/** Builds the text file in the browser and releases its URL right away: the codes never leave the page otherwise. */
function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function BackupCodesPanel({ codes, onContinue }: BackupCodesPanelProps) {
  const { t } = useTranslation('auth');
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  return (
    <div className={styles.form}>
      <StepHeading title={t('backupCodes.title')} description={t('backupCodes.help')} />
      <ul className={panel.codes}>
        {codes.map((code) => (
          <li key={code} className={styles.code}>
            {code}
          </li>
        ))}
      </ul>
      <div className={panel.tools}>
        <CopyButton text={text} label={t('backupCodes.copy')} copiedLabel={t('backupCodes.copied')} />
        <Button variant="ghost" icon={<DownloadIcon size={15} />} onClick={() => downloadText(t('backupCodes.fileName'), text)}>
          {t('backupCodes.download')}
        </Button>
      </div>
      <Checkbox label={t('backupCodes.ack')} checked={saved} onChange={(event) => setSaved(event.target.checked)} />
      <div className={styles.actions}>
        <Button variant="brand" disabled={!saved} onClick={onContinue}>
          {t('backupCodes.continue')}
        </Button>
      </div>
    </div>
  );
}
