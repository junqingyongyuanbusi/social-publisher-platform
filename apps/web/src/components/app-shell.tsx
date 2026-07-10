import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';

const navigation = [
  ['overview', ''],
  ['compose', 'compose'],
  ['publications', 'publications'],
  ['accounts', 'accounts'],
  ['credentials', 'credentials'],
  ['diagnostics', 'diagnostics'],
] as const;

export async function AppShell({
  active,
  children,
  locale,
}: {
  active: (typeof navigation)[number][0];
  children: ReactNode;
  locale: string;
}) {
  const t = await getTranslations();
  const otherLocale = locale === 'zh-CN' ? 'en-US' : 'zh-CN';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark">S</span>
          <span>Social Publisher</span>
        </div>
        <nav className="nav" aria-label={t('nav.label')}>
          {navigation.map(([item, path]) => (
            <Link
              aria-current={active === item ? 'page' : undefined}
              className={active === item ? 'active' : undefined}
              href={`/${locale}${path ? `/${path}` : ''}`}
              key={item}
            >
              {t(`nav.${item}`)}
            </Link>
          ))}
        </nav>
        <div className="sidebarFoot">
          API v1 · Worker ready
          <br />
          Request IDs enabled
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="pill">● {t('header.environment')}</span>
          <Link
            className="pill"
            href={`/${otherLocale}${active === 'overview' ? '' : `/${active}`}`}
          >
            {t('header.language')}
          </Link>
          <Link className="pill" href={`/api/auth/login?returnTo=/${locale}`}>
            {t('header.signIn')}
          </Link>
          <button className="button" type="button">
            ＋ {t('header.newPost')}
          </button>
        </header>
        {children}
      </main>
    </div>
  );
}
