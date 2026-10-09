#!/usr/bin/env python3
"""Copies shared/*.py into every plugin that ships a copy of it.

Run: python3 scripts/sync-shared.py           copy the files out
     python3 scripts/sync-shared.py --check   exit 1, listing them, when a copy differs

A plugin is installed on its own, so it can't import from shared/: each one
keeps a copy in its hooks/ folder. Edit the file in shared/, run this, and
commit the copies with it (and a new version for every plugin that changed).
"""
import os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SHARED = {
    "pricing.py": ["plugins/repo-spend/hooks"],
}


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    for name, folders in SHARED.items():
        with open(os.path.join(ROOT, "shared", name), "rb") as fh:
            source = fh.read()
        for folder in folders:
            path = os.path.join(ROOT, folder, name)
            try:
                with open(path, "rb") as fh:
                    if fh.read() == source:
                        continue
            except OSError:
                pass
            stale.append(os.path.relpath(path, ROOT))
            if not check:
                with open(path, "wb") as fh:
                    fh.write(source)
    for path in stale:
        print(("differs: " if check else "updated: ") + path)
    return 1 if check and stale else 0


if __name__ == "__main__":
    sys.exit(main())
