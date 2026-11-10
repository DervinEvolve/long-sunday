// The Commons. Meta in Cambridge, drawn as a campus green in the middle of the city.
// You come in from the avenue in the south west under a marble gate with the name on it.
// Across the plaza to the north east a beacon tower stands on a brick plinth on its own lawn,
// a slow light turning in its lantern: that is Black@Boston.
// To the south east a Greek theatre is cut into a grass bank, marble steps in a half bowl looking
// back at the plaza. Three whiteboard monoliths stand where the stage would be. The steps hold
// stools, far too many of them, and the top two rows carry on past the last step and hang in the air.
// North of the plaza is the green itself: a long workbench between two trees under a string of
// lanterns (the hackathon), and a sourcing desk with four stones lettered L3 to L6 rising beside it.
//
// Roads come in from the south west (the avenue up from the Switchboard), the west north west
// (on up to the Terraces) and the east (the side street to the Studio). Nothing stands on those lines.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, Poi } from '../types';

type V3 = [number, number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const TRUNK = '#7a5a86';
const WOOD = '#b27447';
const WOOD_DEEP = '#8a5238';
const BOARD = '#fbf8f1';
const DOOR = '#3d3766';
const LIT = '#f8dc8c';
const BEAM = '#fff0c2';
const LEAVES = ['#7fb85a', '#63aa5e', '#3f8a57', '#8cc56c', '#4f9c62'];
const FLOWERS = ['#f08a6c', '#f3c531', '#f7f0e4', '#f0a0b6'];

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
const DEG = Math.PI / 180;

/** Label rotation for a face whose outward normal is (nx, nz). */
const faceRot = (nx: number, nz: number): V3 => [0, Math.atan2(nx, nz), 0];

/**
 * A piece of a ring lying on the ground: from radius r0 to r1, angle a0 to a1 (measured from +x
 * toward +z), top at hIn on the inside edge and hOut on the outside edge, bottom at y0.
 * Absolute positions around (cx, cz). Flat faced, every face wound to look outward.
 */
function sector(cx: number, cz: number, r0: number, r1: number, a0: number, a1: number, hIn: number, hOut: number, seg: number, y0 = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const E1 = new THREE.Vector3();
  const E2 = new THREE.Vector3();
  const N = new THREE.Vector3();
  const tri = (a: V3, b: V3, c: V3, out: V3): void => {
    A.set(a[0], a[1], a[2]);
    B.set(b[0], b[1], b[2]);
    C.set(c[0], c[1], c[2]);
    N.crossVectors(E1.subVectors(B, A), E2.subVectors(C, A));
    if (N.lengthSq() < 1e-10) return;
    N.normalize();
    if (N.x * out[0] + N.y * out[1] + N.z * out[2] < 0) {
      N.negate();
      pos.push(...a, ...c, ...b);
    } else pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) nrm.push(N.x, N.y, N.z);
  };
  const quad = (a: V3, b: V3, c: V3, d: V3, out: V3): void => {
    tri(a, b, c, out);
    tri(a, c, d, out);
  };
  const p = (r: number, t: number, y: number): V3 => [cx + Math.cos(t) * r, y, cz + Math.sin(t) * r];
  for (let k = 0; k < seg; k++) {
    const t0 = a0 + ((a1 - a0) * k) / seg;
    const t1 = a0 + ((a1 - a0) * (k + 1)) / seg;
    const tm = (t0 + t1) / 2;
    const rad: V3 = [Math.cos(tm), 0, Math.sin(tm)];
    const up: V3 = [0, 1, 0];
    quad(p(r0, t0, hIn), p(r1, t0, hOut), p(r1, t1, hOut), p(r0, t1, hIn), up);
    if (hIn > y0 + 1e-3) quad(p(r0, t0, y0), p(r0, t0, hIn), p(r0, t1, hIn), p(r0, t1, y0), [-rad[0], 0, -rad[2]]);
    if (hOut > y0 + 1e-3) quad(p(r1, t0, y0), p(r1, t0, hOut), p(r1, t1, hOut), p(r1, t1, y0), rad);
  }
  const cap = (t: number, out: V3): void => quad(p(r0, t, y0), p(r1, t, y0), p(r1, t, hOut), p(r0, t, hIn), out);
  cap(a0, [Math.sin(a0), 0, -Math.cos(a0)]);
  cap(a1, [-Math.sin(a1), 0, Math.cos(a1)]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export const district: DistrictModule = {
  id: 'commons',
  build(ctx) {
    return buildCommons(ctx);
  },
};

function buildCommons(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const sun = ctx.sun ?? FALLBACK_SUN;
  const [BLUE, CORAL, CREAM] = site.accents as [string, string, string];
  const LAWN_Y = 0.05;
  const paveShade = mix(mix(P.pave, BLUE, 0.08), P.shadow, 0.3);
  const lawnShade = mix(P.grass, P.shadow, 0.35);

  const group = new THREE.Group();
  group.name = 'commons';
  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const b = kit.builder();
  const has = (id: string): boolean => entries.some((e) => e.id === id);
  const fit = (text: string, size: number, max: number): number => {
    const w = b.measure ? b.measure({ text, size }).width : text.length * size * 0.7;
    return w > max ? (size * max) / w : size;
  };
  const cast = (g: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: number | V3, onLawn = false): void => {
    b.shadow?.(g, { color: onLawn ? lawnShade : paveShade, sun, pos, rot, scale, y: onLawn ? LAWN_Y : 0, lift: 0.015 });
  };
  /** Rotate a local offset (x along the face, z out of the face) by yaw and add a centre. */
  const place = (cx: number, cz: number, yaw: number) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return (x: number, y: number, z: number): V3 => [cx + x * c + z * s, y, cz - x * s + z * c];
  };

  // A clump of leaf. Hedges, beds, and ivy when it is squashed flat against stone.
  let clumpSeed = 71;
  const clump = (pos: V3, scale: V3, tint: string, rot?: V3, count = 4, sway = 0.1): void => {
    b.add(geo.blobs(clumpSeed++, count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos, rot, scale, sway,
    });
  };
  // A campus tree: a trunk and three round masses of leaf.
  const tree = (x: number, z: number, h: number, tint: string, onLawn = true): void => {
    const y = onLawn ? LAWN_Y : 0;
    const s = h / 7;
    const a = rng() * 6.28;
    const ca = Math.cos(a), sa = Math.sin(a);
    if (!onLawn) b.add(geo.cylinder(0.95, 0.95, 0.1, 8), { color: P.grassDeep, pos: [x, 0, z], flat: 0.5 });
    b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, y, z], sway: 0.2, swayBase: y });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: y };
    const id = b.newId();
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    b.add(ball, { ...leaf, id, pos: [x, y + 4.9 * s, z], scale: [2.5 * s, 2.0 * s, 2.4 * s] });
    b.add(ball, { ...leaf, id, pos: [x - 1.6 * s * ca, y + 4.6 * s, z - 1.6 * s * sa], scale: [1.5 * s, 1.25 * s, 1.45 * s] });
    b.add(ball, { ...leaf, pos: [x + 1.6 * s * ca + 0.6 * sa, y + 4.0 * s, z + 1.6 * s * sa], scale: [1.7 * s, 1.35 * s, 1.6 * s] });
    if (!low) cast(ball, [x, 4.9 * s, z], undefined, [2.5 * s, 2.0 * s, 2.4 * s], onLawn);
    colliders.push({ kind: 'circle', x, z, r: 0.34 * s });
  };
  // A bed of flowers: a low rim of soil green with a few coloured heads in it.
  const bed = (x: number, z: number, r: number, n: number): void => {
    b.add(geo.cylinder(r, r, 0.12, 12), { color: P.grassDeep, pos: [x, 0, z], flat: 0.4 });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng();
      const d = r * (0.25 + rng() * 0.5);
      clump([x + Math.cos(a) * d, 0.22, z + Math.sin(a) * d], [0.32, 0.26, 0.32], FLOWERS[i % FLOWERS.length], undefined, 3, 0.15);
    }
  };

  // ------------------------------------------------------------------------------------------
  // The green. Three lawns a few centimetres proud of the paving, clear of the three roads.
  // ------------------------------------------------------------------------------------------
  const lawn = (x: number, z: number, rx: number, rz: number, rot = 0): void => {
    const lid = b.newId();
    b.add(geo.cylinder(1, 1, LAWN_Y, 32), { color: P.grass, pos: [x, 0, z], scale: [rx, 1, rz], rot: [0, rot, 0], flat: 0.3, id: lid });
  };
  lawn(-3.5, -14.5, 12, 8.2, 0.08); // the north green: bench, desk and stones
  const BX = 18, BZ = -12; // the beacon
  lawn(BX, BZ, 6.8, 6.8);
  lawn(-4.5, 20.5, 6.5, 4.6, -0.3); // the south corner by the theatre

  // ------------------------------------------------------------------------------------------
  // The gate. Two fluted columns either side of the avenue and a lintel with the name on both faces.
  // ------------------------------------------------------------------------------------------
  {
    const A = site.arrive;
    const al = Math.hypot(A.x, A.z) || 1;
    const dx = -A.x / al, dz = -A.z / al; // the way in
    const gx = A.x + dx * 8.5, gz = A.z + dz * 8.5;
    const yaw = Math.atan2(-dx, -dz); // front looks back down the road
    const at = place(gx, gz, yaw);
    const rot: V3 = [0, yaw, 0];
    const back: V3 = [0, yaw + Math.PI, 0];
    const HALF = 4.1;
    const SHAFT = 4.4;
    const shaft = geo.prism(12, 0.4, 0.5, SHAFT);
    for (const side of [-1, 1]) {
      const x = side * HALF;
      b.add(geo.bevelBox(1.4, 0.5, 1.4, 0.06), { color: P.marbleShade, pos: at(x, 0, 0), rot });
      b.add(geo.cylinder(0.56, 0.56, 0.16, 12), { color: BLUE, pos: at(x, 0.5, 0), rot, flat: 0.4 });
      b.add(shaft, { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: at(x, 0.66, 0), rot });
      cast(shaft, at(x, 0.66, 0), rot);
      b.add(geo.cylinder(0.6, 0.44, 0.26, 12), { color: P.marbleShade, pos: at(x, 0.66 + SHAFT, 0), rot });
      b.add(geo.bevelBox(1.3, 0.24, 1.3, 0.04), { color: P.marble, pos: at(x, 0.92 + SHAFT, 0), rot });
      const p = at(x, 0, 0);
      colliders.push({ kind: 'circle', x: p[0], z: p[2], r: 0.78 });
      // Beds against the outer side of each column.
      const bp = at(x + side * 1.9, 0, 0.3);
      bed(bp[0], bp[2], 1.1, low ? 3 : 5);
      // Ivy climbing the shaft.
      clump(at(x - side * 0.1, 1.6, 0.45), [0.55, 1.6, 0.3], LEAVES[side > 0 ? 2 : 4], rot, 4);
    }
    // Ivy over one end of the lintel and down the column under it.
    const LY = 1.16 + SHAFT;
    const LH = 1.3;
    const LD = 0.95;
    const lintelGeo = geo.bevelBox(HALF * 2 + 1.5, LH, LD, 0.05);
    const lintel = b.add(lintelGeo, { color: P.marble, pos: at(0, LY, 0), rot });
    cast(lintelGeo, at(0, LY, 0), rot);
    b.add(geo.bevelBox(HALF * 2 + 1.9, 0.22, LD + 0.3, 0.04), { color: BLUE, pos: at(0, LY + LH, 0), rot, flat: 0.3 });
    b.add(geo.bevelBox(HALF * 2 + 0.9, 0.3, LD - 0.1, 0.04), { color: P.marbleShade, pos: at(0, LY + LH + 0.22, 0), rot });
    // A planted top: a hedge running along the lintel.
    clump(at(-2.4, LY + LH + 0.65, 0), [2.2, 0.55, 0.55], LEAVES[1], rot, 5);
    clump(at(2.6, LY + LH + 0.62, 0), [1.8, 0.5, 0.55], LEAVES[3], rot, 4);
    clump(at(-HALF - 0.35, LY + 0.3, LD / 2 + 0.05), [0.75, 0.9, 0.28], LEAVES[2], rot, 4);
    const name = site.name.toUpperCase();
    const ns = fit(name, 0.56, HALF * 2 + 0.6);
    for (const [z, r] of [[LD / 2, rot], [-LD / 2, back]] as const) {
      b.label({ text: name, size: ns, pos: at(0, LY + LH * 0.6, z), rot: r, ink: P.ink, plate: P.marble, id: lintel, pad: 0.12 });
      b.label({ text: site.years.toUpperCase(), size: 0.17, pos: at(0, LY + LH * 0.2, z), rot: r, ink: P.violet, plate: P.marble, id: lintel, pad: 0.1 });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The beacon. A brick plinth, a fluted marble shaft with blue bands, a gallery, an open lantern.
  // ------------------------------------------------------------------------------------------
  // Shaft from S0 up SH metres, gallery and lantern on top. The light sits in the middle of the lantern.
  const S0 = 5.05, SH = 19.0;
  const LAMP_Y = S0 + SH + 1.35 + 1.25;
  {
    const A = site.arrive;
    const yaw = Math.atan2(A.x - BX, A.z - BZ); // the door looks at the way in
    const at = place(BX, BZ, yaw);
    const rot: V3 = [0, yaw, 0];
    const PW = 5.6;
    b.add(geo.bevelBox(PW + 1.0, 0.6, PW + 1.0, 0.08), { color: P.marbleShade, pos: at(0, 0, 0), rot });
    const plinthGeo = geo.box(PW, 4.0, PW);
    const plinth = b.add(plinthGeo, { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, pos: at(0, 0.6, 0), rot, hatch: 0.05 });
    cast(geo.box(PW, 4.6, PW), at(0, 0, 0), rot, undefined, true);
    b.add(geo.bevelBox(PW + 0.6, 0.45, PW + 0.6, 0.06), { color: P.marble, pos: at(0, 4.6, 0), rot });
    // The door, under a marble arch.
    b.add(geo.arch({ span: 1.3, rise: 2.3, thick: 0.28, depth: 0.32 }), { color: P.marble, pos: at(0, 0.6, PW / 2), rot });
    b.add(geo.plane(1.3, 2.3), { color: DOOR, pos: at(0, 1.75, PW / 2 + 0.02), rot, flat: 0.6 });
    b.label({ text: 'BLACK@BOSTON', size: fit('BLACK@BOSTON', 0.4, PW - 0.8), pos: at(0, 3.75, PW / 2 + 0.01), rot, ink: CREAM, plate: P.brick, id: plinth, pad: 0.1 });
    // Lit windows on the two sides.
    for (const side of [-1, 1]) {
      const r: V3 = [0, yaw + (side * Math.PI) / 2, 0];
      b.add(geo.plane(0.8, 1.3), { color: LIT, pos: at(side * (PW / 2 + 0.02), 2.6, 0), rot: r, flat: 0.8 });
      b.add(geo.box(1.0, 0.12, 0.22), { color: P.marble, pos: at(side * (PW / 2 + 0.06), 1.88, 0), rot: r });
    }
    colliders.push({ kind: 'box', x: BX, z: BZ, hw: PW / 2 + 0.5, hd: PW / 2 + 0.5, rot: yaw });

    // The shaft. Twelve flutes, narrowing as it goes up.
    const R0 = 1.85, R1 = 1.3;
    const rAt = (y: number): number => R0 + ((R1 - R0) * (y - S0)) / SH;
    b.add(geo.cylinder(2.3, 2.4, 0.4, 12), { color: P.marbleShade, pos: [BX, 5.05 - 0.4, BZ] });
    b.add(geo.prism(12, R1, R0, SH), { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [BX, S0, BZ], rot: [0, yaw, 0] });
    for (const y of [9.5, 15.0, 20.5]) {
      const r = rAt(y) + 0.09;
      b.add(geo.prism(12, r, r, 0.55), { color: BLUE, pos: [BX, y, BZ], rot: [0, yaw, 0], flat: 0.2 });
    }
    // Ivy up the first third of the shaft, on the shady side.
    const ivyRot: V3 = [0, yaw + Math.PI * 0.8, 0];
    const ia = yaw + Math.PI * 0.8;
    for (let i = 0; i < (low ? 2 : 4); i++) {
      const y = 5.8 + i * 1.5;
      const r = rAt(y) + 0.05;
      const a = ia + Math.sin(i * 1.7) * 0.25;
      clump([BX + Math.sin(a) * r, y, BZ + Math.cos(a) * r], [0.7, 1.1, 0.3], LEAVES[(i + 1) % LEAVES.length], [0, a, 0], 4);
    }
    clump(at(-PW / 2 - 0.1, 2.4, 0.8), [0.35, 2.4, 1.6], LEAVES[2], rot, 5);
    clump(at(-PW / 2 + 0.5, 5.0, PW / 2 - 0.4), [0.8, 0.32, 0.6], LEAVES[4], ivyRot, 4);
    clump(at(PW / 2 - 0.7, 0.9, PW / 2 + 0.1), [0.6, 0.9, 0.25], LEAVES[0], rot, 4);
    // The gallery on corbels, and its rail.
    const GY = S0 + SH;
    b.add(geo.cylinder(2.45, R1, 1.0, 12), { color: P.marbleShade, pos: [BX, GY, BZ] });
    b.add(geo.cylinder(2.65, 2.65, 0.35, 16), { color: P.marble, pos: [BX, GY + 1.0, BZ] });
    const RAIL = GY + 1.35;
    b.add(geo.torus(2.5, 0.06, 20, 4), { color: P.ink, pos: [BX, RAIL + 0.95, BZ], rot: [Math.PI / 2, 0, 0], flat: 0.5 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.add(geo.cylinder(0.04, 0.04, 0.95, 4), { color: P.ink, pos: [BX + Math.cos(a) * 2.5, RAIL, BZ + Math.sin(a) * 2.5], flat: 0.5 });
    }
    // The lantern: eight blue posts round the light, a blue roof, a brass ball.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + yaw;
      b.add(geo.cylinder(0.1, 0.12, 2.5, 5), { color: BLUE, pos: [BX + Math.cos(a) * 1.35, RAIL, BZ + Math.sin(a) * 1.35], flat: 0.3 });
    }
    b.add(geo.cylinder(1.25, 1.25, 0.25, 12), { color: P.marbleShade, pos: [BX, RAIL, BZ] });
    b.add(geo.cylinder(1.65, 1.65, 0.32, 12), { color: BLUE, pos: [BX, RAIL + 2.5, BZ], flat: 0.2 });
    b.add(geo.cone(1.75, 1.9, 12), { gradient: { bottom: BLUE, top: mix(BLUE, '#ffffff', 0.25) }, color: BLUE, pos: [BX, RAIL + 2.82, BZ] });
    b.add(geo.sphere(0.3, 10, 6), { color: P.brass, pos: [BX, RAIL + 4.85, BZ], flat: 0.4 });
  }

  // ------------------------------------------------------------------------------------------
  // The theatre. A half bowl of marble steps in a grass bank, looking back at the plaza.
  // ------------------------------------------------------------------------------------------
  const TX = 8, TZ = 12.5;
  const AC = 45 * DEG; // the axis of the seats points south east, away from the plaza
  const SPAN = 78 * DEG;
  const R_ORCH = 4.6;
  const TREAD = 0.95;
  const RISE = 0.42;
  const TIERS = 6;
  const FLOOR = 0.08;
  const R_TOP = R_ORCH + TIERS * TREAD;
  const R_BANK = R_TOP + 3.0;
  const H_TOP = FLOOR + TIERS * RISE;
  const seg = high ? 30 : low ? 16 : 22;
  {
    // The orchestra floor, with a coral ring let into it.
    const floor = b.newId();
    b.add(geo.cylinder(R_ORCH + 0.15, R_ORCH + 0.15, FLOOR, 28), { color: P.marble, pos: [TX, 0, TZ], id: floor });
    b.add(geo.ring(R_ORCH - 0.75, R_ORCH - 0.45, 28), { color: CORAL, pos: [TX, FLOOR + 0.01, TZ], flat: 0.8, outline: false });
    b.add(geo.disc(0.6, 12), { color: CORAL, pos: [TX, FLOOR + 0.01, TZ], flat: 0.8, outline: false });
    // The steps. Each tier is solid to the ground, so the risers read as one block of stone.
    const steps = b.newId();
    for (let i = 0; i < TIERS; i++) {
      const r0 = R_ORCH + i * TREAD;
      const h = FLOOR + (i + 1) * RISE;
      const c = i % 2 === 0 ? P.marble : mix(P.marble, P.marbleShade, 0.35);
      b.add(sector(TX, TZ, r0, r0 + TREAD, AC - SPAN, AC + SPAN, h, h, seg), { color: c, id: steps });
    }
    // A coral aisle down the middle of the bowl: a strip on each tread.
    for (let i = 0; i < TIERS; i++) {
      const r0 = R_ORCH + i * TREAD;
      const h = FLOOR + (i + 1) * RISE;
      const da = 0.45 / (r0 + TREAD / 2);
      b.add(sector(TX, TZ, r0 + 0.04, r0 + TREAD - 0.04, AC - da, AC + da, h + 0.015, h + 0.015, 1, h - 0.01), { color: CORAL, flat: 0.6, outline: false });
    }
    // The grass bank behind, and the turf on the slope ends either side.
    b.add(sector(TX, TZ, R_TOP, R_BANK, AC - SPAN - 4 * DEG, AC + SPAN + 4 * DEG, H_TOP, 0.03, seg), {
      gradient: { bottom: P.grass, top: P.grassLight }, color: P.grass, flat: 0.25,
    });
    // Ivy on the stepped ends of the bowl, where the stone meets the bank.
    for (const s of [-1, 1]) {
      const a = AC + s * (SPAN + 1.5 * DEG);
      for (let k = 0; k < (low ? 2 : 3); k++) {
        const r = R_ORCH + (3.2 + k * 1.1) * TREAD;
        const y = FLOOR + (3 + k) * RISE * 0.9;
        clump([TX + Math.cos(a) * r, y, TZ + Math.sin(a) * r], [0.9, 0.7, 0.9], LEAVES[(k + (s > 0 ? 2 : 0)) % LEAVES.length], undefined, 4);
      }
    }
    // Colliders: the bowl and its bank as boxes round the arc. The orchestra stays open.
    const nBox = 10;
    const rm = (R_ORCH + 0.1 + R_BANK) / 2;
    const hd = (R_BANK - R_ORCH - 0.1) / 2;
    for (let k = 0; k < nBox; k++) {
      const a = AC - SPAN + ((k + 0.5) / nBox) * 2 * SPAN;
      const hw = Math.sin(SPAN / nBox) * rm * 1.08;
      colliders.push({ kind: 'box', x: TX + Math.cos(a) * rm, z: TZ + Math.sin(a) * rm, hw, hd, rot: Math.atan2(Math.cos(a), Math.sin(a)) });
    }

    // The whiteboard monoliths, where the stage would be. White on both faces.
    const AO = AC + Math.PI; // toward the plaza
    const fronts = ['THE SCREEN', 'SYSTEM DESIGN', 'CODING'];
    const backs = ['A MONTH', 'INTERVIEW PREP', '160 SEATS'];
    for (let k = 0; k < 3; k++) {
      const a = AO + (k - 1) * 46 * DEG;
      const x = TX + Math.cos(a) * 6.0;
      const z = TZ + Math.sin(a) * 6.0;
      const yaw = Math.atan2(TX - x, TZ - z); // the board faces the seats
      const at = place(x, z, yaw);
      const rot: V3 = [0, yaw, 0];
      const W = 2.0, H = 2.5, D = 0.3;
      b.add(geo.bevelBox(W + 0.5, 0.35, D + 0.5, 0.05), { color: P.marbleShade, pos: at(0, 0, 0), rot });
      b.add(geo.bevelBox(W + 0.24, H + 0.24, D, 0.05), { color: P.steel, pos: at(0, 0.35, 0), rot });
      const face = b.add(geo.box(W, H, D + 0.04), { color: BOARD, pos: at(0, 0.47, 0), rot, flat: 0.55 });
      b.add(geo.bevelBox(W + 0.4, 0.14, D + 0.2, 0.03), { color: P.steel, pos: at(0, 0.35 + H + 0.24, 0), rot });
      cast(geo.box(W + 0.24, H + 0.6, D), at(0, 0, 0), rot);
      const zf = D / 2 + 0.02;
      // Front: the topic, then a little diagram in marker.
      b.label({ text: fronts[k], size: fit(fronts[k], 0.24, W - 0.4), pos: at(0, 0.47 + H - 0.42, zf), rot, ink: BLUE, plate: BOARD, id: face, flat: 0.55, pad: 0.1 });
      const mk = (mx: number, my: number, w: number, h: number, c: string): void => {
        b.add(geo.box(w, h, 0.02), { color: c, pos: at(mx, 0.47 + my, zf), rot, flat: 1, outline: false });
      };
      if (k === 1) {
        // Three boxes and the lines between them.
        for (const [bx, by] of [[-0.6, 1.4], [0.6, 1.4], [0, 0.6]] as const) {
          mk(bx - 0.25, by, 0.04, 0.4, CORAL);
          mk(bx + 0.25, by, 0.04, 0.4, CORAL);
          mk(bx, by - 0.02, 0.54, 0.04, CORAL);
          mk(bx, by + 0.38, 0.54, 0.04, CORAL);
        }
        mk(0, 1.58, 0.66, 0.04, P.ink as string);
        mk(-0.3, 1.1, 0.04, 0.3, P.ink as string);
        mk(0.3, 1.1, 0.04, 0.3, P.ink as string);
      } else {
        for (let l = 0; l < 4; l++) mk(-0.2 + ((l * 37) % 5) * 0.06, 1.75 - l * 0.33, 1.2 - ((l * 3) % 4) * 0.18, 0.05, l === 2 ? CORAL : (P.ink as string));
      }
      b.label({ text: backs[k], size: fit(backs[k], 0.34, W - 0.3), pos: at(0, 0.47 + H * 0.62, -zf), rot: [0, yaw + Math.PI, 0], ink: P.ink, plate: BOARD, id: face, flat: 0.55, pad: 0.1 });
      colliders.push({ kind: 'box', x, z, hw: W / 2 + 0.3, hd: D / 2 + 0.3, rot: yaw });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The hackathon: a long bench between two trees, under a string of lanterns.
  // ------------------------------------------------------------------------------------------
  const HX = -7.5, HZ = -17.5;
  {
    const y = LAWN_Y;
    const L = 7.2;
    b.add(geo.bevelBox(L, 0.12, 1.25, 0.03), { color: WOOD, pos: [HX, y + 0.8, HZ] });
    cast(geo.box(L, 0.12, 1.25), [HX, y + 0.8, HZ], undefined, undefined, true);
    for (const sx of [-L / 2 + 0.5, 0, L / 2 - 0.5]) {
      b.add(geo.box(0.12, 0.8, 1.0), { color: WOOD_DEEP, pos: [HX + sx, y, HZ] });
    }
    for (const sz of [-1.05, 1.05]) {
      b.add(geo.bevelBox(L - 0.4, 0.09, 0.42, 0.02), { color: WOOD, pos: [HX, y + 0.44, HZ + sz] });
      for (const sx of [-L / 2 + 0.7, 0, L / 2 - 0.7]) b.add(geo.box(0.1, 0.44, 0.32), { color: WOOD_DEEP, pos: [HX + sx, y, HZ + sz] });
    }
    // Laptops open along both sides, and the odd mug.
    for (let i = 0; i < 6; i++) {
      const sx = -L / 2 + 0.75 + i * ((L - 1.5) / 5);
      const side = i % 2 === 0 ? 1 : -1;
      const lz = HZ + side * 0.28;
      const c = i % 3 === 0 ? P.steel : i % 3 === 1 ? CREAM : BLUE;
      b.add(geo.box(0.46, 0.04, 0.32), { color: c, pos: [HX + sx, y + 0.92, lz] });
      b.add(geo.box(0.46, 0.32, 0.04), { color: c, pos: [HX + sx, y + 0.94, lz - side * 0.16], rot: [side * -0.25, 0, 0] });
      if (i % 2 === 1) b.add(geo.cylinder(0.06, 0.06, 0.12, 6), { color: CORAL, pos: [HX + sx + 0.42, y + 0.92, lz + 0.05] });
    }
    colliders.push({ kind: 'box', x: HX, z: HZ, hw: L / 2, hd: 1.3 });

    const T1 = HX - L / 2 - 1.5, T2 = HX + L / 2 + 1.5;
    tree(T1, HZ - 0.4, 7.4, LEAVES[0]);
    tree(T2, HZ + 0.3, 6.8, LEAVES[2]);
    // The string, tied to both trunks, and a second one looping back across a little lower.
    const SY = 3.6;
    const strings: [V3, V3, number][] = [
      [[T1 + 0.25, SY, HZ - 0.35], [T2 - 0.25, SY, HZ + 0.3], 0.75],
      [[T1 + 0.25, SY - 0.3, HZ - 0.5], [T2 - 0.25, SY - 0.2, HZ + 0.1], 1.0],
    ];
    const lantern = geo.sphere(0.21, 8, 6);
    let n = 0;
    for (const [a, c, sag] of strings) {
      b.add(geo.tube([a, c], 0.03, { sag, perSpan: 8, radial: 4 }), { color: P.ink, flat: 0.6 });
      const count = low ? 5 : 8;
      for (let i = 1; i <= count; i++) {
        const s = i / (count + 1);
        // The tube sags as a smooth curve through the mid point. A parabola is close enough.
        const lx = a[0] + (c[0] - a[0]) * s;
        const ly = a[1] + (c[1] - a[1]) * s - sag * 4 * s * (1 - s);
        const lz = a[2] + (c[2] - a[2]) * s;
        // None in front of the banner.
        if (Math.abs(lx - HX) < 2.2) continue;
        const col = [CORAL, LIT, BLUE, CREAM][n++ % 4];
        b.add(geo.cylinder(0.015, 0.015, 0.22, 3), { color: P.ink, pos: [lx, ly - 0.22, lz], outline: false });
        b.add(lantern, { color: col, pos: [lx, ly - 0.42, lz], scale: [1, 1.25, 1], flat: 0.7 });
        b.add(geo.cylinder(0.1, 0.12, 0.07, 6), { color: P.ink, pos: [lx, ly - 0.2 - 0.07, lz], flat: 0.5 });
      }
    }
    // The banner, hung from the upper string over the middle of the bench.
    const BY = SY - 0.75 - 0.25;
    const bw = 3.7, bh = 0.62;
    const banner = b.add(geo.box(bw, bh, 0.06), { color: CORAL, pos: [HX, BY - bh, HZ], flat: 0.6 });
    for (const sx of [-bw / 2 + 0.2, bw / 2 - 0.2]) b.add(geo.cylinder(0.015, 0.015, 0.32, 3), { color: P.ink, pos: [HX + sx, BY - 0.05, HZ], outline: false });
    const ht = 'FIRST BLACK@ HACKATHON';
    const hs = fit(ht, 0.22, bw - 0.3);
    b.label({ text: ht, size: hs, pos: [HX, BY - bh / 2, HZ + 0.04], ink: CREAM, plate: CORAL, id: banner, flat: 0.6, pad: 0.08 });
    b.label({ text: ht, size: hs, pos: [HX, BY - bh / 2, HZ - 0.04], rot: [0, Math.PI, 0], ink: CREAM, plate: CORAL, id: banner, flat: 0.6, pad: 0.08 });
  }

  // ------------------------------------------------------------------------------------------
  // The sourcing desk, and four stones rising beside it, L3 to L6.
  // ------------------------------------------------------------------------------------------
  const DX = 3.2, DZ = -19.6;
  {
    const y = LAWN_Y;
    const desk = b.newId();
    b.add(geo.bevelBox(2.6, 0.1, 1.1, 0.03), { color: WOOD, pos: [DX, y + 0.78, DZ], id: desk });
    const panel = b.add(geo.box(2.5, 0.62, 0.08), { color: CREAM, pos: [DX, y + 0.14, DZ + 0.48] });
    for (const sx of [-1.2, 1.2]) b.add(geo.box(0.1, 0.78, 1.0), { color: WOOD_DEEP, pos: [DX + sx, y, DZ] });
    b.label({ text: 'SOURCING', size: 0.2, pos: [DX, y + 0.45, DZ + 0.53], ink: BLUE, plate: CREAM, id: panel, pad: 0.08 });
    cast(geo.box(2.6, 0.9, 1.1), [DX, y, DZ], undefined, undefined, true);
    // A card file, a lamp, a stack of folders, and a big brass glass on a stand.
    b.add(geo.box(0.5, 0.26, 0.4), { color: P.steel, pos: [DX - 0.75, y + 0.88, DZ - 0.1] });
    for (let i = 0; i < 6; i++) b.add(geo.box(0.42, 0.12, 0.02), { color: CREAM, pos: [DX - 0.75, y + 1.1, DZ - 0.26 + i * 0.06], rot: [-0.25, 0, 0], outline: i % 2 === 0 });
    for (let i = 0; i < 3; i++) b.add(geo.box(0.36, 0.05, 0.26), { color: [BLUE, CORAL, CREAM][i], pos: [DX + 0.15, y + 0.88 + i * 0.05, DZ + 0.15], rot: [0, i * 0.2, 0] });
    b.add(geo.cylinder(0.12, 0.14, 0.04, 8), { color: P.brass, pos: [DX + 0.95, y + 0.88, DZ - 0.25] });
    b.add(geo.cylinder(0.025, 0.025, 0.5, 4), { color: P.brass, pos: [DX + 0.95, y + 0.9, DZ - 0.25] });
    b.add(geo.cone(0.16, 0.2, 8), { color: P.verdigris, pos: [DX + 0.95, y + 1.48, DZ - 0.18], rot: [Math.PI + 0.5, 0, 0] });
    b.add(geo.cylinder(0.04, 0.04, 0.55, 5), { color: P.brass, pos: [DX + 0.5, y + 0.88, DZ - 0.3] });
    b.add(geo.torus(0.28, 0.045, 14, 4), { color: P.brass, pos: [DX + 0.5, y + 1.7, DZ - 0.3], flat: 0.3 });
    b.add(geo.cylinder(0.25, 0.25, 0.02, 12), { color: P.glass, pos: [DX + 0.5, y + 1.7, DZ - 0.3], rot: [Math.PI / 2, 0, 0], flat: 1, dither: 0.5 });
    // The chair.
    b.add(geo.bevelBox(0.5, 0.08, 0.5, 0.02), { color: BLUE, pos: [DX, y + 0.46, DZ - 0.95] });
    b.add(geo.bevelBox(0.5, 0.6, 0.08, 0.02), { color: BLUE, pos: [DX, y + 0.54, DZ - 1.2] });
    b.add(geo.cylinder(0.04, 0.04, 0.46, 4), { color: P.ink, pos: [DX, y, DZ - 0.95] });
    colliders.push({ kind: 'box', x: DX, z: DZ - 0.25, hw: 1.35, hd: 0.95 });

    // The stones, each a step higher, toward the beacon.
    const stones: [number, number, number][] = [
      [6.8, -21.1, 0.45],
      [8.9, -21.9, 0.9],
      [11.0, -22.7, 1.35],
      [13.1, -23.5, 1.8],
    ];
    stones.forEach(([sx, sz, h], i) => {
      const yaw = -0.35;
      const at = place(sx, sz, yaw);
      const rot: V3 = [0, yaw, 0];
      const s = b.add(geo.bevelBox(1.35, h, 1.35, 0.07), { color: P.marble, pos: at(0, 0, 0), rot });
      cast(geo.box(1.35, h, 1.35), at(0, 0, 0), rot, undefined, true);
      b.add(geo.bevelBox(1.39, 0.1, 1.39, 0.03), { color: i % 2 ? BLUE : CORAL, pos: at(0, h - 0.06, 0), rot, flat: 0.4 });
      clump(at(-0.3, h + 0.08, 0.15), [0.45, 0.16, 0.4], P.moss as string, rot, 3, 0);
      const t = `L${i + 3}`;
      b.label({ text: t, size: Math.min(0.32, h * 0.45), pos: at(0, h * 0.48, 0.69), rot, ink: P.ink, plate: P.marble, id: s, pad: 0.08 });
      const c = at(0, 0, 0);
      colliders.push({ kind: 'box', x: c[0], z: c[2], hw: 0.72, hd: 0.72, rot: yaw });
    });
  }

  // ------------------------------------------------------------------------------------------
  // More of the green: trees round the edges, beds at the beacon.
  // ------------------------------------------------------------------------------------------
  tree(-18.5, -18.5, 7.6, LEAVES[4], false);
  {
    // A round marble planter in the west corner, its tree, and moss creeping over the rim.
    const px = -21.5, pz = 4.5;
    const rim = b.newId();
    b.add(geo.cylinder(2.5, 2.6, 0.55, 18), { color: P.marble, pos: [px, 0, pz], id: rim });
    b.add(geo.cylinder(2.15, 2.15, 0.06, 18), { color: P.grassDeep, pos: [px, 0.52, pz], flat: 0.4 });
    for (let k = 0; k < 4; k++) {
      const a = k * 1.6 + 0.4;
      clump([px + Math.cos(a) * 2.45, 0.42, pz + Math.sin(a) * 2.45], [0.7, 0.28, 0.7], P.moss as string, [0, -a, 0], 3, 0);
    }
    for (let k = 0; k < 5; k++) {
      const a = k * 1.25 + 0.9;
      clump([px + Math.cos(a) * 1.5, 0.75, pz + Math.sin(a) * 1.5], [0.4, 0.3, 0.4], FLOWERS[k % FLOWERS.length], undefined, 3, 0.15);
    }
    colliders.push({ kind: 'circle', x: px, z: pz, r: 2.6 });
  }
  {
    // The planter tree stands in the soil, half a metre up.
    const s = 6.6 / 7, px = -21.5, pz = 4.5, y = 0.55;
    b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [px, y, pz], sway: 0.2, swayBase: y });
    const leaf = { gradient: { bottom: mix(LEAVES[1], P.shadow, 0.38), top: mix(LEAVES[1], '#ffffff', 0.12) }, color: LEAVES[1], sway: 0.5, swayBase: y };
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    const id = b.newId();
    b.add(ball, { ...leaf, id, pos: [px, y + 4.9 * s, pz], scale: [2.5 * s, 2.0 * s, 2.4 * s] });
    b.add(ball, { ...leaf, id, pos: [px - 1.4 * s, y + 4.5 * s, pz + 0.8 * s], scale: [1.5 * s, 1.25 * s, 1.45 * s] });
    b.add(ball, { ...leaf, pos: [px + 1.5 * s, y + 4.0 * s, pz - 0.5 * s], scale: [1.7 * s, 1.35 * s, 1.6 * s] });
  }
  // Two verdigris lamps on the plaza.
  for (const [lx, lz] of [[5.0, -6.0], [14.5, 3.6]] as const) {
    b.add(geo.cylinder(0.24, 0.3, 0.5, 8), { color: P.verdigris, pos: [lx, 0, lz] });
    b.add(geo.cylinder(0.08, 0.11, 4.2, 6), { color: P.verdigris, pos: [lx, 0.5, lz] });
    b.add(geo.torus(0.16, 0.05, 8, 4), { color: P.verdigris, pos: [lx, 4.7, lz], rot: [Math.PI / 2, 0, 0] });
    b.add(geo.sphere(0.32, 10, 7), { color: LIT, pos: [lx, 5.0, lz], flat: 0.8 });
    b.add(geo.cone(0.36, 0.3, 8), { color: P.verdigris, pos: [lx, 5.25, lz] });
  }
  tree(-4.5, 22.5, 7.2, LEAVES[3]);
  tree(-12.5, 24.0, 6.4, LEAVES[0], false);
  tree(23.5, 9.5, 7.0, LEAVES[1], false);
  tree(9.0, -26.0, 6.0, LEAVES[3], false);
  if (!low) {
    tree(-3.0, -8.0, 6.2, LEAVES[4]);
    tree(24.5, -19.0, 6.4, LEAVES[0]);
  }
  for (let k = 0; k < 3; k++) {
    const a = -0.3 + k * 2.1;
    bed(BX + Math.cos(a) * 5.0, BZ + Math.sin(a) * 5.0, 0.9, low ? 3 : 4);
  }
  // A hedge along the back of the north green.
  clump([-8, 0.5, -24.6], [3.4, 0.75, 0.9], LEAVES[2], [0, 0.08, 0], 6);
  clump([-1.0, 0.5, -24.9], [2.6, 0.7, 0.9], LEAVES[4], [0, 0.08, 0], 5);

  group.add(b.build('commons-static'));

  // ------------------------------------------------------------------------------------------
  // The stools. One hundred and sixty of them in curved rows on the steps. The top two rows have
  // run out of steps and go on regardless, in the air over the bank.
  // ------------------------------------------------------------------------------------------
  const sb = kit.builder();
  sb.add(geo.cylinder(0.22, 0.22, 0.07, low ? 6 : 10), { color: '#ffffff', pos: [0, 0.42, 0] });
  sb.add(geo.cylinder(0.035, 0.05, 0.42, 4), { color: '#d8d4e4', pos: [0, 0, 0] });
  sb.add(geo.cylinder(0.16, 0.18, 0.03, low ? 5 : 8), { color: '#d8d4e4', pos: [0, 0, 0] });
  const stoolGeo = sb.geometry ? sb.geometry() : geo.cylinder(0.22, 0.22, 0.49, 8);
  const ROWS = TIERS + 2;
  const rowR: number[] = [];
  const rowY: number[] = [];
  for (let i = 0; i < ROWS; i++) {
    rowR.push(R_ORCH + (i + 0.5) * TREAD);
    rowY.push(i < TIERS ? FLOOR + (i + 1) * RISE : H_TOP + 1.3 + (i - TIERS) * 1.5);
  }
  const TOTAL = 160;
  const sumR = rowR.reduce((s, r) => s + r, 0);
  const counts = rowR.map((r) => Math.round((TOTAL * r) / sumR));
  counts[ROWS - 1] += TOTAL - counts.reduce((s, c) => s + c, 0);
  const onSteps = counts.slice(0, TIERS).reduce((s, c) => s + c, 0);
  const steps = kit.instances(stoolGeo, onSteps, { flat: 0.2 });
  const floating = kit.instances(stoolGeo, TOTAL - onSteps, { flat: 0.2 });
  steps.name = 'commons-stools';
  floating.name = 'commons-stools-air';
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    const cBlue = new THREE.Color(BLUE);
    const cCoral = new THREE.Color(CORAL);
    const cCream = new THREE.Color(CREAM);
    let si = 0, fi = 0;
    for (let i = 0; i < ROWS; i++) {
      const n = counts[i];
      const span = 2 * SPAN - 6 * DEG;
      for (let k = 0; k < n; k++) {
        let a = AC - span / 2 + ((k + 0.5) / n) * span;
        // Leave the coral aisle clear on the steps.
        const gap = 0.55 / rowR[i];
        if (i < TIERS && Math.abs(a - AC) < gap) a = AC + Math.sign(a - AC || 1) * gap;
        const air = i >= TIERS;
        const wob = air ? (rng() - 0.5) * 0.5 : 0;
        v.set(TX + Math.cos(a) * rowR[i], rowY[i] + wob, TZ + Math.sin(a) * rowR[i]);
        e.set(air ? (rng() - 0.5) * 0.35 : 0, rng() * 6.28, air ? (rng() - 0.5) * 0.35 : 0);
        q.setFromEuler(e);
        m.compose(v, q, one);
        const r = rng();
        col.copy(r < 0.62 ? cBlue : r < 0.86 ? cCoral : cCream);
        if (air) {
          floating.setMatrixAt(fi, m);
          floating.setColorAt(fi++, col);
        } else {
          steps.setMatrixAt(si, m);
          steps.setColorAt(si++, col);
        }
      }
    }
    for (const mesh of [steps, floating]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  // ------------------------------------------------------------------------------------------
  // The light in the lantern: a lamp and two broad beams, turning slowly.
  // ------------------------------------------------------------------------------------------
  const lb = kit.builder();
  lb.add(geo.sphere(0.55, 12, 8), { color: LIT, flat: 1 });
  lb.add(geo.cylinder(0.75, 0.75, 0.3, 10), { color: CORAL, pos: [0, -0.85, 0], flat: 0.5 });
  lb.add(geo.cylinder(0.12, 0.12, 0.3, 5), { color: P.ink, pos: [0, -0.6, 0], flat: 0.5 });
  const BEAM_L = low ? 8 : 11;
  const beam = geo.cone(1.7, BEAM_L, 12);
  lb.add(beam, { color: BEAM, pos: [BEAM_L, 0, 0], rot: [0, 0, Math.PI / 2], flat: 1, dither: 0.45 });
  lb.add(beam, { color: BEAM, pos: [-BEAM_L, 0, 0], rot: [0, 0, -Math.PI / 2], flat: 1, dither: 0.45 });
  const light = lb.build('commons-beacon-light');
  light.position.set(BX, LAMP_Y, BZ);
  light.rotation.y = 0.9;
  group.add(light);

  // ------------------------------------------------------------------------------------------
  // Points of interest.
  // ------------------------------------------------------------------------------------------
  {
    const A = site.arrive;
    const al = Math.hypot(A.x - BX, A.z - BZ) || 1;
    const fx = (A.x - BX) / al, fz = (A.z - BZ) / al;
    if (has('black-at-boston')) pois.push({ entry: 'black-at-boston', x: BX + fx * 5.2, z: BZ + fz * 5.2, y: 2.6, reach: 4.5, prompt: 'Look up at the beacon' });
    const ao = AC + Math.PI;
    if (has('interview-prep')) pois.push({ entry: 'interview-prep', x: TX + Math.cos(ao) * 7.4, z: TZ + Math.sin(ao) * 7.4, y: 3.2, reach: 4.8, prompt: 'Read the whiteboards' });
    if (has('hackathon')) pois.push({ entry: 'hackathon', x: HX, z: HZ + 2.6, y: 2.0, reach: 4.5, prompt: 'Pull up to the bench' });
    if (has('meta-sourcer')) pois.push({ entry: 'meta-sourcer', x: DX + 1.6, z: DZ + 1.9, y: 2.2, reach: 4.5, prompt: 'Look over the sourcing desk' });
  }

  return {
    group,
    colliders,
    pois,
    update(_dt, t) {
      light.rotation.y = 0.9 + t * 0.35;
      floating.position.y = Math.sin(t * 0.45) * 0.18;
    },
    dispose() {
      stoolGeo.dispose();
    },
  };
}
