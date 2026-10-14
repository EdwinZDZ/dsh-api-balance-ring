#!/usr/bin/env python3
"""Record a real demo of the API Balance Ring and build the README artwork.

The README's images must be real captures, not illustrations: a rendering can
look right while the plugin is broken, which is exactly the failure mode a
screenshot is supposed to catch. This script drives the capture end to end —
it does not touch the mouse or keyboard, the operator does that while it
records, so the interaction in the result is genuine.

    # 1. one still, to find the rectangle that holds the ring
    python scripts/capture-demo.py stills

    # 2. record while you operate the plugin (~20 s)
    python scripts/capture-demo.py record --region 700,1180,1160,260 --seconds 20

    # 3. turn the clip into the README gif
    python scripts/capture-demo.py gif --clip assets/demo.mp4

Suggested script to perform on camera, in one take:

    idle ~3 s  ->  hover the ring ~3 s  ->  click it, leave the panel up ~4 s
    ->  click away  ->  switch model to a DeepSeek provider  ->  idle ~3 s
    ->  hover ~3 s  ->  click, panel up ~4 s

That covers every mode the ring detects, which is the behaviour the README
describes.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FFMPEG = "ffmpeg"


def run(cmd: list[str]) -> None:
    print("$ " + " ".join(cmd))
    proc = subprocess.run(cmd)
    if proc.returncode != 0:
        sys.exit(f"command failed with exit {proc.returncode}")


def stills() -> None:
    """Grab one full-screen PNG so the ring's rectangle can be measured."""
    out = ASSETS / "capture-still.png"
    run([FFMPEG, "-y", "-f", "gdigrab", "-i", "desktop", "-frames:v", "1", str(out)])
    print(f"\nwrote {out}")
    print("measure the ring's rectangle and pass it as --region L,T,W,H")


def record(region: str, seconds: int, fps: int) -> None:
    """Record one screen rectangle. Nothing is synthesised: what you do is what
    lands in the clip."""
    if "," not in region:
        sys.exit("--region must be L,T,W,H")
    left, top, width, height = (int(v) for v in region.split(","))
    out = ASSETS / "demo.mp4"
    run([
        FFMPEG, "-y",
        "-f", "gdigrab",
        "-framerate", str(fps),
        "-offset_x", str(left),
        "-offset_y", str(top),
        "-video_size", f"{width}x{height}",
        "-i", "desktop",
        "-t", str(seconds),
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        str(out),
    ])
    print(f"\nwrote {out} — now run: python scripts/capture-demo.py gif --clip {out}")


def gif(clip: Path, fps: int, width: int) -> None:
    """Two-pass palette GIF — noticeably cleaner than a single-pass conversion."""
    palette = ASSETS / ".palette.png"
    out = ASSETS / "demo.gif"
    scale = f"scale={width}:-2:flags=lanczos"
    run([FFMPEG, "-y", "-i", str(clip), "-vf", f"fps={fps},{scale},palettegen=stats_mode=diff", str(palette)])
    run([FFMPEG, "-y", "-i", str(clip), "-i", str(palette),
         "-lavfi", f"fps={fps},{scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4",
         "-loop", "0", str(out)])
    palette.unlink(missing_ok=True)
    print(f"\nwrote {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("stills", help="grab one full-screen PNG to measure the region from")

    rec = sub.add_parser("record", help="record a screen rectangle while you operate the plugin")
    rec.add_argument("--region", required=True, help="rectangle as L,T,W,H in physical pixels")
    rec.add_argument("--seconds", type=int, default=20)
    rec.add_argument("--fps", type=int, default=15)

    g = sub.add_parser("gif", help="build assets/demo.gif from a recorded clip")
    g.add_argument("--clip", type=Path, default=ASSETS / "demo.mp4")
    g.add_argument("--fps", type=int, default=12)
    g.add_argument("--width", type=int, default=1100)

    args = ap.parse_args()
    ASSETS.mkdir(exist_ok=True)
    if args.cmd == "stills":
        stills()
    elif args.cmd == "record":
        record(args.region, args.seconds, args.fps)
    else:
        gif(args.clip, args.fps, args.width)


if __name__ == "__main__":
    main()
