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


def normalise(src: Path, dst: Path, skin: str, log) -> int:
    """Move a freshly written Spine model into `<dst>` as `<skin>.skel|.atlas|.png`.

    `write_spine` names the files after the skeleton inside the bundle (`…ambienceSynesthesia#6`), while our renderer
    loads `<skinId>.skel`/`.atlas` and pixi-spine resolves page names relative to the atlas: rename all three and
    rewrite the atlas page line so the set stays consistent whatever the client called them."""
    files = sorted(src.glob('*'))
    skel = next((p for p in files if p.suffix.lower() == '.skel'), None)
    atlas = next((p for p in files if p.suffix.lower() == '.atlas'), None)
    pages = [p for p in files if p.suffix.lower() in ('.png', '.webp')]
    if skel is None or atlas is None or not pages:
        log(f'  warn {skin}: extraction produced {[p.name for p in files]}')
        return 0
    dst.mkdir(parents=True, exist_ok=True)
    for stale in dst.glob('*'):
        if stale.is_file():
            stale.unlink()
    shutil.copyfile(skel, dst / f'{skin}.skel')
    page = pages[0]
    shutil.copyfile(page, dst / f'{skin}{page.suffix.lower()}')
    lines = atlas.read_text(encoding='utf-8').splitlines(keepends=True)
    if lines:
        lines[0] = f'{skin}{page.suffix.lower()}\n'
    (dst / f'{skin}.atlas').write_text(''.join(lines), encoding='utf-8')
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
                    got += normalise(tmp / side, out_root / skin / side, skin, log)
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
