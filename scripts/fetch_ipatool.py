#!/usr/bin/env python3
"""
Fetch the latest ipatool release asset matching a target pattern, extract the
ipatool executable, and place it under src-tauri/binaries/ as
`ipatool-<target-triple>` (or `ipatool-<target-triple>.exe` on Windows).

Tauri's `externalBin` mechanism requires binaries named exactly like this:
    <name>-<rust-target-triple>[.exe]

Inputs (CLI flags):
  --target       Rust target triple, e.g. x86_64-pc-windows-msvc
  --pattern      Substring to match in ipatool's release asset name, e.g.
                 darwin_arm64 / linux_amd64 / windows_amd64
  --ext          'tar.gz' or 'zip' — selects the right unpacker

This script is invoked from .github/workflows/build.yml.
"""
import argparse
import io
import os
import re
import shutil
import stat
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

REPO = "ipatool/ipatool"
API_LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"

ASSET_NAME_RE = re.compile(r"ipatool_[^_]+_(?P<plat>[a-z]+)_(?P<arch>[a-z0-9]+)", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--target", required=True, help="Rust target triple")
    p.add_argument("--pattern", required=True, help="Asset name substring to match")
    p.add_argument("--ext", required=True, choices=["tar.gz", "zip"])
    p.add_argument("--out-dir", default="src-tauri/binaries",
                   help="Where to write the extracted binary")
    return p.parse_args()


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "ipatool-gui-ci",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        import json
        return json.loads(resp.read().decode())


def pick_asset(release: dict, pattern: str) -> dict:
    for asset in release.get("assets", []):
        name = asset.get("name", "")
        if pattern.lower() in name.lower():
            return asset
    raise RuntimeError(f"No asset matching '{pattern}' in release {release.get('tag_name')}")


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "ipatool-gui-ci"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read()


def extract_ipatool(blob: bytes, ext: str) -> bytes:
    """Return the raw bytes of the `ipatool` (or ipatool.exe) binary inside
    the archive."""
    if ext == "zip":
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                base = os.path.basename(info.filename).lower()
                if base in ("ipatool", "ipatool.exe") or (
                    base.startswith("ipatool") and base.endswith(".exe")
                ):
                    return zf.read(info.filename)
            # Fallback: pick the only executable-looking entry.
            for info in zf.infolist():
                if info.is_dir():
                    continue
                base = os.path.basename(info.filename).lower()
                if "ipatool" in base:
                    return zf.read(info.filename)
    elif ext == "tar.gz":
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                base = os.path.basename(member.name).lower()
                if base in ("ipatool", "ipatool.exe") or (
                    base.startswith("ipatool") and base.endswith(".exe")
                ):
                    f = tf.extractfile(member)
                    if f:
                        return f.read()
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                base = os.path.basename(member.name).lower()
                if "ipatool" in base:
                    f = tf.extractfile(member)
                    if f:
                        return f.read()
    raise RuntimeError("Could not locate ipatool binary inside the archive")


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"::group::Fetching {API_LATEST}")
    release = http_get_json(API_LATEST)
    print(f"Latest release: {release.get('tag_name')} — {release.get('name')}")
    print("::endgroup::")

    asset = pick_asset(release, args.pattern)
    print(f"Selected asset: {asset.get('name')} ({asset.get('size')} bytes)")
    blob = download(asset.get("browser_download_url"))
    print(f"Downloaded {len(blob)} bytes")

    bin_bytes = extract_ipatool(blob, args.ext)
    print(f"Extracted ipatool binary: {len(bin_bytes)} bytes")

    # Tauri externalBin naming convention: <name>-<rust-target-triple>[.exe]
    is_windows = "windows" in args.target
    out_name = f"ipatool-{args.target}" + (".exe" if is_windows else "")
    out_path = out_dir / out_name
    out_path.write_bytes(bin_bytes)
    if not is_windows:
        st = os.stat(out_path)
        os.chmod(out_path, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    # Write a tiny JSON summary that the workflow can cat for debugging.
    summary = {
        "release_tag": release.get("tag_name"),
        "asset_name": asset.get("name"),
        "asset_size": asset.get("size"),
        "target": args.target,
        "output": str(out_path),
        "output_size": len(bin_bytes),
    }
    print(f"::set-output name=summary::{summary}")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
