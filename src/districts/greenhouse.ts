// The Greenhouse. A garden lot between two brick walk-ups, with a glass and brass house in the middle.
// Inside it one plant has outgrown the roof: it comes up out of a glass planter where you can see its
// roots, goes through a hole where the ridge used to be and opens into a crown you can see from the
// avenue. Five small work stations stand round it, one for each part the models take turns playing.
// On the west side of the lot, potting benches of seedlings with numbered tags, most of them gone
// brown, and one tall one in a big pot at the end. On the east side a desk with seven chairs faces a
// wall of charts painted onto the brick, under a sign that says the one thing the place cannot do.
// A marble colonnade closes the back of the lot, and ivy has both the walk-up and the stone.
// Over the crown a ring of potted seedlings floats round and round, which is the part that cannot be.
//
// The one road comes in from the south east. Everything is laid out in a frame turned to face it:
// local +z points down that road, so the house's front, the door and the name all look at the
// visitor as he walks in. The meshes are turned once; colliders and markers are turned by hand.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import { gates } from '../world/layout';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, Poi } from '../types';

type V3 = [number, number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const TRUNK = '#7a5a86';
const BARK = '#8d6a7c';
const WINDOW = '#56528f';
const LIT = '#f6d98a';
const IRON = '#3d3766';
const WOOD = '#a8643f';
const WOOD_DEEP = '#7d4a3a';
const TERRA = '#cf7350';
const SOIL = '#5b4152';
const WITHER = '#b08a52';
const WITHER_DEEP = '#8a6044';
const RED = '#d8412f';
const CHART_UP = '#3f8a57';
const CHART_DOWN = '#d8412f';
const LEAVES = ['#7fb85a', '#63aa5e', '#3f8a57', '#8cc56c', '#4f9c62'];
// One colour per role at the stations. Plain colours, nobody's brand.
const ROLES: { name: string; color: string }[] = [
  { name: 'PLAN', color: '#f3c531' },
  { name: 'BUILD', color: '#3fa9a5' },
  { name: 'CHALLENGE', color: '#d8412f' },
  { name: 'REVIEW', color: '#6f58c2' },
  { name: 'NARRATE', color: '#f0a0b6' },
];

/** XYZ angles for a part turned by `rot` and then turned about the vertical by `yaw`. */
function yawed(rot: V3, yaw: number): V3 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ')));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

export const district: DistrictModule = {
  id: 'greenhouse',
  build(ctx) {
    return buildGreenhouse(ctx);
  },
};

function buildGreenhouse(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const [GREEN, BRASS, MINT] = site.accents as [string, string, string];

  // The frame. Local +z looks down the road toward the Switchboard.
  const g0 = gates('greenhouse')[0] ?? { x: site.arrive.x, z: site.arrive.z };
  const TURN = Math.atan2(g0.x, g0.z);
  const C = Math.cos(TURN);
  const S = Math.sin(TURN);
  const wx = (x: number, z: number): number => x * C + z * S;
  const wz = (x: number, z: number): number => -x * S + z * C;
  const ground = (x: number, z: number): number => ctx.groundAt(wx(x, z), wz(x, z));
  const ws = ctx.sun ?? FALLBACK_SUN;
  const sun: V3 = [ws[0] * C - ws[2] * S, ws[1], ws[0] * S + ws[2] * C];
  const shade = mix(mix(P.pave, GREEN, 0.1), P.shadow, 0.3);

  const group = new THREE.Group();
  group.name = 'greenhouse';
  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const circle = (x: number, z: number, r: number): void => {
    colliders.push({ kind: 'circle', x: wx(x, z), z: wz(x, z), r });
  };
  const box = (x: number, z: number, hw: number, hd: number, rot = 0): void => {
    colliders.push({ kind: 'box', x: wx(x, z), z: wz(x, z), hw, hd, rot: TURN + rot });
  };
  const poi = (entry: string, x: number, z: number, prompt: string, y = 2.4, reach = 4.5): void => {
    if (!entries.some((e) => e.id === entry)) return;
    pois.push({ entry, x: wx(x, z), z: wz(x, z), y, reach, prompt });
  };

  const b = kit.builder();
  const fit = (text: string, size: number, max: number): number => {
    const w = b.measure ? b.measure({ text, size }).width : text.length * size * 0.7;
    return w > max ? (size * max) / w : size;
  };
  const cast = (gg: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: number | V3): void => {
    b.shadow?.(gg, { color: shade, sun, pos, rot, scale, y: 0, lift: 0.015 });
  };

  // A clump of leaf: hedges, shrubs, ivy when squashed against a wall.
  let seed = 41;
  const clump = (pos: V3, scale: V3, tint: string, rot?: V3, count = 4, sway = 0.1): void => {
    b.add(geo.blobs(seed++, count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos, rot, scale, sway,
    });
  };
  // A street tree in a pit: trunk and three masses of leaf.
  const tree = (x: number, z: number, h: number, tint: string): void => {
    const y = ground(x, z);
    const s = h / 7;
    const a = rng() * 6.28;
    const ca = Math.cos(a), sa = Math.sin(a);
    b.add(geo.cylinder(0.95, 0.95, 0.08, 8), { color: P.grassDeep, pos: [x, y, z], flat: 0.5 });
    b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, y, z], sway: 0.2, swayBase: y });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: y };
    const id = b.newId();
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    b.add(ball, { ...leaf, id, pos: [x, y + 4.9 * s, z], scale: [2.5 * s, 2.0 * s, 2.4 * s] });
    b.add(ball, { ...leaf, id, pos: [x - 1.6 * s * ca, y + 4.6 * s, z - 1.6 * s * sa], scale: [1.5 * s, 1.25 * s, 1.45 * s] });
    b.add(ball, { ...leaf, pos: [x + 1.6 * s * ca + 0.6 * sa, y + 4.0 * s, z + 1.6 * s * sa], scale: [1.7 * s, 1.35 * s, 1.6 * s] });
    if (y === 0) cast(ball, [x, 4.9 * s, z], undefined, [2.5 * s, 2.0 * s, 2.4 * s]);
    circle(x, z, 0.34 * s);
  };

  // ==========================================================================================
  // The glass house. 12 m wide, 16 m deep, gable to the road. Marble knee wall, dithered glass,
  // brass everywhere the glass meets anything.
  // ==========================================================================================
  const HX = 6; // half width
  const ZF = 4; // front face
  const ZB = -12; // back face
  const ZC = (ZF + ZB) / 2; // -4, where the plant stands
  const KNEE = 0.7;
  const EAVE = 4.6;
  const RIDGE = 7.8;
  const DOOR = 1.3; // half width of the doorway
  const DOOR_H = 3.0;
  const GLASS = mix(P.glass, MINT, 0.35);
  const glassOpts = { color: GLASS, dither: 0.5, flat: 1 };
  const brassOpts = { color: BRASS, flat: 0.25 };
  const B = 0.13; // brass section
  {
    // Floor: pale tiles, barely proud of the paving so his feet stay on it.
    b.add(geo.box(HX * 2 - 0.2, 0.07, ZF - ZB - 0.2), { color: mix(P.pave, MINT, 0.25), pos: [0, 0, ZC], flat: 0.3 });
    // Knee wall.
    const knee = b.newId();
    const kneeColor = { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble };
    for (const sx of [-1, 1]) b.add(geo.box(0.36, KNEE, ZF - ZB), { ...kneeColor, id: knee, pos: [sx * (HX - 0.18), 0, ZC] });
    b.add(geo.box(HX * 2, KNEE, 0.36), { ...kneeColor, id: knee, pos: [0, 0, ZB + 0.18] });
    for (const sx of [-1, 1]) {
      const w = HX - DOOR;
      b.add(geo.box(w, KNEE, 0.36), { ...kneeColor, id: knee, pos: [sx * (DOOR + w / 2), 0, ZF - 0.18] });
    }
    // Coping on top of the knee wall.
    for (const sx of [-1, 1]) b.add(geo.box(0.5, 0.1, ZF - ZB + 0.14), { color: P.marble, pos: [sx * (HX - 0.18), KNEE, ZC] });
    b.add(geo.box(HX * 2 + 0.14, 0.1, 0.5), { color: P.marble, pos: [0, KNEE, ZB + 0.18] });
    for (const sx of [-1, 1]) {
      const w = HX - DOOR + 0.07;
      b.add(geo.box(w, 0.1, 0.5), { color: P.marble, pos: [sx * (DOOR + w / 2 - 0.07 + 0.07), KNEE, ZF - 0.18] });
    }
    // Moss along the foot of the wall.
    if (!low) {
      for (let i = 0; i < 6; i++) {
        const sx = i % 2 ? 1 : -1;
        clump([sx * (HX + 0.15), 0.15, ZB + 2 + i * 2.4], [0.5, 0.35, 1.1], P.moss as string, undefined, 3, 0);
      }
    }

    const GH = EAVE - KNEE - 0.1; // glass height
    const GY = KNEE + 0.1;
    // Side glass and its brass.
    for (const sx of [-1, 1]) {
      const x = sx * (HX - 0.18);
      b.add(geo.box(0.04, GH, ZF - ZB), { ...glassOpts, pos: [x, GY, ZC] });
      for (let z = ZB; z <= ZF + 0.01; z += 2) b.add(geo.box(B, GH, B), { ...brassOpts, pos: [x, GY, z === ZB ? z + 0.07 : z === ZF ? z - 0.07 : z] });
      b.add(geo.box(B, B, ZF - ZB), { ...brassOpts, pos: [x, GY + GH * 0.5, ZC] });
      b.add(geo.box(0.26, 0.2, ZF - ZB + 0.3), { ...brassOpts, pos: [x, EAVE - 0.1, ZC] });
    }
    // Back glass.
    b.add(geo.box(HX * 2 - 0.36, GH, 0.04), { ...glassOpts, pos: [0, GY, ZB + 0.18] });
    for (let x = -HX + 2; x <= HX - 2 + 0.01; x += 2) b.add(geo.box(B, GH, B), { ...brassOpts, pos: [x, GY, ZB + 0.18] });
    b.add(geo.box(HX * 2, B, B), { ...brassOpts, pos: [0, GY + GH * 0.5, ZB + 0.18] });
    b.add(geo.box(HX * 2 + 0.3, 0.2, 0.26), { ...brassOpts, pos: [0, EAVE - 0.1, ZB + 0.18] });
    // Front glass either side of the doorway, and the doorway frame.
    for (const sx of [-1, 1]) {
      const w = HX - DOOR - 0.18;
      b.add(geo.box(w, GH, 0.04), { ...glassOpts, pos: [sx * (DOOR + w / 2), GY, ZF - 0.18] });
      b.add(geo.box(B, GH, B), { ...brassOpts, pos: [sx * 3.6, GY, ZF - 0.18] });
      b.add(geo.box(w, B, B), { ...brassOpts, pos: [sx * (DOOR + w / 2), GY + GH * 0.5, ZF - 0.18] });
      b.add(geo.box(0.22, DOOR_H, 0.22), { ...brassOpts, pos: [sx * DOOR, 0, ZF - 0.18] });
    }
    b.add(geo.box(DOOR * 2 + 0.22, 0.22, 0.22), { ...brassOpts, pos: [0, DOOR_H, ZF - 0.18] });
    b.add(geo.box(DOOR * 2, EAVE - 1.0 - DOOR_H - 0.22, 0.04), { ...glassOpts, pos: [0, DOOR_H + 0.22, ZF - 0.18] });
    // The two door leaves, swung wide open into the garden.
    for (const sx of [-1, 1]) {
      const hx = sx * (DOOR - 0.12);
      const hz = ZF + 0.05;
      const phi = 1.22; // swung past square, back toward the glass
      const ux = sx * Math.cos(phi);
      const uz = Math.sin(phi);
      const leaf = b.newId();
      const cx = hx + ux * 0.6;
      const cz = hz + uz * 0.6;
      const r: V3 = [0, Math.atan2(-uz, ux), 0];
      b.add(geo.box(1.2, DOOR_H - 0.2, 0.03), { ...glassOpts, pos: [cx, 0.1, cz], rot: r });
      for (const e of [-0.56, 0.56]) {
        b.add(geo.box(0.09, DOOR_H - 0.1, 0.09), { ...brassOpts, id: leaf, pos: [cx + ux * e, 0.05, cz + uz * e], rot: r });
      }
      for (const y of [0.05, 1.3, DOOR_H - 0.12]) b.add(geo.box(1.2, 0.09, 0.09), { ...brassOpts, id: leaf, pos: [cx, y, cz], rot: r });
    }
    // A marble step at the door.
    b.add(geo.bevelBox(DOOR * 2 + 1.0, 0.08, 1.0, 0.03), { color: P.marble, pos: [0, 0, ZF + 0.45] });

    // The name band across the front, under the gable.
    const bandY = EAVE - 1.0;
    const band = b.add(geo.box(HX * 2 + 0.3, 1.0, 0.34), { color: P.marble, pos: [0, bandY, ZF - 0.12] });
    b.add(geo.box(HX * 2 + 0.5, 0.14, 0.46), { color: BRASS, pos: [0, bandY - 0.07, ZF - 0.12], flat: 0.3 });
    {
      const name = site.name.toUpperCase();
      b.label({ text: name, size: fit(name, 0.52, 9.5), pos: [0, bandY + 0.6, ZF + 0.06], ink: P.ink, plate: P.marble, id: band, pad: 0.1 });
      b.label({ text: site.years, size: 0.2, pos: [0, bandY + 0.2, ZF + 0.06], ink: P.violet, plate: P.marble, id: band, pad: 0.1 });
    }

    // Gables: glass triangles in brass, a round brass window at the front.
    const rise = RIDGE - EAVE;
    const tri = geo.extrude([[-HX, 0], [HX, 0], [0, rise]], 0.04, { cacheKey: 'greenhouse-gable' });
    for (const z of [ZF - 0.18, ZB + 0.18]) {
      b.add(tri, { ...glassOpts, pos: [0, EAVE, z] });
      b.add(geo.box(B, rise - 0.1, B), { ...brassOpts, pos: [0, EAVE, z] });
      for (const sx of [-1, 1]) b.add(geo.box(B, rise * 0.5, B), { ...brassOpts, pos: [sx * HX * 0.5, EAVE, z] });
    }
    b.add(geo.torus(1.0, 0.11, 18, 5), { ...brassOpts, pos: [0, EAVE + 1.25, ZF - 0.1], rot: [Math.PI / 2, 0, 0] });
    b.add(geo.disc(0.18, 10), { ...brassOpts, pos: [0, EAVE + 1.25, ZF - 0.06], rot: [Math.PI / 2, 0, 0] });

    // The roof. Two slopes in bays of two metres. Over the plant the upper panes and the ridge are
    // simply gone: it grew through them.
    const slope = Math.atan2(rise, HX);
    const run = Math.hypot(HX, rise);
    const hole = (z: number): boolean => z > ZC - 2.5 && z < ZC + 2.5;
    for (const sx of [-1, 1]) {
      const rotS: V3 = [0, 0, sx * -slope];
      // A point a fraction `u` up the slope (0 at the eave, 1 at the ridge).
      const px = (u: number): number => sx * HX * (1 - u);
      const py = (u: number): number => EAVE + rise * u;
      for (let z = ZB + 1; z < ZF; z += 2) {
        const gapped = hole(z);
        // Lower half always, upper half unless the plant is there.
        b.add(geo.box(run * 0.5, 0.04, 1.9), { ...glassOpts, pos: [px(0.25), py(0.25) - 0.02, z], rot: rotS });
        if (!gapped) b.add(geo.box(run * 0.5, 0.04, 1.9), { ...glassOpts, pos: [px(0.75), py(0.75) - 0.02, z], rot: rotS });
      }
      // Rafters at every bay line, short ones where the hole is.
      for (let z = ZB; z <= ZF + 0.01; z += 2) {
        const zz = z === ZB ? z + 0.1 : z === ZF ? z - 0.1 : z;
        const short = hole(zz);
        const len = short ? run * 0.5 : run;
        b.add(geo.box(len, B, B), { ...brassOpts, pos: [px(short ? 0.25 : 0.5), py(short ? 0.25 : 0.5), zz], rot: rotS });
      }
      // A purlin halfway up, broken by the hole.
      const zA = ZC - 2.5;
      const zB2 = ZC + 2.5;
      b.add(geo.box(B, B, zA - ZB), { ...brassOpts, pos: [px(0.5), py(0.5), (ZB + zA) / 2], rot: rotS });
      b.add(geo.box(B, B, ZF - zB2), { ...brassOpts, pos: [px(0.5), py(0.5), (zB2 + ZF) / 2], rot: rotS });
    }
    // The ridge, in two pieces, with a finial on each end.
    b.add(geo.box(0.22, 0.22, ZC - 2.5 - ZB), { ...brassOpts, pos: [0, RIDGE - 0.1, (ZB + ZC - 2.5) / 2] });
    b.add(geo.box(0.22, 0.22, ZF - ZC - 2.5), { ...brassOpts, pos: [0, RIDGE - 0.1, (ZF + ZC + 2.5) / 2] });
    for (const z of [ZF - 0.1, ZB + 0.1]) {
      b.add(geo.cylinder(0.05, 0.05, 0.7, 6), { ...brassOpts, pos: [0, RIDGE, z] });
      b.add(geo.sphere(0.2, 8, 6), { ...brassOpts, pos: [0, RIDGE + 0.8, z] });
    }

    // Walls of the house, leaving the doorway open.
    for (const sx of [-1, 1]) box(sx * (HX - 0.18), ZC, 0.25, (ZF - ZB) / 2);
    box(0, ZB + 0.18, HX, 0.25);
    for (const sx of [-1, 1]) box(sx * (DOOR + (HX - DOOR) / 2), ZF - 0.18, (HX - DOOR) / 2, 0.25);
    // The swung doors.
    for (const sx of [-1, 1]) circle(sx * (DOOR + 0.3), ZF + 0.7, 0.3);
  }

  // ==========================================================================================
  // The plant. Glass planter with its roots showing, a trunk wound with vines, a crown that reads
  // from the avenue. About 21 m to the top.
  // ==========================================================================================
  const PX = 0;
  const PZ = ZC;
  const CROWN = 15.5;
  {
    const sb = 0; // everything on the plant sways from the floor
    // Planter: brass rings with dithered glass between, roots inside, dark soil on top.
    b.add(geo.cylinder(1.7, 1.75, 0.2, 18), { color: BRASS, pos: [PX, 0, PZ], flat: 0.3 });
    b.add(geo.cylinder(1.55, 1.55, 0.8, 18, true), { color: GLASS, dither: 0.5, flat: 1, pos: [PX, 0.2, PZ] });
    b.add(geo.torus(1.6, 0.08, 20, 5), { color: BRASS, pos: [PX, 1.0, PZ], flat: 0.3 });
    b.add(geo.cylinder(1.5, 1.5, 0.04, 18), { color: SOIL, pos: [PX, 0.96, PZ], flat: 0.4 });
    b.add(geo.cylinder(0.8, 0.8, 0.72, 12), { color: mix(SOIL, P.ink, 0.15), pos: [PX, 0.22, PZ], flat: 0.5 });
    for (let i = 0; i < (low ? 3 : 6); i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const pts: V3[] = [
        [PX + Math.cos(a) * 0.4, 0.95, PZ + Math.sin(a) * 0.4],
        [PX + Math.cos(a + 0.3) * 1.0, 0.65, PZ + Math.sin(a + 0.3) * 1.0],
        [PX + Math.cos(a + 0.1) * 1.48, 0.35, PZ + Math.sin(a + 0.1) * 1.48],
      ];
      b.add(geo.tube(pts, 0.09, { radial: 4, perSpan: 3 }), { color: mix(BARK, '#ffffff', 0.35), flat: 0.6 });
    }
    // A brass plate on the planter rim, facing the door.
    const plate = b.add(geo.box(2.0, 0.42, 0.06), { color: BRASS, pos: [PX, 0.36, PZ + 1.66], flat: 0.3 });
    b.label({ text: 'OBSERVABLE LAB', size: 0.15, pos: [PX, 0.57, PZ + 1.7], ink: P.ink, plate: BRASS, id: plate, flat: 0.3, pad: 0.1 });

    // Trunk: three tapering drums, leaning a little toward the road, with knuckles at the joints.
    const trunk = b.newId();
    const tOpts = { gradient: { bottom: mix(BARK, P.shadow, 0.2), top: BARK }, color: BARK, id: trunk, sway: 0.3, swayBase: sb };
    const segs: [number, number, number, number, number][] = [
      // y0, y1, r0, r1, lean x
      [0.9, 6.0, 0.72, 0.56, 0],
      [6.0, 11.0, 0.56, 0.42, 0.25],
      [11.0, CROWN, 0.42, 0.28, 0.45],
    ];
    for (const [y0, y1, r0, r1, lx] of segs) {
      b.add(geo.cylinder(r1, r0, y1 - y0, 9), { ...tOpts, pos: [PX + lx, y0, PZ] });
      b.add(geo.sphere(r1 * 1.05, 9, 6), { ...tOpts, pos: [PX + lx, y1, PZ] });
    }
    // The foot of the trunk flares into the soil.
    b.add(geo.cylinder(0.72, 1.15, 0.7, 9), { ...tOpts, pos: [PX, 0.95, PZ] });
    // Two vines winding up the trunk.
    if (!low) {
      for (const ph of [0, Math.PI]) {
        const pts: V3[] = [];
        for (let i = 0; i <= 14; i++) {
          const y = 1.0 + i * 0.85;
          const a = ph + i * 0.9;
          const lean = y < 6 ? 0 : y < 11 ? 0.25 : 0.45;
          const r = y < 6 ? 0.72 : y < 11 ? 0.56 : 0.44;
          pts.push([PX + lean + Math.cos(a) * r, y, PZ + Math.sin(a) * r]);
        }
        b.add(geo.tube(pts, 0.08, { radial: 4, perSpan: 2 }), { color: P.leafDeep, sway: 0.3, swayBase: sb });
      }
    }
    // Big leaves low down inside the glass.
    for (let i = 0; i < (low ? 3 : 5); i++) {
      const a = (i / 5) * Math.PI * 2 + 0.9;
      const y = 1.6 + (i % 2) * 0.9;
      b.add(geo.sphere(1, 8, 5), {
        gradient: { bottom: P.leafDeep, top: GREEN }, color: GREEN, sway: 0.3, swayBase: sb,
        pos: [PX + Math.cos(a) * 1.1, y, PZ + Math.sin(a) * 1.1], rot: [0, -a, 0.35], scale: [0.9, 0.12, 0.42],
      });
    }

    // Boughs out of the top of the trunk.
    const boughs: V3[] = [];
    const nb = 6;
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + 0.4;
      const reach = 4.0 + (i % 2) * 1.2;
      const y0 = 11.5 + (i % 3) * 1.2;
      const end: V3 = [PX + 0.45 + Math.cos(a) * reach, y0 + 2.6, PZ + Math.sin(a) * reach];
      boughs.push(end);
      b.add(geo.tube([[PX + 0.4, y0, PZ], [PX + 0.4 + Math.cos(a) * reach * 0.5, y0 + 1.6, PZ + Math.sin(a) * reach * 0.5], end], 0.22, { radial: 5, perSpan: 2 }), {
        color: BARK, id: trunk, sway: 0.3, swayBase: sb,
      });
    }
    // The crown: masses of leaf on each bough and one over the top. One mass is going brown at the
    // edges, where the models could not agree.
    const crownCount = high ? 7 : 5;
    const crownDetail = high ? 1 : 0;
    const crownId = b.newId();
    const masses: [V3, number][] = boughs.map((p) => [p, 2.9 + rng() * 0.6]);
    masses.push([[PX + 0.5, CROWN + 3.8, PZ], 3.7]);
    const CROWN_TINTS = [GREEN, '#8cc56c', '#63aa5e', '#9fd06e', '#6fb85e', '#7fc06a', '#86c463'];
    masses.forEach(([p, r], i) => {
      const sick = i === 2;
      const tint = sick ? mix(GREEN, WITHER, 0.55) : CROWN_TINTS[i % CROWN_TINTS.length];
      b.add(geo.blobs(seed++, crownCount, r, { squash: 0.75, detail: crownDetail, size: [0.45, 0.68] }), {
        gradient: { bottom: mix(tint, P.leafDeep, 0.45), top: mix(tint, '#f4f7c8', 0.22) }, color: tint,
        pos: p, id: sick ? undefined : crownId, sway: 0.35, swayBase: sb,
      });
    });
    // Five blossoms in the crown, one in each station's colour.
    ROLES.forEach((role, i) => {
      const [p, r] = masses[(i * 2 + 1) % masses.length];
      const a = i * 1.7;
      b.add(geo.sphere(0.42, 8, 6), {
        color: role.color, flat: 0.5, sway: 0.35, swayBase: sb,
        pos: [p[0] + Math.cos(a) * r * 0.75, p[1] + r * 0.45, p[2] + Math.sin(a) * r * 0.75],
      });
    });
    cast(geo.sphere(6.5, 10, 6), [PX + 0.5, CROWN + 2, PZ], undefined, [1, 0.6, 1]);
    circle(PX, PZ, 1.8);
  }

  // ==========================================================================================
  // Five stations round the plant, each turned to face it, each with its own instrument.
  // ==========================================================================================
  {
    const R = 3.7;
    const desk = geo.bevelBox(1.2, 0.08, 0.62, 0.02);
    const leg = geo.box(0.07, 0.76, 0.07);
    ROLES.forEach((role, i) => {
      // Spread round the back and sides; the front stays open for the door.
      const a = Math.PI * (0.25 + (i / 4) * 1.5); // 45 to 315 degrees from +z
      const sx = PX + Math.sin(a) * R;
      const sz = PZ + Math.cos(a) * R;
      const yaw = Math.atan2(PX - sx, PZ - sz); // +z of the desk faces the plant
      const rot: V3 = [0, yaw, 0];
      const ca = Math.cos(yaw), sa = Math.sin(yaw);
      const at = (lx: number, ly: number, lz: number): V3 => [sx + lx * ca + lz * sa, ly, sz - lx * sa + lz * ca];
      b.add(desk, { color: WOOD, pos: at(0, 0.76, 0), rot });
      for (const [lx, lz] of [[-0.52, -0.24], [0.52, -0.24], [-0.52, 0.24], [0.52, 0.24]] as const) b.add(leg, { color: WOOD_DEEP, pos: at(lx, 0, lz), rot });
      // A stool on the far side, in the role colour.
      b.add(geo.cylinder(0.24, 0.24, 0.08, 10), { color: role.color, pos: at(0, 0.5, -0.75), flat: 0.3 });
      b.add(geo.cylinder(0.05, 0.08, 0.5, 6), { color: IRON, pos: at(0, 0, -0.75) });
      // A lettered tag on the desk's front edge, facing the plant and anyone standing by it.
      const tag = b.add(geo.box(0.9, 0.24, 0.04), { color: role.color, pos: at(0, 0.56, 0.33), rot, flat: 0.6 });
      b.label({ text: role.name, size: fit(role.name, 0.12, 0.8), pos: at(0, 0.68, 0.36), rot, ink: P.ink, plate: role.color, id: tag, flat: 0.6, pad: 0.08 });
      const top = 0.84;
      if (role.name === 'PLAN') {
        // A slate on an easel.
        b.add(geo.box(0.9, 0.62, 0.05), { color: '#3d4a5c', pos: at(0, top + 0.2, -0.22), rot: yawed([-0.25, 0, 0], yaw) });
        b.add(geo.box(0.98, 0.06, 0.08), { color: WOOD, pos: at(0, top + 0.18, -0.17), rot });
        for (let k = 0; k < 3; k++) b.add(geo.box(0.5 - k * 0.12, 0.03, 0.01), { color: P.paper, pos: at(-0.1, top + 0.6 - k * 0.14, -0.18 + k * 0.035), rot: yawed([-0.25, 0, 0], yaw), outline: false, flat: 1 });
      } else if (role.name === 'BUILD') {
        // Specimen jars and a tool rack.
        for (let k = 0; k < 3; k++) {
          b.add(geo.cylinder(0.11, 0.11, 0.3, 10), { color: mix(GLASS, GREEN, 0.3), flat: 0.6, pos: at(-0.35 + k * 0.3, top, -0.05) });
          b.add(geo.cylinder(0.12, 0.12, 0.05, 10), { color: BRASS, pos: at(-0.35 + k * 0.3, top + 0.3, -0.05) });
          b.add(geo.sphere(0.06, 6, 4), { color: LEAVES[k], pos: at(-0.35 + k * 0.3, top + 0.12, -0.05) });
        }
      } else if (role.name === 'CHALLENGE') {
        // A red lamp on a post and a stress gauge.
        b.add(geo.cylinder(0.03, 0.03, 0.45, 6), { color: IRON, pos: at(0.3, top, -0.1) });
        b.add(geo.sphere(0.15, 10, 7), { color: RED, flat: 0.9, pos: at(0.3, top + 0.55, -0.1) });
        b.add(geo.cylinder(0.2, 0.2, 0.06, 14), { color: P.paper, pos: at(-0.25, top + 0.25, -0.1), rot: yawed([Math.PI / 2 - 0.3, 0, 0], yaw) });
        b.add(geo.torus(0.2, 0.03, 14, 4), { color: BRASS, pos: at(-0.25, top + 0.25, -0.07), rot: yawed([Math.PI / 2 - 0.3, 0, 0], yaw) });
        b.add(geo.box(0.04, 0.24, 0.04), { color: IRON, pos: at(-0.25, top + 0.03, -0.1), rot });
      } else if (role.name === 'REVIEW') {
        // A brass microscope.
        b.add(geo.box(0.32, 0.05, 0.28), { color: IRON, pos: at(0, top, -0.05), rot });
        b.add(geo.box(0.07, 0.42, 0.07), { color: BRASS, pos: at(0, top, -0.15), rot: yawed([0.2, 0, 0], yaw) });
        b.add(geo.cylinder(0.06, 0.07, 0.42, 8), { color: BRASS, pos: at(0, top + 0.2, -0.02), rot: yawed([0.45, 0, 0], yaw) });
        b.add(geo.box(0.22, 0.03, 0.18), { color: BRASS, pos: at(0, top + 0.15, 0.02), rot });
      } else {
        // An open journal and a speaking tube rising out of the desk.
        b.add(geo.box(0.62, 0.04, 0.42), { color: P.paper, pos: at(-0.1, top, 0.02), rot: [0, yaw + 0.15, 0], flat: 0.4 });
        b.add(geo.box(0.02, 0.05, 0.42), { color: WOOD_DEEP, pos: at(-0.1, top, 0.02), rot: [0, yaw + 0.15, 0] });
        b.add(geo.tube([at(0.45, 0, -0.2), at(0.45, top + 0.4, -0.2), at(0.4, top + 0.65, 0.0)], 0.04, { radial: 5, perSpan: 3 }), { color: BRASS, flat: 0.3 });
        b.add(geo.cone(0.12, 0.18, 10), { color: BRASS, pos: at(0.4, top + 0.62, 0.05), rot: yawed([Math.PI / 2 + 0.3, 0, 0], yaw), flat: 0.3 });
      }
      circle(sx, sz, 0.62);
    });
  }

  // ==========================================================================================
  // The two walk-ups either side of the lot. We see their side walls from the garden and their
  // fronts from the road.
  // ==========================================================================================
  const WX = 21; // inner face
  const WD = 4.4; // depth of each building
  const WZ0 = -16;
  const WZ1 = 8;
  const WH = 10.6;
  const wallCZ = (WZ0 + WZ1) / 2;
  const wallLen = WZ1 - WZ0;
  {
    for (const sx of [-1, 1]) {
      const cx = sx * (WX + WD / 2);
      const foot = Math.min(0, ground(cx, WZ0), ground(sx * (WX + WD), WZ0), ground(sx * (WX + WD), WZ1)) - 1.2;
      b.add(geo.box(WD + 0.3, 0.9 - foot, wallLen + 0.3), { color: P.marbleShade, pos: [cx, foot, wallCZ] });
      b.add(geo.box(WD, WH - 0.9, wallLen), { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, pos: [cx, 0.9, wallCZ], hatch: 0.06 });
      b.add(geo.box(WD + 0.6, 0.4, wallLen + 0.6), { color: P.marble, pos: [cx, WH, wallCZ] });
      b.add(geo.box(WD - 0.3, 0.6, wallLen - 0.3), { color: P.brickDeep, pos: [cx, WH + 0.4, wallCZ] });
      // Roof garden.
      b.add(geo.box(WD - 0.9, 0.16, wallLen - 0.9), { color: P.grassDeep, pos: [cx, WH + 0.6, wallCZ], flat: 0.4 });
      for (let i = 0; i < (low ? 2 : 4); i++) clump([cx, WH + 1.1, WZ0 + 4 + i * 5], [1.1, 0.8, 1.2], LEAVES[(i + 1) % LEAVES.length]);
      // Brick string courses on the garden side so the wall is not one flat slab.
      for (const y of [3.6, 7.0]) b.add(geo.box(0.12, 0.18, wallLen), { color: P.brickDeep, pos: [sx * (WX - 0.06), y, wallCZ] });
      // The fronts, facing the road: windows, a stoop, a door.
      const fz = WZ1 + 0.02;
      const pane = geo.plane(0.95, 1.5);
      for (const y of [4.2, 7.4]) {
        for (const off of [-1.1, 1.1]) {
          const r = rng();
          b.add(pane, { color: r < 0.25 ? LIT : r < 0.45 ? (P.glass as string) : WINDOW, pos: [cx + off, y, fz], flat: 0.7 });
          b.add(geo.box(1.2, 0.12, 0.22), { color: P.marble, pos: [cx + off, y - 0.82, fz + 0.06] });
          b.add(geo.box(1.2, 0.16, 0.16), { color: P.marble, pos: [cx + off, y + 0.82, fz + 0.04] });
        }
      }
      b.add(geo.plane(1.1, 2.1), { color: sx < 0 ? MINT : GREEN, pos: [cx, 1.0, fz], flat: 0.6 });
      b.add(geo.arch({ span: 1.3, rise: 2.5, thick: 0.18, depth: 0.25, round: true }), { color: P.marble, pos: [cx, 0.9, fz + 0.08] });
      for (let k = 0; k < 3; k++) b.add(geo.box(1.8, 0.3, 0.45), { color: P.marbleShade, pos: [cx, k * 0.3, fz + 1.2 - k * 0.38] });
      box(cx, wallCZ + 0.5, WD / 2 + 0.15, wallLen / 2 + 1.4);
    }
    // Left: a water tower on the roof, ivy all over the garden face.
    {
      const tx = -(WX + WD / 2);
      const tz = WZ0 + 5;
      const ty = WH + 0.6;
      for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) {
        b.add(geo.box(0.14, 2.2, 0.14), { color: IRON, pos: [tx + dx, ty, tz + dz] });
      }
      b.add(geo.cylinder(1.45, 1.45, 2.8, 12), { gradient: { bottom: WOOD_DEEP, top: WOOD }, color: WOOD, pos: [tx, ty + 2.2, tz] });
      for (const y of [0.6, 1.6, 2.5]) b.add(geo.torus(1.47, 0.05, 16, 3), { color: IRON, pos: [tx, ty + 2.2 + y, tz] });
      b.add(geo.cone(1.65, 1.2, 12), { color: P.verdigris, pos: [tx, ty + 5.0, tz] });
      const ivy = b.newId();
      const ivyN = low ? 7 : 14;
      for (let i = 0; i < ivyN; i++) {
        const z = WZ0 + 1.5 + (i / ivyN) * (wallLen - 3) + (rng() - 0.5) * 0.8;
        const top = 3 + rng() * 6.5;
        const s = 1.0 + rng() * 0.7;
        b.add(geo.blobs(seed++, 5, 1, { squash: 0.8, detail: 0, size: [0.45, 0.7] }), {
          gradient: { bottom: P.grassDeep, top: P.grassLight }, color: P.leaf, id: ivy, flat: 0.35,
          pos: [-WX + 0.15, top * 0.45, z], scale: [0.22, top * 0.42, s * 1.5], sway: 0.05,
        });
      }
      // Ivy pouring over the cornice.
      for (let i = 0; i < (low ? 3 : 5); i++) {
        b.add(geo.blobs(seed++, 4, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
          gradient: { bottom: P.grassDeep, top: P.grassLight }, color: P.leaf, flat: 0.35,
          pos: [-WX + 0.1, WH - 0.6, WZ0 + 3 + i * 4.5], scale: [0.5, 1.4, 1.6], sway: 0.05,
        });
      }
    }
  }

  // ==========================================================================================
  // East: the chart wall, a desk with seven chairs facing it, and the sign.
  // ==========================================================================================
  {
    const fx = WX - 0.02; // the wall's garden face
    const faceRot: V3 = [0, -Math.PI / 2, 0];
    const board = b.add(geo.box(0.12, 4.9, 10.6), { color: P.marble, pos: [fx - 0.06, 1.0, 0] });
    // Six charts, three across, two high.
    const cw = 3.2;
    const ch = 1.8;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const cz = -3.4 + col * 3.4;
        const cy = 1.2 + row * 2.1;
        const fill = row === 0 && col === 1 ? mix(P.paper, MINT, 0.4) : P.paper;
        b.add(geo.box(0.05, ch, cw), { color: fill, pos: [fx - 0.14, cy, cz], flat: 0.6 });
        // Grid lines.
        for (let k = 1; k < 3; k++) {
          b.add(geo.box(0.02, 0.03, cw - 0.2), { color: P.paveShade, pos: [fx - 0.17, cy + (ch * k) / 3, cz], flat: 1, outline: false });
        }
        const kind = (row * 3 + col) % 3;
        if (kind === 0) {
          // Candles.
          let y = cy + 0.7;
          for (let k = 0; k < 9; k++) {
            const up = rng() < 0.55;
            const h = 0.15 + rng() * 0.35;
            const z = cz - cw / 2 + 0.3 + k * 0.33;
            const y0 = up ? y : y - h;
            b.add(geo.box(0.04, Math.max(0.08, h), 0.16), { color: up ? CHART_UP : CHART_DOWN, pos: [fx - 0.18, Math.max(cy + 0.1, Math.min(cy + ch - 0.3, y0)), z], flat: 0.8 });
            y = up ? y0 + h : y0;
            y = Math.max(cy + 0.25, Math.min(cy + ch - 0.4, y));
          }
        } else {
          // A line wandering across, and a level drawn on it by hand.
          const pts: V3[] = [];
          let y = cy + 0.4 + rng() * 0.6;
          for (let k = 0; k <= 8; k++) {
            pts.push([fx - 0.19, y, cz - cw / 2 + 0.2 + (k * (cw - 0.4)) / 8]);
            y = Math.max(cy + 0.2, Math.min(cy + ch - 0.2, y + (rng() - 0.45) * 0.45));
          }
          b.add(geo.tube(pts, 0.045, { radial: 4, perSpan: 1 }), { color: kind === 1 ? P.tealDeep : CHART_DOWN, flat: 0.7 });
          b.add(geo.box(0.02, 0.05, cw - 0.3), { color: BRASS, pos: [fx - 0.2, cy + ch * 0.62, cz], flat: 0.9 });
        }
        // A pin at each top corner.
        for (const e of [-1, 1]) b.add(geo.sphere(0.07, 6, 4), { color: RED, flat: 0.6, pos: [fx - 0.18, cy + ch - 0.12, cz + e * (cw / 2 - 0.15)] });
      }
    }
    b.label({ text: 'TRADINGOS', size: 0.2, pos: [fx - 0.13, 5.5, -3.6], rot: faceRot, ink: P.violet, plate: P.marble, id: board, pad: 0.1, align: 'left', anchor: 'center' });
    // The sign, red enamel over the board, exactly these words.
    const signY = 6.75;
    const sign = b.add(geo.bevelBox(0.14, 1.2, 8.6, 0.04), { color: RED, pos: [fx - 0.1, signY, 0], flat: 0.5 });
    b.add(geo.box(0.06, 1.36, 8.8), { color: BRASS, pos: [fx - 0.04, signY - 0.08, 0], flat: 0.3 });
    b.label({ text: 'CANNOT ROUTE ORDERS', size: fit('CANNOT ROUTE ORDERS', 0.62, 7.9), pos: [fx - 0.18, signY + 0.6, 0], rot: faceRot, ink: P.paper, plate: RED, id: sign, flat: 0.5, pad: 0.1 });
    for (const e of [-3.6, 3.6]) b.add(geo.box(0.5, 0.08, 0.08), { color: IRON, pos: [fx - 0.25, signY + 1.25, e] });

    // The desk: long, oak, papers and a lamp on it.
    const DX = 17.4;
    const deskLen = 7.6;
    b.add(geo.bevelBox(1.3, 0.1, deskLen, 0.03), { color: WOOD, pos: [DX, 0.76, 0] });
    for (const z of [-deskLen / 2 + 0.3, 0, deskLen / 2 - 0.3]) b.add(geo.box(1.1, 0.76, 0.12), { color: WOOD_DEEP, pos: [DX, 0, z] });
    for (let k = 0; k < 7; k++) {
      const z = -3 + k;
      b.add(geo.box(0.42, 0.02, 0.3), { color: P.paper, pos: [DX - 0.15, 0.86, z + (rng() - 0.5) * 0.2], rot: [0, (rng() - 0.5) * 0.5, 0], flat: 0.5 });
    }
    b.add(geo.cylinder(0.14, 0.16, 0.05, 10), { color: BRASS, pos: [DX + 0.35, 0.86, 3.3] });
    b.add(geo.box(0.04, 0.5, 0.04), { color: BRASS, pos: [DX + 0.35, 0.86, 3.3] });
    b.add(geo.cone(0.2, 0.22, 10), { color: GREEN, pos: [DX + 0.3, 1.36, 3.3], flat: 0.4 });
    // A brass plate on the front of the desk, facing back toward the house.
    // Seven chairs in a row, all facing the charts. Six alike, and one for the human who watches.
    const CX = 16.1;
    for (let k = 0; k < 7; k++) {
      const z = -3 + k;
      const human = k === 3;
      const col = human ? BRASS : MINT;
      b.add(geo.box(0.5, 0.08, 0.5), { color: col, pos: [CX, 0.46, z], flat: 0.2 });
      b.add(geo.box(0.08, 0.62, 0.5), { color: col, pos: [CX - 0.25, 0.54, z], rot: [0, 0, 0.08], flat: 0.2 });
      for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as const) {
        b.add(geo.box(0.05, 0.46, 0.05), { color: IRON, pos: [CX + lx, 0, z + lz] });
      }
    }
    box(DX - 0.55, 0, 1.25, deskLen / 2 + 0.1);
  }

  // ==========================================================================================
  // West: potting benches of seedlings, numbered one to forty eight, and the one that made it.
  // ==========================================================================================
  {
    const benchX = [-11.4, -14.6, -17.8];
    const BZ0 = -6.0;
    const BL = 5.6;
    const bcz = BZ0 + BL / 2;
    const TOP = 0.86;
    // The ones that are still green. The champion, 14, has gone to the big pot.
    const alive = new Set([1, 2, 3, 5, 8, 9, 11, 17, 21, 26, 30, 33, 39]);
    const stem = geo.cylinder(0.03, 0.035, 0.3, 5);
    const leafG = geo.sphere(1, 6, 4);
    const tagG = geo.box(0.16, 0.12, 0.02);
    let n = 1;
    benchX.forEach((bx) => {
      b.add(geo.bevelBox(1.3, 0.08, BL, 0.02), { color: WOOD, pos: [bx, TOP - 0.08, bcz] });
      b.add(geo.box(1.1, 0.05, BL - 0.3), { color: WOOD_DEEP, pos: [bx, 0.25, bcz] });
      for (const lz of [BZ0 + 0.2, BZ0 + BL - 0.2]) for (const lx of [-0.55, 0.55]) b.add(geo.box(0.07, TOP - 0.08, 0.07), { color: WOOD_DEEP, pos: [bx + lx, 0, lz] });
      // Pots under the bench.
      if (!low) for (let k = 0; k < 3; k++) b.add(geo.cylinder(0.22, 0.16, 0.3, 8), { color: TERRA, pos: [bx - 0.2 + (k % 2) * 0.35, 0.3, BZ0 + 0.9 + k * 1.6] });
      // Two trays of eight.
      for (let t = 0; t < 2; t++) {
        const tz = BZ0 + 1.45 + t * 2.6;
        b.add(geo.box(0.76, 0.1, 1.42), { color: SOIL, pos: [bx, TOP, tz] });
        b.add(geo.box(0.8, 0.06, 1.46), { color: mix(TERRA, WOOD, 0.4), pos: [bx, TOP, tz] });
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 2; col++) {
            const x = bx + (col === 0 ? -0.18 : 0.18);
            const z = tz - 0.52 + row * 0.35;
            const y = TOP + 0.1;
            const num = n++;
            const label = String(num).padStart(2, '0');
            const crashed = num >= 44;
            if (num === 14) {
              // Empty cell, with a stake where it stood.
              b.add(geo.box(0.03, 0.22, 0.03), { color: BRASS, pos: [x, y, z] });
            } else if (alive.has(num)) {
              const h = 0.7 + rng() * 0.6;
              b.add(stem, { color: P.leafDeep, pos: [x, y, z], scale: [1, h, 1], sway: 0.15, swayBase: y });
              b.add(leafG, { color: LEAVES[num % LEAVES.length], pos: [x + 0.05, y + 0.3 * h, z], rot: [0, num, 0.4], scale: [0.11, 0.035, 0.06], sway: 0.15, swayBase: y });
              b.add(leafG, { color: LEAVES[(num + 2) % LEAVES.length], pos: [x - 0.05, y + 0.27 * h, z], rot: [0, num, -0.4], scale: [0.1, 0.035, 0.06], sway: 0.15, swayBase: y });
            } else {
              // Withered: bent over, one leaf hanging.
              const lean = 0.7 + rng() * 0.5;
              const dir = rng() * 6.28;
              const r: V3 = [Math.sin(dir) * lean, 0, Math.cos(dir) * lean];
              b.add(stem, { color: crashed ? WITHER_DEEP : WITHER, pos: [x, y, z], rot: r, scale: [1, 0.8, 1] });
              b.add(leafG, {
                color: crashed ? WITHER_DEEP : WITHER, pos: [x + Math.sin(r[2]) * -0.18, y + 0.12, z + Math.sin(r[0]) * 0.18],
                rot: [0.8, dir, 0.6], scale: [0.08, 0.03, 0.05],
              });
            }
            // The tag, on the tray edge, facing the aisle on its side.
            const sx = col === 0 ? -1 : 1;
            const tagX = bx + sx * 0.43;
            const rr: V3 = [0, sx * Math.PI / 2, 0];
            const tid = b.add(tagG, { color: crashed ? mix(RED, P.paper, 0.35) : P.paper, pos: [tagX, TOP - 0.02, z], rot: rr, flat: 0.5 });
            if (!low) b.label({ text: label, size: 0.06, pos: [tagX + sx * 0.012, TOP + 0.04, z], rot: rr, ink: P.ink, plate: crashed ? mix(RED, P.paper, 0.35) : P.paper, id: tid, flat: 0.5, pad: 0.05, jitter: 0.2 });
          }
        }
      }
      box(bx, bcz, 0.68, BL / 2 + 0.05);
    });
    // The bench sign, on a post at the head of the middle aisle, facing the road.
    {
      const sx = -13.0;
      const sz = 1.0;
      b.add(geo.box(0.1, 1.5, 0.1), { color: WOOD_DEEP, pos: [sx, 0, sz] });
      const board2 = b.add(geo.box(1.9, 0.75, 0.06), { color: P.paper, pos: [sx, 1.3, sz + 0.07], flat: 0.4 });
      b.label({ text: 'RESEARCH LAB', size: 0.17, pos: [sx, 1.86, sz + 0.11], ink: P.ink, plate: P.paper, id: board2, flat: 0.4, pad: 0.06 });
      b.label({ text: 'FIVE MINUTES EACH', size: 0.1, pos: [sx, 1.58, sz + 0.11], ink: P.violet, plate: P.paper, id: board2, flat: 0.4, pad: 0.06 });
      b.label({ text: 'MOST DO NOT MAKE IT', size: 0.1, pos: [sx, 1.42, sz + 0.11], ink: RED, plate: P.paper, id: board2, flat: 0.4, pad: 0.06 });
    }
    // The champion, in a big terracotta pot at the front, as tall as a man.
    {
      const cx = -14.6;
      const cz = 3.0;
      const pot = b.add(geo.cylinder(0.72, 0.52, 0.9, 14), { color: TERRA, pos: [cx, 0, cz] });
      b.add(geo.cylinder(0.8, 0.8, 0.14, 14), { color: mix(TERRA, '#ffffff', 0.15), pos: [cx, 0.9, cz] });
      b.add(geo.cylinder(0.7, 0.7, 0.04, 14), { color: SOIL, pos: [cx, 0.98, cz] });
      b.label({ text: 'EPOCH 14', size: 0.13, pos: [cx, 0.62, cz + 0.66], rot: [-0.2, 0, 0], ink: P.paper, plate: TERRA, id: pot, pad: 0.06 });
      b.label({ text: '0.7067', size: 0.1, pos: [cx, 0.4, cz + 0.63], rot: [-0.2, 0, 0], ink: P.paper, plate: TERRA, id: pot, pad: 0.06 });
      const sb = 1.0;
      b.add(geo.cylinder(0.05, 0.08, 1.7, 6), { color: P.leafDeep, pos: [cx, 1.0, cz], sway: 0.4, swayBase: sb });
      for (let k = 0; k < 6; k++) {
        const a = k * 1.1;
        const y = 1.3 + k * 0.22;
        b.add(geo.sphere(1, 7, 5), {
          gradient: { bottom: P.leafDeep, top: GREEN }, color: GREEN, sway: 0.4, swayBase: sb,
          pos: [cx + Math.cos(a) * 0.32, y, cz + Math.sin(a) * 0.32], rot: [0, -a, 0.5], scale: [0.42, 0.06, 0.2],
        });
      }
      b.add(geo.blobs(seed++, 4, 0.45, { squash: 0.9, detail: 0 }), { gradient: { bottom: P.leafDeep, top: GREEN }, color: GREEN, pos: [cx, 2.75, cz], sway: 0.4, swayBase: sb });
      circle(cx, cz, 0.8);
    }
    // A watering can and a coil of hose in the aisle.
    {
      const x = -13.0;
      const z = -7.2;
      b.add(geo.cylinder(0.2, 0.22, 0.38, 10), { color: P.verdigris, pos: [x, 0, z] });
      b.add(geo.cylinder(0.035, 0.035, 0.5, 5), { color: P.verdigris, pos: [x + 0.2, 0.15, z], rot: [0, 0, -1.0] });
      b.add(geo.torus(0.14, 0.03, 10, 4), { color: P.verdigris, pos: [x, 0.45, z], rot: [Math.PI / 2, 0, 0] });
      b.add(geo.torus(0.45, 0.06, 14, 4), { color: CHART_UP, pos: [-16.2, 0.06, -7.6] });
      b.add(geo.torus(0.36, 0.06, 14, 4), { color: CHART_UP, pos: [-16.2, 0.16, -7.6], rot: [0, 0, 0.1] });
    }
  }

  // ==========================================================================================
  // The back of the lot: a marble colonnade with ivy, and hedges to the walls.
  // ==========================================================================================
  {
    const CZ2 = -19.0;
    const cols = [-9, -4.5, 0, 4.5, 9];
    const SH = 5.6;
    const stone = b.newId();
    b.add(geo.bevelBox(21, 0.5, 2.4, 0.05), { color: P.marbleShade, pos: [0, ground(0, CZ2) - 0.2, CZ2], id: stone });
    for (const x of cols) {
      const y = 0.3;
      b.add(geo.bevelBox(1.3, 0.35, 1.3, 0.05), { color: P.marble, pos: [x, y, CZ2] });
      b.add(geo.prism(12, 0.44, 0.52, SH), { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [x, y + 0.35, CZ2] });
      b.add(geo.cylinder(0.68, 0.48, 0.32, 12), { color: P.marble, pos: [x, y + 0.35 + SH, CZ2] });
      b.add(geo.bevelBox(1.4, 0.24, 1.4, 0.04), { color: P.marbleShade, pos: [x, y + 0.67 + SH, CZ2] });
      circle(x, CZ2, 0.7);
    }
    const ent = b.add(geo.box(20.6, 1.2, 1.5), { color: P.marble, pos: [0, 0.3 + 0.91 + SH, CZ2] });
    b.add(geo.box(21.2, 0.3, 1.8), { color: P.marbleShade, pos: [0, 0.3 + 2.11 + SH, CZ2] });
    b.label({ text: 'AGENTS UNDER GLASS', size: 0.46, pos: [0, 0.3 + 1.51 + SH, CZ2 + 0.77], ink: P.ink, plate: P.marble, id: ent, pad: 0.1 });
    // Ivy hanging in curtains off the entablature and climbing two of the shafts.
    for (let i = 0; i < (low ? 4 : 8); i++) {
      const x = -9.5 + i * 2.7 + rng() * 0.6;
      const len = 1.2 + rng() * 2.2;
      b.add(geo.blobs(seed++, 4, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
        gradient: { bottom: P.leafDeep, top: P.moss }, color: P.moss,
        pos: [x, 0.3 + 2.1 + SH - len * 0.5, CZ2 + 0.85], scale: [0.7, len * 0.55, 0.3], sway: 0.15,
      });
    }
    for (const x of [-4.5, 9]) clump([x, 2.2, CZ2 + 0.35], [0.75, 2.2, 0.75], P.leafDeep as string, undefined, 5, 0.08);
    box(0, CZ2, 10.5, 1.2);
    // Hedges either side.
    for (const sx of [-1, 1]) {
      const hx = sx * 15.2;
      b.add(geo.bevelBox(9.6, 1.5, 1.4, 0.3), { gradient: { bottom: P.grassDeep, top: P.grass }, color: P.grass, pos: [hx, 0, -17.6], hatch: 0.08 });
      box(hx, -17.6, 4.8, 0.7);
    }
  }

  // ==========================================================================================
  // Ground: lawns and beds either side of the walk up to the door, a brick apron at the door,
  // and trees.
  // ==========================================================================================
  {
    const lawn = { gradient: { bottom: P.grassDeep, top: P.grass }, color: P.grass, flat: 0.35 };
    for (const sx of [-1, 1]) {
      const x0 = sx * 2.4;
      const x1 = sx * 9.5;
      const cx = (x0 + x1) / 2;
      b.add(geo.bevelBox(Math.abs(x1 - x0), 0.08, 9.0, 0.03), { ...lawn, pos: [cx, 0, 10.5] });
      // A kerb of marble round it.
      b.add(geo.box(Math.abs(x1 - x0) + 0.3, 0.14, 0.18), { color: P.marble, pos: [cx, 0, 15.0] });
      b.add(geo.box(0.18, 0.14, 9.0), { color: P.marble, pos: [x0, 0, 10.5] });
      // A bed of flowers in the lawn.
      const fx = sx * 6.2;
      b.add(geo.cylinder(1.6, 1.6, 0.14, 14), { color: SOIL, pos: [fx, 0, 10.0], flat: 0.4 });
      for (let k = 0; k < (low ? 4 : 8); k++) {
        const a = (k / 8) * Math.PI * 2;
        const r = k % 2 ? 1.0 : 0.55;
        const flower = [RED, P.yellow as string, P.pink as string, '#ffffff'][k % 4];
        b.add(geo.sphere(0.18, 6, 4), { color: flower, flat: 0.6, pos: [fx + Math.cos(a) * r, 0.42, 10.0 + Math.sin(a) * r], sway: 0.1 });
        b.add(geo.blobs(seed++, 3, 0.32, { squash: 0.8, detail: 0 }), { color: LEAVES[k % LEAVES.length], pos: [fx + Math.cos(a) * r, 0.2, 10.0 + Math.sin(a) * r], sway: 0.1 });
      }
    }
    // Brick apron in front of the door.
    b.add(geo.box(4.8, 0.06, 2.4), { color: mix(P.brick, P.pave, 0.45), pos: [0, 0, ZF + 1.6], flat: 0.3 });
    // Gravel paths to the benches and the desk.
    b.add(geo.box(4.0, 0.06, 1.8), { color: P.paveShade, pos: [-8.0, 0, 5.0], flat: 0.3 });
    b.add(geo.box(4.0, 0.06, 1.8), { color: P.paveShade, pos: [8.0, 0, 5.0], flat: 0.3 });
    // Box hedges along the house.
    for (const sx of [-1, 1]) {
      b.add(geo.bevelBox(0.9, 0.9, 12, 0.2), { gradient: { bottom: P.grassDeep, top: P.grassLight }, color: P.grass, pos: [sx * (HX + 0.9), 0, ZC - 1.5], hatch: 0.05 });
      box(sx * (HX + 0.9), ZC - 1.5, 0.45, 6);
    }
    // Low marble planters along the front of the lot, either side of the lawns, full of box.
    for (const sx of [-1, 1]) {
      const cx = sx * 14.6;
      b.add(geo.bevelBox(7.0, 0.55, 1.1, 0.05), { color: P.marble, pos: [cx, 0, 16.2] });
      b.add(geo.bevelBox(6.6, 0.7, 0.8, 0.25), { gradient: { bottom: P.grassDeep, top: P.grassLight }, color: P.grass, pos: [cx, 0.5, 16.2], hatch: 0.05 });
      if (!low) for (let k = 0; k < 3; k++) b.add(geo.sphere(0.16, 6, 4), { color: [RED, P.yellow as string, P.pink as string][k], flat: 0.6, pos: [cx - 2 + k * 2, 1.25, 16.2] });
      box(cx, 16.2, 3.5, 0.55);
    }
    // Trees at the corners of the lot.
    tree(-16.5, 12.0, 8.5, LEAVES[2]);
    tree(18.5, 10.8, 8.0, LEAVES[0]);
    if (!low) tree(-17.0, -12.0, 7.5, LEAVES[3]);
    if (!low) tree(17.5, -11.0, 7.0, LEAVES[4]);
    // Pots by the door.
    for (const sx of [-1, 1]) {
      b.add(geo.cylinder(0.42, 0.3, 0.6, 10), { color: TERRA, pos: [sx * 2.7, 0, ZF + 0.7] });
      clump([sx * 2.7, 0.85, ZF + 0.7], [0.45, 0.5, 0.45], LEAVES[sx > 0 ? 1 : 3], undefined, 4, 0.15);
    }
    for (const sx of [-1, 1]) circle(sx * 2.7, ZF + 0.7, 0.45);
  }

  const main = b.build('greenhouse-static');
  main.rotation.y = TURN;
  group.add(main);

  // ==========================================================================================
  // Over the crown: a ring of potted seedlings going slowly round, held up by nothing.
  // ==========================================================================================
  const rb = kit.builder();
  const RING_Y = 13.0;
  {
    const N = low ? 6 : 9;
    const RR = 11.5;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * RR;
      const z = Math.sin(a) * RR;
      const y = Math.sin(a * 3) * 0.6;
      rb.add(geo.cylinder(0.5, 0.34, 0.65, 10), { color: TERRA, pos: [x, y, z] });
      rb.add(geo.cylinder(0.56, 0.56, 0.12, 10), { color: mix(TERRA, '#ffffff', 0.15), pos: [x, y + 0.6, z] });
      rb.add(geo.blobs(100 + i, 4, 0.5, { squash: 0.9, detail: 0 }), {
        gradient: { bottom: P.leafDeep, top: LEAVES[i % LEAVES.length] }, color: GREEN, pos: [x, y + 1.05, z],
      });
    }
  }
  const ring = rb.build('greenhouse-ring');
  // Positioned in the turned frame, round the plant.
  ring.position.set(wx(PX + 0.4, PZ), RING_Y, wz(PX + 0.4, PZ));
  ring.rotation.set(0.08, 0, 0.05);
  group.add(ring);

  // ==========================================================================================
  // Points of interest.
  // ==========================================================================================
  poi('observable-lab', PX, PZ + 3.2, 'Look at the plant', 2.6, 4.5);
  poi('research-lab', -13.0, 3.4, 'Read the seedling tags', 2.4, 4.5);
  poi('tradingos', 14.0, 0, 'Look at the charts', 2.6, 4.5);
  let spare = 0;
  for (const e of entries) {
    if (e.id === 'observable-lab' || e.id === 'research-lab' || e.id === 'tradingos') continue;
    poi(e.id, -6 + spare * 3, 16, 'Look closer');
    spare++;
  }

  return {
    group,
    colliders,
    pois,
    update(_dt, t) {
      ring.rotation.y = t * 0.06;
      ring.position.y = RING_Y + Math.sin(t * 0.4) * 0.35;
    },
  };
}
