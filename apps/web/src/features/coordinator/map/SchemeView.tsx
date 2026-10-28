import type { CandidateSite } from '../../../shared/api/types';
import { t } from '../../../shared/i18n';
import { AREA, siteCenter } from './geo';
import type { SiteRankItem } from '../../../shared/api/types';
type Elig = SiteRankItem['eligibility'];

// Резервная схема без внешних тайлов: контуры и точки строго по координатам.
// Подписана как схема — улиц и зданий нет, за подробную карту не выдаётся.
const W = 1000;
const kx = Math.cos(((AREA.north + AREA.south) / 2) * (Math.PI / 180));
const H = Math.round((W * (AREA.north - AREA.south)) / ((AREA.east - AREA.west) * kx));
const px = (lng: number) => ((lng - AREA.west) / (AREA.east - AREA.west)) * W;
const py = (lat: number) => ((AREA.north - lat) / (AREA.north - AREA.south)) * H;
const COLORS: Record<Elig, string> = { survey_needed: '#d89a1c', blocked: '#b3261e', planting_candidate: '#2f7a3e' };

export function SchemeView({ sites, eligibility, selectedId, onSelect }: { sites: CandidateSite[]; eligibility: (s: CandidateSite) => Elig; selectedId: string | null; onSelect: (id: string) => void }) {
  const grid = [];
  for (let lat = Math.ceil(AREA.south * 100) / 100; lat <= AREA.north; lat += 0.01) grid.push({ y: py(lat), label: `${lat.toFixed(2)}° с.ш.` });
  const gridX = [];
  for (let lng = Math.ceil(AREA.west * 100) / 100; lng <= AREA.east; lng += 0.01) gridX.push({ x: px(lng), label: `${lng.toFixed(2)}° в.д.` });
  return (
    <figure className="gp-scheme">
      <figcaption className="gp-alert gp-alert--info gp-small"><span aria-hidden="true">ⓘ </span>{t('map.schemeNotice')}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t('map.scheme')}>
        <defs>
          <pattern id="gp-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0L8 8M8 0L0 8" stroke="#b3261e" strokeWidth="1.4" /></pattern>
        </defs>
        <rect width={W} height={H} fill="#fafbf8" />
        {grid.map((g) => <g key={g.label}><line x1={0} x2={W} y1={g.y} y2={g.y} stroke="#dfe5da" /><text x={4} y={g.y - 3} fontSize="11" fill="#7a8578">{g.label}</text></g>)}
        {gridX.map((g) => <g key={g.label}><line y1={0} y2={H} x1={g.x} x2={g.x} stroke="#dfe5da" /><text x={g.x + 3} y={H - 4} fontSize="11" fill="#7a8578">{g.label}</text></g>)}
        {sites.map((s) => {
          const e = eligibility(s);
          const sel = s.id === selectedId;
          const c = siteCenter(s);
          const ring = s.geometry.type === 'Polygon' ? s.geometry.coordinates[0] : null;
          return (
            <g key={s.id} role="button" tabIndex={0} aria-label={`${s.name}, ${t(`elig.${e}`)}`} aria-pressed={sel}
              onClick={() => onSelect(s.id)} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onSelect(s.id))} style={{ cursor: 'pointer' }}>
              {ring && <polygon points={ring.map(([lng, lat]) => `${px(lng)},${py(lat)}`).join(' ')} fill={e === 'blocked' ? 'url(#gp-hatch)' : COLORS[e]} fillOpacity={e === 'blocked' ? 1 : 0.35} stroke={sel ? '#1f5d99' : COLORS[e]} strokeWidth={sel ? 3 : 1.5} strokeDasharray={e === 'survey_needed' ? '5 3' : undefined} />}
              <circle cx={px(c.lng)} cy={py(c.lat)} r={sel ? 7 : 4} fill={COLORS[e]} stroke={sel ? '#1f5d99' : '#fff'} strokeWidth={2} />
              {sel && <text x={px(c.lng) + 10} y={py(c.lat) + 4} fontSize="14" fontWeight="700" fill="#0f2f4f" stroke="#fff" strokeWidth="3" paintOrder="stroke">{s.name}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
