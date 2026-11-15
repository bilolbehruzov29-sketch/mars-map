"""Square elevation patches around a point for the local 3D terrain viewer."""
import math

from backend.terrain import hires
from backend.terrain.grid import PPD as BASE_PPD, SOURCE as BASE_SOURCE, elevation as base_elevation, normalize_lon

KM_PER_DEG = 2 * math.pi * 3389.5 / 360
MIN_SIZE, MAX_SIZE = 33, 161


def build_patch(lat, lon, radius_km, data=None):
    """Elevations on a local east/north grid (row 0 = north edge), metres."""
    if data is not None:
        sample, ppd, source = (lambda a, b: hires.elevation(data, a, b)), hires.PPD, hires.SOURCE
    else:
        sample, ppd, source = base_elevation, BASE_PPD, {**BASE_SOURCE, 'ppd': BASE_PPD}
    native_km = KM_PER_DEG / ppd
    size = max(MIN_SIZE, min(MAX_SIZE, round(2 * radius_km / native_km) + 1))
    spacing = 2 * radius_km / (size - 1)
    cos_lat = max(0.05, math.cos(math.radians(lat)))
    heights = []
    for i in range(size):
        north = radius_km - i * spacing
        row_lat = lat + north / KM_PER_DEG
        for j in range(size):
            east = -radius_km + j * spacing
            heights.append(round(sample(row_lat, lon + east / (KM_PER_DEG * cos_lat))))
    center = round(sample(lat, lon))
    return {
        'lat': lat, 'lon': normalize_lon(lon), 'radiusKm': radius_km,
        'size': size, 'spacingKm': round(spacing, 3), 'nativeKm': round(native_km, 2),
        'interpolated': spacing < native_km * 0.95,
        'heights': heights, 'minM': min(heights), 'maxM': max(heights), 'centerM': center,
        'dem': source,
    }
