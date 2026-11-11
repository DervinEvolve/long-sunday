"""Paths, settings and small helpers shared by the Blender side of the real look."""
import hashlib
import json
import os
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(REAL))
CACHE = os.path.join(REAL, "cache")
EXPORT_DIR = os.path.join(CACHE, "export")
BUILD_DIR = os.path.join(CACHE, "build")
BAKE_DIR = os.path.join(CACHE, "bake")
TEX_DIR = os.path.join(CACHE, "textures")
OUT = os.path.join(ROOT, "public", "real")


def load_json(path):
    with open(path, "r", encoding="utf8") as f:
        return json.load(f)


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        json.dump(data, f, indent=1)


def settings():
    return load_json(os.path.join(REAL, "settings.json"))


def materials_table():
    return load_json(os.path.join(REAL, "materials.json"))


def export_info():
    return load_json(os.path.join(EXPORT_DIR, "export.json"))


def digest(*parts):
    h = hashlib.sha256()
    for p in parts:
        if isinstance(p, bytes):
            h.update(p)
        else:
            h.update(json.dumps(p, sort_keys=True).encode("utf8"))
    return h.hexdigest()[:16]


def file_digest(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:16]


def code_digest(names):
    """A hash of the pipeline's own source files, so a change to the code reruns what it touches."""
    h = hashlib.sha256()
    for n in names:
        with open(os.path.join(HERE, n), "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:16]


def chunk_settings(cfg, chunk):
    """Settings for one chunk: the defaults, then the quality level it is set to, then its own overrides."""
    out = dict(cfg["defaults"])
    per = cfg.get("chunks", {}).get(chunk, {})
    level = per.get("quality", cfg.get("quality", "rough"))
    out.update(cfg["levels"][level])
    out.update({k: v for k, v in per.items() if k != "quality"})
    out["quality"] = level
    return out


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def hex_to_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


class Timer:
    def __init__(self):
        self.t = time.time()

    def lap(self):
        now = time.time()
        d = now - self.t
        self.t = now
        return d


def log(*a):
    print("[real]", *a, flush=True)
