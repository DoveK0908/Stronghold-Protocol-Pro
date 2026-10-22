#!/usr/bin/env python3
"""Build a server hotfix zip (app/... paths) from the commits since a base tag.

The maintainer deploys releases as a portable bundle directory and applies small fixes with WinSCP:
unzip the zip in the bundle root (`python3 -m zipfile -e <zip> .`) and restart the service. This script keeps
that workflow in one place, and always writes into the workspace `hotfix/` folder so the packages do not scatter.

    python tools/make-hotfix.py                       # since the latest tag, today's date in the name
    python tools/make-hotfix.py --base v0.3.2-pro.5 --name uploads
    python tools/make-hotfix.py --paths public/js/ui/lobby.js,server/lobby.js
    python tools/make-hotfix.py --list                # only print what would be packed

Runtime files only: public/ (without public/assets and the non-English locale packs), server/, shared/,
data/*.json and mods/. Tests, tools, docs, scripts, workflows and packaging metadata never go into a hotfix.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import subprocess
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE = os.path.dirname(REPO)
OUT_DIR = os.path.join(WORKSPACE, 'hotfix')

SKIP_PREFIX = (
    'public/assets/', 'test/', 'tools/', 'docs/', 'scripts/', '.github/', 'deploy/', 'bench/',
    'public/i18n/ja', 'public/i18n/ko', 'public/i18n/zh-TW',
)
KEEP_PREFIX = ('public/', 'server/', 'shared/', 'data/', 'mods/')


def git(*args: str) -> str:
    return subprocess.check_output(['git', *args], cwd=REPO, text=True, encoding='utf-8').strip()


def latest_tag() -> str:
    return git('describe', '--tags', '--abbrev=0')


def changed(base: str) -> list[str]:
    out = git('diff', '--name-only', f'{base}..HEAD')
    return [line.strip().replace(chr(92), '/') for line in out.splitlines() if line.strip()]


def app_side(path: str) -> bool:
    if any(path.startswith(p) for p in SKIP_PREFIX):
        return False
    if not path.startswith(KEEP_PREFIX):
        return False
    return os.path.isfile(os.path.join(REPO, path.replace('/', os.sep)))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base', help='commit/tag to diff from (default: the latest tag)')
    ap.add_argument('--name', help="slug for the file name (default: today's date only)")
    ap.add_argument('--paths', help='comma separated paths to pack instead of diffing')
    ap.add_argument('--list', action='store_true', help='print the file list and exit')
    args = ap.parse_args()

    base = args.base or latest_tag()
    if args.paths:
        files = [p.strip().replace(chr(92), '/') for p in args.paths.split(',') if p.strip()]
        unknown = [p for p in files if not os.path.isfile(os.path.join(REPO, p.replace('/', os.sep)))]
        if unknown:
            print('missing files: ' + ', '.join(unknown), file=sys.stderr)
            return 2
    else:
        files = [p for p in changed(base) if app_side(p)]

    files = sorted(set(files))
    if not files:
        print(f'nothing to pack since {base}')
        return 0
    print(f'{len(files)} files since {base}:')
    for p in files:
        print('  ' + p)
    if args.list:
        return 0

    today = dt.date.today().isoformat()
    slug = args.name or 'hotfix'
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f'{today}_{slug}.zip')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(os.path.join(REPO, p.replace('/', os.sep)), 'app/' + p)
    size = os.path.getsize(out)
    print(f'\nwrote {out} ({size} bytes, {size / 1024:.0f} KB)')
    print('apply on the server:  cd <bundle root> && python3 -m zipfile -e <zip> . && sudo systemctl restart <service>')
    print('then hard refresh the browser (Ctrl+Shift+R).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
