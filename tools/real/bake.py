#!/usr/bin/env python
"""Step 2 of the real look: build every chunk and bake its light.

    tools/real/cache/venv/bin/python tools/real/bake.py            (npm run real:bake)
    ... bake.py --only trailhead,ground      just these chunks
    ... bake.py --force                      ignore the cache
    ... bake.py --build-only                 sort materials and unwrap, no light

For each chunk it reads tools/real/cache/export/<chunk>.glb, sorts the surfaces into real
materials, adds leaves, unwraps, and keeps the result in cache/build. Then, with the whole world
standing in one Blender scene so shadows and bounce cross chunk borders, it bakes each chunk whose
input or settings changed and writes cache/bake/<chunk>/: the geometry as a plain glTF, one
lightmap per page, and a small meta file. A chunk whose hash has not changed is left alone.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "blender"))

from common import (BAKE_DIR, BUILD_DIR, CACHE, EXPORT_DIR, chunk_settings, code_digest, digest, export_info, load_json, log,  # noqa: E402
                    materials_table, save_json, settings)
import emit  # noqa: E402
from cache import build_all  # noqa: E402

BAKE_KEYS = ["samples", "bounces", "lightmap", "denoise", "pageSamples", "blockFloor"]


def dilate(rgb, valid, iters):
    """Spread known texels into their unknown neighbours, a ring at a time."""
    rgb = rgb.copy()
    valid = valid.copy()
    for _ in range(iters):
        if valid.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(valid.shape, dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                v = np.roll(np.roll(valid, dy, axis=0), dx, axis=1)
                c = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
                if dy == 1:
                    v[0, :] = False
                if dy == -1:
                    v[-1, :] = False
                if dx == 1:
                    v[:, 0] = False
                if dx == -1:
                    v[:, -1] = False
                acc += c * v[:, :, None]
                cnt += v
        grow = (~valid) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        valid |= grow
    return rgb, valid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--build-only", action="store_true")
    ap.add_argument("--sky-only", action="store_true", help="only write the sky (cache/light) and stop")
    args = ap.parse_args()
    only = [c for c in args.only.split(",") if c]

    cfg = settings()
    table = materials_table()
    info = export_info()
    t_all = time.time()
    built = build_all(cfg, table, info, only, args.force)
    if args.build_only:
        return

    light_cfg = {"sun": cfg["sun"], "sky": cfg["sky"], "sunAt": info["meta"]["sunAt"], "scale": cfg["lightmapScale"]}
    # A bake is keyed on what the build made and on how the materials take light. The rules are
    # left out: a rule that changes nothing in a chunk leaves that chunk's bake alone.
    surfaces = {"materials": table["materials"], "plain": table.get("plain", {})}
    stale = []
    # With --only, bake in the order given: the chunk that matters most first.
    order = [c for c in only if c in built] + [c for c in built if c not in only]
    for chunk in order:
        data, bh = built[chunk]
        cs = chunk_settings(cfg, chunk)
        h = digest(bh, surfaces, {k: cs.get(k) for k in BAKE_KEYS}, light_cfg, cfg.get("bakeVersion", 1))
        meta_path = os.path.join(BAKE_DIR, chunk, "meta.json")
        fresh = os.path.exists(meta_path) and load_json(meta_path).get("hash") == h
        wanted = not only or chunk in only
        if wanted and (args.force or not fresh):
            stale.append((chunk, h))
    sky_hash = digest(light_cfg, cfg["sun"].get("envDiscDeg"), 2)
    sky_file = os.path.join(CACHE, "light", "sky.hdr")
    light_file = os.path.join(CACHE, "light", "light.json")
    sky_fresh = os.path.exists(sky_file) and os.path.exists(light_file) and load_json(light_file).get("hash") == sky_hash
    if args.sky_only:
        stale = []
    if not stale and sky_fresh:
        log("every chunk is up to date")
        return
    log("to bake:", ", ".join(c for c, _ in stale) or "only the sky")

    import scene as S  # needs bpy: only now

    scn = S.reset(cfg["threads"])
    atlas = os.path.join(EXPORT_DIR, info["atlas"]["file"])
    mats = S.make_materials(table, atlas)
    light = S.setup_light(scn, cfg, info["meta"]["sunAt"])
    lightinfo = S.calibrate(scn, light, cfg)
    lightinfo["hash"] = sky_hash
    if not sky_fresh:
        env = S.environment(scn, light, cfg, lightinfo, info["meta"]["sunAt"])
        emit.write_hdr(sky_file, env)
        save_json(light_file, lightinfo)
        log("sky written")
    if not stale:
        return
    objs = {}
    t = time.time()
    for chunk, (data, _bh) in built.items():
        objs[chunk] = S.add_chunk(scn, chunk, data, mats)
    log(f"scene: {sum(len(d['P']) for d, _ in built.values())} triangles in {time.time() - t:.1f} s")

    scale = float(cfg["lightmapScale"])
    S.set_bake_flag(mats, True)
    for chunk, h in stale:
        data, _bh = built[chunk]
        cs = chunk_settings(cfg, chunk)
        size = int(cs["lightmap"])
        out_dir = os.path.join(BAKE_DIR, chunk)
        os.makedirs(out_dir, exist_ok=True)
        t0 = time.time()
        pages = []
        for page, obj in enumerate(objs[chunk]):
            if obj is None:
                continue
            tp = time.time()
            samples = int(cs.get("pageSamples", {}).get(str(page), cs["samples"]))
            raw = S.bake_diffuse(scn, obj, size, samples, cs["bounces"])
            tb = time.time() - tp
            rgb = raw[:, :, :3] * math.pi
            valid = raw[:, :, 3] > 0
            cover = float(valid.mean())
            rgb, valid = dilate(rgb, valid, 8)
            if (~valid).any() and valid.any():
                rgb[~valid] = rgb[valid].mean(axis=0)
            if cs.get("denoise", True):
                # Each chart gets a colour of its own in the guide, so light does not smear from
                # one chart into the next. Blocks keep their own values: they get averaged below.
                rng = np.random.default_rng(page + 11)
                guide = np.full((size, size, 3), 0.5, dtype=np.float32)
                cr = data["chart_rects"]
                cr = cr[cr[:, 0] == page]
                cols = rng.random((len(cr), 3)).astype(np.float32)
                for (pg, x, y, w, hh), c in zip(cr, cols):
                    guide[y : y + hh, x : x + w] = c
                clean = S.denoise(np.minimum(rgb, scale * 4), guide)
                keep = np.zeros((size, size), dtype=bool)
                br = data["block_rects"]
                br = br[br[:, 0] == page]
                for dy in (0, 1):
                    for dx in (0, 1):
                        keep[br[:, 2] + dy, br[:, 1] + dx] = True
                rgb = np.where(keep[:, :, None], rgb, clean)
            br = data["block_rects"]
            br = br[br[:, 0] == page]
            if len(br):
                # One light value per block: the mean of its four texels.
                ys, xs = br[:, 2], br[:, 1]
                m = (rgb[ys, xs] + rgb[ys + 1, xs] + rgb[ys, xs + 1] + rgb[ys + 1, xs + 1]) / 4
                # A leaf deep inside a crown still gets a little light through its neighbours.
                # The bake has it black, and black leaves look like holes.
                m = np.maximum(m, float(cs.get("blockFloor", 0.0)))
                for dy in (0, 1):
                    for dx in (0, 1):
                        rgb[ys + dy, xs + dx] = m
            for pg, x, y, w, hh in data["lamp_rects"]:
                if int(pg) == page:
                    rgb[y : y + hh, x : x + w] = scale
            stats = emit.write_lightmap(os.path.join(out_dir, f"lm{page}.png"), rgb, scale)
            stats.update({"page": page, "seconds": round(time.time() - tp, 1), "bakeSeconds": round(tb, 1), "coverage": round(cover, 3)})
            pages.append(stats)
            stats["samples"] = samples
            log(f"  {chunk} page {page}: {size}px, {samples} samples, {time.time() - tp:.1f} s, cover {cover:.2f}, "
                f"median {stats['median']:.2f}, p99 {stats['p99']:.2f}, over {stats['clipped']:.4f}")
        geo = emit.write_chunk_glb(os.path.join(out_dir, "chunk.glb"), chunk, data, table)
        meta = {
            "hash": h, "chunk": chunk, "quality": cs["quality"], "lightmap": size, "samples": cs["samples"], "bounces": cs["bounces"],
            "seconds": round(time.time() - t0, 1), "pages": pages, "scale": scale, **geo,
        }
        save_json(os.path.join(out_dir, "meta.json"), meta)
        log(f"baked {chunk} in {time.time() - t0:.1f} s: {geo['triangles']} triangles, {geo['drawCalls']} draw calls")
    S.set_bake_flag(mats, False)
    log(f"bake done in {time.time() - t_all:.1f} s")


if __name__ == "__main__":
    main()
