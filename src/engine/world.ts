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
import { buildTerrain, heightAt, inBounds } from './terrain';
import { createSky, skyColors, skyHex, type Sky, type SkyHex } from './sky';
import { buildScatter } from './scatter';
import { createCharacter, type Character } from './character';
import { createController, type Controller } from './controller';
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
/** District update() runs while the visitor is within the pad radius plus this. */
const UPDATE_MARGIN = 60;
/** Colliders are gathered this far around him: the longest camera arm plus the biggest rock. */
const GATHER = 24;
const GATHER_STEP = 3;
const CELL = 16;
const MAX_SPOTS = 160;
/** The whole picture has to stay under this. */
export const BUDGET = { calls: 150, triangles: 400000 };
/** What ground, sky, scatter, the figure, the markers and the ink pass cost with no district in view (measured, rounded up). */
const RESERVE = { calls: 60, triangles: 200000 };
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
}

interface Place {
  site: DistrictSite;
  build: DistrictBuild | null;
  group: THREE.Group | null;
  colliders: Collider[]; // world space
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

export function createWorld(opts: WorldOpts): World {
  const { ink, quality, input, canvas } = opts;
  const kit = ink.kit;
  const still = !!opts.still;

  const scene = new THREE.Scene();
  const rig = new THREE.PerspectiveCamera(55, 1, 0.3, 3000);
  const free = new THREE.PerspectiveCamera(46, 1, 0.3, 4000);
  let useFree = false;
  let aspect = 1;

  ink.setSun(SUN);
  ink.setFog(FOG_NEAR, FOG_FAR);
  ink.setStill(still);

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------
  const listeners: Listeners = { progress: [], ready: [], district: [], poi: [], interact: [], quality: [], moved: [] };

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
  let scatterColliders: Collider[] = [];
  const cells = new Map<number, number[]>();
  let stamps = new Uint32Array(0);
  let stamp = 0;
  const near: Collider[] = [];
  let gatherX = Infinity;
  let gatherZ = Infinity;
  let gatherDirty = true;

  const cellKey = (ix: number, iz: number): number => (ix + 512) * 1024 + (iz + 512);

  function bucketScatter(list: Collider[]): void {
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
    if (prev >= 0) writeMarker(prev, simT);
    if (markers) markers.instanceMatrix.needsUpdate = true;
    emit('poi', next >= 0 ? spots[next].hit : null);
  }

  function costOf(group: THREE.Group, build: DistrictBuild): DistrictCost {
    let calls = 0;
    let triangles = 0;
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      calls++;
      const g = m.geometry;
      const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      triangles += (m as THREE.InstancedMesh).isInstancedMesh ? n * (m as THREE.InstancedMesh).count : n;
    });
    return {
      calls,
      triangles: Math.round(triangles),
      placeholder: group.name.startsWith('placeholder-'),
      colliders: build.colliders.length,
      pois: build.pois.length,
    };
  }

  function raise(place: Place, mod: DistrictModule): void {
    const site = place.site;
    const cx = site.center.x;
    const cz = site.center.z;
    const ctx: DistrictContext = {
      site,
      kit,
      palette,
      rng: rngFrom('district:' + site.id),
      groundAt: (x, z) => heightAt(cx + x, cz + z) - site.height,
      quality: quality.tier,
      entries: entriesFor(site.id),
      sun: [SUN.x, SUN.y, SUN.z],
    };
    const build = mod.build(ctx);
    build.group.position.set(cx, site.height, cz);
    scene.add(build.group);
    place.build = build;
    place.group = build.group;
    place.cost = costOf(build.group, build);

    place.colliders = build.colliders.map((c): Collider =>
      c.kind === 'circle' ? { kind: 'circle', x: c.x + cx, z: c.z + cz, r: c.r } : { kind: 'box', x: c.x + cx, z: c.z + cz, hw: c.hw, hd: c.hd, rot: c.rot },
    );
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
        writeMarker(i, simT);
        markers.setColorAt(i, MARK_IDLE);
      }
      markers.instanceMatrix.needsUpdate = true;
      if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
    }
    builtOrder.push(site.id);
    if (wantColliders) showColliders(true);
  }

  // -------------------------------------------------------------------------------------------
  // Building, a slice at a time so the title card stays alive
  // -------------------------------------------------------------------------------------------
  let sky: Sky | null = null;
  let scatterUpdate: ((dt: number, t: number) => void) | null = null;
  let ready = false;
  let simT = 0;

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
    await (kit.ready ?? Promise.resolve());
    const tier = quality.tier;
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

    scene.add(buildTerrain(kit, tier).group);
    tick();
    await slice();

    figure = createCharacter(kit);
    scene.add(figure.group);
    const mark = kit.instances(new THREE.OctahedronGeometry(0.3), MAX_SPOTS, { color: '#ffffff', flat: 0.8 });
    mark.name = 'poi-markers';
    mark.count = 0;
    mark.frustumCulled = false; // they are all over the mesa, one sphere would be the mesa anyway
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
    bucketScatter(scatter.colliders);
    if (wantColliders) showColliders(true);
    if (typeof scatter.update === 'function') scatterUpdate = scatter.update.bind(scatter);
    tick();

    for (const place of order) {
      await slice();
      const id = place.site.id;
      try {
        raise(place, await DISTRICTS[id]());
      } catch (err) {
        console.error(`[world] ${id} failed to build. Using the placeholder.`, err);
        try {
          raise(place, placeholder(id));
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
    if (!on) return;
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

    let calls = RESERVE.calls;
    let triangles = RESERVE.triangles;
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
        // The first one in view is always drawn, whatever it costs.
        if (drawn > 0 && (calls + place.cost.calls > BUDGET.calls || triangles + place.cost.triangles > BUDGET.triangles)) shown = false;
        else {
          calls += place.cost.calls;
          triangles += place.cost.triangles;
          drawn++;
        }
      }
      if (shown !== place.shown) {
        place.shown = shown;
        for (let k = place.spotFrom; k < place.spotTo; k++) writeMarker(k, simT);
        if (markers) markers.instanceMatrix.needsUpdate = true;
      }
      place.group.visible = shown && inView;

      const d = Math.hypot(px - s.center.x, pz - s.center.z);
      place.near = d < s.radius + UPDATE_MARGIN;
      if (place.near && shown && place.build.update && !paused) {
        local.set(px - s.center.x, py - s.height, pz - s.center.z);
        place.build.update(dt, simT, local);
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
    // Under an overlay the picture hardly matters: draw every other frame.
    if (paused && (pausedTick++ & 1) === 1) return;
    const step = still ? 0 : dt;
    simT += step;

    input.update();
    gather(controller.position.x, controller.position.z);
    controller.update(dt);
    const px = controller.position.x;
    const py = controller.position.y;
    const pz = controller.position.z;
    if (figure) {
      figure.update(step, simT, controller.speed, controller.turnRate, controller.grounded);
      figure.group.position.copy(controller.position);
      figure.group.rotation.y = controller.yaw;
      figure.setSlope(controller.slopeX, controller.slopeZ);
    }

    const cam = useFree ? free : rig;
    trackDistricts(step, px, py, pz, cam);
    trackSpots(px, pz);
    if (started && !paused) {
      if (input.state.interact && active >= 0) emit('interact', spots[active].hit);
      if (!movedOnce && controller.speed > 0.5) {
        movedOnce = true;
        emit('moved', undefined);
      }
    }
    input.endFrame();

    moveMarkers(simT);
    if (sky) {
      sky.update(step, simT, cam.position);
      if (useFree) sky.colorsAt(cam.position.x, cam.position.z, skyRGB);
      else sky.colorsAt(px, pz, skyRGB);
      ink.setSky(skyHex(skyRGB, skyNow));
    }
    if (scatterUpdate) scatterUpdate(step, simT);
    ink.render(scene, cam, simT);
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
  // The surface
  // -------------------------------------------------------------------------------------------
  function stats(): WorldStats {
    const s = ink.stats();
    const ms = quality.frameMs;
    return { calls: s.calls, triangles: s.triangles, fps: ms > 0 ? 1000 / ms : 0, frameMs: ms, pixelRatio: quality.pixelRatio, tier: quality.tier };
  }

  quality.onChange((q) => {
    ink.setQuality(q.tier);
    emit('quality', stats());
  });
  ink.setQuality(quality.tier);

  function teleport(target: DistrictId | Vec2, yaw?: number): void {
    if (typeof target === 'string') {
      const s = SITE_BY_ID[target];
      if (!s) return;
      controller.teleport(s.center.x + s.arrive.x, s.center.z + s.arrive.z, yaw ?? s.arrive.yaw);
    } else controller.teleport(target.x, target.z, yaw);
    gatherDirty = true;
    if (figure) figure.reset();
  }

  function setFreeCamera(eye: readonly number[] | null, look?: readonly number[]): void {
    if (!eye || eye.length < 3) {
      useFree = false;
      ink.setFog(FOG_NEAR, FOG_FAR);
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
    // Nobody walks this far out. From high up, push the haze back so the whole mesa reads.
    const reach = Math.hypot(eye[0] - lx, eye[1] - ly, eye[2] - lz);
    ink.setFog(Math.max(FOG_NEAR, reach * 0.65), Math.max(FOG_FAR, reach * 4));
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
    visited() {
      return Array.from(visitedSet);
    },
    touchRoot(el) {
      input.setTouchUi(el);
    },

    scene,
    camera: () => (useFree ? free : rig),
    frame,
    resize(width, height, pixelRatio) {
      aspect = width / Math.max(1, height);
      ink.setSize(width, height, pixelRatio);
      controller.setAspect(aspect);
      free.aspect = aspect;
      free.updateProjectionMatrix();
    },
    built: () => builtOrder.slice(),
    costs() {
      const out: Partial<Record<DistrictId, DistrictCost>> = {};
      for (const p of places) if (p.cost) out[p.site.id] = p.cost;
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
  };

  construct().catch((err) => console.error('[world] could not finish building', err));
  return world;
}
