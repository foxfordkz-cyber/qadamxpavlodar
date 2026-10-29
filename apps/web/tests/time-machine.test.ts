import { test } from 'node:test';
import assert from 'node:assert/strict';
import osm from '../../../fixtures/osm/sites.json';
import { species } from '../src/shared/api/mock/species';
import type { CandidateSite, Species } from '../src/shared/api/types';
import { analyzeZone } from '../src/shared/analytics/plan';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { makeProjection, pointInRing, distPointLine, type XY } from '../src/shared/geo';
import { buildGrowthScene } from '../src/features/coordinator/zone/timeMachine';

const origin = { lat: 52.28, lng: 76.95 };
const projection = makeProjection(origin);
const tree: Species = { ...species.find(s => s.form === 'tree')!, id: 'tm-tree', crownDiameterM: 4 };
const flower: Species = { ...species.find(s => s.form === 'flower')!, id: 'tm-flower', spacingM: 0.35 };
const flower2: Species = { ...flower, id: 'tm-flower-2' };
const catalog = new Map([tree, flower, flower2].map(s => [s.id, s]));
const rotate = ([x, y]: XY, angle: number): XY => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
const angles = [0, 27, 90, 136];

function scene(degrees: number, roadSide: -1 | 0 | 1, reverse = false) {
  const angle = degrees * Math.PI / 180;
  // A test lawn 80 × 24 metres; flower beds must stay on one of its long sides.
  const corners: XY[] = [[-40, -12], [40, -12], [40, 12], [-40, 12], [-40, -12]];
  const ll = (p: XY) => projection.toLngLat(rotate(p, angle));
  const ring = (reverse ? [...corners].reverse() : corners).map(ll);
  const site: CandidateSite = { ...osm.sites[0] as unknown as CandidateSite, id: 'tm-lawn', centroid: origin, areaM2: 1920, geometry: { type: 'Polygon', coordinates: [ring] } };
  const a = analyzeZone(site, [...catalog.values()], ratesMap(DEFAULT_RATES));
  a.scheme = [
    { speciesId: tree.id, tier: 'tree', quantity: 50, locked: false },
    { speciesId: flower.id, tier: 'flower', quantity: 100, locked: false },
    { speciesId: flower2.id, tier: 'flower', quantity: 100, locked: false },
  ];
  a.survival = [...catalog.keys()].map(speciesId => ({ speciesId, y1: 90, y2: 85, y3: 80, low: 75, high: 95, risks: [] }));
  // Include a farther street on the other side: the first item in the list must not win by order.
  const roads = roadSide ? [-roadSide * 80, roadSide * 20].map(y => [ll([-60, y]), ll([60, y])]) : [];
  const result = buildGrowthScene(site, a, catalog, roads);
  assert.ok(result, 'polygon with a centroid produces a scene');
  const beds = result.items.flatMap(({ item }) => item.kind === 'bed' && item.geometry.type === 'Polygon' ? [item.geometry.coordinates[0].map(projection.toXY)] : []);
  const trees = result.items.flatMap(({ item }) => item.speciesId === tree.id && item.geometry.type === 'Point' ? [projection.toXY(item.geometry.coordinates)] : []);
  assert.equal(beds.length, 2, 'both flower species must have a nonempty border');
  assert.ok(trees.length > 0, 'the collision check must include actual trees');
  return { beds, trees, local: (p: XY) => rotate(p, -angle) };
}

function samples(ring: XY[]): XY[] {
  return ring.flatMap((a, i) => {
    if (!i) return [a];
    const b = ring[i - 1];
    const n = Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / 0.25);
    return Array.from({ length: n + 1 }, (_, k): XY => [b[0] + (a[0] - b[0]) * k / n, b[1] + (a[1] - b[1]) * k / n]);
  });
}

test('buildGrowthScene: оба бордюра целиком внутри контура, включая отрезки между вершинами', () => {
  for (const angle of angles) for (const side of [-1, 1] as const) for (const reverse of [false, true]) {
    const { beds, local } = scene(angle, side, reverse);
    for (const bed of beds) {
      assert.deepEqual(bed[0], bed.at(-1), 'closed border ring');
      for (const p of samples(bed).map(local)) assert.ok(Math.abs(p[0]) < 40 && Math.abs(p[1]) < 12, `${angle}°: border left the lawn at ${p}`);
    }
  }
});

test('buildGrowthScene: бордюр у длинного края, ближайшего к улице, независимо от порядка дорог', () => {
  for (const angle of angles) for (const side of [-1, 1] as const) {
    const { beds, local } = scene(angle, side);
    for (const p of beds.flat().map(local)) {
      const inset = 12 - side * p[1];
      assert.ok(inset >= 0.65 && inset <= 2.05, `${angle}°: wrong street-facing edge or setback ${inset}`);
    }
  }
});

test('buildGrowthScene: деревья не попадают на бордюры и их границы', () => {
  for (const angle of angles) for (const side of [-1, 0, 1] as const) {
    const { beds, trees } = scene(angle, side);
    for (const p of trees) for (const bed of beds) {
      assert.equal(pointInRing(p, bed), false, `${angle}°: tree inside a flower bed`);
      assert.ok(distPointLine(p, bed) > 0.25, `${angle}°: tree on a flower-bed edge`);
    }
  }
});

test('buildGrowthScene: без дорог бордюр идёт по длинной стороне, в том числе у повёрнутой зоны', () => {
  for (const angle of angles) for (const reverse of [false, true]) {
    const { beds, local } = scene(angle, 0, reverse);
    for (const bed of beds) {
      const xy = bed.map(local), xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
      const length = Math.max(...xs) - Math.min(...xs), width = Math.max(...ys) - Math.min(...ys);
      // The contour is sampled in 0.25 m steps, so a rotated strip can be slightly wider than 1 m.
      assert.ok(length > 5 * width, `${angle}°: border does not follow the 80 m side (${length} × ${width})`);
      assert.ok(ys.every(y => Math.abs(y) >= 9.95 && Math.abs(y) < 12), `${angle}°: border is not near a long edge`);
    }
  }
});
