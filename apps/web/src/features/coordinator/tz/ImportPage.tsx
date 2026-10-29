import { useState } from 'react';
import { useData } from '../../../shared/api/DataProvider';
import type { ImportPreview } from '../../../shared/api/api';
import { Badge, Button, ErrorNote, useGuarded } from '../../../shared/ui/components';
import { PageHeader } from '../PageHeader';

type Feat = { geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> };

/** Разбор файлов в браузере: GeoJSON, KML, CSV (lat/lng). Shapefile (zip) разбирает сервер (участник 3). */
function parseFile(name: string, text: string): { format: string; features: Feat[] } {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'geojson' || ext === 'json') {
    const j = JSON.parse(text);
    const list = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [];
    return { format: 'geojson', features: list.map((f: Feat) => ({ geometry: f.geometry, properties: f.properties ?? {} })) };
  }
  if (ext === 'kml') {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const marks = [...doc.getElementsByTagName('Placemark')];
    return {
      format: 'kml',
      features: marks.map((m) => {
        const nm = m.getElementsByTagName('name')[0]?.textContent ?? null;
        const coords = (m.getElementsByTagName('coordinates')[0]?.textContent ?? '').trim().split(/\s+/).filter(Boolean).map((c) => c.split(',').slice(0, 2).map(Number));
        const isPoly = m.getElementsByTagName('Polygon').length > 0;
        return { geometry: coords.length ? (isPoly ? { type: 'Polygon', coordinates: [coords] } : coords.length === 1 ? { type: 'Point', coordinates: coords[0] } : { type: 'LineString', coordinates: coords }) : null, properties: { name: nm } };
      }),
    };
  }
  if (ext === 'csv') {
    const [head, ...rows] = text.split(/\r?\n/).filter((l) => l.trim());
    const sep = head.includes(';') ? ';' : ',';
    const cols = head.split(sep).map((c) => c.trim().toLowerCase());
    const li = cols.findIndex((c) => ['lat', 'latitude', 'широта'].includes(c));
    const gi = cols.findIndex((c) => ['lng', 'lon', 'long', 'longitude', 'долгота'].includes(c));
    if (li < 0 || gi < 0) throw new Error('В CSV не найдены колонки широты и долготы (lat, lng).');
    return { format: 'csv', features: rows.map((r) => { const v = r.split(sep); return { geometry: { type: 'Point', coordinates: [Number(v[gi]), Number(v[li])] }, properties: Object.fromEntries(cols.map((c, i) => [c, v[i]])) }; }) };
  }
  throw new Error(ext === 'zip' || ext === 'shp' ? 'Shapefile (zip) разбирается на сервере — загрузите через импорт участника 3 или конвертируйте в GeoJSON.' : `Формат .${ext} не поддерживается.`);
}

export function ImportPage() {
  const { api, mode, bump } = useData();
  const [layer,setLayer]=useState("zones"); const [source,setSource]=useState(""); const [ack,setAck]=useState(false);
  const [dataClass,setDataClass]=useState('demo');
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { run, busy } = useGuarded();
  const onFile = (f: File) => run(async () => {
    setError(null);
    setPreview(null);
    setAck(false);
    setFile(f.name);
    try {
      if(mode==='api'){
        if(f.size>5*1024*1024)throw new Error('Максимум 5 MiB');
        if(source.trim().length<3)throw new Error('Укажите источник и дату данных перед выбором файла');
        const ext=f.name.toLowerCase().split('.').pop(); const format=ext==='zip'?'shp':ext==='json'?'geojson':ext!;
        let content:string;if(format==='shp'){const bytes=new Uint8Array(await f.arrayBuffer());let str='';for(const x of bytes)str+=String.fromCharCode(x);content=btoa(str);}else content=await f.text();
        setPreview(await api.importFile({format,content,layer,source,dataClass}));
      }else{const {format,features}=parseFile(f.name,await f.text());setPreview(await api.importPreview(format,features));}
    } catch (e) { setError(e); }
  });
  return (
    <div className="gp-page">
      <PageHeader eyebrow="Данные AI-карты" title="Импорт и проверка слоёв" lead="Загрузите слой зон, почв или насаждений (GeoJSON, KML, CSV с координатами). Система проверит пропуски, систему координат и пересечения до сохранения." />
      <div className="gp-card gp-import">
        <label>Слой <select value={layer} onChange={e=>setLayer(e.target.value)}><option value="zones">Зоны</option><option value="soils">Почвы</option><option value="greenery">Насаждения</option><option value="city">Город</option><option value="catalog">Каталог растений</option></select></label>
        <label>Источник и дата <input value={source} onChange={e=>setSource(e.target.value)} placeholder="Организатор, название файла, дата" /></label>
        <label>Происхождение данных <select value={dataClass} onChange={e=>setDataClass(e.target.value)}><option value="demo">Тестовые данные</option><option value="estimate">Оценка</option><option value="real">Реальный источник (указан пользователем)</option></select></label>
        <label className="gp-btn gp-btn--primary gp-import__pick">
          Выбрать файл
          <input type="file" accept=".geojson,.json,.kml,.csv,.zip" className="gp-sr" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <span className="gp-small gp-muted">{file ?? 'Файл не выбран'}</span>
        {busy && <span className="gp-spinner" aria-label="Проверка" />}
      </div>
      <ErrorNote error={error} />
      {preview && (
        <section className="gp-card gp-import__res" aria-live="polite">
          <div className="gp-bigstats">
            <div><span className="gp-bigstats__v">{preview.total}</span><span className="gp-small">объектов</span></div>
            <div><span className="gp-bigstats__v">{preview.valid}</span><span className="gp-small">без ошибок</span></div>
            <div><span className="gp-bigstats__v gp-caution">{preview.invalid}</span><span className="gp-small">с ошибками</span></div>
          </div>
          <p className="gp-small gp-muted">{preview.note}</p>
          {preview.issues.length === 0 ? <p>Проблем не найдено.</p> : (
            <table className="gp-table gp-small">
              <thead><tr><th>Строка</th><th>Уровень</th><th>Проблема</th></tr></thead>
              <tbody>{preview.issues.map((x, i) => <tr key={i}><td>{x.row}</td><td>{x.level === 'error' ? <Badge tone="bad" icon="✕">ошибка</Badge> : <Badge tone="warn" icon="!">внимание</Badge>}</td><td>{x.text}</td></tr>)}</tbody>
            </table>
          )}
          {mode==='api'&&<><label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> Предупреждения проверены</label><Button disabled={busy||!preview.id||preview.invalid>0||preview.committed||(preview.issues.length>0&&!ack)} onClick={()=>run(async()=>{try{setPreview(await api.commitImport(preview.id!,ack));bump();}catch(e){setError(e);}})}>{preview.committed?'Слой сохранён':'Подтвердить и сохранить слой'}</Button></>}
        </section>
      )}
    </div>
  );
}
