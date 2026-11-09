// Cached low-poly shapes. Ask for the same shape twice and you get the same geometry back, so never
// change one in place: hand it to a builder, which copies what it needs.
//
// Where things sit:
//   standing solids (box, bevelBox, cylinder, cone, prism, hex, dome, capsule, arch) have their base
//   on y = 0 and are centred in x and z;
//   round things (sphere, torus, rock, blobs) are centred on the origin;
//   plane is an upright card facing +z, centred; disc and ring lie on the ground facing up.
//
// Segment counts are low on purpose. The ink line does the work polygons usually do.
import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const cache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    cache.set(key, g);
  }
  return g;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const key = (name: string, ...n: (number | boolean | string)[]) =>
  name + ':' + n.map((v) => (typeof v === 'number' ? r3(v) : String(v))).join(',');

/** Deterministic random in [0, 1) from an integer seed. */
export function seeded(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth across gentle bends, sharp where faces meet at more than `degrees`. Returns a new geometry. */
export function creased(g: THREE.BufferGeometry, degrees = 40): THREE.BufferGeometry {
  const out = toCreasedNormals(g, (degrees * Math.PI) / 180);
  if (out !== g) g.dispose();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Standing solids
// ---------------------------------------------------------------------------------------------

export function box(w = 1, h = 1, d = 1): THREE.BufferGeometry {
  return cached(key('box', w, h, d), () => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0));
}

/** A box with its edges cut off. `bevel` is the size of the cut in metres. */
export function bevelBox(w = 1, h = 1, d = 1, bevel = 0.08): THREE.BufferGeometry {
  return cached(key('bevelBox', w, h, d, bevel), () => {
    const b = Math.min(bevel, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const hw = w / 2;
    const hd = d / 2;
    // Eight corners of the inner box pushed out along each axis gives 24 points: a chamfered box.
    const pts: THREE.Vector3[] = [];
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const cx = sx * (hw - b);
          const cy = h / 2 + sy * (h / 2 - b);
          const cz = sz * (hd - b);
          pts.push(new THREE.Vector3(cx + sx * b, cy, cz), new THREE.Vector3(cx, cy + sy * b, cz), new THREE.Vector3(cx, cy, cz + sz * b));
        }
    return hull(pts, 20);
  });
}

/** Radius top, radius bottom, height. Smooth sides, flat caps. */
export function cylinder(rTop = 0.5, rBottom = 0.5, h = 1, seg = 10, open = false): THREE.BufferGeometry {
  return cached(key('cyl', rTop, rBottom, h, seg, open), () =>
    new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open).translate(0, h / 2, 0),
  );
}

export function cone(r = 0.5, h = 1, seg = 10): THREE.BufferGeometry {
  return cached(key('cone', r, h, seg), () => new THREE.ConeGeometry(r, h, seg, 1).translate(0, h / 2, 0));
}

/** A column with `sides` flat faces, each one its own plane so the ink line picks out every edge. */
export function prism(sides = 6, rTop = 0.5, rBottom = 0.5, h = 1): THREE.BufferGeometry {
  return cached(key('prism', sides, rTop, rBottom, h), () => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, sides, 1).translate(0, h / 2, 0);
    return creased(g, 20);
  });
}

/** The hexagonal rock column. */
export function hex(r = 0.5, h = 1, taper = 1): THREE.BufferGeometry {
  return prism(6, r * taper, r, h);
}

/** Half a sphere sitting on the ground. `squash` scales its height. No floor unless `closed`. */
export function dome(r = 1, seg = 12, rings = 5, squash = 1, closed = false): THREE.BufferGeometry {
  return cached(key('dome', r, seg, rings, squash, closed), () => {
    const g = new THREE.SphereGeometry(r, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, squash, 1);
    if (squash !== 1) g.computeVertexNormals();
    if (!closed) return g;
    const floor = new THREE.CircleGeometry(r, seg).rotateX(Math.PI / 2);
    return join([g, floor]);
  });
}

/** A pill standing on end. `h` is the full height including both caps. */
export function capsule(r = 0.25, h = 1, seg = 8, capSeg = 3): THREE.BufferGeometry {
  return cached(key('capsule', r, h, seg, capSeg), () => {
    const len = Math.max(0.001, h - 2 * r);
    return new THREE.CapsuleGeometry(r, len, capSeg, seg).translate(0, h / 2, 0);
  });
}

export interface ArchOpts {
  /** Clear width between the legs. */
  span: number;
  /** Clear height under the crown. */
  rise: number;
  /** Thickness of the stone, legs and crown. */
  thick: number;
  /** Front to back. */
  depth: number;
  /** Round top (default) or a flat lintel. */
  round?: boolean;
  /** Segments around the curve. Default 10. */
  seg?: number;
}

/** A doorway of stone standing on y = 0, opening along z. */
export function arch(o: ArchOpts): THREE.BufferGeometry {
  const round = o.round !== false;
  const seg = o.seg ?? 10;
  return cached(key('arch', o.span, o.rise, o.thick, o.depth, round, seg), () => {
    const hw = o.span / 2;
    const t = o.thick;
    const s = new THREE.Shape();
    if (round) {
      const spring = Math.max(0, o.rise - hw);
      s.moveTo(-hw - t, 0);
      s.lineTo(-hw - t, spring);
      s.absarc(0, spring, hw + t, Math.PI, 0, true);
      s.lineTo(hw + t, 0);
      s.lineTo(hw, 0);
      s.lineTo(hw, spring);
      s.absarc(0, spring, hw, 0, Math.PI, false);
      s.lineTo(-hw, 0);
      s.closePath();
    } else {
      s.moveTo(-hw - t, 0);
      s.lineTo(-hw - t, o.rise + t);
      s.lineTo(hw + t, o.rise + t);
      s.lineTo(hw + t, 0);
      s.lineTo(hw, 0);
      s.lineTo(hw, o.rise);
      s.lineTo(-hw, o.rise);
      s.lineTo(-hw, 0);
      s.closePath();
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: o.depth, bevelEnabled: false, curveSegments: seg });
    g.translate(0, 0, -o.depth / 2);
    return creased(g, 35);
  });
}

// ---------------------------------------------------------------------------------------------
// Round things
// ---------------------------------------------------------------------------------------------

export function sphere(r = 0.5, seg = 12, rings = 8): THREE.BufferGeometry {
  return cached(key('sphere', r, seg, rings), () => new THREE.SphereGeometry(r, seg, rings));
}

/** A sphere built from triangles of even size. detail 0 is 20 triangles, 1 is 80, 2 is 320. */
export function ico(r = 0.5, detail = 1): THREE.BufferGeometry {
  return cached(key('ico', r, detail), () => smoothRound(new THREE.IcosahedronGeometry(r, detail)));
}

/** A doughnut lying flat. `R` is the ring radius, `r` the tube radius. */
export function torus(R = 1, r = 0.2, seg = 16, tubeSeg = 6, arc = Math.PI * 2): THREE.BufferGeometry {
  return cached(key('torus', R, r, seg, tubeSeg, arc), () => new THREE.TorusGeometry(R, r, tubeSeg, seg, arc).rotateX(Math.PI / 2));
}

/** A boulder: a lumpy icosahedron with flat facets. Same seed, same rock. */
export function rock(seed = 1, r = 1, detail = 1, lump = 0.32, facet = true): THREE.BufferGeometry {
  return cached(key('rock', seed, r, detail, lump, facet), () => {
    const rnd = seeded(seed * 7919 + 13);
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const welded = mergeVertices(g, 1e-4);
    g.dispose();
    g = welded;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const sx = 0.8 + rnd() * 0.5;
    const sy = 0.6 + rnd() * 0.45;
    const sz = 0.8 + rnd() * 0.5;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (rnd() - 0.5) * 2 * lump;
      let y = p.getY(i) * k * sy;
      // Flatten the underside so it sits.
      if (y < -0.45 * sy) y = -0.45 * sy - (y + 0.45 * sy) * -0.15;
      p.setXYZ(i, p.getX(i) * k * sx * r, y * r, p.getZ(i) * k * sz * r);
    }
    if (facet) {
      const flat = g.toNonIndexed();
      g.dispose();
      flat.computeVertexNormals();
      return flat;
    }
    g.computeVertexNormals();
    return g;
  });
}

/** A clump of overlapping balls: clouds, shrubs, hair. Give the whole clump one id so it reads as one shape. */
export function blobs(seed = 1, count = 7, radius = 1, opts: { squash?: number; detail?: number; size?: [number, number]; flatBase?: boolean } = {}): THREE.BufferGeometry {
  const squash = opts.squash ?? 1;
  const detail = opts.detail ?? 1;
  const size = opts.size ?? [0.38, 0.62];
  const flatBase = opts.flatBase ?? false;
  return cached(key('blobs', seed, count, radius, squash, detail, size[0], size[1], flatBase), () => {
    const rnd = seeded(seed * 104729 + 7);
    const parts: THREE.BufferGeometry[] = [];
    const ball = new THREE.IcosahedronGeometry(1, detail);
    for (let i = 0; i < count; i++) {
      // Even spread over a sphere, then pulled in a little, so there are no holes and no stray balls.
      const u = (i + 0.5) / count;
      const phi = Math.acos(1 - 2 * u);
      const th = i * 2.399963 + rnd() * 0.6;
      const d = radius * (i === 0 ? 0 : 0.42 + rnd() * 0.18);
      const s = radius * (size[0] + rnd() * (size[1] - size[0])) * (i === 0 ? 1.15 : 1);
      let y = Math.cos(phi) * d * squash;
      if (flatBase) y = Math.abs(y) * 0.9;
      const g = ball.clone();
      g.scale(s, s * (0.85 + rnd() * 0.25), s);
      g.rotateY(rnd() * 6.283);
      g.translate(Math.sin(phi) * Math.cos(th) * d, y, Math.sin(phi) * Math.sin(th) * d);
      parts.push(g);
    }
    ball.dispose();
    const out = join(parts);
    parts.forEach((g) => g.dispose());
    return smoothRound(out, false);
  });
}

// ---------------------------------------------------------------------------------------------
// Flat things
// ---------------------------------------------------------------------------------------------

/** An upright card facing +z, centred on the origin. */
export function plane(w = 1, h = 1): THREE.BufferGeometry {
  return cached(key('plane', w, h), () => new THREE.PlaneGeometry(w, h));
}

/** A disc lying on the ground, facing up. */
export function disc(r = 0.5, seg = 16): THREE.BufferGeometry {
  return cached(key('disc', r, seg), () => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2));
}

/** A flat washer lying on the ground, facing up. */
export function ring(inner = 0.5, outer = 1, seg = 20, arc = Math.PI * 2): THREE.BufferGeometry {
  return cached(key('ring', inner, outer, seg, arc), () => new THREE.RingGeometry(inner, outer, seg, 1, 0, arc).rotateX(-Math.PI / 2));
}

// ---------------------------------------------------------------------------------------------
// Helpers that take points. Cached by a key you pass, or not cached when you leave it out.
// ---------------------------------------------------------------------------------------------

type P2 = readonly [number, number];
type P3 = readonly [number, number, number];

/** Push a 2D outline (x, y pairs, counter-clockwise) back along z. Centred in z. `holes` are cut through. */
export function extrude(outline: readonly P2[], depth = 0.2, opts: { holes?: readonly (readonly P2[])[]; crease?: number; cacheKey?: string } = {}): THREE.BufferGeometry {
  const make = () => {
    const s = new THREE.Shape(outline.map((p) => new THREE.Vector2(p[0], p[1])));
    for (const h of opts.holes ?? []) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    return creased(g, opts.crease ?? 35);
  };
  return opts.cacheKey ? cached('extrude:' + opts.cacheKey, make) : finish(make());
}

/** Spin a profile (radius, height pairs, bottom to top) around the y axis. */
export function lathe(profile: readonly P2[], seg = 12, opts: { crease?: number; cacheKey?: string } = {}): THREE.BufferGeometry {
  const make = () => {
    const g = new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(Math.max(p[0], 0), p[1])), seg);
    return creased(g, opts.crease ?? 50);
  };
  return opts.cacheKey ? cached('lathe:' + opts.cacheKey, make) : finish(make());
}

/** A pipe or wire through a list of points. `sag` drops the middle of each span, for hanging wire. */
export function tube(points: readonly P3[], radius = 0.03, opts: { radial?: number; perSpan?: number; closed?: boolean; sag?: number; cacheKey?: string } = {}): THREE.BufferGeometry {
  const make = () => {
    const pts: THREE.Vector3[] = [];
    const sag = opts.sag ?? 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      pts.push(new THREE.Vector3(a[0], a[1], a[2]));
      if (sag !== 0 && i < points.length - 1) {
        const b = points[i + 1];
        pts.push(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag, (a[2] + b[2]) / 2));
      }
    }
    const curve = new THREE.CatmullRomCurve3(pts, opts.closed ?? false, 'centripetal');
    const spans = (pts.length - 1) * (opts.perSpan ?? 3);
    return new THREE.TubeGeometry(curve, Math.max(2, spans), radius, opts.radial ?? 4, opts.closed ?? false);
  };
  return opts.cacheKey ? cached('tube:' + opts.cacheKey, make) : finish(make());
}

/** The smallest closed shape around a set of points, flat faced. For crystals, tents, odd blocks. */
export function hull(points: readonly THREE.Vector3[], creaseDegrees = 25): THREE.BufferGeometry {
  return finish(creased(convexHull(points), creaseDegrees));
}

/** Glue geometries into one (positions and normals only). The inputs are left alone. */
export function join(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0;
  for (const g of parts) verts += (g.index ? g.index.count : g.getAttribute('position').count);
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  let o = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const idx = g.index;
    const count = idx ? idx.count : p.count;
    for (let i = 0; i < count; i++) {
      const v = idx ? idx.getX(i) : i;
      pos[o] = p.getX(v);
      pos[o + 1] = p.getY(v);
      pos[o + 2] = p.getZ(v);
      if (n) {
        nor[o] = n.getX(v);
        nor[o + 1] = n.getY(v);
        nor[o + 2] = n.getZ(v);
      }
      o += 3;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

function finish(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Weld and smooth a faceted round shape. With `fromCentre` the normals point straight out from the origin. */
function smoothRound(g: THREE.BufferGeometry, fromCentre = true): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  if (fromCentre) {
    const p = g.getAttribute('position');
    const n = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const l = Math.hypot(x, y, z) || 1;
      n[i * 3] = x / l;
      n[i * 3 + 1] = y / l;
      n[i * 3 + 2] = z / l;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    return g;
  }
  return g;
}

/** Brute force convex hull. Fine for the few dozen points these shapes use. */
function convexHull(points: readonly THREE.Vector3[]): THREE.BufferGeometry {
  const n = points.length;
  const tris: number[] = [];
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  c.multiplyScalar(1 / n);
  const eps = 1e-5;
  const seen = new Set<string>();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        ab.subVectors(points[j], points[i]);
        ac.subVectors(points[k], points[i]);
        nrm.crossVectors(ab, ac);
        const len = nrm.length();
        if (len < 1e-9) continue;
        nrm.multiplyScalar(1 / len);
        const d = nrm.dot(points[i]);
        let pos = false;
        let neg = false;
        const on: number[] = [];
        for (let m = 0; m < n; m++) {
          const s = nrm.dot(points[m]) - d;
          if (s > eps) pos = true;
          else if (s < -eps) neg = true;
          else on.push(m);
          if (pos && neg) break;
        }
        if (pos && neg) continue;
        // A hull face. It may hold more than three points: fan them once, in order around the face.
        const id = on.join('.');
        if (seen.has(id)) continue;
        seen.add(id);
        const out = pos ? -1 : 1;
        const fc = new THREE.Vector3();
        for (const m of on) fc.add(points[m]);
        fc.multiplyScalar(1 / on.length);
        const ux = new THREE.Vector3().subVectors(points[on[0]], fc).normalize();
        const uy = new THREE.Vector3().crossVectors(nrm, ux).multiplyScalar(out);
        const tmp = new THREE.Vector3();
        const ordered = on
          .map((m) => {
            tmp.subVectors(points[m], fc);
            return { m, a: Math.atan2(tmp.dot(uy), tmp.dot(ux)) };
          })
          .sort((p, q) => p.a - q.a);
        for (let f = 1; f < ordered.length - 1; f++) tris.push(ordered[0].m, ordered[f].m, ordered[f + 1].m);
      }
  const pos = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    const p = points[tris[i]];
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = p.y;
    pos[i * 3 + 2] = p.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
