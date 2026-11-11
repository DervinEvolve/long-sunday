// His head and his hair. The face is drawn the way a pen would: a brow, an eye, the plane of the
// nose, a mouth, an ear. The hair is two strand twists, rowed back over the head and tied high on
// the back of the crown, the ends standing off the tie in a short bunch.
// Built round the top of the neck. He faces -z.
import * as THREE from 'three';
import type { ColorLike, InkKit } from '../types';
import * as geo from './geo';
import { clamp, lerp, smoothstep } from './util';
import { palette as P } from '../world/palette';
import { Loft, fan, sheet, type Ring } from './characterGeo';
import { SkinBuilder, type BindOut, type Skin } from './characterSkin';
import { C, mix, type Detail, type Ids } from './characterBody';

const V = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const FRONT = V(0, 0, -1);

// ---------------------------------------------------------------------------------------------
// Hair numbers, the ones a barber would argue about.
// ---------------------------------------------------------------------------------------------

export interface HairSpec {
  /** Free twists in the bunch. */
  twists: number;
  /** Radius of a free twist, metres. Thumb thick, so each one is a shape of its own at a distance. */
  twistR: number;
  /** The longest twist, tie to tip, along the rope. Kept short: the tips never come near the collar. */
  twistLen: number;
  /** Length over which the two strands wind once round each other. */
  turn: number;
  /** Where the tie sits on the back of the skull, radians up from level. */
  tieElev: number;
  /** The bunch leaves the tie this far above level, radians. A quarter turn is straight up. */
  tieTilt: number;
  /** How wide the bunch opens. 0 is a tight rope, 1 is a dandelion. */
  spread: number;
  /** Twists lying on the scalp, hairline to tie. */
  rows: number;
  /** How proud a scalp twist stands off the head. */
  rowH: number;
  /** Half width of a scalp twist at its widest. */
  rowW: number;
  /** How much of its slice of the head a row fills. The rest is the parting. */
  rowFill: number;
  /** Colour of the cuff. */
  tie: ColorLike;
}

export const HAIR: HairSpec = {
  twists: 10,
  twistR: 0.0165,
  twistLen: 0.118,
  turn: 0.062,
  tieElev: 0.98,
  tieTilt: 0.92,
  spread: 0.45,
  rows: 13,
  rowH: 0.012,
  rowW: 0.024,
  rowFill: 0.8,
  tie: P.yellow,
};

// Hair is nearly as dark as the ink, so line alone cannot draw it. Each twist is two strands: the
// strands are the lit tone, the groove between them is the dark one, and that stripes it on the slant.
const HAIR_DARK = P.hair as string;
const HAIR_LIT = mix(P.hair, '#6e5a66', 0.2);
const HAIR_ROW = mix(P.hair, '#6e5a66', 0.16);
const SCALP = mix(P.hair, P.skin, 0.5);
const BROW = mix(P.hair, P.skin, 0.12);
const EYE_WHITE = mix(P.paper, P.skin, 0.14);
const IRIS = '#20120f';
const LIP = mix(P.skin, '#a85a52', 0.5);
const LIP_LINE = mix(P.skin, P.ink, 0.82);
const SKIN_DEEP = mix(P.skin, P.ink, 0.22);

const SKIN_FLAT = 0.3;

const TIE_R = 0.03;
const TIE_LEN = 0.03;
const TIE_OFF = 0.012;

// ---------------------------------------------------------------------------------------------
// Skull
// ---------------------------------------------------------------------------------------------

const SKULL: readonly Ring[] = [
  { y: -0.03, rx: 0.01, rz: 0.012, z: -0.05 },
  { y: -0.025, rx: 0.029, rz: 0.031, z: -0.049, n: 2.1 },
  { y: -0.005, rx: 0.049, rz: 0.062, z: -0.031, n: 2.1 },
  { y: 0.026, rx: 0.0765, rz: 0.087, z: -0.014, n: 2.15, f: 1.035 },
  { y: 0.075, rx: 0.0845, rz: 0.1, z: -0.004, n: 2.2, f: 0.975 },
  { y: 0.12, rx: 0.088, rz: 0.106, z: 0, n: 2.15, f: 0.955 },
  { y: 0.142, rx: 0.088, rz: 0.106, z: 0.001, n: 2.1, f: 0.975 },
  { y: 0.17, rx: 0.086, rz: 0.104, z: 0.002, f: 0.955 },
  { y: 0.198, rx: 0.07, rz: 0.086, z: 0.004 },
  { y: 0.214, rx: 0.04, rz: 0.05, z: 0.005 },
  { y: 0.22, rx: 0.004, rz: 0.005, z: 0.005 },
];
/** Crown above the head pivot. */
export const CROWN = 0.22;
// An egg that sits close to the cranium, for laying the hair out.
const EGG_Y = 0.112;
const EGG_RX = 0.088;
const EGG_RY = 0.108;
const EGG_RZ = 0.106;

// The hairline as a barber leaves it: height of the edge against the angle round from the front.
// Straight across the forehead, a square corner at the temple, a short drop in front of the ear,
// up and over the ear, then down to a tidy nape.
const HAIRLINE: readonly (readonly [number, number])[] = [
  [0, 0.17],
  [0.62, 0.17],
  [0.84, 0.16],
  [0.98, 0.124],
  [1.16, 0.104],
  [1.3, 0.106],
  [1.42, 0.126],
  [1.86, 0.126],
  [2.06, 0.078],
  [2.45, 0.04],
  [Math.PI, 0.026],
];

/** Height of the hairline at angle a (0 is the back of the head). */
function hairY(a: number): number {
  let th = Math.PI - Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
  th = clamp(th, 0, Math.PI);
  for (let i = 1; i < HAIRLINE.length; i++) {
    if (th <= HAIRLINE[i][0]) {
      const p = HAIRLINE[i - 1];
      const q = HAIRLINE[i];
      return lerp(p[1], q[1], (th - p[0]) / (q[0] - p[0]));
    }
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}

// ---------------------------------------------------------------------------------------------
// A two strand twist. Two lobes wound round the middle line: the section is a peanut that turns
// as it goes. `ups` lays it on a surface: then only the top half is built.
// ---------------------------------------------------------------------------------------------

interface TwistSpec {
  pts: readonly THREE.Vector3[];
  ups?: readonly THREE.Vector3[];
  wide: (j: number) => number;
  tall: (j: number) => number;
  seg: number;
  /** Radians the strands turn from one ring to the next. */
  wind: number;
  phase: number;
  capStart?: boolean;
  capEnd?: boolean;
  /** How much of the round the groove takes. Lower is a thinner dark line. Default 0.78. */
  cut?: number;
}

const GROOVE = 0.36; // how deep the groove between the strands cuts, as a share of the radius

function twist(o: TwistSpec): { strand: THREE.BufferGeometry | null; groove: THREE.BufferGeometry | null } {
  const n = o.pts.length;
  const half = o.ups !== undefined;
  const cols = half ? o.seg + 1 : o.seg;
  const pos: number[] = [];
  const t = V();
  const up = V();
  const bn = V();
  const q = V();
  const prev = V(1, 0, 0);
  for (let j = 0; j < n; j++) {
    t.copy(o.pts[Math.min(j + 1, n - 1)]).sub(o.pts[Math.max(j - 1, 0)]).normalize();
    if (o.ups) {
      up.copy(o.ups[j]).addScaledVector(t, -o.ups[j].dot(t)).normalize();
      bn.crossVectors(t, up);
    } else {
      // Carry the frame along the rope so it does not spin by itself.
      bn.copy(prev).addScaledVector(t, -prev.dot(t));
      if (bn.lengthSq() < 1e-8) bn.set(0, 0, 1).addScaledVector(t, -t.z);
      bn.normalize();
      prev.copy(bn);
      up.crossVectors(bn, t);
    }
    const w = Math.max(1e-4, o.wide(j));
    const h = Math.max(1e-4, o.tall(j));
    const turn = j * o.wind + o.phase;
    for (let i = 0; i < cols; i++) {
      // A free rope carries its columns round with the strands. One lying on the head cannot, so
      // there the strands slide across fixed columns.
      const a = half ? (Math.PI * i) / o.seg : (TAU * i) / o.seg + turn;
      const psi = half ? a - turn : (TAU * i) / o.seg;
      const lobe = 1 - GROOVE * Math.sin(psi) * Math.sin(psi);
      q.copy(o.pts[j]).addScaledVector(bn, Math.cos(a) * w * lobe).addScaledVector(up, Math.sin(a) * h * (half ? 0.55 + 0.45 * lobe : lobe));
      pos.push(q.x, q.y, q.z);
    }
  }
  const idx: number[] = [];
  const kind: number[] = []; // per triangle: 0 strand, 1 groove
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < o.seg; i++) {
      const i1 = half ? i + 1 : (i + 1) % o.seg;
      const a = j * cols + i;
      const b = j * cols + i1;
      const c = (j + 1) * cols + i;
      const d = (j + 1) * cols + i1;
      const mid = half ? (Math.PI * (i + 0.5)) / o.seg - (j + 0.5) * o.wind - o.phase : (TAU * (i + 0.5)) / o.seg;
      const g = Math.abs(Math.sin(mid)) > (o.cut ?? 0.78) ? 1 : 0;
      idx.push(a, c, b, b, c, d);
      kind.push(g, g);
    }
  }
  // Ends are closed with a blunt point, the way a twist is finished.
  const cap = (j: number, sign: number): void => {
    t.copy(o.pts[Math.min(j + 1, n - 1)]).sub(o.pts[Math.max(j - 1, 0)]).normalize().multiplyScalar(sign);
    q.copy(o.pts[j]).addScaledVector(t, o.wide(j) * 0.7);
    const tip = pos.length / 3;
    pos.push(q.x, q.y, q.z);
    for (let i = 0; i < o.seg; i++) {
      const a = j * cols + i;
      const b = j * cols + (half ? i + 1 : (i + 1) % o.seg);
      if (sign > 0) idx.push(b, a, tip);
      else idx.push(a, b, tip);
      kind.push(0);
    }
  };
  if (o.capStart) cap(0, -1);
  if (o.capEnd) cap(n - 1, 1);

  // Smooth normals over the whole rope, then part it into the two tones.
  const whole = new THREE.BufferGeometry();
  whole.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  whole.setIndex(idx);
  whole.computeVertexNormals();
  const nor = whole.getAttribute('normal');
  const part = (want: number): THREE.BufferGeometry | null => {
    const map = new Map<number, number>();
    const p2: number[] = [];
    const n2: number[] = [];
    const i2: number[] = [];
    for (let f = 0; f < kind.length; f++) {
      if (kind[f] !== want) continue;
      for (let k = 0; k < 3; k++) {
        const v = idx[f * 3 + k];
        let m = map.get(v);
        if (m === undefined) {
          m = p2.length / 3;
          map.set(v, m);
          p2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
          n2.push(nor.getX(v), nor.getY(v), nor.getZ(v));
        }
        i2.push(m);
      }
    }
    if (i2.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n2, 3));
    g.setIndex(i2);
    return g;
  };
  return { strand: part(0), groove: part(1) };
}

// ---------------------------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------------------------

export const HEAD_FRAMES = { lids: 1, count: 2 };
/** How far the lids travel to close. */
export const LID_DROP = 0.0186;

export interface HeadBuild {
  skin: Skin;
  /** Middle of the cuff, head space. The bunch swings about it. */
  tie: THREE.Vector3;
}

export function buildHead(kit: InkKit, q: Detail, ids: Ids, hs: HairSpec): HeadBuild {
  const sb = new SkinBuilder(kit.builder());
  const sk = new Loft(SKULL, q.seg(16), { step: q.step(0.024) });
  // The skin keeps a little of its own colour in the shade, so his face still reads with the sun behind him.
  sb.add(sk.geometry(), { color: C.skin, id: ids.skin, flat: SKIN_FLAT });

  // Ears.
  for (const s of [-1, 1]) {
    sb.add(geo.sphere(0.027, q.low ? 6 : 8, q.low ? 4 : 6), { color: C.skin, id: ids.skin, pos: [s * 0.086, 0.082, 0.016], scale: [0.3, 1, 0.66], rot: [0, s * 0.5, s * -0.08], flat: SKIN_FLAT });
    sb.add(geo.sphere(0.012, 6, 4), { color: SKIN_DEEP, pos: [s * 0.0935, 0.083, 0.011], scale: [0.3, 1, 0.66], rot: [0, s * 0.5, 0], flat: 0.5, outline: false });
  }

  // Nose: narrow at the bridge, broad and round at the tip, half sunk into the face. Smooth, so the
  // light draws its planes and the pen only its edge.
  {
    const zf = (y: number): number => sk.pointXY(-1, 0, y, 0, V()).z;
    const ring = (y: number, rx: number, rz: number): Ring => ({ y, rx, rz, z: zf(y) + rz * 0.25, n: 2 });
    sb.add(
      new Loft([ring(0.047, 0.002, 0.002), ring(0.052, 0.0175, 0.014), ring(0.061, 0.0205, 0.0195), ring(0.071, 0.0135, 0.015), ring(0.081, 0.008, 0.0075), ring(0.089, 0.0055, 0.003), ring(0.094, 0.002, 0.002)], q.low ? 6 : 8).geometry(),
      { color: C.skin, id: ids.skin, flat: SKIN_FLAT },
    );
  }

  // Everything else on the face is laid on the skin.
  const on = (lift: number) => (x: number, y: number, out: THREE.Vector3) => void sk.pointXY(-1, x, y, lift, out);
  const lids = (_x: number, _y: number, _z: number, o: BindOut): void => {
    o.a = HEAD_FRAMES.lids;
    o.b = HEAD_FRAMES.lids;
    o.w = 0;
  };
  const EX = 0.0375;
  const EY = 0.1;
  const EW = 0.0188;
  const EH = 0.0086;
  for (const s of [-1, 1]) {
    const almond = (cy: number, grow: number): [number, number][] => {
      const rim: [number, number][] = [];
      const n = q.low ? 8 : 10;
      for (let i = 0; i < n; i++) {
        const t = (TAU * i) / n;
        // The outer corner sits a hair higher than the inner one.
        rim.push([s * EX + Math.cos(t) * (EW + grow), cy + Math.sin(t) * (EH + grow) + s * Math.cos(t) * 0.0016]);
      }
      return rim;
    };
    sb.add(fan(almond(EY, 0), on(0.0015), FRONT, 1), { color: EYE_WHITE, flat: 0.55, outline: false });
    const iris: [number, number][] = [];
    for (let i = 0; i < 8; i++) iris.push([s * EX - 0.001 + Math.cos((TAU * i) / 8) * 0.0084, EY + 0.0004 + Math.sin((TAU * i) / 8) * 0.0084]);
    sb.add(fan(iris, on(0.0024), FRONT, 1), { color: IRIS, flat: 1, outline: false });
    // The lid waits just above the eye, the colour of the skin under it, and slides down to blink.
    sb.add(fan(almond(EY + LID_DROP, 0.0026), on(0.0034), FRONT, 1), { color: C.skin, outline: false, flat: SKIN_FLAT }, lids);
    sb.add(
      sheet(q.low ? 4 : 6, 1, (u, v, out) => {
        const t = Math.PI * (1 - u);
        on(0.0042)(s * EX + Math.cos(t) * (EW + 0.002), EY + Math.sin(t) * (EH + 0.0006) + s * Math.cos(t) * 0.0016 + v * (0.0018 + 0.0022 * Math.sin(t)), out);
      }, FRONT),
      { color: P.ink, flat: 1, outline: false },
      lids,
    );
    // Brow: a soft arch, well clear of the eye, thinning toward the temple.
    sb.add(
      sheet(q.low ? 3 : 5, 1, (u, v, out) => {
        const x = s * lerp(0.015, 0.058, u);
        const y = 0.1265 + 0.0075 * Math.sin(u * 2.5);
        on(0.0046)(x, y + v * lerp(0.0072, 0.0034, u), out);
      }, FRONT),
      { color: BROW, flat: 1, outline: false },
    );
  }
  // Mouth: one dark line, the corners turned up a little, a fuller lower lip under it, a quiet upper one above.
  sb.add(
    sheet(q.low ? 4 : 6, 1, (u, v, out) => {
      const x = lerp(-0.0215, 0.0215, u);
      const k = x / 0.0215;
      on(0.003)(x, 0.0195 + 0.0046 * k * k + 0.0008 * k + v * 0.0036 * (1 - 0.55 * k * k), out);
    }, FRONT),
    { color: LIP_LINE, flat: 1, outline: false },
  );
  const lip = (cy: number, rx: number, ry: number): [number, number][] => {
    const rim: [number, number][] = [];
    for (let i = 0; i < 8; i++) rim.push([Math.cos((TAU * i) / 8) * rx, cy + Math.sin((TAU * i) / 8) * ry]);
    return rim;
  };
  sb.add(fan(lip(0.0128, 0.0155, 0.006), on(0.0018), FRONT, 1), { color: LIP, flat: 0.25, outline: false });
  sb.add(fan(lip(0.0262, 0.017, 0.0038), on(0.0016), FRONT, 1), { color: mix(C.skin, P.ink, 0.16), flat: 0.25, outline: false });

  const tie = buildScalp(sb, sk, hs, q);
  return { skin: sb.build('figure-head', HEAD_FRAMES.count), tie };
}

/** Everything of the hair that sits still on the head: the dark under the twists, the rows, the cuff.
 *  Returns the middle of the cuff. */
function buildScalp(sb: SkinBuilder, sk: Loft, hs: HairSpec, q: Detail): THREE.Vector3 {
  const low = q.low;
  const LIFT = 0.0035;
  const p = V();
  // The scalp under the twists. Its rim is the hairline, so the edge up is one clean line.
  {
    const nu = low ? 20 : 30;
    const nv = low ? 4 : 5;
    sb.add(
      sheet(nu, nv, (u, v, out) => {
        const a = u * TAU;
        const y0 = hairY(a);
        sk.pointAY(a, lerp(y0, CROWN - 0.0006, Math.pow(v, 0.85)), LIFT, out);
      }, V(0, 1, 0)),
      { color: SCALP, flat: 0.15, outline: false },
    );
  }

  // Directions on the egg, measured from the tie: bearing psi (0 goes over the top to the forehead,
  // half a turn goes down to the nape), travel delta radians.
  const dT = V(0, Math.sin(hs.tieElev), Math.cos(hs.tieElev));
  const u0 = V(0, Math.cos(hs.tieElev), -Math.sin(hs.tieElev));
  const spoke = (psi: number, delta: number): THREE.Vector3 =>
    V(Math.sin(delta) * Math.sin(psi), 0, 0).addScaledVector(dT, Math.cos(delta)).addScaledVector(u0, Math.sin(delta) * Math.cos(psi)).normalize();
  const angleOf = (d: THREE.Vector3): number => Math.atan2(d.x, d.z);
  const heightOf = (d: THREE.Vector3): number => Math.min(CROWN - 0.0004, EGG_Y + d.y * EGG_RY);
  const inside = (d: THREE.Vector3): boolean => heightOf(d) > hairY(angleOf(d)) + 0.004;
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
  const onHead = (d: THREE.Vector3, lift: number): THREE.Vector3 => sk.pointAY(angleOf(d), heightOf(d), lift, V());
  const normalAt = (d: THREE.Vector3): THREE.Vector3 => V(d.x / EGG_RX, d.y / EGG_RY, d.z / EGG_RZ).normalize();

  // The rows. Fanned evenly round the tie, each as wide as its slice of the head allows, less the parting.
  const ringGap = (hs.turn / 6) * (low ? 1.5 : 1);
  const step = ringGap / 0.1;
  const gather = (TIE_R * 0.75) / 0.1;
  for (let k = 0; k < hs.rows; k++) {
    const psi = ((k + 0.5) / hs.rows) * TAU;
    const far = edge(psi) - 0.012;
    const rings = Math.max(4, Math.round((far - gather) / step) + 1);
    const pts: THREE.Vector3[] = [];
    const ups: THREE.Vector3[] = [];
    const wide: number[] = [];
    for (let j = 0; j < rings; j++) {
      const delta = lerp(far, gather, j / (rings - 1));
      const d = spoke(psi, delta);
      pts.push(onHead(d, 0.001));
      ups.push(normalAt(d));
      const slice = (0.1 * Math.sin(delta) * Math.PI) / hs.rows;
      wide.push(clamp(slice * hs.rowFill, hs.rowW * 0.3, hs.rowW));
    }
    const root = (j: number): number => (j === 0 ? 0.5 : j === 1 ? 0.88 : 1); // rounded where it leaves the hairline
    const g = twist({
      pts,
      ups,
      wide: (j) => wide[j] * root(j),
      tall: (j) => (hs.rowH + LIFT) * root(j),
      seg: low ? 3 : 4,
      wind: (TAU * ringGap) / hs.turn,
      phase: k * 1.7,
      capStart: true,
      cut: 0.94,
    });
    const id = sb.newId();
    if (g.strand) sb.add(g.strand, { color: HAIR_ROW, id });
    if (g.groove) sb.add(g.groove, { color: HAIR_DARK, id, flat: 0.3 });
  }

  // The cuff: where the rows meet, wrapped round the foot of the bunch and turned the way the
  // bunch leaves. It stands a little off the head on a neck of gathered hair.
  const D = V(0, Math.sin(hs.tieTilt), Math.cos(hs.tieTilt));
  const tie = onHead(dT, 0).addScaledVector(D, TIE_OFF + TIE_LEN * 0.5);
  const hl = TIE_LEN / 2;
  const turnTo: [number, number, number] = [Math.PI / 2 - hs.tieTilt, 0, 0];
  sb.add(
    new Loft(
      [
        { y: -hl - TIE_OFF - 0.02, rx: TIE_R * 1.5, rz: TIE_R * 1.5 },
        { y: -hl - TIE_OFF * 0.4, rx: TIE_R * 1.05, rz: TIE_R * 1.05 },
        { y: -hl + 0.004, rx: TIE_R * 0.82, rz: TIE_R * 0.82 },
      ],
      low ? 8 : 10,
    ).geometry(),
    { color: HAIR_DARK, pos: [tie.x, tie.y, tie.z], rot: turnTo },
  );
  sb.add(
    new Loft(
      [
        { y: -hl - 0.002, rx: TIE_R * 0.6, rz: TIE_R * 0.6 },
        { y: -hl, rx: TIE_R * 0.9, rz: TIE_R * 0.9 },
        { y: -hl * 0.4, rx: TIE_R, rz: TIE_R },
        { y: hl * 0.4, rx: TIE_R, rz: TIE_R },
        { y: hl, rx: TIE_R * 0.9, rz: TIE_R * 0.9 },
        { y: hl + 0.002, rx: TIE_R * 0.6, rz: TIE_R * 0.6 },
      ],
      low ? 8 : 10,
    ).geometry(),
    { color: hs.tie, pos: [tie.x, tie.y, tie.z], rot: turnTo, flat: 0.45 },
  );
  void p;
  return tie;
}

// ---------------------------------------------------------------------------------------------
// The bunch: the free ends, standing off the cuff. Short. A ring of twists opens out round the
// way the cuff points and falls over with its own weight, a few shorter ones fill the middle.
// Built round the middle of the cuff. Each twist bends more toward its tip, so the ends trail.
// ---------------------------------------------------------------------------------------------

export const TAIL_FRAMES = { a: 1, b: 2, count: 3 };

export function buildTail(kit: InkKit, q: Detail, hs: HairSpec, tie: THREE.Vector3): Skin {
  const sb = new SkinBuilder(kit.builder());
  const low = q.low;
  const rnd = geo.seeded(23);
  const D = V(0, Math.sin(hs.tieTilt), Math.cos(hs.tieTilt));
  const X = V(1, 0, 0);
  const B = V().crossVectors(D, X); // up and forward, over the crown
  const ringGap = (hs.turn / 6) * (low ? 1.45 : 1);
  const nIn = Math.max(1, Math.round(hs.twists * 0.3));
  const nOut = Math.max(3, hs.twists - nIn - (low ? 1 : 0));
  const count = nOut + nIn;
  const P0 = V();
  const P1 = V();
  const P2 = V();
  const P3 = V();
  const F = V();
  const G = V();
  const qv = V();
  for (let k = 0; k < count; k++) {
    const inner = k >= nOut;
    // phi runs round the cuff. A quarter turn points over the crown, three quarters down the back.
    const phi = inner ? ((k - nOut + 0.25) / nIn) * TAU + 0.6 : ((k + 0.5) / nOut) * TAU;
    // Most of them lie together and fall back. Three stand away from the bundle and keep their curl.
    const stray = !inner && (k === 0 || k === 3 || k === 5);
    const open = (inner ? 0.32 : stray ? 1.75 : 1) * hs.spread * (0.92 + rnd() * 0.16);
    const overCrown = Math.sin(phi); // +1 leans over the top of the head, -1 hangs behind it
    // The ones that hang behind are the shortest, so nothing comes down toward the collar.
    const len = hs.twistLen * (inner ? 0.8 : lerp(0.74, 1, overCrown * 0.5 + 0.5)) * (0.95 + rnd() * 0.1);
    F.copy(D).multiplyScalar(Math.cos(open)).addScaledVector(X, Math.cos(phi) * Math.sin(open)).addScaledVector(B, Math.sin(phi) * Math.sin(open)).normalize();
    // Weight takes the end over: down, and back away from the head.
    G.set(Math.cos(phi) * 0.4, -1, 0.8).normalize();
    const droop = inner ? 0.3 : stray ? 0.16 : lerp(0.66, 0.5, overCrown * 0.5 + 0.5);
    P0.copy(D).multiplyScalar(-TIE_LEN * 0.45).addScaledVector(X, Math.cos(phi) * TIE_R * 0.35).addScaledVector(B, Math.sin(phi) * TIE_R * 0.35);
    P1.copy(P0).addScaledVector(D, TIE_LEN * 0.95 + 0.006);
    P2.copy(P1).addScaledVector(F, len * 0.5);
    qv.copy(F).multiplyScalar(1 - droop).addScaledVector(G, droop).normalize();
    P3.copy(P2).addScaledVector(qv, len * 0.42);
    // Walk the curve, then space the rings evenly along it.
    const fine: THREE.Vector3[] = [];
    const run: number[] = [0];
    for (let n = 0; n <= 36; n++) {
      const s = n / 36;
      const r = 1 - s;
      qv.set(0, 0, 0).addScaledVector(P0, r * r * r).addScaledVector(P1, 3 * r * r * s).addScaledVector(P2, 3 * r * s * s).addScaledVector(P3, s * s * s);
      // Keep it off the head: push any point that dips into the hair straight out again.
      const hx = (qv.x + tie.x) / (EGG_RX + 0.018 + hs.twistR);
      const hy = (qv.y + tie.y - EGG_Y) / (EGG_RY + 0.018 + hs.twistR);
      const hz = (qv.z + tie.z) / (EGG_RZ + 0.018 + hs.twistR);
      const f = Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (f < 1) {
        const k2 = lerp(1, 1 / f, smoothstep(0.3, 0.55, s));
        qv.set((qv.x + tie.x) * k2 - tie.x, (qv.y + tie.y - EGG_Y) * k2 + EGG_Y - tie.y, (qv.z + tie.z) * k2 - tie.z);
      }
      if (n > 0) run.push(run[n - 1] + qv.distanceTo(fine[n - 1]));
      fine.push(qv.clone());
    }
    const total = run[36];
    const rings = Math.max(5, Math.round(total / ringGap) + 1);
    const pts: THREE.Vector3[] = [];
    let seg = 1;
    for (let j = 0; j < rings; j++) {
      const at = (total * j) / (rings - 1);
      while (seg < 36 && run[seg] < at) seg++;
      pts.push(fine[seg - 1].clone().lerp(fine[seg], clamp((at - run[seg - 1]) / Math.max(1e-6, run[seg] - run[seg - 1]), 0, 1)));
    }
    const thick = hs.twistR * (inner ? 0.94 : 1) * (0.95 + rnd() * 0.1);
    const taper = (j: number): number => {
      const left = rings - 1 - j;
      if (j < 2) return j === 0 ? 0.6 : 0.86; // squeezed where the cuff holds it
      return left === 0 ? 0.66 : left === 1 ? 0.9 : 1;
    };
    const g = twist({
      pts,
      wide: (j) => thick * taper(j),
      tall: (j) => thick * taper(j),
      seg: low ? 6 : 8,
      wind: (TAU * ringGap) / hs.turn,
      phase: k * 2.1,
      capEnd: true,
    });
    // The further along the twist, the more it follows the swing.
    const frame = k % 2 === 0 ? TAIL_FRAMES.a : TAIL_FRAMES.b;
    const bend = (x: number, y: number, z: number, o: BindOut): void => {
      const d = Math.sqrt(x * x + y * y + z * z);
      o.a = 0;
      o.b = frame;
      o.w = Math.pow(clamp((d - TIE_LEN * 0.6) / (hs.twistLen * 0.8), 0, 1), 1.15);
    };
    const id = sb.newId();
    if (g.strand) sb.add(g.strand, { color: HAIR_LIT, id }, bend);
    if (g.groove) sb.add(g.groove, { color: HAIR_DARK, id, flat: 0.3 }, bend);
  }
  return sb.build('figure-tail', TAIL_FRAMES.count);
}
