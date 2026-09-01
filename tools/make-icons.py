#!/usr/bin/env python3
"""
Generate the Ochre for Canvas icon set.

Dependency-free: writes PNGs with stdlib zlib/struct only, so the icons are
reproducible from source without ImageMagick, cairo, or Pillow.

Mark: a cream ring ("O" for Ochre) on a rounded square in ochre pigment tones.
Rendered at 8x supersample and box-downsampled for anti-aliasing.

Usage:  python3 tools/make-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

SS = 8  # supersample factor

TOP = (209, 138, 58)     # #D18A3A  ochre, lit
BOTTOM = (150, 82, 20)   # #965214  ochre, shadowed
RING = (247, 240, 228)   # #F7F0E4  cream

OUT = Path(__file__).resolve().parent.parent / "icon"
SIZES = [16, 19, 32, 38, 48, 128]


def rounded_box_sdf(px, py, half, radius):
    """Signed distance to a rounded square centred at the origin. <=0 is inside."""
    qx = abs(px) - (half - radius)
    qy = abs(py) - (half - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def render(size):
    n = size * SS
    half = n / 2.0
    radius = n * 0.235          # corner radius
    ring_r = n * 0.275          # ring centreline radius
    # Heavier stroke at small sizes so the O stays legible at 16px.
    ring_w = n * (0.155 if size <= 19 else 0.135)

    rows = []
    for y in range(n):
        row = bytearray()
        py = y + 0.5 - half
        t = y / (n - 1)
        base = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        for x in range(n):
            px = x + 0.5 - half
            if rounded_box_sdf(px, py, half, radius) > 0:
                row += b"\x00\x00\x00\x00"
                continue
            d = abs(math.hypot(px, py) - ring_r)
            if d <= ring_w / 2.0:
                row += bytes(RING) + b"\xff"
            else:
                row += bytes(base) + b"\xff"
        rows.append(bytes(row))

    # Box-downsample SS x SS blocks, compositing over transparency correctly.
    out = bytearray()
    for oy in range(size):
        out.append(0)  # PNG filter type 0 (None)
        for ox in range(size):
            ra = ga = ba = aa = 0
            for sy in range(SS):
                r = rows[oy * SS + sy]
                for sx in range(SS):
                    i = (ox * SS + sx) * 4
                    a = r[i + 3]
                    ra += r[i] * a
                    ga += r[i + 1] * a
                    ba += r[i + 2] * a
                    aa += a
            if aa == 0:
                out += b"\x00\x00\x00\x00"
            else:
                out += bytes((round(ra / aa), round(ga / aa), round(ba / aa),
                              round(aa / (SS * SS))))
    return bytes(out)


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, size, raw):
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    path.write_bytes(png)
    return len(png)


def main():
    OUT.mkdir(exist_ok=True)
    for s in SIZES:
        n = write_png(OUT / f"icon-{s}.png", s, render(s))
        print(f"  icon-{s}.png  {n:,} bytes")

    # Our own chevron, replacing a third-party SVG Repo asset.
    (OUT / "dropdownArrow.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" '
        'width="16" height="16" fill="currentColor" aria-hidden="true">'
        '<path d="M8 11.2 2.8 6h10.4z"/></svg>\n'
    )
    print("  dropdownArrow.svg")


if __name__ == "__main__":
    main()
