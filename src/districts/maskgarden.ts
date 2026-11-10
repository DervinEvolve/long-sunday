// The Mask Garden. Diaspora DAO, 2022 to 2024.
// A community garden on a gap lot between two brick party walls. The walls stand north and east
// and the alley between them is the road on to Sky Harbor. Masks grow here the way sunflowers do:
// seedlings in the raised beds, bigger ones on posts that turn to watch whoever walks by, three
// monoliths under the painted wall, and one that outgrew its bed, pulled its roots and floats over
// the middle of the lot. Everything else is laid out round it: founder's stone by the gate, the
// ring of workbenches, the stage and its seats, the billboard, the doorways, and the fork.
//
// Seven draw calls: the lot, the floating mask, seedlings, post masks, chairs, bulbs, price tags.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import { gates } from '../world/layout';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, PartOpts, Poi } from '../types';

type V3 = [number, number, number];
type P2 = [number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const D2R = Math.PI / 180;
const STOREY = 3.1;
const IRON = '#3d3766';
const IRON_GREEN = '#2f7d62';
const WINDOW = '#56528f';
const LIT = '#f6d98a';
const TRUNK = '#7a5a86';
const WOOD = '#d99a6a';
const WOOD_DEEP = '#a8643f';
const SOIL = '#7d5560';
const FILM = '#2b2654';
const LEAVES = ['#7fb85a', '#63aa5e', '#3f8a57', '#8cc56c', '#4f9c62'];
const DRY = ['#b9a27a', '#a58a72', '#c4b08a'];

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

/** A spot and a heading. Local +z is the front, local +x is to the right of someone looking at the front. */
interface Frame { x: number; z: number; yaw: number; cs: number; sn: number }
const frame = (x: number, z: number, yaw: number): Frame => ({ x, z, yaw, cs: Math.cos(yaw), sn: Math.sin(yaw) });
const at = (f: Frame, lx: number, y: number, lz: number): V3 => [f.x + lx * f.cs + lz * f.sn, y, f.z - lx * f.sn + lz * f.cs];
/** The heading whose front looks along (dx, dz). */
const facing = (dx: number, dz: number): number => Math.atan2(dx, dz);

const qa = new THREE.Quaternion();
const ea = new THREE.Euler();
const eb = new THREE.Euler();
/** Builder rotation for "tip it by rx and rz first, then turn it by yaw". */
function turned(yaw: number, rx: number, rz: number): V3 {
  ea.set(rx, yaw, rz, 'YXZ');
  qa.setFromEuler(ea);
  eb.setFromQuaternion(qa, 'XYZ');
  return [eb.x, eb.y, eb.z];
}

export const district: DistrictModule = {
  id: 'maskgarden',
  build(ctx) {
    return buildGarden(ctx);
  },
};

function buildGarden(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const sun = ctx.sun ?? FALLBACK_SUN;
  const RED = site.accents[0];
  const GOLD = site.accents[1];
  const GREEN = site.accents[2];
  const CREAM = P.marble;

  // Heights. The plaza paving is 3 cm proud of the pad, the lawns sit a little over that.
  const PAVE = 0.03;
  const LAWN = 0.085;
  const shadePave = mix(mix(P.pave, RED, 0.12), P.shadow, 0.3);
  const shadeLawn = mix(P.grass, P.shadow, 0.34);

  const group = new THREE.Group();
  group.name = 'maskgarden';
  // Scratch, for placing instances and for anything that needs one turn laid on another.
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  const AXIS_Z = new THREE.Vector3(0, 0, 1);
  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const b = kit.builder();
  const entry = (id: string) => entries.find((e) => e.id === id);
  const poi = (id: string, x: number, z: number, prompt: string, y?: number, reach?: number): void => {
    if (entry(id)) pois.push({ entry: id, x, z, prompt, y, reach });
  };
  const fit = (text: string, size: number, max: number): number => {
    const w = b.measure ? b.measure({ text, size }).width : text.length * size * 0.7;
    return w > max ? (size * max) / w : size;
  };
  const cast = (g: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: number | V3, lawn = true): void => {
    b.shadow?.(g, { color: lawn ? shadeLawn : shadePave, sun, pos, rot, scale, y: lawn ? LAWN : PAVE, lift: lawn ? 0.03 : 0.02 });
  };
  const boxCollider = (f: Frame, lx: number, lz: number, hw: number, hd: number): void => {
    const p = at(f, lx, 0, lz);
    colliders.push({ kind: 'box', x: p[0], z: p[2], hw, hd, rot: f.yaw });
  };

  // Discs and drums that face the front, kept so each size is only made once.
  const zcache = new Map<string, THREE.BufferGeometry>();
  const zdisc = (r: number, len: number, seg: number): THREE.BufferGeometry => {
    const k = `${r},${len},${seg}`;
    let g = zcache.get(k);
    if (!g) zcache.set(k, (g = new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2)));
    return g;
  };
  const tri = (hw: number, h: number, depth: number): THREE.BufferGeometry =>
    geo.extrude([[-hw, 0], [hw, 0], [0, h]], depth, { cacheKey: `maskgarden-tri-${hw}-${h}-${depth}` });

  /** A flat shape lying on the ground, from a list of (x, z) corners. */
  const slab = (pts: P2[], y: number, h: number, opts: Omit<PartOpts, 'pos' | 'rot'>): number =>
    b.add(geo.extrude(pts.map(([x, z]): P2 => [x, -z]), h), { ...opts, pos: [0, y + h / 2, 0], rot: [-Math.PI / 2, 0, 0] });
  /** A point by angle (degrees, 0 is east, 90 is south) and distance. */
  const pol = (deg: number, r: number): P2 => [Math.cos(deg * D2R) * r, Math.sin(deg * D2R) * r];

  // Plants. A clump is a hedge, a weed, or ivy when it is pressed flat against a wall.
  let clumpN = 0;
  const clump = (pos: V3, scale: V3, tint: string, rot?: V3, count = 4): void => {
    b.add(geo.blobs(31 + (clumpN++ % 7), count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos, rot, scale, sway: 0.12,
    });
  };
  const flower = (x: number, y: number, z: number, color: ColorLike): void => {
    b.add(geo.ico(0.13, 0), { color, pos: [x, y, z], flat: 0.7, outline: false });
  };
  const tree = (x: number, z: number, h: number, tint: string): void => {
    const s = h / 7;
    const f = frame(x, z, rng() * 6.28);
    b.add(geo.cylinder(0.95, 0.95, 0.12, 8), { color: P.grassDeep, pos: [x, 0, z], flat: 0.5 });
    b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, 0, z], sway: 0.2, swayBase: 0 });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: 0 };
    const id = b.newId();
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    b.add(ball, { ...leaf, id, pos: at(f, 0, 4.9 * s, 0), scale: [2.5 * s, 2.0 * s, 2.4 * s] });
    b.add(ball, { ...leaf, id, pos: at(f, -1.6 * s, 4.6 * s, -0.9 * s), scale: [1.5 * s, 1.25 * s, 1.45 * s] });
    b.add(ball, { ...leaf, pos: at(f, 1.6 * s, 4.0 * s, 0.8 * s), scale: [1.7 * s, 1.35 * s, 1.6 * s] });
    cast(ball, [x, 4.9 * s, z], undefined, [2.5 * s, 2.0 * s, 2.4 * s]);
    colliders.push({ kind: 'circle', x, z, r: 0.36 * s });
  };

  // ------------------------------------------------------------------------------------------
  // The lay of the lot. Three ways in: the avenue from the south west, the avenue on to the
  // north west, and the side road east through the alley. The two party walls are set by hand
  // to leave all three open, so these numbers go with the map as it is now.
  // ------------------------------------------------------------------------------------------
  const gs = gates(site.id);
  const deg = (g: { x: number; z: number } | undefined, fallback: number): number =>
    g ? ((Math.atan2(g.z, g.x) / D2R) + 360) % 360 : fallback;
  const T_IN = deg(gs[0], 143.4);
  const T_NORTH = deg(gs[1], 221.1);
  const T_EAST = deg(gs[2], 331.9);
  const inX = Math.cos(T_IN * D2R), inZ = Math.sin(T_IN * D2R); // from the centre out to the way in
  const eastX = Math.cos(T_EAST * D2R), eastZ = Math.sin(T_EAST * D2R);

  // North wall: its face is 24 m from the centre and looks back at it. East wall: 25 m.
  const FA = frame(7.4, -22.8, facing(-0.309, 0.951));
  const FB = frame(24.1, 6.5, facing(-0.966, -0.259));
  const rotA: V3 = [0, FA.yaw, 0];
  const rotB: V3 = [0, FB.yaw, 0];
  // The gateposts stand a couple of steps inside where he lands, wide of the way in.
  const GATE_AT = 20.6, GATE_HALF = 6.3;
  const GATE_R: P2 = [inZ * GATE_HALF + inX * GATE_AT, -inX * GATE_HALF + inZ * GATE_AT]; // right of the way in, seen walking in
  const GATE_L: P2 = [-inZ * GATE_HALF + inX * GATE_AT, inX * GATE_HALF + inZ * GATE_AT];

  // ------------------------------------------------------------------------------------------
  // Ground. Three lawns fill the lot and leave the paving showing as the paths: a round in the
  // middle and a way out to each gate.
  // ------------------------------------------------------------------------------------------
  const R_IN = 7;
  const PATH_HALF = 2.3;
  {
    const lawn = (t0: number, t1: number, rout: (a: number) => number): void => {
      const pts: P2[] = [];
      const off = (r: number): number => Math.asin(PATH_HALF / r) / D2R;
      const push = (p: P2): void => {
        const q = pts[pts.length - 1];
        if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.08) pts.push(p);
      };
      const a0 = t0 + off(R_IN), a1 = t1 - off(R_IN);
      const n = Math.ceil((a1 - a0) / (low ? 16 : 10));
      for (let i = 0; i <= n; i++) push(pol(a0 + ((a1 - a0) * i) / n, R_IN));
      const m = Math.ceil((t1 - t0) / (low ? 10 : 6));
      for (let i = m; i >= 0; i--) {
        const a = t0 + ((t1 - t0) * i) / m;
        const r = rout(a);
        const d = off(r);
        push(pol(Math.min(t1 - d, Math.max(t0 + d, a)), r));
      }
      slab(pts, 0, LAWN, { color: P.grass, flat: 0.35 });
    };
    /** Distance from the centre to a wall face along a ray, with the wall's own bearing and distance. */
    const wall = (a: number, bearing: number, d: number, cap: number, open: number): number => {
      const k = Math.cos((a - bearing) * D2R);
      return k > 0.45 ? Math.min(cap, d / k) : open;
    };
    const table = (rows: P2[]) => (a: number): number => {
      for (let i = 1; i < rows.length; i++) {
        if (a <= rows[i][0]) {
          const k = (a - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]);
          return rows[i - 1][1] + (rows[i][1] - rows[i - 1][1]) * Math.max(0, k);
        }
      }
      return rows[rows.length - 1][1];
    };
    // West, between the way in and the avenue north.
    lawn(T_IN, T_NORTH, table([[143, 20.4], [160, 20.4], [173, 22.3], [222, 22.3]]));
    // North, under the painted wall.
    lawn(T_NORTH, T_EAST, (a) => (a < 251 ? 25.8 : a > 320 ? 26 : wall(a, 288, 24.5, 27, 26)));
    // South and east: the benches, the billboard, the seats and the stage.
    const south = table([[44, 27.5], [54, 27.6], [66, 25.6], [81, 23.6], [97, 22.6], [114, 22.0], [126, 20.4], [150, 20.4]]);
    lawn(T_EAST, T_IN + 360, (a) => {
      const t = a - 360;
      if (t < -16) return 26;
      if (t < 44) return wall(t, 15, 25.5, 27.5, 26);
      return south(t);
    });

    // The round in the middle: two inlaid bands in the garden's colours.
    b.add(geo.ring(6.25, 6.55, low ? 24 : 40), { color: GOLD, pos: [0, PAVE + 0.022, 0], flat: 1, outline: false });
    b.add(geo.ring(5.75, 5.95, low ? 24 : 40), { color: RED, pos: [0, PAVE + 0.022, 0], flat: 1, outline: false });

    // Mown rings on the lawns, going out from the middle like the rings round a dropped stone.
    const MOWN = mix(P.grass, P.grassLight, 0.5);
    const band = (t0: number, t1: number, r0: number, r1: number): void => {
      const a0 = t0 + Math.asin((PATH_HALF + 0.5) / r0) / D2R, a1 = t1 - Math.asin((PATH_HALF + 0.5) / r0) / D2R;
      b.add(geo.ring(r0, r1, Math.max(6, Math.round((a1 - a0) / (low ? 12 : 7))), (a1 - a0) * D2R), { color: MOWN, pos: [0, LAWN + 0.01, 0], rot: [0, -a1 * D2R, 0], flat: 0.35, outline: false });
    };
    for (const [r0, r1] of [[9.6, 11.6], [14.4, 16.6], [19.2, 20.3]] as const) {
      band(T_IN, T_NORTH, r0, r1);
      band(T_NORTH, T_EAST, r0, r1);
      band(T_EAST, T_IN + 360, r0, r1);
    }

    // The threshold: three stripes across the way in, on the line between the gateposts.
    [RED, GOLD, GREEN].forEach((c, i) => {
      const r = GATE_AT - 0.5 + i * 0.5;
      b.add(geo.box(PATH_HALF * 2 + 1.6, 0.02, 0.36), { color: c, pos: [inX * r, PAVE + 0.012, inZ * r], rot: [0, Math.atan2(inX, inZ), 0], flat: 1, outline: false });
    });
    // Flowers down both edges of the way in, in a strip of turned soil.
    // The right one stops short of the founder's stone. The left one leaves a gap for the stones to the doorways.
    for (const [side, r0, r1] of [[1, 9.2, 13.0], [-1, 9.2, 12.9], [-1, 15.1, 18.6]] as const) {
      const off = PATH_HALF + 0.42;
      const mid = (r0 + r1) / 2;
      b.add(geo.box(0.7, 0.05, r1 - r0), { color: SOIL, pos: [inX * mid + inZ * side * off, LAWN - 0.02, inZ * mid - inX * side * off], rot: [0, Math.atan2(inX, inZ), 0], flat: 0.3 });
      const n = Math.round((r1 - r0) / (low ? 1.6 : 0.85));
      for (let i = 0; i < n; i++) {
        const r = r0 + 0.4 + ((r1 - r0 - 0.8) * i) / Math.max(1, n - 1);
        const x = inX * r + inZ * side * off, z = inZ * r - inX * side * off;
        b.add(geo.cone(0.09, 0.3, 4), { color: LEAVES[i % LEAVES.length], pos: [x, LAWN, z], flat: 0.3, outline: false });
        flower(x, LAWN + 0.36, z, [RED, GOLD, CREAM, P.pink][(i + (r0 > 14 ? 2 : 0)) % 4]);
      }
    }
  }

  // Stepping stones across the lawns, one every stride and a bit.
  const stones = (line: P2[], r = 0.46, tone: ColorLike = P.pave, gap = 1.25): void => {
    let carry = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], c = line[i + 1];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      let d = carry;
      for (; d <= len; d += gap) {
        const k = d / len;
        const x = a[0] + (c[0] - a[0]) * k + (rng() - 0.5) * 0.16;
        const z = a[1] + (c[1] - a[1]) * k + (rng() - 0.5) * 0.16;
        b.add(geo.cylinder(r, r, 0.07, 7), { color: tone, pos: [x, LAWN - 0.012, z], rot: [0, rng() * 6.28, 0], scale: [1, 1, 0.82 + rng() * 0.3] });
      }
      carry = d - len;
    }
  };

  // ------------------------------------------------------------------------------------------
  // The party walls. Each is the blind side of a brick walk-up: no windows toward the lot, a
  // cornice, a footing, windows on the far side so the streets behind are not looking at a slab.
  // ------------------------------------------------------------------------------------------
  const paneTint = (): string => {
    const r = rng();
    return r < 0.16 ? LIT : r < 0.34 ? (P.glass as string) : WINDOW;
  };
  /** One building, from x0 to x1 along the wall, its lot face at `face`. Returns the roof height. */
  const block = (f: Frame, x0: number, x1: number, face: number, depth: number, storeys: number, wallC: string, footC: string, endL: boolean, endR: boolean): number => {
    const w = x1 - x0, cx = (x0 + x1) / 2, cz = face - depth / 2;
    const H = 1.0 + storeys * STOREY;
    let lo = 0;
    for (const lx of [x0, cx, x1]) for (const lz of [face, face - depth]) {
      const p = at(f, lx, 0, lz);
      lo = Math.min(lo, ctx.groundAt(p[0], p[2]));
    }
    const base = lo - 0.7;
    const rot: V3 = [0, f.yaw, 0];
    b.add(geo.box(w, H - base, depth), { gradient: { bottom: mix(wallC, footC, 0.75), top: wallC }, color: wallC, pos: at(f, cx, base, cz), rot, hatch: 0.1 });
    b.add(geo.box(w + 0.16, 1.0 - base, depth + 0.16), { color: footC, pos: at(f, cx, base, cz), rot });
    b.add(geo.box(w + 0.5, 0.4, depth + 0.5), { color: P.marble, pos: at(f, cx, H, cz), rot });
    b.add(geo.box(w + 0.16, 0.34, depth + 0.16), { color: footC, pos: at(f, cx, H + 0.4, cz), rot });
    const pane = geo.plane(1.25, 1.75);
    const bays = Math.max(2, Math.round(w / 3.1));
    for (let k = 0; k < storeys; k++) {
      const y = 1.0 + k * STOREY + 1.7;
      for (let i = 0; i < bays; i++) {
        if (low && (i + k) % 2) continue;
        b.add(pane, { color: paneTint(), pos: at(f, x0 + ((i + 0.5) * w) / bays, y, face - depth - 0.04), rot: [0, f.yaw + Math.PI, 0], flat: 0.7 });
      }
      for (const [on, x, turn] of [[endL, x0 - 0.04, -Math.PI / 2], [endR, x1 + 0.04, Math.PI / 2]] as const) {
        if (!on) continue;
        for (const along of [0.28, 0.72]) b.add(pane, { color: paneTint(), pos: at(f, x, y, face - depth * along), rot: [0, f.yaw + turn, 0], flat: 0.7 });
      }
    }
    boxCollider(f, cx, cz, w / 2 + 0.15, depth / 2 + 0.15);
    return H + 0.74;
  };
  const ivy = (f: Frame, lx: number, y: number, w: number, h: number, tint: number, face = 0): void => {
    clump(at(f, lx, y, face + 0.1), [w, h, 0.34], LEAVES[tint % LEAVES.length], [0, f.yaw, 0], 5);
  };
  const tank = (f: Frame, lx: number, lz: number, roof: number): void => {
    for (const sx of [-0.8, 0.8]) for (const sz of [-0.8, 0.8]) {
      b.add(geo.tube([at(f, lx + sx, roof, lz + sz), at(f, lx + sx * 0.85, roof + 1.5, lz + sz * 0.85)], 0.07, { radial: 5, perSpan: 2 }), { color: IRON });
    }
    b.add(geo.cylinder(1.3, 1.3, 0.12, 10), { color: IRON, pos: at(f, lx, roof + 1.45, lz) });
    b.add(geo.prism(10, 1.2, 1.12, 2.1), { color: WOOD_DEEP, pos: at(f, lx, roof + 1.57, lz), hatch: 0.15 });
    b.add(geo.cone(1.4, 0.95, 10), { color: mix(P.brickDeep, P.shadow, 0.35), pos: at(f, lx, roof + 3.67, lz) });
  };
  const roofGarden = (f: Frame, x0: number, x1: number, z0: number, z1: number, roof: number, n: number): void => {
    b.add(geo.box(x1 - x0, 0.14, z1 - z0), { color: P.grassDeep, pos: at(f, (x0 + x1) / 2, roof, (z0 + z1) / 2), rot: [0, f.yaw, 0], flat: 0.4 });
    for (let i = 0; i < (low ? Math.ceil(n / 2) : n); i++) {
      const p = at(f, x0 + 1 + ((x1 - x0 - 2) * (i + 0.5)) / n, roof + 0.55, z0 + 0.9 + rng() * (z1 - z0 - 1.8));
      clump(p, [1.0 + rng() * 0.4, 0.7 + rng() * 0.3, 0.9], LEAVES[i % LEAVES.length]);
    }
  };
  const hut = (f: Frame, lx: number, lz: number, roof: number, tone: string): void => {
    b.add(geo.box(2.2, 2.0, 2.6), { color: tone, pos: at(f, lx, roof, lz), rot: [0, f.yaw, 0] });
    b.add(geo.box(2.4, 0.16, 2.8), { color: P.marbleShade, pos: at(f, lx, roof + 2.0, lz), rot: [0, f.yaw, 0] });
  };

  const BRICK: [string, string] = [P.brick as string, P.brickDeep as string];
  const BRICK2: [string, string] = ['#b25a4b', '#8c4443'];
  const DEPTH = 5.5;
  // North wall: a tall half that carries the painted name and a lower half set back a step.
  const roofA1 = block(FA, -18, 1, 0, DEPTH, 4, BRICK[0], BRICK[1], true, true);
  const roofA2 = block(FA, 1, 15, -0.4, DEPTH - 0.4, 3, BRICK2[0], BRICK2[1], false, true);
  // East wall: the tall half is by the alley, the low half is behind the panel table.
  const roofB1 = block(FB, -15, 2, 0, DEPTH, 4, BRICK2[0], BRICK2[1], true, true);
  const roofB2 = block(FB, 2, 14, -0.4, DEPTH - 0.4, 3, BRICK[0], BRICK[1], false, true);
  tank(FA, -13.5, -2.8, roofA1);
  hut(FA, -3.2, -3.4, roofA1, mix(BRICK[0], BRICK[1], 0.4));
  roofGarden(FA, 2, 14.4, -5.0, -0.9, roofA2, 5);
  hut(FB, -3, -3.4, roofB1, mix(BRICK2[0], BRICK2[1], 0.4));
  roofGarden(FB, -13.5, -5.5, -4.8, -0.6, roofB1, 4);
  roofGarden(FB, 3, 13.4, -5.0, -0.9, roofB2, 4);
  b.add(geo.cone(0.6, 2.8, 7), { gradient: { bottom: '#2f6f50', top: LEAVES[2] }, color: LEAVES[2], pos: at(FA, 11.5, roofA2, -2.6), sway: 0.25 });

  // The name, painted on the north wall the way a wall sign is: a gold field with a pale edge.
  {
    const PW = 14.2, PH = 5.4, PY = 7.1, PX = -6.6;
    b.add(geo.box(PW + 0.6, PH + 0.6, 0.1), { color: CREAM, pos: at(FA, PX, PY - 0.3, 0.05), rot: rotA, flat: 0.4 });
    const panel = b.add(geo.box(PW, PH, 0.1), { color: GOLD, pos: at(FA, PX, PY, 0.12), rot: rotA, flat: 0.45 });
    const s1 = fit('THE MASK', 1.75, PW - 2.2);
    const s2 = fit('GARDEN', 1.75, PW - 2.2);
    b.label({ text: 'THE MASK', size: s1, pos: at(FA, PX, PY + PH * 0.71, 0.17), rot: rotA, ink: P.ink, plate: GOLD, id: panel, flat: 0.45, pad: 0.2, jitter: 0.3 });
    b.label({ text: 'GARDEN', size: s2, pos: at(FA, PX, PY + PH * 0.28, 0.17), rot: rotA, ink: P.ink, plate: GOLD, id: panel, flat: 0.45, pad: 0.2, jitter: 0.3 });
    // A red rule between the two lines, and a small mask of three shapes at each end of it.
    b.add(geo.box(PW - 5.2, 0.14, 0.04), { color: RED, pos: at(FA, PX, PY + PH * 0.5 - 0.07, 0.19), rot: rotA, flat: 1, outline: false });
    for (const side of [-1, 1]) {
      const x = PX + side * (PW / 2 - 1.3);
      b.add(zdisc(0.42, 0.06, 12), { color: RED, pos: at(FA, x, PY + PH * 0.5, 0.2), rot: rotA, flat: 0.8 });
      b.add(geo.box(0.9, 0.12, 0.08), { color: GREEN, pos: at(FA, x, PY + PH * 0.5 + 0.12, 0.22), rot: rotA, flat: 0.8 });
    }
  }
  // Ivy has most of the north wall below the sign, and is starting on the sign's corners.
  {
    const spots: [number, number, number, number, number][] = [
      [-17.2, 2.6, 1.3, 3.0, 2], [-16.6, 6.2, 0.9, 2.4, 0], [-14.2, 2.0, 1.6, 2.2, 1], [-9.3, 1.9, 1.5, 2.1, 4], [-3.6, 2.2, 1.7, 2.5, 2],
      [0.2, 3.4, 1.0, 3.6, 0], [0.5, 7.6, 0.8, 2.3, 3], [-13.7, 12.4, 1.3, 0.9, 1], [-0.3, 11.6, 0.7, 1.5, 2],
    ];
    spots.forEach((s, i) => {
      if (low && i % 2) return;
      ivy(FA, s[0], s[1], s[2], s[3], s[4]);
    });
    const low2: [number, number, number, number, number][] = [[2.6, 2.4, 1.4, 2.6, 1], [5.4, 4.6, 1.1, 4.8, 2], [6.3, 8.3, 0.9, 1.6, 0], [13.6, 2.2, 1.2, 2.4, 4]];
    for (const s of low2) ivy(FA, s[0], s[1], s[2], s[3], s[4], -0.4);
    // The ghost of a chimney that used to run up the lower half.
    b.add(geo.plane(0.9, 8.6), { color: mix(BRICK2[0], P.marble, 0.3), pos: at(FA, 8.2, 5.3, -0.37), rot: rotA, flat: 0.3 });
  }
  // East wall: ivy between the things that stand against it.
  {
    const spots: [number, number, number, number, number][] = [
      [-10.6, 2.8, 1.3, 3.0, 2], [-9.2, 6.4, 1.0, 2.6, 0], [-7.0, 2.2, 1.4, 2.4, 1], [-10.2, 9.6, 0.9, 1.8, 3], [1.3, 8.6, 1.0, 2.6, 2], [0.4, 11.6, 1.5, 1.0, 1],
    ];
    spots.forEach((s, i) => {
      if (low && i % 2) return;
      ivy(FB, s[0], s[1], s[2], s[3], s[4]);
    });
    const low2: [number, number, number, number, number][] = [[5.2, 2.6, 1.2, 2.8, 4], [13.2, 3.0, 1.0, 3.2, 2], [12.6, 6.8, 0.9, 1.6, 0], [4.6, 7.4, 1.6, 1.0, 1]];
    for (const s of low2) ivy(FB, s[0], s[1], s[2], s[3], s[4], -0.4);
  }
  // A fire escape on the alley end of the east wall: three landings and the ladders between.
  if (!low) {
    const p0 = at(FB, -15, 0, -DEPTH / 2);
    const fe = frame(p0[0], p0[2], FB.yaw - Math.PI / 2);
    const rot: V3 = [0, fe.yaw, 0];
    for (let k = 1; k < 4; k++) {
      const y = 1.0 + k * STOREY + 0.5;
      b.add(geo.box(2.9, 0.09, 0.95), { color: IRON, pos: at(fe, 0, y, 0.5), rot });
      b.add(geo.box(2.9, 0.07, 0.07), { color: IRON, pos: at(fe, 0, y + 1.0, 0.94), rot });
      b.add(geo.plane(2.84, 0.95), { color: IRON, pos: at(fe, 0, y + 0.56, 0.94), rot, dither: 0.5, flat: 1 });
      for (const s of [-1, 1]) b.add(geo.box(0.07, 1.0, 0.07), { color: IRON, pos: at(fe, s * 1.42, y + 0.05, 0.94), rot });
      const drop = k === 1 ? 2.0 : STOREY - 0.1;
      b.add(geo.tube([at(fe, 0.95, y + 0.05, 0.7), at(fe, -0.95 * (k === 1 ? 0.2 : 1), y - drop, 0.7)], 0.055, { radial: 5, perSpan: 2 }), { color: IRON });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The lot line: a low brick wall with a pale cap, hedge behind it, open at the three ways in.
  // ------------------------------------------------------------------------------------------
  {
    const run = (line: P2[], hedgeFrom = 0): void => {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], c = line[i + 1];
        const dx = c[0] - a[0], dz = c[1] - a[1];
        const len = Math.hypot(dx, dz);
        const yaw = Math.atan2(-dz, dx);
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        b.add(geo.box(len + 0.3, 0.72, 0.42), { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, pos: [mx, 0, mz], rot: [0, yaw, 0], hatch: 0.1 });
        b.add(geo.box(len + 0.4, 0.12, 0.54), { color: P.marble, pos: [mx, 0.72, mz], rot: [0, yaw, 0] });
        colliders.push({ kind: 'box', x: mx, z: mz, hw: len / 2 + 0.15, hd: 0.3, rot: yaw });
        if (low && i % 2) continue;
        // Hedge on the lot side of the wall, which is the side nearer the centre.
        const nx = -dz / len, nz = dx / len;
        const inward = nx * -mx + nz * -mz > 0 ? 1 : -1;
        const n = Math.max(1, Math.round(len / 2.6));
        for (let j = 0; j < n; j++) {
          if ((i + j + hedgeFrom) % 3 === 2) continue;
          const k = (j + 0.5) / n;
          const hx = a[0] + dx * k + nx * inward * 0.62, hz = a[1] + dz * k + nz * inward * 0.62;
          clump([hx, 0.62, hz], [1.15, 0.72, 0.6], LEAVES[(i + j) % LEAVES.length], [0, yaw, 0], 3);
          if ((i + j) % 2 === 0) flower(hx + nx * inward * 0.5, 0.95, hz + nz * inward * 0.5, [RED, GOLD, P.pink][(i + j) % 3]);
        }
      }
    };
    const southEnd = at(FB, 14.2, 0, 0.1);
    run([[southEnd[0], southEnd[2]], [17, 23.5], [11, 24.5], [4, 24.5], [-3, 23.5], [-9.5, 21.3], GATE_R]);
    run([GATE_L, [-23.2, 3], [-23.8, -3], [-23.3, -9], [-22.3, -12]], 1);
    const northEnd = at(FA, -18.2, 0, 0.1);
    run([[-15.5, -22.5], [-12.5, -26], [northEnd[0], northEnd[2]]], 2);

    // What is left of a colonnade, standing on the south wall as if the wall had been built round
    // it. Three columns still carry their beam. The fourth lost its top.
    {
      const a: P2 = [4, 24.5], c: P2 = [-3, 23.5];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const yaw = Math.atan2(-dz, dx);
      const lip = mix(P.marble, P.marbleShade, 0.5);
      const H = 3.9;
      const spot = (k: number): P2 => [a[0] + dx * k, a[1] + dz * k];
      [0.1, 0.38, 0.66, 0.94].forEach((k, i) => {
        const [x, z] = spot(k);
        const whole = i < 3;
        b.add(geo.bevelBox(0.95, 0.3, 0.95, 0.05), { color: P.marbleShade, pos: [x, 0.84, z], rot: [0, yaw, 0] });
        b.add(geo.prism(high ? 12 : 8, whole ? 0.27 : 0.31, 0.34, whole ? H : 1.7), { color: P.marble, pos: [x, 1.14, z] });
        if (whole) b.add(geo.cylinder(0.44, 0.29, 0.3, 10), { color: lip, pos: [x, 1.14 + H, z] });
      });
      const [bx, bz] = spot(0.38);
      const beam = geo.box(4.9, 0.5, 0.8);
      b.add(beam, { color: P.marble, pos: [bx, 1.44 + H, bz], rot: [0, yaw, 0] });
      b.add(geo.box(5.2, 0.16, 1.0), { color: lip, pos: [bx, 1.94 + H, bz], rot: [0, yaw, 0] });
      const f = frame(bx, bz, yaw);
      clump(at(f, -1.2, 2.1 + H, 0.1), [1.3, 0.5, 0.6], LEAVES[1], [0, yaw, 0], 4);
      clump(at(f, 2.3, 1.2 + H, 0.2), [0.5, 1.1, 0.5], LEAVES[2], [0, yaw, 0], 4);
      clump(at(f, 2.2, 2.6, -0.3), [0.4, 1.4, 0.4], LEAVES[0], [0, yaw, 0], 4);
      const [fx, fz] = spot(0.94);
      clump([fx + 0.1, 2.9, fz], [0.45, 0.35, 0.45], P.moss as string, undefined, 3);
    }

    // Two marble columns where the avenue comes in, a lamp on each. Old stone, new lot.
    for (const [g, whole] of [[GATE_R, true], [GATE_L, true]] as const) {
      const [x, z] = g;
      b.add(geo.bevelBox(1.1, 0.34, 1.1, 0.05), { color: P.marbleShade, pos: [x, 0, z] });
      b.add(geo.cylinder(0.46, 0.5, 0.16, 10), { color: mix(P.marble, P.marbleShade, 0.5), pos: [x, 0.34, z] });
      const shaft = geo.prism(high ? 12 : 8, 0.31, 0.38, 3.3);
      b.add(shaft, { color: P.marble, pos: [x, 0.5, z] });
      cast(shaft, [x, 0.5, z], undefined, undefined, false);
      if (whole) {
        b.add(geo.cylinder(0.48, 0.32, 0.3, 10), { color: mix(P.marble, P.marbleShade, 0.5), pos: [x, 3.8, z] });
        b.add(geo.box(1.0, 0.24, 1.0), { color: P.marble, pos: [x, 4.1, z] });
        b.add(geo.sphere(0.34, 10, 7), { color: LIT, pos: [x, 4.66, z], flat: 0.85 });
      }
      colliders.push({ kind: 'circle', x, z, r: 0.6 });
    }
    clump([GATE_R[0] + 0.5, 1.6, GATE_R[1] + 0.2], [0.55, 1.5, 0.55], LEAVES[2], undefined, 5);
    clump([GATE_L[0] - 0.3, 0.4, GATE_L[1] + 0.6], [0.8, 0.4, 0.6], P.moss as string, undefined, 3);
  }

  // ------------------------------------------------------------------------------------------
  // Founder's stone, just inside the gate on the right. [diaspora-origin]
  // ------------------------------------------------------------------------------------------
  {
    const sx = site.arrive.x - inX * 8.2 + inZ * 4.7, sz = site.arrive.z - inZ * 8.2 - inX * 4.7;
    // Turned most of the way toward the gate, so it can be read on the way in.
    const f = frame(sx, sz, facing(inX * 0.644 - inZ * 0.727, inZ * 0.644 + inX * 0.727));
    const rot: V3 = [0, f.yaw, 0];
    b.add(geo.bevelBox(2.5, 0.32, 1.1, 0.05), { color: P.marbleShade, pos: at(f, 0, 0, 0), rot });
    const outline: P2[] = [[-0.85, 0], [0.85, 0], [0.82, 1.75], [0.5, 2.1], [-0.2, 2.25], [-0.8, 1.9]];
    const g = geo.extrude(outline, 0.5, { crease: 30, cacheKey: 'maskgarden-stone' });
    const id = b.add(g, { color: P.marble, pos: at(f, 0, 0.32, 0), rot, flat: 0.25 });
    cast(g, at(f, 0, 0.32, 0), rot);
    b.label({ text: 'DIASPORA DAO', size: fit('DIASPORA DAO', 0.2, 1.4), pos: at(f, 0, 1.78, 0.25), rot, ink: P.ink, plate: P.marble, id, flat: 0.25, pad: 0.15, jitter: 0.3 });
    b.label({ text: 'FOUNDED 2023', size: 0.12, pos: at(f, 0, 1.4, 0.25), rot, ink: P.violet, plate: P.marble, id, flat: 0.25, pad: 0.15, jitter: 0.3 });
    // The three colours, set in as a small mask of a disc, a bar and a triangle.
    b.add(zdisc(0.2, 0.06, 10), { color: RED, pos: at(f, 0, 0.92, 0.27), rot, flat: 0.8 });
    b.add(geo.box(0.62, 0.08, 0.06), { color: GOLD, pos: at(f, 0, 1.09, 0.25), rot, flat: 0.8 });
    b.add(tri(0.12, 0.26, 0.06), { color: GREEN, pos: at(f, 0, 0.58, 0.27), rot: turned(f.yaw, 0, Math.PI), flat: 0.8 });
    clump(at(f, -0.95, 0.42, 0.3), [0.6, 0.32, 0.45], P.moss as string, rot, 3);
    clump(at(f, 0.9, 0.9, -0.1), [0.3, 0.9, 0.4], LEAVES[2], rot, 3);
    flower(at(f, 0.7, 0, 0.7)[0], 0.42, at(f, 0.7, 0, 0.7)[2], GOLD);
    boxCollider(f, 0, 0, 1.25, 0.55);
    const stand = at(f, -0.2, 0, 2.0);
    poi('diaspora-origin', stand[0], stand[2], "Read the founder's stone", 3.0);
  }

  // ------------------------------------------------------------------------------------------
  // The garden of masks. [mask-pass] Four sizes, one design each. The three under the wall are
  // drawn here; the seedlings and the post masks are instanced further down.
  // ------------------------------------------------------------------------------------------
  /** Where a seedling's head goes: x, y, z, then the turn as three angles, size, tint. */
  const sprouts: number[] = [];
  /** Where a post mask stands: x, z. */
  const posts: number[] = [];
  const POST_TOP = 1.72;
  // The stalk and its two leaves are drawn here, in the lot's own mesh, so they stay green. Only
  // the head is instanced and tinted. `lean` tips a dead one over; `y` is what it stands on.
  const stalkGeo = geo.cylinder(0.03, 0.05, 0.86, 5, true);
  const leafGeo = geo.cone(0.1, 0.42, 4);
  const sprout = (x: number, z: number, yaw: number, size: number, tint: number, lean = 0, y = 0.55): void => {
    const dead = lean > 0;
    const rot = turned(yaw, dead ? lean * 0.9 : 0, dead ? 0.3 : 0);
    sprouts.push(x, y, z, rot[0], rot[1], rot[2], size, dead ? 4 + (tint % 2) : tint % 4);
    const stem = b.add(stalkGeo, { color: dead ? DRY[1] : LEAVES[2], pos: [x, y, z], rot, scale: size });
    // The leaves sit on the stalk, so they are placed in its own frame: a point up the stalk, tipped with it.
    m4.compose(v.set(x, y, z), q.setFromEuler(e.set(rot[0], rot[1], rot[2], 'XYZ')), sc.set(size, size, size));
    for (const s of [-1, 1]) {
      v.set(s * 0.12, 0.22 + (s > 0 ? 0.14 : 0), 0).applyMatrix4(m4);
      q2.setFromAxisAngle(AXIS_Z, -s * 1.0);
      eb.setFromQuaternion(qa.copy(q).multiply(q2), 'XYZ');
      b.add(leafGeo, { color: dead ? DRY[0] : LEAVES[(tint + (s > 0 ? 0 : 3)) % LEAVES.length], pos: [v.x, v.y, v.z], rot: [eb.x, eb.y, eb.z], scale: size, id: stem });
    }
  };
  const post = (x: number, z: number): void => {
    posts.push(x, z);
    b.add(geo.cylinder(0.62, 0.62, 0.085, 9), { color: SOIL, pos: [x, LAWN - 0.02, z], flat: 0.3 });
    const pole = b.add(geo.cylinder(0.07, 0.1, POST_TOP, 6, true), { color: IRON_GREEN, pos: [x, LAWN, z] });
    const turn = rng() * 6.28;
    for (const s of [-1, 1]) {
      const f = frame(x, z, turn);
      b.add(geo.cone(0.16, 0.7, 4), { color: LEAVES[s > 0 ? 0 : 3], pos: at(f, s * 0.2, LAWN + 0.5 + (s > 0 ? 0.3 : 0), 0), rot: turned(turn, 0, -s * 1.0), id: pole });
    }
    colliders.push({ kind: 'circle', x, z, r: 0.3 });
  };
  /** A raised bed of boards with soil in it and a row of seedlings. Long way along the frame's x. */
  const bed = (f: Frame, lx: number, lz: number, len: number, n: number, tintFrom: number): void => {
    const rot: V3 = [0, f.yaw, 0];
    const boards = b.add(geo.box(len, 0.5, 1.5), { gradient: { bottom: WOOD_DEEP, top: WOOD }, color: WOOD, pos: at(f, lx, 0, lz), rot, hatch: 0.12 });
    b.add(geo.box(len + 0.12, 0.1, 1.62), { color: WOOD, pos: at(f, lx, 0.44, lz), rot, id: boards });
    b.add(geo.box(len - 0.22, 0.06, 1.28), { color: SOIL, pos: at(f, lx, 0.52, lz), rot, flat: 0.3 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(geo.box(0.14, 0.66, 0.14), { color: WOOD_DEEP, pos: at(f, lx + sx * (len / 2 + 0.02), 0, lz + sz * 0.77), rot });
    for (let i = 0; i < n; i++) {
      const x = lx - len / 2 + 0.5 + ((len - 1.0) * i) / Math.max(1, n - 1);
      const z = lz + (i % 2 ? 0.26 : -0.26);
      const p = at(f, x, 0, z);
      if (!(low && i % 2)) sprout(p[0], p[2], f.yaw + (rng() - 0.5) * 0.7, 0.85 + rng() * 0.45, tintFrom + i);
      const q = at(f, x + 0.3, 0.72, lz - (i % 2 ? 0.3 : -0.3));
      if (!low && i % 2 === 0) clump(q, [0.36, 0.26, 0.34], LEAVES[(i + tintFrom) % LEAVES.length], undefined, 3);
    }
    boxCollider(f, lx, lz, len / 2 + 0.1, 0.83);
  };
  {
    // Four beds in two rows with an aisle up the middle to the wall.
    for (const lz of [11, 14.5]) {
      bed(FA, -10.25, lz, 4.5, 6, lz > 12 ? 0 : 2);
      bed(FA, -2.75, lz, 4.5, 6, lz > 12 ? 1 : 3);
    }
    const aisle0 = at(FA, -6.5, 0, 16.6), aisle1 = at(FA, -6.5, 0, 8.3);
    stones([[aisle0[0], aisle0[2]], [aisle1[0], aisle1[2]]]);

    // The three big ones, on marble feet, with their backs to the ivy.
    const body: P2[] = [[-0.9, 0], [0.9, 0], [0.9, 3.9]];
    const seg = high ? 9 : 6;
    for (let i = 1; i < seg; i++) {
      const a = (i / seg) * Math.PI;
      body.push([Math.cos(a) * 0.9, 3.9 + Math.sin(a) * 0.9]);
    }
    body.push([-0.9, 3.9]);
    const slabGeo = geo.extrude(body, 0.6, { cacheKey: 'maskgarden-tier3-' + seg });
    const big = (lx: number, c0: ColorLike, c1: ColorLike, c2: ColorLike): void => {
      const lz = 4.2;
      const p = (x: number, y: number, z: number): V3 => at(FA, lx + x, y, lz + z);
      b.add(geo.bevelBox(2.7, 0.5, 1.8, 0.06), { color: P.marble, pos: p(0, 0, 0), rot: rotA });
      b.add(zdisc(1.55, 0.2, high ? 18 : 12), { color: c1, pos: p(0, 4.4, -0.22), rot: rotA, flat: 0.25 });
      b.add(slabGeo, { gradient: { bottom: mix(c0, P.shadow, 0.22), top: c0 }, color: c0, pos: p(0, 0.5, 0), rot: rotA });
      cast(slabGeo, p(0, 0.5, 0), rotA);
      b.add(geo.box(2.4, 0.3, 0.84), { color: c2, pos: p(0, 3.7, 0), rot: rotA });
      for (const s of [-1, 1]) {
        b.add(geo.box(0.52, 0.16, 0.74), { color: IRON, pos: p(s * 0.42, 3.25, 0), rot: rotA, flat: 0.5 });
        b.add(zdisc(0.42, 0.5, 10), { color: c1, pos: p(s * 0.95, 2.5, 0), rot: rotA, flat: 0.25 });
      }
      b.add(tri(0.3, 1.5, 0.9), { color: c2, pos: p(0, 1.7, 0), rot: rotA });
      b.add(geo.box(0.74, 0.2, 0.74), { color: IRON, pos: p(0, 1.15, 0), rot: rotA, flat: 0.5 });
      clump(p(-1.1, 0.42, 0.7), [0.6, 0.32, 0.45], P.moss as string, rotA, 3);
      boxCollider(FA, lx, lz, 1.4, 0.95);
    };
    big(-12, GOLD, RED, GREEN);
    big(-6.5, CREAM, GOLD, RED);
    big(-1, GREEN, GOLD, RED);

    // The sign that says what they are, on a marble block by the aisle.
    const sp = at(FA, -3.7, 0, 7.2);
    const sf = frame(sp[0], sp[2], FA.yaw);
    const rot: V3 = [0, sf.yaw, 0];
    b.add(geo.bevelBox(2.5, 0.42, 0.8, 0.05), { color: P.marbleShade, pos: at(sf, 0, 0, 0), rot });
    const face = b.add(geo.box(2.3, 0.9, 0.12), { color: CREAM, pos: at(sf, 0, 0.5, 0.1), rot: turned(sf.yaw, -0.32, 0), flat: 0.4 });
    const up = (y: number): V3 => at(sf, 0, 0.5 + y * Math.cos(0.32), 0.1 + 0.07 - y * Math.sin(0.32));
    b.label({ text: 'THE MASK PASS', size: fit('THE MASK PASS', 0.2, 2.0), pos: up(0.62), rot: turned(sf.yaw, -0.32, 0), ink: P.ink, plate: CREAM, id: face, flat: 0.4, pad: 0.12, jitter: 0.3 });
    b.label({ text: 'A DESIGN FOR EACH TIER', size: fit('A DESIGN FOR EACH TIER', 0.11, 2.0), pos: up(0.28), rot: turned(sf.yaw, -0.32, 0), ink: P.violet, plate: CREAM, id: face, flat: 0.4, pad: 0.12, jitter: 0.3 });
    boxCollider(sf, 0, 0, 1.3, 0.45);
    const stand = at(FA, -5.6, 0, 8.9);
    poi('mask-pass', stand[0], stand[2], 'Look up at the masks', 3.2, 5);

    // Post masks about the lot. They keep an eye on him.
    for (const [lx, lz] of [[-13.9, 14.5], [4.5, 8.5], [-15.5, 6.5]] as const) {
      const p = at(FA, lx, 0, lz);
      post(p[0], p[2]);
    }
    post(...pol(162, 12.5));
    post(...pol(200, 10.5));
    post(3.5, 10.5);
    post(13.5, 12.8);
    post(16.6, -15.2);
  }

  // The bed the biggest one left. Kerb, turned soil, the hole, a few roots it did not take.
  const HERO: P2 = [3.2, -2.4];
  {
    const [x, z] = HERO;
    b.add(geo.cylinder(2.75, 2.75, 0.09, low ? 14 : 20), { color: P.marbleShade, pos: [x, PAVE - 0.02, z] });
    b.add(geo.cylinder(2.45, 2.45, 0.1, low ? 14 : 20), { color: SOIL, pos: [x, PAVE - 0.02, z], flat: 0.3 });
    b.add(geo.cylinder(1.05, 1.2, 0.03, 12), { color: mix(SOIL, P.ink, 0.6), pos: [x, PAVE + 0.075, z], flat: 0.9 });
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + 0.4;
      const r0 = 0.9, r1 = 1.5 + (i % 2) * 0.4;
      b.add(geo.tube([[x + Math.cos(a) * r0, 0.1, z + Math.sin(a) * r0], [x + Math.cos(a + 0.2) * (r0 + r1) * 0.5, 0.24, z + Math.sin(a + 0.2) * (r0 + r1) * 0.5], [x + Math.cos(a + 0.35) * r1, 0.1, z + Math.sin(a + 0.35) * r1]], 0.05, { radial: 4, perSpan: 2 }), { color: TRUNK });
    }
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + 1.1;
      clump([x + Math.cos(a) * 1.95, 0.24, z + Math.sin(a) * 1.95], [0.4, 0.26, 0.36], LEAVES[i], undefined, 3);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Six workbenches in a ring round a tree. [diaspora-team] Four for the engineers, two for
  // the designers.
  // ------------------------------------------------------------------------------------------
  const RING: P2 = [-2.5, 16];
  {
    const [cx, cz] = RING;
    for (let i = 0; i < 6; i++) {
      const a = i * 60 * D2R;
      const dx = Math.cos(a), dz = Math.sin(a);
      const f = frame(cx + dx * 4.1, cz + dz * 4.1, facing(dx, dz));
      const rot: V3 = [0, f.yaw, 0];
      const designer = i === 1 || i === 4;
      const tone = designer ? GOLD : RED;
      const top = geo.box(1.9, 0.09, 0.82);
      b.add(top, { color: WOOD, pos: at(f, 0, 0.86, 0), rot });
      cast(top, at(f, 0, 0.86, 0), rot);
      const apron = b.add(geo.box(1.74, 0.26, 0.07), { color: tone, pos: at(f, 0, 0.6, 0.36), rot, flat: 0.4 });
      b.add(geo.box(1.7, 0.05, 0.6), { color: WOOD_DEEP, pos: at(f, 0, 0.24, 0), rot });
      for (const s of [-1, 1]) b.add(geo.box(0.09, 0.86, 0.72), { color: IRON_GREEN, pos: at(f, s * 0.86, 0, 0), rot });
      const text = designer ? 'DESIGNER' : 'ENGINEER';
      b.label({ text, size: fit(text, 0.14, 1.5), pos: at(f, 0, 0.73, 0.395), rot, ink: designer ? P.ink : CREAM, plate: tone, id: apron, flat: 0.4, pad: 0.12, jitter: 0.3 });
      if (designer) {
        // A drawing board tipped up, and a pot of pencils.
        b.add(geo.box(0.9, 0.05, 0.62), { color: CREAM, pos: at(f, -0.3, 1.02, 0.0), rot: turned(f.yaw, -0.5, 0), flat: 0.3 });
        b.add(geo.cylinder(0.1, 0.09, 0.2, 7), { color: GREEN, pos: at(f, 0.6, 0.95, 0.1) });
        b.add(geo.cone(0.05, 0.3, 4), { color: RED, pos: at(f, 0.6, 1.1, 0.1), flat: 0.5 });
      } else {
        // A box of parts with a light on it, and a coil of wire.
        b.add(geo.box(0.62, 0.34, 0.42), { color: P.steel, pos: at(f, -0.35, 0.95, -0.05), rot });
        b.add(geo.sphere(0.07, 6, 4), { color: i % 2 ? GOLD : P.cyan, pos: at(f, -0.5, 1.33, 0.02), flat: 0.9, outline: false });
        b.add(geo.torus(0.16, 0.05, 10, 4), { color: i % 2 ? P.teal : GOLD, pos: at(f, 0.5, 1.0, 0.05) });
      }
      // Something growing on every bench.
      b.add(geo.cylinder(0.13, 0.1, 0.2, 7), { color: P.brick, pos: at(f, 0.15, 0.95, -0.22) });
      clump(at(f, 0.15, 1.3, -0.22), [0.28, 0.3, 0.28], LEAVES[i % LEAVES.length], undefined, 3);
      boxCollider(f, 0, 0, 1.0, 0.46);
    }
    // The tree in the middle, a marble seat round its foot, and a board hung from a bough.
    tree(cx, cz, 7.6, LEAVES[1]);
    b.add(geo.cylinder(1.25, 1.35, 0.42, 12), { color: P.marbleShade, pos: [cx, 0, cz] });
    b.add(geo.cylinder(1.42, 1.42, 0.09, 12), { color: P.marble, pos: [cx, 0.42, cz] });
    colliders.push({ kind: 'circle', x: cx, z: cz, r: 1.45 });
    const sf = frame(cx - 0.6, cz - 1.75, facing(-0.45, -0.89));
    const rot: V3 = [0, sf.yaw, 0];
    const board = b.add(geo.box(2.5, 0.62, 0.08), { color: CREAM, pos: at(sf, 0, 2.62, 0), rot, flat: 0.45 });
    b.add(geo.box(2.6, 0.09, 0.14), { color: GREEN, pos: at(sf, 0, 3.24, 0), rot, flat: 0.4 });
    b.add(geo.tube([[cx, 3.6, cz], at(sf, 0, 3.9, 0.2), at(sf, 0, 3.4, 0)], 0.09, { radial: 5, perSpan: 3 }), { color: TRUNK });
    for (const s of [-1, 1]) b.add(geo.box(0.04, 0.3, 0.04), { color: IRON, pos: at(sf, s * 1.0, 3.3, 0), rot });
    const size = fit('A TEAM OF SIX', 0.26, 2.2);
    for (const side of [1, -1]) {
      b.label({ text: 'A TEAM OF SIX', size, pos: at(sf, 0, 2.93, side * 0.04), rot: [0, sf.yaw + (side > 0 ? 0 : Math.PI), 0], ink: P.ink, plate: CREAM, id: board, flat: 0.45, pad: 0.15, jitter: 0.3 });
    }
    stones([[-1.3, 7.9], [-2.3, 11.2]]);
    poi('diaspora-team', cx - 0.2, cz - 2.5, 'Look over the workbenches', 2.2);
  }

  // ------------------------------------------------------------------------------------------
  // The stage, against the east wall. [consensus-demo] A deck, a screen on the brick, a rail of
  // lamps, and rows of chairs on the lawn. The chairs themselves are instanced further down.
  // ------------------------------------------------------------------------------------------
  const STAGE_X = -0.5;
  /** Where a chair stands: x, y, z, heading, tint. */
  const chairs: number[] = [];
  {
    const sx = STAGE_X;
    b.add(geo.box(9.0, 0.8, 4.2), { color: mix(RED, P.shadow, 0.3), pos: at(FB, sx, 0, 2.4), rot: rotB });
    b.add(geo.box(9.3, 0.12, 4.5), { color: WOOD, pos: at(FB, sx, 0.8, 2.4), rot: rotB });
    const steps = b.newId();
    b.add(geo.box(2.6, 0.6, 0.5), { color: WOOD_DEEP, pos: at(FB, sx, 0, 4.9), rot: rotB, id: steps });
    b.add(geo.box(2.6, 0.3, 0.5), { color: WOOD_DEEP, pos: at(FB, sx, 0, 5.4), rot: rotB, id: steps });
    boxCollider(FB, sx, 2.6, 4.7, 2.5);
    // The screen: a play mark and three chips under it, which is all the demo was to look at.
    b.add(geo.box(6.6, 4.0, 0.16), { color: CREAM, pos: at(FB, sx, 1.7, 0.1), rot: rotB });
    b.add(geo.box(6.0, 3.4, 0.1), { color: FILM, pos: at(FB, sx, 2.0, 0.2), rot: rotB, flat: 0.8 });
    b.add(tri(0.7, 1.2, 0.06), { color: GOLD, pos: at(FB, sx - 0.5, 4.1, 0.28), rot: turned(FB.yaw, 0, -Math.PI / 2), flat: 1 });
    [RED, CREAM, GREEN].forEach((c, i) => {
      b.add(zdisc(0.22, 0.06, 10), { color: c, pos: at(FB, sx + (i - 1) * 0.8, 2.6, 0.28), rot: rotB, flat: 1 });
    });
    // Lectern and microphone.
    b.add(geo.box(0.7, 1.1, 0.5), { color: GREEN, pos: at(FB, sx + 1.6, 0.92, 3.6), rot: rotB });
    b.add(geo.box(0.86, 0.07, 0.62), { color: WOOD, pos: at(FB, sx + 1.6, 2.02, 3.6), rot: turned(FB.yaw, 0.3, 0) });
    b.add(geo.cylinder(0.025, 0.025, 0.4, 5), { color: IRON, pos: at(FB, sx + 1.6, 2.05, 3.7) });
    b.add(geo.sphere(0.08, 6, 4), { color: IRON, pos: at(FB, sx + 1.6, 2.5, 3.7) });
    // The rail of lamps over the front of the deck.
    const rail = b.newId();
    for (const s of [-1, 1]) b.add(geo.box(0.2, 5.3, 0.2), { color: IRON, pos: at(FB, sx + s * 4.5, 0, 4.4), rot: rotB, id: rail });
    b.add(geo.box(9.4, 0.22, 0.22), { color: IRON, pos: at(FB, sx, 5.3, 4.4), rot: rotB, id: rail });
    // The name of the room, on a board over the rail where the back row can read it.
    const banner = b.add(geo.box(6.8, 0.9, 0.12), { color: GOLD, pos: at(FB, sx, 5.52, 4.4), rot: rotB, flat: 0.45 });
    b.label({ text: 'CONSENSUS 2023', size: fit('CONSENSUS 2023', 0.46, 6.0), pos: at(FB, sx, 5.97, 4.46), rot: rotB, ink: P.ink, plate: GOLD, id: banner, flat: 0.45, pad: 0.15, jitter: 0.3 });
    for (let i = 0; i < 4; i++) {
      b.add(geo.cylinder(0.2, 0.3, 0.42, 7), { color: i % 2 ? RED : GOLD, pos: at(FB, sx - 3 + i * 2, 4.78, 4.4), flat: 0.4 });
    }

    // Chairs: eight rows, an aisle up the middle. Each a little out of line, as chairs are.
    const rows = low ? 5 : 8;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 16; c++) {
        if (c === 7 || c === 8) continue;
        if (low && c % 2) continue;
        const p = at(FB, sx + (c - 7.5) * 0.66 + (rng() - 0.5) * 0.08, 0, 7.2 + r * (low ? 1.5 : 0.95) + (rng() - 0.5) * 0.1);
        chairs.push(p[0], LAWN, p[2], FB.yaw + Math.PI + (rng() - 0.5) * 0.22, (r * 3 + c) % 4);
      }
    }
    boxCollider(FB, sx - 2.97, 10.55, 2.3, 3.75);
    boxCollider(FB, sx + 2.97, 10.55, 2.3, 3.75);
    const a0 = at(FB, sx, 0, 15.0), a1 = at(FB, sx, 0, 17.4);
    stones([[a0[0], a0[2]], [a1[0], a1[2]]]);
    const stand = at(FB, sx, 0, 6.3);
    poi('consensus-demo', stand[0], stand[2], 'Step up to the stage', 2.6);
  }

  // ------------------------------------------------------------------------------------------
  // The panel table, to one side of the stage. [consensus-panel] Four chairs, four microphones.
  // ------------------------------------------------------------------------------------------
  {
    const tx = 9.5;
    b.add(geo.box(6.4, 0.25, 2.8), { color: WOOD_DEEP, pos: at(FB, tx, 0, 2.0), rot: rotB });
    b.add(geo.box(6.5, 0.06, 2.9), { color: WOOD, pos: at(FB, tx, 0.25, 2.0), rot: rotB });
    const cloth = b.add(geo.box(4.7, 0.8, 0.85), { color: GOLD, pos: at(FB, tx, 0.31, 2.55), rot: rotB, flat: 0.4 });
    b.add(geo.box(4.8, 0.05, 0.95), { color: CREAM, pos: at(FB, tx, 1.11, 2.55), rot: rotB });
    b.label({ text: 'BLACK FOUNDERS IN CRYPTO', size: fit('BLACK FOUNDERS IN CRYPTO', 0.26, 4.3), pos: at(FB, tx, 0.74, 2.98), rot: rotB, ink: P.ink, plate: GOLD, id: cloth, flat: 0.4, pad: 0.12, jitter: 0.3 });
    for (let i = 0; i < 4; i++) {
      const x = tx + (i - 1.5) * 1.1;
      b.add(geo.cylinder(0.025, 0.025, 0.26, 5), { color: IRON, pos: at(FB, x, 1.16, 2.7) });
      b.add(geo.sphere(0.07, 6, 4), { color: IRON, pos: at(FB, x, 1.46, 2.7) });
      b.add(geo.box(0.34, 0.13, 0.05), { color: CREAM, pos: at(FB, x + 0.3, 1.16, 2.85), rot: turned(FB.yaw, -0.3, 0), flat: 0.5 });
      const p = at(FB, x, 0, 1.55);
      chairs.push(p[0], 0.31, p[2], FB.yaw, i);
    }
    // A sprig of something at each end of the riser.
    for (const s of [-1, 1]) {
      b.add(geo.cylinder(0.26, 0.2, 0.42, 8), { color: P.brick, pos: at(FB, tx + s * 2.8, 0.31, 2.6) });
      clump(at(FB, tx + s * 2.8, 1.1, 2.6), [0.5, 0.6, 0.5], LEAVES[s > 0 ? 0 : 4], undefined, 3);
    }
    boxCollider(FB, tx, 2.0, 3.3, 1.5);
    const s0 = at(FB, 5.9, 0, 9.4), s1 = at(FB, tx - 0.6, 0, 5.4);
    stones([[s0[0], s0[2]], [s1[0], s1[2]]]);
    const stand = at(FB, tx, 0, 5.3);
    poi('consensus-panel', stand[0], stand[2], 'Take a seat at the panel', 2.5);
  }

  // ------------------------------------------------------------------------------------------
  // The billboard: one frame of film, and a price tag on everything in the picture.
  // [tokenized-video] The tags hang down past the frame to just over his head.
  // ------------------------------------------------------------------------------------------
  const FBB = frame(9.5, 19, facing(-13.5, -15));
  /** Where a price tag hangs from: x, y, z. */
  const tagSpots: number[] = [];
  {
    const rot: V3 = [0, FBB.yaw, 0];
    for (const s of [-1, 1]) {
      b.add(geo.box(0.34, 2.1, 0.34), { color: IRON, pos: at(FBB, s * 2.8, 0, 0), rot });
      b.add(geo.tube([at(FBB, s * 2.8, 0.05, -1.7), at(FBB, s * 2.8, 5.2, -0.2)], 0.08, { radial: 5, perSpan: 2 }), { color: IRON });
      const p = at(FBB, s * 2.8, 0, 0);
      colliders.push({ kind: 'circle', x: p[0], z: p[2], r: 0.36 });
      const q = at(FBB, s * 2.8, 0, -1.7);
      colliders.push({ kind: 'circle', x: q[0], z: q[2], r: 0.22 });
    }
    const fascia = b.add(geo.box(7.9, 0.56, 0.36), { color: CREAM, pos: at(FBB, 0, 2.0, 0), rot, flat: 0.4 });
    b.label({ text: 'A FILM YOU CAN BUY FROM', size: fit('A FILM YOU CAN BUY FROM', 0.28, 7.2), pos: at(FBB, 0, 2.28, 0.18), rot, ink: P.ink, plate: CREAM, id: fascia, flat: 0.4, pad: 0.12, jitter: 0.3 });
    const strip = geo.box(7.8, 4.8, 0.3);
    b.add(strip, { color: FILM, pos: at(FBB, 0, 2.56, 0), rot, flat: 0.6 });
    cast(strip, at(FBB, 0, 2.56, 0), rot);
    for (let i = 0; i < 10; i++) {
      for (const y of [2.76, 6.84]) b.add(geo.box(0.36, 0.3, 0.04), { color: CREAM, pos: at(FBB, (i - 4.5) * 0.76, y, 0.15), rot, flat: 0.8, outline: false });
    }
    // The picture: a room at sunset. A chair, a lamp, a painting, a plant.
    const Z = 0.17;
    b.add(geo.box(6.9, 3.36, 0.04), { gradient: { bottom: mix(GOLD, CREAM, 0.3), top: mix(RED, P.pink, 0.6) }, color: P.pink, pos: at(FBB, 0, 3.28, Z), rot, flat: 1 });
    b.add(geo.box(6.9, 0.8, 0.04), { color: mix(GREEN, P.shadow, 0.2), pos: at(FBB, 0, 3.28, Z + 0.02), rot, flat: 1 });
    // `layer` lifts a shape off the one it sits on, so the two never share a plane.
    const pic = (g: THREE.BufferGeometry, x: number, y: number, color: ColorLike, layer = 0): void => {
      b.add(g, { color, pos: at(FBB, x, y, Z + 0.05 + layer * 0.02), rot, flat: 1 });
    };
    pic(geo.box(1.5, 0.62, 0.04), -2.15, 3.72, RED);
    pic(geo.box(1.0, 0.78, 0.04), -2.4, 4.3, mix(RED, P.shadow, 0.25), -1);
    pic(geo.box(0.09, 1.7, 0.04), -0.55, 3.8, IRON);
    pic(geo.extrude([[-0.5, 0], [0.5, 0], [0.26, 0.56], [-0.26, 0.56]], 0.04, { cacheKey: 'maskgarden-shade' }), -0.55, 5.45, GOLD, 1);
    pic(geo.box(1.15, 0.9, 0.04), 1.05, 5.1, CREAM);
    pic(tri(0.34, 0.5, 0.04), 1.05, 5.28, GREEN, 1);
    pic(geo.box(0.56, 0.6, 0.04), 2.5, 3.85, P.brick);
    pic(zdisc(0.6, 0.04, 10), 2.5, 4.95, LEAVES[0], 1);
    tagSpots.push(...at(FBB, -1.55, 4.3, 0.36), ...at(FBB, -0.2, 5.5, 0.36), ...at(FBB, 1.55, 5.1, 0.36), ...at(FBB, 2.95, 4.5, 0.36));
    // Three lamps along the top.
    for (let i = -1; i <= 1; i++) {
      b.add(geo.box(0.07, 0.07, 0.9), { color: IRON, pos: at(FBB, i * 2.6, 7.36, 0.4), rot });
      b.add(geo.box(0.5, 0.16, 0.28), { color: GOLD, pos: at(FBB, i * 2.6, 7.26, 0.86), rot, flat: 0.5 });
    }
    clump(at(FBB, 2.8, 0.5, 0.3), [0.7, 0.5, 0.5], LEAVES[3], rot, 3);
    clump(at(FBB, -2.9, 1.0, -0.2), [0.4, 1.0, 0.4], LEAVES[2], rot, 4);
    stones([[2.9, 17.1], [6.2, 16.6]]);
    const stand = at(FBB, 0.2, 0, 2.9);
    poi('tokenized-video', stand[0], stand[2], 'Check the price tags', 2.2);
  }

  // ------------------------------------------------------------------------------------------
  // Three door frames on the west lawn, no doors in them. [ar-lenses] The same lot through each one,
  // in a different light. A small mask hangs at face height in the middle one.
  // ------------------------------------------------------------------------------------------
  {
    const tints: ColorLike[] = [P.cyan, P.pink, GOLD];
    const fronts: P2[] = [];
    [163, 181, 199].forEach((a, i) => {
      const [x, z] = pol(a, 17.2);
      const f = frame(x, z, facing(-7 - x, -0.5 - z));
      const rot: V3 = [0, f.yaw, 0];
      const tint = tints[i];
      b.add(geo.box(1.9, 0.1, 0.7), { color: P.marbleShade, pos: at(f, 0, LAWN - 0.02, 0), rot });
      const jamb = b.newId();
      for (const s of [-1, 1]) b.add(geo.box(0.22, 2.56, 0.32), { color: CREAM, pos: at(f, s * 0.78, 0, 0), rot, id: jamb });
      const lintel = geo.box(2.0, 0.28, 0.38);
      b.add(lintel, { color: CREAM, pos: at(f, 0, 2.56, 0), rot, id: jamb });
      cast(lintel, at(f, 0, 2.56, 0), rot);
      b.add(geo.box(2.2, 0.1, 0.48), { color: tint, pos: at(f, 0, 2.84, 0), rot, flat: 0.4 });
      b.add(geo.plane(1.34, 2.46), { color: tint, pos: at(f, 0, 1.33, 0), rot, dither: 0.5, flat: 1 });
      if (i === 1) {
        // The filter: a mask the size of a face, on a thread.
        b.add(geo.box(0.02, 0.62, 0.02), { color: IRON, pos: at(f, 0, 1.94, 0), rot, outline: false });
        b.add(zdisc(0.24, 0.06, 10), { color: RED, pos: at(f, 0, 1.72, 0), rot, flat: 0.5 });
        b.add(geo.box(0.56, 0.07, 0.1), { color: GOLD, pos: at(f, 0, 1.76, 0), rot, flat: 0.5 });
        b.add(geo.box(0.07, 0.26, 0.1), { color: GREEN, pos: at(f, 0, 1.5, 0), rot, flat: 0.5 });
      }
      clump(at(f, 1.05, 0.3, -0.1), [0.45, 0.3, 0.4], P.moss as string, rot, 3);
      for (const s of [-1, 1]) {
        const p = at(f, s * 0.78, 0, 0);
        colliders.push({ kind: 'circle', x: p[0], z: p[2], r: 0.2 });
      }
      const fr = at(f, 0, 0, 1.6);
      fronts.push([fr[0], fr[2]]);
    });
    stones([[inX * 14 - inZ * 2.9, inZ * 14 + inX * 2.9], fronts[0], fronts[1], fronts[2], [-12.4, -8.0]]);
    // A marble block with the word on it.
    const [mx, mz] = pol(190, 13.4);
    const mf = frame(mx, mz, facing(1, 0.15));
    const block2 = b.add(geo.bevelBox(1.7, 0.6, 0.5, 0.05), { color: P.marble, pos: at(mf, 0, 0, 0), rot: [0, mf.yaw, 0] });
    b.label({ text: 'DOORWAYS', size: fit('DOORWAYS', 0.2, 1.4), pos: at(mf, 0, 0.34, 0.25), rot: [0, mf.yaw, 0], ink: P.ink, plate: P.marble, id: block2, pad: 0.12, jitter: 0.3 });
    clump(at(mf, -0.9, 0.3, 0), [0.4, 0.3, 0.4], P.moss as string, undefined, 3);
    boxCollider(mf, 0, 0, 0.9, 0.3);
    poi('ar-lenses', fronts[1][0] + 0.5, fronts[1][1], 'Look through a doorway', 3.3);

    // One more bed out here, pointing at the middle.
    const bf = frame(...pol(172, 12.4), -172 * D2R);
    bed(bf, 0, 0, 4.2, 6, 1);
  }

  // ------------------------------------------------------------------------------------------
  // The fork, at the far end. [pivot] A signpost where the lot meets the alley. DAO points up
  // a path that dries out and stops at a bricked-up door. LAB points on down the road, past a
  // lean-to shed with its light on.
  // ------------------------------------------------------------------------------------------
  const SHED_X = -13;
  {
    const sx = eastX * 13 + eastZ * 2.6, sz = eastZ * 13 - eastX * 2.6; // left of the road, walking out
    b.add(geo.cylinder(0.42, 0.5, 0.3, 10), { color: P.marbleShade, pos: [sx, 0, sz] });
    const pole = geo.cylinder(0.07, 0.1, 3.3, 6);
    b.add(pole, { color: IRON_GREEN, pos: [sx, 0.3, sz] });
    cast(pole, [sx, 0.3, sz], undefined, [2.5, 1, 2.5]);
    b.add(geo.sphere(0.16, 8, 5), { color: P.brass, pos: [sx, 3.7, sz], flat: 0.4 });
    colliders.push({ kind: 'circle', x: sx, z: sz, r: 0.42 });
    const blade = geo.extrude([[0.12, -0.24], [1.95, -0.24], [2.3, 0], [1.95, 0.24], [0.12, 0.24]], 0.08, { cacheKey: 'maskgarden-blade' });
    const sign = (text: string, dx: number, dz: number, y: number, droop: number, plate: string, ink: ColorLike): void => {
      const l = Math.hypot(dx, dz);
      const turn = Math.atan2(-dz / l, dx / l);
      const id = b.add(blade, { color: plate, pos: [sx, y, sz], rot: [0, turn, droop], flat: 0.5 });
      for (const side of [1, -1]) {
        // A point on the blade's face, tipped with the blade and then turned with it.
        const X = 1.05 * Math.cos(droop), Y = 1.05 * Math.sin(droop), Zf = side * 0.045;
        b.label({
          text, size: 0.25, pos: [sx + X * Math.cos(turn) + Zf * Math.sin(turn), y + Y, sz - X * Math.sin(turn) + Zf * Math.cos(turn)],
          rot: side > 0 ? [0, turn, droop] : [0, turn + Math.PI, -droop], ink, plate, id, flat: 0.5, pad: 0.15, jitter: 0.3,
        });
      }
    };
    sign('LAB', 0.978, -0.21, 3.05, 0, GREEN as string, CREAM);
    sign('DAO', 0.49, -0.87, 2.4, -0.3, mix(RED, P.paveShade, 0.6), mix(P.ink, P.paveShade, 0.35));
    poi('pivot', sx + eastX * -0.6 - eastZ * 1.5, sz + eastZ * -0.6 + eastX * 1.5, 'Read the signpost', 4.1);

    // The path that withers. The stones get smaller and further apart, the grass gives out.
    const dead: P2[] = [[8.2, -7.4], [9.0, -10.6], [11.2, -13.8], [13.6, -16.4], [15.9, -18.6]];
    const dry: P2[] = [];
    for (let i = 0; i < dead.length; i++) dry.push([dead[i][0] - 1.0 - i * 0.45, dead[i][1] + 0.3 - i * 0.2]);
    dry.push([14.2, -20.6], [18.6, -19.2]);
    for (let i = dead.length - 1; i >= 0; i--) dry.push([dead[i][0] + 1.0 + i * 0.4, dead[i][1] + 0.2 + i * 0.25]);
    slab(dry, LAWN - 0.02, 0.04, { color: mix(P.grass, DRY[0], 0.72), flat: 0.5, outline: false });
    for (let i = 0; i < dead.length - 1; i++) {
      const a = dead[i], c = dead[i + 1];
      const n = 3 - Math.min(2, i);
      for (let j = 0; j < n; j++) {
        const k = (j + 0.3) / n;
        const r = 0.5 - i * 0.07 - j * 0.02;
        b.add(geo.cylinder(r, r, 0.06, 5), { color: mix(P.paveShade, DRY[1], 0.3 + i * 0.12), pos: [a[0] + (c[0] - a[0]) * k + (rng() - 0.5) * 0.5, LAWN + 0.005, a[1] + (c[1] - a[1]) * k + (rng() - 0.5) * 0.4], rot: [0, rng() * 6.28, (rng() - 0.5) * 0.08], scale: [1, 1, 0.7 + rng() * 0.3] });
      }
    }
    const weeds: [number, number, number][] = [[9.9, -11.8, 0], [12.5, -14.1, 1], [12.2, -16.4, 2], [15.0, -16.6, 0], [14.3, -18.9, 1], [17.2, -18.0, 2], [10.4, -9.6, 2]];
    weeds.forEach(([x, z, t], i) => {
      if (low && i % 2) return;
      clump([x, 0.3, z], [0.5, 0.36, 0.45], DRY[t], undefined, 3);
    });
    // Seedlings that did not make it.
    const wilt: [number, number, number][] = [[10.2, -12.6, 1.0], [12.9, -15.3, 1.25], [13.3, -17.5, 1.4], [15.6, -17.4, 1.1], [16.6, -18.9, 1.3]];
    wilt.forEach(([x, z, lean], i) => sprout(x, z, i * 1.9, 0.9 + (i % 2) * 0.2, i, lean, LAWN));
    // A bare tree by the end of it.
    {
      const tx = 13.0, tz = -19.0;
      const bark = mix(TRUNK, P.paveShade, 0.35);
      b.add(geo.cylinder(0.16, 0.3, 3.4, 6), { color: bark, pos: [tx, 0, tz] });
      const boughs: V3[][] = [
        [[tx, 2.6, tz], [tx + 0.9, 3.9, tz + 0.5], [tx + 1.9, 4.5, tz + 1.0]],
        [[tx, 3.2, tz], [tx - 0.8, 4.4, tz + 0.5], [tx - 1.5, 5.4, tz + 1.1]],
        [[tx, 3.3, tz], [tx + 0.3, 4.6, tz - 0.1], [tx + 0.9, 5.9, tz + 0.3]],
        [[tx - 0.8, 4.4, tz + 0.5], [tx - 1.7, 4.5, tz + 0.2]],
      ];
      for (const bough of boughs) b.add(geo.tube(bough, 0.07, { radial: 4, perSpan: 2 }), { color: bark });
      colliders.push({ kind: 'circle', x: tx, z: tz, r: 0.34 });
    }
    // The door it used to lead to, bricked up.
    b.add(geo.arch({ span: 1.4, rise: 2.6, thick: 0.24, depth: 0.3, seg: 8 }), { color: P.marbleShade, pos: at(FA, 10.2, 0, -0.3), rot: rotA });
    b.add(geo.plane(1.4, 2.6), { color: mix(BRICK2[1], P.shadow, 0.2), pos: at(FA, 10.2, 1.3, -0.33), rot: rotA, flat: 0.4, hatch: 0.3 });
    clump(at(FA, 11.3, 1.5, -0.25), [0.5, 1.5, 0.3], DRY[1], rotA, 4);

    // The lab: a lean-to against the east wall by the alley, painted green, its window lit.
    const lx = SHED_X;
    // The walls are one wedge, cut to the slope of the roof: its side outline pushed along the wall.
    const wedge = geo.extrude([[0, 0], [2.8, 0], [2.8, 2.66], [0, 3.34]], 3.2, { cacheKey: 'maskgarden-shed' });
    b.add(wedge, { gradient: { bottom: mix(GREEN, P.shadow, 0.25), top: mix(GREEN, CREAM, 0.15) }, color: GREEN, pos: at(FB, lx, 0, 0), rot: [0, FB.yaw - Math.PI / 2, 0] });
    b.add(geo.box(3.8, 0.14, 3.5), { color: P.verdigris, pos: at(FB, lx, 3.02, 1.5), rot: turned(FB.yaw, 0.24, 0) });
    b.add(geo.box(1.06, 2.1, 0.08), { color: CREAM, pos: at(FB, lx - 0.75, 0, 2.8), rot: rotB });
    b.add(geo.plane(0.86, 1.9), { color: WOOD, pos: at(FB, lx - 0.75, 1.0, 2.85), rot: rotB, flat: 0.4 });
    b.add(geo.sphere(0.06, 6, 4), { color: P.brass, pos: at(FB, lx - 0.45, 1.0, 2.9), flat: 0.5, outline: false });
    b.add(geo.box(1.2, 1.0, 0.08), { color: CREAM, pos: at(FB, lx + 0.75, 1.05, 2.8), rot: rotB });
    b.add(geo.plane(1.0, 0.8), { color: LIT, pos: at(FB, lx + 0.75, 1.55, 2.85), rot: rotB, flat: 0.9 });
    b.add(geo.box(0.05, 0.8, 0.03), { color: CREAM, pos: at(FB, lx + 0.75, 1.15, 2.86), rot: rotB, outline: false });
    const board = b.add(geo.box(1.7, 0.62, 0.08), { color: CREAM, pos: at(FB, lx, 2.76, 2.98), rot: rotB, flat: 0.45 });
    b.label({ text: 'LAB', size: 0.34, pos: at(FB, lx, 3.07, 3.02), rot: rotB, ink: P.ink, plate: CREAM, id: board, flat: 0.45, pad: 0.12, jitter: 0.3 });
    b.add(geo.sphere(0.13, 8, 5), { color: LIT, pos: at(FB, lx - 1.45, 2.3, 2.95), flat: 0.9 });
    // A potting table by the door with a tray of sprouts, and one healthy seedling in a pot.
    b.add(geo.box(1.5, 0.07, 0.6), { color: WOOD, pos: at(FB, lx + 0.9, 0.78, 3.5), rot: rotB });
    for (const s of [-1, 1]) b.add(geo.box(0.07, 0.78, 0.5), { color: WOOD_DEEP, pos: at(FB, lx + 0.9 + s * 0.66, 0, 3.5), rot: rotB });
    b.add(geo.box(1.1, 0.1, 0.4), { color: SOIL, pos: at(FB, lx + 0.9, 0.85, 3.5), rot: rotB });
    for (let i = 0; i < 5; i++) b.add(geo.cone(0.07, 0.24, 4), { color: LEAVES[i % 4], pos: at(FB, lx + 0.5 + i * 0.2, 0.95, 3.5 + (i % 2 ? 0.08 : -0.08)), flat: 0.3 });
    b.add(geo.cylinder(0.24, 0.18, 0.36, 8), { color: P.brick, pos: at(FB, lx - 1.9, 0, 3.3) });
    {
      const p = at(FB, lx - 1.9, 0, 3.3);
      sprout(p[0], p[2], FB.yaw + 0.3, 1.25, 2, 0, 0.26);
    }
    boxCollider(FB, lx, 1.5, 1.75, 1.6);
    const d0 = at(FB, lx - 0.75, 0, 4.2);
    stones([[20.9, -10.0], [d0[0], d0[2]]], 0.42);
    clump(at(FB, lx + 1.9, 0.5, 2.6), [0.6, 0.5, 0.5], LEAVES[0], rotB, 3);
  }

  // ------------------------------------------------------------------------------------------
  // Trees. One in the bench ring already; these fill the corners.
  // ------------------------------------------------------------------------------------------
  tree(-12.8, -18.3, 7.0, LEAVES[3]);
  {
    const p = at(FB, -8.3, 0, 2.1);
    tree(p[0], p[2], 6.4, LEAVES[0]);
  }
  tree(15.5, 21.5, 6.8, LEAVES[4]);
  tree(-20.6, -6.6, 6.2, LEAVES[2]);
  // A bed of flowers along the foot of the east wall, either side of the stage.
  {
    const strip = (x0: number, x1: number): void => {
      b.add(geo.box(x1 - x0, 0.2, 1.0), { color: P.marbleShade, pos: at(FB, (x0 + x1) / 2, 0, 0.6), rot: rotB });
      b.add(geo.box(x1 - x0 - 0.2, 0.24, 0.8), { color: SOIL, pos: at(FB, (x0 + x1) / 2, 0, 0.6), rot: rotB, flat: 0.3 });
      const n = Math.round((x1 - x0) / 1.1);
      for (let i = 0; i < n; i++) {
        if (low && i % 2) continue;
        const p = at(FB, x0 + 0.5 + ((x1 - x0 - 1) * i) / Math.max(1, n - 1), 0.5, 0.6);
        clump(p, [0.5, 0.42, 0.4], LEAVES[i % LEAVES.length], rotB, 3);
        flower(p[0] - FB.sn * -0.3, 0.86, p[2] - FB.cs * -0.3, [RED, GOLD, P.pink, CREAM][i % 4]);
      }
      boxCollider(FB, (x0 + x1) / 2, 0.6, (x1 - x0) / 2, 0.5);
    };
    strip(-11.0, -5.6);
  }

  // ------------------------------------------------------------------------------------------
  // String lights. Six poles round the middle with a ring of lights between them, and a line
  // out from each to whatever is tall enough to take it. Two more cross the alley.
  // ------------------------------------------------------------------------------------------
  const bulbSpots: number[] = [];
  {
    const GAP = low ? 2.6 : high ? 1.3 : 1.8;
    const pt = new THREE.Vector3();
    const string = (a: V3, c: V3, sag: number): void => {
      b.add(geo.tube([a, c], 0.03, { radial: 4, sag, perSpan: low ? 3 : 5 }), { color: IRON });
      const curve = new THREE.CatmullRomCurve3(
        [new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3((a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - sag, (a[2] + c[2]) / 2), new THREE.Vector3(c[0], c[1], c[2])],
        false, 'centripetal',
      );
      const n = Math.max(2, Math.round(curve.getLength() / GAP));
      for (let i = 0; i < n; i++) {
        curve.getPointAt((i + 0.5) / n, pt);
        bulbSpots.push(pt.x, pt.y - 0.13, pt.z);
      }
    };
    const TOP = 5.5;
    // Bearings as on a compass, clear of the three ways in and of the aisles.
    const ring: V3[] = [30, 85, 150, 205, 262, 350].map((bearing): V3 => {
      const x = Math.sin(bearing * D2R) * 8.5, z = -Math.cos(bearing * D2R) * 8.5;
      b.add(geo.cylinder(0.2, 0.26, 0.24, 8), { color: P.marbleShade, pos: [x, LAWN - 0.02, z] });
      const pole = geo.cylinder(0.06, 0.09, TOP, 6);
      b.add(pole, { color: IRON_GREEN, pos: [x, 0.1, z] });
      cast(pole, [x, 0.1, z], undefined, [2.2, 1, 2.2]);
      b.add(geo.sphere(0.13, 8, 5), { color: P.brass, pos: [x, TOP + 0.2, z], flat: 0.4 });
      colliders.push({ kind: 'circle', x, z, r: 0.24 });
      return [x, TOP, z];
    });
    for (let i = 0; i < ring.length; i++) string(ring[i], ring[(i + 1) % ring.length], 0.75);
    string(ring[0], at(FA, 6.2, 8.2, -0.3), 1.3);
    string(ring[1], at(FB, STAGE_X, 6.4, 4.4), 0.9);
    string(ring[2], at(FBB, 3.9, 7.36, 0), 0.8);
    string(ring[3], [GATE_R[0], 4.5, GATE_R[1]], 1.2);
    if (!low) {
      string(at(FA, 15.1, 8.6, -1.2), at(FB, -15.1, 9.6, -1.0), 1.1);
      string(at(FA, 15.1, 9.2, -4.6), at(FB, -15.1, 8.2, -4.0), 1.2);
    }
  }

  // The shadow of the one overhead. It falls across paving and lawn alike, so it is drawn as a
  // screen of violet that lets either show through.
  const HS = 0.78;
  const HERO_Y = 4.9;
  const heroYaw = facing(site.arrive.x - HERO[0], site.arrive.z - HERO[1]);
  const heroFace = geo.extrude([[-2.5, 0], [2.5, 0], [4.1, 4.4], [4.1, 10.0], [2.3, 12.6], [-2.3, 12.6], [-4.1, 10.0], [-4.1, 4.4]], 1.4, { cacheKey: 'maskgarden-hero-face' });
  {
    const flat = heroFace.index ? heroFace.toNonIndexed() : heroFace.clone();
    flat.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(HERO[0], HERO_Y, HERO[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heroYaw), new THREE.Vector3(HS, HS, HS)));
    const p = flat.getAttribute('position');
    const n = flat.getAttribute('normal');
    const sy = Math.max(0.12, sun[1]);
    const ground = LAWN + 0.042;
    for (let i = 0; i < p.count; i++) {
      const h = Math.max(0, p.getY(i) - ground);
      p.setXYZ(i, p.getX(i) - (sun[0] / sy) * h, ground, p.getZ(i) - (sun[2] / sy) * h);
      n.setXYZ(i, 0, 1, 0);
    }
    b.add(flat, { color: mix(P.shadow, CREAM, 0.22), flat: 1, outline: false, dither: 0.5 });
    flat.dispose();
  }

  group.add(b.build('maskgarden'));

  // ------------------------------------------------------------------------------------------
  // The one that left. Its own mesh so it can hang there and move. Built with its chin at the
  // origin, face to +z, and the features pushed right through so the back has a face too.
  // ------------------------------------------------------------------------------------------
  const hero = (() => {
    const hb = kit.builder();
    hb.add(heroFace, { gradient: { bottom: mix(GREEN, P.shadow, 0.28), top: mix(GREEN, '#ffffff', 0.14) }, color: GREEN });
    // Ears, brow, eyes.
    for (const s of [-1, 1]) {
      hb.add(zdisc(1.35, 1.0, 14), { color: GOLD, pos: [s * 4.15, 6.2, 0] });
      hb.add(zdisc(1.1, 2.0, 16), { color: CREAM, pos: [s * 1.95, 6.5, 0], flat: 0.2 });
      hb.add(geo.box(1.7, 0.3, 2.3), { color: IRON, pos: [s * 1.95, 6.35, 0], flat: 0.5 });
    }
    hb.add(geo.box(9.8, 0.95, 2.0), { color: GOLD, pos: [0, 7.9, 0] });
    // Nose: one long red wedge from the brow down.
    hb.add(tri(1.0, 4.6, 2.4), { color: RED, pos: [0, 3.2, 0] });
    // Mouth: one pale bar.
    hb.add(geo.box(3.4, 0.7, 1.9), { color: CREAM, pos: [0, 1.5, 0], flat: 0.2 });
    // A row of gold teeth across the forehead.
    for (let i = 0; i < 4; i++) hb.add(tri(0.55, 1.0, 1.7), { color: GOLD, pos: [(i - 1.5) * 1.25, 9.5, 0] });
    // The crest: five bars fanned out along the top.
    for (let i = -2; i <= 2; i++) {
      const tall = i === 0 ? 3.4 : 2.6 - Math.abs(i) * 0.2;
      hb.add(geo.box(0.75, tall, 0.9), { color: i % 2 === 0 ? RED : GOLD, pos: [i * 1.05, 12.3, 0], rot: [0, 0, -i * 0.24] });
    }
    // Roots, still hanging off the chin.
    const roots: [number, number, number, number][] = [[-1.8, 0.3, 2.6, 0.5], [-0.8, -0.3, 3.4, -0.4], [0.3, 0.2, 2.9, 0.3], [1.2, -0.2, 3.6, -0.5], [2.0, 0.3, 2.3, 0.6]];
    for (const [x, z, len, drift] of roots) {
      hb.add(geo.tube([[x, 0.2, z], [x + drift * 0.4, -len * 0.45, z + drift * 0.3], [x + drift, -len, z - drift * 0.2]], 0.11, { radial: 5, perSpan: 3 }), { color: TRUNK });
      hb.add(geo.ico(0.3, 0), { color: SOIL, pos: [x + drift, -len, z - drift * 0.2], scale: [1, 0.8, 1] });
    }
    const mesh = hb.build('maskgarden-hero');
    mesh.scale.setScalar(HS);
    mesh.position.set(HERO[0], HERO_Y, HERO[1]);
    mesh.rotation.y = heroYaw;
    return mesh;
  })();
  group.add(hero);

  // ------------------------------------------------------------------------------------------
  // Seedlings: a small mask on a stalk. The heads are one shape, many times, tinted.
  // ------------------------------------------------------------------------------------------
  const TINTS = [RED, GOLD, GREEN, CREAM, '#a89a86', '#b7a48a'].map((c) => new THREE.Color(c));
  {
    const sb = kit.builder();
    const faceId = sb.add(zdisc(0.25, 0.08, 9), { color: '#ffffff', pos: [0, 1.06, 0] });
    sb.add(geo.box(0.46, 0.07, 0.13), { color: IRON, pos: [0, 1.1, 0], id: faceId, flat: 0.5 });
    sb.add(geo.box(0.07, 0.2, 0.13), { color: IRON, pos: [0, 0.9, 0], id: faceId, flat: 0.5 });
    const n = sprouts.length / 8;
    const mesh = kit.instances(sb.geometry ? sb.geometry() : geo.box(0.5, 0.5, 0.1), n);
    mesh.name = 'maskgarden-seedlings';
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      e.set(sprouts[o + 3], sprouts[o + 4], sprouts[o + 5], 'XYZ');
      q.setFromEuler(e);
      v.set(sprouts[o], sprouts[o + 1], sprouts[o + 2]);
      sc.setScalar(sprouts[o + 6]);
      m4.compose(v, q, sc);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, TINTS[sprouts[o + 7]]);
    }
    e.set(0, 0, 0, 'YXZ');
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // ------------------------------------------------------------------------------------------
  // Post masks: a diamond on a pole, taller than he is. They turn to face him when he is near.
  // ------------------------------------------------------------------------------------------
  const POSTS = posts.length / 2;
  const postYaw = new Float32Array(POSTS);
  const postHome = new Float32Array(POSTS);
  const postMesh = (() => {
    // Just the head, with its origin where it sits on the pole, so it can turn and nod there.
    const pb = kit.builder();
    pb.add(new THREE.BoxGeometry(1.1, 1.1, 0.22).rotateZ(Math.PI / 4), { color: '#ffffff', pos: [0, 0.76, 0] });
    // The tint multiplies everything, so the features are baked dull and come out as a deep tone of it.
    const DEEP = '#8478b4';
    pb.add(geo.box(1.7, 0.17, 0.32), { color: DEEP, pos: [0, 0.93, 0] });
    pb.add(geo.box(0.17, 0.72, 0.34), { color: DEEP, pos: [0, 0.2, 0] });
    for (const s of [-1, 1]) pb.add(zdisc(0.13, 0.32, 8), { color: IRON, pos: [s * 0.32, 0.72, 0], flat: 0.5 });
    pb.add(tri(0.3, 0.6, 0.26), { color: DEEP, pos: [0, 1.46, 0] });
    const mesh = kit.instances(pb.geometry ? pb.geometry() : geo.box(1, 3, 0.2), POSTS);
    mesh.name = 'maskgarden-posts';
    for (let i = 0; i < POSTS; i++) {
      // Until he comes near they look at the middle of the lot. The one by the gate looks at the gate.
      const x = posts[i * 2], z = posts[i * 2 + 1];
      const near = Math.hypot(site.arrive.x - x, site.arrive.z - z) < 16;
      postHome[i] = near ? facing(site.arrive.x - x, site.arrive.z - z) : facing(-x, -z);
      postYaw[i] = postHome[i];
      mesh.setColorAt(i, TINTS[i % 3]);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  })();
  const placePosts = (t: number): void => {
    for (let i = 0; i < POSTS; i++) {
      e.set(Math.sin(t * 0.7 + i * 1.3) * 0.035, postYaw[i], Math.sin(t * 0.5 + i * 2.1) * 0.03);
      q.setFromEuler(e);
      v.set(posts[i * 2], LAWN + POST_TOP - 0.04, posts[i * 2 + 1]);
      sc.set(1, 1, 1);
      m4.compose(v, q, sc);
      postMesh.setMatrixAt(i, m4);
    }
    postMesh.instanceMatrix.needsUpdate = true;
  };
  placePosts(0);
  postMesh.computeBoundingSphere();
  group.add(postMesh);

  // ------------------------------------------------------------------------------------------
  // Chairs. Far more than the lot should hold.
  // ------------------------------------------------------------------------------------------
  {
    const cb = kit.builder();
    const id = cb.newId();
    cb.add(geo.box(0.48, 0.1, 0.46), { color: '#ffffff', pos: [0, 0.4, 0.02], id });
    cb.add(geo.box(0.48, 0.5, 0.06), { color: '#ffffff', pos: [0, 0.5, -0.2], id });
    cb.add(geo.box(0.34, 0.4, 0.32), { color: '#5a548c', pos: [0, 0, 0], id });
    const n = chairs.length / 5;
    const mesh = kit.instances(cb.geometry ? cb.geometry() : geo.box(0.5, 0.9, 0.5), n);
    mesh.name = 'maskgarden-chairs';
    const tints = [RED, GOLD, CREAM, mix(GREEN, CREAM, 0.25)].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      e.set(0, chairs[o + 3], 0);
      q.setFromEuler(e);
      v.set(chairs[o], chairs[o + 1], chairs[o + 2]);
      sc.set(1, 1, 1);
      m4.compose(v, q, sc);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, tints[chairs[o + 4] % tints.length]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // ------------------------------------------------------------------------------------------
  // Bulbs on the strings. They brighten and dim, each in its own time.
  // ------------------------------------------------------------------------------------------
  const BULBS = bulbSpots.length / 3;
  const bulbBase = new Float32Array(BULBS * 3);
  const bulbPhase = new Float32Array(BULBS);
  const bulbs = kit.instances(geo.ico(0.13, 0), BULBS, { color: '#ffffff', flat: 0.9 });
  bulbs.name = 'maskgarden-bulbs';
  const bulbColor = new THREE.Color();
  {
    const tones = [LIT, GOLD, '#f08a6c', LIT, mix(GREEN, LIT, 0.45)].map((c) => new THREE.Color(c));
    for (let i = 0; i < BULBS; i++) {
      v.set(bulbSpots[i * 3], bulbSpots[i * 3 + 1], bulbSpots[i * 3 + 2]);
      q.identity();
      sc.set(1, 1.25, 1);
      m4.compose(v, q, sc);
      bulbs.setMatrixAt(i, m4);
      const c = tones[i % tones.length];
      bulbBase[i * 3] = c.r;
      bulbBase[i * 3 + 1] = c.g;
      bulbBase[i * 3 + 2] = c.b;
      bulbPhase[i] = rng() * 6.28;
    }
    bulbs.instanceMatrix.needsUpdate = true;
    bulbs.computeBoundingSphere();
    group.add(bulbs);
  }
  const lightBulbs = (t: number): void => {
    for (let i = 0; i < BULBS; i++) {
      const k = 0.8 + 0.2 * Math.sin(t * (0.9 + (i % 5) * 0.17) + bulbPhase[i]);
      bulbColor.setRGB(bulbBase[i * 3] * k, bulbBase[i * 3 + 1] * k, bulbBase[i * 3 + 2] * k);
      bulbs.setColorAt(i, bulbColor);
    }
    if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  };
  lightBulbs(0);

  // ------------------------------------------------------------------------------------------
  // Price tags. Each hangs on a thread from the thing it prices and swings a little.
  // ------------------------------------------------------------------------------------------
  const TAGS = tagSpots.length / 3;
  const tags = (() => {
    const tb = kit.builder();
    tb.add(geo.box(0.03, 1.3, 0.03), { color: IRON, pos: [0, -1.3, 0], outline: false });
    const card = tb.add(geo.extrude([[-0.3, -0.72], [0.3, -0.72], [0.3, -0.14], [0, 0.12], [-0.3, -0.14]], 0.05, { cacheKey: 'maskgarden-tag' }), { color: CREAM, pos: [0, -1.36, 0], flat: 0.5 });
    tb.add(zdisc(0.05, 0.07, 6), { color: GOLD, pos: [0, -1.4, 0], flat: 0.8, outline: false });
    tb.label({ text: 'BUY', size: 0.15, pos: [0, -1.78, 0.025], ink: RED, plate: CREAM, id: card, flat: 0.5, pad: 0.1, jitter: 0.3 });
    const mesh = kit.instances(tb.geometry ? tb.geometry() : geo.box(0.5, 0.7, 0.05), TAGS);
    mesh.name = 'maskgarden-tags';
    return mesh;
  })();
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FBB.yaw);
  const swingTags = (t: number): void => {
    for (let i = 0; i < TAGS; i++) {
      q2.setFromAxisAngle(AXIS_Z, Math.sin(t * 1.1 + i * 1.7) * 0.16 + Math.sin(i * 2.3) * 0.07);
      q.copy(qYaw).multiply(q2);
      v.set(tagSpots[i * 3], tagSpots[i * 3 + 1], tagSpots[i * 3 + 2]);
      sc.set(1, 1, 1);
      m4.compose(v, q, sc);
      tags.setMatrixAt(i, m4);
    }
    tags.instanceMatrix.needsUpdate = true;
  };
  swingTags(0);
  tags.computeBoundingSphere();
  group.add(tags);

  return {
    group,
    colliders,
    pois,
    update(dt, t, player) {
      // The big one hangs and turns a little, like something on a long thread.
      hero.position.y = HERO_Y + Math.sin(t * 0.5) * 0.35;
      hero.rotation.y = heroYaw + Math.sin(t * 0.23) * 0.1;
      hero.rotation.z = Math.sin(t * 0.31) * 0.025;
      // Post masks come round to face him, in no hurry, and go back when he has gone.
      const k = Math.min(1, dt * 2.2);
      for (let i = 0; i < POSTS; i++) {
        const dx = player.x - posts[i * 2], dz = player.z - posts[i * 2 + 1];
        const want = dx * dx + dz * dz < 17 * 17 ? Math.atan2(dx, dz) : postHome[i];
        const diff = want - postYaw[i];
        postYaw[i] += Math.atan2(Math.sin(diff), Math.cos(diff)) * k;
      }
      placePosts(t);
      lightBulbs(t);
      swingTags(t);
    },
  };
}
