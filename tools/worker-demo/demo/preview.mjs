import '../../../apps/web/src/features/worker/worker.mjs';
import { ROLE_LABELS } from '../../../apps/web/src/features/worker/contract-v2.mjs';
import { BrowserDrafts } from '../../../apps/web/src/features/worker/drafts.mjs';
import { normalizeWorkerLocale } from '../../../apps/web/src/features/worker/worker-display.mjs';
import { createDemoSource, accounts, DEMO_DATE, DEMO_SCOPE } from './source.mjs';
const source = createDemoSource({ storage: localStorage });
const drafts = new BrowserDrafts();
const worker = document.querySelector('green-worker');
const $ = selector => document.querySelector(selector);
// The standalone test harness shares the shell's preference; locale repaint must
// not reconnect a session or discard a report that is being edited.
const languageQuery = new URLSearchParams(location.search).get('lang');
let storedLanguage;
try { storedLanguage = localStorage.getItem('gp.language'); } catch { /* Optional storage. */ }
$('#locale').value = normalizeWorkerLocale(languageQuery || storedLanguage);
function changeLanguage() {
  const language = $('#locale').value;
  try { localStorage.setItem('gp.language', language); } catch { /* Optional storage. */ }
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) { url.searchParams.set('lang', language); history.replaceState(history.state, '', url); }
  document.documentElement.lang = language;
  worker.setLocale(language);
}
changeLanguage();
$('#account').replaceChildren(...accounts.map(account=>new Option(`${account.displayName} · ${ROLE_LABELS[account.role]}`,account.id)));
let userId = sessionStorage.getItem(`${DEMO_SCOPE}:user`) || 'demo-foreman-1';
if (!accounts.some(account => account.id === userId)) userId = accounts[0].id;
$('#account').value = userId;
async function connect() {
  userId = $('#account').value; sessionStorage.setItem(`${DEMO_SCOPE}:user`, userId);
  await worker.configure({ gateway: source.apiFor(userId), user: accounts.find(account => account.id === userId), scope: DEMO_SCOPE, date: DEMO_DATE, demo: true, locale: $('#locale').value, drafts });
  updateTools();
}
function updateTools() {
  const { calls, notifications, registry, tasks } = source.snapshot();
  $('#demo-stats').textContent = `Загрузок: ${calls.uploads} · материалов: ${calls.contributions} · итогов: ${calls.reports} · проблем: ${calls.issues} · фактических растений: ${registry.length}`;
  const selectedReview=$('#review-task').value;
  $('#review-task').replaceChildren(...tasks.filter(t=>t.latestReportId).map(t=>new Option(`${t.id} · ${t.status}`,t.id)));
  if(selectedReview)$('#review-task').value=selectedReview;
  $('#demo-notifications').textContent = notifications.length ? `Уведомления координатора:\n${notifications.map(n => `${n.taskId}: ${n.reason} — ${n.note}`).join('\n')}` : 'Уведомлений координатора пока нет.';
  document.querySelectorAll('[data-fault]').forEach(input => { input.checked = source.controls[input.dataset.fault]; });
}
async function guarded(fn) { try { await fn(); $('#tool-message').textContent = ''; } catch (error) { $('#tool-message').textContent = error.message; } updateTools(); }
$('#account').addEventListener('change', () => guarded(connect));
$('#login').addEventListener('click', () => guarded(connect));
$('#locale').addEventListener('change', changeLanguage);
document.querySelectorAll('[data-fault]').forEach(input => input.addEventListener('change', () => { source.controls[input.dataset.fault] = input.checked; updateTools(); }));
window.addEventListener('offline', () => { source.controls.offline = true; updateTools(); });
window.addEventListener('online', () => { source.controls.offline = false; updateTools(); });
source.controls.offline = !navigator.onLine;
for (const [id, action] of [['return-report', 'return'], ['accept-report', 'accept']]) $("#" + id).addEventListener('click', () => guarded(async () => {
  const state=source.snapshot(), task=state.tasks.find(t=>t.id===$('#review-task').value),report=state.reports.find(r=>r.id===task?.latestReportId);
  if(!report)throw new Error('Выберите отправленный отчёт.');
  await source.transportFor(userId)('POST',`/reports/${report.id}/review`,{body:{expectedVersion:report.version,decision:action==='accept'?'accepted':'changes_requested',comment:$('#review-comment').value},headers:{'Idempotency-Key':crypto.randomUUID()}});
  await worker.refresh(false);
}));
$('#reset-demo').addEventListener('click', () => guarded(async () => {
  source.reset();
  for (const account of accounts) for (const draft of await drafts.list(DEMO_SCOPE, account.id)) await drafts.remove(draft.storageKey);
  await connect();
}));
worker.addEventListener('worker-busy', event => { document.querySelectorAll('.tools-body button,.tools-body select').forEach(input => { input.disabled = event.detail; }); updateTools(); });
worker.addEventListener('worker-logout', () => { sessionStorage.removeItem(`${DEMO_SCOPE}:user`); $('#demo-tools').open = true; });
window.addEventListener('storage', event => { if (event.key === DEMO_SCOPE) $('#tool-message').textContent = 'Демо-набор изменён в другой вкладке. Перезагрузите эту вкладку; один стенд рассчитан на одну активную вкладку.'; });
// QA hooks exist only in demo/. Do not ship demo/ with the production component.
window.__greenDemo = { source, worker, drafts, connect, updateTools, ready: false };
await connect(); window.__greenDemo.ready = true;
