#!/usr/bin/env python
"""Image jobs for the pack step, done with Pillow from the pipeline's own venv.

    images.py webp <in> <out> [--quality 90] [--half <out_half>] [--lossless] [--max <side>]
    images.py sheet - <out> --panel "Label=file.png" --panel ...     pictures side by side
"""
import argparse
import os
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def save_webp(img, path, quality, lossless):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if lossless:
        img.save(path, "WEBP", lossless=True, quality=100, method=6)
    else:
        img.save(path, "WEBP", quality=quality, method=6, use_sharp_yuv=True)
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job")
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--half", default="")
    ap.add_argument("--lossless", action="store_true")
    ap.add_argument("--max", type=int, default=0)
    ap.add_argument("--panel", action="append", default=[])
    ap.add_argument("--width", type=int, default=960)
    a = ap.parse_args()
    if a.job == "sheet":
        from PIL import ImageDraw, ImageFont

        try:
            font = ImageFont.truetype("DejaVuSans.ttf", 22)
        except OSError:
            font = ImageFont.load_default()
        panels = []
        for p in a.panel:
            label, path = p.split("=", 1)
            img = Image.open(path).convert("RGB")
            img = img.resize((a.width, round(img.size[1] * a.width / img.size[0])), Image.LANCZOS)
            panels.append((label, img))
        if not panels:
            sys.exit("no panels")
        bar = 36
        h = max(img.size[1] for _, img in panels) + bar
        sheet = Image.new("RGB", (a.width * len(panels) + 8 * (len(panels) - 1), h), (28, 26, 51))
        draw = ImageDraw.Draw(sheet)
        for i, (label, img) in enumerate(panels):
            x = i * (a.width + 8)
            sheet.paste(img, (x, bar))
            draw.text((x + 10, 6), label, fill=(246, 236, 217), font=font)
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        sheet.save(a.out)
        print(a.out)
        return
    if a.job != "webp":
        sys.exit("unknown job")
    img = Image.open(a.src)
    if img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGBA" if "A" in img.mode else "RGB")
    if a.max and max(img.size) > a.max:
        k = a.max / max(img.size)
        img = img.resize((max(1, round(img.size[0] * k)), max(1, round(img.size[1] * k))), Image.LANCZOS)
    n = save_webp(img, a.out, a.quality, a.lossless)
    out = [f"{img.size[0]}x{img.size[1]}", str(n)]
    if a.half:
        # A plain two by two average: lightmap charts sit on even texels so nothing bleeds.
        half = img.resize((max(1, img.size[0] // 2), max(1, img.size[1] // 2)), Image.BOX)
        out.append(str(save_webp(half, a.half, a.quality, a.lossless)))
    print(" ".join(out))


if __name__ == "__main__":
    main()
