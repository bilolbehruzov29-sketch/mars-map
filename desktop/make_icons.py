"""Draws the Mars Map icon (orange planet with a route) for Windows (.ico) and the web app manifest."""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / 'public'


def planet(size):
    s = size * 4  # supersample
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    bg = Image.new('RGBA', (s, s), (10, 15, 28, 255))
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    img.paste(bg, (0, 0), mask)
    cx, cy, r = s * 0.5, s * 0.5, s * 0.34
    sphere = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    px = sphere.load()
    lx, ly = cx - r * 0.35, cy - r * 0.4
    for y in range(int(cy - r), int(cy + r) + 1):
        for x in range(int(cx - r), int(cx + r) + 1):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                t = min(1, math.hypot(x - lx, y - ly) / (r * 1.7))
                stops = [(0, (255, 194, 158)), (0.25, (240, 122, 67)), (0.6, (194, 71, 31)), (1, (70, 20, 8))]
                for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
                    if t <= t1:
                        k = (t - t0) / (t1 - t0)
                        px[x, y] = tuple(int(a + (b - a) * k) for a, b in zip(c0, c1)) + (255,)
                        break
    glow = sphere.filter(ImageFilter.GaussianBlur(s * 0.03))
    img.alpha_composite(glow)
    img.alpha_composite(sphere)
    d = ImageDraw.Draw(img)
    w = max(2, int(s * 0.022))
    pts = [(cx - r * 0.55 + i * r * 1.1 / 20, cy + r * 0.12 - math.sin(i / 20 * math.pi) * r * 0.32) for i in range(21)]
    for a, b in zip(pts[::2], pts[1::2]):
        d.line([a, b], fill=(255, 255, 255, 235), width=w)
    for (x, y), col in ((pts[0], (76, 201, 240)), (pts[-1], (255, 181, 71))):
        rr = s * 0.045
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col + (255,), outline=(10, 15, 28, 255), width=w)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    PUBLIC.mkdir(exist_ok=True)
    big = planet(512)
    big.save(PUBLIC / 'icon-512.png')
    planet(192).save(PUBLIC / 'icon-192.png')
    planet(180).save(PUBLIC / 'apple-touch-icon.png')
    planet(64).save(PUBLIC / 'favicon.png')
    big.save(HERE / 'mars.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('icons written')
