import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/ui';

export interface UnderConstructionPageProps {
  readonly title: string;
}

/** Stand-in for a section whose feature is not built yet; each feature replaces its route. */
export function UnderConstructionPage({ title }: UnderConstructionPageProps) {
  const { t } = useTranslation();
  return <PageHeader title={title} subtitle={t('underConstruction')} />;
}
