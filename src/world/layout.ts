import type { DistrictId, DistrictSite, RoadSpec, Vec2 } from '../types';

// The map. One file decides where everything is, so terrain, districts, the minimap and the index agree.
// x is east, z is south. The visitor starts in the south and the career road runs north, uphill.

/** The walkable world is a disc of this radius around the origin. Past it the mesa falls away into sky. */
export const WORLD_RADIUS = 236;
/** Side of the square the terrain covers. */
export const TERRAIN_SIZE = 560;
/** A pad is flat inside `radius * PAD_FLAT` and has fully blended into wild terrain by `radius * PAD_BLEND`. */
export const PAD_FLAT = 0.82;
export const PAD_BLEND = 1.3;

type SiteSeed = Omit<DistrictSite, 'arrive'>;

const seeds: SiteSeed[] = [
  {
    id: 'trailhead',
    name: 'The Trailhead',
    tagline: 'Where I start: New York, family from Ayiti, two degrees, a camera I put down.',
    years: '2017',
    center: { x: 10, z: 178 },
    radius: 30,
    height: 2,
    thread: 'life',
    sky: { top: '#5a64cc', mid: '#a9b0ee', horizon: '#f8dcc6', haze: '#f3d2c4' },
    accents: ['#f7f0e4', '#ef7a1e', '#5a64cc'],
  },
  {
    id: 'switchboard',
    name: 'The Switchboard',
    tagline: 'TEKsystems. Agency recruiting and sales, one call at a time.',
    years: '2017 to 2019',
    center: { x: -62, z: 118 },
    radius: 32,
    height: 5,
    thread: 'people',
    sky: { top: '#3f8fb0', mid: '#f0c66a', horizon: '#f9e3a6', haze: '#f5d9a0' },
    accents: ['#f3c531', '#ef7a1e', '#1f6c7a'],
  },
  {
    id: 'commons',
    name: 'The Commons',
    tagline: 'Meta, Cambridge. Sourcing engineers and building a community.',
    years: '2019 to 2021',
    center: { x: 42, z: 66 },
    radius: 36,
    height: 9,
    thread: 'people',
    sky: { top: '#2f5fc4', mid: '#7fb0ea', horizon: '#fbd3c0', haze: '#dfe0f2' },
    accents: ['#3d6fd8', '#f08a6c', '#f7f0e4'],
  },
  {
    id: 'terraces',
    name: 'Cloud Terraces',
    tagline: 'Google Cloud. Senior hires, cleared hires, hiring committees.',
    years: '2021 to 2023',
    center: { x: -52, z: 6 },
    radius: 38,
    height: 16,
    thread: 'people',
    sky: { top: '#3d86d8', mid: '#a8d8f0', horizon: '#f4f7f2', haze: '#e6f2f4' },
    accents: ['#f7f0e4', '#3fa9a5', '#7fd8ea'],
  },
  {
    id: 'maskgarden',
    name: 'The Mask Garden',
    tagline: 'Diaspora DAO. My own studio: tokens, mixed reality, a stage at Consensus.',
    years: '2022 to 2024',
    center: { x: 64, z: -46 },
    radius: 38,
    height: 12,
    thread: 'both',
    sky: { top: '#7a2f4a', mid: '#e2674a', horizon: '#f7c66a', haze: '#f0b08a' },
    accents: ['#d8412f', '#f3c531', '#3f8a57'],
  },
  {
    id: 'observatory',
    name: 'The Observatory',
    tagline: 'Microsoft AI. Mapping and recruiting the people who build frontier models.',
    years: '2024 to now',
    center: { x: 0, z: -138 },
    radius: 42,
    height: 30,
    thread: 'both',
    sky: { top: '#1c1f5a', mid: '#5a4fb0', horizon: '#f0a0b6', haze: '#8f86d0' },
    accents: ['#2a2f8a', '#c9a23f', '#7fd8ea'],
  },
  {
    id: 'studio',
    name: 'The Studio',
    tagline: 'Paint, comics and memory. Experiments in making pictures with machines.',
    years: '2023 to 2026',
    center: { x: 138, z: 44 },
    radius: 34,
    height: 7,
    thread: 'tech',
    sky: { top: '#e9a9c0', mid: '#f6d5cf', horizon: '#fdf2dc', haze: '#f8e3d8' },
    accents: ['#f0a0b6', '#7fb0ea', '#f3c531'],
  },
  {
    id: 'greenhouse',
    name: 'The Greenhouse',
    tagline: 'Agents under glass. I set several models to work and watch what grows.',
    years: '2026',
    center: { x: -148, z: 62 },
    radius: 34,
    height: 4,
    thread: 'tech',
    sky: { top: '#2f8f86', mid: '#a6dcc8', horizon: '#f4f0c8', haze: '#d4ecd0' },
    accents: ['#7fb85a', '#c9a23f', '#a6dcc8'],
  },
  {
    id: 'skyharbor',
    name: 'Sky Harbor',
    tagline: 'A whale, a swarm of krill, and wheels within wheels that listen.',
    years: '2024 to 2026',
    center: { x: 146, z: -112 },
    radius: 38,
    height: 20,
    thread: 'tech',
    sky: { top: '#3a2f8f', mid: '#6fa8e6', horizon: '#9fe6e0', haze: '#a8c8ee' },
    accents: ['#6f58c2', '#7fd8ea', '#f0a0b6'],
  },
  {
    id: 'boneyard',
    name: 'The Boneyard',
    tagline: 'What did not work, what I never finished, and what each one fed.',
    years: '2018 to 2026',
    center: { x: -146, z: -72 },
    radius: 36,
    height: -5,
    thread: 'tech',
    sky: { top: '#7d74a8', mid: '#c9bfd8', horizon: '#efe2cf', haze: '#d8cfd8' },
    accents: ['#efe6d2', '#c9644e', '#b7a2e6'],
  },
  {
    id: 'postcards',
    name: 'Postcards',
    tagline: 'Travel and community. The parts of the map that are not work.',
    years: '2017 to now',
    center: { x: 118, z: 150 },
    radius: 32,
    height: 3,
    thread: 'life',
    sky: { top: '#ef7a4a', mid: '#f6b879', horizon: '#fbe6b0', haze: '#f6cfa0' },
    accents: ['#d8412f', '#f3c531', '#3fa9a5'],
  },
];

/** The dated career road, south to north, then the side roads. Points are district centres. */
const SPINE: DistrictId[] = ['trailhead', 'switchboard', 'commons', 'terraces', 'maskgarden', 'observatory'];
const BRANCHES: [DistrictId, DistrictId][] = [
  ['trailhead', 'postcards'],
  ['switchboard', 'greenhouse'],
  ['commons', 'studio'],
  ['terraces', 'boneyard'],
  ['maskgarden', 'skyharbor'],
];

const seedById = new Map(seeds.map((s) => [s.id, s]));
const centerOf = (id: DistrictId): Vec2 => seedById.get(id)!.center;

function bend(a: Vec2, b: Vec2, amount: number): Vec2 {
  // A midpoint pushed sideways so no road is a ruler line.
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: mx + (-dz / len) * amount, z: mz + (dx / len) * amount };
}

export const ROADS: RoadSpec[] = [
  {
    id: 'spine',
    kind: 'spine',
    width: 5.5,
    points: SPINE.flatMap((id, i) => {
      const here = centerOf(id);
      if (i === 0) return [here];
      const prev = centerOf(SPINE[i - 1]);
      return [bend(prev, here, i % 2 === 0 ? 14 : -14), here];
    }),
  },
  ...BRANCHES.map(([from, to], i): RoadSpec => ({
    id: `${from}-${to}`,
    kind: 'branch',
    width: 3.5,
    points: [centerOf(from), bend(centerOf(from), centerOf(to), i % 2 === 0 ? 10 : -10), centerOf(to)],
  })),
];

/** Directions, in district-local space, from which roads reach a district. Unit vectors pointing outward. */
export function gates(id: DistrictId): { toward: DistrictId; x: number; z: number }[] {
  const out: { toward: DistrictId; x: number; z: number }[] = [];
  const here = centerOf(id);
  const push = (other: DistrictId, via: Vec2) => {
    const dx = via.x - here.x;
    const dz = via.z - here.z;
    const len = Math.hypot(dx, dz) || 1;
    out.push({ toward: other, x: dx / len, z: dz / len });
  };
  for (const road of ROADS) {
    const pts = road.points;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].x !== here.x || pts[i].z !== here.z) continue;
      const ends = road.kind === 'spine' ? SPINE : (road.id.split('-') as DistrictId[]);
      if (i > 0) push(road.kind === 'spine' ? SPINE[SPINE.indexOf(id) - 1] : ends[0], pts[i - 1]);
      if (i < pts.length - 1) push(road.kind === 'spine' ? SPINE[SPINE.indexOf(id) + 1] : ends[1], pts[i + 1]);
    }
  }
  return out;
}

/** Heading convention used everywhere: forward = (-sin(yaw), 0, -cos(yaw)). Yaw 0 looks north. */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export const SITES: DistrictSite[] = seeds.map((seed) => {
  const g = gates(seed.id)[0];
  const d = seed.radius * 0.6;
  // Land on the road just inside the pad, looking at the centre.
  return { ...seed, arrive: { x: g.x * d, z: g.z * d, yaw: yawToward(-g.x, -g.z) } };
});

export const SITE_BY_ID: Record<DistrictId, DistrictSite> = Object.fromEntries(SITES.map((s) => [s.id, s])) as Record<
  DistrictId,
  DistrictSite
>;

export const SPINE_ORDER = SPINE;

/** Where a first-time visitor appears: south edge of the Trailhead, looking north up the road. */
export const SPAWN = { x: SITE_BY_ID.trailhead.center.x + 2, z: SITE_BY_ID.trailhead.center.z + 21, yaw: 0 };

/** Year stones along the career road, placed by fraction of the spine's length. */
export const YEAR_STONES: { year: number; at: DistrictId }[] = [
  { year: 2017, at: 'trailhead' },
  { year: 2019, at: 'commons' },
  { year: 2021, at: 'terraces' },
  { year: 2023, at: 'maskgarden' },
  { year: 2024, at: 'observatory' },
];

export function nearestSite(x: number, z: number): { site: DistrictSite; distance: number } {
  let best = SITES[0];
  let bestD = Infinity;
  for (const s of SITES) {
    const d = Math.hypot(x - s.center.x, z - s.center.z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { site: best, distance: bestD };
}
