"""The Blender scene for the real look: materials, the sky and sun, chunk meshes, bakes and renders.

Runs inside the bpy module (the wheel in tools/real/cache/venv). Space: the pipeline's arrays are in
the ink world's space (x east, y up, z south). Blender is z up, so (x, y, z) goes in as (x, -z, y).
"""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

from common import TEX_DIR, log

TO_BLENDER = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])


def to_blender(p):
    p = np.asarray(p, dtype=np.float64)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


def reset(threads):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = int(threads)
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.sample_clamp_indirect = 8.0
    scene.cycles.transparent_max_bounces = 8
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.display_settings.display_device = "sRGB"
    return scene


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------


def _image(path, colorspace):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def texture_paths(tex):
    return {k: os.path.join(TEX_DIR, f"{tex}_{k}.png") for k in ("color", "normal", "orm")}


def make_material(name, m, atlas_path):
    """One Cycles material per entry of materials.json. Every one carries a loose image node named
    BAKE on the second uv set, which is where the lightmap lands."""
    mat = bpy.data.materials.new("ls_" + name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    tint = nodes.new("ShaderNodeVertexColor")
    tint.layer_name = "tint"
    uv0 = nodes.new("ShaderNodeUVMap")
    uv0.uv_map = "uv0"
    uv1 = nodes.new("ShaderNodeUVMap")
    uv1.uv_map = "uv1"
    bake = nodes.new("ShaderNodeTexImage")
    bake.name = "BAKE"
    links.new(uv1.outputs["UV"], bake.inputs["Vector"])
    flag = nodes.new("ShaderNodeValue")
    flag.name = "BAKEFLAG"
    flag.outputs[0].default_value = 0.0
    path = nodes.new("ShaderNodeLightPath")

    kind = m.get("kind", "opaque")
    tex = m.get("texture")
    files = texture_paths(tex) if tex else None
    have = bool(files) and os.path.exists(files["color"])

    def when_baked(alpha_socket):
        """Alpha for see-through things: while this object is being baked the whole quad counts,
        and shadows only ever see the cut-out."""
        cam = nodes.new("ShaderNodeMath")
        cam.operation = "MULTIPLY"
        links.new(path.outputs["Is Camera Ray"], cam.inputs[0])
        links.new(flag.outputs[0], cam.inputs[1])
        mx = nodes.new("ShaderNodeMath")
        mx.operation = "MAXIMUM"
        links.new(alpha_socket, mx.inputs[0])
        links.new(cam.outputs[0], mx.inputs[1])
        return mx.outputs[0]

    if kind == "glass":
        mix = nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = 0.14
        tr = nodes.new("ShaderNodeBsdfTransparent")
        links.new(tint.outputs["Color"], tr.inputs["Color"])
        gl = nodes.new("ShaderNodeBsdfGlossy")
        gl.inputs["Roughness"].default_value = 0.05
        links.new(tr.outputs[0], mix.inputs[1])
        links.new(gl.outputs[0], mix.inputs[2])
        links.new(mix.outputs[0], out.inputs["Surface"])
        return mat
    if kind == "lamp":
        em = nodes.new("ShaderNodeEmission")
        em.inputs["Strength"].default_value = float(m.get("emit", 5.0))
        links.new(tint.outputs["Color"], em.inputs["Color"])
        links.new(em.outputs[0], out.inputs["Surface"])
        return mat

    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs[0], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = float(m.get("roughness", 0.8))
    bsdf.inputs["Metallic"].default_value = float(m.get("metalness", 0.0))
    if kind == "lettering":
        links.new(tint.outputs["Color"], bsdf.inputs["Base Color"])
        if atlas_path and os.path.exists(atlas_path):
            at = nodes.new("ShaderNodeTexImage")
            at.image = _image(atlas_path, "Non-Color")
            at.extension = "EXTEND"
            links.new(uv0.outputs["UV"], at.inputs["Vector"])
            # No shadow from paint.
            inv = nodes.new("ShaderNodeMath")
            inv.operation = "SUBTRACT"
            inv.inputs[0].default_value = 1.0
            links.new(path.outputs["Is Shadow Ray"], inv.inputs[1])
            cut = nodes.new("ShaderNodeMath")
            cut.operation = "MULTIPLY"
            links.new(at.outputs["Color"], cut.inputs[0])
            links.new(inv.outputs[0], cut.inputs[1])
            links.new(when_baked(cut.outputs[0]), bsdf.inputs["Alpha"])
        return mat
    if not have:
        # Plain surfaces, and textured ones before the library has been fetched.
        if tex:
            grey = nodes.new("ShaderNodeMixRGB")
            grey.blend_type = "MULTIPLY"
            grey.inputs["Fac"].default_value = 1.0
            grey.inputs["Color2"].default_value = (0.5, 0.5, 0.5, 1.0)
            links.new(tint.outputs["Color"], grey.inputs["Color1"])
            links.new(grey.outputs[0], bsdf.inputs["Base Color"])
        else:
            links.new(tint.outputs["Color"], bsdf.inputs["Base Color"])
        return mat

    col = nodes.new("ShaderNodeTexImage")
    col.image = _image(files["color"], "sRGB")
    links.new(uv0.outputs["UV"], col.inputs["Vector"])
    mul = nodes.new("ShaderNodeMixRGB")
    mul.blend_type = "MULTIPLY"
    mul.inputs["Fac"].default_value = 1.0
    links.new(col.outputs["Color"], mul.inputs["Color1"])
    links.new(tint.outputs["Color"], mul.inputs["Color2"])
    links.new(mul.outputs[0], bsdf.inputs["Base Color"])
    if os.path.exists(files["normal"]):
        nrm = nodes.new("ShaderNodeTexImage")
        nrm.image = _image(files["normal"], "Non-Color")
        links.new(uv0.outputs["UV"], nrm.inputs["Vector"])
        nm = nodes.new("ShaderNodeNormalMap")
        nm.uv_map = "uv0"
        nm.inputs["Strength"].default_value = float(m.get("normalScale", 1.0))
        links.new(nrm.outputs["Color"], nm.inputs["Color"])
        links.new(nm.outputs[0], bsdf.inputs["Normal"])
    if os.path.exists(files["orm"]):
        orm = nodes.new("ShaderNodeTexImage")
        orm.image = _image(files["orm"], "Non-Color")
        links.new(uv0.outputs["UV"], orm.inputs["Vector"])
        sep = nodes.new("ShaderNodeSeparateColor")
        links.new(orm.outputs["Color"], sep.inputs[0])
        links.new(sep.outputs[1], bsdf.inputs["Roughness"])
        links.new(sep.outputs[2], bsdf.inputs["Metallic"])
    if kind == "cards":
        # A leaf lets light through. Half of what a card shows comes from its far side, so a card
        # seen from behind is lit by the sun on its face, and the one light value a card gets in
        # the lightmap stands for both of its sides.
        thin = nodes.new("ShaderNodeBsdfTranslucent")
        links.new(mul.outputs[0], thin.inputs["Color"])
        both = nodes.new("ShaderNodeMixShader")
        both.inputs[0].default_value = float(m.get("translucent", 0.5))
        links.new(bsdf.outputs[0], both.inputs[1])
        links.new(thin.outputs[0], both.inputs[2])
        clear = nodes.new("ShaderNodeBsdfTransparent")
        cut = nodes.new("ShaderNodeMixShader")
        links.new(when_baked(col.outputs["Alpha"]), cut.inputs[0])
        links.new(clear.outputs[0], cut.inputs[1])
        links.new(both.outputs[0], cut.inputs[2])
        links.new(cut.outputs[0], out.inputs["Surface"])
    return mat


def make_materials(table, atlas_path):
    out = {}
    for name, m in table["materials"].items():
        if m.get("kind") in ("drop", "foliage"):
            continue
        out[name] = make_material(name, m, atlas_path)
    return out


def set_bake_flag(mats, on):
    for mat in mats.values():
        node = mat.node_tree.nodes.get("BAKEFLAG")
        if node:
            node.outputs[0].default_value = 1.0 if on else 0.0


# ---------------------------------------------------------------------------------------------
# Sky and sun
# ---------------------------------------------------------------------------------------------


def setup_light(scene, cfg, sun_three, sky_strength=1.0):
    """A Nishita sky without its sun disc, and a sun lamp of my own in the ink world's direction."""
    d = to_blender(np.asarray(sun_three, dtype=np.float64))
    d = d / np.linalg.norm(d)
    elevation = math.asin(d[2])
    # Compass angle of the sun measured from +y toward +x, which is how the sky texture turns.
    rotation = math.atan2(d[0], d[1])
    world = bpy.data.worlds.new("ls_sky")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_disc = False
    sky.sun_elevation = elevation
    sky.sun_rotation = rotation
    s = cfg["sky"]
    sky.altitude = float(s.get("altitude", 300))
    sky.air_density = float(s.get("airDensity", 1.0))
    sky.dust_density = float(s.get("dustDensity", 1.0))
    sky.ozone_density = float(s.get("ozoneDensity", 1.0))
    # The island floats: there is no ground under the horizon, only more sky. Fold the sky over
    # so it carries on below, a little dimmer, like haze seen from above.
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    up = nt.nodes.new("ShaderNodeMath")
    up.operation = "ABSOLUTE"
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["X"], comb.inputs["X"])
    nt.links.new(sep.outputs["Y"], comb.inputs["Y"])
    nt.links.new(sep.outputs["Z"], up.inputs[0])
    nt.links.new(up.outputs[0], comb.inputs["Z"])
    nt.links.new(comb.outputs[0], sky.inputs["Vector"])
    dim = nt.nodes.new("ShaderNodeMapRange")
    dim.clamp = True
    dim.inputs["From Min"].default_value = -0.3
    dim.inputs["From Max"].default_value = 0.0
    dim.inputs["To Min"].default_value = float(s.get("below", 0.7))
    dim.inputs["To Max"].default_value = 1.0
    nt.links.new(sep.outputs["Z"], dim.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMixRGB")
    mul.blend_type = "MULTIPLY"
    mul.inputs["Fac"].default_value = 1.0
    nt.links.new(sky.outputs[0], mul.inputs["Color1"])
    nt.links.new(dim.outputs[0], mul.inputs["Color2"])
    # A touch of warmth in the sky's own light: the white balance of a camera set for evening.
    warm = nt.nodes.new("ShaderNodeMixRGB")
    warm.blend_type = "MULTIPLY"
    warm.inputs["Fac"].default_value = 1.0
    t = s.get("tint", [1.0, 1.0, 1.0])
    warm.inputs["Color2"].default_value = (t[0], t[1], t[2], 1.0)
    nt.links.new(mul.outputs[0], warm.inputs["Color1"])
    nt.links.new(warm.outputs[0], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = sky_strength
    nt.links.new(bg.outputs[0], out.inputs["Surface"])

    lamp = bpy.data.lights.new("ls_sun", "SUN")
    lamp.angle = math.radians(float(cfg["sun"].get("angleDeg", 1.0)))
    lamp.color = cfg["sun"]["color"]
    lamp.energy = 1.0
    obj = bpy.data.objects.new("ls_sun", lamp)
    scene.collection.objects.link(obj)
    obj.rotation_euler = Vector(d).to_track_quat("Z", "Y").to_euler()
    return {"world": world, "background": bg, "sky": sky, "sun": lamp, "sun_dir": d, "elevation": elevation, "rotation": rotation}


CUBE_FACES = [
    # name, forward, up (Blender space)
    ("px", (1, 0, 0), (0, 0, 1)),
    ("nx", (-1, 0, 0), (0, 0, 1)),
    ("py", (0, 1, 0), (0, 0, 1)),
    ("ny", (0, -1, 0), (0, 0, 1)),
    ("pz", (0, 0, 1), (0, 1, 0)),
    ("nz", (0, 0, -1), (0, 1, 0)),
]


def render_to_array(scene, path=None):
    """Render and hand back linear float pixels, top row first."""
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "32"
    tmp = path or os.path.join(bpy.app.tempdir or "/tmp", "ls_render.exr")
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1]


def look_matrix(pos, forward, up):
    f = Vector(forward).normalized()
    r = f.cross(Vector(up)).normalized()
    u = r.cross(f)
    m = Matrix(((r.x, u.x, -f.x, pos[0]), (r.y, u.y, -f.y, pos[1]), (r.z, u.z, -f.z, pos[2]), (0, 0, 0, 1)))
    return m


def sky_cube(scene, res=128, samples=4, origin=(0, 0, 60), hide=()):
    """The six faces of what the sky looks like from `origin`. Returns {name: (res, res, 3)}."""
    cam_data = bpy.data.cameras.new("ls_cube")
    cam_data.type = "PERSP"
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.angle = math.radians(90)
    cam_data.clip_start = 0.1
    cam_data.clip_end = 10000
    cam = bpy.data.objects.new("ls_cube", cam_data)
    scene.collection.objects.link(cam)
    old = (scene.camera, scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples, scene.render.film_transparent)
    scene.camera = cam
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    hidden = []
    for o in scene.objects:
        if o.type == "MESH" and not o.hide_render and (hide == "all" or o.name in hide):
            o.hide_render = True
            hidden.append(o)
    faces = {}
    for name, fwd, up in CUBE_FACES:
        cam.matrix_world = look_matrix(origin, fwd, up)
        faces[name] = render_to_array(scene)[:, :, :3].astype(np.float64)
    for o in hidden:
        o.hide_render = False
    scene.camera, scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples, scene.render.film_transparent = old
    bpy.data.objects.remove(cam)
    return faces


def cube_lookup(faces, d):
    """Sample the cube along Blender-space directions d (n, 3). Nearest texel."""
    res = next(iter(faces.values())).shape[0]
    out = np.zeros((len(d), 3))
    ax = np.argmax(np.abs(d), axis=1)
    for name, fwd, up in CUBE_FACES:
        f = np.array(fwd, dtype=np.float64)
        u = np.array(up, dtype=np.float64)
        r = np.cross(f, u)
        sel = (d @ f) >= np.max(np.abs(d), axis=1) - 1e-12
        if not sel.any():
            continue
        dd = d[sel]
        z = dd @ f
        x = (dd @ r) / z
        y = (dd @ u) / z
        ix = np.clip(((x + 1) / 2 * res).astype(np.int64), 0, res - 1)
        iy = np.clip(((1 - y) / 2 * res).astype(np.int64), 0, res - 1)
        out[sel] = faces[name][iy, ix]
    return out


def equirect_dirs_three(w, h):
    """Directions for an equirectangular image the way three.js reads one: row 0 is straight up,
    u = atan2(z, x) / 2pi + 0.5."""
    v = (np.arange(h) + 0.5) / h
    u = (np.arange(w) + 0.5) / w
    lat = (0.5 - v) * math.pi
    lon = (u - 0.5) * math.tau
    cl = np.cos(lat)[:, None]
    x = cl * np.cos(lon)[None, :]
    z = cl * np.sin(lon)[None, :]
    y = np.repeat(np.sin(lat)[:, None], w, axis=1)
    return np.stack([x, y, z], axis=2)


def cube_solid_angles(res):
    c = (np.arange(res) + 0.5) / res * 2 - 1
    x, y = np.meshgrid(c, c)
    return (2.0 / res) ** 2 / np.power(1 + x * x + y * y, 1.5), x, y


def cube_dirs(res):
    """Blender-space direction of every texel of every face."""
    _w, x, y = cube_solid_angles(res)
    out = {}
    for name, fwd, up in CUBE_FACES:
        f = np.array(fwd, dtype=np.float64)
        u = np.array(up, dtype=np.float64)
        r = np.cross(f, u)
        d = f[None, None, :] + x[:, :, None] * r[None, None, :] - y[:, :, None] * u[None, None, :]
        out[name] = d / np.linalg.norm(d, axis=2, keepdims=True)
    return out


LUMA = np.array([0.2126, 0.7152, 0.0722])


def calibrate(scene, light, cfg):
    """Set the sky so it puts 1.0 on level ground, and the sun to cfg.sun.ratio times that on a
    surface facing it. Call before any mesh is in the scene."""
    light["background"].inputs["Strength"].default_value = 1.0
    light["sun"].energy = 0.0
    res = 64
    faces = sky_cube(scene, res=res, samples=1, hide="all")
    w, _x, _y = cube_solid_angles(res)
    dirs = cube_dirs(res)
    e_h = np.zeros(3)
    peak = np.zeros(3)
    for name in faces:
        cosz = np.clip(dirs[name][:, :, 2], 0, None)
        e_h += (faces[name] * (w * cosz)[:, :, None]).sum(axis=(0, 1))
        lum = faces[name] @ LUMA
        peak += (dirs[name] * (w * lum ** 4)[:, :, None]).sum(axis=(0, 1))
    lum_h = float(e_h @ LUMA)
    strength = 1.0 / lum_h
    light["background"].inputs["Strength"].default_value = strength
    col = np.array(cfg["sun"]["color"], dtype=np.float64)
    col = col / float(col @ LUMA)
    m = col.max()
    light["sun"].color = tuple(col / m)
    light["sun"].energy = float(cfg["sun"]["ratio"]) * m
    peak /= np.linalg.norm(peak)
    sd = light["sun_dir"]
    az_sun = math.degrees(math.atan2(sd[0], sd[1]))
    az_peak = math.degrees(math.atan2(peak[0], peak[1]))
    info = {
        "skyStrength": strength,
        "skyOnLevelGround": [float(x) for x in e_h * strength],
        "sunEnergy": float(cfg["sun"]["ratio"]),
        "sunColor": [float(x) for x in col],
        "sunDirectionBlender": [float(x) for x in sd],
        "sunElevationDeg": math.degrees(light["elevation"]),
        "sunAzimuthDeg": az_sun,
        "skyBrightSideAzimuthDeg": az_peak,
    }
    log(f"sky strength {strength:.4f}, sun {info['sunEnergy']:.2f}, sun azimuth {az_sun:.1f}, sky bright side {az_peak:.1f}")
    return info


def environment(scene, light, cfg, info, sun_three, width=512):
    """The calibrated sky as an equirectangular image the way three.js reads one, with a soft sun
    drawn in so reflections have something to catch. Returns (height, width, 3) linear, top row up."""
    faces = sky_cube(scene, res=256, samples=1, hide="all")
    height = width // 2
    d3 = equirect_dirs_three(width, height)
    rgb = cube_lookup(faces, to_blender(d3.reshape(-1, 3))).reshape(height, width, 3)
    sun = np.asarray(sun_three, dtype=np.float64)
    sun = sun / np.linalg.norm(sun)
    radius = math.radians(float(cfg["sun"].get("envDiscDeg", 4.0)))
    cosang = d3 @ sun
    ang = np.arccos(np.clip(cosang, -1, 1))
    # A disc with a soft rim, holding the sun's whole irradiance.
    shape = np.clip((radius - ang) / (radius * 0.35), 0, 1)
    v = (np.arange(height) + 0.5) / height
    domega = (math.pi / height) * (math.tau / width) * np.cos((0.5 - v) * math.pi)
    total = float((shape * domega[:, None] * np.clip(cosang, 0, 1)).sum())
    col = np.array(info["sunColor"], dtype=np.float64) * float(info["sunEnergy"])
    if total > 0:
        rgb = rgb + shape[:, :, None] * (col / total)[None, None, :]
    return rgb


# ---------------------------------------------------------------------------------------------
# Chunk meshes
# ---------------------------------------------------------------------------------------------


def add_chunk(scene, chunk, data, mats):
    """One object per lightmap page. Vertices are not shared between triangles, which keeps every
    per corner attribute a plain array."""
    objs = []
    names = [str(n) for n in data["mat_names"]]
    for page in range(int(data["npages"])):
        sel = data["page"] == page
        nf = int(sel.sum())
        if nf == 0:
            objs.append(None)
            continue
        co = to_blender(data["P"][sel].reshape(-1, 3))
        nr = to_blender(data["N"][sel].reshape(-1, 3))
        mesh = bpy.data.meshes.new(f"{chunk}.{page}")
        mesh.vertices.add(nf * 3)
        mesh.vertices.foreach_set("co", co.astype(np.float32).ravel())
        mesh.loops.add(nf * 3)
        mesh.loops.foreach_set("vertex_index", np.arange(nf * 3, dtype=np.int32))
        mesh.polygons.add(nf)
        mesh.polygons.foreach_set("loop_start", np.arange(nf, dtype=np.int32) * 3)
        used = np.unique(data["mat"][sel])
        slot = {int(mi): i for i, mi in enumerate(used)}
        for mi in used:
            mesh.materials.append(mats[names[int(mi)]])
        mesh.polygons.foreach_set("material_index", np.array([slot[int(x)] for x in data["mat"][sel]], dtype=np.int32))
        mesh.polygons.foreach_set("use_smooth", np.ones(nf, dtype=bool))
        mesh.update(calc_edges=True)
        mesh.validate(clean_customdata=False)
        if len(mesh.polygons) != nf:
            raise RuntimeError(f"{chunk} page {page}: Blender dropped {nf - len(mesh.polygons)} triangles")
        uv0 = mesh.uv_layers.new(name="uv0")
        uv0.data.foreach_set("uv", data["uv0"][sel].reshape(-1, 2).astype(np.float32).ravel())
        uv1 = mesh.uv_layers.new(name="uv1")
        uv1.data.foreach_set("uv", data["uv1"][sel].reshape(-1, 2).astype(np.float32).ravel())
        tint = mesh.color_attributes.new("tint", "FLOAT_COLOR", "CORNER")
        rgba = np.ones((nf * 3, 4), dtype=np.float32)
        rgba[:, :3] = data["tint"][sel].reshape(-1, 3)
        tint.data.foreach_set("color", rgba.ravel())
        nrm = nr / np.maximum(np.linalg.norm(nr, axis=1, keepdims=True), 1e-9)
        mesh.normals_split_custom_set_from_vertices(nrm.astype(np.float32).tolist())
        obj = bpy.data.objects.new(f"{chunk}.{page}", mesh)
        scene.collection.objects.link(obj)
        objs.append(obj)
    return objs


# ---------------------------------------------------------------------------------------------
# Baking
# ---------------------------------------------------------------------------------------------


def bake_diffuse(scene, obj, size, samples, bounces):
    """Direct and bounced light on one object, without its own colour, into its second uv set.
    Returns (size, size, 4) float, row 0 at the bottom (v = 0), alpha 1 where a texel was reached."""
    img = bpy.data.images.new("ls_bake", size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes["BAKE"]
        node.image = img
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node
    for o in scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.cycles.samples = int(samples)
    scene.cycles.max_bounces = int(bounces)
    scene.cycles.diffuse_bounces = int(bounces)
    scene.cycles.glossy_bounces = min(2, int(bounces))
    scene.cycles.transmission_bounces = 4
    # The bake itself is never denoised by Cycles. That happens afterwards, in denoise().
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 0
    scene.render.bake.use_clear = True
    scene.render.bake.target = "IMAGE_TEXTURES"
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, uv_layer="uv1", margin=0, use_clear=True)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    for slot in obj.material_slots:
        slot.material.node_tree.nodes["BAKE"].image = None
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)


def denoise(rgb, guide=None):
    """OpenImageDenoise on an image that is not a render, through a compositor of its own.
    rgb and guide: (h, w, 3) float. The guide plays the part of the albedo pass: where it changes,
    the filter does not smooth across."""
    h, w, _ = rgb.shape
    scene = bpy.data.scenes.new("ls_denoise")
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.use_nodes = True
    scene.view_settings.view_transform = "Raw"
    nt = scene.node_tree
    nt.nodes.clear()
    images = []

    def node(arr, name):
        img = bpy.data.images.new(name, w, h, float_buffer=True, alpha=False)
        img.colorspace_settings.name = "Non-Color"
        px = np.ones((h, w, 4), dtype=np.float32)
        px[:, :, :3] = arr
        img.pixels.foreach_set(px.ravel())
        n = nt.nodes.new("CompositorNodeImage")
        n.image = img
        images.append(img)
        return n

    src = node(rgb, "ls_dn_in")
    dn = nt.nodes.new("CompositorNodeDenoise")
    dn.use_hdr = True
    dn.prefilter = "NONE"
    nt.links.new(src.outputs["Image"], dn.inputs["Image"])
    if guide is not None:
        g = node(guide, "ls_dn_guide")
        nt.links.new(g.outputs["Image"], dn.inputs["Albedo"])
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(dn.outputs["Image"], comp.inputs["Image"])
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    tmp = os.path.join(bpy.app.tempdir or "/tmp", "ls_denoise.exr")
    scene.render.filepath = tmp
    bpy.ops.render.render(scene=scene.name, write_still=True)
    out = bpy.data.images.load(tmp, check_existing=False)
    px = np.empty(w * h * 4, dtype=np.float32)
    out.pixels.foreach_get(px)
    bpy.data.images.remove(out)
    for img in images:
        bpy.data.images.remove(img)
    bpy.data.scenes.remove(scene)
    return px.reshape(h, w, 4)[:, :, :3].copy()


def add_camera(scene, pose, name="ls_cam"):
    """A camera from a three.js pose: position, quaternion (x, y, z, w), vertical fov in degrees."""
    cam_data = bpy.data.cameras.new(name)
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle_y = math.radians(float(pose["fov"]))
    cam_data.clip_start = 0.2
    cam_data.clip_end = 6000
    cam = bpy.data.objects.new(name, cam_data)
    scene.collection.objects.link(cam)
    x, y, z, w = pose["quaternion"]
    r3 = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    rb = TO_BLENDER @ r3
    p = to_blender(np.array(pose["position"], dtype=np.float64))
    m = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            m[i][j] = rb[i, j]
        m[i][3] = p[i]
    cam.matrix_world = m
    return cam
