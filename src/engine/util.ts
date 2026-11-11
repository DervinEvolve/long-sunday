// Small maths helpers shared by the whole engine. Everything here is a pure function and none of it
// allocates, so it is safe to call from the frame loop. The random and noise functions are seeded and
// give the same numbers on every machine: the world has to look the same on every load.

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Seeded random
// ---------------------------------------------------------------------------------------------

/** FNV-1a over the string, then an avalanche so short ids like "studio" and "studip" land far apart.
 *  Returns an unsigned 32 bit integer, ready to hand to `rng`. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32. Returns a function that gives the next number in [0, 1). Same seed, same sequence. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator seeded from a name, for example `rngFrom('district:studio')`. */
export function rngFrom(name: string): () => number {
  return rng(hashString(name));
}

/** A number in [min, max) from a generator. */
export function range(next: () => number, min: number, max: number): number {
  return min + (max - min) * next();
}

/** One item of a list. */
export function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(next() * items.length))]!;
}

// ---------------------------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Where `value` sits between a and b, unclamped. 0 when a equals b. */
export function invLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

/** Hermite step. 0 below edge0, 1 above edge1. The edges may be given in either order. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/** The quintic version: flat first and second derivative at both ends. */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// ---------------------------------------------------------------------------------------------
// Angles, in radians
// ---------------------------------------------------------------------------------------------

/** Wrap into [-PI, PI). */
export function wrapAngle(angle: number): number {
  const a = (angle + Math.PI) % TAU;
  return (a < 0 ? a + TAU : a) - Math.PI;
}

/** The shortest signed turn that takes `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

// ---------------------------------------------------------------------------------------------
// Damping. Both give the same motion at 30, 60 or 144 frames a second.
// ---------------------------------------------------------------------------------------------

/** Exponential ease toward a target. Never overshoots, whatever the frame step.
 *  `lambda` is the rate per second. 5 is lazy, 12 is snappy, 30 is nearly instant. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** `damp` for angles: turns the short way round and does not care how many laps either angle holds. */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + angleDelta(current, target) * (1 - Math.exp(-lambda * dt));
}

// ---------------------------------------------------------------------------------------------
// Noise. Integer lattice hashes, so there are no tables to build and nothing to keep in memory.
// ---------------------------------------------------------------------------------------------

function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h;
}

function lattice(ix: number, iy: number, seed: number): number {
  return mix(Math.imul(mix(Math.imul(ix, 0x9e3779b1) ^ seed) + iy, 0x85ebca6b) ^ 0x27d4eb2f);
}

/** A stable number in [0, 1) for a whole-number cell. Handy for "does this cell get a tree". */
export function hash2(ix: number, iy: number, seed = 0): number {
  return (lattice(ix | 0, iy | 0, seed | 0) >>> 0) / 4294967296;
}

/** Value noise in [0, 1). Smooth (quintic blend between cells), one feature per unit. */
export function noise2(x: number, y: number, seed = 0): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const ix = fx | 0;
  const iy = fy | 0;
  const s = seed | 0;
  let u = x - fx;
  let v = y - fy;
  u = u * u * u * (u * (u * 6 - 15) + 10);
  v = v * v * v * (v * (v * 6 - 15) + 10);
  const a = lattice(ix, iy, s) >>> 0;
  const b = lattice(ix + 1, iy, s) >>> 0;
  const c = lattice(ix, iy + 1, s) >>> 0;
  const d = lattice(ix + 1, iy + 1, s) >>> 0;
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) / 4294967296;
}

// One of eight unit directions dotted with the offset from the lattice corner.
function grad(h: number, dx: number, dy: number): number {
  switch (h & 7) {
    case 0: return dx;
    case 1: return -dx;
    case 2: return dy;
    case 3: return -dy;
    case 4: return (dx + dy) * 0.7071067811865476;
    case 5: return (dx - dy) * 0.7071067811865476;
    case 6: return (dy - dx) * 0.7071067811865476;
    default: return -(dx + dy) * 0.7071067811865476;
  }
}

/** Gradient noise in about [-1, 1], zero on the lattice points. Rounder than value noise, so it is
 *  the one to use for hills. */
export function gnoise2(x: number, y: number, seed = 0): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const ix = fx | 0;
  const iy = fy | 0;
  const s = seed | 0;
  const dx = x - fx;
  const dy = y - fy;
  const u = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
  const v = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
  const a = grad(lattice(ix, iy, s), dx, dy);
  const b = grad(lattice(ix + 1, iy, s), dx - 1, dy);
  const c = grad(lattice(ix, iy + 1, s), dx, dy - 1);
  const d = grad(lattice(ix + 1, iy + 1, s), dx - 1, dy - 1);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) * 1.4142135623730951;
}

/** Fractal gradient noise in about [-1, 1], centred on zero. */
export function gfbm(x: number, y: number, octaves = 4, seed = 0, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gnoise2(px, py, seed + i * 1013);
    total += amp;
    amp *= gain;
    px = px * lacunarity + 19.19;
    py = py * lacunarity + 7.31;
  }
  return total > 0 ? sum / total : 0;
}
