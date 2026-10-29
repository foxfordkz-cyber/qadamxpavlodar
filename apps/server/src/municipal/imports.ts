import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import { XMLParser,XMLValidator } from 'fast-xml-parser';
import { unzipSync } from 'fflate';
import shp from 'shpjs';
import { booleanValid,booleanIntersects,kinks } from '@turf/turf';
import { Store } from '../db.js';
import { fail,hash,now,type User } from '../v2/core.js';
import { species } from './vendor/species.js';

const bool=z.preprocess(v=>v==='true'?true:v==='false'?false:v,z.boolean());
const speciesInput=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),nameRu:z.string().min(1).max(200),latin:z.string().min(1).max(200),form:z.enum(['tree','shrub','flower']),evergreen:bool,frostHardiness:z.enum(['low','medium','high']),droughtTolerance:z.enum(['low','medium','high']),saltTolerance:z.enum(['low','medium','high']),minAreaM2:z.coerce.number().nonnegative().max(1e9),native:bool,invasiveRisk:bool,allergenic:bool,notes:z.array(z.string()).default([]),uses:z.array(z.string()).default([]),evidenceIds:z.array(z.string()).default([]) ,pricePerUnitKzt:z.number().nonnegative().max(1e9).nullable().optional(),crownDiameterM:z.number().positive().max(200).nullable().optional(),spacingM:z.number().positive().max(200).nullable().optional(),matureHeightM:z.tuple([z.number().nonnegative(),z.number().nonnegative()]).refine(x=>x[0]<=x[1]).nullable().optional(),careLevel:z.enum(['low','medium','high']).nullable().optional(),floweringMonths:z.array(z.number().int().min(1).max(12)).max(12).nullable().optional(),unit:z.enum(['pcs','pcs_per_m2']).optional(),benefits:z.array(z.string()).max(30).optional(),beauty:z.array(z.string()).max(30).optional()});

export const importInput=z.object({format:z.enum(['geojson','csv','kml','shp']),layer:z.enum(['zones','soils','greenery','city','catalog']).default('zones'),features:z.array(z.unknown()).max(1000).optional(),content:z.string().max(8_000_000).optional(),source:z.string().trim().min(3).max(1000).default('User supplied; source not verified'),sourceUrl:z.url().max(2000).optional(),observedAt:z.iso.datetime({offset:true}).optional(),dataClass:z.enum(['real','demo','estimate']).default('demo'),crs:z.literal('EPSG:4326').default('EPSG:4326')}).strict().refine(b=>(b.features!==undefined)!==(b.content!==undefined),'Supply features OR content');
export type ImportInput=z.infer<typeof importInput>;
export type Feature={type:'Feature';geometry:any;properties:Record<string,unknown>};
const list=(x:any):any[]=>x===undefined?[]:Array.isArray(x)?x:[x];
const coords=(s:unknown)=>String(s??'').trim().split(/\s+/).filter(Boolean).map(p=>p.split(',').slice(0,2).map(Number));
function kmlFeatures(content:string):Feature[]{
  if(/<!DOCTYPE|<!ENTITY/i.test(content))fail('UNSAFE_XML','DTD and entities are forbidden',400);
  if(XMLValidator.validate(content)!==true)fail('INVALID_KML','Malformed KML',400);
  const root=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:false}).parse(content);
  const result:Feature[]=[];
  const walk=(node:any,depth=0)=>{if(depth>30)fail('KML_DEPTH','KML nesting exceeds 30',400);if(!node||typeof node!=='object')return;
    for(const mark of list(node.Placemark)){
      let geometry:any=null;
      if(mark.Point)geometry={type:'Point',coordinates:coords(mark.Point.coordinates)[0]};
      if(mark.LineString)geometry={type:'LineString',coordinates:coords(mark.LineString.coordinates)};
      if(mark.Polygon)geometry={type:'Polygon',coordinates:[coords(mark.Polygon.outerBoundaryIs?.LinearRing?.coordinates),...list(mark.Polygon.innerBoundaryIs).map(x=>coords(x.LinearRing?.coordinates))]};
      result.push({type:'Feature',geometry,properties:{name:String(mark.name??'')}});
    }
    for(const [key,value]of Object.entries(node))if(key!=='Placemark')for(const child of list(value))walk(child,depth+1);
  };walk(root);return result;
}
export async function decode(b:ImportInput):Promise<any[]> {
  if(b.features)return b.features;
  const content=b.content!;
  try{
    if(b.format==='geojson'){const j=JSON.parse(content);if(j.crs&&!JSON.stringify(j.crs).match(/4326|CRS84/))fail('INVALID_CRS','Reproject to EPSG:4326',400);return j.type==='FeatureCollection'?j.features:j.type==='Feature'?[j]:fail('INVALID_GEOJSON','FeatureCollection or Feature required',400);}
    if(b.format==='csv'){
      const rows=parse(content,{columns:true,bom:true,skip_empty_lines:true,delimiter:content.split('\n')[0]!.includes(';')?';':',',max_record_size:100_000}) as Record<string,string>[];
      return rows.map(r=>{const lng=r.lng??r.lon??r.longitude,lat=r.lat??r.latitude;return {type:'Feature',geometry:{type:'Point',coordinates:[lng?.trim()?Number(lng):NaN,lat?.trim()?Number(lat):NaN]},properties:r};});
    }
    if(b.format==='kml')return kmlFeatures(content);
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(content))fail('INVALID_ARCHIVE','Expected base64 ZIP',400);
    const zip=Buffer.from(content,'base64');if(zip.length>5*1024*1024)fail('FILE_TOO_LARGE','ZIP limit 5 MiB',413);
    let total=0,count=0;
    const entries=unzipSync(zip,{filter:f=>{total+=f.originalSize;count++;if(count>20||total>20*1024*1024||f.name.includes('..')||/^[\\/]|:/.test(f.name))fail('UNSAFE_ARCHIVE','Archive entries/size/path limit',400);return true;}});
    const names=Object.keys(entries);const main=names.filter(n=>n.toLowerCase().endsWith('.shp'));
    if(main.length!==1)fail('INVALID_ARCHIVE','ZIP must contain one shapefile',400);
    const stem=main[0]!.slice(0,-4);if(!names.some(n=>n.toLowerCase()===`${stem}.dbf`.toLowerCase())||!names.some(n=>n.toLowerCase()===`${stem}.prj`.toLowerCase()))fail('MISSING_CRS','SHP requires .dbf and .prj',400);
    const parsed=await shp(zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength));
    return list(parsed).flatMap(x=>x.features);
  }catch(e){if(e instanceof Error&&'status'in e)throw e;fail('INVALID_IMPORT','Cannot parse import file',400);}
}
export function preview(s:Store,a:User,b:ImportInput,raw:any[]) {
  if(!Array.isArray(raw)||raw.length===0||raw.length>1000)fail('IMPORT_LIMIT','Use 1–1000 features per import',400);
  const issues:{row:number;level:'error'|'warning';text:string}[]=[],features:Feature[]=[],seen=new Set<string>(),fingerprints:string[]=[];
  const add=(row:number,level:'error'|'warning',text:string)=>issues.push({row,level,text});
  let vertexCount=0;
  raw.forEach((item,i)=>{
    const row=i+1;
    const f:Feature={type:'Feature',geometry:item?.geometry??null,properties:item?.properties??{}};features.push(f);
    if(b.layer==='catalog'){const p=speciesInput.safeParse(f.properties);if(!p.success)add(row,'error','Catalog fields missing or invalid: '+p.error.issues.map(x=>x.path.join('.')).join(', '));else f.properties=p.data;const key=String(f.properties.id);const stored=s.get("SELECT data FROM municipal_state WHERE key='species'");const known=stored?JSON.parse(String(stored.data)):species;if(known.some((x:any)=>x.id===key)||seen.has(key)||s.get("SELECT id FROM municipal_features WHERE layer='catalog' AND fingerprint=?",key))add(row,'error','Duplicate species ID; updates require separate review');seen.add(key);fingerprints.push(key);return;}

    if(!f.properties||Array.isArray(f.properties)||typeof f.properties!=='object')add(row,'error','Properties must be an object');
    if(!['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'].includes(f.geometry?.type)){add(row,'error','Unsupported or missing geometry');fingerprints.push('');return;}
    if(b.layer==='zones'&&!['Point','Polygon','MultiPolygon'].includes(f.geometry.type))add(row,'error','Zones require Point, Polygon or MultiPolygon');
    if(b.layer==='soils'&&!['Polygon','MultiPolygon'].includes(f.geometry.type))add(row,'error','Soils require Polygon or MultiPolygon');
    const points:number[][]=[];
    const flatten=(v:any,depth=0)=>{if(depth>5||!Array.isArray(v)||!v.length)throw Error();if(typeof v[0]==='number'){if(v.length<2||v.length>3||v.some((n:any)=>!Number.isFinite(n))||Math.abs(v[0])>180||Math.abs(v[1])>90)throw Error();points.push(v);if(points.length>500||++vertexCount>10000)fail('GEOMETRY_LIMIT','Maximum 500 vertices per feature / 10000 per batch',413);}else v.forEach((c:any)=>flatten(c,depth+1));};
    try{flatten(f.geometry.coordinates);if(!booleanValid(f as any))throw Error();if(f.geometry.type.includes('Polygon')&&kinks(f as any).features.length)throw Error();}catch{add(row,'error','Invalid geometry, ring, intersection or coordinates; use WGS84 [lng,lat]');}
    if(points.some(p=>p[0]!<60&&p[1]!>70))add(row,'error','Likely swapped latitude/longitude');
    else if(points.some(p=>p[0]!<75||p[0]!>79||p[1]!<51||p[1]!>53.5))add(row,'warning','Outside Pavlodar area; verify coordinates');
    if(!f.properties?.name)add(row,'warning','Missing name');
    if(b.layer==='soils'&&(!['none','low','medium','high'].includes(String(f.properties.salinity))||f.properties.ph===null||f.properties.ph===undefined||String(f.properties.ph).trim()===''||!Number.isFinite(Number(f.properties.ph))||Number(f.properties.ph)<0||Number(f.properties.ph)>14))add(row,'error','Soils require salinity none/low/medium/high and numeric ph in 0..14');
    const fingerprint=hash(f.geometry);fingerprints.push(fingerprint);
    if(seen.has(fingerprint)||s.get('SELECT id FROM municipal_features WHERE layer=? AND fingerprint=?',b.layer,fingerprint))add(row,'error','Duplicate geometry in file or existing layer');seen.add(fingerprint);
  });
  if(vertexCount>10000)fail('GEOMETRY_LIMIT','Maximum 500 vertices per feature / 10000 per batch',413);
  const bad=new Set(issues.filter(x=>x.level==='error').map(x=>x.row));
  // Bound exact intersection checks to small batches; never claim an unchecked large layer is clean.
  if(b.layer==='catalog'){}else if(features.length>150)add(0,'warning','Inter-feature intersection check limited to batches of 150; split the layer for full checking');
  else for(let i=0;i<features.length;i++)for(let j=i+1;j<features.length;j++)if(!bad.has(i+1)&&!bad.has(j+1)&&features[i]!.geometry.type.includes('Polygon')&&features[j]!.geometry.type.includes('Polygon')&&booleanIntersects(features[i] as any,features[j] as any))add(i+1,'warning',`Touches or intersects feature ${j+1}`);
  const id=randomUUID(),createdAt=now(),expiresAt=new Date(Date.now()+3600_000).toISOString();
  const data={id,format:b.format,layer:b.layer,total:raw.length,valid:raw.length-bad.size,invalid:bad.size,issues,committed:false,note:'Preview only. Commit all valid rows explicitly; warnings require acknowledgement.',version:1,source:b.source,sourceUrl:b.sourceUrl??null,observedAt:b.observedAt??null,dataClass:b.dataClass,features,fingerprints};
  s.run('DELETE FROM municipal_imports WHERE committed_at IS NULL AND expires_at<?',createdAt);
  if(Number(s.get('SELECT count(*) AS n FROM municipal_imports WHERE owner_id=? AND committed_at IS NULL',a.id)!.n)>=10)fail('PREVIEW_LIMIT','Maximum 10 active previews per account',429);
  s.run('INSERT INTO municipal_imports VALUES (?,?,?,?,?,NULL)',id,a.id,JSON.stringify(data),createdAt,expiresAt);
  return publicPreview(data);
}
export const publicPreview=(d:any)=>{const{features,fingerprints,...rest}=d;return rest;};
export function commit(s:Store,a:User,id:string,acknowledgeWarnings:boolean){
  const row=s.get('SELECT * FROM municipal_imports WHERE id=? AND owner_id=?',id,a.id);if(!row)fail('NOT_FOUND','Preview not found',404);
  const d=JSON.parse(String(row.data));if(row.committed_at)return publicPreview(d);
  if(String(row.expires_at)<now())fail('PREVIEW_EXPIRED','Run preview again');
  if(d.invalid)fail('IMPORT_ERRORS','Fix invalid rows before commit');
  if(d.issues.length&&!acknowledgeWarnings)fail('ACK_REQUIRED','Acknowledge preview warnings explicitly');
  for(let i=0;i<d.features.length;i++){
    if(s.get('SELECT id FROM municipal_features WHERE layer=? AND fingerprint=?',d.layer,d.fingerprints[i]))fail('IMPORT_DUPLICATE','Layer changed since preview; preview again');
    const feature={...d.features[i],properties:{...d.features[i].properties,id:d.layer==='catalog'?d.features[i].properties.id:randomUUID(),source:d.source,sourceUrl:d.sourceUrl,observedAt:d.observedAt,dataClass:d.dataClass,importedAt:now()}};
    s.run('INSERT INTO municipal_features VALUES (?,?,?,?,?)',feature.properties.id,d.layer,d.fingerprints[i],JSON.stringify(feature),id);
  }
  d.committed=true;d.version=2;s.run('UPDATE municipal_imports SET committed_at=?,data=? WHERE id=?',now(),JSON.stringify(d),id);return publicPreview(d);
}
