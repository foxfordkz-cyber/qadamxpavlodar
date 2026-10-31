const path=require('node:path'),fs=require('node:fs/promises'),http=require('node:http'),assert=require('node:assert/strict');
if(!process.argv[2]||!process.argv[3])throw new Error('Usage: node verify-offline.cjs <offline package directory> <Playwright test module directory>');
const {chromium,expect}=require(path.resolve(process.argv[3]));
const out=path.resolve(process.argv[2]);
const base='http://127.0.0.1:5194',site='site-osm-1569993037';
const report={sourceSha:'a66d542c63c527d608400c84b34d49f982855369',startedUtc:new Date().toISOString(),url:base,cleanContexts:true,allowedNetworkOrigins:[base],externalRequests:[],localApiResponses:[],checks:[],pageErrors:[],limitations:['External map tiles, photos and network search unavailable; schema fallback is used.','Mock browser data is not a real API operation.','Worker interface inside the cabinet remains Russian; native mobile app not claimed.']};
let browser;
async function save(){await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));}
async function shot(p,name){await p.screenshot({path:path.join(out,'verification',name+'.png'),animations:'disabled'});return 'verification/'+name+'.png';}
async function check(name,fn){try{const details=await fn();report.checks.push({name,pass:true,...details});console.log('PASS '+name);}catch(e){report.checks.push({name,pass:false,error:e.stack});throw e;}finally{await save();}}
async function context(viewport={width:1280,height:900}){
 const c=await browser.newContext({viewport,locale:'ru-RU',timezoneId:'Asia/Qyzylorda',serviceWorkers:'block'});
 await c.route('**/*',async route=>{const u=route.request().url();let origin;try{origin=new URL(u).origin;}catch{}if(origin===base || /^(data|blob):/.test(u))return route.continue();report.externalRequests.push({url:u,resourceType:route.request().resourceType(),blocked:true});return route.abort('internetdisconnected');});
 c.on('page',p=>{p.on('pageerror',e=>report.pageErrors.push(e.message));p.on('response',r=>{if(r.url().startsWith(base+'/api'))report.localApiResponses.push({url:r.url(),status:r.status()});});});
 return c;
}
async function open(p,route='/'){
 await p.goto(base+'/?source=mock&lang=ru#'+route,{waitUntil:'domcontentloaded'});
 await p.locator('nav.gp-nav a').first().waitFor();await expect(p.locator('#main .gp-state .gp-spinner')).toHaveCount(0,{timeout:30000});
 const hint=p.locator('.gp-firstrun');if(await hint.isVisible())await hint.getByRole('button',{name:/^Понятно, начать$/}).click();
}
function rawRequest(requestPath,method='GET',host='127.0.0.1:5194'){
 return new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port:5194,path:requestPath,method,headers:{Host:host}},r=>{const data=[];r.on('data',x=>data.push(x));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(data).toString()}));});q.on('error',reject);q.end();});
}
(async()=>{
 await fs.mkdir(path.join(out,'verification'),{recursive:true});
 await check('static server isolation and MIME',async()=>{
  const files=(await fs.readdir(path.join(out,'site/assets')));const cases=[];
  for(const ext of ['.js','.css','.woff2']){const file=files.find(x=>x.endsWith(ext));const r=await rawRequest('/assets/'+file);assert.equal(r.status,200);const expected={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[ext];assert.ok(r.headers['content-type'].startsWith(expected));cases.push({path:'/assets/'+file,status:r.status,mime:r.headers['content-type']});}
  for(const q of ['/../server.mjs','/%2e%2e/server.mjs','/..%5cserver.mjs','/C:%5cWindows','/runtime/node.exe','/server.mjs','/package-manifest.json']){const r=await rawRequest(q);assert.ok(r.status>=400);cases.push({path:q,status:r.status});}
  for(const method of ['GET','POST']){const r=await rawRequest('/api/municipal/outcomes',method);assert.equal(r.status,503);assert.equal(JSON.parse(r.body).error,'OFFLINE_API_UNAVAILABLE');cases.push({path:'/api/municipal/outcomes',method,status:r.status});}
  const foreign=await rawRequest('/','GET','example.com');assert.equal(foreign.status,403);cases.push({host:'example.com',status:foreign.status});
  return {cases};
 });
 browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});report.browser=browser.version();
 const c=await context(),p=await c.newPage();p.setDefaultTimeout(30000);
 await check('home in clean context without external network',async()=>{await open(p);await expect(p.locator('#main')).toContainText('Павлодар');return {screenshot:await shot(p,'01-home')};});
 await check('Tolstogo schema and cost care3 without tiles',async()=>{
  await open(p,'/map?site='+site);await p.getByRole('radio',{name:'Схема',exact:true}).check();await expect(p.getByRole('group',{name:'Схема',exact:true})).toBeVisible();await expect(p.locator('.gp-map')).toContainText('Это не подробная карта');
  const card=p.locator('.gp-sites__card');await card.getByRole('tab',{name:'Смета',exact:true}).click();await p.locator('.gp-zone[aria-busy=false]').waitFor();await p.locator('section[aria-labelledby="z-cost"] .gp-zone__controls select').selectOption('3');await expect(p.locator('#z-cost')).toContainText('10 825 628');
  return {site,careYears:3,totalKzt:10825628,schema:true,screenshot:await shot(p,'02-tolstogo-schema-care3')};
 });
 await check('laboratory 1000 to 500 and rebuild without API',async()=>{
  await open(p,'/lab');await p.locator('.gp-lab-results[aria-busy=false]').waitFor();await p.getByRole('textbox',{name:/^Лимит воды/}).fill('1000');await p.waitForTimeout(450);await p.locator('.gp-lab-results[aria-busy=false]').waitFor();const card=p.locator('.gp-lab-card').first();await expect(card.locator('[data-metric=zones]')).toHaveText('41');await expect(card.locator('[data-metric=water]')).toHaveText('993,1');await p.getByRole('button',{name:'−50%',exact:true}).click();await expect(card.locator('[data-metric=deficit]')).toHaveText('493,1');await p.getByRole('button',{name:'Перестроить под новый лимит воды',exact:true}).click();await expect(card.locator('[data-metric=zones]')).toHaveText('31');await expect(card.locator('[data-metric=water]')).toHaveText('498,1');await expect(card.locator('[data-metric=deficit]')).toHaveText('0');await card.scrollIntoViewIfNeeded();return {budgetKzt:50000000,waterLimit:[1000,500],zones:[41,31],waterM3:[993.1,498.1],deficitM3:[493.1,0],screenshot:await shot(p,'03-lab-rebuilt')};
 });
 await check('outcomes full and partial observation without API',async()=>{
  await open(p,'/outcomes?site='+site);const select=p.getByRole('combobox',{name:'Партия растений',exact:true});await select.selectOption({label:'Полный осмотр'});await expect(p.locator('section[aria-labelledby=outcome-observed]')).toContainText('84,4%');await expect(p.locator('section[aria-labelledby=outcome-compare]')).toContainText('+1,4');await select.selectOption({label:'Частичный осмотр'});await expect(p.locator('section[aria-labelledby=outcome-compare]')).toContainText('Сравнение пока недоступно');await p.locator('section[aria-labelledby=outcome-observed]').scrollIntoViewIfNeeded();return {full:{actualPct:84.4,forecastPct:83,deltaPp:1.4},partial:{comparisonAvailable:false},demo:true,screenshot:await shot(p,'04-outcomes-partial')};
 });
 await c.close();
 for(const width of [1280,375])for(const role of ['Работник','Бригадир']){
  const wc=await context({width,height:900}),wp=await wc.newPage();await open(wp);await wp.getByRole('button',{name:'⚙ Режим проверки',exact:true}).click();await wp.getByRole('radio',{name:role,exact:true}).check();await wp.getByRole('button',{name:'Закрыть',exact:true}).last().click();await wp.waitForFunction(()=>{const w=document.querySelector('green-worker');return w?.user&&!w.loading&&!!w.shadowRoot.querySelector('link')?.sheet;});const cabinet=wp.locator('green-worker');
  for(const [name,heading,key]of [['Журнал','Журнал работ','Enter'],['Профиль','Карточка сотрудника','Space'],['Смена',role==='Работник'?'Моя смена':'Смена бригады','Enter']])await check(`offline ${role} ${width}px ${name}`,async()=>{const button=cabinet.getByRole('button',{name:new RegExp(name+'$')}).filter({visible:true});await expect(button).toHaveCount(1);await wp.keyboard.press('Tab');await button.focus();const focus=await button.evaluate(e=>getComputedStyle(e).outlineStyle!=='none');await wp.keyboard.press(key);await expect(cabinet.getByRole('heading',{name:heading,exact:true})).toBeVisible();await expect(button).toHaveAttribute('aria-current','page');assert.ok(focus,'visible outline');return {role,width,section:name,keyboard:key,visibleFocus:focus,screenshot:await shot(wp,`worker-${width}-${role==='Работник'?'worker':'foreman'}-${name==='Смена'?'shift':name==='Журнал'?'journal':'profile'}`)};});await wc.close();
 }
 assert.equal(report.pageErrors.length,0);report.finishedUtc=new Date().toISOString();report.passed=true;await save();await browser.close();console.log('DONE '+report.checks.length+' checks');
})().catch(async e=>{report.passed=false;report.error=e.stack;await save();console.error(e);if(browser)await browser.close();process.exitCode=1;});
