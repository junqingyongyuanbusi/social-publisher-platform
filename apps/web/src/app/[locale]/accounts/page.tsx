import { getTranslations } from 'next-intl/server';
import { AccountManager } from '../../../components/account-manager';

export default async function AccountsPage() {
  const t = await getTranslations('accounts');
  return (
    <main className="page">
      <div className="pageTitle">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
      </div>
      <AccountManager />
    </main>
  );
}
