#!/usr/bin/env python3
"""Render the in-app 3D brick artwork (empty Vault fallback) from its source.

The app icon itself is rendered by scripts/render-vault-icons.mjs.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PRIMARY = ROOT / "assets/brand/icon-brick-primary.jpg"
PUBLIC = ROOT / "public"

def source(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGB")
    if image.width != image.height:
        edge = min(image.size)
        left = (image.width - edge) // 2
        top = (image.height - edge) // 2
        image = image.crop((left, top, left + edge, top + edge))
    return image


def extract_warm_subject(image: Image.Image) -> Image.Image:
    """Remove the dark generated canvas while preserving anti-aliased orange edges."""
    rgb = image.convert("RGB")
    alpha = Image.new("L", rgb.size)
    src = rgb.load()
    dst = alpha.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            red, green, blue = src[x, y]
            maximum = max(red, green, blue)
            chroma = maximum - min(red, green, blue)
            warm = max(0, red - blue - 8)
            strength = max(chroma - 7, warm)
            opacity = max(0, min(255, int((strength - 4) * 6)))
            dst[x, y] = 0 if maximum < 24 else opacity
    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)
    bounds = alpha.getbbox()
    if not bounds:
        raise ValueError("approved artwork has no warm subject")
    return rgba.crop(bounds)












def transparent_brand_mark(subject: Image.Image, size: int = 192) -> Image.Image:
    """Render the 3D brick alone for use inside the app chrome."""
    scale = min(size * 0.92 / subject.width, size * 0.92 / subject.height)
    artwork = subject.resize(
        (round(subject.width * scale), round(subject.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - artwork.width) // 2, (size - artwork.height) // 2)
    canvas.alpha_composite(artwork, offset)
    return canvas






def save_rgba(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGBA").save(path, format="PNG", optimize=True)


def main() -> None:
    primary = extract_warm_subject(source(PRIMARY))
    save_rgba(transparent_brand_mark(primary), PUBLIC / "brand-brick-transparent.png")
    print("Rendered the in-app brick artwork")


if __name__ == "__main__":
    main()
