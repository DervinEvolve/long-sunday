// Everything that stands between the districts: street trees and park trees, fluted marble columns
// whole and fallen, brick walk-ups in short terraces, hedges, the elevated line on its aqueduct and
// a little street furniture. A future Queens with old stone in it, grown over.
//
// Nothing here is placed by hand except the aqueduct. The rest comes from seeded passes that ask
// the terrain the same questions of every spot: is it on the island, how far is the nearest street,
// how far is the nearest pad, is something already standing there. Nothing on a street or its
// sidewalk, nothing on a pad, no tree or column on a line of sight from a street to a district.
// A lower tier draws a subset of what a higher tier draws.
//
// Trees, columns, drums and hedges are instanced, split into three wedges of the island so the ones
// behind the walker are not drawn. Buildings are baked into one mesh per wedge. The aqueduct and
// the furniture are one mesh, the train is one more because it moves.
import * as THREE from 'three';
import type { Collider, InkKit, QualityTier } from '../types';
import { ROADS } from '../world/layout';
import { palette } from '../world/palette';
import {
  Claims, Frame, ROAD_CLEAR, aqueduct, bench, clearGround, groundRange, hydrant, item, lampPost, padGap, planter, roadGap, sightGap, slab, walkUp, archGap,
  type Builder, type Extras, type Item, type Lot,
} from './city';
import { SIDEWALK, heightAt, inBounds, rimRadius, roadLength, roadPoint, type RoadPoint } from './terrain';
import { gfbm, hash2, rng } from './util';

const SECTORS = 3;
/** How near a line of sight things may stand: a tree by its trunk, a column by its middle, a house by its wall. */
const TREE_SIGHT = 3, COLUMN_SIGHT = 1.5, WALL_SIGHT = 1;
const TIER_SHARE: Record<QualityTier, number> = { high: 1, medium: 0.7, low: 0.42 };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const sectorOf = (x: number, z: number) => Math.min(SECTORS - 1, Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * SECTORS));

const mat = new THREE.Matrix4();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const tint = new THREE.Color();

/** Turn a list of items into one instanced mesh per wedge that has any. `wedges` false keeps them in one. */
function instanced(kit: InkKit, group: THREE.Group, name: string, shape: THREE.BufferGeometry, items: Item[], wedges = true): number {
  const per = (shape.index ? shape.index.count : shape.getAttribute('position').count) / 3;
  for (let sector = 0; sector < (wedges ? SECTORS : 1); sector++) {
    const mine = wedges ? items.filter((it) => sectorOf(it.x, it.z) === sector) : items;
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
// few faces, and none that nobody will ever see.
// ---------------------------------------------------------------------------------------------

/**
 * Add one lumpy round thing to a point and index list. `down` is how far round it closes
 * underneath: about 1.8 is a dome with a little undercut, 3.14 is a whole ball.
 */
function blob(next: () => number, p: number[], idx: number[], seg: number, rings: number, lump: number, rx: number, ry: number, rz: number, ox: number, oy: number, oz: number, down: number): void {
  const first = p.length / 3;
  const whole = down > 3;
  p.push(ox, oy + ry * (1 + (next() - 0.5) * lump), oz);
  const turn = next() * 6.28;
  for (let k = 1; k <= rings; k++) {
    const phi = (k / (whole ? rings + 1 : rings)) * down;
    for (let j = 0; j < seg; j++) {
      const th = turn + ((j + (k & 1) * 0.5) / seg) * Math.PI * 2;
      const out = Math.sin(phi) * (1 + (next() - 0.5) * 2 * lump);
      p.push(ox + Math.cos(th) * out * rx, oy + Math.cos(phi) * ry * (1 + (next() - 0.5) * lump), oz + Math.sin(th) * out * rz);
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
  if (whole) {
    const foot = p.length / 3;
    p.push(ox, oy - ry * 0.92, oz);
    const low = first + 1 + (rings - 1) * seg;
    for (let j = 0; j < seg; j++) idx.push(foot, low + j, low + ((j + 1) % seg));
  }
}

/** Points and faces as a geometry whose normals all point away from one centre, so it shades as one round thing. */
function rounded(p: number[], idx: number[], cx: number, cy: number, cz: number): THREE.BufferGeometry {
  const n: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] - cx, y = p[i + 1] - cy, z = p[i + 2] - cz;
    const l = Math.hypot(x, y, z) || 1;
    n.push(x / l, y / l, z / l);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setIndex(idx);
  return g;
}

// Trees are modelled at their real size, seven metres, because the wind is baked in by height.
// A copy is scaled from that. The trunk is baked a dull violet so that any leaf tint turns it dark.
const TRUNK = '#8c6b9e';
const LEAF_FOOT = '#b3a6d6';

function trunk(b: Builder, h: number, r: number): void {
  b.add(new THREE.CylinderGeometry(r * 0.7, r, h, 5, 1, true).translate(0, h / 2 - 0.3, 0), { color: TRUNK, sway: 0.2, swayBase: 0 });
}

/** A street tree: a short trunk and a canopy of three round masses. 90 triangles. */
function roundTree(kit: InkKit): THREE.BufferGeometry {
  const b = kit.builder() as Builder;
  const next = rng(0x7ee1);
  trunk(b, 3.6, 0.3);
  const p: number[] = [], idx: number[] = [];
  blob(next, p, idx, 6, 3, 0.12, 2.55, 2.1, 2.45, 0, 4.85, 0, 3.14);
  blob(next, p, idx, 5, 2, 0.1, 1.5, 1.25, 1.45, -1.55, 4.9, -1.0, 3.14);
  b.add(rounded(p, idx, 0, 4.2, 0), { color: '#ffffff', gradient: { bottom: LEAF_FOOT, top: '#ffffff' }, sway: 0.5, swayBase: 0 });
  // The third mass has its own outline, so the canopy reads as drawn clumps and not one ball.
  const p2: number[] = [], idx2: number[] = [];
  blob(next, p2, idx2, 6, 2, 0.1, 1.7, 1.35, 1.6, 1.55, 4.0, 0.75, 3.14);
  b.add(rounded(p2, idx2, 0.6, 3.6, 0.3), { color: '#ffffff', gradient: { bottom: LEAF_FOOT, top: '#ffffff' }, sway: 0.5, swayBase: 0 });
  return b.geometry();
}

/** A layered tree: three flat tiers, each with its own line. Squeezed thin it is a cypress. 64 triangles. */
function layeredTree(kit: InkKit): THREE.BufferGeometry {
  const b = kit.builder() as Builder;
  const next = rng(0x1a7e5);
  trunk(b, 3.2, 0.26);
  const tiers: [number, number, number][] = [[2.5, 2.3, 2.2], [3.9, 1.85, 2.0], [5.1, 1.3, 1.9]];
  for (const [y, r, h] of tiers) {
    const p: number[] = [], idx: number[] = [];
    blob(next, p, idx, 6, 2, 0.14, r, h, r, 0, y, 0, 1.85);
    b.add(rounded(p, idx, 0, y - h * 0.3, 0), { color: '#ffffff', gradient: { bottom: LEAF_FOOT, top: '#ffffff' }, sway: 0.45, swayBase: 0 });
  }
  return b.geometry();
}

/** A hedge or a shrub: two domes run together, shaded as one round thing. 39 triangles. */
function bushShape(kit: InkKit): THREE.BufferGeometry {
  const p: number[] = [], idx: number[] = [];
  const next = rng(0x5b);
  blob(next, p, idx, 6, 2, 0.12, 0.8, 0.98, 0.74, -0.18, 0, -0.08, 1.79);
  blob(next, p, idx, 5, 2, 0.12, 0.6, 0.7, 0.6, 0.56, 0, 0.2, 1.79);
  const b = kit.builder() as Builder;
  b.add(rounded(p, idx, 0, -0.35, 0), { color: '#ffffff', gradient: { bottom: LEAF_FOOT, top: '#ffffff' }, sway: 0.4 });
  return b.geometry();
}

/**
 * A fluted shaft between two heights: a star section, so the ridges give the line something to
 * follow. Normals are per face. The points go round so that the outside is the front.
 */
function fluted(p: number[], n: number[], r0: number, r1: number, y0: number, y1: number, ribs = 8, dent = 0.86): void {
  const m = ribs * 2;
  const at = (i: number, r: number): [number, number] => {
    const a = (i / m) * Math.PI * 2;
    const k = i & 1 ? r * dent : r;
    return [Math.sin(a) * k, Math.cos(a) * k];
  };
  for (let i = 0; i < m; i++) {
    const [ax, az] = at(i, r0), [bx, bz] = at(i + 1, r0);
    const [cx, cz] = at(i, r1), [dx, dz] = at(i + 1, r1);
    p.push(ax, y0, az, bx, y0, bz, dx, y1, dz, ax, y0, az, dx, y1, dz, cx, y1, cz);
    let nx = -(bz - az), nz = bx - ax;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    for (let k = 0; k < 6; k++) n.push(nx, 0, nz);
  }
}

function flat(p: number[], n: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}

/** A column one metre tall: plinth, base ring, fluted shaft, a plain round capital and its slab. 86 triangles. */
function columnShape(kit: InkKit): THREE.BufferGeometry {
  const b = kit.builder() as Builder;
  const id = b.newId();
  // Half flat: marble in the shade should still be marble, and the avenue mostly sees the shaded side.
  const stone = { color: '#ffffff', gradient: { bottom: '#d9d0e4', top: '#ffffff' }, id, flat: 0.4 } as const;
  const p: number[] = [], n: number[] = [];
  fluted(p, n, 0.056, 0.047, 0.05, 0.93);
  b.add(flat(p, n), stone);
  b.add(new THREE.BoxGeometry(0.16, 0.03, 0.16).translate(0, 0.015, 0), { color: '#e2d9ea', id, flat: 0.4 });
  b.add(new THREE.CylinderGeometry(0.06, 0.07, 0.025, 8, 1, true).translate(0, 0.0425, 0), { color: '#f2ecf4', id, flat: 0.4 });
  b.add(new THREE.CylinderGeometry(0.07, 0.048, 0.035, 8, 1, true).translate(0, 0.9475, 0), { color: '#ffffff', id, flat: 0.4 });
  b.add(new THREE.BoxGeometry(0.155, 0.035, 0.155).translate(0, 0.9825, 0), { color: '#ffffff', id, flat: 0.4 });
  return b.geometry();
}

/** A drum of a fallen column, one metre tall and one across, broken unevenly on top. 64 triangles. */
function drumShape(kit: InkKit): THREE.BufferGeometry {
  const next = rng(0xd7a);
  const p: number[] = [], n: number[] = [];
  fluted(p, n, 0.5, 0.5, 0, 0.82);
  // Bottom, flat. Top, a rough break: a fan up to an off-centre peak.
  const m = 16;
  const at = (i: number): [number, number] => {
    const a = (i / m) * Math.PI * 2;
    const k = i & 1 ? 0.43 : 0.5;
    return [Math.sin(a) * k, Math.cos(a) * k];
  };
  const px = (next() - 0.5) * 0.4, pz = (next() - 0.5) * 0.4, py = 1.0;
  for (let i = 0; i < m; i++) {
    const [ax, az] = at(i), [bx, bz] = at(i + 1);
    p.push(0, 0, 0, bx, 0, bz, ax, 0, az);
    for (let k = 0; k < 3; k++) n.push(0, -1, 0);
    p.push(px, py, pz, ax, 0.82, az, bx, 0.82, bz);
    const ux = ax - px, uy = 0.82 - py, uz = az - pz, vx = bx - px, vy = 0.82 - py, vz = bz - pz;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) n.push(nx, ny, nz);
  }
  const b = kit.builder() as Builder;
  b.add(flat(p, n), { color: '#ffffff', gradient: { bottom: '#d9d0e4', top: '#ffffff' }, flat: 0.35 });
  return b.geometry();
}

// ---------------------------------------------------------------------------------------------
// Where things go
// ---------------------------------------------------------------------------------------------

const LEAVES = ['#7fb85a', '#63aa5e', '#3f8a57', '#8cc56c', '#4f9c62'];
const HEDGES = ['#5fa85c', '#3f8a57', '#7fb85a', '#6ea884'];
/** A few trees are in blossom or have turned. */
const ODD = ['#f0a0b6', '#f3c531', '#ef9a4e'];

interface Plan {
  share: number;
  rich: boolean;
  claims: Claims;
  /** Baked meshes, one a wedge. */
  city: Builder[];
  /** The aqueduct and the furniture. */
  works: Builder;
  round: Item[];
  layered: Item[];
  drums: Item[];
  out: Extras;
}

const rp: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };

/** Stretches of a road that are clear of every pad: [start, end] in metres along it. */
function openRuns(road: number): [number, number][] {
  const runs: [number, number][] = [];
  const len = roadLength(road);
  let from = -1;
  for (let s = 0; s <= len; s += 1) {
    roadPoint(road, s, rp);
    const open = padGap(rp.x, rp.z) > 3;
    if (open && from < 0) from = s;
    if ((!open || s + 1 > len) && from >= 0) {
      if (s - from > 10) runs.push([from, s]);
      from = -1;
    }
  }
  return runs;
}

const sidewalk = (road: number) => (road === 0 ? SIDEWALK.spine : SIDEWALK.branch);

/** A point `off` metres from the road's centre line on one side, at `s` along it. Leaves the tangent in rp. */
function beside(road: number, s: number, side: number, off: number): [number, number] {
  roadPoint(road, s, rp);
  return [rp.x - rp.tz * off * side, rp.z + rp.tx * off * side];
}

function leaf(next: () => number): string {
  return next() < 0.06 ? ODD[Math.floor(next() * ODD.length)] : LEAVES[Math.floor(next() * LEAVES.length)];
}

/** Stand one column. Returns false and does nothing if the ground is spoken for. */
function column(plan: Plan, x: number, z: number, top: number, yaw: number): boolean {
  if (!clearGround(x, z, 0.7) || sightGap(x, z) < COLUMN_SIGHT || plan.claims.taken(x, z, 0.8)) return false;
  const y = heightAt(x, z) - 0.15;
  const h = top - y;
  plan.out.columns.push(item(x, y, z, yaw, h, palette.marble));
  plan.out.colliders.push({ kind: 'circle', x, z, r: h * 0.08 + 0.05 });
  plan.claims.circle(x, z, 1.1);
  return true;
}

/** A broken stump of a column. */
function stump(plan: Plan, next: () => number, x: number, z: number, wide: number): boolean {
  if (!clearGround(x, z, wide * 0.6) || plan.claims.taken(x, z, wide * 0.6)) return false;
  const h = 0.8 + next() * 2.4;
  plan.drums.push({ x, y: heightAt(x, z) - 0.2, z, yaw: next() * 6.28, tiltX: 0, tiltZ: 0, sx: wide, sy: h, sz: wide, color: palette.marble });
  plan.out.colliders.push({ kind: 'circle', x, z, r: wide * 0.52 });
  plan.claims.circle(x, z, wide * 0.7);
  return true;
}

/** A drum lying in the grass on its side. */
function fallen(plan: Plan, next: () => number, x: number, z: number, wide: number): boolean {
  const long = wide * (0.9 + next() * 0.9);
  if (!clearGround(x, z, long * 0.6) || plan.claims.taken(x, z, long * 0.6)) return false;
  plan.drums.push({ x, y: heightAt(x, z) + wide * 0.42, z, yaw: next() * 6.28, tiltX: Math.PI / 2, tiltZ: 0, sx: wide, sy: long, sz: wide, color: palette.marble });
  plan.out.colliders.push({ kind: 'circle', x, z, r: Math.max(wide, long) * 0.5 });
  plan.claims.circle(x, z, long * 0.7);
  return true;
}

/** A beam across the tops of two columns, with a thin course over it. */
function beam(plan: Plan, ax: number, az: number, bx: number, bz: number, top: number, wide: number): void {
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const len = Math.hypot(bx - ax, bz - az);
  const f = new Frame(mx, top, mz, Math.atan2(-(bz - az), bx - ax));
  const b = plan.city[sectorOf(mx, mz)];
  const id = b.newId();
  slab(b, f, 0, 0, 0, len + wide, wide * 0.8, wide, palette.marbleShade, id, { top: palette.marble, hatch: 0.08 });
  slab(b, f, 0, wide * 0.8, 0, len + wide * 1.3, wide * 0.22, wide * 1.3, palette.marble, undefined);
}

/** Ivy on a column: the hedge shape pressed thin against one side of it. */
function ivy(plan: Plan, next: () => number, x: number, z: number, h: number): void {
  const a = next() * 6.28;
  const r = h * 0.05;
  plan.out.bushes.push({ x: x + Math.sin(a) * r, y: heightAt(x, z) - 0.3, z: z + Math.cos(a) * r, yaw: a, tiltX: 0, tiltZ: 0, sx: h * 0.085, sy: h * (0.35 + next() * 0.4), sz: h * 0.05, color: HEDGES[Math.floor(next() * HEDGES.length)] });
}

/**
 * A colonnade beside a road: a row of columns under one beam, the far end of it fallen.
 * Where a line of sight crosses it the columns are down to stumps, so it frames what is behind.
 * Returns how many columns that is. With `dry` it only counts and builds nothing.
 */
function colonnade(plan: Plan, road: number, a: number, e: number, side: number, seed: number, dry = false): number {
  const next = rng(seed);
  const off = ROADS[road].width / 2 + 4.7;
  const tall = 7.2 + next() * 1.4;
  const gap = tall * 0.42;
  const want = Math.min(9, Math.floor((e - a - 6) / gap));
  if (want < 3) return 0;
  const from = a + 3 + next() * Math.max(0, e - a - 6 - want * gap);
  const whole = Math.max(3, want - 1 - Math.floor(next() * 3));
  let top = -Infinity, down = 0;
  for (let i = 0; i < whole; i++) {
    const [x, z] = beside(road, from + i * gap, side, off);
    top = Math.max(top, heightAt(x, z) + tall);
    if (sightGap(x, z) < COLUMN_SIGHT) down++;
  }
  if (dry) return down;
  let px = 0, pz = 0, had = false;
  for (let i = 0; i < want; i++) {
    const [x, z] = beside(road, from + i * gap, side, off);
    const yaw = Math.atan2(rp.tx, rp.tz);
    if (i < whole) {
      const ok = column(plan, x, z, top, yaw);
      if (ok && had) beam(plan, px, pz, x, z, top, tall * 0.115);
      if (ok && next() < 0.3) ivy(plan, next, x, z, tall);
      if (!ok && sightGap(x, z) < COLUMN_SIGHT) stump(plan, next, x, z, tall * 0.115);
      had = ok; px = x; pz = z;
    } else if (i === whole) {
      stump(plan, next, x, z, tall * 0.115);
    } else {
      fallen(plan, next, x + (next() - 0.5) * 2, z + (next() - 0.5) * 2, tall * 0.115);
    }
  }
  return down;
}

/** Old stone standing in a park: part of a round temple, or a short row, or one tall column on its own. */
function ruin(plan: Plan, x: number, z: number, seed: number): void {
  const next = rng(seed);
  const kind = next();
  const tall = 6.5 + next() * 3;
  const wide = tall * 0.115;
  if (kind < 0.4) {
    // An arc of a round temple.
    const r = 5 + next() * 2;
    const n = 8;
    const start = Math.floor(next() * n);
    const keep = 3 + Math.floor(next() * 3);
    let top = -Infinity;
    for (let i = 0; i < keep; i++) {
      const a = ((start + i) / n) * 6.283;
      top = Math.max(top, heightAt(x + Math.sin(a) * r, z + Math.cos(a) * r) + tall);
    }
    let px = 0, pz = 0, had = false;
    for (let i = 0; i < n; i++) {
      const a = ((start + i) / n) * 6.283;
      const cx = x + Math.sin(a) * r, cz = z + Math.cos(a) * r;
      if (i < keep) {
        const ok = column(plan, cx, cz, top, a);
        if (ok && had) beam(plan, px, pz, cx, cz, top, wide);
        if (ok && next() < 0.35) ivy(plan, next, cx, cz, tall);
        had = ok; px = cx; pz = cz;
      } else if (next() < 0.55) stump(plan, next, cx, cz, wide);
    }
    for (let i = 0; i < 3; i++) fallen(plan, next, x + (next() - 0.5) * r * 1.4, z + (next() - 0.5) * r * 1.4, wide);
  } else if (kind < 0.75) {
    // A short row under a beam, with a pair of cypresses if there is room.
    const yaw = next() * 6.28;
    const n = 3 + Math.floor(next() * 2);
    const gap = tall * 0.42;
    const dx = Math.cos(yaw), dz = -Math.sin(yaw);
    let top = -Infinity;
    for (let i = 0; i < n; i++) top = Math.max(top, heightAt(x + dx * (i - (n - 1) / 2) * gap, z + dz * (i - (n - 1) / 2) * gap) + tall);
    let px = 0, pz = 0, had = false;
    for (let i = 0; i < n; i++) {
      const cx = x + dx * (i - (n - 1) / 2) * gap, cz = z + dz * (i - (n - 1) / 2) * gap;
      const ok = column(plan, cx, cz, top, yaw);
      if (ok && had) beam(plan, px, pz, cx, cz, top, wide);
      if (ok && next() < 0.3) ivy(plan, next, cx, cz, tall);
      had = ok; px = cx; pz = cz;
    }
    fallen(plan, next, x - dz * 3 + dx * gap, z + dx * 3 + dz * gap, wide);
    fallen(plan, next, x + dz * 3.5 - dx * gap, z - dx * 3.5 - dz * gap, wide);
    for (const end of [-1, 1]) {
      const cx = x + dx * end * ((n + 1) / 2) * gap, cz = z + dz * end * ((n + 1) / 2) * gap;
      cypress(plan, next, cx, cz);
    }
  } else {
    // One very tall column and what is left of its neighbour.
    const big = tall * 1.35;
    column(plan, x, z, heightAt(x, z) + big, next() * 6.28);
    if (next() < 0.5) ivy(plan, next, x, z, big);
    const a = next() * 6.28;
    stump(plan, next, x + Math.sin(a) * big * 0.42, z + Math.cos(a) * big * 0.42, big * 0.115);
    fallen(plan, next, x + Math.sin(a + 1.2) * 4, z + Math.cos(a + 1.2) * 4, big * 0.115);
    fallen(plan, next, x + Math.sin(a + 2.6) * 5.5, z + Math.cos(a + 2.6) * 5.5, big * 0.115);
  }
}

/** One tree. `kind` 0 is round, 1 is layered. */
function tree(plan: Plan, kind: number, x: number, z: number, size: number, yaw: number, color: string, room = 1.5): boolean {
  if (!clearGround(x, z, 0.4) || sightGap(x, z) < TREE_SIGHT || plan.claims.taken(x, z, room)) return false;
  (kind === 0 ? plan.round : plan.layered).push(item(x, heightAt(x, z) - 0.05, z, yaw, size, color));
  plan.out.colliders.push({ kind: 'circle', x, z, r: 0.34 * size });
  plan.claims.circle(x, z, 1.3);
  return true;
}

/** A cypress: the layered tree squeezed thin and pulled tall. */
function cypress(plan: Plan, next: () => number, x: number, z: number): boolean {
  if (!clearGround(x, z, 0.5) || sightGap(x, z) < TREE_SIGHT || plan.claims.taken(x, z, 1.2)) return false;
  const s = 0.42 + next() * 0.12;
  plan.layered.push({ x, y: heightAt(x, z) - 1.6, z, yaw: next() * 6.28, tiltX: 0, tiltZ: 0, sx: s, sy: 1.25 + next() * 0.35, sz: s, color: next() < 0.5 ? '#3f8a57' : '#357a5a' });
  plan.out.colliders.push({ kind: 'circle', x, z, r: 0.6 });
  plan.claims.circle(x, z, 1.2);
  return true;
}

/** Can a building stand on this footprint: off streets and pads, out of the view through the arch, on fairly level ground, nothing there already. */
function lotFree(plan: Plan, f: Frame, hw: number, hd: number, road: number, pad: number, rim: number): boolean {
  // The stoop reaches two metres out in front, so the front row of samples is taken out there.
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const lz = j > 0 ? hd + 2.1 : j * hd;
    const x = f.wx(i * hw, lz), z = f.wz(i * hw, lz);
    if (!clearGround(x, z, 0, road, rim) || padGap(x, z) < pad) return false;
    if (archGap(x, z) < WALL_SIGHT) return false;
    if (plan.claims.taken(x, z, 0.6)) return false;
  }
  const [lo, hi] = groundRange(f, hw, hd);
  return hi - lo < 3.4;
}

/**
 * A terrace: up to `count` walk-ups shoulder to shoulder, fronts in one line, facing along `yaw`.
 * (x, z) is the middle of the front line. Returns how many were built.
 */
function terrace(plan: Plan, x: number, z: number, yaw: number, count: number, seed: number, road: number, pad: number, rim: number, low = 3, high = 6): number {
  const next = rng(seed);
  const widths: number[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    widths.push(7 + next() * 2.4);
    total += widths[i];
  }
  const depth = 9.5 + next() * 2;
  const row = new Frame(x, 0, z, yaw);
  const lots: (Lot | null)[] = [];
  let at = -total / 2;
  let before = 0;
  for (let i = 0; i < count; i++) {
    const w = widths[i];
    const d = depth + (next() - 0.5) * 1.6;
    const cx = row.wx(at + w / 2, -d / 2), cz = row.wz(at + w / 2, -d / 2);
    at += w;
    let storeys = low + Math.floor(next() * (high - low + 0.7));
    if (storeys === before) storeys = storeys >= high ? storeys - 1 : storeys + 1;
    before = storeys;
    const lotSeed = Math.floor(next() * 1e9);
    const f = new Frame(cx, 0, cz, yaw);
    if (!lotFree(plan, f, w / 2, d / 2, road, pad, rim)) { lots.push(null); continue; }
    lots.push({ x: cx, z: cz, yaw, w, d, storeys, seed: lotSeed, openLeft: true, openRight: true });
  }
  let built = 0;
  for (let i = 0; i < count; i++) {
    const lot = lots[i];
    if (!lot) continue;
    // Local +x runs to the right along the row, so the neighbour on that side is the next one.
    lot.openLeft = i === 0 || !lots[i - 1];
    lot.openRight = i === count - 1 || !lots[i + 1];
    walkUp(plan.city[sectorOf(lot.x, lot.z)], lot, plan.rich, plan.out);
    plan.claims.box(lot.x, lot.z, lot.w / 2, lot.d / 2, yaw, 0.6);
    const f = new Frame(lot.x, 0, lot.z, yaw);
    plan.claims.circle(f.wx(0, lot.d / 2 + 1.2), f.wz(0, lot.d / 2 + 1.2), lot.w / 2 - 0.8);
    built++;
  }
  return built;
}

/**
 * Terraces set back along the open stretches of the streets, in twos to fours with a lot left open
 * between them, and the two sides out of step, so there is always a way through to the park.
 */
function roadside(plan: Plan): void {
  const next = rng(0xb10c);
  let flip = 1;
  for (let road = 0; road < ROADS.length; road++) {
    const runs = openRuns(road);
    const hw = ROADS[road].width / 2;
    const avenue = road === 0;
    for (let k = 0; k < runs.length; k++) {
      const [a, e] = runs[k];
      flip = -flip;
      const seed = 0x51de + road * 977 + k * 131;
      // The avenue gets a colonnade down one side of every second stretch, and now and then a side street does.
      const stone = avenue ? k % 2 === 0 : hash2(road, k, 91) < 0.3;
      // It goes across the street, and the houses swap with it, if that keeps it clear of a line of sight.
      let stoneSide = -flip;
      if (stone) {
        if (colonnade(plan, road, a, e, -flip, seed + 7, true) > 0 && colonnade(plan, road, a, e, flip, seed + 7, true) === 0) stoneSide = flip;
        colonnade(plan, road, a, e, stoneSide, seed + 7);
      }
      for (const side of [flip, -flip]) {
        if (stone && side === stoneSide) continue;
        let s = a + (side === flip ? 2 : 13) + next() * 5;
        let g = 0;
        while (s < e - 8) {
          let count = 2 + Math.floor(next() * 2.6);
          const keep = hash2(road * 31 + k, g + (side > 0 ? 40 : 0), 17) < (avenue ? 1 : 0.75) * (0.3 + 0.7 * plan.share);
          // Near the end of the stretch a shorter row still fits.
          while (count > 1 && s + count * 8.2 > e + 2) count--;
          const len = count * 8.2;
          if (s + len > e + 2) break;
          if (keep) {
            const [x, z] = beside(road, s + len / 2, side, hw + 6.6);
            // The front looks back at the street.
            const yaw = Math.atan2(rp.tz * side, -rp.tx * side);
            terrace(plan, x, z, yaw, count, seed + g * 53 + (side > 0 ? 9 : 0), ROAD_CLEAR + 0.6, 2.5, 7, 3, avenue ? 6 : 4);
          }
          s += len + 8 + next() * 10;
          g++;
        }
      }
    }
  }
}

/** Blocks standing out in the parkland, so the middle distance is a city and not a lawn. */
function blocks(plan: Plan): void {
  const STEP = 37;
  const next = rng(0xb10c5);
  for (let ix = -7; ix <= 7; ix++) {
    for (let iz = -7; iz <= 7; iz++) {
      const jx = hash2(ix, iz, 301), jz = hash2(ix, iz, 302), pick = hash2(ix, iz, 303), turn = hash2(ix, iz, 304);
      const count = 2 + Math.floor(next() * 2.6);
      const seed = Math.floor(next() * 1e9);
      if (pick > 0.8 * (0.35 + 0.65 * plan.share)) continue;
      const x = (ix + 0.2 + jx * 0.6) * STEP, z = (iz + 0.2 + jz * 0.6) * STEP;
      if (!inBounds(x, z)) continue;
      // The city grid is a little off north, and a block faces one of its four ways.
      const yaw = 0.3 + Math.floor(turn * 4) * (Math.PI / 2);
      terrace(plan, x, z, yaw, count, seed, 9, 7, 9, 4, 6);
    }
  }
}

/** Trees in a line down both sides of every street, behind the sidewalk. */
function streetTrees(plan: Plan): void {
  const next = rng(0x57ee7);
  for (let road = 0; road < ROADS.length; road++) {
    const off = ROADS[road].width / 2 + ROAD_CLEAR + 0.5;
    const gap = road === 0 ? 8.5 : 10.5;
    for (const [a, e] of openRuns(road)) {
      for (const side of [-1, 1]) {
        for (let s = a + 1.5 + (side > 0 ? 0 : gap / 2); s < e - 1; s += gap) {
          const pick = next(), size = 0.82 + next() * 0.3, yaw = next() * 6.28, color = leaf(next), j = (next() - 0.5) * 1.6;
          if (pick > plan.share + 0.3) continue;
          const [x, z] = beside(road, s + j, side, off);
          if (tree(plan, 0, x, z, size, yaw, color, 1.0) || sightGap(x, z) >= TREE_SIGHT) continue;
          // On a line of sight it stands further back from the street, if there is room well clear of the line.
          for (const back of [4.5, 9]) {
            const [bx, bz] = beside(road, s + j, side, off + back);
            if (sightGap(bx, bz) >= TREE_SIGHT + 4 && tree(plan, 0, bx, bz, size, yaw, color, 1.0)) break;
          }
        }
      }
    }
  }
}

/** Groves and loose trees over the parkland. Round trees in one kind of grove, layered in another. */
function parkTrees(plan: Plan): void {
  const STEP = 6.5;
  const reach = Math.ceil(240 / STEP);
  for (let ix = -reach; ix <= reach; ix++) {
    for (let iz = -reach; iz <= reach; iz++) {
      const x = (ix + hash2(ix, iz, 41)) * STEP, z = (iz + hash2(ix, iz, 42)) * STEP;
      if (!inBounds(x, z)) continue;
      const grove = smooth(-0.1, 0.32, gfbm(x * 0.017 + 3.1, z * 0.017 - 8.4, 2, 77));
      const want = (0.04 + 0.42 * grove) * plan.share;
      if (hash2(ix, iz, 43) > want) continue;
      const kind = gfbm(x * 0.011 - 5, z * 0.011 + 2, 2, 78) > 0.08 ? 1 : 0;
      const big = hash2(ix, iz, 44);
      const size = kind === 0 ? 0.95 + big * 0.65 : 0.9 + big * 0.55;
      const odd = hash2(ix, iz, 45) < 0.05;
      const color = odd ? ODD[Math.floor(hash2(ix, iz, 46) * ODD.length)] : LEAVES[Math.floor(hash2(ix, iz, 46) * LEAVES.length)];
      tree(plan, kind, x, z, size, hash2(ix, iz, 47) * 6.28, color, 2.4);
    }
  }
}

/** A shrub this big or bigger stands above his waist, so he walks round it. Smaller ones he wades through. */
const SHRUB_SOLID = 1.15;

/**
 * A hedge or a shrub. `row` is half the gap to the next one when it is part of a clipped row:
 * then it is a length of wall, and the row has no way through.
 */
function bush(plan: Plan, x: number, z: number, size: number, yaw: number, color: string, squash = 1, row = 0): boolean {
  if (!clearGround(x, z, size * 0.5) || plan.claims.taken(x, z, size * 0.6)) return false;
  plan.out.bushes.push({ x, y: heightAt(x, z) - 0.12, z, yaw, tiltX: 0, tiltZ: 0, sx: size, sy: size * squash, sz: size, color });
  if (row > 0) plan.out.colliders.push({ kind: 'box', x, z, hw: row, hd: size * 0.4, rot: yaw });
  else if (size * squash >= SHRUB_SOLID) plan.out.colliders.push({ kind: 'circle', x, z, r: size * 0.5 });
  return true;
}

/** How far apart the lumps of a clipped hedge stand. */
const HEDGE_GAP = 2.15;

/** Clipped hedges along some of the avenue, and loose shrubs through the parks. */
function greenery(plan: Plan): void {
  const next = rng(0x6e3d);
  for (let road = 0; road < ROADS.length; road++) {
    const off = ROADS[road].width / 2 + ROAD_CLEAR + 0.75;
    for (const [a, e] of openRuns(road)) {
      for (const side of [-1, 1]) {
        let s = a + 2 + next() * 6;
        while (s < e - 4) {
          const len = 5 + next() * 7;
          const color = HEDGES[Math.floor(next() * HEDGES.length)];
          const keep = next() < 0.5 * (0.5 + 0.5 * plan.share);
          if (keep) for (let t = s; t < Math.min(s + len, e - 1); t += HEDGE_GAP) {
            const [x, z] = beside(road, t, side, off);
            // Turned so the long way of the shape runs with the street.
            bush(plan, x, z, 1.3, Math.atan2(-rp.tz, rp.tx), color, 0.7, HEDGE_GAP / 2);
          }
          s += len + 6 + next() * 10;
        }
      }
    }
  }
  const STEP = 5.5;
  const reach = Math.ceil(240 / STEP);
  for (let ix = -reach; ix <= reach; ix++) {
    for (let iz = -reach; iz <= reach; iz++) {
      const x = (ix + hash2(ix, iz, 51)) * STEP, z = (iz + hash2(ix, iz, 52)) * STEP;
      if (!inBounds(x, z)) continue;
      const patch = smooth(0.0, 0.4, gfbm(x * 0.03 - 1.7, z * 0.03 + 4.2, 2, 79));
      if (hash2(ix, iz, 53) > (0.012 + 0.085 * patch) * plan.share) continue;
      const size = 0.8 + hash2(ix, iz, 54) * 1.1;
      bush(plan, x, z, size, hash2(ix, iz, 55) * 6.28, HEDGES[Math.floor(hash2(ix, iz, 56) * HEDGES.length)]);
    }
  }
}

const ASIDE: [number, number][] = [[13, 0], [-13, 0], [0, 13], [0, -13], [13, 13], [-13, -13], [13, -13], [-13, 13], [21, 0], [-21, 0], [0, 21], [0, -21]];

/** Old stone in the parks, most of it where it can be seen from a street. */
function ruins(plan: Plan): void {
  const STEP = 40;
  const room = (x: number, z: number) => clearGround(x, z, 7, ROAD_CLEAR + 1, 6) && padGap(x, z) >= 9;
  for (let ix = -6; ix <= 6; ix++) {
    for (let iz = -6; iz <= 6; iz++) {
      let x = (ix + 0.15 + hash2(ix, iz, 61) * 0.7) * STEP, z = (iz + 0.15 + hash2(ix, iz, 62) * 0.7) * STEP;
      if (!room(x, z)) continue;
      const near = roadGap(x, z) < 34;
      if (hash2(ix, iz, 63) > (near ? 0.75 : 0.3)) continue;
      if (plan.claims.taken(x, z, 7)) continue;
      if (sightGap(x, z) < COLUMN_SIGHT + 7) {
        // On a line of sight it steps aside, and is left out only if there is nowhere to step to.
        const to = ASIDE.find(([ox, oz]) => room(x + ox, z + oz) && sightGap(x + ox, z + oz) >= COLUMN_SIGHT + 7 && !plan.claims.taken(x + ox, z + oz, 7));
        if (!to) continue;
        x += to[0]; z += to[1];
      }
      ruin(plan, x, z, 0x2b1 + ix * 131 + iz * 17);
    }
  }
}

/** Lamps, benches, a hydrant here and there, a planter. Sparse. */
function furniture(plan: Plan): void {
  const next = rng(0xf00d);
  for (let road = 0; road < ROADS.length; road++) {
    const walk = ROADS[road].width / 2 + sidewalk(road);
    let n = 0;
    for (const [a, e] of openRuns(road)) {
      let side = n & 1 ? 1 : -1;
      for (let s = a + 5; s < e - 3; s += 19 + next() * 6) {
        const what = n % 3;
        n++;
        side = -side;
        if (road === 0 && what === 0 && padGap(...beside(road, s, side, walk + 0.6)) < 9) continue;
        if (what !== 1) {
          const [x, z] = beside(road, s, side, walk + 0.6);
          if (!plan.claims.taken(x, z, 0.5) && padGap(x, z) > 1) { lampPost(plan.works, x, z, Math.atan2(rp.tx, rp.tz), plan.out); plan.claims.circle(x, z, 0.6); }
        }
        if (what !== 0) {
          const [x, z] = beside(road, s + 4.5, -side, walk + 1.0);
          // The seat faces the street.
          const yaw = Math.atan2(rp.tz * -side, -rp.tx * -side);
          if (!plan.claims.taken(x, z, 1.1) && padGap(x, z) > 1) { bench(plan.works, x, z, yaw, plan.out); plan.claims.circle(x, z, 1.2); }
        }
        if (what === 2) {
          const [x, z] = beside(road, s + 9, side, walk + 0.55);
          if (!plan.claims.taken(x, z, 0.5) && padGap(x, z) > 1) { hydrant(plan.works, x, z, next() * 6.28, plan.out); plan.claims.circle(x, z, 0.6); }
        }
        if (what === 1 && plan.rich) {
          const [x, z] = beside(road, s - 5, side, walk + 1.35);
          const yaw = Math.atan2(-rp.tz, rp.tx);
          // Near a corner the other street can come closer than this one, so ask about each end of the box.
          const f = new Frame(x, 0, z, yaw);
          let off = roadGap(x, z);
          for (const lx of [-1.6, 1.6]) for (const lz of [-0.6, 0.6]) off = Math.min(off, roadGap(f.wx(lx, lz), f.wz(lx, lz)));
          if (off > SIDEWALK.spine + 0.3 && !plan.claims.taken(x, z, 1.6) && padGap(x, z) > 2) { planter(plan.works, x, z, yaw, 3.2, plan.out, n); plan.claims.circle(x, z, 1.8); }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Everything
// ---------------------------------------------------------------------------------------------

/** The city between the districts. About eighteen draw calls on the best tier, fewer in any one view. */
export function buildScatter(kit: InkKit, tier: QualityTier): { group: THREE.Group; colliders: Collider[]; triangles: number; update?: (dt: number, t: number) => void } {
  const group = new THREE.Group();
  group.name = 'scatter';
  const colliders: Collider[] = [];
  const plan: Plan = {
    share: TIER_SHARE[tier],
    rich: tier !== 'low',
    claims: new Claims(),
    city: [kit.builder() as Builder, kit.builder() as Builder, kit.builder() as Builder],
    works: kit.builder() as Builder,
    round: [],
    layered: [],
    drums: [],
    out: { columns: [], bushes: [], trees: [], colliders },
  };

  // Big things first, so the small things fit round them.
  const line = aqueduct(kit, plan.works, plan.out, plan.claims, plan.rich);
  roadside(plan);
  ruins(plan);
  blocks(plan);
  furniture(plan);
  streetTrees(plan);
  parkTrees(plan);
  greenery(plan);
  // Trees that buildings asked for on their roofs.
  for (const t of plan.out.trees) plan.round.push(t);

  let triangles = line.triangles;
  triangles += instanced(kit, group, 'trees', roundTree(kit), plan.round);
  triangles += instanced(kit, group, 'layered', layeredTree(kit), plan.layered);
  triangles += instanced(kit, group, 'columns', columnShape(kit), plan.out.columns);
  triangles += instanced(kit, group, 'drums', drumShape(kit), plan.drums, false);
  triangles += instanced(kit, group, 'hedges', bushShape(kit), plan.out.bushes);
  for (let i = 0; i < SECTORS; i++) {
    const b = plan.city[i];
    if (b.triangles() === 0) continue;
    triangles += b.triangles();
    group.add(b.build(`buildings-${i}`));
  }
  // The aqueduct runs right across the island and out the far side, so this one is always drawn.
  group.add(plan.works.build('works'));
  group.add(line.train);
  return { group, colliders, triangles, update: line.update };
}
