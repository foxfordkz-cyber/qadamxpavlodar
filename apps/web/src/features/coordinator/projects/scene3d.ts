// 3D-сцена посадок на three.js внутри MapLibre (custom layer). Низкополигональные
// процедурные модели: без внешних файлов, размеры — из справочника, форма — по типу вида.
import * as THREE from 'three';
import type { CustomLayerInterface, Map as MlMap } from 'maplibre-gl';
import type { GeoJsonPoint, GeoJsonPolygon, ProjectItem, Species } from '../../../shared/api/types';
import { makeProjection, ringAreaXY, type XY } from '../../../shared/geo';
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

/** Модель растения в локальных метрах (Y вверх). */
function plantModel(sp: Species | undefined, stage: Stage, seed: string): THREE.Group {
  const r = rng(seed);
  const k = STAGE_K[stage];
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
      if (sp.floweringMonths?.length && stage !== 'planting') {
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

/** Клумба: почва, листва и россыпь цветков (InstancedMesh, до 900 шт.). */
function bedModel(ring: XY[], sp: Species | undefined, stage: Stage, seed: string): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, -y)));
  const soil = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }), mat(0x6e5a3e));
  soil.rotation.x = Math.PI / 2;
  soil.position.y = 0.12;
  g.add(soil);
  const area = ringAreaXY(ring);
  const hMax = sp?.matureHeightM ? (sp.matureHeightM[0] + sp.matureHeightM[1]) / 2 : 0.4;
  const h = Math.max(0.12, hMax * STAGE_K[stage].h);
  const n = Math.min(900, Math.round(area * 14));
  const cols = FLOWER_COLORS[sp?.id ?? ''] ?? (sp?.form === 'shrub' ? [0x6b9a3a] : [0xc0688a]);
  const geo = new THREE.IcosahedronGeometry(0.11, 0);
  const meshes = cols.map((c) => new THREE.InstancedMesh(geo, mat(c, 0.6), n));
  const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 0), mat(0x5f8f35), n);
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const inside = (x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  };
  const m4 = new THREE.Matrix4();
  const counts = cols.map(() => 0);
  let placed = 0;
  for (let tries = 0; placed < n && tries < n * 4; tries++) {
    const x = minX + r() * (maxX - minX);
    const y = minY + r() * (maxY - minY);
    if (!inside(x, y)) continue;
    const ci = Math.floor(r() * cols.length);
    m4.makeTranslation(x, 0.12 + h, -y);
    meshes[ci].setMatrixAt(counts[ci]++, m4);
    m4.makeTranslation(x + 0.05, 0.12 + h * 0.5, -y + 0.05);
    leaves.setMatrixAt(placed, m4);
    placed++;
  }
  meshes.forEach((m, i) => { m.count = counts[i]; g.add(m); });
  leaves.count = placed;
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
  stage: Stage;
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

  const build = (inp: SceneInput) => {
    root.clear();
    origin = mercator(inp.origin.lng, inp.origin.lat);
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
        root.add(bedModel((it.geometry as GeoJsonPolygon).coordinates[0].map(proj.toXY), sp, inp.stage, it.id));
      } else {
        const [x, y] = proj.toXY((it.geometry as GeoJsonPoint).coordinates);
        const m = plantModel(sp, inp.stage, it.id);
        m.position.set(x, 0, -y);
        m.rotation.y = rng(it.id + 'r')() * Math.PI * 2;
        root.add(m);
      }
    }
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
      renderer?.dispose();
      renderer = null;
    },
  };
  return { layer, update: build };
}
