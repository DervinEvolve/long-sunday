// The real look, in the browser. The same world as the ink look, as if it had been built from the
// same blueprints and photographed late in the day. The pipeline (docs/REAL.md) baked it: glTF
// chunks with their light in lightmaps, a small library of tiling textures, a sky. This file shows
// that, in the scene the ink look already runs, and hands the scene back untouched when it leaves.
//
// How the two looks share one scene:
//   - Baked chunks hang under one group ("real"). It is in the scene only while this look is active
//     and it is hidden while an ink page is drawn.
//   - An ink mesh that a loaded chunk stands in for moves to layer 1. The walking camera sees layer 0,
//     so it is gone from the real picture. For an ink page during a change-over the camera sees both.
//   - Everything else the ink look draws (the figure, markers, the train, the whale, flags, clouds,
//     and the ink geometry of any chunk that has not arrived yet) is drawn with a stand-in material
//     that reads the same vertex attributes. So there is never a hole.
//
// world.ts loads this file with a dynamic import the first time the visitor switches.
import * as THREE from 'three';
import type { DistrictId, QualityTier } from '../types';
import type { Manifest, ManifestChunk, RealCost, RealDebug, RealHost, RealLook } from './api';
import { asset, assetJson, dropTexture, gunzip, loadSky, loadTexture, requestCount, textureBytes, type SkyData } from './assets';
import { readChunk } from './glb';
import { bakedMaterial, sharedUniforms, standIns, texturesOf, type BakedInputs, type SharedUniforms, type StandIns, type TextureRole, type TextureWant } from './materials';
import { createPost, type Lut, type Post } from './post';

const MB = 1024 * 1024;
/** How much the baked chunks may hold on the graphics card, geometry and lightmaps together. The
 *  base set (ground, city, far sky) is always in; districts beyond the ceiling are freed, furthest first. */
const CEILING_HALF = 100 * MB;
const CEILING: Record<QualityTier, number> = { low: 100 * MB, medium: 230 * MB, high: 340 * MB };
const SAMPLES: Record<QualityTier, number> = { low: 0, medium: 4, high: 4 };
const SHADOW_SIZE: Record<QualityTier, number> = { low: 0, medium: 1024, high: 2048 };
const ANISOTROPY: Record<QualityTier, number> = { low: 2, medium: 4, high: 8 };
/** Half the width of the box the sun's shadow map covers, centred on the visitor. */
const SHADOW_REACH = 9;
/** Most of the haze a far thing can take. The ink look goes to 0.9. A photograph keeps more of the far side. */
const HAZE_MOST = 0.62;
/** On top of the manifest's exposure, to hold the Trailhead to the Cycles pictures (they have no lens
 *  falloff and no haze). See "What I measured" in docs/REAL.md. */
const EXPOSURE_TRIM = 1.04;
/** How far open sky leans toward the district's drawn sky, after the tone curve: at the horizon,
 *  overhead. The haze takes the horizon share too, so the skyline melts into the same colour. */
const TINT_LOW = 0.75;
const TINT_HIGH = 0.35;
/** How much of the photographed sky's own brightness the leaning keeps (1 all of it, 0 the drawn colour's). */
const TINT_KEEP = 0.4;
/** Whether the drawn clouds come into the built look. Lit softly through they still read as cut-outs
 *  pinned on a photograph (.shots/real/pr-b-sheet-clouds.png), and the Cycles pictures have none. So
 *  the built sky is clear. realTune('clouds', 1) brings them back to look at. */
const CLOUDS = false;
/** Layer for ink meshes the real picture must not show. */
const INK_ONLY = 1;
/** Layer the light maps of the ground are drawn through: the baked ground and districts, and the lights. */
const PROBE = 3;
/** Texels a side of the map of light on the ground, for the whole island and for one district. */
const LIGHT_MAP_GROUND = 1024;
const LIGHT_MAP_DISTRICT = 256;
/** How high above his feet the point is that answers for his head. */
const HEAD = 1.3;
/** Top level groups of the ink scene that are not districts, and the chunk that stands in for each. */
const BASE_OF: Record<string, string> = { terrain: 'ground', scatter: 'city', sky: 'sky' };

interface Chunk {
  info: ManifestChunk;
  district: boolean;
  state: 'none' | 'loading' | 'ready' | 'failed';
  group: THREE.Group | null;
  materials: THREE.Material[];
  lightmaps: THREE.Texture[];
  bytes: number;
  /** The world's say on a district chunk: in range, affordable, on screen. */
  shown: boolean;
  tries: number;
  retryAt: number;
  job: Promise<void> | null;
  /** The light on this chunk's ground, seen from straight above. See "The light on the figure". */
  ground: GroundLight | null;
  groundState: 'none' | 'coming' | 'ready';
}

interface GroundLight {
  data: Uint8Array;
  size: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** One mesh of the ink scene and what the real look does with it. */
interface InkMesh {
  mesh: THREE.Mesh;
  /** Chunk that stands in for it, or '' when it is always drawn (it moves, or belongs to no chunk). */
  chunk: string;
  /** District or base group it lives under, '' for the figure and the markers. */
  home: string;
  drop: boolean;
  /** One of the drawn clouds. */
  cloud: boolean;
  /** The drawn blob under the figure. Here it is the soft dark where his feet meet the ground. */
  blob: boolean;
  casts: boolean;
  ink: THREE.Material;
  stand: THREE.Material;
  triangles: number;
  /** Drawn in the real picture right now (stand-in material on, layer 0). */
  drawn: boolean;
}

function wantsHalf(tier: QualityTier): boolean {
  if (tier === 'low') return true;
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return true;
    // Phones and tablets: the full set is a quarter of a gigabyte of lightmaps. They get the half set.
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function createReal(host: RealHost): RealLook {
  const { scene, ink } = host;
  const renderer = ink.renderer;
  const inkMaterial = ink.kit.material;

  const root = new THREE.Group();
  root.name = 'real';
  root.userData.real = true;

  let manifest: Manifest | null = null;
  let sky: SkyData | null = null;
  /** The sky, blurred into the mip chain rough surfaces reflect. Made here and freed here: left to
   *  three.js, the tools that make it would stay on the graphics card after this look has gone. */
  let mirror: THREE.WebGLRenderTarget | null = null;
  let u: SharedUniforms | null = null;
  let post: Post | null = null;
  let curve: Lut | null = null;
  let stands: StandIns | null = null;
  let sun: THREE.DirectionalLight | null = null;
  let hemi: THREE.HemisphereLight | null = null;
  const sunDir = new THREE.Vector3(-0.62, 0.36, 0.7).normalize();
  /** The haze colours as the baked sky gives them, before the district's own sky leans on them. */
  const hazeAway0 = new THREE.Vector3(1, 1, 1);
  const hazeToward0 = new THREE.Vector3(1, 1, 1);
  const tintHorizon = new THREE.Vector3(1, 1, 1);
  const skyTop = new THREE.Vector3();
  const skyMid = new THREE.Vector3();
  const skyHorizon = new THREE.Vector3();
  let tintKey = '';
  /** Whether the drawn clouds are drawn in this look at all. */
  let cloudsShown = CLOUDS;

  const chunks = new Map<string, Chunk>();
  const textures = new Map<string, THREE.Texture>();
  const texturesComing = new Map<string, Promise<THREE.Texture>>();
  /** Files already reported missing, so the console says it once. */
  const warned = new Set<string>();
  /** Files that failed, and when they may be asked for again. */
  const flatUntil = new Map<string, number>();
  const retired: THREE.Texture[] = [];
  let inkMeshes: InkMesh[] = [];
  const drawnList: InkMesh[] = [];

  let tier: QualityTier = host.tier();
  let half = wantsHalf(tier);
  let ready = false;
  let on = false;
  /** Bumped by release(): anything still loading from before then is thrown away when it lands. */
  let generation = 0;
  let preparing: Promise<void> | null = null;
  let report: (p: number) => void = () => {};
  let stillWanted: () => boolean = () => true;
  let sizeW = 1;
  let sizeH = 1;
  let sizePr = 1;
  let fogNear = 45;
  let fogFar = 620;
  let clock = 0;
  let streamAt = 0;
  let costsDirty = true;
  const reserveNow: RealCost = { calls: 0, triangles: 0 };
  /** The district the sun's shadow box can reach into right now, '' on open ground. */
  let shadowHome = '';
  const districtCost = new Map<string, RealCost>();
  const liveCost = new Map<string, RealCost>();

  const ceiling = (): number => (half ? CEILING_HALF : CEILING[tier]);
  const shadowsOn = (): boolean => SHADOW_SIZE[tier] > 0;

  // -------------------------------------------------------------------------------------------
  // Shared textures
  // -------------------------------------------------------------------------------------------
  function texture(file: string, want: TextureWant): Promise<THREE.Texture> {
    // A file that failed is asked for again by the next chunk that needs it, once 20 seconds have
    // passed. Before that the flat stand-in serves, so a dozen chunks do not ask a dozen times.
    const again = flatUntil.get(file);
    if (again !== undefined && clock >= again) {
      flatUntil.delete(file);
      texturesComing.delete(file);
    }
    let p = texturesComing.get(file);
    if (!p) {
      const gen = generation;
      const aniso = Math.min(ANISOTROPY[tier], renderer.capabilities.getMaxAnisotropy());
      const keep = (t: THREE.Texture): THREE.Texture => {
        if (gen !== generation) {
          dropTexture(t);
          throw new Error('released');
        }
        // A file asked for again replaces its flat stand-in. Chunks made before still use that one,
        // so it is freed with everything else when the look is let go.
        const was = textures.get(file);
        if (was && was !== t) retired.push(was);
        textures.set(file, t);
        upload(t);
        return t;
      };
      const coming: Promise<THREE.Texture> = loadTexture(file, { ...want, anisotropy: aniso }).then(keep, (err: unknown) => {
        if (gen !== generation) throw new Error('released');
        // One missing picture must not cost the whole look. The surfaces that use it go flat.
        if (!warned.has(file)) {
          warned.add(file);
          console.warn(`[real] ${file} did not load. Those surfaces are drawn flat.`, err);
        }
        flatUntil.set(file, clock + 20);
        return keep(flatTexture(want));
      });
      p = coming;
      texturesComing.set(file, p);
    }
    return p;
  }

  /** One texel that stands in for a picture of this kind: mid grey, a flat normal, open and fairly
   *  rough with no metal, no letters. */
  function flatTexture(want: TextureWant): THREE.Texture {
    const texel: Record<TextureRole, [number, number, number, number]> = {
      color: [176, 172, 166, 255],
      normal: [128, 128, 255, 255],
      orm: [255, 200, 0, 255],
      swatch: [255, 160, 0, 255],
      atlas: [0, 0, 0, 255],
    };
    const t = new THREE.DataTexture(new Uint8Array(texel[want.role]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.name = 'flat-' + want.role;
    t.colorSpace = want.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (want.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  /** Send a texture to the card now, between frames, so the first frame that shows it does not stall. */
  function upload(t: THREE.Texture): void {
    if (ink.lost()) return;
    try {
      renderer.initTexture(t);
    } catch {
      // It will go up with the first draw.
    }
  }

  // -------------------------------------------------------------------------------------------
  // Chunks
  // -------------------------------------------------------------------------------------------
  function weightOf(c: ManifestChunk): number {
    let n = c.bytes;
    for (const l of c.lightmaps) n += half && l.halfBytes ? l.halfBytes : l.bytes;
    return n;
  }

  function guessBytes(c: ManifestChunk): number {
    let n = c.rawBytes * 1.7;
    for (const l of c.lightmaps) n += ((l.size * l.size * 4 * 4) / 3) * (half ? 0.25 : 1);
    return n;
  }

  function usedBytes(): number {
    let n = 0;
    for (const c of chunks.values()) if (c.state === 'ready') n += c.bytes;
    return n;
  }

  function disposeChunk(c: Chunk): void {
    if (c.group) {
      root.remove(c.group);
      c.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    for (const m of c.materials) m.dispose();
    for (const t of c.lightmaps) dropTexture(t);
    c.group = null;
    c.materials = [];
    c.lightmaps = [];
    c.bytes = 0;
    c.ground = null;
    c.groundState = 'none';
  }

  function unloadChunk(c: Chunk): void {
    disposeChunk(c);
    c.state = 'none';
    c.job = null;
    chunkChanged(c);
  }

  function loadChunk(c: Chunk, tick?: (bytes: number) => void): Promise<void> {
    if (c.job) return c.job;
    const gen = generation;
    const info = c.info;
    c.state = 'loading';
    const inputs = (): BakedInputs => ({ manifest: manifest!, u: u!, sky: mirror!.texture, textures, half, coverage: SAMPLES[tier] > 0 });
    const job = (async () => {
      const lightmaps: THREE.Texture[] = [];
      try {
        const need: Promise<unknown>[] = [];
        for (const name of info.materials) for (const t of texturesOf(manifest!, name, half)) need.push(texture(t.file, t));
        const geometry = asset(info.file).then((b) => {
          tick?.(info.bytes);
          return gunzip(b);
        });
        const maps = Promise.all(
          info.lightmaps.map(async (l) => {
            const t = await loadTexture(half && l.half ? l.half : l.file, { srgb: true, channel: 1 });
            lightmaps.push(t);
            tick?.(half && l.halfBytes ? l.halfBytes : l.bytes);
            return t;
          }),
        );
        const [bytes, pages] = await Promise.all([geometry, maps, Promise.all(need)]);
        const read = await readChunk(bytes, 'real-' + info.id);
        if (gen !== generation) {
          for (const r of read.meshes) r.mesh.geometry.dispose();
          throw new Error('released');
        }

        const made = new Map<string, THREE.MeshStandardMaterial>();
        const buffers = new Set<ArrayBufferLike>();
        let size = 0;
        const group = read.group;
        for (const { mesh, material: name, page } of read.meshes) {
          const key = name + ':' + page;
          let mat = made.get(key);
          if (!mat) made.set(key, (mat = bakedMaterial(name, pages[page] ?? pages[0] ?? null, inputs())));
          mesh.material = mat;
          mesh.receiveShadow = true;
          // What he can stand on: the ground and the floors of districts. Their light is mapped from above.
          if (!mat.transparent && (c.district || info.id === 'ground')) mesh.layers.enable(PROBE);
          if (mat.transparent) mesh.renderOrder = name === 'lettering' ? 2 : 1;
          // Once the numbers are on the card the copy in memory is dead weight. Bounds are already worked out.
          const g = mesh.geometry;
          const drop = function (this: { array: unknown }): void {
            this.array = null;
          };
          const each = (a: THREE.BufferAttribute | null): void => {
            if (!a) return;
            const arr = a.array as unknown as ArrayBufferView;
            if (!buffers.has(arr.buffer)) {
              buffers.add(arr.buffer);
              size += arr.byteLength;
            }
            (a as unknown as { onUpload(cb: () => void): void }).onUpload(drop);
          };
          for (const k of Object.keys(g.attributes)) each(g.attributes[k] as THREE.BufferAttribute);
          each(g.index);
        }
        for (const t of pages) {
          size += textureBytes(t);
          upload(t);
        }
        c.group = group;
        c.materials = Array.from(made.values());
        c.lightmaps = pages;
        c.bytes = size;
        c.state = 'ready';
        c.tries = 0;
        group.visible = c.district ? c.shown : true;
        root.add(group);
        chunkChanged(c);
      } catch (err) {
        for (const t of lightmaps) dropTexture(t);
        if (gen !== generation) return;
        c.state = 'failed';
        c.tries++;
        c.retryAt = clock + 20 * c.tries;
        c.job = null;
        throw err;
      }
    })();
    c.job = job;
    return job;
  }

  /** A chunk arrived or left: the ink meshes it stands in for swap places with it. */
  function chunkChanged(c: Chunk): void {
    costsDirty = true;
    if (!on) return;
    for (const e of inkMeshes) if (e.chunk === c.info.id) place(e);
    listDrawn();
  }

  // -------------------------------------------------------------------------------------------
  // The ink scene's meshes
  // -------------------------------------------------------------------------------------------
  function trianglesOf(mesh: THREE.Mesh): number {
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const n = (g.index ? g.index.count : pos ? pos.count : 0) / 3;
    const inst = mesh as THREE.InstancedMesh;
    return Math.round(inst.isInstancedMesh ? n * inst.count : n);
  }

  /** Names every ink mesh the way the export did (group, slash, mesh, #n for a repeat) and looks
   *  up what the manifest says about it. */
  function scan(): void {
    const m = manifest;
    const list: InkMesh[] = [];
    if (!m || !stands) {
      inkMeshes = list;
      return;
    }
    const liveSet = new Set<string>(m.live);
    const dropSet = new Set<string>(m.drop);
    const bakedSet = new Set<string>();
    const chunkIds = new Set<string>();
    for (const c of m.chunks) {
      chunkIds.add(c.id);
      for (const p of c.live) liveSet.add(p);
      for (const p of c.drop) dropSet.add(p);
      for (const p of c.replaces) bakedSet.add(p);
    }
    const seen = new Map<string, number>();
    for (const top of scene.children) {
      if (top === root) continue;
      const home = BASE_OF[top.name] ?? (chunkIds.has(top.name) ? top.name : '');
      top.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        let path = top === o ? o.name : `${top.name}/${o.name}`;
        const n = seen.get(path) ?? 0;
        seen.set(path, n + 1);
        if (n > 0) path = `${path}#${n}`;
        const mat = mesh.material as THREE.Material;
        // Only what the ink kit made. Anything else in the scene is not mine to restyle.
        if (mat !== inkMaterial && mat.name !== 'ink-instanced') return;
        const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh === true;
        // A mesh the bake never named is newer than the bake (something added to a district since).
        // It stays drawn, as if it moved, so it never goes missing.
        const live = liveSet.has(path) || home === '' || (!bakedSet.has(path) && !dropSet.has(path));
        const blob = path === 'figure/figure-shadow';
        list.push({
          mesh,
          // A mesh the bake names is hidden once its chunk is in.
          chunk: live ? '' : home,
          home,
          drop: dropSet.has(path),
          cloud: path.startsWith('sky/clouds'),
          blob,
          // Things near the ground that move throw a shadow. Markers glow, clouds and birds are far above.
          casts: live && !blob && path !== 'poi-markers' && home !== 'sky' && !path.startsWith('debug'),
          ink: mat,
          stand: blob
            ? stands!.patch
            : top.name === 'figure'
              ? stands!.figure
              : path.startsWith('sky/clouds')
                ? stands!.cloud
                : live
                  ? instanced
                    ? stands!.instanced
                    : stands!.plain
                  : instanced
                    ? stands!.waitingInstanced
                    : stands!.waiting,
          triangles: trianglesOf(mesh),
          drawn: false,
        });
      });
    }
    inkMeshes = list;
    costsDirty = true;
  }

  /** Put one ink mesh where it belongs while the real look is active. */
  function place(e: InkMesh): void {
    const c = e.chunk ? chunks.get(e.chunk) : undefined;
    const covered = c !== undefined && c.state === 'ready';
    const hidden = e.drop || covered || (e.cloud && !cloudsShown);
    e.drawn = !hidden;
    if (hidden) {
      e.mesh.layers.set(INK_ONLY);
      e.mesh.material = e.ink;
      e.mesh.castShadow = false;
    } else {
      e.mesh.layers.set(0);
      e.mesh.material = e.stand;
      e.mesh.castShadow = e.casts;
      e.mesh.receiveShadow = !e.blob;
    }
  }

  function listDrawn(): void {
    drawnList.length = 0;
    for (const e of inkMeshes) if (e.drawn) drawnList.push(e);
  }

  /** Every ink mesh back exactly as the ink look had it. */
  function restore(): void {
    for (const e of inkMeshes) {
      e.mesh.layers.set(0);
      e.mesh.material = e.ink;
      e.mesh.castShadow = false;
      e.mesh.receiveShadow = false;
      e.drawn = false;
    }
    drawnList.length = 0;
  }

  /** An sRGB palette colour as a linear hue whose brightness is 1. */
  function hueOf(c: THREE.Color, out: THREE.Vector3): void {
    const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    out.set(lin(c.r), lin(c.g), lin(c.b));
    const l = 0.2126 * out.x + 0.7152 * out.y + 0.0722 * out.z;
    if (l > 1e-4) out.multiplyScalar(1 / l);
    else out.set(1, 1, 1);
  }

  /** The haze keeps its brightness and takes the horizon's hue by the horizon's share. */
  function leanHaze(base: THREE.Vector3, out: THREE.Vector3): void {
    const l = 0.2126 * base.x + 0.7152 * base.y + 0.0722 * base.z;
    out.copy(base).lerp(new THREE.Vector3().copy(tintHorizon).multiplyScalar(l), TINT_LOW);
  }

  // -------------------------------------------------------------------------------------------
  // Light for what moves
  // -------------------------------------------------------------------------------------------
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  const anchor = new THREE.Vector3();

  function makeLights(m: Manifest, s: SkyData): void {
    sunDir.fromArray(m.sun.direction).normalize();
    sun = new THREE.DirectionalLight(0xffffff, m.sun.irradiance);
    sun.name = 'real-sun';
    sun.color.setRGB(m.sun.color[0], m.sun.color[1], m.sun.color[2]);
    u!.uSunDir.value.copy(sunDir);
    u!.uSunE.value.set(m.sun.color[0], m.sun.color[1], m.sun.color[2]).multiplyScalar(m.sun.irradiance);
    {
      const c = new THREE.Vector3().fromArray(m.sun.color);
      const l = 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z;
      if (l > 0) c.multiplyScalar(1 / l);
      else c.set(1, 1, 1);
      // Half of the sun's hue taken back out of the light on things that move. See STANDIN_EXPOSURE.
      u!.uSunKeep.value.set(1 / (1 + (c.x - 1) * 0.5), 1 / (1 + (c.y - 1) * 0.5), 1 / (1 + (c.z - 1) * 0.5));
    }
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 2.5;
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_REACH;
    cam.right = cam.top = SHADOW_REACH;
    cam.near = 1;
    cam.far = 90;
    cam.updateProjectionMatrix();
    // The sky light, from the same sky the bake was lit by, scaled to what the bake put on level ground.
    const lum = 0.2126 * s.up.x + 0.7152 * s.up.y + 0.0722 * s.up.z;
    const k = lum > 0 ? m.sun.skyIrradiance / lum : 1;
    hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    hemi.name = 'real-skylight';
    hemi.color.setRGB(s.up.x * k, s.up.y * k, s.up.z * k);
    hemi.groundColor.setRGB(s.down.x * k, s.down.y * k, s.down.z * k);
    u!.uSkyUp.value.set(s.up.x * k, s.up.y * k, s.up.z * k);
    u!.uSkyDown.value.set(s.down.x * k, s.down.y * k, s.down.z * k);
    // Haze takes the colour of the sky at the horizon. Toward the sun that is very bright, so it is held back.
    const tame = (v: THREE.Vector3, most: number): THREE.Vector3 => {
      const l = 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
      return l > most ? v.clone().multiplyScalar(most / l) : v.clone();
    };
    hazeAway0.copy(tame(s.away, 1.1));
    hazeToward0.copy(tame(s.toward, 2.6));
    u!.uHazeAway.value.copy(hazeAway0);
    u!.uHazeToward.value.copy(hazeToward0);
    tintKey = '';
    const flat = Math.hypot(sunDir.x, sunDir.z) || 1;
    u!.uHazeSun.value.set(sunDir.x / flat, sunDir.z / flat);
    lightRight.crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
    lightUp.crossVectors(sunDir, lightRight).normalize();
    sun.layers.enable(PROBE);
    hemi.layers.enable(PROBE);
    root.add(sun, sun.target, hemi);
    applyShadowTier();
  }

  function applyShadowTier(): void {
    if (!sun) return;
    const size = SHADOW_SIZE[tier];
    const cast = size > 0;
    if (cast && sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = cast;
    if (on) renderer.shadowMap.enabled = cast;
    // With a real shadow the patch under him only has to say where his feet touch. Without one it is all there is.
    if (stands) stands.patch.uniforms.uOpacity.value = cast ? 0.34 : 0.5;
  }

  /** The shadow box rides with the visitor, in whole texels so the shadow's edge does not crawl. */
  function moveShadow(x: number, y: number, z: number): void {
    if (!sun) return;
    const texel = (SHADOW_REACH * 2) / Math.max(1, sun.shadow.mapSize.x);
    anchor.set(x, y + 1, z);
    const r = Math.round(anchor.dot(lightRight) / texel) * texel;
    const up = Math.round(anchor.dot(lightUp) / texel) * texel;
    const f = anchor.dot(sunDir);
    anchor.set(0, 0, 0).addScaledVector(lightRight, r).addScaledVector(lightUp, up).addScaledVector(sunDir, f);
    sun.target.position.copy(anchor);
    sun.position.copy(anchor).addScaledVector(sunDir, 45);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  // -------------------------------------------------------------------------------------------
  // The light on the figure. The sun lamp shines through walls: the baked world's shadows are in
  // its lightmaps, and a lamp knows nothing of them. So when a chunk he can stand on arrives (the
  // ground, a district) I draw it once from straight above, with every baked surface writing out
  // its light and nothing else, and keep that small picture in memory. From then on, asking how much
  // sun reaches the ground at a spot is a lookup. A point on him at height h is in shade when the
  // ground h / tan(sun height) further down-sun is. His feet ask where he stands, his head asks a
  // few metres on. No work per frame, and the answer is there at once.
  // -------------------------------------------------------------------------------------------
  const mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 100);
  mapCam.layers.set(PROBE);
  mapCam.up.set(0, 0, -1);
  const probed = { low: 1, high: 1, amb: 1 };
  let mapsBusy = 0;

  /** Draw one chunk's ground light from above and read it back. One chunk a frame, while active. */
  function mapGround(c: Chunk): void {
    if (!u || !c.group || ink.lost()) return;
    const box = c.info.bounds.box;
    const size = c.district ? LIGHT_MAP_DISTRICT : half ? LIGHT_MAP_GROUND / 2 : LIGHT_MAP_GROUND;
    const x0 = box[0];
    const z0 = box[2];
    const x1 = box[3];
    const z1 = box[5];
    // A district is looked at from just over head height above its pad, so roofs, arches and crowns are
    // out of the picture and the floor under them is in. The ground has nothing over it in its own chunk.
    const site = c.district ? host.sites.find((s) => s.id === c.info.id) : undefined;
    const top = site ? site.y + 2.4 : box[4] + 1;
    const depth = site ? 9 : box[4] - box[1] + 2;
    mapCam.left = -(x1 - x0) / 2;
    mapCam.right = (x1 - x0) / 2;
    mapCam.top = (z1 - z0) / 2;
    mapCam.bottom = -(z1 - z0) / 2;
    mapCam.near = 0.01;
    mapCam.far = depth;
    mapCam.position.set((x0 + x1) / 2, top, (z0 + z1) / 2);
    mapCam.lookAt((x0 + x1) / 2, top - 10, (z0 + z1) / 2);
    mapCam.updateProjectionMatrix();
    mapCam.updateMatrixWorld();
    const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false });
    // Only this chunk, and the sky off: the sky is not on the mapping layer anyway.
    const hid: THREE.Object3D[] = [];
    for (const other of chunks.values()) {
      if (other !== c && other.group && other.group.visible) {
        other.group.visible = false;
        hid.push(other.group);
      }
    }
    const shownWas = c.group.visible;
    c.group.visible = true;
    const autoWas = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    u.uProbe.value = 1;
    renderer.setRenderTarget(target);
    renderer.render(root, mapCam);
    renderer.setRenderTarget(null);
    u.uProbe.value = 0;
    renderer.shadowMap.autoUpdate = autoWas;
    c.group.visible = shownWas;
    for (const o of hid) o.visible = true;

    const data = new Uint8Array(size * size * 4);
    const gen = generation;
    c.groundState = 'coming';
    mapsBusy++;
    renderer
      .readRenderTargetPixelsAsync(target, 0, 0, size, size, data)
      .then(() => {
        if (gen !== generation || c.state !== 'ready') return;
        c.ground = { data, size, x0, z0, x1, z1 };
        c.groundState = 'ready';
      })
      .catch(() => {
        // No map for this chunk: he is lit as in open air while he stands on it.
        if (gen === generation) c.groundState = 'ready';
      })
      .finally(() => {
        // After a release the count has been set back already. A lost context may never answer at all.
        if (gen === generation) mapsBusy--;
        target.dispose();
      });
  }

  function mapNext(): void {
    if (mapsBusy > 0) return;
    // Wait for the first full frame: before it the sun has no shadow map yet, and three.js would bind
    // a blank texture of its own in its place, which then never leaves the card.
    if (sun && sun.castShadow && renderer.shadowMap.enabled && !sun.shadow.map) return;
    for (const c of chunks.values()) {
      if (c.state === 'ready' && c.groundState === 'none' && (c.district || c.info.id === 'ground')) {
        mapGround(c);
        return;
      }
    }
  }

  /** Light on the ground at a spot, as one number in the lightmaps' units, or -1 where a map has nothing. */
  function lightIn(g: GroundLight, x: number, z: number): number {
    const fx = ((x - g.x0) / (g.x1 - g.x0)) * g.size - 0.5;
    // Row 0 of what comes back is the bottom of the picture, and the picture's bottom is the south edge.
    const fz = ((g.z1 - z) / (g.z1 - g.z0)) * g.size - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= g.size - 1 || iz >= g.size - 1) return -1;
    const tx = fx - ix;
    const tz = fz - iz;
    let sum = 0;
    let weight = 0;
    for (let k = 0; k < 4; k++) {
      const o = ((iz + (k >> 1)) * g.size + ix + (k & 1)) * 4;
      if (g.data[o + 3] < 128) continue;
      const w = ((k & 1) === 1 ? tx : 1 - tx) * (k >> 1 === 1 ? tz : 1 - tz);
      // Each channel holds sqrt(light / 10).
      const r = (g.data[o] / 255) ** 2;
      const gr = (g.data[o + 1] / 255) ** 2;
      const b = (g.data[o + 2] / 255) ** 2;
      sum += (0.2126 * r + 0.7152 * gr + 0.0722 * b) * 10 * w;
      weight += w;
    }
    return weight > 0.25 ? sum / weight : -1;
  }

  function groundLight(x: number, z: number): number {
    let base: Chunk | null = null;
    for (const c of chunks.values()) {
      if (!c.ground) continue;
      if (!c.district) {
        base = c;
        continue;
      }
      const b = c.info.bounds.box;
      if (x < b[0] || x > b[3] || z < b[2] || z > b[5]) continue;
      const e = lightIn(c.ground, x, z);
      if (e >= 0) return e;
    }
    return base && base.ground ? lightIn(base.ground, x, z) : -1;
  }

  function probe(x: number, z: number): void {
    const flat = Math.hypot(sunDir.x, sunDir.z) || 1;
    const reach = HEAD * (flat / Math.max(0.05, sunDir.y));
    const feet = groundLight(x, z);
    const head = groundLight(x - (sunDir.x / flat) * reach, z - (sunDir.z / flat) * reach);
    // Level ground in the sun takes about 2.5 to 3 (2 from the sun, 1 from the sky). In shade about 1 or less.
    const sunIn = (e: number): number => (e < 0 ? 1 : Math.min(1, Math.max(0, (e - 1.25) / 1.05)));
    probed.low = sunIn(feet);
    probed.high = sunIn(head);
    // The sky's share: what the ground at his feet gets once the sun is out of it, against open ground.
    probed.amb = feet < 0 ? 1 : Math.min(1.1, Math.max(0.4, feet));
  }

  /** Ease what the figure's material uses toward what the ground under him says. */
  function settleFigureLight(dt: number, x: number, y: number, z: number): void {
    if (!stands) return;
    probe(x, z);
    const vis = stands.figureLight.uSunVis.value;
    const k = 1 - Math.exp(-dt * 7);
    vis.x += (probed.low - vis.x) * k;
    vis.y += (probed.high - vis.y) * k;
    vis.z = y + 0.1;
    vis.w = y + HEAD;
    const amb = stands.figureLight.uAmb;
    amb.value += (probed.amb - amb.value) * k;
  }

  // -------------------------------------------------------------------------------------------
  // Costs, for the world's budget
  // -------------------------------------------------------------------------------------------
  function countCosts(): void {
    costsDirty = false;
    liveCost.clear();
    let calls = 0;
    let triangles = 0;
    let shadowCalls = 0;
    let shadowTris = 0;
    for (const e of inkMeshes) {
      const c = e.chunk ? chunks.get(e.chunk) : undefined;
      const covered = c !== undefined && c.state === 'ready';
      if (e.drop || covered || (e.cloud && !cloudsShown)) continue;
      const home = chunks.get(e.home);
      if (home && home.district) {
        // A district's own moving parts are part of what that district costs.
        if (covered || e.chunk === '') {
          let lc = liveCost.get(e.home);
          if (!lc) liveCost.set(e.home, (lc = { calls: 0, triangles: 0 }));
          // A part that throws a shadow is drawn a second time, into the sun's shadow map, when it is
          // within the shadow box. The box rides with the visitor, so only the district he is in counts twice.
          const times = e.casts && shadowsOn() && e.home === shadowHome ? 2 : 1;
          lc.calls += times;
          lc.triangles += e.triangles * times;
        }
        continue;
      }
      calls++;
      triangles += e.triangles;
      if (e.casts && shadowsOn()) {
        shadowCalls++;
        shadowTris += e.triangles;
      }
    }
    districtCost.clear();
    for (const c of chunks.values()) {
      if (c.state !== 'ready') continue;
      if (c.district) {
        const lc = liveCost.get(c.info.id);
        districtCost.set(c.info.id, { calls: c.info.drawCalls + (lc ? lc.calls : 0), triangles: c.info.triangles + (lc ? lc.triangles : 0) });
      } else {
        calls += c.info.drawCalls;
        triangles += c.info.triangles;
      }
    }
    // The sky, the output pass, the bloom chain, and the figure once more for the shadow map.
    const bloom = post && post.bloom() ? 9 : 0;
    reserveNow.calls = calls + 2 + bloom + shadowCalls;
    reserveNow.triangles = triangles + 2 + bloom + shadowTris;
  }

  // -------------------------------------------------------------------------------------------
  // Streaming: districts by distance, under the ceiling
  // -------------------------------------------------------------------------------------------
  const districtOrder: Chunk[] = [];
  const reach = (c: Chunk, x: number, z: number): number => {
    const s = c.info.bounds.sphere;
    return Math.hypot(x - s[0], z - s[2]) - s[3];
  };

  function stream(x: number, z: number): void {
    if (!ready) return;
    districtOrder.length = 0;
    let busy = 0;
    for (const c of chunks.values()) {
      if (c.state === 'loading') busy++;
      if (c.district) districtOrder.push(c);
    }
    if (busy > 0) return;
    districtOrder.sort((a, b) => reach(a, x, z) - reach(b, x, z));
    for (const c of districtOrder) {
      if (c.state === 'ready') continue;
      if (c.state === 'failed' && (c.tries >= 3 || clock < c.retryAt)) continue;
      const need = guessBytes(c.info);
      let used = usedBytes();
      // Room is made by letting go of whatever is further away than the one wanted. Never the other way.
      for (let i = districtOrder.length - 1; i >= 0 && used + need > ceiling(); i--) {
        const far = districtOrder[i];
        if (far === c) break;
        if (far.state !== 'ready') continue;
        used -= far.bytes;
        unloadChunk(far);
      }
      if (used + need > ceiling()) return;
      loadChunk(c).catch((err) => console.warn(`[real] ${c.info.id} did not load. The drawn version stands in.`, err));
      return;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Getting ready
  // -------------------------------------------------------------------------------------------
  async function getReady(at: { x: number; y: number; z: number }): Promise<void> {
    const gen = generation;
    const dead = (): boolean => gen !== generation;
    tier = host.tier();
    half = wantsHalf(tier);
    report(0);
    if (!manifest) {
      // No manifest means the real look's files are not beside this page. The world stops offering it.
      const missing = (why: unknown): Error => Object.assign(new Error('the real look has no manifest here'), { code: 'no-manifest', cause: why });
      const m = await assetJson<Manifest>('manifest.json').catch((err) => {
        throw missing(err);
      });
      if (!m || m.version !== 1 || !Array.isArray(m.chunks) || !m.look || !m.sun) throw missing('not a manifest I can read');
      manifest = m;
    }
    if (dead()) throw new Error('released');
    const m = manifest;
    for (const info of m.chunks) {
      if (!chunks.has(info.id)) {
        chunks.set(info.id, { info, district: info.kind === 'district', state: 'none', group: null, materials: [], lightmaps: [], bytes: 0, shown: true, tries: 0, retryAt: 0, job: null, ground: null, groundState: 'none' });
      }
    }
    if (!u) u = sharedUniforms(inkMaterial);

    // What has to be in before the picture can change: the sky, the base set, the district he is in or nearest.
    const first: Chunk[] = [];
    let nearest: Chunk | null = null;
    for (const c of chunks.values()) {
      if (!c.district) first.push(c);
      else if (!nearest || reach(c, at.x, at.z) < reach(nearest, at.x, at.z)) nearest = c;
    }
    if (nearest) first.push(nearest);
    let total = m.environment.bytes;
    for (const c of first) if (c.state !== 'ready') total += weightOf(c.info);
    let done = 0;
    const tick = (bytes: number): void => {
      done += bytes;
      // The last few percent are the card taking it all in.
      report(Math.min(0.97, (done / Math.max(1, total)) * 0.97));
    };

    sunDir.fromArray(m.sun.direction).normalize();
    if (!sky) {
      const s = await loadSky(m.environment.file, sunDir);
      if (dead()) {
        s.texture.dispose();
        throw new Error('released');
      }
      sky = s;
      upload(s.texture);
    }
    if (!mirror) {
      const maker = new THREE.PMREMGenerator(renderer);
      try {
        mirror = maker.fromEquirectangular(sky.texture);
        mirror.texture.name = 'real-sky-mirror';
      } finally {
        maker.dispose();
      }
    }
    const reflected = mirror.texture;
    tick(m.environment.bytes);
    // The tone curve the bake was judged under, when it ships one. Without it three's fitted AgX stands in.
    const L = m.look.lut;
    if (L && !curve) {
      try {
        const t = await loadTexture(L.file, { srgb: false });
        t.generateMipmaps = false;
        t.minFilter = t.magFilter = THREE.LinearFilter;
        t.anisotropy = 1;
        t.needsUpdate = true;
        if (dead()) {
          dropTexture(t);
          throw new Error('released');
        }
        curve = { texture: t, size: L.size, logMin: L.logMin, logMax: L.logMax };
        upload(t);
      } catch (err) {
        if (dead()) throw err;
        console.warn(`[real] ${L.file} did not load. The fitted AgX curve stands in.`, err);
      }
    }
    if (!stands) stands = standIns(u, reflected, SAMPLES[tier] > 0);
    if (!sun) makeLights(m, sky);
    applyShadowTier();
    if (!post) {
      post = createPost(sky.texture, sunDir, new THREE.Vector3().fromArray(m.sun.color), m.look.exposure * EXPOSURE_TRIM, curve);
      post.setSamples(SAMPLES[tier]);
      post.setBloom(tier === 'high');
      post.setSize(sizeW, sizeH, sizePr);
      root.add(post.sky);
    }
    u.uHaze.value.set(fogNear, fogFar, HAZE_MOST);

    // The base set has to be in. The district is good to have: without it the look still goes on, and
    // that district is drawn from its ink geometry until the file can be had.
    await Promise.all(
      first.map((c) =>
        c.state === 'ready'
          ? Promise.resolve()
          : loadChunk(c, tick).catch((err) => {
              if (!c.district || dead()) throw err;
              console.warn(`[real] ${c.info.id} did not load. The drawn version stands in.`, err);
            }),
      ),
    );
    if (dead()) throw new Error('released');

    // Compile the baked materials now, off the frame, so the first real picture does not stall on it.
    // The call sets the work going at once and hands back a promise for when the card is done.
    let compiled: Promise<unknown> = Promise.resolve();
    if (!ink.lost()) {
      const shadowWas = renderer.shadowMap.enabled;
      const typeWas = renderer.shadowMap.type;
      try {
        renderer.shadowMap.enabled = shadowsOn();
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        scene.add(root);
        renderer.setRenderTarget(post.target);
        compiled = renderer.compileAsync(root, host.camera(), scene).catch(() => undefined);
      } catch {
        // No harm: the first frame compiles what is missing.
      } finally {
        renderer.setRenderTarget(null);
        if (!on) {
          scene.remove(root);
          renderer.shadowMap.enabled = shadowWas;
          renderer.shadowMap.type = typeWas;
        }
      }
    }
    await compiled;
    if (dead()) throw new Error('released');
    ready = true;
    report(1);
  }

  // -------------------------------------------------------------------------------------------
  // The surface
  // -------------------------------------------------------------------------------------------
  let shadowWas = false;
  let shadowTypeWas: THREE.ShadowMapType = THREE.PCFShadowMap;

  const api: RealLook = {
    prepare(at, onProgress, alive) {
      report = onProgress;
      stillWanted = alive;
      if (ready) {
        onProgress(1);
        return Promise.resolve();
      }
      if (!preparing) {
        const p = getReady(at).finally(() => {
          if (preparing === p) preparing = null;
        });
        preparing = p;
      }
      return preparing.then(() => {
        if (!stillWanted()) throw new Error('abandoned');
      });
    },
    prepared: () => ready,
    holding: () => chunks.size > 0 || sky !== null || preparing !== null,
    setActive(want) {
      if (want === on || (want && !ready)) return;
      on = want;
      if (want) {
        shadowWas = renderer.shadowMap.enabled;
        shadowTypeWas = renderer.shadowMap.type;
        renderer.shadowMap.enabled = shadowsOn();
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        scene.add(root);
        scan();
        for (const e of inkMeshes) place(e);
        listDrawn();
      } else {
        restore();
        scene.remove(root);
        renderer.shadowMap.enabled = shadowWas;
        renderer.shadowMap.type = shadowTypeWas;
      }
      costsDirty = true;
    },
    active: () => on,
    update(dt, x, y, z) {
      clock += dt;
      if (!on) return;
      moveShadow(x, y, z);
      let home = '';
      for (const site of host.sites) {
        if (Math.hypot(x - site.x, z - site.z) < site.radius + SHADOW_REACH + 4) {
          home = site.id;
          break;
        }
      }
      if (home !== shadowHome) {
        shadowHome = home;
        costsDirty = true;
      }
      settleFigureLight(dt, x, y, z);
      mapNext();
      if (clock >= streamAt) {
        streamAt = clock + 0.3;
        stream(x, z);
      }
    },
    setShown(id, shown) {
      const c = chunks.get(id);
      if (!c) return;
      c.shown = shown;
      if (c.group) c.group.visible = shown;
    },
    cost(id: DistrictId) {
      if (costsDirty) countCosts();
      return districtCost.get(id) ?? null;
    },
    reserve() {
      if (costsDirty) countCosts();
      return reserveNow;
    },
    setFog(near, far) {
      fogNear = near;
      fogFar = far;
      if (u) u.uHaze.value.set(near, far, HAZE_MOST);
    },
    setSky(c) {
      if (!post || !u) return;
      // The palette is written as sRGB hex. Each stop becomes a hue of unit brightness in linear light.
      const key = c.top.getHexString() + c.mid.getHexString() + c.horizon.getHexString();
      if (key === tintKey) return;
      tintKey = key;
      hueOf(c.horizon, tintHorizon);
      post.setTint(skyTop.set(c.top.r, c.top.g, c.top.b), skyMid.set(c.mid.r, c.mid.g, c.mid.b), skyHorizon.set(c.horizon.r, c.horizon.g, c.horizon.b), TINT_LOW, TINT_HIGH, TINT_KEEP);
      leanHaze(hazeAway0, u.uHazeAway.value);
      leanHaze(hazeToward0, u.uHazeToward.value);
    },
    setSize(width, height, pixelRatio) {
      sizeW = width;
      sizeH = height;
      sizePr = pixelRatio;
      post?.setSize(width, height, pixelRatio);
    },
    setTier(next) {
      if (next === tier) return;
      tier = next;
      if (!post) return;
      post.setSamples(SAMPLES[tier]);
      post.setBloom(tier === 'high');
      const coverage = SAMPLES[tier] > 0;
      stands?.setCoverage(coverage);
      for (const c of chunks.values())
        for (const m of c.materials) {
          const sm = m as THREE.MeshStandardMaterial;
          if (sm.alphaTest > 0 && sm.alphaToCoverage !== coverage) {
            sm.alphaToCoverage = coverage;
            sm.needsUpdate = true;
          }
        }
      applyShadowTier();
      costsDirty = true;
    },
    rescan() {
      if (!on) return;
      restore();
      scan();
      for (const e of inkMeshes) place(e);
      listDrawn();
    },
    render(sceneNow, camera, time, mix, toReal) {
      if (!post || !on || ink.lost()) return;
      const mask = camera.layers.mask;
      if (mix < 1) {
        // A change-over frame: the ink page first, exactly as the ink look draws it, on the canvas.
        // The output pass lays the real frame over it.
        for (let i = 0; i < drawnList.length; i++) drawnList[i].mesh.material = drawnList[i].ink;
        root.visible = false;
        camera.layers.mask = mask | (1 << INK_ONLY);
        ink.render(sceneNow, camera, time);
        camera.layers.mask = mask;
        root.visible = true;
        for (let i = 0; i < drawnList.length; i++) drawnList[i].mesh.material = drawnList[i].stand;
      } else renderer.info.reset();
      renderer.setRenderTarget(post.target);
      renderer.render(sceneNow, camera);
      const frozen = u !== null && (u.uTime.value === 0 || u.uSway.value === 0);
      post.present(renderer, mix, toReal, mix < 1 ? ink.depth() : null, camera, time, frozen);
      const s = ink.stats();
      s.calls = renderer.info.render.calls;
      s.triangles = renderer.info.render.triangles;
    },
    release() {
      generation++;
      if (on) api.setActive(false);
      ready = false;
      preparing = null;
      for (const c of chunks.values()) disposeChunk(c);
      chunks.clear();
      for (const t of textures.values()) dropTexture(t);
      textures.clear();
      texturesComing.clear();
      flatUntil.clear();
      for (const t of retired) dropTexture(t);
      retired.length = 0;
      if (post) {
        root.remove(post.sky);
        post.dispose();
        post = null;
      }
      if (sun) {
        root.remove(sun, sun.target);
        sun.shadow.map?.dispose();
        sun.dispose();
        sun = null;
      }
      if (hemi) {
        root.remove(hemi);
        hemi.dispose();
        hemi = null;
      }
      stands?.dispose();
      stands = null;
      sky?.texture.dispose();
      sky = null;
      if (curve) dropTexture(curve.texture);
      curve = null;
      mirror?.dispose();
      mirror = null;
      inkMeshes = [];
      drawnList.length = 0;
      mapsBusy = 0;
      costsDirty = true;
    },
    tune(name, value) {
      if (post && post.tune(name, value)) return;
      if (name === 'clouds') {
        cloudsShown = value !== 0;
        if (on) {
          for (const e of inkMeshes) if (e.cloud) place(e);
          listDrawn();
        }
        costsDirty = true;
        return;
      }
      const target = (u as unknown as Record<string, THREE.IUniform | undefined> | null)?.[name];
      if (!target) return;
      if (typeof value === 'number') target.value = value;
      else (target.value as { fromArray(a: readonly number[]): void }).fromArray(value);
    },
    debug(): RealDebug {
      const loaded: string[] = [];
      const loading: string[] = [];
      const failed: string[] = [];
      for (const c of chunks.values()) (c.state === 'ready' ? loaded : c.state === 'loading' ? loading : c.state === 'failed' ? failed : []).push(c.info.id);
      return {
        active: on,
        half,
        loaded,
        loading,
        failed,
        chunkBytes: usedBytes(),
        ceilingBytes: ceiling(),
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
        requests: requestCount(),
        bloom: post?.bloom() ?? false,
        shadows: on && shadowsOn(),
        samples: post?.samples() ?? 0,
        figureLight: { low: probed.low, high: probed.high, sky: probed.amb },
        reserve: { calls: reserveNow.calls, triangles: reserveNow.triangles },
      };
    },
  };
  return api;
}
