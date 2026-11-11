// Shapes for the figure. Nearly all of him is lofted: rings stacked along y, each ring a rounded
// box of its own width, depth and squareness, with a smooth curve run through the rings I give.
// Angle 0 is his back (+z), a quarter turn is his right (+x), a half turn is his front (-z).
import * as THREE from 'three';

export interface Ring {
  y: number;
  rx: number;
  rz: number;
  x?: number;
  z?: number;
  /** 2 is an ellipse. Higher is squarer. */
  n?: number;
  /** Depth of the front half as a multiple of rz. */
  f?: number;
  /** Depth of the back half as a multiple of rz. */
  b?: number;
  /** The ring tips: this much higher at the back, lower at the front. Metres. */
  ty?: number;
  /** And this much higher at his right. */
  tx?: number;
  /** Wider at the back (positive) or at the front (negative), as a share of rx. */
  e?: number;
}

type Full = Required<Ring>;
const FIELDS: readonly (keyof Full)[] = ['y', 'rx', 'rz', 'x', 'z', 'n', 'f', 'b', 'ty', 'tx', 'e'];
const full = (r: Ring): Full => ({ y: r.y, rx: r.rx, rz: r.rz, x: r.x ?? 0, z: r.z ?? 0, n: r.n ?? 2, f: r.f ?? 1, b: r.b ?? 1, ty: r.ty ?? 0, tx: r.tx ?? 0, e: r.e ?? 0 });

const TAU = Math.PI * 2;

/** A smooth curve through evenly numbered values that never overshoots them. */
function tangents(v: readonly number[]): number[] {
  const n = v.length;
  const m = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const d0 = i > 0 ? v[i] - v[i - 1] : v[1] - v[0];
    const d1 = i < n - 1 ? v[i + 1] - v[i] : v[n - 1] - v[n - 2];
    m[i] = d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1);
  }
  return m;
}

function hermite(a: number, b: number, ma: number, mb: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * ma + (-2 * t3 + 3 * t2) * b + (t3 - t2) * mb;
}

export interface LoftOpts {
  /** Longest gap between rings, metres. Rings are added between the ones given until none is longer. Default: none added. */
  step?: number;
  /** Open loft: only this arc of the round, radians. */
  from?: number;
  to?: number;
  /** Bend the finished surface: called for every point on it, before the normals are worked out. */
  warp?: (p: THREE.Vector3) => void;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

export class Loft {
  readonly rings: Full[];
  readonly seg: number;
  readonly cols: number;
  readonly closed: boolean;
  readonly from: number;
  readonly to: number;
  private pos: Float32Array;
  private nor: Float32Array;
  private bend: ((p: THREE.Vector3) => void) | undefined;

  constructor(keys: readonly Ring[], seg: number, o: LoftOpts = {}) {
    const ks = keys.map(full);
    this.seg = Math.max(3, Math.round(seg));
    this.closed = o.from === undefined && o.to === undefined;
    this.from = o.from ?? 0;
    this.to = o.to ?? TAU;
    this.cols = this.closed ? this.seg : this.seg + 1;
    this.bend = o.warp;
    // Fill in between the rings given.
    const step = o.step ?? Infinity;
    const rings: Full[] = [];
    if (ks.length < 2 || !Number.isFinite(step)) rings.push(...ks);
    else {
      const tan: Partial<Record<keyof Full, number[]>> = {};
      for (const f of FIELDS) tan[f] = tangents(ks.map((k) => k[f]));
      for (let i = 0; i < ks.length - 1; i++) {
        const a = ks[i];
        const b = ks[i + 1];
        const d = Math.hypot(b.y - a.y, Math.max(Math.abs(b.rx - a.rx), Math.abs(b.rz - a.rz)));
        const n = Math.max(1, Math.ceil(d / step - 0.25));
        for (let s = 0; s < n; s++) {
          const t = s / n;
          const r = {} as Full;
          for (const f of FIELDS) r[f] = s === 0 ? a[f] : hermite(a[f], b[f], tan[f]![i], tan[f]![i + 1], t);
          rings.push(r);
        }
      }
      rings.push(ks[ks.length - 1]);
    }
    this.rings = rings;

    const rows = rings.length;
    const cols = this.cols;
    this.pos = new Float32Array(rows * cols * 3);
    this.nor = new Float32Array(rows * cols * 3);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        ringPoint(rings[j], this.angle(i), 0, _p);
        if (this.bend) this.bend(_p);
        this.pos.set([_p.x, _p.y, _p.z], (j * cols + i) * 3);
      }
    }
    // Smooth normals from the grid itself.
    const P = this.pos;
    const at = (j: number, i: number, out: THREE.Vector3): THREE.Vector3 => {
      const o3 = (j * cols + i) * 3;
      return out.set(P[o3], P[o3 + 1], P[o3 + 2]);
    };
    const du = new THREE.Vector3();
    const dv = new THREE.Vector3();
    const nn = new THREE.Vector3();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const i0 = this.closed ? (i + cols - 1) % cols : Math.max(0, i - 1);
        const i1 = this.closed ? (i + 1) % cols : Math.min(cols - 1, i + 1);
        at(j, i1, du).sub(at(j, i0, _q));
        at(Math.min(rows - 1, j + 1), i, dv).sub(at(Math.max(0, j - 1), i, _q));
        nn.crossVectors(du, dv);
        if (nn.lengthSq() < 1e-14) {
          // A ring pinched to a point: face away from the ring next to it.
          const o = j === 0 ? 1 : j - 1;
          nn.set(rings[j].x - rings[o].x, rings[j].y - rings[o].y, rings[j].z - rings[o].z);
          if (nn.lengthSq() < 1e-14) nn.set(0, j === 0 ? -1 : 1, 0);
        }
        nn.normalize();
        this.nor.set([nn.x, nn.y, nn.z], (j * cols + i) * 3);
      }
    }
  }

  angle(i: number): number {
    return this.from + ((this.to - this.from) * i) / this.seg;
  }

  /** Ring number (with a fraction) whose height is y. The first match going up from `start`. */
  tAtY(y: number, start = 0): number {
    const r = this.rings;
    for (let j = Math.floor(start); j < r.length - 1; j++) {
      const a = r[j].y;
      const b = r[j + 1].y;
      if ((y >= a && y <= b) || (y <= a && y >= b)) return j + (b === a ? 0 : (y - a) / (b - a));
    }
    return y < r[0].y ? 0 : r.length - 1;
  }

  private ringT(t: number): Full {
    const r = this.rings;
    const j = Math.min(r.length - 2, Math.max(0, Math.floor(t)));
    const k = Math.min(1, Math.max(0, t - j));
    const a = r[j];
    const b = r[j + 1];
    const out = {} as Full;
    for (const f of FIELDS) out[f] = a[f] + (b[f] - a[f]) * k;
    return out;
  }

  /** A point on the surface at angle a and height y, lifted off it. */
  pointAY(a: number, y: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
    ringPoint(this.ringT(this.tAtY(y)), a, lift, out);
    if (this.bend) this.bend(out);
    return out;
  }

  /** A point on the back (side = 1) or front (side = -1) of the surface, straight behind or in front of (x, y). */
  pointXY(side: number, x: number, y: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
    const r = this.ringT(this.tAtY(y));
    const rx = r.rx + lift;
    const rz = (r.rz + lift) * (side > 0 ? r.b : r.f);
    const u = Math.min(0.999, Math.abs((x - r.x) / rx));
    const z = rz * Math.pow(1 - Math.pow(u, r.n), 1 / r.n);
    out.set(x, y, r.z + side * z);
    if (this.bend) this.bend(out);
    return out;
  }

  /** The quads that `pick` says yes to (all of them without it), as one geometry with the loft's smooth normals. */
  geometry(pick?: (row: number, col: number, angle: number, y: number) => boolean): THREE.BufferGeometry {
    const rows = this.rings.length;
    const cols = this.cols;
    const map = new Int32Array(rows * cols).fill(-1);
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const use = (v: number): number => {
      if (map[v] < 0) {
        map[v] = pos.length / 3;
        pos.push(this.pos[v * 3], this.pos[v * 3 + 1], this.pos[v * 3 + 2]);
        nor.push(this.nor[v * 3], this.nor[v * 3 + 1], this.nor[v * 3 + 2]);
      }
      return map[v];
    };
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < this.seg; i++) {
        const mid = this.from + ((this.to - this.from) * (i + 0.5)) / this.seg;
        if (pick && !pick(j, i, mid, (this.rings[j].y + this.rings[j + 1].y) / 2)) continue;
        const i1 = this.closed ? (i + 1) % this.seg : i + 1;
        const a = use(j * cols + i);
        const b = use(j * cols + i1);
        const c = use((j + 1) * cols + i);
        const d = use((j + 1) * cols + i1);
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  }

  /** A flat lid on the first ring (looking down) or the last (looking up). */
  cap(top: boolean): THREE.BufferGeometry {
    const r = this.rings[top ? this.rings.length - 1 : 0];
    const pos: number[] = [r.x, r.y, r.z];
    const idx: number[] = [];
    for (let i = 0; i < this.seg; i++) {
      ringPoint(r, (TAU * i) / this.seg, 0, _p);
      if (this.bend) this.bend(_p);
      pos.push(_p.x, _p.y, _p.z);
    }
    for (let i = 0; i < this.seg; i++) {
      const p = 1 + i;
      const q = 1 + ((i + 1) % this.seg);
      if (top) idx.push(0, p, q);
      else idx.push(0, q, p);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}

/** A point on one ring. */
export function ringPoint(r: Full, a: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = Math.pow(Math.pow(Math.abs(c), r.n) + Math.pow(Math.abs(s), r.n), -1 / r.n);
  const rx = r.rx + lift;
  const rz = (r.rz + lift) * (c >= 0 ? r.b : r.f);
  return out.set(r.x + rx * s * k * (1 + r.e * c), r.y + r.ty * c * k + r.tx * s * k, r.z + rz * c * k);
}

/** Shorthand: the whole loft as one geometry. */
export function loft(keys: readonly Ring[], seg: number, o: LoftOpts = {}): THREE.BufferGeometry {
  return new Loft(keys, seg, o).geometry();
}

/** A sheet of nu by nv quads laid wherever `at` puts each corner. Faces the way `facing` points. */
export function sheet(nu: number, nv: number, at: (u: number, v: number, out: THREE.Vector3) => void, facing: THREE.Vector3, keep?: (u: number, v: number) => boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      at(i / nu, j / nv, _p);
      pos.push(_p.x, _p.y, _p.z);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (keep && !keep((i + 0.5) / nu, (j + 0.5) / nv)) continue;
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  return faced(pos, idx, facing);
}

/** A flat shape with a middle and a rim, laid wherever `at` puts each point. For badges and prints. */
export function fan(rim: readonly (readonly [number, number])[], at: (x: number, y: number, out: THREE.Vector3) => void, facing: THREE.Vector3, loops = 2): THREE.BufferGeometry {
  let cx = 0;
  let cy = 0;
  for (const p of rim) {
    cx += p[0] / rim.length;
    cy += p[1] / rim.length;
  }
  const pos: number[] = [];
  const idx: number[] = [];
  at(cx, cy, _p);
  pos.push(_p.x, _p.y, _p.z);
  const n = rim.length;
  for (let l = 1; l <= loops; l++) {
    for (const p of rim) {
      at(cx + ((p[0] - cx) * l) / loops, cy + ((p[1] - cy) * l) / loops, _p);
      pos.push(_p.x, _p.y, _p.z);
    }
  }
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    idx.push(0, 1 + i, 1 + i1);
    for (let l = 1; l < loops; l++) {
      const a = 1 + (l - 1) * n + i;
      const b = 1 + (l - 1) * n + i1;
      const c = 1 + l * n + i;
      const d = 1 + l * n + i1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return faced(pos, idx, facing);
}

function faced(pos: number[], idx: number[], facing: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Turn it over if it came out facing the wrong way.
  const n = g.getAttribute('normal');
  let dot = 0;
  for (let i = 0; i < n.count; i++) dot += n.getX(i) * facing.x + n.getY(i) * facing.y + n.getZ(i) * facing.z;
  if (dot < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** Move every vertex of g, then make the normals smooth again. Returns g. */
export function warp(g: THREE.BufferGeometry, move: (p: THREE.Vector3) => void): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    _p.set(p.getX(i), p.getY(i), p.getZ(i));
    move(_p);
    p.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A copy of g moved and turned, normals included. */
export function placed(g: THREE.BufferGeometry, pos: readonly [number, number, number], rot: readonly [number, number, number] = [0, 0, 0], scale: number | readonly [number, number, number] = 1): THREE.BufferGeometry {
  const out = g.clone();
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(scale[0], scale[1], scale[2]);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), s);
  out.applyMatrix4(m);
  if (s.x !== s.y || s.y !== s.z) out.computeVertexNormals();
  return out;
}

/** A round tube along a path, with smooth normals and rounded ends. `radius` may change along it (t runs 0 to 1). */
export function hose(pts: readonly THREE.Vector3[], radius: number | ((t: number) => number), seg: number, flatten = 1, flatAxis?: THREE.Vector3): THREE.BufferGeometry {
  const n = pts.length;
  const pos: number[] = [];
  const idx: number[] = [];
  const t = new THREE.Vector3();
  const u = new THREE.Vector3();
  const b = new THREE.Vector3();
  const ref = flatAxis ? flatAxis.clone() : new THREE.Vector3(0, 0, 1);
  for (let j = 0; j < n; j++) {
    t.copy(pts[Math.min(n - 1, j + 1)]).sub(pts[Math.max(0, j - 1)]).normalize();
    // u is the thin way when the hose is flattened into a strap.
    u.copy(ref).addScaledVector(t, -ref.dot(t));
    if (u.lengthSq() < 1e-8) u.set(1, 0, 0).addScaledVector(t, -t.x);
    u.normalize();
    b.crossVectors(t, u);
    const r = typeof radius === 'number' ? radius : radius(j / (n - 1));
    for (let i = 0; i < seg; i++) {
      const a = (TAU * i) / seg;
      _p.copy(pts[j]).addScaledVector(b, Math.cos(a) * r).addScaledVector(u, Math.sin(a) * r * flatten);
      pos.push(_p.x, _p.y, _p.z);
    }
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      const a = j * seg + i;
      const c = j * seg + i1;
      const d = (j + 1) * seg + i;
      const e = (j + 1) * seg + i1;
      idx.push(a, d, c, c, d, e);
    }
  }
  // Ends.
  const endCap = (j: number, sign: number): void => {
    const base = pos.length / 3;
    t.copy(pts[Math.min(n - 1, j + 1)]).sub(pts[Math.max(0, j - 1)]).normalize();
    const r = typeof radius === 'number' ? radius : radius(j / (n - 1));
    _p.copy(pts[j]).addScaledVector(t, sign * r * 0.5 * Math.min(1, flatten * 2));
    pos.push(_p.x, _p.y, _p.z);
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      if (sign > 0) idx.push(j * seg + i, base, j * seg + i1);
      else idx.push(j * seg + i, j * seg + i1, base);
    }
  };
  endCap(0, -1);
  endCap(n - 1, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
