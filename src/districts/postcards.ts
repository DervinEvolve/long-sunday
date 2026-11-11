// Postcards. A pocket park at the end of the side road from the Trailhead.
// A round lawn with a ring of nine postcards standing on marble plinths, each three metres tall,
// each a flat poster of a place with its name lettered underneath. They face in, toward a campfire
// with log seats in the middle, so walking in through the gap in the ring you see the pictures.
// You come in under a small marble arch with the name on it, grown over with ivy.
// Behind the ring, through the gap between Cape Verde and Puerto Rico, a hot air balloon is moored on the
// lawn: step up to the basket and it opens the map. Postcards fly round the envelope like a flock
// of birds, which is the part that cannot be.
// A low hedge on either side, three street trees, one of them in a brick planter of flowers.
//
// The one road arrives from the west south west. Everything is laid out in a frame turned to face
// it: frame +z points down that road. The frame group is turned once; colliders and markers are
// turned by hand.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import { gates } from '../world/layout';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictModule, InkBuilder, Poi } from '../types';

type V3 = [number, number, number];
type P2 = [number, number];

const FALLBACK_SUN: V3 = [-0.52, 0.7, 0.5];
const TRUNK = '#7a5a86';
const WOOD = '#a8643f';
const WOOD_DEEP = '#7d4a3a';
const WICKER = '#c98a4e';
const SOIL = '#5b4152';
const NAVY = '#2a2f8a';
const PLUM = '#5b4152';

/** XYZ angles for a part turned by `rot` and then turned about the vertical by `yaw`. */
function yawed(rot: V3, yaw: number): V3 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ')));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

/** Points round an arc in picture space, from angle a0 to a1. */
function arcPts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The posters. Each one is drawn in picture space: u across (-0.95..0.95), v up (-1..1), in
// layers from the back. Plain shapes only, so the ink line has something clean to follow.
// ---------------------------------------------------------------------------------------------
interface Painter {
  poly(pts: P2[], color: ColorLike, layer: number): void;
  rect(u0: number, v0: number, u1: number, v1: number, color: ColorLike, layer: number): void;
  circ(u: number, v: number, r: number, color: ColorLike, layer: number): void;
}

interface Card {
  id: string;
  name: string;
  frame: ColorLike;
  draw(p: Painter): void;
}

const U = 0.95;
const V = 1.0;

const CARDS: Card[] = [
  {
    id: 'jamaica',
    name: 'JAMAICA',
    frame: '#3f8a57',
    draw(p) {
      p.rect(-U, -V, U, V, '#f3c531', 1);
      p.circ(0.35, 0.45, 0.32, '#ef7a1e', 2);
      p.poly([[-U, -0.2], [-0.45, 0.42], [-0.05, 0.05], [0.4, 0.3], [U, -0.1], [U, -0.45], [-U, -0.45]], '#1f6c7a', 3);
      p.poly([[-U, -0.45], [-0.3, 0.02], [0.2, -0.3], [U, -0.15], [U, -0.6], [-U, -0.6]], '#3f8a57', 4);
      p.rect(-U, -V, U, -0.6, '#3fa9a5', 5);
      p.rect(-0.7, -0.78, -0.1, -0.72, '#a6dcc8', 6);
      p.rect(0.15, -0.9, 0.65, -0.84, '#a6dcc8', 6);
    },
  },
  {
    id: 'el-salvador',
    name: 'EL SALVADOR',
    frame: '#3d6fd8',
    draw(p) {
      p.rect(-U, -V, U, V, '#f6b879', 1);
      p.circ(-0.05, 0.62, 0.17, '#f7f0e4', 2);
      p.circ(0.18, 0.78, 0.14, '#f7f0e4', 2);
      p.circ(-0.25, 0.82, 0.12, '#f7f0e4', 2);
      p.poly([[-U, -0.45], [-0.22, 0.38], [0.12, 0.38], [U, -0.45]], '#6f58c2', 3);
      p.poly([[-0.22, 0.38], [-0.12, 0.26], [0.0, 0.33], [0.12, 0.38]], '#d8412f', 4);
      p.rect(-U, -V, U, -0.45, '#3fa9a5', 5);
      p.poly(arcPts(-0.35, -0.75, 0.32, 0.18, 0, Math.PI, 8), '#f7f0e4', 6);
      p.poly(arcPts(0.4, -0.62, 0.25, 0.13, 0, Math.PI, 8), '#f7f0e4', 6);
    },
  },
  {
    id: 'cape-town',
    name: 'CAPE TOWN',
    frame: '#d8412f',
    draw(p) {
      p.rect(-U, -V, U, V, '#7fd8ea', 1);
      p.poly([[-U, -0.35], [-0.6, 0.25], [0.45, 0.25], [U, -0.2], [U, -0.35]], '#6f58c2', 2);
      p.poly([[-0.62, 0.22], [-0.58, 0.36], [0.4, 0.36], [0.47, 0.22]], '#f7f0e4', 3);
      p.rect(-U, -V, U, -0.35, '#1f6c7a', 4);
      // A paraglider over the mountain.
      const wing = arcPts(0.5, 0.48, 0.3, 0.14, 0.15, Math.PI - 0.15, 8);
      const under = arcPts(0.5, 0.48, 0.24, 0.07, Math.PI - 0.2, 0.2, 8);
      p.poly([...wing, ...under], '#d8412f', 5);
      p.circ(0.5, 0.22, 0.045, NAVY, 5);
      p.rect(-0.8, -0.82, 0.8, -0.76, '#7fd8ea', 6);
    },
  },
  {
    id: 'lisbon',
    name: 'LISBON',
    frame: '#3d6fd8',
    draw(p) {
      p.rect(-U, -V, U, V, '#f0a0b6', 1);
      p.poly([[-U, -0.5], [-U, 0.05], [-0.2, 0.35], [0.5, 0.1], [U, 0.2], [U, -0.5]], '#c9644e', 2);
      const houses: [number, number, number][] = [[-0.7, 0.0, 0.28], [-0.32, 0.18, 0.3], [0.1, 0.08, 0.28], [0.52, 0.0, 0.32]];
      for (const [u, v, w] of houses) {
        p.rect(u - w / 2, v - 0.42, u + w / 2, v, '#f7f0e4', 3);
        p.poly([[u - w / 2 - 0.04, v], [u, v + 0.18], [u + w / 2 + 0.04, v]], '#d8412f', 3);
        p.rect(u - 0.05, v - 0.3, u + 0.05, v - 0.14, '#3d6fd8', 4);
      }
      // A band of blue tiles along the bottom.
      p.rect(-U, -V, U, -0.5, '#f7f0e4', 5);
      for (let i = 0; i < 4; i++) {
        const u = -0.71 + i * 0.475;
        p.poly([[u, -0.55], [u + 0.2, -0.75], [u, -0.95], [u - 0.2, -0.75]], '#3d6fd8', 6);
      }
    },
  },
  {
    id: 'cape-verde',
    name: 'CAPE VERDE',
    frame: '#ef7a1e',
    draw(p) {
      p.rect(-U, -V, U, V, '#a6dcc8', 1);
      p.circ(-0.5, 0.55, 0.22, '#f3c531', 2);
      p.poly([[-0.75, -0.3], [-0.05, 0.42], [0.2, 0.42], [U, -0.3]], PLUM, 3);
      p.poly([[-0.48, -0.02], [-0.05, 0.42], [0.2, 0.42], [0.62, 0.0], [0.3, -0.08], [0.05, 0.05], [-0.2, -0.1]], '#3f8a57', 4);
      p.rect(-U, -V, U, -0.3, '#3d6fd8', 5);
      // A volleyball net on the beach.
      p.rect(-U, -V, U, -0.72, '#f8e2c2', 6);
      p.rect(-0.45, -0.72, -0.41, -0.32, NAVY, 7);
      p.rect(0.41, -0.72, 0.45, -0.32, NAVY, 7);
      p.rect(-0.43, -0.44, 0.43, -0.36, '#f7f0e4', 7);
      p.circ(0.6, -0.15, 0.09, '#f7f0e4', 7);
    },
  },
  {
    id: 'puerto-rico',
    name: 'PUERTO RICO',
    frame: '#3fa9a5',
    draw(p) {
      p.rect(-U, -V, U, V, '#f08a6c', 1);
      p.poly(arcPts(0.25, -0.2, 0.45, 0.45, 0, Math.PI, 12), '#f3c531', 2);
      p.rect(-U, -V, U, -0.2, '#3fa9a5', 3);
      p.rect(-0.1, -0.45, 0.6, -0.39, '#f3c531', 4);
      p.rect(0.05, -0.65, 0.45, -0.59, '#f3c531', 4);
      // A palm on a spit of sand.
      p.poly([[-U, -V], [-U, -0.55], [-0.3, -0.75], [0.1, -V]], '#f8e2c2', 5);
      p.poly([[-0.62, -0.68], [-0.55, -0.68], [-0.42, 0.42], [-0.5, 0.42]], WOOD_DEEP, 6);
      const top: P2 = [-0.46, 0.44];
      const fronds: P2[] = [[-0.9, 0.2], [-0.82, 0.62], [-0.3, 0.75], [0.0, 0.4], [-0.1, 0.12]];
      for (const [fu, fv] of fronds) {
        const du = fu - top[0];
        const dv = fv - top[1];
        const l = Math.hypot(du, dv);
        const nu = (-dv / l) * 0.06;
        const nv = (du / l) * 0.06;
        p.poly([top, [top[0] + du * 0.5 + nu, top[1] + dv * 0.5 + nv], [fu, fv], [top[0] + du * 0.5 - nu, top[1] + dv * 0.5 - nv]], '#3f8a57', 7);
      }
    },
  },
  {
    id: 'vienna',
    name: 'VIENNA',
    frame: '#c9a23f',
    draw(p) {
      p.rect(-U, -V, U, V, '#b7a2e6', 1);
      p.rect(-0.75, -0.55, 0.75, 0.05, '#f7f0e4', 2);
      p.poly(arcPts(0, 0.05, 0.42, 0.42, 0, Math.PI, 12), '#6fc0a8', 3);
      p.rect(-0.03, 0.47, 0.03, 0.68, '#c9a23f', 3);
      p.circ(0, 0.72, 0.06, '#c9a23f', 3);
      p.poly([[-0.85, 0.05], [0, 0.22], [0.85, 0.05]], '#f7f0e4', 4);
      for (let i = 0; i < 6; i++) p.rect(-0.62 + i * 0.25 - 0.035, -0.5, -0.62 + i * 0.25 + 0.035, -0.02, '#d6cde4', 4);
      p.rect(-U, -V, U, -0.55, '#6f58c2', 5);
      p.rect(-0.85, -0.68, 0.85, -0.6, '#f7f0e4', 6);
      // Two notes, for the music.
      p.circ(0.62, 0.55, 0.06, NAVY, 6);
      p.rect(0.66, 0.55, 0.69, 0.8, NAVY, 6);
      p.circ(-0.6, 0.45, 0.06, NAVY, 6);
      p.rect(-0.56, 0.45, -0.53, 0.7, NAVY, 6);
    },
  },
  {
    id: 'morocco',
    name: 'MOROCCO',
    frame: '#3fa9a5',
    draw(p) {
      p.rect(-U, -V, U, V, '#ef7a1e', 1);
      p.poly([[-U, -0.25], [-0.3, 0.05], [0.35, -0.2], [U, 0.0], [U, -V], [-U, -V]], '#f0c9a2', 2);
      p.poly([[-U, -0.7], [-0.4, -0.35], [0.25, -0.6], [U, -0.4], [U, -V], [-U, -V]], '#dfa57f', 3);
      // The little balloon in the picture, which is the big one on the lawn.
      p.poly(arcPts(0.1, 0.42, 0.2, 0.24, -0.6, Math.PI + 0.6, 12).concat([[0.1, 0.12]]), '#d8412f', 4);
      p.rect(0.06, 0.02, 0.14, 0.08, WOOD_DEEP, 4);
      // Seen through a horseshoe arch, cut as two halves so no hole is needed.
      const R = 0.62;
      const lpts: P2[] = [[-U, -V], [-0.58, -V], ...arcPts(0, 0.25, R, R, Math.PI + 0.35, Math.PI / 2, 8), [0, V], [-U, V]];
      const rpts: P2[] = [[0.58, -V], [U, -V], [U, V], [0, V], ...arcPts(0, 0.25, R, R, Math.PI / 2, -0.35, 8)];
      p.poly(lpts, '#3fa9a5', 5);
      p.poly(rpts, '#3fa9a5', 5);
    },
  },
  {
    id: 'tokyo',
    name: 'TOKYO',
    frame: '#d8412f',
    draw(p) {
      p.rect(-U, -V, U, V, '#f6ecd9', 1);
      p.circ(0.1, 0.4, 0.4, '#d8412f', 2);
      const towers: [number, number][] = [[-0.82, 0.05], [-0.62, 0.3], [-0.4, -0.05], [-0.18, 0.15], [0.42, 0.22], [0.62, -0.08], [0.8, 0.12]];
      for (const [u, v] of towers) p.rect(u - 0.1, -0.3, u + 0.1, v, NAVY, 3);
      p.rect(-U, -V, U, -0.3, '#7d74a8', 4);
      // The bowl, and the chopsticks.
      p.poly(arcPts(0, -0.45, 0.48, 0.38, Math.PI, Math.PI * 2, 12), '#d8412f', 5);
      p.rect(-0.5, -0.47, 0.5, -0.41, '#f3c531', 6);
      p.poly([[0.12, -0.3], [0.17, -0.3], [0.7, 0.2], [0.66, 0.23]], WOOD_DEEP, 6);
      p.poly([[0.22, -0.32], [0.27, -0.32], [0.84, 0.1], [0.8, 0.14]], WOOD_DEEP, 6);
      p.rect(-0.2, -0.32, -0.16, -0.06, '#f7f0e4', 6);
      p.rect(-0.04, -0.32, 0.0, -0.1, '#f7f0e4', 6);
    },
  },
];

export const district: DistrictModule = {
  id: 'postcards',
  build(ctx) {
    return buildPostcards(ctx);
  },
};

function buildPostcards(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, rng, entries } = ctx;
  const high = ctx.quality === 'high';
  const low = ctx.quality === 'low';
  const [RED, YELLOW, TEAL] = site.accents as [string, string, string];

  // The frame. +z looks down the road toward the Trailhead.
  const g0 = gates('postcards')[0] ?? { x: site.arrive.x, z: site.arrive.z };
  const TURN = Math.atan2(g0.x, g0.z);
  const C = Math.cos(TURN);
  const S = Math.sin(TURN);
  const wx = (x: number, z: number): number => x * C + z * S;
  const wz = (x: number, z: number): number => -x * S + z * C;
  const ground = (x: number, z: number): number => Math.max(0, ctx.groundAt(wx(x, z), wz(x, z)));
  const ws = ctx.sun ?? FALLBACK_SUN;
  const sun: V3 = [ws[0] * C - ws[2] * S, ws[1], ws[0] * S + ws[2] * C];
  const LAWN = P.grass as string;
  const lawnShade = mix(LAWN, P.shadow, 0.3);
  const paveShade = mix(mix(P.pave, RED, 0.12), P.shadow, 0.3);

  const group = new THREE.Group();
  group.name = 'postcards';
  const frame = new THREE.Group();
  frame.rotation.y = TURN;
  group.add(frame);

  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const circle = (x: number, z: number, r: number): void => {
    colliders.push({ kind: 'circle', x: wx(x, z), z: wz(x, z), r });
  };
  const box = (x: number, z: number, hw: number, hd: number, rot = 0): void => {
    colliders.push({ kind: 'box', x: wx(x, z), z: wz(x, z), hw, hd, rot: TURN + rot });
  };
  const has = (id: string): boolean => entries.some((e) => e.id === id);

  const b = kit.builder();
  const fit = (bb: InkBuilder, text: string, size: number, max: number): number => {
    const w = bb.measure ? bb.measure({ text, size }).width : text.length * size * 0.7;
    return w > max ? (size * max) / w : size;
  };
  // The top of the lawn: a centimetre over the paving and no more, so his shoes stay in sight on the grass.
  const TOP = 0.04;
  const cast = (gg: THREE.BufferGeometry, pos: V3, rot?: V3, scale?: number | V3, color: string = lawnShade, y = TOP): void => {
    b.shadow?.(gg, { color, sun, pos, rot, scale, y, lift: 0.01 });
  };

  // A clump of leaf: hedge tops, ivy, moss, flowers.
  let seed = 71;
  const clump = (pos: V3, scale: V3, tint: string, rot?: V3, count = 4, sway = 0.1, id?: number): void => {
    b.add(geo.blobs(seed++ % 9, count, 1, { squash: 0.8, detail: 0, size: [0.42, 0.7] }), {
      gradient: { bottom: mix(tint, P.shadow, 0.35), top: mix(tint, '#ffffff', 0.1) },
      color: tint,
      pos,
      rot,
      scale,
      sway,
      id,
    });
  };

  // ==========================================================================================
  // Ground: a round lawn a centimetre proud of the paving, a paved hearth in the middle,
  // stepping stones in from the arch and out to the balloon.
  // ==========================================================================================
  const LAWN_R = 15.5;
  const SEG = high ? 56 : 36;
  b.add(geo.cylinder(LAWN_R, LAWN_R, TOP, SEG), { color: LAWN, pos: [0, 0, 0], flat: 0.15 });
  b.add(geo.cylinder(LAWN_R + 0.18, LAWN_R + 0.18, 0.035, SEG), { color: P.marbleShade, pos: [0, 0, 0], flat: 0.3 });
  b.add(geo.cylinder(3.3, 3.3, 0.01, 24), { color: P.pave, pos: [0, TOP, 0], flat: 0.2 });
  const stone = geo.cylinder(0.42, 0.46, 0.01, 9);
  for (let i = 0; i < 7; i++) {
    const z = 4.2 + i * 1.55;
    b.add(stone, { color: i % 2 ? P.pave : P.marble, pos: [(i % 2 ? 0.28 : -0.28), TOP, z], rot: [0, i, 0], flat: 0.2 });
  }
  // The balloon sits out past the ring, through the gap between Cape Verde and Puerto Rico.
  const BA = (197.5 * Math.PI) / 180;
  const BR = 22;
  const bx = Math.sin(BA) * BR;
  const bz = Math.cos(BA) * BR;
  for (let i = 0; i < 8; i++) {
    const r = 4.3 + i * 1.6;
    const side = i % 2 ? 0.28 : -0.28;
    const x = Math.sin(BA) * r + Math.cos(BA) * side;
    const z = Math.cos(BA) * r - Math.sin(BA) * side;
    b.add(stone, { color: i % 2 ? P.pave : P.marble, pos: [x, TOP, z], rot: [0, i * 2, 0], flat: 0.2 });
  }
  // A paved landing round the basket.
  b.add(geo.cylinder(3.0, 3.0, 0.04, 20), { color: mix(P.pave, YELLOW, 0.12), pos: [bx, 0, bz], flat: 0.2 });

  // ==========================================================================================
  // The ring of postcards.
  // ==========================================================================================
  const RING = 12.8;
  const CW = 2.2; // card width
  const CH = 3.0; // card height
  const PL = 0.35; // plinth height
  const CD = 0.14; // card thickness
  const HEAD = 0.5; // the strip above the picture that carries the name
  const PY = PL + CH - 0.12 - V; // picture centre
  const LAYER = 0.011;
  const cardIds: string[] = [];
  for (let i = 0; i < CARDS.length; i++) {
    const card = CARDS[i];
    const phi = ((40 + i * 35) * Math.PI) / 180;
    const cx = Math.sin(phi) * RING;
    const cz = Math.cos(phi) * RING;
    const th = phi + Math.PI; // faces the fire
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const at = (x: number, y: number, z: number): V3 => [cx + x * cs + z * sn, y, cz - x * sn + z * cs];
    const rot: V3 = [0, th, 0];
    const back: V3 = [0, th + Math.PI, 0];

    // Plinth, with moss in a corner of some.
    const plinth = geo.bevelBox(CW + 0.45, PL, 0.85, 0.06);
    b.add(plinth, { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: at(0, 0.04, 0), rot });
    if (!low && i % 3 !== 1) clump(at((i % 2 ? 1 : -1) * (CW / 2 + 0.05), 0.3, 0.2), [0.42, 0.26, 0.35], P.moss as string, rot, 3, 0);

    // The card itself, cream like old card stock. It stands a strip taller than the picture needs:
    // the name goes up there, where he cannot stand in front of it while he reads.
    const bodyGeo = geo.bevelBox(CW, CH + HEAD, CD, 0.03);
    const body = b.add(bodyGeo, { color: P.bone, pos: at(0, PL, 0), rot, flat: 0.35 });
    cast(bodyGeo, at(0, PL, 0), rot, undefined, lawnShade, TOP);

    // The poster, layer on layer out from the face.
    const z0 = CD / 2 + 0.006;
    const painter: Painter = {
      poly(pts, color, layer) {
        const g = geo.extrude(pts, LAYER * 0.8);
        b.add(g, { color, pos: at(0, PY, z0 + layer * LAYER), rot, flat: 1 });
        g.dispose();
      },
      rect(u0, v0, u1, v1, color, layer) {
        b.add(geo.box(u1 - u0, v1 - v0, LAYER * 0.8), { color, pos: at((u0 + u1) / 2, PY + v0, z0 + layer * LAYER), rot, flat: 1 });
      },
      circ(u, v, r, color, layer) {
        b.add(geo.cylinder(r, r, LAYER * 0.8, high ? 16 : 12), {
          color,
          pos: at(u, PY + v, z0 + layer * LAYER - LAYER * 0.4),
          rot: yawed([Math.PI / 2, 0, 0], th),
          flat: 1,
        });
      },
    };
    painter.rect(-U - 0.05, -V - 0.05, U + 0.05, V + 0.05, card.frame, 0);
    card.draw(painter);
    const nameSize = fit(b, card.name, 0.27, CW - 0.35);
    b.label({ text: card.name, size: nameSize, pos: at(0, PL + CH + HEAD / 2 - 0.1, CD / 2), rot, ink: P.ink, plate: P.bone, id: body, flat: 0.35, pad: 0.12 });

    // The back: stamp, a line down the middle, address lines, POST CARD across the top.
    const bz0 = -CD / 2 - 0.006;
    b.add(geo.box(0.46, 0.56, 0.012), { color: card.frame, pos: at(-0.68, PL + CH - 0.82, bz0), rot: back, flat: 0.8 });
    b.add(geo.box(0.32, 0.42, 0.012), { color: RED, pos: at(-0.68, PL + CH - 0.75, bz0 - 0.008), rot: back, flat: 0.8 });
    b.add(geo.box(0.04, 1.7, 0.012), { color: mix(P.bone, P.shadow, 0.35), pos: at(0, PL + 0.45, bz0), rot: back, flat: 0.8 });
    for (let k = 0; k < 3; k++) {
      b.add(geo.box(0.78, 0.035, 0.012), { color: mix(P.bone, P.shadow, 0.35), pos: at(-0.52, PL + 0.75 + k * 0.42, bz0), rot: back, flat: 0.8 });
    }
    b.label({ text: 'POST CARD', size: 0.15, pos: at(0.38, PL + CH - 0.32, -CD / 2), rot: back, ink: P.violet, plate: P.bone, id: body, flat: 0.35, pad: 0.1 });
    b.label({ text: card.name, size: Math.min(0.15, nameSize * 0.6), pos: at(0.5, PL + 1.6, -CD / 2), rot: back, ink: NAVY, plate: P.bone, id: body, flat: 0.35, pad: 0.1, jitter: 0.9 });

    box(cx, cz, (CW + 0.45) / 2, 0.45, th);
    if (has(card.id)) {
      // The marker hangs clear above the card's top edge, so it never sits on the name.
      const r = RING - 2.2;
      pois.push({ entry: card.id, x: wx(Math.sin(phi) * r, Math.cos(phi) * r), z: wz(Math.sin(phi) * r, Math.cos(phi) * r), y: 4.4, reach: 3.6, prompt: 'Read the postcard' });
    }
    cardIds.push(card.id);
  }

  // ==========================================================================================
  // The campfire: a ring of stones, crossed logs, four log seats, a suitcase, a few cards on the
  // grass. The flame is its own small mesh.
  // ==========================================================================================
  {
    const ringN = high ? 9 : 7;
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2;
      b.add(geo.rock(i + 3, 0.24, 0, 0.3), { color: i % 2 ? P.marbleShade : P.marble, pos: [Math.cos(a) * 0.78, 0.15, Math.sin(a) * 0.78], hatch: 0.15 });
    }
    b.add(geo.cylinder(0.65, 0.65, 0.03, 12), { color: SOIL, pos: [0, 0.08, 0], flat: 0.4 });
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + 0.3;
      b.add(geo.cylinder(0.08, 0.08, 1.0, 6), { color: WOOD_DEEP, pos: [0, 0.18, 0], rot: yawed([0, 0, Math.PI / 2 - 0.25], a) });
    }
    const seats = [55, 125, 245, 305];
    for (const deg of seats) {
      const a = (deg * Math.PI) / 180;
      const x = Math.sin(a) * 2.5;
      const z = Math.cos(a) * 2.5;
      const logGeo = geo.cylinder(0.26, 0.26, 1.7, 9);
      const r = yawed([0, 0, Math.PI / 2], a);
      b.add(logGeo, { color: WOOD, pos: [x - Math.cos(a) * 0.85, 0.33, z + Math.sin(a) * 0.85], rot: r, hatch: 0.1 });
      // The log hangs from its seat point along the turn, so the box goes at the log centre.
      box(x - Math.cos(a) * 1.7, z + Math.sin(a) * 1.7, 0.85, 0.28, a);
    }
    // A suitcase leaning on the east seat, and a stack of cards on the west one.
    const sa = (125 * Math.PI) / 180;
    const sx = Math.sin(sa) * 3.25;
    const sz = Math.cos(sa) * 3.25;
    b.add(geo.bevelBox(0.7, 0.5, 0.24, 0.04), { color: TEAL, pos: [sx, 0.06, sz], rot: [0, sa, 0] });
    b.add(geo.box(0.72, 0.06, 0.26), { color: WOOD_DEEP, pos: [sx, 0.3, sz], rot: [0, sa, 0] });
    b.add(geo.torus(0.1, 0.025, 8, 4, Math.PI), { color: WOOD_DEEP, pos: [sx, 0.56, sz], rot: [0, sa, 0] });
    b.add(geo.box(0.18, 0.14, 0.01), { color: YELLOW, pos: [sx + Math.sin(sa) * 0.125, 0.18, sz + Math.cos(sa) * 0.125], rot: [0, sa, 0], flat: 0.8 });
    const wa = (305 * Math.PI) / 180;
    for (let k = 0; k < 4; k++) {
      b.add(geo.box(0.36, 0.025, 0.25), {
        color: [P.bone, P.pink, P.mint, P.sandLight][k],
        pos: [Math.sin(wa) * 2.5, 0.56 + k * 0.026, Math.cos(wa) * 2.5],
        rot: [0, k * 0.4, 0],
        flat: 0.6,
      });
    }
    // Cards blown onto the lawn.
    const strays = low ? 4 : 9;
    for (let k = 0; k < strays; k++) {
      const a = rng() * Math.PI * 2;
      const r = 4.5 + rng() * 5.5;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (Math.abs(x) < 1.2 && z > 3) continue;
      b.add(geo.box(0.34, 0.02, 0.24), { color: [P.bone, P.pink, P.mint, P.sandLight][k % 4], pos: [x, 0.05, z], rot: [0, rng() * 6.28, 0], flat: 0.6 });
    }
    circle(0, 0, 1.0);
    if (has('community')) pois.push({ entry: 'community', x: wx(1.3, 1.3), z: wz(1.3, 1.3), y: 2.2, reach: 3.6, prompt: 'Sit by the fire' });
  }

  // ==========================================================================================
  // The arch you come in under. Marble, ivy up the left pier and over the attic.
  // ==========================================================================================
  {
    const AZ = 14.6;
    const SPAN = 3.4;
    const RISE = 3.5;
    const THICK = 0.55;
    const DEPTH = 0.8;
    const archId = b.newId();
    const archGeo = geo.arch({ span: SPAN, rise: RISE, thick: THICK, depth: DEPTH });
    b.add(archGeo, { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [0, 0, AZ], id: archId });
    cast(archGeo, [0, 0, AZ], undefined, undefined, paveShade, 0.0);
    const top = RISE + THICK;
    for (const sx of [-1, 1]) {
      b.add(geo.bevelBox(THICK + 0.3, 0.45, DEPTH + 0.2, 0.05), { color: P.marbleShade, pos: [sx * (SPAN / 2 + THICK / 2), 0, AZ] });
      box(sx * (SPAN / 2 + THICK / 2), AZ, (THICK + 0.3) / 2, (DEPTH + 0.2) / 2);
    }
    const atticGeo = geo.bevelBox(SPAN + THICK * 2 + 0.3, 1.0, DEPTH + 0.1, 0.04);
    const attic = b.add(atticGeo, { color: P.marble, pos: [0, top, AZ] });
    b.add(geo.bevelBox(SPAN + THICK * 2 + 0.7, 0.2, DEPTH + 0.35, 0.04), { color: P.marbleShade, pos: [0, top + 1.0, AZ] });
    // A red and yellow stamp edge along the cornice.
    for (let k = 0; k < 7; k++) {
      b.add(geo.box(0.5, 0.14, 0.04), { color: k % 2 ? YELLOW : RED, pos: [-1.95 + k * 0.65, top + 1.2, AZ + (DEPTH + 0.35) / 2 - 0.1], flat: 0.6 });
    }
    const nameSize = fit(b, 'POSTCARDS', 0.5, SPAN + THICK * 2 - 0.2);
    b.label({ text: 'POSTCARDS', size: nameSize, pos: [0, top + 0.5, AZ + (DEPTH + 0.1) / 2], ink: P.ink, plate: P.marble, id: attic, pad: 0.12 });
    b.label({ text: 'WISH YOU WERE HERE', size: 0.24, pos: [0, top + 0.5, AZ - (DEPTH + 0.1) / 2], rot: [0, Math.PI, 0], ink: P.violet, plate: P.marble, id: attic, pad: 0.12 });
    // Ivy: up the left pier and spilling over the left of the attic.
    const ivy = b.newId();
    const IVY = P.grassDeep as string;
    clump([-(SPAN / 2 + THICK / 2) - 0.2, 0.7, AZ + 0.2], [0.55, 0.9, 0.6], IVY, undefined, 4, 0.05, ivy);
    clump([-(SPAN / 2 + THICK / 2) - 0.25, 2.1, AZ + 0.1], [0.45, 1.0, 0.55], IVY, undefined, 4, 0.05, ivy);
    clump([-(SPAN / 2 + THICK / 2) - 0.15, 3.5, AZ], [0.5, 0.8, 0.6], IVY, undefined, 4, 0.05, ivy);
    clump([-(SPAN / 2) - 0.4, top + 1.1, AZ], [1.1, 0.4, 0.65], P.moss as string, undefined, 5, 0.05, ivy);
    clump([(SPAN / 2) + 0.7, top + 1.15, AZ - 0.1], [0.6, 0.25, 0.5], P.moss as string, undefined, 3, 0.05);
  }

  // ==========================================================================================
  // Green: a low hedge either side of the ring, three street trees, one in a brick planter.
  // ==========================================================================================
  {
    const HEDGE = P.grassDeep as string;
    const hedgeR = 18.2;
    const step = high ? 7 : 9;
    for (const [from, to] of [[60, 122], [238, 300]] as const) {
      const id = b.newId();
      for (let d = from; d <= to; d += step) {
        const a = (d * Math.PI) / 180;
        const x = Math.sin(a) * hedgeR;
        const z = Math.cos(a) * hedgeR;
        b.add(geo.bevelBox(2.3, 0.85, 0.9, 0.18), {
          gradient: { bottom: mix(HEDGE, P.shadow, 0.3), top: mix(HEDGE, P.grass, 0.5) },
          color: HEDGE,
          pos: [x, 0, z],
          rot: [0, a, 0],
          id,
        });
        if (!low && (d / step) % 2 < 1) b.add(geo.sphere(0.1, 6, 4), { color: (d % 3 ? P.pink : YELLOW), pos: [x, 0.88, z], flat: 0.7 });
        // Three small rounds down its length stop him as well as one box would, and leave the camera
        // free to look over the top: the hedge is lower than his shoulders.
        for (const k of [-0.75, 0, 0.75]) circle(x + Math.cos(a) * k, z - Math.sin(a) * k, 0.45);
      }
    }

    const tree = (x: number, z: number, h: number, tint: string, pit: boolean): void => {
      const y = ground(x, z);
      const s = h / 7;
      const a = rng() * 6.28;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (pit) b.add(geo.cylinder(0.95, 0.95, 0.08, 8), { color: P.grassDeep, pos: [x, y, z], flat: 0.5 });
      b.add(geo.cylinder(0.2 * s, 0.32 * s, 3.9 * s, 6, true), { color: TRUNK, pos: [x, y, z], sway: 0.2, swayBase: y });
      const leaf = { gradient: { bottom: mix(tint, P.shadow, 0.38), top: mix(tint, '#ffffff', 0.12) }, color: tint, sway: 0.5, swayBase: y };
      const id = b.newId();
      const ball = geo.sphere(1, high ? 8 : 6, high ? 5 : 4);
      b.add(ball, { ...leaf, id, pos: [x, y + 4.9 * s, z], scale: [2.5 * s, 2.0 * s, 2.4 * s] });
      b.add(ball, { ...leaf, id, pos: [x - 1.6 * s * ca, y + 4.6 * s, z - 1.6 * s * sa], scale: [1.5 * s, 1.25 * s, 1.45 * s] });
      b.add(ball, { ...leaf, pos: [x + 1.6 * s * ca + 0.6 * sa, y + 4.0 * s, z + 1.6 * s * sa], scale: [1.7 * s, 1.35 * s, 1.6 * s] });
      if (y === 0) cast(ball, [x, 4.9 * s, z], undefined, [2.5 * s, 2.0 * s, 2.4 * s], mix(mix(P.pave, RED, 0.12), P.shadow, 0.3), 0);
      circle(x, z, 0.34 * s);
    };
    const pol = (deg: number, r: number): [number, number] => [Math.sin((deg * Math.PI) / 180) * r, Math.cos((deg * Math.PI) / 180) * r];
    const [t1x, t1z] = pol(92, 22);
    const [t2x, t2z] = pol(268, 22);
    const [t3x, t3z] = pol(52, 22.5);
    tree(t1x, t1z, 8.5, P.grass as string, true);
    tree(t2x, t2z, 7.8, P.leafDeep as string, true);
    // The brick planter, full of flowers, with the third tree in it.
    {
      const W = 3.4;
      const H = 0.6;
      const T = 0.32;
      const id = b.newId();
      const a = (52 * Math.PI) / 180;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const at = (x: number, z: number): V3 => [t3x + x * cs + z * sn, 0, t3z - x * sn + z * cs];
      const r: V3 = [0, a, 0];
      b.add(geo.box(W, H, T), { color: P.brick, pos: at(0, W / 2 - T / 2), rot: r, id, hatch: 0.1 });
      b.add(geo.box(W, H, T), { color: P.brick, pos: at(0, -W / 2 + T / 2), rot: r, id, hatch: 0.1 });
      b.add(geo.box(T, H, W - 2 * T), { color: P.brick, pos: at(W / 2 - T / 2, 0), rot: r, id, hatch: 0.1 });
      b.add(geo.box(T, H, W - 2 * T), { color: P.brick, pos: at(-W / 2 + T / 2, 0), rot: r, id, hatch: 0.1 });
      const cap = b.newId();
      b.add(geo.box(W + 0.1, 0.08, T + 0.1), { color: P.marble, pos: [at(0, W / 2 - T / 2)[0], H, at(0, W / 2 - T / 2)[2]], rot: r, id: cap });
      b.add(geo.box(W + 0.1, 0.08, T + 0.1), { color: P.marble, pos: [at(0, -W / 2 + T / 2)[0], H, at(0, -W / 2 + T / 2)[2]], rot: r, id: cap });
      b.add(geo.box(T + 0.1, 0.08, W - 2 * T), { color: P.marble, pos: [at(W / 2 - T / 2, 0)[0], H, at(W / 2 - T / 2, 0)[2]], rot: r, id: cap });
      b.add(geo.box(T + 0.1, 0.08, W - 2 * T), { color: P.marble, pos: [at(-W / 2 + T / 2, 0)[0], H, at(-W / 2 + T / 2, 0)[2]], rot: r, id: cap });
      b.add(geo.box(W - 2 * T, H - 0.06, W - 2 * T), { color: SOIL, pos: at(0, 0), rot: r });
      const flowers = low ? 8 : 16;
      const cols = [RED, YELLOW, P.pink as string, P.bone as string];
      for (let k = 0; k < flowers; k++) {
        const fx = (rng() - 0.5) * (W - 1.0);
        const fz = (rng() - 0.5) * (W - 1.0);
        if (Math.hypot(fx, fz) < 0.5) continue;
        const p = at(fx, fz);
        b.add(geo.blobs(k % 5, 3, 0.22, { detail: 0 }), { color: P.leafDeep, pos: [p[0], H - 0.02, p[2]], sway: 0.1 });
        b.add(geo.sphere(0.11, 6, 4), { color: cols[k % cols.length], pos: [p[0], H + 0.2, p[2]], flat: 0.6, sway: 0.1, swayBase: H - 0.06 });
      }
      tree(t3x, t3z, 7.0, P.grassLight as string, false);
      box(t3x, t3z, W / 2, W / 2, a);
    }
    if (high) {
      const [t4x, t4z] = pol(308, 22.5);
      tree(t4x, t4z, 6.5, P.grass as string, true);
    }
  }

  // ==========================================================================================
  // Two curved colonnades either side of the balloon, the kind that turn up in the middle of a
  // block here: fluted shafts, a plain lintel, ivy taking the end columns. And four lamps.
  // ==========================================================================================
  {
    const CR = 21;
    const COLH = 4.4;
    const shaft = geo.prism(12, 0.3, 0.36, COLH);
    const base = geo.bevelBox(0.95, 0.32, 0.95, 0.05);
    const capG = geo.cylinder(0.52, 0.34, 0.26, 12);
    const abacus = geo.bevelBox(0.9, 0.18, 0.9, 0.03);
    for (const [from, to] of [[138, 176], [219, 257]] as const) {
      const n = 5;
      const lid = b.newId();
      let px = 0;
      let pz = 0;
      for (let k = 0; k < n; k++) {
        const d = from + ((to - from) * k) / (n - 1);
        const a = (d * Math.PI) / 180;
        const x = Math.sin(a) * CR;
        const z = Math.cos(a) * CR;
        b.add(base, { color: P.marbleShade, pos: [x, 0, z], rot: [0, a, 0] });
        b.add(shaft, { gradient: { bottom: P.marbleShade, top: P.marble }, color: P.marble, pos: [x, 0.32, z] });
        cast(shaft, [x, 0.32, z], undefined, undefined, paveShade, 0);
        b.add(capG, { color: P.marble, pos: [x, 0.32 + COLH, z] });
        b.add(abacus, { color: P.marble, pos: [x, 0.58 + COLH, z], rot: [0, a, 0] });
        circle(x, z, 0.5);
        if (k > 0) {
          const mx = (x + px) / 2;
          const mz = (z + pz) / 2;
          const len = Math.hypot(x - px, z - pz) + 0.9;
          const ta = Math.atan2(-(z - pz), x - px);
          b.add(geo.box(len, 0.62, 0.8), { color: P.marble, pos: [mx, 0.76 + COLH, mz], rot: [0, ta, 0], id: lid });
          b.add(geo.box(len + 0.05, 0.16, 0.95), { color: P.marbleShade, pos: [mx, 1.38 + COLH, mz], rot: [0, ta, 0], id: lid });
        }
        px = x;
        pz = z;
      }
      // Ivy up the outer end column and along the lintel.
      const end = ((from === 138 ? from : to) * Math.PI) / 180;
      const ex = Math.sin(end) * CR;
      const ez = Math.cos(end) * CR;
      const ivy = b.newId();
      clump([ex, 1.0, ez], [0.6, 1.1, 0.6], P.grassDeep as string, undefined, 4, 0.05, ivy);
      clump([ex, 2.6, ez], [0.5, 1.1, 0.5], P.grassDeep as string, undefined, 4, 0.05, ivy);
      clump([ex, 4.2, ez], [0.6, 0.9, 0.6], P.grassDeep as string, undefined, 4, 0.05, ivy);
      const mid = (((from + to) / 2 + (from === 138 ? -6 : 6)) * Math.PI) / 180;
      clump([Math.sin(mid) * CR, 6.0, Math.cos(mid) * CR], [2.2, 0.45, 0.8], P.moss as string, [0, mid, 0], 5, 0.05);
    }
    // Lamps round the lawn.
    for (const d of [24, 336, 150, 210, 95, 265]) {
      if (low && (d === 95 || d === 265)) continue;
      const a = (d * Math.PI) / 180;
      const x = Math.sin(a) * (LAWN_R + 0.9);
      const z = Math.cos(a) * (LAWN_R + 0.9);
      b.add(geo.cylinder(0.2, 0.26, 0.3, 8), { color: NAVY, pos: [x, 0, z] });
      b.add(geo.cylinder(0.07, 0.09, 3.7, 6), { color: NAVY, pos: [x, 0.3, z] });
      b.add(geo.cylinder(0.2, 0.12, 0.14, 8), { color: NAVY, pos: [x, 3.95, z] });
      b.add(geo.sphere(0.3, 10, 7), { color: '#fbe6b0', pos: [x, 4.32, z], flat: 0.9 });
      b.add(geo.cone(0.12, 0.2, 6), { color: NAVY, pos: [x, 4.58, z] });
    }
  }

  // ==========================================================================================
  // The balloon, moored on its landing. Basket, mooring lines and stakes are static; the
  // envelope with its load lines is one mesh that leans a little in the wind.
  // ==========================================================================================
  const BASKET = 1.15;
  const MOUTH = 7.4;
  const K = 1.4;
  {
    // Basket.
    const bas = geo.bevelBox(1.5, BASKET, 1.5, 0.08);
    const basket = b.add(bas, { color: WICKER, pos: [bx, 0.04, bz], rot: [0, BA, 0], hatch: 0.15 });
    cast(bas, [bx, 0.04, bz], [0, BA, 0], undefined, mix(mix(P.pave, YELLOW, 0.12), P.shadow, 0.3), 0.04);
    b.add(geo.bevelBox(1.62, 0.16, 1.62, 0.05), { color: WOOD_DEEP, pos: [bx, BASKET - 0.04, bz], rot: [0, BA, 0] });
    b.add(geo.bevelBox(1.56, 0.12, 1.56, 0.04), { color: WOOD_DEEP, pos: [bx, 0.38, bz], rot: [0, BA, 0] });
    // The side that faces the ring, lettered.
    const fx = Math.sin(BA + Math.PI);
    const fz = Math.cos(BA + Math.PI);
    b.label({ text: 'ANYWHERE', size: 0.2, pos: [bx + fx * 0.75, 0.78, bz + fz * 0.75], rot: [0, BA + Math.PI, 0], ink: P.ink, plate: WICKER, id: basket, pad: 0.12 });
    // A step to climb in by.
    b.add(geo.bevelBox(0.9, 0.36, 0.5, 0.04), { color: WOOD, pos: [bx + fx * 1.15, 0.04, bz + fz * 1.15], rot: [0, BA, 0] });
    // Sand bags on the outer side.
    for (const s of [-0.4, 0.4]) {
      const ox = Math.sin(BA) * 0.8 + Math.cos(BA) * s;
      const oz = Math.cos(BA) * 0.8 - Math.sin(BA) * s;
      b.add(geo.sphere(0.2, 8, 6), { color: P.sandDeep, pos: [bx + ox, 0.55, bz + oz], scale: [1, 1.3, 1], hatch: 0.1 });
    }
    // Four mooring lines out to stakes.
    for (let k = 0; k < 4; k++) {
      const a = BA + Math.PI / 4 + (k * Math.PI) / 2;
      const ax = Math.sin(a);
      const az = Math.cos(a);
      const sxp = bx + ax * 3.4;
      const szp = bz + az * 3.4;
      b.add(geo.tube([[bx + ax * 0.95, BASKET - 0.1, bz + az * 0.95], [sxp, 0.25, szp]], 0.035, { sag: 0.15, perSpan: 4, radial: 4 }), { color: WOOD_DEEP });
      b.add(geo.cylinder(0.07, 0.05, 0.4, 6), { color: P.steel, pos: [sxp, 0, szp] });
    }
    circle(bx, bz, 1.15);
    pois.push({ entry: '', action: 'map', x: wx(bx + fx * 2.1, bz + fz * 2.1), z: wz(bx + fx * 2.1, bz + fz * 2.1), y: 3.4, reach: 3.4, prompt: 'Step into the balloon' });
  }

  const statics = b.build('postcards-static');
  frame.add(statics);

  // The envelope: ten gores of red and yellow, a teal band, a crown, and the load lines.
  const eb = kit.builder();
  {
    const prof: [number, number][] = [
      [0.55, 0], [1.4, 0.9], [2.9, 2.5], [4.3, 4.5], [5.05, 6.4], [5.2, 7.9], [4.85, 9.3], [3.9, 10.5], [2.4, 11.35], [0.9, 11.75], [0.05, 11.85],
    ];
    const pts = prof.map(([r, y]) => new THREE.Vector2(r * K, y * K));
    const GORES = 10;
    const per = high ? 3 : 2;
    for (let k = 0; k < GORES; k++) {
      const g = new THREE.LatheGeometry(pts, per, (k * Math.PI * 2) / GORES, (Math.PI * 2) / GORES);
      eb.add(g, { color: k % 2 ? YELLOW : RED, pos: [0, MOUTH - BASKET, 0], flat: 0.15 });
      g.dispose();
    }
    eb.add(geo.torus(5.08 * K, 0.18, high ? 40 : 28, 4), { color: TEAL, pos: [0, MOUTH - BASKET + 6.4 * K, 0], rot: [Math.PI / 2, 0, 0], flat: 0.3 });
    eb.add(geo.torus(4.3 * K, 0.15, high ? 36 : 24, 4), { color: TEAL, pos: [0, MOUTH - BASKET + 4.5 * K, 0], rot: [Math.PI / 2, 0, 0], flat: 0.3 });
    eb.add(geo.dome(0.95 * K, 12, 3), { color: TEAL, pos: [0, MOUTH - BASKET + 11.62 * K, 0], flat: 0.3 });
    // Mouth skirt and burner.
    eb.add(geo.cylinder(0.62 * K, 0.56 * K, 0.35, 10, true), { color: WOOD_DEEP, pos: [0, MOUTH - BASKET - 0.3, 0] });
    eb.add(geo.cylinder(0.22, 0.26, 0.4, 8), { color: P.steel, pos: [0, 1.15, 0] });
    eb.add(geo.cone(0.16, 0.5, 6), { color: P.orange, pos: [0, 1.55, 0], flat: 1 });
    for (let k = 0; k < 4; k++) {
      const a = BA + Math.PI / 4 + (k * Math.PI) / 2;
      const ax = Math.sin(a);
      const az = Math.cos(a);
      eb.add(geo.tube([[ax * 0.7, 0, az * 0.7], [ax * 0.25, 1.2, az * 0.25], [ax * 0.56 * K, MOUTH - BASKET - 0.3, az * 0.56 * K]], 0.035, { perSpan: 2, radial: 4 }), { color: WOOD_DEEP });
    }
  }
  const balloon = eb.build('postcards-balloon');
  balloon.position.set(bx, BASKET + 0.04, bz);
  frame.add(balloon);

  // The flame.
  const fb = kit.builder();
  {
    const fid = fb.newId();
    // Tongues of flame leaning out from the middle, a yellow heart in front.
    const tongues: [number, number, number, number, number][] = [
      [0, 0, 0.3, 1.15, 0],
      [0.2, 0.08, 0.2, 0.8, -0.25],
      [-0.2, -0.05, 0.22, 0.9, 0.25],
      [0.02, -0.2, 0.18, 0.7, 0.2],
    ];
    for (const [x, z, r, h, lean] of tongues) {
      fb.add(geo.cone(r, h, 6), { color: P.orange, pos: [x, 0, z], rot: [lean * 0.6, 0, lean], flat: 1, id: fid });
    }
    fb.add(geo.cone(0.17, 0.65, 6), { color: YELLOW, pos: [0.04, 0, 0.16], flat: 1 });
    fb.add(geo.cone(0.12, 0.45, 5), { color: RED, pos: [-0.22, 0, 0.12], rot: [0, 0, 0.3], flat: 1 });
  }
  const flame = fb.build('postcards-flame');
  flame.position.set(0, 0.12, 0);
  frame.add(flame);

  // The flock: postcards flying round the envelope like birds.
  const FLOCK = low ? 10 : high ? 22 : 16;
  const cb = kit.builder();
  cb.add(geo.bevelBox(1.0, 0.68, 0.05, 0.015), { color: '#ffffff', pos: [0, -0.34, 0], flat: 0.4 });
  cb.add(geo.box(0.22, 0.27, 0.02), { color: RED, pos: [0.3, -0.04, 0.025], flat: 0.7 });
  cb.add(geo.box(0.22, 0.27, 0.02), { color: RED, pos: [-0.3, -0.04, -0.045], flat: 0.7 });
  const cardGeo = cb.geometry ? cb.geometry() : geo.box(0.62, 0.42, 0.04);
  const flock = kit.instances(cardGeo, FLOCK);
  flock.name = 'postcards-flock';
  const tints = [P.bone, P.pink, P.mint, P.sandLight, P.cyan, '#ffffff'];
  const fR = new Float32Array(FLOCK);
  const fA = new Float32Array(FLOCK);
  const fY = new Float32Array(FLOCK);
  const fW = new Float32Array(FLOCK);
  const tint = new THREE.Color();
  for (let i = 0; i < FLOCK; i++) {
    fR[i] = 8.6 + rng() * 2.8;
    fA[i] = (i / FLOCK) * Math.PI * 2 + rng() * 0.4;
    fY[i] = 9 + rng() * 13;
    fW[i] = 0.14 + rng() * 0.08;
    tint.set(tints[i % tints.length]);
    flock.setColorAt(i, tint);
  }
  if (flock.instanceColor) flock.instanceColor.needsUpdate = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p3 = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const placeFlock = (t: number): void => {
    for (let i = 0; i < FLOCK; i++) {
      const a = fA[i] + t * fW[i];
      const r = fR[i];
      p3.set(bx + Math.cos(a) * r, fY[i] + Math.sin(t * 0.5 + i * 1.7) * 0.6, bz - Math.sin(a) * r);
      // Fly along the circle, banked into the turn, flapping a little.
      e.set(Math.sin(t * 1.3 + i) * 0.25, a, 0.35 + Math.sin(t * 0.9 + i * 2.1) * 0.15);
      q.setFromEuler(e);
      m4.compose(p3, q, one);
      flock.setMatrixAt(i, m4);
    }
    flock.instanceMatrix.needsUpdate = true;
  };
  placeFlock(0);
  flock.computeBoundingSphere();
  frame.add(flock);

  return {
    group,
    colliders,
    pois,
    update(_dt, t) {
      flame.scale.set(1 + Math.sin(t * 9.1) * 0.06, 1 + Math.sin(t * 7.3) * 0.16 + Math.sin(t * 12.7) * 0.06, 1 + Math.sin(t * 8.2) * 0.06);
      flame.rotation.y = t * 0.8;
      balloon.rotation.z = Math.sin(t * 0.37) * 0.014;
      balloon.rotation.x = Math.sin(t * 0.29 + 1.0) * 0.012;
      placeFlock(t);
    },
  };
}
