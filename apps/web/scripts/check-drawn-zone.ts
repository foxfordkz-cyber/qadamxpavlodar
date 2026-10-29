// Проверка SRV-02 без браузера: валидация полигона и построение зоны.
// Запуск из apps/web: npm run check:zones
import assert from 'node:assert/strict';
import { buildDrawnZone, validateDrawnPolygon } from '../src/shared/api/mock/drawnZone';
import { analyzeZone } from '../src/shared/analytics/plan';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { species } from '../src/shared/api/mock/species';

const sq = (lng: number, lat: number, d: number) => [[lng, lat], [lng + d, lat], [lng + d, lat + d * 0.6], [lng, lat + d * 0.6], [lng, lat]];
const poly = (ring: number[][]) => ({ type: 'Polygon', coordinates: [ring] });
const errs = (g: unknown) => validateDrawnPolygon(g).errors.map((e) => e.message).join(' ');

// 1. Нормальный участок ~60×40 м в центре.
const ok = validateDrawnPolygon(poly(sq(76.9500, 52.2860, 0.0009)));
assert.equal(ok.errors.length, 0, 'валидный полигон без ошибок');
const site = buildDrawnZone('site-user-1', '', ok.ring as [number, number][], 60);
assert.ok(site.areaM2! > 1500 && site.areaM2! < 5000, `площадь в разумных пределах: ${site.areaM2}`);
assert.ok(site.centroid && Math.abs(site.centroid.lat - 52.2862) < 0.001, 'центр рядом с участком');
assert.equal(site.factors.waterAvailability.value, null, 'вода неизвестна — null, не 0');
assert.ok(site.missingData.some((m) => m.field === 'context.busStops300m'), 'нет данных об остановках — в missingData');
assert.equal(site.checks.landPermission.state, 'unknown');
const a = analyzeZone(site, species, ratesMap(DEFAULT_RATES));
assert.ok(a.scheme.length > 0 && a.cost.total > 0, 'анализ зоны работает для нарисованной зоны');

// 2. Самопересечение («бабочка»).
assert.match(errs(poly([[76.95, 52.286], [76.951, 52.2866], [76.951, 52.286], [76.95, 52.2866], [76.95, 52.286]])), /самопересекается/);
// 3. Не замкнут.
assert.match(errs(poly(sq(76.95, 52.286, 0.0009).slice(0, 4))), /не замкнут/);
// 4. Перепутаны lat и lng.
assert.match(errs(poly(sq(76.95, 52.286, 0.0009).map(([x, y]) => [y, x]))), /перепутаны/);
// 5. Площадь меньше 50 м².
assert.match(errs(poly(sq(76.95, 52.286, 0.00005))), /нужно больше 50/);
// 6. Вне района.
assert.match(errs(poly(sq(76.80, 52.286, 0.0009))), /за пределы/);
// 7. Не Polygon.
assert.match(errs({ type: 'Point', coordinates: [76.95, 52.286] }), /Polygon/);

console.log(`SRV-02: 7 проверок пройдены. Пример: ${site.name}, ${site.areaM2} м², зелень в 200 м ${site.context?.greenShare200m}, зданий в 200 м ${site.context?.buildings200m}, смета ${Math.round(a.cost.total).toLocaleString('ru-RU')} ₸`);
