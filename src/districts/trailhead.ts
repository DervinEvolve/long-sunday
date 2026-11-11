// The Trailhead. A street corner at the bottom of the avenue, and the first thing anyone sees.
// The arch stands due north of the spawn so it fills the first frame. The two story lines are
// inlaid from under his feet, through the arch, and round to where the real avenue leaves the
// plaza, with a pair of kerb bands either side so the whole way reads as one street.
// Brick walk-ups stand behind and to the sides. The title camera looks back south at him, so the
// rows, the stoops and the subway stair are what sits behind the title.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import { SITES, SPAWN, yawToward } from '../world/layout';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, PartOpts, Poi } from '../types';

type V3 = [number, number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const STOREY = 3.1;
const IRON = '#3d3766';
const IRON_GREEN = '#2f7d62';
const WINDOW = '#56528f';
const LIT = '#f6d98a';
const TRUNK = '#7a5a86';
const CORAL = '#ee6352';
// Wall and footing tones for the walk-ups. Brick first, then the odd painted one.
const WALLS: [string, string][] = [
  ['#c8684e', '#a34e45'],
  ['#b25a4b', '#8c4443'],
  ['#d98a5f', '#b06a58'],
  ['#f0dcc2', '#d6bfc0'],
  ['#c8684e', '#93433c'],
];
const DOORS = ['#3fa9a5', '#d8412f', '#f3c531', '#6f58c2', '#1f6c7a'];
const LEAVES = ['#7fb85a', '#63aa5e', '#3f8a57', '#8cc56c', '#4f9c62'];

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

/** A spot and a heading. Local +z is the front. */
interface Frame { x: number; z: number; yaw: number; cs: number; sn: number }
const frame = (x: number, z: number, yaw: number): Frame => ({ x, z, yaw, cs: Math.cos(yaw), sn: Math.sin(yaw) });
const at = (f: Frame, lx: number, y: number, lz: number): V3 => [f.x + lx * f.cs + lz * f.sn, y, f.z - lx * f.sn + lz * f.cs];

/** A flat strip along a line of points, lying face up. For the inlaid story lines. */
function ribbon(points: [number, number][], side: number, half: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const c = points[Math.min(points.length - 1, i + 1)];
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const hx = (c[0] - a[0]) / l;
    const hz = (c[1] - a[1]) / l;
    // Left of the heading is (hz, -hx).
    const lx = hz, lz = -hx;
    const p = points[i];
    pos.push(p[0] + lx * (side + half), y, p[1] + lz * (side + half), p[0] + lx * (side - half), y, p[1] + lz * (side - half));
    nor.push(0, 1, 0, 0, 1, 0);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export const district: DistrictModule = {
  id: 'trailhead',
  build(ctx) {
    return buildTrailhead(ctx);
  },
};

function buildTrailhead(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const sun = ctx.sun ?? FALLBACK_SUN;
  // The plaza is paving with a little of the first accent in it. Shadows are that, pushed toward violet.
  const shade = mix(mix(P.pave, site.accents[0], 0.12), P.shadow, 0.3);
  const GROUND = 0.045; // the plaza sits 3 cm proud of the pad, so shadows and inlays go just above that
  const FLUSH = 0.035; // anything he can walk onto tops out here, a hair over the paving
  const ORANGE = site.accents[1];
  const BLUE = site.accents[2];

  const group = new THREE.Group();
  group.name = 'trailhead';
  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const b = kit.builder();
  const entry = (id: string) => entries.find((e) => e.id === id);
  const fit = (text: string, size: number, max: number): number => {
    const w = b.measure ? b.measure({ text, size }).width : text.length * size * 0.7;
    return w > max ? (size * max) / w : size;
  };
  const cast = (g: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: number | V3): void => {
    b.shadow?.(g, { color: shade, sun, pos, rot, scale, y: GROUND, lift: 0.01 });
  };

  // A street tree: a trunk and three round masses of leaf. Baked wind, more at the top.
  const tree = (x: number, z: number, h: number, tint: string, pit = true): void => {
    const y = ctx.groundAt(x, z);
    const s = h / 7;
    const turn = rng() * 6.28;
    const f = frame(x, z, turn);
    if (pit) b.add(geo.cylinder(0.95, 0.95, FLUSH, 8), { color: P.grassDeep, pos: [x, y, z], flat: 0.5 });
    b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, y, z], sway: 0.2, swayBase: y });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: y };
    const id = b.newId();
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    b.add(ball, { ...leaf, id, pos: at(f, 0, y + 4.9 * s, 0), scale: [2.5 * s, 2.0 * s, 2.4 * s] });
    b.add(ball, { ...leaf, id, pos: at(f, -1.6 * s, y + 4.6 * s, -0.9 * s), scale: [1.5 * s, 1.25 * s, 1.45 * s] });
    b.add(ball, { ...leaf, pos: at(f, 1.6 * s, y + 4.0 * s, 0.8 * s), scale: [1.7 * s, 1.35 * s, 1.6 * s] });
    cast(ball, [x, 4.9 * s, z], undefined, [2.5 * s, 2.0 * s, 2.4 * s]);
    colliders.push({ kind: 'circle', x, z, r: 0.34 * s });
  };
  // A cypress: one dark flame of leaf on a short trunk. Narrow, so it can stand close to the rim.
  const cypress = (x: number, z: number, h: number): void => {
    const y = ctx.groundAt(x, z);
    const k = h / 7;
    b.add(geo.cylinder(0.95, 0.95, FLUSH, 8), { color: P.grassDeep, pos: [x, y, z], flat: 0.5 });
    b.add(geo.cylinder(0.14 * k, 0.2 * k, 1.0 * k, 6, true), { color: TRUNK, pos: [x, y, z] });
    const flame = geo.lathe([[0.3, 0], [0.82, 0.55], [1.05, 1.9], [0.9, 3.7], [0.5, 5.3], [0, 6.3]], high ? 9 : 7, { cacheKey: 'trailhead-cypress-' + (high ? 9 : 7) });
    b.add(flame, { gradient: { bottom: '#2a6149', top: LEAVES[2] }, color: LEAVES[2], pos: [x, y + 0.7 * k, z], scale: k, sway: 0.3, swayBase: y });
    cast(geo.sphere(1, 6, 4), [x, 3.2 * k, z], undefined, [1.05 * k, 2.6 * k, 1.05 * k]);
    colliders.push({ kind: 'circle', x, z, r: 0.4 * k });
  };
  // A clump of leaf: a hedge, or ivy when it is pressed flat against a wall.
  let clumpSeed = 11;
  const clump = (pos: V3, scale: V3, tint: string, rot?: V3, count = 4): void => {
    b.add(geo.blobs(clumpSeed++, count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos, rot, scale, sway: 0.12,
    });
  };

  // ------------------------------------------------------------------------------------------
  // The arch. Due north of the spawn, front to the south, so the first frame is the arch with
  // the way north through it. Piers and spandrels are one piece with the round opening cut out.
  // ------------------------------------------------------------------------------------------
  const AX = SPAWN.x - site.center.x; // on the spawn's own north line
  const AZ = 6.5;
  const SPAN = 5.5, PIER = 3.0, DEPTH = 4.0, SPRING = 5.6;
  const HALF = SPAN / 2 + PIER; // 5.75
  const TOP = 9.0; // top of the pier mass, underside of the entablature
  {
    const outline: [number, number][] = [[-HALF, 0], [-SPAN / 2, 0], [-SPAN / 2, SPRING]];
    const seg = high ? 14 : 10;
    for (let i = 1; i < seg; i++) {
      const a = Math.PI - (i / seg) * Math.PI;
      outline.push([Math.cos(a) * (SPAN / 2), SPRING + Math.sin(a) * (SPAN / 2)]);
    }
    outline.push([SPAN / 2, SPRING], [SPAN / 2, 0], [HALF, 0], [HALF, TOP], [-HALF, TOP]);
    const mass = geo.extrude(outline, DEPTH, { crease: 35, cacheKey: 'trailhead-arch-' + seg });
    b.add(mass, { gradient: { bottom: mix(P.marble, P.marbleShade, 0.55), top: P.marble }, color: P.marble, pos: [AX, 0, AZ] });
    cast(mass, [AX, 0, AZ]);
    // The moulding round the opening, standing a hand proud on both faces.
    const lip = mix(P.marble, P.marbleShade, 0.5);
    // Its inside face sits a finger inside the opening, or the two surfaces fight for the same place.
    b.add(geo.arch({ span: SPAN - 0.08, rise: SPRING + SPAN / 2 - 0.04, thick: 0.54, depth: DEPTH + 0.3, seg }), { color: lip, pos: [AX, 0, AZ] });
    b.add(geo.bevelBox(0.8, 1.15, DEPTH + 0.56, 0.06), { color: P.marble, pos: [AX, SPRING + SPAN / 2 - 0.25, AZ] });
    b.add(geo.sphere(0.2, 8, 5), { color: P.brass, pos: [AX, SPRING + SPAN / 2 + 0.45, AZ + DEPTH / 2 + 0.3], flat: 0.4 });
    for (const side of [-1, 1]) {
      const px = AX + side * (SPAN / 2 + PIER / 2);
      b.add(geo.bevelBox(PIER + 0.5, 0.55, DEPTH + 0.5, 0.06), { color: P.marbleShade, pos: [px, 0, AZ] });
      b.add(geo.box(PIER + 0.24, 0.32, DEPTH + 0.24), { color: lip, pos: [px, SPRING - 0.16, AZ] });
      // A sunk panel on each face of the pier, between the columns, with a wreath in it.
      for (const face of [-1, 1]) {
        const fz = AZ + face * (DEPTH / 2 + 0.01);
        const ry = face > 0 ? 0 : Math.PI;
        b.add(geo.plane(1.1, 3.0), { color: mix(P.marble, P.marbleShade, 0.75), pos: [px, 3.4, fz], rot: [0, ry, 0], flat: 0.5 });
        b.add(geo.torus(0.55, 0.11, 12, 4), { color: P.moss, pos: [px, 7.3, fz + face * 0.06], rot: [Math.PI / 2, 0, 0], flat: 0.3 });
        // Engaged columns on pedestals at the corners of each pier.
        for (const cx of [-1.05, 1.05]) {
          const x = px + cx;
          const z = AZ + face * (DEPTH / 2 + 0.42);
          b.add(geo.bevelBox(0.95, 1.7, 0.95, 0.05), { color: P.marbleShade, pos: [x, 0, z] });
          b.add(geo.cylinder(0.44, 0.48, 0.2, 10), { color: lip, pos: [x, 1.7, z] });
          b.add(geo.prism(high ? 12 : 8, 0.3, 0.37, 6.4), { color: P.marble, pos: [x, 1.9, z] });
          b.add(geo.cylinder(0.46, 0.32, 0.36, 10), { color: lip, pos: [x, 8.3, z] });
          b.add(geo.box(0.95, 0.34, 0.95), { color: P.marble, pos: [x, 8.66, z] });
        }
      }
      colliders.push({ kind: 'box', x: px, z: AZ, hw: PIER / 2 + 0.3, hd: DEPTH / 2 + 0.95 });
      // Moss creeping over the pedestal feet, ivy up the outer flank.
      clump([px + side * (PIER / 2 + 0.12), 2.6, AZ - 0.5], [0.5, 3.4, 1.7], LEAVES[2], undefined, 5);
      clump([px + side * (PIER / 2 + 0.1), 5.6, AZ + 0.7], [0.4, 2.2, 1.1], LEAVES[0]);
      clump([px + side * 1.2, 0.35, AZ + DEPTH / 2 + 1.0], [1.0, 0.5, 0.6], P.moss as string);
      clump([px - side * 0.6, 0.3, AZ - DEPTH / 2 - 1.0], [1.2, 0.45, 0.6], P.moss as string);
    }
    // Entablature, attic and cornice. The attic carries the name on both faces.
    b.add(geo.box(HALF * 2 + 0.5, 0.3, DEPTH + 1.5), { color: lip, pos: [AX, TOP, AZ] });
    b.add(geo.box(HALF * 2 + 0.2, 0.5, DEPTH + 1.2), { color: P.marble, pos: [AX, TOP + 0.3, AZ] });
    b.add(geo.bevelBox(HALF * 2 + 1.5, 0.34, DEPTH + 2.3, 0.05), { color: P.marbleShade, pos: [AX, TOP + 0.8, AZ] });
    const ATTIC = TOP + 1.14;
    const atticGeo = geo.box(HALF * 2 - 0.3, 2.3, DEPTH - 0.2);
    const attic = b.add(atticGeo, { color: P.marble, pos: [AX, ATTIC, AZ] });
    cast(atticGeo, [AX, ATTIC, AZ]);
    b.add(geo.bevelBox(HALF * 2 + 0.7, 0.3, DEPTH + 0.8, 0.05), { color: P.marbleShade, pos: [AX, ATTIC + 2.3, AZ] });
    b.add(geo.box(HALF * 2 - 0.1, 0.22, DEPTH + 0.1), { color: P.marble, pos: [AX, ATTIC + 2.6, AZ] });
    const nameSize = fit('LONG SUNDAY', 1.0, HALF * 2 - 1.9);
    for (const face of [1, -1]) {
      b.label({
        text: 'LONG SUNDAY', size: nameSize, pos: [AX, ATTIC + 1.2, AZ + face * (DEPTH / 2 - 0.1)], rot: [0, face > 0 ? 0 : Math.PI, 0],
        ink: P.ink, plate: P.marble, id: attic, pad: 0.25, jitter: 0.25,
      });
    }
    // A garden on the roof, spilling over the ends. Never over the lettering.
    const roofY = ATTIC + 2.82;
    b.add(geo.box(HALF * 2 - 0.7, 0.16, DEPTH - 0.5), { color: P.grassDeep, pos: [AX, roofY - 0.04, AZ], flat: 0.4 });
    for (let i = 0; i < (low ? 4 : 7); i++) {
      const x = AX - HALF + 1.1 + (i / 6) * (HALF * 2 - 2.2) * (low ? 1.75 : 1);
      clump([x, roofY + 0.45 + rng() * 0.2, AZ + (rng() - 0.5) * 1.4], [1.0 + rng() * 0.5, 0.75 + rng() * 0.5, 1.0], LEAVES[i % LEAVES.length]);
    }
    for (const side of [-1, 1]) {
      clump([AX + side * (HALF - 0.1), ATTIC + 1.5, AZ + side * 0.4], [0.45, 1.6, 1.5], LEAVES[1], undefined, 5);
      clump([AX + side * (HALF + 0.5), TOP + 0.9, AZ - side * 0.6], [0.5, 0.9, 1.2], LEAVES[3]);
    }
    // Ivy that has come over the cornice at the east end and started down the corner column.
    const fz = AZ + DEPTH / 2;
    clump([AX + HALF + 0.35, TOP + 0.55, fz + 0.75], [1.15, 0.7, 0.6], LEAVES[1], undefined, 5);
    clump([AX + HALF - 0.4, TOP - 0.9, fz + 0.72], [0.55, 1.25, 0.34], LEAVES[2], undefined, 5);
    clump([AX + HALF - 0.25, TOP - 2.7, fz + 0.74], [0.4, 0.9, 0.3], LEAVES[0], undefined, 4);
    // One cypress on the roof, off centre, because somebody planted it.
    b.add(geo.cone(0.55, 2.6, 7), { gradient: { bottom: '#2f6f50', top: LEAVES[2] }, color: LEAVES[2], pos: [AX + 3.4, roofY, AZ - 0.3], sway: 0.25 });

    // On the back half of the roof, a slender column with a bronze figure holding up the sun, so the
    // arch reads over the trees from far down the avenue. Set back so that from where he starts the
    // attic hides all of it but a sliver of the column, and the first frame stays the arch and its name.
    {
      const SZ = AZ - 1.45;
      const base = roofY + 0.12;
      const BRONZE = mix(P.verdigris, P.tealDeep, 0.25);
      const bronze = { gradient: { bottom: mix(BRONZE, P.shadow, 0.3), top: mix(P.verdigris, '#ffffff', 0.12) }, color: BRONZE };
      b.add(geo.bevelBox(2.2, 0.5, 1.6, 0.05), { color: P.marbleShade, pos: [AX, roofY - 0.04, SZ] });
      b.add(geo.bevelBox(1.4, 0.8, 1.3, 0.05), { color: P.marble, pos: [AX, base + 0.34, SZ] });
      const colY = base + 1.14;
      const COL = 2.3;
      b.add(geo.prism(high ? 12 : 8, 0.3, 0.36, COL), { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [AX, colY, SZ] });
      b.add(geo.cylinder(0.5, 0.34, 0.24, 10), { color: P.marble, pos: [AX, colY + COL, SZ] });
      const foot = colY + COL + 0.24;
      // Robe, shoulders, head.
      b.add(geo.prism(high ? 10 : 7, 0.36, 0.56, 2.8), { ...bronze, pos: [AX, foot, SZ] });
      b.add(geo.sphere(1, high ? 10 : 7, high ? 6 : 4), { ...bronze, pos: [AX, foot + 2.84, SZ], scale: [0.5, 0.29, 0.35] });
      b.add(geo.sphere(0.32, high ? 10 : 7, high ? 7 : 5), { ...bronze, pos: [AX, foot + 3.32, SZ] });
      // Both arms up, hands under the sun.
      const sunY = foot + 5.4;
      for (const side of [-1, 1]) {
        const arm: V3[] = [[AX + side * 0.4, foot + 2.88, SZ], [AX + side * 0.68, foot + 3.68, SZ + 0.04], [AX + side * 0.5, sunY - 1.0, SZ]];
        b.add(geo.tube(arm, 0.14, { radial: 6, perSpan: 2 }), { ...bronze });
      }
      // The sun: a gilded ball in a ring of rays.
      b.add(geo.sphere(0.95, high ? 14 : 10, high ? 10 : 7), { gradient: { bottom: ORANGE, top: P.yellow }, color: ORANGE, pos: [AX, sunY, SZ], flat: 0.35 });
      b.add(geo.torus(1.35, 0.1, high ? 20 : 14, 4), { color: P.brass, pos: [AX, sunY, SZ], rot: [Math.PI / 2, 0, 0], flat: 0.3 });
      const ray = geo.cone(0.2, 0.68, 5);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        b.add(ray, { color: P.yellow, pos: [AX + Math.cos(a) * 1.4, sunY + Math.sin(a) * 1.4, SZ], rot: [0, 0, a - Math.PI / 2], flat: 0.4 });
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // The two story lines, inlaid in the paving. They start at a dot under his feet, run north
  // through the arch, then swing left to meet the dot where the real avenue arrives.
  // ------------------------------------------------------------------------------------------
  const al = Math.hypot(site.arrive.x, site.arrive.z) || 1;
  const ux = site.arrive.x / al, uz = site.arrive.z / al; // from the centre out along the avenue
  {
    const sx = AX, sz = SPAWN.z - site.center.z;
    const path: [number, number][] = [[sx, sz - 0.62]];
    // The turn: a circle of radius RT that leaves the north line and lands on the avenue's own line.
    const RT = 6;
    const want = Math.atan2(-ux, -uz); // how far the heading has to swing from north, to the left
    // Where the arc must start so that it ends exactly on the line through the arrive point.
    const endX = -RT + RT * Math.cos(want), endZ = -RT * Math.sin(want); // arc end, from its start
    // The arc end has to sit on the avenue line: cross((start + end) - arrive, u) = 0. Solve for start z.
    const startZ = site.arrive.z + ((sx + endX - site.arrive.x) * uz) / ux - endZ;
    path.push([sx, startZ]);
    const steps = high ? 12 : 7;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * want;
      path.push([sx - RT + RT * Math.cos(a), startZ - RT * Math.sin(a)]);
    }
    path.push([site.arrive.x - ux * 0.62, site.arrive.z - uz * 0.62]);
    const LINE_Y = 0.075;
    b.add(ribbon(path, 0.225, 0.125, LINE_Y), { color: CORAL, flat: 1, outline: false });
    b.add(ribbon(path, -0.225, 0.125, LINE_Y), { color: P.teal, flat: 1, outline: false });
    // The same route again as a street: two kerb bands the width of the avenue, from the crossing
    // behind him, through the arch (they just clear the piers) and out to the plaza kerb where
    // the real avenue takes over. This is what the arch frames.
    const route: [number, number][] = [[sx, sz + 1.25], ...path.slice(1, -1), [ux * 23.3, uz * 23.3]];
    const KERB = mix(P.paveShade, P.asphalt, 0.16);
    for (const side of [-1, 1]) b.add(ribbon(route, side * 2.6, 0.1, 0.06), { color: KERB, flat: 0.6 });
    // The dot he starts on.
    b.add(geo.ring(0.62, 0.74, 20), { color: P.ink, pos: [sx, LINE_Y + 0.004, sz], flat: 1, outline: false });
    b.add(geo.disc(0.62, 20), { color: P.marble, pos: [sx, LINE_Y + 0.007, sz], flat: 1, outline: false });
  }

  // ------------------------------------------------------------------------------------------
  // The sign pole. Every blade points at the true bearing of its district from the pole.
  // ------------------------------------------------------------------------------------------
  const POLE = { x: AX + 2.6, z: -3.6 };
  {
    const px = POLE.x, pz = POLE.z;
    b.add(geo.cylinder(0.5, 0.58, 0.3, 10), { color: P.marbleShade, pos: [px, 0, pz] });
    b.add(geo.cylinder(0.2, 0.3, 0.5, 8), { color: IRON_GREEN, pos: [px, 0.3, pz] });
    const poleGeo = geo.cylinder(0.075, 0.1, 6.4, 6);
    b.add(poleGeo, { color: IRON_GREEN, pos: [px, 0.3, pz] });
    cast(poleGeo, [px, 0.3, pz], undefined, [3, 1, 3]);
    b.add(geo.sphere(0.2, 8, 5), { color: P.brass, pos: [px, 6.8, pz], flat: 0.4 });
    const others = SITES.filter((s) => s.id !== site.id)
      .map((s) => ({ s, yaw: yawToward(s.center.x - (site.center.x + px), s.center.z - (site.center.z + pz)) }))
      .sort((p, q) => p.yaw - q.yaw);
    const blade = geo.extrude([[0.12, -0.21], [1.95, -0.21], [2.25, 0], [1.95, 0.21], [0.12, 0.21]], 0.08, { cacheKey: 'trailhead-blade' });
    const half = Math.ceil(others.length / 2);
    others.forEach((o, i) => {
      // Neighbours in bearing go on different levels, so two blades on one level never cross.
      const level = i % half;
      const y = 3.15 + level * 0.56;
      // Walking forward is (-sin yaw, -cos yaw). The blade's long axis is its local +x.
      const turn = o.yaw + Math.PI / 2;
      const dx = -Math.sin(o.yaw), dz = -Math.cos(o.yaw);
      const plate = o.s.accents[1];
      const c = new THREE.Color(plate);
      const dark = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 < 0.5;
      const id = b.add(blade, { color: plate, pos: [px, y, pz], rot: [0, turn, 0], flat: 0.55 });
      const text = o.s.name.replace(/^The /, '').toUpperCase();
      const size = fit(text, 0.2, 1.55);
      for (const face of [1, -1]) {
        // The face normal is the blade's local z, which is the heading turned a quarter.
        const nx = Math.sin(turn) * face, nz = Math.cos(turn) * face;
        b.label({
          text, size, pos: [px + dx * 1.05 + nx * 0.05, y, pz + dz * 1.05 + nz * 0.05], rot: [0, turn + (face > 0 ? 0 : Math.PI), 0],
          ink: dark ? P.marble : P.ink, plate, id, flat: 0.55, pad: 0.2, jitter: 0.3,
        });
      }
    });
  }
  colliders.push({ kind: 'circle', x: POLE.x, z: POLE.z, r: 0.45 });

  // ------------------------------------------------------------------------------------------
  // Small helpers for the rest of the corner.
  // ------------------------------------------------------------------------------------------
  const strut = (a: V3, c: V3, r: number, color: ColorLike, id?: number): number =>
    b.add(geo.tube([a, c], r, { radial: 5, perSpan: 2 }), { color, id });
  /** A flat shape lying on the ground, from a list of (x, z) corners. */
  const slab = (pts: [number, number][], y: number, h: number, opts: Omit<PartOpts, 'pos' | 'rot'>): number =>
    b.add(geo.extrude(pts.map(([x, z]): [number, number] => [x, -z]), h), { ...opts, pos: [0, y + h / 2, 0], rot: [-Math.PI / 2, 0, 0] });
  /** A point on the pad by compass bearing (degrees, 0 is north, clockwise) and distance. */
  const polar = (deg: number, r: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [Math.sin(a) * r, -Math.cos(a) * r];
  };
  const flower = (x: number, y: number, z: number, color: ColorLike): void => {
    b.add(geo.ico(0.13, 0), { color, pos: [x, y, z], flat: 0.7, outline: false });
  };
  const poi = (id: string, x: number, z: number, prompt: string, y?: number, reach?: number): void => {
    if (entry(id)) pois.push({ entry: id, x, z, prompt, y, reach });
  };
  // A curved planting bed along the rim: a marble kerb with lawn in it, sunk so it is walked on flush.
  const crescent = (b0: number, b1: number, r0: number, r1: number): void => {
    const n = Math.max(3, Math.ceil(Math.abs(b1 - b0) / (low ? 14 : 8)));
    const ring = (ra: number, rb: number, pinch: number): [number, number][] => {
      const pts: [number, number][] = [];
      for (let k = 0; k <= n; k++) pts.push(polar(b0 - pinch + ((b1 - b0 + pinch * 2) * k) / n, ra));
      for (let k = n; k >= 0; k--) pts.push(polar(b0 - pinch + ((b1 - b0 + pinch * 2) * k) / n, rb));
      return pts;
    };
    slab(ring(r0 - 0.18, r1 + 0.18, 0.5), FLUSH - 0.133, 0.13, { color: P.marbleShade });
    slab(ring(r0, r1, 0), FLUSH - 0.19, 0.19, { color: P.grass, flat: 0.35 });
  };
  // A free standing fluted column on a block. Broken ones stop short and lose the capital.
  const column = (x: number, y: number, z: number, h: number, whole: boolean): void => {
    b.add(geo.bevelBox(1.0, 0.32, 1.0, 0.05), { color: P.marbleShade, pos: [x, y, z] });
    b.add(geo.cylinder(0.42, 0.47, 0.16, 10), { color: mix(P.marble, P.marbleShade, 0.5), pos: [x, y + 0.32, z] });
    const shaft = geo.prism(high ? 12 : 8, whole ? 0.3 : 0.34, 0.37, h);
    b.add(shaft, { color: P.marble, pos: [x, y + 0.48, z] });
    if (whole) {
      b.add(geo.cylinder(0.46, 0.31, 0.32, 10), { color: mix(P.marble, P.marbleShade, 0.5), pos: [x, y + 0.48 + h, z] });
      b.add(geo.box(0.95, 0.26, 0.95), { color: P.marble, pos: [x, y + 0.8 + h, z] });
    }
    colliders.push({ kind: 'circle', x, z, r: 0.5 });
  };

  // ------------------------------------------------------------------------------------------
  // The ground. Lawn either side of the arch, planted crescents on the open rim, and the stub
  // of the street he came in by, running south between the two rows.
  // ------------------------------------------------------------------------------------------
  {
    const bed = (x0: number, x1: number, z0: number, z1: number): void => {
      const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      b.add(geo.box(w + 0.36, 0.2, d + 0.36), { color: P.marbleShade, pos: [cx, 0, cz] });
      b.add(geo.box(w, 0.28, d), { color: P.grass, pos: [cx, 0, cz], flat: 0.35 });
      colliders.push({ kind: 'box', x: cx, z: cz, hw: w / 2 + 0.15, hd: d / 2 + 0.15 });
    };
    // West of the arch: lawn, a hedge, one column still standing.
    const wx0 = AX - HALF - 6.2, wx1 = AX - HALF - 0.45;
    bed(wx0, wx1, AZ - 1.5, AZ + 1.5);
    column(wx1 - 1.3, 0.28, AZ, 4.3, true);
    clump([wx1 - 1.3, 2.3, AZ + 0.2], [0.55, 1.6, 0.55], LEAVES[2], undefined, 5);
    for (let i = 0; i < 3; i++) {
      clump([wx0 + 0.9 + i * 0.95, 0.75, AZ + 0.75 - (i % 2) * 0.3], [0.85, 0.62, 0.7], LEAVES[(i + 1) % LEAVES.length]);
      flower(wx0 + 0.7 + i * 1.0, 1.22, AZ + 1.05, i % 2 ? P.yellow : ORANGE);
    }
    // East of it everything stays low, so the bell tower shows over the top.
    const ex0 = AX + HALF + 0.45, ex1 = AX + HALF + 6.6;
    bed(ex0, ex1, AZ - 1.5, AZ + 1.5);
    column(ex0 + 1.5, 0.28, AZ, 1.3, false);
    // The rest of that column, lying where it fell.
    b.add(geo.prism(high ? 12 : 8, 0.3, 0.33, 2.3), { color: P.marble, pos: [ex0 + 3.0, 0.62, AZ - 0.5], rot: [Math.PI / 2, 0, 0.5] });
    clump([ex0 + 3.3, 0.5, AZ - 0.1], [0.9, 0.4, 0.7], P.moss as string);
    for (let i = 0; i < 4; i++) {
      clump([ex0 + 2.6 + i * 1.0, 0.72, AZ + 0.85 - (i % 2) * 0.25], [0.85, 0.58, 0.7], LEAVES[(i + 2) % LEAVES.length]);
      flower(ex0 + 2.4 + i * 1.05, 1.18, AZ + 1.2, i % 2 ? ORANGE : P.pink);
    }

    // The rim. North is kept low between the trees so the way through the arch stays open.
    crescent(312, 402, 21.5, 23.5);
    crescent(255, 282, 21.6, 23.5);
    crescent(98, 112, 21.6, 23.5);
    const rimClumps: [number, number][] = [[318, 0], [327, 1], [350, 2], [358, 3], [8, 4], [16, 0], [33, 1], [39, 2], [259, 3], [266, 1], [273, 0], [279, 2], [101, 4], [109, 1]];
    rimClumps.forEach(([deg, tint], i) => {
      if (low && i % 2) return;
      const [x, z] = polar(deg, 22.5);
      clump([x, 0.62, z], [0.95 + (i % 3) * 0.15, 0.55, 0.8], LEAVES[tint]);
      const [fx, fz] = polar(deg + 2.6, 22.0);
      flower(fx, 0.5, fz, [ORANGE, P.yellow, P.pink][i % 3]);
    });

    // The street stub. A shade different from the plaza, with a crossing painted on it.
    const street = mix(P.pave, P.paveShade, 0.5);
    slab([[-4.9, 22.9], [11.3, 21.0], [14.9, 26.0], [9.5, 28.4], [3, 29.6], [-3, 29.5], [-7.0, 29.0]], FLUSH - 0.09, 0.09, { color: street, flat: 0.2 });
    for (let i = 0; i < 5; i++) {
      b.add(geo.box(0.6, 0.008, 2.5), { color: mix(P.asphalt, street, 0.3), pos: [AX + (i - 2) * 1.08, FLUSH - 0.003, 24.45], flat: 1, outline: false });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The walk-ups. Five of them on the south rim, facing in, with the street stub between.
  // Front faces sit on the plaza, backs on the grass.
  // ------------------------------------------------------------------------------------------
  const ROW_R = 22.5;
  interface Walkup { at: number; storeys: number; tone: number; door: number; escape?: number; tank?: boolean; garden?: boolean; awning?: boolean; ivy?: number }
  const walkup = (o: Walkup): void => {
    const [ox, oz] = polar(o.at, 1);
    const f = frame(ox * ROW_R, oz * ROW_R, Math.atan2(-ox, -oz));
    const rot: V3 = [0, f.yaw, 0];
    const W = 7.5, D = 6.8, BASE = 1.04; // the back cornice has to stay inside the site's circle
    const H = BASE + o.storeys * STOREY;
    const [wall, foot] = WALLS[o.tone];
    b.add(geo.box(W, H, D), { gradient: { bottom: mix(wall, foot, 0.55), top: wall }, color: wall, pos: at(f, 0, 0, -D / 2), rot, hatch: 0.08 });
    b.add(geo.box(W + 0.14, BASE, D + 0.14), { color: foot, pos: at(f, 0, 0, -D / 2), rot });
    b.add(geo.box(W + 0.5, 0.4, D + 0.5), { color: P.marble, pos: at(f, 0, H, -D / 2), rot });
    b.add(geo.box(W + 0.16, 0.34, D + 0.16), { color: foot, pos: at(f, 0, H + 0.4, -D / 2), rot });
    const roof = H + 0.74;
    const p0 = at(f, 0, 0, -D / 2);
    colliders.push({ kind: 'box', x: p0[0], z: p0[2], hw: W / 2 + 0.1, hd: D / 2 + 0.1, rot: f.yaw });

    // Windows. A few lit, a few catching the sky.
    const cols = [-W / 3, 0, W / 3];
    const pane = geo.plane(1.15, 1.8);
    const tint = (): string => {
      const r = rng();
      return r < 0.16 ? LIT : r < 0.36 ? (P.glass as string) : WINDOW;
    };
    for (let k = 0; k < o.storeys; k++) {
      const y = BASE + k * STOREY + 1.72;
      for (let c = 0; c < 3; c++) {
        b.add(pane, { color: tint(), pos: at(f, cols[c], y, -D - 0.03), rot, flat: 0.7 });
        if (k === 0 && c === o.door) continue;
        b.add(pane, { color: tint(), pos: at(f, cols[c], y, 0.03), rot, flat: 0.7 });
        if (!low) b.add(geo.box(1.42, 0.13, 0.26), { color: P.marble, pos: at(f, cols[c], y - 1.03, 0.05), rot });
        if (high) b.add(geo.box(1.42, 0.2, 0.14), { color: foot, pos: at(f, cols[c], y + 0.9, 0.02), rot });
      }
      for (const side of [-1, 1]) {
        for (const z of [-D * 0.28, -D * 0.72]) {
          b.add(pane, { color: tint(), pos: at(f, side * (W / 2 + 0.03), y, z), rot: [0, f.yaw + (side * Math.PI) / 2, 0], flat: 0.7 });
        }
      }
    }

    // The door, up a stoop.
    const dx = cols[o.door];
    b.add(geo.box(1.8, 2.8, 0.22), { color: P.marble, pos: at(f, dx, BASE, 0.02), rot });
    b.add(geo.plane(1.2, 2.35), { color: DOORS[o.tone], pos: at(f, dx, BASE + 1.18, 0.15), rot, flat: 0.5 });
    b.add(geo.sphere(0.07, 6, 4), { color: P.brass, pos: at(f, dx + 0.4, BASE + 1.1, 0.2), flat: 0.5, outline: false });
    if (o.awning) {
      b.add(geo.extrude([[0, 0], [1.25, -0.5], [1.25, -0.3], [0, 0.2]], 2.3, { cacheKey: 'trailhead-awning' }), {
        color: ORANGE, pos: at(f, dx, BASE + 3.0, 0.12), rot: [0, f.yaw - Math.PI / 2, 0], flat: 0.3,
      });
    } else {
      b.add(geo.box(2.1, 0.22, 0.6), { color: P.marble, pos: at(f, dx, BASE + 2.8, 0.25), rot });
    }
    const stoop = b.newId();
    b.add(geo.box(1.9, BASE, 0.62), { color: P.paveShade, pos: at(f, dx, 0, 0.31), rot, id: stoop });
    for (let j = 1; j <= 3; j++) {
      b.add(geo.box(1.9, BASE - j * 0.26, 0.34), { color: P.paveShade, pos: at(f, dx, 0, 0.62 + (j - 0.5) * 0.34), rot, id: stoop });
    }
    for (const side of [-1, 1]) {
      b.add(geo.box(0.3, BASE + 0.32, 1.66), { color: foot, pos: at(f, dx + side * 1.1, 0, 0.83), rot });
      b.add(geo.box(0.44, 0.14, 0.5), { color: P.marble, pos: at(f, dx + side * 1.1, BASE + 0.32, 1.4), rot });
    }
    // Something growing in a pot on one cheek of every stoop.
    const pot = at(f, dx - 1.1, BASE + 0.46, 1.4);
    b.add(geo.cylinder(0.2, 0.15, 0.26, 7), { color: P.brick, pos: pot });
    clump([pot[0], pot[1] + 0.5, pot[2]], [0.42, 0.42, 0.42], LEAVES[(o.tone + 1) % LEAVES.length], undefined, 3);
    const sp = at(f, dx, 0, 0.85);
    colliders.push({ kind: 'box', x: sp[0], z: sp[2], hw: 1.3, hd: 0.85, rot: f.yaw });

    // Fire escape: a balcony at every floor above the first, and the ladders between.
    if (o.escape !== undefined && !low) {
      const ex = cols[o.escape];
      for (let k = 1; k < o.storeys; k++) {
        const y = BASE + k * STOREY + 0.5;
        b.add(geo.box(2.9, 0.09, 0.95), { color: IRON, pos: at(f, ex, y, 0.5), rot });
        b.add(geo.box(2.9, 0.07, 0.07), { color: IRON, pos: at(f, ex, y + 1.0, 0.94), rot });
        b.add(geo.plane(2.84, 0.95), { color: IRON, pos: at(f, ex, y + 0.56, 0.94), rot, dither: 0.5, flat: 1 });
        for (const s of [-1, 1]) {
          b.add(geo.box(0.07, 0.07, 0.95), { color: IRON, pos: at(f, ex + s * 1.42, y + 1.0, 0.5), rot });
          b.add(geo.box(0.07, 1.0, 0.07), { color: IRON, pos: at(f, ex + s * 1.42, y + 0.05, 0.94), rot });
        }
        const drop = k === 1 ? 2.0 : STOREY - 0.1;
        strut(at(f, ex + 0.95, y + 0.05, 0.7), at(f, ex - 0.95 * (k === 1 ? 0.2 : 1), y - drop, 0.7), 0.055, IRON);
      }
    }

    // The roof: a garden, a water tank, or just the stair head.
    if (o.garden) {
      b.add(geo.box(W - 1, 0.14, D - 1), { color: P.grassDeep, pos: at(f, 0, roof, -D / 2), rot, flat: 0.4 });
      for (let i = 0; i < (low ? 2 : 4); i++) {
        const p = at(f, -W / 2 + 1.3 + i * 1.6, roof + 0.55, -1.2 - (i % 2) * 1.6);
        clump(p, [1.0, 0.7, 0.9], LEAVES[(i + o.tone) % LEAVES.length]);
      }
    }
    if (o.tank) {
      const tx = W / 2 - 2.0, tz = -D / 2 - 0.6;
      for (const sx of [-0.8, 0.8]) for (const sz of [-0.8, 0.8]) strut(at(f, tx + sx, roof, tz + sz), at(f, tx + sx * 0.85, roof + 1.5, tz + sz * 0.85), 0.07, IRON);
      b.add(geo.cylinder(1.3, 1.3, 0.12, 10), { color: IRON, pos: at(f, tx, roof + 1.45, tz) });
      b.add(geo.prism(10, 1.2, 1.12, 2.1), { color: '#a8643f', pos: at(f, tx, roof + 1.57, tz), hatch: 0.15 });
      b.add(geo.cone(1.4, 0.95, 10), { color: mix(P.brickDeep, P.shadow, 0.35), pos: at(f, tx, roof + 3.67, tz) });
    } else {
      b.add(geo.box(2.2, 2.0, 2.6), { color: mix(wall, foot, 0.4), pos: at(f, -W / 2 + 1.9, roof, -D + 2.0), rot });
      b.add(geo.box(2.4, 0.16, 2.8), { color: P.marbleShade, pos: at(f, -W / 2 + 1.9, roof + 2.0, -D + 2.0), rot });
    }
    // Ivy up one front corner.
    if (o.ivy !== undefined) {
      const s = o.ivy;
      clump(at(f, s * (W / 2 - 0.7), 2.4, 0.14), [1.25, 2.5, 0.34], LEAVES[2], rot, 5);
      clump(at(f, s * (W / 2 - 0.35), 5.2, 0.12), [0.8, 1.7, 0.3], LEAVES[0], rot);
      clump(at(f, s * (W / 2 + 0.1), 3.4, -1.0), [0.34, 2.2, 1.3], LEAVES[1], rot);
    }
  };
  walkup({ at: 238, storeys: 3, tone: 2, door: 0, garden: true, ivy: -1 });
  walkup({ at: 219, storeys: 4, tone: 0, door: 1, escape: 2, awning: true });
  walkup({ at: 200, storeys: 3, tone: 3, door: 2, tank: true, ivy: 1 });
  walkup({ at: 144, storeys: 4, tone: 4, door: 0, escape: 2, garden: true, ivy: -1 });
  walkup({ at: 125, storeys: 3, tone: 1, door: 1, awning: true, tank: true });

  // ------------------------------------------------------------------------------------------
  // The subway stair, behind him and to one side. He has just come up it, so it is what the
  // title sees over his shoulder, and its lamp is the last thing at the edge of his first look north.
  // The pad cannot be dug, so the way down is drawn: treads that darken to ink, rails that run
  // down into them, and a low wall and railing round the hole.
  // ------------------------------------------------------------------------------------------
  const S = frame(5.92, 23.53, (-112 * Math.PI) / 180);
  {
    const rot: V3 = [0, S.yaw, 0];
    const SL = 4.2, SW = 1.3;
    const DARK = '#15132a';
    const GLOBE = '#43c987';
    const BACK = 0.95; // how far in from the mouth the board hangs
    const n = 8;
    for (let i = 0; i < n; i++) {
      const k = Math.min(1, i / 5);
      b.add(geo.box(SW * 2, 0.03, SL / n), {
        color: i === 0 ? P.pave : mix(P.paveShade, DARK, 0.22 + 0.78 * k), pos: at(S, 0, 0.085, -((i + 0.5) * SL) / n), rot, flat: 1,
      });
      if (i > 0 && i < 4) b.add(geo.box(SW * 2, 0.012, 0.07), { color: P.yellow, pos: at(S, 0, 0.115, -(i * SL) / n - 0.035), rot, flat: 1, outline: false });
    }
    // Low wall on three sides, dark on the inside.
    const wallId = b.newId();
    for (const side of [-1, 1]) {
      b.add(geo.box(0.3, 0.42, SL + 0.3), { color: P.marble, pos: at(S, side * (SW + 0.15), 0, -SL / 2 - 0.15), rot, id: wallId });
      b.add(geo.box(0.02, 0.4, SL - 0.9), { color: mix(P.marbleShade, DARK, 0.75), pos: at(S, side * (SW - 0.012), 0.1, -(SL + 0.9) / 2), rot, flat: 1, outline: false });
      // Railing: posts, a top rail, and a grille drawn as a screen.
      for (let j = 0; j <= 4; j++) b.add(geo.box(0.09, 0.98, 0.09), { color: IRON_GREEN, pos: at(S, side * (SW + 0.15), 0.42, -0.2 - j * ((SL - 0.1) / 4)), rot });
      b.add(geo.box(0.11, 0.09, SL + 0.3), { color: IRON_GREEN, pos: at(S, side * (SW + 0.15), 1.38, -SL / 2 - 0.15), rot });
      b.add(geo.plane(SL, 0.94), { color: IRON_GREEN, pos: at(S, side * (SW + 0.15), 0.9, -SL / 2 - 0.1), rot: [0, S.yaw + Math.PI / 2, 0], dither: 0.5, flat: 1 });
      // The handrail that goes down with the steps and is lost in the dark.
      b.add(geo.cylinder(0.05, 0.05, 1.0, 6), { color: IRON_GREEN, pos: at(S, side * (SW - 0.3), 0.1, 0.05) });
      strut(at(S, side * (SW - 0.3), 1.08, 0.08), at(S, side * (SW - 0.3), 0.1, -SL * 0.66), 0.045, IRON_GREEN);
      // The post that carries its end of the board, set back over the second tread.
      b.add(geo.box(0.11, 2.3, 0.11), { color: IRON_GREEN, pos: at(S, side * (SW + 0.15), 0.42, -BACK), rot });
    }
    // One lamp post beside the stair, with the green globe that says the station is open. It stands
    // clear of the mouth so that it never crosses the board from in front.
    {
      const lp: V3 = [6.3, 0, 21.0];
      const post = b.newId();
      b.add(geo.bevelBox(0.62, 0.3, 0.62, 0.05), { color: P.marbleShade, pos: lp });
      b.add(geo.cylinder(0.17, 0.25, 0.55, 8), { color: IRON_GREEN, pos: [lp[0], 0.3, lp[2]], id: post });
      const shaft = geo.cylinder(0.075, 0.1, 2.6, 6);
      b.add(shaft, { color: IRON_GREEN, pos: [lp[0], 0.85, lp[2]], id: post });
      cast(shaft, [lp[0], 0.85, lp[2]], undefined, [2.5, 1, 2.5]);
      b.add(geo.cylinder(0.13, 0.13, 0.08, 8), { color: P.brass, pos: [lp[0], 2.4, lp[2]], flat: 0.4 });
      b.add(geo.cylinder(0.24, 0.09, 0.2, 8), { color: IRON_GREEN, pos: [lp[0], 3.4, lp[2]] });
      b.add(geo.sphere(0.4, 10, 7), { color: GLOBE, pos: [lp[0], 3.92, lp[2]], flat: 0.85 });
      b.add(geo.cone(0.15, 0.26, 6), { color: IRON_GREEN, pos: [lp[0], 4.28, lp[2]] });
      colliders.push({ kind: 'circle', x: lp[0], z: lp[2], r: 0.32 });
    }
    b.add(geo.box(SW * 2 + 0.6, 0.42, 0.3), { color: P.marble, pos: at(S, 0, 0, -SL - 0.15), rot, id: wallId });
    b.add(geo.box(SW * 2, 0.4, 0.02), { color: DARK, pos: at(S, 0, 0.1, -SL + 0.012), rot, flat: 1, outline: false });
    b.add(geo.box(SW * 2 + 0.6, 0.09, 0.11), { color: IRON_GREEN, pos: at(S, 0, 1.38, -SL - 0.15), rot });
    b.add(geo.plane(SW * 2 + 0.3, 0.94), { color: IRON_GREEN, pos: at(S, 0, 0.9, -SL - 0.15), rot, dither: 0.5, flat: 1 });
    // The board over the mouth. One plain word, both faces.
    const BOARD = '#256a55';
    const board = b.add(geo.box(SW * 2 + 0.5, 0.62, 0.1), { color: BOARD, pos: at(S, 0, 2.45, -BACK), rot, flat: 0.5 });
    for (const face of [1, -1]) {
      b.label({
        text: 'SUBWAY', size: 0.32, pos: at(S, 0, 2.76, -BACK + face * 0.05), rot: [0, S.yaw + (face > 0 ? 0 : Math.PI), 0],
        ink: P.marble, plate: BOARD, id: board, flat: 0.5, pad: 0.2, jitter: 0.25,
      });
    }
    // Moss in the joints of the low wall.
    clump(at(S, 0.7, 0.22, -SL - 0.55), [0.7, 0.3, 0.45], P.moss as string, rot, 3);
    clump(at(S, -SW - 0.45, 0.22, -1.6), [0.6, 0.28, 0.4], P.moss as string, rot, 3);
    const c = at(S, 0, 0, -SL / 2);
    colliders.push({ kind: 'box', x: c[0], z: c[2], hw: SW + 0.4, hd: SL / 2 + 0.45, rot: S.yaw });
    // He starts a few steps from the mouth, so this one reaches a little further than the rest.
    // The marker hangs in the mouth, under the board, where it is out of his first look north.
    const stand = at(S, 0, 0, -0.8);
    poi('about', stand[0], stand[2], 'Look back down the stairs', 1.6, 6.2);
  }

  // ------------------------------------------------------------------------------------------
  // Three greeting stones, left of the way in.
  // ------------------------------------------------------------------------------------------
  {
    // They stand in a stepped row so that from where he starts each one clears the next, and they
    // read left to right in the order he learned them. Turned a little toward him, but not so far
    // from the sun that the faces go into shade.
    const stones: { text: string; x: number; z: number; w: number; h: number; tone: string; lean: number; yaw: number }[] = [
      { text: 'HELLO', x: -5.3, z: 17.74, w: 1.55, h: 1.6, tone: '#f3ead8', lean: 0.2, yaw: 0.3 },
      { text: 'BONJOU', x: -4.23, z: 16.64, w: 1.75, h: 1.75, tone: P.marble as string, lean: -0.15, yaw: 0.22 },
      { text: 'BONJOUR', x: -2.86, z: 15.54, w: 1.85, h: 1.5, tone: '#eee0d2', lean: 0.1, yaw: 0.27 },
    ];
    stones.forEach((s, i) => {
      const f = frame(s.x, s.z, s.yaw);
      const rot: V3 = [0, f.yaw, 0];
      const hw = s.w / 2;
      // A rough cut slab: square at the foot, the top struck off at a slant.
      const outline: [number, number][] = [[-hw, 0], [hw, 0], [hw * 0.94, s.h * (0.78 + s.lean)], [hw * 0.35, s.h], [-hw * 0.5, s.h * 0.97], [-hw * 0.97, s.h * (0.8 - s.lean)]];
      const g = geo.extrude(outline, 0.5, { crease: 30 });
      const id = b.add(g, { color: s.tone, pos: [s.x, 0, s.z], rot, flat: 0.3 });
      cast(g, [s.x, 0, s.z], rot);
      const size = fit(s.text, 0.36, s.w - 0.42);
      b.label({ text: s.text, size, pos: at(f, 0, s.h * 0.48, 0.25), rot, ink: P.ink, plate: s.tone, id, flat: 0.3, pad: 0.2, jitter: 0.35 });
      // And on the back, for whoever comes at them across the plaza.
      b.label({ text: s.text, size, pos: at(f, 0, s.h * 0.48, -0.25), rot: [0, f.yaw + Math.PI, 0], ink: P.ink, plate: s.tone, id, flat: 0.3, pad: 0.2, jitter: 0.35 });
      // Moss at the foot, and a little up one side.
      clump(at(f, -hw + 0.1, 0.22, 0.2), [0.6, 0.32, 0.45], P.moss as string, rot, 3);
      clump(at(f, hw - 0.05, 0.5 + i * 0.1, -0.1), [0.3, 0.6, 0.4], LEAVES[2], rot, 3);
      flower(s.x + 0.5, 0.2, s.z + 0.55, [ORANGE, P.yellow, P.pink][i]);
      colliders.push({ kind: 'box', x: s.x, z: s.z, hw: hw + 0.05, hd: 0.35, rot: f.yaw });
    });
    poi('languages', -3.4, 19.3, 'Read the stones', 2.3);
  }

  // ------------------------------------------------------------------------------------------
  // The camera, put down. A view camera on its tripod under the dark cloth, and beside it the
  // last prints pegged on a line. The line does not stop at its second post.
  // ------------------------------------------------------------------------------------------
  const P1: V3 = [-15.5, 2.5, 10.5];
  const P2: V3 = [-20.5, 2.5, 3.0];
  const SKY: V3[] = [P2, [-23, 5, -2], [-26, 8.5, -6.5], [-26.8, 13.5, -11.5], [-24.5, 19.5, -16.5], [-21, 25.5, -20.5], [-15.5, 31, -23], [-10, 36, -24]];
  {
    const WOOD = '#b0714a';
    const CLOTH = mix(P.brickDeep, '#2a2350', 0.62);
    const f = frame(-14.0, 7.0, Math.atan2(0.6, 0.8));
    const rot: V3 = [0, f.yaw, 0];
    const hubY = 1.72;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      strut(at(f, Math.sin(a) * 0.8, 0.03, Math.cos(a) * 0.8 - 0.1), at(f, Math.sin(a) * 0.1, hubY, Math.cos(a) * 0.1 - 0.1), 0.055, WOOD);
    }
    b.add(geo.cylinder(0.16, 0.2, 0.16, 8), { color: P.brass, pos: at(f, 0, hubY - 0.04, -0.1), flat: 0.3 });
    b.add(geo.box(0.72, 0.1, 0.9), { color: WOOD, pos: at(f, 0, hubY + 0.12, 0.05), rot });
    // Bellows, front board and lens stick out from under the cloth.
    b.add(geo.box(0.56, 0.56, 0.16), { color: IRON, pos: at(f, 0, hubY + 0.25, 0.3), rot });
    b.add(geo.box(0.46, 0.46, 0.14), { color: mix(IRON, P.lavender, 0.3), pos: at(f, 0, hubY + 0.3, 0.44), rot });
    b.add(geo.box(0.62, 0.62, 0.08), { color: WOOD, pos: at(f, 0, hubY + 0.22, 0.56), rot });
    b.add(geo.tube([at(f, 0, hubY + 0.53, 0.58), at(f, 0, hubY + 0.53, 0.86)], 0.17, { radial: 8, perSpan: 1 }), { color: P.brass, flat: 0.3 });
    b.add(geo.sphere(0.15, 8, 6), { color: P.glass, pos: at(f, 0, hubY + 0.53, 0.84), flat: 0.8 });
    // The cloth: a hump over the back and a skirt hanging from it.
    const cloth = b.newId();
    const hump = geo.dome(1, 10, 4);
    b.add(hump, { color: CLOTH, pos: at(f, 0, hubY + 0.72, -0.12), rot, scale: [0.6, 0.5, 0.62], id: cloth });
    const skirt = geo.cylinder(0.6, 0.74, 1.0, 10, true);
    b.add(skirt, { gradient: { bottom: mix(CLOTH, P.shadow, 0.35), top: CLOTH }, color: CLOTH, pos: at(f, 0, hubY - 0.26, -0.12), rot, scale: [1, 1, 1.03], id: cloth, sway: 0.05 });
    cast(skirt, at(f, 0, 0.9, -0.12), rot, [1.1, 1.3, 1.1]);
    colliders.push({ kind: 'circle', x: f.x, z: f.z, r: 0.85 });

    // The line of prints: two posts, a wire with some sag in it.
    for (const p of [P1, P2]) {
      b.add(geo.cylinder(0.22, 0.27, 0.3, 8), { color: P.marbleShade, pos: [p[0], 0, p[2]] });
      const post = geo.cylinder(0.07, 0.09, p[1] - 0.2, 6);
      b.add(post, { color: IRON_GREEN, pos: [p[0], 0.3, p[2]] });
      cast(post, [p[0], 0.3, p[2]], undefined, [2.5, 1, 2.5]);
      b.add(geo.sphere(0.13, 8, 5), { color: P.brass, pos: [p[0], p[1] + 0.14, p[2]], flat: 0.4 });
      colliders.push({ kind: 'circle', x: p[0], z: p[2], r: 0.25 });
    }
    b.add(geo.tube([P1, P2], 0.03, { radial: 4, sag: 0.3, perSpan: 4 }), { color: IRON });
    // And on, up over the avenue and out of sight.
    b.add(geo.tube(SKY, 0.04, { radial: 4, perSpan: low ? 2 : 4 }), { color: IRON });
    // A small board on the first post says what they are.
    const bf = frame(P1[0], P1[2], Math.atan2(0.75, 0.66));
    const plateId = b.add(geo.box(1.5, 0.74, 0.07), { color: P.paper, pos: at(bf, 0, 1.0, 0.12), rot: [0, bf.yaw, 0], flat: 0.3 });
    b.label({ text: 'PORTRAITS', size: 0.19, pos: at(bf, 0, 1.52, 0.16), rot: [0, bf.yaw, 0], ink: P.ink, plate: P.paper, id: plateId, flat: 0.3, pad: 0.15, jitter: 0.3 });
    b.label({ text: (entry('camera')?.dates ?? '2016 to 2022').toUpperCase(), size: 0.13, pos: at(bf, 0, 1.2, 0.16), rot: [0, bf.yaw, 0], ink: P.violet, plate: P.paper, id: plateId, flat: 0.3, pad: 0.15, jitter: 0.3 });
    poi('camera', -12.4, 8.4, 'Lift the cloth', 2.9);
  }

  // ------------------------------------------------------------------------------------------
  // The bell tower. Brick on a marble foot, an open belfry, a copper roof, and one mast flying
  // two flags: coral for the people degree, teal for the machine one.
  // ------------------------------------------------------------------------------------------
  const T = frame(17.5, -10.5, Math.atan2(2 - 17.5, 10 + 10.5));
  const BELL_Y = 14.72;
  {
    const rot: V3 = [0, T.yaw, 0];
    const lip = mix(P.marble, P.marbleShade, 0.5);
    // The round of lawn and its kerb are sunk, so he walks onto them flush.
    b.add(geo.cylinder(4.35, 4.35, 0.12, low ? 14 : 22), { color: P.marbleShade, pos: [T.x, FLUSH - 0.123, T.z] });
    b.add(geo.cylinder(4.15, 4.15, 0.19, low ? 14 : 22), { color: P.grass, pos: [T.x, FLUSH - 0.19, T.z], flat: 0.35 });
    const steps = b.newId();
    b.add(geo.box(5.0, 0.4, 5.0), { color: P.marbleShade, pos: at(T, 0, 0, 0), rot, id: steps });
    b.add(geo.box(4.3, 0.62, 4.3), { color: P.marble, pos: at(T, 0, 0, 0), rot, id: steps });
    b.add(geo.box(3.7, 0.84, 3.7), { color: P.marbleShade, pos: at(T, 0, 0, 0), rot, id: steps });
    const foot = b.add(geo.bevelBox(3.1, 2.6, 3.1, 0.08), { color: P.marble, pos: at(T, 0, 0.84, 0), rot });
    b.add(geo.box(3.4, 0.26, 3.4), { color: lip, pos: at(T, 0, 3.44, 0), rot });
    // A door on the front of the foot, and the stone that says what was earned here.
    b.add(geo.arch({ span: 1.0, rise: 1.9, thick: 0.16, depth: 0.2, seg: 8 }), { color: lip, pos: at(T, 0, 0.84, 1.56), rot });
    b.add(geo.plane(1.0, 1.7), { color: BLUE, pos: at(T, 0, 1.69, 1.57), rot, flat: 0.5 });
    const SH = 8.2, SY = 3.7;
    b.add(geo.box(2.5, SH, 2.5), { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, pos: at(T, 0, SY, 0), rot, hatch: 0.08 });
    for (const y of [SY + 2.7, SY + 5.5]) b.add(geo.box(2.64, 0.2, 2.64), { color: P.marble, pos: at(T, 0, y, 0), rot });
    for (let k = 0; k < 4; k++) {
      const face: V3 = [0, T.yaw + (k * Math.PI) / 2, 0];
      const ff = frame(T.x, T.z, T.yaw + (k * Math.PI) / 2);
      b.add(geo.plane(0.5, 1.4), { color: WINDOW, pos: at(ff, 0, SY + 1.4, 1.27), rot: face, flat: 0.7 });
      b.add(geo.plane(0.5, 1.4), { color: k === 0 ? LIT : WINDOW, pos: at(ff, 0, SY + 4.2, 1.27), rot: face, flat: 0.7 });
      b.add(geo.torus(0.48, 0.09, 12, 4), { color: P.marble, pos: at(ff, 0, SY + 6.9, 1.27), rot: [Math.PI / 2, 0, -ff.yaw] });
      b.add(geo.sphere(0.42, 10, 6), { color: P.glass, pos: at(ff, 0, SY + 6.9, 1.24), rot: face, scale: [1, 1, 0.22], flat: 0.8 });
      // The belfry arcade on this side.
      b.add(geo.arch({ span: 1.75, rise: 2.5, thick: 0.275, depth: 0.42, seg: 8 }), { color: P.marble, pos: at(ff, 0, SY + SH + 0.35, 1.15), rot: face });
    }
    const BY = SY + SH; // belfry floor
    b.add(geo.box(3.2, 0.35, 3.2), { color: lip, pos: at(T, 0, BY, 0), rot });
    for (const cx of [-1.15, 1.15]) for (const cz of [-1.15, 1.15]) b.add(geo.box(0.56, 2.9, 0.56), { color: P.marble, pos: at(T, cx, BY + 0.35, cz), rot });
    b.add(geo.box(3.3, 0.3, 3.3), { color: P.marble, pos: at(T, 0, BY + 3.25, 0), rot });
    b.add(geo.box(3.7, 0.22, 3.7), { color: lip, pos: at(T, 0, BY + 3.55, 0), rot });
    const RY = BY + 3.77;
    b.add(geo.prism(4, 0.08, 2.5, 3.5), { gradient: { bottom: mix(P.verdigris, P.tealDeep, 0.35), top: P.verdigris }, color: P.verdigris, pos: [T.x, RY, T.z], rot: [0, T.yaw + Math.PI / 4, 0] });
    b.add(geo.sphere(0.28, 8, 6), { color: P.brass, pos: [T.x, RY + 3.6, T.z], flat: 0.4 });
    const MAST = 5.4;
    b.add(geo.cylinder(0.05, 0.075, MAST, 6), { color: IRON, pos: [T.x, RY + 3.7, T.z], sway: 0.12, swayBase: RY + 3.7 });
    b.add(geo.sphere(0.15, 8, 5), { color: P.brass, pos: [T.x, RY + 3.7 + MAST, T.z], flat: 0.4, sway: 0.12, swayBase: RY + 3.7 });
    // The flags fly north east, so both the way in and the avenue see them side on.
    const cloth = flag(2.9, 1.55, 1.25, 0.32);
    b.add(cloth, { color: CORAL, pos: [T.x, RY + 3.7 + MAST - 1.75, T.z], rot: [0, Math.PI / 4, 0], flat: 0.45, sway: 0.3, swayBase: RY + 3.7 });
    b.add(cloth, { color: P.teal, pos: [T.x, RY + 3.7 + MAST - 3.65, T.z], rot: [0, Math.PI / 4 + 0.12, 0], flat: 0.45, sway: 0.3, swayBase: RY + 3.7 });
    // Lettering on the foot, facing the plaza.
    b.label({ text: 'TWO DEGREES', size: fit('TWO DEGREES', 0.26, 2.5), pos: at(T, 0, 3.05, 1.56), rot, ink: P.ink, plate: P.marble, id: foot, pad: 0.15, jitter: 0.3 });
    const side: V3 = [0, T.yaw + Math.PI / 2, 0];
    const sf = frame(T.x, T.z, T.yaw + Math.PI / 2);
    b.label({ text: 'ELMS', size: 0.42, pos: at(sf, 0, 2.5, 1.56), rot: side, ink: P.ink, plate: P.marble, id: foot, pad: 0.15, jitter: 0.3 });
    b.label({ text: (entry('elms')?.dates ?? site.years).toUpperCase(), size: 0.3, pos: at(sf, 0, 1.75, 1.56), rot: side, ink: P.violet, plate: P.marble, id: foot, pad: 0.15, jitter: 0.3 });
    // Ivy on the shady side of the brick, moss on the steps.
    const nf = frame(T.x, T.z, T.yaw + Math.PI);
    clump(at(nf, 0.5, SY + 1.6, 1.3), [1.2, 2.6, 0.32], LEAVES[2], [0, nf.yaw, 0], 5);
    clump(at(nf, -0.2, SY + 4.6, 1.3), [0.8, 1.6, 0.3], LEAVES[0], [0, nf.yaw, 0]);
    clump(at(T, -2.2, 0.75, 1.9), [0.8, 0.3, 0.5], P.moss as string, rot, 3);
    clump(at(T, 2.6, 0.45, -1.5), [0.7, 0.3, 0.6], P.moss as string, rot, 3);
    colliders.push({ kind: 'box', x: T.x, z: T.z, hw: 2.55, hd: 2.55, rot: T.yaw });
    const stand = at(T, 2.1, 0, 3.6);
    poi('elms', stand[0], stand[2], 'Read the cornerstone', 2.6);
  }

  // ------------------------------------------------------------------------------------------
  // The trail board. Two small columns and a pediment holding the name of the place, set
  // beside the avenue and turned to face whoever walks in from it.
  // ------------------------------------------------------------------------------------------
  {
    const kx = site.arrive.x - ux * 8 + uz * 5.2, kz = site.arrive.z - uz * 8 - ux * 5.2;
    const f = frame(kx, kz, Math.atan2(site.arrive.x - kx, site.arrive.z - kz));
    const rot: V3 = [0, f.yaw, 0];
    const back: V3 = [0, f.yaw + Math.PI, 0];
    for (const side of [-1, 1]) {
      b.add(geo.bevelBox(0.76, 0.3, 0.76, 0.04), { color: P.marbleShade, pos: at(f, side * 1.85, 0, 0), rot });
      const shaft = geo.prism(high ? 10 : 8, 0.2, 0.25, 2.55);
      b.add(shaft, { color: P.marble, pos: at(f, side * 1.85, 0.3, 0) });
      cast(shaft, at(f, side * 1.85, 0.3, 0));
      b.add(geo.box(0.66, 0.2, 0.66), { color: mix(P.marble, P.marbleShade, 0.5), pos: at(f, side * 1.85, 2.85, 0), rot });
    }
    b.add(geo.box(4.6, 0.26, 0.74), { color: P.marble, pos: at(f, 0, 3.05, 0), rot });
    const pediment = geo.extrude([[-2.45, 0], [2.45, 0], [0, 1.0]], 0.62, { cacheKey: 'trailhead-pediment' });
    b.add(pediment, { color: P.marble, pos: at(f, 0, 3.31, 0), rot });
    b.add(geo.sphere(0.24, 8, 6), { color: ORANGE, pos: at(f, 0, 3.72, 0), scale: [1, 1, 1.6], flat: 0.5 });
    const boardGeo = geo.box(3.2, 1.75, 0.12);
    const board = b.add(boardGeo, { color: P.paper, pos: at(f, 0, 1.02, 0), rot, flat: 0.55 });
    cast(boardGeo, at(f, 0, 1.02, 0), rot);
    b.add(geo.box(3.3, 0.12, 0.2), { color: ORANGE, pos: at(f, 0, 0.9, 0), rot, flat: 0.4 });
    const nameSize = fit('TRAILHEAD', 0.5, 2.75);
    for (const [face, r] of [[1, rot], [-1, back]] as const) {
      const z = face * 0.07;
      b.label({ text: 'THE', size: 0.2, pos: at(f, 0, 2.47, z), rot: r, ink: P.violet, plate: P.paper, id: board, flat: 0.55, pad: 0.1, jitter: 0.3 });
      b.label({ text: 'TRAILHEAD', size: nameSize, pos: at(f, 0, 1.95, z), rot: r, ink: P.ink, plate: P.paper, id: board, flat: 0.55, pad: 0.12, jitter: 0.3 });
      b.label({ text: `${face > 0 ? 'WHERE I START' : 'NEW YORK'}  ${site.years.toUpperCase()}`, size: 0.15, pos: at(f, 0, 1.3, z), rot: r, ink: P.violet, plate: P.paper, id: board, flat: 0.55, pad: 0.1, jitter: 0.3 });
      // The two lines again, small, under the name.
      b.add(geo.box(2.5, 0.06, 0.02), { color: CORAL, pos: at(f, 0, 1.6, z * 1.1), rot, flat: 1, outline: false });
      b.add(geo.box(2.5, 0.06, 0.02), { color: P.teal, pos: at(f, 0, 1.5, z * 1.1), rot, flat: 1, outline: false });
    }
    clump(at(f, 2.0, 3.5, 0), [0.7, 0.4, 0.5], LEAVES[2], rot, 3);
    clump(at(f, -1.9, 0.3, 0.2), [0.6, 0.32, 0.5], P.moss as string, rot, 3);
    colliders.push({ kind: 'box', x: kx, z: kz, hw: 2.25, hd: 0.42, rot: f.yaw });
  }

  // ------------------------------------------------------------------------------------------
  // Small things of the corner: a hydrant at the kerb and a bench that looks at the arch.
  // ------------------------------------------------------------------------------------------
  {
    const hx = 5.5, hz = 17.6;
    const body = b.newId();
    b.add(geo.cylinder(0.26, 0.28, 0.1, 8), { color: mix(ORANGE, P.shadow, 0.3), pos: [hx, 0, hz] });
    b.add(geo.cylinder(0.17, 0.2, 0.56, 8), { color: ORANGE, pos: [hx, 0.1, hz], id: body });
    b.add(geo.cylinder(0.23, 0.23, 0.07, 8), { color: ORANGE, pos: [hx, 0.62, hz] });
    b.add(geo.dome(0.19, 8, 3), { color: ORANGE, pos: [hx, 0.69, hz], id: body });
    b.add(geo.cylinder(0.05, 0.05, 0.09, 6), { color: P.brass, pos: [hx, 0.86, hz], flat: 0.4 });
    b.add(geo.cylinder(0.09, 0.09, 0.56, 6), { color: mix(ORANGE, P.shadow, 0.3), pos: [hx, 0.42, hz - 0.28], rot: [Math.PI / 2, 0, 0] });
    b.add(geo.cylinder(0.11, 0.11, 0.17, 6), { color: P.brass, pos: [hx - 0.17, 0.42, hz], rot: [0, 0, Math.PI / 2], flat: 0.4 });
    colliders.push({ kind: 'circle', x: hx, z: hz, r: 0.3 });

    const f = frame(10.6, 11.4, Math.atan2(AX - 10.6, AZ + 6 - 11.4));
    const rot: V3 = [0, f.yaw, 0];
    const WOOD = '#b0714a';
    for (const side of [-1, 1]) b.add(geo.bevelBox(0.26, 0.52, 0.66, 0.04), { color: P.marble, pos: at(f, side * 0.92, 0, 0), rot });
    const seatGeo = geo.box(2.3, 0.09, 0.6);
    b.add(seatGeo, { color: WOOD, pos: at(f, 0, 0.46, 0.02), rot });
    cast(seatGeo, at(f, 0, 0.46, 0.02), rot);
    b.add(geo.box(2.3, 0.4, 0.08), { color: WOOD, pos: at(f, 0, 0.72, -0.3), rot });
    for (const side of [-1, 1]) b.add(geo.box(0.09, 0.62, 0.09), { color: IRON_GREEN, pos: at(f, side * 0.92, 0.5, -0.3), rot });
    colliders.push({ kind: 'box', x: f.x, z: f.z, hw: 1.2, hd: 0.4, rot: f.yaw });
  }

  // ------------------------------------------------------------------------------------------
  // Street trees. None on the line of sight through the arch, none under the flying prints.
  // ------------------------------------------------------------------------------------------
  tree(AX - HALF - 4.4, AZ + 0.1, 7.6, LEAVES[1], false);
  tree(-10.0, 17.0, 6.6, LEAVES[0]);
  tree(16.0, 12.7, 6.8, LEAVES[3]);
  tree(...polar(104, 22.5), 6.2, LEAVES[4], false);
  tree(22.6, -8.4, 7.4, LEAVES[2]);
  tree(16.4, -16.6, 6.4, LEAVES[0]);
  tree(...polar(338, 22.5), 6.8, LEAVES[3], false);
  tree(...polar(25, 22.5), 7.2, LEAVES[1], false);
  if (!low) {
    // Two cypresses where the street he came in by runs out. Both behind his first look north.
    cypress(-4.3, 27.9, 7.4);
    cypress(5.6, 28.2, 8.2);
  }

  group.add(b.build('trailhead'));

  // ------------------------------------------------------------------------------------------
  // The bell. Its own mesh so it can swing.
  // ------------------------------------------------------------------------------------------
  const bellPivot = new THREE.Group();
  bellPivot.position.set(T.x, BELL_Y, T.z);
  bellPivot.rotation.y = T.yaw;
  const bb = kit.builder();
  bb.add(geo.box(2.1, 0.18, 0.18), { color: '#7a5a48', pos: [0, -0.09, 0] });
  bb.add(geo.lathe([[0.8, 0], [0.74, 0.14], [0.56, 0.5], [0.44, 0.95], [0.32, 1.14], [0.0, 1.22]], high ? 14 : 10, { cacheKey: 'trailhead-bell-' + (high ? 14 : 10) }), {
    gradient: { bottom: mix(P.brass, P.orange, 0.25), top: P.brass }, color: P.brass, pos: [0, -1.36, 0], flat: 0.2,
  });
  bb.add(geo.sphere(0.15, 8, 5), { color: IRON, pos: [0, -1.4, 0] });
  const bell = bb.build('trailhead-bell');
  bellPivot.add(bell);
  group.add(bellPivot);

  // ------------------------------------------------------------------------------------------
  // The prints. One card, drawn many times: a few on the line by the camera, the rest on the
  // wire that climbs away over the avenue. Far too many for one line, which is the idea.
  // ------------------------------------------------------------------------------------------
  const pb = kit.builder();
  pb.add(geo.box(0.62, 0.84, 0.03), { color: '#ffffff', pos: [0, -0.92, 0], flat: 0.35 });
  pb.add(geo.box(0.09, 0.14, 0.06), { color: '#d9b24f', pos: [0, -0.13, 0], flat: 0.5, outline: false });
  for (const face of [1, -1]) {
    const z = face * 0.024;
    const up: V3 = [(face * Math.PI) / 2, 0, 0];
    pb.add(geo.plane(0.5, 0.64), { color: '#b4acd4', pos: [0, -0.47, z], flat: 1, outline: false });
    pb.add(geo.disc(0.105, 8), { color: '#4a4480', pos: [0, -0.4, z * 1.4], rot: up, flat: 1, outline: false });
    pb.add(geo.disc(0.2, 8), { color: '#4a4480', pos: [0, -0.68, z * 1.4], rot: up, scale: [1, 1, 0.52], flat: 1, outline: false });
  }
  const printGeo = pb.geometry ? pb.geometry() : geo.box(0.62, 0.84, 0.03);
  // Where each one hangs: position, heading, size, and a phase so they do not move as one.
  const spots: number[] = [];
  const hang = (x: number, y: number, z: number, yaw: number, size: number): void => {
    spots.push(x, y, z, yaw, size, rng() * 6.28);
  };
  {
    const lineYaw = Math.atan2(-(P2[2] - P1[2]), P2[0] - P1[0]);
    const n = low ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.7) / (n + 0.4);
      hang(P1[0] + (P2[0] - P1[0]) * t, P1[1] - 0.3 * 4 * t * (1 - t) * 0.85 + 0.03, P1[2] + (P2[2] - P1[2]) * t, lineYaw, 1);
    }
    const curve = new THREE.CatmullRomCurve3(SKY.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    const len = curve.getLength();
    const gap = low ? 3.2 : high ? 1.7 : 2.2;
    const tan = new THREE.Vector3();
    const pt = new THREE.Vector3();
    for (let d = 2.2; d < len - 0.5; d += gap) {
      const u = d / len;
      curve.getPointAt(u, pt);
      curve.getTangentAt(u, tan);
      hang(pt.x, pt.y + 0.03, pt.z, Math.atan2(-tan.z, tan.x), 1 + u * 0.9);
    }
  }
  const COUNT = spots.length / 6;
  const prints = kit.instances(printGeo, COUNT);
  prints.name = 'trailhead-prints';
  const TINTS = ['#ffffff', '#fbe3c8', '#f6cdc4', '#d3e8ef', '#eadff6', '#fff1bd'].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const place = (t: number): void => {
    for (let i = 0; i < COUNT; i++) {
      const o = i * 6;
      const ph = spots[o + 5];
      const size = spots[o + 4];
      // The ones high on the wire catch more wind.
      const wind = 0.1 + (size - 1) * 0.5;
      e.set(Math.sin(t * 1.1 + ph) * wind + Math.sin(ph * 3.1) * wind * 0.6, spots[o + 3] + Math.sin(t * 0.7 + ph * 1.7) * wind * 0.5, 0);
      q.setFromEuler(e);
      v.set(spots[o], spots[o + 1], spots[o + 2]);
      sc.set(size, size, size);
      m.compose(v, q, sc);
      prints.setMatrixAt(i, m);
    }
    prints.instanceMatrix.needsUpdate = true;
  };
  place(0);
  for (let i = 0; i < COUNT; i++) prints.setColorAt(i, TINTS[i % TINTS.length]);
  if (prints.instanceColor) prints.instanceColor.needsUpdate = true;
  prints.computeBoundingSphere();
  group.add(prints);

  return {
    group,
    colliders,
    pois,
    update(_dt, t) {
      // The bell rocks, slow and not far. The prints turn on their pegs.
      bell.rotation.x = Math.sin(t * 0.9) * 0.2;
      place(t);
    },
  };
}

/** A flag caught mid wave, hoist on the y axis, fly along +x. One sheet, drawn from both sides. */
function flag(w: number, h: number, waves: number, amp: number): THREE.BufferGeometry {
  const n = 8;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const z = Math.sin(u * waves * Math.PI * 2) * amp * (0.25 + 0.75 * u);
    const droop = u * u * h * 0.2;
    pos.push(u * w, -droop, z, u * w, h - droop * 0.55, z);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
