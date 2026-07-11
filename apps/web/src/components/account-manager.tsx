'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type Membership = { workspaceId: string; role: string };
type App = { id: string; platform: string; name: string; status: string };
type Account = {
  id: string;
  platform: string;
  displayName: string;
  username: string | null;
  status: string;
  platformApp: { id: string; name: string };
  oauthConnection: {
    id: string;
    status: string;
    grantedScopes: string[];
    updatedAt: string;
  } | null;
};

export function AccountManager() {
  const t = useTranslations('accounts');
  const locale = useLocale();
  const [workspaceId, setWorkspaceId] = useState('');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void initialize();
  }, []);
  async function initialize() {
    try {
      setBusy(true);
      const rows = (await json<Membership[]>('/api/bff/identity/workspaces')).filter((x) =>
        ['owner', 'admin'].includes(x.role)
      );
      setMemberships(rows);
      if (rows[0]) await select(rows[0].workspaceId);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function select(id: string) {
    setWorkspaceId(id);
    setError('');
    try {
      const [a, c] = await Promise.all([
        json<App[]>(`/api/bff/workspaces/${id}/platform-apps`),
        json<Account[]>(`/api/bff/workspaces/${id}/social-accounts`),
      ]);
      setApps(a);
      setAccounts(c);
    } catch (e) {
      setError(message(e));
    }
  }
  async function connect(appId: string) {
    try {
      setBusy(true);
      const result = await json<{ authorizationUrl: string }>(
        `/api/bff/workspaces/${workspaceId}/platform-apps/${appId}/oauth/connect`,
        {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify({ returnTo: `/${locale}/accounts` }),
        }
      );
      window.location.assign(result.authorizationUrl);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  async function disconnect(id: string) {
    if (!confirm(t('confirmDisconnect'))) return;
    try {
      setBusy(true);
      await json(`/api/bff/workspaces/${workspaceId}/oauth-connections/${id}`, {
        method: 'DELETE',
        headers: mutationHeaders(),
      });
      await select(workspaceId);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="credentialLayout">
      <section className="card credentialControls" aria-busy={busy}>
        <h2>{t('workspace')}</h2>
        <select value={workspaceId} onChange={(e) => void select(e.target.value)}>
          {memberships.map((m) => (
            <option key={m.workspaceId} value={m.workspaceId}>
              {m.workspaceId.slice(0, 8)} · {m.role}
            </option>
          ))}
        </select>
        <h2>{t('connect')}</h2>
        {apps
          .filter((a) => a.status === 'ACTIVE')
          .map((app) => (
            <div className="credentialRow" key={app.id}>
              <div>
                <strong>{app.platform}</strong>
                <small>{app.name}</small>
              </div>
              <button className="button" disabled={busy} onClick={() => void connect(app.id)}>
                {t('authorizePlatform', { platform: app.platform })}
              </button>
            </div>
          ))}
      </section>
      <section className="card">
        <div className="sectionHead">
          <h2>{t('connected')}</h2>
          <span>{accounts.length}</span>
        </div>
        {error ? <p className="alert errorAlert">{error}</p> : null}
        {accounts.length === 0 ? <div className="emptyState">{t('empty')}</div> : null}
        {accounts.map((a) => (
          <article className="credentialRow" key={a.id}>
            <div>
              <strong>
                {a.platform} · {a.displayName}
              </strong>
              <small>
                {a.username ? `@${a.username} · ` : ''}
                {a.platformApp.name}
              </small>
              <small>{a.oauthConnection?.grantedScopes.join(', ')}</small>
            </div>
            <div className="credentialActions">
              <span className={`credentialStatus status-${a.status.toLowerCase()}`}>
                {a.status}
              </span>
              {a.oauthConnection?.status === 'ACTIVE' ? (
                <button
                  className="dangerButton"
                  disabled={busy}
                  onClick={() => void disconnect(a.oauthConnection!.id)}
                >
                  {t('disconnect')}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
async function json<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).code ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}
function mutationHeaders() {
  const token =
    document.cookie
      .split('; ')
      .find((v) => v.startsWith('social_csrf='))
      ?.split('=')[1] ?? '';
  return { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(token) };
}
function message(e: unknown) {
  return e instanceof Error ? e.message : 'request_failed';
}
