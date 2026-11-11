// The Studio. A corner block of brick artist lofts with a paved yard in the crook of the L.
// The north wing has its roll-up door open: inside, on a shelf at the back of the bay, the jars from
// the 2023 notebook, two of them sprouting. The east wing carries a comic mural on its yard wall with
// a microphone standing in front of it. A saw-tooth roof, a water tower, a garden on the roof.
// In the yard, far too big for any painter, an easel holds a sheet with a watercolour bloom on it:
// pink, blue and yellow, one colour per painter, and their three brushes stand in a jar at its foot.
// Pieces of the bloom have come off the paper and float up into the pink sky.
// Round the edges: a tree in a brick planter, a cloud of small discs with photographs circling it,
// a card three metres tall with a portal cut through it, a spyglass on a tripod aimed back down the
// road at the Commons, and a broken marble colonnade with ivy on it.
// Behind that colonnade, for whoever wanders that far, a small bone shrine to Hush: a black stone
// figure with its eyes closed and one finger up, a star beside it, and something under a cloth.
//
// One road comes in, from the west south west (the side street from the Commons). The arrival point
// and the line from it to the middle of the yard are kept clear.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, Poi } from '../types';

type V3 = [number, number, number];
type P2 = [number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const WOOD = '#b0714a';
const WOOD_DEEP = '#7d4a3a';
const PAPER = '#fbf4e4';
const IRON = '#3d3766';
const WINDOW = '#56528f';
const LIT = '#f6d98a';
const TRUNK = '#7a5a86';
const INSIDE = '#e7c7c4';
const LEAVES = ['#7fb85a', '#63aa5e', '#3f8a57', '#8cc56c', '#4f9c62'];

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

const UP = new THREE.Vector3(0, 1, 0);

/** XYZ angles for a part turned by `rot` and then turned about the vertical by `yaw`. */
function yawed(rot: V3, yaw: number): V3 {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ')));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

/** A local frame at (ox, oz) turned by yaw. Local +z is the way the thing faces. */
function frame(ox: number, oz: number, yaw: number): (x: number, y: number, z: number) => V3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (x, y, z) => [ox + x * c + z * s, y, oz - x * s + z * c];
}

/** The yaw that makes local +z look from (x, z) toward (tx, tz). */
const face = (x: number, z: number, tx: number, tz: number): number => Math.atan2(tx - x, tz - z);

/** A watercolour bloom outline: a wobbly round with the cauliflower edge a backrun leaves. CCW. */
function bloomOutline(seed: number, r: number, n: number): P2[] {
  const rnd = geo.seeded(seed);
  const a1 = rnd() * 6.28;
  const a2 = rnd() * 6.28;
  const lobes = 7 + Math.floor(rnd() * 4);
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const scallop = Math.pow(Math.abs(Math.sin(t * lobes * 0.5 + a2)), 0.6);
    const k = 1 + 0.13 * Math.sin(2 * t + a1) + 0.08 * Math.sin(3 * t + a2) + 0.09 * scallop - 0.05;
    out.push([Math.cos(t) * r * k, Math.sin(t) * r * k]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Hush. My own brand colours and the mark, measured off my brand sheet.
// ---------------------------------------------------------------------------------------------
const HUSH_INK = '#0b0b0c';
const HUSH_NIGHT = '#151517';
const HUSH_GRAPHITE = '#232326';
const HUSH_BONE = '#f7f3ea';
const HUSH_STONE = '#d9d3c7';
const HUSH_ASH = '#8e8a84';
const HUSH_IRIS = '#b9aaf2';

/** The blob as circles: x, y, radius. One unit is half its width. The origin sits just above the fingertip. */
const HUSH_LOBES: readonly (readonly [number, number, number])[] = [
  [0.0, -0.08, 0.38],
  [0.16, 0.56, 0.35],
  [-0.67, 0.19, 0.34],
  [0.75, 0.05, 0.26],
  [-0.66, -0.57, 0.32],
  [0.68, -0.52, 0.31],
  [-0.26, -0.5, 0.27],
  [0.22, -0.5, 0.27],
  [-0.27, 0.2, 0.2],
  [0.3, -0.14, 0.28],
  [0.5, -0.2, 0.31],
  [-0.5, -0.19, 0.33],
  [-0.1, 0.44, 0.21],
];
/** The raised hand, as the one line the mark draws it with. Left edge up, round the tip, down over the knuckles. */
const HUSH_HAND: readonly P2[] = [
  [-0.4, -0.88],
  [-0.347, -0.77],
  [-0.096, -0.268],
  [-0.072, -0.225],
  [-0.036, -0.213],
  [0.0, -0.232],
  [0.017, -0.28],
  [0.0, -0.411],
  [-0.041, -0.519],
  [0.036, -0.519],
  [0.084, -0.555],
  [0.115, -0.591],
  [0.167, -0.627],
  [0.191, -0.675],
  [0.167, -0.711],
  [0.132, -0.723],
  [0.144, -0.77],
  [0.15, -0.88],
];

/** How far the edge of the blob is from the origin, for 360 evenly spaced angles. */
function hushEdge(): number[] {
  const n = 360;
  const r: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    let far = 0.05;
    for (const [cx, cy, cr] of HUSH_LOBES) {
      const along = dx * cx + dy * cy;
      const disc = along * along - (cx * cx + cy * cy - cr * cr);
      if (disc >= 0) far = Math.max(far, along + Math.sqrt(disc));
    }
    r.push(far);
  }
  // Round the notches between the lobes, the way the mark does.
  for (let pass = 0; pass < 3; pass++) {
    const s = r.slice();
    for (let i = 0; i < n; i++) r[i] = (s[(i + n - 1) % n] + 2 * s[i] + s[(i + 1) % n]) / 4;
  }
  return r;
}

function meshOf(pos: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The blob as a thick stone pillow facing +z. `unit` is half its width in metres, `front` and `back`
 *  how far it swells each way. Also returns the height of the front surface over any point of the face. */
function hushBody(seg: number, fronts: number[], backs: number[], unit: number, front: number, back: number): { geometry: THREE.BufferGeometry; zAt: (x: number, y: number) => number } {
  const edge = hushEdge();
  const mean = edge.reduce((a, c) => a + c, 0) / edge.length;
  const at = (t: number): number => {
    const f = ((((t / (Math.PI * 2)) % 1) + 1) % 1) * edge.length;
    const i = Math.floor(f) % edge.length;
    const k = f - Math.floor(f);
    return edge[i] * (1 - k) + edge[(i + 1) % edge.length] * k;
  };
  // Radius of the ring at depth u (-1 the back, 0 the rim, 1 the front). The lobes soften toward
  // the middle of the face so the eyes and the hand sit on calm stone.
  const radius = (t: number, u: number): number => {
    const e = at(t);
    if (u <= 0) return e * Math.pow(1 - u * u, 0.4);
    const c = Math.pow(1 - Math.pow(u, 2.6), 1 / 2.6);
    const s = Math.min(1, Math.max(0, (u - 0.6) / 0.4));
    const k = 0.9 * s * s * (3 - 2 * s);
    return Math.min(e * Math.pow(c, 0.2), (e * (1 - k) + mean * k) * c);
  };
  // The points go round at even steps of distance along the edge, packed closer deep in the
  // notches, so the pocket under the top lobe keeps its floor.
  const fine = edge.length;
  const reach = Math.max(...edge);
  const cum: number[] = [0];
  for (let i = 0; i < fine; i++) {
    const t0 = (i / fine) * Math.PI * 2;
    const t1 = ((i + 1) / fine) * Math.PI * 2;
    const e0 = edge[i];
    const e1 = edge[(i + 1) % fine];
    const deep = 1 + 2 * (1 - Math.min(e0, e1) / reach);
    cum.push(cum[i] + deep * Math.hypot(Math.cos(t1) * e1 - Math.cos(t0) * e0, Math.sin(t1) * e1 - Math.sin(t0) * e0));
  }
  const angles: number[] = [];
  for (let i = 0, k = 0; i < seg; i++) {
    const want = (i / seg) * cum[fine];
    while (cum[k + 1] < want) k++;
    angles.push(((k + (want - cum[k]) / (cum[k + 1] - cum[k])) / fine) * Math.PI * 2);
  }
  const us = [...backs, 0, ...fronts];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const u of us) {
    for (let i = 0; i < seg; i++) {
      const t = angles[i];
      const r = radius(t, u) * unit;
      pos.push(Math.cos(t) * r, Math.sin(t) * r, u > 0 ? u * front : u * back);
    }
  }
  const poleBack = pos.length / 3;
  pos.push(0, 0, -back);
  const poleFront = poleBack + 1;
  pos.push(0, 0, front);
  for (let j = 0; j < us.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i;
      const c = j * seg + ((i + 1) % seg);
      const d = (j + 1) * seg + i;
      const f = (j + 1) * seg + ((i + 1) % seg);
      idx.push(a, c, d, c, f, d);
    }
  }
  const last = (us.length - 1) * seg;
  for (let i = 0; i < seg; i++) {
    const n = (i + 1) % seg;
    idx.push(poleBack, n, i);
    idx.push(poleFront, last + i, last + n);
  }
  const zAt = (x: number, y: number): number => {
    const rho = Math.hypot(x, y) / unit;
    const t = Math.atan2(y, x);
    if (rho >= at(t)) return 0;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (radius(t, mid) > rho) lo = mid;
      else hi = mid;
    }
    return lo * front;
  };
  return { geometry: meshOf(pos, idx), zAt };
}

/** One closed eye: a crescent hanging down. Width `2 * hw`, counter-clockwise. */
function hushEye(hw: number, sag: number, thick: number, n: number): P2[] {
  const out: P2[] = [];
  const mid = (s: number): number => -sag * (1 - s * s);
  const half = (s: number): number => thick * (0.18 + 0.82 * Math.sqrt(Math.max(0, 1 - s * s)));
  for (let i = 0; i <= n; i++) {
    const s = -1 + (2 * i) / n;
    out.push([hw * s, mid(s) - half(s)]);
  }
  for (let i = n; i >= 0; i--) {
    const s = -1 + (2 * i) / n;
    out.push([hw * s, mid(s) + half(s)]);
  }
  return out;
}

/** A four point star with sides that curve in. Counter-clockwise, first point on the right. */
function hushStar(w: number, h: number, per: number): P2[] {
  const out: P2[] = [];
  const n = per * 4;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push([w * Math.sign(c) * Math.pow(Math.abs(c), 3.2), h * Math.sign(s) * Math.pow(Math.abs(s), 3.2)]);
  }
  return out;
}

/** A cloth laid over something small on a slab, its front edge hanging over the lip of the slab.
 *  The slab top is y = 0, x runs across, +z comes toward whoever stands at the altar, and the slab
 *  ends at z = `lip`. What is under the cloth stays under it. */
function hushCloth(cols: number, rows: number, lip: number): THREE.BufferGeometry {
  const bump = (x: number, z: number, r: number): number => Math.exp(-Math.pow((x * x + z * z) / (r * r), 1.3));
  const lump = (x: number, z: number): number => 0.17 * bump(x + 0.02, z - 0.04, 0.12) + 0.09 * bump(x - 0.105, z - 0.075, 0.085);
  const HALF = 0.36;
  const BACK = -0.24;
  const HANG = 2;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows + HANG; j++) {
    for (let i = 0; i <= cols; i++) {
      const a = i / cols;
      const side = Math.abs(a * 2 - 1);
      if (j <= rows) {
        const f = j / rows;
        const x = (a * 2 - 1) * (HALF + 0.02 * Math.sin(f * 5 + 0.4));
        const z = BACK + (lip - BACK) * f + (j === 0 ? 0.025 * Math.sin(a * 8 + 0.7) : 0);
        // Loose folds toward the hem, none over the thing itself.
        const loose = Math.max(side * side, (1 - f) * (1 - f));
        const fold = 0.02 * loose * (0.5 + 0.5 * Math.sin(a * 13 + f * 4 + 1.1));
        pos.push(x, lump(x, z) + 0.008 + fold, z);
      } else {
        const h = (j - rows) / HANG;
        const len = 0.1 + 0.08 * Math.sin(a * Math.PI) + 0.025 * Math.sin(a * 11 + 0.5);
        pos.push((a * 2 - 1) * (HALF + 0.02 * Math.sin(5.4)), 0.008 - len * h, lip + 0.016 + 0.014 * h * Math.sin(a * 12 + 0.3));
      }
    }
  }
  const w = cols + 1;
  for (let j = 0; j < rows + HANG; j++) {
    for (let i = 0; i < cols; i++) {
      const p0 = j * w + i;
      idx.push(p0, p0 + w, p0 + 1, p0 + 1, p0 + w, p0 + w + 1);
    }
  }
  return meshOf(pos, idx);
}

export const district: DistrictModule = {
  id: 'studio',
  build(ctx) {
    return buildStudio(ctx);
  },
};

function buildStudio(ctx: DistrictContext): DistrictBuild {
  // Anything he can walk onto tops out here: the plaza paving is 3 cm up, this is a hair over it.
  const FLUSH = 0.035;
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const sun = ctx.sun ?? FALLBACK_SUN;
  const [PINK, BLUE, YELLOW] = site.accents as [string, string, string];
  const shade = mix(mix(P.pave, PINK, 0.1), P.shadow, 0.3);
  const arrive = site.arrive;

  const group = new THREE.Group();
  group.name = 'studio';
  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const has = (id: string): boolean => entries.some((e) => e.id === id);

  const b = kit.builder();
  const fit = (text: string, size: number, max: number): number => {
    const w = b.measure ? b.measure({ text, size }).width : text.length * size * 0.7;
    return w > max ? (size * max) / w : size;
  };
  const cast = (g: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: number | V3): void => {
    b.shadow?.(g, { color: shade, sun, pos, rot, scale, y: 0, lift: 0.015 });
  };
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const dir = new THREE.Vector3();
  /** A round post from a to b. */
  const strut = (a: V3, c: V3, r: number, color: ColorLike, seg = 6, id?: number): void => {
    dir.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const len = dir.length();
    dir.normalize();
    q.setFromUnitVectors(UP, dir);
    e.setFromQuaternion(q, 'XYZ');
    b.add(geo.cylinder(r, r, len, seg), { color, pos: a, rot: [e.x, e.y, e.z], id });
  };

  // Leaf in a lump: shrubs, roof gardens, and ivy when it is squashed flat against a wall.
  let clumpSeed = 71;
  const clump = (pos: V3, scale: V3, tint: string, rot?: V3, count = 4, sway = 0.1, detail = 0): void => {
    b.add(geo.blobs(clumpSeed++ % 9, count, 1, { squash: 0.8, detail, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) },
      color: tint,
      pos,
      rot,
      scale,
      sway,
    });
  };
  // A street tree: a trunk and a round crown of three masses.
  const tree = (x: number, z: number, h: number, tint: string, base = 0, pit = true): void => {
    const y = ctx.groundAt(x, z) + base;
    const s = h / 7;
    const a = rng() * 6.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    if (pit) b.add(geo.cylinder(0.95, 0.95, FLUSH, 10), { color: P.grassDeep, pos: [x, y, z], flat: 0.5 });
    b.add(geo.cylinder(0.18 * s, 0.3 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, y, z], sway: 0.2, swayBase: y });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: y };
    const id = b.newId();
    const ball = geo.sphere(1, high ? 9 : 6, high ? 6 : 4);
    b.add(ball, { ...leaf, id, pos: [x, y + 4.9 * s, z], scale: [2.5 * s, 2.0 * s, 2.4 * s] });
    b.add(ball, { ...leaf, id, pos: [x - 1.6 * s * ca, y + 4.6 * s, z - 1.6 * s * sa], scale: [1.5 * s, 1.25 * s, 1.45 * s] });
    b.add(ball, { ...leaf, pos: [x + 1.6 * s * ca + 0.6 * sa, y + 4.0 * s, z + 1.6 * s * sa], scale: [1.7 * s, 1.35 * s, 1.6 * s] });
    if (base === 0) cast(ball, [x, 4.9 * s, z], undefined, [2.5 * s, 2.0 * s, 2.4 * s]);
  };
  // A window with a pink frame, cross bars and a sill, on a wall facing `rot`.
  const pane = (pos: V3, w: number, h: number, rot: V3 = [0, 0, 0], tint?: string): void => {
    const f = frame(pos[0], pos[2], rot[1]);
    const r = rng();
    const glass = tint ?? (r < 0.2 ? LIT : r < 0.42 ? (P.glass as string) : WINDOW);
    b.add(geo.box(w + 0.3, h + 0.3, 0.1), { color: PINK, pos: f(0, pos[1] - 0.15, 0.02), rot, flat: 0.3 });
    b.add(geo.plane(w, h), { color: glass, pos: f(0, pos[1] + h / 2, 0.08), rot, flat: 0.7 });
    b.add(geo.box(0.09, h, 0.06), { color: PINK, pos: f(0, pos[1], 0.1), rot, flat: 0.3 });
    b.add(geo.box(w, 0.09, 0.06), { color: PINK, pos: f(0, pos[1] + h * 0.55, 0.1), rot, flat: 0.3 });
    b.add(geo.box(w + 0.5, 0.14, 0.3), { color: P.marble, pos: f(0, pos[1] - 0.29, 0.12), rot });
  };

  // ------------------------------------------------------------------------------------------
  // The lofts. North wing x -16..12, z -22..-14, 12 m. East wing x 12..19, z -22..6, 14 m.
  // ------------------------------------------------------------------------------------------
  const NF = -14; // north wing front (south face)
  const NB = -22;
  const NH = 12;
  const EX = 12; // east wing yard face (west face)
  const EE = 19;
  const ES = 6; // east wing south end
  const EH = 14;
  const DOOR_L = -11;
  const DOOR_R = -5;
  const DOOR_H = 4.6;
  const BAY = -18; // back wall of the open bay
  const brickId = b.newId();
  const brickFill = { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, hatch: 0.05, id: brickId };
  {
    const foot = Math.min(ctx.groundAt(-16, NB), ctx.groundAt(EE, NB), ctx.groundAt(EE, ES), 0) - 1.2;
    // Marble footing, broken by the bay.
    b.add(geo.box(5.2, 0.7 - foot, 8.2), { color: P.marbleShade, pos: [-13.5, foot, (NF + NB) / 2] });
    b.add(geo.box(7.2, 0.7 - foot, 8.2), { color: P.marbleShade, pos: [-1.5 + 0.1, foot, (NF + NB) / 2] });
    b.add(geo.box(7.2, 0.7 - foot, 28.2), { color: P.marbleShade, pos: [(EX + EE) / 2 - 0.1, foot, (NB + ES) / 2] });
    b.add(geo.box(7, 0.7 - foot, 8.2), { color: P.marbleShade, pos: [8.5 - 0.1, foot, (NF + NB) / 2] });

    // North wing brick, round the bay.
    b.add(geo.box(5, NH - 0.7, 8), { ...brickFill, pos: [-13.5, 0.7, (NF + NB) / 2] });
    b.add(geo.box(17, NH - 0.7, 8), { ...brickFill, pos: [3.5, 0.7, (NF + NB) / 2] });
    b.add(geo.box(6, NH - DOOR_H, 8), { ...brickFill, pos: [-8, DOOR_H, (NF + NB) / 2] });
    b.add(geo.box(6, DOOR_H, BAY - NB), { ...brickFill, pos: [-8, 0, (BAY + NB) / 2] });
    cast(geo.box(28, NH + 1, 8), [-2, 0, (NF + NB) / 2]);
    // East wing.
    b.add(geo.box(EE - EX, EH - 0.7, ES - NB), { ...brickFill, pos: [(EX + EE) / 2, 0.7, (NB + ES) / 2] });
    cast(geo.box(EE - EX, EH + 1, ES - NB), [(EX + EE) / 2, 0, (NB + ES) / 2]);

    // Cornices and parapets.
    b.add(geo.box(28.6, 0.45, 8.6), { color: P.marble, pos: [-2, NH, (NF + NB) / 2] });
    b.add(geo.box(EE - EX + 0.6, 0.45, ES - NB + 0.6), { color: P.marble, pos: [(EX + EE) / 2, EH, (NB + ES) / 2] });
    b.add(geo.box(EE - EX - 0.2, 0.7, ES - NB - 0.2), { color: P.brickDeep, pos: [(EX + EE) / 2, EH + 0.45, (NB + ES) / 2] });
    // A string course of marble between the storeys.
    b.add(geo.box(28.3, 0.22, 8.3), { color: P.marble, pos: [-2, DOOR_H + 0.2, (NF + NB) / 2] });
    b.add(geo.box(EE - EX + 0.3, 0.22, ES - NB + 0.3), { color: P.marble, pos: [(EX + EE) / 2, 6.8, (NB + ES) / 2] });

    colliders.push({ kind: 'box', x: -13.5, z: (NF + NB) / 2, hw: 2.6, hd: 4.1 });
    colliders.push({ kind: 'box', x: 3.5, z: (NF + NB) / 2, hw: 8.6, hd: 4.1 });
    colliders.push({ kind: 'box', x: -8, z: (BAY + 0.7 + NB) / 2, hw: 3.1, hd: (BAY + 0.7 - NB) / 2 });
    colliders.push({ kind: 'box', x: (EX + EE) / 2 - 0.1, z: (NB + ES) / 2, hw: (EE - EX) / 2 + 0.3, hd: (ES - NB) / 2 + 0.1 });
  }

  // The name, on a marble band across the north wing over the open door.
  const frieze = b.add(geo.box(16, 1.8, 0.3), { color: P.marble, pos: [-4, 8.7, NF + 0.1] });
  {
    const name = site.name.toUpperCase();
    b.label({ text: name, size: fit(name, 1.0, 13.5), pos: [-4, 9.85, NF + 0.26], ink: P.ink, plate: P.marble, id: frieze, pad: 0.1 });
    b.label({ text: site.years.toUpperCase(), size: 0.3, pos: [-4, 9.06, NF + 0.26], ink: P.violet, plate: P.marble, id: frieze, pad: 0.1 });
  }

  // The open bay: a warm room with a pave floor, the door rolled up into its drum.
  {
    b.add(geo.box(6, 0.04, NF - BAY), { color: P.paveShade, pos: [-8, 0, (NF + BAY) / 2], flat: 0.3 });
    b.add(geo.plane(6, DOOR_H), { color: INSIDE, pos: [-8, DOOR_H / 2, BAY + 0.01], flat: 0.3 });
    b.add(geo.plane(NF - BAY, DOOR_H), { color: mix(INSIDE, P.shadow, 0.25), pos: [DOOR_R - 0.01, DOOR_H / 2, (NF + BAY) / 2], rot: [0, -Math.PI / 2, 0] });
    b.add(geo.plane(NF - BAY, DOOR_H), { color: mix(INSIDE, P.shadow, 0.25), pos: [DOOR_L + 0.01, DOOR_H / 2, (NF + BAY) / 2], rot: [0, Math.PI / 2, 0] });
    b.add(geo.plane(6, NF - BAY), { color: mix(INSIDE, P.shadow, 0.4), pos: [-8, DOOR_H - 0.01, (NF + BAY) / 2], rot: [Math.PI / 2, 0, 0], flat: 0.5 });
    // Rails and the drum.
    for (const x of [DOOR_L + 0.1, DOOR_R - 0.1]) b.add(geo.box(0.2, DOOR_H, 0.24), { color: P.steel, pos: [x, 0, NF + 0.08] });
    b.add(geo.cylinder(0.42, 0.42, 6.6, 12), { color: PINK, pos: [-11.3, DOOR_H + 0.12, NF + 0.35], rot: [0, 0, -Math.PI / 2], flat: 0.2 });
    b.add(geo.box(6.2, 0.3, 0.14), { color: mix(PINK, P.shadow, 0.2), pos: [-8, DOOR_H - 0.3, NF + 0.15] });
    // A lamp hanging in the bay.
    b.add(geo.cylinder(0.025, 0.025, 1.1, 4), { color: IRON, pos: [-8, DOOR_H - 1.1, NF - 0.9] });
    b.add(geo.cone(0.45, 0.4, 10), { color: YELLOW, pos: [-8, DOOR_H - 1.45, NF - 0.9], flat: 0.6 });
  }

  // The 2023 shelf at the back of the bay. Seven jars, one per tool; two have grown.
  if (has('ai-notebook')) {
    const SZ = BAY + 0.35;
    const shelfId = b.newId();
    for (const x of [-10.6, -5.4]) b.add(geo.box(0.12, 2.6, 0.6), { color: WOOD_DEEP, pos: [x, 0, SZ], id: shelfId });
    for (const y of [0.25, 1.35]) b.add(geo.box(5.4, 0.1, 0.62), { color: WOOD, pos: [-8, y, SZ], id: shelfId });
    const head = b.add(geo.box(5.4, 0.55, 0.08), { color: PAPER, pos: [-8, 2.6, SZ + 0.2], flat: 0.4 });
    b.label({ text: 'THE 2023 SHELF', size: 0.24, pos: [-8, 2.88, SZ + 0.25], ink: P.ink, plate: PAPER, id: head, flat: 0.4, pad: 0.1 });
    const words = ['COMIC', 'MUSIC', 'MOTION', 'VOICE', '3D', 'FACE', 'MOOD'];
    const fills = [PINK, BLUE, P.mint, YELLOW, P.lavender, P.orange, P.teal];
    const jar = geo.cylinder(0.27, 0.27, 0.62, 12);
    const fillG = geo.cylinder(0.24, 0.24, 0.38, 12);
    const lid = geo.cylinder(0.29, 0.29, 0.1, 12);
    for (let i = 0; i < words.length; i++) {
      const row = i < 4 ? 0 : 1;
      const k = row === 0 ? i : i - 4;
      const n = row === 0 ? 4 : 3;
      const x = -8 + (k - (n - 1) / 2) * 1.25;
      const y = row === 0 ? 0.35 : 1.45;
      const grew = words[i] === 'COMIC' || words[i] === 'VOICE';
      b.add(fillG, { color: fills[i], pos: [x, y + 0.02, SZ + 0.05], flat: 0.4 });
      b.add(jar, { color: P.glass, pos: [x, y, SZ + 0.05], dither: 0.5, flat: 1 });
      b.add(lid, { color: grew ? YELLOW : P.steel, pos: [x, y + 0.62, SZ + 0.05] });
      const tag = b.add(geo.box(0.46, 0.2, 0.02), { color: PAPER, pos: [x, y + 0.3, SZ + 0.33], flat: 0.5 });
      b.label({ text: words[i], size: fit(words[i], 0.1, 0.36), pos: [x, y + 0.4, SZ + 0.345], ink: P.ink, plate: PAPER, id: tag, flat: 0.5, pad: 0.06, jitter: 0.3 });
      if (grew) {
        // A sprout through the lid.
        b.add(geo.cylinder(0.025, 0.03, 0.55, 4), { color: P.leafDeep, pos: [x, y + 0.72, SZ + 0.05], sway: 0.3 });
        clump([x, y + 1.3, SZ + 0.05], [0.42, 0.32, 0.36], LEAVES[i % LEAVES.length], undefined, 4, 0.3);
        clump([x + 0.25, y + 1.05, SZ + 0.1], [0.22, 0.16, 0.2], LEAVES[(i + 2) % LEAVES.length], undefined, 3, 0.3);
      }
    }
    pois.push({ entry: 'ai-notebook', x: -8, z: BAY + 3.0, y: 3.9, reach: 4.2, prompt: 'Read the jar labels' });
  }

  // Windows. North wing south face, east wing yard face and south end.
  {
    const south: V3 = [0, 0, 0];
    for (const x of [-14, -9.4, -6.6, -1.5, 2.5, 6.5, 10]) pane([x, 5.5, NF], 1.9, 2.4, south);
    for (const x of [-14, 6.5, 10]) pane([x, 9.1, NF], 1.9, 2.2, south);
    pane([1.5, 1.0, NF], 4.4, 2.6, south, LIT);
    pane([-14, 1.2, NF], 1.9, 2.4, south);
    // A door into the lofts, with a step.
    b.add(geo.box(1.7, 2.8, 0.12), { color: P.marble, pos: [8.2, 0.7, NF + 0.03] });
    b.add(geo.box(1.3, 2.5, 0.1), { color: PINK, pos: [8.2, 0.7, NF + 0.08], flat: 0.3 });
    b.add(geo.box(2.2, 0.35, 0.9), { color: P.marbleShade, pos: [8.2, 0, NF + 0.45] });
    colliders.push({ kind: 'box', x: 8.2, z: NF + 0.45, hw: 1.1, hd: 0.45 });

    const west: V3 = [0, -Math.PI / 2, 0];
    for (const z of [-10.2, -5, 0, 4.4]) {
      pane([EX, 7.6, z], 1.9, 2.3, west);
      pane([EX, 10.9, z], 1.9, 2.3, west);
    }
    pane([EX, 1.6, -10.2], 1.9, 2.4, west);
    const southE: V3 = [0, 0, 0];
    for (const x of [13.9, 17.1]) {
      pane([x, 7.6, ES], 1.7, 2.3, southE);
      pane([x, 10.9, ES], 1.7, 2.3, southE);
    }
    pane([15.5, 1.4, ES], 3.6, 2.6, southE, LIT);
  }

  // A fire escape down the north wing, by the loft door.
  if (!low) {
    const fx = 8.3;
    for (const y of [4.95, 8.55]) {
      b.add(geo.box(3.6, 0.09, 1.1), { color: IRON, pos: [fx, y, NF + 0.55] });
      b.add(geo.box(3.6, 0.07, 0.07), { color: IRON, pos: [fx, y + 1.0, NF + 1.08] });
      b.add(geo.plane(3.6, 0.95), { color: IRON, pos: [fx, y + 0.55, NF + 1.08], dither: 0.5, flat: 1 });
      for (const s of [-1, 1]) b.add(geo.box(0.07, 1.0, 0.07), { color: IRON, pos: [fx + s * 1.77, y + 0.05, NF + 1.08] });
    }
    strut([fx - 1.4, 5.0, NF + 0.6], [fx + 1.2, 8.6, NF + 0.6], 0.05, IRON, 4);
    strut([fx - 1.2, 5.0, NF + 0.85], [fx + 1.4, 8.6, NF + 0.85], 0.05, IRON, 4);
  }

  // Saw-tooth north lights on the north wing, a garden on the rest of the roof.
  {
    const ROOF = NH + 0.45;
    const tooth = geo.extrude([[0, 0], [2.6, 0], [2.6, 1.7]], 13, { cacheKey: 'studio-sawtooth' });
    for (let i = 0; i < 3; i++) {
      const z = NF - 0.2 - i * 2.6;
      b.add(tooth, { color: P.steel, pos: [4.6, ROOF, z], rot: [0, Math.PI / 2, 0] });
      b.add(geo.plane(12.6, 1.5), { color: P.glass, pos: [4.6, ROOF + 0.85, z - 2.62], rot: [0, Math.PI, 0], flat: 0.6 });
    }
    b.add(geo.box(13, 0.16, 7.4), { color: P.grassDeep, pos: [-9.3, ROOF, (NF + NB) / 2], flat: 0.4 });
    const n = low ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const x = -14.5 + i * (11 / (n - 1));
      clump([x, ROOF + 0.45, (NF + NB) / 2 + (i % 2 ? 1.8 : -1.6)], [1.1, 0.8, 1.0], LEAVES[i % LEAVES.length]);
    }
    tree(-12.5, -19.5, 4.6, LEAVES[2], ROOF + 0.1, false);
    // East wing roof: a planted bed and the water tower.
    const ER = EH + 0.45;
    b.add(geo.box(5.8, 0.16, 12), { color: P.grassDeep, pos: [(EX + EE) / 2, ER, 0 - 1], flat: 0.4 });
    for (let i = 0; i < (low ? 2 : 4); i++) clump([13.6 + (i % 2) * 3.2, ER + 0.45, -5.5 + i * 2.8], [1.0, 0.75, 1.0], LEAVES[(i + 2) % 5]);
    const tx = 15.5;
    const tz = -15;
    for (const [dx, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]] as const) {
      b.add(geo.box(0.16, 2.6, 0.16), { color: IRON, pos: [tx + dx, ER, tz + dz] });
    }
    b.add(geo.box(3.0, 0.15, 3.0), { color: IRON, pos: [tx, ER + 2.6, tz] });
    const tank = geo.cylinder(1.5, 1.5, 3.0, 14);
    b.add(tank, { gradient: { bottom: WOOD_DEEP, top: WOOD }, color: WOOD, pos: [tx, ER + 2.75, tz] });
    for (const y of [0.7, 1.6, 2.5]) b.add(geo.torus(1.52, 0.05, 16, 4), { color: IRON, pos: [tx, ER + 2.75 + y, tz] });
    b.add(geo.cone(1.7, 1.3, 14), { color: P.verdigris, pos: [tx, ER + 5.75, tz] });
  }

  // Ivy: up the west end of the north wing and across its front, round the east wing corner.
  {
    // A mat of ivy climbing a wall: rows of leaf lumps, wide at the foot and thinning as it climbs.
    // (x, z) is the foot of the mat on the wall face, `alongX` says which way the wall runs,
    // `out` is the side the wall faces (+1 or -1 along the other axis).
    let ivySeed = 5;
    const ivy = (x: number, z: number, alongX: boolean, out: number, width: number, height: number, tint: string): void => {
      const id = b.newId();
      const rows = Math.max(2, Math.round(height / (low ? 1.0 : 0.75)));
      const step = low ? 1.2 : 0.8;
      for (let j = 0; j < rows; j++) {
        const t = j / (rows - 1);
        const rw = width * (1 - 0.7 * t) * (0.85 + rng() * 0.3);
        const n = Math.max(1, Math.round(rw / step));
        for (let i = 0; i < n; i++) {
          const a = (n === 1 ? 0 : (i / (n - 1) - 0.5) * rw) + (rng() - 0.5) * 0.4 - t * width * 0.15;
          const y = 0.5 + j * (height / rows) + rng() * 0.25;
          const pos: V3 = alongX ? [x + a, y, z + out * 0.12] : [x + out * 0.12, y, z + a];
          const scale: V3 = alongX ? [0.85, 0.72, 0.24] : [0.24, 0.72, 0.85];
          const tt = LEAVES[(ivySeed + i + j) % 2 === 0 ? 2 : 4];
          b.add(geo.blobs(ivySeed++ % 7, 3, 1, { squash: 0.8, detail: 0, size: [0.45, 0.7] }), {
            gradient: { bottom: mix(tint, P.shadow, 0.3), top: mix(tt, '#ffffff', 0.08) },
            color: tint,
            pos,
            scale,
            id,
            sway: 0.04,
          });
        }
      }
    };
    ivy(-16, (NF + NB) / 2 + 0.5, false, -1, 6.5, low ? 6 : 9.5, LEAVES[2]);
    ivy(-14.9, NF, true, 1, 2.0, low ? 5 : 8, LEAVES[4]);
    ivy(12.8, ES, true, 1, 1.6, low ? 5 : 8.5, LEAVES[1]);
    ivy(EX, 5.55, false, -1, 0.8, low ? 4 : 7, LEAVES[2]);
    ivy(-3.2, NF, true, 1, 1.0, 4.2, LEAVES[0]);
    // A bed of shrubs along the north wing either side of the bay.
    for (const [x0, x1] of [[-15.6, -11.4], [-4.6, 0.0]] as const) {
      b.add(geo.box(x1 - x0, 0.35, 1.0), { color: P.marbleShade, pos: [(x0 + x1) / 2, 0, NF + 0.6] });
      b.add(geo.box(x1 - x0 - 0.2, 0.06, 0.8), { color: P.grassDeep, pos: [(x0 + x1) / 2, 0.35, NF + 0.6], flat: 0.4 });
      const m = Math.round((x1 - x0) / 1.4);
      for (let i = 0; i < m; i++) clump([x0 + 0.7 + i * ((x1 - x0 - 1.4) / Math.max(1, m - 1)), 0.85, NF + 0.6], [0.7, 0.55, 0.5], LEAVES[(i + 1) % 5]);
      colliders.push({ kind: 'box', x: (x0 + x1) / 2, z: NF + 0.6, hw: (x1 - x0) / 2, hd: 0.5 });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The easel. The hero. 22 m to the top, its sheet turned to whoever walks in from the road.
  // ------------------------------------------------------------------------------------------
  const EZ_X = 2.5;
  const EZ_Z = -6.5;
  const yE = face(EZ_X, EZ_Z, arrive.x, arrive.z);
  const E = frame(EZ_X, EZ_Z, yE);
  const rE: V3 = [0, yE, 0];
  const SHEET_W = 12;
  const SHEET_H = 9;
  const SHEET_Y = 6.3;
  const SHEET_Z = 0; // centre of the sheet's thickness
  const SHEET_FRONT = SHEET_Z + 0.1;
  {
    // Paving under it: a round of marble set into the yard.
    b.add(geo.cylinder(7.6, 7.6, FLUSH - 0.003, 32), { color: P.marbleShade, pos: [EZ_X, 0, EZ_Z], flat: 0.4 });
    b.add(geo.cylinder(7.0, 7.0, FLUSH, 32), { color: P.marble, pos: [EZ_X, 0, EZ_Z], flat: 0.4 });

    // Legs: two at the front behind the board, leaning in to meet at the top, and one behind.
    const legId = b.newId();
    const TOP: V3 = E(0, 22, -0.75);
    const feet: V3[] = [E(-5.6, 0, -0.75), E(5.6, 0, -0.75), E(0, 0, -7.2)];
    for (let i = 0; i < 2; i++) strut(feet[i], TOP, 0.3, WOOD, 6, legId);
    strut(feet[2], E(0, 20.4, -1.05), 0.27, WOOD_DEEP, 6);
    b.add(geo.cone(0.55, 1.2, 8), { color: PINK, pos: E(0, 21.6, -0.75), flat: 0.3 });
    // A crossbar behind, and the hinge.
    strut(E(-3.9, 7.5, -0.95), E(3.9, 7.5, -0.95), 0.16, WOOD_DEEP, 6);
    strut(E(0, 7.5, -1.0), E(0, 7.5, -4.8), 0.14, WOOD_DEEP, 6);
    for (const f of feet) colliders.push({ kind: 'circle', x: f[0], z: f[2], r: 0.55 });
    for (const f of feet) b.add(geo.cylinder(0.42, 0.48, 0.3, 8), { color: P.marbleShade, pos: [f[0], 0, f[2]] });

    // The ledge it stands on, with the name of the work along it.
    const ledge = b.add(geo.box(13.4, 0.75, 1.5), { color: WOOD, pos: E(0, SHEET_Y - 0.75, -0.2), rot: rE });
    b.add(geo.box(13.4, 0.2, 0.18), { color: WOOD_DEEP, pos: E(0, SHEET_Y, 0.46), rot: rE });
    b.label({ text: 'BACKRUN', size: 0.4, pos: E(0, SHEET_Y - 0.37, 0.56), rot: rE, ink: PAPER, plate: WOOD, id: ledge, pad: 0.08, jitter: 0.3 });
    // The board and the sheet on it.
    const boardG = geo.box(SHEET_W + 0.6, SHEET_H + 0.4, 0.3);
    b.add(boardG, { color: WOOD_DEEP, pos: E(0, SHEET_Y - 0.1, -0.3), rot: rE });
    cast(geo.box(SHEET_W + 0.6, SHEET_H + 0.6, 0.6), E(0, SHEET_Y - 0.1, -0.3), rE);
    const sheet = b.add(geo.box(SHEET_W, SHEET_H, 0.2), { color: PAPER, pos: E(0, SHEET_Y, SHEET_Z), rot: rE, flat: 0.35 });
    // Clamp across the top.
    b.add(geo.box(1.8, 0.7, 1.1), { color: WOOD, pos: E(0, SHEET_Y + SHEET_H - 0.25, -0.35), rot: rE });

    // The bloom: three washes spreading into each other, each with its pale halo and a hard edge.
    const washes: { c: string; x: number; y: number; r: number; seed: number }[] = [
      { c: PINK, x: -2.0, y: 4.3, r: 2.9, seed: 11 },
      { c: BLUE, x: 2.3, y: 3.5, r: 2.5, seed: 23 },
      { c: YELLOW, x: 0.4, y: 6.3, r: 1.9, seed: 37 },
    ];
    const n = high ? 72 : 48;
    let layer = 0;
    for (const w of washes) {
      const halo = geo.extrude(bloomOutline(w.seed + 100, w.r * 1.18, n), 0.03, { cacheKey: `studio-halo-${w.seed}-${n}` });
      b.add(halo, { color: mix(w.c, PAPER, 0.55), pos: E(w.x, SHEET_Y + w.y, SHEET_FRONT + 0.02 + layer * 0.012), rot: rE, flat: 0.8, outline: false });
      layer++;
    }
    for (const w of washes) {
      const body = geo.extrude(bloomOutline(w.seed, w.r, n), 0.03, { cacheKey: `studio-bloom-${w.seed}-${n}` });
      b.add(body, { color: w.c, pos: E(w.x, SHEET_Y + w.y, SHEET_FRONT + 0.06 + layer * 0.012), rot: rE, flat: 0.8 });
      layer++;
    }
    // Where blue runs into yellow it goes green, where pink runs into blue it goes violet.
    const g1 = geo.extrude(bloomOutline(51, 0.9, 36), 0.03, { cacheKey: 'studio-mix-g' });
    b.add(g1, { color: P.leaf, pos: E(1.4, SHEET_Y + 5.1, SHEET_FRONT + 0.06 + layer * 0.012), rot: rE, flat: 0.8 });
    const g2 = geo.extrude(bloomOutline(53, 0.75, 36), 0.03, { cacheKey: 'studio-mix-v' });
    b.add(g2, { color: P.lavender, pos: E(0.3, SHEET_Y + 3.4, SHEET_FRONT + 0.06 + layer * 0.012), rot: rE, flat: 0.8 });
    // Runs down the paper under the blue.
    for (const [x, len] of [[2.0, 1.6], [2.9, 1.0], [1.3, 0.8]] as const) {
      b.add(geo.box(0.12, len, 0.03), { color: BLUE, pos: E(x, SHEET_Y + 1.2 - len + 0.6, SHEET_FRONT + 0.05), rot: rE, flat: 0.8 });
    }
    // Pencil marks: the score in the corner.
    b.label({ text: '8.85', size: 0.32, pos: E(4.6, SHEET_Y + 0.75, SHEET_FRONT + 0.01), rot: rE, ink: P.violet, plate: PAPER, id: sheet, flat: 0.35, pad: 0.1 });
    b.label({ text: 'LOWER IS BETTER', size: 0.16, pos: E(4.6, SHEET_Y + 0.35, SHEET_FRONT + 0.01), rot: rE, ink: P.violet, plate: PAPER, id: sheet, flat: 0.35, pad: 0.1 });

    // Paint underfoot, the splashes flat on the marble.
    const splat: { c: string; x: number; z: number; r: number }[] = [
      { c: PINK, x: -2.2, z: 1.6, r: 0.55 },
      { c: BLUE, x: 1.6, z: 2.4, r: 0.4 },
      { c: YELLOW, x: -0.4, z: 3.4, r: 0.3 },
      { c: BLUE, x: 3.6, z: 1.1, r: 0.25 },
    ];
    for (let i = 0; i < splat.length; i++) {
      const s = splat[i];
      const g = geo.extrude(bloomOutline(70 + i, s.r, 20), 0.006, { cacheKey: `studio-splat-${i}` });
      b.add(g, { color: s.c, pos: E(s.x, FLUSH + 0.003, s.z), rot: yawed([-Math.PI / 2, 0, 0], yE), flat: 0.8, outline: false });
    }
  }

  // The jar and the three brushes, one per painter, at the foot of the easel.
  if (has('backrun')) {
    const J = E(-3.4, 0, 2.6);
    b.add(geo.cylinder(0.75, 0.8, 0.12, 14), { color: P.marbleShade, pos: J });
    const water = geo.cylinder(0.6, 0.6, 0.85, 14);
    b.add(water, { color: mix(BLUE, P.shadow, 0.1), pos: [J[0], 0.12, J[2]], flat: 0.5 });
    b.add(geo.cylinder(0.66, 0.66, 1.35, 14), { color: P.glass, pos: [J[0], 0.12, J[2]], dither: 0.5, flat: 1 });
    b.add(geo.torus(0.66, 0.06, 16, 5), { color: P.glass, pos: [J[0], 1.47, J[2]] });
    const jr = face(J[0], J[2], arrive.x, arrive.z);
    const JF = frame(J[0], J[2], jr);
    const tag = b.add(geo.box(0.86, 0.36, 0.03), { color: PAPER, pos: JF(0, 0.55, 0.66), rot: [0, jr, 0], flat: 0.5 });
    b.label({ text: 'BACKRUN', size: 0.13, pos: JF(0, 0.73, 0.68), rot: [0, jr, 0], ink: P.ink, plate: PAPER, id: tag, flat: 0.5, pad: 0.06 });
    // Three brushes: search, the net that copies it, the one that writes strokes in words.
    const brushes: { c: string; lean: V3; word: string }[] = [
      { c: PINK, lean: [-0.17, 0, 0.12], word: 'SEARCH' },
      { c: BLUE, lean: [0.05, 0, -0.16], word: 'NET' },
      { c: YELLOW, lean: [0.16, 0, 0.1], word: 'WORDS' },
    ];
    for (let i = 0; i < 3; i++) {
      const br = brushes[i];
      const rot = yawed(br.lean, jr);
      const dx = (i - 1) * 0.22;
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
      const along = (d: number): V3 => {
        const v = new THREE.Vector3(0, d, 0).applyMatrix4(m);
        return [J[0] + dx * Math.cos(jr) + v.x, 0.2 + v.y, J[2] - dx * Math.sin(jr) + v.z];
      };
      b.add(geo.cylinder(0.08, 0.1, 3.6, 6), { color: br.c, pos: along(0), rot, flat: 0.3 });
      b.add(geo.cylinder(0.13, 0.08, 0.5, 8), { color: P.brass, pos: along(3.6), rot });
      b.add(geo.lathe([[0.13, 0], [0.2, 0.25], [0.17, 0.6], [0.0, 1.05]], 8, { cacheKey: 'studio-bristle' }), { color: mix(br.c, P.ink, 0.15), pos: along(4.1), rot, flat: 0.4 });
    }
    // A plaque on a low block naming the painters.
    const PB = JF(1.35, 0, 0.5);
    const block = b.add(geo.bevelBox(1.3, 0.75, 0.5, 0.05), { color: P.marble, pos: PB, rot: [0, jr, 0] });
    b.label({ text: 'SEARCH  NET  WORDS', size: 0.09, pos: JF(1.35, 0.5, 0.76), rot: [0, jr, 0], ink: P.ink, plate: P.marble, id: block, pad: 0.06 });
    b.label({ text: 'THREE PAINTERS', size: 0.08, pos: JF(1.35, 0.3, 0.76), rot: [0, jr, 0], ink: P.violet, plate: P.marble, id: block, pad: 0.06 });
    clump([PB[0], 0.1, PB[2]], [0.5, 0.25, 0.45], P.moss as string, undefined, 3, 0);
    colliders.push({ kind: 'circle', x: J[0], z: J[2], r: 0.85 });
    // Two paint pots by the jar.
    const pot = geo.cylinder(0.22, 0.22, 0.32, 10);
    const pp = JF(-1.1, 0, 0.3);
    b.add(pot, { color: P.steel, pos: pp });
    b.add(geo.cylinder(0.2, 0.2, 0.02, 10), { color: PINK, pos: [pp[0], 0.32, pp[2]], flat: 0.6 });
    const pq = JF(-1.4, 0, -0.35);
    b.add(pot, { color: P.steel, pos: pq });
    b.add(geo.cylinder(0.2, 0.2, 0.02, 10), { color: YELLOW, pos: [pq[0], 0.32, pq[2]], flat: 0.6 });
    // The marker stands off to the pots' side, out of the line from the road to the brushes.
    const pj = JF(-1.9, 0, 1.2);
    pois.push({ entry: 'backrun', x: pj[0], z: pj[2], y: 2.2, reach: 4.5, prompt: 'Look at the brushes' });
  }

  // ------------------------------------------------------------------------------------------
  // The comic wall on the east wing, and a microphone in front of it.
  // ------------------------------------------------------------------------------------------
  if (has('hon')) {
    const wrot: V3 = [0, -Math.PI / 2, 0];
    const WX = EX - 0.12; // face of the board
    const W0 = -4.8;
    const W1 = 4.8;
    const board = b.add(geo.box(W1 - W0 + 0.5, 6.6, 0.24), { color: PAPER, pos: [EX - 0.02, 0.6, (W0 + W1) / 2], rot: wrot, flat: 0.3 });
    void board;
    b.add(geo.box(W1 - W0 + 0.9, 0.3, 0.5), { color: P.marble, pos: [EX - 0.1, 7.2, (W0 + W1) / 2], rot: wrot });
    // Six panels, three across, two down. Each z, y is the panel centre.
    const PW = 3.0;
    const PH = 2.7;
    const cols = [W0 + 0.25 + PW / 2, (W0 + W1) / 2, W1 - 0.25 - PW / 2];
    const rows = [5.35, 2.35];
    const bgs = [BLUE, YELLOW, PINK, P.mint, P.lavender, P.sandLight];
    const at = (z: number, y: number, d: number): V3 => [WX - d, y, z];
    // Facing the wall (east), north is on the left, so the panels read from low z to high z.
    const order = [0, 1, 2];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const z = cols[order[c]];
        const y = rows[r];
        const k = r * 3 + c;
        b.add(geo.box(PW, PH, 0.04), { color: P.ink, pos: at(z, y - PH / 2, 0.02), rot: wrot, flat: 1 });
        b.add(geo.plane(PW - 0.16, PH - 0.16), { color: bgs[k], pos: at(z, y, 0.05), rot: wrot, flat: 0.85 });
        // Something drawn in each.
        const p = (dz: number, dy: number, d = 0.08): V3 => at(z - dz, y + dy, d);
        if (k === 0) {
          // A head talking: a round head, a balloon.
          b.add(geo.cylinder(0.42, 0.42, 0.05, 14), { color: P.skin, pos: p(-0.8, -0.35), rot: yawed([Math.PI / 2, 0, 0], -Math.PI / 2), flat: 0.6 });
          b.add(geo.box(0.9, 0.7, 0.05), { color: P.orange, pos: p(-0.8, -1.3), rot: wrot, flat: 0.6 });
          const bal = b.add(geo.box(1.7, 0.85, 0.05), { color: PAPER, pos: p(0.45, 0.05), rot: wrot, flat: 1 });
          b.label({ text: 'DESCRIBE THE PAGE', size: 0.15, maxWidth: 1.4, align: 'center', pos: p(0.45, 0.48, 0.11), rot: wrot, ink: P.ink, plate: PAPER, id: bal, flat: 1, pad: 0.05 });
        } else if (k === 1) {
          // Sound going out: three arcs.
          for (let i = 0; i < 3; i++) {
            b.add(geo.torus(0.35 + i * 0.3, 0.05, 14, 4, Math.PI * 0.6), { color: P.violet, pos: p(0.9, 0), rot: yawed([Math.PI / 2, -Math.PI * 0.3, 0], -Math.PI / 2), flat: 1 });
          }
          const bal = b.add(geo.box(1.3, 0.6, 0.05), { color: PAPER, pos: p(-0.5, 0.4), rot: wrot, flat: 1 });
          b.label({ text: 'OUT LOUD', size: 0.17, pos: p(-0.5, 0.7, 0.11), rot: wrot, ink: P.ink, plate: PAPER, id: bal, flat: 1, pad: 0.05 });
        } else if (k === 2) {
          // The title.
          const t = b.add(geo.box(2.2, 1.3, 0.05), { color: PAPER, pos: p(0, -0.65), rot: wrot, flat: 1 });
          b.label({ text: 'HON', size: 0.75, pos: p(0, 0.05, 0.11), rot: wrot, ink: P.ink, plate: PAPER, id: t, flat: 1, pad: 0.05 });
        } else if (k === 3) {
          // A city, drawn: three blocks and a sun.
          b.add(geo.box(0.6, 1.2, 0.05), { color: P.brick, pos: p(-0.8, -1.2), rot: wrot, flat: 0.7 });
          b.add(geo.box(0.7, 1.7, 0.05), { color: P.brickDeep, pos: p(0, -1.2), rot: wrot, flat: 0.7 });
          b.add(geo.box(0.6, 0.9, 0.05), { color: P.marbleShade, pos: p(0.8, -1.2), rot: wrot, flat: 0.7 });
          b.add(geo.cylinder(0.3, 0.3, 0.05, 14), { color: YELLOW, pos: p(0.7, 0.6), rot: yawed([Math.PI / 2, 0, 0], -Math.PI / 2), flat: 1 });
        } else if (k === 4) {
          // A pencil drawing it.
          b.add(geo.box(0.22, 1.8, 0.05), { color: YELLOW, pos: p(0, -0.9), rot: yawed([0, 0, 0.6], -Math.PI / 2), flat: 0.7 });
          b.add(geo.box(1.6, 0.06, 0.05), { color: P.ink, pos: p(0.1, -0.85), rot: wrot, flat: 1 });
        } else {
          const bal = b.add(geo.box(2.2, 0.95, 0.05), { color: PAPER, pos: p(0, -0.45), rot: wrot, flat: 1 });
          b.label({ text: 'AND IT GETS DRAWN', size: 0.17, maxWidth: 2.0, align: 'center', pos: p(0, 0.02, 0.11), rot: wrot, ink: P.ink, plate: PAPER, id: bal, flat: 1, pad: 0.05 });
        }
      }
    }
    // The microphone, on a stand, turned to the wall.
    const MX = EX - 3.2;
    const MZ = 0.6;
    b.add(geo.cylinder(0.32, 0.36, FLUSH + 0.01, 10), { color: IRON, pos: [MX, 0, MZ] });
    b.add(geo.cylinder(0.035, 0.035, 1.55, 6), { color: P.steel, pos: [MX, 0.06, MZ] });
    strut([MX, 1.6, MZ], [MX + 0.45, 1.75, MZ], 0.03, P.steel, 5);
    b.add(geo.capsule(0.09, 0.2, 8, 3), { color: IRON, pos: [MX + 0.5, 1.62, MZ], rot: [0, 0, -1.2] });
    b.add(geo.sphere(0.12, 8, 6), { color: P.steel, pos: [MX + 0.66, 1.8, MZ] });
    // The marker sits over the gutter between two panels, to the north of the microphone.
    pois.push({ entry: 'hon', x: MX + 0.2, z: MZ - 2.1, y: 2.4, reach: 4.2, prompt: 'Speak into the microphone' });
  }

  // ------------------------------------------------------------------------------------------
  // The tree in its planter, at the yard's west side.
  // ------------------------------------------------------------------------------------------
  {
    const TX = -14.2;
    const TZ = -8.6;
    b.add(geo.box(3.0, 0.7, 3.0), { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, pos: [TX, 0, TZ] });
    b.add(geo.box(3.3, 0.14, 3.3), { color: P.marble, pos: [TX, 0.7, TZ] });
    b.add(geo.box(2.6, 0.06, 2.6), { color: P.grassDeep, pos: [TX, 0.8, TZ], flat: 0.4 });
    tree(TX, TZ, 8.5, LEAVES[0], 0.8, false);
    for (let i = 0; i < 3; i++) clump([TX - 0.9 + i * 0.9, 1.05, TZ + (i % 2 ? 0.8 : -0.8)], [0.4, 0.3, 0.4], LEAVES[(i + 3) % 5], undefined, 3);
    cast(geo.sphere(1, 6, 4), [TX, 5.9, TZ], undefined, [3.0, 2.4, 2.9]);
    colliders.push({ kind: 'box', x: TX, z: TZ, hw: 1.6, hd: 1.6 });
    // A marble bench beside it.
    const bx = TX + 0.4;
    const bz = TZ + 3.1;
    b.add(geo.bevelBox(0.4, 0.42, 0.5, 0.04), { color: P.marbleShade, pos: [bx - 0.9, 0, bz] });
    b.add(geo.bevelBox(0.4, 0.42, 0.5, 0.04), { color: P.marbleShade, pos: [bx + 0.9, 0, bz] });
    b.add(geo.bevelBox(2.4, 0.14, 0.62, 0.04), { color: P.marble, pos: [bx, 0.42, bz] });
    colliders.push({ kind: 'box', x: bx, z: bz, hw: 1.2, hd: 0.32 });
  }

  // Street trees on the south edge, where the yard meets the green.
  {
    const spots: [number, number, number][] = [[-7, 19, 7.0], [5, 21, 7.6], [14, 17, 6.8], [-15, 14, 6.4]];
    const n = low ? 2 : spots.length;
    for (let i = 0; i < n; i++) {
      const [x, z, h] = spots[i];
      tree(x, z, h, LEAVES[(i + 1) % 5]);
      colliders.push({ kind: 'circle', x, z, r: 0.45 });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The memory cloud: small discs hanging in a cloud over a drum of marble on a lawn.
  // ------------------------------------------------------------------------------------------
  const MEM_X = -3.5;
  const MEM_Z = 10.5;
  const MEM_Y = 3.0;
  if (has('memory-visualizer')) {
    const lawn = geo.extrude(bloomOutline(91, 3.6, 28), 0.06, { cacheKey: 'studio-lawn' });
    b.add(lawn, { color: P.grass, pos: [MEM_X, FLUSH - 0.03, MEM_Z], rot: [-Math.PI / 2, 0, 0], flat: 0.4 });
    const drum = geo.prism(12, 0.62, 0.68, 1.1);
    const d = b.add(drum, { color: P.marble, pos: [MEM_X, 0.06, MEM_Z] });
    b.add(geo.cylinder(0.8, 0.8, 0.14, 12), { color: P.marbleShade, pos: [MEM_X, 1.16, MEM_Z] });
    clump([MEM_X + 0.5, 0.2, MEM_Z + 0.4], [0.4, 0.3, 0.35], P.moss as string, undefined, 3, 0);
    const lr = face(MEM_X, MEM_Z, 0, 0);
    const LF = frame(MEM_X, MEM_Z, lr);
    b.label({ text: 'MEMORY', size: 0.13, pos: LF(0, 0.82, 0.67), rot: [0, lr, 0], ink: P.ink, plate: P.marble, id: d, pad: 0.05 });
    b.label({ text: 'VISUALIZER', size: 0.11, pos: LF(0, 0.55, 0.67), rot: [0, lr, 0], ink: P.ink, plate: P.marble, id: d, pad: 0.05 });
    // The cloud.
    const disc = geo.cylinder(0.13, 0.13, 0.04, 12);
    const tints = [PAPER, PINK, BLUE, YELLOW, P.glass, P.lavender];
    const count = low ? 18 : high ? 44 : 30;
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1;
      const a = rng() * 6.283;
      const rr = Math.cbrt(rng()) * 1.15;
      const s = Math.sqrt(1 - u * u);
      const x = MEM_X + Math.cos(a) * s * rr;
      const y = MEM_Y + u * rr * 0.7;
      const z = MEM_Z + Math.sin(a) * s * rr;
      b.add(disc, { color: tints[i % tints.length], pos: [x, y, z], rot: [rng() * 3, rng() * 3, rng() * 3], flat: 0.5, scale: 0.8 + rng() * 0.6 });
    }
    colliders.push({ kind: 'circle', x: MEM_X, z: MEM_Z, r: 0.9 });
    pois.push({ entry: 'memory-visualizer', x: MEM_X + Math.sin(lr) * 2.4, z: MEM_Z + Math.cos(lr) * 2.4, y: 4.6, reach: 4.5, prompt: 'Watch the photographs' });
  }

  // ------------------------------------------------------------------------------------------
  // The broken colonnade south of the east wing, ivy on it, and the card standing in front.
  // ------------------------------------------------------------------------------------------
  {
    const CX = 15.6;
    const zs = low ? [9.5, 13.5] : [9, 12.4, 15.8];
    const colId = b.newId();
    const SH = 5.6;
    for (const z of zs) {
      b.add(geo.bevelBox(1.3, 0.45, 1.3, 0.06), { color: P.marbleShade, pos: [CX, 0, z] });
      const shaft = geo.prism(12, 0.4, 0.48, SH);
      b.add(shaft, { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [CX, 0.45, z], id: colId });
      cast(shaft, [CX, 0.45, z]);
      b.add(geo.cylinder(0.62, 0.46, 0.3, 12), { color: P.marble, pos: [CX, 0.45 + SH, z] });
      b.add(geo.bevelBox(1.35, 0.22, 1.35, 0.04), { color: P.marbleShade, pos: [CX, 0.75 + SH, z] });
      clump([CX - 0.5, 0.45, z + 0.3], [0.45, 0.35, 0.5], P.moss as string, undefined, 3, 0);
      colliders.push({ kind: 'circle', x: CX, z, r: 0.7 });
    }
    // The architrave runs from the wing's corner and stops short in the air.
    const z0 = ES - 0.2;
    const z1 = zs[zs.length - 1] + 0.7;
    const arch = b.add(geo.box(1.3, 0.9, z1 - z0), { color: P.marble, pos: [CX, 0.97 + SH, (z0 + z1) / 2] });
    b.add(geo.box(1.6, 0.25, z1 - z0 + 0.3), { color: P.marbleShade, pos: [CX, 1.87 + SH, (z0 + z1) / 2] });
    void arch;
    // A fallen drum at its foot.
    if (!low) {
      b.add(geo.prism(12, 0.46, 0.46, 1.3), { color: P.marble, pos: [CX - 1.6, 0.46, zs[zs.length - 1] + 1.6], rot: [0, 0.4, Math.PI / 2] });
      colliders.push({ kind: 'circle', x: CX - 2.1, z: zs[zs.length - 1] + 1.6, r: 0.7 });
    }
    // Ivy hanging off it.
    for (let i = 0; i < (low ? 3 : 6); i++) {
      const z = z0 + 0.8 + i * ((z1 - z0 - 1.6) / 5);
      const len = 0.8 + (i % 3) * 0.7;
      clump([CX - 0.7, SH + 1.1 - len * 0.4, z], [0.45, len * 0.6, 0.6], LEAVES[(i + 1) % 5], undefined, 3, 0.15);
      if (i % 2 === 0) clump([CX + 0.7, SH + 1.2 - len * 0.3, z + 0.4], [0.45, len * 0.5, 0.55], LEAVES[(i + 2) % 5], undefined, 3, 0.15);
    }
    clump([CX, SH + 2.2, z0 + 1.6], [1.0, 0.45, 1.6], LEAVES[2]);
  }

  if (has('collectible-card')) {
    const CX = 7.5;
    const CZ = 12.5;
    const yc = face(CX, CZ, -6, 4);
    const C = frame(CX, CZ, yc);
    const rc: V3 = [0, yc, 0];
    const W = 2.0;
    const H = 3.0;
    const k = 0.18;
    const outline: P2[] = [[-W / 2 + k, 0], [W / 2 - k, 0], [W / 2, k], [W / 2, H - k], [W / 2 - k, H], [-W / 2 + k, H], [-W / 2, H - k], [-W / 2, k]];
    const hole: P2[] = [];
    const HN = 28;
    for (let i = 0; i < HN; i++) {
      const t = -(i / HN) * Math.PI * 2;
      hole.push([Math.cos(t) * 0.62, 1.75 + Math.sin(t) * 0.82]);
    }
    const cardG = geo.extrude(outline, 0.16, { holes: [hole], cacheKey: 'studio-card' });
    // A plinth, the card standing in a slot.
    b.add(geo.bevelBox(2.6, 0.32, 0.9, 0.05), { color: P.marbleShade, pos: C(0, 0, 0), rot: rc });
    b.add(cardG, { gradient: { bottom: mix(BLUE, P.shadow, 0.1), top: BLUE }, color: BLUE, pos: C(0, 0.32, 0), rot: rc, flat: 0.25 });
    cast(cardG, C(0, 0.32, 0), rc);
    // Pink border bands, front and back, and the lettering.
    for (const side of [1, -1]) {
      const r2: V3 = [0, yc + (side < 0 ? Math.PI : 0), 0];
      const top = b.add(geo.box(1.7, 0.42, 0.03), { color: PINK, pos: C(0, 0.32 + 2.42, side * 0.09), rot: r2, flat: 0.6 });
      b.label({ text: 'MY CARD', size: 0.2, pos: C(0, 0.32 + 2.63, side * 0.105), rot: r2, ink: P.ink, plate: PINK, id: top, flat: 0.6, pad: 0.05 });
      const bot = b.add(geo.box(1.7, 0.42, 0.03), { color: PINK, pos: C(0, 0.32 + 0.16, side * 0.09), rot: r2, flat: 0.6 });
      b.label({ text: 'NO. 001', size: 0.17, pos: C(0, 0.32 + 0.37, side * 0.105), rot: r2, ink: P.ink, plate: PINK, id: bot, flat: 0.6, pad: 0.05 });
    }
    // A brass ring round the portal.
    const ringRot = yawed([Math.PI / 2, 0, 0], yc);
    b.add(geo.torus(1, 0.06, 28, 5), { color: P.brass, pos: C(0, 0.32 + 1.75, 0.09), rot: ringRot, scale: [0.64, 1, 0.84] });
    b.add(geo.torus(1, 0.06, 28, 5), { color: P.brass, pos: C(0, 0.32 + 1.75, -0.09), rot: ringRot, scale: [0.64, 1, 0.84] });
    // In the portal: a screen of pink light with splats of colour hanging in it at different depths.
    b.add(geo.disc(1, 24), { color: mix(PINK, P.lavender, 0.5), pos: C(0, 0.32 + 1.75, 0), rot: yawed([Math.PI / 2, 0, 0], yc), scale: [0.62, 1, 0.82], dither: 0.5, flat: 1 });
    const sp = geo.sphere(0.07, 6, 4);
    const tints = [YELLOW, PAPER, BLUE, P.mint, PINK];
    for (let i = 0; i < (low ? 6 : 12); i++) {
      const a = rng() * 6.283;
      const r = Math.sqrt(rng()) * 0.5;
      b.add(sp, { color: tints[i % 5], pos: C(Math.cos(a) * r, 0.32 + 1.75 + Math.sin(a) * r * 1.3, (rng() - 0.5) * 0.5), flat: 0.8, scale: 0.7 + rng() * 0.9 });
    }
    colliders.push({ kind: 'box', x: CX, z: CZ, hw: 1.35, hd: 0.5, rot: yc });
    const pp = C(0, 0, 2.2);
    pois.push({ entry: 'collectible-card', x: pp[0], z: pp[2], y: 3.9, reach: 4.2, prompt: 'Look into the card' });
  }

  // ------------------------------------------------------------------------------------------
  // The spyglass on its tripod, on a step of marble, aimed back down the road at the Commons.
  // ------------------------------------------------------------------------------------------
  if (has('talentsniper')) {
    const SX = -10.5;
    const SZ = -1.5;
    const g = { x: -0.911, z: 0.413 };
    const ys = Math.atan2(g.x, g.z);
    b.add(geo.cylinder(1.3, 1.35, FLUSH, 16), { color: P.marbleShade, pos: [SX, 0, SZ], flat: 0.3 });
    const head: V3 = [SX, 1.35, SZ];
    for (let i = 0; i < 3; i++) {
      const a = ys + Math.PI / 3 + (i * Math.PI * 2) / 3;
      strut([SX + Math.sin(a) * 0.75, 0.06, SZ + Math.cos(a) * 0.75], head, 0.04, WOOD_DEEP, 5);
    }
    b.add(geo.cylinder(0.11, 0.11, 0.16, 8), { color: P.brass, pos: [SX, 1.3, SZ] });
    // The tube, pitched up a little, eye end toward the yard.
    const pitch = 0.08;
    const rot = yawed([Math.PI / 2 - pitch, 0, 0], ys);
    const S = frame(SX, SZ, ys);
    const back = S(0, 1.5, -0.75);
    back[1] = 1.5 - Math.sin(pitch) * 0.75;
    b.add(geo.cylinder(0.15, 0.09, 1.4, 10), { color: P.brass, pos: back, rot, flat: 0.15 });
    const mid = S(0, 1.5, -0.05);
    mid[1] = 1.5 - Math.sin(pitch) * 0.05;
    b.add(geo.cylinder(0.12, 0.12, 0.7, 10), { color: mix(P.brass, P.ink, 0.15), pos: mid, rot });
    for (const d of [-0.62, 0.62]) {
      const p = S(0, 1.5, d);
      p[1] = 1.5 + Math.sin(pitch) * d;
      b.add(geo.torus(0.165, 0.035, 12, 4), { color: P.brass, pos: p, rot });
    }
    // The plaque on a short post, facing the yard.
    const pr = face(SX, SZ, 0, 0);
    const PF = frame(SX, SZ, pr);
    const post = PF(0.9, 0, 0.9);
    b.add(geo.box(0.12, 1.0, 0.12), { color: IRON, pos: post, rot: [0, pr, 0] });
    const plate = b.add(geo.box(1.25, 0.4, 0.05), { color: P.brass, pos: PF(0.9, 0.95, 0.9), rot: [-0.35, pr, 0], flat: 0.3 });
    b.label({ text: 'TALENTSNIPER', size: 0.12, pos: PF(0.9, 1.16, 0.92), rot: yawed([-0.35, 0, 0], pr), ink: P.ink, plate: P.brass, id: plate, flat: 0.3, pad: 0.05, lift: 0.04 });
    colliders.push({ kind: 'circle', x: SX, z: SZ, r: 0.65 });
    const pp = PF(0, 0, 2.0);
    pois.push({ entry: 'talentsniper', x: pp[0], z: pp[2], y: 2.6, reach: 4.2, prompt: 'Look through the spyglass' });
  }

  // ------------------------------------------------------------------------------------------
  // Hush. A small shrine behind the broken colonnade, looking back at the yard between two of its
  // columns. A black stone figure with its eyes closed and one finger up, in a little bone temple.
  // On the altar in front of it, one thing under a cloth. I say nothing more about it here.
  // ------------------------------------------------------------------------------------------
  const HUSH_X = 21.2;
  const HUSH_Z = low ? 11.5 : 10.7;
  const HUSH_YAW = -Math.PI / 2;
  const HUSH_U = 1.25; // half the width of the figure, metres
  const HUSH_TOP = 1.0; // top of its plinth
  const HUSH_MID = HUSH_TOP + 0.84 * HUSH_U - 0.02; // height of the mark's origin
  if (has('hush')) {
    const H = frame(HUSH_X, HUSH_Z, HUSH_YAW);
    const rH: V3 = [0, HUSH_YAW, 0];
    const U = HUSH_U;

    // Paving he stands on, flush with the yard.
    b.add(geo.box(5.6, FLUSH - 0.003, 5.0), { color: HUSH_STONE, pos: H(0, 0, 1.15), rot: rH, flat: 0.4 });
    b.add(geo.box(5.1, FLUSH, 4.5), { color: HUSH_BONE, pos: H(0, 0, 1.15), rot: rH, flat: 0.4 });

    // The floor of the little temple, one step up, and the back wall.
    const STEP = 0.2;
    const floor = b.add(geo.box(4.6, STEP, 2.1), { color: HUSH_BONE, pos: H(0, 0, -0.05), rot: rH });
    b.label({ text: 'SHH.', size: 0.055, pos: H(1.62, 0.1, 1.0), rot: rH, ink: HUSH_ASH, plate: HUSH_BONE, id: floor, pad: 0.1, jitter: 0.2, lift: 0.006 });
    const WALL_H = 3.4;
    b.add(geo.box(4.3, WALL_H - STEP, 0.3), { gradient: { bottom: mix(HUSH_STONE, HUSH_ASH, 0.25), top: HUSH_STONE }, color: HUSH_STONE, pos: H(0, STEP, -0.9), rot: rH, hatch: 0.06 });

    // Two short columns in front, two flat ones against the wall behind.
    const shaft = geo.prism(10, 0.17, 0.2, 2.84);
    for (const s of [-1, 1]) {
      b.add(geo.bevelBox(0.52, 0.12, 0.52, 0.03), { color: HUSH_STONE, pos: H(s * 1.95, STEP, 0.65), rot: rH });
      b.add(shaft, { gradient: { bottom: HUSH_STONE, top: HUSH_BONE }, color: HUSH_BONE, pos: H(s * 1.95, STEP + 0.12, 0.65), rot: rH });
      b.add(geo.cylinder(0.27, 0.18, 0.13, 10), { color: HUSH_BONE, pos: H(s * 1.95, STEP + 2.96, 0.65) });
      b.add(geo.bevelBox(0.56, 0.11, 0.56, 0.03), { color: HUSH_STONE, pos: H(s * 1.95, STEP + 3.09, 0.65), rot: rH });
      b.add(geo.box(0.34, WALL_H - STEP, 0.4), { color: HUSH_BONE, pos: H(s * 1.98, STEP, -0.85), rot: rH });
    }
    // Beam, cornice and the little pediment, with one bone star in dark stone.
    b.add(geo.box(4.5, 0.3, 2.05), { color: HUSH_BONE, pos: H(0, WALL_H, -0.05), rot: rH });
    b.add(geo.box(4.8, 0.1, 2.3), { color: HUSH_STONE, pos: H(0, WALL_H + 0.3, -0.05), rot: rH });
    const PED = WALL_H + 0.4;
    b.add(geo.extrude([[-2.4, 0], [2.4, 0], [0, 0.85]], 2.3, { cacheKey: 'studio-hush-ped' }), { color: HUSH_BONE, pos: H(0, PED, -0.05), rot: rH });
    b.add(geo.extrude([[-1.75, 0], [1.75, 0], [0, 0.6]], 0.06, { cacheKey: 'studio-hush-tymp' }), { color: HUSH_GRAPHITE, pos: H(0, PED + 0.09, 1.1), rot: rH, hatch: 0.1 });
    b.add(geo.extrude(hushStar(0.1, 0.12, 4), 0.04, { cacheKey: 'studio-hush-star-s' }), { color: HUSH_BONE, pos: H(0, PED + 0.3, 1.14), rot: rH, flat: 0.6 });
    cast(geo.box(4.6, PED + 0.4, 2.1), H(0, 0, -0.05), rH);

    // The plinth, two tiers of bone marble, with the name cut in it.
    b.add(geo.box(2.7, 0.25, 1.45), { color: HUSH_STONE, pos: H(0, STEP, -0.02), rot: rH });
    const plinth = b.add(geo.box(2.3, HUSH_TOP - STEP - 0.25, 1.25), { color: HUSH_BONE, pos: H(0, STEP + 0.25, -0.02), rot: rH });
    const PF = 0.605; // front face of the upper tier
    {
      const name = 'H U S H   L A B S';
      const line = 'Q U I E T E R   T O O L S ,   B R I G H T E R   P E O P L E';
      b.label({ text: name, size: fit(name, 0.15, 1.75), pos: H(0, 0.8, PF), rot: rH, ink: HUSH_NIGHT, plate: HUSH_BONE, id: plinth, pad: 0.1, jitter: 0.12, lift: 0.008 });
      b.label({ text: line, size: fit(line, 0.05, 2.0), pos: H(0, 0.58, PF), rot: rH, ink: HUSH_ASH, plate: HUSH_BONE, id: plinth, pad: 0.1, jitter: 0.12, lift: 0.008 });
    }

    // The figure. One thick rounded stone, lobed like a small cloud.
    const BZ = -0.08;
    const body = hushBody(low ? 56 : 96, low ? [0.45, 0.8, 0.96] : [0.3, 0.55, 0.75, 0.9, 0.975], low ? [-0.6] : [-0.8, -0.45], U, 0.42, 0.3);
    b.add(body.geometry, { gradient: { bottom: mix(HUSH_NIGHT, HUSH_GRAPHITE, 0.4), top: mix(HUSH_GRAPHITE, HUSH_ASH, 0.2) }, color: HUSH_GRAPHITE, pos: H(0, HUSH_MID, BZ), rot: rH, hatch: 0.2 });
    // Two closed eyes, bone, set into the face.
    const EYE_Y = -0.045;
    for (const ex of [-0.328, 0.234]) {
      const eye = geo.extrude(hushEye(0.16 * U, 0.075 * U, 0.033 * U, low ? 6 : 10), 0.08);
      const p = eye.getAttribute('position');
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + body.zAt(ex * U + p.getX(i), EYE_Y * U + p.getY(i)));
      b.add(eye, { color: HUSH_BONE, pos: H(ex * U, HUSH_MID + EYE_Y * U, BZ), rot: rH, flat: 0.7 });
    }
    // The hand: the same stone, standing proud of the face, and the one bone line that draws it.
    // From the side it is a fist low down with one finger leaning in toward where the mouth would be.
    const HAND_Z = BZ + 0.42 + 0.13;
    {
      const lean = (y: number): number => {
        const yn = y / U;
        if (yn <= -0.56) return 0.1;
        if (yn <= -0.5) return 0.1 - ((yn + 0.56) / 0.06) * 0.07;
        return 0.03 - Math.min(1, (yn + 0.5) / 0.29) * 0.08;
      };
      const shape: P2[] = HUSH_HAND.map((p) => [p[0] * U, p[1] * U] as P2).reverse();
      const hand = geo.extrude(shape, 0.36);
      const hp = hand.getAttribute('position');
      for (let i = 0; i < hp.count; i++) if (hp.getZ(i) > 0) hp.setZ(i, hp.getZ(i) + lean(hp.getY(i)));
      hand.computeVertexNormals();
      b.add(hand, { color: HUSH_GRAPHITE, pos: H(0, HUSH_MID, HAND_Z - 0.18), rot: rH, hatch: 0.08 });
      const at = (x: number, y: number): [number, number, number] => [x * U, y * U, lean(y * U)];
      const line = HUSH_HAND.map((p) => at(p[0], p[1]));
      const stroke = b.newId();
      const radial = low ? 3 : 5;
      b.add(geo.tube(line, 0.028, { radial, perSpan: 2, cacheKey: `studio-hush-line-${radial}` }), { color: HUSH_BONE, pos: H(0, HUSH_MID, HAND_Z), rot: rH, flat: 0.7, id: stroke });
      b.add(geo.tube([at(0.01, -0.64), at(0.06, -0.632), at(0.11, -0.645)], 0.024, { radial, perSpan: 2, cacheKey: `studio-hush-fold-${radial}` }), { color: HUSH_BONE, pos: H(0, HUSH_MID, HAND_Z), rot: rH, flat: 0.7, id: stroke });
    }

    // The altar: a dark slab on a bone block, close enough to touch.
    const AZ = 1.5;
    const AT = 0.5;
    b.add(geo.box(1.5, AT - 0.08, 0.56), { color: HUSH_BONE, pos: H(0, 0, AZ), rot: rH });
    b.add(geo.bevelBox(1.76, 0.08, 0.74, 0.02), { color: HUSH_GRAPHITE, pos: H(0, AT - 0.08, AZ), rot: rH, hatch: 0.1 });
    cast(geo.box(1.76, AT, 0.74), H(0, 0, AZ), rH);
    // One thing under a cloth.
    b.add(hushCloth(low ? 8 : 12, low ? 6 : 10, 0.37 + 0.06), { gradient: { bottom: HUSH_STONE, top: HUSH_BONE }, color: HUSH_BONE, pos: H(-0.06, AT, AZ - 0.06), rot: rH, flat: 0.15 });
    // What people leave: three candles nobody has lit, a few small stars, a folded note.
    const wax: [number, number, number][] = [[-0.7, -0.12, 0.2], [-0.58, 0.1, 0.13], [0.7, -0.15, 0.17]];
    for (const [x, z, h] of wax) {
      b.add(geo.cylinder(0.065, 0.055, 0.016, 8), { color: HUSH_STONE, pos: H(x, AT, AZ + z) });
      b.add(geo.cylinder(0.03, 0.034, h, 8), { color: HUSH_BONE, pos: H(x, AT + 0.016, AZ + z) });
      b.add(geo.cylinder(0.009, 0.009, 0.03, 4), { color: HUSH_INK, pos: H(x, AT + 0.016 + h, AZ + z), outline: false });
    }
    const tiny = geo.extrude(hushStar(0.045, 0.055, 3), 0.02, { cacheKey: 'studio-hush-star-t' });
    const left: [number, number, number][] = low ? [[0.46, 0.2, 0.4]] : [[0.46, 0.2, 0.4], [0.54, -0.02, -0.7], [-0.62, 0.27, 1.2]];
    for (const [x, z, turn] of left) b.add(tiny, { color: HUSH_BONE, pos: H(x, AT + 0.012, AZ + z), rot: yawed([-Math.PI / 2, 0, turn], HUSH_YAW), flat: 0.5 });
    if (!low) {
      const note = b.newId();
      b.add(geo.box(0.13, 0.012, 0.09), { color: HUSH_STONE, pos: H(0.72, AT, AZ + 0.2), rot: yawed([0, 0.5, 0], HUSH_YAW), id: note });
      b.add(geo.box(0.13, 0.012, 0.09), { color: HUSH_BONE, pos: H(0.72, AT + 0.02, AZ + 0.2), rot: yawed([0.3, 0.5, 0], HUSH_YAW), id: note });
    }

    // Green taking it, a little.
    clump(H(-2.0, PED + 0.25, 0.75), [0.6, 0.4, 0.55], LEAVES[2], undefined, 4, 0.08);
    clump(H(-2.2, PED - 0.35, 0.95), [0.3, 0.6, 0.3], LEAVES[4], undefined, 3, 0.15);
    clump(H(2.15, 0.3, -0.55), [0.5, 0.4, 0.5], P.moss as string, undefined, 3, 0);
    if (!low) {
      clump(H(-1.2, PED + 0.55, -0.6), [0.9, 0.35, 0.6], LEAVES[0], undefined, 4, 0.08);
      clump(H(-2.25, 0.25, 0.3), [0.4, 0.3, 0.45], P.moss as string, undefined, 3, 0);
      clump(H(1.3, STEP + 0.08, 0.72), [0.26, 0.14, 0.22], P.moss as string, undefined, 3, 0);
    }

    // Ivy up the back of it, where nobody looks.
    for (let i = 0; i < (low ? 3 : 6); i++) {
      const t = i / 5;
      clump(H(1.5 - t * 1.6 + (i % 2) * 0.5, 0.5 + t * 2.4, -1.12), [0.2, 0.55, 0.7 - t * 0.25], LEAVES[i % 2 === 0 ? 2 : 4], undefined, 3, 0.04);
    }

    // Solid: the temple with everything in it, and the altar on its own so he can stand beside it.
    const tc = H(0, 0, -0.05);
    colliders.push({ kind: 'box', x: tc[0], z: tc[2], hw: 1.1, hd: 2.35 });
    const ac = H(0, 0, AZ);
    colliders.push({ kind: 'box', x: ac[0], z: ac[2], hw: 0.4, hd: 0.9 });
    // The marker hangs to the left of the altar, clear of the face.
    const pp = H(-1.85, 0, 2.25);
    pois.push({ entry: 'hush', x: pp[0], z: pp[2], y: 2.0, reach: 4.2, prompt: 'Say less' });
  }

  // A patch of herringbone brick paving at the bay door, and lawn beside the road in.
  {
    b.add(geo.box(6.6, FLUSH, 2.6), { color: mix(P.brick, P.pave, 0.35), pos: [-8, 0, NF + 1.4], flat: 0.3 });
    for (let i = 0; i < 5; i++) b.add(geo.box(0.05, FLUSH + 0.005, 2.5), { color: mix(P.brickDeep, P.pave, 0.3), pos: [-10.6 + i * 1.3, 0, NF + 1.4], flat: 0.3, outline: false });
    const lawn2 = geo.extrude(bloomOutline(97, 3.2, 24), 0.06, { cacheKey: 'studio-lawn2' });
    b.add(lawn2, { color: P.grassLight, pos: [6, FLUSH - 0.03, 4.5], rot: [-Math.PI / 2, 0, 0], scale: [1.3, 0.8, 1], flat: 0.4 });
    for (let i = 0; i < (low ? 2 : 4); i++) clump([4.2 + i * 1.2, 0.35, 4.8 + (i % 2 ? 0.6 : -0.5)], [0.55, 0.4, 0.5], LEAVES[(i + 2) % 5], undefined, 3);
  }

  // Two marble piers with lamps where the road comes onto the yard, and a flower bed to the south.
  {
    const gx = -0.911;
    const gz = 0.413;
    for (const side of [-1, 1]) {
      const x = arrive.x + gx * 8.6 + side * 5.2 * 0.413;
      const z = arrive.z + gz * 8.6 - side * 5.2 * 0.911;
      const gy = Math.min(0, ctx.groundAt(x, z));
      const pier = geo.bevelBox(0.8, 2.2 - gy, 0.8, 0.05);
      b.add(pier, { color: P.marble, pos: [x, gy, z] });
      cast(pier, [x, 0, z]);
      b.add(geo.bevelBox(1.0, 0.2, 1.0, 0.04), { color: P.marbleShade, pos: [x, 2.2, z] });
      b.add(geo.cylinder(0.06, 0.08, 1.2, 6), { color: IRON, pos: [x, 2.4, z] });
      b.add(geo.sphere(0.32, 10, 7), { color: LIT, pos: [x, 3.85, z], flat: 0.8 });
      b.add(geo.cylinder(0.2, 0.2, 0.08, 8), { color: IRON, pos: [x, 4.15, z] });
      clump([x, ctx.groundAt(x, z) + 0.25, z], [0.75, 0.4, 0.75], LEAVES[(side + 2) % 5], undefined, 3, 0.05);
      colliders.push({ kind: 'circle', x, z, r: 0.6 });
    }
    const fx0 = -4.5;
    const fx1 = 2.5;
    const fz = 16.5;
    b.add(geo.box(fx1 - fx0, 0.3, 1.4), { color: P.marbleShade, pos: [(fx0 + fx1) / 2, 0, fz] });
    b.add(geo.box(fx1 - fx0 - 0.2, 0.06, 1.2), { color: P.grassDeep, pos: [(fx0 + fx1) / 2, 0.3, fz], flat: 0.4 });
    const fl = geo.sphere(0.13, 6, 4);
    const fc = [PINK, YELLOW, BLUE, PAPER];
    for (let i = 0; i < (low ? 4 : 7); i++) {
      const x = fx0 + 0.6 + i * ((fx1 - fx0 - 1.2) / 6);
      clump([x, 0.55, fz + (i % 2 ? 0.25 : -0.25)], [0.45, 0.35, 0.4], LEAVES[(i + 1) % 5], undefined, 3);
      for (let j = 0; j < 3; j++) b.add(fl, { color: fc[(i + j) % 4], pos: [x + (j - 1) * 0.22, 0.85 + (j % 2) * 0.1, fz + (j - 1) * 0.15], flat: 0.7, sway: 0.2 });
    }
    colliders.push({ kind: 'box', x: (fx0 + fx1) / 2, z: fz, hw: (fx1 - fx0) / 2, hd: 0.7 });
  }

  group.add(b.build('studio-static'));

  // ------------------------------------------------------------------------------------------
  // What moves. The photographs circle the disc cloud; the loose bits of bloom drift over the easel.
  // ------------------------------------------------------------------------------------------
  let cards: THREE.Mesh | null = null;
  if (has('memory-visualizer')) {
    const cb = kit.builder();
    const n = low ? 4 : 6;
    const R = 2.0;
    const skies = [BLUE, PINK, YELLOW, P.mint, P.lavender, P.glass];
    const grounds = [P.grass, P.brick, P.teal, P.grassDeep, P.sandDeep, P.marbleShade];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      const y = (i % 2 ? 0.25 : -0.2);
      const ry = Math.atan2(x, z);
      const F = frame(x, z, ry);
      cb.add(geo.box(0.8, 1.0, 0.05), { color: PAPER, pos: F(0, y - 0.5, 0), rot: [0, ry, 0], flat: 0.5 });
      cb.add(geo.plane(0.64, 0.42), { color: skies[i % 6], pos: F(0, y + 0.13, 0.03), rot: [0, ry, 0], flat: 0.8 });
      cb.add(geo.plane(0.64, 0.24), { color: grounds[i % 6], pos: F(0, y - 0.2, 0.03), rot: [0, ry, 0], flat: 0.8 });
      cb.add(geo.plane(0.8, 1.0), { color: mix(PAPER, P.shadow, 0.15), pos: F(0, y, -0.03), rot: [0, ry + Math.PI, 0], flat: 0.6 });
    }
    cards = cb.build('studio-cards');
    cards.position.set(MEM_X, MEM_Y, MEM_Z);
    group.add(cards);
  }

  const db = kit.builder();
  {
    const bits: { c: string; x: number; y: number; z: number; r: number; tilt: number }[] = [
      { c: PINK, x: -4.2, y: 17.2, z: 0.8, r: 0.9, tilt: 0.3 },
      { c: BLUE, x: 3.6, y: 18.4, z: 1.4, r: 0.75, tilt: -0.4 },
      { c: YELLOW, x: 0.6, y: 20.2, z: 2.2, r: 0.55, tilt: 0.6 },
      { c: PINK, x: -1.6, y: 23.4, z: 3.0, r: 0.5, tilt: -0.2 },
      { c: BLUE, x: 5.6, y: 22.0, z: 2.4, r: 0.4, tilt: 0.5 },
      { c: YELLOW, x: -5.8, y: 21.4, z: 1.8, r: 0.35, tilt: -0.5 },
    ];
    const m = low ? 4 : bits.length;
    for (let i = 0; i < m; i++) {
      const p = bits[i];
      const g = geo.extrude(bloomOutline(120 + i, p.r, 28), 0.08, { cacheKey: `studio-drift-${i}` });
      db.add(g, { color: p.c, pos: [p.x, p.y, p.z], rot: [p.tilt * 0.5, p.tilt, p.tilt * 0.3], flat: 0.7 });
    }
  }
  const drift = db.build('studio-drift');
  drift.position.set(EZ_X, 0, EZ_Z);
  drift.rotation.y = yE;
  group.add(drift);

  // The star by the Hush figure. The one thing at the shrine that moves, and the one bit of iris.
  let star: THREE.Mesh | null = null;
  const STAR_Y = HUSH_MID + 0.557 * HUSH_U;
  if (has('hush')) {
    const sb = kit.builder();
    sb.add(geo.extrude(hushStar(0.154 * HUSH_U, 0.184 * HUSH_U, low ? 4 : 6), 0.07, { cacheKey: `studio-hush-star-${low ? 4 : 6}` }), { color: HUSH_IRIS, flat: 1 });
    star = sb.build('studio-hush-star');
    const sp = frame(HUSH_X, HUSH_Z, HUSH_YAW)(1.033 * HUSH_U, STAR_Y, 0.15);
    star.position.set(sp[0], sp[1], sp[2]);
    star.rotation.y = HUSH_YAW;
    group.add(star);
  }

  return {
    group,
    colliders,
    pois,
    update(_dt, t) {
      if (star) {
        // It turns a little way and back, and breathes. Slowly.
        star.rotation.y = HUSH_YAW + Math.sin(t * 0.32) * 0.7;
        star.position.y = STAR_Y + Math.sin(t * 0.5) * 0.03;
        star.scale.setScalar(1 + Math.sin(t * 0.8) * 0.05);
      }
      if (cards) cards.rotation.y = t * 0.22;
      drift.position.y = Math.sin(t * 0.45) * 0.45;
      drift.rotation.y = yE + Math.sin(t * 0.2) * 0.05;
    },
  };
}
