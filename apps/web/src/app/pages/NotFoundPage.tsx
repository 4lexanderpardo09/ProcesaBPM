import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '@/shared/ui';
import { paths } from '../router/paths';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('notFound.title')} subtitle={t('notFound.description')} />
      <Link to={paths.home}>{t('notFound.backHome')}</Link>
    </>
  );
}
