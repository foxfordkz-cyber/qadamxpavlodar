import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataProvider } from '../src/shared/api/DataProvider';
import { DrawBar, MapSearch, drawnArea } from '../src/features/coordinator/map/MapTools';
import { dashboardMetrics } from '../src/shared/api/tzViews';
import { metricPeriod } from '../src/features/coordinator/dashboard/metricText';
import { getLang, setLang, t, tr } from '../src/shared/i18n';

test('карта KK: панель рисования и поиск рендерятся без русских служебных фраз', () => {
  const language = getLang(), location = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?source=mock&lang=kk', hash: '#/map?draw=1' } });
  setLang('kk');
  try {
    const triangles: [number, number][][] = [
      [], [[76.95, 52.28]], [[76.95, 52.28], [76.95001, 52.28]],
      [[76.95, 52.28], [76.95001, 52.28], [76.95, 52.28001]],
      [[76.95, 52.28], [76.951, 52.28], [76.95, 52.281]],
    ];
    for (const points of triangles) {
      const html = renderToStaticMarkup(createElement(DataProvider, { children: createElement(DrawBar, { points, onUndo() {}, onCancel() {}, onSaved() {} }) }));
      assert.match(html, /Аймақты сызу/);
      assert.match(html, /Нүктені болдырмау/);
      assert.match(html, /Дайын/);
      if (points.length < 3) assert.ok(html.includes(`кемінде 3 бұрыштың ${points.length}-і`));
      else {
        assert.ok(html.includes(`Бұрыштар: ${points.length}`));
        assert.ok(html.includes(drawnArea(points).toLocaleString('ru-RU')));
        assert.equal(html.includes('сервер қабылдамайды'), drawnArea(points) <= 50);
      }
      assert.doesNotMatch(html, /Рисование|Кликайте|Углов|Отменить|Готово|Отмена|меньше|не примет/);
      assert.doesNotMatch(html, /\{(?:n|area)\}|undefined|NaN/);
    }
    const search = renderToStaticMarkup(createElement(DataProvider, { children: createElement(MapSearch, { onPick() {} }) }));
    assert.match(search, /Мекенжай бойынша іздеу/);
    assert.match(search, /placeholder="Мекенжай, көше, орын немесе аймақ"/);
    assert.doesNotMatch(search, /Поиск по адресу|Адрес, улица/);
    // The command response and the actual controls must use the same labels.
    assert.ok(t('assistant.drawEnabled').includes(t('draw.undo')));
    assert.ok(t('assistant.drawEnabled').includes(t('draw.done')));
  } finally {
    setLang(language);
    if (location) Object.defineProperty(globalThis, 'location', location);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});

test('метрики KK: все подписи, определения и периоды переводятся без изменения данных', () => {
  const language = getLang();
  const input = { sites: [], tasks: [], reports: [], projects: [], osmBase: '2026-10-29T10:00:00Z' };
  const metrics = dashboardMetrics(input), original = structuredClone(metrics);
  try {
    setLang('kk');
    for (const m of metrics) {
      assert.notEqual(tr(m.label), m.label, m.key + ' label');
      assert.notEqual(tr(m.definition), m.definition, m.key + ' definition');
      assert.notEqual(metricPeriod(m.period), m.period, m.key + ' period');
      assert.equal(m.value, 0);
    }
    assert.equal(metricPeriod(metrics[0].period), '2026-10-29 күнгі OSM деректері');
    assert.equal(metricPeriod(dashboardMetrics({ ...input, osmBase: null })[0].period), '— күнгі OSM деректері');
    assert.equal(tr('Пользовательская метрика'), 'Пользовательская метрика');
    assert.equal(metricPeriod('2026-10-01 / 2026-10-29'), '2026-10-01 / 2026-10-29');
    assert.deepEqual(metrics, original);
    assert.deepEqual(dashboardMetrics(input), original, 'data remains in Russian even when the UI uses Kazakh');
    setLang('ru');
    for (const m of metrics) {
      assert.equal(tr(m.label), m.label);
      assert.equal(tr(m.definition), m.definition);
      assert.equal(metricPeriod(m.period), m.period);
    }
  } finally { setLang(language); }
});
