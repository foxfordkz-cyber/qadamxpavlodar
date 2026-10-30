import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useData, type SvcState } from '../../shared/api/DataProvider';
import { useSession } from '../../shared/api/useSession';
import { ApiError } from '../../shared/api/transport';
import { Button, ErrorNote, Field, StateView, useGuarded } from '../../shared/ui/components';
import { t, type Key } from '../../shared/i18n';
import { LanguageSwitcher } from '../../shared/i18n/LanguageSwitcher';
import { fmtDate } from '../../shared/format';
import { hrefFor, navigate, useRoute } from '../../shared/router';

const DevPanel = lazy(() => import('./DevPanel').then((m) => ({ default: m.DevPanel })));
const WorkerPage = lazy(() => import('../worker/WorkerPage').then((m) => ({ default: m.WorkerPage })));

import { MeContext } from './me';
import { AssistantPanel } from './tz/AssistantPanel';
import type { Role } from '../../shared/api/types';

// Навигация по роли. Права всё равно проверяет сервер; меню лишь не показывает лишнего.
const ALL: Role[] = ['coordinator', 'admin', 'viewer'];
// Сначала разделы ТЗ, затем «Работы» (дополнительный функционал по инициативе команды).
const NAV: { path: string; key: Key; roles: Role[]; works?: boolean }[] = [
  { path: '/', key: 'nav.home', roles: ALL },
  { path: '/map', key: 'nav.map', roles: ALL },
  { path: '/problems', key: 'nav.problems', roles: ALL },
  { path: '/priorities', key: 'nav.priorities', roles: ALL },
  { path: '/lab', key: 'nav.lab', roles: ALL },
  { path: '/species', key: 'nav.species', roles: ALL },
  { path: '/projects', key: 'nav.projects', roles: ALL },
  { path: '/rates', key: 'nav.rates', roles: ALL },
  { path: '/import', key: 'nav.import', roles: ['coordinator', 'admin'] },
  { path: '/guide', key: 'nav.guide', roles: ALL },
  { path: '/tasks', key: 'nav.tasks', roles: ['coordinator', 'admin'], works: true },
  { path: '/reports', key: 'nav.reports', roles: ['coordinator', 'admin'], works: true },
  { path: '/approval', key: 'nav.approval', roles: ['admin'], works: true },
  { path: '/people', key: 'nav.people', roles: ['admin'], works: true },
];

const SVC_ICON: Record<SvcState, string> = { ok: '●', down: '✕', unknown: '○' };

export function Shell({ children }: { children: ReactNode }) {
  const { api, mode, services } = useData();
  const route = useRoute();
  const me = useSession();
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const { run: runLogout, busy: loggingOut } = useGuarded();
  const [dev, setDev] = useState(false);
  const [today, setToday] = useState(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setToday(new Date().toISOString()), 60000);
    return () => clearInterval(id);
  }, []);

  const authError = me.error instanceof ApiError ? me.error.status : null;
  const user = me.data;
  const role = user?.role;
  const crew = role === 'foreman' || role === 'worker';
  // Бригадир и работник работают только в своём кабинете — держим их на маршруте #/worker, остальных уводим с него.
  useEffect(() => {
    if (crew && route.path !== '/worker') navigate('/worker', {}, true);
    else if (role && !crew && route.path === '/worker') navigate('/', {}, true);
  }, [crew, role, route.path]);
  const logout = () => runLogout(async () => {
    setLogoutError(null);
    try {
      if (mode === 'api') {
        const { createV2Transport } = await import('../worker/contract-v2.mjs');
        await createV2Transport({ csrfToken: me.data?.csrfToken })('POST', '/auth/logout', { body: {} });
      } else await api.logout();
      me.clear();
    } catch (error) {
      // The worker transport has its own error class with the same HTTP status.
      if ((error as { status?: number } | null)?.status === 401) me.clear();
      else setLogoutError(error);
    }
  });
  const nav = NAV.filter((n) => role && n.roles.includes(role));
  const current = (path: string) => (path === '/' ? route.path === '/' || route.path === '' : route.path.startsWith(path));
  return (
    <div className="gp-app">
      <a href="#main" className="gp-skip" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{t('shell.skip')}</a>
      <header className="gp-header">
        <a className="gp-brand" href={hrefFor('/')}><span className="gp-brand__logo" aria-hidden="true">❦</span><span>{t('app.title')}</span></a>
        <nav className="gp-nav" aria-label={t('nav.label')}>
          {nav.filter((n) => !n.works).map((n) => <a key={n.path} href={hrefFor(n.path)} aria-current={current(n.path) ? 'page' : undefined}>{t(n.key)}</a>)}
          {nav.some((n) => n.works) && <span className="gp-nav__sep" aria-hidden="true">{t('nav.works')}:</span>}
          {nav.filter((n) => n.works).map((n) => <a key={n.path} className="gp-nav__works" href={hrefFor(n.path)} aria-current={current(n.path) ? 'page' : undefined}>{t(n.key)}</a>)}
        </nav>
        <div className="gp-header__right">
          {user && <span className="gp-small">{user.displayName}</span>}
          {mode === 'mock' && <Button onClick={() => setDev(true)}>⚙ {t('shell.devPanel')}</Button>}
          <LanguageSwitcher />
          {user && <Button onClick={logout} busy={loggingOut}>{t('shell.logout')}</Button>}
        </div>
      </header>
      <div className="gp-subbar">
        <dl className="gp-status-row">
          <div className="gp-kv"><dt>{t('shell.role')}</dt><dd>{user ? <>{t(`shell.role.${user.role}` as Key)}{user.isDemoAccount && <> <span className="gp-badge gp-badge--demo">{t('shell.demoAccount')}</span></>}</> : '—'}</dd></div>
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
        {user && <ErrorNote error={logoutError} />}
        {me.unauthenticated ? (
          <Login onDone={me.reload} />
        ) : authError === 403 ? (
          <Forbidden />
        ) : me.data && crew ? (
          <Suspense fallback={null}><WorkerPage me={me.data} onLogout={logout} /></Suspense>
        ) : (
          <StateView loading={me.loading} error={me.error} hasData={!!me.data} onRetry={me.reload}>
            {me.data && <MeContext.Provider value={me.data}>{children}<AssistantPanel /></MeContext.Provider>}
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
