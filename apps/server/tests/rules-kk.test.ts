import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { seedV2, DEMO_PASSWORD } from '../src/v2/seed.js';
import { seedTz } from '../src/tz/seed.js';

test('rules API without a model: Kazakh priorities preserve Russian numbers and zone order', async t => {
  const f = await fixture(t); await seedV2(f.store); seedTz(f.store);
  const login = await fetch(f.base + '/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'coordinator', password: DEMO_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const session = (await login.json()).data;
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const ask = async (message: string) => {
    const res = await fetch(f.base + '/api/v1/assistant', {
      method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, siteId: null }),
    });
    assert.equal(res.status, 200);
    return (await res.json()).data;
  };
  const ruQuestion = 'Какие зоны озеленять в первую очередь?';
  const ru = await ask(ruQuestion);
  const kk = await ask('Бірінші кезекте қай аумақтарды көгалдандыру керек?');
  assert.equal(ru.method, 'rules'); assert.equal(kk.method, 'rules');
  assert.equal(kk.intent, 'priority');
  assert.match(kk.text, /^Басымдық индексі бойынша алғашқы бестік/);
  assert.doesNotMatch(kk.text, /Первая пятёрка|Данных о районах|Дефицит зелени|\{\w+\}/);
  assert.deepEqual(kk.text.match(/\d+(?:[.,]\d+)?/g), ru.text.match(/\d+(?:[.,]\d+)?/g));
  assert.deepEqual(kk.zones, ru.zones);
  assert.equal((await ask(ruQuestion)).text, ru.text, 'a Kazakh reply must not change the next Russian reply');
});
