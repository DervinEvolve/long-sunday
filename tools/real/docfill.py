#!/usr/bin/env python
"""Fills the tables of docs/REAL.md from materials.json and the packed manifest, and writes
materials.json back out one entry per line so it stays easy to tune by hand.

    tools/real/cache/venv/bin/python tools/real/docfill.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def one_line(v):
    return json.dumps(v, ensure_ascii=False, separators=(", ", ": "))


def format_materials(path):
    with open(path, encoding="utf8") as f:
        t = json.load(f)
    out = ["{"]
    out.append('  "about": [')
    out += ["    " + json.dumps(a, ensure_ascii=False) + ("," if i < len(t["about"]) - 1 else "") for i, a in enumerate(t["about"])]
    out.append("  ],")
    out.append("")
    out.append('  "perFace": ' + one_line(t["perFace"]) + ",")
    out.append('  "plain": ' + one_line(t.get("plain", {})) + ",")
    out.append("")
    out.append('  "materials": {')
    names = list(t["materials"])
    w = max(len(n) for n in names) + 3
    for i, n in enumerate(names):
        out.append("    " + (json.dumps(n) + ":").ljust(w) + one_line(t["materials"][n]) + ("," if i < len(names) - 1 else ""))
    out.append("  },")
    out.append("")
    out.append('  "rules": [')
    wn = max(len(r.get("name", "")) for r in t["rules"]) + 3
    for i, r in enumerate(t["rules"]):
        line = '    { "name": ' + (json.dumps(r.get("name", "")) + ",").ljust(wn) + ' "when": ' + one_line(r["when"]) + ', "material": ' + json.dumps(r["material"]) + " }"
        out.append(line + ("," if i < len(t["rules"]) - 1 else ""))
    out.append("  ]")
    out.append("}")
    text = "\n".join(out) + "\n"
    assert json.loads(text) == t, "the rewrite changed the table"
    with open(path, "w", encoding="utf8") as f:
        f.write(text)
    return t


def material_table(t):
    rows = ["| Name | What it is | Texture | Metres per repeat | Drawn colour shows | Notes |", "| --- | --- | --- | --- | --- | --- |"]
    for n, m in t["materials"].items():
        kind = m.get("kind", "plain" if m.get("plain") else "opaque")
        tex = m.get("texture") or ""
        size = str(m.get("size", "")) if tex else ""
        tint = ""
        if "tint" in m:
            tint = f"{m['tint']} ({m.get('tintMode', 'rgb')})"
        elif m.get("plain") or kind in ("glass", "lettering"):
            tint = "fully"
        notes = []
        if m.get("plain"):
            notes.append(f"roughness {m.get('roughness')}, metal {m.get('metalness')}")
        if m.get("bevel"):
            notes.append(f"bevel {round(m['bevel'] * 100, 1)} cm")
        if kind == "foliage":
            notes.append(f"core plus about {m.get('cards')} leaf cards per m2")
        if m.get("fallback"):
            notes.append(f"folds into {m['fallback']}")
        if kind == "drop":
            notes.append("left out of the real look")
        if kind == "lamp":
            notes.append("written into the lightmap at the ceiling, so it glows")
        rows.append(f"| `{n}` | {kind} | {tex} | {size} | {tint} | {'; '.join(notes)} |")
    return "\n".join(rows)


def status_table(man):
    """Megabytes are a million bytes, as in the budgets."""
    rows = ["| Chunk | Triangles | Draw calls | Geometry | Lightmaps | Half size | Baked as | Bake time |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    mb = lambda n: f"{n / 1e6:.2f} MB"
    tris = calls = geo = full = half = 0
    for c in man["chunks"]:
        lm = sum(l["bytes"] for l in c["lightmaps"])
        lh = sum(l["halfBytes"] for l in c["lightmaps"])
        q = c["quality"]
        spp = "/".join(str(x) for x in sorted(set(q.get("pageSamples") or [q["samples"]])))
        rows.append(f"| {c['id']} | {c['triangles']:,} | {c['drawCalls']} | {mb(c['bytes'])} | {len(c['lightmaps'])} x {q['lightmap']} px, {mb(lm)} | {mb(lh)} | {spp} samples, {q['bounces']} bounces | {round(q['bakeSeconds'])} s |")
        tris += c["triangles"]
        calls += c["drawCalls"]
        geo += c["bytes"]
        full += lm
        half += lh
    rows.append(f"| all | {tris:,} | {calls} | {mb(geo)} | {mb(full)} | {mb(half)} | | |")
    return "\n".join(rows)


def main():
    t = format_materials(os.path.join(HERE, "materials.json"))
    doc_path = os.path.join(ROOT, "docs", "REAL.md")
    with open(doc_path, encoding="utf8") as f:
        doc = f.read()

    def block(name, body):
        nonlocal doc
        pat = re.compile(rf"<!-- {name} -->.*?<!-- /{name} -->", re.S)
        new = f"<!-- {name} -->\n{body}\n<!-- /{name} -->"
        if pat.search(doc):
            doc = pat.sub(lambda _m: new, doc)
        elif name.upper() + "_TABLE" in doc:
            doc = doc.replace(name.upper() + "_TABLE", new)

    block("material", material_table(t))
    man_path = os.path.join(ROOT, "public", "real", "manifest.json")
    if os.path.exists(man_path):
        with open(man_path, encoding="utf8") as f:
            block("status", status_table(json.load(f)))
    with open(doc_path, "w", encoding="utf8") as f:
        f.write(doc)
    print("docs/REAL.md tables filled")


if __name__ == "__main__":
    main()
