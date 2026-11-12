// What the world and the second look know about each other. Types only: world.ts imports this
// file for its types and loads everything else in src/real with a dynamic import, the first time
// the visitor switches. So none of it is in the first bundle.
import type * as THREE from 'three';
import type { DistrictId, QualityTier } from '../types';
import type { Ink } from '../engine/ink';
import type { SkyColorsRGB } from '../engine/sky';

export interface RealCost {
  calls: number;
  triangles: number;
}

/** What the world hands over when it creates the real look. */
export interface RealHost {
  scene: THREE.Scene;
  ink: Ink;
  canvas: HTMLCanvasElement;
  tier(): QualityTier;
  /** The camera the next frame will be drawn with. */
  camera(): THREE.PerspectiveCamera;
  /** District ids in the world's own order, with where each one stands. */
  sites: readonly { id: DistrictId; x: number; y: number; z: number; radius: number }[];
}

export interface RealDebug {
  active: boolean;
  half: boolean;
  /** Chunk ids on screen, and the ones still coming. */
  loaded: string[];
  loading: string[];
  failed: string[];
  /** My own count of what the chunks hold on the graphics card, and the ceiling for this tier. */
  chunkBytes: number;
  ceilingBytes: number;
  /** renderer.info.memory, as three counts it. */
  geometries: number;
  textures: number;
  programs: number;
  requests: number;
  bloom: boolean;
  shadows: boolean;
  samples: number;
  /** What the ground under the figure says reaches him: sun at his feet and head (0..1), and the sky's share. */
  figureLight: { low: number; high: number; sky: number };
  /** What the budget sets aside for everything that is not a district, as last counted. */
  reserve: RealCost;
}

/** The real look: the same place, built and photographed. Made by createReal() in ./index. */
export interface RealLook {
  /** Fetch what is needed to stand at this spot: the manifest, the sky, the base set and the nearest
   *  district. Resolves when the look can be put on screen. `alive` going false abandons the job. */
  prepare(at: { x: number; y: number; z: number }, onProgress: (p: number) => void, alive: () => boolean): Promise<void>;
  /** True once prepare() has finished and nothing has been released since. */
  prepared(): boolean;
  /** True while anything of this look sits on the graphics card or is on its way there. */
  holding(): boolean;
  /** In or out of the scene. Out leaves every ink object exactly as the ink look had it. */
  setActive(on: boolean): void;
  active(): boolean;
  /** Once a frame while active, before the world decides what is shown: streaming, the sun's shadow box. */
  update(dt: number, x: number, y: number, z: number): void;
  /** The world's culling, passed on to a district's baked chunk. */
  setShown(id: DistrictId, shown: boolean): void;
  /** What a district costs to draw in this look right now, or null while its baked chunk is not in
   *  (the world then counts the ink geometry, which is what is drawn). */
  cost(id: DistrictId): RealCost | null;
  /** Everything that is not a district: the base set or its stand-ins, the figure, the sky, the passes. */
  reserve(): RealCost;
  setFog(near: number, far: number): void;
  /** The drawn sky over where the visitor stands (each district has its own). Once a frame while active. */
  setSky(colors: SkyColorsRGB): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  setTier(tier: QualityTier): void;
  /** The ink scene gained or lost meshes (a district was raised, the collider view toggled). */
  rescan(): void;
  /** Draw the frame. `mix` is how much of the picture is the real look: 1 all of it, between 0 and 1
   *  during a change-over, when the ink page is drawn too and the two are joined. `toReal` says which
   *  of the two is arriving. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number, mix: number, toReal: boolean): void;
  /** Free everything on the graphics card. prepare() has to run again after this. */
  release(): void;
  debug(): RealDebug;
  /** Set one of the picture's dials by name while looking at it. For tuning and tests. */
  tune(name: string, value: number | readonly number[]): void;
}

// ---------------------------------------------------------------------------------------------
// The manifest, as docs/REAL.md describes it. Only the fields the browser reads.
// ---------------------------------------------------------------------------------------------

export interface ManifestFile {
  file: string;
  bytes: number;
  half?: string;
  halfBytes?: number;
}

export interface ManifestMaterial {
  kind: 'opaque' | 'plain' | 'cards' | 'glass' | 'lettering';
  texture?: string | null;
  normalScale?: number;
  roughness?: number;
  metalness?: number;
  reflect?: number;
  alphaTest?: number;
  opacity?: number;
  swatch?: string;
  cells?: string[];
}

export interface ManifestChunk {
  id: string;
  kind: 'district' | 'base';
  file: string;
  bytes: number;
  rawBytes: number;
  triangles: number;
  drawCalls: number;
  bounds: { box: number[]; sphere: number[] };
  lightmaps: (ManifestFile & { size: number })[];
  materials: string[];
  replaces: string[];
  live: string[];
  stilled: string[];
  drop: string[];
}

/** Blender's AgX view transform as a table: size cubed cells laid out as columns r + b * size, rows
 *  g from the top, indexed by log2 of the exposed colour between logMin and logMax. sRGB out. */
export interface ManifestLut {
  file: string;
  bytes: number;
  size: number;
  logMin: number;
  logMax: number;
}

export interface Manifest {
  version: number;
  sun: { direction: number[]; elevationDeg: number; color: number[]; irradiance: number; skyIrradiance: number };
  look: { toneMapping: string; exposure: number; lightMapIntensity: number; lut?: ManifestLut };
  environment: { file: string; bytes: number; sunDiscDeg?: number };
  lettering: ManifestFile;
  textures: Record<string, { color?: ManifestFile; normal?: ManifestFile; orm?: ManifestFile }>;
  materials: Record<string, ManifestMaterial>;
  chunks: ManifestChunk[];
  live: string[];
  drop: string[];
}
