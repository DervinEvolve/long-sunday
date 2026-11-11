// Opens one chunk file of the real look. The pack step writes a narrow kind of glTF and nothing
// else, so this reads exactly that: a binary .glb, one node per primitive with a scale and a
// translation, triangles only, every buffer view meshopt compressed, quantised attributes, materials
// by name. The general loader that ships with three.js would also do it, but it brings skinning,
// animation, cameras and lights with it, and because it shares three.js with the first bundle a part
// of that weight would land there. This is two hundred lines and adds nothing to the first load.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  min?: number[];
  max?: number[];
}
interface GltfView {
  byteStride?: number;
  extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string } };
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  material?: number;
}
interface GltfNode {
  name?: string;
  mesh?: number;
  translation?: number[];
  scale?: number[];
  rotation?: number[];
  matrix?: number[];
  children?: number[];
  extras?: Record<string, unknown>;
}
interface Gltf {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  materials?: { name?: string }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfView[];
  extensionsRequired?: string[];
}

const KNOWN = new Set(['KHR_mesh_quantization', 'EXT_meshopt_compression']);
const NAMES: Record<string, string> = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', COLOR_0: 'color' };
const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
type Typed = Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array;
type TypedMaker = new (buffer: ArrayBuffer, byteOffset: number, length: number) => Typed;
const ARRAYS: Record<number, TypedMaker> = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

/** One primitive of a chunk, as a mesh with a throwaway material. `material` is the name the manifest knows. */
export interface ChunkMesh {
  mesh: THREE.Mesh;
  material: string;
  page: number;
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Reads a chunk. The meshes come back under one group, in world space once the group is in the scene.
 *  Decoding is spread over several turns of the event loop so a walk in progress does not stall. */
export async function readChunk(bytes: ArrayBuffer, name: string): Promise<{ group: THREE.Group; meshes: ChunkMesh[] }> {
  const head = new DataView(bytes);
  if (bytes.byteLength < 20 || head.getUint32(0, true) !== 0x46546c67) throw new Error(`${name} is not a glb file`);
  const jsonLength = head.getUint32(12, true);
  if (head.getUint32(16, true) !== 0x4e4f534a) throw new Error(`${name} has no JSON part`);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as Gltf;
  const binAt = 20 + jsonLength;
  if (binAt + 8 > bytes.byteLength || head.getUint32(binAt + 4, true) !== 0x004e4942) throw new Error(`${name} has no binary part`);
  const bin = new Uint8Array(bytes, binAt + 8, head.getUint32(binAt, true));
  for (const ext of gltf.extensionsRequired ?? []) if (!KNOWN.has(ext)) throw new Error(`${name} needs ${ext}, which I do not read`);
  const dec = MeshoptDecoder as unknown as {
    supported: boolean;
    ready: Promise<void>;
    decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string): void;
  };
  if (!dec.supported) throw new Error('this browser cannot open the compressed geometry');
  await dec.ready;

  const views = gltf.bufferViews ?? [];
  const accessors = gltf.accessors ?? [];
  const opened = new Map<number, { data: ArrayBuffer; stride: number; count: number }>();
  const open = (index: number): { data: ArrayBuffer; stride: number; count: number } => {
    let v = opened.get(index);
    if (!v) {
      const ext = views[index]?.extensions?.EXT_meshopt_compression;
      if (!ext || ext.buffer !== 0) throw new Error(`${name}: buffer view ${index} is not compressed the way I expect`);
      const target = new Uint8Array(ext.count * ext.byteStride);
      dec.decodeGltfBuffer(target, ext.count, ext.byteStride, bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength), ext.mode, ext.filter);
      v = { data: target.buffer, stride: ext.byteStride, count: ext.count };
      opened.set(index, v);
    }
    return v;
  };
  const attribute = (index: number): THREE.BufferAttribute => {
    const a = accessors[index];
    const Maker = a ? ARRAYS[a.componentType] : undefined;
    const size = a ? SIZES[a.type] : 0;
    if (!a || !Maker || !size || (a.byteOffset ?? 0) !== 0) throw new Error(`${name}: accessor ${index} is of a kind I do not read`);
    const v = open(a.bufferView);
    const each = (Maker as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    // The packer pads each corner to four bytes: three shorts of position and one spare, three bytes
    // of normal and one spare. The spare goes to the card as a fourth number and the shader, which
    // asks for three, never sees it.
    const per = v.stride / each;
    if (per < size || per > 4 || per !== Math.floor(per) || a.count !== v.count) throw new Error(`${name}: accessor ${index} is packed in a way I do not read`);
    return new THREE.BufferAttribute(new Maker(v.data, 0, a.count * per), per, a.normalized === true);
  };

  const group = new THREE.Group();
  group.name = name;
  const meshes: ChunkMesh[] = [];
  const placeholder = new THREE.MeshBasicMaterial();
  const nodes = gltf.nodes ?? [];
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_n, i) => i);
  let sinceBreak = 0;
  for (const ni of roots) {
    const node = nodes[ni];
    if (!node || node.mesh === undefined) continue;
    if (node.children?.length || node.rotation || node.matrix) throw new Error(`${name}: node ${ni} is laid out in a way I do not read`);
    const def = gltf.meshes?.[node.mesh];
    for (const prim of def?.primitives ?? []) {
      if ((prim.mode ?? 4) !== 4) throw new Error(`${name}: only triangles`);
      const geometry = new THREE.BufferGeometry();
      let vertices = 0;
      for (const key of Object.keys(prim.attributes)) {
        const attr = attribute(prim.attributes[key]);
        geometry.setAttribute(NAMES[key] ?? key.toLowerCase(), attr);
        if (key === 'POSITION') vertices = attr.count;
      }
      if (prim.indices !== undefined) {
        const a = accessors[prim.indices];
        const v = open(a.bufferView);
        const wide = new Uint32Array(v.data, a.byteOffset ?? 0, a.count);
        // The packer writes every index in four bytes. Most primitives have few enough corners for two.
        geometry.setIndex(new THREE.BufferAttribute(vertices <= 65535 ? Uint16Array.from(wide) : wide, 1));
        sinceBreak += a.count;
      }
      const pa = accessors[prim.attributes.POSITION];
      if (pa?.min && pa.max) {
        // The file says how far the corners reach. No need to walk them.
        geometry.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(pa.min), new THREE.Vector3().fromArray(pa.max));
        geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
      }
      const mesh = new THREE.Mesh(geometry, placeholder);
      mesh.name = node.name ?? def?.name ?? name;
      if (node.translation) mesh.position.fromArray(node.translation);
      if (node.scale) mesh.scale.fromArray(node.scale);
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      const extras = node.extras ?? {};
      meshes.push({
        mesh,
        material: typeof extras.material === 'string' ? extras.material : (gltf.materials?.[prim.material ?? -1]?.name ?? ''),
        page: typeof extras.page === 'number' ? extras.page : 0,
      });
      if (sinceBreak > 90000) {
        sinceBreak = 0;
        await pause();
      }
    }
  }
  placeholder.dispose();
  group.updateMatrixWorld(true);
  return { group, meshes };
}
