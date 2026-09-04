#!/usr/bin/env python3
"""
Generate the Orca for Canvas icon set from icon/source.png.

Dependency-free: decodes and re-encodes PNG with stdlib zlib/struct only, so
the icons are reproducible from source without Pillow, ImageMagick or cairo.

Usage:  python3 tools/make-icons.py
"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "icon" / "source.png"
OUT = ROOT / "icon"
SIZES = [16, 19, 32, 38, 48, 128]


def read_png(path):
    """Decode a non-interlaced 8-bit PNG to (width, height, RGBA bytes)."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, pal, trns = 8, bytearray(), None, None
    width = height = depth = color = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8:
                raise ValueError(f"unsupported bit depth {depth}")
            if interlace:
                raise ValueError("interlaced PNG not supported")
        elif tag == b"PLTE":
            pal = body
        elif tag == b"tRNS":
            trns = body
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(stride * height)

    # Undo the per-scanline filters.
    prev = bytearray(stride)
    p = 0
    for y in range(height):
        ftype = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if ftype == 1:      # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:    # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:    # Average
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:    # Paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif ftype != 0:
            raise ValueError(f"bad filter type {ftype}")
        out[y * stride:(y + 1) * stride] = line
        prev = line

    # Normalise to RGBA.
    rgba = bytearray(width * height * 4)
    for i in range(width * height):
        if color == 2:
            r, g, b = out[i * 3:i * 3 + 3]; a = 255
        elif color == 6:
            r, g, b, a = out[i * 4:i * 4 + 4]
        elif color == 0:
            r = g = b = out[i]; a = 255
        elif color == 4:
            r = g = b = out[i * 2]; a = out[i * 2 + 1]
        else:  # palette
            idx = out[i]
            r, g, b = pal[idx * 3:idx * 3 + 3]
            a = trns[idx] if trns and idx < len(trns) else 255
        rgba[i * 4:i * 4 + 4] = bytes((r, g, b, a))
    return width, height, rgba


def resize(src_w, src_h, rgba, size):
    """Box-filter downsample, averaging in premultiplied alpha."""
    out = bytearray()
    for oy in range(size):
        out.append(0)  # PNG filter type None
        y0, y1 = oy * src_h // size, max(oy * src_h // size + 1, (oy + 1) * src_h // size)
        for ox in range(size):
            x0, x1 = ox * src_w // size, max(ox * src_w // size + 1, (ox + 1) * src_w // size)
            r = g = b = a = n = 0
            for y in range(y0, y1):
                row = y * src_w
                for x in range(x0, x1):
                    i = (row + x) * 4
                    pa = rgba[i + 3]
                    r += rgba[i] * pa; g += rgba[i + 1] * pa; b += rgba[i + 2] * pa
                    a += pa; n += 1
            if a == 0:
                out += b"\x00\x00\x00\x00"
            else:
                out += bytes((round(r / a), round(g / a), round(b / a), round(a / n)))
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
    if not SOURCE.exists():
        raise SystemExit(f"missing source artwork: {SOURCE}")
    w, h, rgba = read_png(SOURCE)
    print(f"  source {SOURCE.name}: {w}x{h}")
    for s in SIZES:
        n = write_png(OUT / f"icon-{s}.png", s, resize(w, h, rgba, s))
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
