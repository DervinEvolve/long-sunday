// The sky: which colours it has where you stand, and the big quiet things that hang in it.
// Clouds with flat bottoms, a drawn sun and a pale moon, and beyond the rim the rest of the city:
// other islands carrying glass towers with gardens on every ledge, a temple, a rotunda, a stepped
// garden, a brass armillary on a ring of columns, a marble column the size of a skyscraper and
// most of a pediment adrift. A flock takes minutes to cross it all.
// Nine draw calls. Nothing here allocates after it is built.
import * as THREE from 'three';
import type { InkBuilder, InkKit, QualityTier, ColorLike } from '../types';
import { SITES } from '../world/layout';
import { palette } from '../world/palette';
import * as geo from './geo';
import { toHex } from './kit';
import { rng } from './util';
import { lineEnd } from './city';

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
      // the horizon, the middle sky, and a few below eye level so the island has something to float over.
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
// The skyline: other islands adrift beyond the rim. Each is a lawn on a lump of bedrock with a
// piece of the same city on it: slim glass towers with a hedge on every ledge, a temple front, a
// rotunda, a stepped garden. Vines hang over their edges and roots trail under them. They stay
// put in the world, so walking the rim slides the near ones against the far ones, and the haze
// turns the far ones into outlines.
// ---------------------------------------------------------------------------------------------

type P2 = [number, number];
type P3 = [number, number, number];

const GREENS: ColorLike[] = [palette.grass, palette.leaf, palette.leafDeep, palette.grassDeep, palette.moss];
const MARBLE = { bottom: palette.marbleShade, top: palette.marble };
const GLASS = { bottom: palette.steel, top: palette.glass };
const COPPER = { bottom: palette.teal, top: palette.verdigris };

const BOX = geo.box(1, 1, 1);
// A column a metre tall and a metre in radius, a little wider at the foot. No caps: nobody gets close.
const SHAFT = geo.cylinder(1, 1.14, 1, 6, true);
// A gable one unit wide and one deep, ridge along z.
const GABLE = geo.extrude([[-0.5, 0], [0.5, 0], [0, 0.2]], 1, { cacheKey: 'sky-gable' });
const LEAF = geo.ico(1, 0);
// A strand of something green: stands point up, so turn it over to hang.
const HANG = geo.cone(1, 1, 5);
const CRUMB = geo.cone(1, 1, 7);

/** Part way from one authored colour to another, byte by byte. */
function mixHex(a: ColorLike, b: ColorLike, k: number): number {
  const x = toHex(a), y = toHex(b);
  const ch = (s: number) => Math.round(((x >> s) & 255) + (((y >> s) & 255) - ((x >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A place to build: a point and a heading. Local x runs along the front, local z comes out of it. */
class Plot {
  x: number; y: number; z: number; yaw: number;
  private cs: number; private sn: number;
  constructor(x: number, y: number, z: number, yaw: number) {
    this.x = x; this.y = y; this.z = z; this.yaw = yaw;
    this.cs = Math.cos(yaw); this.sn = Math.sin(yaw);
  }
  p(lx: number, ly: number, lz: number): P3 {
    return [this.x + lx * this.cs + lz * this.sn, this.y + ly, this.z - lx * this.sn + lz * this.cs];
  }
  r(extra = 0): P3 { return [0, this.yaw + extra, 0]; }
  at(lx: number, ly: number, lz: number, turn = 0): Plot {
    const q = this.p(lx, ly, lz);
    return new Plot(q[0], q[1], q[2], this.yaw + turn);
  }
}

/** The heading that turns a front toward the home island from x, z. */
function homeward(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

// Unit island: rim at radius 1 on y = 0, a point at the bottom, a band of soil, a flat lawn.
const ISLAND_UNDER: P2[] = [[0, -1.5], [0.1, -1.28], [0.26, -0.86], [0.52, -0.46], [0.84, -0.16], [1, 0]];
const ISLAND_SOIL: P2[] = [[1, 0], [1.015, 0.03], [1, 0.06]];
const ISLAND_LAWN: P2[] = [[1, 0.06], [0.94, 0.085], [0, 0.085]];
const LAWN = 0.085;

/** The lump itself, with its vines and roots. Hands back the lawn to build on. */
function island(b: Builder, next: () => number, x: number, y: number, z: number, r: number, deep: number, vines: number, roots: number): Plot {
  const turn = next() * Math.PI * 2;
  const rockId = b.newId();
  b.add(geo.lathe(ISLAND_UNDER, 10, { crease: 28, cacheKey: 'sky-island-under' }), {
    color: palette.lavender,
    gradient: { bottom: palette.violet, top: palette.stoneShade },
    pos: [x, y, z], rot: [0, turn, 0], scale: [r, r * deep, r], id: rockId, hatch: 0.25,
  });
  b.add(geo.lathe(ISLAND_SOIL, 10, { crease: 28, cacheKey: 'sky-island-soil' }), {
    color: palette.brickDeep, pos: [x, y, z], rot: [0, turn, 0], scale: [r, r, r],
  });
  b.add(geo.lathe(ISLAND_LAWN, 10, { crease: 28, cacheKey: 'sky-island-lawn' }), {
    color: palette.grass, gradient: { bottom: palette.grassDeep, top: palette.grass }, pos: [x, y, z], rot: [0, turn, 0], scale: [r, r, r],
  });
  // Vines: green spilling over the lip and hanging to a point, a long strand and a short one together.
  for (let i = 0; i < vines; i++) {
    const a = next() * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const len = r * (0.5 + next() * 0.9);
    const out = r * 0.99;
    const color = GREENS[2 + (i % 3)];
    b.add(HANG, { color, pos: [x + ca * out, y + r * 0.07, z + sa * out], rot: [Math.PI, a, 0], scale: [r * 0.05, len, r * 0.05] });
    b.add(HANG, { color: GREENS[(i + 1) % GREENS.length], pos: [x + Math.cos(a + 0.09) * out, y + r * 0.075, z + Math.sin(a + 0.09) * out], rot: [Math.PI, a, 0], scale: [r * 0.085, len * (0.3 + next() * 0.25), r * 0.06] });
  }
  // Roots: thin lines from the underside, each with a kink or two.
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
    b.add(geo.tube(pts, r * 0.018, { radial: 3, perSpan: 1 }), { color: '#7a5a8e', id: rockId });
  }
  return new Plot(x, y + r * LAWN, z, turn);
}

/** Round trees in a ring between two radii. At this range a tree is a green lump with a line round it. */
function grove(b: Builder, next: () => number, g: Plot, count: number, inner: number, outer: number, size: number): void {
  for (let i = 0; i < count; i++) {
    const a = next() * Math.PI * 2;
    const d = inner + next() * (outer - inner);
    const s = size * (0.7 + next() * 0.6);
    b.add(LEAF, { color: GREENS[(i * 3 + 1) % GREENS.length], pos: g.p(Math.cos(a) * d, s * 0.7, Math.sin(a) * d), rot: [0, next() * 3, 0], scale: [s * 1.2, s, s * 1.2] });
  }
}

/** A slim glass tower: two or three set-backs, a hedge round every ledge, balconies with a bush each. */
function tower(b: Builder, next: () => number, g: Plot, w: number, h: number, plain = false): void {
  const d = w * (0.72 + next() * 0.28);
  const share = h > w * 4.2 ? [0.46, 0.32, 0.22] : [0.62, 0.38];
  const plate = Math.max(0.9, h * 0.011);
  let y = 0, cw = w, cd = d;
  for (let i = 0; i < share.length; i++) {
    const part = h * share[i];
    b.add(BOX, { color: palette.glass, gradient: GLASS, pos: g.p(0, y, 0), rot: g.r(), scale: [cw, part, cd], hatch: 0.08 });
    // Floor plates: a few pale bands so the glass has a scale.
    const bands = plain ? 1 : i === 0 ? 3 : 2;
    for (let k = 1; k <= bands; k++) {
      b.add(BOX, { color: palette.marble, pos: g.p(0, y + (part * k) / (bands + 1), 0), rot: g.r(), scale: [cw * 1.06, plate, cd * 1.06] });
    }
    y += part;
    if (i < share.length - 1) {
      // The ledge and its hedge.
      b.add(BOX, { color: palette.marble, pos: g.p(0, y, 0), rot: g.r(), scale: [cw * 1.12, plate, cd * 1.12] });
      b.add(BOX, { color: GREENS[(i + Math.floor(next() * 4)) % GREENS.length], pos: g.p(0, y + plate, 0), rot: g.r(), scale: [cw * 1.04, w * 0.17, cd * 1.04] });
      cw *= 0.66; cd *= 0.7;
    }
  }
  // Roof garden and a mast.
  b.add(BOX, { color: palette.marble, pos: g.p(0, y, 0), rot: g.r(), scale: [cw * 1.1, plate, cd * 1.1] });
  b.add(LEAF, { color: GREENS[Math.floor(next() * GREENS.length)], pos: g.p(cw * 0.12, y + w * 0.16, 0), scale: [cw * 0.5, w * 0.24, cd * 0.5] });
  b.add(SHAFT, { color: palette.steel, pos: g.p(-cw * 0.25, y, -cd * 0.2), scale: [w * 0.03, h * 0.16, w * 0.03] });
  // Balconies: a slab out of one face with a bush on it.
  const count = plain ? 0 : 2 + Math.floor(next() * 2);
  for (let k = 0; k < count; k++) {
    const side = k & 1 ? 1 : -1;
    const by = h * share[0] * (0.2 + next() * 0.7);
    const lz = (next() - 0.5) * d * 0.4;
    b.add(BOX, { color: palette.marble, pos: g.p(side * w * 0.62, by, lz), rot: g.r(), scale: [w * 0.34, plate, d * 0.5] });
    b.add(LEAF, { color: GREENS[(k + 2) % GREENS.length], pos: g.p(side * w * 0.66, by + plate + w * 0.1, lz), scale: [w * 0.15, w * 0.13, d * 0.22] });
  }
}

/** A round tower: glass drum, terrace rings with planting, a copper cap. */
function roundTower(b: Builder, next: () => number, g: Plot, r: number, h: number): void {
  b.add(geo.prism(8, 0.84, 1, 1), { color: palette.glass, gradient: GLASS, pos: g.p(0, 0, 0), rot: g.r(), scale: [r, h, r], hatch: 0.08 });
  const rings = 3;
  for (let k = 1; k <= rings; k++) {
    const y = (h * k) / (rings + 0.6);
    const rr = r * (1.62 - k * 0.14);
    b.add(geo.cylinder(1, 1, 1, 8), { color: palette.marble, pos: g.p(0, y, 0), rot: g.r(), scale: [rr, Math.max(0.9, h * 0.011), rr] });
    b.add(geo.cylinder(1, 1, 1, 8), { color: GREENS[(k + Math.floor(next() * 3)) % GREENS.length], pos: g.p(0, y + Math.max(0.9, h * 0.011), 0), rot: g.r(), scale: [rr * 0.93, r * 0.22, rr * 0.93] });
  }
  b.add(geo.dome(1, 8, 3), { color: palette.verdigris, gradient: COPPER, pos: g.p(0, h, 0), rot: g.r(), scale: [r * 0.84, r * 0.7, r * 0.84] });
  b.add(SHAFT, { color: palette.steel, pos: g.p(0, h + r * 0.6, 0), scale: [r * 0.05, h * 0.14, r * 0.05] });
}

/** A temple `w` across the front: steps, columns all round, a plain room inside, a gabled roof. */
function temple(b: Builder, g: Plot, w: number, cols = 6): void {
  const d = w * 1.7, ch = w * 0.58, cr = w * 0.04, step = ch * 0.07;
  b.add(BOX, { color: palette.marbleShade, pos: g.p(0, 0, 0), rot: g.r(), scale: [w * 1.18, step, d * 1.1] });
  b.add(BOX, { color: palette.marble, pos: g.p(0, step, 0), rot: g.r(), scale: [w * 1.09, step, d * 1.05] });
  const y0 = step * 2;
  b.add(BOX, { color: '#c9bedd', pos: g.p(0, y0, 0), rot: g.r(), scale: [w * 0.6, ch, d * 0.76], hatch: 0.2 });
  const stone = { color: palette.marble, gradient: MARBLE } as const;
  for (const lz of [d * 0.47, -d * 0.47]) {
    for (let i = 0; i < cols; i++) {
      b.add(SHAFT, { ...stone, pos: g.p((i / (cols - 1) - 0.5) * w * 0.9, y0, lz), scale: [cr, ch, cr] });
    }
  }
  const along = Math.max(3, Math.round(cols * 1.2));
  for (const lx of [w * 0.45, -w * 0.45]) {
    for (let i = 1; i < along; i++) {
      b.add(SHAFT, { ...stone, pos: g.p(lx, y0, (i / along - 0.5) * d * 0.94), scale: [cr, ch, cr] });
    }
  }
  b.add(BOX, { color: palette.marble, pos: g.p(0, y0 + ch, 0), rot: g.r(), scale: [w, ch * 0.17, d] });
  b.add(GABLE, { color: palette.marble, gradient: MARBLE, pos: g.p(0, y0 + ch * 1.17, 0), rot: g.r(), scale: [w * 1.08, w * 1.08, d * 1.03] });
}

/** A rotunda of radius `r`: a drum in a ring of columns, a copper dome, a porch to the front. */
function rotunda(b: Builder, g: Plot, r: number): void {
  b.add(geo.cylinder(1.25, 1.3, 0.1, 14), { color: palette.marbleShade, pos: g.p(0, 0, 0), scale: r });
  const y0 = r * 0.1;
  b.add(geo.cylinder(0.8, 0.8, 0.95, 14), { color: palette.marble, gradient: MARBLE, pos: g.p(0, y0, 0), scale: r, hatch: 0.12 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(SHAFT, { color: palette.marble, gradient: MARBLE, pos: g.p(Math.cos(a) * r * 1.05, y0, Math.sin(a) * r * 1.05), scale: [r * 0.05, r * 0.8, r * 0.05] });
  }
  b.add(geo.cylinder(1.14, 1.14, 0.13, 14), { color: palette.marble, pos: g.p(0, y0 + r * 0.8, 0), scale: r });
  b.add(geo.cylinder(0.86, 0.86, 0.22, 14), { color: palette.marbleShade, pos: g.p(0, y0 + r * 0.93, 0), scale: r });
  b.add(geo.dome(0.84, 14, 4, 0.92), { color: palette.verdigris, gradient: COPPER, pos: g.p(0, y0 + r * 1.15, 0), scale: r });
  b.add(geo.cylinder(0.12, 0.12, 0.2, 8), { color: palette.marble, pos: g.p(0, y0 + r * 1.9, 0), scale: r });
  b.add(geo.cone(0.17, 0.24, 8), { color: palette.verdigris, pos: g.p(0, y0 + r * 2.1, 0), scale: r });
  // The porch: four columns and a gable.
  for (const lx of [-0.45, -0.15, 0.15, 0.45]) {
    b.add(SHAFT, { color: palette.marble, gradient: MARBLE, pos: g.p(lx * r, y0, r * 1.5), scale: [r * 0.05, r * 0.8, r * 0.05] });
  }
  b.add(BOX, { color: palette.marble, pos: g.p(0, y0 + r * 0.8, r * 1.28), rot: g.r(), scale: [r * 1.1, r * 0.13, r * 0.56] });
  b.add(GABLE, { color: palette.marble, gradient: MARBLE, pos: g.p(0, y0 + r * 0.93, r * 1.28), rot: g.r(), scale: [r * 1.18, r * 1.18, r * 0.6] });
}

/** A stepped garden `w` wide: four terraces, planting along every lip and hanging down every face. */
function gardens(b: Builder, next: () => number, g: Plot, w: number): void {
  const d = w * 0.82, th = w * 0.13;
  for (let i = 0; i < 4; i++) {
    const k = 1 - i * 0.22;
    const y = i * th;
    b.add(BOX, { color: palette.marble, gradient: MARBLE, pos: g.p(0, y, 0), rot: g.r(), scale: [w * k, th, d * k], hatch: 0.1 });
    b.add(BOX, { color: GREENS[i % 3], pos: g.p(0, y + th, 0), rot: g.r(), scale: [w * k * 1.03, th * 0.2, d * k * 1.03] });
    // Curtains of green over the front and back.
    for (const face of [1, -1]) {
      for (let c = 0; c < 3; c++) {
        const cw = w * k * (0.07 + next() * 0.12);
        const drop = th * (0.45 + next() * 0.75);
        b.add(BOX, { color: GREENS[(c + i + 2) % GREENS.length], pos: g.p((next() - 0.5) * w * k * 0.8, y + th * 1.1 - drop, face * (d * k * 0.5 + w * 0.006)), rot: g.r(), scale: [cw, drop, w * 0.012] });
      }
    }
  }
  // A pavilion on the top step and a few trees on the lower ones.
  const top = 4 * th + th * 0.2;
  const pw = w * 0.16;
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.add(SHAFT, { color: palette.marble, pos: g.p(lx * pw * 0.42, top, lz * pw * 0.42), scale: [pw * 0.05, pw * 0.7, pw * 0.05] });
  }
  b.add(GABLE, { color: palette.marble, pos: g.p(0, top + pw * 0.7, 0), rot: g.r(), scale: [pw * 1.15, pw * 1.15, pw * 1.1] });
  for (let i = 0; i < 6; i++) {
    const tier = i % 3;
    const k = 1 - tier * 0.22;
    const s = w * 0.05;
    b.add(LEAF, { color: GREENS[(i + 1) % GREENS.length], pos: g.p((i & 1 ? 1 : -1) * w * k * (0.36 + next() * 0.1), (tier + 1) * th + s * 0.8, (next() - 0.5) * d * k * 0.7), scale: [s * 1.2, s, s * 1.2] });
  }
}

// The armillary: an old instrument the size of a city block. Three brass hoops, each a full circle
// leaning its own way, inside one broad copper band round the middle, and a brass ball held at the
// centre on a spindle. It stands over a ring of marble columns on a stepped drum, with a clipped
// bed and cypresses round the foot. The hoops are their own mesh so they can turn.
const ARM_R = 24;
const ARM_RING = ARM_R * 0.62;
const ARM_COLUMN = ARM_R * 0.6;
const ARM_STEP = ARM_R * 0.05;
/** From the top of the drum to the middle of the hoops. */
const ARM_LIFT = ARM_COLUMN + ARM_R * 1.12;

/** The stepped drum, its planting and the ring of columns. Hands back the height of the middle of the hoops. */
function armillaryStand(b: Builder, g: Plot): number {
  const R = ARM_R;
  // Three steps. The lowest is wide, and all of its tread is a clipped bed.
  b.add(geo.cylinder(1.36, 1.4, 0.05, 16), { color: palette.marbleShade, pos: g.p(0, 0, 0), scale: R });
  b.add(geo.cylinder(1.3, 1.3, 0.03, 16), { color: palette.leafDeep, pos: g.p(0, ARM_STEP, 0), scale: R });
  b.add(geo.cylinder(1.02, 1.04, 0.05, 16), { color: palette.marble, pos: g.p(0, ARM_STEP, 0), scale: R });
  b.add(geo.cylinder(0.8, 0.82, 0.05, 16), { color: palette.marble, pos: g.p(0, ARM_STEP * 2, 0), scale: R });
  const y0 = ARM_STEP * 3;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add(SHAFT, { color: palette.marble, gradient: MARBLE, pos: g.p(Math.cos(a) * ARM_RING, y0, Math.sin(a) * ARM_RING), scale: [R * 0.055, ARM_COLUMN, R * 0.055] });
  }
  b.add(geo.torus(ARM_RING, R * 0.075, 16, 4), { color: palette.marble, pos: g.p(0, y0 + ARM_COLUMN + R * 0.05, 0) });
  // Cypresses in the bed, tall and short by turns.
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    const tall = R * (i & 1 ? 0.34 : 0.46);
    b.add(HANG, { color: i & 1 ? palette.leafDeep : palette.grassDeep, pos: g.p(Math.cos(a) * R * 1.17, ARM_STEP, Math.sin(a) * R * 1.17), scale: [R * 0.075, tall, R * 0.075] });
  }
  return y0 + ARM_LIFT;
}

const armAt = new THREE.Vector3();
const armTurn = new THREE.Euler();

function buildArmillary(kit: InkKit): THREE.Mesh {
  const b = kit.builder() as Builder;
  const id = b.newId();
  const R = ARM_R;
  const brass = { color: palette.brass, gradient: { bottom: '#a8842f', top: '#ecd27a' }, id, flat: 0.3 } as const;
  // Each hoop is a little smaller than the last so they nest, and a band, taller than it is thick.
  // [radius, lean about x, lean about z, sides]
  const hoops: [number, number, number, number][] = [
    [R * 0.96, Math.PI / 2, 0, 28],
    [R * 0.89, 0, 1.0, 26],
    [R * 0.82, -0.5, -0.38, 24],
  ];
  for (const [r, rx, rz, sides] of hoops) {
    b.add(geo.torus(r, 0.7, sides, 4), { ...brass, rot: [rx, 0, rz], scale: [1, 2, 1] });
  }
  // The band round the middle, broad and green with age.
  b.add(geo.torus(R * 1.02, 0.7, 28, 4), { color: palette.verdigris, gradient: COPPER, scale: [1, 2.8, 1], flat: 0.3 });
  // The spindle runs from the drum up through the ball and out of the top, where it ends in a point.
  const foot = -(ARM_LIFT + 0.5);
  b.add(geo.cylinder(0.6, 0.6, 1, 5, true), { ...brass, pos: [0, foot, 0], scale: [1, R * 1.03 - foot, 1] });
  b.add(geo.cone(1, 1, 5), { ...brass, pos: [0, R * 1.03, 0], scale: [1.5, 3.8, 1.5] });
  for (const end of [-1, 1]) b.add(LEAF, { ...brass, pos: [0, end * R * 0.96, 0], scale: 1.7 });
  b.add(geo.ico(1, 1), { color: palette.brass, gradient: { bottom: '#b08a30', top: '#f0d886' }, pos: [0, 0, 0], scale: R * 0.2, flat: 0.25 });
  // Ivy has got up two of the hoops: a clump where it sits, and a strand hanging off it.
  // [hoop, how far round it, clump size, strand length]
  const ivy: [number, number, number, number][] = [[1, 2.05, 2.6, 8], [1, 2.5, 1.9, 0], [2, 0.75, 2.3, 6], [0, 2.45, 2.2, 7], [2, 4.1, 1.7, 0]];
  for (let i = 0; i < ivy.length; i++) {
    const [h, round, size, strand] = ivy[i];
    const [r, rx, rz] = hoops[h];
    armAt.set(Math.cos(round) * r, 0, Math.sin(round) * r).applyEuler(armTurn.set(rx, 0, rz));
    const green = b.newId();
    b.add(LEAF, { color: GREENS[(i * 2 + 1) % GREENS.length], pos: [armAt.x, armAt.y, armAt.z], rot: [0, i * 1.3, 0], scale: [size * 1.25, size * 0.8, size * 1.1], id: green });
    if (strand > 0) b.add(HANG, { color: palette.leafDeep, pos: [armAt.x, armAt.y, armAt.z], rot: [Math.PI, 0, 0], scale: [0.8, strand, 0.8], id: green });
  }
  return b.build('armillary');
}

// What goes where. Height is the rim of the lump; the lawn is a little above it.
// The first one is moved to wherever the elevated line runs out, at the height of its deck, so the
// train has somewhere to be going. The place written here is only what it comes to on the long line.
interface Spot { kind: 'terminus' | 'towers' | 'temple' | 'armillary' | 'rotunda' | 'gardens' | 'far-east' | 'far-west'; x: number; y: number; z: number; r: number; deep: number; rank: number }
const SPOTS: Spot[] = [
  { kind: 'terminus', x: -255, y: 31, z: -458, r: 58, deep: 0.9, rank: 0 },
  { kind: 'towers', x: -430, y: 40, z: -40, r: 64, deep: 0.85, rank: 0 },
  { kind: 'temple', x: 352, y: 70, z: -214, r: 46, deep: 1.0, rank: 0 },
  { kind: 'armillary', x: 300, y: 22, z: 215, r: 48, deep: 1.0, rank: 0 },
  { kind: 'rotunda', x: -320, y: 80, z: 318, r: 44, deep: 1.05, rank: 1 },
  { kind: 'gardens', x: 50, y: 44, z: 398, r: 54, deep: 0.9, rank: 1 },
  { kind: 'far-east', x: 720, y: 30, z: 330, r: 90, deep: 0.8, rank: 2 },
  { kind: 'far-west', x: -650, y: 110, z: -300, r: 84, deep: 0.85, rank: 2 },
];

/** Towers in a loose ring, the tallest in the middle. */
function cluster(b: Builder, next: () => number, g: Plot, r: number, count: number, low: number, high: number, plain = false): void {
  const a0 = next() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = a0 + (i / Math.max(1, count - 1)) * Math.PI * 2 + (next() - 0.5) * 0.5;
    const d = i === 0 ? 0 : r * (0.34 + next() * 0.2);
    const h = i === 0 ? high : low + next() * (high - low) * 0.7;
    const at = g.at(Math.cos(a) * d, 0, Math.sin(a) * d, next() * 1.5);
    if (i % 3 === 2) roundTower(b, next, at, r * 0.085, h * 0.9);
    else tower(b, next, at, r * (0.15 + next() * 0.05), h, plain);
  }
}

function buildSkyline(kit: InkKit, rank: number, armillaryAt: THREE.Vector3): THREE.Mesh[] {
  const north = kit.builder() as Builder;
  const south = kit.builder() as Builder;
  const next = rng(90210);
  const rich = rank >= 2;
  const end = lineEnd(rank > 0);
  for (const s of SPOTS) {
    if (s.rank > rank) continue;
    const b = s.z < 0 ? north : south;
    const r = s.r;
    const meets = s.kind === 'terminus';
    // The apron is 0.9 thick and its top is the deck, so the lawn is that much lower.
    const x = meets ? end.x + end.dx * (r + 2) : s.x;
    const z = meets ? end.z + end.dz * (r + 2) : s.z;
    const y = meets ? end.y - 0.9 - r * LAWN : s.y;
    const g = island(b, next, x, y, z, r, s.deep, rich ? 5 : 3, rich ? 4 : 2);
    const home = new Plot(g.x, g.y, g.z, meets ? Math.atan2(-end.dx, -end.dz) : homeward(x, z));
    if (meets) {
      // The station: a temple with its front to the line and a marble apron out past the edge to the deck.
      temple(b, home.at(0, 0, r * 0.3), r * 0.5);
      b.add(BOX, { color: palette.marble, pos: home.p(0, 0, r * 0.86), rot: home.r(), scale: [6, 0.9, r * 0.44] });
      tower(b, next, home.at(-r * 0.5, 0, -r * 0.35, 0.4), r * 0.2, 92);
      roundTower(b, next, home.at(r * 0.52, 0, -r * 0.3), r * 0.1, 64);
      grove(b, next, g, rich ? 8 : 6, r * 0.66, r * 0.9, r * 0.08);
    } else if (s.kind === 'towers') {
      cluster(b, next, g, r, rich ? 6 : 4, 46, 118);
      grove(b, next, g, rich ? 9 : 6, r * 0.7, r * 0.92, r * 0.07);
    } else if (s.kind === 'temple') {
      temple(b, home.at(0, 0, r * 0.1), r * 0.62, 8);
      roundTower(b, next, home.at(-r * 0.6, 0, -r * 0.45), r * 0.1, 52);
      grove(b, next, g, rich ? 8 : 6, r * 0.72, r * 0.92, r * 0.08);
    } else if (s.kind === 'armillary') {
      const up = armillaryStand(b, g);
      armillaryAt.set(g.x, g.y + up, g.z);
      grove(b, next, g, rich ? 9 : 5, r * 0.84, r * 0.95, r * 0.085);
    } else if (s.kind === 'rotunda') {
      rotunda(b, home.at(0, 0, -r * 0.1), r * 0.36);
      tower(b, next, home.at(r * 0.56, 0, -r * 0.4, 0.7), r * 0.17, 58);
      grove(b, next, g, 9, r * 0.7, r * 0.92, r * 0.08);
    } else if (s.kind === 'gardens') {
      gardens(b, next, home, r * 1.05);
      grove(b, next, g, 8, r * 0.74, r * 0.93, r * 0.07);
    } else if (s.kind === 'far-east') {
      cluster(b, next, g, r, 7, 60, 150, true);
      rotunda(b, home.at(-r * 0.2, 0, r * 0.62), r * 0.2);
      grove(b, next, g, 8, r * 0.75, r * 0.93, r * 0.07);
    } else {
      cluster(b, next, g, r, 4, 56, 128, true);
      temple(b, home.at(r * 0.1, 0, r * 0.58), r * 0.4);
      grove(b, next, g, 8, r * 0.75, r * 0.93, r * 0.07);
    }
    // A crumb adrift beside the big one: a wedge of rock, a lawn, one tree and one strand of green.
    if (rank >= 1 && s.kind !== 'terminus') {
      const a = next() * Math.PI * 2;
      const cr = r * (0.16 + next() * 0.1);
      const cx = x + Math.cos(a) * r * 1.5, cy = y - r * (0.2 + next() * 0.5), cz = z + Math.sin(a) * r * 1.5;
      b.add(CRUMB, { color: palette.lavender, gradient: { bottom: palette.violet, top: palette.stoneShade }, pos: [cx, cy, cz], rot: [Math.PI, a, 0], scale: [cr, cr * 1.7, cr], hatch: 0.25 });
      b.add(geo.cylinder(1, 0.97, 0.1, 7), { color: palette.grass, pos: [cx, cy, cz], rot: [0, -a, 0], scale: cr * 1.03 });
      b.add(LEAF, { color: GREENS[Math.floor(next() * GREENS.length)], pos: [cx, cy + cr * 0.5, cz], scale: [cr * 0.6, cr * 0.5, cr * 0.6] });
      b.add(HANG, { color: palette.leafDeep, pos: [cx + cr * 0.9, cy + cr * 0.08, cz], rot: [Math.PI, 0, 0], scale: [cr * 0.1, cr * 1.4, cr * 0.1] });
    }
  }
  return [north.build('skyline-north'), south.build('skyline-south')];
}

// ---------------------------------------------------------------------------------------------
// Colossi: two things too big to be buildings. North, a marble column the size of a skyscraper
// coming up out of the haze, with a lawn and a small temple on its capital, and beside it a
// sibling that snapped, its top drums still adrift above the break. East, most of a pediment a
// few hundred metres across, turning very slowly, with what is left of its columns hanging
// under it. Nobody says whose they were.
// ---------------------------------------------------------------------------------------------

/** A fluted drum one unit tall and one in radius, standing on y = 0. Stacked ones need no ends. */
function drumShape(ribs: number, dent: number, caps: boolean): THREE.BufferGeometry {
  const m = ribs * 2;
  const p: number[] = [], n: number[] = [];
  const at = (i: number): [number, number] => {
    const a = (i / m) * Math.PI * 2;
    const k = i & 1 ? dent : 1;
    return [Math.sin(a) * k, Math.cos(a) * k];
  };
  for (let i = 0; i < m; i++) {
    const [ax, az] = at(i), [bx, bz] = at(i + 1);
    p.push(ax, 0, az, bx, 0, bz, bx, 1, bz, ax, 0, az, bx, 1, bz, ax, 1, az);
    let nx = -(bz - az), nz = bx - ax;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    for (let k = 0; k < 6; k++) n.push(nx, 0, nz);
    if (!caps) continue;
    p.push(0, 1, 0, ax, 1, az, bx, 1, bz);
    for (let k = 0; k < 3; k++) n.push(0, 1, 0);
    p.push(0, 0, 0, bx, 0, bz, ax, 0, az);
    for (let k = 0; k < 3; k++) n.push(0, -1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}

const COLUMN_AT: P3 = [-150, 0, -640];
const COLUMN_R = 30;
const DRUM_TALL = 88;
const COLUMN_FOOT = -520;

function buildColumn(kit: InkKit, rank: number): THREE.Mesh {
  const b = kit.builder() as Builder;
  const next = rng(1789);
  const drum = drumShape(14, 0.9, false);
  const loose = drumShape(14, 0.9, true);
  const R = COLUMN_R;
  const shade = '#c6bbdc';
  // The stretch nobody sees the bottom of.
  b.add(drum, { color: shade, pos: [0, COLUMN_FOOT - 500, 0], scale: [R * 1.02, 500, R * 1.02], hatch: 0.2 });
  let y = COLUMN_FOOT;
  for (let i = 0; i < 8; i++) {
    const r = R * (1 - i * 0.018);
    b.add(drum, { color: mixHex(shade, palette.marble, i / 7), pos: [0, y, 0], rot: [0, i * 0.03, 0], scale: [r, DRUM_TALL, r], hatch: 0.12 });
    y += DRUM_TALL;
  }
  // Capital: a neck, a spreading cushion and a square slab.
  const cap = b.newId();
  b.add(geo.cylinder(0.9, 0.86, 0.3, 16), { color: palette.marble, pos: [0, y, 0], scale: R, id: cap });
  b.add(geo.cylinder(1.34, 0.9, 0.62, 16), { color: palette.marble, gradient: MARBLE, pos: [0, y + R * 0.3, 0], scale: R, id: cap });
  y += R * 0.92;
  b.add(BOX, { color: palette.marble, pos: [0, y, 0], rot: [0, 0.5, 0], scale: [R * 2.9, R * 0.46, R * 2.9] });
  y += R * 0.46;
  // What grew up there: a lawn, a small temple, a few trees, and vines a hundred metres long.
  const top = new Plot(0, y, 0, 0.5);
  b.add(BOX, { color: palette.grass, pos: top.p(0, 0, 0), rot: top.r(), scale: [R * 2.7, 2.4, R * 2.7] });
  temple(b, top.at(-R * 0.25, 2.4, -R * 0.2, 2.4), R * 0.8);
  for (let i = 0; i < 6; i++) {
    const s = R * (0.2 + next() * 0.12);
    b.add(LEAF, { color: GREENS[(i * 2 + 1) % GREENS.length], pos: top.p((next() - 0.5) * R * 2.2, 2.4 + s * 0.7, R * (0.55 + next() * 0.6)), scale: [s * 1.2, s, s * 1.2] });
  }
  for (let i = 0; i < 6; i++) {
    const side = i & 1 ? 1 : -1;
    const along = (next() - 0.5) * R * 2.4;
    const len = 60 + next() * 120;
    const at = i < 4 ? top.p(side * R * 1.44, 1.5, along) : top.p(along, 1.5, side * R * 1.44);
    b.add(HANG, { color: GREENS[2 + (i % 3)], pos: at, rot: [Math.PI, 0, 0], scale: [4.5, len, 4.5] });
    b.add(HANG, { color: GREENS[(i + 1) % GREENS.length], pos: [at[0] + 3, at[1] + 0.5, at[2] + 3], rot: [Math.PI, 0, 0], scale: [7.5, len * 0.35, 7.5] });
  }
  if (rank >= 1) {
    // The sibling: seven drums standing, the eighth knocked askew, two more adrift above it.
    const sx = 104, sz = 46, r = R * 0.92;
    b.add(drum, { color: shade, pos: [sx, COLUMN_FOOT - 500, sz], scale: [r * 1.02, 500, r * 1.02], hatch: 0.2 });
    let sy = COLUMN_FOOT;
    for (let i = 0; i < 7; i++) {
      b.add(drum, { color: mixHex(shade, palette.marble, i / 7), pos: [sx, sy, sz], rot: [0, 0.4 + i * 0.05, 0], scale: [r * (1 - i * 0.018), DRUM_TALL, r * (1 - i * 0.018)], hatch: 0.12 });
      sy += DRUM_TALL;
    }
    b.add(BOX, { color: palette.grass, pos: [sx, sy, sz], rot: [0, 0.3, 0], scale: [r * 1.3, 2, r * 1.3] });
    b.add(LEAF, { color: palette.leafDeep, pos: [sx + 6, sy + 7, sz - 4], scale: [9, 7, 9] });
    b.add(loose, { color: palette.marble, pos: [sx + 12, sy + 34, sz - 8], rot: [0.24, 0.6, 0.3], scale: [r * 0.86, DRUM_TALL * 0.62, r * 0.86], hatch: 0.12 });
    b.add(loose, { color: palette.marble, pos: [sx - 20, sy + 128, sz + 10], rot: [-0.34, 1.3, -0.5], scale: [r * 0.84, DRUM_TALL * 0.5, r * 0.84], hatch: 0.12 });
    b.add(geo.bevelBox(1, 1, 1, 0.08), { color: palette.marble, pos: [sx + 34, sy + 96, sz + 22], rot: [0.7, 0.4, 0.9], scale: [15, 11, 13] });
    b.add(geo.bevelBox(1, 1, 1, 0.08), { color: palette.marbleShade, pos: [sx - 44, sy + 62, sz - 12], rot: [0.2, 1.1, 0.5], scale: [9, 8, 10] });
  }
  const mesh = b.build('column');
  mesh.position.set(COLUMN_AT[0], COLUMN_AT[1], COLUMN_AT[2]);
  return mesh;
}

const PEDIMENT_AT: P3 = [600, 150, 36];
const PEDIMENT_YAW = -1.34;
const PEDIMENT_ROLL = 0.13;

function buildPediment(kit: InkKit, rank: number): THREE.Mesh {
  const b = kit.builder() as Builder;
  const next = rng(447);
  const slope = Math.atan2(70, 150);
  // The field: the whole triangle would be 300 across and 70 high. This is the left two thirds,
  // snapped off part way down the right slope.
  const field: P2[] = [[-150, 0], [38, 0], [50, 12], [42, 24], [62, 33], [60, 42], [0, 70]];
  b.add(geo.extrude(field, 26, { cacheKey: 'sky-pediment-field' }), { color: palette.marbleShade, gradient: { bottom: '#c3b8dc', top: palette.marbleShade }, hatch: 0.16 });
  // The frame round it, proud of the field: the bed along the bottom and the two raking edges.
  const frame = b.newId();
  b.add(BOX, { color: palette.marble, pos: [-56, -3, 0], scale: [196, 9, 40], id: frame });
  b.add(BOX, { color: palette.marble, pos: [-76, 34, 0], rot: [0, 0, slope], scale: [174, 9, 40], id: frame });
  b.add(BOX, { color: palette.marble, pos: [31, 55.5, 0], rot: [0, 0, -slope], scale: [70, 9, 40], id: frame });
  // A palmette on the peak and a plain medallion in a copper wreath on the field.
  b.add(geo.dome(1, 8, 3), { color: palette.marble, pos: [0, 76, 0], scale: [12, 17, 5] });
  b.add(geo.cylinder(15, 15, 31, 14), { color: palette.marble, pos: [-24, 27, -15.5], rot: [Math.PI / 2, 0, 0] });
  b.add(geo.torus(20, 2.2, 14, 4), { color: palette.verdigris, pos: [-24, 27, 14.5], rot: [Math.PI / 2, 0, 0] });
  // Teeth under the bed.
  const teeth = b.newId();
  for (let i = 0; i < 16; i++) b.add(BOX, { color: palette.marble, pos: [-147 + i * 12, -8.5, 0], scale: [5.5, 5.5, 36], id: teeth });
  // The beam it sat on, and what is left of the columns: three capitals, two stumps, one drum falling.
  b.add(BOX, { color: palette.marbleShade, gradient: MARBLE, pos: [-72, -22, 0], scale: [150, 13.5, 30], hatch: 0.1 });
  const drum = drumShape(12, 0.88, true);
  const stumps: [number, number][] = [[-134, 30], [-94, 52], [-54, 0]];
  for (const [x, len] of stumps) {
    const id = b.newId();
    b.add(BOX, { color: palette.marble, pos: [x, -27, 0], scale: [23, 5, 23], id });
    b.add(geo.cylinder(10.5, 7.6, 6.5, 12), { color: palette.marble, pos: [x, -33.5, 0], id });
    if (len > 0) b.add(drum, { color: palette.marble, gradient: MARBLE, pos: [x, -33.5 - len, 0], scale: [7.4, len, 7.4], hatch: 0.1 });
  }
  b.add(drum, { color: palette.marble, pos: [-50, -96, 8], rot: [0.3, 0.2, -0.45], scale: [7.4, 25, 7.4], hatch: 0.1 });
  // Pieces off the broken end, going their own way.
  const bits: [number, number, number, number, number, number][] = [[80, 30, 0, 17, 12, 24], [98, 12, -5, 10, 9, 15], [86, -2, 9, 7, 6, 9], [116, 24, 7, 5.5, 5, 7], [72, 50, 2, 9, 6, 22]];
  const count = rank >= 1 ? bits.length : 3;
  for (let i = 0; i < count; i++) {
    const [x, y, z, w, h, d] = bits[i];
    b.add(geo.bevelBox(1, 1, 1, 0.08), { color: i & 1 ? palette.marbleShade : palette.marble, pos: [x, y, z], rot: [next() * 1.2, next() * 2, next() * 1.2 - 0.6], scale: [w, h, d] });
  }
  // Green on it: turf along the long raking edge, a tree in the break, vines off the bed.
  const nx = -Math.sin(slope), ny = Math.cos(slope);
  for (let i = 0; i < 9; i++) {
    const t = 0.06 + (i / 9) * 0.86 + next() * 0.05;
    const s = 9 + next() * 7;
    b.add(LEAF, { color: GREENS[(i * 2) % GREENS.length], pos: [-150 + t * 150 + nx * 11, t * 70 + ny * 11, (next() - 0.5) * 18], scale: [s * 1.3, s * 0.6, s] });
  }
  b.add(SHAFT, { color: '#7a5a8e', pos: [50, 34, 0], rot: [0, 0, -0.5], scale: [1.6, 20, 1.6] });
  b.add(LEAF, { color: palette.leaf, pos: [61, 54, 0], scale: [13, 11, 12] });
  // Vines hang plumb whatever the stone is doing, so lean them back against the roll.
  const plumb: P3 = [0, 0, Math.PI - PEDIMENT_ROLL];
  const vines = rank >= 1 ? 8 : 5;
  for (let i = 0; i < vines; i++) {
    const x = -142 + (i / vines) * 176 + next() * 12;
    const z = i & 1 ? 20.5 : -20.5;
    const len = 40 + next() * 85;
    b.add(HANG, { color: GREENS[2 + (i % 3)], pos: [x, 5, z], rot: plumb, scale: [3.6, len, 3.6] });
    b.add(HANG, { color: GREENS[(i + 1) % GREENS.length], pos: [x + 3, 5.5, z], rot: plumb, scale: [6.5, len * 0.35, 5] });
  }
  const mesh = b.build('pediment');
  mesh.position.set(PEDIMENT_AT[0], PEDIMENT_AT[1], PEDIMENT_AT[2]);
  mesh.rotation.set(0, PEDIMENT_YAW, PEDIMENT_ROLL);
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// The flock: with the armillary and the pediment, the only things up here that move by themselves.
// ---------------------------------------------------------------------------------------------

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

/** Everything above and beyond the home island. Nine draw calls. */
export function createSky(kit: InkKit, tier: QualityTier): Sky {
  const group = new THREE.Group();
  group.name = 'sky';
  const rank = tier === 'low' ? 0 : tier === 'medium' ? 1 : 2;

  // Clouds ride a ring that follows the walker most of the way, so they slide a little against the
  // far things but never get any nearer.
  const ring = new THREE.Group();
  ring.name = 'cloud-ring';
  let triangles = buildClouds(kit, tier, ring);
  group.add(ring);

  const lights = buildLights(kit);
  const armillaryAt = new THREE.Vector3();
  const skyline = buildSkyline(kit, rank, armillaryAt);
  const armillary = buildArmillary(kit);
  armillary.position.copy(armillaryAt);
  const column = buildColumn(kit, rank);
  const pediment = buildPediment(kit, rank);
  const flockCount = tier === 'low' ? 9 : tier === 'medium' ? 13 : 17;
  const flock = buildFlock(kit, flockCount);
  group.add(lights, skyline[0], skyline[1], armillary, column, pediment, flock);
  triangles += trianglesOf(lights) + trianglesOf(skyline[0]) + trianglesOf(skyline[1]) + trianglesOf(armillary) + trianglesOf(column) + trianglesOf(pediment) + trianglesOf(flock);

  function update(_dt: number, t: number, cameraPosition: THREE.Vector3): void {
    ring.position.set(cameraPosition.x * 0.85, 0, cameraPosition.z * 0.85);
    ring.rotation.y = t * 0.0012;
    lights.position.set(cameraPosition.x, 0, cameraPosition.z);

    // The armillary turns once in a couple of minutes. The pediment rides up and down a few metres and
    // rocks a hair, slowly enough that you only catch it against a cloud.
    armillary.rotation.y = t * 0.05;
    pediment.position.y = PEDIMENT_AT[1] + Math.sin(t * 0.05) * 4;
    pediment.rotation.z = PEDIMENT_ROLL + Math.sin(t * 0.031) * 0.02;

    // The flock flies a wide slow circle that crosses the middle of the island. A loose V: each pair
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
