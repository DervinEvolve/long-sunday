#!/usr/bin/env python
"""The texture library of the real look.

    tools/real/cache/venv/bin/python tools/real/textures.py      (npm run real:textures)

Downloads each set named in textures.json (once, into tools/real/cache/textures/src), sizes it down
to what a walking camera needs, packs occlusion, roughness and metal into one map, and writes
    tools/real/cache/textures/<name>_color.png, _normal.png, _orm.png    for Blender and the pack step
    tools/real/cache/textures/library.json                                what came from where
    tools/real/cache/light/swatch.png                                     roughness and metal of the plain surfaces
    public/real/CREDITS.md
Only Poly Haven and ambientCG are contacted, with a plain request header and nothing about this project.
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "blender"))
from common import CACHE, OUT, TEX_DIR, digest, load_json, log, materials_table, save_json  # noqa: E402

SRC = os.path.join(TEX_DIR, "src")
UA = {"User-Agent": "Mozilla/5.0"}
ALLOWED = ("https://api.polyhaven.com/", "https://dl.polyhaven.org/", "https://ambientcg.com/")


def fetch(url, path=None):
    if not url.startswith(ALLOWED):
        raise RuntimeError(f"not a host this pipeline may contact: {url}")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        final = r.geturl()
        data = r.read()
    if path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
    return data, final


def polyhaven(asset):
    """Diffuse, GL normal and the packed AO/rough/metal map at 1k, as PIL images, plus credit."""
    d = os.path.join(SRC, "polyhaven", asset)
    info_path = os.path.join(d, "info.json")
    names = {"color": "Diffuse", "normal": "nor_gl", "orm": "arm"}
    if not all(os.path.exists(os.path.join(d, k + ".jpg")) for k in names) or not os.path.exists(info_path):
        files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset}")[0])
        info = json.loads(fetch(f"https://api.polyhaven.com/info/{asset}")[0])
        for k, key in names.items():
            entry = files[key]["1k"]
            url = (entry.get("jpg") or entry.get("png"))["url"]
            fetch(url, os.path.join(d, k + ".jpg"))
        save_json(info_path, {"name": info.get("name"), "authors": list((info.get("authors") or {}).keys()), "dimensions": info.get("dimensions")})
    info = load_json(info_path)
    maps = {k: Image.open(os.path.join(d, k + ".jpg")).convert("RGB") for k in names}
    credit = {"source": "Poly Haven", "id": asset, "name": info.get("name") or asset, "authors": info.get("authors") or [],
              "url": f"https://polyhaven.com/a/{asset}", "licence": "CC0 1.0"}
    return maps, credit


def ambientcg(asset):
    d = os.path.join(SRC, "ambientcg", asset)
    zpath = os.path.join(d, f"{asset}_1K-JPG.zip")
    if not os.path.exists(zpath):
        fetch(f"https://ambientcg.com/get?file={asset}_1K-JPG.zip", zpath)
    maps = {}
    with zipfile.ZipFile(zpath) as z:
        for n in z.namelist():
            for key in ("Color", "NormalGL", "Roughness", "AmbientOcclusion", "Opacity"):
                if n.endswith(f"_{key}.jpg") and "/" not in n:
                    maps[key] = Image.open(io.BytesIO(z.read(n))).convert("RGB")
    credit = {"source": "ambientCG", "id": asset, "name": asset, "authors": ["ambientCG"],
              "url": f"https://ambientcg.com/view?id={asset}", "licence": "CC0 1.0"}
    return maps, credit


def adjust_color(img, adj):
    a = np.asarray(img, dtype=np.float32) / 255.0
    sat = float(adj.get("saturation", 1.0))
    gain = float(adj.get("gain", 1.0))
    y = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    a = y[:, :, None] + (a - y[:, :, None]) * sat
    a = np.clip(a * gain, 0, 1)
    return Image.fromarray((a * 255 + 0.5).astype(np.uint8), "RGB")


def leaf_cluster(color, opacity, size, atlas, count, leaf=0.1, spread=0.39, seed=5):
    """An atlas of leafy sprays made from single leaves: what a leaf card shows."""
    rng = np.random.default_rng(seed)
    col = np.asarray(color.convert("RGB"), dtype=np.float32) / 255.0
    op = np.asarray(opacity.convert("L"), dtype=np.float32) / 255.0
    h, w = op.shape
    sprites = []
    for gy in range(3):
        for gx in range(3):
            y0, y1, x0, x1 = gy * h // 3, (gy + 1) * h // 3, gx * w // 3, (gx + 1) * w // 3
            a = op[y0:y1, x0:x1]
            if a.mean() < 0.05:
                continue
            rgba = np.dstack([col[y0:y1, x0:x1], a])
            sprites.append(Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA"))
    cols, rows = atlas
    cell = size // cols
    out = np.zeros((size, size, 4), dtype=np.float32)
    mean_rgb = (col * op[:, :, None]).sum(axis=(0, 1)) / max(op.sum(), 1e-6)
    for cy in range(rows):
        for cx in range(cols):
            layer = np.zeros((cell, cell, 4), dtype=np.float32)
            for i in range(count):
                sp = sprites[int(rng.integers(len(sprites)))]
                depth = i / max(count - 1, 1)
                s = cell * leaf * (1 + 0.7 * rng.random())
                sp2 = sp.resize((max(2, int(s * sp.width / sp.height)), max(2, int(s))), Image.LANCZOS)
                sp2 = sp2.rotate(float(rng.random() * 360), expand=True, resample=Image.BICUBIC)
                r = cell * spread * np.sqrt(rng.random())
                th = rng.random() * 2 * np.pi
                px = int(cell / 2 + r * np.cos(th) - sp2.width / 2)
                py = int(cell / 2 + r * np.sin(th) - sp2.height / 2)
                a = np.asarray(sp2, dtype=np.float32) / 255.0
                x0, y0 = max(px, 0), max(py, 0)
                x1, y1 = min(px + sp2.width, cell), min(py + sp2.height, cell)
                if x1 <= x0 or y1 <= y0:
                    continue
                src = a[y0 - py : y1 - py, x0 - px : x1 - px]
                # Leaves further back sit in the shade of the ones in front.
                shade = 0.5 + 0.5 * depth
                jitter = 1 + (rng.random(3) - 0.5) * 0.16
                rgb = np.clip(src[:, :, :3] * shade * jitter[None, None, :], 0, 1)
                al = src[:, :, 3:4]
                dst = layer[y0:y1, x0:x1]
                dst[:, :, :3] = rgb * al + dst[:, :, :3] * (1 - al)
                dst[:, :, 3:4] = al + dst[:, :, 3:4] * (1 - al)
            out[cy * cell : (cy + 1) * cell, cx * cell : (cx + 1) * cell] = layer
    # Leaf colour everywhere, so the cut-out edge never shows a dark fringe when it is filtered.
    alpha = out[:, :, 3:4]
    rgb = np.where(alpha > 0.02, out[:, :, :3], mean_rgb[None, None, :] * 0.8)
    res = np.dstack([rgb, alpha])
    return Image.fromarray((np.clip(res, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def swatch(table):
    """One column of four pixels per plain surface: occlusion 1, roughness, metal."""
    cells = [n for n, m in table["materials"].items() if m.get("plain")]
    img = np.zeros((4, 4 * len(cells), 3), dtype=np.uint8)
    for i, n in enumerate(cells):
        m = table["materials"][n]
        img[:, i * 4 : i * 4 + 4] = [255, round(255 * float(m.get("roughness", 0.8))), round(255 * float(m.get("metalness", 0.0)))]
    path = os.path.join(CACHE, "light", "swatch.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(img, "RGB").save(path)
    return cells


def main():
    cfg = load_json(os.path.join(HERE, "textures.json"))
    table = materials_table()
    os.makedirs(TEX_DIR, exist_ok=True)
    lib_path = os.path.join(TEX_DIR, "library.json")
    lib = load_json(lib_path) if os.path.exists(lib_path) else {"sets": {}}
    if len(cfg["sets"]) > 12:
        raise SystemExit("the library holds at most twelve sets")
    out_sets = {}
    for name, spec in cfg["sets"].items():
        h = digest(spec, 3)
        prev = lib["sets"].get(name)
        if prev and prev.get("hash") == h and os.path.exists(os.path.join(TEX_DIR, f"{name}_color.png")):
            out_sets[name] = prev
            continue
        size = int(spec.get("size", 1024))
        if spec["source"] == "polyhaven":
            maps, credit = polyhaven(spec["id"])
            color, normal, orm = maps["color"], maps["normal"], maps["orm"]
        else:
            maps, credit = ambientcg(spec["id"])
            color, normal = maps["Color"], maps.get("NormalGL")
            orm = None
            if spec.get("make") != "leafcluster":
                ao = np.asarray(maps.get("AmbientOcclusion", Image.new("RGB", color.size, (255, 255, 255))).convert("L"))
                ro = np.asarray(maps["Roughness"].convert("L"))
                orm = Image.fromarray(np.dstack([ao, ro, np.zeros_like(ro)]), "RGB")
        made = ["color"]
        if spec.get("make") == "leafcluster":
            img = leaf_cluster(color, maps["Opacity"], size, spec.get("atlas", [2, 2]), int(spec.get("leaves", 24)),
                               float(spec.get("leafSize", 0.1)), float(spec.get("spread", 0.39)))
            img.save(os.path.join(TEX_DIR, f"{name}_color.png"))
            for k in ("normal", "orm"):
                p = os.path.join(TEX_DIR, f"{name}_{k}.png")
                if os.path.exists(p):
                    os.remove(p)
            credit["note"] = "single leaves from this set, arranged into sprays by tools/real/textures.py"
        else:
            if spec.get("adjust"):
                color = adjust_color(color, spec["adjust"])
            color.resize((size, size), Image.LANCZOS).save(os.path.join(TEX_DIR, f"{name}_color.png"))
            if spec.get("roughness"):
                lo, hi = spec["roughness"]
                o = np.asarray(orm, dtype=np.float32) / 255.0
                r = o[:, :, 1]
                a, b = np.percentile(r, 2), np.percentile(r, 98)
                o[:, :, 1] = lo + (hi - lo) * np.clip((r - a) / max(b - a, 1e-3), 0, 1)
                orm = Image.fromarray((o * 255 + 0.5).astype(np.uint8), "RGB")
            n2 = max(256, size // 2)
            normal.resize((n2, n2), Image.LANCZOS).save(os.path.join(TEX_DIR, f"{name}_normal.png"))
            orm.resize((n2, n2), Image.LANCZOS).save(os.path.join(TEX_DIR, f"{name}_orm.png"))
            made += ["normal", "orm"]
        mean = np.asarray(Image.open(os.path.join(TEX_DIR, f"{name}_color.png")).convert("RGB"), dtype=np.float32).mean(axis=(0, 1)) / 255.0
        out_sets[name] = {**credit, "hash": h, "maps": made, "size": size, "meanColor": [round(float(x), 4) for x in mean]}
        log(f"texture {name}: {credit['source']} {credit['id']}, {size}px")
    cells = swatch(table)
    save_json(lib_path, {"sets": out_sets, "plainCells": cells})

    os.makedirs(OUT, exist_ok=True)
    lines = [
        "# Credits for the real look",
        "",
        "Every surface texture in this folder comes from one of the sets below. All of them are published",
        "under CC0 1.0 (public domain). They were sized down, some were lightened or had colour taken out,",
        "and occlusion, roughness and metal were packed into one map. The step that does it is",
        "`tools/real/textures.py`, and the list it reads is `tools/real/textures.json`.",
        "",
        "| File prefix | Source | Asset id | By | Licence | Link |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for name, s in out_sets.items():
        by = ", ".join(s.get("authors") or []) or s["source"]
        note = f" ({s['note']})" if s.get("note") else ""
        lines.append(f"| `textures/{name}_*` | {s['source']} | {s['id']}{note} | {by} | {s['licence']} | {s['url']} |")
    lines += [
        "",
        "The lightmaps, the sky (`env/`), the lettering atlas and the geometry are made by this project's own",
        "pipeline from this project's own world. The lettering is set in Architects Daughter (SIL Open Font",
        "License 1.1), the same font the drawn look uses.",
        "",
    ]
    with open(os.path.join(OUT, "CREDITS.md"), "w", encoding="utf8") as f:
        f.write("\n".join(lines))
    log(f"library: {len(out_sets)} sets")


if __name__ == "__main__":
    main()
