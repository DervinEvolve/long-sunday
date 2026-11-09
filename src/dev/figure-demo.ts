// Test page for the figure, the controller and the follow camera: http://localhost:5184/dev/figure.html
//   WASD or arrows to walk, Shift to run, drag to look, wheel to zoom.
//   ?pose=idle|walk|run   hold him at that speed on the spot (the ground does not scroll)
//   ?still=1              render one repeatable picture; with ?pose, ?step=<seconds> picks the moment
//   ?view=back|front|side|far|three|title   fixed cameras round him (default is the real follow camera)
//   ?auto=1               autopilot walks a figure of eight through the real controller (&run=1 to sprint)
//   ?sim=<seconds>        with still=1: step the controller that long at 60 Hz before the picture
//   ?slope=1              start on the hillside    ?tier=  ?px=  ?note=0
import * as THREE from 'three';
import { createInk } from '../engine/ink';
import * as geo from '../engine/geo';
import { createInput } from '../engine/input';
import { createCharacter, characterCost } from '../engine/character';
import { createController } from '../engine/controller';
import { palette as P } from '../world/palette';
import type { Collider, QualityTier } from '../types';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('world') as HTMLCanvasElement;
const note = document.getElementById('note') as HTMLDivElement;
const tier = (q.get('tier') as QualityTier | null) ?? 'high';
const still = q.get('still') === '1';
const px = Number(q.get('px') ?? Math.min(window.devicePixelRatio || 1, 2));
const pose = q.get('pose');
const view = q.get('view');
const auto = q.get('auto') === '1';
const autoRun = q.get('run') === '1';
const sim = Number(q.get('sim') ?? 0);
const step = Number(q.get('step') ?? 1.37);

const made = createInk(canvas, tier);
if (!made) {
  note.textContent = 'WebGL2 is not available here.';
  throw new Error('no WebGL2');
}
const ink = made;
const kit = ink.kit;
ink.setStill(still);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 3000);
const sun = new THREE.Vector3(-0.52, 0.7, 0.5).normalize();
ink.setSun(sun);
ink.setFog(45, 620);
const sky = { top: 0x5a64cc, mid: 0xa9b0ee, horizon: 0xf8dcc6, haze: 0xf3d2c4 };

// ---------------------------------------------------------------------------------------------
// Ground: flat where he starts, a long hillside to the east that steepens into a wall, a dip to the west.
// ---------------------------------------------------------------------------------------------
const RIM = 62;
function ramp(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function heightAt(x: number, z: number): number {
  let h = 0;
  h += ramp(x, 10, 26) * 5; // walkable hillside, about 25 degrees at its middle
  h += ramp(x, 34, 40) * 9; // too steep: he should be turned aside
  h -= ramp(-x, 16, 30) * 2.2 * ramp(z, -30, -5); // a shallow bowl
  h += Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09) * 0.35 * ramp(Math.hypot(x, z), 6, 18);
  return h;
}
function inBounds(x: number, z: number): boolean {
  return x * x + z * z < RIM * RIM;
}

const colliders: Collider[] = [
  { kind: 'box', x: -6, z: -9, hw: 2.2, hd: 1.1, rot: 0.5 },
  { kind: 'box', x: 5, z: -14, hw: 1, hd: 3.2, rot: -0.3 },
  { kind: 'box', x: 0, z: -24, hw: 5, hd: 0.6 },
  { kind: 'circle', x: 7, z: -5, r: 1.3 },
  { kind: 'circle', x: -11, z: 3, r: 2.2 },
  { kind: 'circle', x: 1.5, z: 9, r: 0.35 },
  { kind: 'circle', x: 18, z: 4, r: 1.1 },
];

function buildGround(): void {
  const b = kit.builder();
  const N = 64;
  const S = 150;
  const g = new THREE.PlaneGeometry(S, S, N, N);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const ground = b.add(g, { color: P.sand });
  // Painted marks, so speed and foot slide can be judged against something.
  const rnd = geo.seeded(5);
  for (let i = 0; i < 46; i++) {
    const x = (rnd() - 0.5) * 70;
    const z = (rnd() - 0.5) * 70;
    if (Math.abs(x) > 9 && Math.abs(x) < 42 && x > 0) continue;
    b.add(geo.disc(0.5 + rnd() * 1.4, 7), {
      color: rnd() < 0.5 ? P.sandDeep : P.sandLight,
      pos: [x, heightAt(x, z) + 0.02, z],
      scale: [1.5, 1, 0.7],
      rot: [0, rnd() * 3, 0],
      id: ground,
      outline: false,
    });
  }
  // A lane of stripes one metre apart running north from the start.
  for (let i = -6; i <= 30; i++) {
    b.add(geo.box(i % 5 === 0 ? 1.6 : 0.8, 0.02, 0.08), { color: P.sandDeep, pos: [-2.2, 0.01, -i], outline: false });
  }
  scene.add(b.build('ground'));

  const o = kit.builder();
  for (const col of colliders) {
    const y = heightAt(col.x, col.z) - 0.3;
    if (col.kind === 'circle') {
      const tall = col.r < 0.5 ? 2.6 : 1.6 + col.r * 1.4;
      o.add(geo.cylinder(col.r, col.r * 1.04, tall + 0.3, col.r < 0.5 ? 8 : 6), {
        gradient: { bottom: P.rockDeep, top: P.rock },
        color: P.rock,
        pos: [col.x, y, col.z],
      });
      if (col.r > 1) o.add(geo.dome(col.r * 0.8, 12, 4, 0.7), { color: P.teal, pos: [col.x, y + tall + 0.3, col.z] });
    } else {
      o.add(geo.bevelBox(col.hw * 2, 2.4 + col.hw * 0.4, col.hd * 2, 0.06), {
        color: col.hw > 4 ? P.cliff : P.stone,
        pos: [col.x, y, col.z],
        rot: [0, col.rot ?? 0, 0],
        hatch: col.hw > 4 ? 0.3 : 0,
      });
    }
  }
  // Things to see on the skyline.
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7 + 0.3;
    const d = 70 + (i % 3) * 22;
    o.add(geo.rock(30 + i, 7, 1, 0.3), {
      gradient: { bottom: P.rockDeep, top: P.cliff },
      color: P.cliff,
      pos: [Math.cos(a) * d, 3, Math.sin(a) * d],
      scale: [1.4, 1.6 + (i % 4) * 0.5, 1],
      hatch: 0.3,
    });
  }
  scene.add(o.build('props'));
}
buildGround();

// ---------------------------------------------------------------------------------------------
// Him, and what drives him
// ---------------------------------------------------------------------------------------------
const figure = createCharacter(kit);
scene.add(figure.group);
const cost = characterCost(figure);

const input = createInput(canvas);
const ctl = createController({ camera, input, heightAt, inBounds, colliders: () => colliders });
if (q.get('slope') === '1') ctl.teleport(17, 6, -Math.PI / 2);
else ctl.teleport(0, 0, 0);
if (view === 'title') ctl.frameFor('title');

const poseSpeed = pose === 'walk' ? 6 : pose === 'run' ? 11.5 : 0;

// Autopilot: chase a point that runs round a figure of eight, by pushing the stick like a visitor would.
let autoT = 0;
function steer(dt: number): void {
  autoT += dt;
  const w = autoRun ? 0.42 : 0.24;
  const tx = Math.sin(autoT * w) * 15;
  const tz = Math.sin(autoT * w * 2) * 8 + 2;
  let dx = tx - ctl.position.x;
  let dz = tz - ctl.position.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  const sy = Math.sin(ctl.cameraYaw);
  const cy = Math.cos(ctl.cameraYaw);
  const s = input.state;
  const push = Math.min(1, d / 1.5);
  s.moveY = (-sy * dx - cy * dz) * push;
  s.moveX = (cy * dx - sy * dz) * push;
  s.run = autoRun;
}

function place(): void {
  figure.group.position.copy(ctl.position);
  figure.group.rotation.y = ctl.yaw;
  figure.setSlope(ctl.slopeX, ctl.slopeZ);
}

// Fixed cameras, in his own frame: back is +z, his right is +x.
function fixedCamera(): void {
  if (!view || view === 'title') return;
  const p = ctl.position;
  const sn = Math.sin(ctl.yaw);
  const cs = Math.cos(ctl.yaw);
  let lx = 0;
  let ly = 1.25;
  let lz = 4.2;
  let ty = 1.0;
  camera.fov = 34;
  if (view === 'front') lz = -4.2;
  else if (view === 'side') {
    lx = 4.4;
    lz = 0;
  } else if (view === 'three') {
    lx = -2.6;
    lz = 3.4;
    ly = 1.7;
  } else if (view === 'face') {
    lx = 0.5;
    lz = -1.5;
    ly = 1.72;
    ty = 1.68;
  } else if (view === 'far') {
    lz = 26;
    ly = 4.5;
    ty = 3.2;
    camera.fov = 55;
  }
  camera.updateProjectionMatrix();
  // Local to world for a heading where forward is (-sin, 0, -cos).
  const wx = lx * cs + lz * sn;
  const wz = -lx * sn + lz * cs;
  camera.position.set(p.x + wx, p.y + ly, p.z + wz);
  camera.lookAt(p.x, p.y + ty, p.z);
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ink.setSize(w, h, px);
  ctl.setAspect(w / h);
}
window.addEventListener('resize', resize);
resize();

let simT = 0;
function tick(dt: number): void {
  simT += dt;
  input.update();
  if (auto) steer(dt);
  if (pose) {
    figure.update(dt, simT, poseSpeed, 0, true);
    ctl.update(0);
  } else {
    ctl.update(dt);
    figure.update(dt, simT, ctl.speed, ctl.turnRate, ctl.grounded);
  }
  input.endFrame();
  place();
}

declare global {
  interface Window {
    __figure?: {
      ready: boolean;
      frames: number;
      stats(): { calls: number; triangles: number };
      cost: { meshes: number; triangles: number };
      state(): Record<string, number | boolean>;
      figure: typeof figure;
      ctl: typeof ctl;
      camera: THREE.PerspectiveCamera;
    };
  }
}
const hook = {
  ready: false,
  frames: 0,
  stats: () => ink.stats(),
  cost,
  state: () => ({
    x: ctl.position.x,
    y: ctl.position.y,
    z: ctl.position.z,
    yaw: ctl.yaw,
    speed: ctl.speed,
    turnRate: ctl.turnRate,
    cameraYaw: ctl.cameraYaw,
    grounded: ctl.grounded,
    camX: camera.position.x,
    camY: camera.position.y,
    camZ: camera.position.z,
    fov: camera.fov,
    ground: heightAt(ctl.position.x, ctl.position.z),
    camGround: heightAt(camera.position.x, camera.position.z),
  }),
  figure,
  ctl,
  camera,
};
window.__figure = hook;

if (still) {
  figure.reset();
  const n = Math.round((pose ? step : sim) * 60);
  for (let i = 0; i < n; i++) tick(1 / 60);
  if (n === 0) tick(0);
}

let last = 0;
function frame(ms: number): void {
  const dt = last ? Math.min(0.1, (ms - last) / 1000) : 0;
  last = ms;
  if (!still) tick(dt);
  fixedCamera();
  ink.setSky(sky);
  ink.render(scene, camera, still ? 0 : ms / 1000);
  hook.frames++;
  hook.ready = true;
  if (q.get('note') !== '0' && hook.frames % 10 === 0) {
    const s = ink.stats();
    note.textContent = `figure ${cost.meshes} meshes ${cost.triangles} tris   frame ${s.calls} calls ${s.triangles} tris   speed ${ctl.speed.toFixed(1)}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
