// Геометрия на плоскости для небольших участков (сотни метров): локальная
// равнопромежуточная проекция вокруг опорной точки. Погрешность — доли метра,
// этого достаточно для схемы и оценок расстояний; это не геодезическая съёмка.
export type LngLat = [number, number];
export type XY = [number, number];

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function makeProjection(origin: { lat: number; lng: number }) {
  const k = Math.cos(rad(origin.lat));
  return {
    toXY: ([lng, lat]: LngLat): XY => [rad(lng - origin.lng) * k * R, rad(lat - origin.lat) * R],
    toLngLat: ([x, y]: XY): LngLat => [+(origin.lng + (x / (k * R)) * (180 / Math.PI)).toFixed(7), +(origin.lat + (y / R) * (180 / Math.PI)).toFixed(7)],
  };
}

export function pointInRing([x, y]: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distPointSegment([px, py]: XY, [ax, ay]: XY, [bx, by]: XY): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distPointLine(p: XY, line: XY[]): number {
  if (line.length === 1) return Math.hypot(p[0] - line[0][0], p[1] - line[0][1]);
  let m = Infinity;
  for (let i = 0; i < line.length - 1; i++) m = Math.min(m, distPointSegment(p, line[i], line[i + 1]));
  return m;
}

/** Минимальное расстояние между ломаными/контурами (0, если пересекаются или один внутри другого). */
export function distShapes(a: XY[], b: XY[], aClosed = true, bClosed = true): number {
  if (aClosed && b.some((p) => pointInRing(p, a))) return 0;
  if (bClosed && a.some((p) => pointInRing(p, b))) return 0;
  let m = Infinity;
  for (const p of a) m = Math.min(m, distPointLine(p, b));
  for (const p of b) m = Math.min(m, distPointLine(p, a));
  return m;
}

export function ringAreaXY(ring: XY[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(s) / 2;
}

export function bboxXY(pts: XY[]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Правильный многоугольник вокруг точки — для 3D-крон и кругов на схеме. */
export function circleRing(center: XY, radius: number, n = 10): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]);
  }
  return out;
}

export function centroidXY(ring: XY[]): XY {
  const n = ring.length - 1 || 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}
