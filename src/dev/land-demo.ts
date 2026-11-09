// Test page for the ground, the sky and the scatter: http://localhost:5183/dev/land.html
//   ?cam=0..7   0 walker stepping off the Trailhead plaza onto the avenue, 1 the whole island from high up,
//               2 at the rim by the railing, 3 on a side street looking back at its sign and crosswalk,
//               4 below the Observatory where the two lines join, 5 out in the air looking at the underside,
//               6 standing on a plaza, 7 walker halfway up the avenue,
//               8 walker coming up to the aqueduct, 9 right under its arch looking up, 10 the crossing from
//               mid height at three quarters, 11 walker a quarter of the way up the avenue, 12 three quarters up,
//               13 the island from the south at mid height
//   ?still=1    freeze sway, wobble and grain so screenshots repeat
//   ?tier=low|medium|high   ?px=2   ?t=12.5 (fixed clock)   ?note=0
//   ?at=x,z&yaw=deg&up=m    stand anywhere
//   ?s=135&road=0&dir=1&pitch=0   walker on a street, that far along it
// Drag to look around, wheel to move along the view.
import * as THREE from 'three';
import { createInk } from '../engine/ink';
import { buildTerrain, groundSettle, heightAt, inBounds, roadInfo, roadPoint, roadLength, rimRadius, surveyTerrain, MERGE_LENGTH, PLAZA, ROAD_END, type RoadPoint } from '../engine/terrain';
import { buildScatter } from '../engine/scatter';
import { createSky, skyColors, skyHex, type Sky, type SkyHex } from '../engine/sky';
import { ROADS, SITES, SITE_BY_ID } from '../world/layout';
import type { Collider, QualityTier } from '../types';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('world') as HTMLCanvasElement;
const note = document.getElementById('note') as HTMLDivElement;
const tier = (q.get('tier') as QualityTier | null) ?? 'high';
const still = q.get('still') === '1';
const px = Number(q.get('px') ?? Math.min(window.devicePixelRatio || 1, 2));

const made = createInk(canvas, tier);
if (!made) {
  note.textContent = 'WebGL2 is not available here.';
  throw new Error('no WebGL2');
}
const ink = made;
const kit = ink.kit;
ink.setStill(still);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.3, 3000);
const sun = new THREE.Vector3(-0.52, 0.7, 0.5).normalize();
ink.setSun(sun);
ink.setFog(45, 620);

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

const eye = new THREE.Vector3();
const look = new THREE.Vector3();
const rp: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };

/** Stand on a road at distance s, eye `up` metres above it, looking along it (dir 1) or back (-1). */
function onRoad(road: number, s: number, up: number, dir = 1, side = 0, pitch = -0.03): void {
  roadPoint(road, s, rp);
  eye.set(rp.x - rp.tz * side, rp.h + up, rp.z + rp.tx * side);
  look.set(eye.x + rp.tx * dir * 40, eye.y + pitch * 40, eye.z + rp.tz * dir * 40);
}

/** How far along the avenue the aqueduct crosses it. */
function crossing(): number {
  let best = 0, bestD = Infinity;
  for (let s = 0; s < roadLength(0); s += 0.5) {
    roadPoint(0, s, rp);
    const d = Math.hypot(rp.x - 5, rp.z + 8);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

const cam = Math.max(0, Math.min(13, Number(q.get('cam') ?? 0) | 0));
if (cam === 0) onRoad(0, 15, 1.7, 1, 0.9, -0.02);
else if (cam === 1) {
  eye.set(262, 150, 318);
  look.set(-6, -42, -14);
  // Nobody stands this far out in the walk itself; push the haze back so the whole island reads.
  ink.setFog(420, 2600);
} else if (cam === 2) {
  const a = 0.52;
  const r = rimRadius(Math.cos(a), Math.sin(a)) - 5.5;
  eye.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  eye.y = heightAt(eye.x, eye.z) + 1.7;
  look.set(Math.cos(a + 0.42) * (r + 9), eye.y - 5, Math.sin(a + 0.42) * (r + 9));
} else if (cam === 3) onRoad(3, SITE_BY_ID.commons.radius * PLAZA + 15, 1.7, -1, -0.3, -0.01);
else if (cam === 4) {
  // Above the last stretch of the avenue, looking down it to where coral and teal become one line.
  const end = roadLength(0) - SITE_BY_ID.observatory.radius * ROAD_END;
  roadPoint(0, end - MERGE_LENGTH * 0.95, rp);
  eye.set(rp.x - rp.tz * 9 - rp.tx * 10, rp.h + 21, rp.z + rp.tx * 9 - rp.tz * 10);
  roadPoint(0, end - MERGE_LENGTH * 0.5, rp);
  look.set(rp.x, rp.h, rp.z);
} else if (cam === 5) {
  // Out past the edge and below it, looking back at the cut face and the tunnel.
  eye.set(Math.cos(0.7) * 318, -30, Math.sin(0.7) * 318);
  look.set(Math.cos(0.95) * 236, -6, Math.sin(0.95) * 236);
  ink.setFog(300, 2200);
} else if (cam === 6) {
  // On the Commons plaza where the avenue comes in, looking across the paving to the far side.
  const c = SITE_BY_ID.commons;
  let best = 0, bestD = Infinity;
  for (let s = 0; s < roadLength(0); s += 1) {
    roadPoint(0, s, rp);
    const d = Math.hypot(rp.x - c.center.x, rp.z - c.center.z);
    if (d < bestD) { bestD = d; best = s; }
  }
  onRoad(0, best - c.radius * 0.76, 2.2, 1, 1.6, -0.09);
} else if (cam === 8) onRoad(0, crossing() - 42, 1.7, 1, 0.9, 0.12);
else if (cam === 9) onRoad(0, crossing() - 9, 1.7, 1, 0.6, 0.55);
else if (cam === 10) {
  roadPoint(0, crossing(), rp);
  eye.set(rp.x + 74, rp.h + 46, rp.z + 58);
  look.set(rp.x - 6, rp.h + 12, rp.z - 4);
  ink.setFog(120, 900);
} else if (cam === 11) onRoad(0, roadLength(0) * 0.25, 1.7, 1, 0.9, 0.0);
else if (cam === 12) onRoad(0, roadLength(0) * 0.74, 1.7, 1, 0.9, 0.0);
else if (cam === 13) {
  eye.set(-60, 96, 300);
  look.set(10, 0, 40);
  ink.setFog(260, 1600);
} else onRoad(0, roadLength(0) * 0.47, 1.7, 1, 0.9, 0.0);
if (q.has('s')) onRoad(Number(q.get('road') ?? 0) | 0, Number(q.get('s')), Number(q.get('up') ?? 1.7), Number(q.get('dir') ?? 1), 0.9, Number(q.get('pitch') ?? 0));
if (q.has('at')) {
  const [ax, az] = (q.get('at') as string).split(',').map(Number);
  const yaw = (Number(q.get('yaw') ?? 0) * Math.PI) / 180;
  eye.set(ax, heightAt(ax, az) + Number(q.get('up') ?? 1.7), az);
  look.set(ax - Math.sin(yaw) * 40, eye.y + Number(q.get('pitch') ?? 0) * 40, az - Math.cos(yaw) * 40);
}
camera.position.copy(eye);
camera.lookAt(look);

// Look around: drag turns the head, wheel walks along the view.
const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
const step = new THREE.Vector3();
let dragging = false;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => (dragging = false));
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  euler.y -= e.movementX * 0.004;
  euler.x = Math.max(-1.4, Math.min(1.4, euler.x - e.movementY * 0.004));
  camera.quaternion.setFromEuler(euler);
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    camera.getWorldDirection(step);
    camera.position.addScaledVector(step, -e.deltaY * 0.05);
  },
  { passive: false },
);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  ink.setSize(w, h, px);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------

interface LandHook {
  stats(): { calls: number; triangles: number };
  ink: typeof ink;
  ready: boolean;
  frames: number;
  built: Record<string, number>;
  survey: ReturnType<typeof surveyTerrain> | null;
  colliders: Collider[];
  /** Microseconds per heightAt call, timed over a million calls spread across the island. */
  timeHeight(): number;
  settle: { spots: number; deepest: number };
  /** Walk every road and every plaza gate and say what would stop a walker. */
  walk(): { road: string; samples: number; outOfBounds: number; maxStep: number; maxOffRoad: number }[];
}

function timeHeight(): number {
  const n = 1_000_000;
  let sum = 0;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const a = i * 2.399963, d = 236 * Math.sqrt((i + 0.5) / n);
    sum += heightAt(Math.cos(a) * d, Math.sin(a) * d);
  }
  const ms = performance.now() - t0;
  return sum === sum ? (ms * 1000) / n : NaN;
}

// A walker keeps to a road if every step along it, and along both its edges, is inside the world and
// no step in height is taller than a kerb. Also checks that the height under the road is the road's own.
function walk(): ReturnType<LandHook['walk']> {
  const p: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };
  const out = [];
  for (let r = 0; r < ROADS.length; r++) {
    const len = roadLength(r);
    const half = ROADS[r].width / 2;
    let samples = 0, outOfBounds = 0, maxStep = 0, maxOffRoad = 0;
    for (const off of [-half, 0, half]) {
      let prev = NaN;
      for (let s = 0; s <= len; s += 0.25) {
        roadPoint(r, s, p);
        const x = p.x - p.tz * off, z = p.z + p.tx * off;
        samples++;
        if (!inBounds(x, z)) outOfBounds++;
        const h = heightAt(x, z);
        if (prev === prev) maxStep = Math.max(maxStep, Math.abs(h - prev));
        prev = h;
        if (off === 0) maxOffRoad = Math.max(maxOffRoad, Math.abs(h - p.h));
      }
    }
    out.push({ road: ROADS[r].id, samples, outOfBounds, maxStep: +maxStep.toFixed(3), maxOffRoad: +maxOffRoad.toFixed(3) });
  }
  // Round every plaza: the ring where paving meets grass, and the ring a few steps outside it.
  for (const site of SITES) {
    let samples = 0, outOfBounds = 0, maxStep = 0;
    for (const f of [PLAZA, 1.0, 1.25]) {
      let prev = NaN;
      for (let i = 0; i <= 720; i++) {
        const a = (i / 720) * Math.PI * 2;
        const x = site.center.x + Math.cos(a) * site.radius * f, z = site.center.z + Math.sin(a) * site.radius * f;
        samples++;
        if (!inBounds(x, z)) outOfBounds++;
        const h = heightAt(x, z);
        if (prev === prev) maxStep = Math.max(maxStep, Math.abs(h - prev));
        prev = h;
      }
    }
    roadInfo(site.center.x, site.center.z);
    out.push({ road: 'plaza:' + site.id, samples, outOfBounds, maxStep: +maxStep.toFixed(3), maxOffRoad: 0 });
  }
  return out;
}
declare global {
  interface Window {
    __land?: LandHook;
  }
}
const hook: LandHook = { stats: () => ink.stats(), ink, ready: false, frames: 0, built: {}, survey: null, colliders: [], timeHeight, walk, settle: groundSettle };
window.__land = hook;

const skyNow: SkyHex = { top: 0x5a64cc, mid: 0xa9b0ee, horizon: 0xf8dcc6, haze: 0xf3d2c4 };
const skyRGB = skyColors();
let sky: Sky | null = null;
let cityUpdate: ((dt: number, t: number) => void) | null = null;
// ?only=terrain,sky,scatter leaves the rest out, for counting one part at a time.
const only = q.get('only');
const wants = (part: string) => !only || only.split(',').includes(part);

function buildWorld(): void {
  if (wants('terrain')) {
    const terrain = buildTerrain(kit, tier);
    scene.add(terrain.group);
    hook.built.terrain = terrain.triangles;
    for (const child of terrain.group.children) {
      const g = (child as THREE.Mesh).geometry;
      const key = child.name.startsWith('ground') ? 'ground' : child.name;
      hook.built[key] = (hook.built[key] ?? 0) + (g.index ? g.index.count / 3 : 0);
    }
  }
  if (wants('sky')) {
    sky = createSky(kit, tier);
    scene.add(sky.group);
    hook.built.sky = sky.triangles;
  }
  if (wants('scatter')) {
    const scatter = buildScatter(kit, tier);
    scene.add(scatter.group);
    cityUpdate = scatter.update ?? null;
    hook.built.scatter = scatter.triangles;
    hook.built.colliders = scatter.colliders.length;
    hook.colliders = scatter.colliders;
    for (const child of scatter.group.children) {
      const m = child as THREE.InstancedMesh;
      const key = 'scatter.' + child.name.replace(/-\d$/, '');
      const g = m.geometry;
      const per = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      hook.built[key] = (hook.built[key] ?? 0) + per * (m.isInstancedMesh ? m.count : 1);
      if (m.isInstancedMesh) hook.built[key + '.n'] = (hook.built[key + '.n'] ?? 0) + m.count;
    }
  }
  hook.survey = surveyTerrain();
}

const fixedTime = q.has('t') ? Number(q.get('t')) : null;
let last = 0;
function frame(ms: number): void {
  const t = fixedTime ?? ms / 1000;
  const dt = Math.min(0.1, Math.max(0, (ms - last) / 1000));
  last = ms;
  if (sky) {
    sky.update(dt, t, camera.position);
    sky.colorsAt(camera.position.x, camera.position.z, skyRGB);
    ink.setSky(skyHex(skyRGB, skyNow));
  } else ink.setSky(skyNow);
  // The train runs on the clock, so a fixed clock or a stopped one leaves it standing where it is.
  if (cityUpdate) cityUpdate(dt, t);
  ink.render(scene, camera, t);
  hook.frames++;
  if (q.get('note') !== '0' && hook.frames % 20 === 1) {
    const s = ink.stats();
    note.textContent = `cam ${cam}  ${tier}  px ${px}  calls ${s.calls}  tris ${s.triangles}`;
  }
  requestAnimationFrame(frame);
}

if (q.get('note') === '0') note.style.display = 'none';
void (kit.ready ?? Promise.resolve()).then(() => {
  buildWorld();
  hook.ready = true;
  requestAnimationFrame(frame);
});
