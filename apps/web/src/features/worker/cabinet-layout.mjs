import { icon } from './icons.mjs';
import { clockTime, ROLE_LABELS } from './contract-v2.mjs';
import { crewSummary } from './v2-views.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function navigation(app) {
  const t = app.t;
  return [['tasks', t.shiftNav], ['history', t.journalNav], ['profile', t.profile]].map(([id, label], index) => `
    <button type="button" data-action="nav" data-id="${id}" class="${app.page === id ? 'active' : ''}" ${app.page === id ? 'aria-current="page"' : ''}>
      <span class="nav-index" aria-hidden="true">0${index + 1}</span><span>${e(label)}</span>
    </button>`).join('');
}

export function taskRow(app, task, index) {
  const t = app.t;
  return `<button type="button" data-action="select" data-id="${e(task.id)}" class="task task-${e(task.section)}" aria-label="${e(task.place + '. ' + task.action + '. ' + task.statusLabel)}">
    <span class="task-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
    <span class="task-time"><strong>${e(task.scheduledStart ? clockTime(task.scheduledStart) : '—')}</strong><small>${e(t.scheduledStart)}</small></span>
    <span class="task-description"><span class="task-code">${e(task.id)}${task.priorityTone === 'high' ? `<span class="priority high">${e(task.priority)}</span>` : ''}</span>
      <span class="task-place">${e(task.place)}</span><span class="task-action">${e(task.action)}</span>
    </span>
    <span class="task-state">${app.badge(task)}<span class="task-deadline">${e(task.due)}</span>${task.minWorkers > 1 ? `<span class="task-team">${e(t.assignedPeople)}: ${task.assignedWorkerIds.length} / ${task.minWorkers}</span>` : ''}</span>
    <span class="task-arrow" aria-hidden="true">${icon('arrow')}</span>
  </button>`;
}

function dateBlock(app) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(app.date || '') ? new Date(`${app.date}T12:00:00+05:00`) : null;
  const valid = date && Number.isFinite(date.getTime());
  const locale = app.locale === 'kk-draft' ? 'kk' : 'ru';
  const month = valid ? new Intl.DateTimeFormat(locale, {month:'long', timeZone:'Asia/Qyzylorda'}).format(date) : '—';
  const weekday = valid ? new Intl.DateTimeFormat(locale, {weekday:'long', timeZone:'Asia/Qyzylorda'}).format(date) : '';
  return `<div class="date-block" aria-label="${e(app.t.today)}"><strong>${valid ? e(app.date.slice(8,10)) : '—'}</strong><div><span>${e(month)}</span><small>${e(weekday)}</small><small>UTC +05</small></div></div>`;
}

function heading(app) {
  const t = app.t;
  const title = app.page === 'tasks' ? (app.user.role === 'foreman' ? t.crewShift : t.personalShift) : app.page === 'history' ? t.journalTitle : t.profileTitle;
  return `<header class="page-heading">
    <div class="heading-copy"><p class="eyebrow"><span class="registration-mark" aria-hidden="true">+</span> ${e(t.fieldOffice)}</p><h1 tabindex="-1">${e(title)}</h1><p class="subhead">${e(app.page === 'tasks' ? t.shiftDescription : app.page === 'history' ? t.journalDescription : t.profileDescription)}</p></div>
    <div class="shift-stamp">${dateBlock(app)}</div><div class="date-tools"><label for="shift-date"><span>${e(t.today)}</span><input id="shift-date" data-field="date" type="date" value="${e(app.date)}"></label><button type="button" class="icon-button" data-action="refresh" aria-label="${e(t.refresh)}" ${app.loading || app.busy ? 'disabled' : ''}>${icon('refresh')}</button></div>
  </header>`;
}

function list(app) {
  const t = app.t;
  const count = section => app.tasks.filter(task => task.section === section).length;
  const tasks = app.tasks.filter(task => task.section === app.section);
  return `<section class="list-pane" aria-label="${e(t.tasksLabel)}">
    <div class="list-heading"><h2>${e(t.workRegister)}</h2><span>${e(t.totalLabel)} / <strong>${app.tasks.length}</strong></span></div>
    <div class="tabs" role="group" aria-label="${e(t.tasksLabel)}">${['current','submitted','confirmed'].map(section => `<button type="button" data-action="tab" data-id="${section}" class="${app.section === section ? 'active' : ''}" aria-pressed="${app.section === section}">${e(t[section])}<span>${String(count(section)).padStart(2,'0')}</span></button>`).join('')}</div>
    <div class="register-columns" aria-hidden="true"><span>№</span><span>${e(t.scheduledStart)}</span><span>${e(t.placeAndWork)}</span><span>${e(t.statusAndDue)}</span><span>↗</span></div>
    <div class="task-list">${app.loading ? `<p class="loading" role="status">${e(t.loading)}</p>` : tasks.map((task,index) => app.card(task,index)).join('') || `<div class="empty"><span class="empty-index" aria-hidden="true">[ 00 ]</span><h3>${e(app.tasks.length ? t.emptySection : t.emptyTitle)}</h3><p>${e(app.tasks.length ? t.emptySectionText : t.emptyText)}</p>${app.button('refresh',t.refresh,'plain','refresh')}</div>`}</div>
    <div class="register-end"><span>${e(t.registerEnd)}</span><span aria-hidden="true">//</span></div>
  </section>`;
}

function profile(app) {
  const t = app.t;
  return `<section class="profile"><div class="profile-label"><span class="eyebrow">${e(t.employeeRecord)}</span><span class="profile-monogram" aria-hidden="true">${e(app.user.name.split(' ').map(x=>x[0]).slice(0,2).join(''))}</span></div><div class="profile-data"><h2>${e(app.user.name)}</h2><p class="profile-role">${e(ROLE_LABELS[app.user.role] || app.user.role)}</p><dl><dt>${e(t.session)}</dt><dd>${e(app.user.id)}</dd><dt>${e(t.workspace)}</dt><dd>Green Pavlodar</dd></dl>${app.demo ? `<p class="small muted">${e(t.demoAccount)}</p>` : ''}${app.button('logout',t.logout,'secondary','back')}</div></section>`;
}

function journal(app) {
  const entries = app.tasks.filter(task => task.history?.length);
  return `<section class="journal">${entries.map((task,index) => `<section class="journal-entry"><header><span class="journal-index">${String(index+1).padStart(2,'0')}</span><div><span class="task-code">${e(task.id)}</span><h2>${e(task.place)}</h2></div></header>${app.historyCards(task.history,task)}</section>`).join('') || `<div class="empty"><span class="empty-index" aria-hidden="true">[ — ]</span><h2>${e(app.t.noHistory)}</h2></div>`}</section>`;
}

export function cabinetLayout(app, css) {
  const t = app.t;
  const brand = `<div class="brand" aria-label="Green Pavlodar"><span class="brand-mark" aria-hidden="true">GP<span>/</span></span><span>GREEN<br>PAVLODAR</span></div>`;
  if (!app.user) return `${css}<section class="signed-out">${brand}<p class="eyebrow">${e(t.fieldOffice)}</p><h1>${e(t.signIn)}</h1><p>${e(t.signInText)}</p></section>`;
  if (!['worker','foreman'].includes(app.user.role)) return `${css}<section class="signed-out">${brand}<h1>${e(t.unsupportedRole)}</h1><p>${e(t.unsupportedRoleText)}</p><p>${e(app.user.displayName)} · ${e(ROLE_LABELS[app.user.role])}</p></section>`;
  const isDetail = app.page === 'tasks' && app.mobileDetail && app.selected;
  const content = app.page === 'profile' ? profile(app) : app.page === 'history' ? journal(app) : isDetail ? `<div class="detail-navigation">${app.button('back',t.back,'plain','back')}<span>${e(t.workSheet)} / ${e(app.selected.id)}</span></div>${app.detail()}` : `${app.user.role === 'foreman' ? crewSummary(app.crewWorkspace,t) : ''}${list(app)}`;
  const queue = isDetail ? app.queue.filter(entry => entry.taskId !== app.selected.id) : app.queue;
  const queueBlock = queue.length ? `<section class="queue"><div><strong>${e(t.localOnly)} <span class="queue-count">${queue.length}</span></strong><p>${e(t.queueHelp)}</p><div class="draft-links">${queue.map(entry => app.button('open-draft',`${t.draftOpen}: ${entry.taskId} · ${entry.kind === 'issue' ? t.issue : t.report}`,'plain','',entry.storageKey)).join('')}</div></div>${queue.some(entry => entry.frozen && entry.delivery !== 'conflict') ? app.button('sync',t.synchronize,'secondary','cloud','',app.busy) : ''}</section>` : '';
  return `${css}<div class="shell"><header class="topbar">${brand}<nav class="nav" aria-label="${e(t.workerSpace)}">${app.nav()}</nav><div class="identity"><strong>${e(app.user.name)}</strong><span>${e(ROLE_LABELS[app.user.role])}</span></div></header>
    ${app.demo ? `<div class="demo-line"><span class="demo-tag">${e(t.demo)}</span><span>${e(t.demoNotice)}</span></div>` : ''}
    ${app.locale === 'kk-draft' ? `<div class="language-note">${e(t.languageNote)}</div>` : ''}
    <main class="main ${isDetail ? 'work-detail' : ''}">${isDetail ? '' : heading(app)}
      ${app.message ? `<div class="toast ${e(app.message.tone || '')}" role="${app.message.tone === 'error' ? 'alert' : 'status'}">${icon(app.message.tone === 'error' ? 'alert' : 'check')}<span>${e(app.message.text)}</span></div>` : ''}
      ${isDetail ? '' : queueBlock}
      ${content}${isDetail ? queueBlock : ''}<footer class="page-footer"><span>GREEN PAVLODAR / ${e(t.fieldJournal)}</span><span>${e(t.helpText)}</span></footer>
    </main><nav class="mobile-nav" aria-label="${e(t.workerSpace)}">${app.nav()}</nav></div>`;
}
