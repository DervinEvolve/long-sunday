"""Reading and writing binary glTF with numpy. Only what this pipeline needs."""
import json
import struct

import numpy as np

_DTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_SIZE = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    """Returns (json, list of meshes). Each mesh is a dict: name, extras, index, and one array per attribute."""
    with open(path, "rb") as f:
        data = f.read()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path} is not a binary glTF")
    jlen, _jtype = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20 : 20 + jlen].decode("utf8"))
    bstart = 20 + jlen + 8
    views = doc.get("bufferViews", [])

    def accessor(i):
        a = doc["accessors"][i]
        v = views[a["bufferView"]]
        n = _SIZE[a["type"]]
        dt = np.dtype(_DTYPE[a["componentType"]])
        off = bstart + v.get("byteOffset", 0) + a.get("byteOffset", 0)
        arr = np.frombuffer(data, dtype=dt, count=a["count"] * n, offset=off)
        return arr.reshape(-1, n) if n > 1 else arr

    meshes = []
    for node in doc.get("nodes", []):
        if "mesh" not in node:
            continue
        m = doc["meshes"][node["mesh"]]
        for prim in m["primitives"]:
            out = {"name": node.get("name", m.get("name", "")), "extras": node.get("extras", {})}
            out["index"] = accessor(prim["indices"]).astype(np.int64)
            for key, acc in prim["attributes"].items():
                out[key] = accessor(acc)
            meshes.append(out)
    return doc, meshes


class GlbWriter:
    """Collects accessors into one buffer and writes a .glb."""

    def __init__(self):
        self.chunks = []
        self.length = 0
        self.doc = {
            "asset": {"version": "2.0", "generator": "long-sunday real look"},
            "scene": 0,
            "scenes": [{"nodes": []}],
            "nodes": [],
            "meshes": [],
            "materials": [],
            "accessors": [],
            "bufferViews": [],
            "buffers": [{}],
        }
        self._materials = {}

    def accessor(self, arr, type_, target=None, normalized=False, minmax=False):
        """arr is (count, columns). Columns past what `type_` needs are padding, there so that a
        vertex attribute is a whole number of four bytes, which meshopt wants."""
        arr = np.ascontiguousarray(arr)
        if arr.ndim == 1:
            arr = arr.reshape(-1, 1)
        comp = {v: k for k, v in _DTYPE.items()}[arr.dtype.type]
        raw = arr.tobytes()
        view = {"buffer": 0, "byteOffset": self.length, "byteLength": len(raw)}
        n = _SIZE[type_]
        elem = arr.dtype.itemsize * arr.shape[1]
        if target == 34962:
            view["target"] = target
            if elem % 4:
                raise ValueError("vertex attributes must be a multiple of four bytes")
            view["byteStride"] = elem
        elif target:
            view["target"] = target
        pad = (-len(raw)) % 4
        self.chunks.append(raw + b"\0" * pad)
        self.length += len(raw) + pad
        self.doc["bufferViews"].append(view)
        acc = {"bufferView": len(self.doc["bufferViews"]) - 1, "componentType": comp, "count": int(arr.shape[0]), "type": type_}
        if normalized:
            acc["normalized"] = True
        if minmax:
            a2 = arr[:, :n]
            acc["min"] = [float(x) if arr.dtype.kind == "f" else int(x) for x in a2.min(axis=0)]
            acc["max"] = [float(x) if arr.dtype.kind == "f" else int(x) for x in a2.max(axis=0)]
        self.doc["accessors"].append(acc)
        return len(self.doc["accessors"]) - 1

    def material(self, name, extras=None):
        if name not in self._materials:
            m = {"name": name}
            if extras:
                m["extras"] = extras
            self.doc["materials"].append(m)
            self._materials[name] = len(self.doc["materials"]) - 1
        return self._materials[name]

    def node(self, name, attributes, indices, material, translation=None, scale=None, extras=None):
        prim = {"attributes": attributes, "indices": indices, "mode": 4, "material": material}
        self.doc["meshes"].append({"name": name, "primitives": [prim]})
        node = {"name": name, "mesh": len(self.doc["meshes"]) - 1}
        if translation is not None:
            node["translation"] = [float(x) for x in translation]
        if scale is not None:
            node["scale"] = [float(x) for x in scale]
        if extras:
            node["extras"] = extras
        self.doc["nodes"].append(node)
        self.doc["scenes"][0]["nodes"].append(len(self.doc["nodes"]) - 1)

    def write(self, path, extras=None, extensions_used=None):
        self.doc["buffers"][0]["byteLength"] = self.length
        if extras:
            self.doc["scenes"][0]["extras"] = extras
        if extensions_used:
            self.doc["extensionsUsed"] = list(extensions_used)
            self.doc["extensionsRequired"] = list(extensions_used)
        text = json.dumps(self.doc, separators=(",", ":")).encode("utf8")
        text += b" " * ((-len(text)) % 4)
        total = 12 + 8 + len(text) + 8 + self.length
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(text), 0x4E4F534A))
            f.write(text)
            f.write(struct.pack("<II", self.length, 0x004E4942))
            for c in self.chunks:
                f.write(c)
        return total
