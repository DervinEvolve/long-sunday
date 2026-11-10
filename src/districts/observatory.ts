// The Observatory. The top of the avenue and the present day.
// A domed rotunda on a ring of fluted marble columns, its portico facing the street, with a brass
// telescope out through the roof. The one line the avenue has become runs from the kerb to a
// medallion at the door. Round the forecourt: an orrery, a stack of giant pages, a star chart under
// constellations that hang low and are wired up like an org chart, a brick perch with a clockwork
// bird going round it, a small white pavilion with one lamp, and a stream of paper lanterns that
// climbs round the dome.
//
// Everything is laid out in a frame turned to face the street: +z is toward the avenue, +x is to the
// right of someone walking in. One inner group carries the turn, so nothing below has to think
// about it. Colliders and points of interest are turned back into district space at the end.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, Poi } from '../types';

type V3 = [number, number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const UP = new THREE.Vector3(0, 1, 0);
const CORAL = '#ee6352';
const LIT = '#f6d98a';
const TRUNK = '#7a5a86';
const NIGHT = '#15173f';
const STARLIGHT = '#d8f4f8';

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

/** The kit turns parts in XYZ order. This gives the XYZ angles for "lean about x, then turn about y". */
function eul(lean: number, heading: number, roll = 0): V3 {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(lean, heading, roll, 'YXZ'));
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x, e.y, e.z];
}

/** A point given in a part's own space, once the part has been turned by `rot` and put at `pos`. */
function onPart(off: V3, pos: V3, rot: V3): V3 {
  const v = new THREE.Vector3(off[0], off[1], off[2]).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
  return [pos[0] + v.x, pos[1] + v.y, pos[2] + v.z];
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

/** A copy of a shape with its up axis laid along `axis`. */
function along(g: THREE.BufferGeometry, axis: THREE.Vector3): THREE.BufferGeometry {
  const out = g.clone();
  out.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, axis));
  return out;
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

/** A four pointed star, one unit from centre to tip, facing +z, with a little belly so it takes the light. */
function sparkle(waist = 0.3, belly = 0.22): THREE.BufferGeometry {
  const ring: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
    const r = i & 1 ? waist : 1;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const p: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ring[i], c = ring[(i + 1) % 8];
    p.push(a[0], a[1], 0, c[0], c[1], 0, 0, 0, belly);
    p.push(c[0], c[1], 0, a[0], a[1], 0, 0, 0, -belly);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** A strip lying on a ball of radius R about the origin: up one meridian from e0 to e1, `half` wide each side. */
function meridianStrip(R: number, azimuth: number, e0: number, e1: number, half: number, steps: number): { g: THREE.BufferGeometry; left: V3[]; right: V3[] } {
  const p: number[] = [];
  const n: number[] = [];
  const idx: number[] = [];
  const left: V3[] = [];
  const right: V3[] = [];
  const sx = Math.cos(azimuth), sz = -Math.sin(azimuth); // sideways, level
  for (let i = 0; i <= steps; i++) {
    const e = e0 + ((e1 - e0) * i) / steps;
    const cx = Math.cos(e) * Math.sin(azimuth) * R, cy = Math.sin(e) * R, cz = Math.cos(e) * Math.cos(azimuth) * R;
    for (const side of [-1, 1]) {
      let x = cx + sx * half * side, y = cy, z = cz + sz * half * side;
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      p.push(x * R, y * R, z * R);
      n.push(x, y, z);
      (side < 0 ? left : right).push([x * R, y * R, z * R]);
    }
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setIndex(idx);
  return { g, left, right };
}

/** One box of an org chart. A box with no reports is a leaf. */
interface Spec { tag?: string; kids: Spec[] }
const lead = (tag: string | undefined, ...kids: Spec[]): Spec => ({ tag, kids });
const reports = (n: number): Spec[] => Array.from({ length: n }, () => ({ kids: [] }));

export const district: DistrictModule = {
  id: 'observatory',
  build(ctx) {
    return buildObservatory(ctx);
  },
};

function buildObservatory(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const INDIGO = site.accents[0];
  const BRASS = site.accents[1];
  const CYAN = site.accents[2];
  const BRASS_DEEP = mix(BRASS, P.shadow, 0.42);
  const BRASS_LIGHT = mix(BRASS, '#ffffff', 0.38);
  const MARBLE_MID = mix(P.marble, P.marbleShade, 0.5);
  const PAD = mix(P.pave, INDIGO, 0.12);
  const SHADE = mix(PAD, P.shadow, 0.3);
  const GROUND = 0.045; // the plaza sits 3 cm proud of the pad: shadows and inlays go just above it

  // The frame. +z looks down the street the visitor came up.
  const al = Math.hypot(site.arrive.x, site.arrive.z) || 1;
  const yaw = Math.atan2(site.arrive.x / al, site.arrive.z / al);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const toLocal = (fx: number, fz: number): { x: number; z: number } => ({ x: fx * cs + fz * sn, z: -fx * sn + fz * cs });
  const groundAt = (fx: number, fz: number): number => ctx.groundAt(fx * cs + fz * sn, -fx * sn + fz * cs);
  const s0 = ctx.sun ?? FALLBACK_SUN;
  const sun: V3 = [s0[0] * cs - s0[2] * sn, s0[1], s0[0] * sn + s0[2] * cs];

  const group = new THREE.Group();
  group.name = 'observatory';
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
  const fit = (text: string, size: number, max: number): number => {
    const w = b.measure ? b.measure({ text, size }).width : text.length * size * 0.7;
    return w > max ? (size * max) / w : size;
  };
  const cast = (g: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: number | V3): void => {
    b.shadow?.(g, { color: SHADE, sun, pos, rot, scale, y: GROUND, lift: 0.01 });
  };

  // ------------------------------------------------------------------------------------------
  // Planting helpers.
  // ------------------------------------------------------------------------------------------
  const flameSeg = high ? 9 : 7;
  const flame = geo.lathe([[0.3, 0], [0.82, 0.55], [1.05, 1.9], [0.9, 3.7], [0.5, 5.3], [0, 6.3]], flameSeg, { cacheKey: 'observatory-cypress-' + flameSeg });
  const shadowBall = geo.sphere(1, 6, 4);
  // A cypress: one dark flame of leaf on a short trunk.
  const cypress = (x: number, z: number, h: number, y0?: number, shadow = true): void => {
    const y = y0 ?? groundAt(x, z);
    const k = h / 7;
    b.add(geo.cylinder(0.14 * k, 0.2 * k, 1.0 * k, 6, true), { color: TRUNK, pos: [x, y, z] });
    b.add(flame, { gradient: { bottom: '#245a4c', top: P.leafDeep }, color: P.leafDeep, pos: [x, y + 0.7 * k, z], scale: k, sway: 0.3, swayBase: y });
    if (shadow) cast(shadowBall, [x, y + 3.2 * k, z], undefined, [1.05 * k, 2.6 * k, 1.05 * k]);
  };
  // A clump of leaf: a hedge, moss on a footing, or ivy when it is pressed flat against stone.
  let clumpSeed = 31;
  const clump = (pos: V3, scale: V3, tint: ColorLike, rot?: V3, count = 4): void => {
    b.add(geo.blobs(clumpSeed++, count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos, rot, scale, sway: 0.1,
    });
  };
  // A clipped ball of box on a stem, in a marble tub.
  const topiary = (x: number, z: number, r: number): void => {
    b.add(geo.bevelBox(1.3, 0.6, 1.3, 0.06), { color: P.marble, pos: [x, 0, z] });
    b.add(geo.box(1.05, 0.08, 1.05), { color: P.grassDeep, pos: [x, 0.58, z], flat: 0.5 });
    b.add(geo.cylinder(0.09, 0.11, 1.0, 6, true), { color: TRUNK, pos: [x, 0.6, z] });
    b.add(geo.sphere(1, high ? 10 : 8, high ? 7 : 5), {
      gradient: { bottom: mix(P.grassDeep, P.shadow, 0.3), top: P.grass }, color: P.grassDeep, pos: [x, 1.5 + r, z], scale: r,
    });
    cast(shadowBall, [x, 1.5 + r, z], undefined, r);
    circle(x, z, 0.8);
  };

  // ------------------------------------------------------------------------------------------
  // The rotunda. Centre a little back from the middle of the pad so the forecourt has room.
  // ------------------------------------------------------------------------------------------
  const RZ = -9; // rotunda centre, on the axis of the street
  const RC = 7.0; // radius of the ring of columns
  const COL_H = 7.15; // top of the capital slab
  const ENT_TOP = COL_H + 1.5; // top of the cornice
  const DRUM_H = 3.0;
  const DOME_Y = ENT_TOP + DRUM_H + 0.25; // where the dome springs
  const DOME_R = 6.8;
  const ribs = low ? 6 : high ? 10 : 8;
  const shaft = flutedShaft(0.47, 0.4, COL_H - 1.15, ribs);
  const shaftShadow = geo.cylinder(0.44, 0.44, COL_H, 6);

  const column = (x: number, z: number, turn: number, shadow = true): void => {
    const rot: V3 = [0, turn, 0];
    b.add(geo.bevelBox(1.3, 0.35, 1.3, 0.05), { color: P.marbleShade, pos: [x, 0, z], rot });
    b.add(geo.cylinder(0.56, 0.62, 0.2, 10), { color: MARBLE_MID, pos: [x, 0.35, z] });
    b.add(shaft, { gradient: { bottom: mix(P.marble, P.marbleShade, 0.45), top: P.marble }, color: P.marble, pos: [x, 0.55, z], rot, flat: 0.25 });
    b.add(geo.cylinder(0.64, 0.42, 0.32, 10), { color: MARBLE_MID, pos: [x, COL_H - 0.6, z] });
    b.add(geo.box(1.25, 0.28, 1.25), { color: P.marble, pos: [x, COL_H - 0.28, z], rot });
    if (shadow) cast(shaftShadow, [x, 0, z]);
    circle(x, z, 0.72);
  };

  // The floor: a round of marble a few centimetres proud of the plaza, with two inlaid rings.
  const floorId = b.newId();
  const floorSeg = low ? 28 : 40;
  b.add(geo.cylinder(9.5, 9.5, 0.07, floorSeg), { color: MARBLE_MID, pos: [0, 0, RZ], id: floorId });
  b.add(geo.box(10.9, 0.07, 6.0), { color: MARBLE_MID, pos: [0, 0, RZ + RC + 1.4], id: floorId });
  b.add(geo.cylinder(8.3, 8.3, 0.1, floorSeg), { color: P.marble, pos: [0, 0, RZ] });
  b.add(geo.ring(4.5, 4.85, floorSeg), { color: INDIGO, pos: [0, 0.115, RZ], flat: 0.6 });
  b.add(geo.ring(1.9, 2.05, 24), { color: BRASS, pos: [0, 0.115, RZ], flat: 0.5 });

  // Twelve columns. The street axis falls in a gap, and that gap is the door.
  const N_COL = 12;
  for (let i = 0; i < N_COL; i++) {
    const a = ((i + 0.5) / N_COL) * Math.PI * 2;
    column(Math.sin(a) * RC, RZ + Math.cos(a) * RC, a);
  }

  // Entablature: one turned ring. Architrave and frieze, a cornice that steps out, an inside face.
  const ringSeg = low ? 24 : 36;
  const entabl = geo.lathe(
    [[RC - 0.75, COL_H], [RC + 0.75, COL_H], [RC + 0.75, ENT_TOP - 0.38], [RC + 1.12, ENT_TOP - 0.38], [RC + 1.12, ENT_TOP], [RC - 0.75, ENT_TOP], [RC - 0.75, COL_H]],
    ringSeg, { cacheKey: 'observatory-entablature-' + ringSeg },
  );
  b.add(entabl, { gradient: { bottom: P.marble, top: MARBLE_MID }, color: P.marble, pos: [0, 0, RZ], flat: 0.2 });
  cast(entabl, [0, 0, RZ]);
  // The ceiling under the dome: night blue with brass stars, for anyone who looks up from the floor.
  b.add(geo.disc(RC - 0.7, ringSeg), { color: NIGHT, pos: [0, COL_H + 0.7, RZ], rot: [Math.PI, 0, 0], flat: 0.7 });
  const ceilingStar = sparkle(0.34, 0.01);
  for (let i = 0; i < (low ? 7 : 13); i++) {
    const a = rng() * Math.PI * 2;
    const r = 1.4 + rng() * 4.2;
    b.add(ceilingStar, {
      color: i % 4 === 0 ? CYAN : BRASS_LIGHT, pos: [Math.sin(a) * r, COL_H + 0.66, RZ + Math.cos(a) * r],
      rot: [Math.PI / 2, 0, rng() * 1.5], scale: 0.22 + rng() * 0.3, flat: 1, outline: false,
    });
  }

  // The drum the dome sits on: marble, round windows lit from inside, a brass band on top.
  const drumSeg = low ? 20 : 28;
  b.add(geo.cylinder(6.95, 6.95, DRUM_H, drumSeg), { gradient: { bottom: MARBLE_MID, top: P.marble }, color: P.marble, pos: [0, ENT_TOP, RZ], flat: 0.2 });
  b.add(geo.cylinder(7.08, 7.08, 0.25, drumSeg), { color: BRASS, pos: [0, ENT_TOP + DRUM_H, RZ], flat: 0.3 });
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    const rot = eul(Math.PI / 2, a);
    const wx = Math.sin(a), wz = Math.cos(a);
    b.add(geo.disc(0.6, 12), { color: CYAN, pos: [wx * 7.0, ENT_TOP + 1.75, RZ + wz * 7.0], rot, flat: 1, outline: false });
    b.add(geo.ring(0.56, 0.76, 12), { color: BRASS, pos: [wx * 7.02, ENT_TOP + 1.75, RZ + wz * 7.02], rot, flat: 0.4 });
  }
  // The dome and the telescope turn, so they are their own mesh further down. Their shadow stays put.
  cast(geo.dome(DOME_R, 12, 4), [0, DOME_Y, RZ]);

  // The portico. Four columns out in front, a frieze with the name on it, a gable back to the drum.
  const PZ = RZ + RC + 3.3; // line of the front columns
  const PX = [1.81, 4.25];
  for (const side of [-1, 1]) for (const x of PX) column(side * x, PZ, 0);
  const porch = b.newId();
  const friezeGeo = geo.box(10.3, ENT_TOP - COL_H - 0.3, 1.3);
  b.add(friezeGeo, { color: P.marble, pos: [0, COL_H, PZ], id: porch, flat: 0.2 });
  cast(friezeGeo, [0, COL_H, PZ]);
  for (const side of [-1, 1]) b.add(geo.box(1.3, ENT_TOP - COL_H - 0.3, 4.3), { color: P.marble, pos: [side * 4.25, COL_H, PZ - 2.15], id: porch, flat: 0.2 });
  b.add(geo.bevelBox(11.1, 0.3, 6.2, 0.05), { color: P.marbleShade, pos: [0, ENT_TOP - 0.3, PZ - 2.2] });
  const GABLE = 1.8;
  const gable = geo.extrude([[-5.3, 0], [5.3, 0], [0, GABLE]], 6.0, { cacheKey: 'observatory-gable' });
  b.add(gable, { color: P.marble, pos: [0, ENT_TOP, PZ - 2.2], flat: 0.2 });
  const pitch = Math.atan2(GABLE, 5.3);
  for (const side of [-1, 1]) {
    b.add(geo.box(5.95, 0.14, 6.3), { color: P.verdigris, pos: [side * 2.72, ENT_TOP + GABLE / 2 - 0.02, PZ - 2.2], rot: [0, 0, -side * pitch] });
  }
  b.add(sparkle(0.36, 0.3), { color: BRASS, pos: [0, ENT_TOP + 0.78, PZ + 0.82], scale: 0.62, flat: 0.4 });
  const nameSize = fit('THE OBSERVATORY', 0.6, 9.2);
  b.label({ text: 'THE OBSERVATORY', size: nameSize, pos: [0, COL_H + 0.68, PZ + 0.65], ink: P.ink, plate: P.marble, id: porch, flat: 0.2, pad: 0.2, jitter: 0.3 });
  b.label({ text: site.years.toUpperCase(), size: 0.17, pos: [0, COL_H + 0.19, PZ + 0.65], ink: P.violet, plate: P.marble, id: porch, flat: 0.2, pad: 0.15 });

  // Under the dome: the eyepiece. A marble pier, a brass pipe up through the ceiling to the telescope.
  b.add(geo.cylinder(0.85, 1.0, 0.95, 12), { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [0, 0.1, RZ] });
  b.add(geo.cylinder(0.5, 0.6, 0.16, 10), { color: BRASS, pos: [0, 1.05, RZ], flat: 0.3 });
  b.add(geo.cylinder(0.17, 0.2, COL_H - 0.5, 8, true), { gradient: { bottom: BRASS, top: BRASS_DEEP }, color: BRASS, pos: [0, 1.2, RZ] });
  b.add(rod([0, 1.72, RZ], [0, 1.52, RZ + 1.0], 0.15, 0.11, 8), { color: BRASS_LIGHT, flat: 0.3 });
  b.add(rod([0, 1.535, RZ + 0.95], [0, 1.5, RZ + 1.12], 0.17, 0.17, 8), { color: BRASS_DEEP });
  b.add(rod([0, 1.5, RZ + 1.12], [0, 1.497, RZ + 1.135], 0.11, 0.11, 8), { color: CYAN, flat: 1 });
  b.add(geo.torus(0.33, 0.06, 12, 4), { color: BRASS_LIGHT, pos: [0, 1.75, RZ], flat: 0.3 });
  const plate = b.add(geo.box(1.25, 0.5, 0.08), { color: BRASS_LIGHT, pos: [0, 0.3, RZ + 0.96], flat: 0.5 });
  b.label({ text: 'MICROSOFT AI', size: fit('MICROSOFT AI', 0.13, 1.05), pos: [0, 0.62, RZ + 1.0], ink: P.ink, plate: BRASS_LIGHT, id: plate, flat: 0.5, pad: 0.1 });
  b.label({ text: 'THE PRESENT DAY', size: 0.07, pos: [0, 0.42, RZ + 1.0], ink: P.ink, plate: BRASS_LIGHT, id: plate, flat: 0.5, pad: 0.1 });
  circle(0, RZ, 1.05);
  poi('msai-role', 0, RZ + 2.3, 'Look through the telescope', 3.5);

  // Green on the stone: ivy up three of the columns and over the cornice, moss at the feet.
  const ivyAt = (i: number, h: number, tint: ColorLike): void => {
    const a = ((i + 0.5) / N_COL) * Math.PI * 2;
    const x = Math.sin(a) * (RC + 0.42), z = RZ + Math.cos(a) * (RC + 0.42);
    clump([x, 0.5 + h / 2, z], [0.55, h / 2, 0.75], tint, [0, a + Math.PI / 2, 0], 5);
    clump([Math.sin(a) * (RC + 0.9), 0.3, RZ + Math.cos(a) * (RC + 0.9)], [0.9, 0.4, 0.7], P.moss, [0, a, 0]);
  };
  ivyAt(2, 4.6, P.leafDeep);
  ivyAt(3, 2.6, P.leaf);
  ivyAt(8, 5.4, P.leafDeep);
  if (!low) {
    ivyAt(9, 2.2, P.grassDeep);
    for (const a of [1.25, 1.5, -2.2]) {
      clump([Math.sin(a) * (RC + 1.0), ENT_TOP - 0.25, RZ + Math.cos(a) * (RC + 1.0)], [0.5, 0.85, 1.3], P.leaf, [0, a + Math.PI / 2, 0], 5);
    }
  }
  clump([-5.0, COL_H + 0.3, PZ + 0.55], [1.0, 0.75, 0.4], P.leafDeep, undefined, 5);
  topiary(-6.9, PZ + 0.6, 0.85);
  topiary(6.9, PZ + 0.6, 0.85);

  // ------------------------------------------------------------------------------------------
  // The line. The avenue's two lines are one by the time they reach the kerb. It carries on to
  // the door and ends in a medallion: coral half, teal half, one colour in the middle.
  // ------------------------------------------------------------------------------------------
  const lineFrom = Math.hypot(site.arrive.x, site.arrive.z);
  const MED_Z = PZ + 3.3;
  b.add(geo.box(0.2, 0.03, lineFrom - MED_Z - 1.2), { color: P.violet, pos: [0, GROUND, (lineFrom + MED_Z + 1.2) / 2], flat: 1 });
  b.add(geo.cylinder(1.42, 1.42, 0.07, 24), { color: BRASS, pos: [0, GROUND - 0.02, MED_Z], flat: 0.4 });
  const half = (start: number): THREE.BufferGeometry => new THREE.CylinderGeometry(1.14, 1.14, 0.1, 14, 1, false, start, Math.PI).translate(0, 0.05, 0);
  const teal = half(0), coral = half(Math.PI);
  b.add(teal, { color: P.teal, pos: [0, GROUND, MED_Z], flat: 1 });
  b.add(coral, { color: CORAL, pos: [0, GROUND, MED_Z], flat: 1 });
  teal.dispose();
  coral.dispose();
  b.add(geo.cylinder(0.5, 0.5, 0.13, 14), { color: P.violet, pos: [0, GROUND, MED_Z], flat: 1 });

  // ------------------------------------------------------------------------------------------
  // The forecourt. Two lawns either side of the line, each with cypresses and a clipped ball.
  // ------------------------------------------------------------------------------------------
  for (const side of [-1, 1]) {
    const x = side * 5.5;
    b.add(geo.box(4.8, 0.06, 13.4), { color: P.paveShade, pos: [x, GROUND - 0.02, 13.6] });
    b.add(geo.box(4.3, 0.1, 12.9), { color: P.grass, pos: [x, GROUND - 0.02, 13.6] });
    b.add(geo.box(2.6, 0.02, 11.2), { color: P.grassLight, pos: [x, GROUND + 0.085, 13.6], flat: 0.4, outline: false });
    // The tall ones stand at the far end, by the door, so the way in stays open to either side.
    cypress(x, 8.8, 5.6, 0.1);
    circle(x, 8.8, 0.5);
    clump([x, 0.6, 12.4], [1.0, 0.7, 1.0], P.grassDeep, undefined, 5);
    circle(x, 12.4, 0.85);
    clump([x, 0.55, 18.4], [1.2, 0.65, 1.2], P.leafDeep, undefined, 5);
    circle(x, 18.4, 0.95);
  }

  // Brass stars set in the paving either side of the line, and a pair of lamps half way up the lawns.
  const stud = sparkle(0.34, 0.02);
  for (let i = 0; i < 5; i++) {
    const z = MED_Z + 3.2 + i * 3.4;
    for (const side of [-1, 1]) {
      b.add(stud, { color: BRASS, pos: [side * 1.05, GROUND + 0.012, z], rot: [-Math.PI / 2, 0, i * 0.4], scale: 0.24, flat: 0.5, outline: false });
    }
  }
  stud.dispose();
  const lamp = (x: number, z: number): void => {
    b.add(geo.cylinder(0.2, 0.26, 0.3, 8), { color: BRASS_DEEP, pos: [x, 0.08, z] });
    b.add(geo.cylinder(0.06, 0.09, 2.9, 6, true), { color: BRASS, pos: [x, 0.38, z] });
    b.add(geo.cylinder(0.2, 0.08, 0.14, 8), { color: BRASS, pos: [x, 3.24, z], flat: 0.3 });
    b.add(geo.sphere(0.32, 10, 7), { color: LIT, pos: [x, 3.66, z], flat: 1 });
    b.add(geo.cone(0.14, 0.2, 6), { color: BRASS, pos: [x, 3.94, z], flat: 0.3 });
  };
  for (const side of [-1, 1]) lamp(side * 3.55, 15.4);

  // Two curved lawns by the kerb at the front, with a pair of street trees on each.
  const tree = (x: number, z: number, h: number, tint: ColorLike): void => {
    const k = h / 7;
    b.add(geo.cylinder(0.2 * k, 0.32 * k, 3.9 * k, 6, true), { color: TRUNK, pos: [x, 0.1, z], sway: 0.2, swayBase: 0 });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: 0 };
    const id = b.newId();
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    const turn = rng() * 6.28;
    const tc = Math.cos(turn), ts = Math.sin(turn);
    b.add(ball, { ...leaf, id, pos: [x, 4.9 * k, z], scale: [2.5 * k, 2.0 * k, 2.4 * k] });
    b.add(ball, { ...leaf, id, pos: [x - 1.6 * k * tc, 4.6 * k, z + 1.6 * k * ts], scale: [1.5 * k, 1.25 * k, 1.45 * k] });
    b.add(ball, { ...leaf, pos: [x + 1.6 * k * tc, 4.0 * k, z - 1.6 * k * ts], scale: [1.7 * k, 1.35 * k, 1.6 * k] });
    cast(ball, [x, 4.9 * k, z], undefined, [2.5 * k, 2.0 * k, 2.4 * k]);
    circle(x, z, 0.4 * k);
  };
  const lawnSeg = low ? 8 : 12;
  for (const side of [-1, 1]) {
    const a0 = (26 * Math.PI) / 180, arc = (46 * Math.PI) / 180;
    const ry = (side > 0 ? a0 : -a0 - arc) - Math.PI / 2;
    b.add(geo.ring(26.1, 31.7, lawnSeg, arc + 0.02), { color: P.paveShade, pos: [0, GROUND + 0.02, 0], rot: [0, ry - 0.01, 0] });
    b.add(geo.ring(26.4, 31.4, lawnSeg, arc), { color: P.grass, pos: [0, GROUND + 0.05, 0], rot: [0, ry, 0] });
    b.add(geo.ring(27.6, 30.2, lawnSeg, arc - 0.1), { color: P.grassLight, pos: [0, GROUND + 0.065, 0], rot: [0, ry + 0.05, 0], flat: 0.4, outline: false });
    for (const [deg, h, tint] of [[36, 6.6, P.leaf], [60, 7.4, P.grassDeep]] as const) {
      const a = (side * deg * Math.PI) / 180;
      tree(Math.sin(a) * 28.9, Math.cos(a) * 28.9, h, tint);
    }
    const a = (side * 48 * Math.PI) / 180;
    clump([Math.sin(a) * 29.3, 0.45, Math.cos(a) * 29.3], [1.5, 0.6, 1.0], P.grassDeep, [0, a + Math.PI / 2, 0], 5);
  }

  // Round the back: brick planters with a clipped hedge and a cypress in every other one.
  const HEDGE_R = 30.4;
  const segs = low ? 12 : 16;
  const span = (136 * Math.PI) / 180;
  const brickFoot = mix(P.brick, P.brickDeep, 0.6);
  for (let i = 0; i < segs; i++) {
    if (i === segs / 2 - 1 || i === segs / 2) continue; // a gap at the back to look out north
    const a = Math.PI - span / 2 + ((i + 0.5) / segs) * span;
    const x = Math.sin(a) * HEDGE_R, z = Math.cos(a) * HEDGE_R;
    const len = (span / segs) * HEDGE_R - 0.5;
    const rot: V3 = [0, a + Math.PI / 2, 0];
    b.add(geo.box(len, 0.62, 1.5), { gradient: { bottom: brickFoot, top: P.brick }, color: P.brick, pos: [x, 0, z], rot, hatch: 0.12 });
    b.add(geo.box(len + 0.16, 0.12, 1.66), { color: P.marble, pos: [x, 0.62, z], rot });
    b.add(geo.bevelBox(len - 0.3, 0.75, 1.1, 0.16), { gradient: { bottom: mix(P.grassDeep, P.shadow, 0.3), top: P.grassDeep }, color: P.grassDeep, pos: [x, 0.72, z], rot });
    if (i % 2 === 0) cypress(x, z, 6.2 + rng() * 2.2, 1.3);
    else if (!low) clump([x + Math.sin(a) * 0.75, 0.45, z + Math.cos(a) * 0.75], [len * 0.3, 0.5, 0.35], P.leaf, rot);
    boxed(x, z, len / 2 + 0.1, 0.85, a + Math.PI / 2);
  }
  // And out on the grass past the kerb, a few more against the sky.
  if (!low) {
    for (const deg of [-98, -72, 78, 104, 127, -128, 180]) {
      const a = (deg * Math.PI) / 180;
      const r = 36.4 + rng() * 1.6;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      cypress(x, z, 7 + rng() * 3, undefined, false);
      circle(x, z, 0.5);
    }
  }

  // ------------------------------------------------------------------------------------------
  // The orrery [model-teams]. Seven brass rings on a tilt, a bead on each, and a lectern for
  // every team round the foot. The beads are their own mesh so they can go round.
  // ------------------------------------------------------------------------------------------
  const OX = -13.2, OZ = 7.2;
  const TEAMS = ['PRE-TRAINING', 'POST-TRAINING', 'MULTIMODAL', 'SPEECH', 'TEXT', 'INFERENCE', 'DATA'];
  const ORB_TINT = [CYAN, CORAL, LIT, P.pink, P.mint, P.lavender, P.orange];
  const ORB_R = [0.23, 0.27, 0.34, 0.25, 0.3, 0.38, 0.28];
  const ringR = (k: number): number => 1.05 + k * 0.43;
  const ORRERY_Y = 2.75;
  // The rings tip toward the middle of the forecourt, so the low side is where people stand.
  const od = new THREE.Vector3(0.84, 0, 0.54).normalize();
  const TILT = 0.5;
  const on = new THREE.Vector3(od.x * Math.sin(TILT), Math.cos(TILT), od.z * Math.sin(TILT));
  const ou = new THREE.Vector3(od.x * Math.cos(TILT), -Math.sin(TILT), od.z * Math.cos(TILT));
  const ov = new THREE.Vector3().crossVectors(on, ou);
  const oc: V3 = [OX, ORRERY_Y, OZ];
  const onRing = (r: number, a: number): V3 => [
    OX + (ou.x * Math.cos(a) + ov.x * Math.sin(a)) * r,
    ORRERY_Y + (ou.y * Math.cos(a) + ov.y * Math.sin(a)) * r,
    OZ + (ou.z * Math.cos(a) + ov.z * Math.sin(a)) * r,
  ];
  {
    const baseSeg = low ? 20 : 28;
    b.add(geo.cylinder(4.0, 4.1, 0.22, baseSeg), { color: P.marbleShade, pos: [OX, 0, OZ] });
    const step = geo.cylinder(3.2, 3.3, 0.24, baseSeg);
    b.add(step, { color: P.marble, pos: [OX, 0.22, OZ] });
    b.add(geo.cylinder(0.75, 0.95, 0.4, 10), { color: MARBLE_MID, pos: [OX, 0.46, OZ] });
    b.add(geo.cylinder(0.16, 0.26, ORRERY_Y - 0.86, 8, true), { gradient: { bottom: BRASS_DEEP, top: BRASS }, color: BRASS, pos: [OX, 0.86, OZ] });
    // The axis through the middle, a lamp for a sun, a pointer on top.
    b.add(rod([OX - on.x * 1.0, ORRERY_Y - on.y * 1.0, OZ - on.z * 1.0], [OX + on.x * 1.9, ORRERY_Y + on.y * 1.9, OZ + on.z * 1.9], 0.07, 0.05, 6), { color: BRASS_DEEP });
    b.add(geo.sphere(0.55, 12, 8), { color: LIT, pos: oc, flat: 0.85 });
    b.add(geo.sphere(0.14, 8, 5), { color: BRASS_LIGHT, pos: [OX + on.x * 1.95, ORRERY_Y + on.y * 1.95, OZ + on.z * 1.95], flat: 0.4 });
    // Two spokes carry the rings.
    const reach = ringR(6) + 0.12;
    b.add(rod(onRing(reach, 0), onRing(reach, Math.PI), 0.045, 0.045, 5), { color: BRASS_DEEP });
    b.add(rod(onRing(reach, Math.PI / 2), onRing(reach, -Math.PI / 2), 0.045, 0.045, 5), { color: BRASS_DEEP });
    const torSeg = low ? 18 : high ? 30 : 24;
    for (let k = 0; k < 7; k++) {
      const ring = along(geo.torus(ringR(k), 0.05, torSeg, 4), on);
      b.add(ring, { color: k % 2 ? BRASS : BRASS_LIGHT, pos: oc, flat: 0.35 });
      ring.dispose();
    }
    cast(geo.cylinder(ringR(6), ringR(6), 0.1, 14), [OX, ORRERY_Y, OZ]);
    // Seven lecterns round the low side, one for each team, capped in the colour of its bead.
    const mid = Math.atan2(od.x, od.z);
    for (let k = 0; k < 7; k++) {
      const a = mid + (k - 3) * 0.3;
      const pos: V3 = [OX + Math.sin(a) * 3.72, 0.2, OZ + Math.cos(a) * 3.72];
      const rot = eul(-0.5, a);
      const slab = b.add(geo.bevelBox(1.07, 0.66, 0.16, 0.03), { color: P.marble, pos, rot, flat: 0.3 });
      b.add(geo.box(1.09, 0.1, 0.2), { color: ORB_TINT[k], pos: onPart([0, 0.64, 0], pos, rot), rot, flat: 0.7 });
      b.label({ text: TEAMS[k], size: fit(TEAMS[k], 0.118, 0.9), pos: onPart([0, 0.31, 0.085], pos, rot), rot, ink: P.ink, plate: P.marble, id: slab, flat: 0.3, pad: 0.1, lift: 0.005 });
    }
    circle(OX, OZ, 4.15);
    poi('model-teams', OX + od.x * 4.6, OZ + od.z * 4.6, 'Watch the orrery turn', 4.9, 5);
  }

  // ------------------------------------------------------------------------------------------
  // Pages and Tasks [pm-hiring]. A stack of pages the size of a room, two more standing in the
  // air behind it, and three task tablets leaning about with their boxes ticked.
  // ------------------------------------------------------------------------------------------
  {
    const X = 12.3, Z = 10.2;
    const head = Math.atan2(-0.72, 0.69); // faces the line and the way in
    const hc = Math.cos(head), hs = Math.sin(head);
    const at = (lx: number, y: number, lz: number): V3 => [X + lx * hc + lz * hs, y, Z - lx * hs + lz * hc];
    const PAPER = [P.paper, mix(P.paper, P.lavender, 0.22), P.bone, mix(P.paper, CYAN, 0.18)];
    const sheet = geo.box(3.4, 0.13, 4.4);
    const sheets = low ? 6 : 8;
    for (let i = 0; i < sheets; i++) {
      b.add(sheet, { color: PAPER[i % PAPER.length], pos: at((rng() - 0.5) * 0.3, i * 0.14, (rng() - 0.5) * 0.3), rot: [0, head + (rng() - 0.5) * 0.3, 0], flat: 0.3 });
    }
    const top = sheets * 0.14;
    cast(geo.box(3.5, top, 4.5), at(0, 0, 0), [0, head, 0]);
    // The page that stands up. Its heading is the word, its body is ruled lines.
    const pageGeo = geo.box(3.3, 4.4, 0.1);
    const pagePos = at(-0.2, top + 0.55, -1.1);
    const page = b.add(pageGeo, { color: P.paper, pos: pagePos, rot: [0, head, 0], flat: 0.45 });
    cast(pageGeo, pagePos, [0, head, 0]);
    b.label({ text: 'PAGES', size: 0.5, pos: at(-0.2, top + 4.2, -1.04), rot: [0, head, 0], ink: P.ink, plate: P.paper, id: page, flat: 0.45, pad: 0.2 });
    const RULE = mix(P.lavender, P.paper, 0.25);
    for (let i = 0; i < 6; i++) {
      const w = i === 5 ? 1.5 : 2.5;
      b.add(geo.box(w, 0.09, 0.03), { color: RULE, pos: at(-0.2 - (2.5 - w) / 2, top + 3.35 - i * 0.48, -1.04), rot: [0, head, 0], flat: 1, outline: false });
    }
    // One more behind it, higher, already drifting off.
    const page2 = at(1.5, top + 2.1, -2.4);
    b.add(geo.box(3.0, 4.0, 0.1), { color: PAPER[1], pos: page2, rot: eul(0.1, head + 0.32, 0.12), flat: 0.45 });
    // Task tablets: a slate, a pale face, three boxes and three ticks.
    const tablet = (lx: number, lz: number, turn: number, lean: number, done: number): void => {
      const pos = at(lx, 0, lz);
      const rot = eul(-lean, head + turn);
      b.add(geo.bevelBox(1.6, 2.5, 0.22, 0.09), { color: INDIGO, pos, rot });
      const face = b.add(geo.box(1.3, 2.1, 0.04), { color: P.paper, pos: onPart([0, 0.2, 0.1], pos, rot), rot, flat: 0.6 });
      b.label({ text: 'TASKS', size: 0.19, pos: onPart([0, 2.0, 0.145], pos, rot), rot, ink: P.ink, plate: P.paper, id: face, flat: 0.6, pad: 0.1, lift: 0.005 });
      for (let i = 0; i < 3; i++) {
        const y = 1.5 - i * 0.48;
        b.add(geo.box(0.26, 0.26, 0.03), { color: i < done ? BRASS : P.marbleShade, pos: onPart([-0.42, y - 0.13, 0.14], pos, rot), rot, flat: 0.6 });
        b.add(geo.box(0.62, 0.08, 0.02), { color: RULE, pos: onPart([0.2, y - 0.04, 0.14], pos, rot), rot, flat: 1, outline: false });
      }
      const c = at(lx, 0, lz - 0.25);
      circle(c[0], c[2], 0.85);
    };
    tablet(2.75, 1.5, 0.25, 0.2, 3);
    tablet(-2.7, 1.9, -0.3, 0.16, 2);
    if (!low) tablet(3.6, -0.6, 0.6, 0.12, 1);
    boxed(X, Z, 1.9, 2.45, head);
    const p = at(1.0, 0, 3.5);
    poi('pm-hiring', p[0], p[2], 'Read the top page', 2.1, 5);
  }

  // ------------------------------------------------------------------------------------------
  // The star chart [talent-map]. A tilted dial with the chart drawn on it in small. The real
  // one hangs overhead: see the sky mesh below.
  // ------------------------------------------------------------------------------------------
  const TX = -18.2, TZ = -3.6;
  const tableHead = Math.atan2(0.86, 0.5);
  {
    const fx = Math.sin(tableHead), fz = Math.cos(tableHead);
    b.add(geo.cylinder(0.95, 1.1, 0.3, 10), { color: P.marbleShade, pos: [TX - fx * 0.5, 0, TZ - fz * 0.5] });
    b.add(geo.cylinder(0.42, 0.6, 1.25, 10), { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [TX - fx * 0.5, 0.3, TZ - fz * 0.5] });
    const LEAN = 0.98;
    const rot = eul(LEAN, tableHead);
    const pos: V3 = [TX, 1.55, TZ];
    b.add(geo.cylinder(1.5, 1.5, 0.1, 22), { color: BRASS, pos: onPart([0, -0.1, 0], pos, rot), rot, flat: 0.3 });
    const dial = b.add(geo.cylinder(1.36, 1.36, 0.06, 22), { color: INDIGO, pos, rot, flat: 0.6 });
    const dot = geo.cylinder(1, 1, 0.04, 8);
    const mark = (x: number, z: number, r: number, c: ColorLike): void => {
      b.add(dot, { color: c, pos: onPart([x, 0.06, z], pos, rot), rot, scale: [r, 1, r], flat: 1, outline: false });
    };
    const wire = (x0: number, z0: number, x1: number, z1: number): void => {
      const w = Math.max(0.035, Math.abs(x1 - x0)), d = Math.max(0.035, Math.abs(z1 - z0));
      b.add(geo.box(w, 0.02, d), { color: STARLIGHT, pos: onPart([(x0 + x1) / 2, 0.06, (z0 + z1) / 2], pos, rot), rot, flat: 1, outline: false });
    };
    // Root, three leads, six reports. Up the dial is -z.
    mark(0, -0.9, 0.11, LIT);
    wire(0, -0.9, 0, -0.62);
    wire(-0.7, -0.62, 0.7, -0.62);
    for (let i = -1; i <= 1; i++) {
      const x = i * 0.7;
      wire(x, -0.62, x, -0.36);
      mark(x, -0.36, 0.085, CYAN);
      wire(x, -0.36, x, -0.1);
      wire(x - 0.2, -0.1, x + 0.2, -0.1);
      for (const s of [-1, 1]) {
        wire(x + s * 0.2, -0.1, x + s * 0.2, 0.12);
        mark(x + s * 0.2, 0.14, 0.06, STARLIGHT);
      }
    }
    b.label({
      text: 'MAP OF THE FIELD', size: 0.13, pos: onPart([0, 0.065, 0.68], pos, rot), rot: eul(LEAN - Math.PI / 2, tableHead),
      ink: P.marble, plate: INDIGO, id: dial, flat: 0.6, pad: 0.1, lift: 0.004,
    });
    cast(geo.cylinder(1.3, 1.3, 0.2, 10), [TX, 1.5, TZ]);
    circle(TX - fx * 0.3, TZ - fz * 0.3, 1.25);
    poi('talent-map', TX + fx * 2.9, TZ + fz * 2.9, 'Read the star chart', 3.1, 5);
  }

  // ------------------------------------------------------------------------------------------
  // The scout's perch [scout]. A brick pier with ivy on it and a brass bar on top. The bird
  // itself is its own mesh, going round overhead.
  // ------------------------------------------------------------------------------------------
  const SX = 17.2, SZ = -3.6;
  {
    const head = Math.atan2(-0.86, 0.5);
    const rot: V3 = [0, head, 0];
    const fx = Math.sin(head), fz = Math.cos(head);
    b.add(geo.bevelBox(1.9, 0.3, 1.9, 0.05), { color: P.marbleShade, pos: [SX, 0, SZ], rot });
    const pierGeo = geo.box(1.4, 2.4, 1.4);
    b.add(pierGeo, { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, pos: [SX, 0.3, SZ], rot, hatch: 0.12 });
    cast(pierGeo, [SX, 0.3, SZ], rot);
    for (const y of [0.95, 1.6, 2.25]) b.add(geo.box(1.44, 0.05, 1.44), { color: P.brickDeep, pos: [SX, y, SZ], rot, outline: false });
    b.add(geo.bevelBox(1.7, 0.24, 1.7, 0.05), { color: P.marble, pos: [SX, 2.7, SZ], rot });
    b.add(geo.cylinder(0.07, 0.1, 1.3, 6, true), { color: BRASS, pos: [SX, 2.94, SZ] });
    b.add(rod([SX - fz * 1.0, 4.2, SZ + fx * 1.0], [SX + fz * 1.0, 4.2, SZ - fx * 1.0], 0.06, 0.06, 6), { color: BRASS_LIGHT, flat: 0.3 });
    b.add(geo.sphere(0.12, 8, 5), { color: BRASS_LIGHT, pos: [SX, 4.26, SZ], flat: 0.4 });
    const tag = b.add(geo.box(1.0, 0.42, 0.06), { color: P.marble, pos: [SX + fx * 0.71, 1.55, SZ + fz * 0.71], rot, flat: 0.4 });
    b.label({ text: 'SCOUT', size: 0.2, pos: [SX + fx * 0.75, 1.76, SZ + fz * 0.75], rot, ink: P.ink, plate: P.marble, id: tag, flat: 0.4, pad: 0.1 });
    clump([SX - fx * 0.74, 1.5, SZ - fz * 0.74], [0.9, 1.3, 0.4], P.leafDeep, rot, 5);
    clump([SX + fz * 0.74, 1.0, SZ - fx * 0.74], [0.4, 0.9, 0.8], P.leaf, rot);
    clump([SX + fz * 0.3 + fx * 0.9, 0.3, SZ - fx * 0.3 + fz * 0.9], [0.6, 0.35, 0.4], P.moss, rot);
    boxed(SX, SZ, 0.95, 0.95, head);
    poi('scout', SX + fx * 2.6, SZ + fz * 2.6, 'Watch the scout fly', 3.2, 5);
  }

  // ------------------------------------------------------------------------------------------
  // The pavilion [mayo]. Small, white, open on all sides, with one lamp hung in the middle.
  // ------------------------------------------------------------------------------------------
  {
    const X = 15.4, Z = -20.2;
    const head = -0.34;
    const hc = Math.cos(head), hs = Math.sin(head);
    const at = (lx: number, y: number, lz: number): V3 => [X + lx * hc + lz * hs, y, Z - lx * hs + lz * hc];
    const rot: V3 = [0, head, 0];
    b.add(geo.bevelBox(5.6, 0.1, 5.6, 0.04), { color: P.marbleShade, pos: at(0, 0, 0), rot });
    b.add(geo.box(4.9, 0.13, 4.9), { color: P.marble, pos: at(0, 0, 0), rot });
    const post = geo.cylinder(0.2, 0.25, 3.0, 8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = at(sx * 2.05, 0, sz * 2.05);
      b.add(geo.box(0.7, 0.3, 0.7), { color: MARBLE_MID, pos: [p[0], 0.1, p[2]], rot });
      b.add(post, { color: P.marble, pos: [p[0], 0.4, p[2]], flat: 0.25 });
      b.add(geo.box(0.66, 0.2, 0.66), { color: MARBLE_MID, pos: [p[0], 3.4, p[2]], rot });
      cast(post, [p[0], 0.4, p[2]]);
      circle(p[0], p[2], 0.42);
    }
    const beamGeo = geo.box(5.0, 0.62, 5.0);
    const beam = b.add(beamGeo, { color: P.marble, pos: at(0, 3.6, 0), rot, flat: 0.25 });
    cast(beamGeo, at(0, 3.6, 0), rot);
    b.add(geo.bevelBox(5.5, 0.18, 5.5, 0.04), { color: P.marbleShade, pos: at(0, 4.22, 0), rot });
    b.add(geo.prism(4, 0.5, 3.6, 1.25), { color: P.verdigris, pos: at(0, 4.4, 0), rot: [0, head + Math.PI / 4, 0] });
    b.add(geo.sphere(0.24, 8, 6), { color: BRASS, pos: at(0, 5.75, 0), flat: 0.4 });
    b.label({ text: 'THE CLINIC LAMP', size: fit('THE CLINIC LAMP', 0.27, 4.4), pos: at(0, 3.91, 2.5), rot, ink: P.ink, plate: P.marble, id: beam, flat: 0.25, pad: 0.15 });
    // The lamp: a chain, a brass cap, a paper-yellow glass, a brass foot.
    b.add(geo.cylinder(0.03, 0.03, 0.65, 5, true), { color: BRASS_DEEP, pos: at(0, 2.95, 0) });
    b.add(geo.cone(0.34, 0.3, 6), { color: BRASS, pos: at(0, 2.68, 0), flat: 0.3 });
    b.add(geo.prism(6, 0.27, 0.2, 0.56), { color: LIT, pos: at(0, 2.12, 0), flat: 1 });
    b.add(geo.cylinder(0.14, 0.22, 0.1, 6), { color: BRASS, pos: at(0, 2.02, 0), flat: 0.3 });
    // A bench to sit on under it.
    b.add(geo.bevelBox(2.4, 0.14, 0.7, 0.04), { color: P.marble, pos: at(0, 0.5, -1.55), rot });
    for (const sx of [-1, 1]) b.add(geo.box(0.3, 0.4, 0.6), { color: MARBLE_MID, pos: at(sx * 0.85, 0.12, -1.55), rot });
    const bench = at(0, 0, -1.55);
    boxed(bench[0], bench[2], 1.25, 0.4, head);
    clump(at(-2.75, 0.3, 1.9), [0.8, 0.4, 0.6], P.moss, rot);
    clump(at(2.8, 0.25, -1.2), [0.6, 0.35, 0.9], P.moss, rot);
    clump(at(2.42, 2.3, 2.2), [0.35, 1.5, 0.5], P.leafDeep, rot, 5);
    const p = at(0, 0, 3.6);
    poi('mayo', p[0], p[2], 'Stand by the lamp', 2.3, 5);
  }

  // ------------------------------------------------------------------------------------------
  // The lantern table [agent-swarms]. Where each one is lit and let go. The swarm itself is
  // an instanced mesh further down.
  // ------------------------------------------------------------------------------------------
  const LX = -13, LZ = -21;
  const lanternShape = (lb: ReturnType<typeof kit.builder>, pos?: V3, scale?: number, tint: ColorLike = '#ffffff'): void => {
    const s = scale ?? 1;
    const p = pos ?? [0, 0, 0];
    lb.add(geo.cylinder(0.34, 0.22, 0.66, 8), { color: tint, pos: [p[0], p[1] - 0.33 * s, p[2]], scale: s, flat: 0.85 });
    lb.add(geo.cylinder(0.24, 0.24, 0.07, 8, true), { color: mix(BRASS, '#ffffff', 0.5), pos: [p[0], p[1] - 0.4 * s, p[2]], scale: s, flat: 0.5 });
  };
  {
    const head = Math.atan2(-LX, -LZ + RZ + 6);
    const rot: V3 = [0, head, 0];
    const hc = Math.cos(head), hs = Math.sin(head);
    const at = (lx: number, y: number, lz: number): V3 => [LX + lx * hc + lz * hs, y, LZ - lx * hs + lz * hc];
    b.add(geo.bevelBox(3.3, 0.2, 1.7, 0.05), { color: P.marbleShade, pos: at(0, 0, 0), rot });
    const slabGeo = geo.bevelBox(3.0, 0.2, 1.3, 0.05);
    for (const sx of [-1, 1]) b.add(geo.box(0.4, 0.62, 1.0), { color: MARBLE_MID, pos: at(sx * 1.1, 0.2, 0), rot });
    b.add(slabGeo, { color: P.marble, pos: at(0, 0.82, 0), rot });
    cast(slabGeo, at(0, 0.82, 0), rot);
    lanternShape(b, at(-0.95, 1.71, 0.05), 1, P.paper);
    lanternShape(b, at(-0.2, 1.71, -0.2), 1, mix(P.paper, P.pink, 0.4));
    lanternShape(b, at(0.95, 1.9, 0.0), 1.15, LIT);
    b.add(geo.cylinder(0.05, 0.07, 0.5, 6, true), { color: BRASS, pos: at(0.35, 1.02, 0.3) });
    b.add(geo.sphere(0.09, 6, 4), { color: LIT, pos: at(0.35, 1.58, 0.3), flat: 1 });
    const sign = b.add(geo.box(1.7, 0.44, 0.06), { color: P.marble, pos: at(0, 0.3, 0.66), rot, flat: 0.4 });
    b.label({ text: 'LANTERNS', size: 0.2, pos: at(0, 0.52, 0.7), rot, ink: P.ink, plate: P.marble, id: sign, flat: 0.4, pad: 0.1 });
    clump(at(-1.8, 0.3, -0.3), [0.5, 0.4, 0.7], P.moss, rot);
    boxed(LX, LZ, 1.65, 0.85, head);
    const p = at(0, 0, 2.6);
    poi('agent-swarms', p[0], p[2], 'Watch the lanterns rise', 2.6, 5);
  }

  const still = b.build('observatory-static');
  inner.add(still);

  // ------------------------------------------------------------------------------------------
  // The dome and the telescope. One mesh on the axis of the rotunda, so it can swing.
  // ------------------------------------------------------------------------------------------
  const db = kit.builder();
  const SLOT_AZ = (-72 * Math.PI) / 180; // the slot looks left of the street and a touch toward it
  const ELEV = (48 * Math.PI) / 180;
  {
    const seg = low ? 20 : high ? 32 : 26;
    db.add(geo.dome(DOME_R, seg, low ? 6 : 9), { gradient: { bottom: mix(INDIGO, NIGHT, 0.35), top: mix(INDIGO, '#6f74e0', 0.3) }, color: INDIGO, pos: [0, DOME_Y, 0] });
    // The slot: a dark way up the dome and over the top, with a brass rail either side.
    const slot = meridianStrip(DOME_R + 0.05, SLOT_AZ, 0.2, 1.42, 1.05, low ? 6 : 9);
    db.add(slot.g, { color: NIGHT, pos: [0, DOME_Y, 0], flat: 0.7 });
    for (const edge of [slot.left, slot.right]) {
      const rail = geo.tube(edge.map((p): V3 => [p[0] * 1.004, p[1] * 1.004, p[2] * 1.004]), 0.09, { radial: 4, perSpan: 1 });
      db.add(rail, { color: BRASS, pos: [0, DOME_Y, 0], flat: 0.3 });
      rail.dispose();
    }
    slot.g.dispose();
    // Brass ribs between the slot and round the back.
    const nRib = low ? 5 : 7;
    for (let k = 1; k <= nRib; k++) {
      const az = SLOT_AZ + (k / (nRib + 1)) * Math.PI * 2;
      const pts: V3[] = [];
      for (let i = 0; i <= 5; i++) {
        const e = 0.02 + (i / 5) * 1.33;
        pts.push([Math.cos(e) * Math.sin(az) * (DOME_R + 0.04), Math.sin(e) * (DOME_R + 0.04), Math.cos(e) * Math.cos(az) * (DOME_R + 0.04)]);
      }
      const rib = geo.tube(pts, 0.1, { radial: 4, perSpan: 2 });
      db.add(rib, { color: BRASS, pos: [0, DOME_Y, 0], flat: 0.3 });
      rib.dispose();
    }
    // Stars painted on the dome between the ribs.
    if (!low) {
      const paint = sparkle(0.32, 0.01);
      const Z = new THREE.Vector3(0, 0, 1);
      const out = new THREE.Vector3();
      const q = new THREE.Quaternion();
      for (let k = 0; k < nRib; k++) {
        for (let j = 0; j < 2; j++) {
          const az = SLOT_AZ + ((k + 1.5) / (nRib + 1)) * Math.PI * 2 + (rng() - 0.5) * 0.3;
          const e = (j === 0 ? 0.22 : 0.68) + rng() * 0.3;
          out.set(Math.cos(e) * Math.sin(az), Math.sin(e), Math.cos(e) * Math.cos(az));
          const size = 0.22 + rng() * 0.3;
          const g = paint.clone();
          g.rotateZ(rng() * 1.5);
          g.scale(size, size, size);
          g.applyQuaternion(q.setFromUnitVectors(Z, out));
          db.add(g, { color: (k + j) % 3 === 0 ? CYAN : BRASS_LIGHT, pos: [out.x * (DOME_R + 0.04), DOME_Y + out.y * (DOME_R + 0.04), out.z * (DOME_R + 0.04)], flat: 1, outline: false });
          g.dispose();
        }
      }
      paint.dispose();
    }
    db.add(geo.cylinder(1.35, 1.6, 0.3, 14), { color: BRASS, pos: [0, DOME_Y + DOME_R - 0.2, 0], flat: 0.3 });
    db.add(geo.sphere(0.3, 8, 6), { color: BRASS_LIGHT, pos: [0, DOME_Y + DOME_R + 0.3, 0], flat: 0.4 });

    // The telescope. It pivots two metres above the spring of the dome and leaves through the slot.
    const d = new THREE.Vector3(Math.cos(ELEV) * Math.sin(SLOT_AZ), Math.sin(ELEV), Math.cos(ELEV) * Math.cos(SLOT_AZ));
    const pv: V3 = [0, DOME_Y + 2, 0];
    const tp = (t: number, lift = 0): V3 => {
      // `lift` is across the tube, on the upper side.
      const ux = -d.x * d.y, uy = 1 - d.y * d.y, uz = -d.z * d.y;
      const ul = Math.hypot(ux, uy, uz) || 1;
      return [pv[0] + d.x * t + (ux / ul) * lift, pv[1] + d.y * t + (uy / ul) * lift, pv[2] + d.z * t + (uz / ul) * lift];
    };
    const tseg = low ? 10 : 14;
    db.add(rod(tp(4.2), tp(10.4), 0.72, 0.8, tseg), { gradient: { bottom: mix(BRASS, P.shadow, 0.2), top: BRASS_LIGHT }, color: BRASS, flat: 0.15 });
    db.add(rod(tp(10.0), tp(12.2), 0.98, 1.03, tseg), { color: BRASS_LIGHT, flat: 0.25 });
    db.add(rod(tp(5.9), tp(6.2), 0.88, 0.88, tseg), { color: BRASS_DEEP });
    db.add(rod(tp(8.1), tp(8.4), 0.9, 0.9, tseg), { color: BRASS_DEEP });
    db.add(rod(tp(12.16), tp(12.24), 0.86, 0.86, tseg), { color: CYAN, flat: 1 });
    // The finder riding on top.
    db.add(rod(tp(5.6, 1.12), tp(8.6, 1.14), 0.17, 0.2, 8), { color: BRASS_LIGHT, flat: 0.25 });
    db.add(rod(tp(6.2, 0.7), tp(6.2, 1.1), 0.06, 0.06, 5), { color: BRASS_DEEP });
    db.add(rod(tp(7.9, 0.7), tp(7.9, 1.1), 0.06, 0.06, 5), { color: BRASS_DEEP });
  }
  const dome = db.build('observatory-dome');
  dome.position.set(0, 0, RZ);
  inner.add(dome);

  // ------------------------------------------------------------------------------------------
  // The low constellations: the impossible thing. Each one is wired like an org chart, a star
  // for every box, hung low enough that the bottom row passes just overhead.
  // ------------------------------------------------------------------------------------------
  const sb = kit.builder();
  {
    const star = sparkle(0.3, 0.2);
    const TIER_SIZE = [1.0, 0.66, 0.48, 0.38];
    const TIER_TINT: ColorLike[] = [LIT, CYAN, STARLIGHT, P.marble];
    const WIRE = 0.065;
    interface Placed { u: number; tier: number; kids: Placed[]; tag?: string }
    const chart = (root: V3, heading: number, lean: number, spec: Spec, gap: number, drop: number, tagSize: number): void => {
      // U runs along the chart. V runs up it and leans back, so each row down is a step toward whoever is looking.
      const U = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      const V = new THREE.Vector3(-Math.sin(heading) * Math.sin(lean), Math.cos(lean), -Math.cos(heading) * Math.sin(lean));
      let cursor = 0;
      const lay = (s: Spec, tier: number): Placed => {
        const kids = s.kids.map((k) => lay(k, tier + 1));
        const u = kids.length ? (kids[0].u + kids[kids.length - 1].u) / 2 : cursor++ * gap;
        return { u, tier, kids, tag: s.tag };
      };
      const tree = lay(spec, 0);
      const wireId = sb.newId(); // one id for the whole harness, so the corners join clean
      const u0 = tree.u;
      const at = (u: number, v: number): V3 => [root[0] + U.x * (u - u0) + V.x * v, root[1] + V.y * v, root[2] + U.z * (u - u0) + V.z * v];
      const wire = (a: V3, c: V3): void => {
        sb.add(rod(a, c, WIRE, WIRE, 4), { color: STARLIGHT, flat: 1, id: wireId });
      };
      const draw = (n: Placed): void => {
        const v = -n.tier * drop;
        const size = TIER_SIZE[Math.min(n.tier, 3)];
        sb.add(star, { color: TIER_TINT[Math.min(n.tier, 3)], pos: at(n.u, v), rot: [0, heading, (rng() - 0.5) * 0.5], scale: size, flat: 1 });
        if (n.tag) {
          const p = at(n.u, v);
          sb.label({
            text: n.tag, size: tagSize * (n.tier === 0 ? 1.3 : 1), pos: [p[0] + U.x * (size + 0.3) + Math.sin(heading) * 0.1, p[1] + 0.5, p[2] + U.z * (size + 0.3) + Math.cos(heading) * 0.1],
            rot: [0, heading, 0], ink: P.ink, plate: P.paper, flat: 1, pad: 0.4, align: 'left', jitter: 0.3,
          });
        }
        if (!n.kids.length) return;
        const vm = v - drop / 2;
        wire(at(n.u, v), at(n.u, vm));
        if (n.kids.length > 1) wire(at(n.kids[0].u, vm), at(n.kids[n.kids.length - 1].u, vm));
        for (const k of n.kids) {
          wire(at(k.u, vm), at(k.u, v - drop));
          draw(k);
        }
      };
      draw(tree);
    };

    // The big one, over the star chart: the field, its four quarters, and who sits under whom.
    chart(
      [-21, 13.4, -11], 0.62, 0.6,
      lead('THE FIELD',
        lead('FRONTIER LABS', lead(undefined, ...reports(2)), lead(undefined, ...reports(low ? 1 : 2)), lead(undefined, ...reports(1))),
        lead('OPEN SOURCE', lead(undefined, ...reports(2)), lead(undefined, ...reports(2))),
        lead('RESEARCH GROUPS', lead(undefined, ...reports(1)), lead(undefined, ...reports(2))),
        lead('INFRASTRUCTURE', lead(undefined, ...reports(2)), lead(undefined, ...reports(1)))),
      1.45, 3.0, 0.26,
    );
    // A smaller one over the pavilion side.
    chart([24.5, 11.4, -17.5], -0.9, 0.55, lead(undefined, lead(undefined, ...reports(2)), lead(undefined, ...reports(1)), lead(undefined, ...reports(2))), 1.5, 2.8, 0.2);
    // And one high behind the dome.
    if (!low) chart([-11, 15.5, -26.5], 0.2, 0.4, lead(undefined, lead(undefined, ...reports(2)), lead(undefined, ...reports(3))), 1.6, 2.6, 0.2);
    // Loose stars that report to nobody.
    const loose = low ? 6 : 14;
    for (let i = 0; i < loose; i++) {
      const a = rng() * Math.PI * 2;
      const r = 14 + rng() * 22;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (Math.hypot(x, z - RZ) < 10 || (Math.abs(x) < 7 && z > 0)) continue;
      sb.add(star, { color: i % 3 === 0 ? LIT : STARLIGHT, pos: [x, 7 + rng() * 11, z], rot: [0, Math.atan2(x, z) + Math.PI, rng()], scale: 0.2 + rng() * 0.22, flat: 1 });
    }
    star.dispose();
  }
  const sky = sb.build('observatory-constellations');
  inner.add(sky);

  // ------------------------------------------------------------------------------------------
  // The beads of the orrery: seven of one shape, each with its own colour and its own year.
  // ------------------------------------------------------------------------------------------
  const orbs = kit.instances(geo.sphere(1, high ? 12 : 8, high ? 8 : 6), 7, { flat: 0.3 });
  orbs.name = 'observatory-orbs';
  orbs.frustumCulled = false;
  const tint = new THREE.Color();
  const orbPhase: number[] = [];
  const orbSpeed: number[] = [];
  for (let k = 0; k < 7; k++) {
    orbs.setColorAt(k, tint.set(ORB_TINT[k]));
    orbPhase.push(rng() * Math.PI * 2);
    orbSpeed.push(0.42 / (1 + k * 0.42));
  }
  if (orbs.instanceColor) orbs.instanceColor.needsUpdate = true;
  inner.add(orbs);

  // ------------------------------------------------------------------------------------------
  // The scout: a clockwork bird, brass body, verdigris wings, a key in its back.
  // ------------------------------------------------------------------------------------------
  const bb = kit.builder();
  {
    const WING = P.verdigris;
    bb.add(geo.sphere(1, 10, 7), { gradient: { bottom: BRASS_DEEP, top: BRASS_LIGHT }, color: BRASS, scale: [0.34, 0.32, 0.8] });
    bb.add(geo.sphere(0.25, 8, 6), { color: BRASS_LIGHT, pos: [0, 0.16, 0.82] });
    bb.add(rod([0, 0.14, 1.0], [0, 0.06, 1.5], 0.1, 0.01, 6), { color: BRASS_DEEP });
    for (const s of [-1, 1]) {
      bb.add(geo.sphere(0.07, 6, 4), { color: CYAN, pos: [s * 0.2, 0.22, 0.92], flat: 1 });
      // A wing: wide at the shoulder, swept back, tips a little raised.
      const wing = geo.hull([
        new THREE.Vector3(s * 0.2, 0.08, 0.5), new THREE.Vector3(s * 0.2, 0.08, -0.35), new THREE.Vector3(s * 0.2, 0.0, 0.1),
        new THREE.Vector3(s * 1.2, 0.26, 0.3), new THREE.Vector3(s * 1.25, 0.24, -0.5), new THREE.Vector3(s * 1.2, 0.19, -0.1),
        new THREE.Vector3(s * 2.15, 0.5, -0.25), new THREE.Vector3(s * 2.05, 0.48, -0.8),
      ]);
      bb.add(wing, { gradient: { bottom: mix(WING, P.shadow, 0.25), top: mix(WING, '#ffffff', 0.2) }, color: WING });
      bb.add(rod([s * 0.2, 0.11, 0.5], [s * 2.15, 0.53, -0.25], 0.05, 0.03, 5), { color: BRASS_LIGHT, flat: 0.3 });
      wing.dispose();
    }
    const tail = geo.hull([
      new THREE.Vector3(0.12, 0.06, -0.6), new THREE.Vector3(-0.12, 0.06, -0.6), new THREE.Vector3(0, -0.02, -0.6),
      new THREE.Vector3(0.55, 0.12, -1.5), new THREE.Vector3(-0.55, 0.12, -1.5), new THREE.Vector3(0, 0.06, -1.42),
    ]);
    bb.add(tail, { color: WING });
    tail.dispose();
    // The key.
    bb.add(geo.cylinder(0.035, 0.035, 0.36, 5, true), { color: BRASS_DEEP, pos: [0, 0.28, -0.15] });
    bb.add(geo.torus(0.16, 0.045, 10, 4), { color: BRASS_LIGHT, pos: [0, 0.78, -0.15], rot: [0, 0, Math.PI / 2], flat: 0.3 });
  }
  const bird = bb.build('observatory-scout');
  bird.rotation.order = 'YXZ';
  bird.scale.setScalar(1.25);
  inner.add(bird);

  // ------------------------------------------------------------------------------------------
  // The lanterns: one shape, many copies, climbing from the table round the back of the dome
  // and up the far side, so they never cross the telescope.
  // ------------------------------------------------------------------------------------------
  const lb = kit.builder();
  lanternShape(lb);
  lb.add(geo.sphere(0.08, 6, 4), { color: '#ffffff', pos: [0, -0.36, 0], flat: 1, outline: false });
  const N_LAN = low ? 16 : high ? 42 : 28;
  const lanternGeo = lb.geometry ? lb.geometry() : geo.cylinder(0.34, 0.22, 0.66, 8);
  const lanterns = kit.instances(lanternGeo, N_LAN, { flat: 0.85 });
  lanterns.name = 'observatory-lanterns';
  lanterns.frustumCulled = false;
  const LAN_TINT = [LIT, '#f8c6a0', '#fbe9b8', P.pink as string, LIT, '#f8c6a0', CYAN as string];
  const lanU = new Float32Array(N_LAN);
  const lanOff = new Float32Array(N_LAN * 4);
  for (let i = 0; i < N_LAN; i++) {
    lanterns.setColorAt(i, tint.set(LAN_TINT[i % LAN_TINT.length]));
    lanU[i] = (i + rng() * 0.8) / N_LAN;
    lanOff[i * 4] = (rng() - 0.5) * 3.4; // in or out from the path
    lanOff[i * 4 + 1] = (rng() - 0.5) * 2.6; // above or below it
    lanOff[i * 4 + 2] = rng() * Math.PI * 2; // where it is in its own slow bob
    lanOff[i * 4 + 3] = 1.15 + rng() * 0.8; // size
  }
  if (lanterns.instanceColor) lanterns.instanceColor.needsUpdate = true;
  inner.add(lanterns);
  const LAN_A0 = Math.atan2(LX, LZ - RZ);
  const LAN_SWEEP = -3.0; // round the back of the dome and up the far side
  const LAN_R0 = Math.hypot(LX, LZ - RZ);

  // ------------------------------------------------------------------------------------------
  // Motion. Slow, and right at t = 0 too, because stills hold the clock there.
  // ------------------------------------------------------------------------------------------
  const m = new THREE.Matrix4();
  const smooth = (a: number, c: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (c - a)));
    return t * t * (3 - 2 * t);
  };
  const BIRD_R = 5.2;
  const update = (_dt: number, t: number): void => {
    dome.rotation.y = Math.sin(t * 0.045) * 0.3;
    sky.position.y = Math.sin(t * 0.22) * 0.22;

    for (let k = 0; k < 7; k++) {
      const a = orbPhase[k] + t * orbSpeed[k];
      const r = ringR(k);
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      const s = ORB_R[k];
      m.makeScale(s, s, s).setPosition(OX + ou.x * ca + ov.x * sa, ORRERY_Y + ou.y * ca + ov.y * sa, OZ + ou.z * ca + ov.z * sa);
      orbs.setMatrixAt(k, m);
    }
    orbs.instanceMatrix.needsUpdate = true;

    const ba = -0.75 + t * 0.32;
    bird.position.set(SX + Math.sin(ba) * BIRD_R, 6.6 + Math.sin(t * 0.7) * 0.35, SZ + Math.cos(ba) * BIRD_R);
    bird.rotation.set(Math.sin(t * 0.7 + 1.3) * 0.08, ba + Math.PI / 2, -0.32 + Math.sin(t * 0.5) * 0.06);

    for (let i = 0; i < N_LAN; i++) {
      let u = lanU[i] + t * 0.011;
      u -= Math.floor(u);
      const o = i * 4;
      const ph = lanOff[o + 2];
      const a = LAN_A0 + u * LAN_SWEEP;
      const spread = 0.25 + smooth(0, 0.3, u) * 0.75;
      const r = LAN_R0 - 5 * u + lanOff[o] * spread + Math.sin(t * 0.4 + ph) * 0.3;
      const y = 1.9 + 18.5 * Math.pow(u, 0.85) + lanOff[o + 1] * spread + Math.sin(t * 0.55 + ph * 1.7) * 0.25;
      // Each one grows as it leaves the table and thins away at the top, so the loop never pops.
      const s = lanOff[o + 3] * smooth(0, 0.05, u) * (1 - smooth(0.9, 1, u));
      m.makeScale(s, s, s).setPosition(Math.sin(a) * r, y, RZ + Math.cos(a) * r);
      lanterns.setMatrixAt(i, m);
    }
    lanterns.instanceMatrix.needsUpdate = true;
  };
  update(0, 0);

  return {
    group,
    colliders,
    pois,
    update,
    dispose() {
      orbs.geometry.dispose();
      lanterns.geometry.dispose();
    },
  };
}
