import { useEffect, useState } from 'react';
import { DEFAULT_PRIORITY_WEIGHTS, PRIORITY_LABEL, type PriorityFactor } from '../../../shared/analytics/city';

// Веса приоритета (ТЗ 3.7.2) общие для карты и страницы «Приоритеты»: подвинули на карте — те же веса на странице.
export const FACTORS = Object.keys(PRIORITY_LABEL) as PriorityFactor[];
export type Weights = Record<PriorityFactor, number>;
const KEY = 'gp-priority-weights';

function read(): Weights {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Weights | null;
    if (v && FACTORS.every((f) => typeof v[f] === 'number')) return v;
  } catch {
    /* без хранилища — веса по умолчанию */
  }
  return DEFAULT_PRIORITY_WEIGHTS;
}

/** weights — для ползунков, debounced — для запроса: пересчёт не на каждый пиксель движения. */
export function usePriorityWeights(delayMs = 300) {
  const [weights, setWeights] = useState<Weights>(read);
  const [debounced, setDebounced] = useState(weights);
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(weights);
      try {
        localStorage.setItem(KEY, JSON.stringify(weights));
      } catch {
        /* не сохраняется — не страшно */
      }
    }, delayMs);
    return () => clearTimeout(id);
  }, [weights, delayMs]);
  const isDefault = FACTORS.every((f) => weights[f] === DEFAULT_PRIORITY_WEIGHTS[f]);
  return { weights, setWeights, debounced, isDefault, reset: () => setWeights(DEFAULT_PRIORITY_WEIGHTS) };
}

export function WeightSliders({ weights, onChange, idPrefix }: { weights: Weights; onChange: (w: Weights) => void; idPrefix: string }) {
  return (
    <>
      {FACTORS.map((f) => (
        <div key={f} className="gp-weight">
          <label htmlFor={`${idPrefix}-${f}`}>{PRIORITY_LABEL[f]} <strong>{weights[f].toFixed(2)}</strong></label>
          <input id={`${idPrefix}-${f}`} type="range" min={0} max={0.5} step={0.05} value={weights[f]} onChange={(e) => onChange({ ...weights, [f]: Number(e.target.value) })} />
        </div>
      ))}
    </>
  );
}
