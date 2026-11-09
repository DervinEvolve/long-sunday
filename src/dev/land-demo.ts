// Test page for the ground, the sky and the scatter: http://localhost:5183/dev/land.html
//   ?cam=0..4   0 walker on the spine by the Trailhead, 1 the whole mesa from high up, 2 at the rim,
//               3 along a branch road, 4 below the Observatory where the two lines join
//   ?still=1    freeze sway, wobble and grain so screenshots repeat
//   ?tier=low|medium|high   ?px=2   ?t=12.5 (fixed clock)   ?note=0
//   ?at=x,z&yaw=deg&up=m    stand anywhere
// Drag to look around, wheel to move along the view.
import * as THREE from 'three';
import { createInk } from '../engine/ink';
import { buildTerrain, heightAt, roadPoint, roadLength, surveyTerrain, MERGE_LENGTH, ROAD_END, type RoadPoint } from '../engine/terrain';
import { buildScatter } from '../engine/scatter';
import { createSky, skyColors, skyHex, type Sky, type SkyHex } from '../engine/sky';
import { SITE_BY_ID } from '../world/layout';
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

const cam = Math.max(0, Math.min(4, Number(q.get('cam') ?? 0) | 0));
if (cam === 0) onRoad(0, 34, 1.7, 1, 0.6, 0.06);
else if (cam === 1) {
  eye.set(400, 95, 470);
  look.set(0, -45, -10);
  // Nobody stands this far out in the walk itself; push the haze back so the whole mesa reads.
  ink.setFog(420, 2600);
} else if (cam === 2) {
  const a = 2.62;
  const r = 226;
  eye.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  eye.y = heightAt(eye.x, eye.z) + 1.7;
  look.set(Math.cos(a + 0.5) * 246, eye.y - 6, Math.sin(a + 0.5) * 246);
} else if (cam === 3) onRoad(3, 46, 1.7, 1, 0.5, 0.02);
else {
  // Above the last stretch of the spine, looking down it to where coral and teal become one line.
  const end = roadLength(0) - SITE_BY_ID.observatory.radius * ROAD_END;
  roadPoint(0, end - MERGE_LENGTH - 16, rp);
  eye.set(rp.x - rp.tz * 1.2, rp.h + 4.2, rp.z + rp.tx * 1.2);
  roadPoint(0, end - 6, rp);
  look.set(rp.x, rp.h + 1.5, rp.z);
}
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
}
declare global {
  interface Window {
    __land?: LandHook;
  }
}
const hook: LandHook = { stats: () => ink.stats(), ink, ready: false, frames: 0, built: {}, survey: null, colliders: [] };
window.__land = hook;

const skyNow: SkyHex = { top: 0x5a64cc, mid: 0xa9b0ee, horizon: 0xf8dcc6, haze: 0xf3d2c4 };
const skyRGB = skyColors();
let sky: Sky | null = null;
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
