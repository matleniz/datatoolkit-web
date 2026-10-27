#!/usr/bin/env python3
"""Regenerate scripts/assets/datatoolkit.ico (stdlib only): a 64x64 PNG-in-ICO,
a rounded blue tile with a white 3x3 table grid. Usage: make-icon.py [out.ico]"""
import struct
import sys
import zlib
from pathlib import Path

N = 64
BLUE, WHITE = (37, 99, 235, 255), (255, 255, 255, 255)


def pixel(x: int, y: int) -> tuple[int, int, int, int]:
    r = 12  # corner radius
    cx, cy = min(max(x, r), N - 1 - r), min(max(y, r), N - 1 - r)
    if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
        return (0, 0, 0, 0)
    if 14 <= x < 50 and 14 <= y < 50:
        # cells of 10px separated by 3px lines
        if (x - 14) % 13 < 10 and (y - 14) % 13 < 10:
            return WHITE
    return BLUE


def png() -> bytes:
    raw = b"".join(
        b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(N)) for y in range(N)
    )

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def ico() -> bytes:
    data = png()
    head = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", N, N, 0, 0, 1, 32, len(data), 22)
    return head + entry + data


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "assets/datatoolkit.ico")
    out.write_bytes(ico())
