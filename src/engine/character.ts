// The visitor's figure. A Black teenager with his rope twists tied up in a short high ponytail, an oversized
// orange jacket, cargo trousers and chunky trainers. Rigid segments on joints, each segment one kit mesh, animated by hand written maths.
// He faces -z in his own space (yaw 0 looks north), so the back of the jacket is +z.
import * as THREE from 'three';
import type { ColorLike, InkBuilder, InkKit, QualityTier } from '../types';
import * as geo from './geo';
import { clamp, damp, lerp, smoothstep } from './util';
import { palette as P } from '../world/palette';

export interface Character {
  group: THREE.Group;
  /** speed in m/s over the ground, turnRate in rad/s (positive is a left turn, yaw going up). */
  update(dt: number, t: number, speed: number, turnRate: number, grounded: boolean): void;
  /** Top of the head, scalp rows included, above the soles, metres. The tie sits behind the crown
   *  and the bunch stands about a hand's width higher still. */
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
const SHEEN = mix(P.hair, P.violet, 0.48);
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
// Hair, the numbers a barber would argue about. Fat rope twists, rowed back over the head, tied
// high on the back of the crown, the ends standing up and back off the tie in a short bunch.
// Everything here is sized to be read from the follow camera, where his head is twenty pixels wide:
// fat twists, enough of them that the bunch has some body, a band you can see from across the street.
// ---------------------------------------------------------------------------------------------

export interface HairSpec {
  /** Free twists in the bunch. */
  twists: number;
  /** Radius of a free twist, metres. Thumb thick, so each one is a shape of its own at a distance. */
  twistR: number;
  /** The longest twist, tie to tip, along the rope. Kept short: the bunch stands off the crown and
   *  the tips never come down as far as the collar. */
  twistLen: number;
  /** Length of one turn of the rope. */
  turn: number;
  /** Where the tie sits on the back of the skull, radians up from level. */
  tieElev: number;
  /** The bunch leaves the tie this far above level, radians. A quarter turn is straight up. */
  tieTilt: number;
  /** How far the bunch fans from side to side. 0 is a tight rope, 1 is a palm tree. Past about 0.9
   *  the outer twists lie flat and the bunch reads as a bow from behind. */
  spread: number;
  /** How far the tips are carried back behind the head as they fall. 0 drops them straight down. */
  back: number;
  /** How much of the violet sheen the scalp rows carry, 0 to 1. Less than the bunch, so the bunch stands out against them. */
  rowSheen: number;
  /** Short twists that got away at his right temple: 0, 1 or 2. */
  loose: number;
  /** Twists lying on the scalp, hairline to tie. */
  rows: number;
  /** How proud a scalp twist stands off the head. */
  rowH: number;
  /** Half width of a scalp twist at its widest. */
  rowW: number;
  /** How much of its slice of the head a row fills. The rest is the parting. */
  rowFill: number;
  /** Colour of the tie. */
  tie: ColorLike;
  /** Colour of the scalp where a parting shows. */
  part: ColorLike;
}

const HAIR: HairSpec = {
  twists: 11,
  twistR: 0.021,
  twistLen: 0.175,
  turn: 0.04,
  tieElev: 1.0,
  tieTilt: 1.13,
  spread: 0.86,
  back: 1,
  rowSheen: 0.3,
  loose: 0,
  rows: 12,
  rowH: 0.014,
  rowW: 0.03,
  rowFill: 0.76,
  tie: P.yellow,
  part: mix(P.hair, P.skin, 0.72),
};
const GOGGLE_Y = 0.217; // middle of the lens
const GOGGLE_Z = -0.097;
const HAIR_LIFT = 0.004; // the dark under the twists stands this far off the skin
const LOOSE_LEN = 0.075; // a loose twist at the temple, root to tip
const LOOSE_R = 0.011;
const TIE_R = 0.039; // the band: a cuff this fat
const TIE_LEN = 0.04; // this long, wrapped round the foot of the bunch
const TIE_OFF = 0.014; // and standing this far off the scalp
const TAIL_K = 150; // bunch spring: stiffness
const TAIL_C = 9; // and damping
const LEAN_BACK = 0.5; // how far the bunch may lie back before the tips would touch the head
const LEAN_FWD = 0.16; // and how far it may flick forward on a stop
const LEAN_SIDE = 0.28;

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

function buildHead(kit: InkKit, hs: HairSpec, low: boolean): { mesh: THREE.Mesh; tie: THREE.Vector3 } {
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
  const tie = buildScalp(b, hs, low);
  // Goggles pushed up on the forehead, the frame sitting across the hairline. The strap runs round
  // the back of the head over the rows and under the tie.
  const band = (rx: number, rz: number, hy: number, half: number): THREE.BufferGeometry =>
    loft([{ y: -hy, rx, rz }, { y: hy, rx: rx * 0.97, rz: rz * 0.97 }], 10, { from: Math.PI - half, to: Math.PI + half });
  const tilt = 0.5;
  // Hung from the middle of the front of the frame, so the tilt can change without the lens moving.
  const at = (rz: number, up = 0): [number, number, number] => [0, GOGGLE_Y + up - rz * Math.sin(tilt), GOGGLE_Z + rz * Math.cos(tilt)];
  b.add(band(0.11, 0.115, 0.027, 1.0), { color: INDIGO_DARK, pos: at(0.115), rot: [tilt, 0, 0], flat: 0.5 });
  b.add(band(0.112, 0.119, 0.019, 0.84), { color: P.teal, pos: at(0.115), rot: [tilt, 0, 0], flat: 0.75, outline: false });
  b.add(band(0.113, 0.121, 0.006, 0.2), { color: P.cyan, pos: at(0.115, 0.008), rot: [tilt, -0.42, 0], flat: 1, outline: false });
  b.add(
    loft([{ y: -0.012, rx: 0.119, rz: 0.137 }, { y: 0.012, rx: 0.116, rz: 0.134 }], 12, { from: -2.1, to: 2.1 }),
    { color: INDIGO_DARK, pos: [0, 0.172, 0.002], rot: [0.25, 0, 0], flat: 0.5 },
  );
  return { mesh: b.build('figure-head'), tie };
}

// ---------------------------------------------------------------------------------------------
// Hair: two strand twists, laid back over the head in rows, gathered in a tie high on the back of
// the crown, the ends standing off it in a short bunch. It is all built from one thing, a rope: a
// tube whose rings go fat, thin, fat, thin, each ring set a little askew so the turns run on the
// slant. Hair and ink are nearly the same dark, so the line work cannot carry the texture. The
// violet sheen does: every other half turn is drawn in the sheen tone, which stripes each twist
// the way a pen would. The visitor walks behind him the whole time, so the cut is judged from
// there first: what he sees is the back of the head, the band, and the fan against the sky.
// ---------------------------------------------------------------------------------------------

const SKULL_Y = 0.125;
const SKULL_RX = 0.108;
const SKULL_RY = 0.1265;
const SKULL_RZ = 0.115;

// The hairline as a barber leaves it: how high the edge sits on the skull (radians above level)
// against the angle round from the front. Straight across the forehead, a square corner at the
// temple, a short drop in front of the ear, up and over the ear, then down to a tidy nape.
const HAIRLINE: readonly (readonly [number, number])[] = [
  [0, 0.75],
  [0.55, 0.75],
  [0.8, 0.66],
  [0.98, 0.3],
  [1.15, 0.1],
  [1.32, 0.06],
  [1.42, 0.22],
  [1.85, 0.22],
  [2.0, -0.1],
  [2.3, -0.5],
  [Math.PI, -0.58],
];

function hairline(theta: number): number {
  for (let i = 1; i < HAIRLINE.length; i++) {
    if (theta <= HAIRLINE[i][0]) {
      const a = HAIRLINE[i - 1];
      const b = HAIRLINE[i];
      return lerp(a[1], b[1], (theta - a[0]) / (b[0] - a[0]));
    }
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}

const V = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** A point on the skull along direction d, lifted off the skin. Head space. */
function onSkull(d: THREE.Vector3, lift: number): THREE.Vector3 {
  return V(d.x * (SKULL_RX + lift), SKULL_Y + d.y * (SKULL_RY + lift), d.z * (SKULL_RZ + lift));
}

function skullNormal(d: THREE.Vector3): THREE.Vector3 {
  return V(d.x / SKULL_RX, d.y / SKULL_RY, d.z / SKULL_RZ).normalize();
}

/** Loose triangles with their own normals. Winding is fixed up to agree with the normals. */
class Tris {
  pos: number[] = [];
  nor: number[] = [];
  add(p: number[], n: number[], a: number, b: number, c: number): void {
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az;
    const vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const sx = n[a * 3] + n[b * 3] + n[c * 3];
    const sy = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1];
    const sz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2];
    const order = fx * sx + fy * sy + fz * sz < 0 ? [a, c, b] : [a, b, c];
    for (const i of order) {
      this.pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      this.nor.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
    }
  }
  geo(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    return g;
  }
}

interface RopeSpec {
  /** Centres of the rings, evenly spaced, two to a turn. */
  pts: readonly THREE.Vector3[];
  /** For a twist lying on the head: the way out of the head at each ring. Only the top half is built. */
  ups?: readonly THREE.Vector3[];
  /** Half width and half height at ring j, before the fat and thin. */
  wide: (j: number) => number;
  tall: (j: number) => number;
  seg: number;
  /** 0 or 1: which rings are the fat ones, so neighbours do not line up. */
  phase: number;
  /** Which way is the sky for the sheen, and how squarely a face must look at it. A cut of -1 or
   *  less stripes the rope all the way round. */
  sun: THREE.Vector3;
  cut: number;
  capStart?: boolean;
  capEnd?: boolean;
  /** A thin ring against a fat one, if not the usual. */
  pinch?: number;
}

const ROPE_PINCH = 0.62; // a thin ring against a fat one
const TAIL_PINCH = 0.5; // the free twists are knottier, so the edge of each one is beaded against the sky
const ROPE_SLANT = 0.42; // how far each ring is set askew, in widths

function rope(o: RopeSpec): { dark: THREE.BufferGeometry | null; lit: THREE.BufferGeometry | null } {
  const n = o.pts.length;
  const half = o.ups !== undefined;
  const cols = half ? o.seg + 1 : o.seg;
  const p: number[] = [];
  const nr: number[] = [];
  const t = V();
  const up = V();
  const bn = V();
  const q = V();
  const ref = V(1, 0, 0);
  for (let j = 0; j < n; j++) {
    t.copy(o.pts[Math.min(j + 1, n - 1)]).sub(o.pts[Math.max(j - 1, 0)]).normalize();
    if (o.ups) {
      up.copy(o.ups[j]).addScaledVector(t, -o.ups[j].dot(t)).normalize();
      bn.crossVectors(t, up);
    } else {
      bn.copy(ref).addScaledVector(t, -ref.dot(t)).normalize();
      up.crossVectors(bn, t);
    }
    const fat = (j + o.phase) % 2 === 0 ? 1 : (o.pinch ?? ROPE_PINCH);
    const w = Math.max(1e-4, o.wide(j) * fat);
    const h = Math.max(1e-4, o.tall(j) * fat);
    for (let i = 0; i < cols; i++) {
      const a = half ? (Math.PI * i) / o.seg : (TAU * i) / o.seg;
      const c = Math.cos(a);
      const s = Math.sin(a);
      q.copy(o.pts[j]).addScaledVector(bn, c * w).addScaledVector(up, s * h).addScaledVector(t, ROPE_SLANT * w * c);
      p.push(q.x, q.y, q.z);
      q.set(0, 0, 0).addScaledVector(bn, c / w).addScaledVector(up, s / h).normalize();
      nr.push(q.x, q.y, q.z);
    }
  }
  const dark = new Tris();
  const lit = new Tris();
  for (let j = 0; j < n - 1; j++) {
    const shine = (j + o.phase) % 2 === 0;
    for (let i = 0; i < o.seg; i++) {
      const i1 = half ? i + 1 : (i + 1) % o.seg;
      const a = j * cols + i;
      const b = j * cols + i1;
      const c = (j + 1) * cols + i;
      const d = (j + 1) * cols + i1;
      q.set(nr[a * 3] + nr[b * 3] + nr[c * 3] + nr[d * 3], nr[a * 3 + 1] + nr[b * 3 + 1] + nr[c * 3 + 1] + nr[d * 3 + 1], nr[a * 3 + 2] + nr[b * 3 + 2] + nr[c * 3 + 2] + nr[d * 3 + 2]).normalize();
      const out = shine && q.dot(o.sun) > o.cut ? lit : dark;
      out.add(p, nr, a, b, c);
      out.add(p, nr, b, d, c);
    }
  }
  // The end is closed with a point, in the tone of the turn it closes.
  const cap = (j: number, sign: number): void => {
    t.copy(o.pts[Math.min(j + 1, n - 1)]).sub(o.pts[Math.max(j - 1, 0)]).normalize().multiplyScalar(sign);
    q.copy(o.pts[j]).addScaledVector(t, o.wide(j) * 0.8);
    const tip = p.length / 3;
    p.push(q.x, q.y, q.z);
    nr.push(t.x, t.y, t.z);
    const seg = sign > 0 ? j - 1 : j;
    const out = o.cut <= -1 && (seg + o.phase) % 2 === 0 ? lit : dark;
    for (let i = 0; i < o.seg; i++) out.add(p, nr, j * cols + i, j * cols + (half ? i + 1 : (i + 1) % o.seg), tip);
  };
  if (o.capStart) cap(0, -1);
  if (o.capEnd) cap(n - 1, 1);
  return { dark: dark.geo(), lit: lit.geo() };
}

/** Everything that sits still on the head: the dark under the twists, the rows, the tie.
 *  Goes into the head's own mesh. Returns the middle of the tie, which is what the bunch swings about. */
function buildScalp(b: InkBuilder, hs: HairSpec, low: boolean): THREE.Vector3 {
  const dT = V(0, Math.sin(hs.tieElev), Math.cos(hs.tieElev)); // the tie, as a direction from the middle of the skull
  const u = V(0, Math.cos(hs.tieElev), -Math.sin(hs.tieElev)); // from the tie over the top towards the forehead
  // A spoke: start at the tie, head off on bearing psi (0 goes over the top to the forehead, half a
  // turn goes down to the nape), travel delta radians round the skull.
  const spoke = (psi: number, delta: number): THREE.Vector3 =>
    V(Math.sin(delta) * Math.sin(psi), 0, 0)
      .addScaledVector(dT, Math.cos(delta))
      .addScaledVector(u, Math.sin(delta) * Math.cos(psi))
      .normalize();
  const inside = (d: THREE.Vector3): boolean => Math.asin(clamp(d.y, -1, 1)) > hairline(Math.atan2(Math.abs(d.x), -d.z));
  // How far along a spoke the hairline is.
  const edge = (psi: number): number => {
    let lo = 0.2;
    let hi = lo;
    while (hi < 2.9 && inside(spoke(psi, hi))) {
      lo = hi;
      hi += 0.02;
    }
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (inside(spoke(psi, mid))) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  // The scalp under the twists. Its rim is the hairline, so the edge up is one clean line. No ink
  // line of its own: every row is already dark as ink, and a line down both sides of each parting
  // closed the partings up at walking distance. Left bare they show as pale lines running to the tie.
  {
    const cols = low ? 20 : 26;
    const steps = [0.1, 0.3, 0.5, 0.7, 0.86, 1];
    const p: number[] = [];
    const n: number[] = [];
    for (let c = 0; c < cols; c++) {
      const psi = (c / cols) * TAU;
      const far = edge(psi);
      for (const f of steps) {
        const d = spoke(psi, far * f);
        const at = onSkull(d, HAIR_LIFT);
        const nn = skullNormal(d);
        p.push(at.x, at.y, at.z);
        n.push(nn.x, nn.y, nn.z);
      }
    }
    const mid = p.length / 3;
    const at = onSkull(dT, HAIR_LIFT);
    const nn = skullNormal(dT);
    p.push(at.x, at.y, at.z);
    n.push(nn.x, nn.y, nn.z);
    const tris = new Tris();
    const m = steps.length;
    for (let c = 0; c < cols; c++) {
      const c1 = (c + 1) % cols;
      tris.add(p, n, mid, c * m, c1 * m);
      for (let j = 0; j < m - 1; j++) {
        tris.add(p, n, c * m + j, c1 * m + j, c * m + j + 1);
        tris.add(p, n, c1 * m + j, c1 * m + j + 1, c * m + j + 1);
      }
    }
    b.add(tris.geo()!, { color: hs.part, flat: 0.2, outline: false });
  }

  // The rows. Evenly fanned round the tie, each one as wide as its slice of the head allows, less
  // the parting. Striped all the way round: from behind nothing on the back of the head faces the sky.
  const sun = V(0, 1, 0.25).normalize();
  const rowSheen = mix(P.hair, P.violet, hs.rowSheen);
  const step = (hs.turn * (low ? 1.3 : 1)) / 2 / 0.118; // radians of skull per ring
  const gather = (TIE_R * 0.7) / 0.118;
  for (let k = 0; k < hs.rows; k++) {
    const psi = ((k + 0.5) / hs.rows) * TAU;
    const far = edge(psi) - 0.035;
    const rings = Math.max(4, Math.round((far - gather) / step) + 1);
    const pts: THREE.Vector3[] = [];
    const ups: THREE.Vector3[] = [];
    const wide: number[] = [];
    for (let j = 0; j < rings; j++) {
      const delta = lerp(far, gather, j / (rings - 1));
      const d = spoke(psi, delta);
      pts.push(onSkull(d, 0.0005));
      ups.push(skullNormal(d));
      const slice = (0.118 * Math.sin(delta) * Math.PI) / hs.rows;
      wide.push(clamp(slice * hs.rowFill, hs.rowW * 0.3, hs.rowW));
    }
    const root = (j: number): number => (j === 0 ? 0.45 : j === 1 ? 0.9 : 1); // rounded where it leaves the scalp
    const g = rope({
      pts,
      ups,
      wide: (j) => wide[j] * root(j),
      tall: (j) => (hs.rowH + HAIR_LIFT) * root(j),
      seg: low ? 3 : 4,
      phase: k % 2,
      sun,
      cut: -1,
      capStart: true,
    });
    const id = b.newId();
    if (g.dark) b.add(g.dark, { color: P.hair, id });
    if (g.lit) b.add(g.lit, { color: rowSheen, id, flat: 0.4 });
  }

  // The ones that got away: short, hanging in front of the ear over the goggle strap.
  for (let k = 0; k < hs.loose; k++) {
    const theta = 0.74 + k * 0.2;
    const el = hairline(theta) + 0.06;
    const d = V(Math.sin(theta) * Math.cos(el), Math.sin(el), -Math.cos(theta) * Math.cos(el));
    const from = onSkull(d, HAIR_LIFT);
    const out = skullNormal(d);
    out.y = 0;
    out.normalize();
    const len = LOOSE_LEN * (1 - k * 0.22);
    const rings = Math.max(4, Math.round(len / (hs.turn * 0.4)) + 1);
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j < rings; j++) {
      const t = j / (rings - 1);
      pts.push(from.clone().addScaledVector(out, 0.024 * Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5)).add(V(0, 0.012 * Math.sin(t * Math.PI) - len * t * t, 0)));
    }
    const g = rope({
      pts,
      wide: (j) => LOOSE_R * (j === rings - 1 ? 0.6 : 1),
      tall: (j) => LOOSE_R * (j === rings - 1 ? 0.6 : 1),
      seg: 4,
      phase: k % 2,
      sun: V(out.x, 0.6, out.z).normalize(),
      cut: 0.55,
      capStart: true,
      capEnd: true,
    });
    const id = b.newId();
    if (g.dark) b.add(g.dark, { color: P.hair, id });
    if (g.lit) b.add(g.lit, { color: SHEEN, id, flat: 0.4 });
  }

  // The tie: a fat cuff where the rows meet, wrapped round the foot of the bunch and turned the
  // way the bunch leaves. It stands a little off the head on a neck of gathered hair, so from
  // behind it sits on the skyline: the one bright thing up there from across the street.
  const D = V(0, Math.sin(hs.tieTilt), Math.cos(hs.tieTilt));
  const tie = onSkull(dT, 0).addScaledVector(D, TIE_OFF + TIE_LEN * 0.5);
  const hl = TIE_LEN / 2;
  const turnTo: [number, number, number] = [Math.PI / 2 - hs.tieTilt, 0, 0];
  b.add(
    loft(
      [
        { y: -hl - TIE_OFF - 0.02, rx: TIE_R * 1.45, rz: TIE_R * 1.45 },
        { y: -hl - TIE_OFF * 0.4, rx: TIE_R * 1.02, rz: TIE_R * 1.02 },
        { y: -hl + 0.004, rx: TIE_R * 0.8, rz: TIE_R * 0.8 },
      ],
      low ? 8 : 12,
    ),
    { color: P.hair, pos: [tie.x, tie.y, tie.z], rot: turnTo },
  );
  b.add(
    loft(
      [
        { y: -hl, rx: TIE_R * 0.84, rz: TIE_R * 0.84 },
        { y: -hl * 0.5, rx: TIE_R, rz: TIE_R },
        { y: hl * 0.5, rx: TIE_R, rz: TIE_R },
        { y: hl, rx: TIE_R * 0.84, rz: TIE_R * 0.84 },
      ],
      low ? 8 : 12,
      { top: true, bottom: true },
    ),
    // No line of its own: the hair either side of it is as dark as the ink, and at walking distance
    // a line round something this small would eat half the yellow.
    { color: hs.tie, pos: [tie.x, tie.y, tie.z], rot: turnTo, flat: 0.6, outline: false },
  );
  return tie;
}

/** The bunch, built round the middle of the tie. The long twists are a fan seen flat on from
 *  behind: the middle ones stand up and flop over, the outer ones arc out past the sides of the
 *  crown and droop, like a short palm. That fan is the silhouette, so they are few and they part
 *  towards the tips. Shorter twists lean out behind and fill the foot of it. Nothing falls across
 *  the band from where the follow camera sits. Two meshes, so the long ones can swing a beat
 *  behind the short. */
function buildTail(kit: InkKit, hs: HairSpec, low: boolean, tie: THREE.Vector3): THREE.Mesh[] {
  const inner = kit.builder();
  const fan = kit.builder();
  const rnd = geo.seeded(23);
  const D = V(0, Math.sin(hs.tieTilt), Math.cos(hs.tieTilt)); // the way the bunch leaves the tie
  const sun = V(0, 1, 0);
  const step = (hs.turn * (low ? 1.3 : 1)) / 2;
  // Three in five are long. The low tier keeps the fan and gives up two of the short ones.
  const nLong = Math.max(1, Math.ceil(hs.twists * 0.6));
  const nShort = Math.max(0, hs.twists - nLong - (low ? 2 : 0));
  const count = nLong + nShort;
  const P0 = V();
  const P1 = V();
  const P2 = V();
  const P3 = V();
  const F = V();
  const G = V();
  const q = V();
  for (let k = 0; k < count; k++) {
    const short = k >= nLong;
    // u runs across the fan from his left to his right. The short ones sit between the long ones
    // but lean so far back that from behind they only fill the foot of the fan: the gaps further
    // out stay open, and the gaps are what part the fan into ropes from far off.
    const u = short ? (nShort === 1 ? 0.2 : (((k - nLong + 0.5) / nShort) * 2 - 1) * 0.9) : nLong === 1 ? 0 : (k / (nLong - 1)) * 2 - 1;
    const au = Math.abs(u);
    // The middle ones have no side to fall to, so each is given one.
    const flop = (k % 2 === 0 ? 1 : -1) * (0.3 + rnd() * 0.3) * (1 - au);
    // theta: round from straight up, as seen from behind. beta: how far it leans back out of the fan.
    const theta = u * hs.spread * (Math.PI / 2) * (short ? 0.8 : 1) + (short ? 0 : flop * 0.2);
    const beta = short ? 0.5 + hs.back * 0.45 : hs.back * (0.3 + 0.2 * au);
    const len = hs.twistLen * (short ? 0.52 : 0.68 + 0.32 * au) * (0.96 + rnd() * 0.08);
    // Out of the band along the axis, then off its own way, then over with its own weight.
    F.set(Math.sin(theta) * Math.cos(beta), Math.cos(theta) * Math.cos(beta), Math.sin(beta));
    G.set(Math.sin(theta) * 0.45 + flop, -1, hs.back * 0.6).normalize();
    const droop = short ? 0.2 : lerp(0.35, 0.78, au);
    P0.set(Math.sin(theta) * TIE_R * 0.4, 0, 0).addScaledVector(D, -TIE_LEN * 0.4);
    P1.copy(P0).addScaledVector(D, TIE_LEN * 0.9 + 0.006);
    P2.copy(P1).addScaledVector(F, len * 0.46);
    q.copy(F).multiplyScalar(1 - droop).addScaledVector(G, droop).normalize();
    P3.copy(P2).addScaledVector(q, len * 0.38);
    // Walk the curve, then space the rings evenly along it.
    const fine: THREE.Vector3[] = [];
    const run: number[] = [0];
    for (let n = 0; n <= 36; n++) {
      const s = n / 36;
      const r = 1 - s;
      q.set(0, 0, 0)
        .addScaledVector(P0, r * r * r)
        .addScaledVector(P1, 3 * r * r * s)
        .addScaledVector(P2, 3 * r * s * s)
        .addScaledVector(P3, s * s * s);
      // Keep it off the head: push any point that dips into the hair straight out again.
      const hx = (q.x + tie.x) / (SKULL_RX + 0.02 + hs.twistR);
      const hy = (q.y + tie.y - SKULL_Y) / (SKULL_RY + 0.02 + hs.twistR);
      const hz = (q.z + tie.z) / (SKULL_RZ + 0.02 + hs.twistR);
      const f = Math.sqrt(hx * hx + hy * hy + hz * hz);
      const push = smoothstep(0.3, 0.55, s);
      if (f < 1) {
        const k2 = lerp(1, 1 / f, push);
        q.set((q.x + tie.x) * k2 - tie.x, (q.y + tie.y - SKULL_Y) * k2 + SKULL_Y - tie.y, (q.z + tie.z) * k2 - tie.z);
      }
      if (n > 0) run.push(run[n - 1] + q.distanceTo(fine[n - 1]));
      fine.push(q.clone());
    }
    const total = run[36];
    const rings = Math.max(5, Math.round(total / step) + 1);
    const pts: THREE.Vector3[] = [];
    let seg = 1;
    for (let j = 0; j < rings; j++) {
      const at = (total * j) / (rings - 1);
      while (seg < 36 && run[seg] < at) seg++;
      pts.push(fine[seg - 1].clone().lerp(fine[seg], clamp((at - run[seg - 1]) / Math.max(1e-6, run[seg] - run[seg - 1]), 0, 1)));
    }
    const thick = hs.twistR * (short ? 0.92 : 1) * (0.96 + rnd() * 0.08);
    const taper = (j: number): number => {
      const left = rings - 1 - j;
      if (j < 2) return j === 0 ? 0.55 : 0.85; // squeezed where the band holds it
      return left === 0 ? 0.7 : left === 1 ? 0.92 : 1; // a blunt end, the way a twist is finished
    };
    const g = rope({
      pts,
      wide: (j) => thick * taper(j),
      tall: (j) => thick * taper(j),
      seg: low ? 5 : 7,
      phase: k % 2,
      sun,
      cut: -1,
      capEnd: true,
      pinch: TAIL_PINCH,
    });
    const b = short ? inner : fan;
    const id = b.newId();
    if (g.dark) b.add(g.dark, { color: P.hair, id });
    if (g.lit) b.add(g.lit, { color: SHEEN, id, flat: 0.4 });
  }
  return [inner.build('figure-tail'), fan.build('figure-tail-top')];
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

export interface CharacterOptions {
  /** On 'low' the twists get fewer rings and sides. Default is the full figure. */
  tier?: QualityTier;
  /** Override any of the hair numbers. For the test page. */
  hair?: Partial<HairSpec>;
}

export function createCharacter(kit: InkKit, opts: CharacterOptions = {}): Character {
  const hs: HairSpec = { ...HAIR, ...opts.hair };
  const low = opts.tier === 'low';
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
  const built = buildHead(kit, hs, low);
  const head = built.mesh;
  head.position.set(0, NECK_UP, 0);
  torso.add(head);
  // The bunch stands on the tie. The long twists are their own mesh, a beat behind the short ones.
  const tail = buildTail(kit, hs, low, built.tie);
  for (const m of tail) {
    m.position.copy(built.tie);
    head.add(m);
  }

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
  let tailP = 0; // the bunch about the tie: positive lies back
  let tailPV = 0;
  let tailS = 0; // lean, positive to his right
  let tailSV = 0;
  let topP = 0;
  let topS = 0;
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
    tailP = tailPV = tailS = tailSV = topP = topS = 0;
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

    // The bunch: two damped springs about the tie. tailP is how far it lies back, tailS how far it
    // leans to his right. It lies back with speed, is left behind when he sets off, flicks forward
    // when he stops, nods a beat behind each footfall, is thrown to the outside of a turn.
    // With h at zero nothing moves, so a frozen frame keeps whatever swing it had.
    const drop = lagY - py; // positive while the head is on its way down
    const wantP = (0.12 + 0.2 * kr) * move + clamp(accel * 0.022, -0.2, 0.3) - clamp(drop * 8, -0.2, 0.2) - air * 0.12;
    const wantS = clamp(turnRate * (0.05 + v * 0.008), -0.3, 0.3) - Math.cos(TAU * (phase - duty / 2) - 0.6) * lerp(0.06, 0.09, kr) * move + shift * 0.03;
    tailPV += ((wantP - tailP) * TAIL_K - tailPV * TAIL_C) * h;
    tailSV += ((wantS - tailS) * TAIL_K - tailSV * TAIL_C) * h;
    tailP += tailPV * h;
    tailS += tailSV * h;
    // At the stops the swing is spent, or it would buzz against them.
    if (tailP > LEAN_BACK) {
      tailP = LEAN_BACK;
      if (tailPV > 0) tailPV = 0;
    } else if (tailP < -LEAN_FWD) {
      tailP = -LEAN_FWD;
      if (tailPV < 0) tailPV = 0;
    }
    if (tailS > LEAN_SIDE) {
      tailS = LEAN_SIDE;
      if (tailSV > 0) tailSV = 0;
    } else if (tailS < -LEAN_SIDE) {
      tailS = -LEAN_SIDE;
      if (tailSV < 0) tailSV = 0;
    }
    topP = damp(topP, clamp(tailP * 1.3, -LEAN_FWD, LEAN_BACK), 11, h);
    topS = damp(topS, tailS * 1.25, 11, h);
    tail[0].rotation.set(tailP, 0, -tailS);
    tail[1].rotation.set(topP, 0, -topS);

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

  const height = STAND + SPINE_UP + NECK_UP + SKULL_Y + SKULL_RY + HAIR_LIFT + hs.rowH;
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
