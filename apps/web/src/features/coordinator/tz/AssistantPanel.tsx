import { useEffect, useRef, useState } from 'react';
import { useData } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { AssistantReply } from '../../../shared/analytics/assistant';
import { MethodLine, MethodTag } from '../../../shared/ui/components';
import { hrefFor, navigate, useRoute } from '../../../shared/router';
import { mapView } from '../map/mapView';
import { useMe } from '../me';
import { uiCommand } from './assistantCommands';

const EXAMPLES = [
  'Какие участки требуют озеленения в первую очередь?',
  'Подбери растения для этой зоны и посчитай стоимость на 3 года',
  'Какая будет приживаемость, если заменить сирень на карагану?',
  'Что можно озеленить на 50 млн при максимальном эффекте?',
  'Где проблемные зоны?',
  'Бірінші кезекте қай аумақтарды көгалдандыру керек?',
];

// Заголовок подсветки на карте — по тому, что посчитано (правила: intent; модель: первая вызванная функция).
const MAP_TITLE: Record<string, string> = {
  budget: 'Дорожная карта бюджета', budget_roadmap: 'Дорожная карта бюджета', priority: 'Первые по приоритету', top_priorities: 'Первые по приоритету',
  problems: 'Проблемные зоны', find_problems: 'Проблемные зоны', search_zones: 'Найденные зоны',
};
/** Параметры карты для зон ответа: номера на карте идут в порядке ответа (очередь, рейтинг). */
const mapParams = (reply: AssistantReply) => ({ hl: reply.zones.map((z) => z.id).join(','), hlt: MAP_TITLE[reply.intent] ?? 'Зоны из ответа ассистента' });

interface Msg { role: 'user' | 'bot'; text: string; reply?: AssistantReply; error?: boolean }

const TOOL_LABEL: Record<string, string> = {
  search_zones: 'поиск зон', analyze_zone: 'расчёт зоны', compare_variants: 'сравнение вариантов', top_priorities: 'приоритеты',
  budget_roadmap: 'дорожная карта под бюджет', find_problems: 'проблемные зоны', search_knowledge: 'поиск по справочникам', find_place: 'поиск места',
};

/** Чем подтверждён ответ: метод, вызванные расчёты и источники — видно под каждым ответом. */
function ReplyProof({ reply }: { reply: AssistantReply }) {
  const calls = [...new Set((reply.toolCalls ?? []).map((c) => TOOL_LABEL[c.name] ?? c.name))];
  return (
    <div className="gp-assist__proof gp-small">
      <MethodTag method={reply.method} />
      {reply.method === 'model' && <span className="gp-muted">{reply.model ? `${reply.model} · ` : ''}цифры — из расчётов системы</span>}
      {reply.reserveReason && <p className="gp-muted">{reply.reserveReason}</p>}
      {reply.fallbackReason && <p className="gp-muted">{reply.fallbackReason}</p>}
      {calls.length > 0 && <p>Посчитано: {calls.join(', ')}.</p>}
      {!!reply.sources?.length && (
        <p>Источники: {reply.sources.map((s, i) => <span key={s.id}>{i > 0 && '; '}{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a> : s.label}</span>)}</p>
      )}
    </div>
  );
}

/** ТЗ 3.10: диалоговый ассистент в боковой панели. На сервере с ключом модели отвечает модель (Grok и др.)
 *  с расчётами модулей; в тестовом источнике и при сбое модели — правила. */
export function AssistantPanel() {
  const { api } = useData();
  const route = useRoute();
  const siteId = route.path === '/map' ? route.params.get('site') : null;
  const me = useMe();
  const [open, setOpen] = useState(false);
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
        ? 'Включил рисование на карте: кликайте по углам участка, затем «Готово» и название. Ошиблись — «Отменить точку», выйти — Esc.'
        : 'Рисовать зоны может только специалист. Выберите готовую зону на карте или в списке.';
      setMsgs((m) => [...m, { role: 'user', text }, { role: 'bot', text: reply }]);
      if (can) navigate('/map', { draw: '1' }, route.path === '/map');
      return;
    }
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      // Последние реплики — чтобы короткий ответ («Едиге би 1») продолжал вопрос; центр карты — если зона не выбрана.
      const history = msgs.filter((m) => !m.error).slice(-6).map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, text: m.text.slice(0, 600) }));
      const view = route.path === '/map' && !siteId ? mapView.center : null;
      const reply = await api.ask(text, siteId, { history, ...(view ? { view } : {}) });
      setMsgs((m) => [...m, { role: 'bot', text: reply.text, reply }]);
      // Уже на карте — зоны из ответа сразу появляются на ней с номерами; выбранная зона остаётся открытой.
      if (route.path === '/map' && reply.zones.length >= 2) navigate('/map', { site: siteId, ...mapParams(reply) }, true);
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 503 ? 'Ассистент недоступен. Все разделы — карта, подбор, смета, приоритеты — работают вручную.' : `Не удалось получить ответ: ${(e as Error).message}`;
      setMsgs((m) => [...m, { role: 'bot', text: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <button className="gp-assist-fab" onClick={() => setOpen(true)} aria-label="Открыть ассистента">✦ Ассистент</button>;
  return (
    <aside className="gp-assist" aria-label="Ассистент по озеленению">
      <div className="gp-assist__head">
        <strong>Ассистент</strong>
        <span className="gp-small gp-muted">{siteId ? `зона: ${siteId}` : 'зона не выбрана'}</span>
        <button className="gp-icon-btn" onClick={() => setOpen(false)} aria-label="Закрыть ассистента">✕</button>
      </div>
      <MethodLine method={[...msgs].reverse().find((m) => m.reply)?.reply?.method ?? 'rules'} />
      <div ref={list} className="gp-assist__list" aria-live="polite">
        {msgs.length === 0 && (
          <div className="gp-assist__hello">
            <p className="gp-small">Спросите про приоритеты, подбор, смету, приживаемость, эффект или бюджет. Отвечаю только цифрами из модулей системы; если данных нет — скажу об этом.</p>
            {EXAMPLES.map((e) => <button key={e} className="gp-chip gp-chip--btn" onClick={() => send(e)}>{e}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`gp-assist__msg gp-assist__msg--${m.role} ${m.error ? 'is-error' : ''}`}>
            {m.text.split('\n').map((l, j) => <p key={j}>{l}</p>)}
            {!!m.reply?.zones.length && (
              <div className="gp-assist__zones">
                {m.reply.zones.map((z, n) => <a key={z.id} className="gp-chip" href={hrefFor('/map', { site: z.id, ...(m.reply!.zones.length >= 2 ? mapParams(m.reply!) : {}) })} title="Открыть карточку зоны">{m.reply!.zones.length >= 2 ? `${n + 1}.` : '📍'} {z.name}</a>)}
                {m.reply.zones.length >= 2 && <button className="gp-btn gp-btn--secondary gp-assist__map" onClick={() => navigate('/map', mapParams(m.reply!))}>🗺 Показать все на карте ({m.reply.zones.length})</button>}
              </div>
            )}
            {m.reply && <ReplyProof reply={m.reply} />}
          </div>
        ))}
        {busy && <div className="gp-assist__msg gp-assist__msg--bot"><span className="gp-spinner" aria-label="Ассистент думает" /></div>}
      </div>
      <form className="gp-assist__form" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <label className="gp-sr" htmlFor="assist-q">Вопрос ассистенту</label>
        <textarea id="assist-q" ref={input} className="gp-input" rows={2} value={q} placeholder="Например: подбери растения для сквера" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q); } }} />
        <button className="gp-btn gp-btn--primary" type="submit" disabled={busy || !q.trim()}>Спросить</button>
      </form>
    </aside>
  );
}
