import { useEffect, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import type { PlanOptions } from '../../../shared/analytics/plan';
import { t } from '../../../shared/i18n';

export function MemoExport({ siteId, options, ready }: { siteId: string; options: Partial<PlanOptions>; ready: boolean }) {
  const { api, mode } = useData();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([siteId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const sites = useResource(() => open ? api.sites().then(r => r.data) : Promise.resolve([]), [open]);
  useEffect(() => { setSelected([siteId]); setDone(false); setError(''); }, [siteId]);
  async function downloadMemo() {
    setBusy(true); setError(''); setDone(false);
    try {
      const [{ loadMemo, MemoRatesChanged }, { buildMemoDocx }] = await Promise.all([import('../../../shared/export/loadMemo'), import('../../../shared/export/memo')]);
      const input = await loadMemo(api, selected, options, mode).catch(e => { if (e instanceof MemoRatesChanged) throw new Error(t('memo.ratesChanged')); throw e; });
      const bytes = buildMemoDocx(input);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const link = document.createElement('a');
      link.href = url; link.download = `green-pavlodar-memo-${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : t('memo.failed')); }
    finally { setBusy(false); }
  }
  return <div className="gp-noprint">
    <button className="gp-btn" disabled={!ready || busy} aria-expanded={open} onClick={() => setOpen(!open)}>{t('memo.button')}</button>
    {open && <section className="gp-card" aria-label={t('memo.button')}>
      <p>{t('memo.note')}</p>
      {sites.loading && <p>{t('state.loading')}</p>}
      {sites.error && <p role="alert">{t('state.error', { message: sites.error.message })} <button onClick={sites.reload}>{t('state.retry')}</button></p>}
      <label>{t('memo.zones')}<select multiple size={6} value={selected} disabled={busy} onChange={e => setSelected([...e.target.selectedOptions].map(o => o.value))}>
        {(sites.data ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
      <p>{t('memo.selectionHint')}</p>
      <button className="gp-btn gp-btn--primary" disabled={busy || !ready || !selected.length || sites.loading || !!sites.error} onClick={downloadMemo}>{t(busy ? 'memo.creating' : 'memo.download')}</button>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{t('memo.done')}</p>}
    </section>}
  </div>;
}
