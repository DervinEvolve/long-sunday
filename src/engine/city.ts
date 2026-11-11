// The built part of the city between the districts: brick walk-ups, the marble aqueduct that
// carries the elevated line, its train, and the street furniture. scatter.ts decides where things
// go and owns the instanced shapes; this file knows how to draw one of each into a builder.
//
// Everything here is drawn, not modelled: windows are flat cards, a fire escape is a few bars.
import * as THREE from 'three';
import type { Collider, ColorLike, InkBuilder, InkKit } from '../types';
import { ROADS, SITES, SPAWN } from '../world/layout';
import { palette } from '../world/palette';
import * as geo from './geo';
import { heightAt, inBounds, rimRadius, roadInfo, roadLength, roadPoint, type RoadHit, type RoadPoint } from './terrain';

export type Builder = Required<InkBuilder>;

/** Nothing stands nearer a road's edge than this. The sidewalk, its lamps and its signs live inside it. */
export const ROAD_CLEAR = 3.2;
/** Nothing stands nearer a district centre than this share of its radius. */
export const PAD_CLEAR = 1.05;

const hit: RoadHit = { road: -1, dist: 0, s: 0, height: 0, width: 0 };

/** Metres from the nearest road's edge. Big when no road is near. */
export function roadGap(x: number, z: number): number {
  roadInfo(x, z, hit);
  return hit.road < 0 ? 99 : hit.dist - hit.width / 2;
}

/** Metres outside the nearest pad's keep-out circle. Negative inside one. */
export function padGap(x: number, z: number): number {
  let best = Infinity;
  for (const s of SITES) {
    const d = Math.hypot(x - s.center.x, z - s.center.z) - s.radius * PAD_CLEAR;
    if (d < best) best = d;
  }
  return best;
}

/** One thing to draw as an instance: where, how it is turned and stretched, and its tint. */
export interface Item { x: number; y: number; z: number; yaw: number; tiltX: number; tiltZ: number; sx: number; sy: number; sz: number; color: ColorLike }

export function item(x: number, y: number, z: number, yaw: number, s: number, color: ColorLike): Item {
  return { x, y, z, yaw, tiltX: 0, tiltZ: 0, sx: s, sy: s, sz: s, color };
}

// ---------------------------------------------------------------------------------------------
// Who stands where. Everything that is placed claims a circle or two, and the next thing asks
// before it settles. A coarse grid keeps the asking cheap.
// ---------------------------------------------------------------------------------------------

const CELL = 12;

export class Claims {
  private cells = new Map<number, number[]>();
  private xs: number[] = [];
  private zs: number[] = [];
  private rs: number[] = [];

  circle(x: number, z: number, r: number): void {
    const i = this.xs.length;
    this.xs.push(x); this.zs.push(z); this.rs.push(r);
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = (ix + 512) * 1024 + (iz + 512);
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(i);
    }
  }

  /** A box as a row of circles down its long side. */
  box(x: number, z: number, hw: number, hd: number, yaw: number, pad = 0): void {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const long = Math.max(hw, hd), short = Math.min(hw, hd);
    const n = Math.max(1, Math.round(long / short));
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : ((i + 0.5) / n - 0.5) * 2 * long;
      const lx = hw >= hd ? t : 0, lz = hw >= hd ? 0 : t;
      this.circle(x + lx * cs + lz * sn, z - lx * sn + lz * cs, short * 1.25 + pad);
    }
  }

  taken(x: number, z: number, r: number): boolean {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const c = this.cells.get((ix + 512) * 1024 + (iz + 512));
      if (!c) continue;
      for (const i of c) {
        const dx = x - this.xs[i], dz = z - this.zs[i], rr = r + this.rs[i];
        if (dx * dx + dz * dz < rr * rr) return true;
      }
    }
    return false;
  }
}

/** May something of radius `r` stand here: on the island, off the streets, off the pads. */
export function clearGround(x: number, z: number, r: number, road = ROAD_CLEAR, rim = 3): boolean {
  if (!inBounds(x, z)) return false;
  if (rimRadius(x, z) - Math.hypot(x, z) < rim + r) return false;
  if (roadGap(x, z) - r < road) return false;
  return padGap(x, z) - r >= 0;
}

// ---------------------------------------------------------------------------------------------
// Lines of sight. Coming up any street, a district should show the thing it is known by from a
// good way off, so no tree or column stands on the straight line from the street to the middle
// of the pad. One more line runs north from where the walk starts, through the arch.
// ---------------------------------------------------------------------------------------------

/** How far from a district's centre a line starts, measured straight, at a point on each of its streets. */
const SIGHT_FROM = 80;
/** How far north of the start the arch's line runs. The arch stands 14.5 m in, so this is 120 m past it. */
const ARCH_REACH = 135;
/** The opening is 5.5 m wide and the eye sits about 20 m south of it: half its width over that. */
const ARCH_SPREAD = 0.134;

/** Six numbers a line: where it starts, where it ends, and half its width at each end. */
function sightLines(): number[] {
  const out: number[] = [];
  const at: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };
  for (let road = 0; road < ROADS.length; road++) {
    const len = roadLength(road);
    for (const site of SITES) {
      const cx = site.center.x, cz = site.center.z;
      if (!ROADS[road].points.some((p) => p.x === cx && p.z === cz)) continue;
      // Where this street passes the middle of the pad, then out along it both ways.
      let mid = 0, best = Infinity;
      for (let s = 0; s <= len; s += 1) {
        roadPoint(road, s, at);
        const d = Math.hypot(at.x - cx, at.z - cz);
        if (d < best) { best = d; mid = s; }
      }
      for (const dir of [-1, 1]) {
        for (let s = mid; s >= 0 && s <= len; s += dir) {
          roadPoint(road, s, at);
          if (Math.hypot(at.x - cx, at.z - cz) < SIGHT_FROM) continue;
          out.push(at.x, at.z, cx, cz, 0, 0);
          break;
        }
      }
    }
  }
  // Through the arch the middle of the view stays open to everything, and wider the further off.
  out.push(SPAWN.x, SPAWN.z, SPAWN.x, SPAWN.z - ARCH_REACH, 0, 5.5);
  return out;
}

const SIGHT = sightLines();
// Most of what shows in the arch's opening from the start, all but a strip down each side of it.
// Only buildings keep out of this much: trees and old stone to either side are what the arch is
// there to frame, and a wall just coming into the edge of the opening is the city saying hello.
const ARCH_SHARE = 0.8;
const ARCH_VIEW = [SPAWN.x, SPAWN.z, SPAWN.x, SPAWN.z - ARCH_REACH, ARCH_SPREAD * ARCH_SHARE * 6, ARCH_SPREAD * ARCH_SHARE * (ARCH_REACH + 6)];

function lineGap(l: number[], i: number, x: number, z: number): number {
  const ax = l[i], az = l[i + 1], dx = l[i + 2] - ax, dz = l[i + 3] - az;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t) - (l[i + 4] + (l[i + 5] - l[i + 4]) * t);
}

/** Metres from the nearest line of sight. */
export function sightGap(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < SIGHT.length; i += 6) {
    const d = lineGap(SIGHT, i, x, z);
    if (d < best) best = d;
  }
  return best;
}

/** Metres outside the view through the arch from where the walk starts. Negative inside it. */
export function archGap(x: number, z: number): number {
  return lineGap(ARCH_VIEW, 0, x, z);
}

/** A frame turned by `yaw` about y at (x, z): local +z is the front, local +x is to its right seen from behind. */
export class Frame {
  cs = 1; sn = 0;
  constructor(public x: number, public y: number, public z: number, public yaw: number) {
    this.cs = Math.cos(yaw); this.sn = Math.sin(yaw);
  }
  wx(lx: number, lz: number): number { return this.x + lx * this.cs + lz * this.sn; }
  wz(lx: number, lz: number): number { return this.z - lx * this.sn + lz * this.cs; }
  p(lx: number, ly: number, lz: number): [number, number, number] { return [this.wx(lx, lz), this.y + ly, this.wz(lx, lz)]; }
  r(extra = 0): [number, number, number] { return [0, this.yaw + extra, 0]; }
}

const BOX = geo.box(1, 1, 1);
const CARD = geo.plane(1, 1);

/** A box by its size, standing on local (lx, ly, lz). */
export function slab(b: Builder, f: Frame, lx: number, ly: number, lz: number, w: number, h: number, d: number, color: ColorLike, id?: number, extra: { flat?: number; hatch?: number; outline?: boolean; top?: ColorLike } = {}): void {
  b.add(BOX, {
    color, gradient: extra.top ? { bottom: color, top: extra.top } : undefined,
    pos: f.p(lx, ly, lz), rot: f.r(), scale: [w, h, d], id, flat: extra.flat, hatch: extra.hatch, outline: extra.outline,
  });
}

/** A flat card facing the front, centred on local (lx, ly, lz). `turn` swings it about y. */
export function card(b: Builder, f: Frame, lx: number, ly: number, lz: number, w: number, h: number, color: ColorLike, id?: number, flat = 0.5, turn = 0): void {
  b.add(CARD, { color, pos: f.p(lx, ly, lz), rot: f.r(turn), scale: [w, h, 1], id, flat });
}

const qa = new THREE.Quaternion();
const ea = new THREE.Euler();
const eb = new THREE.Euler();

/** Builder rotation for "tip it by rx and rz first, then turn it by yaw". */
export function turned(yaw: number, rx: number, rz: number): [number, number, number] {
  ea.set(rx, yaw, rz, 'YXZ');
  qa.setFromEuler(ea);
  eb.setFromQuaternion(qa, 'XYZ');
  return [eb.x, eb.y, eb.z];
}

// ---------------------------------------------------------------------------------------------
// Walk-ups. Brick and plaster, three to six storeys, a stoop, a cornice, big plain windows.
// ---------------------------------------------------------------------------------------------

export interface Lot {
  x: number; z: number;
  /** The front faces local +z turned by this. */
  yaw: number;
  w: number; d: number; storeys: number; seed: number;
  /** Open sides get a few windows and some ivy; party walls get nothing. */
  openLeft: boolean; openRight: boolean;
}

/** Things a building wants drawn that live in the instanced meshes. */
export interface Extras { columns: Item[]; bushes: Item[]; trees: Item[]; colliders: Collider[] }

const STOREY = 3.2;
// Wall, and the darker tone it grades to at the foot.
const WALLS: [string, string][] = [
  ['#c8684e', '#a34e45'],
  ['#b25a4b', '#8c4443'],
  ['#f0dcc2', '#d6bfc0'],
  ['#e6ab9b', '#c48890'],
  ['#d98a5f', '#b06a58'],
];
const DOORS = ['#3fa9a5', '#d8412f', '#f3c531', '#6f58c2', '#1f6c7a'];
const AWNINGS = ['#ef7a1e', '#3fa9a5', '#f3c531', '#d8412f', '#f0a0b6'];
const WINDOW = '#56528f';
const IRON = '#3d3766';
const GREENS = ['#7fb85a', '#5fa85c', '#3f8a57', '#8cc56c'];

const TANK = geo.cylinder(1, 1.08, 1, 8);
const TANK_ROOF = geo.cone(1, 1, 8);
const LEG = geo.cylinder(0.07, 0.07, 1, 4, true);
const PEDIMENT = geo.extrude([[-0.5, 0], [0.5, 0], [0, 1]], 1, { cacheKey: 'city-pediment' });

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lowest and highest ground under a footprint. */
export function groundRange(f: Frame, hw: number, hd: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const h = heightAt(f.wx(i * hw, j * hd), f.wz(i * hw, j * hd));
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return [lo, hi];
}

/** One building. `rich` adds the back windows, the fire escape and the roof clutter. */
export function walkUp(b: Builder, lot: Lot, rich: boolean, out: Extras): void {
  const next = rand(lot.seed);
  const { w, d, storeys } = lot;
  const hw = w / 2, hd = d / 2;
  const f = new Frame(lot.x, 0, lot.z, lot.yaw);
  const [lo, hi] = groundRange(f, hw, hd);
  const floor = hi + 0.55;
  f.y = floor;
  const tall = storeys * STOREY + 0.5;
  const [wall, wallFoot] = WALLS[Math.floor(next() * WALLS.length)];
  const body = b.newId();
  const trim = b.newId();
  const glass = b.newId();

  // Stone footing down into the ground, then the wall.
  slab(b, f, 0, lo - 1 - floor, 0, w + 0.24, floor - lo + 1, d + 0.24, palette.paveShade, trim, { top: palette.pave });
  slab(b, f, 0, 0, 0, w, tall, d, wallFoot, body, { top: wall, flat: 0.28 });
  // Cornice and the roof inside it.
  slab(b, f, 0, tall, 0, w + 0.7, 0.55, d + 0.7, palette.marbleShade, trim, { top: palette.marble });
  const garden = next() < 0.4;
  slab(b, f, 0, tall + 0.55, 0, w - 0.3, 0.3, d - 0.3, garden ? palette.grassDeep : '#b3a8c9', undefined, { flat: 0.3 });
  const roof = tall + 0.85;

  // Front: a door in one bay, windows in the rest.
  const bays = Math.max(2, Math.round(w / 2.9));
  const step = w / bays;
  const doorBay = Math.floor(next() * bays);
  const shop = next() < 0.16;
  const front = hd + 0.1;
  const bx = (i: number) => (i + 0.5 - bays / 2) * step;
  for (let k = 0; k < storeys; k++) {
    for (let i = 0; i < bays; i++) {
      if (k === 0 && (i === doorBay || shop)) continue;
      const lit = next();
      const tone = lit < 0.13 ? '#f6d98a' : lit < 0.27 ? palette.glass : WINDOW;
      card(b, f, bx(i), k * STOREY + 2.0, front, 1.35, 1.85, tone, glass, 0.6);
    }
  }
  const doorX = bx(doorBay);
  if (shop) {
    // A corner shop: one wide pane, the door beside it, an awning in one loud colour.
    const paneX = doorBay < bays / 2 ? hw - (w - step) / 2 : -hw + (w - step) / 2;
    card(b, f, paneX, 1.5, front, w - step - 0.9, 2.2, palette.glass, glass, 0.6);
    const awn = AWNINGS[Math.floor(next() * AWNINGS.length)];
    b.add(geo.box(1, 1, 1), { color: awn, pos: f.p(0, 2.95, hd + 0.75), rot: turned(lot.yaw, 0.42, 0), scale: [w - 0.4, 0.12, 1.7], flat: 0.35 });
    slab(b, f, 0, 3.3, hd, w - 0.2, 0.5, 0.2, palette.marble, trim);
  } else if (rich) {
    // A band of stone over the ground floor.
    slab(b, f, 0, STOREY + 0.55, hd - 0.05, w + 0.1, 0.24, 0.22, palette.marble, trim);
  }
  slab(b, f, doorX, 0, hd - 0.1, 2.0, 2.9, 0.3, palette.marble, trim);
  card(b, f, doorX, 1.2, hd + 0.22, 1.3, 2.4, DOORS[Math.floor(next() * DOORS.length)], glass, 0.5);

  // The stoop: steps down to whatever the ground is doing at the door.
  const gDoor = heightAt(f.wx(doorX, hd + 1.4), f.wz(doorX, hd + 1.4));
  const drop = floor - gDoor;
  slab(b, f, doorX, -drop - 0.6, hd + 0.55, 2.2, drop + 0.6, 1.1, palette.pave, trim, { top: palette.marble });
  slab(b, f, doorX, -drop - 0.6, hd + 1.5, 2.2, drop * 0.5 + 0.6, 0.9, palette.pave, trim, { top: palette.marble });
  out.colliders.push({ kind: 'box', x: f.wx(0, 0), z: f.wz(0, 0), hw: hw + 0.2, hd: hd + 0.2, rot: lot.yaw });
  out.colliders.push({ kind: 'box', x: f.wx(doorX, hd + 1), z: f.wz(doorX, hd + 1), hw: 1.15, hd: 1, rot: lot.yaw });

  // Back and open sides: plainer, but never blank. Rows of windows are what makes it a building.
  for (let k = 1; k < storeys; k++) for (let i = 0; i < bays; i++) {
    if (next() < (rich ? 0.12 : 0.4)) continue;
    card(b, f, bx(i), k * STOREY + 2.0, -front, 1.25, 1.75, next() < 0.1 ? '#f6d98a' : WINDOW, glass, 0.6, Math.PI);
  }
  for (const side of [-1, 1]) {
    if (side < 0 ? !lot.openLeft : !lot.openRight) continue;
    for (let k = rich ? 0 : 1; k < storeys; k++) {
      for (const along of [-0.27, 0.27]) {
        if (next() < (rich ? 0.18 : 0.5)) continue;
        card(b, f, side * (hw + 0.1), k * STOREY + 2.0, along * d, 1.25, 1.75, next() < 0.1 ? '#f6d98a' : WINDOW, glass, 0.6, side * Math.PI / 2);
      }
    }
    // Ivy up the blank wall, drawn with the hedge shape pressed flat against it.
    if (next() < 0.6) {
      const iz = (next() - 0.5) * d * 0.6;
      const ih = 2.5 + next() * Math.min(7, tall - 4);
      out.bushes.push({ x: f.wx(side * (hw + 0.05), iz), y: lo - 0.3, z: f.wz(side * (hw + 0.05), iz), yaw: lot.yaw, tiltX: 0, tiltZ: 0, sx: 0.45, sy: ih + (floor - lo), sz: 1.6 + next() * 1.6, color: GREENS[Math.floor(next() * 3)] });
    }
  }

  // Fire escape: a landing a floor, one rail, one ladder. Bold bars, nothing more.
  if (rich && storeys >= 4 && !shop && next() < 0.45) {
    const i0 = doorBay === 0 ? 1 : 0;
    const ex = bays > 2 ? (bx(i0) + bx(i0 + 1)) / 2 : bx(i0);
    const ew = bays > 2 ? step + 1.7 : 2.0;
    const iron = b.newId();
    for (let k = 1; k < storeys; k++) {
      const y = k * STOREY + 0.75;
      slab(b, f, ex, y, hd + 0.5, ew, 0.14, 1.0, IRON, iron, { flat: 0.5 });
      card(b, f, ex, y + 1.0, hd + 1.0, ew, 0.12, IRON, iron, 0.7);
      if (k > 1) b.add(geo.plane(1, 1), { color: IRON, pos: f.p(ex + (k & 1 ? 0.5 : -0.5) * (ew - 1), y - STOREY / 2, hd + 0.8), rot: turned(lot.yaw, 0, (k & 1 ? 1 : -1) * 0.5), scale: [0.16, STOREY * 1.12, 1], id: iron, flat: 0.7 });
    }
    for (const sx of [-1, 1]) card(b, f, ex + sx * ew / 2, (storeys - 1) * STOREY / 2 + STOREY * 0.75, hd + 1.0, 0.12, (storeys - 1) * STOREY + 1.1, IRON, iron, 0.7);
  }

  // Roof: a stair hut, maybe a water tower, maybe a garden.
  if (rich && next() < 0.7) slab(b, f, (next() - 0.5) * (w - 3), roof - 0.1, -hd + 1.8, 2.2, 2.4, 2.4, wallFoot, undefined, { top: wall });
  if (next() < (rich ? 0.38 : 0.2) && storeys >= 4) {
    const tx = (next() < 0.5 ? -1 : 1) * (hw - 2), tz = hd - 2.2 - next() * 2;
    const legs = b.newId();
    for (const [lx, lz] of [[-0.75, -0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, 0.75]]) {
      b.add(LEG, { color: IRON, pos: f.p(tx + lx, roof - 0.1, tz + lz), scale: [1, 1.9, 1], id: legs, flat: 0.5 });
    }
    const tank = b.newId();
    b.add(TANK, { color: '#b9825a', gradient: { bottom: '#a06a5a', top: '#dfa57f' }, pos: f.p(tx, roof + 1.7, tz), scale: [1.25, 2.3, 1.25], id: tank, hatch: 0.2 });
    b.add(TANK_ROOF, { color: palette.steel, pos: f.p(tx, roof + 4.0, tz), scale: [1.45, 1.0, 1.45] });
  }
  if (garden) {
    const n = 2 + Math.floor(next() * 3);
    for (let i = 0; i < n; i++) {
      const gx = (next() - 0.5) * (w - 2.4), gz = (next() - 0.5) * (d - 2.4);
      const s = 0.9 + next() * 0.7;
      out.bushes.push(item(f.wx(gx, gz), floor + roof - 0.1, f.wz(gx, gz), next() * 6.28, s, GREENS[Math.floor(next() * GREENS.length)]));
    }
    if (next() < 0.4) out.trees.push(item(f.wx(-hw + 1.8, -hd + 4.4), floor + roof - 0.1, f.wz(-hw + 1.8, -hd + 4.4), next() * 6.28, 0.5, GREENS[Math.floor(next() * 3)]));
  }

  // A few have a marble porch: two columns, a beam, a pediment.
  if (!shop && next() < 0.14) {
    const ph = STOREY * 2 - 0.4;
    for (const sx of [-1, 1]) out.columns.push(item(f.wx(doorX + sx * 1.9, hd + 1.9), floor - drop - 0.2, f.wz(doorX + sx * 1.9, hd + 1.9), lot.yaw, ph + drop + 0.2, palette.marble));
    slab(b, f, doorX, ph, hd + 1.15, 5.2, 0.6, 2.3, palette.marbleShade, trim, { top: palette.marble });
    b.add(PEDIMENT, { color: palette.marble, pos: f.p(doorX, ph + 0.6, hd + 1.15), rot: f.r(), scale: [5.6, 1.5, 2.3], id: trim });
  } else if (!shop && next() < 0.3) {
    // Or just a pediment over the cornice.
    b.add(PEDIMENT, { color: palette.marble, pos: f.p(0, tall + 0.55, hd - 0.1), rot: f.r(), scale: [Math.min(w, 5.5), 1.5, 0.5], id: trim });
  }

  // Planting at the foot of the front wall, either side of the stoop.
  for (const sx of [-1, 1]) {
    if (next() < 0.3) continue;
    const gx = doorX + sx * (2.4 + next() * 0.8);
    if (Math.abs(gx) > hw - 0.6) continue;
    const s = 0.75 + next() * 0.45;
    const wx = f.wx(gx, hd + 0.9), wz = f.wz(gx, hd + 0.9);
    out.bushes.push(item(wx, heightAt(wx, wz) - 0.1, wz, next() * 6.28, s, GREENS[Math.floor(next() * GREENS.length)]));
  }
}

// ---------------------------------------------------------------------------------------------
// The elevated line. One straight run of tall marble arches from a little station near the
// middle of the island, over the avenue, out past the rim and off into the haze.
// ---------------------------------------------------------------------------------------------

/** The line passes through here, heading along LINE_DIR. Measured so it clears every pad. */
export const LINE_AT = { x: 5, z: -8 };
export const LINE_YAW = (Math.PI * 2) / 3;
const LINE_DX = Math.cos(LINE_YAW), LINE_DZ = -Math.sin(LINE_YAW);
const PITCH = 16;
const PIER_LONG = 2.6, PIER_WIDE = 4.8;
const DECK = 36;
const SPRING = 27.5;
const FIRST = -24;
/** Bays on the island and past it. */
const BAYS = 30;

const ARCH_R = (PITCH - PIER_LONG) / 2;
function bayOutline(): [number, number][] {
  const o: [number, number][] = [[PITCH / 2, 0], [PITCH / 2, DECK - SPRING], [-PITCH / 2, DECK - SPRING], [-PITCH / 2, 0], [-ARCH_R, 0]];
  const n = 12;
  for (let i = 1; i < n; i++) {
    const a = Math.PI - (i / n) * Math.PI;
    o.push([Math.cos(a) * ARCH_R, Math.sin(a) * ARCH_R]);
  }
  o.push([ARCH_R, 0]);
  return o;
}
const BAY = geo.extrude(bayOutline(), 1, { cacheKey: 'city-aqueduct-bay', crease: 35 });
const SPIKE = geo.creased(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).rotateX(Math.PI).translate(0, -0.5, 0), 20);

export interface Aqueduct { train: THREE.Mesh; triangles: number; update(dt: number, t: number): void }

/** Where along the line the train is at time `t`: out to the haze and back, easing at both ends. */
const RUN_FROM = -11.5, RUN_PERIOD = 150, RUN_PHASE = 15.1;
function trainAt(t: number, runTo: number): number {
  return RUN_FROM + (runTo - RUN_FROM) * (0.5 - 0.5 * Math.cos(((t + RUN_PHASE) / RUN_PERIOD) * Math.PI * 2));
}

function buildTrain(kit: InkKit): THREE.Mesh {
  const b = kit.builder() as Builder;
  const f = new Frame(0, 0, 0, 0);
  const CAR = 9.2, GAP = 0.7, W = 2.7, H = 2.7;
  const band = palette.teal;
  for (let c = -1; c <= 1; c++) {
    const x = c * (CAR + GAP);
    const shell = b.newId();
    const panes = b.newId();
    slab(b, f, x, 0.15, 0, CAR - 0.8, 0.5, W - 0.5, IRON, undefined, { flat: 0.6 });
    slab(b, f, x, 0.6, 0, CAR, H, W, palette.marbleShade, shell, { top: palette.marble });
    slab(b, f, x, 0.6 + H, 0, CAR - 0.5, 0.28, W - 0.5, palette.steel, undefined);
    for (const side of [-1, 1]) {
      const z = side * (W / 2 + 0.06);
      const turn = side > 0 ? 0 : Math.PI;
      card(b, f, x, 0.6 + 1.9, z, CAR - 1.2, 0.95, WINDOW, panes, 0.6, turn);
      card(b, f, x, 0.6 + 0.75, z, CAR - 0.1, 0.36, band, panes, 0.5, turn);
      for (const dx of [-2.6, 2.6]) card(b, f, x + dx, 0.6 + 1.25, side * (W / 2 + 0.1), 1.1, 2.1, palette.yellow, undefined, 0.5, turn);
    }
    // A cab window at each outer end.
    if (c !== 0) card(b, f, x + c * (CAR / 2 + 0.06), 0.6 + 1.85, 0, W - 0.7, 1.0, '#f6d98a', undefined, 0.7, c * Math.PI / 2);
  }
  const mesh = b.build('train');
  mesh.rotation.y = LINE_YAW;
  return mesh;
}

/** Where the deck runs out and which way it was heading, for whatever is put out there to meet it. */
export function lineEnd(rich: boolean): { x: number; y: number; z: number; dx: number; dz: number } {
  const s = FIRST + (rich ? BAYS : BAYS - 8) * PITCH + PIER_LONG / 2;
  return { x: LINE_AT.x + LINE_DX * s, y: DECK, z: LINE_AT.z + LINE_DZ * s, dx: LINE_DX, dz: LINE_DZ };
}

export function aqueduct(kit: InkKit, b: Builder, out: Extras, claims: Claims, rich: boolean): Aqueduct {
  const f = new Frame(LINE_AT.x, 0, LINE_AT.z, LINE_YAW);
  const before = b.triangles();
  const stone = b.newId();
  const shade = '#cfc3dc';
  const bays = rich ? BAYS : BAYS - 8;
  let last = FIRST;
  for (let i = 0; i <= bays; i++) {
    const t = FIRST + i * PITCH;
    last = t;
    const x = f.wx(t, 0), z = f.wz(t, 0);
    const land = inBounds(x, z) && rimRadius(x, z) - Math.hypot(x, z) > 4;
    const end = i === 0;
    const long = end ? PIER_LONG + 2.8 : PIER_LONG;
    const off = end ? -1.4 : 0;
    if (land) {
      const g = Math.min(heightAt(x, z), heightAt(f.wx(t, 2.4), f.wz(t, 2.4)), heightAt(f.wx(t, -2.4), f.wz(t, -2.4)));
      const top = Math.max(heightAt(x, z), heightAt(f.wx(t, 2.4), f.wz(t, 2.4)), heightAt(f.wx(t, -2.4), f.wz(t, -2.4)));
      slab(b, f, t + off, g - 1.5, 0, long, SPRING - g + 1.5, PIER_WIDE, shade, stone, { top: palette.marble, hatch: 0.08 });
      slab(b, f, t + off, g - 1.5, 0, long + 0.8, top - g + 2.6, PIER_WIDE + 0.8, palette.marbleShade, undefined, { top: palette.pave });
      out.colliders.push({ kind: 'box', x: f.wx(t + off, 0), z: f.wz(t + off, 0), hw: long / 2 + 0.4, hd: PIER_WIDE / 2 + 0.4, rot: LINE_YAW });
      claims.box(f.wx(t + off, 0), f.wz(t + off, 0), long / 2 + 0.4, PIER_WIDE / 2 + 0.4, LINE_YAW, 1.5);
      // Ivy has found some of them.
      if (rich && (i * 7 + 3) % 5 < 2) {
        const side = i & 1 ? 1 : -1;
        out.bushes.push({ x: f.wx(t + off, side * (PIER_WIDE / 2 + 0.05)), y: g - 0.4, z: f.wz(t + off, side * (PIER_WIDE / 2 + 0.05)), yaw: LINE_YAW, tiltX: 0, tiltZ: 0, sx: 1.5, sy: 5 + (i % 4) * 2.2, sz: 0.5, color: GREENS[i % 3] });
      }
    } else {
      // Past the rim the piers hang in the air, shorter the further out, each ending in a point.
      const far = (i - 16) / (BAYS - 16);
      const hang = 15 - 10 * Math.min(1, Math.max(0, far));
      slab(b, f, t, SPRING - hang, 0, long, hang, PIER_WIDE, shade, stone, { top: palette.marble, hatch: 0.08 });
      b.add(SPIKE, { color: shade, pos: f.p(t, SPRING - hang, 0), rot: f.r(), scale: [long, hang * 0.55, PIER_WIDE], id: stone });
    }
    // The band the arches spring from.
    slab(b, f, t + off, SPRING - 0.7, 0, long + 0.5, 0.7, PIER_WIDE + 0.5, palette.marble, undefined);
    if (i < bays) b.add(BAY, { color: shade, gradient: { bottom: shade, top: palette.marble }, pos: f.p(t + PITCH / 2, SPRING, 0), rot: f.r(), scale: [1, 1, PIER_WIDE - 0.4], id: stone, hatch: 0.06 });
  }
  // The deck: one long course of stone, a low wall each side, the track bed between.
  const mid = (FIRST - 4.1 + last + PIER_LONG / 2) / 2, run = last + PIER_LONG / 2 - FIRST + 4.1;
  slab(b, f, mid, DECK - 0.5, 0, run + 0.6, 0.5, PIER_WIDE + 0.5, palette.marble, undefined);
  for (const side of [-1, 1]) slab(b, f, mid, DECK, side * (PIER_WIDE / 2 - 0.1), run, 0.7, 0.3, palette.marble, stone);
  slab(b, f, mid, DECK, 0, run, 0.14, 2.0, '#8a82b4', undefined, { flat: 0.5 });
  // One keystone with colour on it, over the avenue.
  slab(b, f, 0, SPRING + ARCH_R - 0.5, 0, 1.3, 1.7, PIER_WIDE - 0.1, palette.teal, undefined);

  // The station at the island end: a roof on four columns, a pediment facing down the line.
  const sy = DECK + 0.14;
  for (const [lx, lz] of [[-26.6, -2.05], [-26.6, 2.05], [-12.6, -2.05], [-12.6, 2.05]]) out.columns.push(item(f.wx(lx, lz), sy, f.wz(lx, lz), LINE_YAW, 4.4, palette.marble));
  slab(b, f, -19.6, sy + 4.4, 0, 16.4, 0.55, PIER_WIDE + 0.9, palette.marbleShade, undefined, { top: palette.marble });
  for (const lx of [-27.5, -11.7]) b.add(PEDIMENT, { color: palette.marble, pos: f.p(lx, sy + 4.95, 0), rot: f.r(Math.PI / 2), scale: [PIER_WIDE + 0.9, 1.5, 0.6] });
  slab(b, f, -19.6, sy + 4.95, 0, 15.2, 0.5, PIER_WIDE - 0.6, palette.verdigris, undefined, { flat: 0.2 });
  slab(b, f, -27.6, DECK, 0, 0.5, 1.6, PIER_WIDE - 0.4, palette.red, undefined);
  // Things have seeded themselves along the top.
  if (rich) for (let i = 0; i < 14; i++) {
    const t = 30 + i * 14.5 + (i % 3) * 3;
    const side = i & 1 ? 1 : -1;
    out.bushes.push(item(f.wx(t, side * 2.3), DECK + 0.3, f.wz(t, side * 2.3), i * 1.7, 0.75 + (i % 3) * 0.2, GREENS[i % 4]));
  }

  const train = buildTrain(kit);
  const runTo = last - 22;
  const place = (t: number) => {
    const s = trainAt(t, runTo);
    train.position.set(LINE_AT.x + LINE_DX * s, DECK + 0.14, LINE_AT.z + LINE_DZ * s);
  };
  place(0);
  const g = train.geometry;
  const trainTris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  return { train, triangles: b.triangles() - before + trainTris, update: (_dt, t) => place(t) };
}

// ---------------------------------------------------------------------------------------------
// Street furniture. A little of it, behind the sidewalk, where a person would put it.
// ---------------------------------------------------------------------------------------------

const POLE = geo.cylinder(0.06, 0.09, 1, 5, true);
const GLOBE = geo.ico(0.5, 0);
const PLUG = geo.cylinder(0.5, 0.56, 1, 6);
const PLUG_CAP = geo.cone(0.5, 1, 6);

/** A green lamp post with two glass globes on a crossbar. */
export function lampPost(b: Builder, x: number, z: number, yaw: number, out: Extras): void {
  const f = new Frame(x, heightAt(x, z), z, yaw);
  const id = b.newId();
  b.add(POLE, { color: palette.verdigris, pos: f.p(0, -0.2, 0), scale: [1.5, 4.5, 1.5], id });
  slab(b, f, 0, 4.1, 0, 1.5, 0.1, 0.1, palette.verdigris, id);
  slab(b, f, 0, -0.1, 0, 0.42, 0.5, 0.42, palette.verdigris, id);
  for (const sx of [-1, 1]) b.add(GLOBE, { color: '#fbe9a6', pos: f.p(sx * 0.72, 4.5, 0), scale: 0.62, flat: 0.8 });
  out.colliders.push({ kind: 'circle', x, z, r: 0.28 });
}

/** A park bench facing local +z. */
export function bench(b: Builder, x: number, z: number, yaw: number, out: Extras): void {
  const f = new Frame(x, heightAt(x, z), z, yaw);
  const id = b.newId();
  slab(b, f, 0, 0.42, 0.05, 1.9, 0.09, 0.5, '#d99a6a', id);
  slab(b, f, 0, 0.62, -0.22, 1.9, 0.42, 0.08, '#d99a6a', id);
  for (const sx of [-1, 1]) slab(b, f, sx * 0.8, -0.2, 0.03, 0.09, 0.64, 0.34, palette.verdigris, id, { flat: 0.4 });
  out.colliders.push({ kind: 'box', x, z, hw: 0.95, hd: 0.3, rot: yaw });
}

/** A fire hydrant. Red, squat, a cap on top and one on the side. */
export function hydrant(b: Builder, x: number, z: number, yaw: number, out: Extras): void {
  const f = new Frame(x, heightAt(x, z), z, yaw);
  const id = b.newId();
  b.add(PLUG, { color: palette.red, pos: f.p(0, -0.1, 0), scale: [0.44, 0.75, 0.44], id });
  b.add(PLUG_CAP, { color: palette.red, pos: f.p(0, 0.65, 0), scale: [0.5, 0.26, 0.5], id });
  slab(b, f, 0, 0.3, 0.2, 0.2, 0.2, 0.22, palette.yellow, undefined);
  out.colliders.push({ kind: 'circle', x, z, r: 0.3 });
}

/** A marble planter box. The planting goes into the hedge instances. */
export function planter(b: Builder, x: number, z: number, yaw: number, long: number, out: Extras, tone: number): void {
  const f = new Frame(x, 0, z, yaw);
  const [lo, hi] = groundRange(f, long / 2, 0.6);
  slab(b, f, 0, lo - 0.4, 0, long, hi - lo + 1.0, 1.2, palette.marbleShade, undefined, { top: palette.marble });
  const n = Math.max(1, Math.round(long / 1.5));
  for (let i = 0; i < n; i++) {
    const lx = ((i + 0.5) / n - 0.5) * (long - 0.5);
    out.bushes.push(item(f.wx(lx, 0), hi + 0.45, f.wz(lx, 0), i * 2.1 + tone, 0.72 + ((i * 7 + tone) % 3) * 0.12, GREENS[(i + tone) % GREENS.length]));
  }
  out.colliders.push({ kind: 'box', x, z, hw: long / 2, hd: 0.6, rot: yaw });
}
