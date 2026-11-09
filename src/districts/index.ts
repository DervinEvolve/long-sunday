// The district table. A file named src/districts/<id>.ts is picked up on its own: export the
// module as `district` or as the default export. Until that file exists, or if it fails to load,
// the pad gets the placeholder, so the world always has all eleven places in it.
import type { DistrictId, DistrictModule } from '../types';
import { SITES } from '../world/layout';
import { placeholder } from './placeholder';

type Loaded = { default?: unknown; district?: unknown };

// Lazy, so each district is its own chunk and a missing file is not a build error.
const files = import.meta.glob<Loaded>(['./*.ts', '!./index.ts', '!./placeholder.ts']);

function isModule(m: unknown, id: DistrictId): m is DistrictModule {
  return !!m && typeof m === 'object' && typeof (m as DistrictModule).build === 'function' && (m as DistrictModule).id === id;
}

function loader(id: DistrictId): () => Promise<DistrictModule> {
  return async () => {
    const load = files[`./${id}.ts`];
    if (!load) return placeholder(id);
    try {
      const file = await load();
      if (isModule(file.district, id)) return file.district;
      if (isModule(file.default, id)) return file.default;
      console.warn(`[districts] ${id}.ts has no DistrictModule export called "district" or default with id "${id}". Using the placeholder.`);
    } catch (err) {
      console.warn(`[districts] ${id}.ts failed to load. Using the placeholder.`, err);
    }
    return placeholder(id);
  };
}

export const DISTRICTS: Record<DistrictId, () => Promise<DistrictModule>> = Object.fromEntries(
  SITES.map((s) => [s.id, loader(s.id)]),
) as Record<DistrictId, () => Promise<DistrictModule>>;

/** True when a real file exists for this district (it may still fail to load). */
export function hasDistrictFile(id: DistrictId): boolean {
  return `./${id}.ts` in files;
}

export { placeholder };
