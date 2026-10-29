import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { fixture } from './helpers.js';
import { seedV2, DEMO_PASSWORD } from '../src/v2/seed.js';
import { seedTz } from '../src/tz/seed.js';
import { createLlmAssistant, llmConfig, TOOLS, type LlmConfig } from '../src/tz/llm.js';
import type { AssistantAdapter } from '../src/tz/routes.js';

type Reply = { status?: number; body: unknown };
/** Подставной OpenAI-совместимый сервер: отвечает по сценарию и запоминает запросы. */
async function fakeModel(t: TestContext, script: ((req: any) => Reply)[]) {
  const seen: { headers: IncomingMessage['headers']; body: any }[] = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); seen.push({ headers: req.headers, body });
    const step = script[Math.min(seen.length - 1, script.length - 1)]!(body);
    res.writeHead(step.status ?? 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(step.body));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const port = (server.address() as { port: number }).port;
  const cfg: LlmConfig = { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'fake-grok', apiKey: 'test-key', timeoutMs: 5000, maxRounds: 3 };
  return { cfg, seen };
}
const toolCall = (name: string, args: unknown) => ({ body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] } });
const say = (content: string) => ({ body: { choices: [{ message: { role: 'assistant', content } }] } });
const lastTool = (req: any) => JSON.parse(req.messages.filter((m: any) => m.role === 'tool').at(-1).content);

async function app(t: TestContext) {
  let adapter: AssistantAdapter | undefined;
  const f = await fixture(t, { tz: { assistant: input => adapter!(input) } });
  await seedV2(f.store); seedTz(f.store);
  const r = await fetch(f.base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'coordinator', password: DEMO_PASSWORD }) });
  const b = await r.json(); const cookie = r.headers.get('set-cookie')!.split(';')[0]!;
  const ask = async (message: string, siteId: string | null = null) => {
    const res = await fetch(f.base + '/api/v1/assistant', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': b.data.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, siteId }) });
    return { status: res.status, body: await res.json() };
  };
  const history = async () => (await (await fetch(f.base + '/api/v1/assistant/history', { headers: { Cookie: cookie } })).json()).data;
  return { ...f, ask, history, use: (a: AssistantAdapter) => { adapter = a; } };
}

test('LLM config: no key — rules only; Grok by default; https required except a local model', () => {
  assert.equal(llmConfig({}), null);
  assert.equal(llmConfig({ LLM_API_KEY: 'k' }), null);
  assert.equal(llmConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'm' })!.baseUrl, 'https://api.x.ai/v1');
  assert.throws(() => llmConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_BASE_URL: 'http://api.example.com/v1' }), /https/);
  assert.equal(llmConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_BASE_URL: 'http://ollama:11434/v1/' })!.baseUrl, 'http://ollama:11434/v1');
  assert.throws(() => llmConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_TIMEOUT_MS: '10' }), /LLM_TIMEOUT_MS/);
});

test('model answers with numbers from server tools: method, toolCalls, zones, history; no user names sent to the model', async t => {
  const f = await app(t);
  const { cfg, seen } = await fakeModel(t, [
    () => toolCall('top_priorities', { limit: 3 }),
    req => { const top = lastTool(req).items[0]; return say(`Первая по приоритету — ${top.zone.name}, индекс ${top.index}.`); },
  ]);
  f.use(createLlmAssistant(f.store, cfg));
  const r = await f.ask('Какие зоны озеленить в первую очередь?');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const reply = r.body.data;
  assert.equal(reply.method, 'model'); assert.equal(reply.model, 'fake-grok');
  assert.deepEqual(reply.toolCalls, [{ name: 'top_priorities', args: { limit: 3 } }]);
  assert.equal(reply.zones.length, 1); assert.ok(reply.text.includes(reply.zones[0].name));
  // Цифра в ответе — та, что посчитал сервер, а не модель.
  assert.ok(reply.text.includes(String(lastTool(seen[1]!.body).items[0].index)));
  assert.equal(seen[0]!.headers.authorization, 'Bearer test-key');
  assert.deepEqual(seen[0]!.body.tools.map((x: any) => x.function.name), TOOLS.map(x => x.function.name));
  assert.ok(!JSON.stringify(seen.map(x => x.body.messages)).includes('Специалист (демо)'), 'user names are not sent');
  assert.equal((await f.history()).at(-1).method, 'model');
});

test('tools run real calculations: selected zone analysis, knowledge search with sources, errors go back to the model', async t => {
  const f = await app(t);
  const zone = String(f.store.get("SELECT id FROM v2_documents WHERE kind='site' AND id LIKE 'site-osm-%' ORDER BY id LIMIT 1")!.id);
  const { cfg, seen } = await fakeModel(t, [
    req => { assert.match(req.messages[1].content, new RegExp(zone)); return toolCall('analyze_zone', { zoneId: zone, variant: 'econom' }); },
    req => { const a = lastTool(req); assert.equal(a.options.variant, 'econom'); assert.ok(a.cost.totalKzt > 0 && a.survivalPercent.y1 > 0); return toolCall('search_knowledge', { query: 'карагана засуха' }); },
    req => { assert.ok(lastTool(req).results.length > 0); return toolCall('analyze_zone', { zoneId: 'site-missing' }); },
    req => { assert.ok(lastTool(req).error); return say('Смета и приживаемость посчитаны; карагана устойчива к засухе по справочнику.'); },
  ]);
  f.use(createLlmAssistant(f.store, cfg));
  const r = await f.ask('Что посадить здесь подешевле и почему карагана?', zone);
  assert.equal(r.body.data.method, 'model', JSON.stringify(r.body));
  assert.deepEqual(r.body.data.toolCalls.map((x: any) => x.name), ['analyze_zone', 'search_knowledge', 'analyze_zone']);
  assert.ok(r.body.data.sources.length > 0 && r.body.data.sources.every((x: any) => x.id && x.label));
  assert.equal(seen.length, 4);
});

test('fallback to rules: model error, timeout or invented numbers never reach the user as a model answer', async t => {
  const f = await app(t);
  const down = await fakeModel(t, [() => ({ status: 500, body: { error: 'boom' } })]);
  f.use(createLlmAssistant(f.store, down.cfg));
  let r = await f.ask('Где проблемные зоны?');
  assert.equal(r.body.data.method, 'rules'); assert.ok(r.body.data.fallbackReason); assert.match(r.body.data.text, /проблем/i);
  const invented = await fakeModel(t, [() => say('Индекс приоритета у первой зоны — 99.')]);
  f.use(createLlmAssistant(f.store, invented.cfg));
  r = await f.ask('Какие зоны первые?');
  assert.equal(r.body.data.method, 'rules', 'numbers without tool calls are rejected');
  const slow = await fakeModel(t, [() => toolCall('top_priorities', {})]);
  f.use(createLlmAssistant(f.store, { ...slow.cfg, maxRounds: 50, timeoutMs: 1200 }));
  r = await f.ask('Какие зоны первые?');
  assert.equal(r.body.data.method, 'rules', 'endless tool loop stops at the deadline');
});
