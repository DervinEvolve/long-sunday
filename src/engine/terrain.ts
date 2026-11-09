import * as THREE from 'three';
import type { DistrictId, DistrictSite, InkKit, QualityTier } from '../types';
import { PAD_BLEND, PAD_FLAT, ROADS, SITES, SITE_BY_ID, WORLD_RADIUS, YEAR_STONES } from '../world/layout';
import { palette } from '../world/palette';
import * as geo from './geo';
import { toHex } from './kit';
import { gfbm, gnoise2, hash2, noise2, rng, smootherstep, smoothstep } from './util';

// The ground. One function, heightAt, is the truth: the mesh, the walker, the scatter and every
// district read the same number. Roads are graded into it so every road can be walked.

/** Thread colours inlaid in the roads. Coral for people work, teal for technology, yellow for life. */
export const THREAD_COLORS = { people: '#ee6352', tech: palette.teal, life: palette.yellow, both: palette.violet } as const;

/** A road's thread line runs onto each plaza and stops in a pale dot this far (as a share of the pad radius)
 *  from the district centre. The street paving itself stops at the plaza kerb, radius * PLAZA. */
export const ROAD_END = 0.6;
/** roadInfo sees a road from this far away. Past it the distance comes back as Infinity. */
export const ROAD_REACH = 30;

const STEP = 1;          // metres between road samples
const SHOULDER = 11;     // metres from the road edge to untouched ground
const EASE = 5;          // metres a ramp takes to reach its full grade
const MAX_GRADE = 0.31;   // steepest a road may climb, rise over run (about 17 degrees)
const CELL = 16;
const GRID_HALF = 272;
const GRID_N = (GRID_HALF * 2) / CELL;

// ---------------------------------------------------------------------------------------------
// Road paths
// ---------------------------------------------------------------------------------------------

interface RoadPath {
  index: number;
  width: number;
  kind: 'spine' | 'branch';
  n: number;
  x: Float32Array;
  z: Float32Array;
  h: Float32Array;
  length: number;
  /** Districts on this road, in order, with the arc length where the road passes each centre. */
  stops: { site: DistrictSite; s: number }[];
}

function siteAt(x: number, z: number): DistrictSite | null {
  for (const s of SITES) if (s.center.x === x && s.center.z === z) return s;
  return null;
}

function ramp(d: number, len: number): number {
  // Ease in, hold a steady grade, ease out. Returns 0..1.
  if (d <= 0) return 0;
  if (d >= len) return 1;
  const e = Math.min(EASE, len / 3);
  const v = 1 / (len - e);
  if (d < e) return (v * d * d) / (2 * e);
  if (d > len - e) return 1 - (v * (len - d) * (len - d)) / (2 * e);
  return v * (d - e / 2);
}

const SWING_SMOOTH = 160;

function buildPath(index: number): RoadPath {
  const spec = ROADS[index];
  const pts = spec.points;
  // Straight runs out of every district (so a road leaves a pad the way gates() says it does),
  // with the bends between districts rounded off.
  const dx: number[] = [];
  const dz: number[] = [];
  const marks: { site: DistrictSite; at: number }[] = [];
  const push = (x: number, z: number) => { dx.push(x); dz.push(z); };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const site = siteAt(p.x, p.z);
    if (site || i === 0 || i === pts.length - 1) {
      if (site) marks.push({ site, at: dx.length });
      push(p.x, p.z);
      continue;
    }
    const a = pts[i - 1];
    const b = pts[i + 1];
    const la = Math.hypot(a.x - p.x, a.z - p.z);
    const lb = Math.hypot(b.x - p.x, b.z - p.z);
    const cut = Math.min(30, la * 0.55, lb * 0.55);
    const ax = p.x + ((a.x - p.x) / la) * cut, az = p.z + ((a.z - p.z) / la) * cut;
    const bx = p.x + ((b.x - p.x) / lb) * cut, bz = p.z + ((b.z - p.z) / lb) * cut;
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const u = 1 - t;
      push(u * u * ax + 2 * u * t * p.x + t * t * bx, u * u * az + 2 * u * t * p.z + t * t * bz);
    }
  }
  // A climb that would come out too steep gets a longer way up: the stretch between the two pads
  // swings out and back in an S, wide enough to bring the grade down to MAX_GRADE.
  {
    const FINE = 0.5;
    const a0 = [0];
    for (let i = 1; i < dx.length; i++) a0.push(a0[i - 1] + Math.hypot(dx[i] - dx[i - 1], dz[i] - dz[i - 1]));
    const total = a0[a0.length - 1];
    const m = Math.ceil(total / FINE) + 1;
    const fx: number[] = [];
    const fz: number[] = [];
    for (let i = 0, j = 0; i < m; i++) {
      const s = Math.min(total, i * FINE);
      while (j < a0.length - 2 && a0[j + 1] < s) j++;
      const t = a0[j + 1] > a0[j] ? (s - a0[j]) / (a0[j + 1] - a0[j]) : 0;
      fx.push(dx[j] + (dx[j + 1] - dx[j]) * t);
      fz.push(dz[j] + (dz[j + 1] - dz[j]) * t);
    }
    const at = marks.map((mk) => Math.min(m - 1, Math.round(a0[mk.at] / FINE)));
    const ox = fx.slice();
    const oz = fz.slice();
    for (let k = 0; k < marks.length - 1; k++) {
      const A = marks[k].site, B = marks[k + 1].site;
      const rise = Math.abs(B.height - A.height);
      let i0 = at[k], i1 = at[k + 1];
      while (i0 < i1 && Math.hypot(ox[i0] - A.center.x, oz[i0] - A.center.z) < A.radius * PAD_FLAT) i0++;
      while (i1 > i0 && Math.hypot(ox[i1] - B.center.x, oz[i1] - B.center.z) < B.radius * PAD_FLAT) i1--;
      const span = i1 - i0;
      if (span < 8) continue;
      const side = (index + k) & 1 ? -1 : 1;
      const s0 = Math.max(at[k] + 1, i0 - 12), s1 = Math.min(at[k + 1] - 1, i1 + 12);
      for (let amp = 0; amp <= 24; amp += 0.5) {
        let len = 0;
        for (let i = s0; i < i0; i++) { fx[i] = ox[i]; fz[i] = oz[i]; }
        for (let i = i1 + 1; i <= s1; i++) { fx[i] = ox[i]; fz[i] = oz[i]; }
        for (let i = i0; i <= i1; i++) {
          const u = (i - i0) / span;
          const off = side * amp * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u);
          const tx = ox[Math.min(m - 1, i + 1)] - ox[Math.max(0, i - 1)];
          const tz = oz[Math.min(m - 1, i + 1)] - oz[Math.max(0, i - 1)];
          const tl = Math.hypot(tx, tz) || 1;
          fx[i] = ox[i] - (tz / tl) * off;
          fz[i] = oz[i] + (tx / tl) * off;
        }
        if (amp > 0) {
          // Round the swing off, or its turns come out tighter than the street is wide and the
          // inside kerb folds over itself.
          for (let pass = 0; pass < SWING_SMOOTH; pass++) {
            let px = fx[s0], pz = fz[s0];
            for (let i = s0 + 1; i < s1; i++) {
              const cx = fx[i], cz = fz[i];
              fx[i] = 0.25 * px + 0.5 * cx + 0.25 * fx[i + 1];
              fz[i] = 0.25 * pz + 0.5 * cz + 0.25 * fz[i + 1];
              px = cx; pz = cz;
            }
          }
        }
        for (let i = i0 + 1; i <= i1; i++) len += Math.hypot(fx[i] - fx[i - 1], fz[i] - fz[i - 1]);
        if (rise / (len - Math.min(EASE, len / 3)) <= MAX_GRADE) break;
      }
    }
    dx.length = 0;
    dz.length = 0;
    for (let i = 0; i < m; i++) push(fx[i], fz[i]);
    for (let k = 0; k < marks.length; k++) marks[k].at = at[k];
  }
  // Arc length of the dense line, then even samples along it.
  const acc = [0];
  for (let i = 1; i < dx.length; i++) acc.push(acc[i - 1] + Math.hypot(dx[i] - dx[i - 1], dz[i] - dz[i - 1]));
  const length = acc[acc.length - 1];
  const n = Math.ceil(length / STEP) + 1;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const h = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(length, i * STEP);
    while (j < acc.length - 2 && acc[j + 1] < s) j++;
    const t = acc[j + 1] > acc[j] ? (s - acc[j]) / (acc[j + 1] - acc[j]) : 0;
    x[i] = dx[j] + (dx[j + 1] - dx[j]) * t;
    z[i] = dz[j] + (dz[j + 1] - dz[j]) * t;
  }
  const stops = marks.map((m) => ({ site: m.site, s: acc[m.at] }));

  // Height along the road: level across each pad, one steady ramp between the flat edges.
  const edge = (from: number, to: number, site: DistrictSite): number => {
    // Arc length where the road crosses the edge of the site's flat ground, walking from `from` toward `to`.
    const r = site.radius * PAD_FLAT;
    const dir = to > from ? 1 : -1;
    for (let s = from; dir > 0 ? s < to : s > to; s += dir * 0.25) {
      const f = s / STEP;
      const i0 = Math.min(n - 2, Math.floor(f));
      const t = f - i0;
      const px = x[i0] + (x[i0 + 1] - x[i0]) * t;
      const pz = z[i0] + (z[i0 + 1] - z[i0]) * t;
      if (Math.hypot(px - site.center.x, pz - site.center.z) >= r) return s;
    }
    return to;
  };
  for (let k = 0; k < stops.length - 1; k++) {
    const A = stops[k];
    const B = stops[k + 1];
    const out = edge(A.s, B.s, A.site);
    const inn = edge(B.s, A.s, B.site);
    const i0 = Math.round(A.s / STEP);
    const i1 = Math.min(n - 1, Math.round(B.s / STEP));
    for (let i = i0; i <= i1; i++) {
      const s = Math.min(length, i * STEP);
      h[i] = A.site.height + (B.site.height - A.site.height) * ramp(s - out, inn - out);
    }
  }
  return { index, width: spec.width, kind: spec.kind, n, x, z, h, length, stops };
}

const PATHS: RoadPath[] = ROADS.map((_, i) => buildPath(i));

// Every road segment, filed in a coarse grid so a lookup only meets the few that are near.
const segRoad: number[] = [];
const segIdx: number[] = [];
const cells: number[][] = [];
for (let i = 0; i < GRID_N * GRID_N; i++) cells.push([]);
for (const p of PATHS) {
  for (let i = 0; i < p.n - 1; i++) {
    const id = segRoad.length;
    segRoad.push(p.index);
    segIdx.push(i);
    const c0 = Math.max(0, Math.floor((Math.min(p.x[i], p.x[i + 1]) - ROAD_REACH + GRID_HALF) / CELL));
    const c1 = Math.min(GRID_N - 1, Math.floor((Math.max(p.x[i], p.x[i + 1]) + ROAD_REACH + GRID_HALF) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(p.z[i], p.z[i + 1]) - ROAD_REACH + GRID_HALF) / CELL));
    const r1 = Math.min(GRID_N - 1, Math.floor((Math.max(p.z[i], p.z[i + 1]) + ROAD_REACH + GRID_HALF) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * GRID_N + c].push(id);
  }
}
const cellStart = new Int32Array(GRID_N * GRID_N + 1);
for (let i = 0; i < cells.length; i++) cellStart[i + 1] = cellStart[i] + cells[i].length;
const cellItems = new Int32Array(cellStart[cells.length]);
for (let i = 0; i < cells.length; i++) cellItems.set(cells[i], cellStart[i]);
const SEG_ROAD = Uint8Array.from(segRoad);
const SEG_IDX = Uint16Array.from(segIdx);
cells.length = 0;

const NR = PATHS.length;
const bestD2 = new Float64Array(NR);
const bestH = new Float64Array(NR);
const bestS = new Float64Array(NR);

/** Fills bestD2 / bestH / bestS per road for a point. Returns false when no road is in reach. */
function scanRoads(x: number, z: number): boolean {
  const c = Math.floor((x + GRID_HALF) / CELL);
  const r = Math.floor((z + GRID_HALF) / CELL);
  if (c < 0 || r < 0 || c >= GRID_N || r >= GRID_N) return false;
  const cell = r * GRID_N + c;
  const a = cellStart[cell];
  const b = cellStart[cell + 1];
  if (a === b) return false;
  for (let i = 0; i < NR; i++) bestD2[i] = Infinity;
  for (let k = a; k < b; k++) {
    const id = cellItems[k];
    const road = SEG_ROAD[id];
    const i = SEG_IDX[id];
    const p = PATHS[road];
    const x0 = p.x[i], z0 = p.z[i];
    const ex = p.x[i + 1] - x0, ez = p.z[i + 1] - z0;
    let t = ((x - x0) * ex + (z - z0) * ez) / (ex * ex + ez * ez);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = x0 + ex * t - x, qz = z0 + ez * t - z;
    const d2 = qx * qx + qz * qz;
    if (d2 < bestD2[road]) {
      bestD2[road] = d2;
      bestH[road] = p.h[i] + (p.h[i + 1] - p.h[i]) * t;
      bestS[road] = (i + t) * STEP;
    }
  }
  return true;
}

export interface RoadHit {
  /** Index into ROADS, or -1 when no road is within ROAD_REACH. */
  road: number;
  /** Metres to the centre line. Infinity when no road is near. */
  dist: number;
  /** Metres along that road from its first control point. */
  s: number;
  /** Height of the road surface there. */
  height: number;
  /** Full width of that road. */
  width: number;
}

const hitScratch: RoadHit = { road: -1, dist: Infinity, s: 0, height: 0, width: 0 };

/** The nearest road to a point. Pass your own `out` to keep the answer; without one a shared object is reused. */
export function roadInfo(x: number, z: number, out: RoadHit = hitScratch): RoadHit {
  out.road = -1;
  out.dist = Infinity;
  out.s = 0;
  out.height = 0;
  out.width = 0;
  if (!scanRoads(x, z)) return out;
  let best = Infinity;
  for (let i = 0; i < NR; i++) {
    if (bestD2[i] < best) {
      best = bestD2[i];
      out.road = i;
    }
  }
  if (out.road < 0 || best > ROAD_REACH * ROAD_REACH) {
    out.road = -1;
    return out;
  }
  out.dist = Math.sqrt(best);
  out.s = bestS[out.road];
  out.height = bestH[out.road];
  out.width = PATHS[out.road].width;
  return out;
}

export interface RoadPoint { x: number; z: number; h: number; tx: number; tz: number }

/** Length of a road in metres. */
export function roadLength(road: number): number {
  return PATHS[road].length;
}

/** A point on a road's centre line at arc length s, with the unit direction of travel. */
export function roadPoint(road: number, s: number, out: RoadPoint): RoadPoint {
  const p = PATHS[road];
  const f = Math.min(p.n - 1.0001, Math.max(0, s / STEP));
  const i = Math.floor(f);
  const t = f - i;
  out.x = p.x[i] + (p.x[i + 1] - p.x[i]) * t;
  out.z = p.z[i] + (p.z[i + 1] - p.z[i]) * t;
  out.h = p.h[i] + (p.h[i + 1] - p.h[i]) * t;
  const ex = p.x[i + 1] - p.x[i], ez = p.z[i + 1] - p.z[i];
  const l = Math.hypot(ex, ez) || 1;
  out.tx = ex / l;
  out.tz = ez / l;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------------------------

const NS = SITES.length;
const SX = Float64Array.from(SITES.map((s) => s.center.x));
const SZ = Float64Array.from(SITES.map((s) => s.center.z));
const SH = Float64Array.from(SITES.map((s) => s.height));
const SFLAT = Float64Array.from(SITES.map((s) => s.radius * PAD_FLAT));
const SBLEND = Float64Array.from(SITES.map((s) => s.radius * PAD_BLEND));
const BONE = SITES.findIndex((s) => s.id === 'boneyard');

/** Where the island ends, by compass angle. Never closer in than WORLD_RADIUS - 4. */
export function rimRadius(x: number, z: number): number {
  const a = Math.atan2(z, x);
  return WORLD_RADIUS + 4 + 4 * Math.sin(3 * a + 1.3) + 2.5 * Math.sin(7 * a + 0.4) + 1.5 * Math.sin(12 * a + 2.1);
}

/** True where a visitor may stand: on the island, a few steps back from the edge. */
export function inBounds(x: number, z: number): boolean {
  const r2 = x * x + z * z;
  if (r2 < (WORLD_RADIUS - 8) * (WORLD_RADIUS - 8)) return true;
  return Math.sqrt(r2) < rimRadius(x, z) - 3;
}

// How far the last point asked of heightAt stands above or below the broad swell. The ground colour reads it.
let relief = 0;

/** Ground height in metres at a world position. */
export function heightAt(x: number, z: number): number {
  // Pads first: inside the flat part the answer is exact.
  let padW = 0;
  let padH = 0;
  let fade = 1;
  let wsum = 0;
  let hsum = 0;
  for (let i = 0; i < NS; i++) {
    const ddx = x - SX[i], ddz = z - SZ[i];
    const d2 = ddx * ddx + ddz * ddz;
    const f = SFLAT[i];
    if (d2 <= f * f) { relief = 0; return SH[i]; }
    const q = 1 / (d2 + 2500);
    const w = q * q;
    wsum += w;
    hsum += w * SH[i];
    const bl = SBLEND[i];
    if (d2 < bl * bl) {
      const d = Math.sqrt(d2);
      const w2 = 1 - smootherstep(f, bl, d);
      if (w2 > padW) { padW = w2; padH = SH[i]; }
      fade *= smoothstep(f, f + 3, d);
    }
  }

  // Roads in reach, blended so that standing on one road its height wins outright.
  let roadW = 0;
  let roadH = 0;
  let near = ROAD_REACH;
  if (scanRoads(x, z)) {
    let qs = 0;
    for (let i = 0; i < NR; i++) {
      const d2 = bestD2[i];
      if (d2 >= ROAD_REACH * ROAD_REACH) continue;
      const d = Math.sqrt(d2);
      if (d < near) near = d;
      const hw = PATHS[i].width * 0.5 + 0.4;
      const w = 1 - smoothstep(hw, hw + SHOULDER, d);
      if (w <= 0) continue;
      const q = w / (1.0001 - w);
      qs += q;
      roadH += q * bestH[i];
      if (w > roadW) roadW = w;
    }
    if (qs > 0) roadH /= qs;
  }

  // Open ground: a broad swell that carries the district heights, park hills on top, calmer beside a road.
  const calm = 0.22 + 0.78 * smoothstep(5, ROAD_REACH, near);
  const swell = hsum / wsum;
  let h = swell;
  h += gfbm(x * 0.0088 + 3.1, z * 0.0088 - 1.7, 2, 11) * 4.4 * calm;
  const knoll = gnoise2(x * 0.0062 - 4.2, z * 0.0062 + 9.3, 23);
  h += smoothstep(0.05, 0.6, knoll) * 2.6 * calm;
  if (BONE >= 0) {
    // A raised lip around the Boneyard so it sits in a bowl.
    const d = Math.hypot(x - SX[BONE], z - SZ[BONE]) - SBLEND[BONE] * 1.12;
    h += 3.4 * Math.exp(-(d * d) / 150);
  }

  if (padW > 0) h += (padH - h) * padW;
  if (roadW > 0) h += (roadH - h) * roadW * fade;
  relief = h - swell;

  // Past the rim the ground drops away.
  const r2 = x * x + z * z;
  if (r2 > (WORLD_RADIUS - 6) * (WORLD_RADIUS - 6)) {
    const over = Math.sqrt(r2) - rimRadius(x, z);
    if (over > 0) h -= Math.min(180, over * 6);
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// Mesh plumbing
// ---------------------------------------------------------------------------------------------

type RGB = [number, number, number];

function rgb(c: string | number): RGB {
  const v = toHex(c);
  return [v >> 16, (v >> 8) & 255, v & 255];
}

function mix3(out: RGB, a: RGB, b: RGB, t: number): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

let idSeed = 0;
/** An outline id byte that no kit builder part is likely to share with its neighbours. */
function idByte(kit: InkKit): number {
  const b = kit.builder();
  const id = b.newId() + idSeed++;
  return (id % 251) + 1;
}

/** Hand-fed geometry in the kit's vertex layout, for shapes the builder's one-colour parts cannot do. */
class Raw {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  dat: number[] = [];
  idx: number[] = [];

  get count(): number {
    return this.pos.length / 3;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: RGB, id: number, flat = 0, hatch = 0): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(c[0], c[1], c[2], flat * 255);
    this.dat.push(id, hatch * 255, 255, 0);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** One flat-shaded triangle with its own three vertices. */
  face(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: RGB, id: number, flat = 0, hatch = 0): void {
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const i = this.vert(ax, ay, az, nx, ny, nz, c, id, flat, hatch);
    this.vert(bx, by, bz, nx, ny, nz, c, id, flat, hatch);
    this.vert(cx, cy, cz, nx, ny, nz, c, id, flat, hatch);
    this.idx.push(i, i + 1, i + 2);
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  mesh(kit: InkKit, name: string): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    const n = this.count;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(this.col), 4, true));
    g.setAttribute('aData', new THREE.BufferAttribute(new Uint8Array(this.dat), 4, true));
    g.setAttribute('aInk', new THREE.BufferAttribute(new Uint8Array(n * 4), 4, true));
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, kit.material);
    m.name = name;
    m.matrixAutoUpdate = false;
    return m;
  }
}

// ---------------------------------------------------------------------------------------------
// Ground colour
// ---------------------------------------------------------------------------------------------

/** Plazas are paved out to this share of the pad radius. Just inside the flat part, so the paving lies dead level. */
export const PLAZA = PAD_FLAT * 0.97;
/** Width of the sidewalk outside each edge of a road, by road kind. The drawn street is road width plus two of these. */
export const SIDEWALK = { spine: 1.25, branch: 0.9 } as const;

const C_MOSS = rgb(palette.moss);
const C_GDEEP = mix3([0, 0, 0], rgb(palette.grass), rgb(palette.grassDeep), 0.72);
const C_GRASS = rgb(palette.grass);
const C_GLIGHT = rgb(palette.grassLight);
const C_EARTH = rgb('#d8b38a');
// Four flat greens, hollow to crown. A point's tone picks one; where two tones meet is a drawn edge.
const C_TONES: RGB[] = [C_MOSS, C_GDEEP, C_GRASS, C_GLIGHT];
const hit: RoadHit = { road: -1, dist: Infinity, s: 0, height: 0, width: 0 };

/** Which green a point wears, 0..4: hollows and steep banks low, sunny crowns high.
 *  Pads pull toward plain grass so no line cuts in under a plaza. */
function toneValue(x: number, z: number, slope: number, lift: number): number {
  let v = 2.5 + lift * 0.3 - smoothstep(0.1, 0.5, slope) * 1.9 + gfbm(x * 0.017 + 7.7, z * 0.017 + 2.2, 2, 5) * 0.55;
  for (let i = 0; i < NS; i++) {
    const d = Math.hypot(x - SX[i], z - SZ[i]);
    if (d < SBLEND[i]) v += (2.5 - v) * (1 - smoothstep(SFLAT[i] * 1.04, SBLEND[i], d));
  }
  return v < 0.02 ? 0.02 : v > 3.98 ? 3.98 : v;
}

// What lies over the tone colour at a point, as `colour = tone * keep + add`.
const tint = { keep: 1, r: 0, g: 0, b: 0 };
function lay(c: RGB, t: number): void {
  if (t <= 0) return;
  const u = 1 - t;
  tint.keep *= u;
  tint.r = tint.r * u + c[0] * t;
  tint.g = tint.g * u + c[1] * t;
  tint.b = tint.b * u + c[2] * t;
}

function groundTint(x: number, z: number, slope: number): void {
  tint.keep = 1;
  tint.r = tint.g = tint.b = 0;
  // Big soft blotches where the lawn has dried a little.
  const blotch = noise2(x * 0.03 + 31, z * 0.03 - 12, 9);
  lay(C_GLIGHT, smoothstep(0.62, 0.82, blotch) * 0.22);
  // The steepest banks show earth through the grass.
  lay(C_EARTH, smoothstep(0.62, 1.1, slope) * 0.6);
  // The last couple of metres before the drop are bare.
  const r = Math.hypot(x, z);
  if (r > WORLD_RADIUS - 20) lay(C_EARTH, smoothstep(4.5, 0.8, rimRadius(x, z) - r) * 0.85);
}

const TIER_STEP: Record<QualityTier, number> = { high: 3.35, medium: 4.0, low: 5.2 };
const EXTENT = 252;
const CHUNKS = 3;
/** The ground mesh keeps this far under any paving, so grass never pokes up through a slab. */
const UNDER = 0.13;
/** Grass ignores this much of the light, so a bank in shade stays a flat tone and is not scribbled over with hatching. */
const GRASS_FLAT = 0.52;

// The ground grid of the mesh being built, kept so drawn-on shapes can lie exactly on the triangles.
let gridN = 0;
let gridSize = 1;
let gridY = new Float32Array(0);

/** Height of the ground mesh (not the true ground) at a point: the same triangles the mesh draws. */
function meshY(x: number, z: number): number {
  const fi = (x + EXTENT) / gridSize, fj = (z + EXTENT) / gridSize;
  const i = Math.max(0, Math.min(gridN - 1, Math.floor(fi)));
  const j = Math.max(0, Math.min(gridN - 1, Math.floor(fj)));
  const u = fi - i, v = fj - j;
  const w = gridN + 1;
  const a = gridY[j * w + i], b = gridY[j * w + i + 1], c = gridY[(j + 1) * w + i], d = gridY[(j + 1) * w + i + 1];
  if ((i + j) & 1) return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
  return v >= u ? a + u * (d - c) + v * (c - a) : a + u * (b - a) + v * (d - b);
}

/** Mesh height at a grid corner: the true ground, held down under roads and plazas. */
function cornerY(x: number, z: number, size: number): number {
  const h = heightAt(x, z);
  let y = h;
  roadInfo(x, z, hit);
  if (hit.road >= 0 && ribbonHere(hit.road, hit.s)) {
    const half = hit.width * 0.5 + SIDEWALK[PATHS[hit.road].kind];
    const t = 1 - smoothstep(half + size, half + size + 1.5, hit.dist);
    if (t > 0) y += (Math.min(h, hit.height - UNDER) - h) * t;
  }
  for (let i = 0; i < NS; i++) {
    const reach = SITES[i].radius * PLAZA + size;
    const d2 = (x - SX[i]) * (x - SX[i]) + (z - SZ[i]) * (z - SZ[i]);
    if (d2 > (reach + 1.5) * (reach + 1.5)) continue;
    const t = 1 - smoothstep(reach, reach + 1.5, Math.sqrt(d2));
    const low = Math.min(h, SH[i] - UNDER);
    if (low < y) y += (low - y) * t;
  }
  return y;
}

/** How high the ground may come at a spot with paving over it. Infinity on open grass. */
function pavingCeiling(x: number, z: number): number {
  let top = Infinity;
  roadInfo(x, z, hit);
  if (hit.road >= 0 && ribbonHere(hit.road, hit.s) && hit.dist < hit.width * 0.5 + SIDEWALK[PATHS[hit.road].kind]) top = hit.height - 0.03;
  for (let i = 0; i < NS; i++) {
    const r = SITES[i].radius * PLAZA;
    const dx = x - SX[i], dz = z - SZ[i];
    if (dx * dx + dz * dz < r * r) top = Math.min(top, SH[i] - 0.03);
  }
  return top;
}

/** What the last ground build had to push down to keep grass from coming up through paving. */
export const groundSettle = { spots: 0, deepest: 0 };

// A grid this coarse cannot follow a steep street round a tight bend: the odd triangle comes up
// through the sidewalk. Look for those spots and push the corner that causes each one down.
function settleUnderPaving(): void {
  const n = gridN, w = n + 1, size = gridSize;
  const K = 4;
  const lid = new Float32Array(w * w);
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      lid[k] = pavingCeiling(-EXTENT + i * size, -EXTENT + j * size);
      if (gridY[k] > lid[k]) gridY[k] = lid[k];
    }
  }
  const cells: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * w + i;
      if (lid[k] < Infinity || lid[k + 1] < Infinity || lid[k + w] < Infinity || lid[k + w + 1] < Infinity) cells.push(j * n + i);
    }
  }
  const tops = new Float32Array(cells.length * K * K);
  for (let c = 0; c < cells.length; c++) {
    const i = cells[c] % n, j = (cells[c] - i) / n;
    for (let q = 0; q < K * K; q++) {
      const u = ((q % K) + 0.5) / K, v = (Math.floor(q / K) + 0.5) / K;
      tops[c * K * K + q] = pavingCeiling(-EXTENT + (i + u) * size, -EXTENT + (j + v) * size);
    }
  }
  groundSettle.spots = 0;
  groundSettle.deepest = 0;
  const at = [0, 0, 0], wt = [0, 0, 0];
  for (let pass = 0; pass < 5; pass++) {
    let moved = 0;
    for (let c = 0; c < cells.length; c++) {
      const i = cells[c] % n, j = (cells[c] - i) / n;
      const a = j * w + i, b = a + 1, cc = a + w, d = cc + 1;
      for (let q = 0; q < K * K; q++) {
        const top = tops[c * K * K + q];
        if (top === Infinity) continue;
        const u = ((q % K) + 0.5) / K, v = (Math.floor(q / K) + 0.5) / K;
        // The same split meshY uses.
        if ((i + j) & 1) {
          if (u + v <= 1) { at[0] = a; at[1] = b; at[2] = cc; wt[0] = 1 - u - v; wt[1] = u; wt[2] = v; }
          else { at[0] = d; at[1] = cc; at[2] = b; wt[0] = u + v - 1; wt[1] = 1 - u; wt[2] = 1 - v; }
        } else if (v >= u) { at[0] = a; at[1] = cc; at[2] = d; wt[0] = 1 - v; wt[1] = v - u; wt[2] = u; }
        else { at[0] = a; at[1] = b; at[2] = d; wt[0] = 1 - u; wt[1] = u - v; wt[2] = v; }
        const y = gridY[at[0]] * wt[0] + gridY[at[1]] * wt[1] + gridY[at[2]] * wt[2];
        if (y <= top + 1e-4) continue;
        // Push the corner that lifts this spot the most.
        let worst = 0, pull = -Infinity;
        for (let m = 0; m < 3; m++) {
          const p = wt[m] * (gridY[at[m]] - top);
          if (p > pull) { pull = p; worst = m; }
        }
        const drop = (y - top) / Math.max(0.12, wt[worst]);
        gridY[at[worst]] -= drop;
        moved++;
        if (pass === 0) groundSettle.spots++;
        if (drop > groundSettle.deepest) groundSettle.deepest = drop;
      }
    }
    if (!moved) break;
  }
}

// One corner of a ground triangle while it is being cut along the tone edges.
const F = 12; // x y z nx ny nz hatch keep r g b tone
const polyA = new Float64Array(F * 12);
const polyB = new Float64Array(F * 12);
const polyC = new Float64Array(F * 12);

/** Keep the part of a polygon on one side of a tone level. Returns the new corner count. */
function clipBand(src: Float64Array, n: number, dst: Float64Array, level: number, above: boolean): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = i * F;
    const b = ((i + 1) % n) * F;
    const va = src[a + 11], vb = src[b + 11];
    const ia = above ? va >= level : va <= level;
    const ib = above ? vb >= level : vb <= level;
    if (ia) {
      for (let k = 0; k < F; k++) dst[m * F + k] = src[a + k];
      m++;
    }
    if (ia !== ib) {
      // Always walk the edge from its lower end, so the two triangles that share it cut it at the same spot.
      const lo = va < vb ? a : b, hi = va < vb ? b : a;
      const t = (level - src[lo + 11]) / (src[hi + 11] - src[lo + 11]);
      for (let k = 0; k < F; k++) dst[m * F + k] = src[lo + k] + (src[hi + k] - src[lo + k]) * t;
      dst[m * F + 11] = level;
      m++;
    }
  }
  return m;
}

function buildGround(kit: InkKit, tier: QualityTier, group: THREE.Group): number {
  const step = TIER_STEP[tier];
  const n = Math.ceil((EXTENT * 2) / step);
  const size = (EXTENT * 2) / n;
  const w = n + 1;
  const data = new Float64Array(w * w * F);
  const inside = new Uint8Array(w * w);
  const done = new Uint8Array(w * w);
  gridN = n;
  gridSize = size;
  gridY = new Float32Array(w * w);
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      const x = -EXTENT + i * size, z = -EXTENT + j * size;
      if (Math.hypot(x, z) < rimRadius(x, z)) inside[j * w + i] = 1;
      gridY[j * w + i] = Math.hypot(x, z) < WORLD_RADIUS + 16 ? cornerY(x, z, size) : 0;
    }
  }
  settleUnderPaving();
  // Everything about a grid corner, worked out once whichever chunk asks first.
  const corner = (k: number): number => {
    const o = k * F;
    if (done[k]) return o;
    done[k] = 1;
    const i = k % w, j = (k - i) / w;
    let x = -EXTENT + i * size;
    let z = -EXTENT + j * size;
    const r = Math.hypot(x, z);
    const rim = rimRadius(x, z);
    let sx = x, sz = z;
    let y = gridY[k];
    if (r >= rim) {
      // Pull the outside corners onto the rim so the ground ends on a clean edge, and read the
      // height a hair inside, where the ground has not started to fall.
      x *= rim / r;
      z *= rim / r;
      sx = x * 0.9999;
      sz = z * 0.9999;
      y = heightAt(sx, sz);
    }
    heightAt(sx, sz);
    const lift = relief;
    const e = 1.1;
    const gx = (heightAt(sx + e, sz) - heightAt(sx - e, sz)) / (2 * e);
    const gz = (heightAt(sx, sz + e) - heightAt(sx, sz - e)) / (2 * e);
    const slope = inside[k] ? Math.hypot(gx, gz) : 0;
    const nl = Math.hypot(gx, 1, gz);
    groundTint(sx, sz, slope);
    data[o] = x; data[o + 1] = y; data[o + 2] = z;
    data[o + 3] = inside[k] ? -gx / nl : 0; data[o + 4] = inside[k] ? 1 / nl : 1; data[o + 5] = inside[k] ? -gz / nl : 0;
    // No hatching on grass: over a lumpy bank it turns into a scribble. The tone edges do the work.
    data[o + 6] = 0;
    data[o + 7] = tint.keep; data[o + 8] = tint.r; data[o + 9] = tint.g; data[o + 10] = tint.b;
    data[o + 11] = toneValue(sx, sz, slope, lift);
    return o;
  };
  // Moss, deep and grass each carry their own id, so the ink pass draws the line where they meet.
  // Light grass shares the plain grass id: a sunny crown is a patch of colour with no line round it.
  const ids = [idByte(kit), idByte(kit), idByte(kit)];
  ids.push(ids[2]);
  const color: RGB = [0, 0, 0];
  let total = 0;
  for (let cj = 0; cj < CHUNKS; cj++) {
    for (let ci = 0; ci < CHUNKS; ci++) {
      const raw = new Raw();
      const shared = new Map<number, number>();
      const put = (src: Float64Array, o: number, band: number): number => {
        const m = band < 0 ? 0 : band > 3 ? 3 : band;
        const c = C_TONES[m];
        const keep = src[o + 7];
        color[0] = c[0] * keep + src[o + 8];
        color[1] = c[1] * keep + src[o + 9];
        color[2] = c[2] * keep + src[o + 10];
        return raw.vert(src[o], src[o + 1], src[o + 2], src[o + 3], src[o + 4], src[o + 5], color, ids[m], GRASS_FLAT, src[o + 6]);
      };
      const use = (k: number, band: number): number => {
        const key = k * 8 + (band & 7);
        let v = shared.get(key);
        if (v === undefined) {
          v = put(data, k * F, band);
          shared.set(key, v);
        }
        return v;
      };
      const tri = (a: number, b: number, c: number): void => {
        const oa = corner(a), ob = corner(b), oc = corner(c);
        const va = data[oa + 11], vb = data[ob + 11], vc = data[oc + 11];
        const lo = Math.floor(Math.min(va, vb, vc));
        const hi = Math.floor(Math.max(va, vb, vc));
        if (lo === hi) {
          raw.tri(use(a, lo), use(b, lo), use(c, lo));
          return;
        }
        // The triangle straddles a tone edge: cut it into one piece per tone.
        for (let k = 0; k < F; k++) {
          polyA[k] = data[oa + k];
          polyA[F + k] = data[ob + k];
          polyA[2 * F + k] = data[oc + k];
        }
        for (let band = lo; band <= hi; band++) {
          let src = polyA;
          let m = 3;
          if (band > lo) {
            m = clipBand(src, m, polyB, band, true);
            src = polyB;
          }
          if (band < hi && m >= 3) {
            m = clipBand(src, m, polyC, band + 1, false);
            src = polyC;
          }
          if (m < 3) continue;
          const first = put(src, 0, band);
          let prev = put(src, F, band);
          for (let q = 2; q < m; q++) {
            const cur = put(src, q * F, band);
            raw.tri(first, prev, cur);
            prev = cur;
          }
        }
      };
      const i0 = Math.floor((ci * n) / CHUNKS), i1 = Math.floor(((ci + 1) * n) / CHUNKS);
      const j0 = Math.floor((cj * n) / CHUNKS), j1 = Math.floor(((cj + 1) * n) / CHUNKS);
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
          if (!(inside[a] || inside[b] || inside[c] || inside[d])) continue;
          if ((i + j) & 1) { tri(a, c, b); tri(b, c, d); }
          else { tri(a, c, d); tri(a, d, b); }
        }
      }
      if (raw.count === 0) continue;
      total += raw.triangles;
      group.add(raw.mesh(kit, `ground-${ci}-${cj}`));
    }
  }
  return total;
}

// Where the street slabs run: from the kerb of one plaza to the kerb of the next.
interface Leg { road: number; s0: number; s1: number; from: DistrictSite; to: DistrictSite; sFrom: number; sTo: number }
const LEGS: Leg[] = [];
for (const p of PATHS) {
  const cross = (stop: { site: DistrictSite; s: number }, dir: number): number => {
    const r = stop.site.radius * PLAZA;
    const a: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 0 };
    for (let s = stop.s; s >= 0 && s <= p.length; s += dir * 0.1) {
      roadPoint(p.index, s, a);
      if (Math.hypot(a.x - stop.site.center.x, a.z - stop.site.center.z) >= r) return s;
    }
    return stop.s;
  };
  for (let k = 0; k < p.stops.length - 1; k++) {
    const A = p.stops[k], B = p.stops[k + 1];
    LEGS.push({ road: p.index, s0: cross(A, 1), s1: cross(B, -1), from: A.site, to: B.site, sFrom: A.s, sTo: B.s });
  }
}

/** Street slabs run between plazas. True where one is drawn. */
function ribbonHere(road: number, s: number): boolean {
  for (let i = 0; i < LEGS.length; i++) {
    const l = LEGS[i];
    if (l.road === road && s >= l.s0 - 0.7 && s <= l.s1 + 0.7) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// The underside
// ---------------------------------------------------------------------------------------------
// A piece of city lifted out of the earth: topsoil, old fill, then bedrock in violet-grey and warm
// bands down to a point, with brick foundations, pipes, roots and a cut tunnel showing in the face.

// depth below the rim, share of the rim radius, push outward, wobble
const STRATA: [number, number, number, number][] = [
  [0, 1, 0.1, 0],
  [2.2, 1, 0.9, 0.5],
  [5.5, 1, -0.4, 1.2],
  [9, 1, 1.6, 1.4],
  [14, 0.995, -1.2, 2.2],
  [21, 0.99, 1.0, 2.6],
  [30, 0.975, -2.0, 3.4],
  [42, 0.94, 0, 5],
  [60, 0.84, 0, 8],
  [84, 0.66, 0, 10],
  [112, 0.44, 0, 9],
  [142, 0.24, 0, 7],
  [170, 0.09, 0, 3.5],
];
const TIP_DEPTH = 196;
const STRATA_COLORS = ['#9c7862', '#e9d2b4', '#aaa1c6', palette.sandDeep, '#8f88b8', '#d4937a', '#7d76a8', '#b77c78', palette.asphalt, '#625a92', '#574c88', '#4d427c', '#453a72'];
const STRATA_HATCH = [0.05, 0.08, 0.28, 0.16, 0.36, 0.24, 0.46, 0.4, 0.52, 0.56, 0.6, 0.62, 0.62];
const C_BRICK = rgb(palette.brick);
const C_BRICK2 = rgb(palette.brickDeep);

/** Where things stick out of the face, as angles round the rim. The first tunnel faces the usual far view. */
const TUNNELS = [0.93, 3.95];
const FOUNDATIONS = [0.52, 1.36, 2.05, 2.8, 3.45, 4.4, 5.05, 5.75, 0.05];

function rimTop(a: number): number {
  const r = rimRadius(Math.cos(a), Math.sin(a)) * 0.9999;
  return heightAt(Math.cos(a) * r, Math.sin(a) * r);
}

function buildSkirt(kit: InkKit, tier: QualityTier, group: THREE.Group): number {
  const na = tier === 'high' ? 200 : tier === 'medium' ? 150 : 100;
  const raw = new Raw();
  const rings = STRATA.length;
  const px = new Float32Array(na * rings);
  const py = new Float32Array(na * rings);
  const pz = new Float32Array(na * rings);
  let lowest = Infinity;
  for (let i = 0; i < na; i++) {
    const a = (i / na) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    const rim = rimRadius(cx, cz);
    const top = heightAt(cx * rim * 0.9999, cz * rim * 0.9999);
    if (top < lowest) lowest = top;
    for (let k = 0; k < rings; k++) {
      const [depth, share, push, wob] = STRATA[k];
      // The wobble wraps cleanly: it is read on a circle, not on the angle.
      const nz = gnoise2(cx * 9 + k * 3.7, cz * 9 - k * 2.3, 41) * wob + (hash2(i, k, 77) - 0.5) * wob * 0.7;
      const r = rim * share + push + nz;
      const o = k * na + i;
      px[o] = cx * r;
      pz[o] = cz * r;
      py[o] = k === 0 ? top : top - depth - (hash2(i, k, 78) - 0.5) * Math.min(2.5, depth * 0.12);
    }
  }
  const col: RGB = [0, 0, 0];
  // A lid just under the ground's edge, so a hairline gap there shows earth and not sky.
  const lidId = idByte(kit);
  const lidC = rgb(STRATA_COLORS[0]);
  for (let i = 0; i < na; i++) {
    const j = (i + 1) % na;
    const s = 1 - 3.5 / WORLD_RADIUS;
    raw.face(px[i] * s, py[i] - 1.8, pz[i] * s, px[i], py[i], pz[i], px[j], py[j], pz[j], lidC, lidId);
    raw.face(px[i] * s, py[i] - 1.8, pz[i] * s, px[j], py[j], pz[j], px[j] * s, py[j] - 1.8, pz[j] * s, lidC, lidId);
  }
  for (let k = 0; k < rings - 1; k++) {
    const id = idByte(kit);
    rgb(STRATA_COLORS[k]).forEach((v, n) => (col[n] = v));
    const hatch = STRATA_HATCH[k];
    for (let i = 0; i < na; i++) {
      const j = (i + 1) % na;
      const a = k * na + i, b = k * na + j, c = (k + 1) * na + i, d = (k + 1) * na + j;
      raw.face(px[a], py[a], pz[a], px[b], py[b], pz[b], px[c], py[c], pz[c], col, id, 0, hatch);
      raw.face(px[b], py[b], pz[b], px[d], py[d], pz[d], px[c], py[c], pz[c], col, id, 0, hatch);
    }
  }
  // The point underneath.
  const tipId = idByte(kit);
  const tipC = rgb(STRATA_COLORS[rings - 1]);
  const last = (rings - 1) * na;
  for (let i = 0; i < na; i++) {
    const j = (i + 1) % na;
    raw.face(px[last + i], py[last + i], pz[last + i], px[last + j], py[last + j], pz[last + j], 6, lowest - TIP_DEPTH, -8, tipC, tipId, 0, STRATA_HATCH[rings - 1]);
  }

  // Old brick foundations standing proud of the face: courses of big blocks, torn away toward the bottom.
  const brickIds = [idByte(kit), idByte(kit), idByte(kit)];
  // One flat four-sided face, wound so it looks toward (hx, hy, hz).
  const quad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, c: RGB, id: number, hx: number, hy: number, hz: number): void => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = dx - ax, vy = dy - ay, vz = dz - az;
    const out = (uy * vz - uz * vy) * hx + (uz * vx - ux * vz) * hy + (ux * vy - uy * vx) * hz;
    if (out >= 0) {
      raw.face(ax, ay, az, bx, by, bz, cx, cy, cz, c, id);
      raw.face(ax, ay, az, cx, cy, cz, dx, dy, dz, c, id);
    } else {
      raw.face(ax, ay, az, cx, cy, cz, bx, by, bz, c, id);
      raw.face(ax, ay, az, dx, dy, dz, cx, cy, cz, c, id);
    }
  };
  const walls = tier === 'low' ? 5 : FOUNDATIONS.length;
  for (let f = 0; f < walls; f++) {
    const a0 = FOUNDATIONS[f];
    const rows = 5 + Math.floor(hash2(f, 1, 301) * 4);
    const course = 1.05;
    const top = rimTop(a0) - 1.1 - hash2(f, 2, 301) * 0.8;
    const proud = 3.3 + hash2(f, 5, 301) * 0.8;
    let half = (5.5 + hash2(f, 3, 301) * 5) / WORLD_RADIUS;
    const at = (t: number, back: boolean, y: number, out: number[]): void => {
      const r = rimRadius(Math.cos(t), Math.sin(t)) + (back ? -1.5 : proud);
      out[0] = Math.cos(t) * r; out[1] = y; out[2] = Math.sin(t) * r;
    };
    const p0: number[] = [0, 0, 0], p1: number[] = [0, 0, 0], p2: number[] = [0, 0, 0], p3: number[] = [0, 0, 0];
    const hx = Math.cos(a0), hz = Math.sin(a0);
    const dt = 4.2 / WORLD_RADIUS;
    for (let r = 0; r < rows; r++) {
      const y1 = top - r * course, y0 = y1 - course;
      const ta = a0 - half, tb = a0 + half;
      // The front, block by block, each course shifted half a block from the one above.
      let t = ta;
      let n = 0;
      while (t < tb - 1e-5) {
        const next = Math.min(tb, n === 0 && r & 1 ? t + dt * 0.5 : t + dt);
        const c = hash2(f * 17 + r, n, 302) < 0.3 ? C_BRICK2 : C_BRICK;
        at(t, false, y0, p0); at(next, false, y0, p1); at(next, false, y1, p2); at(t, false, y1, p3);
        quad(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], c, brickIds[(r * 2 + n) % 3], hx, 0, hz);
        t = next;
        n++;
      }
      // The two ends of the course.
      for (let e = 0; e < 2; e++) {
        const te = e ? tb : ta;
        at(te, false, y0, p0); at(te, false, y1, p1); at(te, true, y1, p2); at(te, true, y0, p3);
        quad(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], C_BRICK2, brickIds[r % 3], e ? -hz : hz, 0, e ? hx : -hx);
      }
      // Its top, on the first course; its underside, wherever the next course is shorter or missing.
      if (r === 0) {
        at(ta, false, y1, p0); at(tb, false, y1, p1); at(tb, true, y1, p2); at(ta, true, y1, p3);
        quad(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], C_BRICK, brickIds[0], 0, 1, 0);
      }
      const shrink = r === rows - 1 ? half : r >= 2 ? (hash2(f, r, 303) < 0.6 ? dt * (0.5 + hash2(f, r, 304) * 0.5) : 0) : 0;
      if (shrink > 0) {
        const lose = Math.min(shrink, half);
        const sideA = hash2(f, r, 305) < 0.5 || r === rows - 1;
        const cutA = sideA ? lose : 0, cutB = r === rows - 1 ? lose : sideA ? 0 : lose;
        if (cutA > 0) {
          at(ta, false, y0, p0); at(ta + cutA, false, y0, p1); at(ta + cutA, true, y0, p2); at(ta, true, y0, p3);
          quad(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], C_BRICK2, brickIds[r % 3], 0, -1, 0);
        }
        if (cutB > 0) {
          at(tb - cutB, false, y0, p0); at(tb, false, y0, p1); at(tb, true, y0, p2); at(tb - cutB, true, y0, p3);
          quad(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], C_BRICK2, brickIds[r % 3], 0, -1, 0);
        }
        if (r === rows - 1) break;
        // Only a symmetric loss keeps the wall centred on its angle; a one-sided loss just narrows it.
        half -= lose / 2;
      }
    }
  }
  group.add(raw.mesh(kit, 'cliff'));
  return raw.triangles;
}

/** Pipes, roots and the cut tunnel mouths: one mesh. */
function buildUnderside(kit: InkKit, tier: QualityTier, group: THREE.Group): number {
  const b = kit.builder();
  const low = tier === 'low';
  const round = low ? 6 : 8;
  const dark = '#3a3166';
  // Pipes: a length of main sticking out of the fill, some turned down at an elbow.
  const rand = rng(7719);
  const pipes = low ? 5 : 11;
  for (let i = 0; i < pipes; i++) {
    const a = (i + 0.2 + rand() * 0.6) * ((Math.PI * 2) / pipes);
    const depth = 3.4 + rand() * 7;
    const r = 0.38 + rand() * 0.4;
    const len = 5.5 + rand() * 3.5;
    const cx = Math.cos(a), cz = Math.sin(a);
    const start = rimRadius(cx, cz) - 3;
    const y = rimTop(a) - depth;
    const c = i % 3 === 1 ? palette.verdigris : palette.steel;
    const id = b.newId();
    b.add(geo.cylinder(r, r, len, round), { color: c, pos: [cx * start, y, cz * start], rot: [0, -a, -Math.PI / 2], id });
    const end = start + len;
    b.add(geo.cylinder(r * 1.22, r * 1.22, 0.28, round), { color: c, pos: [cx * (end - 0.9), y, cz * (end - 0.9)], rot: [0, -a, -Math.PI / 2] });
    if (i % 2 === 0) {
      const drop = 2.2 + rand() * 2.5;
      b.add(geo.sphere(r * 1.12, round, 4), { color: c, pos: [cx * end, y, cz * end], id });
      b.add(geo.cylinder(r, r, drop, round), { color: c, pos: [cx * end, y - drop, cz * end], id });
      b.add(geo.cylinder(r * 0.72, r * 0.72, 0.04, round), { color: dark, pos: [cx * end, y - drop - 0.03, cz * end], flat: 1 });
    } else {
      b.add(geo.cylinder(r * 0.72, r * 0.72, 0.05, round), { color: dark, pos: [cx * (end - 0.02), y, cz * (end - 0.02)], rot: [0, -a, -Math.PI / 2], flat: 1 });
    }
  }
  // Roots hanging out of the topsoil.
  const roots = low ? 6 : 13;
  for (let i = 0; i < roots; i++) {
    const a = (i + rand()) * ((Math.PI * 2) / roots) + 0.3;
    const cx = Math.cos(a), cz = Math.sin(a);
    const r0 = rimRadius(cx, cz) + 0.6;
    const y = rimTop(a) - 1.2;
    const fall = 6 + rand() * 9;
    const sw = (rand() - 0.5) * 3;
    const pts: [number, number, number][] = [
      [cx * (r0 - 1.5), y + 0.4, cz * (r0 - 1.5)],
      [cx * (r0 + 1.4) - cz * sw * 0.3, y - fall * 0.3, cz * (r0 + 1.4) + cx * sw * 0.3],
      [cx * (r0 + 2.2) - cz * sw * 0.8, y - fall * 0.68, cz * (r0 + 2.2) + cx * sw * 0.8],
      [cx * (r0 + 1.6) - cz * sw, y - fall, cz * (r0 + 1.6) + cx * sw],
    ];
    b.add(geo.tube(pts, 0.16 + rand() * 0.12, { radial: 5, perSpan: low ? 2 : 3 }), { color: '#7b5a4a' });
  }
  // The tunnel: a brick ring cut clean through, dark inside, the rails still poking out.
  const mouths = low ? 1 : TUNNELS.length;
  for (let i = 0; i < mouths; i++) {
    const a = TUNNELS[i];
    const cx = Math.cos(a), cz = Math.sin(a);
    const rim = rimRadius(cx, cz);
    const yaw = Math.PI / 2 - a;
    const y = rimTop(a) - 10.4;
    const front = rim + 4.6;
    const deep = 7;
    const mid = front - deep / 2;
    const span = 5.6, rise = 5.4, thick = 0.8;
    const ring = b.newId();
    b.add(geo.arch({ span, rise, thick, depth: deep, round: true, seg: low ? 8 : 12 }), { color: palette.brick, pos: [cx * mid, y, cz * mid], rot: [0, yaw, 0], id: ring });
    b.add(geo.arch({ span: span + 0.5, rise: rise + 0.25, thick: thick + 0.3, depth: 0.7, round: true, seg: low ? 8 : 12 }), { color: palette.marble, pos: [cx * (front - 0.2), y, cz * (front - 0.2)], rot: [0, yaw, 0] });
    b.add(geo.box(span + 2 * thick + 1.2, 0.7, deep + 1.2), { color: palette.paveShade, pos: [cx * (mid + 0.5), y - 0.7, cz * (mid + 0.5)], rot: [0, yaw, 0] });
    // The dark, a little way in, and a second ring deeper to show it goes on.
    b.add(geo.box(span + 0.3, rise + 0.3, 0.3), { color: dark, pos: [cx * (front - 2.6), y, cz * (front - 2.6)], rot: [0, yaw, 0], flat: 1, outline: false });
    b.add(geo.arch({ span: span - 1.5, rise: rise - 1.1, thick: 0.75, depth: 0.3, round: true, seg: 8 }), { color: '#51467f', pos: [cx * (front - 2.3), y, cz * (front - 2.3)], rot: [0, yaw, 0], flat: 1 });
    for (const side of [-1, 1]) {
      const ox = -cz * side * 0.95, oz = cx * side * 0.95;
      b.add(geo.box(0.16, 0.18, 5.2), { color: palette.steel, pos: [cx * (front - 0.6) + ox, y, cz * (front - 0.6) + oz], rot: [0, yaw, 0] });
    }
    for (let k = 0; k < 3; k++) {
      const d = front - 1.6 + k * 0.9;
      b.add(geo.box(2.7, 0.1, 0.34), { color: '#7b5a4a', pos: [cx * d, y, cz * d], rot: [0, yaw, 0] });
    }
  }
  const tris = b.triangles();
  group.add(b.build('underside'));
  return tris;
}

// ---------------------------------------------------------------------------------------------
// Streets and plazas
// ---------------------------------------------------------------------------------------------

const ROAD_LIFT = 0.05;
const WALK_LIFT = 0.085;
const PLAZA_LIFT = 0.03;
const PAINT_LIFT = 0.03;
const NO_EDGE = 255;
const C_ROAD = rgb(palette.pave);
const C_ROAD2 = mix3([0, 0, 0], rgb(palette.pave), rgb(palette.paveShade), 0.6);
const C_WALK = rgb(palette.marble);
const C_WALK2 = mix3([0, 0, 0], rgb(palette.marble), rgb(palette.marbleShade), 0.45);
const C_KERB = mix3([0, 0, 0], rgb(palette.paveShade), rgb(palette.asphalt), 0.16);
const C_BAR = mix3([0, 0, 0], rgb(palette.pave), rgb(palette.asphalt), 0.78);
const C_CORAL = rgb(THREAD_COLORS.people);
const C_TEAL = rgb(THREAD_COLORS.tech);
const C_BOTH = rgb(THREAD_COLORS.both);
const C_PAD = SITES.map((s) => mix3([0, 0, 0], rgb(palette.pave), rgb(s.accents[0]), 0.12));
const C_PAD2 = C_PAD.map((c) => mix3([0, 0, 0], c, rgb(palette.paveShade), 0.55));
const C_PADKERB = SITES.map((s) => mix3([0, 0, 0], C_KERB, rgb(s.accents[0]), 0.14));
/** Half the width of one inlaid thread line, and how far each line of the avenue's pair sits from the middle. */
const LINE_HALF = 0.125;
const LINE_APART = 0.225;
/** Metres before the Observatory end of the spine over which the two lines become one. */
export const MERGE_LENGTH = 48;

const rp: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };

// How the avenue's pair of lines sits at one spot: apart, half width, and how far they have turned into one colour.
const th = { apart: LINE_APART, half: LINE_HALF, blend: 0 };
function threadAt(s: number, sEnd: number, merge: boolean): void {
  th.apart = LINE_APART;
  th.half = LINE_HALF;
  th.blend = 0;
  if (!merge) return;
  const t = 1 - Math.min(1, Math.max(0, sEnd - s) / MERGE_LENGTH);
  th.blend = smoothstep(0.3, 0.6, t);
  th.half = LINE_HALF - 0.03 * th.blend;
  th.apart = LINE_APART + (th.half - LINE_APART) * smoothstep(0, 0.42, t);
}

function buildStreets(kit: InkKit, raw: Raw, tier: QualityTier): void {
  const roadIds = [idByte(kit), idByte(kit)];
  const walkIds = [idByte(kit), idByte(kit)];
  const dotId = idByte(kit);
  const sub = tier === 'low' ? 3.6 : 2.6;
  const cA: RGB = [0, 0, 0];
  const cB: RGB = [0, 0, 0];
  const offs: number[] = [];
  const cols: RGB[] = [];
  const rowA: number[] = [];
  const rowB: number[] = [];

  for (const leg of LEGS) {
    const p = PATHS[leg.road];
    const hw = p.width / 2;
    const W = hw + SIDEWALK[p.kind];
    const spine = p.kind === 'spine';
    const merge = spine && leg.to.id === 'observatory';
    const lineC = rgb(THREAD_COLORS[p.stops[p.stops.length - 1].site.thread]);
    const lineFrom = leg.sFrom + leg.from.radius * ROAD_END;
    const lineTo = leg.sTo - leg.to.radius * ROAD_END;
    const a = leg.s0 - 0.45, b = leg.s1 + 0.45;
    const slabs = Math.max(1, Math.round((b - a) / 8));
    const per = Math.max(2, Math.round((b - a) / slabs / sub));
    const rows = slabs * per;
    const ds = (b - a) / rows;
    const flagLen = Math.max(1, per >> 1);

    // The strips across the carriageway at one spot, left to right.
    const lay2 = (s: number, cRoad: RGB): void => {
      offs.length = 0;
      cols.length = 0;
      if (spine) {
        threadAt(s, lineTo, merge);
        mix3(cA, C_CORAL, C_BOTH, th.blend);
        mix3(cB, C_TEAL, C_BOTH, th.blend);
        offs.push(-hw, -th.apart - th.half, -th.apart + th.half, th.apart - th.half, th.apart + th.half, hw);
        cols.push(cRoad, cA, cRoad, cB, cRoad);
      } else {
        offs.push(-hw, -LINE_HALF, LINE_HALF, hw);
        cols.push(cRoad, lineC, cRoad);
      }
    };
    // One cross-section of the street: wall, sidewalk, kerb, carriageway, kerb, sidewalk, wall.
    const row = (out: number[], s: number, cRoad: RGB, rid: number, cWalk: RGB, wid: number): void => {
      out.length = 0;
      roadPoint(p.index, s, rp);
      const nx = -rp.tz, nz = rp.tx;
      const yr = rp.h + ROAD_LIFT, yw = rp.h + WALK_LIFT;
      const at = (o: number, y: number, ux: number, uy: number, uz: number, c: RGB, id: number): number =>
        raw.vert(rp.x + nx * o, y, rp.z + nz * o, ux, uy, uz, c, id);
      out.push(at(-W, yw - 0.9, -nx, 0, -nz, C_WALK2, wid), at(-W, yw, -nx, 0, -nz, C_WALK2, wid));
      out.push(at(-W, yw, 0, 1, 0, cWalk, wid), at(-hw - 0.2, yw, 0, 1, 0, cWalk, wid));
      out.push(at(-hw - 0.2, yw, 0, 1, 0, C_KERB, wid), at(-hw, yr, 0, 1, 0, C_KERB, wid));
      lay2(s, cRoad);
      for (let c = 0; c < cols.length; c++) out.push(at(offs[c], yr, 0, 1, 0, cols[c], rid), at(offs[c + 1], yr, 0, 1, 0, cols[c], rid));
      out.push(at(hw, yr, 0, 1, 0, C_KERB, wid), at(hw + 0.2, yw, 0, 1, 0, C_KERB, wid));
      out.push(at(hw + 0.2, yw, 0, 1, 0, cWalk, wid), at(W, yw, 0, 1, 0, cWalk, wid));
      out.push(at(W, yw, nx, 0, nz, C_WALK2, wid), at(W, yw - 0.9, nx, 0, nz, C_WALK2, wid));
    };
    for (let i = 0; i < rows; i++) {
      const slab = Math.floor(i / per);
      const flag = Math.floor(i / flagLen);
      const cRoad = hash2(slab, leg.road * 7 + 1, 911) < 0.17 ? C_ROAD2 : C_ROAD;
      const cWalk = hash2(flag, leg.road * 7 + 2, 912) < 0.14 ? C_WALK2 : C_WALK;
      row(rowA, a + i * ds, cRoad, roadIds[slab & 1], cWalk, walkIds[flag & 1]);
      row(rowB, a + (i + 1) * ds, cRoad, roadIds[slab & 1], cWalk, walkIds[flag & 1]);
      for (let c = 0; c < rowA.length; c += 2) {
        raw.tri(rowA[c], rowA[c + 1], rowB[c]);
        raw.tri(rowA[c + 1], rowB[c + 1], rowB[c]);
      }
    }

    // Paint on the carriageway between two arc lengths and two offsets, lying on the slab's own facets.
    const yAt = (s: number): number => {
      const f = Math.min(rows - 0.0001, Math.max(0, (s - a) / ds));
      const i = Math.floor(f);
      roadPoint(p.index, a + i * ds, rp);
      const h0 = rp.h;
      roadPoint(p.index, a + (i + 1) * ds, rp);
      return h0 + (rp.h - h0) * (f - i) + ROAD_LIFT + PAINT_LIFT;
    };
    const paint = (sa: number, sb: number, oa: number, ob: number, c: RGB): void => {
      let s = sa;
      while (s < sb - 1e-4) {
        const next = Math.min(sb, a + (Math.floor((s - a) / ds + 1e-6) + 1) * ds);
        const y0 = yAt(s), y1 = yAt(next);
        roadPoint(p.index, s, rp);
        const x0 = rp.x, z0 = rp.z, n0x = -rp.tz, n0z = rp.tx;
        roadPoint(p.index, next, rp);
        const x1 = rp.x, z1 = rp.z, n1x = -rp.tz, n1z = rp.tx;
        const A = raw.vert(x0 + n0x * oa, y0, z0 + n0z * oa, 0, 1, 0, c, NO_EDGE);
        const B = raw.vert(x0 + n0x * ob, y0, z0 + n0z * ob, 0, 1, 0, c, NO_EDGE);
        const C = raw.vert(x1 + n1x * oa, y1, z1 + n1z * oa, 0, 1, 0, c, NO_EDGE);
        const D = raw.vert(x1 + n1x * ob, y1, z1 + n1z * ob, 0, 1, 0, c, NO_EDGE);
        raw.tri(A, B, C);
        raw.tri(B, D, C);
        s = next;
      }
    };
    // A crosswalk at each end, where the street meets a plaza.
    const pitch = spine ? 0.8 : 0.6;
    const first = spine ? 0.8 : 0.52;
    for (let end = 0; end < 2; end++) {
      const sa = end === 0 ? a + 1.3 : b - 3.9;
      if (b - a < 12) break;
      for (let c = first; c + pitch * 0.26 <= hw - 0.12; c += pitch) {
        paint(sa, sa + 3.2, c - pitch * 0.27, c + pitch * 0.27, C_BAR);
        paint(sa, sa + 3.2, -c - pitch * 0.27, -c + pitch * 0.27, C_BAR);
      }
    }

    // The thread lines run on across each plaza and stop at a station dot.
    const tail = (sa: number, sb: number, site: DistrictSite, dotAt: number): void => {
      const y = site.height + PLAZA_LIFT + 0.04;
      const n = Math.max(1, Math.ceil((sb - sa) / 2.5));
      let prev: number[] = [];
      for (let i = 0; i <= n; i++) {
        const s = sa + ((sb - sa) * i) / n;
        roadPoint(p.index, s, rp);
        const nx = -rp.tz, nz = rp.tx;
        lay2(s, C_ROAD);
        const cur: number[] = [];
        for (let c = 1; c < cols.length; c += 2) {
          cur.push(
            raw.vert(rp.x + nx * offs[c], y, rp.z + nz * offs[c], 0, 1, 0, cols[c], NO_EDGE),
            raw.vert(rp.x + nx * offs[c + 1], y, rp.z + nz * offs[c + 1], 0, 1, 0, cols[c], NO_EDGE),
          );
        }
        if (i > 0) {
          for (let c = 0; c < cur.length; c += 2) {
            raw.tri(prev[c], prev[c + 1], cur[c]);
            raw.tri(prev[c + 1], cur[c + 1], cur[c]);
          }
        }
        prev = cur;
      }
      // The dot: a pale disc with an ink ring, the way a stop is drawn on a line map.
      roadPoint(p.index, dotAt, rp);
      const c0 = raw.vert(rp.x, y + 0.012, rp.z, 0, 1, 0, C_WALK, dotId);
      const ring: number[] = [];
      for (let k = 0; k < 12; k++) {
        const an = (k / 12) * Math.PI * 2;
        ring.push(raw.vert(rp.x + Math.cos(an) * 0.62, y + 0.012, rp.z + Math.sin(an) * 0.62, 0, 1, 0, C_WALK, dotId));
      }
      for (let k = 0; k < 12; k++) raw.tri(c0, ring[(k + 1) % 12], ring[k]);
    };
    tail(lineFrom, a + 0.2, leg.from, lineFrom);
    tail(b - 0.2, lineTo, leg.to, lineTo);
  }
}

function buildPlazas(kit: InkKit, raw: Raw, tier: QualityTier): void {
  const seg = tier === 'low' ? 24 : 36;
  const sectors = tier === 'low' ? [1, 6, 12, 12] : [1, 6, 12, 18];
  const ids = [idByte(kit), idByte(kit), idByte(kit)];
  const kerbId = idByte(kit);
  for (let i = 0; i < NS; i++) {
    const site = SITES[i];
    const R = site.radius * PLAZA;
    const y = SH[i] + PLAZA_LIFT;
    const radii = [0, R * 0.2, R * 0.46, R * 0.73, R - 0.45];
    const turn = hash2(i, 3, 61) * Math.PI;
    const px = (r: number, k: number): number => SX[i] + Math.cos(turn + (k / seg) * Math.PI * 2) * r;
    const pz = (r: number, k: number): number => SZ[i] + Math.sin(turn + (k / seg) * Math.PI * 2) * r;
    for (let ring = 0; ring < 4; ring++) {
      const r0 = radii[ring], r1 = radii[ring + 1];
      const span = seg / sectors[ring];
      for (let m = 0; m < sectors[ring]; m++) {
        // Rings always show their joint; here and there one flag of paving is cut out and toned.
        const odd = ring > 0 && hash2(i * 31 + ring, m, 517) < 0.3;
        const c = odd && hash2(i * 31 + ring, m, 518) < 0.55 ? C_PAD2[i] : C_PAD[i];
        const id = odd ? ids[2] : ids[ring & 1];
        for (let k = m * span; k < (m + 1) * span; k++) {
          const B = raw.vert(px(r1, k), y, pz(r1, k), 0, 1, 0, c, id);
          const C = raw.vert(px(r1, k + 1), y, pz(r1, k + 1), 0, 1, 0, c, id);
          if (ring === 0) {
            const A = raw.vert(SX[i], y, SZ[i], 0, 1, 0, c, id);
            raw.tri(A, C, B);
          } else {
            const A = raw.vert(px(r0, k), y, pz(r0, k), 0, 1, 0, c, id);
            const D = raw.vert(px(r0, k + 1), y, pz(r0, k + 1), 0, 1, 0, c, id);
            raw.tri(A, D, B);
            raw.tri(D, C, B);
          }
        }
      }
    }
    // The kerb: a darker band of stone round the paving, then a short wall down into the grass.
    const kc = C_PADKERB[i];
    for (let k = 0; k < seg; k++) {
      const A = raw.vert(px(R - 0.45, k), y, pz(R - 0.45, k), 0, 1, 0, kc, kerbId);
      const D = raw.vert(px(R - 0.45, k + 1), y, pz(R - 0.45, k + 1), 0, 1, 0, kc, kerbId);
      const B = raw.vert(px(R, k), y, pz(R, k), 0, 1, 0, kc, kerbId);
      const C = raw.vert(px(R, k + 1), y, pz(R, k + 1), 0, 1, 0, kc, kerbId);
      raw.tri(A, D, B);
      raw.tri(D, C, B);
      const ax = px(R, k), az = pz(R, k), bx = px(R, k + 1), bz = pz(R, k + 1);
      const nx = (ax + bx) / 2 - SX[i], nz = (az + bz) / 2 - SZ[i];
      const nl = Math.hypot(nx, nz) || 1;
      const E = raw.vert(ax, y, az, nx / nl, 0, nz / nl, kc, kerbId);
      const G = raw.vert(bx, y, bz, nx / nl, 0, nz / nl, kc, kerbId);
      const H = raw.vert(ax, y - 0.9, az, nx / nl, 0, nz / nl, kc, kerbId);
      const I = raw.vert(bx, y - 0.9, bz, nx / nl, 0, nz / nl, kc, kerbId);
      raw.tri(E, G, H);
      raw.tri(G, I, H);
    }
  }
}

// Things drawn on the grass: mown stripes beside the avenue, clover, the odd patch of bare earth.
// Flat shapes with no ink line, laid a hand above the ground mesh.
const DECAL_LIFT = 0.1;
const C_MOWN = mix3([0, 0, 0], rgb(palette.grass), rgb(palette.grassLight), 0.62);
const C_CLOVER = mix3([0, 0, 0], rgb(palette.grassLight), rgb(palette.verdigris), 0.42);

/** Open grass: clear of every street, plaza and the rim by `room` metres. */
function openGrass(x: number, z: number, room: number): boolean {
  if (Math.hypot(x, z) > rimRadius(x, z) - 6 - room) return false;
  for (let i = 0; i < NS; i++) {
    const r = SFLAT[i] + 2 + room;
    const dx = x - SX[i], dz = z - SZ[i];
    if (dx * dx + dz * dz < r * r) return false;
  }
  roadInfo(x, z, hit);
  return hit.road < 0 || hit.dist > hit.width / 2 + 2.2 + room;
}

function buildDecals(raw: Raw, tier: QualityTier): void {
  const quad = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number, c: RGB): void => {
    const A = raw.vert(ax, meshY(ax, az) + DECAL_LIFT, az, 0, 1, 0, c, NO_EDGE);
    const B = raw.vert(bx, meshY(bx, bz) + DECAL_LIFT, bz, 0, 1, 0, c, NO_EDGE);
    const C = raw.vert(cx, meshY(cx, cz) + DECAL_LIFT, cz, 0, 1, 0, c, NO_EDGE);
    const D = raw.vert(dx, meshY(dx, dz) + DECAL_LIFT, dz, 0, 1, 0, c, NO_EDGE);
    raw.tri(A, B, C);
    raw.tri(B, D, C);
  };
  // Mown lawns: light stripes running with the avenue, a few to a lawn, on alternate sides.
  const a: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };
  const b: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };
  let n = 0;
  for (const leg of LEGS) {
    const p = PATHS[leg.road];
    if (p.kind !== 'spine' || leg.s1 - leg.s0 < 46) continue;
    const side = n++ & 1 ? 1 : -1;
    const mid = (leg.s0 + leg.s1) / 2 + (hash2(leg.road, n, 77) - 0.5) * 8;
    const inner = p.width / 2 + SIDEWALK.spine + 2.6;
    const stripes = tier === 'low' ? 3 : 4;
    for (let k = 0; k < stripes; k++) {
      const o0 = side * (inner + k * 3.2), o1 = side * (inner + k * 3.2 + 1.6);
      for (let s = mid - 13; s < mid + 13 - 0.01; s += 3.25) {
        roadPoint(p.index, s, a);
        roadPoint(p.index, s + 3.25, b);
        const x0 = a.x - a.tz * o0, z0 = a.z + a.tx * o0, x1 = a.x - a.tz * o1, z1 = a.z + a.tx * o1;
        const x2 = b.x - b.tz * o0, z2 = b.z + b.tx * o0, x3 = b.x - b.tz * o1, z3 = b.z + b.tx * o1;
        if (!openGrass(x0, z0, 0) || !openGrass(x1, z1, 0) || !openGrass(x2, z2, 0) || !openGrass(x3, z3, 0)) continue;
        // Only on a level lawn: on a bank the ground bulges up through a flat stripe.
        if (Math.abs(b.h - a.h) > 0.4) continue;
        const sag = meshY((x0 + x1 + x2 + x3) / 4, (z0 + z1 + z2 + z3) / 4) - (meshY(x0, z0) + meshY(x1, z1) + meshY(x2, z2) + meshY(x3, z3)) / 4;
        if (sag > 0.05 || Math.abs(meshY(x1, z1) - meshY(x0, z0)) > 0.3) continue;
        if (side > 0) quad(x0, z0, x1, z1, x2, z2, x3, z3, C_MOWN);
        else quad(x1, z1, x0, z0, x3, z3, x2, z2, C_MOWN);
      }
    }
  }
  // Patches: a lumpy round shape, two rings of triangles so it bends with the ground.
  const rand = rng(4041);
  const want = tier === 'low' ? 8 : 22;
  let made = 0;
  for (let tries = 0; tries < 900 && made < want; tries++) {
    const ang = rand() * Math.PI * 2, d = Math.sqrt(rand()) * WORLD_RADIUS;
    const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
    const earth = made % 3 === 2;
    const R = earth ? 1.6 + rand() * 1.6 : 2.6 + rand() * 2.6;
    if (!openGrass(x, z, R + 1)) continue;
    const e = 2;
    if (Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e) > 0.2) continue;
    made++;
    const c = earth ? C_EARTH : C_CLOVER;
    const seed = made * 13;
    const N = 9;
    const stretch = 0.7 + rand() * 0.6, turn = rand() * Math.PI;
    const at = (k: number, f: number, out: [number, number]): void => {
      const t = (k / N) * Math.PI * 2;
      const r = R * f * (0.78 + 0.44 * noise2(Math.cos(t) * 1.3 + seed, Math.sin(t) * 1.3, 9));
      const px = Math.cos(t) * r * stretch, pz = Math.sin(t) * r / stretch;
      out[0] = x + px * Math.cos(turn) - pz * Math.sin(turn);
      out[1] = z + px * Math.sin(turn) + pz * Math.cos(turn);
    };
    const q0: [number, number] = [0, 0], q1: [number, number] = [0, 0], q2: [number, number] = [0, 0], q3: [number, number] = [0, 0];
    const centre = raw.vert(x, meshY(x, z) + DECAL_LIFT, z, 0, 1, 0, c, NO_EDGE);
    for (let k = 0; k < N; k++) {
      at(k, 0.5, q0); at(k + 1, 0.5, q1); at(k, 1, q2); at(k + 1, 1, q3);
      const A = raw.vert(q0[0], meshY(q0[0], q0[1]) + DECAL_LIFT, q0[1], 0, 1, 0, c, NO_EDGE);
      const B = raw.vert(q1[0], meshY(q1[0], q1[1]) + DECAL_LIFT, q1[1], 0, 1, 0, c, NO_EDGE);
      raw.tri(centre, B, A);
      quad(q2[0], q2[1], q0[0], q0[1], q3[0], q3[1], q1[0], q1[1], c);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Street furniture: year lamps, street signs, the railing at the rim
// ---------------------------------------------------------------------------------------------

const C_GLOBE = '#fff1c4';

function buildMarkers(kit: InkKit, tier: QualityTier, group: THREE.Group): number {
  const b = kit.builder();
  const low = tier === 'low';
  const round = low ? 6 : 8;
  const spine = PATHS.find((p) => p.kind === 'spine');
  // A year lamp: a lamp post on the sidewalk with the year lettered on a marble plate, both sides.
  if (spine) {
    for (const stone of YEAR_STONES) {
      const k = spine.stops.findIndex((s) => s.site.id === stone.at);
      if (k < 0) continue;
      const stop = spine.stops[k];
      // On the way in, a little before the crosswalk. The first has no way in, so it stands on the way out.
      const reach = stop.site.radius * PLAZA + 8.5;
      const s = k === 0 ? stop.s + reach : stop.s - reach;
      roadPoint(spine.index, s, rp);
      const side = spine.width / 2 + SIDEWALK.spine - 0.32;
      const nx = -rp.tz, nz = rp.tx;
      const x = rp.x + nx * side, z = rp.z + nz * side;
      const y = rp.h + WALK_LIFT;
      // The plate hangs square to the street so the year reads on the way up and on the way back.
      const yaw = Math.atan2(-rp.tx, -rp.tz);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const post = b.newId();
      b.add(geo.bevelBox(0.5, 0.42, 0.5, 0.06), { color: palette.marble, pos: [x, y, z], rot: [0, yaw, 0] });
      b.add(geo.cylinder(0.075, 0.1, 4.25, round), { color: palette.steel, pos: [x, y + 0.4, z], id: post });
      b.add(geo.cylinder(0.15, 0.15, 0.1, round), { color: palette.verdigris, pos: [x, y + 0.42, z] });
      b.add(geo.cylinder(0.12, 0.12, 0.09, round), { color: palette.verdigris, pos: [x, y + 3.25, z] });
      // The arm leans out over the street and carries the globe.
      const ax = x - nx * 0.62, az = z - nz * 0.62;
      b.add(geo.tube([[x, y + 4.5, z], [x - nx * 0.22, y + 4.86, z - nz * 0.22], [ax, y + 4.9, az]], 0.05, { radial: 5, perSpan: low ? 2 : 3 }), { color: palette.steel, id: post });
      b.add(geo.cone(0.26, 0.2, round), { color: palette.verdigris, pos: [ax, y + 4.82, az] });
      b.add(geo.sphere(0.23, round, low ? 4 : 5), { color: C_GLOBE, pos: [ax, y + 4.66, az], flat: 0.85 });
      // The plate, hung from two brackets on the grass side.
      const cx = x + nx * 0.74, cz = z + nz * 0.74;
      const plate = b.newId();
      b.add(geo.box(1.34, 0.045, 0.045), { color: palette.steel, pos: [x + nx * 0.6, y + 2.96, z + nz * 0.6], rot: [0, yaw, 0], id: post });
      b.add(geo.bevelBox(1.12, 0.6, 0.09, 0.03), { color: palette.marble, pos: [cx, y + 2.34, cz], rot: [0, yaw, 0], id: plate });
      const text = String(stone.year);
      b.label({ text, size: 0.3, pos: [cx + fx * 0.05, y + 2.64, cz + fz * 0.05], rot: [0, yaw, 0], plate: palette.marble, id: plate, jitter: 0.25, pad: 0.3 });
      b.label({ text, size: 0.3, pos: [cx - fx * 0.05, y + 2.64, cz - fz * 0.05], rot: [0, yaw + Math.PI, 0], plate: palette.marble, id: plate, jitter: 0.25, pad: 0.3 });
    }
  }
  // A street sign where each side street leaves its plaza: a pole and a blade naming where it goes.
  for (const leg of LEGS) {
    const p = PATHS[leg.road];
    if (p.kind !== 'branch' || leg.sFrom !== p.stops[0].s) continue;
    const to = p.stops[p.stops.length - 1].site;
    roadPoint(p.index, leg.s0 + 5.2, rp);
    const side = -(p.width / 2 + SIDEWALK.branch - 0.28);
    const nx = -rp.tz, nz = rp.tx;
    const x = rp.x + nx * side, z = rp.z + nz * side;
    const y = rp.h + WALK_LIFT;
    // The blade hangs square to the street on the grass side, so it reads on the way out and on the way back.
    const yaw = Math.atan2(-rp.tx, -rp.tz);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const tone = THREAD_COLORS[to.thread];
    const ink = to.thread === 'life' ? undefined : palette.marble;
    b.add(geo.cylinder(0.13, 0.15, 0.16, round), { color: palette.marble, pos: [x, y, z] });
    b.add(geo.cylinder(0.055, 0.065, 3.45, round), { color: palette.steel, pos: [x, y + 0.14, z] });
    b.add(geo.sphere(0.1, round, 4), { color: palette.verdigris, pos: [x, y + 3.62, z] });
    const text = to.name.replace(/^The /, '').toUpperCase();
    const size = Math.min(0.23, 1.5 / Math.max(1, text.length * 0.78));
    const bx = x - nx * 1.02, bz = z - nz * 1.02;
    const id = b.newId();
    b.add(geo.bevelBox(1.9, 0.44, 0.06, 0.02), { color: tone, pos: [bx, y + 2.9, bz], rot: [0, yaw, 0], id });
    b.add(geo.box(0.16, 0.5, 0.1), { color: palette.steel, pos: [x - nx * 0.04, y + 2.87, z - nz * 0.04], rot: [0, yaw, 0] });
    b.label({ text, size, pos: [bx + fx * 0.035, y + 3.12, bz + fz * 0.035], rot: [0, yaw, 0], plate: tone, ink, id, jitter: 0.25, pad: 0.2 });
    b.label({ text, size, pos: [bx - fx * 0.035, y + 3.12, bz - fz * 0.035], rot: [0, yaw + Math.PI, 0], plate: tone, ink, id, jitter: 0.25, pad: 0.2 });
  }
  // A marble balustrade along a few stretches of the rim: posts, a rail, a low kerb.
  const railId = b.newId();
  const runs: [number, number][] = low ? [[0.4, 0.4], [3.6, 0.35]] : [[0.4, 0.5], [2.0, 0.34], [3.6, 0.42], [5.1, 0.3]];
  for (const [start, sweep] of runs) {
    const bays = Math.round((sweep * WORLD_RADIUS) / 5.4);
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i <= bays; i++) {
      const t = start + (sweep * i) / bays;
      const r = rimRadius(Math.cos(t) * 100, Math.sin(t) * 100) - 1.6;
      const x = Math.cos(t) * r, z = Math.sin(t) * r;
      const y = heightAt(x, z) - 0.1;
      b.add(geo.box(0.36, 1.12, 0.36), { color: palette.marble, pos: [x, y, z], rot: [0, -t, 0], id: railId });
      if (i > 0) {
        const dx = x - px, dy = y - py, dz = z - pz;
        const len = Math.hypot(dx, dz);
        const yaw = Math.atan2(-dz, dx);
        const tilt = Math.atan2(dy, len);
        const mx = (x + px) / 2, mz = (z + pz) / 2, my = (y + py) / 2;
        b.add(geo.box(1, 0.12, 0.2), { color: palette.marble, pos: [mx, my + 0.9, mz], rot: [0, yaw, tilt], scale: [Math.hypot(len, dy), 1, 1], id: railId });
        b.add(geo.box(1, 0.1, 0.14), { color: palette.marbleShade, pos: [mx, my + 0.42, mz], rot: [0, yaw, tilt], scale: [Math.hypot(len, dy), 1, 1], id: railId });
      }
      px = x; py = y; pz = z;
    }
  }
  const tris = b.triangles();
  group.add(b.build('markers'));
  return tris;
}

// ---------------------------------------------------------------------------------------------
// Everything
// ---------------------------------------------------------------------------------------------

/** The island: lawn in nine chunks, the cut face under it, the buried pipes and tunnel mouths, one mesh of
 *  streets, plazas and painted lawn, and one of year lamps, street signs and the rim railing.
 *  Thirteen draw calls. Lettering needs `await kit.ready` first. */
export function buildTerrain(kit: InkKit, tier: QualityTier): { group: THREE.Group; triangles: number } {
  const group = new THREE.Group();
  group.name = 'terrain';
  let triangles = buildGround(kit, tier, group);
  triangles += buildSkirt(kit, tier, group);
  triangles += buildUnderside(kit, tier, group);
  const raw = new Raw();
  buildStreets(kit, raw, tier);
  buildPlazas(kit, raw, tier);
  buildDecals(raw, tier);
  triangles += raw.triangles;
  group.add(raw.mesh(kit, 'streets'));
  triangles += buildMarkers(kit, tier, group);
  return { group, triangles };
}

/** Numbers for the test page: steepest grade along each road and the worst bump on each pad. */
export function surveyTerrain(): { roads: { id: string; length: number; maxSlopeDeg: number; maxCrossDeg: number }[]; pads: { id: DistrictId; maxError: number }[] } {
  const roads = PATHS.map((p) => {
    let worst = 0;
    let cross = 0;
    const a: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 0 };
    let prev = NaN;
    for (let s = 0; s <= p.length; s += 0.5) {
      roadPoint(p.index, s, a);
      const h = heightAt(a.x, a.z);
      if (!Number.isNaN(prev)) worst = Math.max(worst, Math.abs(h - prev) / 0.5);
      prev = h;
      const e = p.width / 2;
      const l = heightAt(a.x - a.tz * e, a.z + a.tx * e);
      const r = heightAt(a.x + a.tz * e, a.z - a.tx * e);
      cross = Math.max(cross, Math.abs(l - r) / (2 * e));
    }
    return { id: ROADS[p.index].id, length: +p.length.toFixed(1), maxSlopeDeg: +((Math.atan(worst) * 180) / Math.PI).toFixed(2), maxCrossDeg: +((Math.atan(cross) * 180) / Math.PI).toFixed(2) };
  });
  const pads = SITES.map((site) => {
    let maxError = 0;
    const r = site.radius * PAD_FLAT;
    for (let i = 0; i < 4000; i++) {
      const a = i * 2.39996, d = r * Math.sqrt((i + 0.5) / 4000) * 0.9999;
      maxError = Math.max(maxError, Math.abs(heightAt(site.center.x + Math.cos(a) * d, site.center.z + Math.sin(a) * d) - site.height));
    }
    return { id: site.id, maxError };
  });
  return { roads, pads };
}
