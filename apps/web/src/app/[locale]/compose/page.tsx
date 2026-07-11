import { getTranslations } from 'next-intl/server';
import { Composer } from '../../../components/composer';
export default async function ComposePage() {
  const t = await getTranslations('compose');
  return (
    <main className="page">
      <div className="pageTitle">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
      </div>
      <Composer />
    </main>
  );
}
