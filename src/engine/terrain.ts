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

/** Road ribbons stop this far (as a share of the pad radius) from a district centre. */
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
      for (let amp = 0; amp <= 16; amp += 0.5) {
        let len = 0;
        for (let i = i0; i <= i1; i++) {
          const u = (i - i0) / span;
          const off = side * amp * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u);
          const tx = ox[Math.min(m - 1, i + 1)] - ox[Math.max(0, i - 1)];
          const tz = oz[Math.min(m - 1, i + 1)] - oz[Math.max(0, i - 1)];
          const tl = Math.hypot(tx, tz) || 1;
          fx[i] = ox[i] - (tz / tl) * off;
          fz[i] = oz[i] + (tx / tl) * off;
          if (i > i0) len += Math.hypot(fx[i] - fx[i - 1], fz[i] - fz[i - 1]);
        }
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

/** Where the mesa ends, by compass angle. Never closer in than WORLD_RADIUS - 4. */
export function rimRadius(x: number, z: number): number {
  const a = Math.atan2(z, x);
  return WORLD_RADIUS + 4 + 4 * Math.sin(3 * a + 1.3) + 2.5 * Math.sin(7 * a + 0.4) + 1.5 * Math.sin(12 * a + 2.1);
}

/** True where a visitor may stand: on the mesa, a few steps back from the edge. */
export function inBounds(x: number, z: number): boolean {
  const r2 = x * x + z * z;
  if (r2 < (WORLD_RADIUS - 8) * (WORLD_RADIUS - 8)) return true;
  return Math.sqrt(r2) < rimRadius(x, z) - 3;
}

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
    if (d2 <= f * f) return SH[i];
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

  // Wild ground: a broad swell that carries the district heights, dunes on top, calmer beside a road.
  const calm = 0.22 + 0.78 * smoothstep(5, ROAD_REACH, near);
  let h = hsum / wsum;
  h += gfbm(x * 0.0105 + 3.1, z * 0.0105 - 1.7, 3, 11) * 4.2 * calm;
  const shelf = gnoise2(x * 0.0062 - 4.2, z * 0.0062 + 9.3, 23);
  h += smoothstep(0.12, 0.3, shelf) * 3.2 * calm;
  if (BONE >= 0) {
    // A raised lip around the Boneyard so it sits in a bowl.
    const d = Math.hypot(x - SX[BONE], z - SZ[BONE]) - SBLEND[BONE] * 1.12;
    h += 3.4 * Math.exp(-(d * d) / 150);
  }

  if (padW > 0) h += (padH - h) * padW;
  if (roadW > 0) h += (roadH - h) * roadW * fade;

  // Past the rim the mesa drops away.
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

const C_LIGHT = rgb(palette.sandLight);
const C_DEEP = rgb(palette.sandDeep);
const C_ROCK = rgb(palette.rock);
// Three flat sands. Neighbouring bands never share one, so every contour is a change of colour too.
const C_BANDS: RGB[] = [rgb(palette.sand), rgb('#f6d8b4'), rgb('#e9b98f')];
const C_PAD = SITES.map((s) => mix3([0, 0, 0], rgb('#fbe9cf'), rgb(s.accents[0]), 0.13));
const hit: RoadHit = { road: -1, dist: Infinity, s: 0, height: 0, width: 0 };

const BAND_PER_METRE = 0.19;

/** Which contour band a point is in: the whole part picks the band, crossings are the drawn lines.
 *  Pads pull toward one value so no line cuts across a district floor. */
function bandValue(x: number, z: number, h: number): number {
  let v = h * BAND_PER_METRE + gfbm(x * 0.017 + 7.7, z * 0.017 + 2.2, 2, 5) * 1.25;
  for (let i = 0; i < NS; i++) {
    const d = Math.hypot(x - SX[i], z - SZ[i]);
    if (d < SBLEND[i]) {
      const home = Math.floor(SH[i] * BAND_PER_METRE) + 0.5;
      v += (home - v) * (1 - smoothstep(SFLAT[i] * 1.04, SBLEND[i], d));
    }
  }
  return v;
}

// What lies over the band colour at a point, as `colour = band * keep + add`.
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
  // Sun-bleached blotches.
  const blotch = noise2(x * 0.045 + 31, z * 0.045 - 12, 9);
  lay(C_LIGHT, smoothstep(0.66, 0.8, blotch) * 0.35);
  // Banks and dune faces go deeper.
  lay(C_DEEP, smoothstep(0.2, 0.46, slope) * 0.8);
  lay(C_ROCK, smoothstep(0.5, 1.0, slope) * 0.7);
  // The rim is rockier.
  const r = Math.hypot(x, z);
  if (r > WORLD_RADIUS - 34) lay(C_ROCK, smoothstep(30, 2, rimRadius(x, z) - r) * 0.6);
  // Road dust.
  roadInfo(x, z, hit);
  if (hit.road >= 0) lay(C_LIGHT, (1 - smoothstep(hit.width * 0.5, hit.width * 0.5 + 5, hit.dist)) * 0.55);
  // Pads: paler, with a breath of the district's colour.
  for (let i = 0; i < NS; i++) {
    const d = Math.hypot(x - SX[i], z - SZ[i]);
    if (d < SBLEND[i]) lay(C_PAD[i], 1 - smoothstep(SFLAT[i] * 0.94, SBLEND[i] * 0.92, d));
  }
}

const TIER_STEP: Record<QualityTier, number> = { high: 2.5, medium: 3.3, low: 4.5 };
const EXTENT = 252;
const CHUNKS = 3;

// One corner of a ground triangle while it is being cut along the contours.
const F = 12; // x y z nx ny nz hatch keep r g b band
const polyA = new Float64Array(F * 12);
const polyB = new Float64Array(F * 12);
const polyC = new Float64Array(F * 12);

/** Keep the part of a polygon on one side of a band level. Returns the new corner count. */
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
    if (r >= rim) {
      // Pull the outside corners onto the rim so the ground ends on a clean edge, and read the
      // height a hair inside, where the ground has not started to fall.
      x *= rim / r;
      z *= rim / r;
      sx = x * 0.9999;
      sz = z * 0.9999;
    }
    const h = heightAt(sx, sz);
    const e = 1.1;
    const gx = (heightAt(sx + e, sz) - heightAt(sx - e, sz)) / (2 * e);
    const gz = (heightAt(sx, sz + e) - heightAt(sx, sz - e)) / (2 * e);
    const slope = inside[k] ? Math.hypot(gx, gz) : 0;
    const nl = Math.hypot(gx, 1, gz);
    // Sink the ground a little under the road slabs so it never pokes through them.
    roadInfo(sx, sz, hit);
    let y = h;
    if (hit.road >= 0 && ribbonHere(hit.road, hit.s)) {
      const hw = hit.width * 0.5;
      y -= 0.24 * (1 - smoothstep(hw + size, hw + size + 2.5, hit.dist));
    }
    groundTint(sx, sz, slope);
    data[o] = x; data[o + 1] = y; data[o + 2] = z;
    data[o + 3] = inside[k] ? -gx / nl : 0; data[o + 4] = inside[k] ? 1 / nl : 1; data[o + 5] = inside[k] ? -gz / nl : 0;
    data[o + 6] = smoothstep(0.6, 1.2, slope) * 0.4;
    data[o + 7] = tint.keep; data[o + 8] = tint.r; data[o + 9] = tint.g; data[o + 10] = tint.b;
    data[o + 11] = bandValue(sx, sz, h);
    return o;
  };
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      const x = -EXTENT + i * size, z = -EXTENT + j * size;
      if (Math.hypot(x, z) < rimRadius(x, z)) inside[j * w + i] = 1;
    }
  }
  // One id per band colour: where two bands meet the ids differ and the ink pass draws the contour.
  const ids = [idByte(kit), idByte(kit), idByte(kit)];
  const color: RGB = [0, 0, 0];
  let total = 0;
  for (let cj = 0; cj < CHUNKS; cj++) {
    for (let ci = 0; ci < CHUNKS; ci++) {
      const raw = new Raw();
      const shared = new Map<number, number>();
      const put = (src: Float64Array, o: number, band: number): number => {
        const m = ((band % 3) + 3) % 3;
        const c = C_BANDS[m];
        const keep = src[o + 7];
        color[0] = c[0] * keep + src[o + 8];
        color[1] = c[1] * keep + src[o + 9];
        color[2] = c[2] * keep + src[o + 10];
        return raw.vert(src[o], src[o + 1], src[o + 2], src[o + 3], src[o + 4], src[o + 5], color, ids[m], 0, src[o + 6]);
      };
      const use = (k: number, band: number): number => {
        const key = k * 64 + ((band + 32) & 63);
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
        // The triangle straddles a contour: cut it into one piece per band.
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

/** Road slabs run between districts and stop short of each centre. True where one is drawn. */
function ribbonHere(road: number, s: number): boolean {
  const p = PATHS[road];
  for (const stop of p.stops) {
    if (Math.abs(s - stop.s) < stop.site.radius * ROAD_END) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// The cliff under the rim
// ---------------------------------------------------------------------------------------------

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
const STRATA_COLORS = ['#e9a586', palette.cliff, palette.rockDeep, palette.cliff, palette.rock, palette.cliff, palette.rockDeep, '#a84236', '#9c3f45', '#8c3c50', '#7c3a5a', '#6e3862', '#623668'];

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
  // A lid just under the ground's edge, so a hairline gap there shows rock and not sky.
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
    const hatch = k < 2 ? 0.1 : k < 7 ? 0.3 : 0.5;
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
    raw.face(px[last + i], py[last + i], pz[last + i], px[last + j], py[last + j], pz[last + j], 6, lowest - TIP_DEPTH, -8, tipC, tipId, 0, 0.5);
  }
  group.add(raw.mesh(kit, 'cliff'));
  return raw.triangles;
}

// ---------------------------------------------------------------------------------------------
// Roads, and cracks in the ground
// ---------------------------------------------------------------------------------------------

const ROAD_LIFT = 0.05;
const C_ROAD = rgb('#fcf1dd');
const C_KERB = rgb('#e3b592');
const C_CORAL = rgb(THREAD_COLORS.people);
const C_TEAL = rgb(THREAD_COLORS.tech);
const C_BOTH = rgb(THREAD_COLORS.both);
const LINE_HALF = 0.17;
const LINE_APART = 0.5;
/** Metres before the Observatory end of the spine over which the two lines become one. */
export const MERGE_LENGTH = 48;

const rp: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };

function buildRoads(kit: InkKit, raw: Raw): void {
  const id = idByte(kit);
  const cA: RGB = [0, 0, 0];
  const cB: RGB = [0, 0, 0];
  for (const p of PATHS) {
    const hw = p.width / 2;
    const lineC = rgb(THREAD_COLORS[p.stops[p.stops.length - 1].site.thread]);
    for (let k = 0; k < p.stops.length - 1; k++) {
      const A = p.stops[k], B = p.stops[k + 1];
      const s0 = A.s + A.site.radius * ROAD_END;
      const s1 = B.s - B.site.radius * ROAD_END;
      const merge = p.kind === 'spine' && B.site.id === 'observatory';
      const count = Math.max(2, Math.ceil((s1 - s0) / 1.5));
      // offsets across the road, left to right, and the colour of the strip that starts at each
      let prev: number[] | null = null;
      for (let i = 0; i <= count; i++) {
        const s = s0 + ((s1 - s0) * i) / count;
        roadPoint(p.index, s, rp);
        const nx = -rp.tz, nz = rp.tx;
        const y = rp.h + ROAD_LIFT;
        let offs: number[];
        let cols: RGB[];
        if (p.kind === 'spine') {
          let apart = LINE_APART, half = LINE_HALF, blend = 0;
          if (merge) {
            const t = 1 - Math.min(1, (s1 - s) / MERGE_LENGTH);
            apart = LINE_APART + (LINE_HALF - LINE_APART) * smoothstep(0, 0.6, t);
            blend = smoothstep(0.55, 0.8, t);
            half = LINE_HALF - 0.05 * blend;
            apart -= 0.05 * blend;
          }
          mix3(cA, C_CORAL, C_BOTH, blend);
          mix3(cB, C_TEAL, C_BOTH, blend);
          offs = [-hw, -apart - half, -apart + half, apart - half, apart + half, hw];
          cols = [C_ROAD, [cA[0], cA[1], cA[2]], C_ROAD, [cB[0], cB[1], cB[2]], C_ROAD];
        } else {
          offs = [-hw, -LINE_HALF, LINE_HALF, hw];
          cols = [C_ROAD, lineC, C_ROAD];
        }
        const row: number[] = [];
        // kerb down the left side, the strips, kerb down the right
        const lx = rp.x + nx * offs[0], lz = rp.z + nz * offs[0];
        const rx = rp.x + nx * offs[offs.length - 1], rz = rp.z + nz * offs[offs.length - 1];
        row.push(raw.vert(lx, y - 0.45, lz, -nx, 0, -nz, C_KERB, id), raw.vert(lx, y, lz, -nx, 0, -nz, C_KERB, id));
        for (let c = 0; c < cols.length; c++) {
          row.push(
            raw.vert(rp.x + nx * offs[c], y, rp.z + nz * offs[c], 0, 1, 0, cols[c], id),
            raw.vert(rp.x + nx * offs[c + 1], y, rp.z + nz * offs[c + 1], 0, 1, 0, cols[c], id),
          );
        }
        row.push(raw.vert(rx, y, rz, nx, 0, nz, C_KERB, id), raw.vert(rx, y - 0.45, rz, nx, 0, nz, C_KERB, id));
        if (prev) {
          for (let c = 0; c < row.length; c += 2) {
            raw.tri(prev[c], prev[c + 1], row[c]);
            raw.tri(prev[c + 1], row[c + 1], row[c]);
          }
        }
        prev = row;
      }
    }
  }
}

const C_CRACK = rgb('#9a6672');
const NO_EDGE = 255;

function crackPatch(raw: Raw, cx: number, cz: number, radius: number, seed: number): void {
  const a = 1.9;
  const w = a * 0.866, hh = a * 1.5, q = a * 0.25;
  const half = 0.06;
  const n = Math.ceil(radius / w) + 1;
  const m = Math.ceil(radius / hh) + 1;
  const vx = (i: number, j: number) => cx + i * w + (hash2(i, j, seed) - 0.5) * a * 0.55;
  const vz = (i: number, j: number) => cz + j * hh + ((i + j) & 1 ? q : -q) + (hash2(i, j, seed + 1) - 0.5) * a * 0.55;
  const edge = (i0: number, j0: number, i1: number, j1: number) => {
    const x0 = vx(i0, j0), z0 = vz(i0, j0), x1 = vx(i1, j1), z1 = vz(i1, j1);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const d = Math.hypot(mx - cx, mz - cz) / radius;
    // Plates thin out toward the edge of a patch.
    if (d > 1 || hash2(i0 * 3 + i1, j0 * 3 + j1, seed + 2) < 0.12 + d * d * 0.75) return;
    if (!inBounds(mx, mz) || Math.hypot(mx, mz) > WORLD_RADIUS - 6) return;
    roadInfo(mx, mz, hit);
    if (hit.road >= 0 && hit.dist < hit.width * 0.5 + 0.8) return;
    for (let s = 0; s < NS; s++) if (Math.hypot(mx - SX[s], mz - SZ[s]) < SITES[s].radius * 1.03) return;
    const ex = x1 - x0, ez = z1 - z0;
    const l = Math.hypot(ex, ez) || 1;
    const px = (-ez / l) * half, pz = (ex / l) * half;
    const y0 = heightAt(x0, z0) + 0.035, y1 = heightAt(x1, z1) + 0.035;
    const A = raw.vert(x0 - px, y0, z0 - pz, 0, 1, 0, C_CRACK, NO_EDGE, 1);
    const B = raw.vert(x0 + px, y0, z0 + pz, 0, 1, 0, C_CRACK, NO_EDGE, 1);
    const C = raw.vert(x1 - px, y1, z1 - pz, 0, 1, 0, C_CRACK, NO_EDGE, 1);
    const D = raw.vert(x1 + px, y1, z1 + pz, 0, 1, 0, C_CRACK, NO_EDGE, 1);
    raw.tri(A, B, C);
    raw.tri(B, D, C);
  };
  for (let j = -m; j <= m; j++) {
    for (let i = -n; i <= n; i++) {
      edge(i, j, i + 1, j);
      if ((i + j) & 1) edge(i, j, i, j + 1);
    }
  }
}

function buildCracks(raw: Raw, tier: QualityTier): void {
  const next = rng(20170);
  const patches = tier === 'high' ? 64 : tier === 'medium' ? 40 : 18;
  for (let i = 0; i < patches; i++) {
    let x: number, z: number;
    if (i % 4 !== 3) {
      // Most patches lie beside a road, where a walker meets them.
      const p = PATHS[Math.floor(next() * NR)];
      roadPoint(p.index, next() * p.length, rp);
      const side = (next() < 0.5 ? -1 : 1) * (p.width / 2 + 2 + next() * 22);
      x = rp.x - rp.tz * side;
      z = rp.z + rp.tx * side;
    } else {
      const a = next() * Math.PI * 2, r = Math.sqrt(next()) * (WORLD_RADIUS - 20);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    crackPatch(raw, x, z, 7 + next() * 7, 100 + i * 7);
  }
}

// ---------------------------------------------------------------------------------------------
// Year stones and fingerposts
// ---------------------------------------------------------------------------------------------

const ARM: [number, number][] = [[-1.0, -0.22], [0.72, -0.22], [1.02, 0], [0.72, 0.22], [-1.0, 0.22]];

function buildMarkers(kit: InkKit, group: THREE.Group): number {
  const b = kit.builder();
  const spine = PATHS.find((p) => p.kind === 'spine');
  if (spine) {
    for (const stone of YEAR_STONES) {
      const k = spine.stops.findIndex((s) => s.site.id === stone.at);
      if (k < 0) continue;
      const stop = spine.stops[k];
      // On the way in, just before the pad. The first stone has no way in, so it stands on the way out.
      const s = k === 0 ? stop.s + stop.site.radius * 1.1 : stop.s - stop.site.radius * 1.1;
      roadPoint(spine.index, s, rp);
      const side = spine.width / 2 + 1.5;
      const x = rp.x - rp.tz * side, z = rp.z + rp.tx * side;
      const y = heightAt(x, z);
      // Face the walker coming up the road, turned a little toward the road.
      const yaw = Math.atan2(-rp.tx, -rp.tz) - 0.35;
      const id = b.newId();
      b.add(geo.bevelBox(1.5, 0.22, 0.8, 0.05), { color: palette.stoneShade, pos: [x, y - 0.04, z], rot: [0, yaw, 0] });
      b.add(geo.bevelBox(1.12, 1.25, 0.4, 0.1), { color: palette.stone, pos: [x, y + 0.14, z], rot: [0, yaw, 0], id });
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const text = String(stone.year);
      b.label({ text, size: 0.36, pos: [x + fx * 0.2, y + 0.8, z + fz * 0.2], rot: [0, yaw, 0], plate: palette.stone, id, jitter: 0.3 });
      b.label({ text, size: 0.36, pos: [x - fx * 0.2, y + 0.8, z - fz * 0.2], rot: [0, yaw + Math.PI, 0], plate: palette.stone, id, jitter: 0.3 });
    }
  }
  for (const p of PATHS) {
    if (p.kind !== 'branch') continue;
    const from = p.stops[0];
    const to = p.stops[p.stops.length - 1];
    roadPoint(p.index, from.s + from.site.radius * 1.08, rp);
    const side = -(p.width / 2 + 1.3);
    const x = rp.x - rp.tz * side, z = rp.z + rp.tx * side;
    const y = heightAt(x, z);
    // The board's long side runs along the road and its point aims where the road goes.
    const yaw = Math.atan2(-rp.tz, rp.tx);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const wood = '#8a5a3a';
    b.add(geo.cylinder(0.07, 0.09, 2.9, 7), { color: wood, pos: [x, y - 0.1, z] });
    b.add(geo.cone(0.11, 0.22, 7), { color: THREAD_COLORS[to.site.thread], pos: [x, y + 2.78, z] });
    const id = b.newId();
    const bx = x + rp.tx * 0.55, bz = z + rp.tz * 0.55;
    b.add(geo.extrude(ARM, 0.08, { cacheKey: 'fingerpost-arm' }), { color: palette.stone, pos: [bx, y + 2.3, bz], rot: [0, yaw, 0], id });
    const text = to.site.name.replace(/^The /, '').toUpperCase();
    const size = Math.min(0.2, 1.25 / Math.max(1, text.length * 0.78));
    b.label({ text, size, pos: [bx - rp.tx * 0.12 + fx * 0.045, y + 2.3, bz - rp.tz * 0.12 + fz * 0.045], rot: [0, yaw, 0], plate: palette.stone, id, jitter: 0.3, pad: 0.2 });
    b.label({ text, size, pos: [bx - rp.tx * 0.12 - fx * 0.045, y + 2.3, bz - rp.tz * 0.12 - fz * 0.045], rot: [0, yaw + Math.PI, 0], plate: palette.stone, id, jitter: 0.3, pad: 0.2 });
  }
  const tris = b.triangles();
  const mesh = b.build('markers');
  group.add(mesh);
  return tris;
}

// ---------------------------------------------------------------------------------------------
// Everything
// ---------------------------------------------------------------------------------------------

/** The mesa: ground in nine chunks, the cliff, road slabs with their thread lines, year stones, fingerposts.
 *  Twelve draw calls. Lettering needs `await kit.ready` first. */
export function buildTerrain(kit: InkKit, tier: QualityTier): { group: THREE.Group; triangles: number } {
  const group = new THREE.Group();
  group.name = 'terrain';
  let triangles = buildGround(kit, tier, group);
  triangles += buildSkirt(kit, tier, group);
  const raw = new Raw();
  buildRoads(kit, raw);
  buildCracks(raw, tier);
  triangles += raw.triangles;
  group.add(raw.mesh(kit, 'roads'));
  triangles += buildMarkers(kit, group);
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
