#!/usr/bin/env python3
"""Render Brickvault icon assets from the approved source artwork."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PRIMARY = ROOT / "assets/brand/icon-brick-primary.jpg"
GLOW = ROOT / "assets/brand/icon-brick-glow.jpg"
PUBLIC = ROOT / "public"
RES = ROOT / "android/app/src/main/res"

DENSITY_PX = {"ldpi": 36, "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE_PX = {"ldpi": 81, "mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


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


def seamless_background(size: int) -> Image.Image:
    high = size * 2
    canvas = Image.new("RGB", (high, high), "#050507")
    draw = ImageDraw.Draw(canvas)
    for step in range(120, 0, -1):
        progress = step / 120
        radius = int(high * 0.48 * progress)
        shade = int(5 + 13 * (1 - progress))
        draw.ellipse(
            (high // 2 - radius, high // 2 - radius, high // 2 + radius, high // 2 + radius),
            fill=(shade, shade, shade + 2),
        )
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def place_subject(subject: Image.Image, size: int, fraction: float) -> Image.Image:
    scale = min(size * fraction / subject.width, size * fraction / subject.height)
    artwork = subject.resize(
        (round(subject.width * scale), round(subject.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = seamless_background(size).convert("RGBA")
    offset = ((size - artwork.width) // 2, (size - artwork.height) // 2)
    canvas.alpha_composite(artwork, offset)
    return canvas


def circle_mask(size: int) -> Image.Image:
    high = size * 4
    mask = Image.new("L", (high, high), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, high - 1, high - 1), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def round_legacy(subject: Image.Image, size: int) -> Image.Image:
    rendered = place_subject(subject, size, 0.70)
    rendered.putalpha(circle_mask(size))
    return rendered


def adaptive_foreground(subject: Image.Image, size: int) -> Image.Image:
    # Keep the complete approved composition in Android's adaptive safe zone.
    scale = min(size * 0.62 / subject.width, size * 0.62 / subject.height)
    artwork = subject.resize(
        (round(subject.width * scale), round(subject.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - artwork.width) // 2, (size - artwork.height) // 2)
    canvas.alpha_composite(artwork, offset)
    return canvas


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


def splash(primary: Image.Image, glow: Image.Image, size: int = 2732) -> Image.Image:
    background = seamless_background(size).convert("RGBA")

    def add_layer(subject: Image.Image, fraction: float, blur: float = 0, opacity: float = 1) -> None:
        scale = min(size * fraction / subject.width, size * fraction / subject.height)
        artwork = subject.resize(
            (round(subject.width * scale), round(subject.height * scale)),
            Image.Resampling.LANCZOS,
        )
        if blur:
            artwork = artwork.filter(ImageFilter.GaussianBlur(radius=blur))
        if opacity < 1:
            artwork.putalpha(artwork.getchannel("A").point(lambda value: int(value * opacity)))
        offset = ((size - artwork.width) // 2, (size - artwork.height) // 2)
        background.alpha_composite(artwork, offset)

    add_layer(glow, 0.52, blur=35, opacity=0.65)
    add_layer(primary, 0.38)
    return background


def save_rgb(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, format="PNG", optimize=True)


def save_rgba(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGBA").save(path, format="PNG", optimize=True)


def main() -> None:
    primary_source = source(PRIMARY)
    glow_source = source(GLOW)
    primary = extract_warm_subject(primary_source)
    glow = extract_warm_subject(glow_source)

    save_rgb(place_subject(primary, 192, 0.70), PUBLIC / "icon-192.png")
    save_rgb(place_subject(primary, 512, 0.70), PUBLIC / "icon-512.png")
    save_rgb(place_subject(primary, 512, 0.62), PUBLIC / "icon-maskable-512.png")
    save_rgb(place_subject(primary, 180, 0.70), PUBLIC / "apple-touch-icon.png")
    save_rgb(place_subject(glow, 512, 0.70), PUBLIC / "icon-glow-512.png")
    save_rgba(transparent_brand_mark(primary), PUBLIC / "brand-brick-transparent.png")
    save_rgb(splash(primary, glow), RES / "drawable/splash.png")

    for density, size in DENSITY_PX.items():
        directory = RES / f"mipmap-{density}"
        save_rgba(round_legacy(primary, size), directory / "ic_launcher.png")
        save_rgba(round_legacy(primary, size), directory / "ic_launcher_round.png")

    for density, size in ADAPTIVE_PX.items():
        directory = RES / f"mipmap-{density}"
        save_rgb(seamless_background(size), directory / "ic_launcher_background.png")
        save_rgba(adaptive_foreground(primary, size), directory / "ic_launcher_foreground.png")

    preview = Image.new("RGB", (1024, 1024), "#16161C")
    round_preview = round_legacy(primary, 860)
    preview.paste(round_preview.convert("RGB"), (82, 82), round_preview.getchannel("A"))
    save_rgb(preview, ROOT / "android/app/src/main/icon-round-preview.png")
    print("Rendered Brickvault PWA and Android icon package")


if __name__ == "__main__":
    main()
