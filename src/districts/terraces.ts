// Cloud Terraces. Google Cloud, drawn as stepped marble terraces in the middle of a city block.
// You come in from the avenue in the south east and look across the plaza at the terraces to the
// north: four steps of white stone, the bottom one a solid retaining wall with the name cut into
// it and a round vault door set in it, the three above it open colonnades with planters along
// every edge and green hanging down over the columns. A little round temple with a teal dome sits
// on the top step.
// To the west is a round hole in the paving that shows the sky under the island, with cloud
// drifting across it, and seven pods on stalks far too thin for them rising out of it, one per
// team. A plate on the rim under each pod gives the team name.
// To the east, between the two roads, the two steps of a ladder far too big for anyone, lettered
// L7 and L8, rise out of a second smaller hole of sky.
// To the south a ring of columns stands on a lawn round a stone table: the committee.
//
// Roads come in from the south east (the avenue up from the Commons), the east (on to the Mask
// Garden) and the west south west (the side street down to the Boneyard). Nothing stands on them.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, Poi } from '../types';

type V3 = [number, number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const TRUNK = '#7a5a86';
const DOOR = '#3d3766';
const SKYPOOL = '#8ecbee';
const SKYPOOL_DEEP = '#6fb2e6';
const CLOUD = '#fbfdff';
const LEAVES = ['#7fb85a', '#63aa5e', '#3f8a57', '#8cc56c', '#4f9c62', '#6ea884'];
const FLOWERS = ['#f0a0b6', '#f3c531', '#f7f0e4', '#7fd8ea'];

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

export const district: DistrictModule = {
  id: 'terraces',
  build(ctx) {
    return buildTerraces(ctx);
  },
};

function buildTerraces(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const sun = ctx.sun ?? FALLBACK_SUN;
  const [CREAM, TEAL, CYAN] = site.accents as [string, string, string];
  const LAWN_Y = 0.05;
  const paveShade = mix(mix(P.pave, CREAM, 0.1), P.shadow, 0.3);
  const lawnShade = mix(P.grass, P.shadow, 0.35);

  const group = new THREE.Group();
  group.name = 'terraces';
  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const b = kit.builder();
  const has = (id: string): boolean => entries.some((e) => e.id === id);
  const fit = (text: string, size: number, max: number): number => {
    const w = b.measure ? b.measure({ text, size }).width : text.length * size * 0.7;
    return w > max ? (size * max) / w : size;
  };
  const cast = (g: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: number | V3, y = 0, color = paveShade): void => {
    if (low) return;
    b.shadow?.(g, { color, sun, pos, rot, scale, y, lift: 0.015 });
  };
  /** Rotate a local offset (x along the face, z out of the face) by yaw and add a centre. */
  const place = (cx: number, cz: number, yaw: number) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return (x: number, y: number, z: number): V3 => [cx + x * c + z * s, y, cz - x * s + z * c];
  };

  // A clump of leaf. Hedges, beds, and ivy when it is squashed flat against stone.
  let clumpSeed = 311;
  const clump = (pos: V3, scale: V3, tint: string, rot?: V3, count = 4, sway = 0.1): void => {
    b.add(geo.blobs(clumpSeed++ % 40, count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos, rot, scale, sway,
    });
  };
  // A street tree: a trunk and three round masses of leaf, on a little bed of its own.
  const tree = (x: number, z: number, h: number, tint: string): void => {
    const y = ctx.groundAt(x, z);
    const s = h / 7;
    const a = rng() * 6.28;
    const ca = Math.cos(a), sa = Math.sin(a);
    b.add(geo.cylinder(1.0, 1.0, 0.12, 10), { color: P.grassDeep, pos: [x, y, z], flat: 0.5 });
    b.add(geo.cylinder(1.12, 1.12, 0.16, 10, true), { color: P.brick, pos: [x, y, z] });
    b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, y, z], sway: 0.2, swayBase: y });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: y };
    const id = b.newId();
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    b.add(ball, { ...leaf, id, pos: [x, y + 4.9 * s, z], scale: [2.5 * s, 2.0 * s, 2.4 * s] });
    b.add(ball, { ...leaf, id, pos: [x - 1.6 * s * ca, y + 4.6 * s, z - 1.6 * s * sa], scale: [1.5 * s, 1.25 * s, 1.45 * s] });
    b.add(ball, { ...leaf, pos: [x + 1.6 * s * ca + 0.6 * sa, y + 4.0 * s, z + 1.6 * s * sa], scale: [1.7 * s, 1.35 * s, 1.6 * s] });
    if (Math.abs(y) < 0.05) cast(ball, [x, 4.9 * s, z], undefined, [2.5 * s, 2.0 * s, 2.4 * s]);
    colliders.push({ kind: 'circle', x, z, r: 0.34 * s + 0.1 });
  };
  // A slim dark cypress, for the ends of the terraces.
  const cypress = (x: number, y: number, z: number, h: number): void => {
    const id = b.newId();
    b.add(geo.cylinder(0.12, 0.14, 0.5, 5), { color: TRUNK, pos: [x, y, z], id });
    b.add(geo.capsule(0.55 * (h / 3.5), h, 7, 2), {
      gradient: { bottom: mix(P.grassDeep, P.shadow, 0.3), top: P.moss }, color: P.grassDeep, pos: [x, y + 0.35, z], sway: 0.35, swayBase: y,
    });
  };
  // A ring of stone standing on the ground: the kerb round each hole of sky. Lathe profile wound so
  // the inner face looks in and the outer face looks out.
  const kerb = (x: number, z: number, ri: number, ro: number, h: number, color: ColorLike, key: string): void => {
    b.add(geo.lathe([[ro, 0], [ro, h], [ri, h], [ri, 0]], 32, { crease: 40, cacheKey: 'terraces-kerb-' + key }), { color, pos: [x, 0, z] });
  };
  const lawn = (x: number, z: number, rx: number, rz: number, rot = 0): void => {
    b.add(geo.cylinder(1, 1, LAWN_Y, 32), { color: P.grass, pos: [x, 0, z], scale: [rx, 1, rz], rot: [0, rot, 0], flat: 0.3 });
  };

  // A fluted column: a square base, a teal ring, the shaft, a capital and an abacus. Height to the top
  // of the abacus is `h`.
  const column = (x: number, y: number, z: number, h: number, r = 0.34, castOn?: number): void => {
    const shaftH = h - 0.25 - 0.08 - 0.22 - 0.18;
    b.add(geo.bevelBox(r * 2.8, 0.25, r * 2.8, 0.05), { color: P.marbleShade, pos: [x, y, z] });
    b.add(geo.cylinder(r * 1.25, r * 1.25, 0.08, 12), { color: TEAL, pos: [x, y + 0.25, z], flat: 0.4 });
    const shaft = geo.prism(12, r * 0.88, r, shaftH);
    b.add(shaft, { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [x, y + 0.33, z] });
    if (castOn !== undefined) cast(shaft, [x, y + 0.33, z], undefined, undefined, castOn);
    b.add(geo.cylinder(r * 1.45, r * 0.95, 0.22, 12), { color: P.marbleShade, pos: [x, y + 0.33 + shaftH, z] });
    b.add(geo.bevelBox(r * 2.8, 0.18, r * 2.8, 0.04), { color: P.marble, pos: [x, y + h - 0.18, z] });
  };
  // Green hanging down a face: a few long cones, tip down, swaying. `x0..x1` along the face at z.
  const vines = (x0: number, x1: number, y: number, z: number, maxLen: number, skip?: (x: number) => boolean): void => {
    const step = low ? 1.3 : 0.75;
    for (let x = x0; x <= x1; x += step * (0.7 + rng() * 0.6)) {
      if (skip && skip(x)) continue;
      const len = maxLen * (0.35 + rng() * 0.65);
      const r = 0.22 + rng() * 0.18;
      const tint = LEAVES[Math.floor(rng() * LEAVES.length)];
      if (rng() < 0.5) {
        // A curtain of ivy hanging flat against the face.
        clump([x, y - len * 0.42, z + 0.16], [0.45 + rng() * 0.25, len * 0.5, 0.22], tint, undefined, 4, 0.06);
      } else {
        b.add(geo.cone(r * 0.75, len, 5), {
          gradient: { bottom: mix(tint, P.shadow, 0.25), top: tint }, color: tint, pos: [x, y + 0.1, z + r * 0.5], rot: [Math.PI, 0, 0], sway: 0.25, swayBase: y - len,
        });
      }
      if (!low && rng() < 0.18) {
        clump([x, y - len * 0.55, z + r + 0.08], [0.18, 0.18, 0.18], FLOWERS[Math.floor(rng() * 2)], undefined, 3, 0);
      }
    }
  };

  // ------------------------------------------------------------------------------------------
  // The terraces. Four steps, each set back from the one below it, all sharing one back wall.
  // ------------------------------------------------------------------------------------------
  const HX = 2; // centre line of the terraces, east of the pad centre so the west road stays clear
  const BACK = -28.5;
  type Tier = { w: number; front: number; y0: number; top: number };
  const tiers: Tier[] = [
    { w: 22, front: -13, y0: 0, top: 5.2 },
    { w: 17, front: -16.8, y0: 5.2, top: 9.4 },
    { w: 12.4, front: -20.6, y0: 9.4, top: 13.6 },
    { w: 8, front: -24.4, y0: 13.6, top: 17.3 },
  ];
  const SLAB = 0.55;
  let wallId = 0;
  for (let i = 0; i < tiers.length; i++) {
    const T = tiers[i];
    const depth = T.front - BACK;
    const zc = (T.front + BACK) / 2;
    if (i === 0) {
      // The retaining wall: solid, with a coping along its top.
      const wall = geo.box(T.w, T.top - 0.3, depth);
      wallId = b.add(wall, { color: P.marble, pos: [HX, 0, zc] });
      cast(geo.box(T.w, T.top, depth), [HX, 0, zc]);
      b.add(geo.bevelBox(T.w + 0.5, 0.3, depth + 0.5, 0.06), { color: P.marbleShade, pos: [HX, T.top - 0.3, zc] });
      // A plinth course along the foot of the wall.
      b.add(geo.bevelBox(T.w + 0.3, 0.45, 0.35, 0.05), { color: P.marbleShade, pos: [HX, 0, T.front + 0.1] });
    } else {
      // An open colonnade in front of a shaded core, closed at each end by a pier, under a slab.
      const colH = T.top - SLAB - T.y0;
      const coreFront = T.front - 1.9;
      b.add(geo.box(T.w - 0.8, colH, coreFront - BACK), {
        color: mix(P.marbleShade, P.marble, 0.15), pos: [HX, T.y0, (coreFront + BACK) / 2], hatch: 0.2,
      });
      // Dark doorways in the core wall, between the columns.
      const nDoors = i === 3 ? 1 : i === 2 ? 2 : 3;
      for (let d = 0; d < nDoors; d++) {
        const dx = nDoors === 1 ? 0 : (d - (nDoors - 1) / 2) * (T.w / (nDoors + 0.6));
        b.add(geo.arch({ span: 1.3, rise: Math.min(2.6, colH - 0.6), thick: 0.22, depth: 0.2 }), { color: P.marble, pos: [HX + dx, T.y0, coreFront + 0.08] });
        b.add(geo.plane(1.3, Math.min(2.6, colH - 0.6)), { color: DOOR, pos: [HX + dx, T.y0 + Math.min(2.6, colH - 0.6) / 2, coreFront + 0.02], flat: 0.6 });
      }
      for (const side of [-1, 1]) {
        b.add(geo.box(1.0, colH, 1.95), { color: P.marble, pos: [HX + side * (T.w / 2 - 0.5), T.y0, T.front - 0.97] });
      }
      const span = T.w - 2.4;
      const n = Math.max(2, Math.round(span / 2.3) + 1);
      for (let k = 0; k < n; k++) {
        const x = HX - span / 2 + (k * span) / (n - 1);
        column(x, T.y0, T.front - 0.55, colH, 0.32);
      }
      const slab = geo.bevelBox(T.w + 0.3, SLAB, depth + 0.3, 0.06);
      b.add(slab, { color: P.marble, pos: [HX, T.top - SLAB, zc] });
      b.add(geo.box(T.w + 0.32, 0.12, 0.2), { color: TEAL, pos: [HX, T.top - SLAB + 0.2, T.front + 0.1], flat: 0.4 });
    }
    // Every step but the last carries a planter along its front edge with green spilling over it.
    if (i < tiers.length - 1) {
      const pw = T.w - 0.8;
      b.add(geo.box(pw, 0.55, 0.9), { color: P.marbleShade, pos: [HX, T.top, T.front - 0.55] });
      const hedge = low ? 3 : 6;
      for (let k = 0; k < hedge; k++) {
        const x = HX - pw / 2 + ((k + 0.5) / hedge) * pw;
        clump([x, T.top + 0.7, T.front - 0.5], [pw / hedge / 1.6, 0.5, 0.55], LEAVES[(k + i) % LEAVES.length], undefined, 4, 0.12);
      }
      // Leave the name and the vault clear on the bottom wall.
      const skip = i === 0 ? (x: number) => Math.abs(x - HX) < 5.2 : undefined;
      vines(HX - pw / 2 + 0.2, HX + pw / 2 - 0.2, T.top + 0.3, T.front, i === 0 ? 2.6 : 2.4, skip);
      // Cypresses at the two ends of each terrace walk.
      const nt = tiers[i + 1];
      const walk = (T.front + nt.front) / 2 - 0.4;
      for (const side of [-1, 1]) cypress(HX + side * (T.w / 2 - 1.2), T.top, walk - 0.3, i === 0 ? 3.8 : 3.0);
      // Ivy down the side walls.
      for (const side of [-1, 1]) {
        const sx = HX + side * (T.w / 2 + 0.05);
        clump([sx, T.top - 1.2, T.front - 1.6 - rng() * 2], [0.3, 1.5, 1.4], LEAVES[(i * 2 + 2) % LEAVES.length], undefined, 4, 0.05);
      }
    }
  }
  const T0 = tiers[0];
  // The name across the retaining wall, over the vault door.
  const NAME = site.name.toUpperCase();
  b.label({ text: NAME, size: fit(NAME, 0.78, 9.6), pos: [HX, 4.15, T0.front], ink: P.ink, plate: P.marble, id: wallId, pad: 0.12, jitter: 0.35 });
  // Ivy taking the two front corners of the wall.
  for (const side of [-1, 1]) {
    const cx = HX + side * (T0.w / 2 - 0.9);
    clump([cx, 1.5, T0.front + 0.12], [1.3, 1.8, 0.35], LEAVES[2], undefined, 5, 0.04);
    clump([cx - side * 0.8, 3.0, T0.front + 0.1], [0.9, 1.2, 0.3], LEAVES[5], undefined, 4, 0.04);
    clump([HX + side * (T0.w / 2 + 0.12), 1.8, T0.front - 1.2], [0.35, 1.9, 1.5], LEAVES[4], undefined, 4, 0.04);
  }
  // Beds along the foot of the wall either side of the vault.
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? HX - T0.w / 2 + 0.6 : HX + 2.6;
    const x1 = side < 0 ? HX - 2.6 : HX + T0.w / 2 - 0.6;
    const bw = x1 - x0;
    b.add(geo.box(bw, 0.32, 1.1), { color: P.marbleShade, pos: [(x0 + x1) / 2, 0, T0.front + 0.85] });
    b.add(geo.box(bw - 0.2, 0.06, 0.9), { color: P.grassDeep, pos: [(x0 + x1) / 2, 0.32, T0.front + 0.85], flat: 0.4 });
    const nb = low ? 3 : 6;
    for (let k = 0; k < nb; k++) {
      const x = x0 + ((k + 0.5) / nb) * bw;
      clump([x, 0.65, T0.front + 0.85], [bw / nb / 1.5, 0.45, 0.5], k % 3 === 1 ? FLOWERS[k % 2] : LEAVES[k % LEAVES.length], undefined, 4, 0.12);
    }
  }
  colliders.push({ kind: 'box', x: HX, z: (T0.front + 0.6 + BACK) / 2, hw: T0.w / 2 + 0.25, hd: (T0.front + 0.6 - BACK) / 2 });

  // The temple on the top step: six columns, a ring, a teal dome, a brass finial.
  {
    const T = tiers[3];
    const cz = (T.front + BACK) / 2;
    const y = T.top;
    b.add(geo.cylinder(2.3, 2.4, 0.3, 16), { color: P.marbleShade, pos: [HX, y, cz] });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      column(HX + Math.cos(a) * 1.75, y + 0.3, cz + Math.sin(a) * 1.75, 2.8, 0.24);
    }
    b.add(geo.cylinder(2.25, 2.25, 0.5, 16), { color: P.marble, pos: [HX, y + 3.1, cz] });
    b.add(geo.cylinder(2.32, 2.32, 0.12, 16), { color: TEAL, pos: [HX, y + 3.3, cz], flat: 0.4 });
    b.add(geo.dome(2.15, 14, 5), { gradient: { bottom: TEAL, top: mix(P.verdigris, '#ffffff', 0.2) }, color: TEAL, pos: [HX, y + 3.6, cz] });
    b.add(geo.cylinder(0.1, 0.14, 0.7, 6), { color: P.brass, pos: [HX, y + 5.7, cz], flat: 0.3 });
    b.add(geo.sphere(0.28, 10, 6), { color: P.brass, pos: [HX, y + 6.5, cz], flat: 0.3 });
    // The top terrace is planted too.
    clump([HX - 3.1, y + 0.4, T.front - 0.7], [0.8, 0.5, 0.6], LEAVES[1], undefined, 4, 0.12);
    clump([HX + 3.1, y + 0.4, T.front - 0.7], [0.8, 0.5, 0.6], LEAVES[3], undefined, 4, 0.12);
    clump([HX + 1.6, y + 3.3, cz + 2.0], [0.9, 0.35, 0.45], LEAVES[2], undefined, 4, 0.05);
  }

  // ------------------------------------------------------------------------------------------
  // The vault: a round steel door with a wheel lock, set in the middle of the retaining wall.
  // ------------------------------------------------------------------------------------------
  {
    const z = T0.front;
    const cy = 1.6;
    const face: V3 = [Math.PI / 2, 0, 0];
    b.add(geo.cylinder(1.85, 1.85, 0.14, 24), { color: P.marbleShade, pos: [HX, cy, z], rot: face });
    b.add(geo.cylinder(1.42, 1.42, 0.34, 24), { gradient: { bottom: mix(P.steel, P.shadow, 0.2), top: mix(P.steel, '#ffffff', 0.15) }, color: P.steel, pos: [HX, cy, z], rot: face });
    b.add(geo.torus(1.48, 0.13, 24, 6), { color: TEAL, pos: [HX, cy, z + 0.3], rot: face, flat: 0.3 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.add(geo.sphere(0.075, 6, 4), { color: P.brass, pos: [HX + Math.cos(a) * 1.18, cy + Math.sin(a) * 1.18, z + 0.36], flat: 0.3 });
    }
    // The wheel, on a hub.
    b.add(geo.cylinder(0.17, 0.17, 0.42, 8), { color: P.brass, pos: [HX, cy, z + 0.3], rot: face, flat: 0.3 });
    b.add(geo.torus(0.62, 0.075, 18, 5), { color: P.brass, pos: [HX, cy, z + 0.64], rot: face, flat: 0.3 });
    for (let k = 0; k < 3; k++) {
      b.add(geo.box(1.24, 0.09, 0.09), { color: P.brass, pos: [HX, cy, z + 0.64], rot: [0, 0, (k * Math.PI) / 3], flat: 0.3 });
    }
    // Two heavy hinges on the left, and a plate cut into the wall to the right.
    for (const dy of [-0.75, 0.75]) b.add(geo.bevelBox(0.5, 0.32, 0.3, 0.04), { color: P.steel, pos: [HX - 1.55, cy + dy - 0.16, z + 0.12] });
    b.add(geo.bevelBox(1.4, 0.55, 0.12, 0.03), { color: P.brass, pos: [HX, 0.2, z + 0.05], flat: 0.2 });
    b.label({ text: 'SEALED', size: 0.22, pos: [HX, 0.475, z + 0.12], ink: P.ink, plate: P.brass, flat: 0.2, pad: 0.12 });
    b.label({ text: 'CLEARED\nHIRING', size: 0.2, pos: [HX + 2.65, 1.7, z], ink: P.violet, plate: P.marble, id: wallId, align: 'center', pad: 0.1 });
    if (has('sovereign-vault')) pois.push({ entry: 'sovereign-vault', x: HX, z: z + 2.4, y: 3.0, reach: 4.2, prompt: 'Try the vault door' });
  }

  // ------------------------------------------------------------------------------------------
  // The pod pool: a round of sky let into the paving, cloud drifting over it, seven pods on stalks.
  // ------------------------------------------------------------------------------------------
  const PX = -15, PZ = 7;
  const PR = 6.2; // inside of the kerb
  const PODS = 7;
  const podH = [4.6, 8.8, 5.6, 9.8, 6.2, 10.6, 7.2];
  const podS = [1.0, 0.92, 1.08, 0.86, 1.0, 0.82, 0.95];
  const podX: number[] = [];
  const podZ: number[] = [];
  // Plate 0 faces the pad centre so the place to stand is obvious.
  const toCentre = Math.atan2(-PZ, -PX);
  {
    lawn(PX, PZ, 9.4, 9.4);
    b.add(geo.disc(PR + 0.05, 32), { color: SKYPOOL, pos: [PX, LAWN_Y + 0.02, PZ], flat: 1 });
    b.add(geo.ring(PR - 1.4, PR + 0.05, 32), { color: SKYPOOL_DEEP, pos: [PX, LAWN_Y + 0.03, PZ], flat: 1, outline: false });
    kerb(PX, PZ, PR, PR + 0.6, 0.42, P.brick, 'pods');
    b.add(geo.lathe([[PR + 0.72, 0.42], [PR + 0.72, 0.56], [PR - 0.08, 0.56], [PR - 0.08, 0.42]], 32, { crease: 40, cacheKey: 'terraces-pods-cap' }), { color: P.marble, pos: [PX, 0, PZ] });
    colliders.push({ kind: 'circle', x: PX, z: PZ, r: PR + 0.75 });
    // Moss creeping over the kerb.
    for (let k = 0; k < (low ? 3 : 6); k++) {
      const a = toCentre + 0.9 + k * 0.85;
      clump([PX + Math.cos(a) * (PR + 0.4), 0.45, PZ + Math.sin(a) * (PR + 0.4)], [0.8, 0.3, 0.5], LEAVES[(k + 2) % LEAVES.length], [0, -a, 0], 4, 0.05);
    }
    for (let k = 0; k < PODS; k++) {
      const a = toCentre + (k / PODS) * Math.PI * 2;
      const sr = 3.5 + (k % 2) * 0.6;
      const sx = PX + Math.cos(a) * sr;
      const sz = PZ + Math.sin(a) * sr;
      podX.push(sx);
      podZ.push(sz);
      const top = podH[k] - 0.55 * podS[k];
      b.add(geo.cylinder(0.075, 0.11, top, 5), { color: P.steel, pos: [sx, LAWN_Y, sz], sway: 0.0 });
      b.add(geo.cylinder(0.3, 0.38, 0.25, 8), { color: TEAL, pos: [sx, LAWN_Y, sz], flat: 0.3 });
      cast(geo.cylinder(0.075, 0.11, top, 5), [sx, LAWN_Y, sz], undefined, undefined, LAWN_Y + 0.03, mix(SKYPOOL, P.shadow, 0.3));
      // The plate on the rim, outside the kerb, with the team name.
      const pr = PR + 1.35;
      const px = PX + Math.cos(a) * pr;
      const pz = PZ + Math.sin(a) * pr;
      const yaw = Math.atan2(Math.cos(a), Math.sin(a)); // faces out, away from the pool
      const at = place(px, pz, yaw);
      const r: V3 = [0, yaw, 0];
      const name = TEAMS[k];
      const ts = 0.17;
      const m = b.measure ? b.measure({ text: name, size: ts, maxWidth: 1.5 }) : { width: 1.5, height: 0.6, lines: 2 };
      const ph = Math.max(0.62, m.height + 0.32);
      b.add(geo.bevelBox(0.18, 0.95, 0.18, 0.03), { color: P.marbleShade, pos: at(-0.7, 0, -0.02), rot: r });
      b.add(geo.bevelBox(0.18, 0.95, 0.18, 0.03), { color: P.marbleShade, pos: at(0.7, 0, -0.02), rot: r });
      const plate = b.add(geo.bevelBox(1.8, ph, 0.12, 0.03), { color: CREAM, pos: at(0, 0.85, 0), rot: r, flat: 0.5 });
      b.add(geo.box(1.84, 0.1, 0.16), { color: TEAL, pos: at(0, 0.85 + ph, 0), rot: r, flat: 0.4 });
      b.label({ text: name, size: ts, maxWidth: 1.5, align: 'center', pos: at(0, 0.85 + ph / 2, 0.065), rot: r, ink: P.ink, plate: CREAM, id: plate, flat: 0.5, pad: 0.1 });
      colliders.push({ kind: 'box', x: px, z: pz, hw: 0.95, hd: 0.15, rot: yaw });
    }
    if (has('google-recruiter')) {
      const d = PR + 3.2;
      pois.push({ entry: 'google-recruiter', x: PX + Math.cos(toCentre) * d, z: PZ + Math.sin(toCentre) * d, y: 2.6, reach: 4.5, prompt: 'Read the team plates' });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The ladder: two steps of something enormous, rising out of a smaller round of sky.
  // ------------------------------------------------------------------------------------------
  const LX = 21.5, LZ = 8;
  const LR = 3.5;
  {
    lawn(LX, LZ, 6.0, 6.0);
    b.add(geo.disc(LR + 0.05, 28), { color: SKYPOOL, pos: [LX, LAWN_Y + 0.02, LZ], flat: 1 });
    b.add(geo.ring(LR - 1.0, LR + 0.05, 28), { color: SKYPOOL_DEEP, pos: [LX, LAWN_Y + 0.03, LZ], flat: 1, outline: false });
    kerb(LX, LZ, LR, LR + 0.55, 0.42, P.brick, 'ladder');
    b.add(geo.lathe([[LR + 0.66, 0.42], [LR + 0.66, 0.56], [LR - 0.08, 0.56], [LR - 0.08, 0.42]], 28, { crease: 40, cacheKey: 'terraces-ladder-cap' }), { color: P.marble, pos: [LX, 0, LZ] });
    colliders.push({ kind: 'circle', x: LX, z: LZ, r: LR + 0.7 });
    const yaw = Math.atan2(-LX, -LZ); // the steps face the pad centre
    const at = place(LX, LZ, yaw);
    const r: V3 = [0, yaw, 0];
    const back: V3 = [0, yaw + Math.PI, 0];
    const RAIL = 21;
    const HALF = 2.35;
    for (const side of [-1, 1]) {
      const rail = geo.box(0.5, RAIL, 0.5);
      b.add(rail, { gradient: { bottom: mix(TEAL, P.shadow, 0.25), top: mix(TEAL, CYAN, 0.35) }, color: TEAL, pos: at(side * HALF, LAWN_Y - 0.1, 0), rot: r });
      b.add(geo.cone(0.42, 0.9, 4), { color: CREAM, pos: at(side * HALF, LAWN_Y - 0.1 + RAIL, 0), rot: [0, yaw + Math.PI / 4, 0] });
      clump(at(side * HALF, 0.9, 0.05), [0.45, 1.1, 0.45], LEAVES[side > 0 ? 2 : 5], r, 4, 0.04);
    }
    for (const [y, text] of [[6.2, 'L7'], [12.6, 'L8']] as const) {
      const stepBox = b.add(geo.bevelBox(HALF * 2 + 0.5, 1.05, 0.62, 0.05), { color: CREAM, pos: at(0, y, 0), rot: r });
      b.label({ text, size: 0.66, pos: at(0, y + 0.53, 0.31), rot: r, ink: P.ink, plate: CREAM, id: stepBox, pad: 0.12 });
      b.label({ text, size: 0.66, pos: at(0, y + 0.53, -0.31), rot: back, ink: P.ink, plate: CREAM, id: stepBox, pad: 0.12 });
      b.add(geo.box(HALF * 2 + 0.54, 0.1, 0.66), { color: TEAL, pos: at(0, y + 1.05, 0), rot: r, flat: 0.4 });
    }
    if (has('l7-l8')) {
      const d = LR + 2.4;
      const al = Math.hypot(LX, LZ);
      pois.push({ entry: 'l7-l8', x: LX - (LX / al) * d, z: LZ - (LZ / al) * d, y: 2.6, reach: 4.5, prompt: 'Look up the ladder' });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The committee: a ring of columns on a lawn, a stone table, a rubric, eight seats.
  // ------------------------------------------------------------------------------------------
  const CX = 1, CZ = 18;
  {
    lawn(CX, CZ, 7.0, 7.0);
    const CR = 4.6;
    const N = 8;
    const toC = Math.atan2(-CZ, -CX);
    b.add(geo.cylinder(CR + 0.9, CR + 0.9, 0.06, 32), { color: P.marbleShade, pos: [CX, LAWN_Y, CZ] });
    b.add(geo.cylinder(CR - 0.7, CR - 0.7, 0.07, 28), { color: P.pave, pos: [CX, LAWN_Y, CZ] });
    for (let k = 0; k < N; k++) {
      // A gap faces the plaza.
      const a = toC + ((k + 0.5) / N) * Math.PI * 2;
      const x = CX + Math.cos(a) * CR;
      const z = CZ + Math.sin(a) * CR;
      column(x, LAWN_Y + 0.06, z, 3.9, 0.3, LAWN_Y + 0.06);
      colliders.push({ kind: 'circle', x, z, r: 0.45 });
      if (k % 3 === 1) clump([x + Math.cos(a) * 0.3, 1.5, z + Math.sin(a) * 0.3], [0.3, 1.1, 0.3], LEAVES[k % 2 ? 0 : 3], [0, -a, 0], 4, 0.05);
    }
    // The ring beam over the columns, with a hedge planted along it.
    const ry = LAWN_Y + 0.06 + 3.9;
    b.add(geo.lathe([[CR + 0.5, ry], [CR + 0.5, ry + 0.55], [CR - 0.5, ry + 0.55], [CR - 0.5, ry]], 32, { crease: 40, cacheKey: 'terraces-ring' }), { color: P.marble, pos: [CX, 0, CZ] });
    b.add(geo.lathe([[CR + 0.52, ry + 0.12], [CR + 0.52, ry + 0.24], [CR + 0.4, ry + 0.24], [CR + 0.4, ry + 0.12]], 32, { crease: 40, cacheKey: 'terraces-ring-band' }), { color: TEAL, pos: [CX, 0, CZ], flat: 0.4 });
    const nh = low ? 6 : 12;
    for (let k = 0; k < nh; k++) {
      const a = (k / nh) * Math.PI * 2;
      clump([CX + Math.cos(a) * CR, ry + 0.75, CZ + Math.sin(a) * CR], [1.3, 0.45, 0.6], LEAVES[k % LEAVES.length], [0, -a + Math.PI / 2, 0], 4, 0.12);
      if (!low && k % 2 === 0) {
        const ta = a + 0.2;
        b.add(geo.cone(0.16, 0.8 + rng() * 0.7, 5), {
          color: LEAVES[k % 4 === 0 ? 0 : 3], pos: [CX + Math.cos(ta) * (CR + 0.52), ry + 0.15, CZ + Math.sin(ta) * (CR + 0.52)], rot: [Math.PI, 0, 0], sway: 0.25, swayBase: ry - 2.3,
        });
      }
    }
    // The table: a round top on a fat pedestal.
    const tid = b.newId();
    b.add(geo.cylinder(0.55, 0.75, 0.82, 12), { color: P.marbleShade, pos: [CX, LAWN_Y + 0.07, CZ], id: tid });
    const top = geo.cylinder(1.55, 1.5, 0.2, 24);
    b.add(top, { color: P.marble, pos: [CX, LAWN_Y + 0.89, CZ] });
    cast(top, [CX, LAWN_Y + 0.89, CZ], undefined, undefined, LAWN_Y + 0.13);
    colliders.push({ kind: 'circle', x: CX, z: CZ, r: 1.65 });
    // The rubric: a tablet standing on the table, facing the way in.
    const yaw = toC;
    const tYaw = Math.atan2(Math.cos(yaw), Math.sin(yaw));
    const at = place(CX, CZ, tYaw);
    const tr: V3 = [0, tYaw, 0];
    const tb: V3 = [0, tYaw + Math.PI, 0];
    b.add(geo.bevelBox(1.0, 0.12, 0.4, 0.03), { color: TEAL, pos: at(0, LAWN_Y + 1.09, 0), rot: tr, flat: 0.3 });
    const tablet = b.add(geo.bevelBox(1.6, 1.15, 0.16, 0.04), { color: CREAM, pos: at(0, LAWN_Y + 1.2, 0), rot: tr });
    b.label({ text: 'THE RUBRIC', size: 0.16, pos: at(0, LAWN_Y + 2.1, 0.085), rot: tr, ink: P.ink, plate: CREAM, id: tablet, pad: 0.08 });
    b.label({ text: 'EVIDENCE\nCALIBRATION\nDECISION', size: 0.105, align: 'left', anchor: 'center', pos: at(0, LAWN_Y + 1.62, 0.085), rot: tr, ink: P.violet, plate: CREAM, id: tablet, pad: 0.08, lineHeight: 1.8 });
    b.label({ text: 'HIRING\nCOMMITTEE', size: 0.16, align: 'center', pos: at(0, LAWN_Y + 1.78, -0.085), rot: tb, ink: P.ink, plate: CREAM, id: tablet, pad: 0.08 });
    // Packets on the table.
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.6;
      b.add(geo.box(0.36, 0.05, 0.48), { color: k % 2 ? P.bone : CYAN, pos: [CX + Math.cos(a) * 1.05, LAWN_Y + 1.09, CZ + Math.sin(a) * 1.05], rot: [0, -a, 0], flat: 0.5 });
    }
    // Eight seats round it, leaving a gap at the front of the tablet.
    for (let k = 0; k < 8; k++) {
      const a = toC + ((k + 0.5) / 8) * Math.PI * 2;
      b.add(geo.cylinder(0.3, 0.34, 0.5, 8), { color: k % 2 ? P.marble : P.marbleShade, pos: [CX + Math.cos(a) * 2.35, LAWN_Y + 0.07, CZ + Math.sin(a) * 2.35] });
    }
    if (has('committees')) {
      const d = 3.3;
      pois.push({ entry: 'committees', x: CX + Math.cos(toC) * d, z: CZ + Math.sin(toC) * d, y: 2.4, reach: 4.0, prompt: 'Sit in on the committee' });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Street trees and small things round the edge of the plaza.
  // ------------------------------------------------------------------------------------------
  const TREES: [number, number, number][] = [
    [-25, -3, 7.5], [-23.5, 17, 6.8], [-9, 24.5, 7.2], [13.5, 27, 6.6], [16, -14, 7.4], [-15.5, -21.5, 8], [19.5, -23, 7], [25, 16.5, 6.4],
  ];
  for (let i = 0; i < (low ? 5 : TREES.length); i++) tree(TREES[i][0], TREES[i][1], TREES[i][2], LEAVES[i % 5]);

  // Two marble benches looking at the pods, and two at the terraces.
  const bench = (x: number, z: number, yaw: number): void => {
    const at = place(x, z, yaw);
    const r: V3 = [0, yaw, 0];
    const seat = geo.bevelBox(2.2, 0.16, 0.6, 0.04);
    b.add(seat, { color: P.marble, pos: at(0, 0.42, 0), rot: r });
    for (const s of [-0.8, 0.8]) b.add(geo.box(0.32, 0.42, 0.5), { color: P.marbleShade, pos: at(s, 0, 0), rot: r });
    cast(seat, at(0, 0.42, 0), r);
    colliders.push({ kind: 'box', x, z, hw: 1.15, hd: 0.35, rot: yaw });
  };
  {
    const a = toCentre + Math.PI * 0.38;
    bench(PX + Math.cos(a) * (PR + 3.6), PZ + Math.sin(a) * (PR + 3.6), Math.atan2(Math.cos(a), Math.sin(a)));
    const a2 = toCentre - Math.PI * 0.4;
    bench(PX + Math.cos(a2) * (PR + 3.6), PZ + Math.sin(a2) * (PR + 3.6), Math.atan2(Math.cos(a2), Math.sin(a2)));
    bench(HX - 6.5, -7.2, 0);
    bench(HX + 8.5, -7.2, 0);
  }

  // A low marker stone by the way in, lettered for anyone who has not looked up yet.
  {
    const A = site.arrive;
    const al = Math.hypot(A.x, A.z) || 1;
    const dx = -A.x / al, dz = -A.z / al;
    const sx = A.x + dx * 7 + -dz * 5.2;
    const sz = A.z + dz * 7 + dx * 5.2;
    const yaw = Math.atan2(A.x - sx, A.z - sz) + 0.35;
    const at = place(sx, sz, yaw);
    const r: V3 = [0, yaw, 0];
    b.add(geo.bevelBox(2.9, 0.22, 1.0, 0.05), { color: P.marbleShade, pos: at(0, 0, 0), rot: r });
    const stone = b.add(geo.bevelBox(2.6, 1.05, 0.55, 0.06), { color: P.marble, pos: at(0, 0.22, 0), rot: r });
    b.add(geo.bevelBox(2.7, 0.12, 0.65, 0.04), { color: TEAL, pos: at(0, 1.27, 0), rot: r, flat: 0.4 });
    b.label({ text: NAME, size: fit(NAME, 0.22, 2.3), pos: at(0, 0.92, 0.28), rot: r, ink: P.ink, plate: P.marble, id: stone, pad: 0.08 });
    b.label({ text: site.years.toUpperCase(), size: 0.13, pos: at(0, 0.55, 0.28), rot: r, ink: P.violet, plate: P.marble, id: stone, pad: 0.08 });
    clump(at(-1.2, 0.35, 0.4), [0.5, 0.4, 0.4], LEAVES[2], r, 4, 0.08);
    clump(at(1.35, 0.3, -0.1), [0.45, 0.45, 0.45], LEAVES[5], r, 4, 0.08);
    colliders.push({ kind: 'box', x: sx, z: sz, hw: 1.45, hd: 0.5, rot: yaw });
  }

  group.add(b.build('terraces-static'));

  // ------------------------------------------------------------------------------------------
  // The pods: a saucer, a cyan band, a cream dome. Instanced, bobbing on their stalks.
  // ------------------------------------------------------------------------------------------
  const pb = kit.builder();
  pb.add(geo.cone(1.45, 0.95, 14), { gradient: { bottom: mix(TEAL, P.shadow, 0.2), top: TEAL }, color: TEAL, rot: [Math.PI, 0, 0] });
  pb.add(geo.cylinder(1.55, 1.55, 0.22, 16), { color: CREAM, pos: [0, 0, 0] });
  pb.add(geo.cylinder(1.32, 1.32, 0.34, 16), { color: CYAN, pos: [0, 0.22, 0], flat: 0.5 });
  pb.add(geo.dome(1.28, 14, 5), { gradient: { bottom: CREAM, top: '#ffffff' }, color: CREAM, pos: [0, 0.56, 0] });
  pb.add(geo.cylinder(0.05, 0.07, 0.5, 5), { color: P.brass, pos: [0, 1.78, 0], flat: 0.3 });
  pb.add(geo.sphere(0.14, 8, 5), { color: P.brass, pos: [0, 2.3, 0], flat: 0.3 });
  const ownPodGeo = !!pb.geometry;
  const podGeo = pb.geometry ? pb.geometry() : geo.sphere(1.4, 12, 8);
  const pods = kit.instances(podGeo, PODS, { flat: 0.3 });
  pods.name = 'terraces-pods';
  group.add(pods);

  // ------------------------------------------------------------------------------------------
  // The cloud floor: dithered puffs drifting slowly round each round of sky.
  // ------------------------------------------------------------------------------------------
  const N_POD_PUFFS = low ? 7 : 13;
  const N_LAD_PUFFS = low ? 3 : 6;
  // And a few caught on the terraces, sliding back and forth along each walk.
  const N_TER_PUFFS = low ? 0 : 9;
  const N_PUFFS = N_POD_PUFFS + N_LAD_PUFFS + N_TER_PUFFS;
  const pK = new Uint8Array(N_PUFFS);
  const puffGeo = geo.blobs(17, 5, 1, { squash: 0.45, detail: 0, size: [0.45, 0.7] });
  const puffs = kit.instances(puffGeo, N_PUFFS, { color: CLOUD, flat: 1, dither: 0.5 });
  puffs.name = 'terraces-cloud';
  group.add(puffs);
  const pCx = new Float32Array(N_PUFFS);
  const pCz = new Float32Array(N_PUFFS);
  const pR = new Float32Array(N_PUFFS);
  const pA = new Float32Array(N_PUFFS);
  const pW = new Float32Array(N_PUFFS);
  const pY = new Float32Array(N_PUFFS);
  const pS = new Float32Array(N_PUFFS);
  for (let i = 0; i < N_PUFFS; i++) {
    if (i >= N_POD_PUFFS + N_LAD_PUFFS) {
      const j = i - N_POD_PUFFS - N_LAD_PUFFS;
      const T = tiers[j % 3];
      const nt = tiers[(j % 3) + 1];
      pK[i] = 1;
      pCx[i] = HX + ((Math.floor(j / 3) - 1) * T.w) / 4;
      pCz[i] = (T.front - 1.0 + nt.front) / 2;
      pR[i] = T.w / 5;
      pA[i] = rng() * Math.PI * 2;
      pW[i] = 0.05 + rng() * 0.05;
      pY[i] = T.top + 0.35 + rng() * 0.2;
      pS[i] = 0.9 + rng() * 0.4;
      continue;
    }
    const pod = i < N_POD_PUFFS;
    pCx[i] = pod ? PX : LX;
    pCz[i] = pod ? PZ : LZ;
    const maxR = pod ? PR - 1.6 : LR - 1.2;
    pR[i] = 0.4 + rng() * maxR;
    pA[i] = rng() * Math.PI * 2;
    pW[i] = (0.03 + rng() * 0.05) * (rng() < 0.5 ? -1 : 1);
    pY[i] = LAWN_Y + 0.25 + rng() * 0.35;
    pS[i] = pod ? 1.1 + rng() * 0.8 : 0.8 + rng() * 0.5;
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const place3 = (t: number): void => {
    for (let k = 0; k < PODS; k++) {
      const bob = Math.sin(t * 0.5 + k * 1.3) * 0.14;
      v.set(podX[k], podH[k] + bob, podZ[k]);
      q.setFromAxisAngle(up, k * 0.9 + t * 0.05);
      s.set(podS[k], podS[k], podS[k]);
      m.compose(v, q, s);
      pods.setMatrixAt(k, m);
    }
    pods.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < N_PUFFS; i++) {
      const a = pA[i] + t * pW[i];
      if (pK[i] === 1) v.set(pCx[i] + Math.sin(a) * pR[i], pY[i], pCz[i]);
      else v.set(pCx[i] + Math.cos(a) * pR[i], pY[i] + Math.sin(t * 0.3 + i) * 0.05, pCz[i] + Math.sin(a) * pR[i]);
      q.setFromAxisAngle(up, a);
      s.set(pS[i], pS[i] * 0.7, pS[i]);
      m.compose(v, q, s);
      puffs.setMatrixAt(i, m);
    }
    puffs.instanceMatrix.needsUpdate = true;
  };
  place3(0);
  pods.computeBoundingSphere();
  puffs.computeBoundingSphere();

  return {
    group,
    colliders,
    pois,
    update(_dt, t) {
      place3(t);
    },
    dispose() {
      if (ownPodGeo) podGeo.dispose();
    },
  };
}

const TEAMS = [
  'CLOUD CENTER OF EXCELLENCE',
  'AI INDUSTRY SOLUTIONS',
  'MANAGED INFRASTRUCTURE',
  'SOVEREIGN CLOUD',
  'CONVERSATIONAL AI',
  'APPLIED AI',
  'ML LEARNING SOLUTIONS',
];
