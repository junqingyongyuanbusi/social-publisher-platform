'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
type Membership = { workspaceId: string };
type Summary = {
  successRate: number | null;
  attention: number;
  publications: Record<string, number>;
  accounts: Record<string, number>;
  outbox: Record<string, number>;
};
type Row = {
  id: string;
  platform: string;
  status: string;
  text: string;
  createdAt: string;
  remotePostId: string | null;
  socialAccount: { displayName: string };
  attempts: { errorCode: string | null; errorClass: string | null }[];
};
type Detail = {
  id: string;
  status: string;
  remotePostId: string | null;
  remotePostUrl: string | null;
  attempts: {
    id: string;
    attemptNo: number;
    stage: string;
    status: string;
    traceId: string;
    platformRequestId: string | null;
    httpStatus: number | null;
    errorCode: string | null;
    errorClass: string | null;
    startedAt: string;
    finishedAt: string | null;
    oauthTokenVersion: { versionNo: number; status: string } | null;
  }[];
  outbox: {
    id: string;
    eventType: string;
    status: string;
    attempts: number;
    traceId: string | null;
    lastErrorCode: string | null;
    occurredAt: string;
  }[];
  audit: { id: string; action: string; actorId: string; requestId: string; createdAt: string }[];
};
export function DiagnosticsCenter() {
  const t = useTranslations('diagnostics');
  const [workspaces, setWorkspaces] = useState<Membership[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void init();
  }, []);
  async function init() {
    try {
      const w = await json<Membership[]>('/api/bff/identity/workspaces');
      setWorkspaces(w);
      if (w[0]) {
        setWorkspaceId(w[0].workspaceId);
        await load(w[0].workspaceId);
      }
    } catch (e) {
      setError(message(e));
    }
  }
  async function load(id = workspaceId) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (platform) params.set('platform', platform);
    if (query.trim()) params.set('q', query.trim());
    const [s, r] = await Promise.all([
      json<Summary>(`/api/bff/workspaces/${id}/diagnostics/summary`),
      json<Row[]>(`/api/bff/workspaces/${id}/diagnostics/publications?${params}`),
    ]);
    setSummary(s);
    setRows(r);
  }
  async function select(id: string) {
    setWorkspaceId(id);
    setDetail(null);
    await load(id);
  }
  async function open(id: string) {
    setDetail(await json(`/api/bff/workspaces/${workspaceId}/diagnostics/publications/${id}`));
  }
  return (
    <div className="diagnosticsLayout">
      <section className="card diagnosticFilters">
        <label>
          {t('workspace')}
          <select value={workspaceId} onChange={(e) => void select(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.workspaceId} value={w.workspaceId}>
                {w.workspaceId.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('platform')}
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">{t('all')}</option>
            {['X', 'FACEBOOK', 'INSTAGRAM'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          {t('status')}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('all')}</option>
            {[
              'FAILED',
              'RESULT_UNKNOWN',
              'REAUTH_REQUIRED',
              'RETRY_WAITING',
              'PUBLISHED',
              'QUEUED',
              'PUBLISHING',
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          {t('search')}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchHint')}
          />
        </label>
        <button className="button" onClick={() => void load()}>
          {t('apply')}
        </button>
      </section>
      {error ? <p className="alert errorAlert">{error}</p> : null}
      <section className="metrics">
        {[
          [
            t('successRate'),
            summary?.successRate === null
              ? '—'
              : `${Math.round((summary?.successRate ?? 0) * 100)}%`,
          ],
          [t('attention'), summary?.attention ?? 0],
          [t('published'), summary?.publications.PUBLISHED ?? 0],
          [t('outboxPending'), summary?.outbox.PENDING ?? 0],
        ].map(([label, value]) => (
          <div className="metric card" key={String(label)}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <div className="diagnosticColumns">
        <section className="card">
          <h2>{t('results')}</h2>
          {rows.map((row) => (
            <button className="diagnosticRow" key={row.id} onClick={() => void open(row.id)}>
              <span>
                <strong>
                  {row.platform} · {row.socialAccount.displayName}
                </strong>
                <small>
                  {row.id} · {new Date(row.createdAt).toLocaleString()}
                </small>
                <small>{row.text}</small>
              </span>
              <span className={`credentialStatus status-${row.status.toLowerCase()}`}>
                {row.status}
              </span>
            </button>
          ))}
        </section>
        <section className="card diagnosticDetail">
          <h2>{t('timeline')}</h2>
          {!detail ? (
            <div className="emptyState">{t('selectOne')}</div>
          ) : (
            <>
              <p>
                <strong>{detail.id}</strong>
              </p>
              <p>
                {detail.status} · {detail.remotePostId ?? '—'}
              </p>
              {detail.attempts.map((a) => (
                <article className="timelineItem" key={a.id}>
                  <strong>
                    #{a.attemptNo} {a.stage} · {a.status}
                  </strong>
                  <small>
                    {new Date(a.startedAt).toLocaleString()} · HTTP {a.httpStatus ?? '—'}
                  </small>
                  <small>
                    {a.errorClass ?? '—'} / {a.errorCode ?? '—'}
                  </small>
                  <small>
                    trace {a.traceId} · provider {a.platformRequestId ?? '—'} · token v
                    {a.oauthTokenVersion?.versionNo ?? '—'}
                  </small>
                </article>
              ))}
              {detail.outbox.map((e) => (
                <article className="timelineItem" key={e.id}>
                  <strong>OUTBOX · {e.status}</strong>
                  <small>
                    {e.eventType} · {new Date(e.occurredAt).toLocaleString()}
                  </small>
                  <small>
                    {e.lastErrorCode ?? '—'} · attempts {e.attempts}
                  </small>
                </article>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).code ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}
function message(e: unknown) {
  return e instanceof Error ? e.message : 'request_failed';
}
