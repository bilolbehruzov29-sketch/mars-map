"""Multi-stop expedition planning: base → stops → base on MOLA topography.

Each leg is routed with the slope-limited A* planner. A vehicle model turns
distance into sols, and the solar longitude for every leg's travel window
drives the computed road conditions (daylight, Sun, insolation, pressure).
"""
import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from backend.expedition.conditions import MARS_YEAR_SOLS, SOL_TO_EARTH_DAYS, pressure_reference, summarize_leg, summarize_window
from backend.terrain.grid import distance_km, elevation, normalize_lon
from backend.terrain.planner import MAX_LAT, plan_route
from backend.weather import STATION, solar_longitude

VEHICLES = {
    'robotic': {
        'name': 'Robotic rover · Perseverance-class',
        'kmPerSol': 0.15, 'daylightLimited': False,
        'note': 'Autonomous rovers typically cover about 100–200 m per driving sol; a few hundred metres is a record day.',
    },
    'crewed': {
        'name': 'Pressurized crew rover · concept',
        'speedKmh': 10.0, 'maxDriveHours': 8.0, 'daylightLimited': True,
        'note': 'Concept-level assumption: ~10 km/h, daylight-only driving, at most 8 h per sol.',
    },
    'open': {
        'name': 'Open rover · Apollo LRV-class',
        'speedKmh': 8.0, 'maxDriveHours': 4.0, 'daylightLimited': True,
        'note': 'Apollo LRV-like assumption: ~8 km/h, limited by ~4 h of spacesuit time per sol.',
    },
}
DAYLIGHT_MARGIN_H = 1.0
MAX_STOPS = 10
SAMPLES_PER_LEG = 60
PROFILE_POINTS = 800


class ExpeditionError(ValueError):
    pass


@lru_cache(maxsize=256)
def cached_leg(a_lat, a_lon, b_lat, b_lon, max_slope):
    return plan_route((a_lat, a_lon), (b_lat, b_lon), max_slope)


def leg_path(plan):
    if plan['detour']:
        return [(p['lat'], p['lon'], p['elevationM']) for p in plan['detour']['points']], False
    return [(p['lat'], p['lon'], p['elevationM']) for p in plan['direct']['profile']], True


def sample(points, count):
    if len(points) <= count:
        return points
    step = (len(points) - 1) / (count - 1)
    return [points[round(i * step)] for i in range(count)]


def drive_rate(vehicle, min_daylight_h):
    """(km per sol, driving hours per sol)."""
    if 'kmPerSol' in vehicle:
        return vehicle['kmPerSol'], None
    hours = vehicle['maxDriveHours']
    if vehicle['daylightLimited']:
        hours = min(hours, max(0.0, min_daylight_h - DAYLIGHT_MARGIN_H))
    return vehicle['speedKmh'] * hours, hours


def moment(departure, sols):
    when = departure + timedelta(days=sols * SOL_TO_EARTH_DAYS)
    return {'sol': round(sols, 1), 'date': when.date().isoformat(), 'ls': round(solar_longitude(when), 1)}


def plan_expedition(stops, *, max_slope=15.0, vehicle='crewed', departure=None, round_trip=False,
                    stop_sols=1.0, weather_summary=None):
    if vehicle not in VEHICLES:
        raise ExpeditionError('Unknown vehicle.')
    if not 2 <= len(stops) <= MAX_STOPS:
        raise ExpeditionError(f'Use 2–{MAX_STOPS} stops.')
    stops = [{'name': (s.get('name') or f'Stop {i + 1}').strip()[:60], 'lat': float(s['lat']), 'lon': normalize_lon(float(s['lon']))}
             for i, s in enumerate(stops)]
    for s in stops:
        if abs(s['lat']) > MAX_LAT:
            raise ExpeditionError(f'{s["name"]}: latitude must be within ±{MAX_LAT:g}°.')
    route_stops = stops + ([stops[0]] if round_trip else [])
    for a, b in zip(route_stops, route_stops[1:]):
        if distance_km(a['lat'], a['lon'], b['lat'], b['lon']) < 0.05:
            raise ExpeditionError(f'“{a["name"]}” and “{b["name"]}” are at the same place.')

    spec = VEHICLES[vehicle]
    departure = departure or datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    reference = pressure_reference(weather_summary, elevation(STATION['lat'], STATION['lon']))

    legs, profile, offset_km, clock = [], [], 0.0, 0.0
    arrivals = [{**route_stops[0], 'elevationM': round(elevation(route_stops[0]['lat'], route_stops[0]['lon'])),
                 'arrival': None, 'departure': moment(departure, 0.0)}]
    for index, (a, b) in enumerate(zip(route_stops, route_stops[1:])):
        plan = cached_leg(round(a['lat'], 4), round(a['lon'], 4), round(b['lat'], 4), round(b['lon'], 4), float(max_slope))
        points, blocked = leg_path(plan)
        stats = plan['detour'] or plan['direct']
        distance = stats['distanceKm']

        # Daylight at the start of the leg decides the driving rate; conditions use the leg's midpoint in time.
        start = moment(departure, clock)
        probe = summarize_leg(sample(points, SAMPLES_PER_LEG), start['ls'], reference)
        km_per_sol, hours = drive_rate(spec, probe['daylightH']['min'])
        sols = distance / km_per_sol if km_per_sol > 0 else None
        # Ls values across the travel window: one per ~quarter season, a full year at most.
        span = min(sols or 0.0, MARS_YEAR_SOLS)
        count = 1 if span < 40 else min(13, math.ceil(span / 56) + 1)
        window = [moment(departure, clock + (sols or 0.0) / 2)['ls']] if count == 1 else \
                 [moment(departure, clock + span * i / (count - 1))['ls'] for i in range(count)]
        conditions = summarize_window(sample(points, SAMPLES_PER_LEG), window, sols or 0.0, reference)
        if sols is None:
            conditions['warnings'].insert(0, 'No usable daylight at the start of this leg: a daylight-limited vehicle cannot drive here now.')
            sols = 0.0
        clock += sols
        end = moment(departure, clock)

        cumulative = 0.0
        for i, (lat, lon, h) in enumerate(points):
            if i:
                cumulative += distance_km(points[i - 1][0], points[i - 1][1], lat, lon)
            profile.append({'km': round(offset_km + cumulative, 2), 'elevationM': round(h), 'leg': index})
        offset_km += distance

        legs.append({
            'index': index, 'from': a['name'], 'to': b['name'],
            'distanceKm': distance, 'directKm': plan['direct']['distanceKm'],
            'extraKm': round(distance - plan['direct']['distanceKm'], 1),
            'ascentM': stats['ascentM'], 'descentM': stats['descentM'], 'maxSlopeDeg': stats['maxSlopeDeg'],
            'minElevationM': stats['minElevationM'], 'maxElevationM': stats['maxElevationM'],
            'blocked': blocked, 'blockedReason': plan.get('detourError'),
            'steepSegmentsOnDirect': plan['direct']['steepSegments'],
            'kmPerSol': round(km_per_sol, 2), 'driveHoursPerSol': None if hours is None else round(hours, 1),
            'sols': round(sols, 1), 'start': start, 'end': end, 'conditions': conditions,
            'points': [{'lat': round(lat, 4), 'lon': round(lon, 4)} for lat, lon, _ in points],
            'cellKm': plan.get('grid', {}).get('cellKm'),
        })
        is_last = index == len(route_stops) - 2
        arrivals.append({**b, 'elevationM': round(elevation(b['lat'], b['lon'])), 'arrival': end,
                         'departure': None if is_last else moment(departure, clock + stop_sols)})
        if not is_last:
            clock += stop_sols

    if len(profile) > PROFILE_POINTS:
        profile = sample(profile, PROFILE_POINTS)
    drive_sols = sum(leg['sols'] for leg in legs)
    total_stop_sols = stop_sols * (len(legs) - 1)
    elevations = [p['elevationM'] for p in profile]
    warnings = []
    for leg in legs:
        for w in leg['conditions']['warnings']:
            if w not in warnings and not w.startswith('This leg lasts'):
                warnings.append(w)
    if drive_sols + total_stop_sols >= MARS_YEAR_SOLS:
        warnings.insert(0, f'The expedition takes about {(drive_sols + total_stop_sols) / MARS_YEAR_SOLS:.1f} Mars years with this vehicle.')
    if any(leg['blocked'] for leg in legs):
        warnings.insert(0, f'At least one leg has no path within {max_slope:g}°; it is shown as a straight line through steep terrain.')
    return {
        'vehicle': {'id': vehicle, **spec}, 'maxSlopeDeg': max_slope, 'roundTrip': round_trip, 'stopSols': stop_sols,
        'departure': moment(departure, 0.0), 'stops': arrivals, 'legs': legs, 'profile': profile,
        'totals': {
            'distanceKm': round(sum(leg['distanceKm'] for leg in legs), 1),
            'directKm': round(sum(leg['directKm'] for leg in legs), 1),
            'ascentM': sum(leg['ascentM'] for leg in legs), 'descentM': sum(leg['descentM'] for leg in legs),
            'maxSlopeDeg': max(leg['maxSlopeDeg'] for leg in legs),
            'minElevationM': min(elevations), 'maxElevationM': max(elevations),
            'drivingSols': round(drive_sols, 1), 'stopSols': round(total_stop_sols, 1),
            'totalSols': round(drive_sols + total_stop_sols, 1),
            'earthDays': round((drive_sols + total_stop_sols) * SOL_TO_EARTH_DAYS, 1),
            'arrival': arrivals[-1]['arrival'],
        },
        'pressureReference': reference[2],
        'warnings': warnings,
        'limitations': [
            'Paths follow MOLA topography at ~15 km per cell (coarser on long legs): boulders, small craters, dunes and soil strength are not modelled.',
            'Road conditions are computed from orbital geometry and a barometric model, not forecast weather. Temperature and wind along the route are unknown.',
            'Vehicle speeds are planning assumptions, not mission specifications. Nothing here certifies a safe traverse.',
        ],
    }
