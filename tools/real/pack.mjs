#!/usr/bin/env node
// Step 3 of the real look: make the files the browser fetches.
//
//   node tools/real/pack.mjs            (npm run real:pack)
//
// Reads tools/real/cache/bake/<chunk>/ and writes public/real/:
//   chunks/<chunk>.glb.gz          quantised, meshopt compressed (EXT_meshopt_compression), gzipped
//   lightmaps/<chunk>.<page>.webp  and lightmaps/half/ at half the size
//   textures/, env/                the shared library and the sky, copied from the cache
//   manifest.json                  everything the browser side needs to know
// A file is only rewritten when its source changed.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { MeshoptEncoder } from 'meshoptimizer';
import { BAKE_DIR, CACHE, EXPORT_DIR, HERE, OUT, PYTHON, ensureDir, fmtBytes, settings, sha } from './lib.mjs';

const cfg = settings();
const t0 = Date.now();
await MeshoptEncoder.ready;

const stateFile = path.join(CACHE, 'pack-state.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const size = (f) => statSync(f).size;
const rel = (f) => path.relative(OUT, f).split(path.sep).join('/');

/** Run `make` unless the output is there and was made from this same input. */
function cached(out, key, make) {
  const id = rel(out);
  if (state[id] === key && existsSync(out)) return false;
  ensureDir(path.dirname(out));
  make();
  state[id] = key;
  return true;
}

function webp(src, out, opts = {}) {
  const a = [path.join(HERE, 'images.py'), 'webp', src, out, '--quality', String(opts.quality ?? 90)];
  if (opts.half) a.push('--half', opts.half);
  if (opts.lossless) a.push('--lossless');
  if (opts.max) a.push('--max', String(opts.max));
  execFileSync(PYTHON, a, { stdio: ['ignore', 'pipe', 'inherit'] });
}

// ---------------------------------------------------------------------------------------------
// glTF: reorder for the vertex cache, then meshopt every buffer view
// ---------------------------------------------------------------------------------------------

function readGlb(file) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  return { json, bin: new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength) };
}

function compressGlb(src, out) {
  const { json, bin } = readGlb(src);
  const views = json.bufferViews;
  const data = views.map((v) => bin.slice(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  // Reorder each primitive so triangles that share vertices sit together.
  for (const mesh of json.meshes)
    for (const prim of mesh.primitives) {
      const iacc = json.accessors[prim.indices];
      const iview = iacc.bufferView;
      const indices = new Uint32Array(data[iview].buffer, data[iview].byteOffset, iacc.count);
      const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, true);
      for (const key of Object.keys(prim.attributes)) {
        const acc = json.accessors[prim.attributes[key]];
        const view = views[acc.bufferView];
        const stride = view.byteStride;
        const from = data[acc.bufferView];
        const to = new Uint8Array(unique * stride);
        for (let i = 0; i < acc.count; i++) {
          const j = remap[i];
          if (j === 0xffffffff) continue;
          to.set(from.subarray(i * stride, (i + 1) * stride), j * stride);
        }
        data[acc.bufferView] = to;
        acc.count = unique;
        view.byteLength = to.byteLength;
      }
    }
  const parts = [];
  let encLength = 0;
  let rawLength = 0;
  json.bufferViews = views.map((v, i) => {
    const isIndex = v.target === 34963;
    const stride = isIndex ? 4 : v.byteStride;
    const count = data[i].byteLength / stride;
    const enc = MeshoptEncoder.encodeGltfBuffer(data[i], count, stride, isIndex ? 'TRIANGLES' : 'ATTRIBUTES');
    const view = {
      buffer: 1,
      byteOffset: rawLength,
      byteLength: data[i].byteLength,
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: encLength, byteLength: enc.byteLength, byteStride: stride, count, mode: isIndex ? 'TRIANGLES' : 'ATTRIBUTES' } },
    };
    if (v.target) view.target = v.target;
    if (!isIndex) view.byteStride = stride;
    parts.push(enc);
    encLength += (enc.byteLength + 3) & ~3;
    rawLength += (data[i].byteLength + 3) & ~3;
    return view;
  });
  json.buffers = [{ byteLength: encLength }, { byteLength: rawLength, extensions: { EXT_meshopt_compression: { fallback: true } } }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_meshopt_compression'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_meshopt_compression'])];
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const total = 12 + 8 + text.length + 8 + encLength;
  const o = Buffer.alloc(total);
  o.writeUInt32LE(0x46546c67, 0);
  o.writeUInt32LE(2, 4);
  o.writeUInt32LE(total, 8);
  o.writeUInt32LE(text.length, 12);
  o.writeUInt32LE(0x4e4f534a, 16);
  text.copy(o, 20);
  let at = 20 + text.length;
  o.writeUInt32LE(encLength, at);
  o.writeUInt32LE(0x004e4942, at + 4);
  at += 8;
  for (const p of parts) {
    o.set(p, at);
    at += (p.byteLength + 3) & ~3;
  }
  // The meshopt codecs take out the structure and leave the entropy coding to whatever carries the
  // file. The locked build seals files, so no host can compress them on the way: gzip here instead.
  writeFileSync(out, gzipSync(o, { level: 9 }));
  return total;
}

// ---------------------------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------------------------

const exp = JSON.parse(readFileSync(path.join(EXPORT_DIR, 'export.json'), 'utf8'));
const table = JSON.parse(readFileSync(path.join(HERE, 'materials.json'), 'utf8'));
const sites = Object.fromEntries(exp.meta.sites.map((s) => [s.id, s]));
const chunks = [];
const wanted = new Set();
const lmQualityOf = (id) => cfg.pack?.chunkLightmapQuality?.[id] ?? cfg.pack?.lightmapQuality ?? 90;
const rawSizes = (state['raw-sizes'] ??= {});

for (const id of Object.keys(exp.chunks)) {
  const dir = path.join(BAKE_DIR, id);
  const metaFile = path.join(dir, 'meta.json');
  if (!existsSync(metaFile)) {
    console.warn(`[pack] ${id} has not been baked yet, left out`);
    continue;
  }
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const glb = path.join(OUT, 'chunks', `${id}.glb.gz`);
  cached(glb, meta.hash + ':glb3', () => {
    rawSizes[id] = compressGlb(path.join(dir, 'chunk.glb'), glb);
  });
  wanted.add(rel(glb));
  const lmQuality = lmQualityOf(id);
  const lightmaps = meta.pages.map((p) => {
    const src = path.join(dir, `lm${p.page}.png`);
    const full = path.join(OUT, 'lightmaps', `${id}.${p.page}.webp`);
    const half = path.join(OUT, 'lightmaps', 'half', `${id}.${p.page}.webp`);
    cached(full, `${meta.hash}:${lmQuality}`, () => {
      ensureDir(path.dirname(half));
      webp(src, full, { quality: lmQuality, half });
    });
    wanted.add(rel(full));
    wanted.add(rel(half));
    return { file: rel(full), bytes: size(full), size: meta.lightmap, half: rel(half), halfBytes: size(half) };
  });
  const ex = exp.chunks[id];
  const b = meta.box;
  const centre = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  const radius = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
  const stilled = ex.replaces.filter((p) => exp.moving.includes(p));
  chunks.push({
    id,
    kind: sites[id] ? 'district' : 'base',
    file: rel(glb),
    bytes: size(glb),
    encoding: 'gzip',
    rawBytes: rawSizes[id],
    triangles: meta.triangles,
    drawCalls: meta.drawCalls,
    bounds: { box: b, sphere: [...centre.map((v) => +v.toFixed(2)), +radius.toFixed(2)] },
    lightmaps,
    quality: {
      level: meta.quality,
      lightmap: meta.lightmap,
      samples: meta.samples,
      pageSamples: meta.pages.map((p) => p.samples ?? meta.samples),
      bounces: meta.bounces,
      bakeSeconds: meta.seconds,
    },
    materials: meta.materials,
    primitives: meta.primitives.map((p) => ({ name: p.name, material: p.material, lightmap: p.page, triangles: p.triangles, box: p.box })),
    replaces: ex.replaces,
    live: ex.live,
    stilled,
    drop: ex.drop,
  });
}

// ---------------------------------------------------------------------------------------------
// The shared library, the lettering atlas, the sky
// ---------------------------------------------------------------------------------------------

const texDir = path.join(CACHE, 'textures');
const library = existsSync(path.join(texDir, 'library.json')) ? JSON.parse(readFileSync(path.join(texDir, 'library.json'), 'utf8')) : { sets: {} };
const textures = {};
for (const [name, set] of Object.entries(library.sets)) {
  const entry = { source: set.source, id: set.id, licence: set.licence };
  for (const map of ['color', 'normal', 'orm']) {
    const src = path.join(texDir, `${name}_${map}.png`);
    if (!existsSync(src)) continue;
    const full = path.join(OUT, 'textures', `${name}_${map}.webp`);
    const half = path.join(OUT, 'textures', 'half', `${name}_${map}.webp`);
    const q = map === 'color' ? (cfg.pack?.colorQuality ?? 82) : map === 'normal' ? (cfg.pack?.normalQuality ?? 85) : (cfg.pack?.ormQuality ?? 78);
    cached(full, `${sha(readFileSync(src))}:${q}`, () => {
      ensureDir(path.dirname(half));
      webp(src, full, { quality: q, half });
    });
    wanted.add(rel(full));
    wanted.add(rel(half));
    entry[map] = { file: rel(full), bytes: size(full), half: rel(half), halfBytes: size(half) };
  }
  textures[name] = entry;
}

const atlasSrc = path.join(EXPORT_DIR, exp.atlas.file);
const atlasOut = path.join(OUT, 'textures', 'lettering.webp');
const atlasHalf = path.join(OUT, 'textures', 'half', 'lettering.webp');
cached(atlasOut, exp.atlas.hash, () => {
  ensureDir(path.dirname(atlasHalf));
  webp(atlasSrc, atlasOut, { lossless: true, half: atlasHalf });
});
wanted.add(rel(atlasOut));
wanted.add(rel(atlasHalf));

const lightDir = path.join(CACHE, 'light');
const lightInfo = existsSync(path.join(lightDir, 'light.json')) ? JSON.parse(readFileSync(path.join(lightDir, 'light.json'), 'utf8')) : null;
const environment = {};
for (const [key, file] of [['file', 'sky.hdr'], ['background', 'sky.webp'], ['swatch', 'swatch.png']]) {
  const src = path.join(lightDir, file);
  if (!existsSync(src)) continue;
  const dir = key === 'swatch' ? 'textures' : 'env';
  const out = path.join(OUT, dir, file);
  cached(out, sha(readFileSync(src)), () => copyFileSync(src, out));
  wanted.add(rel(out));
  environment[key] = { file: rel(out), bytes: size(out) };
}

// ---------------------------------------------------------------------------------------------
// Materials, as the browser builds them
// ---------------------------------------------------------------------------------------------

const used = new Set(chunks.flatMap((c) => c.materials));
const plainCells = Object.keys(table.materials).filter((n) => table.materials[n].plain);
const materials = {};
for (const name of used) {
  if (name === 'plain') {
    materials.plain = { kind: 'plain', swatch: environment.swatch?.file ?? null, cells: plainCells, side: 'double', vertexColors: true, reflect: table.plain?.reflect ?? 0.8 };
    continue;
  }
  const m = table.materials[name];
  const out = { kind: m.kind ?? 'opaque', side: 'double', vertexColors: true, reflect: m.reflect ?? (m.kind === 'glass' ? 1 : 0.3) };
  if (m.texture) {
    out.texture = m.texture;
    out.metresPerRepeat = m.size ?? null;
    out.normalScale = m.normalScale ?? 1;
  } else {
    out.roughness = m.roughness ?? 0.8;
    out.metalness = m.metalness ?? 0;
  }
  if (m.kind === 'cards') out.alphaTest = m.alphaTest ?? 0.5;
  if (m.kind === 'glass') out.opacity = m.opacity ?? 0.4;
  if (m.kind === 'lettering') out.alphaMap = rel(atlasOut);
  materials[name] = out;
}

// ---------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------

const scale = cfg.lightmapScale;
const manifest = {
  version: 1,
  generated: new Date().toISOString(),
  space: 'metres. x east, y up, z south. The same space the ink world is built in.',
  sun: {
    direction: exp.meta.sunAt,
    elevationDeg: lightInfo ? +lightInfo.sunElevationDeg.toFixed(2) : null,
    color: lightInfo ? lightInfo.sunColor.map((v) => +v.toFixed(4)) : null,
    irradiance: cfg.sun.ratio,
    skyIrradiance: 1,
  },
  look: { toneMapping: cfg.look?.toneMapping ?? 'AgX', exposure: cfg.look?.exposure ?? 1, lightMapIntensity: scale },
  environment: environment.file
    ? { file: environment.file.file, bytes: environment.file.bytes, format: 'rgbe', projection: 'equirectangular', background: environment.background ?? null }
    : null,
  lettering: { file: rel(atlasOut), bytes: size(atlasOut), half: rel(atlasHalf), halfBytes: size(atlasHalf) },
  textures,
  materials,
  chunks,
  live: exp.worldLive,
  drop: [...exp.worldDrop, ...chunks.flatMap((c) => c.drop)],
  cameras: exp.cameras,
};
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
wanted.add('manifest.json');
writeFileSync(stateFile, JSON.stringify(state, null, 1));

// Sweep what no longer belongs (CREDITS.md is written by the texture step and stays).
const keep = new Set([...wanted, 'CREDITS.md']);
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const f = path.join(dir, name);
    if (statSync(f).isDirectory()) walk(f);
    else if (!keep.has(rel(f))) rmSync(f);
  }
};
walk(OUT);

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

let total = 0;
const all = (dir) => {
  for (const name of readdirSync(dir)) {
    const f = path.join(dir, name);
    if (statSync(f).isDirectory()) all(f);
    else total += size(f);
  }
};
all(OUT);
const MB = 1e6;
const mb = (n) => (n / MB).toFixed(2) + ' MB';
console.log('chunk          tris  calls   geometry   lightmaps (full / half)   baked');
for (const c of chunks) {
  const lm = c.lightmaps.reduce((n, l) => n + l.bytes, 0);
  const lh = c.lightmaps.reduce((n, l) => n + l.halfBytes, 0);
  const spp = [...new Set(c.quality.pageSamples)].join('/');
  console.log(
    `${c.id.padEnd(12)} ${String(c.triangles).padStart(6)} ${String(c.drawCalls).padStart(6)} ${mb(c.bytes).padStart(10)}   ${mb(lm).padStart(9)} / ${mb(lh).padStart(8)}   ${c.quality.level} ${c.quality.lightmap}px x${c.lightmaps.length}, ${spp} samples, ${c.quality.bounces} bounces`,
  );
}

// What goes over the wire, against the budgets I set for it. Megabytes of a million bytes.
const wire = (c, h) => c.bytes + c.lightmaps.reduce((n, l) => n + (h ? l.halfBytes : l.bytes), 0);
const texBytes = (h) =>
  Object.values(textures).reduce((n, t) => n + ['color', 'normal', 'orm'].reduce((m, k) => m + (t[k] ? (h ? t[k].halfBytes : t[k].bytes) : 0), 0), 0) +
  (h ? size(atlasHalf) : size(atlasOut)) +
  Object.values(environment).reduce((n, e) => n + e.bytes, 0);
const base = chunks.filter((c) => c.kind === 'base');
const districts = chunks.filter((c) => c.kind === 'district');
const worst = districts.reduce((a, c) => (wire(c) > wire(a) ? c : a), districts[0]);
const lines = [
  ['shared textures and sky', texBytes(false), texBytes(true), 6],
  ['base set (ground, city, sky)', base.reduce((n, c) => n + wire(c), 0), base.reduce((n, c) => n + wire(c, true), 0), 10],
  [`biggest district (${worst?.id})`, worst ? wire(worst) : 0, worst ? wire(worst, true) : 0, 4],
  ['everything in public/real', total, null, 60],
];
for (const [label, full, halfSize, limit] of lines)
  console.log(`${label.padEnd(30)} ${mb(full).padStart(9)}  ${(halfSize === null ? '' : `(half set ${mb(halfSize)})`).padEnd(19)}  limit ${limit} MB  ${full <= limit * MB ? 'ok' : 'OVER'}`);
const tris = chunks.reduce((n, c) => n + c.triangles, 0);
const calls = chunks.reduce((n, c) => n + c.drawCalls, 0);
console.log(`all chunks at once: ${tris} triangles, ${calls} draw calls. pack took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
