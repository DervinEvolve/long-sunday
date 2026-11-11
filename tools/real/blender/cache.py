"""The build cache: every chunk sorted into materials and unwrapped, kept until its input changes."""
import hashlib
import os
import time

import numpy as np

import build as B
from common import BUILD_DIR, chunk_settings, code_digest, digest, load_json, log, save_json

BUILD_KEYS = ["triangles", "pages", "pageBox", "densityCap", "downWeight", "leafShare", "lightmap", "tinyPart", "materialsMax", "bevel", "bevelMinSize", "bevelShare", "chartSplit", "chartSplitOver", "dropBottoms", "focus"]


def content_digest(data):
    """A hash of what a build made, whatever it was made from. The bake is keyed on this, so a
    change to a rule in materials.json only bakes the chunks whose surfaces it really changed.
    The count of hits per rule is a note for me and stays out of it."""
    h = hashlib.sha256()
    for k in sorted(data):
        if k == "rule_hits":
            continue
        a = np.ascontiguousarray(data[k])
        h.update(f"{k}|{a.dtype}|{a.shape}|".encode("utf8"))
        h.update(a.tobytes())
    return h.hexdigest()[:16]


def build_all(cfg, table, info, only, force):
    """Returns {chunk: (data, content hash)} for every chunk, building what is stale."""
    os.makedirs(BUILD_DIR, exist_ok=True)
    sites = {s["id"]: s for s in info["meta"]["sites"]}
    code = code_digest(["build.py", "glbio.py", "detail.py"])
    out = {}
    for chunk, ex in info["chunks"].items():
        cs = chunk_settings(cfg, chunk)
        if chunk not in sites and cfg.get("focus"):
            # The ground and the city get more lightmap where the districts are.
            f = cfg["focus"]
            cs["focus"] = [[s["center"]["x"], s["center"]["z"], s["radius"] * f.get("reach", 1.0), f.get(s["id"], f.get("sites", 1.0))] for s in sites.values()]
        h = digest(ex["hash"], table, {k: cs.get(k) for k in BUILD_KEYS}, code)
        npz = os.path.join(BUILD_DIR, f"{chunk}.npz")
        side = os.path.join(BUILD_DIR, f"{chunk}.json")
        fresh = os.path.exists(npz) and os.path.exists(side) and load_json(side).get("hash") == h
        if fresh and not (force and (not only or chunk in only)):
            data = dict(np.load(npz, allow_pickle=False))
            note = load_json(side)
            if "content" not in note:
                note["content"] = content_digest(data)
                save_json(side, note)
            out[chunk] = (data, note["content"])
            continue
        t = time.time()
        ground = sites[chunk]["height"] if chunk in sites else 0.0
        data = B.build_chunk(chunk, table, cs, ground)
        np.savez_compressed(npz, **data)
        # Read it back, so the hash is of the very arrays a later run will load.
        data = dict(np.load(npz, allow_pickle=False))
        content = content_digest(data)
        dt = time.time() - t
        names = [str(n) for n in data["mat_names"]]
        counts = {names[i]: int((data["mat"] == i).sum()) for i in range(len(names)) if (data["mat"] == i).any()}
        save_json(side, {
            "hash": h, "content": content, "seconds": round(dt, 2), "triangles": int(len(data["P"])), "sourceTriangles": int(data["source_triangles"]),
            "dropped": int(data["dropped"]), "bevelled": int(data["bevelled"]), "merged": [str(x) for x in data["merged"] if str(x)], "pages": int(data["npages"]), "texelsPerMetre": [round(float(d), 2) for d in data["densities"]],
            "charts": int(data["chart"].max()) + 1 if len(data["chart"]) else 0, "materials": counts,
            "rules": [r for r in (str(x) for x in data["rule_hits"]) if not r.endswith("|0")],
        })
        log(f"built {chunk}: {len(data['P'])} triangles from {int(data['source_triangles'])}, {int(data['npages'])} pages, "
            f"{[round(float(d), 1) for d in data['densities']]} texels/m, {dt:.1f} s")
        out[chunk] = (data, content)
    return out
