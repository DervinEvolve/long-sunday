// What stands on a pad until its district file is written: a marble gate with the name cut into
// it, one tall shape in the district's colours so it can be told apart from across the mesa, and
// a stone for every entry so the captions can already be read. Two draw calls.
import * as THREE from 'three';
import * as geo from '../engine/geo';
import { hashString } from '../engine/util';
import type { Collider, ColorLike, DistrictBuild, DistrictContext, DistrictId, DistrictModule, LabelSize, Poi } from '../types';

const FALLBACK_SUN: [number, number, number] = [-0.52, 0.7, 0.5];

const mix = (a: ColorLike, b: ColorLike, k: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

export function placeholder(id: DistrictId): DistrictModule {
  return { id, build: (ctx) => buildPlaceholder(ctx) };
}

function buildPlaceholder(ctx: DistrictContext): DistrictBuild {
  const { site, kit, palette: P, entries } = ctx;
  const R = site.radius;
  const [c0, c1, c2] = site.accents;
  const sun = ctx.sun ?? FALLBACK_SUN;
  // The pad is cream with a little of the first accent in it (terrain.ts does the same mix).
  const shade = mix(mix('#fbe9cf', c0, 0.13), P.shadow, 0.3);

  const group = new THREE.Group();
  group.name = `placeholder-${site.id}`;
  const colliders: Collider[] = [];
  const pois: Poi[] = [];
  const b = kit.builder();
  const measure = (text: string, size: number, maxWidth?: number): LabelSize =>
    b.measure ? b.measure({ text, size, maxWidth }) : { width: text.length * size * 0.7, height: size, lines: 1 };

  // The way in. Everything is laid out along the line from the arrival point to the centre.
  const al = Math.hypot(site.arrive.x, site.arrive.z) || 1;
  const gx = site.arrive.x / al;
  const gz = site.arrive.z / al;

  // ------------------------------------------------------------------------------------------
  // The gate: two fluted columns, a lintel with the name on both faces, a low pediment.
  // ------------------------------------------------------------------------------------------
  const ax = gx * R * 0.22;
  const az = gz * R * 0.22;
  const turn = Math.atan2(gx, gz); // the gate's front looks back down the road
  const cs = Math.cos(turn);
  const sn = Math.sin(turn);
  const at = (x: number, y: number, z: number): [number, number, number] => [ax + x * cs + z * sn, y, az - x * sn + z * cs];
  const rot: [number, number, number] = [0, turn, 0];
  const back: [number, number, number] = [0, turn + Math.PI, 0];

  const HALF = 3.1; // column centres either side of the road
  const SHAFT = 4.7;
  for (const side of [-1, 1]) {
    const x = side * HALF;
    b.add(geo.bevelBox(1.5, 0.5, 1.5, 0.07), { color: P.marbleShade, pos: at(x, 0, 0), rot });
    b.add(geo.cylinder(0.56, 0.56, 0.16, 12), { color: c1, pos: at(x, 0.5, 0), rot, flat: 0.4 });
    const shaft = geo.prism(12, 0.4, 0.5, SHAFT);
    b.add(shaft, { color: P.marble, pos: at(x, 0.66, 0), rot });
    b.shadow?.(shaft, { color: shade, sun, pos: at(x, 0.66, 0), rot });
    b.add(geo.cylinder(0.58, 0.44, 0.24, 12), { color: P.marbleShade, pos: at(x, 0.66 + SHAFT, 0), rot });
    b.add(geo.bevelBox(1.4, 0.3, 1.4, 0.05), { color: P.marble, pos: at(x, 0.9 + SHAFT, 0), rot });
    const p = at(x, 0, 0);
    colliders.push({ kind: 'circle', x: p[0], z: p[2], r: 0.85 });
  }
  const lintelY = 1.2 + SHAFT;
  const LINTEL_H = 1.35;
  const LINTEL_D = 1.25;
  const lintelGeo = geo.bevelBox(8.5, LINTEL_H, LINTEL_D, 0.05);
  const lintel = b.add(lintelGeo, { color: P.marble, pos: at(0, lintelY, 0), rot });
  b.shadow?.(lintelGeo, { color: shade, sun, pos: at(0, lintelY, 0), rot });
  b.add(geo.bevelBox(9.0, 0.24, 1.6, 0.05), { color: P.marbleShade, pos: at(0, lintelY + LINTEL_H, 0), rot });
  b.add(geo.extrude([[-4.5, 0], [4.5, 0], [0, 1.5]], 1.3, { cacheKey: 'placeholder-pediment' }), {
    color: P.marble,
    pos: at(0, lintelY + LINTEL_H + 0.24, 0),
    rot,
  });
  // A boss in the pediment, pushed through so it shows on both faces.
  b.add(geo.sphere(0.42, 10, 6), { color: c1, pos: at(0, lintelY + LINTEL_H + 0.8, 0), rot, scale: [1, 1, 1.75], flat: 0.5 });

  const name = site.name.toUpperCase();
  let size = 0.58;
  const wide = measure(name, size).width;
  if (wide > 7.5) size *= 7.5 / wide;
  const nameY = lintelY + LINTEL_H * 0.62;
  const yearsY = lintelY + LINTEL_H * 0.2;
  const face = LINTEL_D / 2;
  for (const [z, r] of [[face, rot], [-face, back]] as const) {
    b.label({ text: name, size, pos: at(0, nameY, z), rot: r, ink: P.ink, plate: P.marble, id: lintel, pad: 0.15 });
    b.label({ text: site.years, size: 0.17, pos: at(0, yearsY, z), rot: r, ink: P.violet, plate: P.marble, id: lintel, pad: 0.15 });
  }

  // ------------------------------------------------------------------------------------------
  // The landmark: tall, plain, in the three accents. Which of three shapes depends on the name.
  // ------------------------------------------------------------------------------------------
  const lx = -gx * R * 0.68;
  const lz = -gz * R * 0.68;
  const kind = hashString(site.id) % 3;
  let top = 0;
  b.add(geo.cylinder(3.0, 3.3, 0.5, 14), { color: P.marbleShade, pos: [lx, 0, lz] });
  b.add(geo.cylinder(2.5, 2.7, 0.4, 14), { color: P.marble, pos: [lx, 0.5, lz] });
  if (kind === 0) {
    // An obelisk.
    const body = geo.prism(4, 0.85, 1.7, 15);
    b.add(body, { gradient: { bottom: c1, top: c0 }, color: c0, pos: [lx, 0.9, lz], rot: [0, turn + Math.PI / 4, 0] });
    b.shadow?.(body, { color: shade, sun, pos: [lx, 0.9, lz], rot: [0, turn + Math.PI / 4, 0] });
    b.add(geo.prism(4, 0.02, 0.9, 1.7), { color: c2, pos: [lx, 15.9, lz], rot: [0, turn + Math.PI / 4, 0], flat: 0.4 });
    top = 17.6;
  } else if (kind === 1) {
    // Drums, each smaller than the one under it.
    let y = 0.9;
    let r = 2.1;
    const colors = [c0, c1, c2, c0, c1];
    for (let i = 0; i < 5; i++) {
      const h = 3.4 - i * 0.3;
      const drum = geo.prism(10, r * 0.86, r, h);
      b.add(drum, { color: colors[i], pos: [lx, y, lz], rot: [0, i * 0.31, 0] });
      if (i === 0) b.shadow?.(drum, { color: shade, sun, pos: [lx, y, lz], scale: [1, 4.2, 1] });
      b.add(geo.cylinder(r * 0.94, r * 0.94, 0.16, 12), { color: P.marble, pos: [lx, y + h, lz] });
      y += h + 0.16;
      r *= 0.78;
    }
    b.add(geo.dome(r * 1.1, 10, 4), { color: c2, pos: [lx, y, lz], flat: 0.3 });
    top = y + r * 1.1;
  } else {
    // A spire on a round keep.
    const keep = geo.cylinder(1.9, 2.2, 5.5, 14);
    b.add(keep, { gradient: { bottom: mix(c0, P.shadow, 0.25), top: c0 }, color: c0, pos: [lx, 0.9, lz] });
    b.add(geo.torus(2.0, 0.22, 14, 5), { color: c2, pos: [lx, 6.4, lz], rot: [Math.PI / 2, 0, 0] });
    const spire = geo.cone(1.75, 11.5, 12);
    b.add(spire, { gradient: { bottom: c1, top: mix(c1, '#ffffff', 0.25) }, color: c1, pos: [lx, 6.5, lz] });
    b.shadow?.(spire, { color: shade, sun, pos: [lx, 6.5, lz] });
    top = 18;
  }
  colliders.push({ kind: 'circle', x: lx, z: lz, r: 3.3 });

  // ------------------------------------------------------------------------------------------
  // One stone per entry, on an arc behind the landmark, each facing the centre.
  // ------------------------------------------------------------------------------------------
  const n = entries.length;
  const ring = R * 0.46;
  const mid = Math.atan2(-gz, -gx);
  const stepA = n > 1 ? Math.min(0.6, 3.5 / (n - 1)) : 0;
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    const a = mid + (i - (n - 1) / 2) * stepA;
    const x = Math.cos(a) * ring;
    const z = Math.sin(a) * ring;
    const y = ctx.groundAt(x, z);
    const ry = Math.atan2(-Math.cos(a), -Math.sin(a));
    const r: [number, number, number] = [0, ry, 0];
    let ts = 0.15;
    let m = measure(e.title, ts, 1.5);
    if (m.height > 1.05) {
      ts *= 1.05 / m.height;
      m = measure(e.title, ts, 1.5);
    }
    const h = Math.max(1.15, m.height + 0.55);
    b.add(geo.bevelBox(2.1, 0.24, 0.8, 0.05), { color: P.marbleShade, pos: [x, y, z], rot: r });
    const slabGeo = geo.bevelBox(1.8, h, 0.42, 0.06);
    const slab = b.add(slabGeo, { color: P.marble, pos: [x, y + 0.24, z], rot: r });
    b.shadow?.(slabGeo, { color: shade, sun, pos: [x, 0.24, z], rot: r, y: 0 });
    b.add(geo.bevelBox(1.9, 0.14, 0.52, 0.04), { color: site.accents[i % 3], pos: [x, y + 0.24 + h, z], rot: r, flat: 0.4 });
    b.label({
      text: e.title,
      size: ts,
      maxWidth: 1.5,
      align: 'center',
      pos: [x + Math.sin(ry) * 0.21, y + 0.24 + h / 2, z + Math.cos(ry) * 0.21],
      rot: r,
      ink: P.ink,
      plate: P.marble,
      id: slab,
      pad: 0.2,
    });
    colliders.push({ kind: 'box', x, z, hw: 1.05, hd: 0.42, rot: ry });
    pois.push({ entry: e.id, x, z, y: h + 1.35, reach: 4.5, prompt: 'Read the stone' });
  }

  group.add(b.build(`placeholder-${site.id}-static`));

  // The one thing that moves: a ring and a ball turning slowly over the landmark.
  const fb = kit.builder();
  fb.add(geo.torus(1.5, 0.16, 16, 5), { color: c1, rot: [1.1, 0, 0], flat: 0.5 });
  fb.add(geo.torus(1.0, 0.12, 14, 5), { color: c2, rot: [0.3, 0, 0.5], flat: 0.5 });
  fb.add(geo.sphere(0.42, 10, 7), { color: c0, flat: 0.3 });
  const finial = fb.build(`placeholder-${site.id}-finial`);
  finial.position.set(lx, top + 2.2, lz);
  group.add(finial);
  const phase = (hashString(site.id) % 100) * 0.07;

  return {
    group,
    colliders,
    pois,
    update(_dt, t) {
      finial.rotation.y = t * 0.35 + phase;
      finial.position.y = top + 2.2 + Math.sin(t * 0.6 + phase) * 0.25;
    },
  };
}

