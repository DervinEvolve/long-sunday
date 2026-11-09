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

/** One caption in the world. Text is first person, facts only, sourced. */
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
  /** Where the facts come from. For audit. Never shown. */
  source: string;
  /** A note to the owner where something needs confirming before this goes public. Never shown. */
  confirm?: string;
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
}

/** Collects many coloured parts and returns ONE mesh: one draw call, outlines kept per part. */
export interface InkBuilder {
  add(geometry: THREE.BufferGeometry, opts: PartOpts): number;
  /** Hand-lettered text drawn from the shared lettering atlas. Costs no extra draw call. */
  label(opts: LabelOpts): void;
  newId(): number;
  triangles(): number;
  build(name?: string): THREE.Mesh;
}

export interface InkKit {
  builder(): InkBuilder;
  /** An instanced mesh that draws with the ink material. Set matrices with setMatrixAt.
   *  Each instance gets its own outline. Per-instance colour through setColorAt. */
  instances(geometry: THREE.BufferGeometry, count: number, opts?: { color?: ColorLike; flat?: number; hatch?: number }): THREE.InstancedMesh;
  /** The shared ink material, for the rare mesh that cannot go through a builder. */
  material: THREE.Material;
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
  skin: ColorLike;
  hair: ColorLike;
  shadow: ColorLike;
}
