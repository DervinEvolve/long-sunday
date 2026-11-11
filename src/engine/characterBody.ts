// The figure from the neck down: what he wears and how it is cut. Every function here builds one
// mesh round its own joint. Sizes in metres. He faces -z, his right is +x, index 0 is his left.
import * as THREE from 'three';
import type { ColorLike, InkKit } from '../types';
import * as geo from './geo';
import { smoothstep } from './util';
import { palette as P } from '../world/palette';
import { Loft, hose, sheet, type Ring } from './characterGeo';
import { SkinBuilder, type BindOut, type Skin } from './characterSkin';

export const mix = (a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, k: number): string =>
  '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

// ---------------------------------------------------------------------------------------------
// Skeleton. About 1.72 m to the crown, a little under seven heads, long in the leg.
// ---------------------------------------------------------------------------------------------

export const ANKLE = 0.115; // ankle joint above the sole
export const BALL = 0.16; // ball of the foot ahead of the ankle
export const HEEL = 0.095; // heel behind the ankle
export const SHIN = 0.435;
export const THIGH = 0.45;
export const REACH = THIGH + SHIN - 0.004;
export const HIP_W = 0.082; // half the distance between the hip joints
export const HIP_DROP = 0.03; // hip joints sit this far under the pelvis pivot
export const STAND = 1.018; // pelvis pivot height standing easy, knees a touch soft
export const SPINE_UP = 0.072; // chest pivot above the pelvis pivot
export const NECK_UP = 0.402; // head pivot above the chest pivot
export const SHOULDER_X = 0.192;
export const SHOULDER_Y = 0.296;
export const UPPER_ARM = 0.285;
export const FOREARM = 0.25;

// ---------------------------------------------------------------------------------------------
// His colours. Orange shell first, so he is easy to find in a green city. The rest sits back:
// bone tee, indigo trousers, off-white shoes, teal for the things that strap on.
// ---------------------------------------------------------------------------------------------

export const C = {
  shell: P.orange as string,
  shellDeep: mix(P.orange, P.red, 0.5),
  lining: '#2b2857',
  tee: mix(P.bone, P.lavender, 0.1),
  trouser: '#373475',
  trouserLight: '#4a4790',
  trouserDark: '#27244f',
  trouserInner: '#2e2b61',
  shoe: P.stone as string,
  shoeShade: mix(P.stone, P.lavender, 0.55),
  mid: P.paper as string,
  strap: P.tealDeep as string,
  teal: P.teal as string,
  mint: P.mint as string,
  yellow: P.yellow as string,
  print: P.paper as string,
  skin: P.skin as string,
  palm: mix(P.skin, P.sand, 0.22),
  groundShade: mix(P.sand, P.shadow, 0.42),
};

export interface Detail {
  low: boolean;
  /** Columns round a loft. */
  seg(n: number): number;
  /** Longest gap between rings. */
  step(s: number): number;
}

export function detail(low: boolean): Detail {
  const d = low ? 0.6 : 1;
  return { low, seg: (n) => Math.max(6, Math.round((n * d) / 2) * 2), step: (s) => s / d };
}

/** Outline groups shared between meshes, so cloth that runs from one mesh to the next has no line at the join. */
export interface Ids {
  skin: number;
  seat: number;
}

const V = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const BACK = V(0, 0, 1);
const FRONT = V(0, 0, -1);

// ---------------------------------------------------------------------------------------------
// Hips: the seat of the trousers, the tee that hangs out under the shell, and the strap off his belt.
// Built round the pelvis. The top of the tee follows the chest, the hem follows the thighs.
// ---------------------------------------------------------------------------------------------

// Each thigh has two frames: one that only follows it forward (for the front of the hem) and one
// that only follows it back (for the seat side), so the cloth is pushed out and never pulled in.
export const HIP_FRAMES = { chest: 1, sway: 2, frontL: 3, frontR: 4, backL: 5, backR: 6, strap: 7, count: 8 };
export const WAIST = SPINE_UP;
const TEE_TURN = -0.004;
export const STRAP_AT: readonly [number, number, number] = [-0.187, 0.014, 0.03];

export function buildHips(kit: InkKit, q: Detail, ids: Ids): Skin {
  const sb = new SkinBuilder(kit.builder());
  const F = HIP_FRAMES;

  const seat = new Loft(
    [
      { y: -0.168, rx: 0.02, rz: 0.02 },
      { y: -0.152, rx: 0.088, rz: 0.084 },
      { y: -0.09, rx: 0.158, rz: 0.114, n: 2.3 },
      { y: -0.01, rx: 0.166, rz: 0.116, n: 2.4 },
      { y: 0.06, rx: 0.154, rz: 0.114, n: 2.2 },
      { y: 0.1, rx: 0.144, rz: 0.106 },
    ],
    q.seg(14),
    { step: q.step(0.05) },
  );
  sb.add(seat.geometry(), { color: C.trouser, id: ids.seat });

  // The tee. Only a band of it shows under the shell: short in front, dropped a hand lower behind.
  const tee = new Loft(
    [
      { y: -0.042, rx: 0.166, rz: 0.116, ty: -0.022 },
      { y: -0.05, rx: 0.187, rz: 0.135, n: 2.3, ty: -0.024 },
      { y: -0.012, rx: 0.181, rz: 0.13, n: 2.3, ty: -0.01 },
      { y: WAIST, rx: 0.16, rz: 0.112, n: 2.2 },
      { y: 0.17, rx: 0.162, rz: 0.118 },
      { y: 0.24, rx: 0.158, rz: 0.114 },
    ],
    q.low ? 16 : 18,
    { step: q.step(0.042) },
  );
  const cloth = (x: number, y: number, z: number, o: BindOut): void => {
    // From the shell's hem up the tee goes with the chest, so it never shows through the shell
    // when his hips tip one way and his shoulders the other. Below that it goes with the hips,
    // and the hem with the thighs.
    if (y >= TEE_TURN) {
      o.a = F.chest;
      o.b = F.sway;
      o.w = 1 - smoothstep(TEE_TURN, TEE_TURN + 0.045, y);
    } else {
      o.a = F.sway;
      o.b = z < 0 ? (x < 0 ? F.frontL : F.frontR) : x < 0 ? F.backL : F.backR;
      o.w = smoothstep(TEE_TURN, -0.04, y) * smoothstep(0, 0.06, Math.abs(x)) * smoothstep(0.01, 0.07, Math.abs(z));
    }
  };
  sb.add(tee.geometry(), { color: C.tee, flat: 0.12 }, cloth);
  // What breaks up the pale band: one printed line round it, a finger above the hem, and a tag in front.
  {
    const p = V();
    const n = q.low ? 16 : 18;
    for (const half of [0, 1]) {
      sb.add(
        sheet(n / 2, 1, (u, v, o) => void o.copy(tee.pointAY((half + u - 0.5) * Math.PI, -0.038 + v * 0.011, 0.0025, p)), half === 0 ? BACK : FRONT),
        { color: C.strap, flat: 0.5, outline: false },
        cloth,
      );
    }
    sb.add(sheet(1, 1, (u, v, o) => void o.copy(tee.pointXY(-1, 0.086 + u * 0.034, -0.02 + v * 0.03, 0.004, p)), FRONT), { color: C.yellow, flat: 0.5, outline: false }, cloth);
  }

  // A length of webbing off the belt, down the outside of his left leg. It hangs clear of the tee.
  const rigid = (f: number) => (_x: number, _y: number, _z: number, o: BindOut) => {
    o.a = f;
    o.b = f;
    o.w = 0;
  };
  const [ax, ay, az] = STRAP_AT;
  const web = hose([V(ax + 0.004, ay + 0.03, az), V(ax, ay, az), V(ax - 0.008, ay - 0.09, az + 0.006), V(ax - 0.012, ay - 0.2, az + 0.008), V(ax - 0.012, ay - 0.31, az + 0.008)], 0.015, 6, 0.28, V(1, 0, 0));
  const webId = sb.add(web, { color: C.teal, flat: 0.25 }, rigid(F.strap));
  sb.add(geo.box(0.014, 0.04, 0.036), { color: C.yellow, pos: [ax - 0.012, ay - 0.345, az + 0.008], id: webId, flat: 0.5 }, rigid(F.strap));
  return sb.build('figure-hips', F.count);
}

// ---------------------------------------------------------------------------------------------
// Chest: the shell. Cropped at the waist, boxy, a stand collar, panels with taped seams, and the
// print across the back. This is the part the visitor looks at all day.
// ---------------------------------------------------------------------------------------------

export interface ChestBuild {
  mesh: THREE.Mesh;
  /** Where the pouch hangs from, and which way it faces. */
  bagAt: THREE.Vector3;
  bagTurn: THREE.Quaternion;
}

const SHELL: readonly Ring[] = [
  { y: -0.018, rx: 0.175, rz: 0.123, n: 2.1 },
  { y: -0.036, rx: 0.183, rz: 0.13, n: 2.15, ty: -0.005 },
  { y: 0.0, rx: 0.185, rz: 0.132, n: 2.15, ty: -0.004 },
  { y: 0.022, rx: 0.198, rz: 0.142, n: 2.2 },
  { y: 0.13, rx: 0.21, rz: 0.153, n: 2.25, b: 1.05, f: 0.97 },
  { y: 0.24, rx: 0.212, rz: 0.157, n: 2.25, b: 1.1 },
  { y: 0.308, rx: 0.196, rz: 0.14, n: 2.2, b: 1.08 },
  { y: 0.352, rx: 0.15, rz: 0.116, n: 2.1 },
  { y: 0.385, rx: 0.105, rz: 0.098 },
  { y: 0.405, rx: 0.08, rz: 0.082 },
];
const HEM = 0.006;
// The shell keeps some of its orange in the shade. He has to be easy to find with the sun behind him.
const SHELL_FLAT = 0.2;
const strapY = (a: number): number => 0.192 + 0.176 * Math.sin(a);

export function buildChest(kit: InkKit, q: Detail, ids: Ids): ChestBuild {
  const b = kit.builder();
  const sh = new Loft(SHELL, q.seg(20), { step: q.step(0.036) });
  const isSide = (a: number): boolean => Math.abs(Math.sin(a)) > 0.74;
  const SIDE_TOP = 0.25;

  // Panels. Each has its own outline, so every seam is a drawn line: a ribbed band at the hem,
  // a darker panel under each arm, and the body.
  const bodyId = b.newId();
  b.add(sh.geometry((_j, _i, _a, y) => y < HEM), { color: C.lining, flat: 0.2 });
  b.add(sh.geometry((_j, _i, a, y) => y >= HEM && y < SIDE_TOP && isSide(a)), { color: C.shellDeep, flat: SHELL_FLAT });
  b.add(sh.geometry((_j, _i, a, y) => y >= HEM && !(y < SIDE_TOP && isSide(a))), { color: C.shell, id: bodyId, flat: SHELL_FLAT });

  // The print: a low sun, the bottom of it cut into bars. No words.
  const onBack = (lift: number) => (x: number, y: number, out: THREE.Vector3) => void sh.pointXY(1, x, y, lift, out);
  const R = 0.092;
  const y0 = 0.128;
  {
    // The top half of the disc, laid in rings so it follows the curve of his back.
    const n = q.low ? 8 : 14;
    const print = onBack(0.005);
    b.add(
      sheet(n, 3, (u, v, out) => print(Math.cos(Math.PI * u) * R * v, y0 + Math.sin(Math.PI * u) * R * v, out), BACK),
      { color: C.print, flat: 0.12, outline: false },
    );
    for (const [top, bottom] of [
      [0.012, 0.034],
      [0.046, 0.06],
      [0.071, 0.079],
    ]) {
      const at = onBack(0.005);
      b.add(
        sheet(
          q.low ? 4 : 6,
          1,
          (u, v, out) => {
            const y = y0 - (top + (bottom - top) * v);
            const half = Math.sqrt(Math.max(0, R * R - (y0 - y) * (y0 - y)));
            at((u * 2 - 1) * half, y, out);
          },
          BACK,
        ),
        { color: C.print, flat: 0.12, outline: false },
      );
    }
  }

  // A storm flap over the shoulder blades: a second layer of cloth, its lower edge a drawn line
  // that dips in the middle. And a small tab under the collar.
  {
    const half = (y: number): number => Math.min(0.172, sh.pointAY(Math.PI / 2, y, 0, V()).x * 0.87);
    const at = onBack(0.006);
    b.add(
      sheet(
        q.low ? 6 : 10,
        q.low ? 3 : 4,
        (u, v, out) => {
          const k = u * 2 - 1;
          const bottom = 0.256 + 0.02 * k * k;
          const y = bottom + (0.378 - bottom) * v;
          at(k * half(y), y, out);
        },
        BACK,
      ),
      { color: C.shell, flat: SHELL_FLAT },
    );
    b.add(sheet(1, 1, (u, v, out) => onBack(0.009)((u * 2 - 1) * 0.013, 0.332 + v * 0.026, out), BACK), { color: C.teal, flat: 0.5, outline: false });
  }

  // Stand collar, open at the throat, lined dark.
  const collar: Ring[] = [
    { y: 0.372, rx: 0.1, rz: 0.098, z: 0.004 },
    { y: 0.408, rx: 0.092, rz: 0.095, z: 0.008, ty: 0.003 },
    { y: 0.434, rx: 0.094, rz: 0.098, z: 0.011, ty: 0.007 },
  ];
  const open = 0.62;
  const arc = { from: -Math.PI + open, to: Math.PI - open, step: q.step(0.03) };
  b.add(new Loft(collar, q.seg(14), arc).geometry(), { color: C.shell, id: bodyId, flat: SHELL_FLAT });
  b.add(new Loft(collar.map((r) => ({ ...r, rx: r.rx - 0.007, rz: r.rz - 0.007 })), q.seg(14), arc).geometry(), { color: C.lining, flat: 0.4, outline: false });

  // Neck.
  b.add(
    new Loft(
      [
        { y: 0.34, rx: 0.054, rz: 0.054 },
        { y: 0.4, rx: 0.047, rz: 0.05, z: -0.002 },
        { y: 0.47, rx: 0.046, rz: 0.05, z: -0.006 },
      ],
      q.seg(10),
    ).geometry(),
    { color: C.skin, id: ids.skin, flat: 0.3 },
  );

  // Front: the zip, a pull, a pocket zip on his left, a square tab on his right.
  const onFront = (lift: number) => (x: number, y: number, out: THREE.Vector3) => void sh.pointXY(-1, x, y, lift, out);
  const strip = (at: (x: number, y: number, out: THREE.Vector3) => void, x0: number, x1: number, ya: number, yb: number, n: number, face: THREE.Vector3): THREE.BufferGeometry =>
    sheet(1, n, (u, v, out) => at(x0 + (x1 - x0) * u, ya + (yb - ya) * v, out), face);
  b.add(strip(onFront(0.003), -0.006, 0.006, -0.03, 0.372, q.low ? 5 : 9, FRONT), { color: C.lining, flat: 0.6, outline: false });
  b.add(strip(onFront(0.006), -0.011, 0.011, 0.31, 0.342, 1, FRONT), { color: C.yellow, flat: 0.5, outline: false });
  b.add(strip(onFront(0.004), -0.116, -0.108, 0.15, 0.24, 2, FRONT), { color: C.strap, flat: 0.6, outline: false });
  b.add(strip(onFront(0.004), 0.085, 0.122, 0.2, 0.237, 1, FRONT), { color: C.print, flat: 0.3, outline: false });

  // The sling: a strap over his right shoulder, across the back, down to his left hip and round.
  const N = q.low ? 22 : 34;
  const pos: number[] = [];
  const idx: number[] = [];
  const p = V();
  const pn = V();
  const pp = V();
  const t = V();
  const nrm = V();
  const s = V();
  const HW = 0.017;
  const TH = 0.007;
  for (let i = 0; i < N; i++) {
    const a = (TAU * i) / N;
    const da = TAU / N / 4;
    sh.pointAY(a, strapY(a), 0.007, p);
    sh.pointAY(a + da, strapY(a + da), 0.007, pn);
    sh.pointAY(a - da, strapY(a - da), 0.007, pp);
    t.copy(pn).sub(pp).normalize();
    nrm.set(p.x, 0, p.z).normalize();
    // Over the shoulder the cloth faces up as much as out.
    nrm.y = smoothstep(0.29, 0.39, p.y) * 1.2;
    nrm.addScaledVector(t, -nrm.dot(t)).normalize();
    s.crossVectors(t, nrm).normalize();
    for (const [w, h] of [
      [-1, 0],
      [-1, 1],
      [1, 1],
      [1, 0],
    ]) {
      pos.push(p.x + s.x * HW * w + nrm.x * TH * h, p.y + s.y * HW * w + nrm.y * TH * h, p.z + s.z * HW * w + nrm.z * TH * h);
    }
  }
  for (let i = 0; i < N; i++) {
    const i1 = (i + 1) % N;
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k;
      const c = i * 4 + k + 1;
      const d = i1 * 4 + k;
      const e = i1 * 4 + k + 1;
      idx.push(a, c, d, c, e, d);
    }
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.setIndex(idx);
  band.computeVertexNormals();
  b.add(band, { color: C.strap, flat: 0.3 });
  // A slider on the strap, high on the back.
  {
    const a = 0.62;
    sh.pointAY(a, strapY(a), 0.017, p);
    b.add(geo.box(0.042, 0.026, 0.012), { color: C.yellow, pos: [p.x, p.y - 0.013, p.z], rot: [0, a * 0.8, 0.72], flat: 0.5 });
  }

  // Where the pouch rides: low on the back, his left.
  const ab = -0.95;
  const da = 0.02;
  const bagAt = V();
  sh.pointAY(ab, strapY(ab), 0.012, bagAt);
  sh.pointAY(ab + da, strapY(ab + da), 0.012, pn);
  sh.pointAY(ab - da, strapY(ab - da), 0.012, pp);
  const bx = pn.sub(pp).normalize();
  const bz = V(bagAt.x, 0, bagAt.z).normalize();
  bz.addScaledVector(bx, -bz.dot(bx)).normalize();
  const by = V().crossVectors(bz, bx);
  const bagTurn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, by, bz));
  return { mesh: b.build('figure-chest'), bagAt, bagTurn };
}

/** The pouch. Built hanging from its top edge: x runs along the strap, z points away from his back. */
export function buildBag(kit: InkKit): THREE.Mesh {
  const b = kit.builder();
  const body = b.newId();
  b.add(geo.bevelBox(0.205, 0.118, 0.062, 0.024), { color: C.teal, pos: [0, -0.1, 0.034], id: body });
  b.add(geo.bevelBox(0.209, 0.056, 0.016, 0.006), { color: C.mint, pos: [0, -0.04, 0.062], id: body, flat: 0.2 });
  b.add(geo.box(0.034, 0.03, 0.012), { color: C.yellow, pos: [0, -0.052, 0.074], flat: 0.5 });
  return b.build('figure-bag');
}

// ---------------------------------------------------------------------------------------------
// Arm: one sleeve from shoulder to cuff, bending at the elbow, and a hand that is a size too big.
// Built hanging straight down from the shoulder.
// ---------------------------------------------------------------------------------------------

export const ARM_FRAMES = { fore: 1, hand: 2, count: 3 };
const WRIST = UPPER_ARM + FOREARM;

export function buildArm(kit: InkKit, q: Detail, side: number, ids: Ids): Skin {
  const sb = new SkinBuilder(kit.builder());
  const F = ARM_FRAMES;
  const sleeve = new Loft(
    [
      { y: -WRIST, rx: 0.034, rz: 0.038 },
      { y: -WRIST + 0.006, rx: 0.042, rz: 0.046 },
      { y: -WRIST + 0.034, rx: 0.043, rz: 0.047 },
      { y: -WRIST + 0.04, rx: 0.053, rz: 0.057 },
      { y: -WRIST + 0.08, rx: 0.055, rz: 0.06 },
      { y: -0.41, rx: 0.054, rz: 0.059 },
      { y: -UPPER_ARM, rx: 0.057, rz: 0.062 },
      { y: -0.17, rx: 0.062, rz: 0.068 },
      { y: -0.06, rx: 0.066, rz: 0.073, x: side * 0.002 },
      { y: -0.005, rx: 0.066, rz: 0.073, x: -side * 0.004 },
      { y: 0.03, rx: 0.057, rz: 0.064, x: -side * 0.014 },
      { y: 0.053, rx: 0.036, rz: 0.042, x: -side * 0.028 },
      { y: 0.063, rx: 0.006, rz: 0.008, x: -side * 0.04 },
    ],
    q.seg(10),
    { step: q.step(0.04) },
  );
  const elbow = (_x: number, y: number, _z: number, o: BindOut): void => {
    o.a = 0;
    o.b = F.fore;
    o.w = smoothstep(-UPPER_ARM + 0.05, -UPPER_ARM - 0.05, y);
  };
  const cuffTop = -WRIST + 0.037;
  sb.add(sleeve.geometry((_j, _i, _a, y) => y >= cuffTop), { color: C.shell, flat: SHELL_FLAT }, elbow);
  sb.add(sleeve.geometry((_j, _i, _a, y) => y < cuffTop), { color: C.lining, flat: 0.2 }, elbow);

  if (side < 0) {
    // A square patch on the outside of his left sleeve.
    const p = V();
    const out = V(-1, 0, 0);
    const a0 = -Math.PI / 2;
    const patch = (half: number, ya: number, yb: number, lift: number, n: number): THREE.BufferGeometry =>
      sheet(n, 1, (u, v, o) => void o.copy(sleeve.pointAY(a0 + (u * 2 - 1) * half, ya + (yb - ya) * v, lift, p)), out);
    sb.add(patch(0.5, -0.17, -0.105, 0.003, 3), { color: C.print, flat: 0.25, outline: false });
    sb.add(patch(0.2, -0.152, -0.123, 0.005, 1), { color: C.teal, flat: 0.5, outline: false });
  }

  // Hand. Palm toward the leg, thumb to the front. The palm is one block and the fingers hang off
  // it thinner, so the knuckles are a step in the outline. The first finger is its own shape, the
  // other three go together, and all of them curl in toward the leg.
  const m = -side; // the way the palm faces
  const wrist = (_x: number, _y: number, _z: number, o: BindOut): void => {
    o.a = F.hand;
    o.b = F.hand;
    o.w = 0;
  };
  const W = -WRIST;
  const palm = new Loft(
    [
      { y: W + 0.012, rx: 0.021, rz: 0.028 },
      { y: W - 0.024, rx: 0.02, rz: 0.037, n: 2.5 },
      { y: W - 0.058, rx: 0.019, rz: 0.042, n: 2.7 },
      { y: W - 0.088, rx: 0.018, rz: 0.041, n: 2.8 },
      { y: W - 0.096, rx: 0.012, rz: 0.035, n: 2.6 },
      { y: W - 0.098, rx: 0.003, rz: 0.012 },
    ],
    q.seg(8),
    { step: q.step(0.03) },
  );
  const three = new Loft(
    [
      { y: W - 0.086, rx: 0.011, rz: 0.026, z: 0.013, x: m * 0.002, n: 2.6 },
      { y: W - 0.114, rx: 0.0115, rz: 0.026, z: 0.013, x: m * 0.006, n: 2.6 },
      { y: W - 0.141, rx: 0.0105, rz: 0.025, z: 0.013, x: m * 0.016, n: 2.6 },
      { y: W - 0.162, rx: 0.009, rz: 0.022, z: 0.012, x: m * 0.03, n: 2.4 },
      { y: W - 0.169, rx: 0.003, rz: 0.009, z: 0.012, x: m * 0.036 },
    ],
    q.seg(8),
  );
  const first = new Loft(
    [
      { y: W - 0.086, rx: 0.0105, rz: 0.0115, z: -0.03, x: m * 0.001 },
      { y: W - 0.117, rx: 0.0105, rz: 0.0115, z: -0.031, x: m * 0.003 },
      { y: W - 0.146, rx: 0.0095, rz: 0.0105, z: -0.032, x: m * 0.009 },
      { y: W - 0.167, rx: 0.0085, rz: 0.0095, z: -0.032, x: m * 0.018 },
      { y: W - 0.174, rx: 0.003, rz: 0.004, z: -0.032, x: m * 0.022 },
    ],
    6,
  );
  const gloved = side < 0;
  const palmId = gloved ? sb.newId() : ids.skin;
  // One utility glove, fingers cut off, a small pad on the back of the wrist.
  sb.add(palm.geometry(), gloved ? { color: C.teal, id: palmId } : { color: C.skin, id: palmId, flat: 0.25 }, wrist);
  sb.add(three.geometry(), { color: C.skin, flat: 0.25 }, wrist);
  sb.add(first.geometry(), { color: C.skin, flat: 0.25 }, wrist);
  if (gloved) sb.add(geo.bevelBox(0.01, 0.026, 0.04, 0.003), { color: C.mint, pos: [side * 0.021, W - 0.03, 0.002], id: palmId, flat: 0.3 }, wrist);
  const thumb = hose([V(m * 0.003, W - 0.03, -0.031), V(m * 0.01, W - 0.062, -0.055), V(m * 0.019, W - 0.093, -0.063)], (t) => 0.013 - t * 0.003, 6);
  sb.add(thumb, { color: gloved ? C.teal : C.skin, id: palmId, flat: gloved ? 0 : 0.25 }, wrist);
  return sb.build('figure-arm', F.count);
}

// ---------------------------------------------------------------------------------------------
// Leg: one trouser leg from hip to cuff, bending at the knee. Cargo cut, tapered to the ankle,
// a little cloth stacked over the shoe. Built hanging straight down from the hip joint.
// ---------------------------------------------------------------------------------------------

export const LEG_FRAMES = { shin: 1, count: 2 };
const SEAT_CUT = -0.07;

export function buildLeg(kit: InkKit, q: Detail, side: number, ids: Ids): Skin {
  const sb = new SkinBuilder(kit.builder());
  const F = LEG_FRAMES;
  const L = THIGH + SHIN;
  // The trousers break higher on the shoe than they did, so the heel and its pull show from behind.
  const leg = new Loft(
    [
      { y: -L + 0.064, rx: 0.045, rz: 0.05 },
      { y: -L + 0.071, rx: 0.053, rz: 0.059 },
      { y: -L + 0.096, rx: 0.054, rz: 0.06 },
      { y: -L + 0.103, rx: 0.066, rz: 0.073, z: 0.003 },
      { y: -L + 0.136, rx: 0.062, rz: 0.069, z: 0.002 },
      { y: -L + 0.168, rx: 0.069, rz: 0.076, z: 0.003 },
      { y: -L + 0.3, rx: 0.074, rz: 0.082 },
      { y: -THIGH - 0.06, rx: 0.078, rz: 0.086 },
      { y: -THIGH, rx: 0.083, rz: 0.09, z: -0.006 },
      { y: -THIGH + 0.08, rx: 0.086, rz: 0.094, z: -0.002 },
      { y: -0.2, rx: 0.092, rz: 0.102, tx: side * 0.014 },
      // This ring is tipped: high on the outside of the hip, low at the crotch. It is the seam
      // where the leg leaves the seat, so the line it draws is the fold under the seat.
      { y: SEAT_CUT, rx: 0.094, rz: 0.106, n: 2.2, tx: side * 0.06 },
      { y: 0.035, rx: 0.084, rz: 0.094, tx: side * 0.01 },
      { y: 0.075, rx: 0.05, rz: 0.056 },
      { y: 0.088, rx: 0.006, rz: 0.006 },
    ],
    q.seg(12),
    { step: q.step(0.05) },
  );
  const knee = (_x: number, y: number, _z: number, o: BindOut): void => {
    o.a = 0;
    o.b = F.shin;
    o.w = smoothstep(-THIGH + 0.06, -THIGH - 0.06, y);
  };
  const cuffTop = -L + 0.1;
  const cutRow = leg.rings.findIndex((r) => Math.abs(r.y - SEAT_CUT) < 1e-9);
  // Above the fold the cloth is one piece with the seat. Below it each leg is its own shape, so
  // there is a line between the two legs from behind, and the inside of each is a tone darker.
  const own = sb.newId();
  const inner = (a: number): boolean => Math.sin(a) * side < -0.55;
  sb.add(leg.geometry((j) => j >= cutRow), { color: C.trouser, id: ids.seat }, knee);
  sb.add(leg.geometry((j, _i, a, y) => j < cutRow && y >= cuffTop && !inner(a)), { color: C.trouser, id: own }, knee);
  sb.add(leg.geometry((j, _i, a, y) => j < cutRow && y >= cuffTop && inner(a)), { color: C.trouserInner, id: own }, knee);
  sb.add(leg.geometry((_j, _i, _a, y) => y < cuffTop), { color: C.trouserDark, flat: 0.2 }, knee);
  // One dart across the front of the knee.
  {
    const p = V();
    sb.add(
      sheet(q.low ? 3 : 5, 1, (u, v, o) => void o.copy(leg.pointAY(Math.PI + (u - 0.5) * 1.7, -THIGH + 0.062 - 0.022 * Math.sin(Math.PI * u) + v * 0.0075, 0.002, p)), V(0, 0, -1)),
      { color: C.trouserDark, flat: 1, outline: false },
      knee,
    );
  }

  if (side < 0) {
    // Cargo pocket on the outside of his left thigh: a bellows box with a flap and a pull.
    const pocket = sb.newId();
    sb.add(geo.bevelBox(0.04, 0.155, 0.118, 0.012), { color: C.trouserLight, pos: [-0.1, -0.335, 0.004], rot: [0, 0, -0.03], id: pocket });
    sb.add(geo.bevelBox(0.046, 0.05, 0.124, 0.008), { color: C.trouser, pos: [-0.102, -0.205, 0.004], rot: [0, 0, -0.03] });
    sb.add(geo.box(0.012, 0.03, 0.022), { color: C.teal, pos: [-0.126, -0.215, 0.004], flat: 0.5, outline: false });
  } else {
    // His right leg gets a strap above the knee and a slanted zip.
    const p = V();
    sb.add(
      new Loft(
        [
          { y: -0.352, rx: 0.09, rz: 0.098 },
          { y: -0.322, rx: 0.092, rz: 0.101 },
        ],
        q.seg(12),
      ).geometry(),
      { color: C.teal, flat: 0.3 },
    );
    sb.add(geo.box(0.014, 0.04, 0.03), { color: C.yellow, pos: [0.094, -0.357, 0.012], flat: 0.5 });
    // A pale bar on the back of the calf.
    sb.add(
      sheet(2, 1, (u, v, o) => void o.copy(leg.pointAY((u - 0.5) * 0.9, -THIGH - 0.2 - v * 0.016, 0.003, p)), V(0, 0, 1)),
      { color: C.print, flat: 0.3, outline: false },
      knee,
    );
    sb.add(
      sheet(1, 2, (u, v, o) => void o.copy(leg.pointAY(Math.PI / 2 + 0.5 + u * 0.09 + v * 0.3, -0.24 + v * 0.11, 0.003, p)), V(1, 0, -0.5)),
      { color: C.teal, flat: 0.6, outline: false },
    );
  }
  return sb.build('figure-leg', F.count);
}

// ---------------------------------------------------------------------------------------------
// Shoe: a chunky trainer. Thick two-colour sole that kicks up at the toe, padded collar, a pull
// on the heel. Built round the ankle, toe toward -z. The front of it bends at the ball of the foot.
// ---------------------------------------------------------------------------------------------

export const FOOT_FRAMES = { toe: 1, count: 2 };

export function buildFoot(kit: InkKit, q: Detail, side: number): Skin {
  const sb = new SkinBuilder(kit.builder());
  const F = FOOT_FRAMES;
  const zc = -0.058; // middle of the footprint
  // Drawn a size too big: wider than a real shoe by an eighth, and a touch longer.
  const fp = (y: number, rx: number, rz: number, more: Partial<Ring> = {}): Ring => ({ y, rx: rx * 1.13, rz: rz * 1.03, z: zc, n: 2.5, e: -0.13, ...more });
  const toe = (_x: number, _y: number, z: number, o: BindOut): void => {
    o.a = 0;
    o.b = F.toe;
    o.w = smoothstep(-BALL + 0.03, -BALL - 0.035, z);
  };
  // The toe kicks up and the heel is rounded off.
  const bend = (p: THREE.Vector3): void => {
    const f = Math.max(0, -p.z - 0.11);
    const h = Math.max(0, p.z - 0.05);
    p.y += (f * f * 1.7 + h * h * 2.2) * smoothstep(-0.02, -ANKLE, p.y);
  };

  const sole = new Loft(
    [
      fp(-ANKLE, 0.052, 0.154),
      fp(-ANKLE + 0.004, 0.064, 0.168),
      fp(-ANKLE + 0.024, 0.069, 0.174),
      fp(-ANKLE + 0.048, 0.071, 0.176),
      fp(-ANKLE + 0.069, 0.067, 0.171),
      fp(-ANKLE + 0.071, 0.05, 0.15),
    ],
    q.seg(16),
    { warp: bend },
  );
  // A wedge of the dark colour runs up into the pale one under the heel and under the ball.
  const wave = (a: number): number => (Math.cos(a * 2) > 0.2 ? 3 : 2);
  const soleId = sb.newId();
  sb.add(sole.geometry((j, _i, a) => j < wave(a)), { color: C.teal, id: soleId, flat: 0.15 }, toe);
  sb.add(sole.geometry((j, _i, a) => j >= wave(a)), { color: C.mid, id: soleId, flat: 0.1 }, toe);

  // The upper. The collar stands a little higher at the heel than at the laces.
  const upper = new Loft(
    [
      fp(-ANKLE + 0.063, 0.06, 0.164),
      fp(-ANKLE + 0.09, 0.059, 0.158, { z: zc + 0.004 }),
      fp(-ANKLE + 0.112, 0.056, 0.136, { z: zc + 0.024, n: 2.2 }),
      fp(-ANKLE + 0.136, 0.053, 0.106, { z: zc + 0.052, n: 2.1, e: -0.05 }),
      fp(-ANKLE + 0.16, 0.052, 0.08, { z: zc + 0.078, e: 0, ty: 0.004 }),
      fp(-ANKLE + 0.192, 0.052, 0.07, { z: zc + 0.086, e: 0, ty: 0.016 }),
      fp(-ANKLE + 0.206, 0.044, 0.06, { z: zc + 0.086, e: 0, ty: 0.018 }),
    ],
    q.seg(14),
    { step: q.step(0.03), warp: bend },
  );
  // Three pieces, each with its own line: the toe box, the heel counter, and the rest. Flat colour
  // on each, so the shade falls in bands and the seams do the drawing.
  const upperId = sb.newId();
  const isToe = (a: number, y: number): boolean => Math.cos(a) < -0.42 && y < -ANKLE + 0.106;
  const isHeel = (a: number, y: number): boolean => Math.cos(a) > 0.55 && y < -ANKLE + 0.138;
  const isCollar = (y: number): boolean => y > -ANKLE + 0.176;
  sb.add(upper.geometry((_j, _i, a, y) => !isToe(a, y) && !isHeel(a, y) && !isCollar(y)), { color: C.shoe, id: upperId }, toe);
  sb.add(upper.geometry((_j, _i, a, y) => isToe(a, y)), { color: C.shoe }, toe);
  sb.add(upper.geometry((_j, _i, a, y) => isHeel(a, y)), { color: C.teal, flat: 0.1 });
  sb.add(upper.geometry((_j, _i, _a, y) => isCollar(y)), { color: C.lining, id: upperId, flat: 0.2 });
  sb.add(upper.cap(true), { color: C.trouserDark, flat: 0.6, outline: false });

  const p = V();
  // The tongue stands up in front of the ankle, above the collar.
  {
    const at = (u: number, v: number, o: THREE.Vector3): void => {
      const y = -ANKLE + 0.122 + v * 0.108;
      upper.pointAY(Math.PI + (u - 0.5) * 0.8, Math.min(y, -ANKLE + 0.19), 0.005, p);
      // Above the instep it leaves the shoe and leans on the shin.
      const free = Math.max(0, y - (-ANKLE + 0.168));
      o.set(p.x * (1 - free * 2), y, p.z - 0.004 + free * 0.42);
    };
    sb.add(sheet(q.low ? 2 : 4, q.low ? 3 : 4, at, V(0, 0.4, -1)), { color: C.shoeShade, flat: 0.15 });
  }
  // Three lace bars across the instep, in the dark colour.
  for (let k = 0; k < 3; k++) {
    const y = -ANKLE + 0.116 + k * 0.02;
    sb.add(
      sheet(q.low ? 2 : 3, 1, (u, v, o) => void o.copy(upper.pointAY(Math.PI + (u - 0.5) * 1.3, y + v * 0.01, 0.014, p)), V(0, 0.4, -1)),
      { color: C.lining, flat: 0.6, outline: false },
    );
  }
  // A stripe down the outside, and an orange pull standing above the heel.
  const outSide = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  sb.add(
    sheet(2, 1, (u, v, o) => void o.copy(upper.pointAY(outSide + side * (-0.3 + u * 0.7), -ANKLE + 0.074 + v * 0.03 + u * 0.03, 0.003, p)), V(side, 0.3, 0)),
    { color: C.teal, flat: 0.5, outline: false },
  );
  sb.add(geo.box(0.024, 0.074, 0.012), { color: C.shell, pos: [0, -ANKLE + 0.182, 0.103], rot: [0.1, 0, 0], flat: 0.4 });
  return sb.build('figure-foot', F.count);
}

export function buildShadow(kit: InkKit): THREE.Mesh {
  const b = kit.builder();
  // A solid heart and a screen-door rim, so the edge reads soft. Hatched like every other shadow.
  b.add(geo.disc(0.3, 18), { color: C.groundShade as ColorLike, flat: 1, hatch: 0.6, outline: false });
  b.add(geo.ring(0.3, 0.43, 18), { color: C.groundShade as ColorLike, flat: 1, hatch: 0.6, outline: false, dither: 0.5 });
  const m = b.build('figure-shadow');
  m.renderOrder = -1;
  return m;
}
