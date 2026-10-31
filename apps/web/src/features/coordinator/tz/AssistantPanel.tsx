import { t, type Key } from '../../../shared/i18n';
import type { HighlightTitleKey } from '../sites/highlightTitle';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { AssistantReply } from '../../../shared/analytics/assistant';
import { MethodLine, MethodTag } from '../../../shared/ui/components';
import { hrefFor, navigate, useRoute } from '../../../shared/router';
import { mapView } from '../map/mapView';
import { CENTER } from '../map/geo';
import { useMe } from '../me';
import { uiCommand } from './assistantCommands';

const EXAMPLES: Key[] = [
  'assistant.example1',
  'assistant.example2',
  'assistant.example3',
  'assistant.example4',
  'assistant.example5',
  'assistant.example6',
];

// Заголовок подсветки на карте — по тому, что посчитано (правила: intent; модель: первая вызванная функция).
const MAP_TITLE: Record<string, HighlightTitleKey> = {
  budget: 'highlight.budget', budget_roadmap: 'highlight.budget', priority: 'highlight.priority', top_priorities: 'highlight.priority',
  problems: 'highlight.problems', find_problems: 'highlight.problems', search_zones: 'highlight.found',
};
/** Параметры карты для зон ответа: номера на карте идут в порядке ответа (очередь, рейтинг). */
const mapParams = (reply: AssistantReply) => ({ hl: reply.zones.map((z) => z.id).join(','), hlt: MAP_TITLE[reply.intent] ?? 'highlight.assistant' });

interface Msg { role: 'user' | 'bot'; text: string; reply?: AssistantReply; error?: boolean }

const TOOL_LABEL: Record<string, Key> = {
  search_zones: 'assistant.tool.search', analyze_zone: 'assistant.tool.analyze', compare_variants: 'assistant.tool.compare', top_priorities: 'assistant.tool.priorities',
  budget_roadmap: 'assistant.tool.budget', find_problems: 'assistant.tool.problems', search_knowledge: 'assistant.tool.knowledge', find_place: 'assistant.tool.place',
};

/** Чем подтверждён ответ: метод, вызванные расчёты и источники — видно под каждым ответом. */
function ReplyProof({ reply }: { reply: AssistantReply }) {
  const calls = [...new Set((reply.toolCalls ?? []).map((c) => TOOL_LABEL[c.name] ? t(TOOL_LABEL[c.name]) : c.name))];
  return (
    <div className="gp-assist__proof gp-small">
      <MethodTag method={reply.method} />
      {reply.method === 'model' && <span className="gp-muted">{reply.model ? `${reply.model} · ` : ''}{t('assistant.systemFigures')}</span>}
      {reply.reserveReason && <p className="gp-muted">{reply.reserveReason}</p>}
      {reply.fallbackReason && <p className="gp-muted">{reply.fallbackReason}</p>}
      {calls.length > 0 && <p>{t('assistant.calculated', { calls: calls.join(', ') })}</p>}
      {!!reply.sources?.length && (
        <p>{t('assistant.sources')} {reply.sources.map((s, i) => <span key={s.id}>{i > 0 && '; '}{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a> : s.label}</span>)}</p>
      )}
    </div>
  );
}

/** ТЗ 3.10: диалоговый ассистент в боковой панели. На сервере с ключом модели отвечает модель (Grok и др.)
 *  с расчётами модулей; в тестовом источнике и при сбое модели — правила. */
export function AssistantPanel({ launcherTarget }: { launcherTarget: HTMLElement | null }) {
  const { api } = useData();
  const route = useRoute();
  const siteId = route.path === '/map' ? route.params.get('site') : null;
  const me = useMe();
  const [open, setOpen] = useState(false);
  const zone = useResource(() => open && siteId ? api.site(siteId) : Promise.resolve(null), [open, siteId]);
  // useResource retains old data while loading: never label a new selection with the previous name.
  const zoneName = zone.data?.id === siteId ? zone.data?.name : null;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [msgs]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setQ('');
    // «Нарисуй зону» — команда карте: включаем рисование (#/map?draw=1), а не считаем ближайшую зону.
    if (uiCommand(text) === 'draw') {
      const can = me.role === 'coordinator';
      const reply = can
        ? t('assistant.drawEnabled')
        : t('assistant.drawRestricted');
      setMsgs((m) => [...m, { role: 'user', text }, { role: 'bot', text: reply }]);
      if (can) navigate('/map', { draw: '1' }, route.path === '/map');
      return;
    }
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      // Последние реплики — чтобы короткий ответ («Едиге би 1») продолжал вопрос; центр карты — если зона не выбрана.
      const history = msgs.filter((m) => !m.error).slice(-6).map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, text: m.text.slice(0, 600) }));
      // Карта не загрузилась (показана схема) — центр района прототипа.
      const view = route.path === '/map' && !siteId ? mapView.center ?? { lat: CENTER[1], lng: CENTER[0] } : null;
      const reply = await api.ask(text, siteId, { history, ...(view ? { view } : {}) });
      setMsgs((m) => [...m, { role: 'bot', text: reply.text, reply }]);
      // Уже на карте — зоны из ответа сразу появляются на ней с номерами; выбранная зона остаётся открытой.
      if (route.path === '/map' && reply.zones.length >= 2) navigate('/map', { site: siteId, ...mapParams(reply) }, true);
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 503 ? t('assistant.unavailable') : t('assistant.error', { error: (e as Error).message });
      setMsgs((m) => [...m, { role: 'bot', text: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {launcherTarget && createPortal(<button className="gp-assist-fab" onClick={() => setOpen(true)} aria-label={t('assistant.open')} aria-expanded={open} aria-controls={open ? 'gp-assistant-panel' : undefined}><span aria-hidden="true">✦</span> <span className="gp-assist-fab__label">{t('assistant.title')}</span></button>, launcherTarget)}
      {open && <aside id="gp-assistant-panel" className="gp-assist" aria-label={t('assistant.label')}>
      <div className="gp-assist__head">
        <strong>{t('assistant.title')}</strong>
        <span className="gp-small gp-muted gp-assist__zone">{siteId ? t('assistant.zone', { name: zoneName || t(zone.loading ? 'state.loading' : 'assistant.zoneUnavailable') }) : t('assistant.noZone')}</span>
        <button className="gp-icon-btn" onClick={() => setOpen(false)} aria-label={t('assistant.close')}>✕</button>
      </div>
      <MethodLine method={[...msgs].reverse().find((m) => m.reply)?.reply?.method ?? 'rules'} />
      <div ref={list} className="gp-assist__list" aria-live="polite">
        {msgs.length === 0 && (
          <div className="gp-assist__hello">
            <p className="gp-small">{t('assistant.hello')}</p>
            {EXAMPLES.map((e) => <button key={e} className="gp-chip gp-chip--btn" onClick={() => send(t(e))}>{t(e)}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`gp-assist__msg gp-assist__msg--${m.role} ${m.error ? 'is-error' : ''}`}>
            {m.text.split('\n').map((l, j) => <p key={j}>{l}</p>)}
            {!!m.reply?.zones.length && (
              <div className="gp-assist__zones">
                {m.reply.zones.map((z, n) => <a key={z.id} className="gp-chip" href={hrefFor('/map', { site: z.id, ...(m.reply!.zones.length >= 2 ? mapParams(m.reply!) : {}) })} title={t('assistant.openZone')}>{m.reply!.zones.length >= 2 ? `${n + 1}.` : '📍'} {z.name}</a>)}
                {m.reply.zones.length >= 2 && <button className="gp-btn gp-btn--secondary gp-assist__map" onClick={() => navigate('/map', mapParams(m.reply!))}>🗺 {t('assistant.showMap', { n: m.reply.zones.length })}</button>}
              </div>
            )}
            {m.reply && <ReplyProof reply={m.reply} />}
          </div>
        ))}
        {busy && <div className="gp-assist__msg gp-assist__msg--bot"><span className="gp-spinner" aria-label={t('assistant.thinking')} /></div>}
      </div>
      <form className="gp-assist__form" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <label className="gp-sr" htmlFor="assist-q">{t('assistant.question')}</label>
        <textarea id="assist-q" ref={input} className="gp-input" rows={2} value={q} placeholder={t('assistant.placeholder')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q); } }} />
        <button className="gp-btn gp-btn--primary" type="submit" disabled={busy || !q.trim()}>{t('assistant.ask')}</button>
      </form>
      </aside>}
    </>
  );
}
