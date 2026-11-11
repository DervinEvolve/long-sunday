// The Boneyard. A vacant lot that sits lower than the blocks round it, where the things I did not
// finish are laid to rest, kindly. A great set of bleached rib arches stands at the back like the
// skeleton of something huge that lay down here and stayed. Fluted columns lie where they fell,
// drum by drum. The back of the lot is the party wall of a building that is not there any more,
// with the ghost of its rooms and its stair still painted on the brick.
//
// One object per entry: a giant phone fallen on its back with a face scan grid on the screen
// (tribe), two empty picture frames on stands (empty-pages), a bronze ankh key half sunk in the
// ground (ankh), two blank tablets (contracts), and in the middle a young tree growing out of a
// column drum, with seedlings everywhere (seedlings).
//
// The thing that cannot be: one column has not fallen down, it has fallen up. Its drums hang in
// the air over the stump, one above the other, turning slowly, each one with moss and a sprout.
//
// The one road comes in from the south east. Everything is laid out in a frame turned to face it:
// local +z points down that road. The meshes sit in one turned group; colliders and markers are
// turned by hand.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import { gates } from '../world/layout';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, PartOpts, LabelOpts, Poi } from '../types';

type V3 = [number, number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const TRUNK = '#7a5a86';
const SPROUT = '#8fd65a';
const SPROUT_DEEP = '#4f9c62';
const SCREEN = '#3d3766';
const SCAN = '#8ff0d0';
const PHONE = '#8a86b8';
const SOIL = '#7a6070';
const GHOST_A = '#e8b4a8';
const GHOST_B = '#cdbfe0';

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

export const district: DistrictModule = {
  id: 'boneyard',
  build(ctx) {
    return buildBoneyard(ctx);
  },
};

// Scratch for placing parts inside a turned and tilted object.
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

function frame(pos: V3, rot: V3 = [0, 0, 0], parent?: THREE.Matrix4): THREE.Matrix4 {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
  return parent ? parent.clone().multiply(m) : m;
}

/** Position, rotation and scale of something placed at pos/rot/scale inside frame f. */
function inFrame(f: THREE.Matrix4, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: number | V3 = 1): { pos: V3; rot: V3; scale: V3 } {
  const sc: V3 = typeof scale === 'number' ? [scale, scale, scale] : scale;
  _m.compose(_p.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.set(...sc));
  _m.premultiply(f);
  _m.decompose(_p, _q, _s);
  _e.setFromQuaternion(_q, 'XYZ');
  return { pos: [_p.x, _p.y, _p.z], rot: [_e.x, _e.y, _e.z], scale: [_s.x, _s.y, _s.z] };
}

function buildBoneyard(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const [BONE, TERRA, LILAC] = site.accents as [string, string, string];
  const BONE_SHADE = mix(BONE, P.marbleShade, 0.6);
  const MOSSY = mix(BONE, P.moss, 0.55);

  // The frame. Local +z looks down the road toward the Terraces.
  const g0 = gates('boneyard')[0] ?? { x: site.arrive.x, z: site.arrive.z };
  const TURN = Math.atan2(g0.x, g0.z);
  const C = Math.cos(TURN);
  const S = Math.sin(TURN);
  const wx = (x: number, z: number): number => x * C + z * S;
  const wz = (x: number, z: number): number => -x * S + z * C;
  const ground = (x: number, z: number): number => ctx.groundAt(wx(x, z), wz(x, z));
  const ws = ctx.sun ?? FALLBACK_SUN;
  const sun: V3 = [ws[0] * C - ws[2] * S, ws[1], ws[0] * S + ws[2] * C];
  const shade = mix(mix(P.pave, BONE, 0.2), P.shadow, 0.3);

  const group = new THREE.Group();
  group.name = 'boneyard';
  const root = new THREE.Group();
  root.rotation.y = TURN;
  group.add(root);
  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const circle = (x: number, z: number, r: number): void => {
    colliders.push({ kind: 'circle', x: wx(x, z), z: wz(x, z), r });
  };
  const box = (x: number, z: number, hw: number, hd: number, rot = 0): void => {
    colliders.push({ kind: 'box', x: wx(x, z), z: wz(x, z), hw, hd, rot: TURN + rot });
  };
  /** True when a local point is inside (or right against) something solid. */
  const blocked = (x: number, z: number, margin = 0.4): boolean => {
    const px = wx(x, z);
    const pz = wz(x, z);
    for (const c of colliders) {
      if (c.kind === 'circle') {
        if (Math.hypot(px - c.x, pz - c.z) < c.r + margin) return true;
      } else {
        const r = -(c.rot ?? 0);
        const dx = px - c.x;
        const dz = pz - c.z;
        const lx = dx * Math.cos(r) + dz * Math.sin(r);
        const lz = -dx * Math.sin(r) + dz * Math.cos(r);
        if (Math.abs(lx) < c.hw + margin && Math.abs(lz) < c.hd + margin) return true;
      }
    }
    return false;
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
  /** add() inside a frame. */
  const addIn = (f: THREE.Matrix4, gg: THREE.BufferGeometry, opts: PartOpts): number => {
    const t = inFrame(f, opts.pos, opts.rot, opts.scale ?? 1);
    return b.add(gg, { ...opts, pos: t.pos, rot: t.rot, scale: t.scale });
  };
  const labelIn = (f: THREE.Matrix4, opts: LabelOpts): void => {
    const t = inFrame(f, opts.pos, opts.rot);
    b.label({ ...opts, pos: t.pos, rot: t.rot });
  };

  // A clump of leaf: ivy when squashed against stone, shrubs on the ground.
  let seed = 71;
  const clump = (pos: V3, scale: V3, tint: ColorLike, rot?: V3, count = 4, sway = 0.1, f?: THREE.Matrix4): void => {
    const g = geo.blobs(seed++, count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] });
    const opts: PartOpts = { gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) }, color: tint, pos, rot, scale, sway };
    if (f) addIn(f, g, opts);
    else b.add(g, opts);
  };
  // A low patch of moss or lawn, level with the paving.
  const bed = (x: number, z: number, sx: number, sz: number, tint: ColorLike, yaw = 0): void => {
    const y = ground(x, z);
    // An uneven flat patch: a ragged outline whose top stands 3 cm up, so shoes stay on it.
    const pts: [number, number][] = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 0.78 + rng() * 0.22;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const g0 = geo.extrude(pts, 0.2, { crease: 30 });
    const g = g0.clone().rotateX(-Math.PI / 2);
    g0.dispose();
    b.add(g, { color: tint, pos: [x, y - 0.07, z], rot: [0, yaw, 0], scale: [sx, 1, sz], flat: 0.35 });
  };
  // A street tree: trunk and three masses of leaf.
  const tree = (x: number, z: number, h: number, tint: ColorLike, pit = true, yAt?: number): void => {
    const y = yAt ?? ground(x, z);
    const s = h / 7;
    const a = rng() * 6.28;
    const ca = Math.cos(a), sa = Math.sin(a);
    if (pit) b.add(geo.cylinder(0.95, 0.95, 0.1, 8), { color: P.grassDeep, pos: [x, y, z], flat: 0.5 });
    b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, y - 0.2, z], sway: 0.2, swayBase: y });
    const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: y };
    const id = b.newId();
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    b.add(ball, { ...leaf, id, pos: [x, y + 4.9 * s, z], scale: [2.5 * s, 2.0 * s, 2.4 * s] });
    b.add(ball, { ...leaf, id, pos: [x - 1.6 * s * ca, y + 4.6 * s, z - 1.6 * s * sa], scale: [1.5 * s, 1.25 * s, 1.45 * s] });
    b.add(ball, { ...leaf, pos: [x + 1.6 * s * ca + 0.6 * sa, y + 4.0 * s, z + 1.6 * s * sa], scale: [1.7 * s, 1.35 * s, 1.6 * s] });
    if (Math.abs(y) < 0.05) cast(ball, [x, 4.9 * s, z], undefined, [2.5 * s, 2.0 * s, 2.4 * s]);
    circle(x, z, 0.34 * s);
  };

  const FLUTES = high ? 14 : 10;
  // A fluted drum: a star of sharp arrises and shallow grooves, so the ink line draws the flutes.
  const flutes = high ? 16 : 12;
  const fluteCache = new Map<string, THREE.BufferGeometry>();
  const fluted = (r: number, h: number): THREE.BufferGeometry => {
    const k = `${r}:${h}`;
    let g = fluteCache.get(k);
    if (!g) {
      const pts: [number, number][] = [];
      for (let i = 0; i < flutes * 2; i++) {
        const a = (i / (flutes * 2)) * Math.PI * 2;
        const rr = i % 2 ? r * 0.88 : r;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      g = geo.extrude(pts, h, { cacheKey: `boneyard-flute-${flutes}-${k}`, crease: 15 }).clone().rotateX(-Math.PI / 2).translate(0, h / 2, 0);
      fluteCache.set(k, g);
    }
    return g;
  };
  const marble = { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble };
  const mossyMarble = { gradient: { bottom: mix(P.marble, P.moss, 0.5), top: P.marble }, color: P.marble };

  // A capital: echinus and abacus, standing on y = 0 of its frame.
  const capital = (f: THREE.Matrix4, r: number, id?: number): void => {
    addIn(f, geo.cylinder(r * 1.25, r * 0.95, 0.42, FLUTES), { color: P.marble, pos: [0, 0, 0], id });
    addIn(f, geo.bevelBox(r * 2.9, 0.38, r * 2.9, 0.05), { color: P.marble, pos: [0, 0.42, 0], id });
  };

  // A fallen column: drums along a line on the ground, a little apart and a little askew, the capital
  // at the far end on its side. Starts at (x, z) and runs along yaw (0 runs toward +x).
  const fallen = (x: number, z: number, yaw: number, r: number, drums: number, len: number, mossTop = true): void => {
    const f = frame([x, ground(x, z), z], [0, yaw, 0]);
    let at = 0;
    for (let i = 0; i < drums; i++) {
      const skew = (rng() - 0.5) * 0.18;
      const lift = r * 0.93;
      const pos: V3 = [at + len / 2, lift, (rng() - 0.5) * 0.3];
      addIn(f, fluted(r, len), { ...marble, pos: [at, lift, pos[2]], rot: [skew, 0, -Math.PI / 2], hatch: 0.05 });
      if (mossTop && i % 2 === 0) {
        addIn(f, geo.blobs(seed++, 3, 1, { squash: 0.35, detail: 0, size: [0.4, 0.7] }), {
          color: P.moss, pos: [pos[0], lift + r * 0.85, pos[2]], scale: [len * 0.4, 0.4, r * 0.8], flat: 0.3,
        });
      }
      const c = inFrame(f, [pos[0], 0, pos[2]]);
      circle(c.pos[0], c.pos[2], Math.max(r, len * 0.5) * 0.95);
      at += len + 0.25 + rng() * 0.5;
    }
    // The capital, toppled: its axis lies along the line, abacus outward.
    const cf = frame([at + 0.1, r * 1.45, 0], [0.2, 0, -Math.PI / 2], f);
    capital(cf, r);
    const c = inFrame(f, [at + 0.5, 0, 0]);
    circle(c.pos[0], c.pos[2], r * 1.5);
  };

  // ==========================================================================================
  // The ground. Moss and lawn mounds where the stone lies, a bed round the tree in the middle,
  // a scatter of old paving slabs set crooked into it.
  // ==========================================================================================
  bed(0, 2, 4.2, 3.8, P.grass, 0.4);
  bed(0, 2, 2.6, 2.4, P.grassLight, 1.2);
  bed(10, 8.8, 5, 2.6, P.moss, -0.45);
  bed(-7.5, 13.5, 4.8, 2.8, P.grassDeep, 0.6);
  bed(-15, -8, 4.2, 4, P.grass, 0.2);
  bed(0, -15, 7, 9.5, mix(P.grass, P.moss, 0.4), -0.45);
  bed(18.4, -0.5, 3.2, 6.2, P.moss, 0.12);
  bed(14.2, -10.6, 3.2, 2.8, P.grassDeep, 0.9);
  bed(-13.2, -15.8, 3.4, 2.6, P.grass, 0.5);
  bed(-11.5, 2.5, 2.8, 3.6, P.grassLight, 0.3);
  bed(11, 2, 3.8, 3.2, P.grass, -0.3);

  // ==========================================================================================
  // The hero: bleached rib arches. Five ribs over the walk, 12 m to the crown, a spine along the
  // top that comes down to the ground behind as a tail. Two of the ribs are broken.
  // ==========================================================================================
  // The cage is turned off the line of the walk so it reads as a cage and not as one arch.
  const RIB_W = 5.6;
  const RIB_H = 12.2;
  const RIB_R = 0.42;
  const RIB_Z = [6.6, 3.3, 0, -3.3, -6.6]; // along the cage, from its own centre
  const RIB_YAW = -0.45;
  const rf = frame([0, 0, -14.6], [0, RIB_YAW, 0]);
  const ribFeet: V3[] = [];
  {
    const ribPoints = (from: number, to: number): [number, number, number][] => {
      const out: [number, number, number][] = [];
      const n = high ? 16 : 11;
      for (let i = 0; i <= n; i++) {
        const t = from + (to - from) * (i / n);
        const a = Math.PI * t;
        // A little pointed at the crown, like a gothic arch, wider at the knee.
        out.push([Math.cos(a) * RIB_W, Math.pow(Math.sin(a), 0.85) * RIB_H, 0]);
      }
      return out;
    };
    const opts = { radial: high ? 7 : 5 };
    const whole = geo.tube(ribPoints(0, 1), RIB_R, { ...opts, cacheKey: 'boneyard-rib' });
    const stubL = geo.tube(ribPoints(0.62, 1), RIB_R, { ...opts, cacheKey: 'boneyard-rib-l' });
    const stubR = geo.tube(ribPoints(0, 0.3), RIB_R, { ...opts, cacheKey: 'boneyard-rib-r' });
    const piece = geo.tube(ribPoints(0.3, 0.62).map(([x, y, z]): [number, number, number] => [x - 0.6, y - 11.0, z]), RIB_R, { ...opts, cacheKey: 'boneyard-rib-piece' });
    const ribOpts = { gradient: { bottom: MOSSY, top: BONE }, color: BONE, hatch: 0.04 };
    const knuckle = geo.sphere(0.72, 10, 7);
    for (let i = 0; i < RIB_Z.length; i++) {
      const z = RIB_Z[i];
      const lean = 0.05 + i * 0.015;
      const g = i === 3 ? stubL : i === 4 ? stubR : whole;
      const t = inFrame(rf, [0, -0.1, z], [-lean, 0, 0]);
      b.add(g, { ...ribOpts, pos: t.pos, rot: t.rot });
      if (i === 0) cast(g, t.pos, t.rot);
      for (const sx of [-1, 1]) {
        if ((i === 4 && sx < 0) || (i === 3 && sx > 0)) {
          // The foot is still there even where the rib above it went.
          addIn(rf, geo.cylinder(RIB_R * 1.05, RIB_R * 1.2, 1.4, 7), { ...ribOpts, pos: [sx * RIB_W, 0, z], rot: [0, 0, sx * 0.12] });
        }
        addIn(rf, knuckle, { color: MOSSY, pos: [sx * RIB_W, 0.15, z], scale: [1, 0.8, 1] });
        const f = inFrame(rf, [sx * RIB_W, 0, z]);
        ribFeet.push(f.pos);
        circle(f.pos[0], f.pos[2], 0.8);
        clump([sx * (RIB_W + 0.3), 0.1, z + 0.4], [1.1, 0.9, 1.0], i % 2 ? P.leafDeep : P.moss, undefined, 3, 0.15, rf);
      }
    }
    // The missing piece of rib four lies on the ground off to one side.
    addIn(rf, piece, { color: BONE, pos: [-9.6, 0.4, -1.5], rot: [-Math.PI / 2, 0, 0], hatch: 0.04 });
    for (const [px, pz] of [[-10.9, -2.5], [-7.8, -1.9]]) {
      const c = inFrame(rf, [px, 0, pz]);
      circle(c.pos[0], c.pos[2], 1.0);
    }
    // The spine along the crown and down to the tail.
    const spine: [number, number, number][] = [
      [0, RIB_H + 0.1, 6.4],
      [0, RIB_H + 0.45, 2.6],
      [0, RIB_H + 0.3, -3.4],
      [0, RIB_H - 0.4, -6.6],
      [0, RIB_H - 3.2, -9.8],
      [0, 3.5, -11.6],
      [0, 0.5, -12.4],
    ];
    const sp = geo.tube(spine, 0.32, { radial: 6, perSpan: high ? 5 : 3, cacheKey: 'boneyard-spine' });
    addIn(rf, sp, { color: BONE });
    const vert = geo.bevelBox(1.0, 0.75, 1.05, 0.12);
    const curve = new THREE.CatmullRomCurve3(spine.map((p) => new THREE.Vector3(...p)));
    const count = high ? 16 : 11;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const s = 1 - t * 0.55;
      addIn(rf, vert, { color: i % 2 ? BONE : BONE_SHADE, pos: [p.x, p.y - 0.35 * s, p.z], rot: [Math.atan2(tan.y, -tan.z), 0, 0], scale: [s, s, s] });
    }
    const tail = inFrame(rf, [0, 0, -12.2]);
    circle(tail.pos[0], tail.pos[2], 1.0);
  }

  // ==========================================================================================
  // The column that fell up. A stump on a base, then its drums hanging one above the other
  // (instanced, moved in update), then the capital (its own small mesh).
  // ==========================================================================================
  const FX = -16;
  const FZ = -8;
  const FR = 1.0;
  const STUMP = 3.2;
  {
    b.add(geo.bevelBox(3.2, 0.6, 3.2, 0.08), { ...mossyMarble, pos: [FX, -0.05, FZ] });
    b.add(geo.bevelBox(2.6, 0.35, 2.6, 0.06), { color: P.marble, pos: [FX, 0.55, FZ] });
    const stump = fluted(FR, STUMP);
    b.add(stump, { ...mossyMarble, pos: [FX, 0.9, FZ] });
    cast(stump, [FX, 0.9, FZ]);
    // A broken top: a jagged cap.
    b.add(geo.rock(9, FR * 0.95, 0, 0.25), { color: P.marble, pos: [FX, 0.9 + STUMP, FZ], scale: [1, 0.35, 1] });
    clump([FX + 0.6, 0.9 + STUMP + 0.2, FZ + 0.2], [0.7, 0.45, 0.6], P.moss, undefined, 3, 0.2);
    clump([FX + 1.3, 0.4, FZ + 1.0], [1.2, 1.2, 1.0], P.leafDeep, undefined, 4, 0.15);
    clump([FX - 1.4, 0.4, FZ - 0.4], [1.0, 1.4, 1.1], P.grassDeep, undefined, 4, 0.15);
    // Ivy climbing the stump on the side facing the road.
    for (let i = 0; i < 3; i++) {
      clump([FX + 0.55, 1.3 + i * 0.9, FZ + 0.75], [0.6, 0.55, 0.35], i % 2 ? P.moss : P.leafDeep, [0, 0.6, 0], 3, 0.05);
    }
    box(FX, FZ, 1.6, 1.6);
  }

  // ==========================================================================================
  // Fallen columns: one across the way in on the right, one lying out on the east side.
  // ==========================================================================================
  fallen(7.6, 10.2, 0.45, 0.8, 3, 1.35);
  fallen(18.8, 4.0, Math.PI / 2 + 0.12, 0.9, 5, 1.5);
  // A standing stump with its moss cap beside the eastern one, and a lone drum the other side.
  {
    const x = 21.5;
    const z = 6.5;
    b.add(geo.bevelBox(2.4, 0.4, 2.4, 0.06), { color: P.marbleShade, pos: [x, -0.05, z] });
    b.add(fluted(0.88, 5.2), { ...mossyMarble, pos: [x, 0.35, z] });
    b.add(geo.rock(13, 0.85, 0, 0.3), { color: P.marble, pos: [x, 5.55, z], scale: [1, 0.4, 1] });
    clump([x, 5.75, z], [0.8, 0.5, 0.8], P.moss, undefined, 3, 0.2);
    clump([x - 0.9, 0.3, z + 0.5], [1.2, 1.3, 1.0], P.leafDeep, undefined, 4, 0.15);
    circle(x, z, 1.3);
  }

  // ==========================================================================================
  // The name, cut into a fallen lintel that lies to the left of the way in, turned to the road.
  // ==========================================================================================
  {
    const nx = -7.6;
    const nz = 13.2;
    const yaw = Math.atan2(0 - nx, 21.6 - nz) * 0.8;
    const f = frame([nx, 0, nz], [0, yaw, 0]);
    const W = 7.2;
    const H = 1.7;
    const D = 1.4;
    const lintel = addIn(f, geo.bevelBox(W, H, D, 0.08), { color: P.marble, pos: [0, -0.15, 0], rot: [0, 0, 0.03] });
    addIn(f, geo.bevelBox(W + 0.3, 0.3, D + 0.25, 0.05), { color: P.marbleShade, pos: [0.1, H - 0.17, -0.05], rot: [0, 0, 0.03] });
    // Its broken end, a wedge of stone lying off the left.
    addIn(f, geo.rock(21, 0.9, 0, 0.22), { color: P.marble, pos: [-W / 2 - 0.9, 0.45, 0.2], scale: [1, 0.7, 0.9] });
    // Moss on top and ivy over one end.
    addIn(f, geo.blobs(seed++, 4, 1, { squash: 0.3, detail: 0, size: [0.4, 0.7] }), { color: P.moss, pos: [1.6, H + 0.18, 0], scale: [2.2, 0.4, 0.8], flat: 0.3 });
    clump([W / 2 + 0.2, 0.6, -0.35], [0.8, 1.2, 0.8], P.leafDeep, undefined, 4, 0.1, f);
    const name = site.name.toUpperCase();
    labelIn(f, { text: name, size: fit(name, 0.62, W - 1.2), pos: [-0.1, 0.95, D / 2 + 0.01], rot: [0, 0, 0.03], ink: P.ink, plate: P.marble, id: lintel, pad: 0.12 });
    labelIn(f, { text: site.years.toUpperCase(), size: 0.2, pos: [-0.1, 0.32, D / 2 + 0.01], rot: [0, 0, 0.03], ink: P.violet, plate: P.marble, id: lintel, pad: 0.12 });
    const c = inFrame(f, [0, 0, 0]);
    box(c.pos[0], c.pos[2], W / 2 + 0.2, D / 2 + 0.1, yaw);
    const r = inFrame(f, [-W / 2 - 0.9, 0, 0.2]);
    circle(r.pos[0], r.pos[2], 0.8);
  }

  // ==========================================================================================
  // seedlings: the young tree in a hollow column drum, in the middle of the lot.
  // ==========================================================================================
  {
    const x = 0;
    const z = 2;
    const drum = fluted(1.3, 1.1);
    b.add(drum, { ...mossyMarble, pos: [x, 0, z] });
    b.add(geo.cylinder(1.05, 1.05, 0.06, 12), { color: SOIL, pos: [x, 1.02, z], flat: 0.4 });
    cast(drum, [x, 0, z]);
    // The young tree.
    const y = 1.05;
    b.add(geo.cylinder(0.11, 0.18, 2.6, 6, true), { color: TRUNK, pos: [x, y, z], sway: 0.25, swayBase: 0 });
    b.add(geo.cylinder(0.05, 0.07, 1.2, 5, true), { color: TRUNK, pos: [x + 0.1, y + 1.6, z], rot: [0, 0, -0.6], sway: 0.3, swayBase: 0 });
    const crown = b.newId();
    const leaf = { gradient: { bottom: mix(SPROUT, P.shadow, 0.3), top: mix(SPROUT, '#ffffff', 0.15) }, color: SPROUT, sway: 0.5, swayBase: 0 };
    const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
    b.add(ball, { ...leaf, id: crown, pos: [x, y + 3.2, z], scale: [1.5, 1.2, 1.4] });
    b.add(ball, { ...leaf, id: crown, pos: [x + 1.0, y + 2.6, z + 0.3], scale: [0.9, 0.75, 0.85] });
    b.add(ball, { ...leaf, pos: [x - 0.8, y + 2.5, z - 0.4], scale: [0.95, 0.8, 0.9] });
    cast(ball, [x, y + 3.2, z], undefined, [1.5, 1.2, 1.4]);
    // A small sign in the bed, facing the way in.
    const sf = frame([1.9, 0, 4.9], [0, 0.25, 0]);
    addIn(sf, geo.cylinder(0.05, 0.05, 1.0, 5), { color: TRUNK, pos: [0, 0, -0.02] });
    const text = 'WHAT GROWS HERE';
    const sz = 0.22;
    const w = fit(text, sz, 2.2) === sz && b.measure ? b.measure({ text, size: sz }).width + 0.3 : 1.9;
    const board = addIn(sf, geo.bevelBox(w, 0.5, 0.06, 0.02), { color: P.paper, pos: [0, 0.8, 0], flat: 0.4 });
    labelIn(sf, { text, size: fit(text, sz, 2.2), pos: [0, 1.05, 0.04], ink: SPROUT_DEEP, plate: P.paper, id: board, flat: 0.4, pad: 0.1 });
    circle(x, z, 1.4);
    poi('seedlings', 0, 5.6, 'Look at what grows here', 2.8);
  }

  // ==========================================================================================
  // tribe: a giant phone fallen on its back, one edge propped on a drum, the screen tipped
  // toward the walk. On the screen, the grid of a face scan and an oval where the face should be.
  // ==========================================================================================
  {
    const cx = 11.6;
    const cz = 1.6;
    const tilt = 0.42;
    const PW = 2.4; // across, the edge that lifts
    const PL = 4.6; // along the walk
    const PT = 0.34;
    // Propped: the far edge sits on a drum.
    b.add(fluted(0.62, 1.6), { ...marble, pos: [cx + 1.25, 0.6, cz - 1.0], rot: [Math.PI / 2, 0, 0] });
    const f = frame([cx, Math.sin(tilt) * PW * 0.5 + 0.02, cz], [0, 0, tilt]);
    addIn(f, geo.bevelBox(PW, PT, PL, 0.14), { color: PHONE, pos: [0, -PT / 2, 0] });
    const screen = addIn(f, geo.box(PW - 0.22, 0.03, PL - 0.3), { color: SCREEN, pos: [0, PT / 2 - 0.01, 0], flat: 0.85 });
    // The scan grid.
    for (let i = -3; i <= 3; i++) addIn(f, geo.box(PW - 0.5, 0.025, 0.04), { color: mix(SCAN, SCREEN, 0.45), pos: [0, PT / 2 + 0.02, i * 0.55], flat: 1, id: screen });
    for (let i = -2; i <= 2; i++) addIn(f, geo.box(0.04, 0.025, PL - 0.6), { color: mix(SCAN, SCREEN, 0.45), pos: [i * 0.42, PT / 2 + 0.02, 0], flat: 1, id: screen });
    // The face oval, a bright ring, and the brackets of the frame round it.
    addIn(f, geo.torus(0.62, 0.05, 20, 4), { color: SCAN, pos: [0.1, PT / 2 + 0.04, 0.05], scale: [0.85, 1, 1.25], flat: 1 });
    for (const [bx, bz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      addIn(f, geo.box(0.32, 0.03, 0.06), { color: SCAN, pos: [0.1 + bx * 0.7, PT / 2 + 0.04, bz * 1.02], flat: 1 });
      addIn(f, geo.box(0.06, 0.03, 0.32), { color: SCAN, pos: [0.1 + bx * 0.84, PT / 2 + 0.04, bz * 0.88], flat: 1 });
    }
    // Reads across the screen for someone standing on the walk side (−x), looking at it.
    const flatUp: V3 = [-Math.PI / 2, 0, -Math.PI / 2];
    labelIn(f, { text: 'NO DEPTH MAP', size: 0.2, pos: [-0.85, PT / 2 + 0.03, 0], rot: flatUp, ink: SCAN, plate: SCREEN, id: screen, flat: 0.85, pad: 0.1 });
    // A side button and the camera bump on the underside are lost; one speaker slot shows.
    addIn(f, geo.box(0.1, 0.03, 0.7), { color: SCREEN, pos: [PW / 2 - 0.25, PT / 2 + 0.02, 0], flat: 1 });
    // A plaque at its foot.
    const pf = frame([cx - 2.2, 0, cz + 2.9], [0, -Math.PI / 2 + 0.9, 0]);
    const pt = frame([0, 0, 0], [-0.25, 0, 0], pf);
    const plaque = addIn(pt, geo.bevelBox(1.3, 0.75, 0.3, 0.05), { color: P.marble });
    labelIn(pt, { text: 'TRIBE', size: 0.26, pos: [0, 0.4, 0.15], ink: P.ink, plate: P.marble, id: plaque, pad: 0.1 });
    clump([cx + 0.6, 0.2, cz + 2.5], [0.9, 0.8, 0.8], P.grassDeep, undefined, 3, 0.15);
    box(cx, cz, PW / 2 + 0.2, PL / 2 + 0.1);
    poi('tribe', cx - 3.2, cz + 0.6, 'Look at the screen', 2.6);
  }

  // ==========================================================================================
  // empty-pages: two empty picture frames on stands, facing the walk. You see the lot through them.
  // ==========================================================================================
  {
    const cx = -11.2;
    const cz = 2.6;
    const yaw = Math.atan2(1, 0.25);
    const f = frame([cx, 0, cz], [0, yaw, 0]);
    const names = ['PREDICTIONS', 'AI / VOICE / CREATION'];
    const FW = 2.2;
    const FH = 2.7;
    const BAR = 0.24;
    for (let k = 0; k < 2; k++) {
      const ox = (k - 0.5) * 3.0;
      const tilt = k === 0 ? 0.04 : -0.05;
      const ff = frame([ox, 0, k * 0.4], [-0.06, k ? 0.12 : -0.1, tilt], f);
      const id = b.newId();
      const y0 = 0.75;
      const fr = { color: TERRA, id, hatch: 0.05 };
      addIn(ff, geo.bevelBox(FW, BAR, 0.2, 0.04), { ...fr, pos: [0, y0, 0] });
      addIn(ff, geo.bevelBox(FW, BAR, 0.2, 0.04), { ...fr, pos: [0, y0 + FH - BAR, 0] });
      addIn(ff, geo.bevelBox(BAR, FH, 0.2, 0.04), { ...fr, pos: [-(FW - BAR) / 2, y0, 0] });
      addIn(ff, geo.bevelBox(BAR, FH, 0.2, 0.04), { ...fr, pos: [(FW - BAR) / 2, y0, 0] });
      // An inner gilt slip so it reads as a picture frame and not a doorway.
      const slip = { color: P.brass, flat: 0.3 };
      addIn(ff, geo.box(FW - BAR * 2, 0.06, 0.08), { ...slip, pos: [0, y0 + BAR, 0.04] });
      addIn(ff, geo.box(FW - BAR * 2, 0.06, 0.08), { ...slip, pos: [0, y0 + FH - BAR - 0.06, 0.04] });
      addIn(ff, geo.box(0.06, FH - BAR * 2, 0.08), { ...slip, pos: [-(FW / 2 - BAR - 0.03), y0 + BAR, 0.04] });
      addIn(ff, geo.box(0.06, FH - BAR * 2, 0.08), { ...slip, pos: [FW / 2 - BAR - 0.03, y0 + BAR, 0.04] });
      // Legs: two in front, one strut behind.
      for (const sx of [-1, 1]) addIn(ff, geo.box(0.12, y0 + 0.4, 0.12), { color: mix(TERRA, P.shadow, 0.25), pos: [sx * (FW / 2 - 0.35), 0, 0.02] });
      for (const sx of [-1, 1]) addIn(ff, geo.box(0.12, 1.15, 0.12), { color: mix(TERRA, P.shadow, 0.25), pos: [sx * (FW / 2 - 0.35), -0.05, -0.38], rot: [0.32, 0, 0] });
      // The title plate under each frame.
      const t = names[k];
      const size = fit(t, 0.16, FW - 0.4);
      const plate = addIn(ff, geo.box(FW - 0.3, 0.32, 0.06), { color: P.paper, pos: [0, y0 - 0.42, 0.12], flat: 0.3 });
      labelIn(ff, { text: t, size, pos: [0, y0 - 0.26, 0.155], ink: P.ink, plate: P.paper, id: plate, flat: 0.3, pad: 0.08 });
      const c = inFrame(ff, [0, 0, -0.3]);
      box(c.pos[0], c.pos[2], FW / 2, 0.55, yaw);
      // A thread of ivy up one leg.
      clump([(k ? 1 : -1) * (FW / 2 + 0.15), 0.3, -0.2], [0.45, 1.1, 0.4], P.leafDeep, undefined, 3, 0.1, ff);
    }
    poi('empty-pages', cx + 3.2, cz + 1.2, 'Look through the frames', 3.6);
  }

  // ==========================================================================================
  // ankh: a bronze key in the shape of an ankh, gone green, half sunk in a mound, leaning.
  // ==========================================================================================
  {
    const cx = 14.2;
    const cz = -10.6;
    const yaw = Math.atan2(-12.4, 6) + 0.2;
    const f = frame([cx, 0, cz], [0, yaw, 0]);
    // The mound it went into.
    addIn(f, geo.blobs(seed++, 5, 1, { squash: 0.35, detail: 1, size: [0.5, 0.8], flatBase: true }), {
      gradient: { bottom: P.grassDeep, top: P.grass }, color: P.grass, pos: [0, -0.05, 0], scale: [2.3, 1.1, 1.8], flat: 0.2,
    });
    const kf = frame([0.1, -1.9, 0], [0, 0, -0.38], f);
    const bronze = { gradient: { bottom: mix(P.verdigris, P.shadow, 0.2), top: mix(P.verdigris, P.brass, 0.35) }, color: P.verdigris };
    const key = b.newId();
    addIn(kf, geo.bevelBox(0.6, 5.6, 0.42, 0.08), { ...bronze, id: key, pos: [0, 0, 0] });
    addIn(kf, geo.bevelBox(3.4, 0.6, 0.42, 0.08), { ...bronze, id: key, pos: [0, 4.4, 0] });
    addIn(kf, geo.torus(0.95, 0.3, high ? 22 : 16, 6), { ...bronze, id: key, pos: [0, 6.25, 0], rot: [Math.PI / 2, 0, 0], scale: [0.85, 1, 1.15] });
    // The bit of the key, sticking out of the mound on the near side.
    addIn(kf, geo.bevelBox(0.9, 0.42, 0.36, 0.05), { ...bronze, pos: [0.65, 1.85, 0] });
    addIn(kf, geo.bevelBox(0.36, 0.5, 0.36, 0.05), { ...bronze, pos: [0.92, 1.42, 0] });
    // Moss over the bow.
    addIn(kf, geo.blobs(seed++, 3, 1, { squash: 0.5, detail: 0, size: [0.4, 0.7] }), { color: P.moss, pos: [-0.5, 7.05, 0], scale: [0.6, 0.35, 0.5], flat: 0.3 });
    clump([-1.4, 0.2, 0.8], [1.0, 0.8, 0.8], P.leafDeep, undefined, 3, 0.15, f);
    // A stone at its foot with its three names.
    const pf = frame([-1.4, 0, 2.2], [0, 0.1, 0], f);
    const pt = frame([0, 0, 0], [-0.2, 0, 0], pf);
    const stone = addIn(pt, geo.bevelBox(2.1, 0.9, 0.34, 0.06), { color: P.marble });
    labelIn(pt, { text: 'ANKH', size: 0.24, pos: [0, 0.6, 0.17], ink: P.ink, plate: P.marble, id: stone, pad: 0.08 });
    labelIn(pf, { text: 'AR  SECURITY  LANG?', size: fit('AR  SECURITY  LANG?', 0.1, 1.8), pos: [0, 0.27, 0.17], ink: P.violet, plate: P.marble, id: stone, pad: 0.06 });
    const c = inFrame(f, [0, 0, 0]);
    circle(c.pos[0], c.pos[2], 1.6);
    const s = inFrame(pf, [0, 0, 0]);
    circle(s.pos[0], s.pos[2], 0.6);
    // The stone itself, 2.1 wide, 0.34 deep, turned with its two frames.
    const st = inFrame(pt, [0, 0, 0]);
    box(st.pos[0], st.pos[2], 1.05, 0.17, st.rot[1]);
    const p = inFrame(f, [-1.0, 0, 3.6]);
    poi('ankh', p.pos[0], p.pos[2], 'Look at the key', 3.0);
  }

  // ==========================================================================================
  // contracts: two blank tablets, standing a little apart, nothing cut in them yet.
  // ==========================================================================================
  {
    const cx = -13.2;
    const cz = -15.8;
    const yaw = Math.atan2(13.2, 7.5);
    const f = frame([cx, 0, cz], [0, yaw, 0]);
    // A round-topped tablet outline.
    const pts: [number, number][] = [];
    const TW = 1.5;
    const TH = 2.5;
    pts.push([-TW / 2, 0], [TW / 2, 0]);
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      pts.push([Math.cos(a) * TW / 2, TH - TW / 2 + Math.sin(a) * TW / 2]);
    }
    const tablet = geo.extrude(pts, 0.3, { cacheKey: 'boneyard-tablet' });
    const names = ['SOLANA', 'ETHEREUM'];
    for (let k = 0; k < 2; k++) {
      const ox = (k - 0.5) * 2.3;
      const tf = frame([ox, 0.45, k * 0.3], [k ? -0.08 : -0.03, k ? -0.12 : 0.1, k ? 0.07 : -0.03], f);
      addIn(f, geo.bevelBox(1.9, 0.5, 0.8, 0.06), { ...mossyMarble, pos: [ox, -0.05, k * 0.3 + 0.05] });
      const face = addIn(tf, tablet, { color: P.marble, pos: [0, 0, 0] });
      labelIn(tf, { text: names[k], size: 0.18, pos: [0, 1.5, 0.16], ink: P.ink, plate: P.marble, id: face, pad: 0.06 });
      const c = inFrame(f, [ox, 0, k * 0.3]);
      box(c.pos[0], c.pos[2], 0.95, 0.42, yaw);
    }
    // One plate in front for both.
    const hf = frame([0, 0, 1.55], [-0.3, 0, 0], f);
    const pl = addIn(hf, geo.bevelBox(2.6, 0.5, 0.25, 0.04), { color: P.paper, flat: 0.3 });
    labelIn(hf, { text: 'HOLD THAT THOUGHT', size: 0.16, pos: [0, 0.27, 0.125], ink: P.ink, plate: P.paper, id: pl, flat: 0.3, pad: 0.06 });
    const pc = inFrame(f, [0, 0, 1.55]);
    box(pc.pos[0], pc.pos[2], 1.3, 0.2, yaw);
    // The one that did get written has something growing at its foot.
    clump([-1.75, 0.45, 0.6], [0.35, 0.5, 0.3], SPROUT, undefined, 3, 0.3, f);
    clump([2.0, 0.2, -0.3], [0.8, 1.0, 0.7], P.leafDeep, undefined, 4, 0.15, f);
    const p = inFrame(f, [0, 0, 3.4]);
    poi('contracts', p.pos[0], p.pos[2], 'Read the tablets', 3.2);
  }

  // ==========================================================================================
  // The party wall at the back left: brick, with the ghost of the rooms that leaned on it.
  // ==========================================================================================
  {
    const cx = -14;
    const cz = -24.5;
    const yaw = Math.atan2(-cx, -cz) * 0.9;
    const f = frame([cx, 0, cz], [0, yaw, 0]);
    const W = 17;
    const H = 11;
    let lowest = 0;
    for (let i = 0; i <= 4; i++) {
      const p = inFrame(f, [-W / 2 + (i * W) / 4, 0, 0]);
      lowest = Math.min(lowest, ground(p.pos[0], p.pos[2]));
    }
    const y0 = lowest - 0.6;
    const wall = addIn(f, geo.box(W, H - y0, 0.9), { gradient: { bottom: P.brickDeep, top: P.brick }, color: P.brick, pos: [0, y0, -0.45], hatch: 0.08 });
    addIn(f, geo.box(W + 0.3, 0.3, 1.1), { color: P.brickDeep, pos: [0, H, -0.45] });
    // The ghost: two floors of room paint, and the zigzag where the stair went.
    addIn(f, geo.box(5.6, 3.0, 0.04), { color: GHOST_A, pos: [-4.8, 4.2, 0.01], flat: 0.6, id: wall });
    addIn(f, geo.box(5.6, 3.0, 0.04), { color: GHOST_B, pos: [-4.8, 7.6, 0.01], flat: 0.6, id: wall });
    addIn(f, geo.box(4.6, 3.0, 0.04), { color: GHOST_B, pos: [3.6, 4.2, 0.01], flat: 0.6, id: wall });
    addIn(f, geo.box(4.6, 2.6, 0.04), { color: mix(GHOST_A, P.paper, 0.4), pos: [3.6, 7.6, 0.01], flat: 0.6, id: wall });
    for (let i = 0; i < 3; i++) {
      const y = 1.0 + i * 3.4;
      addIn(f, geo.box(4.4, 0.2, 0.06), { color: P.brickDeep, pos: [-0.7, y + 1.5, 0.02], rot: [0, 0, i % 2 ? 0.62 : -0.62], flat: 0.5 });
    }
    // A chimney flue stripe up the middle.
    addIn(f, geo.box(0.9, H - 1, 0.05), { color: mix(P.brickDeep, P.shadow, 0.2), pos: [1.0, 1.0, 0.02], flat: 0.5 });
    // Ivy taking the left end and the foot.
    const ivy: ColorLike[] = [P.leafDeep, P.moss, P.grassDeep];
    const n = low ? 6 : 12;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.5 + rng() * 6.5;
      const y = rng() * (H - 2) * (1 - (x + W / 2) / 9);
      clump([x, Math.max(0.2, y), 0.25], [0.9 + rng() * 0.6, 0.9 + rng() * 0.6, 0.35], ivy[i % 3], undefined, 4, 0.05, f);
    }
    for (let i = 0; i < 5; i++) clump([-2 + i * 2.6, 0.2 + y0 * 0.2, 0.5], [1.2, 1.0, 0.7], ivy[(i + 1) % 3], undefined, 4, 0.1, f);
    // The planted top, a rooftop that lost its roof.
    for (let i = 0; i < 4; i++) clump([-W / 2 + 1 + i * 1.6, H + 0.2, -0.45], [0.8, 0.6, 0.6], P.grassDeep, undefined, 3, 0.25, f);
    const c = inFrame(f, [0, 0, -0.45]);
    box(c.pos[0], c.pos[2], W / 2, 0.55, yaw);
  }

  // ==========================================================================================
  // Trees round the rim where the ground rises, shrubs at the edges.
  // ==========================================================================================
  tree(-18.5, 14.5, 7.5, P.leaf, false);
  tree(17.5, 15.5, 6.5, P.grassDeep, false);
  tree(20.5, -17, 8, P.leafDeep, false);
  tree(-25, -7, 7, P.grass, false);
  if (!low) tree(7, -27.5, 6.5, P.leaf, false);
  clump([-22, ground(-22, 6) + 0.2, 6], [1.6, 1.3, 1.4], P.grassDeep, undefined, 4, 0.15);
  clump([24, ground(24, -6) + 0.2, -6], [1.5, 1.2, 1.4], P.leafDeep, undefined, 4, 0.15);
  clump([14, ground(14, 19) + 0.2, 19], [1.4, 1.1, 1.2], P.moss, undefined, 4, 0.15);

  // Crooked old slabs, the floor of whatever stood here.
  {
    const slab = geo.bevelBox(1.3, 0.1, 1.3, 0.03);
    for (let i = 0; i < (low ? 8 : 16); i++) {
      const a = rng() * Math.PI * 2;
      const d = 5 + rng() * 20;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.abs(x) < 2.2 && z > 3) continue; // keep the way in clean
      if (blocked(x, z, 0.8)) continue;
      b.add(slab, { color: i % 3 === 0 ? P.paveShade : mix(P.pave, BONE, 0.5), pos: [x, -0.02, z], rot: [(rng() - 0.5) * 0.06, rng() * 3, (rng() - 0.5) * 0.06], scale: [0.7 + rng() * 0.8, 1, 0.7 + rng() * 0.6] });
    }
  }
  // Lilac flowers in the beds.
  {
    const bloom = geo.sphere(0.085, 6, 4);
    const spots: [number, number, number][] = [[0, 2, 3.2], [-11.5, 2.5, 2.2], [-15, -8, 3], [14.2, -10.6, 2.2], [-7.5, 13.5, 3], [-13.2, -15.8, 2.4]];
    for (const [cx, cz, r] of spots) {
      for (let i = 0; i < (low ? 4 : 9); i++) {
        const a = rng() * Math.PI * 2;
        const d = r * (0.3 + rng() * 0.6);
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d;
        if (blocked(x, z, 0.15)) continue;
        b.add(bloom, { color: i % 4 === 0 ? P.marble : LILAC, pos: [x, ground(x, z) + 0.22 + rng() * 0.1, z], flat: 0.5, sway: 0.3 });
      }
    }
  }

  // ==========================================================================================
  // The sunken lot. A marble retaining wall rings the pad with a grass bank behind it, so the lot
  // sits a storey below the street. It is open where the road comes in and broken in two places.
  // ==========================================================================================
  const BANK_R = 30;
  const BANK_H = 2.1;
  {
    const STEP = (9 * Math.PI) / 180;
    const bank = geo.extrude([[0.45, -0.4], [6.0, -0.4], [5.3, 0.8], [2.4, BANK_H], [0.45, BANK_H]], 5.9, { cacheKey: 'boneyard-bank' });
    const wallSeg = geo.box(4.85, BANK_H + 0.4, 0.55);
    const coping = geo.bevelBox(4.9, 0.22, 0.8, 0.04);
    const bankId = b.newId();
    const wallId = b.newId();
    // The road, then two places where the wall came down. Both breaks face the gentle side of the
    // bank, so whoever walks out through one can climb on to the pavement.
    const gaps = [0, 2.67, 4.1];
    const gapHalf = [0.42, 0.13, 0.13];
    const isGap = (a: number): number => {
      for (let i = 0; i < gaps.length; i++) {
        let d = Math.abs(a - gaps[i]);
        d = Math.min(d, Math.PI * 2 - d);
        if (d < gapHalf[i]) return i;
      }
      return -1;
    };
    const n = Math.round((Math.PI * 2) / STEP);
    for (let i = 0; i < n; i++) {
      const a = i * STEP;
      if (isGap(a) >= 0) continue;
      const edge = isGap(a + STEP) >= 1 || isGap(a - STEP) >= 1; // beside a broken gap
      const f = frame([Math.sin(a) * BANK_R, 0, Math.cos(a) * BANK_R], [0, a, 0]);
      addIn(f, bank, { gradient: { bottom: P.grassDeep, top: P.grass }, color: P.grass, id: bankId, rot: [0, -Math.PI / 2, 0], flat: 0.2 });
      const h = edge ? 0.55 + rng() * 0.3 : 1;
      addIn(f, wallSeg, { ...mossyMarble, id: wallId, pos: [0, -0.4, 0.27], scale: [1, h, 1], hatch: 0.05 });
      if (!edge) addIn(f, coping, { color: P.marble, pos: [0, BANK_H, 0.3] });
      else addIn(f, geo.rock(30 + i, 0.6, 0, 0.3), { color: P.marble, pos: [(rng() - 0.5) * 2, 0.35, -0.7], scale: [1.1, 0.7, 0.9] });
      if (i % 3 === 1 || edge) clump([(rng() - 0.5) * 2.5, BANK_H * (edge ? 0.3 : 0.75), -0.05], [1.0 + rng() * 0.5, 1.1 + rng() * 0.6, 0.4], i % 2 ? P.leafDeep : P.moss, undefined, 3, 0.05, f);
      const c = inFrame(f, [0, 0, 3.0]);
      box(c.pos[0], c.pos[2], 2.5, 3.0, a);
      // Street trees along the top of the bank, the city's pavement above the lot.
      if (i % 4 === 2 && !edge && !low) tree(Math.sin(a) * (BANK_R + 1.6), Math.cos(a) * (BANK_R + 1.6), 6 + rng() * 1.5, i % 8 === 2 ? P.leaf : P.grassDeep, false, BANK_H);
    }
  }

  root.add(b.build('boneyard-static'));

  // ==========================================================================================
  // Seedlings everywhere, one instanced mesh: a stem and two bright leaves.
  // ==========================================================================================
  {
    const sb = kit.builder();
    sb.add(geo.cylinder(0.035, 0.045, 0.34, 5), { color: SPROUT_DEEP, pos: [0, 0, 0] });
    const leaf = geo.sphere(0.5, 6, 4);
    sb.add(leaf, { color: SPROUT, pos: [0.13, 0.36, 0], rot: [0, 0, 0.5], scale: [0.3, 0.08, 0.16], flat: 0.3 });
    sb.add(leaf, { color: SPROUT, pos: [-0.12, 0.4, 0.02], rot: [0, 0.3, -0.5], scale: [0.26, 0.08, 0.15], flat: 0.3 });
    const sg = sb.geometry ? sb.geometry() : geo.cone(0.1, 0.35, 5);
    const spots: V3[] = [];
    // On the ruins first: rib feet, the tops of fallen drums, the stump, the lintel.
    for (const f of ribFeet) spots.push([f[0] + (rng() - 0.5) * 1.6, 0.06, f[2] + 1.0]);
    spots.push([FX + 0.3, 0.9 + STUMP + 0.25, FZ - 0.2], [21.5, 5.85, 6.5], [-0.4, 1.05, 2.4], [0.5, 1.05, 1.6]);
    const want = low ? 30 : high ? 110 : 70;
    let guard = 0;
    while (spots.length < want && guard++ < 1000) {
      const a = rng() * Math.PI * 2;
      const d = 3 + Math.sqrt(rng()) * 24;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.abs(x) < 1.4 && z > 4) continue; // the way in
      if (Math.hypot(x - FX, z - FZ) < 1.8) continue;
      if (blocked(x, z)) continue;
      spots.push([x, ground(x, z) + 0.03, z]);
    }
    const inst = kit.instances(sg, spots.length, { sway: 0.5 });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const k = 0.65 + rng() * 0.6;
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      m.compose(v.set(...spots[i]), q, s.set(k, k, k));
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.name = 'boneyard-seedlings';
    root.add(inst);
  }

  // ==========================================================================================
  // The drums that fell up. Instanced so each can turn and bob on its own.
  // ==========================================================================================
  const DRUMS = low ? 4 : 6;
  const DRUM_H = 1.5;
  const GAP = 1.15;
  const BASE_Y = 0.9 + STUMP + 1.4;
  const drumBase = new Float32Array(DRUMS * 3); // y, tilt, phase
  let drums: THREE.InstancedMesh;
  let cap: THREE.Mesh;
  const CAP_Y = BASE_Y + DRUMS * (DRUM_H + GAP) + 0.4;
  {
    const db = kit.builder();
    db.add(fluted(FR, DRUM_H), { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [0, -DRUM_H / 2, 0] });
    db.add(geo.blobs(5, 3, 1, { squash: 0.35, detail: 0, size: [0.4, 0.7] }), { color: P.moss, pos: [0.3, DRUM_H / 2 - 0.05, 0.1], scale: [0.65, 0.3, 0.55], flat: 0.3 });
    db.add(geo.cylinder(0.035, 0.04, 0.4, 5), { color: SPROUT_DEEP, pos: [0.3, DRUM_H / 2 + 0.05, 0.1] });
    db.add(geo.sphere(0.5, 6, 4), { color: SPROUT, pos: [0.42, DRUM_H / 2 + 0.43, 0.1], rot: [0, 0, 0.5], scale: [0.3, 0.08, 0.16], flat: 0.3 });
    db.add(geo.sphere(0.5, 6, 4), { color: SPROUT, pos: [0.18, DRUM_H / 2 + 0.47, 0.12], rot: [0, 0.3, -0.5], scale: [0.26, 0.08, 0.15], flat: 0.3 });
    const dg = db.geometry ? db.geometry() : geo.prism(FLUTES, FR, FR, DRUM_H);
    drums = kit.instances(dg, DRUMS);
    drums.name = 'boneyard-drums';
    for (let i = 0; i < DRUMS; i++) {
      drumBase[i * 3] = BASE_Y + i * (DRUM_H + GAP) + DRUM_H / 2;
      drumBase[i * 3 + 1] = (rng() - 0.5) * 0.22;
      drumBase[i * 3 + 2] = rng() * 6.28;
    }
    root.add(drums);

    const cb = kit.builder();
    const cf = frame([0, 0, 0]);
    cb.add(geo.cylinder(FR * 1.25, FR * 0.95, 0.42, FLUTES), { color: P.marble, pos: [0, 0, 0] });
    cb.add(geo.bevelBox(FR * 2.9, 0.38, FR * 2.9, 0.05), { color: P.marble, pos: [0, 0.42, 0] });
    cb.add(geo.blobs(8, 4, 1, { squash: 0.4, detail: 0, size: [0.4, 0.7] }), { color: P.moss, pos: [0.5, 0.82, -0.3], scale: [0.9, 0.35, 0.8], flat: 0.3 });
    cb.add(geo.blobs(9, 3, 1, { squash: 0.8, detail: 0, size: [0.4, 0.7] }), { color: SPROUT, pos: [-0.7, 0.85, 0.5], scale: [0.45, 0.5, 0.4], sway: 0.3 });
    void cf;
    cap = cb.build('boneyard-capital');
    cap.position.set(FX, CAP_Y, FZ);
    root.add(cap);
  }
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const e4 = new THREE.Euler();
  const v4 = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const place = (t: number): void => {
    for (let i = 0; i < DRUMS; i++) {
      const ph = drumBase[i * 3 + 2];
      const tilt = drumBase[i * 3 + 1];
      e4.set(tilt + Math.sin(t * 0.3 + ph) * 0.04, t * (0.05 + i * 0.012) + ph, Math.cos(t * 0.27 + ph) * 0.05);
      q4.setFromEuler(e4);
      m4.compose(v4.set(FX, drumBase[i * 3] + Math.sin(t * 0.45 + ph) * 0.18, FZ), q4, one);
      drums.setMatrixAt(i, m4);
    }
    drums.instanceMatrix.needsUpdate = true;
    cap.position.y = CAP_Y + Math.sin(t * 0.4 + 1.3) * 0.25;
    cap.rotation.set(0.08, t * 0.03, -0.06);
  };
  place(0);
  drums.computeBoundingSphere();

  return {
    group,
    colliders,
    pois,
    update(_dt, t) {
      place(t);
    },
  };
}
