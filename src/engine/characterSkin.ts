// Soft joints for the figure. A mesh built by the kit is one rigid thing. Here some of its vertices
// are allowed to follow a second frame (a forearm, a shin, the toe of a shoe, the free end of a
// twist), blended by a weight, so an elbow bends as one sleeve and a hem moves like cloth.
// The blending is done here, on the processor, straight into the mesh's own position and normal
// arrays. The ink material never knows. Only the vertices that move are touched.
import * as THREE from 'three';
import type { InkBuilder, PartOpts } from '../types';

export interface BindOut {
  /** First frame. 0 is the mesh itself. */
  a: number;
  /** Second frame. */
  b: number;
  /** 0 follows the first frame, 1 the second. */
  w: number;
}

/** Says which frames a vertex follows, from where it sits at rest (in the mesh's own space). */
export type Bind = (x: number, y: number, z: number, out: BindOut) => void;

const scratch: BindOut = { a: 0, b: 0, w: 0 };

/** A kit builder that remembers which parts bend. */
export class SkinBuilder {
  private ranges: { from: number; to: number; bind: Bind }[] = [];
  private count = 0;

  constructor(readonly b: InkBuilder) {}

  newId(): number {
    return this.b.newId();
  }

  add(g: THREE.BufferGeometry, opts: PartOpts, bind?: Bind): number {
    // The kit unpicks the index of anything that comes without normals, which would lose my count.
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    if (bind) this.ranges.push({ from: this.count, to: this.count + n, bind });
    this.count += n;
    return this.b.add(g, opts);
  }

  triangles(): number {
    return this.b.triangles();
  }

  build(name: string, frames: number): Skin {
    return new Skin(this.b.build(name), this.ranges, frames);
  }
}

export class Skin {
  /** Twelve numbers a frame: the three rows of a 3 by 4 matrix, in the mesh's own space. Frame 0 stays the identity. */
  readonly frames: Float32Array;
  private readonly rest: Float32Array;
  private readonly restN: Float32Array;
  private readonly pos: THREE.BufferAttribute;
  private readonly nor: THREE.BufferAttribute;
  private readonly idx: Uint32Array;
  private readonly fa: Uint8Array;
  private readonly fb: Uint8Array;
  private readonly fw: Float32Array;

  constructor(
    readonly mesh: THREE.Mesh,
    ranges: readonly { from: number; to: number; bind: Bind }[],
    frames: number,
  ) {
    const g = mesh.geometry;
    this.pos = g.getAttribute('position') as THREE.BufferAttribute;
    this.nor = g.getAttribute('normal') as THREE.BufferAttribute;
    this.rest = new Float32Array(this.pos.array as Float32Array);
    this.restN = new Float32Array(this.nor.array as Float32Array);
    this.frames = new Float32Array(12 * Math.max(1, frames));
    for (let f = 0; f < frames; f++) {
      this.frames[f * 12] = 1;
      this.frames[f * 12 + 5] = 1;
      this.frames[f * 12 + 10] = 1;
    }
    const idx: number[] = [];
    const fa: number[] = [];
    const fb: number[] = [];
    const fw: number[] = [];
    for (const r of ranges) {
      for (let v = r.from; v < r.to; v++) {
        scratch.a = 0;
        scratch.b = 0;
        scratch.w = 0;
        r.bind(this.rest[v * 3], this.rest[v * 3 + 1], this.rest[v * 3 + 2], scratch);
        let a = scratch.a;
        let b = scratch.b;
        let w = scratch.w < 0 ? 0 : scratch.w > 1 ? 1 : scratch.w;
        if (w < 0.002) {
          b = a;
          w = 0;
        } else if (w > 0.998) {
          a = b;
          w = 0;
        }
        if (a === 0 && b === 0) continue;
        idx.push(v);
        fa.push(a);
        fb.push(b);
        fw.push(w);
      }
    }
    this.idx = Uint32Array.from(idx);
    this.fa = Uint8Array.from(fa);
    this.fb = Uint8Array.from(fb);
    this.fw = Float32Array.from(fw);
    if (idx.length > 0) {
      this.pos.setUsage(THREE.DynamicDrawUsage);
      this.nor.setUsage(THREE.DynamicDrawUsage);
    }
    // Nothing he does carries a part further than this from its own joint.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.6);
  }

  /** How many vertices bend. */
  get moving(): number {
    return this.idx.length;
  }

  /** Frame f becomes m, taken about the point (px, py, pz): what sat there at rest goes where m puts the origin. */
  setFrame(f: number, m: THREE.Matrix4, px = 0, py = 0, pz = 0): void {
    const e = m.elements;
    const o = f * 12;
    const F = this.frames;
    F[o] = e[0];
    F[o + 1] = e[4];
    F[o + 2] = e[8];
    F[o + 3] = e[12] - (e[0] * px + e[4] * py + e[8] * pz);
    F[o + 4] = e[1];
    F[o + 5] = e[5];
    F[o + 6] = e[9];
    F[o + 7] = e[13] - (e[1] * px + e[5] * py + e[9] * pz);
    F[o + 8] = e[2];
    F[o + 9] = e[6];
    F[o + 10] = e[10];
    F[o + 11] = e[14] - (e[2] * px + e[6] * py + e[10] * pz);
  }

  /** Move every bending vertex to where its frames now put it. */
  apply(): void {
    const n = this.idx.length;
    if (n === 0) return;
    const F = this.frames;
    const R = this.rest;
    const RN = this.restN;
    const P = this.pos.array as Float32Array;
    const N = this.nor.array as Float32Array;
    const idx = this.idx;
    const fa = this.fa;
    const fb = this.fb;
    const fw = this.fw;
    for (let k = 0; k < n; k++) {
      const v = idx[k] * 3;
      const a = fa[k] * 12;
      const b = fb[k] * 12;
      const w = fw[k];
      const u = 1 - w;
      const m0 = F[a] * u + F[b] * w;
      const m1 = F[a + 1] * u + F[b + 1] * w;
      const m2 = F[a + 2] * u + F[b + 2] * w;
      const m3 = F[a + 3] * u + F[b + 3] * w;
      const m4 = F[a + 4] * u + F[b + 4] * w;
      const m5 = F[a + 5] * u + F[b + 5] * w;
      const m6 = F[a + 6] * u + F[b + 6] * w;
      const m7 = F[a + 7] * u + F[b + 7] * w;
      const m8 = F[a + 8] * u + F[b + 8] * w;
      const m9 = F[a + 9] * u + F[b + 9] * w;
      const m10 = F[a + 10] * u + F[b + 10] * w;
      const m11 = F[a + 11] * u + F[b + 11] * w;
      const x = R[v];
      const y = R[v + 1];
      const z = R[v + 2];
      P[v] = m0 * x + m1 * y + m2 * z + m3;
      P[v + 1] = m4 * x + m5 * y + m6 * z + m7;
      P[v + 2] = m8 * x + m9 * y + m10 * z + m11;
      const nx = RN[v];
      const ny = RN[v + 1];
      const nz = RN[v + 2];
      const ax = m0 * nx + m1 * ny + m2 * nz;
      const ay = m4 * nx + m5 * ny + m6 * nz;
      const az = m8 * nx + m9 * ny + m10 * nz;
      const l = 1 / (Math.sqrt(ax * ax + ay * ay + az * az) || 1);
      N[v] = ax * l;
      N[v + 1] = ay * l;
      N[v + 2] = az * l;
    }
    this.pos.needsUpdate = true;
    this.nor.needsUpdate = true;
  }
}

const eul = new THREE.Euler();

/** out = a turn of (rx, ry, rz) about the point p, in the order given. */
export function turnAbout(out: THREE.Matrix4, px: number, py: number, pz: number, rx: number, ry: number, rz: number, order: THREE.EulerOrder = 'XYZ'): THREE.Matrix4 {
  out.makeRotationFromEuler(eul.set(rx, ry, rz, order));
  const e = out.elements;
  e[12] = px - (e[0] * px + e[4] * py + e[8] * pz);
  e[13] = py - (e[1] * px + e[5] * py + e[9] * pz);
  e[14] = pz - (e[2] * px + e[6] * py + e[10] * pz);
  return out;
}
