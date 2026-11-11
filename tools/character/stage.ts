// A stage for the figure: many copies of him in one picture, so a turnaround or a walk strip is one render.
// Open it through the dev server: /tools/character/stage.html?turn=1
//   ?n=8                 how many figures in the row
//   ?turn=1              figure k is turned k * 360/n degrees (a turnaround); else all face `yaw`
//   ?yaw=90              degrees; 0 shows his back to the camera, 180 his face, 90 his left side
//   ?speed=6             metres per second fed to update
//   ?t0=2&period=0.56    figure k is stepped t0 + k * period / n seconds (a strip of one cycle)
//   ?times=0.4,3.2,7.9   or: explicit times, one figure each
//   ?ramp=0.35           speed comes up from zero over this many seconds (to look at a start)
//   ?stop=2              after this many seconds he brakes to a stop the way the controller does (38 m/s each second)
//   ?spin=3.1&spinat=0   swing round to a heading this many radians away, at the controller's rate (to look at a turn-about)
//   ?spinonly=1          and hold the speed at a creep while he does it (turning on the spot)
//   ?gap=1.3  ?dist=14 ?h=1.3 ?ty=0.95 ?fov=14  ?az=0 (camera swung round the row, degrees)
//   ?tier=high|low  ?sun=x,y,z  ?ground=sand|grass|pave|dark  ?turnrate=  ?air=1 ?calm=1 ?slope=dx,dz
import * as THREE from 'three';
import { createInk } from '/src/engine/ink';
import * as geo from '/src/engine/geo';
import { palette as P } from '/src/world/palette';
import type { QualityTier } from '/src/types';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
const canvas = document.getElementById('world') as HTMLCanvasElement;
const tier = (q.get('tier') as QualityTier | null) ?? 'high';
const made = createInk(canvas, tier === 'low' ? 'low' : 'high');
if (!made) throw new Error('no WebGL2');
const ink = made;
const kit = ink.kit;
ink.setStill(true);

const mod = await import('/src/engine/character');
const scene = new THREE.Scene();
const sunP = (q.get('sun') ?? '-0.52,0.7,0.5').split(',').map(Number);
ink.setSun(new THREE.Vector3(sunP[0], sunP[1], sunP[2]).normalize());
ink.setFog(60, 900);
const skies: Record<string, { top: number; mid: number; horizon: number; haze: number }> = {
  day: { top: 0x5a64cc, mid: 0xa9b0ee, horizon: 0xf8dcc6, haze: 0xf3d2c4 },
  bright: { top: 0x9fb4f2, mid: 0xdfe6fb, horizon: 0xfff4e2, haze: 0xfff0e0 },
};
const sky = skies[q.get('sky') ?? 'day'];

const groundCol: Record<string, string> = { sand: P.sand as string, grass: P.grass as string, pave: P.pave as string, dark: P.asphalt as string };
const gname = q.get('ground') ?? 'sand';
const slope = (q.get('slope') ?? '0,0').split(',').map(Number);
{
  const b = kit.builder();
  const g = new THREE.PlaneGeometry(200, 200, 1, 1);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, p.getX(i) * slope[0] + p.getZ(i) * slope[1]);
  g.computeVertexNormals();
  b.add(g, { color: groundCol[gname] ?? P.sand });
  if (q.get('wall')) {
    // A wall behind the row, to judge him against a colour.
    b.add(geo.box(60, 12, 0.5), { color: groundCol[q.get('wall') as string] ?? (('#' + q.get('wall')) as string), pos: [0, 0, -4] });
  }
  scene.add(b.build('ground'));
}

const n = num('n', 8);
const gap = num('gap', 1.3);
const speed = num('speed', 0);
const period = num('period', 0.56);
const t0 = num('t0', 0.02);
const yaw = (num('yaw', 0) * Math.PI) / 180;
const times = q.get('times')?.split(',').map(Number);
const count = times ? times.length : n;
const figs: { group: THREE.Group; update: Function; setSlope: Function; reset: Function; setCalm?: Function }[] = [];
let cost = { meshes: 0, triangles: 0 };
for (let k = 0; k < count; k++) {
  const f = mod.createCharacter(kit, { tier });
  figs.push(f);
  f.group.position.set((k - (count - 1) / 2) * gap, 0, 0);
  f.group.position.y = f.group.position.x * slope[0];
  f.group.rotation.y = q.get('turn') === '1' ? (k * Math.PI * 2) / count : yaw;
  scene.add(f.group);
  if (k === 0) cost = mod.characterCost(f);
  f.setSlope(slope[0], slope[1]);
  if (q.get('calm') === '1' && f.setCalm) f.setCalm(true);
  f.reset();
  const T = times ? times[k] : t0 + (speed > 0 || q.get('spread') === '1' ? (k * period) / count : 0);
  const steps = Math.max(1, Math.round(T * 60));
  const baseYaw = f.group.rotation.y;
  const grounded = q.get('air') !== '1';
  const ramp = num('ramp', 0); // seconds over which speed comes up from zero (to see starts)
  for (let i = 0; i < steps; i++) {
    const tt = (i + 1) / 60;
    const v = ramp > 0 ? speed * Math.min(1, tt / ramp) : speed;
    const stop = num('stop', 0); // after this time, speed drops to zero (to see stops)
    let sp = stop > 0 && tt > stop ? Math.max(0, speed - 38 * (tt - stop)) : v;
    let tr = num('turnrate', 0);
    const spin = num('spin', 0);
    if (spin !== 0 && tt > num('spinat', 0)) {
      // swing toward a heading spin radians away, the way the controller does (rate 13, eased by speed)
      const left = spin - (f.group.rotation.y - baseYaw);
      const k = 13 * Math.min(1, Math.max(0, (sp - 0.35) / 1.65));
      const d = left * (1 - Math.exp(-k / 60));
      f.group.rotation.y += d;
      tr = d * 60;
    }
    if (q.get('spinonly') === '1') sp = Math.min(sp, 0.6);
    f.update(1 / 60, tt, sp, tr, grounded);
  }
}

// How long one update takes.
let updateMs = 0;
{
  const f = figs[0];
  // Timed on a spare figure state would disturb the picture, so time a fresh one.
  const g = mod.createCharacter(kit, { tier });
  for (let i = 0; i < 300; i++) g.update(1 / 60, i / 60, 6, 0.3, true);
  const a = performance.now();
  const N = 4000;
  for (let i = 0; i < N; i++) g.update(1 / 60, 5 + i / 60, i % 600 < 300 ? 6 : 11.5, 0.3, true);
  updateMs = (performance.now() - a) / N;
  void f;
}

const camera = new THREE.PerspectiveCamera(num('fov', 14), 1, 0.3, 3000);
const dist = num('dist', 14);
const az = (num('az', 0) * Math.PI) / 180;
camera.position.set(Math.sin(az) * dist + num('cx', 0), num('h', 1.3), Math.cos(az) * dist);
camera.lookAt(num('cx', 0), num('ty', 0.95), 0);
function resize(): void {
  ink.setSize(window.innerWidth, window.innerHeight, num('px', 1));
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
resize();

const hook = { ready: false, frames: 0, cost, updateMs, stats: () => ink.stats(), figs };
(window as unknown as { __stage: typeof hook }).__stage = hook;
function frame(): void {
  ink.setSky(sky);
  ink.render(scene, camera, 0);
  hook.frames++;
  if (hook.frames > 2) hook.ready = true;
  if (hook.frames < 6) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
