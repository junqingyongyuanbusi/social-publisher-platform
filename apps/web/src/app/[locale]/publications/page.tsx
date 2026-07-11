import { getTranslations } from 'next-intl/server';
import { PublicationManager } from '../../../components/publication-manager';
export default async function PublicationsPage() {
  const t = await getTranslations('publications');
  return (
    <main className="page">
      <div className="pageTitle">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
      </div>
      <PublicationManager />
    </main>
  );
}
