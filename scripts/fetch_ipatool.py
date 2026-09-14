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
from __future__ import annotations

import argparse
import io
import json
import os
import re
import stat
import sys
import tarfile
import traceback
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

REPO = "majd/ipatool"
API_LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"

ASSET_NAME_RE = re.compile(r"ipatool_[^_]+_(?P<plat>[a-z]+)_(?P<arch>[a-z0-9]+)", re.IGNORECASE)


# ------------------------------- logging -----------------------------------

def log(msg: str = "") -> None:
    """Always print to stdout (so GitHub Actions shows it) and flush."""
    print(msg, flush=True)


def err(msg: str) -> None:
    """Print an error both to stdout (visible in step log) and via the
    `::error::` GitHub Actions annotation (visible in the Actions summary)."""
    # Single-line form for the annotation (newlines would break it).
    single = " ".join(msg.splitlines())
    print(f"::error:: {single}", flush=True)
    print(f"[ERROR] {msg}", flush=True)


def step(n: int, title: str) -> None:
    log(f"\n=== STEP {n}: {title} ===")


# ------------------------------- GitHub API --------------------------------

def _gh_headers(extra: dict | None = None) -> dict:
    """Build request headers for the GitHub API. If GITHUB_TOKEN is in the
    environment (always present in GitHub Actions), use it for auth so we
    get the 5000 req/hour limit instead of the anonymous 60/hour."""
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "ipatool-gui-ci",
    }
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    else:
        log("  (no GITHUB_TOKEN in env — using anonymous rate limit of 60/hour)")
    if extra:
        headers.update(extra)
    return headers


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=_gh_headers())
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode()
            log(f"  HTTP {resp.status} {resp.reason} — {len(body)} bytes")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:500]
        err(f"GitHub API returned HTTP {e.code} for {url}\n  response: {body}")
        raise
    except Exception as e:
        err(f"Request to {url} failed: {e}")
        raise


def download(url: str) -> bytes:
    """Download a release asset. Uses the same auth header (objects.githubusercontent.com
    honours the Authorization header for downloads of private repo assets, but is
    also fine for public ones)."""
    req = urllib.request.Request(url, headers=_gh_headers())
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = resp.read()
            log(f"  HTTP {resp.status} {resp.reason} — {len(data)} bytes")
            return data
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:500]
        err(f"Download from {url} failed: HTTP {e.code}\n  response: {body}")
        raise
    except Exception as e:
        err(f"Download from {url} failed: {e}")
        raise


def pick_asset(release: dict, pattern: str) -> dict:
    """Find the release asset matching our target. We try the supplied
    pattern first, then fall back to common variants for the same platform
    so we survive minor naming changes between ipatool releases.

    Asset naming in majd/ipatool v2.6.0+ uses dash separators:
      ipatool-<version>-<os>-<arch>.tar.gz
    where <os> ∈ {macos, linux, windows, ios}. We still support the older
    `darwin_arm64` underscore form in case anyone copy-pastes it from docs.
    """
    assets = release.get("assets", []) or []
    log(f"  release has {len(assets)} asset(s):")
    for a in assets:
        log(f"    - {a.get('name')}  ({a.get('size')} bytes, {a.get('browser_download_url')})")

    p = pattern.lower()
    variants: list[str] = [p]
    # Cross-product: both separators
    variants.append(p.replace("_", "-") if "_" in p else p.replace("-", "_"))
    # OS-name aliases (darwin -> macos, windows -> win)
    os_aliases: list[tuple[str, str]] = [
        ("darwin", "macos"),
        ("darwin", "mac"),
        ("windows", "win"),
    ]
    extra: list[str] = []
    for src, dst in os_aliases:
        if p.startswith(src + "_") or p == src or src + "-" in p or src + "_" in p:
            # underscore form
            u = p.replace(src + "_", dst + "_") if src + "_" in p else p.replace(src, dst, 1)
            extra.append(u)
            # dash form
            extra.append(u.replace("_", "-") if "_" in u else u.replace("-", "_"))
    variants.extend(extra)

    # Deduplicate while preserving order
    seen: set[str] = set()
    candidates = [v for v in variants if v and (v not in seen or seen.add(v))]
    log(f"  trying patterns in order: {candidates}")

    for cand in candidates:
        for asset in assets:
            name = asset.get("name", "")
            if cand in name.lower():
                log(f"  ✓ matched '{cand}' against asset '{name}'")
                return asset

    available = "\n".join(f"  - {a.get('name')}" for a in assets)
    err(
        f"No asset matching any of {candidates} in release "
        f"{release.get('tag_name')}.\nAvailable assets:\n{available}"
    )
    raise RuntimeError(
        f"No asset matching any of {candidates} in release {release.get('tag_name')}."
    )


def detect_format(blob: bytes, hint: str) -> str:
    """Detect archive format from magic bytes. The `hint` is the file
    extension we were told to expect; if magic bytes contradict it, magic
    bytes win (so a tar.gz asset mistakenly labelled as .zip is still
    handled correctly).

    Returns one of: 'zip', 'tar.gz', 'tar', 'unknown'.
    """
    if blob[:4] == b"PK\x03\x04" or blob[:4] == b"PK\x05\x06":
        return "zip"
    if blob[:2] == b"\x1f\x8b":
        # gzip — almost certainly tar.gz
        return "tar.gz"
    # ustar magic at offset 257
    if len(blob) > 265 and blob[257:262] == b"ustar":
        return "tar"
    # Fallback: trust the hint.
    log(f"  warning: could not detect archive format from magic bytes; "
        f"falling back to hint={hint!r}")
    return hint


def list_archive(blob: bytes, ext: str) -> None:
    """Print the contents of the archive so the CI log shows what we're
    about to extract from."""
    fmt = detect_format(blob, ext)
    log(f"  detected archive format: {fmt} (hint was {ext!r})")
    log("  archive contents:")
    try:
        if fmt == "zip":
            with zipfile.ZipFile(io.BytesIO(blob)) as zf:
                for info in zf.infolist():
                    kind = "DIR " if info.is_dir() else "FILE"
                    log(f"    [{kind}] {info.filename}  ({info.file_size} bytes)")
        elif fmt in ("tar.gz", "tar"):
            mode = "r:gz" if fmt == "tar.gz" else "r:"
            with tarfile.open(fileobj=io.BytesIO(blob), mode=mode) as tf:
                for m in tf.getmembers():
                    kind = "DIR " if m.isdir() else ("LINK" if m.issym() or m.islnk() else "FILE")
                    log(f"    [{kind}] {m.name}  ({m.size} bytes)")
    except Exception as e:
        err(f"  failed to list archive: {e}")
        raise


def extract_ipatool(blob: bytes, ext: str) -> bytes:
    """Return the raw bytes of the `ipatool` (or ipatool.exe) binary inside
    the archive."""
    list_archive(blob, ext)
    fmt = detect_format(blob, ext)

    def matches(base: str) -> bool:
        b = base.lower()
        return b in ("ipatool", "ipatool.exe") or (
            b.startswith("ipatool") and b.endswith(".exe")
        )

    if fmt == "zip":
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            # First pass: exact name match.
            for info in zf.infolist():
                if info.is_dir():
                    continue
                base = os.path.basename(info.filename)
                if matches(base):
                    log(f"  ✓ extracting '{info.filename}' (exact match)")
                    return zf.read(info.filename)
            # Second pass: any name containing 'ipatool'.
            for info in zf.infolist():
                if info.is_dir():
                    continue
                base = os.path.basename(info.filename)
                if "ipatool" in base.lower():
                    log(f"  ✓ extracting '{info.filename}' (substring match)")
                    return zf.read(info.filename)
    elif fmt in ("tar.gz", "tar"):
        mode = "r:gz" if fmt == "tar.gz" else "r:"
        with tarfile.open(fileobj=io.BytesIO(blob), mode=mode) as tf:
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                base = os.path.basename(member.name)
                if matches(base):
                    log(f"  ✓ extracting '{member.name}' (exact match)")
                    f = tf.extractfile(member)
                    if f:
                        return f.read()
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                base = os.path.basename(member.name)
                if "ipatool" in base.lower():
                    log(f"  ✓ extracting '{member.name}' (substring match)")
                    f = tf.extractfile(member)
                    if f:
                        return f.read()
    err("Could not locate ipatool binary inside the archive "
        "(see archive contents above).")
    raise RuntimeError("Could not locate ipatool binary inside the archive")


# ------------------------------- main --------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--target", required=True, help="Rust target triple")
    p.add_argument("--pattern", required=True, help="Asset name substring to match")
    p.add_argument("--ext", required=True, choices=["tar.gz", "zip"])
    p.add_argument("--out-dir", default="src-tauri/binaries",
                   help="Where to write the extracted binary")
    return p.parse_args()


def main() -> int:
    try:
        args = parse_args()
        log(f"fetch_ipatool starting")
        log(f"  target  = {args.target}")
        log(f"  pattern = {args.pattern}")
        log(f"  ext     = {args.ext}")
        log(f"  out_dir = {args.out_dir}")

        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)

        step(1, f"GET {API_LATEST}")
        release = http_get_json(API_LATEST)
        log(f"  latest release tag : {release.get('tag_name')}")
        log(f"  latest release name: {release.get('name')}")

        step(2, f"pick asset matching '{args.pattern}'")
        asset = pick_asset(release, args.pattern)
        log(f"  selected asset: {asset.get('name')}  ({asset.get('size')} bytes)")

        step(3, "download asset")
        blob = download(asset.get("browser_download_url"))
        log(f"  downloaded {len(blob)} bytes")

        step(4, "extract ipatool binary from archive")
        bin_bytes = extract_ipatool(blob, args.ext)
        log(f"  extracted ipatool binary: {len(bin_bytes)} bytes")
        if len(bin_bytes) < 1024:
            err(f"extracted binary is suspiciously small ({len(bin_bytes)} bytes) — "
                "extraction likely failed.")
            return 2

        step(5, "write binary to src-tauri/binaries/")
        is_windows = "windows" in args.target
        out_name = f"ipatool-{args.target}" + (".exe" if is_windows else "")
        out_path = out_dir / out_name
        out_path.write_bytes(bin_bytes)
        if not is_windows:
            st = os.stat(out_path)
            os.chmod(out_path, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        # Verify write.
        actual_size = out_path.stat().st_size
        log(f"  wrote {out_path} ({actual_size} bytes)")
        if actual_size != len(bin_bytes):
            err(f"file size mismatch after write: expected {len(bin_bytes)}, "
                f"got {actual_size}")
            return 3

        step(6, "final listing")
        for f in sorted(out_dir.iterdir()):
            log(f"  {f.name}  ({f.stat().st_size} bytes)")

        log("\n✓ fetch_ipatool completed successfully")
        return 0

    except SystemExit:
        raise
    except Exception as e:
        err(f"fetch_ipatool failed: {type(e).__name__}: {e}")
        err("Full traceback:")
        err(traceback.format_exc())
        return 1


if __name__ == "__main__":
    sys.exit(main())
