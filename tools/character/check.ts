// Checks on the figure that need no browser: cost per tier, time per update, reset gives the same
// picture, no NaN, nothing jumps when the pace changes, hair stays clear of the head.
//   npx rolldown ./tools/character/check.ts --file /tmp/figure-check.mjs --platform node && node /tmp/figure-check.mjs
//   SLOPE=0 for flat ground only (default drives him over slopes of up to 0.3).
import * as THREE from 'three';
import { createKit } from '../../src/engine/kit';
import { createCharacter, characterCost } from '../../src/engine/character';

const lettering = { ready: Promise.resolve(), capHeight: () => 1, glyph: () => ({ adv: 0, empty: true }) } as never;
const kit = createKit(new THREE.ShaderMaterial(), lettering);

for (const tier of ['high', 'medium', 'low'] as const) {
  const c = createCharacter(kit, { tier });
  const cost = characterCost(c);
  let verts = 0;
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) verts += m.geometry.getAttribute('position').count;
  });
  console.log(tier, 'meshes', cost.meshes, 'triangles', cost.triangles, 'vertices', verts, 'height', c.height.toFixed(3));
}

const c = createCharacter(kit, { tier: 'high' });
// Time.
{
  for (let i = 0; i < 2000; i++) c.update(1 / 60, i / 60, 6, 0.2, true);
  const N = 20000;
  const a = performance.now();
  for (let i = 0; i < N; i++) c.update(1 / 60, 40 + i / 60, i % 1200 < 500 ? 6 : i % 1200 < 900 ? 11.5 : 0, Math.sin(i * 0.01), true);
  console.log('update ms', ((performance.now() - a) / N).toFixed(4));
}

// Same picture twice after reset.
function snapshot(): number {
  let h = 0;
  c.group.updateMatrixWorld(true);
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const e = m.matrixWorld.elements;
    for (let i = 0; i < 16; i++) h = (h * 31 + Math.round(e[i] * 1e6)) | 0;
    const p = m.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < p.length; i += 7) h = (h * 31 + Math.round(p[i] * 1e6)) | 0;
  });
  return h;
}
c.reset();
c.update(0, 0, 0, 0, true);
const s1 = snapshot();
for (let i = 0; i < 500; i++) c.update(1 / 60, i / 60, 11.5, 1, i % 50 < 40);
c.reset();
c.update(0, 0, 0, 0, true);
const s2 = snapshot();
console.log('reset gives the same picture:', s1 === s2);

// A long drive: speed wandering through every threshold, turning, the odd hop. Look for NaN and for jumps.
const names = ['figure-hips', 'figure-chest', 'figure-head', 'figure-tail', 'figure-arm', 'figure-leg', 'figure-foot', 'figure-bag'];
const meshes: THREE.Mesh[] = [];
c.group.traverse((o) => {
  if ((o as THREE.Mesh).isMesh && names.includes(o.name)) meshes.push(o as THREE.Mesh);
});
const tail = meshes.find((m) => m.name === 'figure-tail')!;
const head = meshes.find((m) => m.name === 'figure-head')!;
const prev = meshes.map(() => new THREE.Vector3());
const prevV = meshes.map(() => new THREE.Vector3());
const now = new THREE.Vector3();
const worst = meshes.map(() => 0);
let nan = 0;
const SLOPE = Number(process.env.SLOPE ?? 0.3);
let minEgg = 9;
let minTipY = 9;
let maxVertStep = 0;
let where = '';
const lastPos = new Map<THREE.Mesh, Float32Array>();
c.reset();
let speed = 0;
for (let i = 0; i < 60 * 240; i++) {
  const t = i / 60;
  // Speed ramps and holds, like a visitor on and off the stick and the shift key.
  const want = [0, 6, 11.5, 6, 0, 11.5, 2, 6, 3.5, 0][Math.floor(t / 4) % 10];
  const rate = want > speed ? 30 : 38;
  speed += Math.sign(want - speed) * Math.min(Math.abs(want - speed), rate / 60);
  const turn = Math.sin(t * 0.7) * 2.2 * (Math.floor(t / 7) % 2);
  const grounded = !(Math.floor(t / 13) % 2 === 1 && t % 13 < 0.4);
  c.setSlope(Math.sin(t * 0.1) * SLOPE, Math.cos(t * 0.13) * SLOPE);
  c.group.rotation.y += turn / 60;
  c.update(1 / 60, t, speed, turn, grounded);
  c.group.updateMatrixWorld(true);
  for (let k = 0; k < meshes.length; k++) {
    const m = meshes[k];
    // Position in his own frame, so walking on the spot is what is measured.
    now.setFromMatrixPosition(m.matrixWorld);
    c.group.worldToLocal(now);
    if (!Number.isFinite(now.x + now.y + now.z)) nan++;
    if (i > 1) {
      const vx = now.x - prev[k].x, vy = now.y - prev[k].y, vz = now.z - prev[k].z;
      const jerk = Math.hypot(vx - prevV[k].x, vy - prevV[k].y, vz - prevV[k].z);
      if (jerk > worst[k]) worst[k] = jerk;
      prevV[k].set(vx, vy, vz);
    }
    prev[k].copy(now);
    const p = m.geometry.getAttribute('position').array as Float32Array;
    let last = lastPos.get(m);
    if (!last) {
      last = new Float32Array(p);
      lastPos.set(m, last);
    }
    for (let j = 0; j < p.length; j += 3) {
      if (!Number.isFinite(p[j] + p[j + 1] + p[j + 2])) nan++;
      const d = Math.hypot(p[j] - last[j], p[j + 1] - last[j + 1], p[j + 2] - last[j + 2]);
      if (d > maxVertStep) { maxVertStep = d; where = `${m.name} t=${t.toFixed(3)} speed=${speed.toFixed(2)} want=${want} grounded=${grounded}`; }
    }
    last.set(p);
  }
  // Hair against the head: every vertex of the bunch, in head space.
  const tp = tail.geometry.getAttribute('position').array as Float32Array;
  for (let j = 0; j < tp.length; j += 3) {
    const x = tp[j] + tail.position.x, y = tp[j + 1] + tail.position.y, z = tp[j + 2] + tail.position.z;
    const f = Math.hypot(x / 0.088, (y - 0.112) / 0.108, z / 0.106);
    if (f < minEgg) minEgg = f;
    if (y < minTipY) minTipY = y;
  }
}
void head;
console.log('NaN count', nan);
console.log('worst change of velocity in one frame, metres (his own frame):');
meshes.forEach((m, k) => console.log('  ', m.name, worst[k].toFixed(4)));
console.log('largest move of a single vertex inside its own mesh in one frame', maxVertStep.toFixed(4), where);
console.log('hair: closest to the skull (1 is touching the egg)', minEgg.toFixed(3), ' lowest point above the head pivot', minTipY.toFixed(3));
