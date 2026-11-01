import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createApiConnection, isConnectionFailure } from '../api/connection';
import { t } from '../i18n';
import { Button } from './components';

/** Recovery is separate from page data: a temporary outage must not unmount the worker's draft. */
export function ApiConnectionNotice({ enabled, loading, hasUser, error, disconnected, onReady }:
  { enabled: boolean; loading: boolean; hasUser: boolean; error: unknown; disconnected: boolean; onReady: () => void | Promise<void> }) {
  const connection = useMemo(() => createApiConnection(), []);
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
  const ready = useRef(onReady);
  useEffect(() => { ready.current = onReady; }, [onReady]);
  const outage = enabled && (disconnected || isConnectionFailure(error));
  useEffect(() => {
    let alive = true;
    if (outage) void connection.start().then(ok => { if (ok && alive) void ready.current(); });
    return () => { alive = false; connection.cancel(); };
  }, [connection, outage]);

  if (!enabled || !outage && !(loading && !hasUser)) return null;
  const checking = outage && state.phase === 'connecting';
  const initial = !outage && loading && !hasUser;
  const restoring = state.phase === 'ready' && loading;
  const cancelled = state.phase === 'cancelled';
  const mock = new URL(window.location.href);
  mock.searchParams.set('source', 'mock');
  // Keep locale, drop a private API task route: mock has its own independent data.
  mock.hash = '#/';
  const retry = () => { void connection.start().then(ok => { if (ok) void ready.current(); }); };
  return <section className="gp-card" aria-label={t('connection.title')}>
    <div role="status" aria-live="polite">
      <strong>{t(initial ? 'connection.initial' : checking ? 'connection.starting' : cancelled ? 'connection.cancelled' : restoring ? 'connection.restoring' : 'connection.unavailable')}</strong>
      <p>{t(initial ? 'connection.initialDetail' : checking ? 'connection.checkingDetail' : restoring ? 'connection.restoringDetail' : 'connection.unavailableDetail')}</p>
      {checking && <p>{t('connection.attempt', { current: state.attempt, total: state.maxAttempts })}</p>}
      {hasUser && <p>{t('connection.draftKept')}</p>}
    </div>
    <div className="gp-btn-row">
      {checking ? <Button onClick={connection.cancel}>{t('connection.cancel')}</Button> : !initial && <Button onClick={retry}>{t('connection.retry')}</Button>}
      <a className="gp-btn gp-btn--secondary" href={mock.pathname + mock.search + mock.hash}>{t('connection.mock')}</a>
    </div>
    <p className="gp-small gp-muted">{t('connection.mockDetail')}</p>
  </section>;
}
