const {chromium, expect}=require('../defense-final/tools/e2e/node_modules/@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const out=path.join(__dirname,'captures'),base='http://127.0.0.1:5184',site='site-osm-1569993037';
const options={variant:'optimal',careYears:3,excluded:[],locked:[],replacements:{},watering:'regular',improveSoil:false,maxSpeciesShare:0.3};
const m={sha:'a66d542c63c527d608400c84b34d49f982855369',source:'mock',base,created:new Date().toISOString(),status:'captured package version; independent acceptance not claimed',options,captures:[]};
let b;
async function open(p,route,lang='ru'){
 await p.goto(base+'/?source=mock&lang='+lang+'#'+route,{waitUntil:'domcontentloaded'});
 await p.locator('nav.gp-nav a').first().waitFor();
 await expect(p.locator('#main .gp-state .gp-spinner')).toHaveCount(0,{timeout:30000});
 const hint=p.locator('.gp-firstrun');if(await hint.isVisible())await hint.getByRole('button',{name:/^(Понятно, начать|Түсінікті, бастау)$/}).click();
 await p.evaluate(async()=>await document.fonts.ready);
}
async function snap(p,name,steps,inputs={},selector=null,clip=null){
 await p.evaluate(async()=>await document.fonts.ready);
 await (selector?p.locator(selector):p).screenshot({path:path.join(out,name+'.png'),animations:'disabled',...(clip?{clip}: {})});
 let text=await p.locator('body').innerText();
 if(await p.locator('green-worker').count())text+='\n'+await p.locator('green-worker').evaluate(el=>el.shadowRoot.innerText);
 await fs.writeFile(path.join(out,name+'.txt'),text);
 m.captures.push({name,url:p.url(),viewport:p.viewportSize(),steps,inputs,selector,clip,sha256:crypto.createHash('sha256').update(await fs.readFile(path.join(out,name+'.png'))).digest('hex')});
 await fs.writeFile(path.join(out,'capture-manifest.json'),JSON.stringify(m,null,2));console.log(name);
}
async function between(p,first,last,name,steps,inputs){
 await first.evaluate(e=>e.scrollIntoView({block:'start'}));await p.evaluate(()=>scrollBy(0,-120));
 const a=await first.boundingBox(),z=await last.boundingBox();
 await snap(p,name,steps,inputs,null,{x:Math.min(a.x,z.x),y:a.y,width:Math.max(a.width,z.width),height:z.y+z.height-a.y});
}
async function readyLab(p){await p.locator('.gp-lab-results[aria-busy=false]').waitFor();await p.locator('.gp-lab-card').first().waitFor();}
async function labShot(p,name,inputs){
 const card=p.locator('.gp-lab-card').first();await card.evaluate(e=>e.scrollIntoView({block:'start'}));await p.evaluate(()=>scrollBy(0,-120));
 const box=await card.boundingBox(),last=await card.locator('[data-testid=water-stress-survival]').boundingBox();
 const metrics=await p.locator('.gp-lab-card').evaluateAll(es=>es.map(e=>({plan:e.dataset.plan,metrics:[...e.querySelectorAll('[data-metric]')].map(n=>({name:n.dataset.metric,value:n.textContent})),zoneIds:[...e.querySelectorAll('[data-site-id]')].map(n=>n.dataset.siteId)})));
 await snap(p,name,['Laboratory, budget 50m, balanced, regular','Water1000; stress50%; rebuild as named'],{...inputs,metrics},null,{x:box.x,y:box.y,width:box.width,height:last.y+last.height-box.y});
}
(async()=>{
 await fs.mkdir(out,{recursive:true});b=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});m.browser=b.version();
 const c=await b.newContext({viewport:{width:1280,height:900},locale:'ru-RU',timezoneId:'Asia/Qyzylorda',acceptDownloads:true});const p=await c.newPage();p.setDefaultTimeout(30000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await open(p,'/map?site='+site);const card=p.locator('.gp-sites__card');await card.getByRole('tab',{name:'Смета',exact:true}).click();await p.locator('.gp-zone[aria-busy=false]').waitFor();await p.locator('section[aria-labelledby="z-cost"] .gp-zone__controls select').selectOption('3');await expect(p.locator('#z-cost')).toContainText('10 825 628');
 await card.getByRole('tab',{name:'Обзор',exact:true}).click();await p.waitForTimeout(1800);await snap(p,'zone-overview-1280',['Map Tolstogo','Select care3','Overview'],{site,...options});
 await card.getByRole('tab',{name:'Смета',exact:true}).click();await p.locator('.gp-zone[aria-busy=false]').waitFor();await expect(p.locator('#z-cost')).toContainText('10 825 628');await snap(p,'estimate-1280',['Смета','Уход3г'],{site,...options});
 await card.getByRole('tab',{name:'Эффект',exact:true}).click();await card.getByRole('heading',{name:'Машина времени',exact:true}).waitFor();const years=card.getByRole('radiogroup',{name:'Год после посадки',exact:true});await years.locator('label').filter({hasText:/^20 лет$/}).click();await p.waitForTimeout(2000);await snap(p,'growth20-1280',['Эффект','20лет'],{site,...options,growthYear:20});await snap(p,'growth20-controls',['Same state, controls'],{site,...options,growthYear:20},'.gp-tm');
 const reportLink=card.getByRole('link',{name:'⤓ Отчёт по зоне (PDF / Excel)',exact:true});m.reportHref=await reportLink.getAttribute('href');await reportLink.click();await p.locator('.gp-report-doc').waitFor();await expect(p.locator('.gp-report-doc')).toContainText('уход 3');m.reportUrl=p.url();
 await p.setViewportSize({width:1440,height:1400});const doc=p.locator('.gp-report-doc');await between(p,doc.locator('h2').nth(1),doc.locator('table').nth(1),'plants-focus',['Actual report link preserves options','Plant composition'],{site,...options});await between(p,doc.locator('h2').nth(2),doc.locator('table').nth(2),'report-estimate-focus',['Same report','Cost section'],{site,...options});
 await p.getByRole('button',{name:'Служебная записка (Word)',exact:true}).click();const memo=p.getByRole('region',{name:'Служебная записка (Word)',exact:true});await memo.getByRole('button',{name:'Скачать .docx',exact:true}).waitFor();
 for(const lang of ['ru','kk']){await memo.locator(`label[lang=${lang}]`).click();await memo.getByRole('listbox').selectOption([site]);await snap(p,'memo-'+lang+'-panel',['Memo Word',lang,'Select Tolstogo'],{site,...options,documentLanguage:lang},'section[aria-label="Служебная записка (Word)"]');}
 await open(p,'/lab');await readyLab(p);await p.getByRole('textbox',{name:/^Лимит воды/}).fill('1000');await p.waitForTimeout(450);await readyLab(p);await labShot(p,'lab-before',{budgetM:50,waterLimit:1000,reductionPct:0,watering:'regular',goal:'balanced'});await p.getByRole('button',{name:'−50%',exact:true}).click();await labShot(p,'lab-stress',{budgetM:50,waterLimit:1000,available:500,reductionPct:50,watering:'regular',goal:'balanced'});await p.getByRole('button',{name:'Перестроить под новый лимит воды',exact:true}).click();await p.waitForTimeout(450);await readyLab(p);await labShot(p,'lab-rebuilt',{budgetM:50,waterLimit:500,reductionPct:0,watering:'regular',goal:'balanced'});
 await open(p,'/outcomes?site='+site);for(const [label,id]of [['Полный осмотр','full'],['Частичный осмотр','partial']]){await p.getByRole('combobox',{name:'Партия растений',exact:true}).selectOption({label});await between(p,p.locator('section[aria-labelledby=outcome-observed]'),p.locator('section[aria-labelledby=outcome-compare]'),'outcomes-'+id,['Outcomes Tolstogo','Cohort '+label,'Observation and comparison'],{site,cohort:id,demo:true});}
 m.pageErrors=errors;await c.close();
 for(const width of [1280,375]){
  const wc=await b.newContext({viewport:{width,height:900},locale:'ru-RU',timezoneId:'Asia/Qyzylorda'});const wp=await wc.newPage();await open(wp,'/');await wp.getByRole('button',{name:'⚙ Режим проверки',exact:true}).click();await wp.getByRole('radio',{name:'Работник',exact:true}).check();await wp.getByRole('button',{name:'Закрыть',exact:true}).last().click();await wp.waitForFunction(()=>{const w=document.querySelector('green-worker');return w?.user&&!w.loading&&!!w.shadowRoot.querySelector('link')?.sheet;});await snap(wp,'worker-'+width,['Mock role worker','Embedded cabinet'],{role:'worker',language:'ru',native:false});await wc.close();
 }
 await fs.writeFile(path.join(out,'capture-manifest.json'),JSON.stringify(m,null,2));await b.close();
})().catch(async e=>{m.error=e.stack;await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'capture-manifest.json'),JSON.stringify(m,null,2));console.error(e);if(b)await b.close();process.exitCode=1;});
