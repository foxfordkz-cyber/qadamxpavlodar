import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const workspaceDir='C:/Users/User/Documents/Codex/2026-10-31/https-github-com-foxfordkz-cyber-qadamxpavlodar';
const build=path.join(workspaceDir,'work/final-media/build');
const out=path.join(workspaceDir,'work/final-media/exports');
const cap=path.join(workspaceDir,'work/final-media/captures');
const old=cap;
const SKILL_DIR='C:/Users/User/.codex/plugins/cache/openai-primary-runtime/presentations/26.1026.10807/skills/presentations';
const runtime='C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=path.join(runtime,'node/node_modules');
const sha='a66d542c63c527d608400c84b34d49f982855369';
const p=Presentation.create({slideSize:{width:1600,height:900}});
const C={bg:'#F6F6EF',ink:'#18392D',green:'#267250',muted:'#54685F',warm:'#805414'};
const manifest=[];
function tx(s,text,x,y,w,h,size=32,color=C.ink,bold=false){const e=s.shapes.add({geometry:'textbox',name:text.slice(0,45),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});e.text=text;e.text.style={fontSize:size,typeface:'Arial',color,bold,autoFit:'none',insets:0,wrap:'square'};return e;}
function slide(title,n){const s=p.slides.add();s.background.fill=C.bg;tx(s,title,64,48,1472,85,50,C.ink,true);tx(s,`Демонстрация · a66d542 · mock · ${n}/9`,64,850,1472,28,20,C.muted);return s;}
async function pic(s,dir,file,x,y,w,h,crop){const source=path.join(dir,file);const bytes=await fs.readFile(source);s.images.add({blob:new Uint8Array(bytes),contentType:'image/png',alt:`Реальный UI a66d542, mock: ${file}`,fit:'contain',position:{left:x,top:y,width:w,height:h},...(crop?{crop}: {})});manifest.push({slide:p.slides.items.length,source,filename:file,crop:crop??null});}
function notes(s,text,files=[]){s.speakerNotes.text=`Демонстрационный пакет, 31.10.2026. Рабочий тайминг 5 минут, регламент организатора неизвестен. Версия кода пакета закреплена, независимая приёмка не заявляется. База ${sha}. Source=mock.\n\n${text}\n\nИсточники: ${files.join('\n')}\nОтдельное согласование Айданой не заявляется. Фактические UI-кадры и входы закреплены в manifest этого пакета.`;}

// 1
{
const s=p.slides.add();s.background.fill='#164D3A';
tx(s,'Green Pavlodar',90,175,1400,115,88,'#FFFFFF',true);
tx(s,'Планирование озеленения\nна примере участка в Павлодаре',95,330,1280,125,44,'#E7ECDD');
tx(s,'Дамир   Бекзат   Айдана   Танирберди',95,570,1370,60,32,'#FFFFFF');
tx(s,'Демонстрация · 31.10.2026',95,715,1350,42,29,'#E7ECDD');
tx(s,'a66d542 · mock · расчётные оценки и демонстрационная история',95,778,1400,55,24,'#E7ECDD');
notes(s,'0:00–0:10, Дамир. «Green Pavlodar помогает обосновать озеленение: выбрать участок, оценить посадку и уход, затем сопоставить прогноз с наблюдением». Назвать mock. Рабочие пять минут не являются подтверждённым регламентом организатора.',[`${old}/capture-manifest.json`]);
}
// 2
{
const s=slide('Участок на улице Толстого',2);
await pic(s,old,'zone-overview-1280.png',55,157,850,665,{left:0,top:0.13,right:0.36,bottom:0.02});
tx(s,'3 782 м²',950,175,580,86,61,C.green,true);
tx(s,'Контур участка из OpenStreetMap',950,275,550,90,33);
tx(s,'Демонстрационный пример\nрядом с жильём и социальными объектами',950,400,550,135,33);
tx(s,'Осмотр и разрешение на посадку\nподтверждает человек',950,590,550,110,33,C.warm);
tx(s,'site-osm-1569993037',950,760,580,35,24,C.muted);
notes(s,'0:10–0:35, Дамир. До 0:20 обзор и контур Толстого, затем 0:20–0:35 команды «нарисуй зону» / «аймақ сыз»: активировать рисование и отменить без создания новой зоны. Площадь 3 782 м² по OSM. Участок выбран как воспроизводимый пример, не самый приоритетный в городе. Контур и окружение OSM не подтверждают права на землю. Почва, проверки и история в mock демонстрационные.',[`${old}/zone-overview-1280.txt`]);
}
// 3
{
const s=slide('Подбор растений и ограничения',3);
tx(s,'1 345 растений',80,180,800,85,62,C.green,true);
tx(s,'54 дерева\n270 кустарников\n1 021 цветок',80,295,520,195,40);
tx(s,'«Оптимальный»\nСквер · все ярусы\nДоля вида в ярусе до 30%',80,540,520,140,30);
tx(s,'Почва синтетическая: pH 8,6, сильное засоление. Нужен осмотр.',80,760,1440,60,30,C.warm);
await pic(s,cap,'plants-focus.png',630,333,900,390,{left:0,top:0,right:0.535,bottom:0.554});

notes(s,'0:35–1:00, Дамир. Показать растения:1 345 всего,54 дерева,270 кустов,1 021 цветочное растение. Входы: сквер, optimal, все ярусы, maxShare 0.30, уход 3 года, регулярный полив, без улучшения почвы. Подбор показывает ограничения справочника. У ели виден риск засоления. Синтетическая почва не заменяет осмотр. Перейти к смете без смены входов.',[`${old}/plants-focus.txt`,`${cap}/plants-focus.png`]);
}
// 4
{
const s=slide('Смета участка: уход на 3 года',4);
tx(s,'10 825 628 ₸',75,170,820,90,62,C.green,true);
tx(s,'«Оптимальный» · сквер · все ярусы',75,265,850,50,30,C.muted);
const vals=[['Статья','Сумма, ₸'],['Посадочный материал','2 093 100'],['Подготовка почвы и участка','4 765 320'],['Посадка и доставка','1 072 968'],['Полив и уход, 3 года','2 565 450'],['Резерв на замену','328 790'],['Итого','10 825 628']];
const table=s.tables.add({rows:7,columns:2,left:75,top:340,width:820,height:370,columnWidths:[565,255],values:vals});
table.borders.assign({fill:'#D4DED1',width:1,style:'solid'});
for(let r=0;r<7;r++){table.rows[r].height=r===0?44:54;for(let c=0;c<2;c++){const cell=table.getCell(r,c);cell.fill=r===0?'#164D3A':(r===6?'#E1EADB':'#F6F6EF');cell.text.style={typeface:'Arial',fontSize:27,color:r===0?'#FFFFFF':C.ink,bold:r===0||r===6,insets:8};}}
await pic(s,old,'estimate-1280.png',965,165,540,565,{left:0.647,top:0.414,right:0.02,bottom:0.14});
tx(s,'Цены из демо-справочника.\nДля проекта нужны действующие расценки.',75,755,1440,68,28,C.warm);
notes(s,'1:00–1:30, Бекзат. «Оптимальный», уход 3 года, регулярный полив, без улучшения почвы, все ярусы. Сумма пяти статей 10 825 628 ₸, уход 2 565 450 ₸. Цены демонстрационные. Показать допущения и отсутствующие данные. В Outcomes отдельное сравнение только деревьев за 3 года, его сумма не равна смешанной смете этой зоны.',[`${old}/estimate-1280.txt`,`${cap}/report-estimate-focus.txt`]);
}
// 5
{
const s=slide('Рост посадок на карте',5);
await pic(s,cap,'growth20-1280.png',55,157,890,660,{left:0.005,top:0.13,right:0.36,bottom:0.02});
tx(s,'Посадка, 5, 10 и 20 лет',1000,180,520,100,36,C.green,true);
tx(s,'Через 20 лет:\n1 976 м² кроны',1000,350,530,150,47);
tx(s,'Оценка по справочникам\nи прогнозу приживаемости',1000,555,530,95,31);
tx(s,'Условная раскладка.\nТочный план требует проекта.',1000,718,530,85,29,C.warm);
notes(s,'1:30–1:55, Дамир. На вкладке «Эффект» показать посадку и 20 лет.1 976 м² кроны — расчётная оценка. Положение растений условное.324 древесных растения —54 дерева+270 кустов, это не общий состав 1 345. Оценка не гарантирует приживаемость и не является измеренным охлаждением.',[`${cap}/growth20-1280.txt`,`${cap}/capture-manifest.json`]);
}
// 6
{
const s=slide('Служебная записка на русском и казахском',6);
tx(s,'Один участок и одинаковые параметры расчёта',70,153,1450,55,34,C.green,true);
tx(s,'Русский',75,240,680,60,38,C.ink,true);
tx(s,'Қазақша',835,240,680,60,38,C.ink,true);
await pic(s,cap,'memo-ru-panel.png',75,325,680,385,{left:0,top:0.20,right:0.65,bottom:0});
await pic(s,cap,'memo-kk-panel.png',835,325,680,385,{left:0,top:0.20,right:0.65,bottom:0});
tx(s,'Одинаковые входы: «Оптимальный», 3 года ухода, 10 825 628 ₸.',75,755,1440,65,30,C.warm);
notes(s,'1:55–2:25, Бекзат. Открыть отчёт по ссылке из карточки, сохраняющей параметры:optimal, careYears 3. Сверить сумму 10 825 628 ₸. Раскрыть «Служебная записка(Word)», выбрать только Толстого, скачать Рус, затем Қаз. Язык документа отдельный. На защите показать заранее открытые проверенные файлы. Экспорт не означает утверждение документа акиматом.',[`${cap}/memo-ru-panel.png`,`${cap}/memo-kk-panel.png`, `${workspaceDir}/outputs/defense-final/documents/green-pavlodar-memo-ru-a66d542.docx`, `${workspaceDir}/outputs/defense-final/documents/green-pavlodar-memo-kk-a66d542.docx`]);
}
// 7

{
const s=slide('Кабинет работника в адаптивном вебе',7);
await pic(s,cap,'worker-1280.png',65,185,1000,615,{left:0,top:0.09,right:0,bottom:0.08});
await pic(s,cap,'worker-375.png',1180,185,265,575);
tx(s,'Смена / Журнал / Профиль при 1280 и 375 px',70,137,1440,42,30,C.green,true);
tx(s,'Учебные задания. Внутри кабинета русский интерфейс, перевод KK частичный.',70,805,1480,38,27,C.warm);
notes(s,'2:25–2:55, Танирберди. Показать Смена/Журнал/Профиль при 1280 и 375 CSSpx, реальный клавиатурный фокус. Это адаптивное веб-приложение. Mock-кабинет и основной mock имеют отдельные учебные хранилища, поэтому показ не доказывает выполнение этой конкретной посадки. Внутренний интерфейс остаётся русским при KK-оболочке. Физический телефон и выпуск native APK не заявляются.',[`${cap}/worker-1280.png`,`${cap}/worker-375.png`]);
}

// 8

{
const s=slide('Лаборатория: ограничение воды',8);
tx(s,'50 млн ₸ · обычный полив',70,155,1470,55,34,C.green,true);
tx(s,'Доступная вода\n1 000, затем 500 м³/сезон',70,250,590,150,45);
tx(s,'После перестроения:\n31 зона вместо 41\n498,1 м³ вместо 993,1\nДефицит воды: 0 м³',70,450,640,215,34);
tx(s,'Показатели расчётные.\nЖадный отбор не гарантирует\nматематический оптимум.',70,710,610,110,28,C.warm);
tx(s,'Больше сохранившихся деревьев',780,180,735,45,28,C.green,true);
await pic(s,cap,'lab-rebuilt.png',780,225,710,565,{left:0,top:0.22,right:0,bottom:0.42});
notes(s,'2:55–3:25, Айдана. Лаборатория:50 млн₸, balanced, обычный полив, careYears 3, вода 1000 м³. Сокращение 50% даёт 500 м³ и дефицит 493,1 м³ у прежнего состава. Нажать «Перестроить под новый лимит воды». Первая стратегия:41→31 зона,301→160 высаживаемых деревьев,993,1→498,1 м³/сезон, стоимость 45 306 446→22 743 049 ₸, ожидаемые 243→129. Это отдельный многозонный расчёт. Жадный отбор не гарантирует математический оптимум.',[`${cap}/capture-manifest.json`,`${cap}/lab-rebuilt.png`]);
}
// 9

{
const s=slide('Прогноз и факт: полнота осмотра',9);
tx(s,'Демо-история · стоимость только деревьев за 3 года',70,150,1470,48,30,C.green,true);
tx(s,'«Эконом»: 152 963 ₸ за ожидаемо сохранившееся дерево — оценка',70,209,1460,48,33);
tx(s,'Полный осмотр: 84,4% (27 из 32) · прогноз 83% за 1 год · +1,4 п.п.',70,266,1460,48,33);
tx(s,'Частичный осмотр: неизвестные состояния не считаются погибшими',70,325,1460,42,28,C.green,true);
await pic(s,cap,'outcomes-partial.png',70,378,1460,362,{left:0,top:0.18,right:0,bottom:0.14});
tx(s,'Синтетическая модель. Вымышленная история и +1,4 п.п. не доказывают точность.\nДля пилота нужны полевые осмотры, нормы и подтверждённые исходные данные.',70,770,1460,70,28,C.warm);
notes(s,'3:25–4:35, Айдана. Outcomes: Толстого, только деревья, стоимость за 3 года. Сначала экономический выбор: Эконом 3 854 660 ₸,25,2 ожидаемого дерева,152 962,70 ₸/ожидаемое дерево; на слайде округлено до 152 963 ₸. Сохранить прогноз и показать сохранённый снимок. Полный учебный осмотр 15.10.2026:32 всего,27 живы,5 погибли,84,4%, исходный прогноз 83%за 1 год,+1,4 п.п. Затем частичный осмотр:16 из 32 осмотрены,15 состояний известны,13 живы,2 погибли,17 неизвестно включая 16 неосмотренных. Показатель всей партии и сравнение не рассчитываются. Неизвестные не погибшие. История не форма нового осмотра. Модель обучена на синтетике, не калибрована на Павлодаре. 4:35–4:50 Дамир: для пилота нужны данные, утверждённые нормы, обследования и права доступа. 4:50–5:00 резерв. Регламент и независимое согласование команды не заявляются.',[`${old}/outcomes-full.txt`,`${cap}/outcomes-partial.txt`]);
}
await fs.mkdir(out,{recursive:true}); await fs.mkdir(path.join(build,'renders'),{recursive:true});
for(const [i,s] of p.slides.items.entries()){
 const b=await p.export({slide:s,format:'png',scale:1});
 await fs.writeFile(path.join(build,'renders',`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await b.arrayBuffer()));
 console.log(`render ${i+1}/9`);
}
await fs.writeFile(path.join(build,'deck.proto.json'),JSON.stringify(p.toProto()));
await fs.writeFile(path.join(build,'slide-sources.json'),JSON.stringify({status:'synchronized demonstration package; independent acceptance not claimed',sha,source:'mock',slides:manifest},null,2));
const candidatePath=path.join(build,'candidate.pptx');
await (await PresentationFile.exportPptx(p)).save(candidatePath);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL_DIR,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({workspaceDir,candidatePath,finalPath:path.join(out,'green-pavlodar-defense-a66d542-v3.pptx'),pythonExecutable:path.join(runtime,'python/python.exe'),integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit','--require-native-table-slide','4'],explicitTotalSlideCount:9,requiredNativeTableOwnerSlides:[4],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:path.join(build,'finalizer-validation-v3.json')});
console.log(JSON.stringify(result));
