// The one line of contract between the lock and the world.
//
// In the locked build (npm run build:locked) the unlock page sets window.__lsAsset before the world
// starts. Give it a path relative to the page, the ones that start with "real/". It fetches the
// sealed file, opens it with the key already in memory and resolves with the plain bytes. It rejects
// with an Error when the file is missing or does not open.
//
// In a plain build the function does not exist, so the world fetches the file itself:
//
//   const bytes = await (window.__lsAsset?.(path) ?? fetch(path).then((r) => r.arrayBuffer()));
//
// The locked copies are made by scripts/lock.mjs from public/real/ (and dist/real/).
interface Window {
  __lsAsset?: (path: string) => Promise<ArrayBuffer>;
}
