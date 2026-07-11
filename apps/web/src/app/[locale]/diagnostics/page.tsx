import { getTranslations } from 'next-intl/server';
import { DiagnosticsCenter } from '../../../components/diagnostics-center';
export default async function DiagnosticsPage() {
  const t = await getTranslations('diagnostics');
  return (
    <main className="page">
      <div className="pageTitle">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
      </div>
      <DiagnosticsCenter />
    </main>
  );
}
