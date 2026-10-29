// npm run llm:check — проверка ключей и моделей ассистента из apps/server/.env до запуска сервера.
import { checkProvider, llmProviders } from './llm.js';

const providers = llmProviders();
const allowed = ['127.0.0.1', 'localhost', '[::1]', ...(process.env.LLM_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean)];
console.log('Проверка моделей ассистента (apps/server/.env)\n');
if (!providers.length) {
  console.log('Ключи не заданы: вставьте LLM_API_KEY (и LLM2_API_KEY для резерва) в apps/server/.env.');
  console.log('Готовые блоки с адресами и моделями — в apps/server/env-templates/. Без ключей ассистент отвечает по правилам.');
  process.exit(1);
}
const mark = (ok: boolean | null, yes: string, no: string) => (ok === null ? `? ${yes} — не проверено` : ok ? `✓ ${yes}` : `✗ ${no}`);
let working = 0;
for (const [i, p] of providers.entries()) {
  const r = await checkProvider(p, allowed);
  console.log(`${i + 1}) ${i ? 'Резерв' : 'Основная'} ${r.name}: ${r.model} — ${r.host}`);
  console.log(`   ${mark(r.hostAllowed, 'хост разрешён', 'хост не в LLM_ALLOWED_HOSTS')}`);
  if (r.hostAllowed) {
    console.log(`   ${mark(r.keyAccepted, 'ключ принят', `ключ не принят — проверьте ${r.name}_API_KEY`)}`);
    console.log(`   ${mark(r.modelListed, 'модель есть у провайдера', `модели ${r.model} нет в списке провайдера`)}`);
    if (r.available.length) console.log(`     похожие модели: ${r.available.join(', ')}`);
    console.log(`   ${mark(r.keyAccepted ? r.toolCall : null, 'вызывает функции расчёта', 'не вызывает функции')}${r.ms !== null ? `   ответ за ${(r.ms / 1000).toFixed(1)} с` : ''}`);
    if (r.ms !== null && r.ms > 5000 && r.toolCall) console.log('     медленнее 5 с, которые просит ТЗ: попробуйте более быструю модель');
  }
  if (r.error) console.log(`   причина: ${r.error}`);
  if (r.toolCall) working++;
  console.log('');
}
console.log(working === providers.length ? 'Итог: все модели работают. Перезапустите сервер.' : working ? `Итог: работают ${working} из ${providers.length}; ассистент будет отвечать рабочей.` : 'Итог: ни одна модель не работает — ассистент будет отвечать по правилам.');
process.exit(working ? 0 : 1);
