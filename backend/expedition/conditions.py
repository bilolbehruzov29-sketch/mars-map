"""Computed surface conditions along a route ("road weather").

Everything here is derived from orbital mechanics and the bundled MOLA
topography; nothing is a forecast:

* daylight length, noon Sun elevation and top-of-atmosphere insolation from
  the solar longitude Ls (Allison & McEwen 2000 constants);
* surface pressure scaled from the latest Curiosity REMS reading with the
  barometric formula (scale height ~11.1 km), or from the 610 Pa mean at the
  MOLA datum when no reading is available;
* flags for polar night, seasonal CO2 frost latitudes, the dust-storm season
  and pressure below the water triple point.
"""
import math

SOL_HOURS = 24.6597           # mean solar day
SOL_TO_EARTH_DAYS = 1.0274912
OBLIQUITY = 25.19             # degrees
SEMI_MAJOR_AU = 1.52368
ECCENTRICITY = 0.0934
PERIHELION_LS = 251.0
SOLAR_CONSTANT_1AU = 1361.0   # W/m²
SCALE_HEIGHT_M = 11_100
DATUM_PRESSURE_PA = 610.0
TRIPLE_POINT_PA = 611.657


def declination(ls):
    return math.degrees(math.asin(math.sin(math.radians(OBLIQUITY)) * math.sin(math.radians(ls))))


def sun_distance_au(ls):
    return SEMI_MAJOR_AU * (1 - ECCENTRICITY ** 2) / (1 + ECCENTRICITY * math.cos(math.radians(ls - PERIHELION_LS)))


def hour_angle_sunset(lat, dec):
    """Sunset hour angle in radians (0 = polar night, pi = polar day)."""
    x = -math.tan(math.radians(lat)) * math.tan(math.radians(dec))
    return math.acos(max(-1.0, min(1.0, x)))


def daylight_hours(lat, ls):
    return SOL_HOURS * hour_angle_sunset(lat, declination(ls)) / math.pi


def noon_sun_elevation(lat, ls):
    return 90.0 - abs(lat - declination(ls))


def mean_insolation(lat, ls):
    """Sol-averaged sunlight at the top of the atmosphere, W/m²."""
    dec = math.radians(declination(ls))
    phi = math.radians(lat)
    h0 = hour_angle_sunset(lat, math.degrees(dec))
    flux = SOLAR_CONSTANT_1AU / sun_distance_au(ls) ** 2
    return max(0.0, flux / math.pi * (h0 * math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.sin(h0)))


def pressure_reference(weather_summary, gale_elevation_m):
    """(pressure_pa, elevation_m, label) used as the barometric anchor."""
    latest = (weather_summary or {}).get('latest') or {}
    if latest.get('pressurePa'):
        return latest['pressurePa'], gale_elevation_m, f"Curiosity REMS {latest['pressurePa']:.0f} Pa on {latest.get('date')} at Gale crater"
    return DATUM_PRESSURE_PA, 0.0, 'Mean 610 Pa at the MOLA datum (no REMS reading available)'


def pressure_at(elevation_m, reference):
    p0, h0, _ = reference
    return p0 * math.exp(-(elevation_m - h0) / SCALE_HEIGHT_M)


def local_season(lat, ls):
    names = ['spring', 'summer', 'autumn', 'winter']
    index = int((ls % 360) // 90)
    return names[index] if lat >= 0 else names[(index + 2) % 4]


def sun_times(lat, ls):
    """Sunrise/sunset in local mean solar time (Mars hours, 0–24) ignoring refraction and terrain."""
    h0 = math.degrees(hour_angle_sunset(lat, declination(ls)))
    if h0 <= 0:
        return None, None
    if h0 >= 180:
        return 0.0, 24.0
    return 12 - h0 / 15, 12 + h0 / 15


def frost_likely(lat, ls):
    return abs(lat) >= 50 and local_season(lat, ls) in ('autumn', 'winter')


def point_conditions(lat, elevation_m, ls, reference):
    return {
        'daylightH': round(daylight_hours(lat, ls), 2),
        'noonSunDeg': round(noon_sun_elevation(lat, ls), 1),
        'insolationWm2': round(mean_insolation(lat, ls)),
        'pressurePa': round(pressure_at(elevation_m, reference)),
        'season': local_season(lat, ls),
    }


def summarize_leg(points, ls, reference):
    """points: [(lat, lon, elevation)] -> ranges and hazard flags for one leg."""
    samples = [point_conditions(lat, h, ls, reference) for lat, _, h in points]
    def span(key):
        values = [s[key] for s in samples]
        return {'min': min(values), 'max': max(values)}
    warnings = []
    daylight = span('daylightH')
    if daylight['min'] < 0.5:
        warnings.append('Part of this leg is in polar night: no sunlight for solar power or daylight driving.')
    elif daylight['min'] < 8:
        warnings.append(f"Short days: as little as {daylight['min']:.1f} h of daylight.")
    winter_frost = [s for (lat, _, _), s in zip(points, samples) if abs(lat) >= 50 and s['season'] in ('autumn', 'winter')]
    if winter_frost:
        warnings.append('High latitude in local autumn/winter: seasonal CO₂ frost and very low temperatures are likely.')
    pressure = span('pressurePa')
    if pressure['max'] < TRIPLE_POINT_PA:
        warnings.append('Pressure stays below the water triple point (611 Pa): liquid water cannot persist.')
    elevations = [h for _, _, h in points]
    if max(elevations) > 8000:
        warnings.append('Route climbs above 8 km: the thinnest air on the route, harsher for parachute/landing operations and ventilation.')
    if 180 <= ls % 360 < 360:
        warnings.append('Dust-storm season (Ls 180–360°): regional storms can cut sunlight for weeks.')
    return {
        'ls': round(ls % 360, 1),
        'daylightH': daylight, 'noonSunDeg': span('noonSunDeg'),
        'insolationWm2': span('insolationWm2'), 'pressurePa': pressure,
        'seasons': sorted({s['season'] for s in samples}),
        'warnings': warnings,
    }


MARS_YEAR_SOLS = 668.6


def summarize_window(points, ls_values, sols, reference):
    """Merge leg summaries over several solar longitudes (a long leg crosses seasons)."""
    if len(ls_values) == 1:
        return summarize_leg(points, ls_values[0], reference)
    parts = [summarize_leg(points, ls, reference) for ls in ls_values]
    merged = {'ls': [round(min(ls_values), 1), round(max(ls_values), 1)] if sols < MARS_YEAR_SOLS else [0, 360]}
    for key in ('daylightH', 'noonSunDeg', 'insolationWm2', 'pressurePa'):
        merged[key] = {'min': min(p[key]['min'] for p in parts), 'max': max(p[key]['max'] for p in parts)}
    merged['seasons'] = sorted({season for p in parts for season in p['seasons']})
    warnings = []
    for p in parts:
        for w in p['warnings']:
            if w not in warnings and not w.startswith('Short days'):
                warnings.append(w)
    shortest = merged['daylightH']['min']
    if 0.5 <= shortest < 8:
        warnings.append(f'Short days: as little as {shortest:.1f} h of daylight.')
    if sols >= MARS_YEAR_SOLS:
        warnings.insert(0, f'This leg lasts about {sols / MARS_YEAR_SOLS:.1f} Mars years: every season is crossed on the way.')
    merged['warnings'] = warnings
    return merged

