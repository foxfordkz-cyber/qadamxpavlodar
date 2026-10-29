import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { fail } from '../v2/core.js';
import type { analyze } from './data.js';
type Analysis=ReturnType<typeof analyze>;
function sections(a:Analysis):[string,(string|number|null)[][]][]{return[
  ['Summary',[['Zone',a.siteId],['Method',`Shared estimates; survival: ${a.provenance.survivalMethod}; not field calibrated`],['Input SHA256',a.provenance.inputHash],['Generated UTC',a.provenance.generatedAt],['Rates version',a.provenance.ratesVersion],['Cost KZT',a.cost.total],['CO2 cost KZT/t',a.costPerTonCo2],['Soil source',JSON.stringify(a.provenance.soilSource)]]],
  ['Estimate',[['Article','KZT','Formula'],...a.cost.items.map(x=>[x.label,x.amount,x.formula])]],
  ['Planting',[['Species','Tier','Quantity'],...a.scheme.map(x=>[x.speciesId,x.tier,x.quantity])]],
  ['Survival',[['Species','Year 1 %','Year 2 %','Year 3 %','Lower','Upper','Risks'],...a.survival.map(x=>[x.speciesId,x.y1,x.y2,x.y3,x.low,x.high,JSON.stringify(x.risks)])]],
  ['Care',[['Month','Operation','Detail','Visits'],...a.care.map(x=>[x.month,x.operation,x.detail,x.visits])]],
  ['Effect',[['Years','CO2 t','O2 t','Rain m3','Cooling C','Canopy m2','Dust kg'],...a.effect.map(x=>[x.years,x.co2t,x.o2t,x.rainM3,x.coolingC,x.canopyM2,x.dustKg])]],
  ['Sources',[['Label','URL','Class'],...a.provenance.sources.map((x:any)=>[x.sourceLabel??'',x.sourceUrl??'',x.dataClass??''])]],
  ['Limitations',[...a.assumptions,...a.missing,...a.careWarnings].map(x=>[x])]
];}
export async function exportAnalysis(a:Analysis,format:'pdf'|'xlsx'):Promise<Buffer>{
  if(format==='xlsx'){
    const book=new ExcelJS.Workbook();book.creator='Green Pavlodar';book.created=new Date();
    for(const[name,rows]of sections(a)){const sheet=book.addWorksheet(name);for(const row of rows)sheet.addRow(row);sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.columns.forEach(c=>{c.width=32;});sheet.eachRow(r=>{r.alignment={wrapText:true,vertical:'top'};});}
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  const font=[process.env.REPORT_FONT,'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/dejavu/DejaVuSans.ttf','C:/Windows/Fonts/arial.ttf'].find(p=>p&&existsSync(p));
  if(!font)fail('REPORT_FONT_MISSING','Install DejaVu Sans or set REPORT_FONT to a Unicode TTF',503);
  return new Promise((resolve,reject)=>{const doc=new PDFDocument({size:'A4',margin:36}),chunks:Buffer[]=[];doc.on('data',c=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.font(font).fontSize(18).text('Green Pavlodar — Zone report');
    for(const[name,rows]of sections(a)){doc.moveDown().fontSize(14).text(name);doc.fontSize(9);for(const row of rows)doc.text(row.map(x=>x===null?'Unknown':String(x)).join(' | '));}doc.end();});
}
