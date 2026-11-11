"""Detail a built place has and a drawing leaves out: soft edges on stone and metal.

The pieces chosen are welded, sent through Blender's bevel modifier, and come back as triangles
with weighted normals, so a block's flat faces stay flat and its edges catch the light.
"""
import math

import numpy as np


def weighted_normals(P, F, crease_deg=50.0):
    """Corner normals for triangles F over welded vertices P: each corner takes the area weighted
    normals of the faces round its vertex that lie within crease_deg of its own face."""
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    cr = np.cross(b - a, c - a)
    area = np.linalg.norm(cr, axis=1)
    fn = cr / np.maximum(area[:, None], 1e-20)
    nf = len(F)
    corner_v = F.reshape(-1)
    corner_f = np.repeat(np.arange(nf), 3)
    order = np.argsort(corner_v, kind="stable")
    sv = corner_v[order]
    sf = corner_f[order]
    start = np.searchsorted(sv, np.arange(P.shape[0]))
    count = np.diff(np.append(start, len(sv)))
    K = int(min(24, count.max())) if len(count) else 0
    out = np.zeros((nf * 3, 3))
    cosmin = math.cos(math.radians(crease_deg))
    own = fn[corner_f]
    for k in range(K):
        has = count[corner_v] > k
        idx = np.minimum(start[corner_v] + k, len(sf) - 1)
        g = sf[idx]
        ok = has & ((fn[g] * own).sum(axis=1) >= cosmin)
        out += fn[g] * (area[g] * ok)[:, None]
    bad = np.linalg.norm(out, axis=1) < 1e-12
    out[bad] = own[bad]
    out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-20)
    return out.reshape(nf, 3, 3)


def bevel(P, F, rgb, face_tag, width, angle_deg=38.0):
    """P: vertices (not yet welded), F: triangles, rgb: per vertex colour bytes, face_tag: an
    integer per face that must survive (piece and material). Returns corner arrays
    (P3, N3, rgb3, tag) for the bevelled result. Blender space is not needed: a bevel does not
    care which way is up."""
    import bpy

    # Weld per tag so each piece is watertight where it was only creased, and pieces stay apart.
    vtag = np.zeros(len(P), dtype=np.int64)
    vtag[F.reshape(-1)] = np.repeat(face_tag, 3)
    used = np.zeros(len(P), dtype=bool)
    used[F.reshape(-1)] = True
    key = np.concatenate([np.round(P * 2000).astype(np.int64), vtag[:, None]], axis=1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    WP = P[first]
    WF = inv[F]
    good = (WF[:, 0] != WF[:, 1]) & (WF[:, 1] != WF[:, 2]) & (WF[:, 0] != WF[:, 2])
    WF = WF[good]
    tags = face_tag[good]
    corner_rgb = rgb[F[good]].astype(np.float32) / 255.0

    mesh = bpy.data.meshes.new("ls_bevel")
    nf = len(WF)
    mesh.vertices.add(len(WP))
    mesh.vertices.foreach_set("co", WP.astype(np.float32).ravel())
    mesh.loops.add(nf * 3)
    mesh.loops.foreach_set("vertex_index", WF.astype(np.int32).ravel())
    mesh.polygons.add(nf)
    mesh.polygons.foreach_set("loop_start", np.arange(nf, dtype=np.int32) * 3)
    mesh.update(calc_edges=True)
    tag_attr = mesh.attributes.new("tag", "INT", "FACE")
    tag_attr.data.foreach_set("value", tags.astype(np.int32))
    col = mesh.color_attributes.new("src", "FLOAT_COLOR", "CORNER")
    rgba = np.ones((nf * 3, 4), dtype=np.float32)
    rgba[:, :3] = corner_rgb.reshape(-1, 3)
    col.data.foreach_set("color", rgba.ravel())
    if mesh.validate(clean_customdata=False):
        mesh.update(calc_edges=True)

    obj = bpy.data.objects.new("ls_bevel", mesh)
    bpy.context.scene.collection.objects.link(obj)
    # Quads first where two triangles lie in one plane, or the bevel would cut every diagonal.
    tri = obj.modifiers.new("planar", "DECIMATE")
    tri.decimate_type = "DISSOLVE"
    tri.angle_limit = math.radians(0.1)
    tri.delimit = {"MATERIAL", "SEAM"}
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = float(width)
    mod.segments = 1
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle_deg)
    mod.use_clamp_overlap = True
    mod.miter_outer = "MITER_SHARP"
    mod.affect = "EDGES"
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    em = ev.to_mesh()
    em.calc_loop_triangles()
    nv = len(em.vertices)
    co = np.empty(nv * 3, dtype=np.float32)
    em.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    nt = len(em.loop_triangles)
    tv = np.empty(nt * 3, dtype=np.int32)
    em.loop_triangles.foreach_get("vertices", tv)
    tl = np.empty(nt * 3, dtype=np.int32)
    em.loop_triangles.foreach_get("loops", tl)
    tp = np.empty(nt, dtype=np.int32)
    em.loop_triangles.foreach_get("polygon_index", tp)
    ptag = np.empty(len(em.polygons), dtype=np.int32)
    em.attributes["tag"].data.foreach_get("value", ptag)
    lcol = np.empty(len(em.loops) * 4, dtype=np.float32)
    em.color_attributes["src"].data.foreach_get("color", lcol)
    lcol = lcol.reshape(-1, 4)[:, :3]
    T = tv.reshape(-1, 3).astype(np.int64)
    out_tag = ptag[tp].astype(np.int64)
    out_rgb = np.clip(lcol[tl.reshape(-1, 3)] * 255.0, 0, 255)
    ev.to_mesh_clear()
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)

    area = np.linalg.norm(np.cross(co[T[:, 1]] - co[T[:, 0]], co[T[:, 2]] - co[T[:, 0]]), axis=1)
    keep = area > 1e-10
    T, out_tag, out_rgb = T[keep], out_tag[keep], out_rgb[keep]
    N3 = weighted_normals(co, T)
    return co[T], N3, out_rgb, out_tag
