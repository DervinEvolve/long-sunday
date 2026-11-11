"""Writing what the browser side will read: chunk geometry as glTF, lightmaps, the sky."""
import math

import numpy as np

from common import linear_to_srgb
from glbio import GlbWriter


def runtime_material(name, mats):
    """Plain surfaces all draw with one browser material."""
    return "plain" if mats[name].get("plain") else name


def write_chunk_glb(path, chunk, data, table):
    """One node per lightmap page and material. Positions sit on a lattice of 1/512 m (1/256 m for
    a mesh wider than 128 m), stored as 16 bit integers with the node's scale and translation."""
    mats = table["materials"]
    names = [str(n) for n in data["mat_names"]]
    rt = np.array([runtime_material(n, mats) for n in names])
    rt_names = sorted(set(rt[np.unique(data["mat"])]))
    rt_index = np.array([rt_names.index(r) if r in rt_names else -1 for r in rt])
    face_rt = rt_index[data["mat"]]
    w = GlbWriter()
    prims = []
    total_tris = 0
    total_verts = 0
    lo_all = np.full(3, np.inf)
    hi_all = np.full(3, -np.inf)
    for page in range(int(data["npages"])):
        for ri, rname in enumerate(rt_names):
            sel = (data["page"] == page) & (face_rt == ri)
            nf = int(sel.sum())
            if nf == 0:
                continue
            P = data["P"][sel].reshape(-1, 3).astype(np.float64)
            N = data["N"][sel].reshape(-1, 3).astype(np.float64)
            uv0 = data["uv0"][sel].reshape(-1, 2).astype(np.float64)
            uv1 = data["uv1_rt"][sel].reshape(-1, 2).astype(np.float64)
            tint = data["tint"][sel].reshape(-1, 3).astype(np.float64)
            lo = P.min(axis=0)
            hi = P.max(axis=0)
            lo_all = np.minimum(lo_all, lo)
            hi_all = np.maximum(hi_all, hi)
            k = 9
            while (hi - lo).max() * (1 << k) > 65000 and k > 0:
                k -= 1
            step = 1.0 / (1 << k)
            origin = np.floor(lo / step)
            qp = np.round(P / step) - origin
            qp = np.clip(qp, 0, 65535).astype(np.uint16)
            N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
            qn = np.round(N * 127).astype(np.int8)
            # glTF reads images top row first: v flips. Tiling coordinates keep to a 1/2048 grid.
            q0 = np.stack([uv0[:, 0], 1.0 - uv0[:, 1]], axis=1)
            q0 = (np.round(q0 * 2048) / 2048).astype(np.float32)
            q1 = np.stack([uv1[:, 0], 1.0 - uv1[:, 1]], axis=1)
            q1 = np.clip(np.round(q1 * 65535), 0, 65535).astype(np.uint16)
            qc = np.clip(np.round(tint * 255), 0, 255).astype(np.uint8)
            rec = np.zeros(len(P), dtype=[("p", np.uint16, 4), ("n", np.int8, 4), ("t0", np.float32, 2), ("t1", np.uint16, 2), ("c", np.uint8, 4)])
            rec["p"][:, :3] = qp
            rec["n"][:, :3] = qn
            rec["t0"] = q0
            rec["t1"] = q1
            rec["c"][:, :3] = qc
            rec["c"][:, 3] = 255
            flat = rec.view(np.dtype((np.void, rec.dtype.itemsize)))
            _, first, inverse = np.unique(flat, return_index=True, return_inverse=True)
            # Keep vertices in the order they first appear, which is kinder to the compressor.
            order = np.argsort(first)
            rank = np.empty(len(order), dtype=np.int64)
            rank[order] = np.arange(len(order))
            verts = rec[first[order]]
            index = rank[inverse.reshape(-1)].astype(np.uint32)
            tri = index.reshape(-1, 3)
            good = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
            index = tri[good].reshape(-1)
            if len(index) == 0:
                continue
            attrs = {
                "POSITION": w.accessor(verts["p"], "VEC3", 34962, minmax=True),
                "NORMAL": w.accessor(verts["n"], "VEC3", 34962, normalized=True),
                "TEXCOORD_0": w.accessor(verts["t0"], "VEC2", 34962),
                "TEXCOORD_1": w.accessor(verts["t1"], "VEC2", 34962, normalized=True),
                "COLOR_0": w.accessor(verts["c"], "VEC4", 34962, normalized=True),
            }
            ind = w.accessor(index, "SCALAR", 34963)
            name = f"{chunk}.{page}.{rname}"
            w.node(name, attrs, ind, w.material(rname), translation=origin * step, scale=[step] * 3, extras={"page": page, "material": rname})
            ntri = len(index) // 3
            total_tris += ntri
            total_verts += len(verts)
            prims.append({"name": name, "material": rname, "page": page, "triangles": ntri, "vertices": int(len(verts)),
                          "box": [round(float(x), 3) for x in np.concatenate([lo, hi])]})
    size = w.write(path, extras={"chunk": chunk}, extensions_used=["KHR_mesh_quantization"])
    return {
        "triangles": total_tris, "vertices": total_verts, "drawCalls": len(prims), "plainBytes": size,
        "box": [round(float(x), 3) for x in np.concatenate([lo_all, hi_all])] if prims else [0, 0, 0, 0, 0, 0],
        "materials": rt_names, "primitives": prims,
    }


def write_lightmap(path, rgb, scale):
    """rgb: (size, size, 3) linear irradiance, row 0 at v = 0. Stored as sRGB bytes of rgb / scale,
    with a little noise under the rounding so slow gradients do not band."""
    from PIL import Image

    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    stats = {"median": float(np.median(lum)), "p99": float(np.percentile(lum, 99)), "p1": float(np.percentile(lum, 1)),
             "clipped": float((rgb.max(axis=2) > scale).mean())}
    enc = linear_to_srgb(np.clip(rgb / scale, 0, 1)) * 255.0
    rng = np.random.default_rng(7)
    enc = enc + (rng.random(enc.shape[:2])[:, :, None] - 0.5) * 0.9
    out = np.clip(np.round(enc), 0, 255).astype(np.uint8)[::-1]
    Image.fromarray(out, "RGB").save(path, optimize=False, compress_level=3)
    return stats


def write_hdr(path, rgb):
    """Radiance .hdr, flat (no run lengths). rgb: (h, w, 3) linear, top row first."""
    h, w, _ = rgb.shape
    rgb = np.maximum(rgb.astype(np.float64), 0)
    mx = rgb.max(axis=2)
    e = np.zeros((h, w), dtype=np.int64)
    nz = mx > 1e-32
    e[nz] = np.ceil(np.log2(mx[nz])).astype(np.int64)
    # frexp convention: mantissa in [0.5, 1)
    same = nz & (mx == np.power(2.0, e))
    e[same] += 1
    scale = np.where(nz, 256.0 / np.power(2.0, e.astype(np.float64)), 0)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[:, :, :3] = np.clip(np.floor(rgb * scale[:, :, None]), 0, 255).astype(np.uint8)
    out[:, :, 3] = np.where(nz, e + 128, 0).astype(np.uint8)
    with open(path, "wb") as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n")
        f.write(f"-Y {h} +X {w}\n".encode("ascii"))
        f.write(out.tobytes())
