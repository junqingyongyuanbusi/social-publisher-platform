import { getTranslations } from 'next-intl/server';
import { AppShell } from '../../components/app-shell';

const platforms = [
  { name: 'Instagram', id: '@northstar.studio', icon: 'IG' },
  { name: 'Facebook', id: 'Northstar Studio', icon: 'f' },
  { name: 'X', id: '@northstarHQ', icon: 'X' },
];
const posts = [
  {
    icon: 'IG',
    title: 'Summer collection — behind the scenes',
    time: '09:42',
    status: 'published',
  },
  { icon: 'f', title: 'The story behind our new collection', time: '14:30', status: 'scheduled' },
  {
    icon: 'X',
    title: 'A small preview of what we are building…',
    time: '16:00',
    status: 'scheduled',
  },
];

export default async function Dashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations();
  const metrics = [
    [t('dashboard.published'), '24'],
    [t('dashboard.scheduled'), '8'],
    [t('dashboard.attention'), '1'],
    [t('dashboard.successRate'), '98.7%'],
  ];
  return (
    <AppShell active="overview" locale={locale}>
      <div className="content">
        <div className="eyebrow">{t('dashboard.eyebrow')}</div>
        <h1>{t('dashboard.title')}</h1>
        <p className="subtitle">{t('dashboard.subtitle')}</p>
        <section className="metrics">
          {metrics.map(([label, value]) => (
            <div className="card" key={label}>
              <div className="metricLabel">{label}</div>
              <div className="metricValue">{value}</div>
            </div>
          ))}
        </section>
        <section className="grid">
          <div className="card">
            <div className="sectionHead">
              <h2>{t('dashboard.platformHealth')}</h2>
            </div>
            {platforms.map((p) => (
              <div className="platform" key={p.name}>
                <span className="icon">{p.icon}</span>
                <div>
                  <strong>{p.name}</strong>
                  <small>{p.id}</small>
                </div>
                <span className="ok">{t('dashboard.healthy')}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="sectionHead">
              <h2>{t('dashboard.recent')}</h2>
              <a href="#">{t('dashboard.viewAll')} →</a>
            </div>
            {posts.map((p) => (
              <div className="post" key={p.title}>
                <span className="icon">{p.icon}</span>
                <div className="postTitle">
                  {p.title}
                  <small>{p.time}</small>
                </div>
                <span className="status">{t(`status.${p.status}`)}</span>
              </div>
            ))}
            <div className="note">{t('dashboard.empty')}</div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
