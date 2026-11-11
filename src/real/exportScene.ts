// Dev only. Hands the built world to the real look's pipeline (tools/real/export.mjs).
//
// main.ts loads this file behind ?export=1 on the dev server and never in a build. It walks the
// scene the ink look draws and writes one binary glTF per chunk, in world space, so both looks
// agree on where everything is. Nothing here touches the world: it only reads.
//
// What a chunk file carries, per mesh:
//   POSITION, NORMAL   world space, x east, y up, z south, metres
//   TEXCOORD_0         the lettering atlas uv (zero away from letters)
//   COLOR_0            aColor: the authored fill colour, and `flat` in the fourth byte
//   _DATA              aData: outline id (renumbered per mesh), extra hatch, dither coverage, sway weight
//   _INK               aInk: lettering colour, and the lettering mode in the fourth byte
//   _PART              which add() of the builder the vertex came from, counted per mesh
// Instanced meshes are written out copy by copy, with the instance tint already in COLOR_0.
import * as THREE from 'three';
import type { World } from '../engine/world';
import { SUN } from '../engine/world';
import { SITES, SPAWN } from '../world/layout';

/** Top level groups that are not districts, and the chunk each one becomes. */
const BASE_CHUNKS: Record<string, string> = { terrain: 'ground', scatter: 'city', sky: 'sky' };

export interface ExportMeshInfo {
  /** Group name, a slash, mesh name. What the browser side uses to find the ink object. */
  path: string;
  chunk: string;
  triangles: number;
  instances: number;
  /** World space box, [minX, minY, minZ, maxX, maxY, maxZ]. */
  box: number[];
}

interface Found {
  path: string;
  chunk: string;
  mesh: THREE.Mesh;
}

function findMeshes(scene: THREE.Scene): Found[] {
  const districts = new Set<string>(SITES.map((s) => s.id));
  const out: Found[] = [];
  const seen = new Map<string, number>();
  for (const top of scene.children) {
    const chunk = BASE_CHUNKS[top.name] ?? (districts.has(top.name) ? top.name : 'world');
    top.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let path = top === o ? o.name : `${top.name}/${o.name}`;
      // Two meshes with one name (the figure's arms and legs): number the later ones.
      const n = seen.get(path) ?? 0;
      seen.set(path, n + 1);
      if (n > 0) path = `${path}#${n}`;
      out.push({ path, chunk, mesh });
    });
  }
  return out;
}

/** A cheap fingerprint of where a mesh is and what its copies are doing. Two readings a moment
 *  apart, with the clock running, tell me what moves. */
function signature(mesh: THREE.Mesh): string {
  const e = mesh.matrixWorld.elements;
  let s = '';
  for (let i = 0; i < 16; i++) s += e[i].toFixed(3) + ',';
  const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
  if (inst) {
    const a = inst.instanceMatrix.array;
    let sum = 0;
    for (let i = 0; i < inst.count * 16; i++) sum += a[i] * ((i % 13) + 1);
    s += `|${inst.count}|${sum.toFixed(2)}`;
    const c = inst.instanceColor;
    if (c) {
      let cs = 0;
      for (let i = 0; i < inst.count * 3; i++) cs += c.array[i] * ((i % 7) + 1);
      s += `|${cs.toFixed(3)}`;
    }
  }
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  s += `|${pos.version}|${mesh.visible ? 1 : 0}`;
  return s;
}

// ---------------------------------------------------------------------------------------------
// A small glTF writer. One node and one primitive per mesh, everything in one binary buffer.
// ---------------------------------------------------------------------------------------------

interface Part {
  name: string;
  extras: Record<string, unknown>;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Uint8Array;
  data: Uint8Array;
  ink: Uint8Array;
  part: Float32Array;
  index: Uint32Array;
}

function writeGlb(parts: Part[], extras: Record<string, unknown>): ArrayBuffer {
  const views: { bytes: Uint8Array; target?: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const push = (arr: Float32Array | Uint8Array | Uint32Array, type: string, componentType: number, normalized: boolean, target: number, minMax: boolean): number => {
    const size = type === 'SCALAR' ? 1 : type === 'VEC2' ? 2 : type === 'VEC3' ? 3 : 4;
    views.push({ bytes: new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), target });
    const acc: Record<string, unknown> = { bufferView: views.length - 1, componentType, count: arr.length / size, type };
    if (normalized) acc.normalized = true;
    if (minMax) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < arr.length; i += 3)
        for (let k = 0; k < 3; k++) {
          const v = arr[i + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  for (const p of parts) {
    const attributes = {
      POSITION: push(p.position, 'VEC3', 5126, false, 34962, true),
      NORMAL: push(p.normal, 'VEC3', 5126, false, 34962, false),
      TEXCOORD_0: push(p.uv, 'VEC2', 5126, false, 34962, false),
      COLOR_0: push(p.color, 'VEC4', 5121, true, 34962, false),
      _DATA: push(p.data, 'VEC4', 5121, false, 34962, false),
      _INK: push(p.ink, 'VEC4', 5121, false, 34962, false),
      _PART: push(p.part, 'SCALAR', 5126, false, 34962, false),
    };
    const indices = push(p.index, 'SCALAR', 5125, false, 34963, false);
    meshes.push({ name: p.name, primitives: [{ attributes, indices, mode: 4 }] });
    nodes.push({ name: p.name, mesh: meshes.length - 1, extras: p.extras });
  }
  let length = 0;
  const bufferViews = views.map((v) => {
    const view: Record<string, unknown> = { buffer: 0, byteOffset: length, byteLength: v.bytes.byteLength };
    if (v.target) view.target = v.target;
    length += (v.bytes.byteLength + 3) & ~3;
    return view;
  });
  const json = {
    asset: { version: '2.0', generator: 'long-sunday export hook' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i), extras }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: length }],
  };
  let text = JSON.stringify(json);
  while (new TextEncoder().encode(text).length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.length + 8 + length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  u8.set(jsonBytes, 20);
  let at = 20 + jsonBytes.length;
  dv.setUint32(at, length, true);
  dv.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const v of views) {
    u8.set(v.bytes, at);
    at += (v.bytes.byteLength + 3) & ~3;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// One mesh, flattened into world space
// ---------------------------------------------------------------------------------------------

const mWorld = new THREE.Matrix4();
const mInst = new THREE.Matrix4();
const mNormal = new THREE.Matrix3();
const v3 = new THREE.Vector3();
const tint = new THREE.Color();

/** The builder appends each add() as its own run of vertices, and its triangles only ever point
 *  into that run. So a part can only start at a triangle whose lowest index is past everything
 *  seen so far. A faceted shape shares no vertices, so every one of its triangles looks like that:
 *  a start only counts when the outline id or the flat, hatch or dither bytes change as well.
 *  Adds that share an id on purpose (the rocks of one cliff) come out as one part, which is what
 *  the id means. `same(a, b)` compares two vertices on those bytes. */
function partIds(index: ArrayLike<number>, vertexCount: number, same: (a: number, b: number) => boolean): Float32Array {
  const startsAt: number[] = [];
  let maxSeen = -1;
  let prevVertex = -1;
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i];
    const b = index[i + 1];
    const c = index[i + 2];
    const lo = Math.min(a, b, c);
    if (lo > maxSeen && (prevVertex < 0 || !same(prevVertex, lo))) startsAt.push(lo);
    const hi = Math.max(a, b, c);
    if (hi > maxSeen) maxSeen = hi;
    prevVertex = lo;
  }
  const out = new Float32Array(vertexCount);
  let part = -1;
  let next = 0;
  for (let v = 0; v < vertexCount; v++) {
    while (next < startsAt.length && startsAt[next] <= v) {
      part++;
      next++;
    }
    out[v] = Math.max(0, part);
  }
  return out;
}

/** Two vertices came from adds that look alike: same outline id, flat, hatch, dither and lettering mode. */
function sameBytes(g: THREE.BufferGeometry): (a: number, b: number) => boolean {
  const col = g.getAttribute('aColor') as THREE.BufferAttribute | undefined;
  const dat = g.getAttribute('aData') as THREE.BufferAttribute | undefined;
  const ink = g.getAttribute('aInk') as THREE.BufferAttribute | undefined;
  const c = col ? (col.array as Uint8Array) : null;
  const d = dat ? (dat.array as Uint8Array) : null;
  const k = ink ? (ink.array as Uint8Array) : null;
  return (a, b) =>
    (!d || (d[a * 4] === d[b * 4] && d[a * 4 + 1] === d[b * 4 + 1] && d[a * 4 + 2] === d[b * 4 + 2] && d[a * 4 + 3] > 0 === d[b * 4 + 3] > 0)) &&
    (!c || c[a * 4 + 3] === c[b * 4 + 3]) &&
    (!k || k[a * 4 + 3] === k[b * 4 + 3]);
}

function flatten(found: Found): { part: Part; info: ExportMeshInfo } {
  const mesh = found.mesh;
  const g = mesh.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const col = g.getAttribute('aColor') as THREE.BufferAttribute | undefined;
  const dat = g.getAttribute('aData') as THREE.BufferAttribute | undefined;
  const ink = g.getAttribute('aInk') as THREE.BufferAttribute | undefined;
  const vc = pos.count;
  let srcIndex: ArrayLike<number>;
  if (g.index) srcIndex = g.index.array as ArrayLike<number>;
  else {
    const seq = new Uint32Array(vc);
    for (let i = 0; i < vc; i++) seq[i] = i;
    srcIndex = seq;
  }
  const ic = srcIndex.length - (srcIndex.length % 3);
  const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
  const copies = inst ? inst.count : 1;
  const srcPart = partIds(srcIndex, vc, sameBytes(g));
  let partsPerCopy = 0;
  for (let i = 0; i < vc; i++) partsPerCopy = Math.max(partsPerCopy, srcPart[i] + 1);

  const P: Part = {
    name: found.path,
    extras: { chunk: found.chunk, instances: inst ? copies : 0, partsPerCopy },
    position: new Float32Array(vc * copies * 3),
    normal: new Float32Array(vc * copies * 3),
    uv: new Float32Array(vc * copies * 2),
    color: new Uint8Array(vc * copies * 4),
    data: new Uint8Array(vc * copies * 4),
    ink: new Uint8Array(vc * copies * 4),
    part: new Float32Array(vc * copies),
    index: new Uint32Array(ic * copies),
  };
  mesh.updateWorldMatrix(true, false);
  // Outline ids come from one counter that runs through the whole world, so one more part in
  // the figure would renumber every district built after it and the pipeline would bake them all
  // again for nothing. Nothing downstream reads the number itself, only "no line" (255). So each
  // mesh is renumbered here in the order its ids turn up.
  const idOf = new Map<number, number>();
  const steadyId = (id: number): number => {
    if (id === 255) return 255;
    let n = idOf.get(id);
    if (n === undefined) {
      n = (idOf.size % 251) + 1;
      idOf.set(id, n);
    }
    return n;
  };
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let c = 0; c < copies; c++) {
    if (inst) {
      inst.getMatrixAt(c, mInst);
      mWorld.multiplyMatrices(mesh.matrixWorld, mInst);
      if (inst.instanceColor) inst.getColorAt(c, tint);
      else tint.setRGB(1, 1, 1);
    } else {
      mWorld.copy(mesh.matrixWorld);
      tint.setRGB(1, 1, 1);
    }
    mNormal.getNormalMatrix(mWorld);
    const mirrored = mWorld.determinant() < 0;
    const base = c * vc;
    for (let i = 0; i < vc; i++) {
      const o = base + i;
      v3.fromBufferAttribute(pos, i).applyMatrix4(mWorld);
      P.position[o * 3] = v3.x;
      P.position[o * 3 + 1] = v3.y;
      P.position[o * 3 + 2] = v3.z;
      if (v3.x < box[0]) box[0] = v3.x;
      if (v3.y < box[1]) box[1] = v3.y;
      if (v3.z < box[2]) box[2] = v3.z;
      if (v3.x > box[3]) box[3] = v3.x;
      if (v3.y > box[4]) box[4] = v3.y;
      if (v3.z > box[5]) box[5] = v3.z;
      v3.fromBufferAttribute(nor, i).applyMatrix3(mNormal).normalize();
      P.normal[o * 3] = v3.x;
      P.normal[o * 3 + 1] = v3.y;
      P.normal[o * 3 + 2] = v3.z;
      if (uv) {
        P.uv[o * 2] = uv.getX(i);
        P.uv[o * 2 + 1] = uv.getY(i);
      }
      for (let k = 0; k < 4; k++) {
        // The attributes are normalised bytes: read the raw array, not the 0..1 getters.
        const cb = col ? (col.array as Uint8Array)[i * 4 + k] : k === 3 ? 0 : 255;
        P.color[o * 4 + k] = k < 3 ? Math.round(cb * (k === 0 ? tint.r : k === 1 ? tint.g : tint.b)) : cb;
        const db = dat ? (dat.array as Uint8Array)[i * 4 + k] : k === 2 ? 255 : k === 0 ? 1 : 0;
        P.data[o * 4 + k] = k === 0 ? steadyId(db) : db;
        P.ink[o * 4 + k] = ink ? (ink.array as Uint8Array)[i * 4 + k] : 0;
      }
      P.part[o] = c * partsPerCopy + srcPart[i];
    }
    const io = c * ic;
    for (let i = 0; i < ic; i += 3) {
      P.index[io + i] = base + srcIndex[i];
      P.index[io + i + 1] = base + srcIndex[i + (mirrored ? 2 : 1)];
      P.index[io + i + 2] = base + srcIndex[i + (mirrored ? 1 : 2)];
    }
  }
  return {
    part: P,
    info: { path: found.path, chunk: found.chunk, triangles: (ic / 3) * copies, instances: inst ? copies : 0, box },
  };
}

function base64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, i + step) as unknown as number[]);
  return btoa(s);
}

// ---------------------------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------------------------

export interface RealExport {
  /** Every mesh in the scene, with the chunk it belongs to. */
  meshes(): ExportMeshInfo[];
  /** A fingerprint per mesh path. Read it twice with the clock running to see what moves. */
  signatures(): Record<string, string>;
  /** One chunk as a binary glTF, base64. `skip` lists mesh paths to leave out (the ones that move). */
  chunk(id: string, skip: string[]): string;
  /** The lettering atlas as a PNG data URL. Coverage in every channel: white is ink. */
  atlas(): string;
  /** The suns, the sites and the place the visitor starts. */
  meta(): Record<string, unknown>;
  /** Where the camera stands now. */
  cameraPose(): { position: number[]; quaternion: number[]; fov: number; aspect: number; near: number; far: number };
}

declare global {
  interface Window {
    __realExport?: RealExport;
  }
}

export function installExport(world: World): void {
  const scene = world.scene;

  const api: RealExport = {
    meshes() {
      scene.updateMatrixWorld(true);
      return findMeshes(scene).map((f) => flatten(f).info);
    },
    signatures() {
      scene.updateMatrixWorld(true);
      const out: Record<string, string> = {};
      for (const f of findMeshes(scene)) out[f.path] = signature(f.mesh);
      return out;
    },
    chunk(id, skip) {
      scene.updateMatrixWorld(true);
      const leave = new Set(skip);
      const parts: Part[] = [];
      for (const f of findMeshes(scene)) {
        if (f.chunk !== id || leave.has(f.path)) continue;
        parts.push(flatten(f).part);
      }
      return base64(writeGlb(parts, { chunk: id }));
    },
    atlas() {
      let url = '';
      scene.traverse((o) => {
        if (url) return;
        const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        const tex = mat?.uniforms?.uAtlas?.value as THREE.Texture | undefined;
        const image = tex?.image as HTMLCanvasElement | undefined;
        if (image && typeof image.toDataURL === 'function') url = image.toDataURL('image/png');
      });
      return url;
    },
    meta() {
      // The drawn sun hangs lower than the light that shades the ink world. Its place is not
      // exported by the sky, so read it back from the disc: the first part of the sun-moon mesh.
      let sunAt: number[] | null = null;
      const lights = scene.getObjectByName('sun-moon') as THREE.Mesh | undefined;
      if (lights) {
        const pos = lights.geometry.getAttribute('position') as THREE.BufferAttribute;
        const idx = lights.geometry.index;
        if (idx) {
          const ids = partIds(idx.array as ArrayLike<number>, pos.count, sameBytes(lights.geometry));
          const c = new THREE.Vector3();
          let n = 0;
          for (let i = 0; i < pos.count && ids[i] === 0; i++) {
            c.add(v3.fromBufferAttribute(pos, i));
            n++;
          }
          if (n > 0) sunAt = c.divideScalar(n).normalize().toArray();
        }
      }
      return {
        sunShading: SUN.toArray(),
        sunAt,
        spawn: SPAWN,
        sites: SITES.map((s) => ({ id: s.id, name: s.name, center: s.center, radius: s.radius, height: s.height, arrive: s.arrive })),
      };
    },
    cameraPose() {
      const cam = world.camera();
      cam.updateMatrixWorld();
      return {
        position: cam.getWorldPosition(new THREE.Vector3()).toArray(),
        quaternion: cam.getWorldQuaternion(new THREE.Quaternion()).toArray(),
        fov: cam.fov,
        aspect: cam.aspect,
        near: cam.near,
        far: cam.far,
      };
    },
  };
  window.__realExport = api;
}
