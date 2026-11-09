// Test page for the ink renderer and the kit: http://localhost:5181/dev/kit.html
//   ?cam=0..3   fixed views (0 overview, 1 lettering close, 2 far, 3 figure, glass and stools)
//   ?still=1    freeze sway, wobble and grain so screenshots repeat
//   ?tier=low|medium|high   ?px=2 (pixel ratio)   ?note=0 (hide the readout)
// Drag to look around, wheel to move in and out.
import * as THREE from 'three';
import { createInk } from '../engine/ink';
import * as geo from '../engine/geo';
import { palette as P } from '../world/palette';
import type { QualityTier } from '../types';

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
const sky = { top: 0x5a64cc, mid: 0xa9b0ee, horizon: 0xf8dcc6, haze: 0xf3d2c4 };

const rnd = geo.seeded(11);
// Ground shadow: sand pulled toward the palette's shadow violet.
const SHADE = '#' + new THREE.Color(P.sand).lerp(new THREE.Color(P.shadow), 0.3).getHexString();

function buildWorld(): void {
  const b = kit.builder() as Required<ReturnType<typeof kit.builder>>;

  // Ground: one big sand disc, a paler apron in the middle and a few flat patches for the eye.
  const ground = b.add(geo.disc(900, 40), { color: P.sand });
  b.add(geo.disc(26, 28), { color: P.sandLight, pos: [0, 0.01, 2], id: ground });
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.283;
    const d = 16 + rnd() * 40;
    b.add(geo.disc(2 + rnd() * 4, 9), {
      color: P.sandDeep,
      pos: [Math.cos(a) * d, 0.012, Math.sin(a) * d - 4],
      scale: [1.6, 1, 0.7],
      rot: [0, rnd() * 3, 0],
    });
  }

  // The arch, with its name cut straight into the lintel.
  const archGeo = geo.arch({ span: 5, rise: 4.6, thick: 1.3, depth: 1.5, round: false });
  const archId = b.add(archGeo, { color: P.stone });
  b.shadow(archGeo, { color: SHADE, sun });
  b.add(geo.bevelBox(8.6, 0.35, 2.1, 0.08), { color: P.stone, pos: [0, 5.9, 0] });
  b.add(geo.bevelBox(1.9, 0.4, 2.0, 0.08), { color: P.stoneShade, pos: [-3.15, 0, 0] });
  b.add(geo.bevelBox(1.9, 0.4, 2.0, 0.08), { color: P.stoneShade, pos: [3.15, 0, 0] });
  // The plate has the lintel's colour and id, so it vanishes and leaves smooth letters on the stone.
  b.label({ text: 'LONG SUNDAY', size: 0.62, pos: [0, 5.3, 0.76], ink: P.ink, plate: P.stone, id: archId, pad: 0.2 });
  b.label({ text: 'est. some time ago', size: 0.16, pos: [0, 4.8, 0.76], ink: P.violet, plate: P.stone, id: archId, pad: 0.2 });

  // Cliff: a few boulders pressed into one wall. One id, so only the outer shape and the creases ink.
  const cliff = b.newId();
  for (let i = 0; i < 7; i++) {
    b.add(geo.rock(20 + i, 6, 1, 0.3), {
      gradient: { bottom: P.rockDeep, top: P.cliff },
      color: P.cliff,
      pos: [-30 + i * 10 + rnd() * 3, 3 + rnd() * 3, -26 - rnd() * 4],
      scale: [1.5, 2 + rnd() * 0.8, 0.8],
      rot: [0, rnd() * 3, 0],
      id: cliff,
      hatch: 0.3,
    });
  }

  // Salmon hex columns.
  for (let i = 0; i < 11; i++) {
    const cx = 8 + (i % 4) * 1.56 + (Math.floor(i / 4) % 2) * 0.78;
    const cz = -5 - Math.floor(i / 4) * 1.35;
    const h = 1.2 + rnd() * 5.2;
    b.add(geo.hex(0.9, h), {
      gradient: { bottom: P.rockDeep, top: P.rock },
      color: P.rock,
      pos: [cx, 0, cz],
    });
    b.shadow(geo.hex(0.9, h), { color: SHADE, sun, pos: [cx, 0, cz] });
    b.add(geo.hex(0.9, 0.06), { color: P.pink, pos: [cx, h, cz], flat: 0.6 });
  }

  // Teal dome with a door and a brass finial.
  const dome = b.add(geo.dome(3.6, 16, 6), { gradient: { bottom: P.tealDeep, top: P.teal }, color: P.teal, pos: [-11, 0, -7] });
  b.shadow(geo.dome(3.6, 16, 6), { color: SHADE, sun, pos: [-11, 0, -7] });
  b.add(geo.cylinder(3.75, 3.85, 0.5, 16), { color: P.bone, pos: [-11, 0, -7] });
  b.add(geo.arch({ span: 1.1, rise: 1.9, thick: 0.22, depth: 0.5 }), { color: P.bone, pos: [-9.3, 0, -3.9], rot: [0, 0.5, 0] });
  b.add(geo.plane(1.1, 1.9), { color: P.ink, flat: 1, pos: [-9.33, 0.95, -3.95], rot: [0, 0.5, 0], id: dome });
  b.add(geo.cylinder(0.06, 0.06, 1.1, 6), { color: P.brass, pos: [-11, 3.55, -7] });
  b.add(geo.sphere(0.22, 8, 6), { color: P.brass, pos: [-11, 4.75, -7] });

  // Lavender shrubs. They sway.
  const shrubs: [number, number, number][] = [
    [-5.6, 1.2, 1.0], [6.4, 3.2, 1.2], [-15.5, -3.4, 1.5], [12.5, 1.5, 1.1], [-13.8, 4.6, 0.9], [3.6, -7.5, 1.3], [-10.5, 11, 0.7],
  ];
  shrubs.forEach(([x, z, r], i) => {
    b.add(geo.cylinder(0.07 * r, 0.11 * r, 0.9 * r, 5), { color: P.violet, pos: [x, 0, z], sway: 0.25, swayBase: 0 });
    b.add(geo.blobs(3 + i, 7, r, { squash: 0.8 }), {
      gradient: { bottom: P.violet, top: P.lavender },
      color: P.lavender,
      pos: [x, 1.15 * r, z],
      rot: [0, i * 1.3, 0],
      sway: 0.55,
      swayBase: 0,
    });
    b.shadow(geo.blobs(3 + i, 7, r, { squash: 0.8 }), { color: SHADE, sun, pos: [x, 1.15 * r, z], rot: [0, i * 1.3, 0] });
  });

  // A sign with wrapped lettering on a plate.
  const signRot: [number, number, number] = [0, -0.32, 0];
  const text = 'The well is closed on Sundays. Leave your bucket and your questions by the door.';
  const m = b.measure({ text, size: 0.115, maxWidth: 1.9 });
  b.add(geo.cylinder(0.05, 0.06, 1.6, 6), { color: P.hair, pos: [4.4, 0, 5.6] });
  b.add(geo.bevelBox(m.width + 0.36, m.height + 0.36, 0.08, 0.02), { color: P.brass, pos: [4.4, 1.25, 5.6], rot: signRot });
  b.label({
    text,
    size: 0.115,
    maxWidth: 1.9,
    align: 'left',
    anchor: 'center',
    plate: P.bone,
    ink: P.ink,
    pos: [4.4 + Math.sin(signRot[1]) * 0.045, 1.25 + (m.height + 0.36) / 2, 5.6 + Math.cos(signRot[1]) * 0.045],
    rot: signRot,
    pad: 0.9,
  });
  b.shadow(geo.box(m.width + 0.36, m.height + 0.36, 0.08), { color: SHADE, sun, pos: [4.4, 1.25, 5.6], rot: signRot });
  b.shadow(geo.cylinder(0.05, 0.06, 1.6, 6), { color: SHADE, sun, pos: [4.4, 0, 5.6] });

  // A pane of glass in a frame. The pane is a screen-door, so the frame carries the line.
  const gx = 8.6;
  const gz = 8.2;
  const gr: [number, number, number] = [0, -0.7, 0];
  const frame = b.newId();
  const fx = (dx: number, dy: number, w: number, h: number) => {
    const c = Math.cos(gr[1]);
    const s = Math.sin(gr[1]);
    b.add(geo.box(w, h, 0.12), { color: P.hair, pos: [gx + dx * c, dy, gz - dx * s], rot: gr, id: frame });
  };
  fx(-1.25, 0, 0.1, 2.3);
  fx(1.25, 0, 0.1, 2.3);
  fx(0, 2.25, 2.6, 0.1);
  fx(0, 0, 2.6, 0.14);
  b.add(geo.plane(2.4, 2.15), { color: P.cyan, flat: 1, dither: 0.5, pos: [gx, 1.2, gz], rot: gr });
  b.add(geo.sphere(0.45, 10, 7), { color: P.yellow, pos: [gx + 1.1, 0.45, gz - 1.6] });
  b.add(geo.cone(0.5, 1.3, 8), { color: P.orange, pos: [gx + 2.2, 0, gz - 0.9] });

  // Someone looking at the arch.
  const who: [number, number, number] = [1.9, 0, 6.4];
  b.add(geo.capsule(0.23, 0.95, 8, 3), { color: P.orange, pos: [who[0], 0.62, who[2]] });
  b.add(geo.cylinder(0.09, 0.1, 0.7, 6), { color: P.tealDeep, pos: [who[0] - 0.11, 0, who[2]] });
  b.add(geo.cylinder(0.09, 0.1, 0.7, 6), { color: P.tealDeep, pos: [who[0] + 0.11, 0, who[2]] });
  b.add(geo.sphere(0.17, 10, 7), { color: P.skin, pos: [who[0], 1.72, who[2]] });
  b.add(geo.blobs(5, 9, 0.3, { squash: 0.85 }), { color: P.hair, pos: [who[0], 1.86, who[2] - 0.03], flat: 0.3 });
  b.shadow(geo.capsule(0.25, 1.6, 8, 3), { color: SHADE, sun, pos: [who[0], 0, who[2]] });
  b.shadow(geo.blobs(5, 9, 0.3, { squash: 0.85 }), { color: SHADE, sun, pos: [who[0], 1.86, who[2] - 0.03] });

  // Far mesas, to judge haze and the far line.
  for (let i = 0; i < 12; i++) {
    const a = -2.6 + i * 0.42 + rnd() * 0.2;
    const d = 130 + rnd() * 420;
    const s = 12 + rnd() * 26;
    b.add(geo.rock(40 + i, s, 1, 0.25), {
      gradient: { bottom: P.rockDeep, top: P.rock },
      color: P.rock,
      pos: [Math.sin(a) * d, s * 0.5, -Math.cos(a) * d],
      scale: [1.5, 1.1 + rnd(), 1.2],
    });
  }

  const world = b.build('diorama');
  scene.add(world);

  // A hundred stools, one draw call. The shape is built once with the builder, then instanced.
  const sb = kit.builder();
  const seat = sb.add(geo.cylinder(0.2, 0.18, 0.06, 9), { color: 0xffffff, pos: [0, 0.44, 0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 6.283;
    sb.add(geo.cylinder(0.02, 0.028, 0.46, 5), {
      color: 0x8a8296,
      pos: [Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13],
      rot: [Math.sin(a) * 0.14, 0, -Math.cos(a) * 0.14],
      id: seat,
    });
  }
  const stoolGeo = sb.geometry!();
  const stools = kit.instances(stoolGeo, 100);
  stools.name = 'stools';
  const mtx = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  const tints = [P.red, P.yellow, P.teal, P.pink, P.orange, P.mint, P.lavender, P.cyan];
  let n = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 20; i++) {
      const a = -1.32 + (i / 19) * 1.1;
      const r = 7 + row * 0.95;
      pos.set(Math.sin(a) * r, 0, 2 + Math.cos(a) * r);
      quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6.283);
      const s = 0.9 + rnd() * 0.25;
      scl.set(s, s, s);
      mtx.compose(pos, quat, scl);
      stools.setMatrixAt(n, mtx);
      stools.setColorAt(n, col.set(tints[(i + row * 3) % tints.length]));
      n++;
    }
  }
  stools.instanceMatrix.needsUpdate = true;
  if (stools.instanceColor) stools.instanceColor.needsUpdate = true;
  stools.computeBoundingSphere();
  scene.add(stools);
}

// Views: position, then what to look at.
const views: [THREE.Vector3, THREE.Vector3][] = [
  [new THREE.Vector3(7.5, 3.4, 19), new THREE.Vector3(-0.8, 2.6, 0)],
  [new THREE.Vector3(1.2, 2.2, 3.9), new THREE.Vector3(0.6, 4.6, 0.7)],
  [new THREE.Vector3(3, 2.6, 33), new THREE.Vector3(0, 3.6, 0)],
  [new THREE.Vector3(5.0, 1.75, 9.4), new THREE.Vector3(3.6, 1.35, 5.8)],
];
const cam = Math.max(0, Math.min(views.length - 1, Number(q.get('cam') ?? 0) | 0));
const target = views[cam][1].clone();
camera.position.copy(views[cam][0]);
camera.lookAt(target);

// Look around: drag orbits the target, wheel moves in and out.
const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
let dragging = false;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => (dragging = false));
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.theta -= e.movementX * 0.005;
  orbit.phi = Math.max(0.15, Math.min(1.56, orbit.phi - e.movementY * 0.005));
  camera.position.setFromSpherical(orbit).add(target);
  camera.lookAt(target);
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    orbit.radius = Math.max(1, Math.min(400, orbit.radius * Math.exp(e.deltaY * 0.001)));
    camera.position.setFromSpherical(orbit).add(target);
    camera.lookAt(target);
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

declare global {
  interface Window {
    __kit?: { stats(): { calls: number; triangles: number }; ink: typeof ink; ready: boolean; frames: number };
  }
}
const hook = { stats: () => ink.stats(), ink, ready: false, frames: 0 };
window.__kit = hook;

const fixedTime = q.has('t') ? Number(q.get('t')) : null;
function frame(ms: number): void {
  ink.setSky(sky);
  ink.render(scene, camera, fixedTime ?? ms / 1000);
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
