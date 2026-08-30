#!/usr/bin/env python3
"""Render Brickvault's pre-Android-8 round launcher icons."""

from pathlib import Path

from PIL import Image, ImageDraw

RESOURCE_ROOT = Path(__file__).resolve().parents[1] / "android/app/src/main/res"
DENSITY_SIZES = {
    "ldpi": 36,
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
CANVAS = 768


def render_master() -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Round badge with a restrained charcoal rim.
    draw.ellipse((12, 12, 756, 756), fill="#1C1C1E")
    draw.ellipse((26, 26, 742, 742), fill="#F3C846")

    # Vault shield and warm inset panel.
    draw.polygon(
        [(384, 146), (582, 230), (582, 377), (582, 508), (498, 606), (384, 652),
         (270, 606), (186, 508), (186, 377), (186, 230)],
        fill="#1C1C1E",
    )
    draw.polygon(
        [(384, 198), (532, 261), (532, 377), (532, 470), (472, 542), (384, 584),
         (296, 542), (236, 470), (236, 377), (236, 261)],
        fill="#FFF4BD",
    )

    # Twin LEGO studs and a vault/brick slot.
    for center_x in (328, 440):
        draw.ellipse((center_x - 40, 294, center_x + 40, 374), fill="#1C1C1E")
    draw.rounded_rectangle((270, 410, 498, 526), radius=30, fill="#1C1C1E")
    draw.rounded_rectangle((309, 448, 459, 486), radius=14, fill="#F3C846")
    return image


def main() -> None:
    master = render_master()
    for density, size in DENSITY_SIZES.items():
        output = RESOURCE_ROOT / f"mipmap-{density}" / "ic_launcher_round.png"
        master.resize((size, size), Image.Resampling.LANCZOS).save(output, optimize=True)
        print(f"wrote {output.relative_to(RESOURCE_ROOT.parents[4])} ({size}x{size})")


if __name__ == "__main__":
    main()
