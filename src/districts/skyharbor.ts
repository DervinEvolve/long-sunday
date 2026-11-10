// Sky Harbor. The last stop on the east side, where the platform keeps going after the island ends.
// A marble shelter with a copper roof and wisteria on it, one car standing at the platform edge, and
// the walkway running on through three lock gates, one per milestone, the third still shut and held
// by a balance: one whale in the high pan, eleven krill in the low one. Past the shut gate the
// platform is a pier on viaduct arches that leave the ground behind and stand on nothing. Off the
// end of it hangs the whale, with a garden on its back and krill going round it.
// To the right of the platform a brass horn listens upward at three wheels set with eyes, with a
// desk beside it. To the left a listening booth with a station clock that has three hands.
//
// Everything is laid out in a frame turned to face the street: +z is toward the road the visitor
// came in by, -z is out to open sky, +x is to his right as he walks in. One inner group carries the
// turn. Colliders and points of interest are turned back into district space at the end.
//
// The pier and the whale are past the site radius on purpose. Nothing a visitor can touch is.
// The walk ends at the third gate because the visitor walks on the ground, and the ground under
// the pier falls away nearly two metres before the rim. If the controller ever learns about decks,
// open that gate: the parapets are already there to be the rails.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, Poi } from '../types';

type V3 = [number, number, number];
type P2 = [number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const UP = new THREE.Vector3(0, 1, 0);
const TRUNK = '#7a5a86';
const LIT = '#fff3c4';

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

/** The kit turns parts in XYZ order. This gives the XYZ angles for "tilt about x, then turn about y". */
function yx(heading: number, tilt: number, roll = 0): V3 {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, heading, roll, 'YXZ'));
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x, e.y, e.z];
}

/** XYZ angles that tip the up axis toward the level direction (dx, dz) by `angle`. */
function leanTo(dx: number, dz: number, angle: number): V3 {
  const l = Math.hypot(dx, dz) || 1;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz / l, 0, -dx / l), angle);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

/** XYZ angles for a part whose own x, y and z axes should lie along the three given directions. */
function basis(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3): V3 {
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z), 'XYZ');
  return [e.x, e.y, e.z];
}

/** A round bar from a to b. */
function rod(a: V3, b: V3, ra: number, rb = ra, seg = 6): THREE.BufferGeometry {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length() || 1e-3;
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.multiplyScalar(1 / len)));
  g.translate(a[0], a[1], a[2]);
  return g;
}

/** A copy of a standing shape laid over so its up axis points along +z. */
function facing(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.clone();
  out.rotateX(Math.PI / 2);
  return out;
}

/** A flat shape given as (x, z) corners, standing `h` tall on y = 0. */
function slab(pts: P2[], h: number): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return geo.creased(g, 30);
}

/** A fluted shaft standing on y = 0: a star section with a face for every flute, so the ink finds the ridges. */
function flutedShaft(r0: number, r1: number, h: number, ribs: number, dent = 0.86): THREE.BufferGeometry {
  const p: number[] = [];
  const n: number[] = [];
  const m = ribs * 2;
  const at = (i: number, r: number): [number, number] => {
    const a = (i / m) * Math.PI * 2;
    const k = i & 1 ? r * dent : r;
    return [Math.sin(a) * k, Math.cos(a) * k];
  };
  for (let i = 0; i < m; i++) {
    const [ax, az] = at(i, r0), [bx, bz] = at(i + 1, r0);
    const [cx, cz] = at(i, r1), [dx, dz] = at(i + 1, r1);
    p.push(ax, 0, az, bx, 0, bz, dx, h, dz, ax, 0, az, dx, h, dz, cx, h, cz);
    let nx = -(bz - az), nz = bx - ax;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    for (let k = 0; k < 6; k++) n.push(nx, 0, nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}

// ---------------------------------------------------------------------------------------------
// The whale's body, as a row of cross sections from nose to tail. Nose at +z.
// ---------------------------------------------------------------------------------------------

/** One cross section: where it is, half its width, how far it rises and drops from its middle, and the middle's height. */
interface Ring { z: number; w: number; up: number; dn: number; y: number }

const WHALE: Ring[] = [
  { z: 15.0, w: 0.05, up: 0.05, dn: 0.05, y: -0.5 },
  { z: 14.3, w: 1.9, up: 1.35, dn: 1.8, y: -0.4 },
  { z: 12.3, w: 3.1, up: 2.35, dn: 3.0, y: -0.2 },
  { z: 8.5, w: 3.9, up: 3.05, dn: 3.7, y: 0 },
  { z: 4.0, w: 4.05, up: 3.3, dn: 3.8, y: 0.1 },
  { z: -0.5, w: 3.6, up: 3.1, dn: 3.3, y: 0.3 },
  { z: -5.0, w: 2.7, up: 2.5, dn: 2.45, y: 0.7 },
  { z: -8.6, w: 1.7, up: 1.7, dn: 1.6, y: 1.2 },
  { z: -11.2, w: 0.95, up: 1.05, dn: 1.0, y: 1.7 },
  { z: -13.0, w: 0.5, up: 0.7, dn: 0.7, y: 2.1 },
];

const cr = (p0: number, p1: number, p2: number, p3: number, f: number): number =>
  0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);

/** The section at `t`, counted in rings: 0 is the nose, WHALE.length - 1 the tail stock. */
function ringAt(t: number, out: Ring): Ring {
  const n = WHALE.length - 1;
  const c = Math.min(n, Math.max(0, t));
  const i = Math.min(n - 1, Math.floor(c));
  const f = c - i;
  const a = WHALE[Math.max(0, i - 1)], b = WHALE[i], d = WHALE[i + 1], e = WHALE[Math.min(n, i + 2)];
  out.z = cr(a.z, b.z, d.z, e.z, f);
  out.w = Math.max(0.02, cr(a.w, b.w, d.w, e.w, f));
  out.up = Math.max(0.02, cr(a.up, b.up, d.up, e.up, f));
  out.dn = Math.max(0.02, cr(a.dn, b.dn, d.dn, e.dn, f));
  out.y = cr(a.y, b.y, d.y, e.y, f);
  return out;
}

const ringScratch: Ring = { z: 0, w: 0, up: 0, dn: 0, y: 0 };

/** A point on the whale's skin. `a` is the angle round the body: 0 on the spine, pi under the belly. */
function skin(t: number, a: number, grow = 1): V3 {
  const r = ringAt(t, ringScratch);
  const c = Math.cos(a);
  return [Math.sin(a) * r.w * grow, r.y + c * (c > 0 ? r.up : r.dn) * grow, r.z];
}

/** A patch of skin between two sections and two angles. `grow` swells it off the body, by how far along it is. */
function skinPatch(t0: number, t1: number, nt: number, a0: number, a1: number, na: number, grow?: (k: number) => number): THREE.BufferGeometry {
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const cols = full ? na : na + 1;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nt; i++) {
    const k = i / nt;
    const g = grow ? grow(k) : 1;
    for (let j = 0; j < cols; j++) {
      const p = skin(t0 + (t1 - t0) * k, a0 + ((a1 - a0) * j) / na, g);
      pos.push(p[0], p[1], p[2]);
    }
  }
  for (let i = 0; i < nt; i++)
    for (let j = 0; j < na; j++) {
      const j1 = full ? (j + 1) % na : j + 1;
      const A = i * cols + j, B = i * cols + j1, C = (i + 1) * cols + j1, D = (i + 1) * cols + j;
      idx.push(A, B, C, A, C, D);
    }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/** A paddle: a row of stations along x, each a diamond of lead edge, trail edge, top and bottom. */
function paddle(stations: [number, number, number, number][]): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (const [x, lead, trail, thick] of stations) {
    if (thick < 1e-3) {
      pts.push(new THREE.Vector3(x, 0, (lead + trail) / 2));
      continue;
    }
    const mid = (lead + trail) / 2;
    pts.push(new THREE.Vector3(x, 0, lead), new THREE.Vector3(x, 0, trail), new THREE.Vector3(x, thick, mid), new THREE.Vector3(x, -thick, mid));
  }
  return geo.hull(pts, 20);
}

export const district: DistrictModule = {
  id: 'skyharbor',
  build(ctx) {
    return buildSkyHarbor(ctx);
  },
};

function buildSkyHarbor(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const VIOLET = site.accents[0];
  const CYAN = site.accents[1];
  const PINK = site.accents[2];
  const VIOLET_DEEP = mix(VIOLET, P.ink, 0.35);
  const VIOLET_PALE = mix(VIOLET, '#ffffff', 0.45);
  const BRASS = P.brass;
  const BRASS_DEEP = mix(BRASS, P.shadow, 0.42);
  const BRASS_LIGHT = mix(BRASS, '#ffffff', 0.4);
  const MARBLE_MID = mix(P.marble, P.marbleShade, 0.5);
  const IRON = mix(P.steel, P.ink, 0.5);
  const WOOD = P.sandDeep;
  const WOOD_DEEP = mix(P.sandDeep, P.shadow, 0.35);
  const PADC = mix(P.pave, VIOLET, 0.12);
  const SHADE = mix(PADC, P.shadow, 0.3);
  const DECK_C = mix(P.marble, P.pave, 0.2);
  const DECK_SHADE = mix(DECK_C, P.shadow, 0.28);
  const LAWN_SHADE = mix(P.grass, P.shadow, 0.32);
  const GROUND = 0.045; // the plaza is drawn a few centimetres proud of the pad: shadows and inlays go just above it
  const DECK = 0.09; // the top of the platform
  const LAWN = 0.1; // the top of a lawn bed
  const GREENS = [P.grass, P.leaf, P.grassDeep, P.moss] as const;

  // The frame. +z looks back down the street the visitor came up.
  const al = Math.hypot(site.arrive.x, site.arrive.z) || 1;
  const yaw = Math.atan2(site.arrive.x / al, site.arrive.z / al);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const toLocal = (fx: number, fz: number): { x: number; z: number } => ({ x: fx * cs + fz * sn, z: -fx * sn + fz * cs });
  const groundAt = (fx: number, fz: number): number => ctx.groundAt(fx * cs + fz * sn, -fx * sn + fz * cs);
  const s0 = ctx.sun ?? FALLBACK_SUN;
  const sun: V3 = [s0[0] * cs - s0[2] * sn, s0[1], s0[0] * sn + s0[2] * cs];

  const group = new THREE.Group();
  group.name = 'skyharbor';
  const inner = new THREE.Group();
  inner.rotation.y = yaw;
  group.add(inner);

  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const circle = (fx: number, fz: number, r: number): void => {
    const l = toLocal(fx, fz);
    colliders.push({ kind: 'circle', x: l.x, z: l.z, r });
  };
  const boxed = (fx: number, fz: number, hw: number, hd: number, rot = 0): void => {
    const l = toLocal(fx, fz);
    colliders.push({ kind: 'box', x: l.x, z: l.z, hw, hd, rot: rot + yaw });
  };
  const has = (id: string): boolean => entries.some((e) => e.id === id);
  const poi = (id: string, fx: number, fz: number, prompt: string, y = 2.4, reach = 4.5): void => {
    if (!has(id)) return;
    const l = toLocal(fx, fz);
    pois.push({ entry: id, x: l.x, z: l.z, y, reach, prompt });
  };

  const b = kit.builder();
  const cast = (g: THREE.BufferGeometry, pos: V3, y: number, rot?: V3, scale?: number | V3, color: string = SHADE): void => {
    b.shadow?.(g, { color, sun, pos, rot, scale, y, lift: 0.012 });
  };

  /** A spot with its own heading. `at` gives a point in the spot's own axes: +z is its front. */
  interface Spot { x: number; z: number; c: number; s: number; turn: number }
  const spot = (x: number, z: number, turn: number): Spot => ({ x, z, c: Math.cos(turn), s: Math.sin(turn), turn });
  const at = (f: Spot, x: number, y: number, z: number): V3 => [f.x + x * f.c + z * f.s, y, f.z - x * f.s + z * f.c];

  // ------------------------------------------------------------------------------------------
  // Planting helpers.
  // ------------------------------------------------------------------------------------------
  const shadowBall = geo.sphere(1, 6, 4);
  let treeSeed = 3;
  // A street tree like the ones along the avenue: a trunk and three faceted masses of leaf.
  const tree = (x: number, z: number, h: number, tint: ColorLike, shadowY = GROUND, shadowC: string = SHADE): void => {
    const y = groundAt(x, z);
    const s = h / 7;
    const f = spot(x, z, rng() * 6.28);
    b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, y, z], sway: 0.2, swayBase: y });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.4), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.45, swayBase: y };
    const id = b.newId();
    const d = low ? 0 : 1;
    b.add(geo.rock(treeSeed++, 1, d, 0.2), { ...leaf, id, pos: at(f, 0, y + 5.0 * s, 0), scale: [2.6 * s, 2.3 * s, 2.5 * s] });
    b.add(geo.rock(treeSeed++, 1, d, 0.2), { ...leaf, id, pos: at(f, -1.7 * s, y + 4.4 * s, -0.8 * s), scale: [1.6 * s, 1.5 * s, 1.5 * s] });
    b.add(geo.rock(treeSeed++, 1, d, 0.2), { ...leaf, pos: at(f, 1.7 * s, y + 4.0 * s, 0.8 * s), scale: [1.8 * s, 1.55 * s, 1.7 * s] });
    cast(shadowBall, [x, 5.0 * s, z], shadowY, undefined, [2.5 * s, 2.0 * s, 2.4 * s], shadowC);
    circle(x, z, 0.36 * s);
  };
  const flameSeg = high ? 9 : 7;
  const flame = geo.lathe([[0.3, 0], [0.82, 0.55], [1.05, 1.9], [0.9, 3.7], [0.5, 5.3], [0, 6.3]], flameSeg, { cacheKey: 'skyharbor-cypress-' + flameSeg });
  // A cypress: one dark flame of leaf on a short trunk.
  const cypress = (x: number, z: number, h: number): void => {
    const y = groundAt(x, z);
    const k = h / 7;
    b.add(geo.cylinder(0.14 * k, 0.2 * k, 1.0 * k, 6, true), { color: TRUNK, pos: [x, y, z] });
    b.add(flame, { gradient: { bottom: '#2a6149', top: P.leafDeep }, color: P.leafDeep, pos: [x, y + 0.7 * k, z], scale: k, sway: 0.3, swayBase: y });
    circle(x, z, 0.45 * k);
  };
  // A clump of leaf: a hedge, moss on a footing, or ivy when it is pressed flat against stone.
  let clumpSeed = 51;
  const clump = (pos: V3, scale: V3, tint: ColorLike, rot?: V3, count = 4, id?: number): void => {
    b.add(geo.blobs(clumpSeed++, count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos, rot, scale, sway: 0.1, id,
    });
  };
  // A strand of ivy hanging off an edge: a thin cone, point down.
  const drip = (x: number, y: number, z: number, len: number, r: number, tint: ColorLike = P.moss): void => {
    b.add(geo.cone(r, len, 5), { gradient: { bottom: mix(tint, P.shadow, 0.3), top: tint }, color: tint, pos: [x, y, z], scale: [1, -1, 1] });
  };
  // A lawn: a flat bed a few centimetres proud of the paving, with a kerb of darker green.
  const lawn = (pts: P2[], tint: ColorLike = P.grass): void => {
    b.add(slab(pts, LAWN), { color: tint, flat: 0.35 });
  };

  // ------------------------------------------------------------------------------------------
  // Stone helpers.
  // ------------------------------------------------------------------------------------------
  const ribs = low ? 6 : high ? 10 : 8;
  const COL_TOP = 3.75; // top of the capital slab, above the deck
  const shaft = flutedShaft(0.3, 0.26, COL_TOP - 0.95, ribs);
  const shaftShadow = geo.cylinder(0.28, 0.28, COL_TOP, 6);
  const column = (x: number, z: number): void => {
    b.add(geo.bevelBox(0.9, 0.3, 0.9, 0.04), { color: P.marbleShade, pos: [x, DECK, z] });
    b.add(geo.cylinder(0.37, 0.42, 0.15, 10), { color: MARBLE_MID, pos: [x, DECK + 0.3, z] });
    b.add(shaft, { gradient: { bottom: mix(P.marble, P.marbleShade, 0.45), top: P.marble }, color: P.marble, pos: [x, DECK + 0.45, z], flat: 0.25 });
    b.add(geo.cylinder(0.44, 0.28, 0.25, 10), { color: MARBLE_MID, pos: [x, COL_TOP - 0.5, z] });
    b.add(geo.box(0.86, 0.25, 0.86), { color: P.marble, pos: [x, COL_TOP - 0.25, z] });
    cast(shaftShadow, [x, 0, z], DECK, undefined, undefined, DECK_SHADE);
    circle(x, z, 0.52);
  };
  // A street lamp: iron post, one lit globe.
  const lamp = (x: number, y: number, z: number, h: number, glow: ColorLike = LIT): void => {
    b.add(geo.cylinder(0.14, 0.2, 0.45, 8), { color: IRON, pos: [x, y, z] });
    b.add(geo.cylinder(0.06, 0.085, h - 0.45, 6, true), { color: IRON, pos: [x, y + 0.45, z] });
    b.add(geo.cylinder(0.16, 0.1, 0.12, 8), { color: IRON, pos: [x, y + h - 0.02, z] });
    b.add(geo.sphere(0.3, 10, 7), { color: glow, pos: [x, y + h + 0.34, z], flat: 1 });
    b.add(geo.cone(0.12, 0.16, 6), { color: IRON, pos: [x, y + h + 0.62, z] });
  };

  // ------------------------------------------------------------------------------------------
  // The platform. A marble deck in slabs, each its own outline so the joints are drawn.
  // ------------------------------------------------------------------------------------------
  const WALK = 3.1; // half the width of the walkway between the lock walls
  const PLAT_X0 = -3.4; // platform edge, the track side
  const PLAT_X1 = 8.8; // back of the shelter
  const PLAT_Z0 = 10.8; // near end
  const LOCK_Z = -19.5; // first gate: from here on the walkway is walled
  const PAD_END = -28.5; // where the plaza stops and the pier takes over
  const PIER_END = -76;
  const PIER_X0 = -7.5, PIER_X1 = 3.5;
  {
    const n = 10;
    const step = (PLAT_Z0 - LOCK_Z) / n;
    for (let i = 0; i < n; i++) {
      const z0 = PLAT_Z0 - i * step;
      b.add(geo.box(PLAT_X1 - PLAT_X0, DECK, step), { color: DECK_C, pos: [(PLAT_X0 + PLAT_X1) / 2, 0, z0 - step / 2], flat: 0.2 });
    }
    for (let i = 0; i < 3; i++) {
      const z0 = LOCK_Z - i * 3;
      b.add(geo.box(WALK * 2, DECK, 3), { color: DECK_C, pos: [0, 0, z0 - 1.5], flat: 0.2 });
    }
    // The teal line of the road does not stop at the kerb: it crosses the plaza, runs down the
    // platform, under the gates and out along the pier to the very end.
    b.add(geo.box(0.26, 0.062, 22.6 - PLAT_Z0), { color: P.teal, pos: [0, 0, (22.6 + PLAT_Z0) / 2], flat: 0.6, outline: false });
    b.add(geo.box(0.26, 0.012, PLAT_Z0 - (PIER_END + 0.3)), { color: P.teal, pos: [0, DECK, (PLAT_Z0 + PIER_END + 0.3) / 2], flat: 0.6, outline: false });
    // The warning strip along the edge the train stands at.
    b.add(geo.box(0.5, 0.012, PLAT_Z0 + 15.5), { color: P.yellow, pos: [PLAT_X0 + 0.35, DECK, (PLAT_Z0 - 15.5) / 2], flat: 0.6 });
  }

  // ------------------------------------------------------------------------------------------
  // The track: ballast, sleepers, two rails. It starts at a buffer on the plaza and runs the
  // whole length of the pier, then lifts off the end.
  // ------------------------------------------------------------------------------------------
  const TRACK_X = -5.3;
  const TRACK_Z0 = 3.0;
  const BAL = 0.12; // top of the ballast
  {
    const len = TRACK_Z0 - PIER_END;
    b.add(geo.box(3.6, BAL, len), { color: mix(P.asphalt, PADC, 0.45), pos: [TRACK_X, 0, TRACK_Z0 - len / 2], flat: 0.2, hatch: 0.12 });
    const gap = low ? 2.5 : 1.25;
    const tie = geo.box(2.5, 0.08, 0.3);
    const tieC = mix(TRUNK, P.ink, 0.2);
    const ties = b.newId();
    for (let z = TRACK_Z0 - 0.5; z > PIER_END + 0.3; z -= gap) b.add(tie, { color: tieC, pos: [TRACK_X, BAL, z], id: ties, flat: 0.3 });
    const railLen = TRACK_Z0 - 0.2 - (PIER_END + 1.5);
    for (const s of [-1, 1]) {
      const x = TRACK_X + s * 0.75;
      b.add(geo.box(0.12, 0.14, railLen), { color: P.steel, pos: [x, BAL + 0.08, TRACK_Z0 - 0.2 - railLen / 2], flat: 0.3 });
      // Off the end the rails keep going, up.
      b.add(geo.tube([[x, BAL + 0.15, PIER_END + 1.6], [x, BAL + 0.21, PIER_END - 0.6], [x, 0.8, PIER_END - 2.8], [x, 1.9, PIER_END - 4.6], [x, 3.5, PIER_END - 6.0]], 0.085, { radial: 4, perSpan: 3 }), { color: P.steel, flat: 0.3 });
    }
    // Three sleepers that went with them.
    const lift: [number, number, number][] = [[PIER_END - 1.6, 0.42, 0.18], [PIER_END - 3.6, 1.2, 0.5], [PIER_END - 5.2, 2.5, 0.85]];
    for (const [z, y, tilt] of lift) b.add(tie, { color: tieC, pos: [TRACK_X, y - 0.16, z], rot: [tilt, 0, 0], flat: 0.3 });

    // The buffer at the plaza end.
    const bz = TRACK_Z0 + 0.35;
    for (const s of [-1, 1]) {
      b.add(geo.box(0.24, 1.05, 0.24), { color: IRON, pos: [TRACK_X + s * 0.75, 0, bz] });
      b.add(rod([TRACK_X + s * 0.75, 0.95, bz], [TRACK_X + s * 0.75, 0.1, bz + 1.1], 0.07, 0.07, 5), { color: IRON });
    }
    b.add(geo.bevelBox(2.3, 0.34, 0.32, 0.05), { color: PINK, pos: [TRACK_X, 0.66, bz - 0.2], flat: 0.4 });
    boxed(TRACK_X, bz + 0.3, 1.25, 0.75);
  }

  // ------------------------------------------------------------------------------------------
  // The car. One, standing at the platform with its doors to the walkway.
  // ------------------------------------------------------------------------------------------
  {
    const CAR = '#e9e6f2';
    const z0 = -1.5, len = 14;
    const zc = z0 - len / 2;
    const under = mix(IRON, P.ink, 0.3);
    for (const dz of [-4.2, 4.2]) b.add(geo.bevelBox(2.3, 0.56, 2.7, 0.08), { color: under, pos: [TRACK_X, 0.3, zc + dz] });
    b.add(geo.box(2.6, 0.22, len - 0.8), { color: under, pos: [TRACK_X, 0.74, zc] });
    const bodyG = geo.bevelBox(2.9, 2.62, len, 0.16);
    const body = b.add(bodyG, { gradient: { bottom: mix(CAR, P.marbleShade, 0.5), top: CAR }, color: CAR, pos: [TRACK_X, 0.94, zc], flat: 0.15 });
    b.add(geo.bevelBox(2.55, 0.3, len - 0.7, 0.1), { color: mix(P.steel, P.shadow, 0.25), pos: [TRACK_X, 3.5, zc] });
    cast(geo.box(2.9, 3.6, len), [TRACK_X, 0, zc], BAL + 0.005);
    for (const s of [-1, 1]) {
      const x = TRACK_X + s * 1.462;
      // A belt of the district's violet under the windows.
      b.add(geo.box(0.02, 0.36, len - 0.34), { color: VIOLET, pos: [x, 1.36, zc], id: body, flat: 0.4 });
      // Door, three windows, door, three windows, door.
      for (let k = 0; k < 3; k++) {
        const dz = z0 - 1.3 - k * 5.7;
        b.add(geo.box(0.03, 2.04, 1.2), { color: VIOLET_DEEP, pos: [x, 1.04, dz], flat: 0.3 });
        b.add(geo.box(0.045, 0.8, 0.84), { color: P.glass, pos: [x, 2.0, dz], flat: 0.7, outline: false });
        if (k < 2) for (let w = 0; w < 3; w++) b.add(geo.box(0.03, 0.86, 1.08), { color: P.glass, pos: [x, 1.96, dz - 1.55 - w * 1.3], flat: 0.7 });
      }
    }
    // The end that looks back at the visitor: a windscreen, a roll sign, two lamps.
    for (const s of [-1, 1]) {
      const z = s > 0 ? z0 + 0.012 : z0 - len - 0.012;
      for (const k of [-1, 1]) b.add(geo.box(0.6, 0.9, 0.03), { color: P.glass, pos: [TRACK_X + k * 0.72, 1.95, z], flat: 0.7 });
      b.add(geo.box(0.7, 1.9, 0.03), { color: VIOLET_DEEP, pos: [TRACK_X, 0.98, z], flat: 0.3 });
      b.add(geo.box(0.44, 0.74, 0.03), { color: P.glass, pos: [TRACK_X, 2.03, z + s * 0.025], flat: 0.7, outline: false });
      for (const k of [-1, 1]) b.add(facing(geo.cylinder(0.13, 0.13, 0.06, 8)), { color: LIT, pos: [TRACK_X + k * 1.05, 1.36, s > 0 ? z : z - 0.06], flat: 1 });
    }
    const sign = b.add(geo.box(1.7, 0.36, 0.05), { color: VIOLET_DEEP, pos: [TRACK_X, 3.0, z0 + 0.012], flat: 0.5 });
    b.label({ text: 'LAST STOP', size: 0.19, pos: [TRACK_X, 3.18, z0 + 0.062], ink: P.bone, plate: VIOLET_DEEP, id: sign, flat: 0.5, pad: 0.2, jitter: 0.3 });
    b.add(geo.box(0.3, 0.2, 0.5), { color: under, pos: [TRACK_X, 0.74, z0 + 0.2] });
    // One collider for the whole track bed, buffer to pier, out to the platform edge: nobody steps
    // down among the sleepers or gets wedged between the car and the hedge.
    {
      const x0 = TRACK_X - 1.9, x1 = PLAT_X0 + 0.1;
      const zNear = TRACK_Z0, zFar = PAD_END - 2.2;
      boxed((x0 + x1) / 2, (zNear + zFar) / 2, (x1 - x0) / 2, (zNear - zFar) / 2);
    }
  }

  // A clipped hedge along the far side of the track, so the line past the car is closed off.
  {
    const z0 = -3.5, z1 = PAD_END - 0.3;
    const len = z0 - z1;
    const hedge = b.newId();
    b.add(geo.bevelBox(1.0, 1.3, len, 0.22), { gradient: { bottom: mix(P.grassDeep, P.shadow, 0.35), top: P.grassDeep }, color: P.grassDeep, pos: [-7.9, 0, z0 - len / 2], id: hedge });
    for (let i = 0; i < 5; i++) clump([-7.9 + (rng() - 0.5) * 0.3, 1.25, z0 - 2 - i * (len - 4) / 4], [0.75, 0.5, 1.5], P.grassDeep, [0, rng() * 3, 0], 3, hedge);
    boxed(-7.9, z0 - len / 2, 0.55, len / 2);
  }

  // ------------------------------------------------------------------------------------------
  // The shelter: a little stoa with a copper roof, the station's name on its lintel.
  // ------------------------------------------------------------------------------------------
  const SX0 = 4.3, SX1 = 7.9; // the two rows of columns
  const SXC = (SX0 + SX1) / 2;
  const COL_Z = [8, 2, -4, -10];
  const ENT_TOP = COL_TOP + 0.95; // top of the entablature
  {
    for (const z of COL_Z) {
      column(SX0, z);
      column(SX1, z);
    }
    const zc = (COL_Z[0] + COL_Z[3]) / 2;
    const len = COL_Z[0] - COL_Z[3] + 1.6;
    const ent = b.newId();
    for (const x of [SX0, SX1]) b.add(geo.box(0.62, 0.95, len), { color: P.marble, pos: [x, DECK + COL_TOP, zc], id: ent });
    const lintelG = geo.box(5.4, 0.95, 0.62);
    b.add(lintelG, { color: P.marble, pos: [SXC, DECK + COL_TOP, COL_Z[0] + 0.9], id: ent });
    b.add(lintelG, { color: P.marble, pos: [SXC, DECK + COL_TOP, COL_Z[3] - 0.9], id: ent });
    b.add(geo.box(5.7, 0.12, len + 2.3), { color: P.marbleShade, pos: [SXC, DECK + ENT_TOP, zc] });
    b.label({ text: 'SKY HARBOR', size: 0.5, pos: [SXC, DECK + COL_TOP + 0.47, COL_Z[0] + 1.21], plate: P.marble, id: ent, pad: 0.2 });
    b.label({ text: 'SKY HARBOR', size: 0.5, pos: [SXC, DECK + COL_TOP + 0.47, COL_Z[3] - 1.21], rot: [0, Math.PI, 0], plate: P.marble, id: ent, pad: 0.2 });

    // The roof in copper sheets, each its own outline so the seams are drawn.
    const ROOF_Y = DECK + ENT_TOP + 0.12;
    const zf = COL_Z[0] + 0.95, zb = COL_Z[3] - 0.95;
    const sheets = 7;
    const sl = (zf - zb) / sheets;
    const sheet = geo.extrude([[-3.05, 0], [3.05, 0], [0, 1.4]], sl, { cacheKey: 'skyharbor-roof' });
    for (let i = 0; i < sheets; i++) {
      b.add(sheet, { gradient: { bottom: mix(P.verdigris, P.shadow, 0.18), top: mix(P.verdigris, '#ffffff', 0.15) }, color: P.verdigris, pos: [SXC, ROOF_Y, zf - (i + 0.5) * sl], flat: 0.1 });
    }
    b.add(geo.box(0.26, 0.14, zf - zb + 0.3), { color: mix(P.verdigris, P.shadow, 0.3), pos: [SXC, ROOF_Y + 1.36, (zf + zb) / 2] });
    // A pediment at each end: a raking cornice with the field set in front of it.
    const corn = geo.extrude([[-3.3, 0], [3.3, 0], [0, 1.56]], 0.34, { cacheKey: 'skyharbor-cornice' });
    const field = geo.extrude([[-2.75, 0.14], [2.75, 0.14], [0, 1.28]], 0.2, { cacheKey: 'skyharbor-tympanum' });
    for (const s of [1, -1]) {
      const z = s > 0 ? zf : zb;
      b.add(corn, { color: P.marbleShade, pos: [SXC, ROOF_Y, z + s * 0.17] });
      b.add(field, { color: P.marble, pos: [SXC, ROOF_Y, z + s * 0.4] });
      // One round window in the field, glazed in the sky's own cyan.
      b.add(facing(geo.cylinder(0.34, 0.34, 0.08, 14)), { color: CYAN, pos: [SXC, ROOF_Y + 0.56, s > 0 ? z + 0.46 : z - 0.54], flat: 0.8 });
    }
    cast(geo.box(6.1, 0.3, zf - zb), [SXC, ROOF_Y - 0.1, (zf + zb) / 2], DECK, undefined, undefined, DECK_SHADE);

    // Planters between the back columns, clipped box in each.
    for (let i = 0; i < 3; i++) {
      const z = (COL_Z[i] + COL_Z[i + 1]) / 2;
      b.add(geo.bevelBox(0.84, 0.62, 4.3, 0.05), { color: P.marble, pos: [SX1 + 0.42, DECK, z] });
      const hedge = b.newId();
      b.add(geo.bevelBox(0.7, 0.75, 4.1, 0.2), { gradient: { bottom: mix(P.grassDeep, P.shadow, 0.3), top: P.grass }, color: P.grassDeep, pos: [SX1 + 0.42, DECK + 0.6, z], id: hedge });
      if (!low) clump([SX1 + 0.42, DECK + 1.4, z + (rng() - 0.5) * 2], [0.55, 0.42, 1.1], P.grass, [0, rng() * 3, 0], 3, hedge);
      boxed(SX1 + 0.42, z, 0.5, 2.2);
    }

    // The bench, facing the walkway, and somebody's case left beside it.
    const BZ = -1, BX = 7.05;
    for (const dz of [-1.15, 1.15]) b.add(geo.box(0.5, 0.45, 0.09), { color: IRON, pos: [BX, DECK, BZ + dz] });
    const seat = b.newId();
    b.add(geo.box(0.5, 0.07, 2.7), { color: WOOD, pos: [BX, DECK + 0.45, BZ], id: seat });
    for (const dz of [-1.15, 1.15]) b.add(geo.box(0.07, 0.6, 0.09), { color: IRON, pos: [BX + 0.3, DECK + 0.45, BZ + dz] });
    for (let k = 0; k < 2; k++) b.add(geo.box(0.05, 0.16, 2.7), { color: WOOD, pos: [BX + 0.27, DECK + 0.68 + k * 0.22, BZ], id: seat });
    boxed(BX + 0.05, BZ, 0.38, 1.4);
    b.add(geo.bevelBox(0.26, 0.56, 0.8, 0.04), { color: PINK, pos: [BX - 0.05, DECK, BZ + 2.3], rot: [0, 0.25, 0], flat: 0.3 });
    b.add(geo.box(0.05, 0.08, 0.3), { color: IRON, pos: [BX - 0.05, DECK + 0.56, BZ + 2.3], rot: [0, 0.25, 0] });

    // Wisteria up the front column and along the eave over the walkway.
    b.add(geo.tube([[SX0 - 0.5, DECK, COL_Z[0] + 0.5], [SX0 - 0.38, 1.3, COL_Z[0] + 0.3], [SX0 - 0.45, 2.6, COL_Z[0] + 0.42], [SX0 - 0.6, 3.9, COL_Z[0] + 0.3], [SX0 - 0.9, ENT_TOP + 0.15, COL_Z[0] - 0.4], [SX0 - 1.0, ENT_TOP + 0.3, COL_Z[0] - 3]], 0.07, { radial: 5, perSpan: 3 }), { color: TRUNK });
    const vine = b.newId();
    const leafy = low ? 4 : 7;
    for (let i = 0; i < leafy; i++) {
      const z = COL_Z[0] + 0.6 - (i * (COL_Z[0] - COL_Z[3] + 1)) / (leafy - 1);
      clump([SX0 - 0.95 + (rng() - 0.5) * 0.3, DECK + ENT_TOP + 0.3 + rng() * 0.2, z], [0.8, 0.45, 1.5], i % 2 ? P.leaf : P.grassDeep, [0, rng() * 3, 0], 3, vine);
    }
    clump([SX0 - 0.5, DECK + ENT_TOP + 1.0, COL_Z[0] + 0.7], [0.9, 0.6, 0.8], P.leaf, undefined, 3, vine);
    const racemes = low ? 7 : 16;
    const bunch = geo.lathe([[0, 0], [0.5, 0.26], [1, 0.66], [0.72, 0.9], [0, 1]], 5, { crease: 80, cacheKey: 'skyharbor-raceme' });
    for (let i = 0; i < racemes; i++) {
      const z = COL_Z[0] + 0.9 - ((i + rng() * 0.6) * (COL_Z[0] - COL_Z[3] + 1.6)) / racemes;
      const len = 0.75 + rng() * 0.75;
      const x = SX0 - 1.0 + (rng() - 0.5) * 0.5;
      const top = DECK + ENT_TOP + 0.15;
      // A hanging bunch: one soft drop, full at the shoulder, pale at the tip.
      b.add(bunch, { gradient: { bottom: VIOLET_PALE, top: VIOLET }, color: VIOLET, pos: [x, top - len, z], rot: [0, rng() * 3, 0], scale: [0.2, len, 0.2], flat: 0.3 });
    }

    // The platform lamp, at the near corner of the shelter.
    lamp(2.7, DECK, PLAT_Z0 - 0.7, 3.9);
  }

  // ------------------------------------------------------------------------------------------
  // The lock. Three gates across the walkway, one per milestone. Two stand open and lit, the
  // third is shut and that is as far as anybody walks.
  // ------------------------------------------------------------------------------------------
  const GATE_Z = [LOCK_Z, -24.8, -30.1];
  let balance: THREE.Mesh | null = null;
  {
    const WALL_X = WALK + 0.2;
    const LEAF = mix(P.tealDeep, P.verdigris, 0.25);
    const wallG = (len: number) => geo.box(0.4, 1.05, len);
    const copeG = (len: number) => geo.box(0.54, 0.1, len);
    // Walls: the left one starts where the car ends, so the track behind it is fenced off too.
    const lz0 = -15.6, rz0 = LOCK_Z;
    const wallEnd = GATE_Z[2] - 0.5;
    const walls = b.newId();
    for (const [x, z0] of [[-WALL_X, lz0], [WALL_X, rz0]] as const) {
      const len = z0 - wallEnd;
      b.add(wallG(len), { gradient: { bottom: MARBLE_MID, top: P.marble }, color: P.marble, pos: [x, 0, z0 - len / 2], id: walls });
      b.add(copeG(len), { color: P.marbleShade, pos: [x, 1.05, z0 - len / 2] });
      // A little proud of the wall on the walkway side, to cover the open leaves folded back against it.
      boxed(x - Math.sign(x) * 0.1, z0 - len / 2, 0.4, len / 2);
    }
    const leafG = geo.box(2.74, 1.9, 0.2);
    const strapG = geo.box(2.78, 0.12, 0.26);
    const leaf = (cx: number, cz: number, turn: number): void => {
      const f = spot(cx, cz, turn);
      const id = b.add(leafG, { gradient: { bottom: mix(LEAF, P.shadow, 0.3), top: LEAF }, color: LEAF, pos: [cx, DECK + 0.04, cz], rot: [0, turn, 0] });
      for (const y of [0.35, 1.55]) b.add(strapG, { color: BRASS, pos: [cx, DECK + y, cz], rot: [0, turn, 0], flat: 0.3 });
      // Planks, drawn as three thin battens a side.
      for (const k of [-0.7, 0, 0.7]) for (const s of [-1, 1]) b.add(geo.box(0.05, 1.05, 0.02), { color: mix(LEAF, P.ink, 0.25), pos: at(f, k, DECK + 0.48, s * 0.105), rot: [0, turn, 0], id, flat: 0.4 });
    };
    const STEPS = ['STEP 1', 'STEP 2', 'STEP 3'];
    for (let g = 0; g < 3; g++) {
      const z = GATE_Z[g];
      const open = g < 2;
      const glow = open ? CYAN : PINK;
      for (const s of [-1, 1]) {
        const x = s * (WALK - 0.05);
        b.add(geo.box(0.9, 2.4, 0.9), { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, pos: [x, 0, z], hatch: 0.1 });
        b.add(geo.bevelBox(1.1, 0.2, 1.1, 0.04), { color: P.marble, pos: [x, 2.4, z] });
        b.add(geo.sphere(0.27, 10, 7), { color: glow, pos: [x, 2.84, z], flat: 1 });
        b.add(geo.cylinder(0.13, 0.17, 0.1, 8), { color: IRON, pos: [x, 2.6, z] });
        // A marble tablet on the face that looks back up the platform.
        const tab = b.add(geo.box(0.76, 0.5, 0.05), { color: P.marble, pos: [x, 1.45, z + 0.45], flat: 0.3 });
        b.label({ text: s < 0 ? STEPS[g] : open ? 'PAID' : 'HELD', size: 0.15, pos: [x, 1.7, z + 0.505], plate: P.marble, id: tab, flat: 0.3, pad: 0.15, ink: s > 0 && !open ? '#b23a5a' : P.ink });
        circle(x, z, 0.62);
        if (open) leaf(s * (WALK - 0.13), z - 0.45 - 1.37, Math.PI / 2);
      }
      if (!open) {
        // Mitred shut, the point toward whoever is walking up.
        leaf(-1.27, z + 0.45, -0.333);
        leaf(1.27, z + 0.45, Math.PI + 0.333);
        boxed(0, z + 0.45, WALK, 0.6);
        // What holds it: a balance on the mitre post. One whale in the high pan, eleven krill in the low one.
        // The beam and pans are a mesh of their own, built round the pivot, so the balance can rock.
        const pz = z + 0.93;
        const TOP = DECK + 3.75;
        b.add(geo.cylinder(0.07, 0.1, TOP - DECK, 6), { color: BRASS, pos: [0, DECK, pz], flat: 0.3 });
        b.add(geo.sphere(0.17, 8, 6), { color: BRASS_LIGHT, pos: [0, TOP, pz], flat: 0.4 });
        const sb = kit.builder();
        const ARM = 1.55, DIP = 0.34, HANG = 1.0;
        sb.add(rod([-ARM, DIP, 0], [ARM, -DIP, 0], 0.055, 0.055, 6), { color: BRASS, flat: 0.3 });
        const pan = geo.cylinder(0.56, 0.4, 0.09, 10);
        for (const s of [-1, 1]) {
          const ey = -s * DIP;
          const py = ey - HANG;
          const chains = sb.newId();
          for (const k of [-1, 1]) sb.add(rod([s * ARM, ey, 0], [s * ARM + k * 0.5, py + 0.08, 0], 0.028, 0.028, 4), { color: BRASS_DEEP, id: chains });
          sb.add(pan, { color: BRASS_LIGHT, pos: [s * ARM, py, 0], flat: 0.3 });
          if (s < 0) {
            // The whale: one smooth lump and its tail.
            const wid = sb.newId();
            sb.add(geo.sphere(1, 8, 6), { color: VIOLET, pos: [-ARM + 0.04, py + 0.3, 0], scale: [0.4, 0.23, 0.25], id: wid, flat: 0.2 });
            sb.add(geo.cone(0.16, 0.3, 4), { color: VIOLET, pos: [-ARM - 0.3, py + 0.3, 0], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.5], id: wid, flat: 0.2 });
          } else {
            // The krill: a heap of eleven.
            const ball = geo.ico(1, 0);
            for (let i = 0; i < 11; i++) {
              const ring = i < 7 ? 0 : i < 10 ? 1 : 2;
              const n = ring === 0 ? 7 : 3;
              const a = (i / n) * Math.PI * 2 + ring * 0.5;
              const r = ring === 0 ? 0.3 : ring === 1 ? 0.14 : 0;
              sb.add(ball, { color: i % 3 ? PINK : mix(PINK, '#ffffff', 0.3), pos: [ARM + Math.cos(a) * r, py + 0.17 + ring * 0.15, Math.sin(a) * r], scale: 0.105, flat: 0.4 });
            }
          }
        }
        balance = sb.build('skyharbor-balance');
        balance.position.set(0, TOP, pz);
        inner.add(balance);
        // A brass plate on the leaf, where the whale is in full view over it.
        const nx = Math.sin(0.333), nz = Math.cos(0.333);
        const plate = b.add(geo.box(2.3, 0.62, 0.03), { color: BRASS_LIGHT, pos: [1.27 + nx * 0.125, DECK + 0.56, z + 0.45 + nz * 0.125], rot: [0, 0.333, 0], flat: 0.5 });
        b.label({ text: 'ELEVEN KRILL\nOUTVOTE ONE WHALE', size: 0.115, pos: [1.27 + nx * 0.145, DECK + 0.88, z + 0.45 + nz * 0.145], rot: [0, 0.333, 0], plate: BRASS_LIGHT, id: plate, flat: 0.5, pad: 0.2, lineHeight: 1.75 });
      }
    }
    // The name of the lock, on a board over the first gate.
    {
      const z = GATE_Z[0];
      for (const s of [-1, 1]) b.add(geo.cylinder(0.06, 0.06, 1.0, 6, true), { color: IRON, pos: [s * (WALK - 0.05), 3.1, z] });
      const board = b.add(geo.bevelBox(5.6, 0.74, 0.14, 0.03), { color: VIOLET_DEEP, pos: [0, 3.5, z], flat: 0.4 });
      b.label({ text: 'MILESTONE LOCK', size: 0.34, pos: [0, 3.87, z + 0.071], ink: P.bone, plate: VIOLET_DEEP, id: board, flat: 0.4, pad: 0.2 });
      b.label({ text: 'MILESTONE LOCK', size: 0.34, pos: [0, 3.87, z - 0.071], rot: [0, Math.PI, 0], ink: P.bone, plate: VIOLET_DEEP, id: board, flat: 0.4, pad: 0.2 });
    }
    // Ivy over the right wall, and moss at the foot of the gateposts.
    const ivy = b.newId();
    clump([WALL_X + 0.1, 0.85, -22.3], [0.5, 0.6, 1.6], P.moss, [0, 0.2, 0], 4, ivy);
    clump([WALL_X + 0.25, 0.3, -23.2], [0.45, 0.45, 1.1], P.grassDeep, undefined, 3, ivy);
    clump([-WALL_X - 0.1, 0.9, -17.4], [0.45, 0.5, 1.2], P.moss, undefined, 3);
    clump([WALK + 0.55, 0.22, GATE_Z[0] + 0.5], [0.6, 0.3, 0.5], P.moss, undefined, 3);
    poi('krill', 0, -26.9, 'Watch the whale and the krill', 2.3);
  }

  // ------------------------------------------------------------------------------------------
  // The pier. A deck on a viaduct that starts in the ground and ends over nothing.
  // ------------------------------------------------------------------------------------------
  {
    const xc = (PIER_X0 + PIER_X1) / 2;
    const wide = PIER_X1 - PIER_X0;
    const len = PAD_END - PIER_END;
    const body = b.newId();
    b.add(geo.box(wide, 0.6, len), { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [xc, -0.6, PAD_END - len / 2], id: body });
    b.add(geo.box(wide + 0.3, 0.14, len + 0.15), { color: P.marbleShade, pos: [xc, -0.14, PAD_END - len / 2 - 0.08] });
    const n = 15;
    const step = len / n;
    for (let i = 0; i < n; i++) b.add(geo.box(wide, DECK, step), { color: DECK_C, pos: [xc, 0, PAD_END - (i + 0.5) * step], flat: 0.2 });

    // The arches. Buried to the crown on the island, clear of everything past the rim.
    const A0 = -31.5;
    const bays = 8;
    const pitch = (A0 - PIER_END) / bays;
    const RISE = 5.6, THICK = 0.6;
    const archG = geo.arch({ span: pitch - THICK * 2, rise: RISE, thick: THICK, depth: wide - 0.4, seg: high ? 12 : 8 });
    for (let i = 0; i < bays; i++) {
      b.add(archG, { gradient: { bottom: mix(P.marbleShade, P.shadow, 0.15), top: P.marble }, color: P.marble, pos: [xc, -0.6 - RISE - THICK, A0 - (i + 0.5) * pitch], rot: [0, Math.PI / 2, 0], id: body });
    }

    // Parapets with a post at every pier, lamps on some of them.
    const para = b.newId();
    const rz0 = GATE_Z[2] - 0.5, lz0 = PAD_END - 0.4;
    for (const [x, z0] of [[PIER_X1 - 0.2, rz0], [PIER_X0 + 0.2, lz0]] as const) {
      const l = z0 - PIER_END;
      b.add(geo.box(0.3, 1.0, l), { gradient: { bottom: MARBLE_MID, top: P.marble }, color: P.marble, pos: [x, 0, z0 - l / 2], id: para });
      b.add(geo.box(0.44, 0.1, l), { color: P.marbleShade, pos: [x, 1.0, z0 - l / 2] });
      for (let i = 0; i <= bays; i++) {
        const z = A0 - i * pitch;
        if (z > z0 - 0.3) continue;
        b.add(geo.box(0.5, 1.3, 0.5), { color: P.marble, pos: [x, 0, z + (i === bays ? 0.25 : 0)] });
        b.add(geo.bevelBox(0.64, 0.14, 0.64, 0.03), { color: P.marbleShade, pos: [x, 1.3, z + (i === bays ? 0.25 : 0)] });
      }
    }
    // The end wall closes the walkway. The track side is left open: the rails go on.
    b.add(geo.box(PIER_X1 - (TRACK_X + 1.8), 1.0, 0.3), { color: P.marble, pos: [(PIER_X1 + TRACK_X + 1.8) / 2, 0, PIER_END + 0.15], id: para });
    b.add(geo.box(PIER_X1 - (TRACK_X + 1.8) + 0.1, 0.1, 0.44), { color: P.marbleShade, pos: [(PIER_X1 + TRACK_X + 1.8) / 2, 1.0, PIER_END + 0.15] });
    for (const i of [1, 3, 5, 7]) lamp(PIER_X1 - 0.2, 1.44, A0 - i * pitch, 2.3);
    for (const i of [2, 4, 6]) lamp(PIER_X0 + 0.2, 1.44, A0 - i * pitch, 2.3);
    // The harbour light on the last post: a lantern in the district's cyan under a small roof.
    {
      const x = PIER_X1 - 0.2, z = PIER_END + 0.25;
      b.add(geo.cylinder(0.16, 0.22, 1.7, 8), { color: P.marble, pos: [x, 1.44, z] });
      b.add(geo.cylinder(0.46, 0.46, 0.1, 10), { color: IRON, pos: [x, 3.14, z] });
      b.add(geo.prism(8, 0.34, 0.34, 0.8), { color: CYAN, pos: [x, 3.24, z], flat: 1 });
      b.add(geo.cone(0.52, 0.6, 8), { color: VIOLET, pos: [x, 4.04, z], flat: 0.2 });
      b.add(geo.sphere(0.1, 6, 4), { color: BRASS_LIGHT, pos: [x, 4.7, z], flat: 0.5 });
    }
    // Mooring posts along the walkway, and a coil of rope by the last.
    for (const z of [-38, -50, -62, -73]) {
      b.add(geo.cylinder(0.2, 0.27, 0.55, 8), { color: VIOLET_DEEP, pos: [PIER_X1 - 1.1, DECK, z] });
      b.add(geo.cylinder(0.3, 0.3, 0.12, 8), { color: VIOLET_DEEP, pos: [PIER_X1 - 1.1, DECK + 0.55, z] });
    }
    for (let k = 0; k < 3; k++) b.add(geo.torus(0.42 - k * 0.04, 0.07, 10, 4), { color: WOOD, pos: [PIER_X1 - 2.0, DECK + 0.07 + k * 0.12, -73.6], flat: 0.3 });

    // Green on it: clumps over the parapets and long strands down the arches.
    const strands = low ? 10 : 24;
    for (let i = 0; i < strands; i++) {
      const side = i % 2 ? PIER_X1 + 0.12 : PIER_X0 - 0.12;
      const z = -40 - rng() * 35.5;
      const l = 1.2 + rng() * 3.6;
      drip(side, -0.05 - rng() * 0.3, z, l, 0.22 + rng() * 0.2, i % 3 ? P.moss : P.grassDeep);
      if (i % 3 === 0) clump([side + (i % 2 ? -0.2 : 0.2), 0.75, z], [0.5, 0.55, 1.2 + rng()], P.moss, [0, rng() * 3, 0], 3);
    }
    // And under the feet of the last arches, where the stone gives out.
    for (let i = bays - 2; i <= bays; i++) for (const s of [-1, 1]) {
      const z = A0 - i * pitch + (i === bays ? 0.4 : 0);
      drip(xc + s * (wide / 2 - 1.2 - rng() * 2), -0.6 - RISE - THICK + 0.1, z, 1.5 + rng() * 2.5, 0.35, P.moss);
    }

    // Nobody walks into the side of it from the grass.
    const stop = GATE_Z[2] - 0.6;
    boxed(xc, (stop - 58) / 2, wide / 2 + 0.3, (stop + 58) / 2);
  }

  // ------------------------------------------------------------------------------------------
  // Ophanim. A great brass horn on a seven sided plinth, listening upward at the wheels.
  // The wheels themselves are three meshes of their own, further down.
  // ------------------------------------------------------------------------------------------
  const GX = 17.5, GZ = -6; // the point on the ground the wheels hang over
  const WHEEL_Y = 13.4;
  {
    // The ground under them: a round of darker paving with the wheels inlaid in brass.
    b.add(geo.cylinder(8, 8, 0.07, high ? 36 : 24), { color: mix(PADC, VIOLET, 0.16), pos: [GX, 0, GZ], flat: 0.3 });
    for (const [r0, r1] of [[6.5, 6.78], [4.6, 4.84], [2.9, 3.1]] as const) {
      b.add(geo.ring(r0, r1, high ? 40 : 28), { color: BRASS, pos: [GX, 0.082, GZ], flat: 0.5, outline: false });
    }

    const LEAN = 0.5;
    const ldx = -0.49, ldz = 0.872; // the way the horn tips: toward the plaza
    const TX = GX - ldx * 5.1 * Math.sin(LEAN), TZ = GZ - ldz * 5.1 * Math.sin(LEAN); // the plinth
    const face = Math.atan2(ldx, ldz); // the plinth face that looks at the plaza
    const turn = face - Math.PI / 7;
    const plinthG = geo.prism(7, 2.3, 2.3, 1.3);
    b.add(geo.prism(7, 2.65, 2.65, 0.25), { color: P.marbleShade, pos: [TX, 0, TZ], rot: [0, turn, 0] });
    const plinth = b.add(plinthG, { gradient: { bottom: MARBLE_MID, top: P.marble }, color: P.marble, pos: [TX, 0.25, TZ], rot: [0, turn, 0] });
    b.add(geo.prism(7, 2.05, 2.45, 0.2), { color: P.marbleShade, pos: [TX, 1.55, TZ], rot: [0, turn, 0] });
    cast(plinthG, [TX, 0.25, TZ], 0.07, [0, turn, 0]);
    const apo = 2.3 * Math.cos(Math.PI / 7);
    b.label({ text: 'OPHANIM', size: 0.3, pos: [TX + Math.sin(face) * (apo + 0.005), 1.05, TZ + Math.cos(face) * (apo + 0.005)], rot: [0, face, 0], plate: MARBLE_MID, id: plinth, pad: 0.2 });
    b.label({ text: 'WHEELS WITHIN WHEELS', size: 0.095, pos: [TX + Math.sin(face) * (apo + 0.005), 0.58, TZ + Math.cos(face) * (apo + 0.005)], rot: [0, face, 0], plate: MARBLE_MID, id: plinth, pad: 0.2, ink: VIOLET_DEEP });

    // The horn. Outside and inside are two skins so the throat can be dark.
    const rot = leanTo(ldx, ldz, LEAN);
    const TY = 1.75;
    const seg = high ? 24 : low ? 12 : 16;
    const outer = geo.lathe([[0.3, 0], [0.4, 1.1], [0.66, 2.3], [1.2, 3.4], [2.05, 4.3], [3.2, 5.0], [3.36, 5.1]], seg, { cacheKey: 'skyharbor-horn-out-' + seg });
    const inside = geo.lathe([[3.36, 5.1], [3.18, 5.06], [2.0, 4.42], [1.14, 3.52], [0.6, 2.4], [0.33, 1.2], [0.2, 0.3], [0, 0.25]], seg, { cacheKey: 'skyharbor-horn-in-' + seg });
    b.add(outer, { gradient: { bottom: mix(BRASS, BRASS_DEEP, 0.5), top: BRASS_LIGHT }, color: BRASS, pos: [TX, TY, TZ], rot, flat: 0.35 });
    b.add(inside, { gradient: { bottom: mix(VIOLET_DEEP, P.ink, 0.3), top: mix(BRASS, VIOLET_DEEP, 0.3) }, color: BRASS_DEEP, pos: [TX, TY, TZ], rot, flat: 0.6, hatch: 0.2 });
    const ax: V3 = [Math.sin(LEAN) * ldx, Math.cos(LEAN), Math.sin(LEAN) * ldz];
    b.add(geo.torus(3.36, 0.14, seg + 4, 5), { color: BRASS_LIGHT, pos: [TX + ax[0] * 5.1, TY + ax[1] * 5.1, TZ + ax[2] * 5.1], rot, flat: 0.3 });
    for (const k of [1.4, 2.9]) b.add(geo.torus(k === 1.4 ? 0.5 : 0.98, 0.07, 14, 4), { color: BRASS_LIGHT, pos: [TX + ax[0] * k, TY + ax[1] * k, TZ + ax[2] * k], rot, flat: 0.3 });
    // The elbow it sits in, and a strut under its belly.
    b.add(geo.sphere(0.55, 10, 7), { color: BRASS, pos: [TX, TY - 0.05, TZ] });
    b.add(geo.cylinder(0.72, 0.85, 0.3, 10), { color: BRASS_DEEP, pos: [TX, 1.5, TZ] });
    b.add(rod([TX + ldx * 1.35, 1.7, TZ + ldz * 1.35], [TX + ax[0] * 3.1 + ldx * 0.75, TY + ax[1] * 3.1 - 0.7, TZ + ax[2] * 3.1 + ldz * 0.75], 0.11, 0.08, 6), { color: BRASS_DEEP });
    // Moss on the plinth and ivy up its shaded side.
    const moss = b.newId();
    clump([TX - ldx * 2.2, 0.35, TZ - ldz * 2.2], [1.2, 0.45, 1.0], P.moss, [0, 0.6, 0], 4, moss);
    clump([TX - ldx * 2.0 + 0.6, 1.1, TZ - ldz * 2.0 - 0.3], [0.9, 0.9, 0.5], P.grassDeep, [0, face + 0.5, 0], 4, moss);
    clump([TX + 2.3, 0.3, TZ + 0.6], [0.7, 0.35, 0.9], P.moss, undefined, 3);
    circle(TX, TZ, 2.75);
    poi('ophanim', TX + Math.sin(face) * 3.7, TZ + Math.cos(face) * 3.7, 'Listen at the horn', 2.6);
  }

  // ------------------------------------------------------------------------------------------
  // Ophanim Desktop. A desk on the round of paving, to one side so the plinth can be read from the
  // way in: a lamp, a microphone, one sealed machine.
  // ------------------------------------------------------------------------------------------
  {
    const D = spot(20.9, -1.0, -0.78);
    const rot: V3 = [0, D.turn, 0];
    b.add(geo.bevelBox(2.4, 0.09, 1.05, 0.03), { color: WOOD, pos: at(D, 0, 0.77, 0), rot, flat: 0.2 });
    for (const s of [-1, 1]) b.add(geo.box(0.6, 0.74, 0.92), { color: WOOD_DEEP, pos: at(D, s * 0.82, 0.03, 0), rot });
    const panel = b.add(geo.box(2.24, 0.68, 0.06), { color: WOOD, pos: at(D, 0, 0.09, 0.45), rot, flat: 0.2 });
    b.label({ text: 'OPHANIM DESKTOP', size: 0.14, pos: at(D, 0, 0.56, 0.485), rot, plate: WOOD, id: panel, flat: 0.2, pad: 0.15 });
    b.label({ text: 'NOTHING LEAVES THE MACHINE', size: 0.078, pos: at(D, 0, 0.3, 0.485), rot, plate: WOOD, id: panel, flat: 0.2, pad: 0.15, ink: VIOLET_DEEP });
    cast(geo.box(2.4, 0.86, 1.05), at(D, 0, 0, 0), 0.07, rot);
    // The lamp: a brass stem and a green trough of a shade with the light under it.
    b.add(geo.cylinder(0.14, 0.16, 0.04, 8), { color: BRASS, pos: at(D, -0.78, 0.86, -0.1), rot });
    b.add(geo.cylinder(0.028, 0.028, 0.44, 5, true), { color: BRASS, pos: at(D, -0.78, 0.9, -0.1), rot });
    b.add(geo.cylinder(0.12, 0.12, 0.56, 8), { color: P.verdigris, pos: at(D, -0.5, 1.4, -0.1), rot: yx(D.turn, 0, Math.PI / 2), flat: 0.3 });
    b.add(geo.box(0.5, 0.03, 0.16), { color: LIT, pos: at(D, -0.78, 1.25, -0.1), rot, flat: 1, outline: false });
    // The microphone, tipped toward the chair.
    b.add(geo.cylinder(0.11, 0.13, 0.035, 8), { color: IRON, pos: at(D, 0.1, 0.86, 0.05), rot });
    b.add(rod(at(D, 0.1, 0.89, 0.05), at(D, 0.1, 1.2, -0.08), 0.022, 0.022, 5), { color: IRON });
    b.add(geo.capsule(0.075, 0.25, 8, 3), { color: P.steel, pos: at(D, 0.1, 1.15, -0.06), rot: yx(D.turn, -0.5), flat: 0.3 });
    // The machine. No wires out.
    b.add(geo.bevelBox(0.52, 0.36, 0.42, 0.04), { color: '#e9e6f2', pos: at(D, 0.78, 0.86, 0), rot });
    b.add(geo.sphere(0.04, 6, 4), { color: CYAN, pos: at(D, 0.94, 1.08, 0.215), flat: 1 });
    b.add(geo.sphere(0.04, 6, 4), { color: CYAN, pos: at(D, 0.94, 1.08, -0.215), flat: 1 });
    // The chair, pushed back.
    b.add(geo.cylinder(0.05, 0.05, 0.44, 6, true), { color: IRON, pos: at(D, 0.05, 0.03, -1.15) });
    b.add(geo.cylinder(0.26, 0.3, 0.05, 8), { color: IRON, pos: at(D, 0.05, 0.03, -1.15) });
    b.add(geo.bevelBox(0.52, 0.1, 0.5, 0.03), { color: VIOLET, pos: at(D, 0.05, 0.46, -1.15), rot, flat: 0.3 });
    b.add(geo.bevelBox(0.5, 0.5, 0.08, 0.03), { color: VIOLET, pos: at(D, 0.05, 0.66, -1.42), rot, flat: 0.3 });
    boxed(D.x, D.z, 1.25, 0.6, D.turn);
    const ch = at(D, 0.05, 0, -1.2);
    circle(ch[0], ch[2], 0.4);
    const p = at(D, 0, 0, 1.9);
    poi('ophanim-desktop', p[0], p[2], 'Speak into the microphone', 2.2);
  }

  // ------------------------------------------------------------------------------------------
  // Empathy Archives. A listening booth: brick and marble, a history book on a lectern, a pair
  // of headphones, and on the roof a station clock with three hands and no hours.
  // ------------------------------------------------------------------------------------------
  const BOOTH = spot(-11.2, 2.4, 0.72);
  const DIAL_Y = 4.62;
  const DIAL_R = 0.95;
  {
    const B = BOOTH;
    const rot: V3 = [0, B.turn, 0];
    b.add(geo.bevelBox(3.1, 0.2, 3.1, 0.05), { color: P.marbleShade, pos: at(B, 0, 0, 0), rot });
    const post = geo.prism(8, 0.19, 0.22, 2.5);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(post, { color: P.marble, pos: at(B, sx * 1.22, 0.2, sz * 1.22), rot });
    const brick = { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, hatch: 0.1 };
    b.add(geo.box(2.3, 2.5, 0.26), { ...brick, pos: at(B, 0, 0.2, -1.22), rot });
    for (const s of [-1, 1]) {
      b.add(geo.box(0.26, 1.15, 2.3), { ...brick, pos: at(B, s * 1.22, 0.2, 0), rot });
      b.add(geo.box(0.36, 0.08, 2.24), { color: P.marble, pos: at(B, s * 1.22, 1.35, 0), rot });
    }
    const entG = geo.box(3.0, 0.52, 3.0);
    const ent = b.add(entG, { color: P.marble, pos: at(B, 0, 2.7, 0), rot });
    b.add(geo.bevelBox(3.3, 0.16, 3.3, 0.04), { color: P.marbleShade, pos: at(B, 0, 3.22, 0), rot });
    b.label({ text: 'EMPATHY ARCHIVES', size: 0.2, pos: at(B, 0, 2.96, 1.505), rot, plate: P.marble, id: ent, pad: 0.2 });
    cast(entG, at(B, 0, 2.7, 0), GROUND, rot);
    // The lectern and the book, open, tipped toward the reader.
    const tip = yx(B.turn, 0.42);
    b.add(geo.box(0.16, 1.0, 0.16), { color: BRASS_DEEP, pos: at(B, 0, 0.2, -0.3), rot });
    b.add(geo.box(0.5, 0.06, 0.5), { color: BRASS_DEEP, pos: at(B, 0, 0.2, -0.3), rot });
    b.add(geo.box(1.3, 0.06, 0.8), { color: BRASS, pos: at(B, 0, 1.2, -0.3), rot: tip });
    b.add(geo.box(1.16, 0.05, 0.72), { color: P.brickDeep, pos: at(B, 0, 1.262, -0.275), rot: tip });
    const pages = b.newId();
    for (const s of [-1, 1]) b.add(geo.bevelBox(0.54, 0.07, 0.66, 0.02), { color: P.bone, pos: at(B, s * 0.275, 1.305, -0.26), rot: tip, id: pages, flat: 0.3 });
    b.add(geo.box(0.035, 0.012, 0.7), { color: PINK, pos: at(B, 0.12, 1.385, -0.22), rot: tip, flat: 0.6, outline: false });
    // The headphones, hung on the back wall beside the book. Drawn a little over life size.
    {
      b.add(geo.torus(0.21, 0.035, 10, 4, Math.PI), { color: IRON, pos: at(B, 0.72, 1.78, -1.0), rot: yx(B.turn, -Math.PI / 2) });
      for (const s of [-1, 1]) b.add(facing(geo.cylinder(0.14, 0.14, 0.1, 8)), { color: VIOLET_DEEP, pos: at(B, 0.72 + s * 0.24, 1.74, -1.04), rot: yx(B.turn + s * Math.PI / 2, 0), flat: 0.3 });
      b.add(geo.box(0.06, 0.06, 0.12), { color: BRASS, pos: at(B, 0.72, 2.0, -1.06), rot });
    }
    // The clock. Brass rim, bone face, nine ticks over the top, the hands are their own mesh.
    b.add(geo.box(1.1, 0.26, 0.5), { color: P.marble, pos: at(B, 0, 3.38, 0), rot });
    b.add(facing(geo.cylinder(DIAL_R, DIAL_R, 0.3, high ? 24 : 16)), { color: BRASS, pos: at(B, 0, DIAL_Y, -0.15), rot, flat: 0.2 });
    const dial = b.add(facing(geo.cylinder(DIAL_R - 0.12, DIAL_R - 0.12, 0.04, high ? 24 : 16)), { color: P.bone, pos: at(B, 0, DIAL_Y, 0.14), rot, flat: 0.6 });
    b.label({ text: 'TONE', size: 0.13, pos: at(B, 0, DIAL_Y - 0.33, 0.185), rot, plate: P.bone, id: dial, flat: 0.6, pad: 0.1, ink: VIOLET_DEEP });
    for (let k = 0; k < 9; k++) {
      const a = (k - 4) * 0.32;
      const r = DIAL_R - 0.24;
      b.add(geo.box(0.035, 0.13, 0.02), { color: P.ink, pos: at(B, Math.sin(a) * r, DIAL_Y + Math.cos(a) * r - 0.065 * Math.cos(a), 0.18), rot: yx(B.turn, 0, -a), flat: 1, outline: false });
    }
    b.add(facing(geo.cylinder(0.09, 0.09, 0.1, 8)), { color: BRASS_DEEP, pos: at(B, 0, DIAL_Y, 0.17), rot });
    // Ivy over the back corner and moss at the foot.
    const ivy = b.newId();
    clump(at(B, -1.3, 2.5, -1.3), [0.75, 0.9, 0.75], P.grassDeep, undefined, 4, ivy);
    clump(at(B, -1.45, 1.3, -0.9), [0.4, 0.9, 0.7], P.moss, rot, 3, ivy);
    clump(at(B, -1.1, 3.4, -1.0), [0.8, 0.35, 0.9], P.moss, undefined, 3, ivy);
    clump(at(B, 1.7, 0.25, -1.2), [0.6, 0.3, 0.8], P.moss, undefined, 3);
    drip(...(at(B, -1.56, 2.3, -1.4) as V3), 1.2, 0.2, P.moss);
    boxed(B.x, B.z, 1.6, 1.6, B.turn);
    const p = at(B, 0, 0, 2.75);
    poi('empathy-archives', p[0], p[2], 'Pick up the headphones', 2.0);
  }

  // ------------------------------------------------------------------------------------------
  // Lawns and trees round the edge of the plaza. The way in and the view down the pier stay open.
  // ------------------------------------------------------------------------------------------
  lawn([[-16, 10], [-11.5, 16.5], [-10.5, 26.6], [-17, 24], [-23, 18.5], [-27.5, 10.5], [-29.2, 3], [-22, 3]]);
  lawn([[-9.2, -27.6], [-9.2, -5], [-15, -5], [-22, -2], [-28.8, -6], [-27, -12], [-23.5, -17.8], [-18, -23.3], [-13, -26.5]]);
  lawn([[6.5, -28.6], [6.5, -21.5], [11, -16.5], [20, -17], [25, -15.5], [22.5, -19.5], [18, -23.4], [12, -27]]);
  lawn([[11, 26.6], [12, 19], [17, 13.5], [22, 9.5], [28.5, 6.5], [27, 12.5], [23, 18.5], [17, 24]]);
  tree(-21, 11.5, 7.2, GREENS[0], LAWN, LAWN_SHADE);
  tree(-15.5, 20.5, 6.4, GREENS[2], LAWN, LAWN_SHADE);
  tree(-19.5, -11, 7.6, GREENS[1], LAWN, LAWN_SHADE);
  cypress(-13, -21.5, 6.2);
  cypress(-15.6, -19.4, 5.2);
  tree(14.5, -21.5, 6.6, GREENS[2], LAWN, LAWN_SHADE);
  cypress(20.2, -19, 5.6);
  tree(20.5, 14.5, 7.0, GREENS[0], LAWN, LAWN_SHADE);
  tree(14.6, 22, 6.2, GREENS[1], LAWN, LAWN_SHADE);
  // A fallen drum of column in the far lawn, half taken by moss.
  b.add(geo.prism(10, 0.55, 0.55, 1.5), { color: P.marble, pos: [9.4, 0.62, -22.6], rot: [Math.PI / 2, 0, 0.5] });
  clump([9.6, 0.5, -23.3], [0.8, 0.5, 0.7], P.moss, undefined, 3);
  circle(9.6, -23.2, 0.8);

  const base = b.build('skyharbor-static');
  inner.add(base);

  // ------------------------------------------------------------------------------------------
  // The whale. Its own mesh so it can drift. Nose at +z in its own space.
  // ------------------------------------------------------------------------------------------
  const WHALE_SCALE = 1.35;
  const wb = kit.builder();
  {
    const N = WHALE.length - 1;
    const nt = high ? 26 : low ? 14 : 20;
    const na = high ? 20 : low ? 12 : 16;
    const BACK = mix(VIOLET, P.ink, 0.1);
    const BELLY = '#efe9f7';
    const body = wb.add(skinPatch(0, N, nt, 0, Math.PI * 2, na), { gradient: { bottom: mix(VIOLET, '#ffffff', 0.3), top: BACK }, color: VIOLET, flat: 0.1 });
    wb.add(geo.sphere(1, 8, 6), { color: mix(VIOLET, '#ffffff', 0.12), pos: [0, WHALE[N].y, WHALE[N].z - 0.1], scale: [0.5, 0.72, 0.7], id: body, flat: 0.1 });
    // The throat: pale pleats from the chin back past the flippers, each its own outline.
    const pleats = 7;
    const half = 1.36;
    const swell = (k: number): number => 0.975 + 0.065 * Math.min(1, Math.sin(Math.PI * k) * 2.4);
    for (let i = 0; i < pleats; i++) {
      const a0 = Math.PI - half + (i * 2 * half) / pleats;
      wb.add(skinPatch(0.75, 5.7, high ? 18 : 12, a0, a0 + (2 * half) / pleats, 2, swell), { color: BELLY, flat: 0.15 });
    }
    // Eyes, small and far back, just over the corner of the mouth.
    for (const s of [-1, 1]) {
      const e = skin(2.15, s * 1.52);
      wb.add(geo.sphere(0.46, 8, 6), { color: '#f6f1fb', pos: [e[0] - s * 0.24, e[1], e[2]], flat: 0.6 });
      wb.add(geo.sphere(0.27, 8, 6), { color: P.ink, pos: [e[0] + s * 0.02, e[1] - 0.03, e[2] + 0.05], flat: 1 });
    }
    // Flippers, long, swept back and down.
    const flipper = paddle([[0, 1.15, -1.15, 0.34], [2.6, 1.3, -1.2, 0.3], [5.6, 0.95, -0.95, 0.2], [7.6, 0.4, -0.4, 0.1], [8.3, 0, 0, 0]]);
    const FLIP = mix(VIOLET, '#ffffff', 0.18);
    for (const s of [-1, 1]) {
      const r = skin(3.15, s * 2.1, 0.9);
      wb.add(flipper, { gradient: { bottom: mix(FLIP, '#ffffff', 0.3), top: FLIP }, color: FLIP, pos: r, rot: [0, s * 0.55, s * -0.6], scale: [s, 1, 1], flat: 0.1 });
    }
    flipper.dispose();
    // A low fin well back.
    const fin = geo.hull([new THREE.Vector3(0, -0.3, 1.2), new THREE.Vector3(0, -0.3, -1.0), new THREE.Vector3(0.22, -0.3, 0), new THREE.Vector3(-0.22, -0.3, 0), new THREE.Vector3(0, 1.25, -0.9)]);
    wb.add(fin, { color: BACK, pos: skin(6.6, 0), flat: 0.1 });
    fin.dispose();

    // The garden on its back: moss, three trees and a little round temple.
    const top = (z: number, x = 0): number => {
      // Height of the back over a point given by its z in whale space: walk the rings to find it.
      let t = 0;
      for (let i = 0; i < 200; i++) {
        t = (i / 200) * N;
        if (ringAt(t, ringScratch).z <= z) break;
      }
      const r = ringAt(t, ringScratch);
      const k = Math.min(0.98, Math.abs(x) / r.w);
      return r.y + r.up * Math.sqrt(1 - k * k);
    };
    const moss = wb.newId();
    const patch = (x: number, z: number, sx: number, sz: number, tint: ColorLike, seed: number): void => {
      wb.add(geo.blobs(seed, 4, 1, { squash: 0.8, detail: 0, size: [0.45, 0.7] }), {
        gradient: { bottom: mix(tint, P.shadow, 0.3), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos: [x, top(z, x) - 0.12, z], scale: [sx, 0.5, sz], id: moss,
      });
    };
    patch(0, 5.2, 2.5, 3.2, P.grass, 71);
    patch(0.3, 0.6, 2.3, 3.0, P.moss, 72);
    patch(-1.9, 3.0, 1.5, 2.4, P.grassDeep, 73);
    patch(1.9, 3.4, 1.4, 2.2, P.moss, 74);
    patch(0, -3.4, 1.5, 2.2, P.grass, 75);
    const wtree = (x: number, z: number, s: number, tint: ColorLike, seed: number): void => {
      const y = top(z, x);
      wb.add(geo.cylinder(0.11 * s, 0.16 * s, 1.7 * s, 5, true), { color: TRUNK, pos: [x, y - 0.1, z] });
      wb.add(geo.rock(seed, 1, low ? 0 : 1, 0.2), { gradient: { bottom: mix(tint, P.shadow, 0.4), top: mix(tint, '#ffffff', 0.12) }, color: tint, pos: [x, y + 2.3 * s, z], scale: [1.35 * s, 1.2 * s, 1.3 * s] });
    };
    wtree(1.0, 7.2, 1.0, P.leaf, 81);
    wtree(-1.3, 0.2, 1.2, P.grassDeep, 82);
    wtree(0.6, -3.6, 0.85, P.grass, 83);
    {
      const z = 3.5;
      const y = top(z) + 0.05;
      wb.add(geo.cylinder(1.5, 1.6, 0.25, 12), { color: P.marbleShade, pos: [0, y, z] });
      const cols = low ? 5 : 7;
      for (let i = 0; i < cols; i++) {
        const a = (i / cols) * Math.PI * 2 + 0.2;
        wb.add(geo.cylinder(0.1, 0.12, 1.55, 6, true), { color: P.marble, pos: [Math.sin(a) * 1.15, y + 0.25, z + Math.cos(a) * 1.15] });
      }
      wb.add(geo.cylinder(1.42, 1.42, 0.22, 12), { color: P.marble, pos: [0, y + 1.8, z] });
      wb.add(geo.dome(1.25, 12, 4, 0.72), { color: CYAN, pos: [0, y + 2.02, z], flat: 0.3 });
      wb.add(geo.sphere(0.12, 6, 4), { color: BRASS_LIGHT, pos: [0, y + 3.0, z], flat: 0.5 });
    }
  }
  const whale = wb.build('skyharbor-whale');
  whale.rotation.order = 'YXZ';
  whale.scale.setScalar(WHALE_SCALE);
  inner.add(whale);

  // The flukes, hinged at the tail stock so they can beat.
  const fb = kit.builder();
  {
    const lobe = paddle([[0.1, 1.0, -1.7, 0.32], [2.7, 0.2, -2.5, 0.2], [4.9, -1.9, -3.0, 0.08], [5.5, -2.9, -2.9, 0]]);
    const FL = mix(VIOLET, P.ink, 0.06);
    const id = fb.newId();
    for (const s of [-1, 1]) fb.add(lobe, { gradient: { bottom: mix(VIOLET, '#ffffff', 0.25), top: FL }, color: FL, scale: [s, 1, 1], id, flat: 0.1 });
    lobe.dispose();
  }
  const flukes = fb.build('skyharbor-flukes');
  flukes.position.set(0, WHALE[WHALE.length - 1].y, WHALE[WHALE.length - 1].z + 0.1);
  whale.add(flukes);

  // ------------------------------------------------------------------------------------------
  // The krill. One small shape, a great many times, going round the whale in shoals.
  // ------------------------------------------------------------------------------------------
  const kb = kit.builder();
  {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const head = geo.hull([V(0, 0.04, 0.78), V(0.15, 0.13, 0.32), V(-0.15, 0.13, 0.32), V(0.13, -0.1, 0.3), V(-0.13, -0.1, 0.3), V(0.12, 0.15, -0.02), V(-0.12, 0.15, -0.02), V(0.1, -0.07, -0.02), V(-0.1, -0.07, -0.02)]);
    const tail = geo.hull([V(0.11, 0.15, 0.0), V(-0.11, 0.15, 0.0), V(0.09, -0.06, 0.0), V(-0.09, -0.06, 0.0), V(0.06, -0.03, -0.5), V(-0.06, -0.03, -0.5), V(0.05, -0.19, -0.46), V(-0.05, -0.19, -0.46)]);
    const fan = geo.hull([V(0.04, -0.08, -0.44), V(-0.04, -0.08, -0.44), V(0.22, -0.27, -0.8), V(-0.22, -0.27, -0.8), V(0, -0.2, -0.72), V(0, -0.33, -0.76)]);
    const legs = geo.hull([V(0.03, -0.08, 0.4), V(-0.03, -0.08, 0.4), V(0.03, -0.08, -0.05), V(-0.03, -0.08, -0.05), V(0, -0.34, 0.12)]);
    const body = kb.newId();
    kb.add(head, { color: '#ffffff', id: body, flat: 0.5 });
    kb.add(tail, { color: '#ffe9ee', id: body, flat: 0.5 });
    kb.add(fan, { color: '#f7c9c4', id: body, flat: 0.5 });
    kb.add(legs, { color: '#f0b4b4', id: body, flat: 0.5 });
    kb.add(geo.box(0.33, 0.09, 0.09), { color: '#3a2f5a', pos: [0, 0.03, 0.5], id: body, flat: 1 });
    for (const g of [head, tail, fan, legs]) g.dispose();
  }
  const N_KRILL = low ? 55 : high ? 150 : 100;
  const krillGeo = kb.geometry ? kb.geometry() : geo.box(0.3, 0.2, 1.4);
  const krill = kit.instances(krillGeo, N_KRILL, { flat: 0.5 });
  krill.name = 'skyharbor-krill';
  krill.frustumCulled = false;
  inner.add(krill);
  // Per krill: where it is round the ring, how fast, how far out, how high, how big, its own bob.
  const kA = new Float32Array(N_KRILL);
  const kW = new Float32Array(N_KRILL);
  const kR = new Float32Array(N_KRILL);
  const kY = new Float32Array(N_KRILL);
  const kS = new Float32Array(N_KRILL);
  const kP = new Float32Array(N_KRILL);
  {
    const tint = new THREE.Color();
    const SHOALS = 6;
    const TINTS = [PINK, mix(PINK, '#ffffff', 0.25), mix(PINK, P.orange, 0.3), PINK, mix(PINK, P.red, 0.2)];
    for (let i = 0; i < N_KRILL; i++) {
      const shoal = i % SHOALS;
      // Bunched round six points on the ring, loose at the edges.
      const spread = (rng() + rng() + rng() - 1.5) * 0.62;
      kA[i] = (shoal / SHOALS) * Math.PI * 2 + spread + (shoal % 2) * 0.2;
      kW[i] = 0.05 + rng() * 0.012;
      kR[i] = 0.88 + rng() * 0.3;
      kY[i] = (rng() - 0.5) * 5.5;
      kS[i] = 1.1 + rng() * 0.9;
      kP[i] = rng() * Math.PI * 2;
      krill.setColorAt(i, tint.set(TINTS[i % TINTS.length]));
    }
    if (krill.instanceColor) krill.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------------------------------
  // The wheels. Three hoops, one inside the next, each rimmed with eyes that look outward.
  // ------------------------------------------------------------------------------------------
  const wheel = (R: number, eyes: number, rim: ColorLike, name: string): THREE.Mesh => {
    const w = kit.builder();
    const hw = 0.42, th = 0.36;
    const seg = high ? 36 : low ? 20 : 28;
    const hoop = geo.lathe([[R - th / 2, -hw], [R + th / 2, -hw], [R + th / 2, hw], [R - th / 2, hw], [R - th / 2, -hw]], seg, { crease: 60 });
    w.add(hoop, { color: rim, rot: [Math.PI / 2, 0, 0], flat: 0.35 });
    hoop.dispose();
    const white = geo.sphere(1, 8, 5);
    const iris = geo.sphere(1, 8, 4);
    const tX = new THREE.Vector3(), tY = new THREE.Vector3(0, 0, 1), tZ = new THREE.Vector3();
    for (let i = 0; i < eyes; i++) {
      const a = (i / eyes) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      tX.set(-s, c, 0);
      tZ.set(c, s, 0);
      const rot = basis(tX, tY, tZ);
      const r = R + th / 2;
      w.add(white, { color: '#fbf7ee', pos: [c * (r + 0.01), s * (r + 0.01), 0], rot, scale: [0.37, 0.21, 0.09], flat: 0.7 });
      w.add(iris, { color: CYAN, pos: [c * (r + 0.07), s * (r + 0.07), 0], rot, scale: [0.15, 0.15, 0.05], flat: 1 });
      w.add(iris, { color: P.ink, pos: [c * (r + 0.105), s * (r + 0.105), 0], rot, scale: [0.07, 0.07, 0.03], flat: 1 });
    }
    const mesh = w.build(name);
    mesh.rotation.order = 'YXZ';
    mesh.position.set(GX, WHEEL_Y, GZ);
    inner.add(mesh);
    return mesh;
  };
  const GOLD = mix(BRASS, '#ffffff', 0.5);
  const wheelA = wheel(4.4, low ? 10 : 14, GOLD, 'skyharbor-wheel-outer');
  const wheelB = wheel(3.3, low ? 7 : 10, P.marble, 'skyharbor-wheel-middle');
  const wheelC = wheel(2.2, low ? 5 : 7, mix(BRASS, '#ffffff', 0.25), 'skyharbor-wheel-inner');

  // ------------------------------------------------------------------------------------------
  // The three hands of the booth clock: the three tones it hears, never still.
  // ------------------------------------------------------------------------------------------
  const handGeo = new THREE.BoxGeometry(0.075, 0.74, 0.03).translate(0, 0.29, 0);
  const hands = kit.instances(handGeo, 3, { flat: 0.9 });
  hands.name = 'skyharbor-hands';
  hands.frustumCulled = false;
  {
    const tint = new THREE.Color();
    const HAND = [PINK, mix(CYAN, P.tealDeep, 0.35), VIOLET];
    for (let i = 0; i < 3; i++) hands.setColorAt(i, tint.set(HAND[i]));
    if (hands.instanceColor) hands.instanceColor.needsUpdate = true;
  }
  inner.add(hands);
  const handTurn = new THREE.Matrix4().makeRotationY(BOOTH.turn);
  const handAt = [at(BOOTH, 0, DIAL_Y, 0.2), at(BOOTH, 0, DIAL_Y, 0.235), at(BOOTH, 0, DIAL_Y, 0.27)];
  const HAND_REST = [-0.95, 0.15, 0.85];

  // ------------------------------------------------------------------------------------------
  // Motion. Slow, and right at t = 0 too, because stills hold the clock there.
  // ------------------------------------------------------------------------------------------
  const WX = -4, WY = 19.5, WZ = -64; // where the whale hangs: broadside to the pier, off its end
  const RING_A = 21 * WHALE_SCALE, RING_B = 9.6 * WHALE_SCALE; // the krill ring: long way along the whale, short way across
  const TILT = 0.62;
  const ct = Math.cos(TILT), st = Math.sin(TILT);
  const m = new THREE.Matrix4();
  const update = (_dt: number, t: number): void => {
    const drift = t * 0.045;
    const wx = WX + Math.sin(drift) * 6;
    const wy = WY + Math.sin(t * 0.21) * 0.9;
    const wz = WZ + (1 - Math.cos(drift)) * 1.2;
    whale.position.set(wx, wy, wz);
    whale.rotation.set(Math.sin(t * 0.21 + 0.8) * 0.035, -Math.PI / 2 + Math.sin(drift + 1.2) * 0.1, Math.sin(t * 0.13) * 0.04);
    flukes.rotation.x = -0.06 + Math.sin(t * 0.5) * 0.2;
    if (balance) balance.rotation.z = Math.sin(t * 0.6) * 0.045;

    const e = m.elements;
    for (let i = 0; i < N_KRILL; i++) {
      const a = kA[i] + t * kW[i];
      const ca = Math.cos(a), sa = Math.sin(a);
      const ra = RING_A * kR[i], rb = RING_B * kR[i];
      const flat = sa * rb;
      const bob = Math.sin(t * 0.8 + kP[i]) * 0.35;
      const px = wx + ca * ra;
      const py = wy - 0.5 + kY[i] + bob - flat * st;
      const pz = wz + flat * ct;
      // Heading: along the ring, the way it is going.
      let fx = -sa * ra, fy = -ca * rb * st, fz = ca * rb * ct;
      const fl = 1 / Math.hypot(fx, fy, fz);
      fx *= fl; fy *= fl; fz *= fl;
      // Right is up cross forward, up is forward cross right.
      let rx = fz, rz = -fx;
      const rl = 1 / (Math.hypot(rx, rz) || 1);
      rx *= rl; rz *= rl;
      const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
      const s = kS[i];
      e[0] = rx * s; e[1] = 0; e[2] = rz * s; e[3] = 0;
      e[4] = ux * s; e[5] = uy * s; e[6] = uz * s; e[7] = 0;
      e[8] = fx * s; e[9] = fy * s; e[10] = fz * s; e[11] = 0;
      e[12] = px; e[13] = py; e[14] = pz; e[15] = 1;
      krill.setMatrixAt(i, m);
    }
    krill.instanceMatrix.needsUpdate = true;

    wheelA.rotation.set(0.12, -0.5 + Math.sin(t * 0.05) * 0.3, t * 0.06);
    wheelB.rotation.set(-0.3, 0.75 + t * 0.045, -t * 0.09);
    wheelC.rotation.set(1.05, 0.4 - t * 0.07, t * 0.12);

    for (let i = 0; i < 3; i++) {
      const a = HAND_REST[i] + Math.sin(t * (0.5 + i * 0.17) + i * 2.1) * 0.28 + Math.sin(t * (1.3 + i * 0.4) + i) * 0.06;
      const p = handAt[i];
      m.makeRotationZ(-a).premultiply(handTurn).setPosition(p[0], p[1], p[2]);
      hands.setMatrixAt(i, m);
    }
    hands.instanceMatrix.needsUpdate = true;
  };
  update(0, 0);

  return {
    group,
    colliders,
    pois,
    update,
    dispose() {
      krill.geometry.dispose();
      hands.geometry.dispose();
    },
  };
}
