import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useData, useResource, type SvcState } from '../../shared/api/DataProvider';
import { ApiError } from '../../shared/api/transport';
import { Button, ErrorNote, Field, StateView, useGuarded } from '../../shared/ui/components';
import { t, type Key } from '../../shared/i18n';
import { fmtDate } from '../../shared/format';
import { hrefFor, useRoute } from '../../shared/router';

const DevPanel = lazy(() => import('./DevPanel').then((m) => ({ default: m.DevPanel })));

import { MeContext } from './me';
import type { Me, Role } from '../../shared/api/types';

// Навигация по роли. Права всё равно проверяет сервер; меню лишь не показывает лишнего.
const NAV: { path: string; key: Key; roles: Role[] }[] = [
  { path: '/', key: 'nav.home', roles: ['coordinator', 'admin'] },
  { path: '/map', key: 'nav.map', roles: ['coordinator', 'admin'] },
  { path: '/projects', key: 'nav.projects', roles: ['coordinator', 'admin'] },
  { path: '/approval', key: 'nav.approval', roles: ['admin'] },
  { path: '/tasks', key: 'nav.tasks', roles: ['coordinator', 'admin'] },
  { path: '/reports', key: 'nav.reports', roles: ['coordinator', 'admin'] },
  { path: '/ranking', key: 'nav.ranking', roles: ['coordinator', 'admin'] },
  { path: '/species', key: 'nav.species', roles: ['coordinator', 'admin'] },
  { path: '/guide', key: 'nav.guide', roles: ['coordinator', 'admin'] },
  { path: '/people', key: 'nav.people', roles: ['admin'] },
];

const SVC_ICON: Record<SvcState, string> = { ok: '●', down: '✕', unknown: '○' };

export function Shell({ children }: { children: ReactNode }) {
  const { api, mode, services } = useData();
  const route = useRoute();
  const me = useResource(() => api.me(), []);
  const [dev, setDev] = useState(false);
  const [today, setToday] = useState(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setToday(new Date().toISOString()), 60000);
    return () => clearInterval(id);
  }, []);

  const authError = me.error instanceof ApiError ? me.error.status : null;
  const role = me.data?.role;
  const nav = NAV.filter((n) => role && n.roles.includes(role));
  const current = (path: string) => (path === '/' ? route.path === '/' || route.path === '' : route.path.startsWith(path));
  return (
    <div className="gp-app">
      <a href="#main" className="gp-skip" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{t('shell.skip')}</a>
      <header className="gp-header">
        <a className="gp-brand" href={hrefFor('/')}><span className="gp-brand__logo" aria-hidden="true">❦</span><span>{t('app.title')}</span></a>
        <nav className="gp-nav" aria-label={t('nav.label')}>
          {nav.map((n) => <a key={n.path} href={hrefFor(n.path)} aria-current={current(n.path) ? 'page' : undefined}>{t(n.key)}</a>)}
        </nav>
        <div className="gp-header__right">
          {me.data && <span className="gp-small">{me.data.displayName}</span>}
          {mode === 'mock' && <Button onClick={() => setDev(true)}>⚙ {t('shell.devPanel')}</Button>}
          {me.data && <Button onClick={async () => { try { await api.logout(); } finally { me.reload(); } }}>{t('shell.logout')}</Button>}
        </div>
      </header>
      <div className="gp-subbar">
        <dl className="gp-status-row">
          <div className="gp-kv"><dt>{t('shell.role')}</dt><dd>{me.data ? <>{t(`shell.role.${me.data.role}` as Key)}{me.data.isDemoAccount && <> <span className="gp-badge gp-badge--demo">{t('shell.demoAccount')}</span></>}</> : '—'}</dd></div>
          <div className="gp-kv"><dt>{t('shell.today')}</dt><dd>{fmtDate(today)} (UTC+5)</dd></div>
          <div className="gp-kv"><dt>{t('shell.data')}</dt><dd><span className={`gp-badge ${mode === 'mock' ? 'gp-badge--demo' : 'gp-badge--info'}`}>{t(mode === 'mock' ? 'shell.data.mock' : 'shell.data.api')}</span></dd></div>
          <div className="gp-kv gp-svcs"><dt>{t('shell.services')}</dt>
            {(['api', 'ai', 'map'] as const).map((s) => (
              <dd key={s} className={`gp-svc gp-svc--${services[s]}`}><span aria-hidden="true">{SVC_ICON[services[s]]}</span> {t(`shell.svc.${s}` as Key)}: {t(`shell.svc.${services[s] === 'ok' ? 'ok' : services[s] === 'down' ? 'down' : 'unknown'}` as Key)}</dd>
            ))}
          </div>
        </dl>
      </div>
      <main id="main" className="gp-main" tabIndex={-1}>
        {authError === 401 ? (
          <Login onDone={me.reload} />
        ) : authError === 403 ? (
          <Forbidden />
        ) : me.data && (me.data.role === 'foreman' || me.data.role === 'worker') ? (
          <OtherCabinet me={me.data} />
        ) : (
          <StateView loading={me.loading} error={me.error} hasData={!!me.data} onRetry={me.reload}>
            {me.data && <MeContext.Provider value={me.data}>{children}</MeContext.Provider>}
          </StateView>
        )}
      </main>
      {mode === 'mock' && dev && <Suspense fallback={null}><DevPanel open={dev} onClose={() => setDev(false)} onAuthChange={me.reload} /></Suspense>}
    </div>
  );
}

const Forbidden = () => (
  <div className="gp-page"><div className="gp-state gp-state--error" role="alert"><span className="gp-state__icon" aria-hidden="true">🔒</span>{t('state.forbidden')}</div></div>
);

/** Бригадир и работник работают в своих кабинетах (участник 4); сюда им доступа нет. */
function OtherCabinet({ me }: { me: Me }) {
  return (
    <div className="gp-page">
      <div className="gp-card gp-other">
        <p className="gp-eyebrow">{t(`shell.role.${me.role}` as Key)}</p>
        <h1 className="gp-h1">{t('shell.otherCabinet.title')}</h1>
        <p>{t('shell.otherCabinet.text')}</p>
        <a className="gp-btn gp-btn--primary" href="#/worker">{t('shell.otherCabinet.link')}</a>
      </div>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const { api, mode } = useData();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const { run, busy } = useGuarded();
  return (
    <div className="gp-page">
      <form className="gp-card gp-login" onSubmit={(e) => { e.preventDefault(); run(async () => { setError(null); try { await api.login(login, password); onDone(); } catch (err) { setError(err); } }); }}>
        <h1 className="gp-h1">{t('login.title')}</h1>
        <Field label={t('login.login')} required>{(id) => <input id={id} className="gp-input" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} />}</Field>
        <Field label={t('login.password')} required>{(id) => <input id={id} className="gp-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {mode === 'mock' && <p className="gp-small gp-muted">{t('login.mockHint')}</p>}
        <ErrorNote error={error} />
        <Button variant="primary" type="submit" busy={busy}>{t('login.submit')}</Button>
      </form>
    </div>
  );
}
