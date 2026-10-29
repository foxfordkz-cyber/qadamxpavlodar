import { useState } from 'react';
import { useData } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { CandidateSite, CheckKey, CheckState } from '../../../shared/api/types';
import { Button, CheckBadge, ErrorNote, Field, useGuarded } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { CHECK_KEYS } from './eligibility';

type Draft = Record<CheckKey, { state: CheckState; comment: string }>;

const fromSite = (s: CandidateSite): Draft =>
  Object.fromEntries(CHECK_KEYS.map((k) => [k, { state: s.checks[k].state, comment: '' }])) as Draft;

export function ChecksForm({ site, onSaved, onCancel }: { site: CandidateSite; onSaved: () => void; onCancel: () => void }) {
  const { api } = useData();
  const [base, setBase] = useState(site);
  const [draft, setDraft] = useState<Draft>(() => fromSite(site));
  const [water, setWater] = useState<string>(site.factors.waterAvailability.value?.toString() ?? '');
  const [waterNote, setWaterNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<CandidateSite | null>(null);
  const [saved, setSaved] = useState<CandidateSite | null>(null);
  const { run, busy } = useGuarded();

  const changedChecks = CHECK_KEYS.filter((k) => draft[k].state !== base.checks[k].state || draft[k].comment.trim());
  const waterChanged = water.trim() !== (base.factors.waterAvailability.value?.toString() ?? '');

  const validate = () => {
    const e: Record<string, string> = {};
    for (const k of changedChecks) if (draft[k].state !== 'unknown' && !draft[k].comment.trim()) e[k] = t('checks.commentRequired');
    if (waterChanged) {
      const v = Number(water);
      if (water.trim() && (!Number.isFinite(v) || v < 0 || v > 100)) e.water = t('checks.waterRange');
      if (!waterNote.trim()) e.waterNote = t('checks.waterSource');
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = () =>
    run(async () => {
      setError(null);
      if (!validate()) return;
      try {
        const res = await api.patchSite(base.id, {
          expectedVersion: base.version,
          checks: Object.fromEntries(changedChecks.map((k) => [k, { state: draft[k].state, comment: draft[k].comment }])),
          ...(waterChanged ? { waterAvailability: { value: water.trim() ? Number(water) : null, note: waterNote } } : {}),
        });
        setSaved(res);
      } catch (e) {
        if (e instanceof ApiError && e.isConflict) {
          try {
            setConflict(await api.site(base.id));
          } catch {
            /* показываем общую ошибку ниже */
          }
        }
        if (e instanceof ApiError && e.details && typeof e.details === 'object' && 'field' in e.details) {
          setErrors({ [String((e.details as { field: string }).field).replace('checks.', '').replace('.comment', '')]: e.message });
        }
        setError(e);
      }
    });

  if (saved)
    return (
      <div>
        <div className="gp-alert gp-alert--ok" role="status"><span aria-hidden="true">✓ </span>{t('checks.saved', { v: saved.version })}</div>
        <ul>{CHECK_KEYS.map((k) => <li key={k}>{t(`check.${k}` as Key)}: <CheckBadge state={saved.checks[k].state} /></li>)}</ul>
        <Button variant="primary" onClick={onSaved}>{t('common.close')}</Button>
      </div>
    );

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <p className="gp-small gp-muted">{t('site.checksNote')}</p>
      {conflict && (
        <div className="gp-alert gp-alert--warn" role="alert">
          <strong>{t('conflict.title')}.</strong> {t('conflict.text', { v: conflict.version })}
          <ul className="gp-small">
            {CHECK_KEYS.filter((k) => conflict.checks[k].state !== base.checks[k].state || conflict.checks[k].comment !== base.checks[k].comment).map((k) => (
              <li key={k}>{t(`check.${k}` as Key)}: {t('checks.onServer')} <CheckBadge state={conflict.checks[k].state} /> {conflict.checks[k].comment ?? ''} ({conflict.checks[k].checkedBy ?? '—'})</li>
            ))}
          </ul>
          <Button type="button" onClick={() => { setBase(conflict); setConflict(null); setError(null); }}>{t('conflict.reload')}</Button>
          <div className="gp-small">{t('conflict.reloadHint')} {t('checks.keptInputs')}</div>
        </div>
      )}
      {CHECK_KEYS.map((k) => (
        <fieldset key={k} className="gp-fieldset">
          <legend>{t(`check.${k}` as Key)} <span className="gp-muted gp-small">· {t('checks.current')} </span><CheckBadge state={base.checks[k].state} /></legend>
          <div className="gp-segment" role="radiogroup" aria-label={t(`check.${k}` as Key)}>
            {(['unknown', 'cleared', 'blocked'] as CheckState[]).map((st) => (
              <label key={st}>
                <input type="radio" name={`chk-${k}`} checked={draft[k].state === st} onChange={() => setDraft((d) => ({ ...d, [k]: { ...d[k], state: st } }))} />
                {st === 'unknown' ? '?' : st === 'cleared' ? '✓' : '✕'} {t(`check.${st}` as Key)}
              </label>
            ))}
          </div>
          <Field label={t('checks.comment')} required={draft[k].state !== 'unknown' && draft[k].state !== base.checks[k].state} error={errors[k]}>
            {(id, d) => <input id={id} aria-describedby={d} className="gp-input" value={draft[k].comment} onChange={(e) => setDraft((x) => ({ ...x, [k]: { ...x[k], comment: e.target.value } }))} />}
          </Field>
        </fieldset>
      ))}
      <fieldset className="gp-fieldset">
        <legend>{t('factor.waterAvailability')}</legend>
        <div className="gp-grid-2">
          <Field label={t('checks.water')} error={errors.water} hint={t('checks.waterUnknown')}>
            {(id, d) => <input id={id} aria-describedby={d} className="gp-input" inputMode="numeric" value={water} onChange={(e) => setWater(e.target.value)} />}
          </Field>
          <Field label={t('checks.waterNote')} required={waterChanged} error={errors.waterNote}>
            {(id, d) => <input id={id} aria-describedby={d} className="gp-input" value={waterNote} onChange={(e) => setWaterNote(e.target.value)} placeholder={t('checks.waterExample')} />}
          </Field>
        </div>
      </fieldset>
      <ErrorNote error={error} notSaved />
      <div className="gp-btn-row">
        <Button variant="primary" type="submit" busy={busy} disabled={(!changedChecks.length && !waterChanged) || !!conflict}>{busy ? t('form.saving') : t('checks.save')}</Button>
        <Button type="button" onClick={onCancel}>{t('checks.cancel')}</Button>
      </div>
    </form>
  );
}
