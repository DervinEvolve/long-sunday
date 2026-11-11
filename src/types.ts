// Shared contracts. Engine, districts and UI all code against this file.
// Engine owners may ADD to it. Nobody removes or renames what is here without updating every user.
import type * as THREE from 'three';

export type ColorLike = number | string;
export type QualityTier = 'low' | 'medium' | 'high';

/** A point on the ground plane. x is east, z is south. Metres. */
export interface Vec2 {
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------------------------

export type EntryKind = 'origin' | 'role' | 'experiment' | 'thread' | 'place';
export type EntryStatus = 'shipped' | 'live' | 'ongoing' | 'parked' | 'failed' | 'unfinished' | 'retired';

export interface EntryLink {
  label: string;
  url: string;
}

/** One caption in the world. Text is first person, facts only. Sources and open questions sit
 *  beside it in src/content/notes.ts, which never ships. */
export interface Entry {
  id: string;
  district: DistrictId;
  kind: EntryKind;
  status?: EntryStatus;
  title: string;
  org?: string;
  dates?: string;
  /** One or two plain sentences. */
  blurb: string;
  /** Up to five short facts. */
  bullets?: string[];
  links?: EntryLink[];
}

// ---------------------------------------------------------------------------------------------
// World layout
// ---------------------------------------------------------------------------------------------

export type DistrictId =
  | 'trailhead'
  | 'switchboard'
  | 'commons'
  | 'terraces'
  | 'maskgarden'
  | 'observatory'
  | 'studio'
  | 'greenhouse'
  | 'skyharbor'
  | 'boneyard'
  | 'postcards';

export interface DistrictSite {
  id: DistrictId;
  /** Name lettered in the world and listed in the index. */
  name: string;
  /** One line under the name in the index. */
  tagline: string;
  /** Years shown on the map. */
  years: string;
  center: Vec2;
  /** Everything a district builds stays inside this radius. */
  radius: number;
  /** Ground height of the flat pad. The pad is flat within `radius * 0.82` of the centre. */
  height: number;
  /** Which thread of the story this place belongs to. */
  thread: 'people' | 'tech' | 'both' | 'life';
  /** Sky gradient and haze the world drifts toward while the visitor stands here. */
  sky: { top: ColorLike; mid: ColorLike; horizon: ColorLike; haze: ColorLike };
  /** The district's dominant colours, for the map and for its builder. */
  accents: [ColorLike, ColorLike, ColorLike];
  /** Where a visitor lands when they fast travel here, in district-local metres, and the way they face. */
  arrive: { x: number; z: number; yaw: number };
}

export interface RoadSpec {
  id: string;
  /** Control points on the ground plane. The terrain smooths a curve through them. */
  points: Vec2[];
  width: number;
  /** The spine is the dated career road. Branches lead to experiments and to life outside work. */
  kind: 'spine' | 'branch';
}

// ---------------------------------------------------------------------------------------------
// Districts
// ---------------------------------------------------------------------------------------------

/** All district geometry, colliders and points of interest are in DISTRICT-LOCAL space:
 *  origin at the district centre, y = 0 on the flat pad, +x east, +z south. */
export type Collider =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'box'; x: number; z: number; hw: number; hd: number; rot?: number };

export interface Poi {
  /** The Entry.id this point opens. */
  entry: string;
  x: number;
  z: number;
  /** Height of the floating marker above the pad. Default 2.4. */
  y?: number;
  /** How close the visitor must be. Default 4.5. */
  reach?: number;
  /** Short verb line for the prompt, for example "Read the plaque". Default "Look closer". */
  prompt?: string;
  /** What E does here. Default 'entry' opens the caption. 'map' opens the map for fast travel. */
  action?: 'entry' | 'map';
}

export interface DistrictContext {
  site: DistrictSite;
  kit: InkKit;
  palette: Palette;
  /** Deterministic random in [0, 1). Same sequence on every load. */
  rng: () => number;
  /** Terrain height relative to the pad (0 on the pad) at a district-local position. */
  groundAt: (x: number, z: number) => number;
  quality: QualityTier;
  /** Entries that belong to this district. */
  entries: Entry[];
  /** Direction toward the sun, the one the renderer uses. For baked ground shadows. */
  sun?: [number, number, number];
}

export interface DistrictBuild {
  /** Everything visible. The world places it at the district centre and pad height. */
  group: THREE.Group;
  colliders: Collider[];
  pois: Poi[];
  /** Called every frame while the district is near. `t` is seconds since load, `dt` is the frame step.
   *  `player` is in district-local space. Keep it cheap: no allocation, no geometry rebuilds. */
  update?: (dt: number, t: number, player: THREE.Vector3) => void;
  /** Free GPU resources the district created outside the kit. */
  dispose?: () => void;
  /** How far anything in the group reaches from the pad centre, in metres, moving parts at their
   *  furthest included. Only needed when that is more than `site.radius + 35`: the world uses it for
   *  its is-it-on-screen test, and never goes below that default. */
  cullRadius?: number;
}

export interface DistrictModule {
  id: DistrictId;
  build: (ctx: DistrictContext) => DistrictBuild;
}

// ---------------------------------------------------------------------------------------------
// Ink kit. The engine owner finalises this section and documents it in docs/KIT.md.
// ---------------------------------------------------------------------------------------------

export interface PartOpts {
  color: ColorLike;
  /** Vertical gradient across the part, lowest vertex to highest. Replaces `color` when present. */
  gradient?: { bottom: ColorLike; top: ColorLike };
  pos?: [number, number, number];
  /** Euler XYZ, radians. */
  rot?: [number, number, number];
  scale?: number | [number, number, number];
  /** Outline group. Parts that share an id get no ink line between them. Omit for a fresh id. */
  id?: number;
  /** 0..1. How much the part ignores light. 1 is a flat poster colour. */
  flat?: number;
  /** 0..1. Extra hatching on top of what the light gives. */
  hatch?: number;
  /** 0..1 coverage. Below 1 the part is drawn as a screen-door: glass, cloud floors, tinted portals.
   *  A dithered part draws no ink line of its own, so give it a frame. */
  dither?: number;
  /** 0..1. Gentle sway in the wind, growing with height above the part's lowest vertex. Plants, flags, wires. */
  sway?: number;
  /** Height (in builder space) that sway is measured from, when several parts of one plant should bend together. */
  swayBase?: number;
  /** False removes the ink line around and inside this part. For decals and soft things. Default true. */
  outline?: boolean;
}

export interface LabelOpts {
  text: string;
  /** Height of a capital letter in metres. */
  size: number;
  pos: [number, number, number];
  rot?: [number, number, number];
  /** Colour of a plate behind the letters. Omit to letter straight onto whatever is behind. */
  plate?: ColorLike;
  ink?: ColorLike;
  align?: 'left' | 'center' | 'right';
  /** Wrap width in metres. */
  maxWidth?: number;
  /** Outline id for the plate. Pass the id of the part the label sits on (with the same colour as `plate`)
   *  and the plate edge disappears, leaving smooth letters on the surface. */
  id?: number;
  /** 0..1. How much the plate ignores light. Match the part it sits on. Default 0. */
  flat?: number;
  /** Line spacing as a multiple of `size`. Default 1.7. */
  lineHeight?: number;
  /** Plate margin around the text as a multiple of `size`. Default 0.55. */
  pad?: number;
  /** How far the label floats off its surface, metres. Default 0.02. */
  lift?: number;
  /** 0..1. Hand wobble: letters bob and tilt a little. Default 0.5. */
  jitter?: number;
  /** Which part of the block sits on `pos`. Defaults to `align`. Use 'center' with align 'left' for a
   *  ragged-right paragraph in the middle of a sign. */
  anchor?: 'left' | 'center' | 'right';
}

/** A flat shadow of a part, thrown onto level ground. Baked: it does not follow the sun afterwards. */
export interface ShadowOpts {
  /** Shadow colour. Mix the ground colour toward palette.shadow. */
  color: ColorLike;
  /** Direction toward the sun, the same one given to the renderer. */
  sun: THREE.Vector3 | [number, number, number];
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: number | [number, number, number];
  /** Height of the ground it falls on. Default 0. */
  y?: number;
  /** How far it floats above the ground to stay clear of it. Default 0.02. */
  lift?: number;
}

export interface LabelSize {
  /** Width of the widest line, metres. */
  width: number;
  /** Height of the whole block, first cap top to last baseline, metres. */
  height: number;
  lines: number;
}

/** Collects many coloured parts and returns ONE mesh: one draw call, outlines kept per part. */
export interface InkBuilder {
  add(geometry: THREE.BufferGeometry, opts: PartOpts): number;
  /** Hand-lettered text drawn from the shared lettering atlas. Costs no extra draw call. */
  label(opts: LabelOpts): void;
  /** Size a label would take, without drawing it. For fitting a sign to its text. */
  measure?(opts: Pick<LabelOpts, 'text' | 'size' | 'maxWidth' | 'lineHeight'>): LabelSize;
  /** The same geometry and placement as an add(), squashed flat along the sun onto the ground. No ink line. */
  shadow?(geometry: THREE.BufferGeometry, opts: ShadowOpts): void;
  /** Everything added so far as one geometry with the kit's attributes, for kit.instances(). Empties the builder. */
  geometry?(): THREE.BufferGeometry;
  newId(): number;
  triangles(): number;
  build(name?: string): THREE.Mesh;
}

export interface InkKit {
  builder(): InkBuilder;
  /** An instanced mesh that draws with the ink material. Set matrices with setMatrixAt.
   *  Each instance gets its own outline. Per-instance colour through setColorAt. */
  instances(geometry: THREE.BufferGeometry, count: number, opts?: { color?: ColorLike; flat?: number; hatch?: number; dither?: number; sway?: number },
  ): THREE.InstancedMesh;
  /** The shared ink material, for the rare mesh that cannot go through a builder. */
  material: THREE.Material;
  /** Resolves when the lettering font is loaded and the atlas is drawn. Await it before building anything with labels. */
  ready?: Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------

export interface Palette {
  ink: ColorLike;
  paper: ColorLike;
  sand: ColorLike;
  sandLight: ColorLike;
  sandDeep: ColorLike;
  rock: ColorLike;
  rockDeep: ColorLike;
  cliff: ColorLike;
  stone: ColorLike;
  stoneShade: ColorLike;
  lavender: ColorLike;
  violet: ColorLike;
  teal: ColorLike;
  tealDeep: ColorLike;
  mint: ColorLike;
  yellow: ColorLike;
  orange: ColorLike;
  red: ColorLike;
  pink: ColorLike;
  cyan: ColorLike;
  brass: ColorLike;
  bone: ColorLike;
  leaf: ColorLike;
  leafDeep: ColorLike;
  grass: ColorLike;
  grassLight: ColorLike;
  grassDeep: ColorLike;
  moss: ColorLike;
  marble: ColorLike;
  marbleShade: ColorLike;
  brick: ColorLike;
  brickDeep: ColorLike;
  pave: ColorLike;
  paveShade: ColorLike;
  asphalt: ColorLike;
  steel: ColorLike;
  glass: ColorLike;
  verdigris: ColorLike;
  skin: ColorLike;
  hair: ColorLike;
  shadow: ColorLike;
}

// ---------------------------------------------------------------------------------------------
// The world, as the interface layer sees it
// ---------------------------------------------------------------------------------------------

export interface WorldStats {
  calls: number;
  triangles: number;
  fps: number;
  frameMs: number;
  pixelRatio: number;
  tier: QualityTier;
}

/** A point of interest the visitor can act on. `entry` is null for things that are not content (the map table). */
export interface PoiHit {
  entry: Entry | null;
  prompt: string;
  action: 'entry' | 'map';
}

export interface WorldEvents {
  /** 0..1 while the world is being built. */
  progress: number;
  ready: void;
  /** The district the visitor stands in changed. Null out on the streets between them. */
  district: DistrictSite | null;
  /** The thing in reach changed. Null when nothing is in reach. */
  poi: PoiHit | null;
  /** The visitor pressed the interact key, tapped the touch button or tapped a marker, with something in reach. */
  interact: PoiHit;
  /** Tier or pixel ratio changed. */
  quality: WorldStats;
  /** Fires once, the first time the visitor moves. */
  moved: void;
}

export interface WorldApi {
  ready: boolean;
  isTouch: boolean;
  on<K extends keyof WorldEvents>(event: K, cb: (payload: WorldEvents[K]) => void): () => void;
  /** The visitor chose Walk in: hand over control, ease the camera from the title orbit to play framing. */
  start(): void;
  /** An overlay is open: input off, world keeps rendering at reduced cost. */
  setPaused(paused: boolean): void;
  teleport(target: DistrictId | Vec2, yaw?: number): void;
  player(): { x: number; z: number; yaw: number; district: DistrictId | null };
  stats(): WorldStats;
  /** The tier budget, draw distance, haze, pixel ratio and ink settings follow at once. Geometry is
   *  built once per load, so the full detail level of a tier applies from the next load. */
  setQuality(tier: QualityTier | 'auto'): void;
  /** Still what moves by itself: plant sway, the boiling grain, the title camera drift and the eased
   *  camera moves that are only decoration. Markers, sky, the train and district machinery slow to a
   *  creep. His walk and the follow camera stay. Starts from the device's reduce motion setting. */
  setReducedMotion(on: boolean): void;
  reducedMotion(): boolean;
  /** Districts the visitor has stood in this session. */
  visited(): DistrictId[];
  touchRoot(el: HTMLElement | null): void;
}
