'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
type Membership = { workspaceId: string; role: string };
type Account = {
  id: string;
  platform: string;
  displayName: string;
  username: string | null;
  status: string;
};
export function Composer() {
  const t = useTranslations('compose');
  const locale = useLocale();
  const [workspaces, setWorkspaces] = useState<Membership[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [altText, setAltText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void init();
  }, []);
  async function init() {
    try {
      const rows = (await json<Membership[]>('/api/bff/identity/workspaces')).filter(
        (x) => x.role !== 'viewer'
      );
      setWorkspaces(rows);
      if (rows[0]) await select(rows[0].workspaceId);
    } catch (e) {
      setError(msg(e));
    }
  }
  async function select(id: string) {
    setWorkspaceId(id);
    const rows = await json<Account[]>(`/api/bff/workspaces/${id}/social-accounts`);
    const active = rows.filter(
      (x) => x.status === 'ACTIVE' && ['X', 'FACEBOOK', 'INSTAGRAM'].includes(x.platform)
    );
    setAccounts(active);
    setAccountId(active[0]?.id ?? '');
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || !accountId || !text.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const media: { mediaAssetId: string; position: number; altText: string | null }[] = [];
      for (const [position, file] of images.entries()) {
        const form = new FormData();
        form.set('file', file);
        if (altText) form.set('altText', altText);
        const asset = await json<{ id: string }>(
          `/api/bff/workspaces/${workspaceId}/media-assets`,
          { method: 'POST', headers: csrfHeader(), body: form }
        );
        media.push({ mediaAssetId: asset.id, position, altText: altText || null });
      }
      const content = await json<{ versions: { id: string }[] }>(
        `/api/bff/workspaces/${workspaceId}/contents`,
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ title: title || text.slice(0, 60), body: text, locale }),
        }
      );
      const account = accounts.find((x) => x.id === accountId);
      await json(`/api/bff/workspaces/${workspaceId}/publications`, {
        method: 'POST',
        headers: { ...headers(), 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          contentVersionId: content.versions[0]!.id,
          accountId,
          text,
          contentLocale: locale,
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
          media,
          settings:
            account!.platform === 'FACEBOOK'
              ? { platform: 'facebook', postType: media.length ? 'photo' : 'feed' }
              : account!.platform === 'INSTAGRAM'
                ? { platform: 'instagram', postType: 'feed' }
                : { platform: 'x' },
        }),
      });
      setMessage(t('created'));
      setTitle('');
      setText('');
      setScheduledAt('');
      setImages([]);
      setAltText('');
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card credentialControls" onSubmit={submit}>
      <label>
        {t('workspace')}
        <select value={workspaceId} onChange={(e) => void select(e.target.value)}>
          {workspaces.map((w) => (
            <option key={w.workspaceId} value={w.workspaceId}>
              {w.workspaceId.slice(0, 8)} · {w.role}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('account')}
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.length ? (
            accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.platform} · {a.displayName}
              </option>
            ))
          ) : (
            <option value="">{t('noAccount')}</option>
          )}
        </select>
      </label>
      <label>
        {t('contentTitle')}
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
      </label>
      <label>
        {t('text')}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={280}
          rows={8}
          required
        />
      </label>
      <label>
        {t('schedule')}
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
      </label>
      <label>
        {t('images')}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) =>
            setImages(
              Array.from(e.target.files ?? []).slice(
                0,
                accounts.find((account) => account.id === accountId)?.platform === 'X' ? 4 : 1
              )
            )
          }
        />
      </label>
      {images.length ? (
        <>
          <small>{t('imageCount', { count: images.length })}</small>
          <label>
            {t('altText')}
            <input
              value={altText}
              maxLength={1000}
              onChange={(e) => setAltText(e.target.value)}
              placeholder={t('altPlaceholder')}
            />
          </label>
        </>
      ) : null}
      {error ? <p className="alert errorAlert">{error}</p> : null}
      {message ? <p className="alert successAlert">{message}</p> : null}
      <button className="button" disabled={busy || !accountId || !text.trim()}>
        {busy ? t('saving') : t('publish')}
      </button>
    </form>
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
  return { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(token) };
}
function csrfHeader() {
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
