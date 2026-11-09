// The visitor's figure. A teenager with a big afro, an oversized orange jacket, cargo trousers and
// chunky trainers. Rigid segments on joints, each segment one kit mesh, animated by hand written maths.
// He faces -z in his own space (yaw 0 looks north), so the back of the jacket is +z.
import * as THREE from 'three';
import type { InkKit } from '../types';
import * as geo from './geo';
import { clamp, damp, lerp, smoothstep } from './util';
import { palette as P } from '../world/palette';

export interface Character {
  group: THREE.Group;
  /** speed in m/s over the ground, turnRate in rad/s (positive is a left turn, yaw going up). */
  update(dt: number, t: number, speed: number, turnRate: number, grounded: boolean): void;
  /** Top of the hair above the soles, metres. */
  height: number;
  /** Ground slope under him in world space (rise per metre east, rise per metre south). Tilts the
   *  contact shadow and plants the feet on the hill. Optional: flat ground if never called. */
  setSlope(dhdx: number, dhdz: number): void;
  /** Put the animation in a known state, for stills. */
  reset(): void;
}

// ---------------------------------------------------------------------------------------------
// Colours that are his alone
// ---------------------------------------------------------------------------------------------

const mix = (a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, k: number): string =>
  '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

const INDIGO = '#34316e';
const INDIGO_LIGHT = '#454189';
const INDIGO_DARK = '#27244f';
const SHEEN = mix(P.hair, P.violet, 0.4);
const JACKET_DEEP = mix(P.orange, P.red, 0.45);
const GROUND_SHADE = mix(P.sand, P.shadow, 0.42);

// ---------------------------------------------------------------------------------------------
// Skeleton, metres
// ---------------------------------------------------------------------------------------------

const HIP_W = 0.095; // half the distance between the hip joints
const HIP_DROP = 0.02; // hip joints sit this far under the pelvis pivot
const THIGH = 0.455;
const SHIN = 0.445;
const ANKLE = 0.11; // ankle joint above the sole
const BALL = 0.15; // ball of the foot ahead of the ankle
const HEEL = 0.085; // heel behind the ankle
const REACH = THIGH + SHIN - 0.006;
const SPINE_UP = 0.07; // spine pivot above the pelvis pivot
const NECK_UP = 0.445; // head pivot above the spine pivot
const SHOULDER_X = 0.232;
const SHOULDER_Y = 0.365;
const UPPER_ARM = 0.285;
const STAND = 1.025; // pelvis pivot height standing still

// ---------------------------------------------------------------------------------------------
// Lofted tube: rings of ellipses stacked along y. This is most of his body.
// Angle 0 is the back (+z), a quarter turn is his right (+x), a half turn is the front (-z).
// ---------------------------------------------------------------------------------------------

interface Ring {
  y: number;
  rx: number;
  rz: number;
  x?: number;
  z?: number;
}

function loft(rings: readonly Ring[], seg: number, o: { from?: number; to?: number; top?: boolean; bottom?: boolean } = {}): THREE.BufferGeometry {
  const from = o.from ?? 0;
  const to = o.to ?? Math.PI * 2;
  const closed = o.from === undefined && o.to === undefined;
  const cols = closed ? seg : seg + 1;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of rings) {
    for (let i = 0; i < cols; i++) {
      const a = from + ((to - from) * i) / seg;
      pos.push((r.x ?? 0) + Math.sin(a) * r.rx, r.y, (r.z ?? 0) + Math.cos(a) * r.rz);
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const i1 = closed ? (i + 1) % seg : i + 1;
      const a = j * cols + i;
      const b = j * cols + i1;
      const c = (j + 1) * cols + i;
      const d = (j + 1) * cols + i1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (r: Ring, up: boolean): void => {
    const base = pos.length / 3;
    pos.push(r.x ?? 0, r.y, r.z ?? 0);
    for (let i = 0; i < seg; i++) {
      const a = (Math.PI * 2 * i) / seg;
      pos.push((r.x ?? 0) + Math.sin(a) * r.rx, r.y, (r.z ?? 0) + Math.cos(a) * r.rz);
    }
    for (let i = 0; i < seg; i++) {
      const p = base + 1 + i;
      const q = base + 1 + ((i + 1) % seg);
      if (up) idx.push(base, p, q);
      else idx.push(base, q, p);
    }
  };
  if (closed && o.top) cap(rings[rings.length - 1], true);
  if (closed && o.bottom) cap(rings[0], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Segments. Each returns one mesh, built round its own joint.
// ---------------------------------------------------------------------------------------------

function buildPelvis(kit: InkKit): THREE.Mesh {
  const b = kit.builder();
  const id = b.newId();
  // Seat of the trousers. The jacket hem hangs over the top of it.
  b.add(
    loft(
      [
        { y: -0.17, rx: 0.1, rz: 0.085 },
        { y: -0.1, rx: 0.19, rz: 0.125 },
        { y: 0.0, rx: 0.2, rz: 0.135 },
        { y: 0.09, rx: 0.185, rz: 0.125 },
      ],
      12,
      { top: true, bottom: true },
    ),
    { color: INDIGO, id },
  );
  // Belt, with a strap end hanging off his left hip.
  b.add(loft([{ y: 0.035, rx: 0.2, rz: 0.137 }, { y: 0.075, rx: 0.195, rz: 0.133 }], 12), { color: P.tealDeep, flat: 0.4 });
  b.add(geo.box(0.035, 0.2, 0.02), { color: P.teal, pos: [-0.17, -0.19, 0.06], rot: [0.1, 0, -0.12], flat: 0.5 });
  return b.build('figure-pelvis');
}

function buildTorso(kit: InkKit): THREE.Mesh {
  const b = kit.builder();
  const jacket = b.newId();
  // Oversized jacket: wide in the shoulder, boxy, dropping past the belt.
  b.add(
    loft(
      [
        { y: -0.15, rx: 0.214, rz: 0.152, z: 0.006 },
        { y: -0.02, rx: 0.23, rz: 0.163, z: 0.006 },
        { y: 0.16, rx: 0.25, rz: 0.17, z: 0.008 },
        { y: 0.315, rx: 0.262, rz: 0.158, z: 0.012 },
        { y: 0.39, rx: 0.225, rz: 0.13, z: 0.012 },
        { y: 0.43, rx: 0.12, rz: 0.1, z: 0.01 },
      ],
      14,
      { top: true, bottom: true },
    ),
    { color: P.orange, id: jacket },
  );
  // Ribbed hem.
  b.add(
    loft(
      [
        { y: -0.215, rx: 0.2, rz: 0.144, z: 0.006 },
        { y: -0.2, rx: 0.222, rz: 0.16, z: 0.006 },
        { y: -0.15, rx: 0.224, rz: 0.162, z: 0.006 },
        { y: -0.135, rx: 0.214, rz: 0.152, z: 0.006 },
      ],
      14,
      { bottom: true },
    ),
    { color: INDIGO_DARK, flat: 0.3 },
  );
  // Tall collar, higher at the back, open at the throat.
  const collar = [
    { y: 0.375, rx: 0.128, rz: 0.11, z: 0.012 },
    { y: 0.465, rx: 0.15, rz: 0.124, z: 0.02 },
    { y: 0.54, rx: 0.17, rz: 0.14, z: 0.034 },
  ];
  b.add(loft(collar, 12, { from: -2.5, to: 2.5 }), { color: P.orange, rot: [0.1, 0, 0] });
  b.add(
    loft(collar.map((r) => ({ ...r, rx: r.rx - 0.012, rz: r.rz - 0.012 })), 12, { from: -2.5, to: 2.5 }),
    { color: JACKET_DEEP, rot: [0.1, 0, 0], flat: 0.5, outline: false },
  );
  b.add(
    loft([{ y: 0.512, rx: 0.165, rz: 0.137, z: 0.031 }, { y: 0.544, rx: 0.175, rz: 0.144, z: 0.035 }], 12, { from: -2.5, to: 2.5 }),
    { color: P.paper, rot: [0.1, 0, 0], flat: 0.5, outline: false },
  );
  // Neck.
  b.add(geo.cylinder(0.048, 0.055, 0.16, 8), { color: P.skin, pos: [0, 0.37, 0.004] });
  // The back: a paper panel across the shoulder blades with one hard teal bar, a thin stripe under it.
  const back = (y0: number, y1: number, half: number, lift: number): THREE.BufferGeometry => {
    const at = (y: number): Ring => {
      // Follow the jacket so the panel lies on it.
      const k = clamp((y - 0.16) / 0.155, 0, 1);
      return { y, rx: lerp(0.25, 0.262, k) + lift, rz: lerp(0.17, 0.158, k) + lift, z: lerp(0.008, 0.012, k) };
    };
    return loft([at(y0), at((y0 + y1) / 2), at(y1)], 8, { from: -half, to: half });
  };
  b.add(back(0.185, 0.318, 0.98, 0.007), { color: P.paper, flat: 0.25 });
  b.add(back(0.226, 0.28, 0.42, 0.012), { color: P.teal, flat: 0.5, outline: false });
  b.add(back(0.105, 0.14, 0.98, 0.007), { color: P.paper, flat: 0.25 });
  // Yellow tag on the hem, his right side.
  b.add(geo.box(0.05, 0.075, 0.016), { color: P.yellow, pos: [0.115, -0.1, 0.146], rot: [0, 0.3, 0], flat: 0.7 });
  // Zip and a pull.
  b.add(geo.box(0.014, 0.52, 0.012), { color: INDIGO_DARK, pos: [0, -0.14, -0.163], outline: false, flat: 1 });
  b.add(geo.box(0.03, 0.045, 0.016), { color: P.paper, pos: [0, 0.3, -0.158], flat: 0.6 });
  // Chest pocket flap.
  b.add(geo.box(0.085, 0.05, 0.014), { color: JACKET_DEEP, pos: [-0.115, 0.2, -0.158], rot: [0, 0.32, 0], flat: 0.3 });
  // Sling bag: strap from his right shoulder to his left hip, pouch riding low on the back.
  b.add(geo.torus(1, 0.085, 16, 4), { color: P.tealDeep, scale: [0.3, 0.22, 0.184], pos: [0, 0.14, 0.008], rot: [0, 0, 0.84], flat: 0.35 });
  const bag = b.newId();
  b.add(geo.bevelBox(0.23, 0.125, 0.085, 0.03), { color: P.teal, pos: [-0.05, -0.008, 0.166], rot: [0, 0, 0.7], id: bag });
  b.add(geo.box(0.1, 0.042, 0.02), { color: P.mint, pos: [-0.095, 0.0455, 0.21], rot: [0, 0, 0.7], flat: 0.5 });
  b.add(geo.box(0.036, 0.036, 0.02), { color: P.yellow, pos: [0.03, 0.155, 0.2], rot: [0, 0, 0.84], flat: 0.8 });
  return b.build('figure-torso');
}

function buildHead(kit: InkKit): THREE.Mesh {
  const b = kit.builder();
  const skin = b.newId();
  // Skull, jaw, ears. One outline.
  b.add(geo.sphere(0.115, 14, 9), { color: P.skin, id: skin, pos: [0, 0.125, 0], scale: [0.94, 1.1, 1] });
  b.add(geo.sphere(0.08, 10, 6), { color: P.skin, id: skin, pos: [0, 0.062, -0.026], scale: [0.98, 0.9, 1.02] });
  b.add(geo.ico(0.03, 1), { color: P.skin, id: skin, pos: [-0.106, 0.118, 0.008], scale: [0.5, 1, 0.75] });
  b.add(geo.ico(0.03, 1), { color: P.skin, id: skin, pos: [0.106, 0.118, 0.008], scale: [0.5, 1, 0.75] });
  // Face, drawn simply: almond eyes, heavy brows, a small nose, a half smile.
  for (const s of [-1, 1]) {
    b.add(geo.sphere(0.024, 8, 5), { color: P.paper, pos: [s * 0.044, 0.132, -0.096], scale: [1.3, 0.86, 0.5], rot: [0, s * -0.3, s * 0.1], flat: 0.85 });
    b.add(geo.ico(0.0125, 0), { color: P.ink, pos: [s * 0.041, 0.131, -0.1075], scale: [1, 1.1, 0.5], flat: 1, outline: false });
    b.add(geo.box(0.056, 0.014, 0.012), { color: P.hair, pos: [s * 0.046, 0.166, -0.103], rot: [0, s * -0.35, s * 0.16], flat: 1, outline: false });
  }
  b.add(geo.ico(0.02, 1), { color: mix(P.skin, P.ink, 0.12), pos: [0, 0.1, -0.116], scale: [0.8, 1.05, 0.9] });
  b.add(geo.box(0.04, 0.009, 0.01), { color: P.ink, pos: [-0.006, 0.06, -0.103], rot: [0, 0, 0.05], flat: 1, outline: false });
  b.add(geo.box(0.022, 0.009, 0.01), { color: P.ink, pos: [0.022, 0.065, -0.099], rot: [0, -0.3, 0.55], flat: 1, outline: false });
  // Goggles pushed up to the hairline: strap, frame, one wide teal lens with a glint.
  const band = (rx: number, rz: number, hy: number, half: number): THREE.BufferGeometry =>
    loft([{ y: -hy, rx, rz }, { y: hy, rx: rx * 0.97, rz: rz * 0.97 }], 10, { from: Math.PI - half, to: Math.PI + half });
  const at: [number, number, number] = [0, 0.218, 0];
  const tilt: [number, number, number] = [0.25, 0, 0];
  b.add(band(0.126, 0.132, 0.014, 2.4), { color: INDIGO_DARK, pos: at, rot: tilt, flat: 0.5 });
  b.add(band(0.13, 0.142, 0.04, 1.02), { color: INDIGO_DARK, pos: at, rot: tilt, flat: 0.5 });
  b.add(band(0.132, 0.146, 0.028, 0.86), { color: P.teal, pos: at, rot: tilt, flat: 0.75, outline: false });
  b.add(band(0.133, 0.148, 0.007, 0.2), { color: P.cyan, pos: [0, 0.23, 0], rot: [0.25, -0.42, 0], flat: 1, outline: false });
  return b.build('figure-head');
}

function buildHair(kit: InkKit): THREE.Mesh {
  const b = kit.builder();
  const id = b.newId();
  const rnd = geo.seeded(41);
  const puff = (x: number, y: number, z: number, r: number, detail = 1): void => {
    b.add(geo.ico(r, detail), { color: P.hair, id, pos: [x, y, z], scale: [1, 0.94 + rnd() * 0.1, 1] });
  };
  // A catch of violet light on the upper side of a curl. Same outline as the hair, so it is a tone not a shape.
  const shine = (x: number, y: number, z: number, r: number): void => {
    const dz = z - 0.03;
    const d = Math.hypot(x, dz) || 1;
    const out = 0.3 * r;
    b.add(geo.ico(r * 0.8, 1), { color: SHEEN, id, pos: [x + (x / d) * out * 0.6, y + out * 0.8, z + (dz / d) * out * 0.6], flat: 0.4 });
  };
  // Core, then three rings of curls and a crown. Angles from the back, so 0 is what the camera sees.
  puff(0, 0.1, 0.03, 0.17, 2);
  const ring = (n: number, y: number, rad: number, r: number, start: number, lit: boolean, skipFront: number): void => {
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2;
      const front = Math.cos(a) < -skipFront;
      if (front) continue;
      const rr = r * (0.9 + rnd() * 0.2);
      const x = Math.sin(a) * rad * (0.94 + rnd() * 0.12);
      const z = Math.cos(a) * rad * (0.94 + rnd() * 0.12) + 0.03;
      const yy = y + (rnd() - 0.5) * 0.03;
      puff(x, yy, z, rr);
      if (lit) shine(x, yy, z, rr);
    }
  };
  ring(7, -0.035, 0.118, 0.082, 0, false, 0.3); // nape and behind the ears
  ring(9, 0.07, 0.16, 0.094, 0.35, false, 0.45); // the widest row
  ring(8, 0.2, 0.132, 0.09, 0.1, true, 2); // upper row, carries the sheen
  puff(0, 0.275, 0.03, 0.088);
  return b.build('figure-hair');
}

function buildUpperArm(kit: InkKit, side: number): THREE.Mesh {
  const b = kit.builder();
  const id = b.newId();
  // Dropped shoulder and a wide sleeve.
  b.add(
    loft(
      [
        { y: -0.3, rx: 0.068, rz: 0.074 },
        { y: -0.2, rx: 0.078, rz: 0.084 },
        { y: -0.06, rx: 0.084, rz: 0.09 },
        { y: 0.02, rx: 0.08, rz: 0.086, x: -side * 0.012 },
        { y: 0.068, rx: 0.05, rz: 0.058, x: -side * 0.03 },
      ],
      10,
      { top: true, bottom: true },
    ),
    { color: P.orange, id },
  );
  // Paper band round the sleeve.
  b.add(loft([{ y: -0.165, rx: 0.086, rz: 0.092 }, { y: -0.115, rx: 0.089, rz: 0.095 }], 10), { color: P.paper, flat: 0.25 });
  return b.build('figure-upper-arm');
}

function buildForearm(kit: InkKit, side: number): THREE.Mesh {
  const b = kit.builder();
  b.add(
    loft(
      [
        { y: -0.215, rx: 0.062, rz: 0.066 },
        { y: -0.12, rx: 0.072, rz: 0.078 },
        { y: 0.0, rx: 0.07, rz: 0.076 },
        { y: 0.04, rx: 0.05, rz: 0.055 },
      ],
      10,
      { top: true },
    ),
    { color: P.orange },
  );
  // Chunky cuff.
  b.add(
    loft(
      [
        { y: -0.275, rx: 0.056, rz: 0.06 },
        { y: -0.262, rx: 0.07, rz: 0.074 },
        { y: -0.215, rx: 0.072, rz: 0.076 },
        { y: -0.2, rx: 0.064, rz: 0.068 },
      ],
      10,
      { bottom: true },
    ),
    { color: INDIGO_DARK, flat: 0.3 },
  );
  // Hand, a mitt with a thumb.
  const hand = b.newId();
  b.add(geo.ico(0.056, 1), { color: P.skin, id: hand, pos: [0, -0.328, -0.004], scale: [0.72, 1.12, 0.98] });
  b.add(geo.ico(0.022, 0), { color: P.skin, id: hand, pos: [-side * 0.012, -0.315, -0.046] });
  return b.build('figure-forearm');
}

function buildThigh(kit: InkKit, side: number): THREE.Mesh {
  const b = kit.builder();
  const id = b.newId();
  b.add(
    loft(
      [
        { y: -0.475, rx: 0.07, rz: 0.076 },
        { y: -0.42, rx: 0.09, rz: 0.098 },
        { y: -0.22, rx: 0.106, rz: 0.114 },
        { y: -0.02, rx: 0.112, rz: 0.118 },
        { y: 0.06, rx: 0.085, rz: 0.095 },
      ],
      10,
      { top: true, bottom: true },
    ),
    { color: INDIGO, id },
  );
  // Cargo pocket on the outside with a paler flap, and a strap round the leg under it.
  b.add(geo.bevelBox(0.05, 0.16, 0.13, 0.014), { color: INDIGO_LIGHT, pos: [side * 0.097, -0.33, 0.0], rot: [0, 0, side * 0.045] });
  b.add(geo.box(0.056, 0.05, 0.138), { color: P.lavender, pos: [side * 0.1, -0.2, 0.0], rot: [0, 0, side * 0.045], flat: 0.35 });
  b.add(loft([{ y: -0.4, rx: 0.098, rz: 0.106 }, { y: -0.37, rx: 0.102, rz: 0.11 }], 10), { color: P.teal, flat: 0.5 });
  return b.build('figure-thigh');
}

function buildShin(kit: InkKit): THREE.Mesh {
  const b = kit.builder();
  const id = b.newId();
  // Baggy to the ankle, then gathered.
  b.add(
    loft(
      [
        { y: -0.35, rx: 0.082, rz: 0.09, z: 0.004 },
        { y: -0.28, rx: 0.096, rz: 0.104, z: 0.004 },
        { y: -0.12, rx: 0.094, rz: 0.102 },
        { y: 0.0, rx: 0.09, rz: 0.098 },
        { y: 0.07, rx: 0.07, rz: 0.076 },
      ],
      10,
      { top: true },
    ),
    { color: INDIGO, id },
  );
  b.add(
    loft(
      [
        { y: -0.4, rx: 0.058, rz: 0.064 },
        { y: -0.385, rx: 0.076, rz: 0.084, z: 0.004 },
        { y: -0.35, rx: 0.082, rz: 0.09, z: 0.004 },
      ],
      10,
      { bottom: true },
    ),
    { color: INDIGO_DARK, flat: 0.3 },
  );
  // Knee patch.
  b.add(geo.box(0.11, 0.07, 0.02), { color: INDIGO_LIGHT, pos: [0, -0.07, -0.094], outline: false });
  return b.build('figure-shin');
}

function buildFoot(kit: InkKit, side: number): THREE.Mesh {
  const b = kit.builder();
  // Origin is the ankle. Toe is at -z. Thick teal sole, fat white upper.
  b.add(
    loft(
      [
        { y: -ANKLE, rx: 0.084, rz: 0.172, z: -0.04 },
        { y: -ANKLE + 0.014, rx: 0.094, rz: 0.182, z: -0.04 },
        { y: -ANKLE + 0.068, rx: 0.094, rz: 0.182, z: -0.04 },
      ],
      12,
      { top: true, bottom: true },
    ),
    { color: P.teal, flat: 0.3 },
  );
  const upper = b.newId();
  b.add(
    loft(
      [
        { y: -ANKLE + 0.068, rx: 0.088, rz: 0.174, z: -0.04 },
        { y: -ANKLE + 0.125, rx: 0.085, rz: 0.158, z: -0.032 },
        { y: -ANKLE + 0.17, rx: 0.075, rz: 0.108, z: 0.0 },
        { y: -ANKLE + 0.215, rx: 0.066, rz: 0.078, z: 0.014 },
      ],
      12,
      { top: true },
    ),
    { color: P.stone, id: upper },
  );
  // A strap over the toes, an orange pull on the heel, a teal flash on the outside.
  b.add(geo.box(0.146, 0.036, 0.02), { color: P.lavender, pos: [0, -ANKLE + 0.128, -0.095], rot: [-0.5, 0, 0], flat: 0.4, outline: false });
  b.add(geo.box(0.032, 0.075, 0.02), { color: P.orange, pos: [0, -ANKLE + 0.16, 0.108], rot: [0.2, 0, 0], flat: 0.6 });
  b.add(geo.box(0.02, 0.032, 0.1), { color: P.teal, pos: [side * 0.084, -ANKLE + 0.105, -0.02], flat: 0.6, outline: false });
  return b.build('figure-foot');
}

function buildShadow(kit: InkKit): THREE.Mesh {
  const b = kit.builder();
  // A solid heart and a screen-door rim, so the edge reads soft. Hatched like every other shadow.
  b.add(geo.disc(0.3, 18), { color: GROUND_SHADE, flat: 1, hatch: 0.6, outline: false });
  b.add(geo.ring(0.3, 0.43, 18), { color: GROUND_SHADE, flat: 1, hatch: 0.6, outline: false, dither: 0.5 });
  const m = b.build('figure-shadow');
  m.renderOrder = -1;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Assembly and animation
// ---------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const HAIR_Y = 0.155;

export function createCharacter(kit: InkKit): Character {
  const group = new THREE.Group();
  group.name = 'figure';

  const shadow = buildShadow(kit);
  shadow.position.y = 0.035;
  group.add(shadow);

  // Everything that leans in a turn hangs off `body`, which pivots at the ground.
  const body = new THREE.Group();
  group.add(body);

  const pelvis = buildPelvis(kit);
  body.add(pelvis);
  const torso = buildTorso(kit);
  torso.position.set(0, SPINE_UP, 0);
  pelvis.add(torso);
  const head = buildHead(kit);
  head.position.set(0, NECK_UP, 0);
  torso.add(head);
  const hair = buildHair(kit);
  hair.position.set(0, HAIR_Y, 0.012);
  head.add(hair);

  // Index 0 is his left (-x), 1 is his right.
  const upperArm: THREE.Mesh[] = [];
  const forearm: THREE.Mesh[] = [];
  const thigh: THREE.Mesh[] = [];
  const shin: THREE.Mesh[] = [];
  const foot: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const ua = buildUpperArm(kit, side);
    ua.position.set(side * SHOULDER_X, SHOULDER_Y, 0.01);
    torso.add(ua);
    const fa = buildForearm(kit, side);
    fa.position.set(0, -UPPER_ARM, 0);
    ua.add(fa);
    upperArm.push(ua);
    forearm.push(fa);

    // Legs hang off the body, not the pelvis: the hip joints are placed by hand each frame so the
    // feet can be solved in one flat space.
    const th = buildThigh(kit, side);
    th.rotation.order = 'ZXY';
    body.add(th);
    const sh = buildShin(kit);
    sh.position.set(0, -THIGH, 0);
    th.add(sh);
    const ft = buildFoot(kit, side);
    ft.position.set(0, -SHIN, 0);
    sh.add(ft);
    thigh.push(th);
    shin.push(sh);
    foot.push(ft);
  }

  // State. Plain numbers, nothing allocated after this point.
  let phase = 0; // one unit is two steps
  let move = 0; // 0 standing, 1 in stride
  let air = 0;
  let accel = 0;
  let prevSpeed = 0;
  let roll = 0;
  let lagY = STAND;
  let slopeX = 0;
  let slopeZ = 0;
  const footZ = [0, 0]; // where each planted foot is, fore and aft, in his space
  const liftZ = [0, 0]; // where it left the ground
  const planted = [true, false];

  function reset(): void {
    phase = 0;
    move = 0;
    air = 0;
    accel = 0;
    prevSpeed = 0;
    roll = 0;
    lagY = STAND;
    footZ[0] = footZ[1] = 0;
    liftZ[0] = liftZ[1] = 0;
    planted[0] = true;
    planted[1] = false;
  }

  function setSlope(dhdx: number, dhdz: number): void {
    slopeX = dhdx;
    slopeZ = dhdz;
  }

  function update(dt: number, t: number, speed: number, turnRate: number, grounded: boolean): void {
    const h = clamp(dt, 0, 0.05);
    const v = Math.max(0, speed);

    if (h > 0) accel = damp(accel, clamp((v - prevSpeed) / h, -40, 40), 9, h);
    prevSpeed = v;
    move = damp(move, smoothstep(0.15, 1.4, v), 12, h);
    air = damp(air, grounded ? 0 : 1, 10, h);
    roll = damp(roll, clamp(turnRate * (0.035 + v * 0.011), -0.26, 0.26), 7, h);

    // The gait for this speed. Three keys: a stroll (1.5 m/s), the walk (6), the run (11.5).
    // A planted foot travels back at exactly ground speed, so stride length falls out of period and
    // duty: stride = v * period * duty. At 6 m/s nobody strolls, so the walk is a light loping jog.
    const k0 = clamp(v / 1.5, 0, 1);
    const kw = clamp((v - 1.5) / 4.5, 0, 1);
    const kr = clamp((v - 6) / 5.5, 0, 1);
    const period = lerp(lerp(0.95, 0.56, kw), 0.44, kr);
    const duty = lerp(lerp(0.62, 0.3, kw), 0.225, kr);
    const stride = v * period * duty;
    const centre = lerp(lerp(0.03, 0.13, kw), 0.16, kr);
    const strikeZ = centre - stride / 2;
    const liftH = lerp(lerp(0.08, 0.2, kw), 0.34, kr);
    const heelMax = lerp(lerp(0.5, 0.9, kw), 1.1, kr);
    const bounceA = lerp(lerp(-0.012, 0.03, kw), 0.036, kr);
    const hipH = lerp(lerp(lerp(1.015, 1.0, k0), 0.982, kw), 0.972, kr);
    const stanceX = lerp(lerp(0.1, 0.075, kw), 0.05, kr);

    if (v > 0.05) {
      phase += h / period;
      phase -= Math.floor(phase);
    }

    // Local slope, so feet and shadow sit on the hill. Rise per metre along his own x and z.
    const yaw = group.rotation.y;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const gx = clamp(slopeX * cy - slopeZ * sy, -1, 1);
    const gz = clamp(slopeX * sy + slopeZ * cy, -1, 1);
    shadow.rotation.set(-Math.atan(gz), 0, Math.atan(gx));
    const sh = 1 - air * 0.3;
    shadow.scale.set(sh, sh, sh * (1.05 + kr * 0.12 * move));

    // Pelvis.
    const idle = 1 - move;
    const breath = Math.sin(t * 1.7);
    const shift = Math.sin(t * 0.55) * idle; // weight from foot to foot while standing
    const beat = Math.cos(2 * TAU * (phase - duty / 2)); // +1 at the middle of each foot's stance
    const side0 = Math.cos(TAU * (phase - duty / 2)); // +1 when the left foot carries him
    const px = shift * 0.026 - side0 * 0.014 * move * (1 - kr * 0.5);
    let py = lerp(STAND - 0.006 - Math.abs(shift) * 0.012 + breath * 0.002, hipH - bounceA * beat, move);
    py += air * 0.04;
    const lead = Math.cos(TAU * phase + 0.2); // +1 when the left leg is forward
    const twist = -lead * lerp(0.07, 0.15, kr) * move + shift * 0.05;
    const tip = shift * 0.035 + side0 * 0.03 * move;
    const lean = lerp(0.015, lerp(0.02, lerp(0.095, 0.3, kr), kw), move) + clamp(accel * 0.011, -0.13, 0.16);
    pelvis.position.set(px, py, 0);
    pelvis.rotation.set(-lean * 0.25, twist, tip);
    body.rotation.z = roll * 0.55;

    // Spine, head, hair.
    torso.rotation.set(-lean * 0.75 + breath * 0.008 * idle, -twist * 1.75, roll * 0.5 - tip * 1.3);
    torso.position.y = SPINE_UP + breath * 0.003;
    const look = clamp(turnRate * 0.1, -0.35, 0.35) + Math.sin(t * 0.31) * 0.14 * idle;
    head.rotation.set(lean * 0.8 - 0.03, twist * 0.6 + look, -roll * 0.6 + tip * 0.3);
    lagY = damp(lagY, py, 16, h);
    const bob = clamp((lagY - py) * 0.9, -0.03, 0.03);
    hair.position.y = HAIR_Y + bob;
    hair.scale.set(1 - bob * 1.1, 1 + bob * 2.4, 1 - bob * 1.1);

    // Arms swing against the legs. Elbows fold as the pace picks up.
    const swing = Math.cos(TAU * phase + 0.35);
    const armA = lerp(lerp(0.3, 0.6, kw), 1.0, kr) * move;
    const fold = lerp(0.16, lerp(lerp(0.3, 0.8, kw), 1.5, kr), move);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const s = side * swing; // right arm forward with the left leg
      upperArm[i].rotation.set(
        armA * s + 0.06 * kr * move - lean * 0.2 + air * 0.3,
        0,
        side * (0.13 + 0.05 * kr * move + breath * 0.012 * idle + air * 0.5) - (roll * 0.5 - tip * 1.3) * 0.5,
      );
      forearm[i].rotation.set(fold + Math.max(0, s) * 0.45 * move + (side < 0 ? 0.08 : 0) * idle, 0, 0);
    }

    // Legs. Find where each foot touches, then solve hip, knee and ankle to reach it.
    const cr = Math.cos(tip);
    const sr = Math.sin(tip);
    const ct = Math.cos(twist);
    const st = Math.sin(twist);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      let p = phase + i * 0.5;
      p -= Math.floor(p);
      let z: number;
      let lift: number;
      let pitch: number; // heel up is positive
      if (p < duty) {
        const u = p / duty;
        if (!planted[i]) {
          planted[i] = true;
          footZ[i] = strikeZ;
        } else {
          footZ[i] = Math.min(footZ[i] + v * h, strikeZ + stride * 1.2 + 0.05);
        }
        z = footZ[i];
        lift = 0;
        pitch = -0.26 * (1 - smoothstep(0, 0.3, u)) * (1 - kr * 0.6) + heelMax * smoothstep(0.45, 1, u);
      } else {
        const s = (p - duty) / (1 - duty);
        if (planted[i]) {
          planted[i] = false;
          liftZ[i] = footZ[i];
        }
        z = lerp(liftZ[i], strikeZ, smoothstep(0, 1, s));
        footZ[i] = z;
        lift = liftH * Math.sin(Math.PI * Math.pow(s, 0.8));
        pitch = lerp(heelMax, -0.26 * (1 - kr * 0.6), smoothstep(0.2, 0.95, s)) + Math.sin(Math.PI * s) * 0.35 * kr;
      }

      // Blend the stride with the standing pose, then with the tucked pose in the air.
      let fx = lerp(side * 0.118, side * stanceX, move);
      let fz = lerp(-side * 0.035, z, move);
      lift *= move;
      pitch *= move;
      fx = lerp(fx, side * 0.1, air);
      fz = lerp(fz, side * 0.14, air);
      lift = lerp(lift, 0.14 - side * 0.05, air);
      pitch = lerp(pitch, 0.5, air);

      // Ground under this foot, and the tilt of the sole to match it.
      const ground = clamp(gx * fx + gz * fz, -0.35, 0.35) * (1 - air);
      pitch += Math.atan(gz) * 0.85 * (1 - air);

      // Ankle from the contact point: rock over the ball of the foot, or back on the heel.
      const c = Math.cos(pitch);
      const s2 = Math.sin(pitch);
      let ay: number;
      let az: number;
      if (pitch >= 0) {
        ay = ground + lift + ANKLE * c + BALL * s2;
        az = fz - BALL + BALL * c - ANKLE * s2;
      } else {
        ay = ground + lift + ANKLE * c - HEEL * s2;
        az = fz + HEEL - ANKLE * s2 - HEEL * c;
      }

      // Hip joint, carried by the pelvis roll and twist.
      const ox = side * HIP_W * cr + HIP_DROP * sr;
      const oy = side * HIP_W * sr - HIP_DROP * cr;
      const hx = px + ox * ct;
      const hy = py + oy;
      const hz = -ox * st;

      const dx = fx - hx;
      const dy = ay - hy;
      const dz = az - hz;
      const lat = Math.atan2(dx, -dy);
      const down = Math.hypot(dx, dy);
      const d = clamp(Math.hypot(down, dz), 0.3, REACH);
      const dir = Math.atan2(-dz, down);
      const alpha = Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
      const bend = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
      thigh[i].position.set(hx, hy, hz);
      thigh[i].rotation.set(dir + alpha, 0, lat);
      shin[i].rotation.x = -bend;
      foot[i].rotation.set(-pitch - (dir + alpha) + bend, side * -0.16 * idle, -lat);
    }
  }

  reset();
  update(0, 0, 0, 0, true);

  const height = STAND + SPINE_UP + NECK_UP + HAIR_Y + 0.275 + 0.088;
  return { group, update, height, setSlope, reset };
}

/** How many triangles and meshes he costs. For the test page. */
export function characterCost(c: Character): { meshes: number; triangles: number } {
  let meshes = 0;
  let triangles = 0;
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return { meshes, triangles };
}
