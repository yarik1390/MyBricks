#!/usr/bin/env python3
"""Build Android's circular launcher assets from the user-approved artwork."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "android/app/src/main/icon-round-approved.jpg"
PREVIEW = ROOT / "android/app/src/main/icon-round-preview.png"
RESOURCE_ROOT = ROOT / "android/app/src/main/res"
DENSITIES = {"ldpi": 36, "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def approved_master() -> Image.Image:
    """Crop the supplied square and preserve its artwork without redesigning it."""
    source = Image.open(MASTER).convert("RGB")
    side = min(source.size)
    left = (source.width - side) // 2
    top = (source.height - side) // 2
    source = source.crop((left, top, left + side, top + side)).convert("RGBA")

    # The supplied JPEG is shown on white. Keep every pixel of the approved
    # circular artwork, but make the surrounding canvas transparent for legacy
    # launchers. Supersampling retains the original soft antialiased perimeter.
    scale = 4
    alpha = Image.new("L", (side * scale, side * scale), 0)
    ImageDraw.Draw(alpha).ellipse((20 * scale, 20 * scale, 1004 * scale, 1004 * scale), fill=255)
    source.putalpha(alpha.resize((side, side), Image.Resampling.LANCZOS))
    return source


def render() -> None:
    master = approved_master()
    master.save(PREVIEW, optimize=True)
    for density, size in DENSITIES.items():
        output = RESOURCE_ROOT / f"mipmap-{density}" / "ic_launcher_round.png"
        output.parent.mkdir(parents=True, exist_ok=True)
        master.resize((size, size), Image.Resampling.LANCZOS).save(output, optimize=True)


if __name__ == "__main__":
    render()
