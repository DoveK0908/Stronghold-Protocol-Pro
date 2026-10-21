#!/usr/bin/env python3
"""Export the operators' E2 illustrations (立绘) from a local Arknights client.

The client's `chararts/<charId>.ab` holds two full-size portraits: `<charId>_1` (精英一, the plain art) and
`<charId>_2` (精英二, the same art with its painted surroundings).  The web dumps we fetch only carry the
180x360 `portrait` crops, so this script pulls the E2 picture — the one the preparation screen wants behind the
seat card — straight from the installed client.

Some clients split the alpha channel into a companion `<name>[alpha]` texture; the RGB base is then opaque and the
alpha texture's red channel is the real mask (Ark-Models layout).  Both layouts are handled.

Usage:
  .venv-extract/Scripts/python.exe tools/local-extract/chararts.py --ab <AB/Windows> --chars char_249_mlyss,char_003_kalts
  .venv-extract/Scripts/python.exe tools/local-extract/chararts.py --ab <AB/Windows> --all --out public/assets

Writes <out>/char/illust/<charId>.webp (max 1600px, quality 88) and prints a JSON line with what it wrote.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aklz4  # noqa: F401,E402  registers the client's LZ4AK decoder with UnityPy
import UnityPy  # noqa: E402
from PIL import Image  # noqa: E402

MAX_SIDE = 1600
QUALITY = 88


def _textures(bundle):
    env = UnityPy.load(bundle)
    out = {}
    for obj in env.objects:
        if obj.type.name != "Texture2D":
            continue
        try:
            data = obj.read()
            name = data.m_Name
        except Exception:
            continue
        out[name] = data
    return out


def _rgba(tex_map, stem):
    """The stem's picture as RGBA: RGB from `stem`, alpha from `stem[alpha]` when the client splits them."""
    base = tex_map.get(stem)
    if base is None:
        return None
    rgb = base.image.convert("RGB")
    alpha = tex_map.get(stem + "[alpha]")
    if alpha is not None:
        mask = alpha.image.convert("L")
        if mask.size != rgb.size:
            mask = mask.resize(rgb.size, Image.LANCZOS)
        img = rgb.convert("RGBA")
        img.putalpha(mask)
        return img
    return base.image.convert("RGBA")


def export_char(ab_root, char_id, out_dir, log=print):
    bundle = os.path.join(ab_root, "chararts", char_id + ".ab")
    if not os.path.exists(bundle):
        return None
    tex_map = _textures(bundle)
    img = _rgba(tex_map, char_id + "_2")
    if img is None:
        img = _rgba(tex_map, char_id + "_1")
        if img is None:
            return None
    if max(img.size) > MAX_SIDE:
        scale = MAX_SIDE / max(img.size)
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    os.makedirs(out_dir, exist_ok=True)
    dst = os.path.join(out_dir, char_id + ".webp")
    img.save(dst, "WEBP", quality=QUALITY, method=4)
    log(f"[chararts] {char_id} {img.width}x{img.height} {os.path.getsize(dst) // 1024} KB")
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ab", required=True, help="the client's AB/Windows directory")
    ap.add_argument("--out", default="public/assets", help="asset root (writes <out>/char/illust)")
    ap.add_argument("--chars", default="", help="comma separated charIds")
    ap.add_argument("--all", action="store_true", help="every chararts bundle in the client")
    ap.add_argument("--manifest", default="data/assets.json", help="with --all: take the char list from this manifest")
    args = ap.parse_args()

    if args.all:
        with open(args.manifest, encoding="utf-8") as fh:
            ids = list((json.load(fh).get("chars") or {}).keys())
    else:
        ids = [c.strip() for c in args.chars.split(",") if c.strip()]
    if not ids:
        print("no chars given", file=sys.stderr)
        return 2

    out_dir = os.path.join(args.out, "char", "illust")
    wrote, missing = [], []
    started = time.time()
    for cid in ids:
        dst = export_char(args.ab, cid, out_dir)
        (wrote if dst else missing).append(cid)
    print(json.dumps({
        "written": len(wrote), "missing": len(missing),
        "missingIds": missing[:20], "seconds": round(time.time() - started, 1),
        "dir": out_dir,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
