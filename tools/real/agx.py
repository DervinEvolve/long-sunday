#!/usr/bin/env python
"""Blender's own AgX view transform as a small 3D table, for the browser.

    tools/real/cache/venv/bin/python tools/real/agx.py      (run by the bake step when missing)

three.js ships an AgX that is a fitted curve. Against Blender's (the one the Cycles pictures and
the bake were judged under) it comes out 10 to 14 levels of 255 brighter between linear 0.04 and
0.15, which is where shade lives, and 5 or 6 brighter in the light. That made shade read 20 to 35%
too bright in the browser with the lightmaps exactly right. This writes Blender's transform as a
33 by 33 by 33 table so the browser can show the bake the way it was made.

The table: input is linear sRGB times the exposure, per channel, as
    u = clamp((log2(x) - min) / (max - min), 0, 1),  min -12.47393, max 4.026069
and the cell for (r, g, b) is at column r + b * 33, row g (row 0 at the top). The value is the
display colour, sRGB encoded. Look it up with trilinear filtering (blend two blue slices), then
decode sRGB to linear for the output.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "blender"))

from common import CACHE, log  # noqa: E402

N = 33
LO = -12.47393
HI = 4.026069


def main(out=None):
    import bpy
    from PIL import Image

    out = out or os.path.join(CACHE, "light", "agx.png")
    u = np.arange(N) / (N - 1)
    x = np.power(2.0, LO + u * (HI - LO))
    x[0] = 0.0
    w, h = N * N, N
    r = np.tile(np.arange(N), N)          # column -> r
    b = np.repeat(np.arange(N), N)        # column -> b slice
    px = np.ones((h, w, 4), dtype=np.float32)
    for g in range(N):
        px[g, :, 0] = x[r]
        px[g, :, 1] = x[g]
        px[g, :, 2] = x[b]
    img = bpy.data.images.new("ls_agx", w, h, float_buffer=True, alpha=False)
    img.colorspace_settings.name = "Linear Rec.709"
    img.pixels.foreach_set(px.ravel())  # Blender row 0 is the bottom: row index g
    scene = bpy.context.scene
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.display_settings.display_device = "sRGB"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "16"
    scene.render.dither_intensity = 0.0
    tmp = os.path.join(bpy.app.tempdir or "/tmp", "ls_agx.png")
    img.save_render(tmp, scene=scene)
    back = bpy.data.images.load(tmp, check_existing=False)
    back.colorspace_settings.name = "Non-Color"
    a = np.empty(w * h * 4, dtype=np.float32)
    back.pixels.foreach_get(a)
    bpy.data.images.remove(back)
    a = a.reshape(h, w, 4)[:, :, :3].astype(np.float64)  # Blender rows run bottom up, as set: row g
    os.makedirs(os.path.dirname(out), exist_ok=True)
    Image.fromarray(np.clip(np.round(a * 255), 0, 255).astype(np.uint8), "RGB").save(out, optimize=True)
    log(f"agx table {N}^3 -> {out}")
    return out


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
