import { useEffect, useRef, useState } from 'react';
import { useData } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { AssistantReply } from '../../../shared/analytics/assistant';
import { MethodLine, MethodTag } from '../../../shared/ui/components';
import { hrefFor, useRoute } from '../../../shared/router';

const EXAMPLES = [
  'Какие участки требуют озеленения в первую очередь?',
  'Подбери растения для этой зоны и посчитай стоимость на 3 года',
  'Какая будет приживаемость, если заменить сирень на карагану?',
  'Что можно озеленить на 50 млн при максимальном эффекте?',
  'Где проблемные зоны?',
];

interface Msg { role: 'user' | 'bot'; text: string; reply?: AssistantReply; error?: boolean }

const TOOL_LABEL: Record<string, string> = {
  search_zones: 'поиск зон', analyze_zone: 'расчёт зоны', compare_variants: 'сравнение вариантов', top_priorities: 'приоритеты',
  budget_roadmap: 'дорожная карта под бюджет', find_problems: 'проблемные зоны', search_knowledge: 'поиск по справочникам',
};

/** Чем подтверждён ответ: метод, вызванные расчёты и источники — видно под каждым ответом. */
function ReplyProof({ reply }: { reply: AssistantReply }) {
  const calls = [...new Set((reply.toolCalls ?? []).map((c) => TOOL_LABEL[c.name] ?? c.name))];
  return (
    <div className="gp-assist__proof gp-small">
      <MethodTag method={reply.method} />
      {reply.method === 'model' && <span className="gp-muted">{reply.model ? `${reply.model} · ` : ''}цифры — из расчётов системы</span>}
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
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [msgs]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setMsgs((m) => [...m, { role: 'user', text }]);
    setQ('');
    setBusy(true);
    try {
      const reply = await api.ask(text, siteId);
      setMsgs((m) => [...m, { role: 'bot', text: reply.text, reply }]);
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
            {!!m.reply?.zones.length && <div className="gp-assist__zones">{m.reply.zones.map((z) => <a key={z.id} className="gp-chip" href={hrefFor('/map', { site: z.id })} title="Показать на карте">📍 {z.name}</a>)}</div>}
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
