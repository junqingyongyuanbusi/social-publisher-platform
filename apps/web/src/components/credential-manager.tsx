'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';

type Membership = { workspaceId: string; role: string };
type PlatformApp = {
  id: string;
  platform: string;
  name: string;
  environment: string;
  status: string;
};
type Credential = {
  id: string;
  credentialType: string;
  versionNo: number;
  status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED' | 'EXPIRED';
  maskedValue: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
};

export function CredentialManager() {
  const t = useTranslations('credentials');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [apps, setApps] = useState<PlatformApp[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [platformAppId, setPlatformAppId] = useState('');
  const [credentialType, setCredentialType] = useState('oauth_refresh_token');
  const [secret, setSecret] = useState('');
  const [scopes, setScopes] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void loadMemberships();
  }, []);

  async function loadMemberships() {
    try {
      setBusy(true);
      setError('');
      const data = await requestJson<Membership[]>('/api/bff/identity/workspaces');
      const manageable = data.filter(({ role }) => role === 'owner' || role === 'admin');
      setMemberships(manageable);
      if (manageable[0]) await chooseWorkspace(manageable[0].workspaceId);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function chooseWorkspace(id: string) {
    setWorkspaceId(id);
    setPlatformAppId('');
    setCredentials([]);
    setError('');
    try {
      const data = await requestJson<PlatformApp[]>(
        `/api/bff/workspaces/${encodeURIComponent(id)}/platform-apps`
      );
      setApps(data);
      if (data[0]) await chooseApp(id, data[0].id);
    } catch (reason) {
      setApps([]);
      setError(errorMessage(reason));
    }
  }

  async function chooseApp(workspace: string, appId: string) {
    setPlatformAppId(appId);
    setError('');
    try {
      setCredentials(await fetchCredentials(workspace, appId));
    } catch (reason) {
      setCredentials([]);
      setError(errorMessage(reason));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !platformAppId || !secret) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await requestJson<Credential>(credentialUrl(workspaceId, platformAppId), {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({
          credentialType,
          secret,
          scopes: scopes
            .split(',')
            .map((scope) => scope.trim())
            .filter(Boolean),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      setMessage(t('saved'));
      setCredentials(await fetchCredentials(workspaceId, platformAppId));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSecret('');
      setBusy(false);
    }
  }

  async function revoke(credential: Credential) {
    if (!window.confirm(t('confirmRevoke', { version: credential.versionNo }))) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await requestJson<Credential>(
        `${credentialUrl(workspaceId, platformAppId)}/${encodeURIComponent(credential.id)}`,
        { method: 'DELETE', headers: mutationHeaders() }
      );
      setMessage(t('revoked'));
      setCredentials(await fetchCredentials(workspaceId, platformAppId));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="credentialLayout">
      <section className="card credentialControls" aria-busy={busy}>
        <div className="sectionHead">
          <h2>{t('target')}</h2>
          {busy ? <span className="status">{t('loading')}</span> : null}
        </div>
        <label>
          {t('workspace')}
          <select
            value={workspaceId}
            onChange={(event) => void chooseWorkspace(event.target.value)}
          >
            {memberships.length === 0 ? <option value="">{t('noWorkspace')}</option> : null}
            {memberships.map((membership) => (
              <option key={membership.workspaceId} value={membership.workspaceId}>
                {shortId(membership.workspaceId)} · {membership.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('platformApp')}
          <select
            disabled={!workspaceId}
            value={platformAppId}
            onChange={(event) => void chooseApp(workspaceId, event.target.value)}
          >
            {apps.length === 0 ? <option value="">{t('noPlatformApp')}</option> : null}
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.platform} · {app.name} · {app.environment}
              </option>
            ))}
          </select>
        </label>

        <form onSubmit={submit}>
          <h2>{t('addOrRotate')}</h2>
          <p className="formHint">{t('rotationHint')}</p>
          <label>
            {t('type')}
            <select
              value={credentialType}
              onChange={(event) => setCredentialType(event.target.value)}
            >
              <option value="oauth_refresh_token">OAuth refresh token</option>
              <option value="oauth_access_token">OAuth access token</option>
              <option value="app_secret">App secret</option>
              <option value="api_key">API key</option>
            </select>
          </label>
          <label>
            {t('secret')}
            <input
              autoComplete="new-password"
              maxLength={65_536}
              onChange={(event) => setSecret(event.target.value)}
              required
              type="password"
              value={secret}
            />
          </label>
          <label>
            {t('scopes')}
            <input
              onChange={(event) => setScopes(event.target.value)}
              placeholder={t('scopesPlaceholder')}
              value={scopes}
            />
          </label>
          <label>
            {t('expiresAt')}
            <input
              onChange={(event) => setExpiresAt(event.target.value)}
              type="datetime-local"
              value={expiresAt}
            />
          </label>
          <button className="button" disabled={busy || !platformAppId || !secret} type="submit">
            {t('save')}
          </button>
        </form>
        <p className="securityNote">{t('securityNote')}</p>
      </section>

      <section className="card">
        <div className="sectionHead">
          <h2>{t('versions')}</h2>
          <span className="metricLabel">{t('count', { count: credentials.length })}</span>
        </div>
        <div aria-live="polite">
          {error ? <p className="alert errorAlert">{error}</p> : null}
          {message ? <p className="alert successAlert">{message}</p> : null}
        </div>
        {credentials.length === 0 ? <div className="emptyState">{t('empty')}</div> : null}
        {credentials.map((credential) => (
          <article className="credentialRow" key={credential.id}>
            <div>
              <strong>{credential.credentialType}</strong>
              <small>
                {t('version', { version: credential.versionNo })} · {credential.maskedValue}
              </small>
              <small>
                {credential.scopes.length ? credential.scopes.join(', ') : t('noScopes')}
              </small>
              <small>
                {t('created')} {formatDate(credential.createdAt)}
                {credential.expiresAt
                  ? ` · ${t('expires')} ${formatDate(credential.expiresAt)}`
                  : ''}
              </small>
            </div>
            <div className="credentialActions">
              <span className={`credentialStatus status-${credential.status.toLowerCase()}`}>
                {t(`status.${credential.status}`)}
              </span>
              {credential.status === 'ACTIVE' ? (
                <button
                  className="dangerButton"
                  disabled={busy}
                  onClick={() => void revoke(credential)}
                  type="button"
                >
                  {t('revoke')}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function credentialUrl(workspaceId: string, platformAppId: string): string {
  return `/api/bff/workspaces/${encodeURIComponent(workspaceId)}/platform-apps/${encodeURIComponent(platformAppId)}/credentials`;
}

function fetchCredentials(workspaceId: string, platformAppId: string): Promise<Credential[]> {
  return requestJson<Credential[]>(credentialUrl(workspaceId, platformAppId));
}

function mutationHeaders(): HeadersInit {
  return { 'content-type': 'application/json', 'x-csrf-token': cookie('sp_csrf') };
}

function cookie(name: string): string {
  const item = document.cookie.split('; ').find((value) => value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      detail?: string;
      title?: string;
    } | null;
    throw new Error(problem?.detail ?? problem?.title ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Unexpected error';
}

function shortId(value: string): string {
  return `${value.slice(0, 8)}…`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}
