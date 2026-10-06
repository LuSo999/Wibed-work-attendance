#!/usr/bin/env python3
"""Vygeneruje PNG ikony aplikace (hodiny na fialovém pozadí) bez externích knihoven.

Spuštění z kořene repozitáře:  python3 scripts/make-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'icons'
TOP = (79, 70, 229)      # indigo-600
BOTTOM = (124, 58, 237)  # violet-600
WHITE = (255, 255, 255)
SS = 4                   # supersampling pro vyhlazení hran


def png(path, size, pixels):
    raw = b''.join(b'\x00' + bytes(pixels[y * size * 4:(y + 1) * size * 4]) for y in range(size))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))
    path.write_bytes(data)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size, maskable=False, corner=0.22):
    """Vrátí RGBA pixely. maskable = plné pozadí bez zaoblení, motiv v bezpečné zóně."""
    pixels = bytearray(size * size * 4)
    scale = 0.62 if maskable else 0.78     # velikost hodin vůči ikoně
    r_outer = 0.5 * scale
    ring = 0.07 * scale
    for y in range(size):
        for x in range(size):
            bg_cov = 0
            fg_cov = 0
            for sy in range(SS):
                for sx in range(SS):
                    u = (x + (sx + 0.5) / SS) / size   # 0..1
                    v = (y + (sy + 0.5) / SS) / size
                    # pozadí: zaoblený čtverec
                    inside = True
                    if not maskable:
                        cx = min(max(u, corner), 1 - corner)
                        cy = min(max(v, corner), 1 - corner)
                        inside = math.hypot(u - cx, v - cy) <= corner
                    if not inside:
                        continue
                    bg_cov += 1
                    # hodiny: kruh + ručičky
                    px, py = u - 0.5, v - 0.5
                    d = math.hypot(px, py)
                    on = abs(d - (r_outer - ring / 2)) <= ring / 2
                    hw = 0.045 * scale
                    on = on or seg_dist(px, py, 0, 0, 0, -0.30 * scale) <= hw          # minutová (12)
                    on = on or seg_dist(px, py, 0, 0, 0.22 * scale, 0.10 * scale) <= hw  # hodinová (~4)
                    on = on or d <= 0.07 * scale
                    if on:
                        fg_cov += 1
            n = SS * SS
            i = (y * size + x) * 4
            t = y / (size - 1)
            bg = [round(TOP[k] + (BOTTOM[k] - TOP[k]) * t) for k in range(3)]
            if bg_cov == 0:
                continue
            f = fg_cov / bg_cov
            for k in range(3):
                pixels[i + k] = round(bg[k] * (1 - f) + WHITE[k] * f)
            pixels[i + 3] = round(255 * bg_cov / n)
    return pixels


def main():
    OUT.mkdir(exist_ok=True)
    for name, size, maskable in [
        ('icon-192.png', 192, False),
        ('icon-512.png', 512, False),
        ('icon-maskable-512.png', 512, True),
        ('apple-touch-icon.png', 180, True),  # iOS si zaoblení dělá sám
    ]:
        png(OUT / name, size, render(size, maskable))
        print('✔', OUT / name)


if __name__ == '__main__':
    main()
