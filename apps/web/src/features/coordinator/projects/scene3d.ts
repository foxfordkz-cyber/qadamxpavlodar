// 3D-сцена посадок на three.js внутри MapLibre (custom layer). Низкополигональные
// процедурные модели: без внешних файлов, размеры — из справочника, форма — по типу вида.
import * as THREE from 'three';
import type { CustomLayerInterface, Map as MlMap } from 'maplibre-gl';
import type { GeoJsonPoint, GeoJsonPolygon, ProjectItem, Species } from '../../../shared/api/types';
import { longAxis, makeProjection, type XY } from '../../../shared/geo';
import { STAGE_K, type Stage } from './trees3d';

const FLOWER_COLORS: Record<string, number[]> = {
  'sp-tagetes': [0xf2a024, 0xe57a1c], 'sp-hemerocallis': [0xe8782c, 0xf0a640], 'sp-iris-sibirica': [0x6c5bb5, 0x8f7fd6],
  'sp-echinacea': [0xc75a8c, 0xd97aa6], 'sp-sedum-spectabile': [0xd77fa6, 0xe8a1c0], 'sp-salvia-nemorosa': [0x7a5fc0, 0x9a84d8],
  'sp-petunia': [0xc2408f, 0xf2f2f2], 'sp-paeonia-lactiflora': [0xf2a7c3, 0xffffff], 'sp-phlox-paniculata': [0xd98ad1, 0xffffff],
  'sp-cosmos-bipinnatus': [0xf29cc6, 0xffffff, 0xc2407a], 'sp-zinnia-elegans': [0xf25c3c, 0xf2c12e, 0xd9468f],
  'sp-salvia-splendens': [0xd9262b], 'sp-ageratum': [0x8fa3e8], 'sp-hosta': [0x5f8f3a, 0x9fbf5a],
};

/** Детерминированный «случай» по id — модели не меняются при каждом рендере. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

const mat = (color: number, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1e2614, transparent: true, opacity: 0.22, depthWrite: false });

function shadowDisk(r: number) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  return m;
}

/** Стадия проекта или доли взрослых размеров (машина времени зоны: рост по расчёту экоэффекта). */
export type Growth = Stage | { h: number; crown: number };
const kOf = (g: Growth) => (typeof g === 'string' ? STAGE_K[g] : g);

/** Модель растения в локальных метрах (Y вверх). */
function plantModel(sp: Species | undefined, stage: Growth, seed: string): THREE.Group {
  const r = rng(seed);
  const k = kOf(stage);
  const hMax = sp?.matureHeightM ? (sp.matureHeightM[0] + sp.matureHeightM[1]) / 2 : 2;
  const H = Math.max(0.5, hMax * k.h);
  const R = Math.max(0.3, ((sp?.crownDiameterM ?? 1.5) / 2) * k.crown);
  const g = new THREE.Group();
  const greens = [0x6a9e3a, 0x7fb043, 0x8cbd4c, 0x5e9134];
  const green = () => greens[Math.floor(r() * greens.length)];

  if (sp?.form === 'tree') {
    const columnar = /bolleana|pyramidalis/i.test(sp.id + sp.latin);
    const trunkH = H * (sp.evergreen ? 0.22 : columnar ? 0.15 : 0.42);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.06, R * 0.07), Math.max(0.09, R * 0.1), trunkH, 7), mat(0x6b5236));
    trunk.position.y = trunkH / 2;
    g.add(trunk, shadowDisk(R * 1.05));
    if (sp.evergreen && !/larix/i.test(sp.id)) {
      // Хвойное: ярусы конусов, радиус убывает к вершине.
      const tiers = 4;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const h = (H - trunkH) * 0.42;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(R * (1 - t * 0.7), h, 9), mat(i % 2 ? 0x3f7a44 : 0x4a8a4c));
        cone.position.y = trunkH + (H - trunkH) * t * 0.78 + h / 2;
        cone.rotation.y = r() * Math.PI;
        g.add(cone);
      }
    } else if (columnar) {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat(green()));
      crown.scale.set(R, (H - trunkH) / 2, R);
      crown.position.y = trunkH + (H - trunkH) / 2;
      g.add(crown);
    } else {
      // Лиственное: крона из 4–6 объёмов разного размера — силуэт неровный, «живой».
      const blobs = 4 + Math.floor(r() * 3);
      const cy = trunkH + (H - trunkH) * 0.5;
      const ry = (H - trunkH) / 2;
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + r();
        const dist = i === 0 ? 0 : R * (0.35 + r() * 0.3);
        const size = i === 0 ? R * 0.75 : R * (0.45 + r() * 0.25);
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), mat(green()));
        blob.position.set(Math.cos(a) * dist, cy + (i === 0 ? 0 : (r() - 0.3) * ry * 0.8), Math.sin(a) * dist);
        blob.scale.y = Math.min(1.25, ry / size);
        g.add(blob);
      }
      if (sp.floweringMonths?.length && k.crown > STAGE_K.planting.crown) {
        // Лёгкий намёк на цветение у цветущих деревьев.
        const petals = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 0.35, 0), mat(/niedzwetzkyana/.test(sp.id) ? 0xe58bb4 : 0xf4f1e6));
        petals.position.set(R * 0.3, cy + ry * 0.5, -R * 0.2);
        g.add(petals);
      }
    }
  } else if (sp?.form === 'shrub') {
    const blobs = 3;
    for (let i = 0; i < blobs; i++) {
      const s = R * (0.55 + r() * 0.25);
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mat(sp.evergreen ? 0x2f5a32 : green()));
      const a = r() * Math.PI * 2;
      blob.position.set(Math.cos(a) * R * 0.35, Math.min(H * 0.55, s), Math.sin(a) * R * 0.35);
      blob.scale.y = Math.min(1, H / (s * 2));
      g.add(blob);
    }
    g.add(shadowDisk(R));
  } else {
    // Одиночный цветок/куртинка.
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(0.15, R * 0.8), 0), mat(0x6b9a3a));
    leaf.scale.y = 0.6;
    leaf.position.y = H * 0.3;
    const cols = FLOWER_COLORS[sp?.id ?? ''] ?? [0xc0688a];
    const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(0.1, R * 0.45), 0), mat(cols[0], 0.6));
    bloom.position.y = H * 0.75;
    g.add(leaf, bloom);
  }
  return g;
}

/**
 * Клумба: низкий бортик почвы и растения ровными рядами вдоль длинной стороны, шаг — из справочника
 * (spacingM или диаметр куста), ряды в шахматном порядке; каждое — куст листвы у земли и соцветие на высоте вида.
 * Раньше цветки падали случайно по 14 на м²: налезали друг на друга и висели над почвой.
 */
function bedModel(ring: XY[], sp: Species | undefined, stage: Growth, seed: string): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const k = kOf(stage);
  const SOIL = 0.05;
  const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, -y)));
  const soil = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: SOIL, bevelEnabled: false }), mat(0x5a4632));
  soil.rotation.x = Math.PI / 2;
  soil.position.y = SOIL;
  g.add(soil);
  const hMax = sp?.matureHeightM ? (sp.matureHeightM[0] + sp.matureHeightM[1]) / 2 : 0.4;
  const h = Math.max(0.1, hMax * k.h);
  const crown = Math.max(0.12, (sp?.crownDiameterM ?? 0.35) * Math.max(0.35, k.crown));
  // Шаг посадки — из справочника (spacingM), иначе диаметр взрослого куста; не плотнее 0,2 м.
  const step = Math.max(0.2, sp?.spacingM ?? (sp?.crownDiameterM ?? 0.35));
  // Ряды идут вдоль длинной оси клумбы (у бордюра — вдоль улицы), а не по сторонам света.
  const u = longAxis(ring);
  const n: XY = [-u[1], u[0]];
  const st = ring.map(([x, y]) => [x * u[0] + y * u[1], x * n[0] + y * n[1]] as XY);
  const [minS, maxS] = [Math.min(...st.map((p) => p[0])), Math.max(...st.map((p) => p[0]))];
  const [minT, maxT] = [Math.min(...st.map((p) => p[1])), Math.max(...st.map((p) => p[1]))];
  const inside = (x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  };
  // Ровные ряды в шахматном порядке; ряды по центру ширины клумбы, без случайного разброса.
  const nRows = Math.max(1, Math.floor((maxT - minT) / (step * 0.87)));
  const t0 = minT + ((maxT - minT) - (nRows - 1) * step * 0.87) / 2;
  const cells: XY[] = [];
  for (let row = 0; row < nRows; row++) {
    const t = t0 + row * step * 0.87;
    for (let sv = minS + step / 2 + (row % 2 ? step / 2 : 0); sv < maxS - step / 4; sv += step) {
      const x = sv * u[0] + t * n[0];
      const y = sv * u[1] + t * n[1];
      if (inside(x, y)) cells.push([x, y]);
    }
  }
  // Больше 700 растений браузер рисует тяжело: на большой клумбе берём каждое n-е место, сетка остаётся ровной.
  const every = Math.max(1, Math.ceil(cells.length / 700));
  const spots = cells.filter((_, i) => i % every === 0);
  const cols = FLOWER_COLORS[sp?.id ?? ''] ?? (sp?.form === 'shrub' ? [0x6b9a3a] : [0xc0688a]);
  const unit = new THREE.IcosahedronGeometry(1, 0);
  const blooms = cols.map((c) => new THREE.InstancedMesh(unit, mat(c, 0.6), spots.length));
  const leaves = new THREE.InstancedMesh(unit, mat(0x5f8f35), spots.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const counts = cols.map(() => 0);
  spots.forEach(([x, y], i) => {
    const leaf = crown / 2;
    // Куст листвы стоит на почве, соцветие — у верхушки, на высоте вида.
    m4.compose(new THREE.Vector3(x, SOIL + Math.min(h, leaf) * 0.55, -y), q, new THREE.Vector3(leaf, Math.min(h, leaf) * 0.6, leaf));
    leaves.setMatrixAt(i, m4);
    const ci = Math.floor(r() * cols.length);
    const b = Math.max(0.07, crown * 0.42);
    m4.compose(new THREE.Vector3(x, SOIL + h - b * 0.5, -y), q, new THREE.Vector3(b, b * 0.8, b));
    blooms[ci].setMatrixAt(counts[ci]++, m4);
  });
  blooms.forEach((m, i) => { m.count = counts[i]; m.computeBoundingSphere(); g.add(m); });
  leaves.computeBoundingSphere();
  g.add(leaves);
  return g;
}

/** Мировые координаты Web Mercator (0..1) без зависимости от внутренних классов MapLibre. */
function mercator(lng: number, lat: number) {
  const x = (180 + lng) / 360;
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
  const metersToUnits = 1 / (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180));
  return { x, y, s: metersToUnits };
}

export interface SceneInput {
  origin: { lat: number; lng: number };
  siteRing: [number, number][] | null;
  items: ProjectItem[];
  species: Map<string, Species>;
  stage: Growth;
}

const TWEEN_MS = 1100;

/** Растение на своём месте зоны; поворот зависит только от id, поэтому при смене года модель не крутится. */
function placed(it: ProjectItem, sp: Species | undefined, stage: Growth, proj: ReturnType<typeof makeProjection>) {
  const [x, y] = proj.toXY((it.geometry as GeoJsonPoint).coordinates);
  const m = plantModel(sp, stage, it.id);
  m.position.set(x, 0, -y);
  m.rotation.y = rng(it.id + 'r')() * Math.PI * 2;
  return m;
}

/** Смена года пересобирает сотни моделей: без освобождения памяти видеокарты анимация быстро её исчерпает. */
function disposeModels(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | undefined;
    if (material && material !== shadowMat) material.dispose();
    if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
  });
}

/** Слой MapLibre с three.js-сценой. update() пересобирает модели без пересоздания карты. */
export function createPlantingLayer(input: SceneInput) {
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const root = new THREE.Group();
  root.rotation.x = Math.PI / 2; // модели в Y-вверх → Z-вверх MapLibre
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5c, 2.8));
  const sun = new THREE.DirectionalLight(0xfff6e0, 2.4);
  sun.position.set(-40, 80, 30);
  scene.add(sun);
  let renderer: THREE.WebGLRenderer | null = null;
  let map: MlMap | null = null;
  let origin = mercator(input.origin.lng, input.origin.lat);
  let previous: SceneInput | null = null;
  let tween = 0;

  // Плавный переход между годами: модели уже нового размера, масштаб идёт от прежнего к 1.
  // Выпавшие растения остаются на время перехода и уменьшаются до нуля.
  const animate = (parts: { model: THREE.Group; from: THREE.Vector3; to: THREE.Vector3 }[]) => {
    cancelAnimationFrame(tween);
    if (!parts.length || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      parts.forEach(({ model, to }) => model.scale.copy(to));
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / TWEEN_MS);
      const eased = 1 - (1 - p) ** 3;
      parts.forEach(({ model, from, to }) => model.scale.lerpVectors(from, to, eased));
      map?.triggerRepaint();
      if (p < 1) tween = requestAnimationFrame(step);
    };
    parts.forEach(({ model, from }) => model.scale.copy(from));
    tween = requestAnimationFrame(step);
  };

  const build = (inp: SceneInput) => {
    cancelAnimationFrame(tween);
    disposeModels(root);
    root.clear();
    origin = mercator(inp.origin.lng, inp.origin.lat);
    const prev = previous && previous.origin.lat === inp.origin.lat && previous.origin.lng === inp.origin.lng ? previous : null;
    previous = inp;
    const parts: { model: THREE.Group; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
    const k0 = prev ? kOf(prev.stage) : null;
    const k1 = kOf(inp.stage);
    const moved = !!k0 && (k0.h !== k1.h || k0.crown !== k1.crown);
    const one = new THREE.Vector3(1, 1, 1);
    const growFrom = moved ? new THREE.Vector3(k0.crown / k1.crown, k0.h / k1.h, k0.crown / k1.crown) : one;
    const proj = makeProjection(inp.origin);
    if (inp.siteRing) {
      const ring = inp.siteRing.map(proj.toXY);
      const lawn = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, -y)))), new THREE.MeshStandardMaterial({ color: 0xa8c66c, roughness: 1, transparent: true, opacity: 0.75 }));
      lawn.rotation.x = Math.PI / 2;
      lawn.position.y = 0.02;
      root.add(lawn);
    }
    for (const it of inp.items) {
      const sp = inp.species.get(it.speciesId);
      if (it.kind === 'bed') {
        const bed = bedModel((it.geometry as GeoJsonPolygon).coordinates[0].map(proj.toXY), sp, inp.stage, it.id);
        root.add(bed);
        // Клумба растёт только вверх: её координаты отсчитаны от центра зоны, а не от самой клумбы.
        if (moved) parts.push({ model: bed, from: new THREE.Vector3(1, growFrom.y, 1), to: one });
      } else {
        const m = placed(it, sp, inp.stage, proj);
        root.add(m);
        if (moved) parts.push({ model: m, from: growFrom, to: one });
      }
    }
    if (moved && prev) {
      const kept = new Set(inp.items.map((it) => it.id));
      for (const it of prev.items) {
        if (kept.has(it.id) || it.kind === 'bed') continue;
        const m = placed(it, prev.species.get(it.speciesId), prev.stage, proj);
        root.add(m);
        parts.push({ model: m, from: one, to: new THREE.Vector3(0.001, 0.001, 0.001) });
      }
    }
    animate(parts);
    map?.triggerRepaint();
  };
  build(input);

  const layer: CustomLayerInterface = {
    id: 'planting-3d',
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      map = m;
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl, args) {
      if (!renderer) return;
      const l = new THREE.Matrix4().makeTranslation(origin.x, origin.y, 0).scale(new THREE.Vector3(origin.s, -origin.s, origin.s));
      camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(l);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      cancelAnimationFrame(tween);
      disposeModels(root);
      renderer?.dispose();
      renderer = null;
    },
  };
  return { layer, update: build };
}
