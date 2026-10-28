import { WorkerWorkflow, validatePhoto, REASONS } from './workflow.mjs';
import { BrowserDrafts } from './drafts.mjs';
import { dictionary } from './strings.mjs';
import { icon } from './icons.mjs';
import { OBSERVATION_CATEGORIES, ROLE_LABELS } from './contract-v2.mjs';
import { scheme, crewSummary, assignmentPanel, sharedMaterials, reportQuantities, reportHistoryAmounts, localInput } from './v2-views.mjs';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const dateTime = value => new Intl.DateTimeFormat('ru-KZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Qyzylorda' }).format(new Date(value));
const safePhotoURL = url => typeof url === 'string' && (/^data:image\/(png|jpeg|webp);base64,/.test(url) || /^https:\/\//.test(url) || /^blob:/.test(url)) ? url : '';
export class GreenWorker extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: 'open' }); this.t = dictionary('ru'); this.tasks = []; this.section = 'current'; this.page = 'tasks';
    this.selected = null; this.mobileDetail = false; this.busy = false; this.loading = false; this.message = null;
    this.draft = null; this.queue = []; this.contextVersion = 0; this.writeChain = Promise.resolve(); this.previewURL = null; this.saveState = 'pending';
    this.root = this.shadowRoot;
    this.root.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button && !button.disabled) this.action(button.dataset.action, button.dataset.id).catch(error => this.showError(error)); });
    this.root.addEventListener('input', event => this.onInput(event));
    this.root.addEventListener('change', event => this.onChange(event));
    this.onConnectivity = () => { if (!navigator.onLine) this.message = { text: this.t.networkOffline, tone: 'info' }; this.render(); };
    this.onVisible = () => { if (document.visibilityState === 'visible' && this.workflow && !this.busy) this.refresh(false); };
  }
  connectedCallback() { window.addEventListener('offline', this.onConnectivity); window.addEventListener('online', this.onConnectivity); document.addEventListener('visibilitychange', this.onVisible); this.render(); }
  disconnectedCallback() { window.removeEventListener('offline', this.onConnectivity); window.removeEventListener('online', this.onConnectivity); document.removeEventListener('visibilitychange', this.onVisible); this.contextVersion++; if (this.previewURL) URL.revokeObjectURL(this.previewURL); }
  async configure({ gateway, user, scope, date, demo = false, locale = 'ru', drafts, timeoutMs, embedded = false }) {
    ++this.contextVersion;
    this.toggleAttribute('embedded',embedded);
    this.user = user ? {...user,name:user.displayName || user.name} : null; this.scope = scope; this.date = date; this.demo = demo; this.locale = locale; this.t = {...dictionary(locale)};
    if(user?.role==='foreman'){this.t.myTasks=this.t.crewTasks;this.t.workerSpace=this.t.foremanSpace;}
    this.crewWorkspace=null;this.assignmentDraft=null;
    this.workflow = user && ['worker','foreman'].includes(user.role) ? new WorkerWorkflow({ gateway, drafts: drafts || new BrowserDrafts(), userId: user.id, scope, timeoutMs }) : null;
    this.gateway = gateway; this.tasks = []; this.selected = null; this.draft = null; this.suggestion = null; this.message = null; this.queue = []; this.section = 'current'; this.page = 'tasks'; this.busy = false; this.aiBusy = false; this.geoBusy = false; this.mobileDetail = false;
    this.setPreview(null); this.render(); if (user) await this.refresh(false);
  }
  showError(error) { this.message = { text: error.message || String(error), tone: 'error' }; this.render(); }
  notify(text, tone = '') { this.message = { text, tone }; this.render(); }
  async refresh(showNotice = true) {
    if (!this.workflow) return;
    const version = this.contextVersion; const date = this.date;
    try {
      this.loading = this.tasks.length === 0; this.render();
      const [tasks, workspace] = await Promise.all([this.gateway.listTasks({date}),this.user.role==='foreman'?this.gateway.getCrewWorkspace():null]);
      if (version !== this.contextVersion || date !== this.date) return;
      // Defense in depth; real access control MUST also run on the server.
      this.tasks = tasks.filter(task => task.visibleToCurrentUser || task.assignedTo === this.user.id);
      this.crewWorkspace=workspace;
      if (this.selected) {
        const fresh = this.tasks.find(task => task.id === this.selected.id);
        this.selected = fresh || null;
      }
      if (!this.selected) this.selected = this.tasks.find(task => task.section === this.section) || null;
      const queue = await this.workflow.pending();
      if (version !== this.contextVersion) return;
      this.queue = queue;
      if (showNotice) this.message = { text: this.t.stale, tone: 'info' };
    } catch (error) { if (version === this.contextVersion) this.message = { text: error.message, tone: 'error' }; }
    finally { if (version === this.contextVersion) { this.loading = false; this.render(); } }
  }
  setPreview(file) { if (this.previewURL) URL.revokeObjectURL(this.previewURL); this.previewURL = file ? URL.createObjectURL(file) : null; }
  async saveDraft() {
    if (!this.draft || !this.workflow) return;
    const draft = structuredClone(this.draft), workflow = this.workflow, version = this.contextVersion;
    this.saveState = 'pending';
    const status = this.root.querySelector('[data-save-status]'); if (status) status.textContent = this.t.savePending;
    this.writeChain = this.writeChain.catch(() => {}).then(() => workflow.save(draft));
    try {
      await this.writeChain;
      if (version !== this.contextVersion) return;
      const queue = await workflow.pending();
      if (version !== this.contextVersion) return;
      this.queue = queue; this.saveState = 'saved';
      const label = this.root.querySelector('[data-save-status]'); if (label) label.textContent = this.t.savedDevice;
    } catch (error) { if (version === this.contextVersion) { this.saveState = 'failed'; this.showError(error); } throw error; }
  }
  async openDraft(kind) {
    const version = this.contextVersion, taskId = this.selected.id;
    await this.writeChain.catch(() => {});
    const draft = await this.workflow.draft(taskId, kind);
    if (version !== this.contextVersion || this.selected?.id !== taskId) return;
    if(!draft.baseVersion){draft.baseVersion=this.selected.version;draft.sharedBaseVersion=this.selected.sharedDraft?.version;draft.actualWorkerIds=this.selected.reportMode==='contribution'?[this.user.id]:[...(this.selected.assignedWorkerIds||[])];}
    this.draft = draft; this.suggestion = null; this.message = null; this.setPreview(draft.photo); await this.saveDraft(); this.render();
    this.root.querySelector('.form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async onInput(event) {
    const field = event.target.dataset.field;
    if(event.target.dataset.assignmentField || event.target.dataset.assignmentWorker){
      const fields={taskId:this.selected.id,workerIds:[...this.root.querySelectorAll('[data-assignment-worker]:checked')].map(el=>el.dataset.assignmentWorker),responsibleUserId:this.root.querySelector('#responsible')?.value,start:this.root.querySelector('#assign-start')?.value,end:this.root.querySelector('#assign-end')?.value};
      const fingerprint=JSON.stringify(fields);
      this.assignmentDraft={...fields,expectedVersion:this.assignmentDraft?.expectedVersion??this.selected.version,idempotencyKey:this.assignmentDraft?.fingerprint===fingerprint?this.assignmentDraft.idempotencyKey:crypto.randomUUID(),fingerprint};return;
    }
    if(this.draft&&!this.draft.frozen&&event.target.dataset.quantity){
      const item=this.selected.design.plantingItems.find(i=>i.id===event.target.dataset.quantity);
      this.draft.actualPlantingItems=this.draft.actualPlantingItems.filter(i=>i.plantingItemId!==item.id);
      if(event.target.value!=='')this.draft.actualPlantingItems.push({plantingItemId:item.id,catalogItemId:item.catalogItemId,quantity:Number(event.target.value)});
      await this.saveDraft().catch(()=>{});return;
    }
    if(this.draft&&!this.draft.frozen&&field==='foremanChecked'){this.draft.foremanChecked=event.target.checked;await this.saveDraft().catch(()=>{});return;}
    if(this.draft&&!this.draft.frozen&&event.target.dataset.actualWorker){this.draft.actualWorkerIds=[...this.root.querySelectorAll('[data-actual-worker]:checked')].map(el=>el.dataset.actualWorker);await this.saveDraft().catch(()=>{});return;}
    if (!this.draft || this.draft.frozen || !['note','reason'].includes(field)) return;
    this.draft[field] = event.target.value;
    if (field === 'note' && (this.draft.analysis || this.suggestion)) {
      this.draft.analysis = null; this.suggestion = null;
      this.root.querySelector('.ai-box')?.remove();
    }
    await this.saveDraft().catch(() => {});
  }
  async onChange(event) {
    try {
      if (event.target.dataset.field === 'date') { this.date = event.target.value; this.selected = null; this.draft = null; this.mobileDetail = false; this.setPreview(null); await this.refresh(false); }
      if (event.target.type === 'file' && this.draft && !this.draft.frozen) {
        const file = event.target.files[0]; if (!file) return;
        const key = this.draft.storageKey; const version = this.contextVersion;
        await validatePhoto(file);
        if (typeof createImageBitmap === 'function') { try { const bitmap = await createImageBitmap(file); bitmap.close(); } catch { throw new Error(this.t.photoUnreadable); } }
        if (version !== this.contextVersion || this.draft?.storageKey !== key) return;
        this.draft.photo = file; this.draft.upload = null; this.setPreview(file); this.message = null; await this.saveDraft(); this.render();
      }
    } catch (error) { this.showError(error); }
  }
  async action(action, id) {
    if (this.busy) return;
    if (action === 'logout') { await this.writeChain.catch(() => {}); await this.configure({ gateway: null, user: null, scope: this.scope, date: this.date, demo: this.demo }); this.dispatchEvent(new CustomEvent('worker-logout', { bubbles: true, composed: true })); return; }
    if (!this.workflow) return;
    if (action === 'nav') { this.page = id; this.draft = null; this.mobileDetail = false; this.message = null; this.render(); return; }
    if (action === 'refresh') return this.refresh();
    if (action === 'reload-assignment') {this.assignmentDraft=null;return this.refresh();}
    if (action === 'rebase-draft' && this.draft?.delivery==='conflict'){await this.workflow.rebase(this.draft);await this.refresh(false);this.render();return;}
    if (action === 'tab') { this.section = id; this.selected = this.tasks.find(t => t.section === id) || null; this.draft = null; this.mobileDetail = false; this.message = null; this.setPreview(null); this.render(); return; }
    if (action === 'select') { const version = this.contextVersion; const task = await this.gateway.getTask(id); if (version !== this.contextVersion || !task.visibleToCurrentUser && task.assignedTo !== this.user?.id) return; this.selected = task; this.assignmentDraft=null; this.mobileDetail = true; this.draft = null; this.suggestion = null; this.message = null; this.setPreview(null); this.render(); this.root.querySelector('.detail-panel h2')?.focus(); return; }
    if (action === 'back') { this.mobileDetail = false; this.draft = null; this.setPreview(null); this.render(); return; }
    if (action === 'open-report' || action === 'open-issue') return this.openDraft(action === 'open-report' ? 'report' : 'issue');
    if (action === 'open-draft') {
      const entry = this.queue.find(x => x.storageKey === id); if (!entry) return;
      const version = this.contextVersion; const task = await this.gateway.getTask(entry.taskId); if (version !== this.contextVersion || !task.visibleToCurrentUser && task.assignedTo !== this.user?.id) return; this.selected = task; this.section = this.selected.section; this.page = 'tasks'; this.mobileDetail = true; return this.openDraft(entry.kind);
    }
    if (action === 'close-form') { this.draft = null; this.setPreview(null); this.render(); return; }
    if (action === 'choose-photo' || action === 'camera') { this.root.querySelector(action === 'camera' ? '#camera' : '#photo').click(); return; }
    if (action === 'remove-photo' && this.draft && !this.draft.frozen) { this.draft.photo = null; this.draft.upload = null; this.setPreview(null); await this.saveDraft(); this.render(); return; }
    if (action === 'reject-ai') { this.suggestion = null; this.draft.analysis = null; await this.saveDraft(); this.render(); return; }
    if (action === 'accept-ai' && this.suggestion && !this.draft.frozen) {
      const category = this.root.querySelector('#ai-category').value.trim();
      const facts = this.root.querySelector('#ai-facts').value.split('\n').map(x => x.trim()).filter(Boolean);
      this.draft.analysis = { category, facts, provenance: { ...this.suggestion.provenance, suggestion: { category: this.suggestion.category, facts: this.suggestion.facts } },
        decision: category === this.suggestion.category && JSON.stringify(facts) === JSON.stringify(this.suggestion.facts) ? 'accepted' : 'edited', confirmedBy: this.user.id, confirmedAt: new Date().toISOString() };
      this.suggestion = null; this.message = null; await this.saveDraft(); this.render(); return;
    }
    if (action === 'analyze') {
      if (this.aiBusy || !this.draft || this.draft.frozen) return;
      const text = this.draft.note, key = this.draft.storageKey, version = this.contextVersion; this.aiBusy = true; this.render();
      try { const result = await this.workflow.analyze(text,{objectId:this.selected.objectId,taskId:this.selected.id}); if (version === this.contextVersion && this.draft?.storageKey === key && this.draft.note === text && !this.draft.frozen) this.suggestion = result; }
      catch (error) { if (version === this.contextVersion && this.draft?.storageKey === key) this.message = { text: error.message, tone: 'error' }; }
      finally { if (version === this.contextVersion) { this.aiBusy = false; this.render(); } } return;
    }
    if (action === 'remove-geo' && !this.draft?.frozen) { this.draft.geo = null; await this.saveDraft(); this.render(); return; }
    if (action === 'geo') {
      if (this.geoBusy || !this.draft || this.draft.frozen) return;
      const key = this.draft.storageKey, version = this.contextVersion; this.geoBusy = true; this.render();
      try {
        if (!navigator.geolocation) throw new Error(this.t.geoDenied);
        const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, maximumAge: 0, enableHighAccuracy: false }));
        if (version === this.contextVersion && this.draft?.storageKey === key && !this.draft.frozen) {
          this.draft.geo = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, deviceTime: new Date(pos.timestamp).toISOString() }; await this.saveDraft();
        }
      } catch { if (version === this.contextVersion) this.message = { text: this.t.geoDenied, tone: 'info' }; }
      finally { if (version === this.contextVersion) { this.geoBusy = false; this.render(); } } return;
    }
    if (this.busy) return;
    const version = this.contextVersion; this.busy = true; this.message = null; this.render(); this.dispatchEvent(new CustomEvent('worker-busy', { detail: true }));
    try {
      if(action==='assign-workers'){
        const a=this.assignmentDraft||{workerIds:this.selected.assignedWorkerIds,responsibleUserId:this.selected.responsibleUserId||this.selected.assignedWorkerIds[0],start:localInput(this.selected.scheduledStart),end:localInput(this.selected.scheduledEnd),expectedVersion:this.selected.version,idempotencyKey:crypto.randomUUID()};
        const task=await this.gateway.assignWorkers(this.selected.id,{...a,scheduledStart:`${a.start}:00+05:00`,scheduledEnd:`${a.end}:00+05:00`});
        if(version===this.contextVersion){this.selected=task;this.assignmentDraft=null;this.message={text:this.t.assignmentSaved};}
      }
      if (action === 'start') { const task = await this.gateway.startTask(this.selected.id); if (version === this.contextVersion) this.selected = task; }
      if (action === 'send') {
        if (!this.draft) return;
        if (this.draft.note.length > 4000) throw new Error(this.t.tooLong);
        await this.writeChain;
        const kind = this.draft.kind;
        const receipt=await this.workflow.send(this.draft);
        if (version === this.contextVersion) { this.draft = null; this.suggestion = null; this.setPreview(null); this.message = { text: kind === 'report' ? receipt.submissionType==='contribution'?this.t.materialsSaved:this.t.waitingReview : this.t.issueSaved }; }
      }
      if (action === 'sync') {
        const results = await this.workflow.synchronize();
        if (version === this.contextVersion) {
          const saved = results.filter(r => r.saved).length, failed = results.length - saved;
          this.message = { text: results.length ? `${this.t.syncSuccess}: ${saved}. ${this.t.syncFailure}: ${failed}.${failed ? ' ' + results.find(r => !r.saved).error : ''}` : this.t.noQueued, tone: failed ? 'error' : 'info' };
          if (this.draft?.frozen && results.some(r => r.taskId === this.draft.taskId && r.saved)) { this.draft = null; this.setPreview(null); }
        }
      }
      if (version === this.contextVersion) await this.refresh(false);
    } catch (error) { if (version === this.contextVersion) { this.message = { text: error.message, tone: 'error' }; this.queue = await this.workflow.pending(); } }
    finally { if (version === this.contextVersion) { this.busy = false; this.render(); this.dispatchEvent(new CustomEvent('worker-busy', { detail: false })); } }
  }
  button(action, label, css = '', iconName = '', id = '', disabled = false) { return `<button type="button" class="button ${css}" data-action="${action}" ${id ? `data-id="${escape(id)}"` : ''} ${disabled ? 'disabled' : ''}>${iconName ? icon(iconName) : ''}${escape(label)}</button>`; }
  nav() { return [['tasks','list',this.t.myTasks],['history','clock',this.t.history],['profile','user',this.t.profile]].map(([id, symbol, label]) => `<button type="button" data-action="nav" data-id="${id}" class="${this.page === id ? 'active' : ''}" ${this.page === id ? 'aria-current="page"' : ''}>${icon(symbol)}${escape(label)}</button>`).join(''); }
  badge(task) { return `<span class="badge ${task.coordinatorComment ? 'warn' : task.section === 'confirmed' ? 'ok' : ''}">${escape(task.statusLabel)}</span>`; }
  card(task) { return `<button type="button" data-action="select" data-id="${escape(task.id)}" class="task ${this.selected?.id === task.id ? 'selected' : ''}" aria-label="${escape(task.place + '. ' + task.action + '. ' + task.statusLabel)}"><div class="task-top"><span class="task-code">${escape(task.id)}</span><span class="priority ${task.priorityTone === 'high' ? 'high' : ''}"><span class="dot"></span>${escape(task.priority)}</span></div><h3>${escape(task.place)}</h3><p class="task-action">${escape(task.action)}</p><span class="task-arrow">${icon('arrow')}</span><div class="task-bottom"><span class="time">${icon('clock')}${escape(task.due)}</span>${this.badge(task)}</div></button>`; }
  historyCards(history, task) { return history.length ? `<div class="history-list">${[...history].reverse().map(item => `<article class="history-card"><div class="row"><strong>${item.type === 'issue' ? this.t.issue : this.t.report}</strong><span class="badge">${escape(item.reviewLabel)}</span></div><small>${escape(dateTime(item.time))}</small>${item.reason ? `<p><strong>${escape(item.reason)}</strong></p>` : ''}<p>${escape(item.note || this.t.emptyNote)}</p>${item.photoName ? `<small>${icon('photo')} ${this.t.photoAttached}: ${escape(item.photoName)}</small>${safePhotoURL(item.photoUrl) ? `<img src="${escape(safePhotoURL(item.photoUrl))}" alt="${escape(this.t.photoAttached)}" loading="lazy">` : `<small>${this.demo ? this.t.previewUnavailable : ''}</small>`}` : ''}${item.analysis ? `<p><strong>${this.t.confirmedAnalysis}: ${escape(item.analysis.category)}</strong><br>${item.analysis.facts.map(escape).join('<br>')}</p><small>${this.t.origin}: ${escape(item.analysis.provenance?.provider)} · ${escape(item.analysis.decision)}</small>` : ''}${item.geo ? `<p>${Number(item.geo.latitude).toFixed(5)}, ${Number(item.geo.longitude).toFixed(5)} · ±${Math.round(item.geo.accuracy)} м</p><small>${this.t.geoEvidence}</small>` : ''}${reportHistoryAmounts(task,item,this.crewWorkspace,this.t)}${item.coordinatorComment ? `<blockquote><strong>${this.t.reviewComment}</strong><br>${escape(item.coordinatorComment)}</blockquote>` : ''}</article>`).join('')}</div>` : `<p class="small muted">${this.t.noHistory}</p>`; }
  detail() {
    const task = this.selected, t = this.t; if (!task) return '';
    return `<section class="detail-panel" aria-label="${t.detail}"><div class="detail-hero"><div class="detail-pattern">${icon('leaf')}</div><div class="row"><span class="task-code">${t.detail.toUpperCase()} ${escape(task.id)}</span>${this.badge(task)}</div><h2 tabindex="-1">${escape(task.action)}</h2><p>${escape(task.objectLabel)}</p></div><div class="detail-body">
      ${task.coordinatorComment ? `<div class="note-box"><strong>${t.returnTitle}</strong>${escape(task.coordinatorComment)}</div>` : ''}
      <div><p class="section-label">${t.instruction}</p><p class="body-text">${escape(task.instruction)}</p></div>
      ${scheme(task,t)}
      <div class="norm-box"><p class="section-label">${t.norm}</p><p>${escape(task.norm || t.noNorm)}</p><small>${escape(task.norm ? task.normSource : t.noNormText)}</small></div>
      <div class="metadata"><div><p class="section-label">${t.duration}</p><p>${icon('clock')} ${escape(task.duration || t.noData)}</p></div>${task.startedAt ? `<div><p class="section-label">${t.started}</p><p>${escape(dateTime(task.startedAt))}</p></div>` : ''}</div>
      <div><p class="section-label">${t.location}</p><div class="location-box"><div class="location-icon">${icon('pin')}</div><div><p><strong>${escape(task.place)}</strong></p><p>${escape(task.address)}</p><small>${t.coordinates}: ${escape(task.coordinates?.latitude ?? t.noData)}, ${escape(task.coordinates?.longitude ?? t.noData)}</small></div></div><p class="small muted" style="margin-top:7px">${t.locationNote}</p></div>
    </div>${this.user.role==='foreman'||task.sharedDraft?`<div class="crew-context">${this.user.role==='foreman'?assignmentPanel(task,this.crewWorkspace,this.assignmentDraft,t,this.busy):''}${sharedMaterials(task,this.crewWorkspace,t)}</div>`:''}<div class="detail-footer">${task.permissions.start && !this.draft ? this.button('start', this.busy ? t.starting : t.start, 'primary full', 'arrow', '', this.busy) + `<p class="small muted" style="text-align:center">${t.startHint}</p>` : ''}${task.permissions.report && !this.draft ? this.button('open-report', task.reportMode==='contribution'?t.addMaterials:task.reportMode==='final'?t.prepareFinal:task.coordinatorComment ? t.fixReport : t.writeReport, 'primary full', 'photo') : ''}${task.permissions.issue && !this.draft ? this.button('open-issue', t.cannot, 'plain full', 'alert') : ''}${!task.permissions.start && !task.permissions.report && !task.permissions.issue ? `<p class="small muted">${escape(task.statusLabel)}</p>` : ''}</div>
      ${this.draft ? this.form() : ''}<div class="detail-body"><h3>${t.historyTitle}</h3>${this.historyCards(task.history || [], task)}</div></section>`;
  }
  form() {
    const d = this.draft, t = this.t, issue = d.kind === 'issue', final=!issue&&this.selected.reportMode==='final',contribution=!issue&&this.selected.reportMode==='contribution', locked = !!d.frozen || this.busy, disabled = locked ? 'disabled' : '';
    return `<section class="form" aria-label="${issue ? t.issueTitle : t.reportTitle}"><div class="form-heading"><div class="row"><h3>${issue ? t.issueTitle :final?t.finalTitle:contribution?t.contributionTitle:t.reportTitle}</h3>${this.button('close-form', t.cancel, 'plain', '', '', this.busy)}</div><p>${issue ? t.issueSubtitle :final?t.finalSubtitle:contribution?t.contributionSubtitle:t.reportSubtitle}</p></div>
      ${d.frozen ? `<div class="note-box">${t.frozen}</div>` : ''}
      ${d.delivery==='conflict'?`<div class="note-box">${t.draftConflict}${this.button('rebase-draft',t.rebaseDraft,'secondary')}</div>`:''}
      ${issue ? `<div class="field"><label for="reason">${t.reason}</label><select id="reason" data-field="reason" ${disabled}>${REASONS.map(reason => `<option ${d.reason === reason ? 'selected' : ''}>${escape(reason)}</option>`).join('')}</select></div>` : ''}
      ${final?'':`<div class="field"><label>${issue ? t.issuePhotoStep : t.photoStep}</label>${this.previewURL ? `<figure class="preview"><img src="${this.previewURL}" alt="${t.photoAlt}"><figcaption>${escape(d.photo?.name || 'photo')} · ${((d.photo?.size || 0) / 1024).toFixed(0)} КБ</figcaption></figure>` : ''}
        <input type="file" id="photo" class="file-input" accept="image/jpeg,image/png,image/webp" aria-label="${t.choosePhoto}" ${disabled}><input type="file" id="camera" class="file-input" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="${t.takePhoto}" ${disabled}>
        <div class="field-actions">${this.button('choose-photo', d.photo ? t.replacePhoto : t.choosePhoto, 'secondary', 'photo', '', locked)}${this.button('camera', t.takePhoto, 'secondary', 'camera', '', locked)}${d.photo ? this.button('remove-photo', t.removePhoto, 'plain', '', '', locked) : ''}</div><small>${t.photoHint}</small>
      </div>`}
      ${reportQuantities(this.selected,d,t,locked)}
      ${final?`<fieldset class="people-picker"><legend>${t.actualWorkers}</legend>${this.selected.assignedWorkerIds.map(id=>`<label class="person-option"><input type="checkbox" data-actual-worker="${escape(id)}" ${d.actualWorkerIds.includes(id)?'checked':''} ${disabled}><span>${escape(this.crewWorkspace?.workers.find(w=>w.id===id)?.displayName||id)}</span></label>`).join('')}</fieldset>${!this.selected.design?`<label class="person-option"><input type="checkbox" data-field="foremanChecked" ${d.foremanChecked?'checked':''} ${disabled}><span>${t.foremanCheck}</span></label>`:''}`:''}
      <div class="field"><label for="note">${issue ? t.issueNote : t.noteStep}</label><textarea id="note" data-field="note" maxlength="4000" placeholder="${t.notePlaceholder}" ${disabled}>${escape(d.note)}</textarea><small>${t.noteOptional}</small></div>
      <div>${this.button('analyze', this.aiBusy ? t.analyzing : t.analyze, 'secondary full', 'spark', '', locked || this.aiBusy)}<p class="small muted" style="margin-top:7px">${t.aiOptional}</p>${this.demo ? `<p class="small muted" style="margin-top:4px">${t.aiDemo}</p>` : ''}</div>
      ${this.suggestion ? `<div class="ai-box"><h3>${t.aiTitle}</h3><p class="small muted">${t.original}</p><blockquote>${escape(this.suggestion.provenance?.originalText)}</blockquote><div class="field"><label for="ai-category">${t.category}</label><select id="ai-category" ${disabled}>${Object.entries(OBSERVATION_CATEGORIES).map(([key,label])=>`<option value="${key}" ${key===this.suggestion.category?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label for="ai-facts">${t.facts}</label><textarea id="ai-facts" maxlength="4000" ${disabled}>${escape(this.suggestion.facts.join('\n'))}</textarea></div><p class="small muted">${t.aiUnconfirmed}</p><div class="field-actions">${this.button('accept-ai', t.acceptAI, 'primary', 'check', '', locked)}${this.button('reject-ai', t.rejectAI, 'plain', '', '', locked)}</div></div>` : ''}
      ${d.analysis ? `<div class="ai-box"><strong class="small">${t.aiAccepted}</strong><p class="small">${escape(OBSERVATION_CATEGORIES[d.analysis.category]||d.analysis.category)}: ${d.analysis.facts.map(escape).join('; ')}</p>${this.button('reject-ai', t.rejectAI, 'plain', '', '', locked)}</div>` : ''}
      <div class="geo-box"><h3>${t.geoTitle}</h3><p>${t.geoText}</p>${d.geo ? `<p>${Number(d.geo.latitude).toFixed(5)}, ${Number(d.geo.longitude).toFixed(5)} · ${t.accuracy}: ±${Math.round(d.geo.accuracy)} м</p>${this.button('remove-geo', t.removePhoto, 'plain', '', '', locked)}` : this.button('geo', this.geoBusy ? t.geoWaiting : t.geoAdd, 'secondary', 'pin', '', locked || this.geoBusy)}</div>
      <p class="save-status">${icon('cloud')}<span data-save-status>${this.saveState === 'saved' ? t.savedDevice : this.saveState === 'failed' ? t.saveFailed : t.savePending}</span></p>
      ${this.button('send', this.busy ? t.sending : d.frozen ? t.sendAgain : issue ? t.sendIssue : final?t.sendFinal:contribution?t.sendMaterials:t.sendReport, 'primary full', 'arrow', '', this.busy||d.delivery==='conflict')}
    </section>`;
  }
  render() {
    const t = this.t, selected = this.selected, count = section => this.tasks.filter(task => task.section === section).length;
    const css = `<link rel="stylesheet" href="${new URL('./worker.css', import.meta.url).href}">`;
    if (!this.user) { this.root.innerHTML = `${css}<div class="signed-out"><h2>${t.signIn}</h2><p>${t.signInText}</p></div>`; return; }
    if(!['worker','foreman'].includes(this.user.role)){this.root.innerHTML=`${css}<div class="signed-out"><h2>${t.unsupportedRole}</h2><p>${t.unsupportedRoleText}</p><p>${escape(this.user.displayName)} · ${ROLE_LABELS[this.user.role]}</p></div>`;return;}
    const brand = `<div class="brand"><span class="brand-mark">${icon('leaf')}</span><span>${t.brand}<small>${t.workspace}</small></span></div>`;
    let content;
    if (this.page === 'profile') content = `<section class="profile"><h2>${t.profile}</h2><div><p class="section-label">${t.user}</p><strong>${escape(this.user.name)}</strong><p class="small muted">${escape(ROLE_LABELS[this.user.role]||this.user.role)}</p></div><div><p class="section-label">${t.session}</p><p class="small break">${escape(this.user.id)}</p></div>${this.demo ? `<p class="small muted">${t.demoAccount}</p>` : ''}${this.button('logout', t.logout, 'secondary')}</section>`;
    else if (this.page === 'history') content = `<section><h2 style="margin-bottom:20px">${t.historyTitle}</h2><div class="history-list">${this.tasks.filter(task => task.history?.length).map(task => `<section><h3 style="margin:8px 0 12px">${escape(task.place)} · ${escape(task.id)}</h3>${this.historyCards(task.history, task)}</section>`).join('') || `<p>${t.noHistory}</p>`}</div></section>`;
    else content = `<div class="split ${this.mobileDetail && selected ? 'detail-open' : ''}"><div class="list-pane"><div class="tabs" role="group" aria-label="${t.tasksLabel}">${['current','submitted','confirmed'].map(section => `<button type="button" data-action="tab" data-id="${section}" class="${this.section === section ? 'active' : ''}" aria-pressed="${this.section === section}">${t[section]}<span>${count(section)}</span></button>`).join('')}</div><div class="task-list">${this.loading ? `<p role="status">${t.loading}</p>` : this.tasks.filter(task => task.section === this.section).map(task => this.card(task)).join('') || `<div class="empty">${icon('leaf')}<h3>${this.tasks.length ? t.emptySection : t.emptyTitle}</h3><p>${this.tasks.length ? t.emptySectionText : t.emptyText}</p>${this.button('refresh', t.refresh, 'plain', 'refresh')}</div>`}</div></div><div>${this.button('back', t.back, 'back plain', 'back')}${this.detail()}</div></div>`;
    this.root.innerHTML = `${css}<div class="shell"><aside class="rail">${brand}<nav class="nav" aria-label="${t.workerSpace}">${this.nav()}</nav><div class="rail-help"><div class="leaf-art">${icon('leaf')}</div><h3 style="font-size:12px">${t.helpTitle}</h3><p>${t.helpText}</p></div><p class="rail-bottom">${this.demo ? 'Локальный шаблон · V2' : t.workerSpace}</p></aside><div class="workspace"><header class="topbar"><p class="breadcrumb">Green Pavlodar <span style="margin:0 12px">/</span> ${t.workerSpace}</p><div class="mobile-brand">${brand}</div><div class="identity"><div><strong>${escape(this.user.name)}</strong><small>${escape(ROLE_LABELS[this.user.role]||this.user.role)}</small></div><span class="avatar">${escape(this.user.name.split(' ').map(x => x[0]).slice(0,2).join(''))}</span></div></header>${this.demo ? `<div class="demo-line"><span class="demo-tag">${t.demo}</span><span>${t.demoNotice}</span></div>` : ''}${this.locale === 'kk-draft' ? `<div class="language-note">${t.languageNote}</div>` : ''}<main class="main"><div class="page-heading ${this.mobileDetail ? 'detail-mode' : ''}"><div><p class="eyebrow">${t.workerSpace}</p><h1>${t.myTasks}</h1><p class="subhead">${t.greeting}</p></div><div class="date-tools"><label for="shift-date">${t.today}<input id="shift-date" data-field="date" type="date" value="${escape(this.date)}"></label><button type="button" class="icon-button" data-action="refresh" aria-label="${t.refresh}" ${this.loading || this.busy ? 'disabled' : ''}>${icon('refresh')}</button></div></div><div class="stats ${this.mobileDetail ? 'detail-mode' : ''}"><div class="stat"><div><span>${t.totalLabel}</span></div><strong>${this.tasks.length}</strong><i class="stat-icon">${icon('list')}</i></div><div class="stat"><div><span>${t.inProgressLabel}</span></div><strong>${count('current')}</strong><i class="stat-icon">${icon('clock')}</i></div><div class="stat green"><div><span>${t.completedLabel}</span></div><strong>${count('confirmed')}</strong><i class="stat-icon">${icon('check')}</i></div></div>
      ${this.message ? `<div class="toast ${this.message.tone || ''}" role="${this.message.tone === 'error' ? 'alert' : 'status'}">${escape(this.message.text)}</div>` : ''}
      ${this.queue.length ? `<div class="queue"><div><strong>${t.localOnly}: ${this.queue.length}</strong><p>${t.queueHelp}</p>${this.queue.map(entry => `<button type="button" class="button plain" style="font-size:11px;padding:5px;min-height:44px" data-action="open-draft" data-id="${escape(entry.storageKey)}">${t.draftOpen}: ${escape(entry.taskId)} · ${entry.kind === 'issue' ? t.issue : t.report}</button>`).join('')}</div>${this.button('sync', t.synchronize, 'secondary', 'cloud', '', this.busy)}</div>` : ''}${this.user.role==='foreman'&&!this.mobileDetail?crewSummary(this.crewWorkspace,t):''}${content}</main></div><nav class="mobile-nav" aria-label="${t.workerSpace}">${this.nav()}</nav></div>`;
    // Disable navigation during a mutation; retries are guarded in the workflow as well.
    if (this.busy) this.root.querySelectorAll('[data-action="select"],[data-action="tab"],[data-action="nav"],[data-action="open-draft"],[data-action="back"],[data-field="date"]').forEach(element => { element.disabled = true; });
  }
}
customElements.define('green-worker', GreenWorker);
