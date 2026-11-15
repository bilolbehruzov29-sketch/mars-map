"""Terrain-aware route planning on the bundled MOLA topography.

The planner runs A* on a latitude/longitude grid built from the MOLA MEGDR
heights. Moves steeper than the requested limit are impassable, and gentler
slopes are penalised, so the result bends around steep crater walls, scarps
and volcano flanks that a straight great-circle line would cross.

Limits (also returned to the client): the grid is at best ~14.8 km per cell
and coarser for long routes, so the slope is averaged over the cell. Boulders,
small craters, sand traps and soil strength are invisible at this resolution.
The result is a planning sketch, not a certified safe traverse.
"""
import heapq
import math

from backend.terrain.grid import PPD, SOURCE, distance_km, elevation, great_circle, normalize_lon

KM_PER_DEG = 2 * math.pi * 3389.5 / 360
BASE_STEP = 1.0 / PPD
MAX_NODES = 90_000
MAX_LAT = 88.0
SLOPE_WEIGHT = 1.0  # extra cost of a step at the slope limit, relative to its length
NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


class NoRouteError(Exception):
    pass


def slope_deg(dh_m, dist_km):
    if dist_km <= 0:
        return 0.0
    return math.degrees(math.atan(abs(dh_m) / (dist_km * 1000)))


def path_stats(points):
    """points: [(lat, lon, elev_m)] -> length, climb, descent and slope figures."""
    length = ascent = descent = 0.0
    worst = 0.0
    for (la1, lo1, h1), (la2, lo2, h2) in zip(points, points[1:]):
        d = distance_km(la1, lo1, la2, lo2)
        length += d
        dh = h2 - h1
        ascent += max(0.0, dh)
        descent += max(0.0, -dh)
        worst = max(worst, slope_deg(dh, d))
    heights = [p[2] for p in points]
    return {
        'distanceKm': round(length, 1),
        'ascentM': round(ascent),
        'descentM': round(descent),
        'maxSlopeDeg': round(worst, 2),
        'minElevationM': round(min(heights)),
        'maxElevationM': round(max(heights)),
    }


def thin(points, limit):
    if len(points) <= limit:
        return points
    stride = (len(points) - 1) / (limit - 1)
    return [points[round(i * stride)] for i in range(limit)]


def to_json(points):
    return [{'lat': round(la, 4), 'lon': round(normalize_lon(lo), 4), 'elevationM': round(h)} for la, lo, h in points]


def analyse_direct(start, target, spacing_km, max_slope):
    """Elevation profile of the straight great-circle line at the planner scale."""
    total = distance_km(*start, *target)
    steps = max(2, min(4000, math.ceil(total / spacing_km)))
    line = [(la, lo, elevation(la, lo)) for la, lo in great_circle(*start, *target, steps)]
    blocked = []
    for i, ((la1, lo1, h1), (la2, lo2, h2)) in enumerate(zip(line, line[1:])):
        s = slope_deg(h2 - h1, distance_km(la1, lo1, la2, lo2))
        if s > max_slope:
            blocked.append({'lat': round((la1 + la2) / 2, 3), 'lon': round(normalize_lon((lo1 + lo2) / 2), 3), 'slopeDeg': round(s, 2), 'index': i})
    return line, blocked


def build_grid(start, target):
    (s_lat, s_lon), (t_lat, t_lon) = start, target
    t_lon = s_lon + normalize_lon(t_lon - s_lon)  # unwrap across the antimeridian
    mean_cos = max(0.2, math.cos(math.radians((s_lat + t_lat) / 2)))
    span = max(abs(t_lat - s_lat), abs(t_lon - s_lon) * mean_cos)
    margin = min(30.0, max(1.5, 0.35 * span))
    lat_lo, lat_hi = max(-MAX_LAT, min(s_lat, t_lat) - margin), min(MAX_LAT, max(s_lat, t_lat) + margin)
    lon_margin = min(60.0, margin / mean_cos)
    lon_lo, lon_hi = min(s_lon, t_lon) - lon_margin, max(s_lon, t_lon) + lon_margin
    if lon_hi - lon_lo > 359:
        mid = (lon_lo + lon_hi) / 2
        lon_lo, lon_hi = mid - 179.5, mid + 179.5
    area = ((lat_hi - lat_lo) / BASE_STEP + 1) * ((lon_hi - lon_lo) / BASE_STEP + 1)
    factor = max(1, math.ceil(math.sqrt(area / MAX_NODES)))
    step = BASE_STEP * factor
    rows = max(2, math.ceil((lat_hi - lat_lo) / step) + 1)
    cols = max(2, math.ceil((lon_hi - lon_lo) / step) + 1)
    return lat_lo, lon_lo, step, rows, cols, t_lon


def astar(start, target, max_slope):
    lat_lo, lon_lo, step, rows, cols, t_lon_u = build_grid(start, target)
    lats = [lat_lo + i * step for i in range(rows)]
    lons = [lon_lo + j * step for j in range(cols)]
    heights = [elevation(la, lo) for la in lats for lo in lons]
    coslat = [max(0.02, math.cos(math.radians(la))) for la in lats]

    def node(lat, lon):
        i = min(rows - 1, max(0, round((lat - lat_lo) / step)))
        j = min(cols - 1, max(0, round((lon - lon_lo) / step)))
        return i, j

    si, sj = node(*start)
    ti, tj = node(target[0], t_lon_u)
    goal = ti * cols + tj
    t_lat = lats[ti]
    t_lon = lons[tj]
    dy = step * KM_PER_DEG

    def h(i, j):
        return 0.995 * distance_km(lats[i], lons[j], t_lat, t_lon)

    begin = si * cols + sj
    best = {begin: 0.0}
    parent = {begin: -1}
    frontier = [(h(si, sj), 0.0, begin)]
    closed = set()
    while frontier:
        _, cost, current = heapq.heappop(frontier)
        if current in closed:
            continue
        if current == goal:
            break
        closed.add(current)
        ci, cj = divmod(current, cols)
        hc = heights[current]
        for di, dj in NEIGHBOURS:
            ni, nj = ci + di, cj + dj
            if not (0 <= ni < rows and 0 <= nj < cols):
                continue
            nxt = ni * cols + nj
            if nxt in closed:
                continue
            dx = step * KM_PER_DEG * (coslat[ci] + coslat[ni]) / 2 * dj
            d = math.hypot(dx, dy * di)
            s = slope_deg(heights[nxt] - hc, d)
            if s > max_slope:
                continue
            ratio = s / max_slope
            new_cost = cost + d * (1 + SLOPE_WEIGHT * ratio * ratio)
            if new_cost < best.get(nxt, math.inf):
                best[nxt] = new_cost
                parent[nxt] = current
                heapq.heappush(frontier, (new_cost + h(ni, nj), new_cost, nxt))
    else:
        raise NoRouteError(f'No path inside the search area keeps every grid step at or below {max_slope:g}°.')
    path = []
    current = goal
    while current != -1:
        i, j = divmod(current, cols)
        path.append((lats[i], lons[j], heights[current]))
        current = parent[current]
    path.reverse()
    # Replace snapped grid endpoints with the exact requested coordinates.
    path[0] = (start[0], start[1], elevation(*start))
    path[-1] = (target[0], t_lon_u, elevation(target[0], t_lon_u))
    return path, {'cellDeg': step, 'cellKm': round(step * KM_PER_DEG, 1), 'nodes': rows * cols, 'explored': len(closed)}


def plan_route(start, target, max_slope=15.0):
    """start/target: (lat, lon) in degrees. Returns a JSON-ready dict."""
    for lat, lon in (start, target):
        if not (-90 <= lat <= 90) or not math.isfinite(lon):
            raise ValueError('Coordinates are out of range.')
    start = (start[0], normalize_lon(start[1]))
    target = (target[0], normalize_lon(target[1]))
    if max(abs(start[0]), abs(target[0])) > MAX_LAT:
        raise ValueError(f'Routes are limited to latitudes within ±{MAX_LAT:g}°.')
    _, _, step, _, _, _ = build_grid(start, target)
    spacing = step * KM_PER_DEG
    line, blocked = analyse_direct(start, target, spacing, max_slope)
    direct = {**path_stats(line), 'passable': not blocked, 'steepSegments': len(blocked),
              'steepExamples': blocked[:12], 'profile': to_json(thin(line, 300))}
    result = {
        'start': {'lat': start[0], 'lon': start[1]},
        'target': {'lat': target[0], 'lon': target[1]},
        'maxSlopeDeg': max_slope,
        'direct': direct,
        'source': SOURCE,
        'limitations': [
            f'Slopes are averaged over ~{spacing:.0f} km grid steps; local slopes, boulders, small craters and dunes are not resolved.',
            'No soil-strength, rock-abundance or obstacle model is used. Treat the detour as a planning sketch, not a safe traverse.',
            'Weather is a single-station observation (Curiosity REMS), not a forecast along the route.',
        ],
    }
    try:
        path, grid = astar(start, target, max_slope)
    except NoRouteError as error:
        result['detour'] = None
        result['detourError'] = str(error)
        return result
    stats = path_stats(path)
    result['grid'] = grid
    result['detour'] = {**stats, 'extraDistanceKm': round(stats['distanceKm'] - direct['distanceKm'], 1),
                        'points': to_json(thin(path, 500))}
    return result
