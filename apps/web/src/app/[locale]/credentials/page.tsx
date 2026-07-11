import { getTranslations } from 'next-intl/server';
import { AppShell } from '../../../components/app-shell';
import { CredentialManager } from '../../../components/credential-manager';

export default async function CredentialsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('credentials');

  return (
    <AppShell active="credentials" locale={locale}>
      <div className="content">
        <div className="eyebrow">{t('eyebrow')}</div>
        <h1>{t('title')}</h1>
        <p className="subtitle">{t('subtitle')}</p>
        <CredentialManager />
      </div>
    </AppShell>
  );
}
