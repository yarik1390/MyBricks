#!/usr/bin/env python3
"""Build Android's circular launcher assets from the GPT Image 2 master."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "android/app/src/main/icon-round-gpt-image-2.png"
RESOURCE_ROOT = ROOT / "android/app/src/main/res"
DENSITIES = {"ldpi": 36, "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
YELLOW = (255, 215, 0, 255)  # #FFD700 from public/icon.svg
CHARCOAL = (28, 28, 30, 255)  # #1C1C1E from public/icon.svg


def clean_master() -> Image.Image:
    """Normalize the generated raster to the original icon's two-color brand."""
    source = Image.open(MASTER).convert("RGB")
    side = min(source.size)
    left = (source.width - side) // 2
    top = (source.height - side) // 2
    source = source.crop((left, top, left + side, top + side)).resize((1024, 1024), Image.Resampling.LANCZOS)

    # GPT Image 2 preserves the geometry well but introduces faint texture.
    # A luminance split restores the square icon's exact flat two-color system.
    gray = ImageOps.grayscale(source)
    yellow_region = gray.point([0] * 105 + [255] * 151)
    yellow_region = yellow_region.filter(ImageFilter.MedianFilter(3))

    cleaned = Image.new("RGBA", source.size, CHARCOAL)
    cleaned.paste(YELLOW, mask=yellow_region)

    # Enforce a mathematically circular silhouette and transparent legacy corners.
    circle = Image.new("L", source.size, 0)
    ImageDraw.Draw(circle).ellipse((20, 20, 1003, 1003), fill=255)
    cleaned.putalpha(circle)
    return cleaned


def render() -> None:
    cleaned = clean_master()
    for density, size in DENSITIES.items():
        output = RESOURCE_ROOT / f"mipmap-{density}" / "ic_launcher_round.png"
        output.parent.mkdir(parents=True, exist_ok=True)
        cleaned.resize((size, size), Image.Resampling.LANCZOS).save(output, optimize=True)
        print(output.relative_to(ROOT))

    preview = ROOT / "android/app/src/main/icon-round-preview.png"
    cleaned.save(preview, optimize=True)
    print(preview.relative_to(ROOT))


if __name__ == "__main__":
    render()
