// The Switchboard. My first desk, drawn as a city block.
// A brick telephone exchange stands across the north side of the plaza with a plugboard the size of
// its whole front: nine rows of jacks, each row lettered with a kind of engineer, and patch cords
// hanging in loops between them. A ring of old utility poles leans in from the south and west, and
// every one of them runs its wires across the plaza into that board. Lights run along the wires.
// Ivy has the west end of the building and is working along the cornice.
// On the east side, on a patch of brick paving under a short marble colonnade, a desk with two
// phones and a rolodex wheel taller than a person, with the clients lettered on its cards.
// Over the roof a telephone handset the size of a bus hangs in the air, its cord coiling down
// toward a jack on the roof and stopping short.
//
// Roads come in from the south south east (the avenue from the Trailhead), the east (on to the
// Commons) and the west north west (the side street to the Greenhouse). Nothing stands on those lines.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, Poi } from '../types';

type V3 = [number, number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const TRUNK = '#7a5a86';
const WINDOW = '#56528f';
const LIT = '#f6d98a';
const IRON = '#3d3766';
const WOOD = '#a8643f';
const POLE = '#8a5a4e';
const LEAVES = ['#7fb85a', '#63aa5e', '#3f8a57', '#8cc56c', '#4f9c62'];
const WIRE = '#2e2a52';

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

/** XYZ angles for a part leaned by `lean` radians toward heading `dir` (radians, around y), then turned to `yaw`. */
function leanRot(leanX: number, leanZ: number, yaw: number): { rot: V3; q: THREE.Quaternion } {
  const qLean = new THREE.Quaternion().setFromEuler(new THREE.Euler(leanX, 0, leanZ, 'XYZ'));
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const q = qLean.multiply(qYaw);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return { rot: [e.x, e.y, e.z], q };
}

/** XYZ angles that turn a part's +x, +y, +z onto the three given axes. */
function basisRot(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3): V3 {
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x, e.y, e.z];
}

/** XYZ angles for a part turned by `rot` and then turned about the vertical by `yaw`. */
function yawed(rot: V3, yaw: number): V3 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ')));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

/** A sagging span sampled as a hanging curve: straight between the ends, dropped by `sag` in the middle. */
function span(a: V3, b: V3, sag: number, n: number, bulge: V3 = [0, 0, 0]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const d = 4 * s * (1 - s);
    out.push([
      a[0] + (b[0] - a[0]) * s + bulge[0] * d,
      a[1] + (b[1] - a[1]) * s - sag * d + bulge[1] * d,
      a[2] + (b[2] - a[2]) * s + bulge[2] * d,
    ]);
  }
  return out;
}

export const district: DistrictModule = {
  id: 'switchboard',
  build(ctx) {
    return buildSwitchboard(ctx);
  },
};

function buildSwitchboard(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const sun = ctx.sun ?? FALLBACK_SUN;
  const [YELLOW, ORANGE, TEAL] = site.accents as [string, string, string];
  const shade = mix(mix(P.pave, YELLOW, 0.1), P.shadow, 0.3);

  const group = new THREE.Group();
  group.name = 'switchboard';
  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const b = kit.builder();
  const has = (id: string): boolean => entries.some((e) => e.id === id);
  const fit = (text: string, size: number, max: number): number => {
    const w = b.measure ? b.measure({ text, size }).width : text.length * size * 0.7;
    return w > max ? (size * max) / w : size;
  };
  const cast = (g: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: number | V3): void => {
    b.shadow?.(g, { color: shade, sun, pos, rot, scale, y: 0, lift: 0.015 });
  };

  // A clump of leaf. Hedges, shrubs, and ivy when it is squashed flat against a wall.
  let clumpSeed = 31;
  const clump = (pos: V3, scale: V3, tint: string, rot?: V3, count = 4): void => {
    b.add(geo.blobs(clumpSeed++, count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos, rot, scale, sway: 0.1,
    });
  };
  // A street tree: a trunk and three round masses of leaf.
  const tree = (x: number, z: number, h: number, tint: string, pit = true): void => {
    const y = ctx.groundAt(x, z);
    const s = h / 7;
    const a = rng() * 6.28;
    const ca = Math.cos(a), sa = Math.sin(a);
    if (pit) b.add(geo.cylinder(0.95, 0.95, 0.1, 8), { color: P.grassDeep, pos: [x, y, z], flat: 0.5 });
    b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, y, z], sway: 0.2, swayBase: y });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: y };
    const id = b.newId();
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    b.add(ball, { ...leaf, id, pos: [x, y + 4.9 * s, z], scale: [2.5 * s, 2.0 * s, 2.4 * s] });
    b.add(ball, { ...leaf, id, pos: [x - 1.6 * s * ca, y + 4.6 * s, z - 1.6 * s * sa], scale: [1.5 * s, 1.25 * s, 1.45 * s] });
    b.add(ball, { ...leaf, pos: [x + 1.6 * s * ca + 0.6 * sa, y + 4.0 * s, z + 1.6 * s * sa], scale: [1.7 * s, 1.35 * s, 1.6 * s] });
    cast(ball, [x, 4.9 * s, z], undefined, [2.5 * s, 2.0 * s, 2.4 * s]);
    colliders.push({ kind: 'circle', x, z, r: 0.34 * s });
  };

  // ------------------------------------------------------------------------------------------
  // The exchange. Brick, nine storeys of nothing but board, on a marble footing, facing south.
  // ------------------------------------------------------------------------------------------
  const FZ = -16; // front face
  const BZ = -24.2; // back face
  const W = 22; // x from -11 to 11
  const D = FZ - BZ;
  const CZ = (FZ + BZ) / 2;
  const TOP = 13.2; // top of the brick
  const ROOF = TOP + 0.5 + 0.8; // top of the parapet
  {
    const foot = Math.min(ctx.groundAt(-11, BZ), ctx.groundAt(11, BZ), 0) - 1.5;
    b.add(geo.box(W + 0.4, 1.2 - foot, D + 0.4), { color: P.marbleShade, pos: [0, foot, CZ] });
    const body = geo.box(W, TOP - 1.2, D);
    b.add(body, { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, pos: [0, 1.2, CZ], hatch: 0.06 });
    cast(geo.box(W, TOP + 1.3, D), [0, 0, CZ]);
    b.add(geo.box(W + 0.8, 0.5, D + 0.8), { color: P.marble, pos: [0, TOP, CZ] });
    b.add(geo.box(W + 0.2, 0.8, D + 0.2), { color: P.brickDeep, pos: [0, TOP + 0.5, CZ] });
    // The roof is a garden now.
    b.add(geo.box(W - 1.0, 0.18, D - 1.0), { color: P.grassDeep, pos: [0, ROOF, CZ], flat: 0.4 });
    for (let i = 0; i < (low ? 3 : 6); i++) {
      const x = 2.5 + i * 1.5;
      clump([x, ROOF + 0.5, CZ + (i % 2 ? 1.6 : -1.4)], [1.1, 0.8, 1.0], LEAVES[i % LEAVES.length]);
    }
    colliders.push({ kind: 'box', x: 0, z: (FZ + 0.6 + BZ) / 2, hw: W / 2 + 0.2, hd: (FZ + 0.6 - BZ) / 2 });
  }

  // The frieze with the name on it, right across the front above the board.
  const frieze = b.add(geo.box(W + 0.4, 1.8, 0.4), { color: P.marble, pos: [0, 11.3, FZ + 0.1] });
  {
    const name = site.name.toUpperCase();
    const sz = fit(name, 0.92, 15);
    b.label({ text: name, size: sz, pos: [0, 12.32, FZ + 0.31], ink: P.ink, plate: P.marble, id: frieze, pad: 0.1 });
    b.label({ text: site.years.toUpperCase(), size: 0.36, pos: [0, 11.62, FZ + 0.31], ink: P.violet, plate: P.marble, id: frieze, pad: 0.1 });
  }

  // Engaged columns either side of the board, marble against the brick.
  for (const sx of [-7.45, 7.45]) {
    b.add(geo.bevelBox(1.3, 0.5, 1.0, 0.05), { color: P.marbleShade, pos: [sx, 0, FZ + 0.1] });
    b.add(geo.prism(12, 0.42, 0.5, 9.4), { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [sx, 0.5, FZ + 0.1] });
    b.add(geo.cylinder(0.66, 0.5, 0.3, 12), { color: P.marble, pos: [sx, 9.9, FZ + 0.1] });
    b.add(geo.bevelBox(1.4, 0.24, 1.1, 0.04), { color: P.marbleShade, pos: [sx, 10.2, FZ + 0.1] });
    colliders.push({ kind: 'circle', x: sx, z: FZ + 0.3, r: 0.75 });
  }

  // Windows on the brick: the west strip, over the door, and three bays down each side.
  {
    const pane = geo.plane(1.1, 1.7);
    const tint = (): string => {
      const r = rng();
      return r < 0.18 ? LIT : r < 0.38 ? (P.glass as string) : WINDOW;
    };
    const sill = geo.box(1.36, 0.12, 0.24);
    for (const y of [4.4, 7.6]) {
      for (const x of [-9.4, 9.3]) {
        b.add(pane, { color: tint(), pos: [x, y, FZ + 0.03], flat: 0.7 });
        b.add(sill, { color: P.marble, pos: [x, y - 0.98, FZ + 0.1] });
      }
    }
    for (const side of [-1, 1]) {
      const rot: V3 = [0, (side * Math.PI) / 2, 0];
      for (const y of [4.4, 7.6, 10.8]) {
        for (const z of [FZ - 1.6, CZ, BZ + 1.6]) {
          b.add(pane, { color: tint(), pos: [side * (W / 2 + 0.03), y, z], rot, flat: 0.7 });
          if (!low) b.add(sill, { color: P.marble, pos: [side * (W / 2 + 0.08), y - 0.98, z], rot });
        }
      }
    }
    // A fire escape down the east end, where the street from the Commons comes in.
    if (!low) {
      const ex = W / 2 + 0.5;
      for (const y of [3.4, 6.6, 9.8]) {
        b.add(geo.box(0.95, 0.09, 3.0), { color: IRON, pos: [ex, y, CZ] });
        b.add(geo.box(0.07, 0.07, 3.0), { color: IRON, pos: [ex + 0.44, y + 1.0, CZ] });
        b.add(geo.plane(3.0, 0.95), { color: IRON, pos: [ex + 0.44, y + 0.55, CZ], rot: [0, Math.PI / 2, 0], dither: 0.5, flat: 1 });
        for (const s of [-1, 1]) b.add(geo.box(0.07, 1.0, 0.07), { color: IRON, pos: [ex + 0.44, y + 0.05, CZ + s * 1.46] });
      }
    }
  }

  // The door, at the east end of the front, under a marble frame with its name over it.
  {
    const dx = 9.3;
    const frame = b.add(geo.box(2.3, 3.5, 0.3), { color: P.marble, pos: [dx, 0, FZ + 0.05] });
    b.add(geo.plane(1.35, 2.55), { color: TEAL, pos: [dx, 1.3, FZ + 0.215], flat: 0.5 });
    b.add(geo.sphere(0.07, 6, 4), { color: P.brass, pos: [dx + 0.45, 1.2, FZ + 0.25], flat: 0.5, outline: false });
    b.label({ text: 'EXCHANGE', size: 0.22, pos: [dx, 3.04, FZ + 0.205], ink: P.ink, plate: P.marble, id: frame, pad: 0.1 });
    const step = b.newId();
    b.add(geo.box(2.6, 0.16, 0.9), { color: P.paveShade, pos: [dx, 0, FZ + 0.6], id: step });
    b.add(geo.box(2.6, 0.08, 1.4), { color: P.paveShade, pos: [dx, 0, FZ + 0.85], id: step });
  }

  // Water tower on the west end of the roof.
  {
    const tx = -6.4, tz = CZ - 0.4;
    const legs = geo.cylinder(0.07, 0.07, 1.8, 5);
    for (const sx of [-0.85, 0.85]) for (const sz of [-0.85, 0.85]) b.add(legs, { color: IRON, pos: [tx + sx, ROOF, tz + sz] });
    b.add(geo.cylinder(1.35, 1.35, 0.12, 10), { color: IRON, pos: [tx, ROOF + 1.8, tz] });
    b.add(geo.prism(10, 1.25, 1.18, 2.4), { color: WOOD, pos: [tx, ROOF + 1.92, tz], hatch: 0.15 });
    b.add(geo.cone(1.45, 1.05, 10), { color: mix(P.brickDeep, P.shadow, 0.35), pos: [tx, ROOF + 4.32, tz] });
  }

  // The roof jack the handset's cord is reaching for.
  b.add(geo.bevelBox(1.0, 0.4, 1.0, 0.05), { color: P.marble, pos: [0, ROOF, CZ] });
  b.add(geo.cylinder(0.26, 0.26, 0.06, 10), { color: P.brass, pos: [0, ROOF + 0.4, CZ] });
  b.add(geo.disc(0.13, 8), { color: P.ink, pos: [0, ROOF + 0.465, CZ], flat: 1, outline: false });

  // Ivy has the west end: up the corner, across the frieze, and over the cornice.
  {
    const flat: V3 = [0, 0, 0];
    clump([-10.2, 1.6, FZ + 0.25], [1.4, 2.4, 0.4], LEAVES[2], flat, 5);
    clump([-10.6, 4.6, FZ + 0.2], [1.1, 2.4, 0.38], LEAVES[4], flat, 5);
    clump([-10.4, 7.8, FZ + 0.2], [1.0, 2.2, 0.36], LEAVES[0], flat);
    clump([-9.2, 11.6, FZ + 0.4], [2.2, 0.9, 0.5], LEAVES[2], flat, 5);
    clump([-11.25, 5.2, FZ - 1.6], [0.4, 3.0, 1.6], LEAVES[4], flat, 5);
    clump([-11.25, 9.6, FZ - 3.6], [0.4, 2.2, 1.4], LEAVES[1], flat);
    clump([-9.6, TOP + 0.55, FZ + 0.2], [1.6, 0.55, 0.6], LEAVES[3], flat);
    clump([-6.9, 12.0, FZ + 0.45], [0.9, 0.7, 0.4], LEAVES[1], flat, 3);
    // A runner up the west column and a tongue down onto the board frame.
    clump([-7.45, 6.4, FZ + 0.62], [0.5, 2.6, 0.32], LEAVES[0], flat, 4);
    clump([-6.6, 10.9, FZ + 0.62], [0.7, 0.6, 0.3], LEAVES[2], flat, 3);
    if (!low) {
      clump([11.25, 2.2, FZ - 6.4], [0.4, 2.0, 1.2], LEAVES[2], flat);
      clump([5.0, TOP + 0.6, FZ + 0.25], [1.0, 0.4, 0.5], LEAVES[4], flat, 3);
    }
    // Moss along the marble footing.
    b.add(geo.box(5.2, 0.12, 0.08), { color: P.moss, pos: [-8.4, 0.9, FZ + 0.215], flat: 0.4, outline: false });
  }

  // Two street lamps in front of the board, verdigris, with globes.
  for (const lx of [-8.6, 6.4]) {
    const lz = FZ + 4.4;
    b.add(geo.cylinder(0.24, 0.3, 0.5, 8), { color: P.verdigris, pos: [lx, 0, lz] });
    b.add(geo.cylinder(0.08, 0.11, 4.2, 6), { color: P.verdigris, pos: [lx, 0.5, lz] });
    b.add(geo.torus(0.16, 0.05, 8, 4), { color: P.verdigris, pos: [lx, 4.7, lz], rot: [Math.PI / 2, 0, 0] });
    b.add(geo.sphere(0.32, 10, 7), { color: LIT, pos: [lx, 5.0, lz], flat: 0.8 });
  }

  // A planting bed under the ivy, with a tree, and a kerb round it.
  {
    const x0 = -11.2, x1 = -8.2, z0 = FZ + 0.45, z1 = FZ + 3.6;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    b.add(geo.box(x1 - x0 + 0.3, 0.22, z1 - z0 + 0.3), { color: P.marbleShade, pos: [cx, 0, cz] });
    b.add(geo.box(x1 - x0, 0.26, z1 - z0), { color: P.grassDeep, pos: [cx, 0, cz], flat: 0.4 });
    clump([x0 + 0.9, 0.6, z1 - 0.6], [0.8, 0.6, 0.7], LEAVES[3], undefined, 3);
    colliders.push({ kind: 'box', x: cx, z: cz, hw: (x1 - x0) / 2 + 0.15, hd: (z1 - z0) / 2 + 0.15 });
  }
  tree(-9.8, FZ + 2.3, 7.2, LEAVES[0], false);

  // ------------------------------------------------------------------------------------------
  // The board. Marble frame, teal panel, nine rows of brass jacks with a lamp over each.
  // ------------------------------------------------------------------------------------------
  const PANEL_Z = FZ + 0.55; // front face of the panel
  const ROWS = 9;
  const COLS = low ? 9 : 12;
  const COL0 = -3.7;
  const COL_W = (5.75 - COL0) / (COLS - 1);
  const jackX = (c: number): number => COL0 + c * COL_W;
  const jackY = (r: number): number => 2.4 + r * 0.95;
  b.add(geo.box(13.8, 10.0, 0.5), { color: P.marble, pos: [0, 1.25, FZ + 0.2] });
  const panel = b.add(geo.box(13.0, 9.3, 0.2), { color: TEAL, pos: [0, 1.6, PANEL_Z - 0.1], flat: 0.15 });
  // The sill, lettered.
  const sill = b.add(geo.bevelBox(14.4, 0.32, 1.0, 0.05), { color: P.marble, pos: [0, 0.95, FZ + 0.45] });
  b.label({ text: 'ONE CALL AT A TIME', size: 0.2, pos: [0, 1.1, FZ + 0.96], ink: P.ink, plate: P.marble, id: sill, pad: 0.1 });
  {
    const ROW_NAMES = ['QA', 'DEVOPS', 'CLOUD', '.NET', 'JAVA', 'INFRA', 'FULL STACK', 'BACKEND', 'FRONTEND'];
    for (let r = 0; r < ROWS; r++) {
      const text = ROW_NAMES[r];
      b.label({ text, size: fit(text, 0.2, 1.9), pos: [-5.35, jackY(r), PANEL_Z], ink: P.paper, plate: TEAL, id: panel, flat: 0.15, pad: 0.1 });
    }
    const jack = geo.cylinder(0.17, 0.17, 0.1, 8);
    const hole = geo.disc(0.08, 8);
    const lamp = geo.sphere(0.1, 6, 4);
    const faceOut: V3 = [Math.PI / 2, 0, 0];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = jackX(c), y = jackY(r);
        b.add(jack, { color: P.brass, pos: [x, y, PANEL_Z - 0.01], rot: faceOut, flat: 0.3 });
        b.add(hole, { color: P.ink, pos: [x, y, PANEL_Z + 0.095], rot: faceOut, flat: 1, outline: false });
        if (!low) {
          const lit = rng() < 0.3;
          b.add(lamp, { color: lit ? LIT : mix(TEAL, P.ink, 0.45), pos: [x, y + 0.38, PANEL_Z], flat: lit ? 1 : 0.4 });
        }
      }
    }
  }
  colliders.push({ kind: 'box', x: 0, z: FZ + 0.6, hw: 7.3, hd: 0.5 });

  // Plugs, and the patch cords hanging between them in loops.
  const plug = geo.cylinder(0.1, 0.1, 0.32, 6);
  const plugAt = (c: number, r: number, color: string): V3 => {
    const x = jackX(c), y = jackY(r);
    b.add(plug, { color, pos: [x, y, PANEL_Z + 0.08], rot: [Math.PI / 2, 0, 0], flat: 0.3 });
    return [x, y - 0.04, PANEL_Z + 0.36];
  };
  {
    const cords: [number, number, number, number, string][] = [
      [0, 1, 4, 0, ORANGE], [2, 3, 7, 2, YELLOW], [5, 4, 9, 1, ORANGE], [1, 5, 3, 2, YELLOW],
      [6, 0, 10, 3, P.red as string], [8, 4, 11, 1, YELLOW], [3, 0, 6, 1, P.pink as string], [9, 2, 11, 5, ORANGE],
    ];
    for (const [c1, r1, c2, r2, color] of low ? cords.slice(0, 4) : cords) {
      const a = plugAt(Math.min(c1, COLS - 1), r1, color);
      const z = plugAt(Math.min(c2, COLS - 1), r2, color);
      const sag = 0.9 + Math.abs(a[0] - z[0]) * 0.18;
      b.add(geo.tube(span(a, z, sag, 10, [0, 0, 0.35]), 0.05, { radial: 4, perSpan: 2 }), { color, flat: 0.3 });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The poles. Old timber, each leaning its own way, every wire running to the board.
  // ------------------------------------------------------------------------------------------
  const wires: V3[][] = [];
  {
    const POLES: [number, number][] = [
      [-40, 19.5], [92, 21.5], [110, 20], [128, 22], [146, 20.5], [164, 22], [182, 20],
    ];
    const tops: V3[] = [];
    const board: V3 = [1, 7.5, FZ];
    const pole = (h: number): THREE.BufferGeometry => geo.cylinder(0.14, 0.21, h, 7);
    const arm = geo.box(2.7, 0.2, 0.2);
    const insul = geo.cylinder(0.09, 0.12, 0.26, 6);
    const brace = geo.box(0.08, 0.9, 0.08);
    const tmp = new THREE.Vector3();
    POLES.forEach(([deg, r], i) => {
      const a = (deg * Math.PI) / 180;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = ctx.groundAt(x, z);
      const h = 10.2 + rng() * 1.6;
      const yaw = Math.atan2(board[0] - x, board[2] - z) + Math.PI / 2; // crossarm square to the wires
      const lean = (4 + rng() * 6) * (Math.PI / 180);
      const dir = rng() * Math.PI * 2;
      const { rot, q } = leanRot(Math.cos(dir) * lean, Math.sin(dir) * lean, yaw);
      const on = (lx: number, ly: number, lz: number): V3 => {
        tmp.set(lx, ly, lz).applyQuaternion(q);
        return [x + tmp.x, y + tmp.y, z + tmp.z];
      };
      // Sunk a little so the lean never lifts a foot off the paving.
      const pg = pole(h + 0.4);
      b.add(pg, { gradient: { bottom: mix(POLE, P.shadow, 0.25), top: POLE }, color: POLE, pos: on(0, -0.4, 0), rot, hatch: 0.1 });
      cast(pg, [x, -0.4, z], rot);
      b.add(geo.cylinder(0.42, 0.48, 0.18, 8), { color: P.paveShade, pos: [x, y, z] });
      const armY = h - 0.75;
      b.add(arm, { color: POLE, pos: on(0, armY, 0), rot });
      if (!low) {
        b.add(brace, { color: IRON, pos: on(-0.55, armY - 0.85, 0), rot });
        b.add(brace, { color: IRON, pos: on(0.55, armY - 0.85, 0), rot });
      }
      const ends: V3[] = [];
      for (const lx of [-1.15, 0, 1.15]) {
        b.add(insul, { color: P.verdigris, pos: on(lx, armY + 0.2, 0), rot, flat: 0.3 });
        ends.push(on(lx, armY + 0.48, 0));
      }
      tops.push(ends[1]);
      // A transformer can on every other pole.
      if (i % 2 === 1) {
        b.add(geo.cylinder(0.36, 0.36, 1.1, 8), { color: P.steel, pos: on(0, h - 3.2, 0.45), rot });
        b.add(geo.cylinder(0.4, 0.4, 0.1, 8), { color: mix(P.steel, P.ink, 0.3), pos: on(0, h - 2.1, 0.45), rot });
      }
      // Wires: two to the board from the outer insulators, landing on the top rows, spread by where
      // the pole stands. The middle insulator carries the street span from pole to pole.
      const base = Math.round(((x + 22) / 40) * (COLS - 2));
      for (let k = 0; k < 2; k++) {
        const c = Math.max(0, Math.min(COLS - 1, base + k));
        const rr = ROWS - 1 - ((k + i) % 3);
        const end = plugAt(c, rr, P.ink as string);
        const pts = span(ends[k * 2], end, 0.7 + Math.hypot(end[0] - x, end[2] - z) * 0.035, 12);
        wires.push(pts);
        b.add(geo.tube(pts, 0.035, { radial: 4, perSpan: 1 }), { color: WIRE });
      }
      colliders.push({ kind: 'circle', x, z, r: 0.42 });
    });
    // Spans from pole to pole round the arc, so the block reads as a street, not a diagram.
    for (let i = 1; i < tops.length - 1; i++) {
      b.add(geo.tube(span(tops[i], tops[i + 1], 0.55, 8), 0.035, { radial: 4, perSpan: 1 }), { color: WIRE });
    }
  }

  // The verge the poles stand in: a long crescent of grass round the south west, a few centimetres
  // proud of the paving, with two marble benches on its inner edge facing the board.
  {
    const r0 = 17, r1 = 24.4, a0 = (95 * Math.PI) / 180, a1 = (186 * Math.PI) / 180;
    const seg = high ? 24 : 14;
    const out: [number, number][] = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      out.push([Math.cos(a) * r1, -Math.sin(a) * r1]);
    }
    for (let i = seg; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / seg;
      out.push([Math.cos(a) * r0, -Math.sin(a) * r0]);
    }
    const verge = geo.extrude(out, 0.12, { cacheKey: 'switchboard-verge-' + seg });
    b.add(geo.extrude(out.map(([x, y]) => [x * 1.012, y * 1.012] as [number, number]), 0.1, { cacheKey: 'switchboard-kerb-' + seg }), {
      color: P.marbleShade, pos: [0, 0.02, 0], rot: [-Math.PI / 2, 0, 0],
    });
    b.add(verge, { color: P.grass, pos: [0, 0.04, 0], rot: [-Math.PI / 2, 0, 0], flat: 0.4 });
    for (const deg of [134, 158]) {
      const a = (deg * Math.PI) / 180;
      const x = Math.cos(a) * (r0 - 0.9), z = Math.sin(a) * (r0 - 0.9);
      const yaw = Math.atan2(-x, -z);
      const seat = b.newId();
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      for (const s of [-0.8, 0.8]) b.add(geo.box(0.35, 0.42, 0.5), { color: P.marbleShade, pos: [x + s * cs, 0, z - s * sn], rot: [0, yaw, 0], id: seat });
      b.add(geo.bevelBox(2.2, 0.14, 0.62, 0.04), { color: P.marble, pos: [x, 0.42, z], rot: [0, yaw, 0] });
      colliders.push({ kind: 'box', x, z, hw: 1.15, hd: 0.35, rot: yaw });
    }
    // Shrubs along the outer edge, between the poles.
    if (!low) {
      for (const deg of [101, 137, 155, 175]) {
        const a = (deg * Math.PI) / 180;
        clump([Math.cos(a) * 23.2, 0.55, Math.sin(a) * 23.2], [1.2, 0.8, 1.0], LEAVES[deg % LEAVES.length], undefined, 4);
      }
    }
  }

  // A cable drum lying by the south poles, half its cable still on it.
  {
    const cx = -5.6, cz = 17.6;
    const yaw = 0.6;
    const ax = Math.cos(yaw), az = -Math.sin(yaw);
    const rot: V3 = [0, yaw, -Math.PI / 2];
    const pos: V3 = [cx - ax * 0.4, 0.86, cz - az * 0.4];
    const spool = geo.lathe([[0, 0], [0.76, 0], [0.76, 0.08], [0.46, 0.08], [0.46, 0.72], [0.76, 0.72], [0.76, 0.8], [0, 0.8]], 14, { cacheKey: 'switchboard-spool' });
    b.add(spool, { color: WOOD, pos, rot, hatch: 0.1 });
    b.add(geo.cylinder(0.56, 0.56, 0.62, 12), { color: ORANGE, pos: [pos[0] + ax * 0.09, 0.86, pos[2] + az * 0.09], rot, flat: 0.2 });
    colliders.push({ kind: 'circle', x: cx, z: cz, r: 0.9 });
  }

  // ------------------------------------------------------------------------------------------
  // The account desk. Brick paving, a short colonnade grown over, a desk with two phones.
  // ------------------------------------------------------------------------------------------
  {
    // Brick paving, laid a couple of centimetres proud of the plaza.
    b.add(geo.box(8.0, 0.04, 11.6), { color: mix(P.brick, P.pave, 0.45), pos: [14.4, 0, 6.6], flat: 0.3 });
    const seam = geo.box(8.0, 0.012, 0.06);
    for (let k = 1; k < (low ? 4 : 8); k++) {
      b.add(seam, { color: mix(P.brickDeep, P.pave, 0.35), pos: [14.4, 0.04, 0.8 + k * (11.6 / (low ? 4 : 8))], flat: 1, outline: false });
    }

    // The colonnade: four columns, an architrave with a line on it, ivy over the top.
    const CX = 19.4;
    const zs = [1.8, 5.3, 8.8, 12.3];
    b.add(geo.box(2.1, 0.28, 12.4), { color: P.marbleShade, pos: [CX, 0, 7.05] });
    b.add(geo.box(1.8, 0.14, 12.0), { color: P.marble, pos: [CX, 0.28, 7.05] });
    const shaft = geo.prism(12, 0.36, 0.44, 4.6);
    for (const z of zs) {
      b.add(geo.bevelBox(1.1, 0.3, 1.1, 0.04), { color: P.marbleShade, pos: [CX, 0.42, z] });
      b.add(shaft, { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [CX, 0.72, z] });
      cast(shaft, [CX, 0.72, z]);
      b.add(geo.cylinder(0.55, 0.4, 0.24, 12), { color: P.marble, pos: [CX, 5.32, z] });
      b.add(geo.bevelBox(1.05, 0.2, 1.05, 0.03), { color: P.marbleShade, pos: [CX, 5.56, z] });
      colliders.push({ kind: 'circle', x: CX, z, r: 0.6 });
    }
    const arch = b.add(geo.box(1.0, 0.95, 11.6), { color: P.marble, pos: [CX, 5.76, 7.05] });
    b.add(geo.box(1.35, 0.24, 12.0), { color: P.marbleShade, pos: [CX, 6.71, 7.05] });
    cast(geo.box(1.0, 1.2, 11.6), [CX, 5.76, 7.05]);
    b.label({ text: 'ALWAYS CALL BACK', size: 0.4, pos: [CX - 0.51, 6.23, 7.05], rot: [0, -Math.PI / 2, 0], ink: P.ink, plate: P.marble, id: arch, pad: 0.1 });
    // Ivy over the top and down two of the columns, grass behind.
    clump([CX + 0.2, 7.1, 3.2], [1.0, 0.6, 2.6], LEAVES[2], undefined, 5);
    clump([CX + 0.1, 7.05, 10.6], [0.9, 0.55, 2.0], LEAVES[0], undefined, 4);
    clump([CX - 0.35, 4.6, 12.3], [0.55, 2.3, 0.62], LEAVES[4], undefined, 4);
    clump([CX - 0.3, 5.4, 2.3], [0.5, 1.4, 1.2], LEAVES[1], undefined, 3);
    clump([CX + 0.1, 0.55, 7.0], [0.9, 0.35, 5.6], P.moss as string, undefined, 5);
    b.add(geo.box(2.6, 0.1, 13.0), { color: P.grass, pos: [CX + 2.35, 0, 7.05], flat: 0.4 });

    // The desk, facing the plaza.
    const DX = 11.6, DZ = 2.6;
    const deskTeal = mix(TEAL, P.ink, 0.1);
    const ped = geo.box(1.0, 0.72, 0.62);
    for (const s of [-0.85, 0.85]) b.add(ped, { color: deskTeal, pos: [DX, 0, DZ + s] });
    const modesty = b.add(geo.box(0.06, 0.55, 1.1), { color: deskTeal, pos: [DX - 0.42, 0.17, DZ] });
    const top = geo.bevelBox(1.2, 0.08, 2.5, 0.03);
    b.add(top, { color: WOOD, pos: [DX, 0.72, DZ] });
    cast(geo.box(1.2, 0.8, 2.5), [DX, 0, DZ]);
    b.label({ text: 'ACCOUNTS', size: 0.13, pos: [DX - 0.46, 0.45, DZ], rot: [0, -Math.PI / 2, 0], ink: P.paper, plate: deskTeal, id: modesty, pad: 0.15 });
    // Two phones, a lamp, a pad of call sheets.
    const phone = (px: number, pz: number, color: string, turn: number): void => {
      const y = 0.8;
      b.add(geo.bevelBox(0.3, 0.13, 0.36, 0.04), { color, pos: [px, y, pz], rot: [0, turn, 0] });
      b.add(geo.cylinder(0.11, 0.11, 0.03, 10), { color: P.paper, pos: [px - 0.06, y + 0.13, pz], flat: 0.5 });
      b.add(geo.capsule(0.045, 0.34, 6, 2), { color, pos: [px + 0.08, y + 0.2, pz], rot: [Math.PI / 2, turn, 0] });
      for (const s of [-0.2, 0.2]) b.add(geo.bevelBox(0.12, 0.08, 0.1, 0.02), { color, pos: [px + 0.08, y + 0.14, pz + s], rot: [0, turn, 0] });
    };
    phone(DX + 0.05, DZ - 0.75, YELLOW, 0);
    phone(DX + 0.05, DZ + 0.55, ORANGE, 0.15);
    b.add(geo.box(0.32, 0.03, 0.24), { color: P.paper, pos: [DX - 0.15, 0.8, DZ - 0.05], rot: [0, 0.2, 0], flat: 0.5 });
    b.add(geo.cylinder(0.03, 0.03, 0.55, 5), { color: P.brass, pos: [DX + 0.42, 0.8, DZ + 1.05] });
    b.add(geo.dome(0.24, 10, 4), { color: YELLOW, pos: [DX + 0.42, 1.3, DZ + 1.05], flat: 0.4 });
    // The chair, pushed back.
    const CXH = DX + 1.15;
    const chair = b.newId();
    b.add(geo.box(0.55, 0.08, 0.55), { color: TEAL, pos: [CXH, 0.46, DZ], id: chair });
    b.add(geo.box(0.08, 0.62, 0.55), { color: TEAL, pos: [CXH + 0.25, 0.54, DZ], id: chair });
    b.add(geo.cylinder(0.04, 0.04, 0.46, 5), { color: P.steel, pos: [CXH, 0, DZ] });
    b.add(geo.cylinder(0.3, 0.3, 0.05, 8), { color: P.steel, pos: [CXH, 0, DZ] });
    colliders.push({ kind: 'box', x: DX + 0.3, z: DZ, hw: 0.95, hd: 1.3 });
  }

  // The rolodex stand. The wheel itself turns, below. The axle is turned off square so the cards face
  // whoever walks over from the middle of the plaza and the wheel shows three quarters from the road.
  const RX = 14.2, RY = 1.95, RZ = 8.0, RYAW = 0.45;
  {
    const cs = Math.cos(RYAW), sn = Math.sin(RYAW);
    const along = (s: number, y: number): V3 => [RX + s * sn, y, RZ + s * cs];
    b.add(geo.bevelBox(1.4, 0.18, 3.1, 0.05), { color: IRON, pos: [RX, 0, RZ], rot: [0, RYAW, 0] });
    const leg = b.newId();
    for (const s of [-1.3, 1.3]) {
      b.add(geo.extrude([[-0.55, 0], [0.55, 0], [0.14, RY + 0.18], [-0.14, RY + 0.18]], 0.14, { cacheKey: 'switchboard-rolo-leg' }), {
        color: TEAL, pos: along(s, 0.18), rot: [0, RYAW, 0], id: leg,
      });
    }
    cast(geo.cylinder(1.5, 1.5, 0.3, 12), [RX, RY - 0.15, RZ], yawed([Math.PI / 2, 0, 0], RYAW), [1, 1, 1.25]);
    colliders.push({ kind: 'box', x: RX, z: RZ, hw: 1.05, hd: 1.6, rot: RYAW });
  }

  // A tree behind the colonnade's north end and one on the west of the plaza.
  tree(22.2, -10.8, 6.6, LEAVES[3]);
  tree(-15.8, 3.6, 7.0, LEAVES[1]);
  if (!low) tree(-3.2, 23.4, 6.0, LEAVES[4], false);

  // Small things underfoot: two covers over the cable vaults.
  for (const [x, z] of [[2.2, -5.2], [-6.8, 9.4]] as const) {
    b.add(geo.cylinder(0.5, 0.5, 0.03, 12), { color: P.steel, pos: [x, 0, z], flat: 0.4 });
    b.add(geo.ring(0.3, 0.38, 12), { color: mix(P.steel, P.ink, 0.3), pos: [x, 0.035, z], flat: 1, outline: false });
  }

  group.add(b.build('switchboard-static'));

  // ------------------------------------------------------------------------------------------
  // The rolodex wheel. Cards all round, the clients lettered on some of them.
  // ------------------------------------------------------------------------------------------
  const rb = kit.builder();
  {
    const N = low ? 28 : high ? 44 : 36;
    const CLIENTS = ['UBER', 'ADOBE', 'HACKERONE', 'ANHEUSER-BUSCH', 'JPMC', 'AMERICAN EXPRESS'];
    const card = geo.box(1.8, 0.95, 0.035);
    const tab = geo.box(0.36, 0.14, 0.04);
    const plate = geo.box(1.7, 0.46, 0.05);
    const tabColors = [YELLOW, ORANGE, TEAL, P.pink as string];
    const named = new Map<number, string>();
    CLIENTS.forEach((c, i) => named.set(Math.round((i * N) / CLIENTS.length), c));
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      const n = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
      const rot = basisRot(zAxis, d, n);
      rb.add(card, { color: P.paper, pos: [d.x * 0.55, d.y * 0.55, 0], rot, flat: 0.25 });
      const name = named.get(i);
      if (name) {
        // A wide index tab standing on the card's outer edge, facing out, lettered along the axle.
        // It reads the right way up as it comes round the side toward the plaza.
        const u = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0);
        const prot = basisRot(zAxis, u, d);
        const id = rb.add(plate, { color: P.paper, pos: [d.x * 1.52 - u.x * 0.23, d.y * 1.52 - u.y * 0.23, 0], rot: prot, flat: 0.25 });
        rb.label({
          text: name, size: fit(name, 0.2, 1.45), pos: [d.x * 1.548, d.y * 1.548, 0], rot: prot,
          ink: P.ink, plate: P.paper, id, flat: 0.25, pad: 0.1,
        });
      } else {
        rb.add(tab, { color: tabColors[i % tabColors.length], pos: [d.x * 1.48, d.y * 1.48, 0.55 - (i % 3) * 0.5], rot, flat: 0.4 });
      }
    }
    rb.add(geo.cylinder(0.5, 0.5, 2.0, 12), { color: mix(TEAL, P.ink, 0.15), pos: [0, 0, -1.0], rot: [Math.PI / 2, 0, 0] });
    for (const s of [-1, 1]) {
      rb.add(geo.cylinder(0.62, 0.62, 0.08, 12), { color: P.steel, pos: [0, 0, s > 0 ? 1.0 : -1.08], rot: [Math.PI / 2, 0, 0] });
      rb.add(geo.cylinder(0.26, 0.2, 0.36, 10), { color: YELLOW, pos: [0, 0, s > 0 ? 1.3 : -1.66], rot: [Math.PI / 2, 0, 0], flat: 0.3 });
    }
  }
  const wheel = rb.build('switchboard-rolodex');
  wheel.position.set(RX, RY, RZ);
  wheel.rotation.y = RYAW;
  group.add(wheel);
  // At rest a named card faces the plaza.
  const WHEEL0 = Math.PI - 0.08;

  // ------------------------------------------------------------------------------------------
  // The handset over the roof. Far too big, floating, its cord coiling down and stopping short.
  // ------------------------------------------------------------------------------------------
  const hb = kit.builder();
  const HANDSET_Y = ROOF + 11.6;
  {
    const grip = geo.bevelBox(5.2, 0.8, 1.15, 0.2);
    hb.add(grip, { gradient: { bottom: ORANGE, top: YELLOW }, color: YELLOW, pos: [0, -0.4, 0] });
    for (const s of [-1, 1]) {
      const cup = geo.cylinder(1.05, 0.72, 1.1, 14);
      hb.add(cup, { gradient: { bottom: ORANGE, top: YELLOW }, color: YELLOW, pos: [s * 2.55, -1.45, 0], rot: [0, 0, s * 0.18] });
      hb.add(geo.disc(0.62, 12), { color: mix(ORANGE, P.ink, 0.35), pos: [s * 2.55 - s * 0.26, -1.47, 0], rot: [Math.PI, 0, s * 0.18], flat: 0.6 });
    }
    // The coiled cord, straight down the axis it turns about, ending in a plug.
    const coil: V3[] = [];
    const turns = 12;
    const len = 6.4;
    const per = high ? 10 : 7;
    for (let i = 0; i <= turns * per; i++) {
      const u = i / (turns * per);
      const a = u * turns * Math.PI * 2;
      coil.push([Math.cos(a) * 0.3, -0.5 - u * len, Math.sin(a) * 0.3]);
    }
    hb.add(geo.tube(coil, 0.07, { radial: 4, perSpan: 1 }), { color: ORANGE, flat: 0.3 });
    hb.add(geo.cylinder(0.16, 0.16, 0.7, 8), { color: P.brass, pos: [0, -0.5 - len - 0.75, 0], flat: 0.3 });
    hb.add(geo.cylinder(0.24, 0.24, 0.3, 8), { color: ORANGE, pos: [0, -0.5 - len - 0.3, 0] });
  }
  const handset = hb.build('switchboard-handset');
  handset.position.set(0, HANDSET_Y, CZ);
  handset.rotation.y = 0.35;
  handset.scale.setScalar(1.3);
  group.add(handset);

  // ------------------------------------------------------------------------------------------
  // Calls coming in: a bead of light running along each pole wire to the board.
  // ------------------------------------------------------------------------------------------
  const S = wires.length ? wires[0].length : 0;
  const nBeads = low ? Math.ceil(wires.length / 2) : wires.length;
  const track = new Float32Array(wires.length * S * 3);
  wires.forEach((w, i) => w.forEach((p, j) => track.set(p, (i * S + j) * 3)));
  const beadWire = new Int16Array(nBeads);
  const beadSpeed = new Float32Array(nBeads);
  const beadPhase = new Float32Array(nBeads);
  for (let i = 0; i < nBeads; i++) {
    beadWire[i] = low ? i * 2 : i;
    beadSpeed[i] = 0.07 + rng() * 0.07;
    beadPhase[i] = rng();
  }
  const beads = kit.instances(geo.sphere(0.17, 8, 6), nBeads, { color: '#fff1a0', flat: 1 });
  beads.name = 'switchboard-beads';
  const m4 = new THREE.Matrix4();
  const placeBeads = (t: number): void => {
    for (let i = 0; i < nBeads; i++) {
      let u = (t * beadSpeed[i] + beadPhase[i]) % 1;
      if (u < 0) u += 1;
      const f = u * (S - 1);
      const j = Math.min(S - 2, Math.floor(f));
      const k = f - j;
      const o = (beadWire[i] * S + j) * 3;
      m4.makeTranslation(
        track[o] + (track[o + 3] - track[o]) * k,
        track[o + 1] + (track[o + 4] - track[o + 1]) * k,
        track[o + 2] + (track[o + 5] - track[o + 2]) * k,
      );
      beads.setMatrixAt(i, m4);
    }
    beads.instanceMatrix.needsUpdate = true;
  };
  placeBeads(0);
  beads.computeBoundingSphere();
  group.add(beads);

  // ------------------------------------------------------------------------------------------
  // Points of interest.
  // ------------------------------------------------------------------------------------------
  if (has('tek-recruiter')) pois.push({ entry: 'tek-recruiter', x: 1.0, z: FZ + 3.6, y: 3.0, reach: 4.8, prompt: 'Look at the board' });
  if (has('tek-am')) pois.push({ entry: 'tek-am', x: 10.4, z: 8.6, y: 2.6, reach: 4.5, prompt: 'Turn the rolodex' });
  // Anything else filed here later still gets a place to be read: in front of the desk.
  let spare = 0;
  for (const e of entries) {
    if (e.id === 'tek-recruiter' || e.id === 'tek-am') continue;
    pois.push({ entry: e.id, x: -4 + spare * 2.5, z: -9, prompt: 'Look closer' });
    spare++;
  }

  return {
    group,
    colliders,
    pois,
    update(_dt, t) {
      wheel.rotation.z = WHEEL0 + t * 0.12;
      handset.position.y = HANDSET_Y + Math.sin(t * 0.45) * 0.3;
      handset.rotation.y = 0.35 + t * 0.08;
      placeBeads(t);
    },
  };
}
