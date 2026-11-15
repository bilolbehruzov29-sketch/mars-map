"""MOLA MEGDR global topography (4 pixels/degree) bundled with the server.

Source: NASA PDS Geosciences Node, MGS-M-MOLA-5-MEGDR-L3-V1.0, file
meg004/megt90n000cb.img (see the .lbl file next to the data). Values are
16-bit big-endian signed integers in metres relative to the MOLA areoid.
Row 0 is centred on 89.875°N, column 0 on 0.125°E; longitude is positive east.
"""
import array
import gzip
import math
from functools import lru_cache

from backend.config.settings import ROOT

MARS_RADIUS_KM = 3389.5
PPD = 4
ROWS, COLS = 180 * PPD, 360 * PPD
DATA_FILE = ROOT / 'backend/terrain/data/megt90n000cb.img.gz'
SOURCE = {
    'dataset': 'MGS MOLA MEGDR topography, 4 pixels/degree (~14.8 km at the equator)',
    'product': 'megt90n000cb.img',
    'url': 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/',
    'reference': 'Elevation in metres relative to the MOLA areoid',
}


@lru_cache(maxsize=1)
def heights():
    raw = gzip.decompress(DATA_FILE.read_bytes())
    if len(raw) != ROWS * COLS * 2:
        raise RuntimeError('MOLA topography file has an unexpected size.')
    grid = array.array('h')
    grid.frombytes(raw)
    if grid.itemsize != 2:
        raise RuntimeError('Unsupported platform integer size.')
    if array.array('h', [1]).tobytes() != b'\x00\x01':
        grid.byteswap()
    return grid


def normalize_lon(lon):
    """Return longitude in [-180, 180)."""
    return ((lon + 180.0) % 360.0) - 180.0


def _pixel(row, col):
    row = min(ROWS - 1, max(0, row))
    return heights()[row * COLS + (col % COLS)]


def elevation(lat, lon):
    """Bilinearly interpolated MOLA elevation in metres."""
    y = (90.0 - lat) * PPD - 0.5
    x = (lon % 360.0) * PPD - 0.5
    r0, c0 = math.floor(y), math.floor(x)
    fy, fx = y - r0, x - c0
    top = _pixel(r0, c0) * (1 - fx) + _pixel(r0, c0 + 1) * fx
    bottom = _pixel(r0 + 1, c0) * (1 - fx) + _pixel(r0 + 1, c0 + 1) * fx
    return top * (1 - fy) + bottom * fy


def distance_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * MARS_RADIUS_KM * math.asin(min(1.0, math.sqrt(max(0.0, a))))


def great_circle(lat1, lon1, lat2, lon2, steps):
    """Points along the shortest great-circle path (inclusive)."""
    def vec(lat, lon):
        p, l = math.radians(lat), math.radians(lon)
        return (math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p))
    a, b = vec(lat1, lon1), vec(lat2, lon2)
    dot = max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b))))
    angle = math.acos(dot)
    if angle < 1e-9:
        return [(lat1, normalize_lon(lon1)), (lat2, normalize_lon(lon2))]
    if math.pi - angle < 1e-6:
        # Antipodes: pick the path through the northern side of the start meridian.
        pole = (0.0, 0.0, 1.0) if abs(a[2]) < 0.9 else (1.0, 0.0, 0.0)
        axis_dot = sum(x * y for x, y in zip(a, pole))
        mid = [p - axis_dot * x for p, x in zip(pole, a)]
        norm = math.sqrt(sum(x * x for x in mid))
        mid = [x / norm for x in mid]
        points = []
        for i in range(steps + 1):
            t = math.pi * i / steps
            v = [math.cos(t) * x + math.sin(t) * y for x, y in zip(a, mid)]
            points.append((math.degrees(math.asin(max(-1, min(1, v[2])))), math.degrees(math.atan2(v[1], v[0]))))
        return points
    s = math.sin(angle)
    points = []
    for i in range(steps + 1):
        t = i / steps
        k1, k2 = math.sin((1 - t) * angle) / s, math.sin(t * angle) / s
        v = [k1 * x + k2 * y for x, y in zip(a, b)]
        points.append((math.degrees(math.asin(max(-1, min(1, v[2])))), math.degrees(math.atan2(v[1], v[0]))))
    return points
