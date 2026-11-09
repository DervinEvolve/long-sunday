// The kit: how anything gets into the world.
//
// A builder takes many coloured parts and bakes them into one mesh, so a whole district can be a
// handful of draw calls. Every vertex carries what the ink material needs:
//   position, normal, uv            the usual
//   aColor (4 bytes)                fill colour, and `flat` in the fourth byte
//   aData  (4 bytes)                outline id, extra hatch, dither coverage, sway weight
//   aInk   (4 bytes)                lettering colour, and the lettering mode in the fourth byte
// Colours are stored exactly as authored (sRGB bytes). The material never converts them.
// See docs/KIT.md for how to use it.
import * as THREE from 'three';
import type { ColorLike, InkBuilder, InkKit, LabelOpts, LabelSize, PartOpts, ShadowOpts } from '../types';
import type { Lettering } from './lettering';

/** Outline id byte that means "draw no ink line here". */
const NO_EDGE = 255;
/** Sway weight is stored as a byte: this many metres of height reach full weight. */
export const SWAY_HEIGHT = 6;
const MODE_PLATE = 128;
const MODE_CUTOUT = 255;

export interface Kit extends InkKit {
  ready: Promise<void>;
  builder(): KitBuilder;
}

export interface KitBuilder extends InkBuilder {
  shadow(geometry: THREE.BufferGeometry, opts: ShadowOpts): void;
  measure(opts: Pick<LabelOpts, 'text' | 'size' | 'maxWidth' | 'lineHeight'>): LabelSize;
  /** Like build(), but hands back the bare geometry: for kit.instances() of a many-coloured thing. */
  geometry(): THREE.BufferGeometry;
}

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

const styleCache = new Map<string, number>();
const scratchColor = new THREE.Color();

/** Any authored colour as 0xRRGGBB, the bytes exactly as written. */
export function toHex(c: ColorLike): number {
  if (typeof c === 'number') return c & 0xffffff;
  let h = styleCache.get(c);
  if (h === undefined) {
    scratchColor.setStyle(c, THREE.LinearSRGBColorSpace);
    h =
      (Math.round(scratchColor.r * 255) << 16) |
      (Math.round(scratchColor.g * 255) << 8) |
      Math.round(scratchColor.b * 255);
    styleCache.set(c, h);
  }
  return h;
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

const m4 = new THREE.Matrix4();
const m3 = new THREE.Matrix3();
const vPos = new THREE.Vector3();
const vScale = new THREE.Vector3();
const qRot = new THREE.Quaternion();
const eRot = new THREE.Euler();
const v = new THREE.Vector3();
const nrm = new THREE.Vector3();
const white = 0xffffff;

let idCounter = 0;

function compose(pos?: readonly number[], rot?: readonly number[], scale?: number | readonly number[]): THREE.Matrix4 {
  vPos.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
  eRot.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, 'XYZ');
  qRot.setFromEuler(eRot);
  if (typeof scale === 'number') vScale.set(scale, scale, scale);
  else if (scale) vScale.set(scale[0], scale[1], scale[2]);
  else vScale.set(1, 1, 1);
  return m4.compose(vPos, qRot, vScale);
}

class Builder implements KitBuilder {
  private pos = new Float32Array(3 * 1024);
  private nor = new Float32Array(3 * 1024);
  private uv = new Float32Array(2 * 1024);
  private col = new Uint8Array(4 * 1024);
  private dat = new Uint8Array(4 * 1024);
  private ink = new Uint8Array(4 * 1024);
  private idx = new Uint32Array(3 * 2048);
  private vc = 0;
  private ic = 0;
  private hasSway = false;

  constructor(
    private material: THREE.Material,
    private lettering: Lettering,
  ) {}

  newId(): number {
    return ++idCounter;
  }

  triangles(): number {
    return this.ic / 3;
  }

  private reserve(verts: number, indices: number): void {
    const needV = this.vc + verts;
    if (needV * 3 > this.pos.length) {
      let cap = this.pos.length / 3;
      while (cap < needV) cap *= 2;
      this.pos = grow(this.pos, cap * 3);
      this.nor = grow(this.nor, cap * 3);
      this.uv = grow(this.uv, cap * 2);
      this.col = grow(this.col, cap * 4);
      this.dat = grow(this.dat, cap * 4);
      this.ink = grow(this.ink, cap * 4);
    }
    const needI = this.ic + indices;
    if (needI > this.idx.length) {
      let cap = this.idx.length;
      while (cap < needI) cap *= 2;
      this.idx = grow(this.idx, cap);
    }
  }

  add(geometry: THREE.BufferGeometry, opts: PartOpts): number {
    const id = opts.id ?? this.newId();
    let src = geometry;
    let temp: THREE.BufferGeometry | null = null;
    if (!src.getAttribute('normal')) {
      // Never touch what was passed in. Work on a throwaway copy.
      temp = src.index ? src.toNonIndexed() : src.clone();
      temp.computeVertexNormals();
      src = temp;
    }
    const p = src.getAttribute('position');
    const n = src.getAttribute('normal');
    const index = src.index;
    const count = p.count;
    const icount = index ? index.count : count;
    this.reserve(count, icount);

    const mat = compose(opts.pos, opts.rot, opts.scale);
    m3.getNormalMatrix(mat);
    const mirrored = mat.determinant() < 0;

    const base = this.vc;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mat);
      nrm.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(m3).normalize();
      const o = (base + i) * 3;
      this.pos[o] = v.x;
      this.pos[o + 1] = v.y;
      this.pos[o + 2] = v.z;
      this.nor[o] = nrm.x;
      this.nor[o + 1] = nrm.y;
      this.nor[o + 2] = nrm.z;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }

    const flat = byte(opts.flat ?? 0);
    const hatch = byte(opts.hatch ?? 0);
    const dither = byte(opts.dither ?? 1);
    const idByte = opts.outline === false ? NO_EDGE : (id % 251) + 1;
    const sway = opts.sway ?? 0;
    const swayBase = opts.swayBase ?? minY;
    if (sway > 0) this.hasSway = true;

    let r0 = 0, g0 = 0, b0 = 0, r1 = 0, g1 = 0, b1 = 0;
    const grad = opts.gradient;
    if (grad) {
      const lo = toHex(grad.bottom);
      const hi = toHex(grad.top);
      r0 = lo >> 16; g0 = (lo >> 8) & 255; b0 = lo & 255;
      r1 = hi >> 16; g1 = (hi >> 8) & 255; b1 = hi & 255;
    } else {
      const c = toHex(opts.color);
      r0 = r1 = c >> 16; g0 = g1 = (c >> 8) & 255; b0 = b1 = c & 255;
    }
    const span = maxY - minY > 1e-6 ? 1 / (maxY - minY) : 0;

    for (let i = 0; i < count; i++) {
      const vi = base + i;
      const y = this.pos[vi * 3 + 1];
      const o = vi * 4;
      if (grad) {
        const t = (y - minY) * span;
        this.col[o] = r0 + (r1 - r0) * t + 0.5;
        this.col[o + 1] = g0 + (g1 - g0) * t + 0.5;
        this.col[o + 2] = b0 + (b1 - b0) * t + 0.5;
      } else {
        this.col[o] = r0;
        this.col[o + 1] = g0;
        this.col[o + 2] = b0;
      }
      this.col[o + 3] = flat;
      this.dat[o] = idByte;
      this.dat[o + 1] = hatch;
      this.dat[o + 2] = dither;
      this.dat[o + 3] = sway > 0 ? byte(sway * Math.min(1, Math.max(0, (y - swayBase) / SWAY_HEIGHT))) : 0;
      this.ink[o] = 0;
      this.ink[o + 1] = 0;
      this.ink[o + 2] = 0;
      this.ink[o + 3] = 0;
      this.uv[vi * 2] = 0;
      this.uv[vi * 2 + 1] = 0;
    }

    const io = this.ic;
    if (index) {
      for (let i = 0; i < icount; i += 3) {
        const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
        this.idx[io + i] = base + a;
        this.idx[io + i + 1] = base + (mirrored ? c : b);
        this.idx[io + i + 2] = base + (mirrored ? b : c);
      }
    } else {
      for (let i = 0; i < icount; i += 3) {
        this.idx[io + i] = base + i;
        this.idx[io + i + 1] = base + i + (mirrored ? 2 : 1);
        this.idx[io + i + 2] = base + i + (mirrored ? 1 : 2);
      }
    }
    this.vc += count;
    this.ic += icount - (icount % 3);
    if (temp) temp.dispose();
    return id;
  }

  /** The part's shadow, thrown flat onto the ground. See ShadowOpts. */
  shadow(geometry: THREE.BufferGeometry, opts: ShadowOpts): void {
    const first = this.vc;
    this.add(geometry, { color: opts.color, pos: opts.pos, rot: opts.rot, scale: opts.scale, flat: 1, outline: false });
    const sun = opts.sun;
    const sx = Array.isArray(sun) ? sun[0] : sun.x;
    const sy = Math.max(0.12, Array.isArray(sun) ? sun[1] : sun.y);
    const sz = Array.isArray(sun) ? sun[2] : sun.z;
    const ground = opts.y ?? 0;
    const lift = opts.lift ?? 0.02;
    for (let vi = first; vi < this.vc; vi++) {
      const o = vi * 3;
      const h = Math.max(0, this.pos[o + 1] - ground);
      this.pos[o] -= (sx / sy) * h;
      this.pos[o + 1] = ground + lift;
      this.pos[o + 2] -= (sz / sy) * h;
      this.nor[o] = 0;
      this.nor[o + 1] = 1;
      this.nor[o + 2] = 0;
    }
  }

  // ----- lettering -----

  private layout(text: string, size: number, maxWidth: number | undefined): { lines: { text: string; width: number }[]; em: number } {
    const L = this.lettering;
    const em = size / L.capHeight();
    const widthOf = (s: string) => {
      let w = 0;
      for (const ch of s) w += L.glyph(ch).adv;
      return w * em;
    };
    const lines: { text: string; width: number }[] = [];
    for (const para of text.split('\n')) {
      if (maxWidth === undefined) {
        lines.push({ text: para, width: widthOf(para) });
        continue;
      }
      let cur = '';
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        const next = cur ? cur + ' ' + word : word;
        if (cur && widthOf(next) > maxWidth) {
          lines.push({ text: cur, width: widthOf(cur) });
          cur = word;
        } else cur = next;
      }
      lines.push({ text: cur, width: widthOf(cur) });
    }
    return { lines, em };
  }

  measure(opts: Pick<LabelOpts, 'text' | 'size' | 'maxWidth' | 'lineHeight'>): LabelSize {
    const { lines } = this.layout(opts.text, opts.size, opts.maxWidth);
    let width = 0;
    for (const l of lines) width = Math.max(width, l.width);
    const lineH = (opts.lineHeight ?? 1.7) * opts.size;
    return { width, height: (lines.length - 1) * lineH + opts.size, lines: lines.length };
  }

  private quad(
    mat: THREE.Matrix4,
    x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
    z: number,
    u0: number, v0: number, u1: number, v1: number,
    fill: number, flat: number, idByte: number, inkHex: number, mode: number,
  ): void {
    this.reserve(4, 6);
    const base = this.vc;
    const xs = [x0, x1, x2, x3];
    const ys = [y0, y1, y2, y3];
    const us = [u0, u1, u1, u0];
    const vs = [v0, v0, v1, v1];
    nrm.set(0, 0, 1).transformDirection(mat);
    for (let i = 0; i < 4; i++) {
      v.set(xs[i], ys[i], z).applyMatrix4(mat);
      const vi = base + i;
      this.pos[vi * 3] = v.x;
      this.pos[vi * 3 + 1] = v.y;
      this.pos[vi * 3 + 2] = v.z;
      this.nor[vi * 3] = nrm.x;
      this.nor[vi * 3 + 1] = nrm.y;
      this.nor[vi * 3 + 2] = nrm.z;
      this.uv[vi * 2] = us[i];
      this.uv[vi * 2 + 1] = vs[i];
      const o = vi * 4;
      this.col[o] = fill >> 16;
      this.col[o + 1] = (fill >> 8) & 255;
      this.col[o + 2] = fill & 255;
      this.col[o + 3] = flat;
      this.dat[o] = idByte;
      this.dat[o + 1] = 0;
      this.dat[o + 2] = 255;
      this.dat[o + 3] = 0;
      this.ink[o] = inkHex >> 16;
      this.ink[o + 1] = (inkHex >> 8) & 255;
      this.ink[o + 2] = inkHex & 255;
      this.ink[o + 3] = mode;
    }
    const io = this.ic;
    this.idx[io] = base;
    this.idx[io + 1] = base + 1;
    this.idx[io + 2] = base + 2;
    this.idx[io + 3] = base;
    this.idx[io + 4] = base + 2;
    this.idx[io + 5] = base + 3;
    this.vc += 4;
    this.ic += 6;
  }

  label(opts: LabelOpts): void {
    const L = this.lettering;
    const size = opts.size;
    const { lines, em } = this.layout(opts.text, size, opts.maxWidth);
    let width = 0;
    for (const l of lines) width = Math.max(width, l.width);
    const lineH = (opts.lineHeight ?? 1.7) * size;
    const height = (lines.length - 1) * lineH + size;
    const align = opts.align ?? 'center';
    const lift = opts.lift ?? 0.02;
    const jitter = opts.jitter ?? 0.5;
    const flat = byte(opts.flat ?? 0);
    const inkHex = toHex(opts.ink ?? 0x1c1a33);
    const hasPlate = opts.plate !== undefined;
    const fill = hasPlate ? toHex(opts.plate as ColorLike) : white;
    const idByte = hasPlate ? ((opts.id ?? this.newId()) % 251) + 1 : NO_EDGE;
    const mode = hasPlate ? MODE_PLATE : MODE_CUTOUT;
    // The matrix is copied because quad() runs glyph lookups that never touch m4, but add() would.
    const mat = labelMat.copy(compose(opts.pos, opts.rot, undefined));

    // Block origin: left edge of the widest line, by alignment. Vertically the block is centred on pos.
    const anchor = opts.anchor ?? align;
    const left = anchor === 'left' ? 0 : anchor === 'right' ? -width : -width / 2;

    if (hasPlate) {
      const pad = (opts.pad ?? 0.55) * size;
      const x0 = left - pad, x1 = left + width + pad;
      const y0 = -height / 2 - pad, y1 = height / 2 + pad;
      this.quad(mat, x0, y0, x1, y0, x1, y1, x0, y1, lift, 0, 0, 0, 0, fill, flat, idByte, 0, 0);
    }
    const z = hasPlate ? lift + Math.max(0.006, size * 0.02) : lift;

    let seed = 2166136261;
    for (let i = 0; i < opts.text.length; i++) seed = Math.imul(seed ^ opts.text.charCodeAt(i), 16777619);
    const rand = () => {
      seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9;
      return ((seed >>> 8) & 0xffff) / 0xffff - 0.5;
    };

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      let pen = align === 'left' ? left : align === 'right' ? left + width - line.width : left + (width - line.width) / 2;
      const baseY = height / 2 - size - li * lineH;
      for (const ch of line.text) {
        const g = L.glyph(ch);
        if (!g.empty) {
          const gw = g.w * em;
          const gh = g.h * em;
          const gx = pen + g.ox * em;
          const gy = baseY + g.oy * em + rand() * 0.07 * size * jitter;
          const a = rand() * 0.09 * jitter;
          const ca = Math.cos(a), sa = Math.sin(a);
          const cx = gx + gw / 2, cy = gy + gh / 2;
          const hx = gw / 2, hy = gh / 2;
          this.quad(
            mat,
            cx + -hx * ca - -hy * sa, cy + -hx * sa + -hy * ca,
            cx + hx * ca - -hy * sa, cy + hx * sa + -hy * ca,
            cx + hx * ca - hy * sa, cy + hx * sa + hy * ca,
            cx + -hx * ca - hy * sa, cy + -hx * sa + hy * ca,
            z, g.u0, g.v0, g.u1, g.v1, fill, flat, idByte, inkHex, mode,
          );
        }
        pen += g.adv * em;
      }
    }
  }

  // ----- output -----

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const vc = this.vc;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, vc * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, vc * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, vc * 2), 2));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col.slice(0, vc * 4), 4, true));
    g.setAttribute('aData', new THREE.BufferAttribute(this.dat.slice(0, vc * 4), 4, true));
    g.setAttribute('aInk', new THREE.BufferAttribute(this.ink.slice(0, vc * 4), 4, true));
    g.setIndex(new THREE.BufferAttribute(vc > 65535 ? this.idx.slice(0, this.ic) : new Uint16Array(this.idx.subarray(0, this.ic)), 1));
    if (vc > 0) {
      g.computeBoundingBox();
      g.computeBoundingSphere();
      // Sway moves vertices in the shader. Leave room so the mesh is not culled while a branch is still on screen.
      if (this.hasSway && g.boundingSphere && g.boundingBox) {
        g.boundingSphere.radius += 1;
        g.boundingBox.expandByScalar(1);
      }
    } else {
      g.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    }
    // The builder is spent: drop the big arrays.
    this.pos = new Float32Array(3 * 64);
    this.nor = new Float32Array(3 * 64);
    this.uv = new Float32Array(2 * 64);
    this.col = new Uint8Array(4 * 64);
    this.dat = new Uint8Array(4 * 64);
    this.ink = new Uint8Array(4 * 64);
    this.idx = new Uint32Array(3 * 64);
    this.vc = 0;
    this.ic = 0;
    this.hasSway = false;
    return g;
  }

  build(name?: string): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(), this.material);
    if (name) mesh.name = name;
    return mesh;
  }
}

const labelMat = new THREE.Matrix4();

function grow<T extends Float32Array | Uint8Array | Uint32Array>(a: T, length: number): T {
  const out = new (a.constructor as { new (n: number): T })(length);
  out.set(a);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Kit
// ---------------------------------------------------------------------------------------------

export function createKit(material: THREE.Material, lettering: Lettering): Kit {
  const builder = () => new Builder(material, lettering);
  return {
    material,
    ready: lettering.ready,
    builder,
    instances(geometry, count, opts = {}) {
      let geo = geometry;
      if (!geometry.getAttribute('aData')) {
        // A plain shape: give it the kit's attributes. One id for the whole shape; the material
        // offsets it per instance so every copy gets its own outline.
        const b = builder();
        b.add(geometry, {
          color: opts.color ?? white,
          flat: opts.flat,
          hatch: opts.hatch,
          dither: opts.dither,
          sway: opts.sway,
        });
        geo = b.geometry();
      }
      const mesh = new THREE.InstancedMesh(geo, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    },
  };
}
