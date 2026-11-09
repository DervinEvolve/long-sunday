// Everything that grows or stands between the districts: stands of six sided rock, boulders, shrubs,
// thin desert plants, a few white arches and standing stones to steer by.
//
// Nothing here is placed by hand except the arches and stones. The rest comes from a seeded pass
// over the mesa that asks the terrain three questions of every spot: is it on the mesa, how far is
// the nearest road, how far is the nearest pad. Thick at the rim, thin by the roads, nothing on a
// road or a pad. A lower tier draws a subset of what a higher tier draws, never a different layout.
//
// Columns, boulders and shrubs are instanced, split into three wedges of the mesa so the ones
// behind the walker are not drawn. Plants and waymarks are one fixed mesh.
import * as THREE from 'three';
import type { Collider, ColorLike, InkBuilder, InkKit, QualityTier } from '../types';
import { ROADS, SITES, WORLD_RADIUS } from '../world/layout';
import { palette } from '../world/palette';
import * as geo from './geo';
import { heightAt, inBounds, rimRadius, roadInfo, roadLength, roadPoint, type RoadHit, type RoadPoint } from './terrain';
import { gfbm, hash2, rng } from './util';

type Builder = Required<InkBuilder>;

const SECTORS = 3;
/** Nothing stands nearer a road's edge than this. Year stones and fingerposts live inside it. */
const ROAD_CLEAR = 3.2;
/** Nothing stands nearer a district centre than this share of its radius. */
const PAD_CLEAR = 1.05;

const TIER_SHARE: Record<QualityTier, number> = { high: 1, medium: 0.66, low: 0.4 };

const hit: RoadHit = { road: -1, dist: 0, s: 0, height: 0, width: 0 };

/** Metres from the nearest road's edge. Big when no road is near. */
function roadGap(x: number, z: number): number {
  roadInfo(x, z, hit);
  return hit.road < 0 ? 99 : hit.dist - hit.width / 2;
}

/** Metres outside the nearest pad's keep-out circle. Negative inside one. */
function padGap(x: number, z: number): number {
  let best = Infinity;
  for (const s of SITES) {
    const d = Math.hypot(x - s.center.x, z - s.center.z) - s.radius * PAD_CLEAR;
    if (d < best) best = d;
  }
  return best;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much wants to grow here, 0..1, for something of radius `size`. 0 means keep out.
 * `wayside` is how much of it survives right beside a road: rock stays well back, small growth
 * comes nearly up to the verge so the walk is not bare.
 */
function growth(x: number, z: number, size: number, wayside = 0.25): number {
  if (!inBounds(x, z)) return 0;
  const r = Math.hypot(x, z);
  if (rimRadius(x, z) - r < 3.5 + size) return 0;
  const road = roadGap(x, z) - size;
  if (road < ROAD_CLEAR) return 0;
  const pad = padGap(x, z) - size;
  if (pad < 0) return 0;
  // Thick toward the rim, thinner by roads and pads, and in drifts so there are bare stretches too.
  const rim = 0.3 + 0.7 * smooth(90, 215, r);
  const byRoad = wayside + (1 - wayside) * smooth(ROAD_CLEAR, 20, road);
  const byPad = 0.45 + 0.55 * smooth(0, 14, pad);
  const drift = smooth(-0.35, 0.3, gfbm(x * 0.021 + 3.1, z * 0.021 - 8.4, 2, 77));
  return rim * byRoad * byPad * (0.25 + 0.75 * drift);
}

const sectorOf = (x: number, z: number) => Math.min(SECTORS - 1, Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * SECTORS));

// One thing to draw: where, how it is turned and stretched, and its tint.
interface Item { x: number; y: number; z: number; yaw: number; tiltX: number; tiltZ: number; sx: number; sy: number; sz: number; color: ColorLike }

const mat = new THREE.Matrix4();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const tint = new THREE.Color();

/** Turn lists of items into one instanced mesh per wedge that has any. */
function instanced(kit: InkKit, group: THREE.Group, name: string, shape: THREE.BufferGeometry, items: Item[]): number {
  const per = (shape.index ? shape.index.count : shape.getAttribute('position').count) / 3;
  for (let sector = 0; sector < SECTORS; sector++) {
    const mine = items.filter((it) => sectorOf(it.x, it.z) === sector);
    if (mine.length === 0) continue;
    const mesh = kit.instances(shape, mine.length);
    mesh.name = `${name}-${sector}`;
    for (let i = 0; i < mine.length; i++) {
      const it = mine[i];
      pos.set(it.x, it.y, it.z);
      euler.set(it.tiltX, it.yaw, it.tiltZ, 'YXZ');
      quat.setFromEuler(euler);
      scl.set(it.sx, it.sy, it.sz);
      mesh.setMatrixAt(i, mat.compose(pos, quat, scl));
      mesh.setColorAt(i, tint.set(it.color));
    }
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Culling goes by this sphere, so it has to wrap every copy, not the one shape.
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return per * items.length;
}

// ---------------------------------------------------------------------------------------------
// Shapes. Made here, not taken from the shared set, because each is drawn hundreds of times:
// no undersides, no faces nobody will ever see.
// ---------------------------------------------------------------------------------------------

/** A six sided column, one metre tall and one in radius, open underneath. 16 triangles. */
function columnShape(): THREE.BufferGeometry {
  const p: number[] = [];
  const n: number[] = [];
  const cx = (i: number) => Math.sin((i / 6) * Math.PI * 2);
  const cz = (i: number) => Math.cos((i / 6) * Math.PI * 2);
  for (let i = 0; i < 6; i++) {
    const ax = cx(i), az = cz(i), bx = cx(i + 1), bz = cz(i + 1);
    const nl = Math.hypot(ax + bx, az + bz);
    p.push(ax, 0, az, bx, 1, bz, ax, 1, az, ax, 0, az, bx, 0, bz, bx, 1, bz);
    for (let k = 0; k < 6; k++) n.push((ax + bx) / nl, 0, (az + bz) / nl);
  }
  for (let i = 1; i < 5; i++) {
    p.push(cx(0), 1, cz(0), cx(i), 1, cz(i), cx(i + 1), 1, cz(i + 1));
    for (let k = 0; k < 3; k++) n.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}

/** Add one lumpy dome to a point and index list: a cap on top, `rings` bands, a little undercut. */
function dome(next: () => number, p: number[], idx: number[], seg: number, rings: number, lump: number, rx: number, ry: number, rz: number, ox: number, oz: number): void {
  const first = p.length / 3;
  p.push(ox, ry * (1 + (next() - 0.5) * lump), oz);
  const turn = next() * 6.28;
  for (let k = 1; k <= rings; k++) {
    const phi = (k / rings) * (Math.PI / 2 + 0.22);
    for (let j = 0; j < seg; j++) {
      const th = turn + ((j + (k & 1) * 0.5) / seg) * Math.PI * 2;
      const out = Math.sin(phi) * (1 + (next() - 0.5) * 2 * lump);
      p.push(ox + Math.cos(th) * out * rx, Math.cos(phi) * ry * (1 + (next() - 0.5) * lump), oz + Math.sin(th) * out * rz);
    }
  }
  for (let j = 0; j < seg; j++) idx.push(first, first + 1 + ((j + 1) % seg), first + 1 + j);
  for (let k = 1; k < rings; k++) {
    const up = first + 1 + (k - 1) * seg, low = up + seg;
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      idx.push(up + j, up + j1, low + j, up + j1, low + j1, low + j);
    }
  }
}

/** A boulder: one lumpy dome, nothing underneath. 35 triangles. */
function boulderShape(): THREE.BufferGeometry {
  const p: number[] = [];
  const idx: number[] = [];
  dome(rng(0xb0b), p, idx, 7, 3, 0.26, 1, 0.9, 0.92, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A shrub: three domes run together, shaded as one round thing. 57 triangles. */
function shrubShape(): THREE.BufferGeometry {
  const p: number[] = [];
  const idx: number[] = [];
  const next = rng(0x5b);
  dome(next, p, idx, 7, 2, 0.1, 0.78, 0.98, 0.74, 0, 0);
  dome(next, p, idx, 6, 2, 0.1, 0.56, 0.66, 0.6, 0.62, 0.22);
  dome(next, p, idx, 6, 2, 0.1, 0.6, 0.72, 0.52, -0.5, -0.4);
  const n: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1] + 0.35, z = p[i + 2];
    const l = Math.hypot(x, y, z) || 1;
    n.push(x / l, y / l, z / l);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setIndex(idx);
  return g;
}

// A whip is a three sided spike with no base, a bud is eight faces. Unit size, stretched per use.
const WHIP = new THREE.ConeGeometry(1, 1, 3, 1, true).translate(0, 0.5, 0);
const BUD = new THREE.OctahedronGeometry(1, 0);

// ---------------------------------------------------------------------------------------------
// Rock: stands of six sided columns, and boulders
// ---------------------------------------------------------------------------------------------

const COLUMN_TINTS: ColorLike[] = [palette.rock, palette.rock, '#ea9c80', '#dc8068', '#eea88c', palette.rockDeep];
const BOULDER_TINTS: ColorLike[] = [palette.rock, '#e9ab8c', palette.sandDeep, '#d98c72', '#efc7a6'];

interface Stand { x: number; z: number; r: number }

/** One stand: columns packed like basalt, tallest in the middle, stepping down to stumps. */
function stand(next: () => number, cx: number, cz: number, big: number, columns: Item[], stands: Stand[], colliders: Collider[]): void {
  const cr = 0.75 + next() * 0.5 + big * 0.7;
  const count = 3 + Math.floor(next() * 6 + big * 7);
  const tall = 2.6 + next() * 3.2 + big * 8;
  const yaw = next() * Math.PI;
  const pitch = cr * 1.74;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // Walk a hex lattice outward from the middle and keep the nearest cells, with a few holes.
  const cells: [number, number, number][] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      const lx = (q + r * 0.5) * pitch;
      const lz = r * pitch * 0.866;
      cells.push([lx, lz, Math.hypot(lx, lz) + next() * pitch * 0.9]);
    }
  }
  cells.sort((a, b) => a[2] - b[2]);
  let reach = 0;
  const lean = (next() - 0.5) * 0.08;
  for (let i = 0; i < count && i < cells.length; i++) {
    const [lx, lz] = cells[i];
    const x = cx + lx * cy - lz * sy;
    const z = cz + lx * sy + lz * cy;
    const d = Math.hypot(lx, lz);
    const fall = 1 - Math.min(0.85, (d / (pitch * 2.6)) * (0.6 + next() * 0.5));
    // Heights land on steps, the way these columns break.
    const h = Math.max(0.5, Math.round((tall * fall * (0.7 + next() * 0.3)) / 0.6) * 0.6);
    const ground = heightAt(x, z);
    columns.push({
      x, y: ground - 1.4, z, yaw: -yaw + Math.PI / 6, tiltX: lean, tiltZ: lean * 0.6,
      sx: cr, sy: h + 1.4, sz: cr, color: COLUMN_TINTS[Math.floor(next() * COLUMN_TINTS.length)],
    });
    reach = Math.max(reach, d + cr);
  }
  stands.push({ x: cx, z: cz, r: reach });
  colliders.push({ kind: 'circle', x: cx, z: cz, r: reach * 0.92 });
}

function gatherRock(share: number, columns: Item[], boulders: Item[], stands: Stand[], colliders: Collider[]): void {
  // Stands of columns, one try per 20 metre cell.
  const cell = 20;
  const n = Math.ceil(WORLD_RADIUS / cell) + 1;
  for (let iz = -n; iz <= n; iz++) {
    for (let ix = -n; ix <= n; ix++) {
      const next = rng((ix * 73856093) ^ (iz * 19349663) ^ 0x51f15e);
      const x = (ix + 0.15 + next() * 0.7) * cell;
      const z = (iz + 0.15 + next() * 0.7) * cell;
      const pick = hash2(ix, iz, 11);
      const want = growth(x, z, 5);
      if (want <= 0 || pick > want * 1.15 * share) continue;
      let free = true;
      for (const st of stands) if (Math.hypot(x - st.x, z - st.z) < st.r + 7) { free = false; break; }
      if (!free) continue;
      const rim = smooth(150, 225, Math.hypot(x, z));
      // The big stands are out at the rim, where they stand against the sky.
      const big = rim * (0.35 + next() * 0.65) * (next() < 0.5 ? 1 : 0.3);
      stand(next, x, z, big, columns, stands, colliders);
      // Rubble: a few boulders fallen round the foot.
      const fallen = 1 + Math.floor(next() * 3);
      const reach = stands[stands.length - 1].r;
      for (let k = 0; k < fallen; k++) {
        const a = next() * Math.PI * 2;
        const d = reach + 0.4 + next() * 2.2;
        const bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
        const s = 0.35 + next() * 0.55;
        if (growth(bx, bz, s) <= 0) continue;
        boulders.push({
          x: bx, y: heightAt(bx, bz) - s * 0.08, z: bz, yaw: next() * 6.28, tiltX: (next() - 0.5) * 0.4, tiltZ: (next() - 0.5) * 0.4,
          sx: s * (0.9 + next() * 0.4), sy: s * (0.8 + next() * 0.3), sz: s, color: BOULDER_TINTS[Math.floor(next() * BOULDER_TINTS.length)],
        });
      }
    }
  }
  // Boulders by themselves, one try per 10 metre cell.
  const bc = 10;
  const bn = Math.ceil(WORLD_RADIUS / bc) + 1;
  for (let iz = -bn; iz <= bn; iz++) {
    for (let ix = -bn; ix <= bn; ix++) {
      const next = rng((ix * 83492791) ^ (iz * 2971215073) ^ 0xb01de7);
      const x = (ix + next()) * bc;
      const z = (iz + next()) * bc;
      const pick = hash2(ix, iz, 23);
      // Mostly small, now and then one the size of a hut.
      const u = next();
      const s = u < 0.72 ? 0.4 + next() * 0.7 : u < 0.95 ? 1.1 + next() * 0.9 : 2 + next() * 1.3;
      const want = growth(x, z, s);
      if (want <= 0 || pick > want * 0.34 * share) continue;
      let clear = true;
      for (const st of stands) if (Math.hypot(x - st.x, z - st.z) < st.r + s) { clear = false; break; }
      if (!clear) continue;
      const squat = 0.55 + next() * 0.35;
      boulders.push({
        x, y: heightAt(x, z) - s * 0.08, z, yaw: next() * 6.28, tiltX: (next() - 0.5) * 0.3, tiltZ: (next() - 0.5) * 0.3,
        sx: s * (0.9 + next() * 0.35), sy: s * (squat + 0.25), sz: s * (0.85 + next() * 0.3), color: BOULDER_TINTS[Math.floor(next() * BOULDER_TINTS.length)],
      });
      if (s >= 1.1) colliders.push({ kind: 'circle', x, z, r: s * 0.82 });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Shrubs
// ---------------------------------------------------------------------------------------------

const SHRUB_TINTS: ColorLike[] = [palette.lavender, palette.lavender, palette.lavender, '#c7b4ee', '#a48ddc', palette.teal, palette.mint, '#5fb9b0'];

function gatherShrubs(share: number, stands: Stand[], shrubs: Item[]): void {
  const cell = 8.5;
  const n = Math.ceil(WORLD_RADIUS / cell) + 1;
  for (let iz = -n; iz <= n; iz++) {
    for (let ix = -n; ix <= n; ix++) {
      const next = rng((ix * 49979687) ^ (iz * 86028121) ^ 0x5b7ab);
      const x = (ix + next()) * cell;
      const z = (iz + next()) * cell;
      const pick = hash2(ix, iz, 37);
      const want = growth(x, z, 1, 0.7);
      if (want <= 0 || pick > want * 0.4 * share) continue;
      // One colour to a patch: lavender most places, teal and mint in pockets.
      const pocket = gfbm(x * 0.013 - 4, z * 0.013 + 9, 2, 5);
      const base = pocket > 0.22 ? 5 + Math.floor(next() * 3) : Math.floor(next() * 5);
      const group = 1 + Math.floor(next() * 2.6);
      for (let k = 0; k < group; k++) {
        const sx = x + (k === 0 ? 0 : (next() - 0.5) * 3.6);
        const sz = z + (k === 0 ? 0 : (next() - 0.5) * 3.6);
        const s = (k === 0 ? 0.75 + next() * 0.7 : 0.45 + next() * 0.45);
        if (k > 0 && growth(sx, sz, s, 0.7) <= 0) continue;
        let clear = true;
        for (const st of stands) if (Math.hypot(sx - st.x, sz - st.z) < st.r + s * 0.6) { clear = false; break; }
        if (!clear) continue;
        shrubs.push({
          x: sx, y: heightAt(sx, sz) - 0.06 * s, z: sz, yaw: next() * 6.28, tiltX: 0, tiltZ: 0,
          sx: s * (0.95 + next() * 0.3), sy: s * (0.8 + next() * 0.35), sz: s, color: SHRUB_TINTS[base],
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Thin plants: a fan of whips with a spot of colour at each tip, or one tall stalk with a tuft
// ---------------------------------------------------------------------------------------------

const STEM_COLORS: ColorLike[] = ['#6f9a78', palette.tealDeep, '#8aa56a', palette.leafDeep];
const TIP_COLORS: ColorLike[] = [palette.orange, palette.pink, palette.yellow, palette.red, palette.cyan];

function plant(b: Builder, next: () => number, x: number, z: number): void {
  const y = heightAt(x, z) - 0.05;
  const stem = STEM_COLORS[Math.floor(next() * STEM_COLORS.length)];
  const tip = TIP_COLORS[Math.floor(next() * TIP_COLORS.length)];
  const id = b.newId();
  if (next() < 0.62) {
    const whips = 4 + Math.floor(next() * 3);
    const turn = next() * 6.28;
    for (let i = 0; i < whips; i++) {
      const az = turn + (i / whips) * Math.PI * 2 + (next() - 0.5) * 0.5;
      const lean = 0.16 + next() * 0.42;
      const len = 1.5 + next() * 2;
      b.add(WHIP, { color: stem, pos: [x, y, z], rot: [0, az, lean], scale: [0.085, len, 0.085], id, sway: 0.5, swayBase: y });
      // Where the whip ends: tilt about z, then turn about y.
      const tx = x - Math.sin(lean) * Math.cos(az) * len;
      const ty = y + Math.cos(lean) * len;
      const tz = z + Math.sin(lean) * Math.sin(az) * len;
      b.add(BUD, { color: tip, pos: [tx, ty, tz], scale: [0.13, 0.24, 0.13], sway: 0.5, swayBase: y, flat: 0.4 });
    }
  } else {
    const tall = 2.6 + next() * 2.6;
    const r = 0.34 + next() * 0.16;
    b.add(WHIP, { color: stem, pos: [x, y, z], rot: [0, 0, (next() - 0.5) * 0.12], scale: [0.11, tall, 0.11], id, sway: 0.4, swayBase: y });
    b.add(geo.ico(1, 0), { color: tip, pos: [x, y + tall, z], scale: [r, r * 1.5, r], sway: 0.4, swayBase: y, flat: 0.3 });
    // A rosette of blades at the foot.
    const blades = 4 + Math.floor(next() * 2);
    for (let i = 0; i < blades; i++) {
      b.add(WHIP, { color: stem, pos: [x, y, z], rot: [0, (i / blades) * 6.28 + next(), 0.9 + next() * 0.3], scale: [0.12, 0.7 + next() * 0.4, 0.12], id });
    }
  }
}

function gatherPlants(b: Builder, share: number, stands: Stand[]): void {
  const cell = 13;
  const n = Math.ceil(WORLD_RADIUS / cell) + 1;
  for (let iz = -n; iz <= n; iz++) {
    for (let ix = -n; ix <= n; ix++) {
      const next = rng((ix * 15485863) ^ (iz * 32452843) ^ 0x9a17);
      const x = (ix + next()) * cell;
      const z = (iz + next()) * cell;
      const pick = hash2(ix, iz, 53);
      const want = growth(x, z, 0.6, 0.8);
      if (want <= 0 || pick > want * 0.52 * share) continue;
      let clear = true;
      for (const st of stands) if (Math.hypot(x - st.x, z - st.z) < st.r + 0.5) { clear = false; break; }
      if (clear) plant(b, next, x, z);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Waymarks: white arches and standing stones. Placed by rule, the same on every tier, because
// people will say "left at the arch".
// ---------------------------------------------------------------------------------------------

const rp: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };

/** A white arch you walk through along `yaw`. Feet go down to whichever side is lower. */
function arch(b: Builder, x: number, z: number, yaw: number, span: number, rise: number, thick: number, depth: number, colliders: Collider[], keep: Stand[]): void {
  const ax = Math.cos(yaw), az = -Math.sin(yaw); // across the opening
  const off = span / 2 + thick / 2;
  const lx = x - ax * off, lz = z - az * off;
  const rx = x + ax * off, rz = z + az * off;
  const hl = heightAt(lx, lz), hr = heightAt(rx, rz), hm = heightAt(x, z);
  const base = Math.min(hl, hr) - 0.7;
  const lift = Math.max(hl, hr, hm) - base;
  const id = b.newId();
  b.add(geo.arch({ span, rise: rise + lift, thick, depth, seg: 12 }), { color: palette.stone, gradient: { bottom: palette.stoneShade, top: palette.stone }, pos: [x, base, z], rot: [0, yaw, 0], id });
  // Plinths, a course wider than the legs.
  b.add(geo.bevelBox(thick * 1.5, 0.9, depth * 1.3, 0.12), { color: palette.stoneShade, pos: [lx, hl - 0.35, lz], rot: [0, yaw, 0] });
  b.add(geo.bevelBox(thick * 1.5, 0.9, depth * 1.3, 0.12), { color: palette.stoneShade, pos: [rx, hr - 0.35, rz], rot: [0, yaw, 0] });
  // A keystone in the district blue green, the one bit of colour on it.
  b.add(geo.bevelBox(thick * 0.7, thick * 1.25, depth * 1.12, 0.08), { color: palette.teal, pos: [x, base + rise + lift - thick * 0.1, z], rot: [0, yaw, 0] });
  const r = Math.max(thick, depth) * 0.72;
  colliders.push({ kind: 'circle', x: lx, z: lz, r }, { kind: 'circle', x: rx, z: rz, r });
  keep.push({ x: lx, z: lz, r: r + 1 }, { x: rx, z: rz, r: r + 1 });
}

const lean = new THREE.Euler();
const up = new THREE.Vector3();

/** A lone white stone, taller than a person, a little out of true, with one painted band. */
function standingStone(b: Builder, next: () => number, x: number, z: number, colliders: Collider[], keep: Stand[]): void {
  const y = heightAt(x, z);
  const tall = 3 + next() * 1.6;
  const yaw = next() * 6.28;
  const rx = (next() - 0.5) * 0.1, rz = (next() - 0.5) * 0.14;
  const sunk = 0.8, foot = 0.56, top = 0.3;
  const id = b.newId();
  b.add(geo.prism(5, top, foot, 1), {
    color: palette.stone, gradient: { bottom: palette.stoneShade, top: palette.stone },
    pos: [x, y - sunk, z], rot: [rx, yaw, rz], scale: [1, tall + sunk, 1], id,
  });
  // The band sits on the stone's own axis and is just proud of it at that height.
  const at = 0.78;
  const wide = (foot + (top - foot) * at) / top + 0.07;
  lean.set(rx, yaw, rz, 'XYZ');
  up.set(0, (tall + sunk) * at, 0).applyEuler(lean);
  b.add(geo.prism(5, top, foot, 1), {
    color: next() < 0.5 ? palette.teal : palette.orange,
    pos: [x + up.x, y - sunk + up.y, z + up.z], rot: [rx, yaw, rz], scale: [wide * 0.62, 0.3, wide * 0.62],
  });
  colliders.push({ kind: 'circle', x, z, r: 0.7 });
  keep.push({ x, z, r: 2.2 });
}

/** Stretches of a road that are clear of every pad: [start, end] in metres along it. */
function openRuns(road: number): [number, number][] {
  const runs: [number, number][] = [];
  const len = roadLength(road);
  let from = -1;
  for (let s = 0; s <= len; s += 1) {
    roadPoint(road, s, rp);
    const open = padGap(rp.x, rp.z) > 4;
    if (open && from < 0) from = s;
    if ((!open || s + 1 > len) && from >= 0) {
      if (s - from > 12) runs.push([from, s]);
      from = -1;
    }
  }
  return runs;
}

function buildWaymarks(b: Builder, colliders: Collider[], keep: Stand[]): void {
  const next = rng(0x57a9e);
  let flip = 1;
  for (let road = 0; road < ROADS.length; road++) {
    const runs = openRuns(road);
    const hw = ROADS[road].width / 2;
    for (let k = 0; k < runs.length; k++) {
      const [a, e] = runs[k];
      if (road === 0 && (k === 1 || k === 3)) {
        // Two arches over the career road, a third and two thirds of the way up. The legs stand
        // well clear of the paving, so the road itself stays open.
        roadPoint(road, (a + e) / 2, rp);
        arch(b, rp.x, rp.z, Math.atan2(rp.tx, rp.tz), hw * 2 + 4.6, 6.4, 1.3, 1.8, colliders, keep);
        continue;
      }
      // Everywhere else one stone a little way off the road, on alternate sides.
      roadPoint(road, a + (e - a) * (0.4 + next() * 0.2), rp);
      const off = (hw + 5 + next() * 3) * flip;
      flip = -flip;
      const x = rp.x - rp.tz * off, z = rp.z + rp.tx * off;
      if (inBounds(x, z) && padGap(x, z) > 1 && roadGap(x, z) >= ROAD_CLEAR) standingStone(b, next, x, z, colliders, keep);
    }
  }
  // Three big arches near the edge, opening onto the sky. Each starts from its own bearing and
  // steps sideways until it finds ground clear of roads and pads.
  for (let k = 0; k < 3; k++) {
    for (let j = 0; j < 16; j++) {
      const a = 0.55 + k * 2.09 + (j & 1 ? 1 : -1) * Math.ceil(j / 2) * 0.07;
      const reach = rimRadius(Math.cos(a) * WORLD_RADIUS, Math.sin(a) * WORLD_RADIUS) - 17;
      const x = Math.cos(a) * reach, z = Math.sin(a) * reach;
      if (!inBounds(x, z) || padGap(x, z) < 12 || roadGap(x, z) < 14) continue;
      arch(b, x, z, Math.atan2(x, z), 8.5, 10.5, 1.7, 2.4, colliders, keep);
      break;
    }
  }
  // And five stones round the rim between them, found the same way.
  for (let k = 0; k < 5; k++) {
    const back = 9 + next() * 10;
    for (let j = 0; j < 12; j++) {
      const a = 1.6 + k * 1.257 + (j & 1 ? 1 : -1) * Math.ceil(j / 2) * 0.08;
      const reach = rimRadius(Math.cos(a) * WORLD_RADIUS, Math.sin(a) * WORLD_RADIUS) - back;
      const x = Math.cos(a) * reach, z = Math.sin(a) * reach;
      if (!inBounds(x, z) || padGap(x, z) < 6 || roadGap(x, z) < 8) continue;
      let clear = true;
      for (const q of keep) if (Math.hypot(x - q.x, z - q.z) < 12) { clear = false; break; }
      if (!clear) continue;
      standingStone(b, next, x, z, colliders, keep);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Everything
// ---------------------------------------------------------------------------------------------

/** Rock, plants and waymarks for the whole mesa. Ten draw calls at most, fewer in any one view. */
export function buildScatter(kit: InkKit, tier: QualityTier): { group: THREE.Group; colliders: Collider[]; triangles: number } {
  const group = new THREE.Group();
  group.name = 'scatter';
  const colliders: Collider[] = [];
  const share = TIER_SHARE[tier];

  // Waymarks first: everything else keeps out of their way.
  const fixed = kit.builder() as Builder;
  const keep: Stand[] = [];
  buildWaymarks(fixed, colliders, keep);

  const columns: Item[] = [];
  const boulders: Item[] = [];
  const shrubs: Item[] = [];
  const stands: Stand[] = keep.slice();
  gatherRock(share, columns, boulders, stands, colliders);
  gatherShrubs(share, stands, shrubs);
  gatherPlants(fixed, share, stands);

  // Shapes are baked nearly white so each copy's tint is its colour, darker toward the foot.
  const cb = kit.builder() as Builder;
  cb.add(columnShape(), { color: '#ffffff', gradient: { bottom: '#d3bcc4', top: '#ffffff' }, hatch: 0.12 });
  const bb = kit.builder() as Builder;
  bb.add(boulderShape(), { color: '#ffffff', gradient: { bottom: '#cdbccb', top: '#ffffff' } });
  const sb = kit.builder() as Builder;
  sb.add(shrubShape(), { color: '#ffffff', gradient: { bottom: '#b8a9d2', top: '#ffffff' }, sway: 0.45 });

  let triangles = 0;
  triangles += instanced(kit, group, 'columns', cb.geometry(), columns);
  triangles += instanced(kit, group, 'boulders', bb.geometry(), boulders);
  triangles += instanced(kit, group, 'shrubs', sb.geometry(), shrubs);
  triangles += fixed.triangles();
  const mesh = fixed.build('waymarks-plants');
  // One mesh spread over the whole mesa: its sphere is the mesa, so it is always drawn.
  group.add(mesh);
  return { group, colliders, triangles };
}
