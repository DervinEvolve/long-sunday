#!/usr/bin/env python
"""Cycles pictures of the real look: the reference the browser should approach.

    tools/real/cache/venv/bin/python tools/real/render.py --views trailhead-spawn,trailhead-east
    ... render.py --views all --samples 96 --size 1280x720 --prefix .shots/real/cycles-

The views are named in settings.json. The whole world is loaded from the build cache with the same
materials, sky and sun the bake uses, and path traced from each camera.
"""
import argparse
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "blender"))

from common import CACHE, EXPORT_DIR, ROOT, export_info, log, materials_table, save_json, settings  # noqa: E402
from cache import build_all  # noqa: E402
import emit  # noqa: E402


def look_at_pose(cam, fov):
    """A three.js pose (position, quaternion) from eye and target."""
    eye = np.array(cam[:3], dtype=np.float64)
    target = np.array(cam[3:6], dtype=np.float64)
    z = eye - target
    z /= np.linalg.norm(z)
    x = np.cross(np.array([0.0, 1.0, 0.0]), z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    m = np.stack([x, y, z], axis=1)
    w = math.sqrt(max(0.0, 1 + m[0, 0] + m[1, 1] + m[2, 2])) / 2
    if w > 1e-6:
        q = [(m[2, 1] - m[1, 2]) / (4 * w), (m[0, 2] - m[2, 0]) / (4 * w), (m[1, 0] - m[0, 1]) / (4 * w), w]
    else:
        q = [0.0, 1.0, 0.0, 0.0]
    return {"position": eye.tolist(), "quaternion": q, "fov": fov}


def view_pose(name, cfg, info):
    v = cfg["views"][name]
    if "view" in v:
        return dict(info["cameras"][v["view"]])
    return look_at_pose(v["cam"], v.get("fov", 46))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", default="all")
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--size", default="1280x720")
    ap.add_argument("--prefix", default=os.path.join(ROOT, ".shots", "real", "cycles-"))
    args = ap.parse_args()
    cfg = settings()
    table = materials_table()
    info = export_info()
    names = list(cfg["views"]) if args.views == "all" else [n for n in args.views.split(",") if n]
    built = build_all(cfg, table, info, [], False)

    import bpy
    import scene as S

    scn = S.reset(cfg["threads"])
    mats = S.make_materials(table, os.path.join(EXPORT_DIR, info["atlas"]["file"]))
    light = S.setup_light(scn, cfg, info["meta"]["sunAt"])
    S.calibrate(scn, light, cfg)
    for chunk, (data, _h) in built.items():
        S.add_chunk(scn, chunk, data, mats)
    w, h = (int(x) for x in args.size.split("x"))
    scn.render.resolution_x = w
    scn.render.resolution_y = h
    scn.render.resolution_percentage = 100
    scn.cycles.samples = args.samples
    scn.cycles.max_bounces = 6
    scn.cycles.diffuse_bounces = 4
    scn.cycles.glossy_bounces = 4
    scn.cycles.transmission_bounces = 6
    scn.cycles.use_denoising = True
    scn.cycles.denoiser = "OPENIMAGEDENOISE"
    scn.render.use_persistent_data = True
    scn.view_settings.view_transform = cfg.get("look", {}).get("toneMapping", "AgX")
    scn.view_settings.exposure = math.log2(float(cfg.get("look", {}).get("exposure", 1.0)))
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGB"
    scn.render.image_settings.color_depth = "8"
    for name in names:
        t = time.time()
        cam = S.add_camera(scn, view_pose(name, cfg, info), "ls_" + name)
        scn.camera = cam
        scn.render.filepath = f"{args.prefix}{name}.png"
        bpy.ops.render.render(write_still=True)
        log(f"rendered {name} in {time.time() - t:.1f} s -> {scn.render.filepath}")


if __name__ == "__main__":
    main()
