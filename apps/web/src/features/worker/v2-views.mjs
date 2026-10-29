import { clockTime } from './contract-v2.mjs';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const photoURL=url=>typeof url==='string'&&(/^data:image\/(png|jpeg|webp);base64,/.test(url)||/^https:\/\//.test(url)||/^blob:/.test(url))?url:'';
export const localInput=iso=>iso?new Date(Date.parse(iso)+5*3600000).toISOString().slice(0,16):'';
export function scheme(task,t){
  if(!task.design)return '';
  const d=task.design;
  const features=[...(task.context?.features||[]).map(f=>({...f,kind:f.featureType})),...d.plantingItems.map(i=>({...i,kind:'planting'}))];
  const points=features.flatMap(f=>f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.type==='MultiPoint'?f.geometry.coordinates:f.geometry.type==='Point'?[f.geometry.coordinates]:[]);
  if(!points.length)return `<p>${t.noScheme}</p>`;
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const x=v=>20+(v-minX)/Math.max(.00001,maxX-minX)*320,y=v=>200-(v-minY)/Math.max(.00001,maxY-minY)*180;
  const palette={building:'#d4d7dd',road:'#a2a8b3',crossing:'#ffffff',planting:'#2d52d1'};
  const shapes=features.map(f=>{
    const color=palette[f.kind]||'#e9edf5';
    if(f.geometry.type==='Polygon')return `<polygon points="${f.geometry.coordinates[0].map(p=>`${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}" fill="${color}" stroke="${f.kind==='planting'?'#183a98':'#8991a2'}" stroke-width="1.5"><title>${e(f.name||f.kind)}</title></polygon>`;
    const ps=f.geometry.type==='MultiPoint'?f.geometry.coordinates:f.geometry.type==='Point'?[f.geometry.coordinates]:[];
    return ps.map(p=>`<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="8" fill="${color}" stroke="#183a98"/>`).join('');
  }).join('');
  return `<section><p class="section-label">${t.approvedDesign}</p><h3>${e(d.name)}</h3><p class="small muted">${t.revision} ${d.revision} · ${t.taskVersion} ${task.approvedDesignVersion}</p>${!task.designCurrent?`<div class="note-box">${t.staleDesign}</div>`:''}<figure class="scheme"><svg viewBox="0 0 360 220" role="img" aria-label="${t.schemeLabel}"><rect width="360" height="220" fill="#f1f4fa"/>${shapes}</svg><figcaption>${task.isDemo?t.schemeDemo:t.schemeSources}</figcaption></figure><p class="small muted">${t.schemeLegend}</p><div class="quantity-list">${d.plantingItems.map(item=>`<div class="quantity-row"><span>${e(task.catalog.find(c=>c.id===item.catalogItemId)?.displayName||item.catalogItemId)}</span><strong>${item.quantity===null?t.noData:item.quantity} ${t.pieces}</strong></div>`).join('')}</div><p class="small muted">${t.noConceptPhoto}</p></section>`;
}
export function crewSummary(workspace,t){
  if(!workspace)return '';
  return `<details class="crew-summary"><summary><span class="crew-label">${t.myCrews}</span><strong>${workspace.crews.map(c=>e(c.name)).join(', ')}</strong><span class="roster-count">${workspace.workers.length} ${t.peopleInRoster}</span><span class="disclosure" aria-hidden="true">+</span></summary><div class="crew-expanded"><div><p class="section-label">${t.selectPeople}</p>${workspace.workers.map(w=>`<p>${e(w.displayName)} <span class="small muted">${clockTime(w.profile.shiftStart)}–${clockTime(w.profile.shiftEnd)}</span></p>`).join('')}</div><div><p class="section-label">${t.resources}</p>${workspace.resources.map(r=>`<p>${e(r.label)} · ${r.capacity??t.noData} ${e(r.unit||'')}</p>`).join('')}<p class="small muted">${t.resourcesOnce}</p></div></div></details>`;
}
export function assignmentPanel(task,workspace,draft,t,busy){
  if(!workspace||!workspace.crews.some(c=>c.id===task.assignedCrewId))return '';
  const a=draft?.taskId===task.id?draft:{workerIds:task.assignedWorkerIds,responsibleUserId:task.responsibleUserId||task.assignedWorkerIds[0]||'',start:localInput(task.scheduledStart),end:localInput(task.scheduledEnd)};
  const people=workspace.workers.filter(w=>w.crewIds.includes(task.assignedCrewId));
  const disabled=task.status!=='assigned'||busy?'disabled':'';
  return `<section class="assignment"><h3>${t.assignPeople}</h3><p class="small muted">${t.minPeople}: ${task.minWorkers} · ${t.skills}: ${e(task.requiredSkills.join(', '))}</p><p class="small muted">${t.agreedTime}: ${clockTime(task.scheduledStart)}–${clockTime(task.scheduledEnd)} · UTC+5</p>${!task.assignedWorkerIds.length?`<div class="note-box">${t.unconfirmedCrew}</div>`:''}
    <fieldset class="people-picker"><legend>${t.selectPeople}</legend>${people.map(w=>`<label class="person-option"><input type="checkbox" data-assignment-worker="${e(w.id)}" ${a.workerIds.includes(w.id)?'checked':''} ${disabled}><span><strong>${e(w.displayName)}</strong><small>${clockTime(w.profile.shiftStart)}–${clockTime(w.profile.shiftEnd)} · ${e(w.profile.skills.join(', '))}</small>${w.profile.unavailableIntervals.map(i=>`<small class="warning-text">${t.unavailable}: ${clockTime(i.start)}–${clockTime(i.end)}</small>`).join('')}</span></label>`).join('')}</fieldset>
    <div class="field"><label for="responsible">${t.responsible}</label><select id="responsible" data-assignment-field="responsible" ${disabled}><option value="">${t.selectResponsible}</option>${people.map(w=>`<option value="${e(w.id)}" ${a.responsibleUserId===w.id?'selected':''}>${e(w.displayName)}</option>`).join('')}</select></div>
    <div class="assignment-time"><div class="field"><label for="assign-start">${t.timeStart}</label><input id="assign-start" data-assignment-field="start" type="datetime-local" value="${e(a.start)}" ${disabled}></div><div class="field"><label for="assign-end">${t.timeEnd}</label><input id="assign-end" data-assignment-field="end" type="datetime-local" value="${e(a.end)}" ${disabled}></div></div>
    ${task.status==='assigned'?`<button class="button primary full" type="button" data-action="assign-workers" ${disabled}>${t.saveAssignment}</button>`:`<p class="note-box">${t.cannotReassign}</p>`}<button class="button plain" type="button" data-action="reload-assignment" ${busy?'disabled':''}>${t.refreshAssignment}</button><p class="small muted">${t.assignmentCheck}</p></section>`;
}
export function sharedMaterials(task,workspace,t){
  if(!task.sharedDraft)return '';
  return `<section class="shared-materials"><h3>${t.sharedReport}</h3><p class="small muted">${t.revision} ${task.sharedDraft.version} · ${t.finalReview}</p>${task.sharedDraft.contributions.length?task.sharedDraft.contributions.map(c=>`<article class="history-card"><strong>${e(workspace?.workers.find(w=>w.id===c.authorId)?.displayName||c.authorId)}</strong><p>${e(c.note||t.emptyNote)}</p><small>${t.photos}: ${c.photoIds.length}</small>${(c.photos||[]).map(p=>photoURL(p.url)?`<img src="${e(photoURL(p.url))}" alt="${e(t.photoAttached)}" loading="lazy">`:`<small>${e(p.name||t.photoAttached)} · ${t.previewUnavailable}</small>`).join('')}${(c.actualPlantingItems||[]).map(i=>`<p>${e(task.catalog.find(p=>p.id===i.catalogItemId)?.displayName||i.catalogItemId)}: ${i.quantity} ${t.pieces}</p>`).join('')}</article>`).join(''):`<p class="small muted">${t.noMaterials}</p>`}</section>`;
}
export function reportQuantities(task,draft,t,locked){
  if(draft.kind==='issue'||!task.design)return '';
  const disabled=locked?'disabled':'';
  return `<section><h3>${t.actualAmounts}</h3><p class="small muted">${t.amountHint}</p><div class="quantity-list">${task.design.plantingItems.map(item=>{const actual=draft.actualPlantingItems.find(a=>a.plantingItemId===item.id);return `<div class="quantity-input"><label for="quantity-${e(item.id)}">${e(task.catalog.find(c=>c.id===item.catalogItemId)?.displayName||item.catalogItemId)}<small>${t.planned}: ${item.quantity??t.noData} ${t.pieces}</small></label><input id="quantity-${e(item.id)}" data-quantity="${e(item.id)}" type="number" min="0" step="1" placeholder="—" value="${actual?.quantity??''}" ${disabled}></div>`;}).join('')}</div><p class="small warning-text">${t.partialWarning}</p>${task.reportMode==='final'?`<label class="person-option"><input id="foreman-checked" data-field="foremanChecked" type="checkbox" ${draft.foremanChecked?'checked':''} ${disabled}><span>${t.foremanCheck}</span></label>`:''}</section>`;
}
export function reportHistoryAmounts(task,report,workspace,t){
  if(report.type==='issue')return '';
  const actuals=report.actualPlantingItems||[];
  const planned=task?.design?.plantingItems||[];
  const rows=planned.length?planned:actuals.map(item=>({...item,id:item.plantingItemId,quantity:null}));
  const amounts=rows.length?`<section class="quantity-list"><strong>${t.actualAmounts}</strong>${rows.map(item=>{
    const actual=actuals.find(value=>value.plantingItemId===item.id);
    const name=task?.catalog?.find(value=>value.id===item.catalogItemId)?.displayName||item.catalogItemId;
    return `<div class="quantity-row"><span>${e(name)}<small>${t.planned}: ${e(item.quantity??t.noData)} ${t.pieces}</small></span><strong>${e(actual?.quantity??t.noData)} ${t.pieces}</strong></div>`;
  }).join('')}</section>`:'';
  const people=report.actualWorkerIds?.length?`<p class="small"><strong>${t.actualWorkers}:</strong> ${report.actualWorkerIds.map(id=>e(workspace?.workers.find(worker=>worker.id===id)?.displayName||id)).join(', ')}</p>`:'';
  return amounts+people;
}
