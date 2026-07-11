'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
type Membership = { workspaceId: string };
type Publication = {
  id: string;
  platform: string;
  status: string;
  text: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  remotePostUrl: string | null;
  createdAt: string;
  socialAccount: { displayName: string; username: string | null };
  attempts: {
    id: string;
    attemptNo: number;
    status: string;
    errorCode: string | null;
    errorClass: string | null;
    platformRequestId: string | null;
  }[];
};
export function PublicationManager() {
  const t = useTranslations('publications');
  const [workspaceId, setWorkspaceId] = useState('');
  const [items, setItems] = useState<Publication[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void init();
  }, []);
  async function init() {
    try {
      const w = await json<Membership[]>('/api/bff/identity/workspaces');
      if (w[0]) {
        setWorkspaceId(w[0].workspaceId);
        await load(w[0].workspaceId);
      }
    } catch (e) {
      setError(msg(e));
    }
  }
  async function load(w = workspaceId) {
    setItems(await json(`/api/bff/workspaces/${w}/publications`));
  }
  async function action(id: string, a: 'cancel' | 'retry') {
    try {
      await json(`/api/bff/workspaces/${workspaceId}/publications/${id}/${a}`, {
        method: 'POST',
        headers: headers(),
      });
      await load();
    } catch (e) {
      setError(msg(e));
    }
  }
  return (
    <section className="card">
      <div className="sectionHead">
        <h2>{t('recent')}</h2>
        <button className="button" onClick={() => void load()}>
          {t('refresh')}
        </button>
      </div>
      {error ? <p className="alert errorAlert">{error}</p> : null}
      {items.length === 0 ? (
        <div className="emptyState">{t('empty')}</div>
      ) : (
        items.map((p) => (
          <article className="credentialRow" key={p.id}>
            <div>
              <strong>
                {p.platform} · {p.socialAccount.displayName}
              </strong>
              <small>{p.text}</small>
              <small>
                {new Date(p.createdAt).toLocaleString()} ·{' '}
                {p.attempts[0]?.errorCode ?? t('noError')}
              </small>
              {p.remotePostUrl ? (
                <a href={p.remotePostUrl} target="_blank" rel="noreferrer">
                  {t('openRemote')}
                </a>
              ) : null}
            </div>
            <div className="credentialActions">
              <span className={`credentialStatus status-${p.status.toLowerCase()}`}>
                {p.status}
              </span>
              {['SCHEDULED', 'QUEUED', 'RETRY_WAITING'].includes(p.status) ? (
                <button className="dangerButton" onClick={() => void action(p.id, 'cancel')}>
                  {t('cancel')}
                </button>
              ) : null}
              {['FAILED', 'REAUTH_REQUIRED', 'RETRY_WAITING'].includes(p.status) ? (
                <button className="button" onClick={() => void action(p.id, 'retry')}>
                  {t('retry')}
                </button>
              ) : null}
            </div>
          </article>
        ))
      )}
    </section>
  );
}
async function json<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).code ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}
function headers() {
  const token =
    document.cookie
      .split('; ')
      .find((v) => v.startsWith('social_csrf='))
      ?.split('=')[1] ?? '';
  return { 'x-csrf-token': decodeURIComponent(token) };
}
function msg(e: unknown) {
  return e instanceof Error ? e.message : 'request_failed';
}
