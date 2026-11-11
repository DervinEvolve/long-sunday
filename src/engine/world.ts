// The running world: ground, sky, scatter, the visitor, and the eleven districts built one at a
// time around him. Keeps track of which district he stands in and which caption is in reach, and
// hands the interface a small typed surface (WorldApi) so it never has to look inside.
//
// Space: districts build in their own space (origin at the pad centre, y = 0 on the pad). This
// file puts each group at its site and turns colliders and points of interest into world space.
import * as THREE from 'three';
import type {
  Collider,
  DistrictBuild,
  DistrictContext,
  DistrictId,
  DistrictModule,
  DistrictSite,
  Look,
  PoiHit,
  QualityTier,
  Vec2,
  WorldApi,
  WorldEvents,
  WorldStats,
} from '../types';
import type { Ink } from './ink';
import type { Input } from './input';
import type { Quality } from './quality';
import type { RealDebug, RealLook } from '../real/api';
import { buildTerrain, heightAt, inBounds } from './terrain';
import { createSky, skyColors, skyHex, type Sky, type SkyHex } from './sky';
import { buildScatter } from './scatter';
import { createCharacter, type Character } from './character';
import { createController, type Controller, type WorldCollider } from './controller';
import * as geo from './geo';
import { rngFrom } from './util';
import { DISTRICTS, placeholder } from '../districts';
import { SITES, SITE_BY_ID, SPAWN } from '../world/layout';
import { palette } from '../world/palette';
import { ENTRY_BY_ID, entriesFor } from '../content/content';

/** Direction toward the sun. Low enough for long hatching on north faces, high enough that pads stay bright. */
export const SUN = new THREE.Vector3(-0.52, 0.7, 0.5).normalize();

const FOG_NEAR = 45;
const FOG_FAR = 620;
/** A district further than this from the eye is not drawn. Its landmark has mostly gone into the haze by then. */
const DRAW_FAR: Record<QualityTier, number> = { low: 250, medium: 330, high: 440 };
/** The haze closes in with the draw distance, so a district that comes into range arrives pale on every tier. */
const fogFar = (tier: QualityTier): number => Math.min(FOG_FAR, DRAW_FAR[tier] * 1.45);
/** District update() runs while the visitor is within the pad radius plus this. */
const UPDATE_MARGIN = 60;
/** Colliders are gathered this far around him: the longest camera arm plus the widest building. */
const GATHER = 24;
const GATHER_STEP = 3;
const CELL = 16;
const MAX_SPOTS = 160;
/** The whole picture has to stay under this. */
export const BUDGET = { calls: 150, triangles: 400000 };
/** Triangles the picture may hold once the tier has dropped below the one the world was built for.
 *  Geometry is built once, for the tier the page loaded with, so this is the lever that still works
 *  when the tier changes later: the far districts are dropped sooner. A build on its own tier keeps
 *  the whole budget. The full detail level of a tier applies from the next load. */
const TRI_BUDGET: Record<QualityTier, number> = { low: 260000, medium: 320000, high: 400000 };
const TIER_RANK: Record<QualityTier, number> = { low: 0, medium: 1, high: 2 };
/** The real look's picture has its own ceiling. Its base set alone (ground, city, far sky) is 320,000
 *  triangles and 68 draw calls, the same on every tier, so the tiers differ in how many districts ride on top. */
export const REAL_BUDGET = { calls: 250, triangles: 700000 };
const REAL_TRI_BUDGET: Record<QualityTier, number> = { low: 480000, medium: 600000, high: 700000 };
/** Seconds the change-over between the two looks takes. A straight cut with reduced motion. */
const LOOK_SECONDS = 0.6;
/** After the visitor goes back to the ink look, the real look's files stay on the graphics card for
 *  this many seconds, so flipping back and forth is instant. Then they are freed and the ink look
 *  holds exactly what it held before. */
const REAL_KEEP: Record<QualityTier, number> = { low: 10, medium: 25, high: 45 };
const NO_REAL = 'The built version is not available here.';
const REAL_FAILED = 'The built version did not load. You are still in the drawing.';
/** With reduced motion the ambient clock runs at this fraction of real time: clouds, markers and
 *  district machinery creep where they used to move. */
const CALM_RATE = 0.05;
/** How far past its measured geometry a district's on-screen test reaches, for parts that move. */
const BOUNDS_SLACK = 8;
const MARK_IDLE = new THREE.Color('#ef7a1e');
const MARK_ACTIVE = new THREE.Color('#ffe98a');

export interface WorldOpts {
  ink: Ink;
  quality: Quality;
  input: Input;
  canvas: HTMLCanvasElement;
  /** Start at this district's arrival point, not at the Trailhead. */
  spawn?: DistrictId | null;
  /** Build only this district. For working on one place. */
  solo?: DistrictId | null;
  /** Hold the clock at zero so two screenshots match. */
  still?: boolean;
}

export interface DistrictCost {
  calls: number;
  triangles: number;
  placeholder: boolean;
  colliders: number;
  pois: number;
}

/** The typed surface for the interface, plus what the boot code and the test tools need. */
export interface World extends WorldApi {
  scene: THREE.Scene;
  /** The camera the last frame was drawn with. */
  camera(): THREE.PerspectiveCamera;
  /** Step everything and draw. `dt` in seconds, already clamped. */
  frame(dt: number): void;
  resize(width: number, height: number, pixelRatio: number): void;
  /** Districts that are standing, in the order they were built. */
  built(): DistrictId[];
  /** What each standing district costs to draw. */
  costs(): Partial<Record<DistrictId, DistrictCost>>;
  /** A fixed camera for stills and overviews. Null hands the view back to the walking camera. */
  setFreeCamera(eye: readonly number[] | null, look?: readonly number[]): void;
  /** Draw every collider as a see-through red shape. */
  showColliders(on: boolean): void;
  /** The colliders the controller is testing right now. */
  nearColliders(): readonly Collider[];
  /** The caption in reach, if any. */
  poi(): PoiHit | null;
  /** Every point of interest in world space. For tests. */
  spots(): { entry: string | null; action: string; x: number; y: number; z: number; reach: number; district: DistrictId }[];
  /** The live budget. Lower it in the console to watch far districts drop out. */
  budget: { calls: number; triangles: number };
  /** Every district collider in world space. For tests. */
  districtColliders(id: DistrictId): readonly Collider[];
  /** The real look's own ceiling, live like `budget`. */
  realBudget: { calls: number; triangles: number };
  /** What the real look holds right now, or null while its code has not been loaded. For tests. */
  realInfo(): (RealDebug & { mix: number; keptFor: number }) | null;
  /** Free the real look's files now, without waiting out the grace time. Only does anything in the ink look. For tests. */
  dropReal(): void;
  /** What three.js counts on the graphics card right now, in either look. For tests. */
  gpu(): { geometries: number; textures: number; programs: number; names: string[] };
  /** Set one of the real picture's dials (a shared uniform, by name). For tuning and tests. */
  realTune(name: string, value: number | readonly number[]): void;
  /** Stop the next change-over when this share of the picture (0..1) is the real look, to look at it. null lets it finish. For tests. */
  holdLook(mix: number | null): void;
}

interface Place {
  site: DistrictSite;
  build: DistrictBuild | null;
  group: THREE.Group | null;
  colliders: WorldCollider[]; // world space
  spotFrom: number;
  spotTo: number;
  near: boolean;
  /** Close enough and affordable. Its markers follow this. */
  shown: boolean;
  /** Roughly where its geometry is, for a cheap is-it-on-screen test. */
  bounds: THREE.Sphere;
  cost: DistrictCost | null;
}

interface Spot {
  hit: PoiHit;
  x: number;
  y: number;
  z: number;
  reach: number;
  place: number;
  phase: number;
}

type Listeners = { [K in keyof WorldEvents]: ((payload: WorldEvents[K]) => void)[] };

// ---------------------------------------------------------------------------------------------
// How tall is the thing inside each collider? Colliders are flat shapes on the ground; the camera
// needs to tell a bench from a wall. So once, at build time, every triangle of the geometry that
// came with the colliders is sampled and each collider remembers the highest point found over its
// footprint. Nothing found means nothing drawn there, and the camera ignores it.
// ---------------------------------------------------------------------------------------------
const TOP_CELL = 2;
const TOP_PAD = 0.3; // footprints are widened by this, so a wall flush with its collider still counts
const TOP_STEP = 0.6; // spacing of samples across a big triangle
const topMat = new THREE.Matrix4();
const topInst = new THREE.Matrix4();
const topV = new THREE.Vector3();
let topScratch = new Float32Array(3 * 4096);

function measureTops(root: THREE.Object3D, list: WorldCollider[]): void {
  const n = list.length;
  if (n === 0) return;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const reach = (c: Collider): number => (c.kind === 'circle' ? c.r : Math.hypot(c.hw, c.hd)) + TOP_PAD;
  for (const c of list) {
    const r = reach(c);
    x0 = Math.min(x0, c.x - r);
    x1 = Math.max(x1, c.x + r);
    z0 = Math.min(z0, c.z - r);
    z1 = Math.max(z1, c.z + r);
  }
  const nx = Math.floor((x1 - x0) / TOP_CELL) + 1;
  const nz = Math.floor((z1 - z0) / TOP_CELL) + 1;
  if (!(nx * nz < 2e6)) return; // something is wildly out of place: leave every collider tall
  // Which colliders touch which cell, packed: start[cell] .. start[cell + 1] indexes into `who`.
  const start = new Int32Array(nx * nz + 1);
  const span = (c: Collider, visit: (cell: number) => void): void => {
    const r = reach(c);
    const ax = Math.floor((c.x - r - x0) / TOP_CELL);
    const bx = Math.floor((c.x + r - x0) / TOP_CELL);
    const az = Math.floor((c.z - r - z0) / TOP_CELL);
    const bz = Math.floor((c.z + r - z0) / TOP_CELL);
    for (let iz = az; iz <= bz; iz++) for (let ix = ax; ix <= bx; ix++) visit(iz * nx + ix);
  };
  for (const c of list) span(c, (cell) => start[cell + 1]++);
  for (let i = 0; i < nx * nz; i++) start[i + 1] += start[i];
  const who = new Int32Array(start[nx * nz]);
  const fill = start.slice(0, nx * nz);
  for (let i = 0; i < n; i++) span(list[i], (cell) => (who[fill[cell]++] = i));
  const cs = new Float32Array(n);
  const sn = new Float32Array(n);
  const top = new Float32Array(n).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const rot = c.kind === 'box' ? (c.rot ?? 0) : 0;
    cs[i] = Math.cos(rot);
    sn[i] = Math.sin(rot);
  }

  const sample = (x: number, y: number, z: number): void => {
    const ix = Math.floor((x - x0) / TOP_CELL);
    const iz = Math.floor((z - z0) / TOP_CELL);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return;
    const cell = iz * nx + ix;
    for (let k = start[cell]; k < start[cell + 1]; k++) {
      const i = who[k];
      if (y <= top[i]) continue;
      const c = list[i];
      const dx = x - c.x;
      const dz = z - c.z;
      if (c.kind === 'circle') {
        const r = c.r + TOP_PAD;
        if (dx * dx + dz * dz <= r * r) top[i] = y;
      } else if (Math.abs(dx * cs[i] - dz * sn[i]) <= c.hw + TOP_PAD && Math.abs(dx * sn[i] + dz * cs[i]) <= c.hd + TOP_PAD) top[i] = y;
    }
  };

  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const index = mesh.geometry.index;
    const vc = pos.count;
    if (topScratch.length < vc * 3) topScratch = new Float32Array(vc * 3);
    const p = topScratch;
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
    const copies = inst ? inst.count : 1;
    const tris = (index ? index.count : vc) / 3;
    for (let c = 0; c < copies; c++) {
      if (inst) {
        inst.getMatrixAt(c, topInst);
        topMat.multiplyMatrices(mesh.matrixWorld, topInst);
      } else topMat.copy(mesh.matrixWorld);
      for (let i = 0; i < vc; i++) {
        topV.fromBufferAttribute(pos, i).applyMatrix4(topMat);
        p[i * 3] = topV.x;
        p[i * 3 + 1] = topV.y;
        p[i * 3 + 2] = topV.z;
      }
      for (let t = 0; t < tris; t++) {
        const a = (index ? index.getX(t * 3) : t * 3) * 3;
        const b = (index ? index.getX(t * 3 + 1) : t * 3 + 1) * 3;
        const d = (index ? index.getX(t * 3 + 2) : t * 3 + 2) * 3;
        const ax = p[a], ay = p[a + 1], az = p[a + 2];
        const bx = p[b], by = p[b + 1], bz = p[b + 2];
        const dx = p[d], dy = p[d + 1], dz = p[d + 2];
        const long = Math.max(Math.hypot(bx - ax, bz - az), Math.hypot(dx - bx, dz - bz), Math.hypot(ax - dx, az - dz));
        const m = Math.min(16, Math.max(1, Math.ceil(long / TOP_STEP)));
        if (m === 1) {
          sample(ax, ay, az);
          sample(bx, by, bz);
          sample(dx, dy, dz);
          continue;
        }
        for (let u = 0; u <= m; u++)
          for (let w = 0; w <= m - u; w++) {
            const fu = u / m;
            const fw = w / m;
            const fa = 1 - fu - fw;
            sample(ax * fa + bx * fu + dx * fw, ay * fa + by * fu + dy * fw, az * fa + bz * fu + dz * fw);
          }
      }
    }
  });
  for (let i = 0; i < n; i++) list[i].top = top[i];
}

function costOfTree(root: THREE.Object3D, out: { calls: number; triangles: number }): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    out.calls++;
    const g = m.geometry;
    const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    out.triangles += (m as THREE.InstancedMesh).isInstancedMesh ? n * (m as THREE.InstancedMesh).count : n;
  });
}

function prefersCalm(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function createWorld(opts: WorldOpts): World {
  const { ink, quality, input, canvas } = opts;
  const kit = ink.kit;
  const still = !!opts.still;
  /** What ground, sky, scatter, the figure, the markers and the ink pass cost with no district in
   *  view. These are the high tier's numbers, rounded up; construct() replaces them with what this
   *  build really came to. */
  const reserve = { calls: 60, triangles: 200000 };

  const scene = new THREE.Scene();
  const rig = new THREE.PerspectiveCamera(55, 1, 0.3, 3000);
  const free = new THREE.PerspectiveCamera(46, 1, 0.3, 4000);
  let useFree = false;
  let aspect = 1;

  // -------------------------------------------------------------------------------------------
  // The second look. Its code lives in src/real and is fetched the first time it is asked for.
  // -------------------------------------------------------------------------------------------
  let real: RealLook | null = null;
  const fogNow = { near: FOG_NEAR, far: fogFar(quality.tier) };
  const sizeNow = { width: 1, height: 1, pixelRatio: 1 };
  /** Both looks fade into the distance over the same range, so a district arrives pale in either. */
  function setFog(near: number, far: number): void {
    fogNow.near = near;
    fogNow.far = far;
    ink.setFog(near, far);
    if (real) real.setFog(near, far);
  }

  ink.setSun(SUN);
  setFog(FOG_NEAR, fogFar(quality.tier));
  ink.setStill(still);

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------
  const listeners: Listeners = { progress: [], ready: [], district: [], poi: [], interact: [], quality: [], moved: [], look: [] };

  function on<K extends keyof WorldEvents>(event: K, cb: (payload: WorldEvents[K]) => void): () => void {
    const list = listeners[event] as ((payload: WorldEvents[K]) => void)[];
    list.push(cb);
    return () => {
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    };
  }

  function emit<K extends keyof WorldEvents>(event: K, payload: WorldEvents[K]): void {
    const list = listeners[event] as ((payload: WorldEvents[K]) => void)[];
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](payload);
      } catch (err) {
        console.error(`[world] a "${event}" listener threw`, err);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Colliders: scatter goes into a grid, each district keeps its own list.
  // -------------------------------------------------------------------------------------------
  let scatterColliders: WorldCollider[] = [];
  const cells = new Map<number, number[]>();
  let stamps = new Uint32Array(0);
  let stamp = 0;
  const near: WorldCollider[] = [];
  let gatherX = Infinity;
  let gatherZ = Infinity;
  let gatherDirty = true;

  const cellKey = (ix: number, iz: number): number => (ix + 512) * 1024 + (iz + 512);

  function bucketScatter(list: WorldCollider[]): void {
    scatterColliders = list;
    stamps = new Uint32Array(list.length);
    cells.clear();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const r = c.kind === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
      const x0 = Math.floor((c.x - r) / CELL);
      const x1 = Math.floor((c.x + r) / CELL);
      const z0 = Math.floor((c.z - r) / CELL);
      const z1 = Math.floor((c.z + r) / CELL);
      for (let ix = x0; ix <= x1; ix++)
        for (let iz = z0; iz <= z1; iz++) {
          const k = cellKey(ix, iz);
          let cell = cells.get(k);
          if (!cell) cells.set(k, (cell = []));
          cell.push(i);
        }
    }
    gatherDirty = true;
  }

  function gather(px: number, pz: number): void {
    const dx = px - gatherX;
    const dz = pz - gatherZ;
    if (!gatherDirty && dx * dx + dz * dz < GATHER_STEP * GATHER_STEP) return;
    gatherDirty = false;
    gatherX = px;
    gatherZ = pz;
    near.length = 0;
    const reach = GATHER + GATHER_STEP;
    stamp++;
    const x0 = Math.floor((px - reach) / CELL);
    const x1 = Math.floor((px + reach) / CELL);
    const z0 = Math.floor((pz - reach) / CELL);
    const z1 = Math.floor((pz + reach) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const cell = cells.get(cellKey(ix, iz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const idx = cell[i];
          if (stamps[idx] === stamp) continue;
          stamps[idx] = stamp;
          near.push(scatterColliders[idx]);
        }
      }
    for (let p = 0; p < places.length; p++) {
      const place = places[p];
      if (!place.build) continue;
      const s = place.site;
      const lim = s.radius * 1.35 + reach;
      const ddx = px - s.center.x;
      const ddz = pz - s.center.z;
      if (ddx * ddx + ddz * ddz > lim * lim) continue;
      const list = place.colliders;
      for (let i = 0; i < list.length; i++) near.push(list[i]);
    }
  }

  // -------------------------------------------------------------------------------------------
  // The visitor
  // -------------------------------------------------------------------------------------------
  const controller: Controller = createController({ camera: rig, input, heightAt, inBounds, colliders: () => near });
  let figure: Character | null = null;
  let started = false;
  let paused = false;
  let movedOnce = false;
  controller.frameFor('title');
  input.setEnabled(false);

  const startSite = opts.spawn ? SITE_BY_ID[opts.spawn] : null;
  if (startSite) controller.teleport(startSite.center.x + startSite.arrive.x, startSite.center.z + startSite.arrive.z, startSite.arrive.yaw);
  else controller.teleport(SPAWN.x, SPAWN.z, SPAWN.yaw);

  // -------------------------------------------------------------------------------------------
  // Districts and points of interest
  // -------------------------------------------------------------------------------------------
  const places: Place[] = SITES.map((site) => ({
    site,
    build: null,
    group: null,
    colliders: [],
    spotFrom: 0,
    spotTo: 0,
    near: false,
    shown: true,
    bounds: new THREE.Sphere(new THREE.Vector3(site.center.x, site.height + 15, site.center.z), site.radius + 35),
    cost: null,
  }));
  const byDistance = places.map((_, i) => i);
  const eyeDistance = new Float32Array(places.length);
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const builtOrder: DistrictId[] = [];
  const spots: Spot[] = [];
  let markers: THREE.InstancedMesh | null = null;
  let active = -1;
  let standing = -1;
  const visitedSet = new Set<DistrictId>();
  const local = new THREE.Vector3();

  const mMat = new THREE.Matrix4();
  const mPos = new THREE.Vector3();
  const mQuat = new THREE.Quaternion();
  const mScale = new THREE.Vector3();
  const mEuler = new THREE.Euler();

  function writeMarker(i: number, t: number): void {
    if (!markers) return;
    const s = spots[i];
    const shown = places[s.place].shown;
    const on = i === active;
    const k = shown ? (on ? 1.3 + Math.sin(t * 5) * 0.12 : 1) : 0;
    mPos.set(s.x, s.y + Math.sin(t * 1.5 + s.phase) * (on ? 0.07 : 0.14), s.z);
    mEuler.set(0, t * (on ? 2.2 : 0.7) + s.phase, 0);
    mQuat.setFromEuler(mEuler);
    mScale.set(k, k * 1.5, k);
    markers.setMatrixAt(i, mMat.compose(mPos, mQuat, mScale));
  }

  function paintMarker(i: number): void {
    if (!markers || i < 0) return;
    markers.setColorAt(i, i === active ? MARK_ACTIVE : MARK_IDLE);
    if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
  }

  function setActive(next: number): void {
    if (next === active) return;
    const prev = active;
    active = next;
    paintMarker(prev);
    paintMarker(next);
    if (prev >= 0) writeMarker(prev, ambT);
    if (markers) markers.instanceMatrix.needsUpdate = true;
    emit('poi', next >= 0 ? spots[next].hit : null);
  }

  const tally = { calls: 0, triangles: 0 };
  const boundsBox = new THREE.Box3();
  const boundsBall = new THREE.Sphere();

  function costOf(group: THREE.Group, build: DistrictBuild): DistrictCost {
    tally.calls = 0;
    tally.triangles = 0;
    costOfTree(group, tally);
    return {
      calls: tally.calls,
      triangles: Math.round(tally.triangles),
      placeholder: group.name.startsWith('placeholder-'),
      colliders: build.colliders.length,
      pois: build.pois.length,
    };
  }

  function raise(place: Place, mod: DistrictModule, tier: QualityTier): void {
    const site = place.site;
    const cx = site.center.x;
    const cz = site.center.z;
    const ctx: DistrictContext = {
      site,
      kit,
      palette,
      rng: rngFrom('district:' + site.id),
      groundAt: (x, z) => heightAt(cx + x, cz + z) - site.height,
      quality: tier,
      entries: entriesFor(site.id),
      sun: [SUN.x, SUN.y, SUN.z],
    };
    const build = mod.build(ctx);
    build.group.position.set(cx, site.height, cz);
    scene.add(build.group);
    place.build = build;
    place.group = build.group;
    place.cost = costOf(build.group, build);

    // The on-screen test has to cover what was really built. Most districts sit well inside the
    // default sphere; one with a pier or something adrift past its pad gets a wider one, from its
    // own cullRadius or from the measured geometry, whichever reaches further.
    let reach = Math.max(site.radius + 35, build.cullRadius ?? 0);
    boundsBox.setFromObject(build.group);
    if (!boundsBox.isEmpty()) {
      boundsBox.getBoundingSphere(boundsBall);
      reach = Math.max(reach, boundsBall.center.distanceTo(place.bounds.center) + boundsBall.radius + BOUNDS_SLACK);
    }
    place.bounds.radius = reach;

    place.colliders = build.colliders.map((c): WorldCollider =>
      c.kind === 'circle' ? { kind: 'circle', x: c.x + cx, z: c.z + cz, r: c.r } : { kind: 'box', x: c.x + cx, z: c.z + cz, hw: c.hw, hd: c.hd, rot: c.rot },
    );
    measureTops(build.group, place.colliders);
    gatherDirty = true;

    place.spotFrom = spots.length;
    const index = places.indexOf(place);
    for (const p of build.pois) {
      const action = p.action ?? 'entry';
      const entry = ENTRY_BY_ID[p.entry] ?? null;
      if (action === 'entry' && !entry) {
        console.warn(`[world] ${site.id} has a point of interest for "${p.entry}", which is not an entry. Skipped.`);
        continue;
      }
      if (spots.length >= MAX_SPOTS) {
        console.warn('[world] too many points of interest, raise MAX_SPOTS');
        break;
      }
      const x = p.x + cx;
      const z = p.z + cz;
      spots.push({
        hit: { entry, prompt: p.prompt ?? (action === 'map' ? 'Open the map' : 'Look closer'), action },
        x,
        z,
        y: Math.max(site.height, heightAt(x, z)) + (p.y ?? 2.4),
        reach: p.reach ?? 4.5,
        place: index,
        phase: (spots.length * 2.399) % 6.283,
      });
    }
    place.spotTo = spots.length;
    if (markers) {
      markers.count = spots.length;
      for (let i = place.spotFrom; i < place.spotTo; i++) {
        writeMarker(i, ambT);
        markers.setColorAt(i, MARK_IDLE);
      }
      markers.instanceMatrix.needsUpdate = true;
      if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
    }
    builtOrder.push(site.id);
    if (wantColliders) showColliders(true);
    if (real) real.rescan();
  }

  // -------------------------------------------------------------------------------------------
  // Building, a slice at a time so the title card stays alive
  // -------------------------------------------------------------------------------------------
  let sky: Sky | null = null;
  let scatterUpdate: ((dt: number, t: number) => void) | null = null;
  let ready = false;
  let simT = 0;
  // Reduced motion. simT is the real clock: his walk and the camera run on it. ambT is the clock
  // for everything that moves by itself (clouds, markers, the train, district machinery) and it
  // slows to a creep when the switch is on.
  let calm = false;
  let ambT = 0;
  /** The tier the geometry was built for. */
  let builtTier: QualityTier = quality.tier;

  const slice = (): Promise<void> =>
    new Promise((resolve) => {
      let done = false;
      const go = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      requestAnimationFrame(go);
      setTimeout(go, 80); // a hidden tab gets no animation frames
    });

  async function construct(): Promise<void> {
    // One tier for the whole build, read once: ground, sky, city, figure and every district.
    const tier = quality.tier;
    builtTier = tier;
    const order = opts.solo
      ? places.filter((p) => p.site.id === opts.solo)
      : places
          .slice()
          .sort(
            (a, b) =>
              Math.hypot(a.site.center.x - controller.position.x, a.site.center.z - controller.position.z) -
              Math.hypot(b.site.center.x - controller.position.x, b.site.center.z - controller.position.z),
          );
    const steps = 4 + order.length;
    let step = 0;
    const tick = (): void => emit('progress', ++step / steps);

    // Ask for every district file now, so they download side by side with the lettering font and
    // while the ground is built. The loader never rejects: a file that fails comes back as the placeholder.
    const loading = order.map((p) => DISTRICTS[p.site.id]());
    await (kit.ready ?? Promise.resolve());

    // One slice first, so the sky can be drawn and the title card can mount before the long job.
    await slice();
    const terrain = buildTerrain(kit, tier);
    scene.add(terrain.group);
    tick();
    await slice();

    figure = createCharacter(kit, { tier });
    scene.add(figure.group);
    const mark = kit.instances(new THREE.OctahedronGeometry(0.3), MAX_SPOTS, { color: '#ffffff', flat: 0.8 });
    mark.name = 'poi-markers';
    mark.count = 0;
    mark.frustumCulled = false; // they are all over the island, one sphere would be the island anyway
    scene.add(mark);
    markers = mark;
    tick();
    await slice();

    sky = createSky(kit, tier);
    scene.add(sky.group);
    tick();
    await slice();

    const scatter = buildScatter(kit, tier) as ReturnType<typeof buildScatter> & { update?: (dt: number, t: number) => void };
    scene.add(scatter.group);
    measureTops(scatter.group, scatter.colliders);
    bucketScatter(scatter.colliders);
    if (wantColliders) showColliders(true);
    if (typeof scatter.update === 'function') scatterUpdate = scatter.update.bind(scatter);
    // What the picture costs before any district is in it, for this tier's build: every mesh of the
    // ground, sky, city and figure, the markers at their fullest, and the ink pass.
    tally.calls = 2;
    tally.triangles = MAX_SPOTS * 8 + 1;
    costOfTree(terrain.group, tally);
    costOfTree(sky.group, tally);
    costOfTree(scatter.group, tally);
    costOfTree(figure.group, tally);
    reserve.calls = tally.calls;
    reserve.triangles = Math.round(tally.triangles);
    tick();

    for (let i = 0; i < order.length; i++) {
      const place = order[i];
      await slice();
      const id = place.site.id;
      try {
        raise(place, await loading[i], tier);
      } catch (err) {
        console.error(`[world] ${id} failed to build. Using the placeholder.`, err);
        try {
          raise(place, placeholder(id), tier);
        } catch (err2) {
          console.error(`[world] the placeholder for ${id} failed too. The pad stays empty.`, err2);
        }
      }
      tick();
    }
    ready = true;
    emit('ready', undefined);
  }

  // -------------------------------------------------------------------------------------------
  // Debug: colliders as see-through red shapes
  // -------------------------------------------------------------------------------------------
  let colliderView: THREE.Mesh | null = null;
  let wantColliders = false;

  function showColliders(on: boolean): void {
    wantColliders = on;
    if (colliderView) {
      scene.remove(colliderView);
      colliderView.geometry.dispose();
      colliderView = null;
    }
    if (!on) {
      if (real) real.rescan();
      return;
    }
    const b = kit.builder();
    const add = (c: Collider): void => {
      const y = heightAt(c.x, c.z) - 0.2;
      if (c.kind === 'circle') b.add(geo.cylinder(c.r, c.r, 1.1, 14), { color: palette.red, pos: [c.x, y, c.z], dither: 0.5, flat: 1 });
      else b.add(geo.box(c.hw * 2, 1.1, c.hd * 2), { color: palette.red, pos: [c.x, y, c.z], rot: [0, c.rot ?? 0, 0], dither: 0.5, flat: 1 });
    };
    let n = 0;
    for (const c of scatterColliders) (add(c), n++);
    for (const p of places) for (const c of p.colliders) (add(c), n++);
    if (n === 0) return;
    colliderView = b.build('debug-colliders');
    colliderView.frustumCulled = false;
    scene.add(colliderView);
    if (real) real.rescan();
  }

  // -------------------------------------------------------------------------------------------
  // Per frame
  // -------------------------------------------------------------------------------------------
  const skyRGB = skyColors();
  const skyNow: SkyHex = { top: 0x5a64cc, mid: 0xa9b0ee, horizon: 0xf8dcc6, haze: 0xf3d2c4 };
  ink.setSky(skyNow);
  let pausedTick = 0;

  function trackDistricts(dt: number, px: number, py: number, pz: number, cam: THREE.PerspectiveCamera): void {
    const eye = cam.position;
    const far = useFree ? Infinity : DRAW_FAR[quality.tier];
    cam.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));

    // Nearest first, so when the picture gets too heavy it is the far districts that go.
    for (let i = 0; i < places.length; i++) {
      const s = places[i].site;
      eyeDistance[i] = Math.hypot(eye.x - s.center.x, eye.z - s.center.z) - s.radius;
    }
    for (let i = 1; i < byDistance.length; i++) {
      const v = byDistance[i];
      let j = i - 1;
      while (j >= 0 && eyeDistance[byDistance[j]] > eyeDistance[v]) {
        byDistance[j + 1] = byDistance[j];
        j--;
      }
      byDistance[j + 1] = v;
    }

    // The real look counts its own way: baked chunks where they are in, the ink geometry where they are not.
    const rl = real !== null && real.active() ? real : null;
    const kept = rl ? rl.reserve() : reserve;
    const budget = rl ? REAL_BUDGET : BUDGET;
    let calls = kept.calls;
    let triangles = kept.triangles;
    const now = quality.tier;
    const maxTriangles = rl
      ? Math.min(REAL_BUDGET.triangles, REAL_TRI_BUDGET[now])
      : TIER_RANK[now] < TIER_RANK[builtTier]
        ? Math.min(BUDGET.triangles, TRI_BUDGET[now])
        : BUDGET.triangles;
    let drawn = 0;
    let stand = -1;
    for (let n = 0; n < byDistance.length; n++) {
      const i = byDistance[n];
      const place = places[i];
      if (!place.build || !place.group || !place.cost) continue;
      const s = place.site;
      const dEye = eyeDistance[i];
      const inView = frustum.intersectsSphere(place.bounds);
      let shown = place.shown ? dEye < far + 12 : dEye < far;
      if (shown && inView) {
        const cost = (rl ? rl.cost(s.id) : null) ?? place.cost;
        // The first one in view is always drawn, whatever it costs.
        if (drawn > 0 && (calls + cost.calls > budget.calls || triangles + cost.triangles > maxTriangles)) shown = false;
        else {
          calls += cost.calls;
          triangles += cost.triangles;
          drawn++;
        }
      }
      if (shown !== place.shown) {
        place.shown = shown;
        for (let k = place.spotFrom; k < place.spotTo; k++) writeMarker(k, ambT);
        if (markers) markers.instanceMatrix.needsUpdate = true;
      }
      place.group.visible = shown && inView;
      if (rl) rl.setShown(s.id, shown && inView);

      const d = Math.hypot(px - s.center.x, pz - s.center.z);
      place.near = d < s.radius + UPDATE_MARGIN;
      if (place.near && shown && place.build.update && !paused) {
        local.set(px - s.center.x, py - s.height, pz - s.center.z);
        place.build.update(dt, ambT, local);
      }
      // A little slack either side of the pad edge so the name does not flicker on the boundary.
      if (d < s.radius * (i === standing ? 1.06 : 0.98)) stand = i;
    }
    if (stand !== standing) {
      standing = stand;
      if (stand >= 0) visitedSet.add(places[stand].site.id);
      emit('district', stand >= 0 ? places[stand].site : null);
    }
  }

  function trackSpots(px: number, pz: number): void {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const dx = px - s.x;
      const dz = pz - s.z;
      const d = Math.hypot(dx, dz);
      // The one he already has keeps a small head start, so two close stones do not flip back and forth.
      const lim = i === active ? s.reach + 0.35 : s.reach;
      if (d > lim) continue;
      const score = i === active ? d - 0.4 : d;
      if (score < bestD) {
        bestD = score;
        best = i;
      }
    }
    setActive(best);
  }

  function moveMarkers(t: number): void {
    if (!markers || still) return;
    let any = false;
    for (let p = 0; p < places.length; p++) {
      const place = places[p];
      if (!place.near || !place.shown) continue;
      for (let i = place.spotFrom; i < place.spotTo; i++) writeMarker(i, t);
      any = any || place.spotTo > place.spotFrom;
    }
    if (any) markers.instanceMatrix.needsUpdate = true;
  }

  function frame(dt: number): void {
    // Under an overlay the picture hardly matters: draw every other frame. A change-over keeps its pace.
    if (paused && (pausedTick++ & 1) === 1) {
      lookOwed += dt;
      return;
    }
    stepLook(dt + lookOwed);
    lookOwed = 0;
    const step = still ? 0 : dt;
    const drift = calm ? step * CALM_RATE : step;
    simT += step;
    ambT += drift;

    input.update();
    gather(controller.position.x, controller.position.z);
    controller.update(dt);
    const px = controller.position.x;
    const py = controller.position.y;
    const pz = controller.position.z;
    if (figure) {
      // His stride runs on the real step. The clock only drives the idle breathing and looking about.
      // With reduced motion he also leans less into a turn, which is most of what swings the hair.
      figure.update(step, calm ? ambT : simT, controller.speed, calm ? controller.turnRate * 0.35 : controller.turnRate, controller.grounded);
      figure.group.position.copy(controller.position);
      figure.group.rotation.y = controller.yaw;
      figure.setSlope(controller.slopeX, controller.slopeZ);
    }

    const cam = useFree ? free : rig;
    const realOn = real !== null && real.active();
    if (realOn) real!.update(dt, px, py, pz);
    trackDistricts(drift, px, py, pz, cam);
    trackSpots(px, pz);
    if (started && !paused) {
      if (input.state.interact && active >= 0) emit('interact', spots[active].hit);
      if (!movedOnce && controller.speed > 0.5) {
        movedOnce = true;
        emit('moved', undefined);
      }
    }
    input.endFrame();

    moveMarkers(ambT);
    if (sky) {
      sky.update(drift, ambT, cam.position);
      if (useFree) sky.colorsAt(cam.position.x, cam.position.z, skyRGB);
      else sky.colorsAt(px, pz, skyRGB);
      ink.setSky(skyHex(skyRGB, skyNow));
    }
    if (scatterUpdate) scatterUpdate(drift, ambT);
    if (realOn) real!.render(scene, cam, simT, lookMix, lookAim === 1);
    else ink.render(scene, cam, simT);
  }

  // A tap on the marker of the thing in reach does what the interact key does.
  const tapAt = new THREE.Vector3();
  input.onInteractTap((clientX, clientY) => {
    if (!started || paused || active < 0) return;
    const s = spots[active];
    const cam = useFree ? free : rig;
    tapAt.set(s.x, s.y, s.z).project(cam);
    if (tapAt.z > 1) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + (tapAt.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-tapAt.y * 0.5 + 0.5) * rect.height;
    if (Math.hypot(clientX - sx, clientY - sy) < 64) emit('interact', s.hit);
  });

  // -------------------------------------------------------------------------------------------
  // The two looks. 'ink' is the drawing and what the page starts in. 'real' is the same place built
  // and photographed. One call swaps them where the visitor stands: the walk never stops, the camera
  // never moves. Nothing of the real look is fetched, not even its code, until the first request.
  // -------------------------------------------------------------------------------------------
  /** What look() answers. */
  let lookNow: Look = 'ink';
  /** The latest request, and whether it has landed. */
  let lookWanted: Look = 'ink';
  let lookSettled = true;
  /** Share of the picture that is the real look, and where that is heading (0 or 1). */
  let lookMix = 0;
  let lookAim = 0;
  let lookOwed = 0;
  /** Bumped by every new request. A load that finds a newer number steps aside. */
  let lookSeq = 0;
  let waiting: { resolve: () => void; reject: (err: Error) => void }[] = [];
  let realComing: Promise<RealLook> | null = null;
  let realMissing = false;
  let capable: boolean | null = null;
  /** When the real look's files are freed, in seconds on the page clock. Infinity while it is on screen. */
  let releaseAt = Infinity;
  let lookHold: number | null = null;

  function lookAvailable(): boolean {
    if (realMissing) return false;
    if (capable === null) {
      capable = false;
      try {
        const r = ink.renderer;
        // The files sit beside the page. A page opened from disk cannot fetch them. The single file
        // build has none, unless it is inside the locked copy, which brings its own way to open them.
        const filesThere = location.protocol !== 'file:' && (import.meta.env.MODE !== 'single' || typeof window.__lsAsset === 'function');
        const canDraw =
          r.capabilities.maxTextureSize >= 2048 && (r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float'));
        capable = filesThere && canDraw && typeof DecompressionStream === 'function';
      } catch {
        capable = false;
      }
    }
    return capable;
  }

  function settleLook(err?: Error): void {
    const list = waiting;
    waiting = [];
    for (const w of list) {
      if (err) w.reject(err);
      else w.resolve();
    }
  }

  /** The change-over has run its course: the wanted look fills the screen. */
  function landLook(): void {
    if (lookAim === 0 && real) {
      real.setActive(false);
      releaseAt = performance.now() / 1000 + REAL_KEEP[quality.tier];
    }
    // Each look has its own tier and resolution: a heavy real frame must not leave the drawing blurred.
    quality.setLook(lookAim === 1 ? 'real' : 'ink');
    lookSettled = true;
    emit('look', { look: lookAim === 1 ? 'real' : 'ink', state: 'on' });
    settleLook();
  }

  function stepLook(dt: number): void {
    if (real && !real.active() && lookWanted === 'ink') {
      const now = performance.now() / 1000;
      // Back in the drawing with the real look's files still held (a load that was called off lands
      // here too): start the clock, and when it runs out give the memory back.
      if (releaseAt === Infinity) {
        if (real.holding()) releaseAt = now + REAL_KEEP[quality.tier];
      } else if (now > releaseAt) {
        lookSeq++;
        real.release();
        releaseAt = Infinity;
      }
    }
    if (lookMix === lookAim) return;
    const move = calm ? 1 : dt / LOOK_SECONDS;
    let next = lookAim > lookMix ? Math.min(1, lookMix + move) : Math.max(0, lookMix - move);
    // A test can stop the change-over part way to look at it.
    if (lookHold !== null) next = lookAim > lookMix ? Math.min(next, Math.max(lookMix, lookHold)) : Math.max(next, Math.min(lookMix, lookHold));
    lookMix = next;
    if (lookMix === lookAim) landLook();
  }

  function loadReal(): Promise<RealLook> {
    if (!realComing) {
      const coming = import('../real/index').then((m) => {
        const made = m.createReal({
          scene,
          ink,
          canvas,
          tier: () => quality.tier,
          camera: () => (useFree ? free : rig),
          sites: SITES.map((s) => ({ id: s.id, x: s.center.x, y: s.height, z: s.center.z, radius: s.radius })),
        });
        made.setFog(fogNow.near, fogNow.far);
        made.setSize(sizeNow.width, sizeNow.height, sizeNow.pixelRatio);
        real = made;
        return made;
      });
      coming.catch(() => {
        if (realComing === coming) realComing = null;
      });
      realComing = coming;
    }
    return realComing;
  }

  async function bringReal(seq: number): Promise<void> {
    try {
      emit('look', { look: 'real', state: 'loading', progress: 0 });
      if (!ready) await new Promise<void>((resolve) => void on('ready', () => resolve()));
      if (seq !== lookSeq) return;
      const r = await loadReal();
      if (seq !== lookSeq) return;
      await r.prepare(
        controller.position,
        (p) => {
          if (seq === lookSeq) emit('look', { look: 'real', state: 'loading', progress: p });
        },
        () => seq === lookSeq,
      );
      if (seq !== lookSeq) return;
      r.setActive(true);
      releaseAt = Infinity;
      lookNow = 'real';
      lookAim = 1;
      // frame() carries the picture across and settles the promises when it has arrived.
    } catch (err) {
      if (seq !== lookSeq) return; // a newer request took over, and it settles everyone
      lookSeq++; // files still on their way must not report progress after this
      console.error('[world] the real look did not load', err);
      if ((err as { code?: string } | null)?.code === 'no-manifest') realMissing = true;
      lookWanted = 'ink';
      lookSettled = true;
      if (real && !real.active()) releaseAt = performance.now() / 1000 + REAL_KEEP[quality.tier];
      emit('look', { look: 'real', state: 'failed' });
      settleLook(new Error(realMissing ? NO_REAL : REAL_FAILED));
    }
  }

  function setLook(next: Look): Promise<void> {
    if (next !== 'ink' && next !== 'real') return Promise.reject(new Error('There is no look called that.'));
    if (next === 'real' && !lookAvailable()) return Promise.reject(new Error(NO_REAL));
    return new Promise<void>((resolve, reject) => {
      if (next === lookWanted) {
        // Already there, or already on its way: one job, and everyone who asked hears when it lands.
        if (lookSettled) resolve();
        else waiting.push({ resolve, reject });
        return;
      }
      waiting.push({ resolve, reject });
      lookWanted = next;
      lookSettled = false;
      const seq = ++lookSeq;
      if (next === 'real') {
        void bringReal(seq);
        return;
      }
      lookNow = 'ink';
      lookAim = 0;
      if (real && !real.active()) releaseAt = performance.now() / 1000 + REAL_KEEP[quality.tier];
      // Pressed while the real look was still loading: there is nothing to cross back from.
      if (lookMix === 0) landLook();
    });
  }

  // A lost graphics context takes every texture and buffer with it. three rebuilds the ink look by
  // itself. The real look's files are let go and fetched again (the browser has them cached).
  canvas.addEventListener('webglcontextrestored', () => {
    if (!real) return;
    const was = lookWanted;
    lookSeq++;
    real.release();
    releaseAt = Infinity;
    lookMix = 0;
    lookAim = 0;
    lookNow = 'ink';
    lookWanted = 'ink';
    lookSettled = true;
    quality.setLook('ink');
    const list = waiting;
    waiting = [];
    if (was === 'real') {
      const again = setLook('real');
      again.then(
        () => list.forEach((w) => w.resolve()),
        (err: Error) => list.forEach((w) => w.reject(err)),
      );
    } else list.forEach((w) => w.resolve());
  });

  // -------------------------------------------------------------------------------------------
  // The surface
  // -------------------------------------------------------------------------------------------
  function stats(): WorldStats {
    const s = ink.stats();
    const ms = quality.frameMs;
    return { calls: s.calls, triangles: s.triangles, fps: ms > 0 ? 1000 / ms : 0, frameMs: ms, pixelRatio: quality.pixelRatio, tier: quality.tier };
  }

  // A tier change while the page is open. What follows at once: the ink settings, the haze and
  // draw distance, the triangle budget when the tier goes below the built one (trackDistricts reads
  // the tier every frame) and the pixel ratio. What does not: the geometry, which was built for the
  // tier the page loaded with. That is why a saved choice has to be read before the world is built
  // (see boot() in main.ts).
  let fogTier: QualityTier | null = null;
  const followTier = (): void => {
    ink.setQuality(quality.tier);
    if (fogTier !== quality.tier) {
      fogTier = quality.tier;
      if (!useFree) setFog(FOG_NEAR, fogFar(quality.tier));
    }
    if (real) real.setTier(quality.tier);
  };
  quality.onChange(() => {
    followTier();
    emit('quality', stats());
  });
  followTier();

  function setReducedMotion(on: boolean): void {
    calm = on;
    controller.setCalm(on);
    ink.setCalm(on);
  }
  setReducedMotion(prefersCalm());

  function teleport(target: DistrictId | Vec2, yaw?: number): void {
    let x: number;
    let z: number;
    let face = yaw;
    if (typeof target === 'string') {
      const s = SITE_BY_ID[target];
      if (!s) return;
      x = s.center.x + s.arrive.x;
      z = s.center.z + s.arrive.z;
      face = yaw ?? s.arrive.yaw;
    } else {
      x = target.x;
      z = target.z;
    }
    // The colliders round the new spot first, so the camera snaps to where it will stay.
    gatherDirty = true;
    gather(x, z);
    controller.teleport(x, z, face);
    if (figure) figure.reset();
  }

  function setFreeCamera(eye: readonly number[] | null, look?: readonly number[]): void {
    if (!eye || eye.length < 3) {
      useFree = false;
      setFog(FOG_NEAR, fogFar(quality.tier));
      return;
    }
    useFree = true;
    free.position.set(eye[0], eye[1], eye[2]);
    const lx = look?.[0] ?? 0;
    const ly = look?.[1] ?? 0;
    const lz = look?.[2] ?? 0;
    free.lookAt(lx, ly, lz);
    free.aspect = aspect;
    free.updateProjectionMatrix();
    // Nobody walks this far out. From high up, push the haze back so the whole island reads.
    const reach = Math.hypot(eye[0] - lx, eye[1] - ly, eye[2] - lz);
    setFog(Math.max(FOG_NEAR, reach * 0.65), Math.max(FOG_FAR, reach * 4));
  }

  const world: World = {
    get ready() {
      return ready;
    },
    get isTouch() {
      return input.isTouch;
    },
    on,
    start() {
      if (started) return;
      started = true;
      controller.frameFor('play');
      input.setEnabled(!paused);
    },
    setPaused(p: boolean) {
      paused = p;
      pausedTick = 0;
      input.setEnabled(started && !paused);
    },
    teleport,
    player() {
      return { x: controller.position.x, z: controller.position.z, yaw: controller.yaw, district: standing >= 0 ? places[standing].site.id : null };
    },
    stats,
    setQuality(tier) {
      quality.setTier(tier);
    },
    setReducedMotion,
    reducedMotion: () => calm,
    visited() {
      return Array.from(visitedSet);
    },
    touchRoot(el) {
      input.setTouchUi(el);
    },
    look: () => lookNow,
    lookAvailable,
    setLook,

    scene,
    camera: () => (useFree ? free : rig),
    frame,
    resize(width, height, pixelRatio) {
      aspect = width / Math.max(1, height);
      sizeNow.width = width;
      sizeNow.height = height;
      sizeNow.pixelRatio = pixelRatio;
      ink.setSize(width, height, pixelRatio);
      if (real) real.setSize(width, height, pixelRatio);
      controller.setAspect(aspect);
      free.aspect = aspect;
      free.updateProjectionMatrix();
    },
    built: () => builtOrder.slice(),
    costs() {
      const out: Partial<Record<DistrictId, DistrictCost>> = {};
      const rl = real !== null && real.active() ? real : null;
      for (const p of places) {
        if (!p.cost) continue;
        const baked = rl ? rl.cost(p.site.id) : null;
        out[p.site.id] = baked ? { ...p.cost, calls: baked.calls, triangles: baked.triangles } : p.cost;
      }
      return out;
    },
    setFreeCamera,
    showColliders,
    nearColliders: () => near,
    poi: () => (active >= 0 ? spots[active].hit : null),
    spots: () =>
      spots.map((s) => ({ entry: s.hit.entry ? s.hit.entry.id : null, action: s.hit.action, x: s.x, y: s.y, z: s.z, reach: s.reach, district: places[s.place].site.id })),
    budget: BUDGET,
    districtColliders: (id) => places.find((p) => p.site.id === id)?.colliders ?? [],
    realBudget: REAL_BUDGET,
    realInfo: () => (real ? { ...real.debug(), mix: lookMix, keptFor: Number.isFinite(releaseAt) ? Math.max(0, releaseAt - performance.now() / 1000) : -1 } : null),
    dropReal() {
      if (real && !real.active() && lookWanted === 'ink') {
        lookSeq++;
        real.release();
        releaseAt = Infinity;
      }
    },
    gpu() {
      const info = ink.renderer.info;
      const programs = info.programs ?? [];
      return { geometries: info.memory.geometries, textures: info.memory.textures, programs: programs.length, names: programs.map((p) => p.name) };
    },
    realTune(name, value) {
      if (real) real.tune(name, value);
    },
    holdLook(mix) {
      lookHold = mix === null ? null : Math.min(1, Math.max(0, mix));
    },
  };

  construct().catch((err) => console.error('[world] could not finish building', err));
  return world;
}
