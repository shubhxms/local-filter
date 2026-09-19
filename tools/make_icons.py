#!/usr/bin/env python3
"""Generate the Local Filter toolbar icons: a white rounded square with
three redaction bars — the same mark as the ack animation.

Run from the repo root:  python3 tools/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SS = 8  # supersampling factor for crisp edges
INK = (17, 17, 17, 255)


def render(size: int) -> Image.Image:
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Card: white rounded square with a hairline ink border.
    d.rounded_rectangle(
        [0, 0, n - 1, n - 1],
        radius=int(n * 0.22),
        fill=(255, 255, 255, 255),
        outline=INK,
        width=max(1, round(n * 0.04)),
    )

    # Three redaction bars on the same 64-unit grid as the ack SVG.
    def bar(x: float, y: float, w: float, h: float) -> None:
        box = [x * n / 64, y * n / 64, (x + w) * n / 64, (y + h) * n / 64]
        d.rounded_rectangle(box, radius=h * n / 128, fill=INK)

    bar(14, 21, 36, 6)
    bar(14, 29, 27, 6)
    bar(14, 37, 32, 6)

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    out = Path("icons")
    out.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        render(size).save(out / f"icon-{size}.png")
        print(f"icons/icon-{size}.png")


if __name__ == "__main__":
    main()
