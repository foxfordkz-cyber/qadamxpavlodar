import { speciesName } from '../../../shared/i18n';
import { tr } from '../../../shared/i18n';
import { useState } from 'react';
import type { Level, Species } from '../../../shared/api/types';
import { Badge } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { hrefFor } from '../../../shared/router';

export const USE_LABEL: Record<NonNullable<Species['uses']>[number], string> = {
  alley: 'Аллея', yard: 'Двор', square: 'Сквер', hedge: 'Изгородь', flowerbed: 'Клумба', roadside: 'У дороги', greenbelt: 'Зелёный пояс',
};

/** Фото вида с подписью автора и лицензией; без фото — нейтральная заглушка с формой растения. */
export function SpeciesPhoto({ s, small }: { s: Species; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!s.photo || failed)
    return <div className={`gp-spphoto gp-spphoto--none ${small ? 'is-small' : ''}`} aria-hidden="true">{s.form === 'tree' ? '🌳' : s.form === 'shrub' ? '🌿' : '🌸'}</div>;
  return (
    <figure className={`gp-spphoto ${small ? 'is-small' : ''}`}>
      <img src={s.photo.src} alt={speciesName(s)} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      {!small && <figcaption><a href={s.photo.page} target="_blank" rel="noreferrer">{s.photo.author} · {s.photo.license}</a></figcaption>}
    </figure>
  );
}

export function SpeciesThumb({ s }: { s: Species }) {
  return (
    <a className="gp-spthumb" href={hrefFor('/species', { q: s.nameRu })}>
      <SpeciesPhoto s={s} small />
      <span className="gp-spthumb__name">{speciesName(s)}</span>
      <span className="gp-small gp-muted">{t(`species.form.${s.form}` as Key)}{s.pavlodarEvidenceId ? ' · сажают в Павлодаре' : ''}</span>
    </a>
  );
}

const LVL: Record<Level, number> = { low: 1, medium: 2, high: 3 };
function Meter({ label, v }: { label: string; v: Level }) {
  return (
    <div className="gp-meter" aria-label={`${label}: ${t(`species.level.${v}` as Key)}`}>
      <span className="gp-meter__label">{label}</span>
      <span className="gp-meter__dots" aria-hidden="true">{[1, 2, 3].map((i) => <span key={i} className={i <= LVL[v] ? 'on' : ''} />)}</span>
      <span className="gp-meter__val">{t(`species.level.${v}` as Key)}</span>
    </div>
  );
}

export function SpeciesCardFull({ s, onOpen }: { s: Species; onOpen?: () => void }) {
  return (
    <article className="gp-spcard gp-card">
      <SpeciesPhoto s={s} />
      <div className="gp-spcard__body">
        <div className="gp-spcard__badges">
          {s.pavlodarEvidenceId && <Badge tone="ok" icon="✓">{tr("Сажают в Павлодаре")}</Badge>}
          {s.soviet && <Badge tone="neutral" icon="★">{tr("Советская классика")}</Badge>}
          {s.native && <Badge tone="info" icon="◆">{tr("Местный")}</Badge>}
          {s.invasiveRisk && <Badge tone="bad" icon="!">{tr("Инвазивный риск")}</Badge>}
          {s.allergenic && <Badge tone="warn" icon="!">{tr("Аллерген")}</Badge>}
        </div>
        <h3 className="gp-spcard__name">{speciesName(s)}</h3>
        <p className="gp-small gp-muted"><i>{s.latin}</i> · {t(`species.form.${s.form}` as Key)}{s.matureHeightM ? t('dynamic.006', { p0: String(s.matureHeightM[0]), p1: String(s.matureHeightM[1]) }) : ''}</p>
        {!!s.benefits?.length && <p className="gp-spcard__line"><strong>{tr("Польза:")}</strong> {s.benefits.join(' · ')}</p>}
        {!!s.beauty?.length && <p className="gp-spcard__line"><strong>{tr("Красота:")}</strong> {s.beauty.join(' · ')}</p>}
        <div className="gp-spcard__meters">
          <Meter label={tr("Мороз")} v={s.frostHardiness} />
          <Meter label={tr("Засуха")} v={s.droughtTolerance} />
          <Meter label={tr("Соль")} v={s.saltTolerance} />
        </div>
        {!!s.uses?.length && <div className="gp-spcard__uses">{s.uses.map((u) => <span key={u} className="gp-chip">{tr(USE_LABEL[u])}</span>)}</div>}
        {onOpen && <button className="gp-btn gp-btn--ghost gp-spcard__more" onClick={onOpen}>{tr("Подробнее и источники")}</button>}
      </div>
    </article>
  );
}
