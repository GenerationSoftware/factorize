"""Restore only immutable assets from trusted successful deployment artifacts.
Never restore entry HTML, configuration, symlinks, or paths outside dist/assets.
"""
import argparse
import pathlib
import re
import stat
import zipfile


def restore(archive, destination):
    destination = pathlib.Path(destination)
    count = 0
    with zipfile.ZipFile(archive) as source:
        for item in source.infolist():
            if not re.fullmatch(r"assets/[A-Za-z0-9_.-]+|styles\.css", item.filename):
                continue
            if stat.S_ISLNK(item.external_attr >> 16) or item.file_size > 25_000_000:
                raise ValueError("Invalid retained asset")
            target = destination / item.filename
            content = source.read(item)
            if target.exists():
                if target.read_bytes() != content:
                    raise ValueError("Immutable asset collision: " + item.filename)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            count += 1
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("destination")
    arguments = parser.parse_args()
    print(f"Retained {restore(arguments.archive, arguments.destination)} assets")
