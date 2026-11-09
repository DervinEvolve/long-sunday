// The sky: which colours it has where you stand, and the big quiet things that hang in it.
// Clouds with flat bottoms, a drawn sun and a pale moon, islands with roots trailing under them,
// three slow crystals, a few colossal shapes out past the rim and a flock that takes minutes to cross.
// Seven draw calls. Nothing here allocates after it is built.
import * as THREE from 'three';
import type { InkBuilder, InkKit, QualityTier, ColorLike } from '../types';
import { SITES } from '../world/layout';
import { palette } from '../world/palette';
import * as geo from './geo';
import { toHex } from './kit';
import { rng } from './util';

type Builder = Required<InkBuilder>;

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

/** The four sky stops as colours. r, g and b hold the palette's own 0..1 values, exactly as written
 *  in the layout (no colour space conversion), so they blend the way the hex codes look. */
export interface SkyColorsRGB {
  top: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  haze: THREE.Color;
}

/** The same four stops as 0xRRGGBB numbers, which is what `ink.setSky` takes. */
export interface SkyHex {
  top: number;
  mid: number;
  horizon: number;
  haze: number;
}

/** A blank set to hand to `colorsAt`. Make one at start-up and keep it. */
export function skyColors(): SkyColorsRGB {
  return { top: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color(), haze: new THREE.Color() };
}

function pack(c: THREE.Color): number {
  return (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
}

/** Write a blended sky into a reusable object for `ink.setSky(out)`. No allocation. */
export function skyHex(c: SkyColorsRGB, out: SkyHex): SkyHex {
  out.top = pack(c.top);
  out.mid = pack(c.mid);
  out.horizon = pack(c.horizon);
  out.haze = pack(c.haze);
  return out;
}

const NS = SITES.length;
// Per site: centre x, centre z, the radius inside which the sky is purely its own.
const SITE_GEO = new Float64Array(NS * 3);
// Per site: top, mid, horizon, haze as r g b.
const SITE_SKY = new Float64Array(NS * 12);
for (let i = 0; i < NS; i++) {
  const s = SITES[i];
  SITE_GEO[i * 3] = s.center.x;
  SITE_GEO[i * 3 + 1] = s.center.z;
  SITE_GEO[i * 3 + 2] = s.radius * 0.55;
  const stops = [s.sky.top, s.sky.mid, s.sky.horizon, s.sky.haze];
  for (let k = 0; k < 4; k++) {
    const hex = toHex(stops[k]);
    SITE_SKY[i * 12 + k * 3] = (hex >> 16) / 255;
    SITE_SKY[i * 12 + k * 3 + 1] = ((hex >> 8) & 255) / 255;
    SITE_SKY[i * 12 + k * 3 + 2] = (hex & 255) / 255;
  }
}
const mixed = new Float64Array(12);

/** The sky over a point: every district's palette weighted by how near it is. Inside the middle of
 *  a district the answer is exactly that district's palette; between districts it slides. */
function colorsAt(x: number, z: number, out: SkyColorsRGB): void {
  let total = 0;
  let home = -1;
  mixed.fill(0);
  for (let i = 0; i < NS; i++) {
    const d = Math.hypot(x - SITE_GEO[i * 3], z - SITE_GEO[i * 3 + 1]) - SITE_GEO[i * 3 + 2];
    if (d <= 0) {
      home = i;
      break;
    }
    // Falls off fast, so the two or three nearest districts do nearly all the talking.
    const q = d * d + 4;
    const w = 1 / (q * q);
    total += w;
    for (let k = 0; k < 12; k++) mixed[k] += SITE_SKY[i * 12 + k] * w;
  }
  if (home >= 0) {
    for (let k = 0; k < 12; k++) mixed[k] = SITE_SKY[home * 12 + k];
    total = 1;
  }
  const inv = 1 / total;
  out.top.r = mixed[0] * inv; out.top.g = mixed[1] * inv; out.top.b = mixed[2] * inv;
  out.mid.r = mixed[3] * inv; out.mid.g = mixed[4] * inv; out.mid.b = mixed[5] * inv;
  out.horizon.r = mixed[6] * inv; out.horizon.g = mixed[7] * inv; out.horizon.b = mixed[8] * inv;
  out.haze.r = mixed[9] * inv; out.haze.g = mixed[10] * inv; out.haze.b = mixed[11] * inv;
}

/** `colorsAt` without a sky built, for the map or a caption that wants the local colours. */
export const skyColorsAt = colorsAt;

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Euler angles that turn a thing lying flat (facing up) to face along `dir`. */
function facing(dir: THREE.Vector3): [number, number, number] {
  quat.setFromUnitVectors(UP, vA.copy(dir).normalize());
  euler.setFromQuaternion(quat, 'XYZ');
  return [euler.x, euler.y, euler.z];
}

/** One cloud, about three units long, sitting on y = 0 so its underside is a ruled line. */
function cloudShape(kit: InkKit, seed: number, lumps: number): THREE.BufferGeometry {
  const b = kit.builder() as Builder;
  const next = rng(seed);
  const id = b.newId();
  const fill = { bottom: '#e4d9f3', top: '#fffaf0' };
  let x = -lumps * 0.26;
  for (let i = 0; i < lumps; i++) {
    // Tallest toward the middle, like a heaped cumulus.
    const mid = 1 - Math.abs((i + 0.5) / lumps - 0.5) * 2;
    const r = 0.3 + mid * 0.34 + next() * 0.12;
    b.add(geo.dome(r, 9, 4, 0.78 + next() * 0.3, true), { color: '#fffaf0', gradient: fill, pos: [x, 0, (next() - 0.5) * 0.3], scale: [1.25, 1, 1], id });
    if (mid > 0.45 && next() < 0.8) {
      // A second billow riding on the first.
      b.add(geo.sphere(r * 0.62, 8, 5), { color: '#fffaf0', gradient: fill, pos: [x + (next() - 0.5) * 0.3, r * 0.74, (next() - 0.5) * 0.2], id });
    }
    x += r * 0.95 + 0.12;
  }
  return b.geometry();
}

const mat = new THREE.Matrix4();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();

function buildClouds(kit: InkKit, tier: QualityTier, parent: THREE.Group): number {
  const per = tier === 'low' ? 5 : tier === 'medium' ? 7 : 9;
  const next = rng(4711);
  let triangles = 0;
  for (let shape = 0; shape < 2; shape++) {
    const g = cloudShape(kit, 31 + shape * 17, shape === 0 ? 5 : 7);
    const mesh = kit.instances(g, per);
    mesh.name = `clouds-${shape}`;
    for (let i = 0; i < per; i++) {
      // Spread round the compass with a little shuffle, in three layers: a far low bank that sits on
      // the horizon, the middle sky, and a few below eye level so the mesa has something to float over.
      const a = ((i + shape * 0.5) / per) * Math.PI * 2 + (next() - 0.5) * 0.5;
      const layer = (i + shape) % 4;
      let dist: number, y: number, size: number;
      if (layer === 0) { dist = 980 + next() * 160; y = 60 + next() * 70; size = 150 + next() * 70; }
      else if (layer === 3) { dist = 520 + next() * 200; y = -150 - next() * 70; size = 110 + next() * 60; }
      else { dist = 520 + next() * 330; y = 190 + next() * 150; size = 80 + next() * 70; }
      pos.set(Math.cos(a) * dist, y, Math.sin(a) * dist);
      // Long side across the line of sight.
      euler.set(0, -a + Math.PI / 2 + (next() - 0.5) * 0.5, 0);
      quat.setFromEuler(euler);
      scl.set(size, size * (0.5 + next() * 0.2), size * 0.8);
      mesh.setMatrixAt(i, mat.compose(pos, quat, scl));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
    triangles += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * per;
  }
  return triangles;
}

// Where the drawn sun and moon hang. The sun sits lower than the light that shades the world: it is
// there to be seen from the road, not to be correct.
const SUN_AT = new THREE.Vector3(-0.62, 0.36, 0.7).normalize();
const MOON_AT = new THREE.Vector3(0.46, 0.33, -0.82).normalize();
const LIGHTS_FAR = 1250;

function buildLights(kit: InkKit): THREE.Mesh {
  const b = kit.builder() as Builder;
  // Sun: a pale disc with two thin rings round it, all facing the middle of the world.
  const toSun = facing(vB.copy(SUN_AT).negate());
  const sx = SUN_AT.x * LIGHTS_FAR, sy = SUN_AT.y * LIGHTS_FAR, sz = SUN_AT.z * LIGHTS_FAR;
  b.add(geo.disc(74, 36), { color: '#fff3c4', pos: [sx, sy, sz], rot: toSun, flat: 1 });
  b.add(geo.ring(96, 99, 40), { color: '#fff3c4', pos: [sx, sy, sz], rot: toSun, flat: 1, outline: false });
  b.add(geo.ring(124, 126, 40), { color: '#ffe9c9', pos: [sx, sy, sz], rot: toSun, flat: 1, outline: false });
  // Moon: bigger and paler, with a few seas drawn on it.
  const toMoon = facing(vB.copy(MOON_AT).negate());
  const mx = MOON_AT.x * LIGHTS_FAR, my = MOON_AT.y * LIGHTS_FAR, mz = MOON_AT.z * LIGHTS_FAR;
  b.add(geo.disc(118, 44), { color: '#f1ecfb', pos: [mx, my, mz], rot: toMoon, flat: 1 });
  // The seas sit a little nearer than the disc. Work out the moon's own right and up to place them.
  const right = new THREE.Vector3().crossVectors(UP, MOON_AT).normalize();
  const up = new THREE.Vector3().crossVectors(MOON_AT, right).normalize();
  const seas: [number, number, number][] = [[-38, 34, 30], [30, 52, 17], [44, -22, 24], [-22, -48, 15], [-66, -12, 10], [8, 4, 9]];
  for (const [u, v, r] of seas) {
    b.add(geo.disc(r, 18), {
      color: '#ddd3f1',
      pos: [mx + right.x * u + up.x * v - MOON_AT.x * 6, my + right.y * u + up.y * v - MOON_AT.y * 6, mz + right.z * u + up.z * v - MOON_AT.z * 6],
      rot: toMoon,
      flat: 1,
    });
  }
  const mesh = b.build('sun-moon');
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Floating islands: lumps of the same rock as the mesa, adrift a few hundred metres out, with
// roots hanging under them. They stay put in the world so walking the rim moves them against the
// far things.
// ---------------------------------------------------------------------------------------------

type P2 = [number, number];
type P3 = [number, number, number];

// Unit island, rim at radius 1 on y = 0, point at the bottom.
const ISLAND_UNDER: P2[] = [[0, -1.5], [0.1, -1.28], [0.26, -0.86], [0.52, -0.46], [0.84, -0.16], [1, 0]];
const ISLAND_TOP: P2[] = [[1, 0], [0.95, 0.05], [0.5, 0.085], [0, 0.1]];

function island(b: Builder, next: () => number, x: number, y: number, z: number, r: number, deep: number): void {
  const turn = next() * Math.PI * 2;
  const rockId = b.newId();
  b.add(geo.lathe(ISLAND_UNDER, 9, { crease: 28, cacheKey: 'sky-island-under' }), {
    color: palette.rock,
    gradient: { bottom: palette.cliff, top: palette.rock },
    pos: [x, y, z], rot: [0, turn, 0], scale: [r, r * deep, r], id: rockId, hatch: 0.25,
  });
  b.add(geo.lathe(ISLAND_TOP, 9, { crease: 28, cacheKey: 'sky-island-top' }), {
    color: palette.sandLight, pos: [x, y, z], rot: [0, turn, 0], scale: [r, r, r],
  });
  // A stand of columns and a dome or a shrub, so the island has a skyline.
  const columns = 2 + Math.floor(next() * 3);
  const ca = next() * Math.PI * 2;
  for (let i = 0; i < columns; i++) {
    const a = ca + i * 0.9 + next() * 0.4;
    const d = r * (0.2 + next() * 0.35);
    const cr = r * (0.07 + next() * 0.05);
    b.add(geo.hex(cr, r * (0.3 + next() * 0.55), 0.85), {
      color: palette.rock, gradient: { bottom: palette.rockDeep, top: palette.rock },
      pos: [x + Math.cos(a) * d, y + r * 0.05, z + Math.sin(a) * d], rot: [0, next() * 3, 0],
    });
  }
  const oa = ca + Math.PI + (next() - 0.5);
  const od = r * 0.42;
  if (next() < 0.5) {
    b.add(geo.dome(r * 0.2, 10, 4), { color: palette.teal, pos: [x + Math.cos(oa) * od, y + r * 0.06, z + Math.sin(oa) * od] });
  } else {
    b.add(geo.ico(r * 0.2, 1), { color: palette.lavender, pos: [x + Math.cos(oa) * od, y + r * 0.2, z + Math.sin(oa) * od], scale: [1.2, 0.8, 1] });
  }
  // Roots: thin lines hanging from the underside, each with a kink or two.
  const roots = 4 + Math.floor(next() * 3);
  for (let i = 0; i < roots; i++) {
    const a = next() * Math.PI * 2;
    const d = r * (0.1 + next() * 0.4);
    const rx = x + Math.cos(a) * d, rz = z + Math.sin(a) * d;
    // Start inside the rock so the root never floats free of it.
    const top = y - r * deep * (0.55 + (0.4 - d / r) * 0.9);
    const len = r * (0.6 + next() * 1.1);
    const pts: P3[] = [[rx, top, rz]];
    for (let k = 1; k <= 3; k++) {
      pts.push([rx + (next() - 0.5) * r * 0.16, top - (len * k) / 3, rz + (next() - 0.5) * r * 0.16]);
    }
    b.add(geo.tube(pts, r * 0.018, { radial: 4, perSpan: 2 }), { color: '#8f5648', id: rockId });
  }
}

function buildIslands(kit: InkKit, tier: QualityTier): THREE.Mesh {
  const b = kit.builder() as Builder;
  const next = rng(90210);
  // x, height, z, radius, depth of the underside as a multiple of the radius
  const spots: [number, number, number, number, number][] = [
    [352, 78, -214, 44, 1.0],
    [-418, 44, -66, 62, 0.85],
    [268, 30, 352, 32, 1.15],
    [-236, 132, -452, 70, 0.9],
    [-330, 96, 318, 38, 1.05],
  ];
  const count = tier === 'low' ? 3 : tier === 'medium' ? 4 : 5;
  for (let i = 0; i < count; i++) {
    const s = spots[i];
    island(b, next, s[0], s[1], s[2], s[3], s[4]);
    // A crumb or two drifting beside the big one.
    if (i % 2 === 0) island(b, next, s[0] + s[3] * 1.5, s[1] - s[3] * 0.5, s[2] + s[3] * 0.7, s[3] * 0.24, 1.3);
  }
  const mesh = b.build('islands');
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Colossi: three or four enormous things standing in the haze beyond the rim. Nobody says what
// they are. They come up from far below the mesa and only their outlines survive the distance.
// ---------------------------------------------------------------------------------------------

const axis = new THREE.Vector3();

/** Stack boxes along a leaning axis so the joins between them read as strata. */
function leaningStack(b: Builder, x: number, y: number, z: number, yaw: number, lean: number, pieces: [number, number, number, ColorLike][]): void {
  euler.set(0, yaw, lean, 'XYZ');
  axis.set(0, 1, 0).applyEuler(euler);
  let h = 0;
  for (const [w, tall, d, color] of pieces) {
    b.add(geo.bevelBox(w, tall, d, Math.min(w, d) * 0.08), {
      color, pos: [x + axis.x * h, y + axis.y * h, z + axis.z * h], rot: [0, yaw, lean], hatch: 0.3,
    });
    h += tall;
  }
}

function buildColossi(kit: InkKit, tier: QualityTier): THREE.Mesh {
  const b = kit.builder() as Builder;
  // The slab: north, a little west of the Observatory, leaning. Seen from the spine it stands behind the hill.
  leaningStack(b, -176, -420, -690, 0.5, 0.11, [
    [128, 250, 46, palette.cliff],
    [122, 150, 44, palette.rockDeep],
    [118, 96, 42, palette.rock],
    [112, 58, 40, palette.rockDeep],
    [104, 150, 38, palette.rock],
    [60, 34, 30, palette.stone],
  ]);
  // The ring: east, standing on edge, a third of it under the haze line.
  b.add(geo.torus(190, 17, 30, 6), { color: palette.stone, pos: [660, -30, -40], rot: [0.08, 1.1, Math.PI / 2] });
  b.add(geo.torus(190, 19, 4, 6, 0.42), { color: palette.teal, pos: [660, -30, -40], rot: [0.08, 1.1, Math.PI / 2 + 0.5] });
  if (tier !== 'low') {
    // The domes: south west, three teal caps on thin stalks like something that grew.
    const caps: [number, number, number, number, number][] = [[-560, 150, 430, 92, 15], [-668, 62, 330, 58, 10], [-470, 6, 560, 44, 8]];
    for (const [x, top, z, r, stalk] of caps) {
      const id = b.newId();
      b.add(geo.cylinder(stalk * 0.7, stalk * 1.6, top + 460, 7), { color: palette.stone, pos: [x, -460, z], id });
      b.add(geo.dome(r, 14, 5, 0.72, true), { color: palette.teal, gradient: { bottom: palette.tealDeep, top: palette.teal }, pos: [x, top, z] });
      b.add(geo.cone(r * 0.94, r * 0.5, 14), { color: palette.stoneShade, pos: [x, top, z], rot: [Math.PI, 0, 0], id });
    }
    // The columns: south east, the same six sided rock as the mesa at fifty times the size.
    const cols: [number, number, number, number][] = [[520, 210, 520, 46], [588, 120, 500, 38], [540, 40, 596, 52], [470, -20, 590, 34]];
    for (const [x, top, z, r] of cols) {
      b.add(geo.hex(r, top + 480, 0.9), { color: palette.rock, gradient: { bottom: palette.cliff, top: palette.rock }, pos: [x, -480, z], rot: [0, x * 0.01, 0], hatch: 0.2 });
    }
  }
  const mesh = b.build('colossi');
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Crystals and the flock: the only things up here that move by themselves.
// ---------------------------------------------------------------------------------------------

const CRYSTALS: { x: number; y: number; z: number; size: number; tilt: number; rate: number; color: ColorLike }[] = [
  { x: -300, y: 150, z: 210, size: 20, tilt: 0.22, rate: 0.09, color: palette.cyan },
  { x: 318, y: 196, z: 96, size: 26, tilt: -0.3, rate: -0.06, color: palette.pink },
  { x: 60, y: 236, z: -372, size: 32, tilt: 0.16, rate: 0.045, color: palette.mint },
];

function buildCrystals(kit: InkKit): THREE.InstancedMesh {
  const b = kit.builder() as Builder;
  const id = b.newId();
  // Baked nearly white so the instance colour is the colour.
  b.add(geo.cone(0.46, 1.5, 6), { color: '#ffffff', gradient: { bottom: '#e9e4f4', top: '#ffffff' }, id });
  b.add(geo.cone(0.46, 0.8, 6), { color: '#e9e4f4', gradient: { bottom: '#cfc6e6', top: '#e9e4f4' }, rot: [Math.PI, 0, 0], id });
  const mesh = kit.instances(b.geometry(), CRYSTALS.length, { flat: 0.25 });
  mesh.name = 'crystals';
  const c = new THREE.Color();
  for (let i = 0; i < CRYSTALS.length; i++) mesh.setColorAt(i, c.set(CRYSTALS[i].color));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

const FLOCK_CX = 96;
const FLOCK_CZ = -30;
const FLOCK_R = 215;
const FLOCK_Y = 92;
const FLOCK_PERIOD = 250;

function buildFlock(kit: InkKit, count: number): THREE.InstancedMesh {
  const b = kit.builder() as Builder;
  // A ray or a kite: nose, two long wingtips, a notch and a thin tail. Drawn flat, nose toward -z.
  const outline: P2[] = [[0, 1], [-0.5, 0.35], [-1.9, -0.15], [-0.45, -0.3], [-0.08, -0.5], [0, -1.7], [0.08, -0.5], [0.45, -0.3], [1.9, -0.15], [0.5, 0.35]];
  b.add(geo.extrude(outline, 0.1, { cacheKey: 'sky-ray' }), { color: palette.stone, rot: [-Math.PI / 2, 0, 0], flat: 0.5 });
  const mesh = kit.instances(b.geometry(), count);
  mesh.name = 'flock';
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// The sky itself
// ---------------------------------------------------------------------------------------------

const spin = new THREE.Euler(0, 0, 0, 'XYZ');
const bank = new THREE.Euler(0, 0, 0, 'YXZ');

function trianglesOf(mesh: THREE.Mesh): number {
  const g = mesh.geometry;
  const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  return mesh instanceof THREE.InstancedMesh ? n * mesh.count : n;
}

export interface Sky {
  group: THREE.Group;
  /** Sky colours for someone standing at x, z. Writes into `out`, allocates nothing. */
  colorsAt(x: number, z: number, out: SkyColorsRGB): void;
  /** Call once a frame. `t` is seconds since the world started. */
  update(dt: number, t: number, cameraPosition: THREE.Vector3): void;
  triangles: number;
}

/** Everything above and beyond the mesa. Seven draw calls. */
export function createSky(kit: InkKit, tier: QualityTier): Sky {
  const group = new THREE.Group();
  group.name = 'sky';

  // Clouds ride a ring that follows the walker most of the way, so they slide a little against the
  // far things but never get any nearer.
  const ring = new THREE.Group();
  ring.name = 'cloud-ring';
  let triangles = buildClouds(kit, tier, ring);
  group.add(ring);

  const lights = buildLights(kit);
  const islands = buildIslands(kit, tier);
  const colossi = buildColossi(kit, tier);
  const crystals = buildCrystals(kit);
  const flockCount = tier === 'low' ? 9 : tier === 'medium' ? 13 : 17;
  const flock = buildFlock(kit, flockCount);
  group.add(lights, islands, colossi, crystals, flock);
  triangles += trianglesOf(lights) + trianglesOf(islands) + trianglesOf(colossi) + trianglesOf(crystals) + trianglesOf(flock);

  function update(_dt: number, t: number, cameraPosition: THREE.Vector3): void {
    ring.position.set(cameraPosition.x * 0.85, 0, cameraPosition.z * 0.85);
    ring.rotation.y = t * 0.0012;
    lights.position.set(cameraPosition.x, 0, cameraPosition.z);

    for (let i = 0; i < CRYSTALS.length; i++) {
      const c = CRYSTALS[i];
      spin.set(c.tilt, t * c.rate + i * 2.1, c.tilt * 0.5);
      quat.setFromEuler(spin);
      pos.set(c.x, c.y + Math.sin(t * 0.21 + i * 2) * 3, c.z);
      scl.set(c.size, c.size, c.size);
      crystals.setMatrixAt(i, mat.compose(pos, quat, scl));
    }
    crystals.instanceMatrix.needsUpdate = true;

    // The flock flies a wide slow circle that crosses the middle of the mesa. A loose V: each pair
    // sits a little further back and a little further out than the pair in front.
    const lead = (t / FLOCK_PERIOD) * Math.PI * 2 + 2.4;
    for (let i = 0; i < flockCount; i++) {
      const row = (i + 1) >> 1;
      const side = i & 1 ? 1 : -1;
      const wobble = Math.sin(t * 0.37 + i * 1.7);
      const a = lead - (row * 7.5 + wobble * 1.2) / FLOCK_R;
      const r = FLOCK_R + side * row * 5.2 + Math.sin(t * 0.23 + i * 2.9) * 1.4;
      pos.set(FLOCK_CX + Math.cos(a) * r, FLOCK_Y + row * 0.9 + wobble * 1.3, FLOCK_CZ + Math.sin(a) * r);
      bank.set(wobble * 0.05, Math.PI - a, 0.16 + Math.sin(t * 0.9 + i) * 0.12);
      quat.setFromEuler(bank);
      // Wings beat by squashing the span. At this size nobody can tell.
      const beat = 0.78 + 0.22 * Math.sin(t * 2.6 + i * 1.3);
      scl.set(1.7 * beat, 1.7, 1.7);
      flock.setMatrixAt(i, mat.compose(pos, quat, scl));
    }
    flock.instanceMatrix.needsUpdate = true;
  }

  update(0, 0, vA.set(0, 0, 0));
  return { group, colorsAt, update, triangles };
}
