"""Turns one exported chunk into the real look's geometry. Pure numpy, no Blender needed.

    surfaces sorted into materials (materials.json)
    fake drawn shadows dropped
    tree crowns rebuilt as leaf cards inside the drawn lump, hedges as a small dark core inside cards
    first uv set at true scale, second uv set packed for the lightmap

Everything stays in the ink world's own space: x east, y up, z south, metres.
"""
import fnmatch
import math
import os

import numpy as np

from common import EXPORT_DIR, hex_to_rgb, log, srgb_to_linear
from glbio import read_glb


# ---------------------------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------------------------


def load_chunk(chunk):
    """One soup for the whole chunk. Per vertex: P, N, UV, C, D, K, part (global), mesh. Faces F."""
    _doc, meshes = read_glb(os.path.join(EXPORT_DIR, f"{chunk}.glb"))
    P, N, UV, C, D, K, part, mesh, F = [], [], [], [], [], [], [], [], []
    names = []
    voff = 0
    poff = 0
    for mi, m in enumerate(meshes):
        n = len(m["POSITION"])
        idx = m["index"].reshape(-1, 3)
        p = m["_PART"].astype(np.int64)
        P.append(m["POSITION"].astype(np.float64))
        N.append(m["NORMAL"].astype(np.float64))
        UV.append(m["TEXCOORD_0"].astype(np.float64))
        C.append(m["COLOR_0"])
        D.append(m["_DATA"])
        K.append(m["_INK"])
        part.append(p + poff)
        mesh.append(np.full(n, mi, dtype=np.int64))
        F.append(idx + voff)
        names.append(m["name"])
        voff += n
        poff += int(p.max()) + 1 if n else 0
    if not P:
        z = np.zeros
        return dict(P=z((0, 3)), N=z((0, 3)), UV=z((0, 2)), C=z((0, 4), np.uint8), D=z((0, 4), np.uint8), K=z((0, 4), np.uint8),
                    part=z(0, np.int64), mesh=z(0, np.int64), F=z((0, 3), np.int64), names=[])
    return dict(
        P=np.concatenate(P), N=np.concatenate(N), UV=np.concatenate(UV), C=np.concatenate(C), D=np.concatenate(D), K=np.concatenate(K),
        part=np.concatenate(part), mesh=np.concatenate(mesh), F=np.concatenate(F), names=names,
    )


# ---------------------------------------------------------------------------------------------
# What each part is: numbers a rule can test
# ---------------------------------------------------------------------------------------------


def rgb_to_hsv(rgb):
    r, g, b = rgb[:, 0] / 255.0, rgb[:, 1] / 255.0, rgb[:, 2] / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-9
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = ((g[rm] - b[rm]) / d[rm]) % 6
    h[gm] = (b[gm] - r[gm]) / d[gm] + 2
    h[bm] = (r[bm] - g[bm]) / d[bm] + 4
    s = np.where(mx > 1e-9, d / np.maximum(mx, 1e-9), 0)
    return h * 60.0, s, mx


def face_geometry(P, F):
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    cr = np.cross(b - a, c - a)
    area = 0.5 * np.linalg.norm(cr, axis=1)
    ng = cr / np.maximum(2 * area[:, None], 1e-20)
    return area, ng


def features(S, unit, nunits, ground_y):
    """Per classification unit (a part, or a single face on the terrain)."""
    P, F, C, D, K = S["P"], S["F"], S["C"], S["D"], S["K"]
    area, ng = face_geometry(P, F)
    w = np.maximum(area, 1e-12)
    tot = np.bincount(unit, weights=w, minlength=nunits)
    tot = np.maximum(tot, 1e-12)

    def mean(v):
        return np.bincount(unit, weights=v * w, minlength=nunits) / tot

    fc = C[F].astype(np.float64)  # faces, 3, 4
    rgb = np.stack([mean(fc[:, :, k].mean(axis=1)) for k in range(3)], axis=1)
    hue, sat, val = rgb_to_hsv(rgb)
    fd = D[F].astype(np.float64)
    fk = K[F].astype(np.float64)
    f = {
        "r": rgb[:, 0], "g": rgb[:, 1], "b": rgb[:, 2], "hue": hue, "sat": sat, "val": val,
        "flat": mean(fc[:, :, 3].mean(axis=1)) / 255.0,
        "hatch": mean(fd[:, :, 1].mean(axis=1)) / 255.0,
        "dither": mean(fd[:, :, 2].mean(axis=1)) / 255.0,
        "area": np.bincount(unit, weights=area, minlength=nunits),
        "up": mean((ng[:, 1] > 0.7).astype(np.float64)),
        "down": mean((ng[:, 1] < -0.7).astype(np.float64)),
        "tris": np.bincount(unit, minlength=nunits).astype(np.float64),
    }
    f["side"] = 1 - f["up"] - f["down"]
    mx = np.full((nunits, 3), -np.inf)
    mn = np.full((nunits, 3), np.inf)
    sway = np.zeros(nunits)
    noedge = np.zeros(nunits)
    letter = np.zeros(nunits)
    cmin = np.full((nunits, 3), 255.0)
    cmax = np.zeros((nunits, 3))
    for k in range(3):
        vi = F[:, k]
        np.maximum.at(mx, unit, P[vi])
        np.minimum.at(mn, unit, P[vi])
        np.maximum.at(sway, unit, D[vi, 3].astype(np.float64))
        np.maximum.at(noedge, unit, (D[vi, 0] == 255).astype(np.float64))
        np.maximum.at(letter, unit, K[vi, 3].astype(np.float64))
        np.minimum.at(cmin, unit, C[vi, :3].astype(np.float64))
        np.maximum.at(cmax, unit, C[vi, :3].astype(np.float64))
    size = np.where(np.isfinite(mx - mn), mx - mn, 0)
    # Box sizes along the part's own axes as well as the world's: a sheet of paper turned 30 degrees
    # is still 10 cm thick. The axes come from the spread of its corners, weighted by area.
    wc = np.repeat(w, 3) / 3.0
    uc = np.repeat(unit, 3)
    pc = P[F.reshape(-1)]
    tw = np.maximum(np.bincount(uc, weights=wc, minlength=nunits), 1e-12)
    mu = np.stack([np.bincount(uc, weights=wc * pc[:, k], minlength=nunits) for k in range(3)], axis=1) / tw[:, None]
    dp = pc - mu[uc]
    cov = np.zeros((nunits, 3, 3))
    for i in range(3):
        for j in range(i, 3):
            v = np.bincount(uc, weights=wc * dp[:, i] * dp[:, j], minlength=nunits) / tw
            cov[:, i, j] = v
            cov[:, j, i] = v
    _ev, axes = np.linalg.eigh(cov + np.eye(3)[None] * 1e-12)
    ext = np.zeros((nunits, 3))
    for k in range(3):
        proj = np.einsum("ij,ij->i", dp, axes[uc][:, :, k])
        hi_ = np.full(nunits, -np.inf)
        lo_ = np.full(nunits, np.inf)
        np.maximum.at(hi_, uc, proj)
        np.minimum.at(lo_, uc, proj)
        ext[:, k] = np.where(np.isfinite(hi_ - lo_), hi_ - lo_, 0)
    ext.sort(axis=1)
    f["depth"] = ext[:, 0]
    f["breadth"] = ext[:, 1]
    f["length"] = ext[:, 2]
    f["dx"], f["dy"], f["dz"] = size[:, 0], size[:, 1], size[:, 2]
    f["size"] = np.linalg.norm(size, axis=1)
    f["wide"] = np.maximum(size[:, 0], size[:, 2])
    f["thin"] = np.min(size, axis=1)
    f["y"] = np.where(np.isfinite(mn[:, 1]), mn[:, 1], 0) - ground_y
    f["top"] = np.where(np.isfinite(mx[:, 1]), mx[:, 1], 0) - ground_y
    f["sway"] = sway / 255.0
    f["noedge"] = noedge
    f["letter"] = letter
    f["gradient"] = np.linalg.norm(cmax - cmin, axis=1)
    # A drawn shadow is a solid squashed flat onto the ground: level, and about half of its
    # triangles wind the wrong way round. A painted mark is level too but all of it faces up.
    planar = size[:, 1] < 2e-3
    back = mean((ng[:, 1] < -0.5).astype(np.float64))
    degenerate = np.bincount(unit, weights=(area < 1e-9).astype(np.float64), minlength=nunits) / np.maximum(f["tris"], 1)
    f["planar"] = planar.astype(np.float64)
    f["squashed"] = (planar & ((back > 0.2) | (degenerate > 0.3)) & (f["tris"] >= 4)).astype(np.float64)
    return f, area, ng


def _range(v, lo_hi):
    lo, hi = lo_hi
    m = np.ones(len(v), dtype=bool)
    if lo is not None:
        m &= v >= lo
    if hi is not None:
        m &= v <= hi
    return m


def rule_mask(when, f, chunk, unit_mesh_name):
    n = len(f["r"])
    m = np.ones(n, dtype=bool)
    for key, want in when.items():
        if key == "chunk":
            pats = want if isinstance(want, list) else [want]
            if not any(fnmatch.fnmatch(chunk, p) for p in pats):
                return np.zeros(n, dtype=bool)
        elif key == "mesh":
            pats = want if isinstance(want, list) else [want]
            ok = np.array([any(fnmatch.fnmatch(name, p) for p in pats) for name in unit_mesh_name["names"]], dtype=bool)
            m &= ok[unit_mesh_name["index"]]
        elif key == "hue":
            lo, hi = want
            h = f["hue"]
            m &= ((h >= lo) & (h <= hi)) if lo <= hi else ((h >= lo) | (h <= hi))
        elif key == "near":
            cols = want[:-1]
            dist = float(want[-1])
            rgb = np.stack([f["r"], f["g"], f["b"]], axis=1)
            ok = np.zeros(n, dtype=bool)
            for c in cols:
                ok |= np.linalg.norm(rgb - hex_to_rgb(c)[None, :], axis=1) <= dist
            m &= ok
        elif isinstance(want, bool):
            m &= (f[key] > 0) == want
        else:
            m &= _range(f[key], want)
    return m


def face_components(P, F, part, sway=None):
    """The export keeps adds that share an outline id as one part. Here each piece that hangs
    together (shares corner positions) inside a part becomes a piece of its own."""
    if len(F) == 0:
        return np.zeros(0, dtype=np.int64)
    q = np.round(P * 2000).astype(np.int64)
    # The export starts a new part wherever the sway changes, so a swaying shrub arrives as dozens
    # of parts of one to four triangles. Swaying corners weld across parts.
    group = part if sway is None else np.where(sway > 0, -1, part)
    key = np.concatenate([q, group[:, None]], axis=1)
    _, vid = np.unique(key, axis=0, return_inverse=True)
    vid = vid.reshape(-1)
    fv = vid[F]
    a = np.concatenate([fv[:, 0], fv[:, 1]])
    b = np.concatenate([fv[:, 1], fv[:, 2]])
    label = connected_components(int(vid.max()) + 1, a, b)
    _, comp = np.unique(label[fv[:, 0]], return_inverse=True)
    return comp.reshape(-1)


def classify(S, table, chunk, ground_y):
    """Material name per face, and a keep mask. Rules run top to bottom, the first that fits wins."""
    F = S["F"]
    names = S["names"]
    face_mesh = S["mesh"][F[:, 0]]
    face_part = S["piece"]
    per_face = np.array([any(fnmatch.fnmatch(n, p) for p in table.get("perFace", [])) for n in names], dtype=bool)
    unit = face_part.copy()
    pf = per_face[face_mesh] if len(names) else np.zeros(len(F), dtype=bool)
    nparts = int(face_part.max()) + 1 if len(face_part) else 0
    unit[pf] = nparts + np.arange(int(pf.sum()))
    nunits = nparts + int(pf.sum())
    f, area, ng = features(S, unit, nunits, ground_y)
    unit_mesh = np.zeros(nunits, dtype=np.int64)
    unit_mesh[unit] = face_mesh
    lookup = {"names": names, "index": unit_mesh}

    mat_of_unit = np.full(nunits, -1, dtype=np.int64)
    mat_names = []
    rule_hits = []
    for rule in table["rules"]:
        m = rule_mask(rule["when"], f, chunk, lookup) & (mat_of_unit < 0)
        name = rule["material"]
        if name not in mat_names:
            mat_names.append(name)
        mat_of_unit[m] = mat_names.index(name)
        rule_hits.append((rule.get("name", name), name, float(f["area"][m].sum()), int(m.sum())))
    face_mat = mat_of_unit[unit]
    return face_mat, mat_names, f, unit, rule_hits, area, ng


# ---------------------------------------------------------------------------------------------
# Tint: how the authored colour shows through the real surface
# ---------------------------------------------------------------------------------------------


def tint_for(mat, src_rgb):
    """src_rgb: n by 3 sRGB bytes. Returns linear multipliers in 0..1 for COLOR_0."""
    lin = srgb_to_linear(src_rgb / 255.0)
    amount = float(mat.get("tint", 1.0))
    mode = mat.get("tintMode", "rgb")
    if mat.get("texture") is None and "ref" not in mat:
        # Paint: the authored colour is the surface colour. Poster colours are brighter than any
        # paint, so they are pulled down a little.
        return np.clip(lin * float(mat.get("albedo", 0.82)), 0, 1)
    ref = srgb_to_linear(hex_to_rgb(mat.get("ref", "#ffffff")) / 255.0)
    ratio = lin / np.maximum(ref[None, :], 1e-4)
    if mode in ("luma", "hue"):
        y = (lin @ np.array([0.2126, 0.7152, 0.0722])) / max(float(ref @ np.array([0.2126, 0.7152, 0.0722])), 1e-4)
        luma = np.repeat(y[:, None], 3, axis=1)
        if mode == "luma":
            ratio = luma
        else:
            # Pale grey paint takes the stone's own colour; a drawn colour with real saturation
            # keeps its hue, so a violet block stays violet under the texture.
            mx_ = src_rgb.max(axis=1)
            sat = np.where(mx_ > 0, (mx_ - src_rgb.min(axis=1)) / np.maximum(mx_, 1e-6), 0)
            lo_s, hi_s = mat.get("hueSat", [0.05, 0.2])
            k = np.clip((sat - lo_s) / max(hi_s - lo_s, 1e-6), 0, 1)[:, None]
            ratio = luma * (1 - k) + ratio * k
    lo, hi = mat.get("tintClamp", [0.35, 1.0])
    t = 1 + (np.clip(ratio, lo, hi) - 1) * amount
    return np.clip(t * float(mat.get("gain", 1.0)), 0, 1)


def value_noise(xz, scale, seed):
    """Smooth noise in 0..1 on the ground plane, for patchy grass."""
    p = xz / scale
    i = np.floor(p).astype(np.int64)
    fr = p - i
    fr = fr * fr * (3 - 2 * fr)

    def h(ix, iz):
        n = (ix * 374761393 + iz * 668265263 + seed * 1442695041) & 0xFFFFFFFF
        n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0

    a = h(i[:, 0], i[:, 1])
    b = h(i[:, 0] + 1, i[:, 1])
    c = h(i[:, 0], i[:, 1] + 1)
    d = h(i[:, 0] + 1, i[:, 1] + 1)
    return (a * (1 - fr[:, 0]) + b * fr[:, 0]) * (1 - fr[:, 1]) + (c * (1 - fr[:, 0]) + d * fr[:, 0]) * fr[:, 1]


# ---------------------------------------------------------------------------------------------
# Leaves
# ---------------------------------------------------------------------------------------------


def make_foliage(S, face_mat, mat_names, table, face_part, area, ng, rng, budget_tris):
    """For every part sorted into a leafy material: leaf cards inside the drawn lump, and the lump
    either shrunk into a dark core or dropped. Returns extra corner arrays for the cards, the core
    faces, the moved positions and the faces to drop."""
    mats = table["materials"]
    leafy = [i for i, n in enumerate(mat_names) if mats[n].get("kind") == "foliage"]
    out = {"P": [], "N": [], "UV": [], "rgb": [], "mat": [], "part": [], "crown": []}
    core_faces = np.zeros(len(face_mat), dtype=bool)
    drop_faces = np.zeros(len(face_mat), dtype=bool)
    crowns = 0
    P, F, C = S["P"], S["F"], S["C"]
    if not leafy:
        return out, core_faces, P, drop_faces
    P = P.copy()
    sel = np.isin(face_mat, leafy)
    core_faces = sel
    parts = np.unique(face_part[sel])
    total_area = float(area[sel].sum())
    order = np.argsort(face_part[sel], kind="stable")
    sel_idx = np.nonzero(sel)[0][order]
    starts = np.searchsorted(face_part[sel_idx], parts)
    ends = np.append(starts[1:], len(sel_idx))
    up = np.array([0.0, 1.0, 0.0])

    def crown_shape(pi):
        fi = sel_idx[starts[pi] : ends[pi]]
        m = mats[mat_names[int(face_mat[fi[0]])]]
        vi = np.unique(F[fi])
        lo, hi = P[vi].min(axis=0), P[vi].max(axis=0)
        radius = float(np.linalg.norm(hi - lo)) / 2
        half = np.maximum((hi - lo) / 2, max(float((hi - lo).max()) * 0.12, 0.05))
        size = float(np.clip(radius * m.get("cardSize", 0.5), m.get("cardSizeMin", 0.3), m.get("cardSizeMax", 1.3)))
        if float(m.get("fit", 0)) > 0:
            # A card no bigger than the crown it is in, or the fitting below cuts it to a sprig.
            size = float(np.clip(min(size, float(half.mean()) * float(m.get("cardFit", 0.8))), m.get("cardSizeMin", 0.3) * 0.5, m.get("cardSizeMax", 1.3)))
        n = float(area[fi].sum()) * m.get("cards", 1.0)
        if m.get("cover"):
            # Enough leaf to read as a mass: the cards together cover the crown's middle shell
            # about `cover` times over (a spray is a little over half leaf, and the fitting trims a
            # card to about two thirds). Small shrubs and ivy need more than their area gives them.
            shell = 4 * math.pi * float((half * 0.55).mean()) ** 2
            n = max(n, float(m["cover"]) * shell / (0.55 * (0.67 * size) ** 2))
        return n, size, half

    shapes = [crown_shape(pi) for pi in range(len(parts))]
    # Keep inside the triangle budget: fewer cards everywhere when there is a lot of leaf.
    want = sum(n for n, _s, _h in shapes)
    scale = min(1.0, budget_tris / max(1.0, want * 2))
    if os.environ.get("LS_DEBUG_LEAVES"):
        log(f"leaves: {len(parts)} crowns want {want:.0f} cards, budget {budget_tris // 2}, scale {scale:.2f}")
    for pi in range(len(parts)):
        fi = sel_idx[starts[pi] : ends[pi]]
        mi = int(face_mat[fi[0]])
        m = mats[mat_names[mi]]
        vi = np.unique(F[fi])
        lo, hi = P[vi].min(axis=0), P[vi].max(axis=0)
        centre = (lo + hi) / 2
        radius = float(np.linalg.norm(hi - lo)) / 2
        half = np.maximum((hi - lo) / 2, max(float((hi - lo).max()) * 0.12, 0.05))
        a = area[fi]
        A = float(a.sum())
        if A < 1e-6:
            continue
        n_want, size, _half = shapes[pi]
        n_cards = int(np.clip(round(n_want * scale), m.get("cardsMin", 4), m.get("cardsMax", 40)))
        fit = float(m.get("fit", 0))
        pick = rng.choice(len(fi), size=n_cards, p=a / A)
        tri = F[fi[pick]]
        r1 = np.sqrt(rng.random(n_cards))
        r2 = rng.random(n_cards)
        bary = np.stack([1 - r1, r1 * (1 - r2), r1 * r2], axis=1)
        pts = (P[tri] * bary[:, :, None]).sum(axis=1)
        col = (C[tri][:, :, :3].astype(np.float64) * bary[:, :, None]).sum(axis=1)
        nrm = ng[fi[pick]]
        outward = pts - centre[None, :]
        flip = (nrm * outward).sum(axis=1) < 0
        nrm[flip] *= -1
        if fit > 0:
            # Leaves stay inside the drawn crown: a card's centre sits on a shell inside the lump
            # (as a share of the lump's own half size), and the card is cut down until its corners
            # are inside `fit` of the lump. So a crown is never bigger than the drawing.
            q = outward / half[None, :]
            dq = q / np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-9)
            s_lo, s_hi = m.get("shell", [0.45, 0.8])
            t_ = s_lo + (s_hi - s_lo) * np.sqrt(rng.random(n_cards))
            pts = centre[None, :] + dq * t_[:, None] * half[None, :]
            nrm = dq / half[None, :]
            nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        rnd = rng.normal(size=(n_cards, 3))
        rnd /= np.maximum(np.linalg.norm(rnd, axis=1, keepdims=True), 1e-9)
        mdir = nrm * 0.55 + rnd * 0.8
        mdir /= np.maximum(np.linalg.norm(mdir, axis=1, keepdims=True), 1e-9)
        back = (mdir * nrm).sum(axis=1) < 0
        mdir[back] *= -1
        ref = np.where(np.abs(mdir[:, 1:2]) > 0.9, np.array([[1.0, 0, 0]]), up[None, :])
        t = np.cross(ref, mdir)
        t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
        b = np.cross(mdir, t)
        roll = rng.random(n_cards) * math.tau
        cr, sr = np.cos(roll)[:, None], np.sin(roll)[:, None]
        t, b = t * cr + b * sr, b * cr - t * sr
        s = size * (0.75 + 0.5 * rng.random(n_cards))[:, None]
        c0 = pts + nrm * (s * 0.18) if fit <= 0 else pts

        def corners(s):
            return np.stack([c0 - t * s / 2 - b * s / 2, c0 + t * s / 2 - b * s / 2, c0 + t * s / 2 + b * s / 2, c0 - t * s / 2 + b * s / 2], axis=1)

        quad = corners(s)
        if fit > 0:
            # First a card that pokes out moves in toward the middle, as far as the inner edge of
            # the shell allows; only then is it cut down. A narrow crown (a cypress) keeps cards of
            # a useful size that way, filling its middle, where it would otherwise get slivers.
            reach = np.linalg.norm((quad - centre[None, None, :]) / half[None, None, :], axis=2).max(axis=1)
            over = reach > fit
            if over.any():
                tc = np.linalg.norm((c0 - centre[None, :]) / half[None, :], axis=1)
                inner = float(m.get("shell", [0.45, 0.8])[0]) * 0.5
                t_new = np.maximum(inner, tc - (reach - fit))
                c0 = np.where(over[:, None], centre[None, :] + (c0 - centre[None, :]) * (t_new / np.maximum(tc, 1e-6))[:, None], c0)
                quad = corners(s)
            tc = np.linalg.norm((c0 - centre[None, :]) / half[None, :], axis=1)
            for _ in range(3):
                reach = np.linalg.norm((quad - centre[None, None, :]) / half[None, None, :], axis=2).max(axis=1)
                over = reach > fit
                if not over.any():
                    break
                k = np.clip((fit - tc) / np.maximum(reach - tc, 1e-6), 0.25, 1.0)
                s = np.where(over[:, None], s * k[:, None], s)
                quad = corners(s)
        qn = quad - centre[None, None, :]
        qn /= np.maximum(np.linalg.norm(qn, axis=2, keepdims=True), 1e-9)
        qn = qn * 0.75 + up[None, None, :] * 0.25
        qn /= np.maximum(np.linalg.norm(qn, axis=2, keepdims=True), 1e-9)
        cols_, rows_ = m.get("atlas", [1, 1])
        cells = m.get("cells") or [[cx, cy] for cy in range(rows_) for cx in range(cols_)]
        cell = np.array(cells)[rng.integers(0, len(cells), n_cards)]
        u0 = cell[:, 0] / cols_
        v0 = cell[:, 1] / rows_
        du, dv = 1 / cols_, 1 / rows_
        inset = 0.004
        quv = np.stack([
            np.stack([u0 + inset, v0 + inset], axis=1),
            np.stack([u0 + du - inset, v0 + inset], axis=1),
            np.stack([u0 + du - inset, v0 + dv - inset], axis=1),
            np.stack([u0 + inset, v0 + dv - inset], axis=1),
        ], axis=1)
        mirror = rng.random(n_cards) < 0.5
        quv[mirror] = quv[mirror][:, [1, 0, 3, 2], :]
        card_mat = m.get("cardMaterial")
        if card_mat not in mat_names:
            mat_names.append(card_mat)
        cm = mat_names.index(card_mat)
        for tri_idx in ((0, 1, 2), (0, 2, 3)):
            out["P"].append(quad[:, tri_idx, :])
            out["N"].append(qn[:, tri_idx, :])
            out["UV"].append(quv[:, tri_idx, :])
            out["rgb"].append(np.repeat(col[:, None, :], 3, axis=1))
            out["mat"].append(np.full(n_cards, cm))
            out["part"].append(np.full(n_cards, -1))
            out["crown"].append(np.full(n_cards, crowns))
        crowns += 1
        # The lump itself becomes the dark inside of the crown. With "core": 0 it goes: seen from
        # above or between the leaves, a faceted lump gives the drawing away.
        shrink = float(m.get("core", 0.8))
        if shrink <= 0:
            drop_faces[fi] = True
        else:
            P[vi] = centre[None, :] + (P[vi] - centre[None, :]) * shrink
    return out, core_faces, P, drop_faces


# ---------------------------------------------------------------------------------------------
# Lightmap charts
# ---------------------------------------------------------------------------------------------


def connected_components(n, a, b):
    """Labels for n nodes joined by edges a-b. Min label spreading with pointer jumping."""
    label = np.arange(n)
    if len(a) == 0:
        return label
    while True:
        m = np.minimum(label[a], label[b])
        new = label.copy()
        np.minimum.at(new, a, m)
        np.minimum.at(new, b, m)
        new = new[new]
        new = new[new]
        if np.array_equal(new, label):
            return label
        label = new


def make_charts(P3, face_key, ng, area, split=6.0, split_over=24.0):
    """P3: faces by 3 by 3 corner positions. face_key: an integer per face; faces only join inside
    one key. Returns chart id per face and 2D corner coordinates in metres, each chart turned so
    its outline lies square to the axes. Charts that are huge or mostly empty (a ring of kerb, a
    long curved path) are cut into square cells so they pack."""
    nf = len(P3)
    axis = np.argmax(np.abs(ng), axis=1)
    sign = np.take_along_axis(ng, axis[:, None], axis=1)[:, 0] < 0
    group = axis * 2 + sign
    key = face_key * 6 + group
    # Weld corners by position so faces that were split at a crease still count as neighbours.
    q = np.round(P3.reshape(-1, 3) * 2000).astype(np.int64)
    _, vid = np.unique(q, axis=0, return_inverse=True)
    vid = vid.reshape(nf, 3)
    ea = np.concatenate([vid[:, 0], vid[:, 1], vid[:, 2]])
    eb = np.concatenate([vid[:, 1], vid[:, 2], vid[:, 0]])
    lo = np.minimum(ea, eb)
    hi = np.maximum(ea, eb)
    ef = np.concatenate([np.arange(nf)] * 3)
    ek = key[ef]
    order = np.lexsort((hi, lo, ek))
    slo, shi, sek, sef = lo[order], hi[order], ek[order], ef[order]
    same = (slo[1:] == slo[:-1]) & (shi[1:] == shi[:-1]) & (sek[1:] == sek[:-1])
    label = connected_components(nf, sef[:-1][same], sef[1:][same])
    _, chart = np.unique(label, return_inverse=True)
    chart = chart.reshape(-1)
    nc = int(chart.max()) + 1 if nf else 0
    # Flatten: drop the axis the chart faces along.
    ua = np.array([2, 0, 0])[axis]
    va = np.array([1, 2, 1])[axis]
    u = np.take_along_axis(P3, ua[:, None, None].repeat(3, axis=1), axis=2)[:, :, 0]
    v = np.take_along_axis(P3, va[:, None, None].repeat(3, axis=1), axis=2)[:, :, 0]
    # Turn each chart square to its own outline: the outline edges vote, with four-fold symmetry.
    inner = np.zeros(3 * nf, dtype=bool)
    inner[order[:-1][same]] = True
    inner[order[1:][same]] = True
    k = np.repeat(np.arange(3), nf)
    f = np.tile(np.arange(nf), 3)
    du = u[f, (k + 1) % 3] - u[f, k]
    dv = v[f, (k + 1) % 3] - v[f, k]
    length = np.hypot(du, dv)
    ang = np.arctan2(dv, du)
    wgt = np.where(inner, 0.0, length)
    zr = np.bincount(chart[f], weights=wgt * np.cos(4 * ang), minlength=nc)
    zi = np.bincount(chart[f], weights=wgt * np.sin(4 * ang), minlength=nc)
    theta = np.arctan2(zi, zr) / 4
    c, s_ = np.cos(theta)[chart][:, None], np.sin(theta)[chart][:, None]
    u, v = u * c + v * s_, -u * s_ + v * c
    # Cut the awkward ones into cells.
    cmin_u = np.full(nc, np.inf)
    cmax_u = np.full(nc, -np.inf)
    cmin_v = np.full(nc, np.inf)
    cmax_v = np.full(nc, -np.inf)
    for j in range(3):
        np.minimum.at(cmin_u, chart, u[:, j])
        np.maximum.at(cmax_u, chart, u[:, j])
        np.minimum.at(cmin_v, chart, v[:, j])
        np.maximum.at(cmax_v, chart, v[:, j])
    eu = cmax_u - cmin_u
    ev = cmax_v - cmin_v
    carea = np.bincount(chart, weights=area, minlength=nc)
    fill = carea / np.maximum(eu * ev, 1e-9)
    big = np.maximum(eu, ev)
    cell = np.where((big > split * 1.5) & (fill < 0.55), split, np.where(big > split_over, split_over / 2, 0.0))
    cut = cell[chart] > 0
    if cut.any():
        cu = u[cut].mean(axis=1)
        cv = v[cut].mean(axis=1)
        cs_ = cell[chart[cut]]
        iu = np.floor((cu - cmin_u[chart[cut]]) / cs_).astype(np.int64)
        iv = np.floor((cv - cmin_v[chart[cut]]) / cs_).astype(np.int64)
        sub = np.zeros(nf, dtype=np.int64)
        sub[cut] = 1 + iu + iv * 4096
        _, chart = np.unique(chart.astype(np.int64) * (1 << 26) + sub, return_inverse=True)
        chart = chart.reshape(-1)
    return chart, np.stack([u, v], axis=2)


def shelf_pack(w, h, size):
    """Rectangles (already padded, even) into a square. Returns x, y or None if they do not fit."""
    order = np.lexsort((-w, -h))
    x = np.zeros(len(w), dtype=np.int64)
    y = np.zeros(len(w), dtype=np.int64)
    cx = 0
    cy = 0
    shelf = 0
    for i in order:
        wi = int(w[i])
        hi = int(h[i])
        if wi > size or hi > size:
            return None
        if cx + wi > size:
            cy += shelf
            cx = 0
            shelf = 0
        if shelf == 0:
            shelf = hi
        if cy + hi > size:
            return None
        x[i] = cx
        y[i] = cy
        cx += wi
    return x, y


def pack_page(cw_m, ch_m, weight, fixed, size, density_cap):
    """Find the texel density at which this page's charts fill the square. cw_m, ch_m in metres.
    `fixed` > 0 marks a chart that holds one light value: a bare block of two by two texels."""

    def sizes(d):
        nu = np.maximum(1, np.ceil(cw_m * d * weight)).astype(np.int64) + 1
        nv = np.maximum(1, np.ceil(ch_m * d * weight)).astype(np.int64) + 1
        aw = ((nu + 2 + 1) // 2) * 2
        ah = ((nv + 2 + 1) // 2) * 2
        # A block of one light value needs no border: two by two texels, bare.
        nu = np.where(fixed > 0, 2, nu)
        nv = np.where(fixed > 0, 2, nv)
        aw = np.where(fixed > 0, 2, aw)
        ah = np.where(fixed > 0, 2, ah)
        return nu, nv, aw, ah

    lo, hi = 0.0, density_cap
    best = None
    # Does it fit at the cap? Then use the cap: no point spending texels nobody can see.
    nu, nv, aw, ah = sizes(hi)
    got = shelf_pack(aw, ah, size)
    if got is not None:
        return hi, nu, nv, got[0], got[1]
    for _ in range(22):
        mid = (lo + hi) / 2
        nu, nv, aw, ah = sizes(mid)
        got = shelf_pack(aw, ah, size) if int((aw * ah).sum()) <= size * size else None
        if got is not None:
            best = (mid, nu, nv, got[0], got[1])
            lo = mid
        else:
            hi = mid
        if hi - lo < 0.01 * max(hi, 1e-6):
            break
    if best is None:
        raise RuntimeError(f"{len(cw_m)} charts do not fit a {size} lightmap even at the lowest density")
    return best


# ---------------------------------------------------------------------------------------------
# The whole build
# ---------------------------------------------------------------------------------------------


def build_chunk(chunk, table, cs, ground_y, seed=1):
    """Returns a dict of arrays ready to become a Blender mesh and a glTF."""
    tune = cs.get("tune") or {}
    if tune:
        # A chunk can change how one of its materials is made (more leaf cards in the city, patchier
        # grass on the ground) without touching the table, so the other chunks keep their bake.
        table = {**table, "materials": {n: {**m, **tune.get(n, {})} for n, m in table["materials"].items()}}
    mats = table["materials"]
    S = load_chunk(chunk)
    rng = np.random.default_rng(seed + sum(ord(c) for c in chunk))
    S["piece"] = face_components(S["P"], S["F"], S["part"], S["D"][:, 3])
    face_mat, mat_names, feat, unit, rule_hits, area, ng = classify(S, table, chunk, ground_y)
    F = S["F"]
    face_part = S["piece"]
    if (face_mat < 0).any():
        raise RuntimeError("a surface matched no rule: the last rule in materials.json has to catch everything")

    # Too many materials is too many draw calls: fold the least used into the one named as its fallback.
    limit = int(cs.get("materialsMax", 12))

    def runtime(n):
        m = mats[n]
        if m.get("kind") == "foliage":
            return mats[m["cardMaterial"]].get("texture") or "plain"
        return "plain" if m.get("plain") else n

    merged = []
    while True:
        used = [i for i in range(len(mat_names)) if (face_mat == i).any() and mats[mat_names[i]].get("kind") != "drop"]
        groups = {}
        for i in used:
            groups.setdefault(runtime(mat_names[i]), []).append(i)
        extra = 1 if any(mats[mat_names[i]].get("kind") == "foliage" for i in used) else 0  # the core is plain
        if len(groups) + (extra if "plain" not in groups else 0) <= limit:
            break

        def target(n):
            """The first material down the fallback chain that this chunk already draws with."""
            seen = {n}
            fb = mats[n].get("fallback")
            while fb and fb not in seen:
                if runtime(fb) in groups and runtime(fb) != runtime(n):
                    return fb
                seen.add(fb)
                fb = mats[fb].get("fallback")
            return None

        cand = [(sum(float(area[face_mat == i].sum()) for i in ids), name, ids) for name, ids in groups.items()
                if any(target(mat_names[i]) for i in ids)]
        if not cand:
            break
        cand.sort()
        _a, name, ids = cand[0]
        for i in ids:
            fb = target(mat_names[i])
            if not fb:
                continue
            if fb not in mat_names:
                mat_names.append(fb)
            face_mat[face_mat == i] = mat_names.index(fb)
        merged.append(name)

    # Soft edges on stone and metal, biggest pieces first, inside the triangle budget.
    budget = max(0, int(cs["triangles"]) - len(F))
    bevel_sel = np.zeros(len(F), dtype=bool)
    bevelled = None
    if cs.get("bevel", True) and budget > 0:
        width_of = np.array([float(mats[n].get("bevel", 0.0)) for n in mat_names])
        bottoms = np.zeros(len(F), dtype=bool)
        if cs.get("dropBottoms", False):
            bottoms = (ng[:, 1] < -0.95) & (S["P"][F][:, :, 1].max(axis=1) < ground_y + 0.04)
        whole = unit == face_part  # not the terrain, which is sorted triangle by triangle
        cand = whole & (width_of[face_mat] > 0) & ~bottoms & (feat["size"][unit] >= float(cs.get("bevelMinSize", 0.7))) & \
            (feat["thin"][unit] >= 6 * width_of[face_mat])
        if cand.any():
            pieces, inv = np.unique(face_part[cand], return_inverse=True)
            tris = np.bincount(inv)
            size_of = feat["size"][unit[cand]][np.unique(inv, return_index=True)[1]]
            order = np.argsort(-size_of)
            allow = int(budget * float(cs.get("bevelShare", 0.4)))
            grow = np.cumsum(tris[order] * 1.7)
            take = np.zeros(len(pieces), dtype=bool)
            take[order[grow <= allow]] = True
            chosen = np.zeros(len(F), dtype=bool)
            chosen[np.nonzero(cand)[0]] = take[inv]
            if chosen.any():
                import detail

                outs = []
                for wv in np.unique(width_of[face_mat[chosen]]):
                    sel = chosen & (width_of[face_mat] == wv)
                    outs.append(detail.bevel(S["P"], F[sel], S["C"][:, :3], face_part[sel], wv))
                mat_of_piece = np.zeros(int(face_part.max()) + 1, dtype=np.int64)
                mat_of_piece[face_part[chosen]] = face_mat[chosen]
                bevelled = (np.concatenate([o[0] for o in outs]), np.concatenate([o[1] for o in outs]),
                            np.concatenate([o[2] for o in outs]), np.concatenate([o[3] for o in outs]))
                bevelled = bevelled + (mat_of_piece[bevelled[3]],)
                bevel_sel = chosen
                budget = max(0, budget - (len(bevelled[0]) - int(chosen.sum())))

    # Leaves, while faces still index the shared vertices.
    cards, core_faces, P, core_drop = make_foliage(S, face_mat, mat_names, table, face_part, area, ng, rng, int(budget * cs.get("leafShare", 0.8)))
    for i, n in enumerate(list(mat_names)):
        core = mats[n].get("coreMaterial")
        if core and mats[n].get("kind") == "foliage":
            if core not in mat_names:
                mat_names.append(core)
            face_mat[face_mat == i] = mat_names.index(core)

    kind = np.array([mats[n].get("kind", "opaque") for n in mat_names])
    keep = kind[face_mat] != "drop"
    if cs.get("dropBottoms", False):
        # The underside of something standing on the pad: nobody sees it and no light reaches it.
        top = S["P"][F][:, :, 1].max(axis=1)
        keep &= ~((ng[:, 1] < -0.95) & (top < ground_y + 0.04))
    keep &= ~bevel_sel
    keep &= ~core_drop
    # Corners.
    Fk = F[keep]
    P3 = P[Fk]
    N3 = S["N"][Fk]
    UV3 = S["UV"][Fk]
    rgb3 = S["C"][Fk][:, :, :3].astype(np.float64)
    ink3 = S["K"][Fk][:, :, :3].astype(np.float64)
    fmat = face_mat[keep]
    fpart = face_part[keep]
    fixed = np.zeros(len(Fk), dtype=np.int64)  # texels a side for charts of a fixed size
    quad_of = np.full(len(Fk), -1, dtype=np.int64)
    crown = np.full(len(Fk), -1, dtype=np.int64)  # which crown a leaf card belongs to

    is_letter = kind[fmat] == "lettering"
    # Letters: each glyph quad is its own little chart, coloured with the ink colour.
    rgb3[is_letter] = ink3[is_letter]
    fixed[is_letter] = 2
    nq = 0
    if is_letter.any():
        # The two triangles of a glyph are written together and both start at its first corner.
        lp = Fk[is_letter].min(axis=1)
        _, q = np.unique(lp, return_inverse=True)
        quad_of[is_letter] = q
        nq = int(q.max()) + 1
    if bevelled is not None:
        bP, bN, bRGB, bPiece, bMat = bevelled
        n = len(bP)
        P3 = np.concatenate([P3, bP])
        N3 = np.concatenate([N3, bN])
        UV3 = np.concatenate([UV3, np.zeros((n, 3, 2))])
        rgb3 = np.concatenate([rgb3, bRGB])
        fmat = np.concatenate([fmat, bMat])
        fpart = np.concatenate([fpart, bPiece])
        fixed = np.concatenate([fixed, np.zeros(n, dtype=np.int64)])
        quad_of = np.concatenate([quad_of, np.full(n, -1, dtype=np.int64)])
        crown = np.concatenate([crown, np.full(n, -1, dtype=np.int64)])
        is_letter = np.concatenate([is_letter, np.zeros(n, dtype=bool)])
    if cards["P"]:
        cP = np.concatenate(cards["P"])
        # Cards were appended as (all first triangles, all second triangles) per part: number quads per pair.
        offs = []
        base = nq
        for k in range(0, len(cards["P"]), 2):
            n = len(cards["P"][k])
            offs.append(np.arange(n) + base)
            offs.append(np.arange(n) + base)
            base += n
        cquad = np.concatenate(offs)
        P3 = np.concatenate([P3, cP])
        N3 = np.concatenate([N3, np.concatenate(cards["N"])])
        UV3 = np.concatenate([UV3, np.concatenate(cards["UV"])])
        rgb3 = np.concatenate([rgb3, np.concatenate(cards["rgb"])])
        fmat = np.concatenate([fmat, np.concatenate(cards["mat"])])
        fpart = np.concatenate([fpart, np.full(len(cP), -1)])
        fixed = np.concatenate([fixed, np.full(len(cP), 2)])
        quad_of = np.concatenate([quad_of, cquad])
        crown = np.concatenate([crown, np.concatenate(cards["crown"])])
        is_letter = np.concatenate([is_letter, np.zeros(len(cP), dtype=bool)])
        kind = np.array([mats[n].get("kind", "opaque") for n in mat_names])
    nf = len(P3)
    area3, ng3 = face_geometry(P3.reshape(-1, 3), np.arange(nf * 3).reshape(nf, 3))
    is_card = (fixed > 0) & ~is_letter

    # A small part gets one block of texels for the whole of it: one light value, no seams.
    tiny_face = np.zeros(nf, dtype=bool)
    tiny = float(cs.get("tinyPart", 0.3))
    valid = (fpart >= 0) & (fixed == 0)
    if tiny > 0 and valid.any():
        n_parts = int(fpart.max()) + 1
        pmin = np.full((n_parts, 3), np.inf)
        pmax = np.full((n_parts, 3), -np.inf)
        for k in range(3):
            np.minimum.at(pmin, fpart[valid], P3[valid][:, k, :])
            np.maximum.at(pmax, fpart[valid], P3[valid][:, k, :])
        with np.errstate(invalid="ignore"):
            small = np.linalg.norm(pmax - pmin, axis=1) < tiny
        tiny_face = valid & small[np.maximum(fpart, 0)]
        if tiny_face.any():
            _, q = np.unique(fpart[tiny_face], return_inverse=True)
            quad_of[tiny_face] = (int(quad_of.max()) + 1) + q
            fixed[tiny_face] = 2

    # ---- tint ---------------------------------------------------------------------------------
    tint = np.ones((nf, 3, 3))
    for i, n in enumerate(mat_names):
        sel = fmat == i
        if not sel.any():
            continue
        m = mats[n]
        t = tint_for(m, rgb3[sel].reshape(-1, 3)).reshape(-1, 3, 3)
        vary = float(m.get("vary", 0))
        if vary > 0:
            xz = P3[sel][:, :, [0, 2]].reshape(-1, 2)
            nz = 0.6 * value_noise(xz, float(m.get("varyScale", 14.0)), 7) + 0.4 * value_noise(xz, float(m.get("varyScale", 14.0)) * 3.7, 19)
            t = t * (1 - vary + vary * nz.reshape(-1, 3, 1) * 1.0)
            dry = m.get("varyColor")
            if dry:
                # Patches of a second tone at a larger scale: a lawn has dry and lush stretches.
                n2 = value_noise(xz, float(m.get("varyColorScale", 30.0)), 31).reshape(-1, 3, 1)
                k = np.clip((n2 - 0.45) / 0.3, 0, 1) * float(m.get("varyColorAmount", 0.6))
                t = t * (1 - k + k * np.array(dry, dtype=np.float64)[None, None, :])
        tint[sel] = np.clip(t, 0, 1)

    # ---- first uv set: true scale, world aligned -----------------------------------------------
    uv0 = np.zeros((nf, 3, 2))
    axis = np.argmax(np.abs(ng3), axis=1)
    ua = np.array([2, 0, 0])[axis]
    va = np.array([1, 2, 1])[axis]
    wu = np.take_along_axis(P3, ua[:, None, None].repeat(3, axis=1), axis=2)[:, :, 0]
    wv = np.take_along_axis(P3, va[:, None, None].repeat(3, axis=1), axis=2)[:, :, 0]
    plain_cells = [n for n in mats if mats[n].get("plain")]
    tiled = np.zeros(nf, dtype=bool)
    for i, n in enumerate(mat_names):
        sel = fmat == i
        if not sel.any():
            continue
        m = mats[n]
        k = m.get("kind", "opaque")
        if k == "lettering" or k == "cards":
            uv0[sel] = UV3[sel]
        elif m.get("plain"):
            cell = plain_cells.index(n)
            uv0[sel] = np.array([(cell + 0.5) / len(plain_cells), 0.5])[None, None, :]
        else:
            size = float(m.get("size", 2.0))
            uv0[sel] = np.stack([wu[sel] / size, wv[sel] / size], axis=2)
            tiled |= sel

    # ---- second uv set: charts, pages, packing -------------------------------------------------
    # Faces join into a chart inside one part, one material and one facing.
    key = (fpart.astype(np.int64) + 1) * 64 + fmat
    key[fixed > 0] = (int(key.max()) + 1 if nf else 0) + quad_of[fixed > 0]
    chart, flat2 = make_charts(P3, key, ng3, area3, float(cs.get("chartSplit", 6.0)), float(cs.get("chartSplitOver", 24.0)))
    # A fixed chart (card, glyph) keeps its two triangles together even though they may not face one way.
    if (fixed > 0).any():
        base = int(chart.max()) + 1
        chart[fixed > 0] = base + quad_of[fixed > 0]
        _, chart = np.unique(chart, return_inverse=True)
    nc = int(chart.max()) + 1 if nf else 0
    # Tiling: whole repeats can go, which keeps the numbers small. One offset per chart, so
    # neighbouring triangles still share their corners.
    if tiled.any():
        off = np.full((nc, 2), np.inf)
        for k in range(3):
            np.minimum.at(off, chart[tiled], uv0[tiled][:, k, :])
        off = np.where(np.isfinite(off), np.floor(off), 0.0)
        uv0[tiled] -= off[chart[tiled]][:, None, :]
    cmin = np.full((nc, 2), np.inf)
    cmax = np.full((nc, 2), -np.inf)
    for k in range(3):
        np.minimum.at(cmin, chart, flat2[:, k, :])
        np.maximum.at(cmax, chart, flat2[:, k, :])
    ext = cmax - cmin
    cfixed = np.zeros(nc, dtype=np.int64)
    np.maximum.at(cfixed, chart, fixed)
    # Long side along u, so shelves fill.
    rot = ext[:, 1] > ext[:, 0]
    cw = np.where(rot, ext[:, 1], ext[:, 0])
    ch = np.where(rot, ext[:, 0], ext[:, 1])
    # How much each chart matters.
    dens = np.array([float(mats[n].get("lightmap", 1.0)) for n in mat_names])
    wsum = np.bincount(chart, weights=area3 * dens[fmat] * np.where(ng3[:, 1] < -0.7, cs.get("downWeight", 0.5), 1.0), minlength=nc)
    asum = np.maximum(np.bincount(chart, weights=area3, minlength=nc), 1e-12)
    weight = np.clip(wsum / asum, 0.05, 4)
    # Pages: a grid over the chunk's footprint.
    cen = np.zeros((nc, 3))
    for k in range(3):
        np.add.at(cen, chart, P3[:, k, :])
    cnt = np.maximum(np.bincount(chart, minlength=nc), 1)[:, None] * 3
    cen /= cnt
    nx, nz = cs.get("pages", [1, 1])
    lo = P3.reshape(-1, 3).min(axis=0) if nf else np.zeros(3)
    hi = P3.reshape(-1, 3).max(axis=0) if nf else np.ones(3)
    if cs.get("pageBox"):
        b = cs["pageBox"]
        lo = np.array([b[0], lo[1], b[1]])
        hi = np.array([b[2], hi[1], b[3]])
    # Where people stand gets more texels: [x, z, radius, weight] rings from the settings.
    for fx, fz, fr, fw in cs.get("focus", []):
        near = np.hypot(cen[:, 0] - fx, cen[:, 2] - fz) < fr
        weight[near] = np.maximum(weight[near], weight[near] * fw)
    px = np.clip(((cen[:, 0] - lo[0]) / max(hi[0] - lo[0], 1e-6) * nx).astype(np.int64), 0, nx - 1)
    pz = np.clip(((cen[:, 2] - lo[2]) / max(hi[2] - lo[2], 1e-6) * nz).astype(np.int64), 0, nz - 1)
    page_of_chart = pz * nx + px
    used_pages, page_of_chart = np.unique(page_of_chart, return_inverse=True)
    npages = len(used_pages)
    size = int(cs["lightmap"])
    cx = np.zeros(nc, dtype=np.int64)
    cy = np.zeros(nc, dtype=np.int64)
    cnu = np.zeros(nc, dtype=np.int64)
    cnv = np.zeros(nc, dtype=np.int64)
    densities = []
    for p in range(npages):
        sel = np.nonzero(page_of_chart == p)[0]
        d, nu, nv, x, y = pack_page(cw[sel], ch[sel], weight[sel], cfixed[sel], size, float(cs.get("densityCap", 24.0)))
        cx[sel], cy[sel], cnu[sel], cnv[sel] = x, y, nu, nv
        densities.append(float(d))
    # Corner uv: the chart's surface covers its texel centres with a quarter texel to spare.
    fu = np.where(rot[chart][:, None], flat2[:, :, 1], flat2[:, :, 0]) - np.where(rot, cmin[:, 1], cmin[:, 0])[chart][:, None]
    fv = np.where(rot[chart][:, None], flat2[:, :, 0], flat2[:, :, 1]) - np.where(rot, cmin[:, 0], cmin[:, 1])[chart][:, None]
    su = (cnu - 0.5) / np.maximum(cw, 1e-9)
    sv = (cnv - 0.5) / np.maximum(ch, 1e-9)
    tu = cx[chart][:, None] + 1 + 0.25 + fu * su[chart][:, None]
    tv = cy[chart][:, None] + 1 + 0.25 + fv * sv[chart][:, None]
    # Thin charts sit in the middle of their strip.
    thin_u = (cw < 1e-9)[chart]
    thin_v = (ch < 1e-9)[chart]
    tu[thin_u] = (cx[chart][:, None] + 1 + cnu[chart][:, None] / 2.0)[thin_u].repeat(3, axis=1) if thin_u.any() else tu[thin_u]
    tv[thin_v] = (cy[chart][:, None] + 1 + cnv[chart][:, None] / 2.0)[thin_v].repeat(3, axis=1) if thin_v.any() else tv[thin_v]
    tu_rt = tu.copy()
    tv_rt = tv.copy()
    if (fixed > 0).any():
        # Cards, glyphs and small parts hold one light value. For the bake every triangle of the
        # block is laid over all four of its texel centres (and none of a neighbour's); the
        # browser reads the middle of the block, where the four meet.
        fx = np.nonzero(fixed > 0)[0]
        c = chart[fx]
        bx = cx[c].astype(np.float64)
        by = cy[c].astype(np.float64)
        tu[fx] = np.stack([bx - 0.2, bx + 2.2, bx + 1.0], axis=1)
        tv[fx] = np.stack([by + 0.35, by + 0.35, by + 2.6], axis=1)
        tu_rt[fx] = (bx + 1.0)[:, None]
        tv_rt[fx] = (by + 1.0)[:, None]
    uv1 = np.stack([tu / size, tv / size], axis=2)
    uv1_rt = np.stack([tu_rt / size, tv_rt / size], axis=2)
    block = cfixed > 0
    block_rects = np.stack([page_of_chart, cx, cy], axis=1)[block]
    ccrown = np.full(nc, -1, dtype=np.int64)
    np.maximum.at(ccrown, chart, crown)
    block_crown = ccrown[block]
    face_page = page_of_chart[chart]

    # Charts whose light is set by hand afterwards (lamps glow).
    lamp = np.array([mats[n].get("kind") == "lamp" for n in mat_names])
    lamp_chart = np.zeros(nc, dtype=bool)
    lamp_chart[chart[lamp[fmat]]] = True
    pad = np.where(block, 0, 2)
    chart_rects = np.stack([page_of_chart, cx, cy, cnu + pad, cnv + pad], axis=1)[~block]
    lamp_rects = np.stack([page_of_chart, cx, cy, cnu + pad, cnv + pad], axis=1)[lamp_chart]

    return {
        "P": P3.astype(np.float32),
        "N": N3.astype(np.float32),
        "uv0": uv0.astype(np.float32),
        "uv1": uv1.astype(np.float32),
        "uv1_rt": uv1_rt.astype(np.float32),
        "block_rects": block_rects.astype(np.int32),
        "block_crown": block_crown.astype(np.int32),
        "chart_rects": chart_rects.astype(np.int32),
        "tint": tint.astype(np.float32),
        "mat": fmat.astype(np.int32),
        "page": face_page.astype(np.int32),
        "chart": chart.astype(np.int32),
        "is_card": is_card,
        "mat_names": np.array(mat_names),
        "npages": np.array(npages),
        "densities": np.array(densities),
        "lamp_rects": lamp_rects.astype(np.int32),
        "rule_hits": np.array([f"{a}|{b}|{c:.1f}|{d}" for a, b, c, d in rule_hits]),
        "source_triangles": np.array(len(F)),
        "dropped": np.array(int((~keep).sum() - bevel_sel.sum())),
        "bevelled": np.array(int(bevel_sel.sum())),
        "merged": np.array(merged if merged else [""]),
    }
