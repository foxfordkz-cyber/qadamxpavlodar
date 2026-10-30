import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLang, t } from '../src/shared/i18n';
import { highlightTitle } from '../src/features/coordinator/sites/highlightTitle';
import { GROWTH_YEARS, YEAR_LABEL } from '../src/features/coordinator/zone/timeMachine';
import { hrefFor } from '../src/shared/router';

test('подсветка: одна ссылка сохраняет очередь и бюджет при смене языка', () => {
  const url = hrefFor('/map', { hl: 'zone-b,zone-a', hlt: 'highlight.roadmap', hlb: '50,5' });
  const query = new URLSearchParams(url.split('?')[1]);
  setLang('ru');
  assert.equal(highlightTitle(query.get('hlt'), query.get('hlb')), 'Дорожная карта · 50,5 млн ₸');
  setLang('kk');
  assert.equal(highlightTitle(query.get('hlt'), query.get('hlb')), 'Жол картасы · 50,5 млн ₸');
  assert.equal(query.get('hl'), 'zone-b,zone-a');
  setLang('ru');
});

test('подсветка: старые русские ссылки переводятся, произвольный заголовок сохраняется', () => {
  setLang('kk');
  assert.equal(highlightTitle('Первые 10 по приоритету'), 'Басымдығы ең жоғары 10 аймақ');
  assert.equal(highlightTitle('Зоны из ответа ассистента'), 'Көмекші жауабындағы аймақтар');
  assert.equal(highlightTitle('Дорожная карта · 125.5 млн ₸'), 'Жол картасы · 125.5 млн ₸');
  assert.equal(highlightTitle('Мой список № 7'), 'Мой список № 7');
  setLang('ru');
});

test('подсветка: неполная ссылка имеет читаемый заголовок, не подставляет выдуманный бюджет', () => {
  setLang('kk');
  assert.equal(highlightTitle(null), 'Көмекші жауабындағы аймақтар');
  assert.equal(highlightTitle('highlight.roadmap'), 'Жол картасы · — млн ₸');
  setLang('ru');
});

test('машина времени: подписи всех годов обновляются без повторной загрузки модуля', () => {
  setLang('ru');
  assert.deepEqual(GROWTH_YEARS.map(year => t(YEAR_LABEL[year])), ['Посадка', '5 лет', '10 лет', '20 лет']);
  setLang('kk');
  assert.deepEqual(GROWTH_YEARS.map(year => t(YEAR_LABEL[year])), ['Отырғызу', '5 жыл', '10 жыл', '20 жыл']);
  setLang('ru');
});
