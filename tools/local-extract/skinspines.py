#!/usr/bin/env python3
"""Re-extract the battle Spine of every skin from the installed client's skinpack.

The PRTS skin plugin we downloaded from writes its atlas pages premultiplied and clamps them with `min(RGB, A)`,
which is lossy — dark rings around the eyes survive any later "un-premultiply". The client's own
`skinpack/<charId>.ab` holds the straight-alpha pages, so this writes
`<out>/<skinId>/{front,back}/{skinId}.skel|.atlas` plus the page textures with `extract.write_spine`
(same straight-alpha口径 as the operator/enemy/token spine jobs).

Usage (from the repo root, with the extraction venv):

    .venv-extract/Scripts/python.exe tools/local-extract/skinspines.py \
        --assets data/assets.json \
        --out public/assets/skins \
        --skin-bundles "D:/Hypergryph Launcher/games/Arknights Game/Arknights_Data/StreamingAssets/AB/Windows" \
        [--skin-bundles <PersistentData/Bundles>] [--only char_249_mlyss_ambienceSynesthesia_6,...]

`--skin-bundles` points at an AB root (the script looks in `<root>/skinpack/<charId>.ab`); repeatable, the first
root holding the file wins. Bundles are loaded one at a time; `--only` limits the skins (comma separated ids).
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXTRACT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(EXTRACT_DIR))


def skin_char_map(assets_path: Path) -> dict[str, list[str]]:
    """{charId: [skinId, …]} from data/assets.json (chars[].skins keys)."""
    data = json.loads(assets_path.read_text(encoding='utf-8'))
    out: dict[str, list[str]] = {}
    for char_id, rec in (data.get('chars') or {}).items():
        skins = list((rec.get('skins') or {}).keys())
        if skins:
            out[char_id] = sorted(skins)
    return out


def skin_skel_names(assets_path: Path) -> dict[str, dict[str, str]]:
    """{skinId: {side: '<basename>.skel'}} — the skeleton file name data/assets.json asks each skin side for.

    The manifest is what the renderer loads, so it decides the name: an operator skin written as
    `<skin>.display.skel` by tools/prepare-operator-skins.mjs (its normalised display copy) keeps that name here."""
    data = json.loads(assets_path.read_text(encoding='utf-8'))
    out: dict[str, dict[str, str]] = {}
    for rec in (data.get('chars') or {}).values():
        for skin_id, skin in (rec.get('skins') or {}).items():
            sides = {}
            for side in ('front', 'back'):
                skel = ((skin.get('spine') or {}).get(side) or {}).get('skel')
                if isinstance(skel, str) and skel.endswith('.skel'):
                    sides[side] = skel.rsplit('/', 1)[-1]
            if sides:
                out[skin_id] = sides
    return out


def skin_prefab_entry(container, char_id: str, skin_id: str):
    """The container entry of a skin's battle prefab, if this bundle carries it.

    The client spells a skin as `char_x_…_ambienceSynesthesia#6` while our catalogue keeps `…_6`: match either the
    underscore or the `#<n>` form, case-insensitively."""
    import re
    forms = {skin_id.lower(), re.sub(r'_(\d+)$', r'#\1', skin_id).lower()}
    for name, ref in container.items():
        low = name.lower()
        if 'battle/prefabs/skins' in low and any(low.endswith('/' + f + '.prefab') for f in forms):
            return ref
    for name, ref in container.items():
        low = name.lower()
        if 'battle/prefabs' in low and low.endswith('.prefab') and any(f in low for f in forms):
            return ref
    return None


def strip_editor_roots(source: bytes) -> tuple[bytes, list[str]]:
    """Drop the Spine editor's image/audio roots (`imagesPath`, `audioPath`) from a 3.8 binary skeleton.

    Same output as the Node `normalizeSkelPaths` (tools/assets/skel.mjs) the operator job uses: everything after the
    skeleton's non-essential header block is kept byte for byte, so only the two paths change. Returns the bytes and the
    names of the fields that were removed."""
    index = 0

    def read_string() -> bytes | None:
        nonlocal index
        result = 0
        for shift in (0, 7, 14, 21, 28):
            byte = source[index]
            index += 1
            result |= (byte & 0x7F) << shift
            if not byte & 0x80:
                break
        if result == 0:
            return None
        start = index
        index += result - 1
        return source[start:index]

    read_string()  # hash
    version = read_string()
    if version is None or not version.startswith(b'3.8.'):
        return source, []
    index += 16  # x, y, width, height (four floats)
    if not source[index]:
        return source, []
    index += 1 + 4  # nonessential flag, fps
    spans = []
    for field in ('imagesPath', 'audioPath'):
        start = index
        if read_string():
            spans.append((field, start, index))
    if not spans:
        return source, []
    out = bytearray()
    offset = 0
    for _field, start, end in spans:
        out += source[offset:start]
        out.append(1)  # Spine's encoding of an empty string
        offset = end
    out += source[offset:]
    return bytes(out), [field for field, _s, _e in spans]


def _atlas_lines(text: str) -> list[str]:
    return text.replace('\r\n', '\n').replace('\r', '\n').lstrip('\ufeff').split('\n')


def _page_line(lines: list[str], i: int) -> bool:
    """Same rule as extract.py `_is_page_line`: an unindented line without ':' that comes first or after a blank line."""
    line = lines[i]
    return bool(line.strip()) and ':' not in line and not line[:1].isspace() and (i == 0 or not lines[i - 1].strip())


def normalise(src: Path, dst: Path, skin: str, log, skel_name: str) -> int:
    """Move a freshly written Spine model into `<dst>` as `<skel_name>|.atlas|.png`.

    `write_spine` names the files after the skeleton inside the bundle (`…ambienceSynesthesia#6`), while our renderer
    loads `<skinId>.skel`/`.atlas` and pixi-spine resolves page names relative to the atlas: rename all three and
    rewrite the atlas page line so the set stays consistent whatever the client called them.

    `skel_name` is the skeleton name data/assets.json asks this skin side for; a client skeleton that carries editor
    roots is written as `<skin>.display.skel` there (tools/prepare-operator-skins.mjs model(): `displayStem`). Writing
    the plain name instead left those skins unloadable and the renderer fell back to the old premultiplied PRTS page:
    the dark rings around the eyes."""
    files = sorted(src.glob('*'))
    skel = next((p for p in files if p.suffix.lower() == '.skel'), None)
    atlas = next((p for p in files if p.suffix.lower() == '.atlas'), None)
    pages = [p for p in files if p.suffix.lower() in ('.png', '.webp')]
    if skel is None or atlas is None or not pages:
        log(f'  warn {skin}: extraction produced {[p.name for p in files]}')
        return 0
    body, _removed = strip_editor_roots(skel.read_bytes())
    dst.mkdir(parents=True, exist_ok=True)
    for stale in dst.glob('*'):
        if stale.is_file():
            stale.unlink()
    (dst / skel_name).write_bytes(body)
    page = pages[0]
    page_name = f'{skin}{page.suffix.lower()}'
    shutil.copyfile(page, dst / page_name)
    # The client atlas starts with a blank line, so the page name is actually line 1: replacing line 0 alone left the
    # original `<skeleton>#<n>.png` in place and produced two consecutive page lines. Drop every page line and write
    # the one name we actually ship, with the LF endings tools/local-extract/extract.py normalize_atlas produces.
    #
    # The name must be followed by its fields immediately: a blank line there ends the page header, and pixi-spine then
    # reads `size:` as the start of a region ("Spine: error in texture loader … reading 'baseTexture'"). The client text
    # begins with that blank line, so drop the edge blanks too — public/assets/spine/op/*/*.atlas has the same shape.
    lines = _atlas_lines(atlas.read_text(encoding='utf-8'))
    body_lines = [line for i, line in enumerate(lines) if not _page_line(lines, i)]
    while body_lines and not body_lines[0].strip():
        body_lines.pop(0)
    while body_lines and not body_lines[-1].strip():
        body_lines.pop()
    (dst / f'{skin}.atlas').write_text('\n'.join([page_name, *body_lines]) + '\n', encoding='utf-8')
    return 3


def run(args) -> int:
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    from extract import prefab_spine_nodes, write_spine  # noqa: E402  (needs sys.path above)

    def log(line):
        print(line, flush=True)

    assets = Path(args.assets)
    out_root = Path(args.out)
    roots = [Path(p) for p in args.skin_bundles]
    chars = skin_char_map(assets)
    names = skin_skel_names(assets)
    only = {s.strip() for s in args.only.split(',') if s.strip()} if args.only else None
    todo = {c: [s for s in skins if not only or s in only] for c, skins in chars.items()}
    todo = {c: s for c, s in todo.items() if s}
    total = sum(len(v) for v in todo.values())
    log(f'skins to export: {total} across {len(todo)} operator bundles')

    written = missing_bundle = failed = 0
    for char_id, skin_ids in sorted(todo.items()):
        bundle = next((r / 'skinpack' / f'{char_id}.ab' for r in roots if (r / 'skinpack' / f'{char_id}.ab').is_file()), None)
        if bundle is None:
            for skin in skin_ids:
                log(f'  skip {skin}: no skinpack/{char_id}.ab in {", ".join(str(r) for r in roots)}')
            missing_bundle += len(skin_ids)
            continue
        try:
            env = UnityPy.load(str(bundle))
        except Exception as e:
            log(f'  FAIL load {bundle.name}: {e}')
            failed += len(skin_ids)
            continue
        objects = {o.path_id: o for o in env.objects}
        for skin in skin_ids:
            entry = skin_prefab_entry(env.container, char_id, skin)
            if entry is None:
                log(f'  skip {skin}: prefab not in {bundle.name}')
                failed += 1
                continue
            try:
                nodes = prefab_spine_nodes(entry.read_typetree(), objects)
            except Exception as e:
                log(f'  warn {skin}: prefab unreadable: {e}')
                failed += 1
                continue
            sides = {}
            for name, _active, ref in nodes:
                if ref and not ref.get('m_FileID'):
                    side = 'front' if str(name).lower().startswith('front') else ('back' if str(name).lower().startswith('back') else None)
                    if side and side not in sides:
                        sides[side] = ref
            if not sides:
                log(f'  warn {skin}: no Spine renderer in its prefab')
                failed += 1
                continue
            got = 0
            for side, ref in sides.items():
                sda = objects.get(ref.get('m_PathID'))
                if sda is None:
                    continue
                tmp = Path(tempfile.mkdtemp(prefix='skin-'))
                try:
                    k = write_spine(objects, sda.read_typetree(), side, skin, tmp, {}, log)
                except Exception as e:
                    log(f'  warn {skin}/{side}: {e}')
                    k = 0
                if k:
                    skel_name = names.get(skin, {}).get(side) or f'{skin}.skel'
                    got += normalise(tmp / side, out_root / skin / side, skin, log, skel_name)
                shutil.rmtree(tmp, ignore_errors=True)
            if got:
                written += 1
                log(f'  {skin}: {got} files ({", ".join(sorted(sides))})')
            else:
                failed += 1
    log(f'done: {written} skins written, {failed} failed, {missing_bundle} without bundle')
    return 0 if failed == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--assets', default=str(ROOT / 'data/assets.json'))
    ap.add_argument('--out', default=str(ROOT / 'public/assets/skins'))
    ap.add_argument('--skin-bundles', action='append', default=[], metavar='DIR', required=True,
                    help='AB root holding skinpack/<charId>.ab (repeatable; first hit wins)')
    ap.add_argument('--only', default='', metavar='SKIN1,SKIN2', help='only these skin ids')
    return run(ap.parse_args())


if __name__ == '__main__':
    sys.exit(main())
