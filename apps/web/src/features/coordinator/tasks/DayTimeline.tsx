import type { Brigade, Task } from '../../../shared/api/types';
import { t, type Key } from '../../../shared/i18n';
import { fmtTime } from '../../../shared/format';

const FROM = 8; // 08:00 UTC+5
const TO = 18;
const hourOf = (iso: string) => {
  const d = new Date(Date.parse(iso) + 5 * 3600e3);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
};
const pct = (h: number) => `${((Math.min(TO, Math.max(FROM, h)) - FROM) / (TO - FROM)) * 100}%`;

/** Временная шкала смены бригады: полосы заданий, затемнение вне смены. Текстовый список — рядом. */
export function DayTimeline({ brigade, tasks, siteName }: { brigade: Brigade; tasks: Task[]; siteName: (id: string) => string }) {
  const s0 = hourOf(brigade.shiftStart);
  const s1 = hourOf(brigade.shiftEnd);
  const timed = tasks.filter((x) => x.scheduledStart && x.scheduledEnd);
  return (
    <div className="gp-daytl" aria-hidden="true">
      <div className="gp-daytl__axis">
        {Array.from({ length: TO - FROM + 1 }, (_, i) => <span key={i} style={{ left: pct(FROM + i) }}>{String(FROM + i).padStart(2, '0')}</span>)}
      </div>
      <div className="gp-daytl__track">
        <div className="gp-daytl__off" style={{ left: 0, width: pct(s0) }} />
        <div className="gp-daytl__off" style={{ left: pct(s1), right: 0 }} />
        {timed.map((x) => {
          const a = hourOf(x.scheduledStart!);
          const b = hourOf(x.scheduledEnd!);
          const over = b > s1 || a < s0;
          return (
            <div key={x.id} className={`gp-daytl__bar gp-daytl__bar--${x.status} ${over ? 'is-over' : ''}`} style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} title={`${x.id} · ${siteName(x.objectId)} · ${fmtTime(x.scheduledStart)}–${fmtTime(x.scheduledEnd)} · ${t(`status.${x.status}` as Key)}`}>
              <span>{x.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
