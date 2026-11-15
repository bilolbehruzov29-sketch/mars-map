"""Server-side summary of the Curiosity REMS weather feed.

The raw NASA feed lists every sol since landing (~1 MB). The summary keeps the
latest observations, a short trend and the Martian season, and states how far a
route is from the only station so the client never presents it as route weather.
"""
import math
import re
from datetime import date, datetime, timezone

from backend.terrain.grid import distance_km

FEED_URL = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json'
STATION = {'name': 'Curiosity · REMS · Gale Crater', 'lat': -4.5895, 'lon': 137.4417}
LOCAL_RADIUS_KM = 10
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
FIELDS = {'min_temp': 'minTempC', 'max_temp': 'maxTempC', 'pressure': 'pressurePa', 'wind_speed': 'windMs',
          'min_gts_temp': 'minGroundTempC', 'max_gts_temp': 'maxGroundTempC'}


def numeric(value):
    if value is None or str(value).strip() in ('', '--'):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def text(value):
    value = str(value or '').strip()
    return None if value in ('', '--') else value[:40]


def observation(row):
    out = {'sol': row.get('sol'), 'date': row['terrestrial_date']}
    out.update({name: numeric(row.get(key)) for key, name in FIELDS.items()})
    out.update({'opacity': text(row.get('atmo_opacity')), 'uv': text(row.get('local_uv_irradiance_index')),
                'sunrise': text(row.get('sunrise')), 'sunset': text(row.get('sunset')), 'ls': numeric(row.get('ls'))})
    return out


def solar_longitude(moment):
    """Mars areocentric solar longitude Ls (degrees) for a UTC datetime.

    Allison & McEwen (2000), Planetary and Space Science 48, 215-235 (Mars24 algorithm).
    """
    jd_utc = moment.timestamp() / 86400 + 2440587.5
    dt = jd_utc + 69.184 / 86400 - 2451545.0
    m = math.radians(19.3871 + 0.52402073 * dt)
    alpha = 270.3871 + 0.524038496 * dt
    pbs = sum(a * math.cos(math.radians(0.985626 * dt / tau + phi)) for a, tau, phi in (
        (0.0071, 2.2353, 49.409), (0.0057, 2.7543, 168.173), (0.0039, 1.1177, 191.837), (0.0037, 15.7866, 21.736),
        (0.0021, 2.1354, 15.704), (0.0020, 2.4694, 95.528), (0.0018, 32.8493, 49.095)))
    eoc = ((10.691 + 3.0e-7 * dt) * math.sin(m) + 0.623 * math.sin(2 * m) + 0.050 * math.sin(3 * m)
           + 0.005 * math.sin(4 * m) + 0.0005 * math.sin(5 * m) + pbs)
    return (alpha + eoc) % 360


def season(ls):
    """Seasons from solar longitude Ls (degrees)."""
    if ls is None:
        return None
    ls %= 360
    names = ['spring', 'summer', 'autumn', 'winter']
    north = names[int(ls // 90)]
    south = names[(int(ls // 90) + 2) % 4]
    dust = 180 <= ls < 360
    return {'ls': ls, 'northern': north, 'southern': south, 'dustStormSeason': dust,
            'note': ('Ls 180–360° (southern spring/summer, near perihelion): the season when regional and '
                     'planet-encircling dust storms are most likely.') if dust else
                    ('Ls 0–180° (northern spring/summer, near aphelion): typically the clearer, less dusty half of the Mars year.')}


def trend(rows, key):
    values = [r[key] for r in rows if r[key] is not None]
    if len(values) < 2:
        return None
    return round(values[0] - values[-1], 1)


def summarize(feed, today=None):
    rows = [r for r in (feed.get('soles') or []) if isinstance(r, dict) and DATE.match(str(r.get('terrestrial_date', '')))]
    if not rows:
        raise ValueError('NASA returned no observations')
    rows.sort(key=lambda r: (r['terrestrial_date'], numeric(r.get('sol')) or 0), reverse=True)
    recent = [observation(r) for r in rows[:7]]
    latest = recent[0]
    today = today or datetime.now(timezone.utc).date()
    age = (today - date.fromisoformat(latest['date'])).days
    warnings = []
    if age > 2:
        warnings.append(f'Latest observation is {age} days old; it is archival, not current weather.')
    if latest['windMs'] is None:
        warnings.append('Wind speed is not reported, so dust-lifting risk cannot be assessed.')
    if latest['opacity'] and latest['opacity'].lower() != 'sunny':
        warnings.append(f'Atmospheric opacity reported as "{latest["opacity"]}".')
    # Season for *today*, computed astronomically; the feed's Ls belongs to the (possibly old) observation.
    now = datetime(today.year, today.month, today.day, 12, tzinfo=timezone.utc)
    current_season = season(solar_longitude(now))
    current_season['computedFor'] = today.isoformat()
    if current_season['dustStormSeason']:
        warnings.append('Mars is in its dust-storm season (Ls 180–360°).')
    return {
        'station': STATION, 'source': FEED_URL, 'latest': latest, 'ageDays': age,
        'recent': recent, 'trend7Sols': {'maxTempC': trend(recent, 'maxTempC'), 'minTempC': trend(recent, 'minTempC'),
                                         'pressurePa': trend(recent, 'pressurePa')},
        'season': current_season, 'warnings': warnings,
        # Raw rows kept for clients that parse the original feed format.
        'soles': rows[:10],
    }


def route_weather(summary, points):
    """How the single REMS station relates to a route. points: [(lat, lon)]."""
    if summary is None:
        return {'available': False, 'note': 'NASA weather observations are unavailable.'}
    nearest = min(distance_km(STATION['lat'], STATION['lon'], la, lo) for la, lo in points)
    farthest = max(distance_km(STATION['lat'], STATION['lon'], la, lo) for la, lo in points)
    local = farthest <= LOCAL_RADIUS_KM and summary['ageDays'] <= 2
    return {
        'available': True, 'station': STATION['name'], 'date': summary['latest']['date'], 'sol': summary['latest']['sol'],
        'nearestKm': round(nearest, 1), 'farthestKm': round(farthest, 1), 'local': local,
        'latest': summary['latest'], 'season': summary['season'], 'warnings': summary['warnings'],
        'note': ('Route stays within 10 km of the REMS station and the data is recent; still an observation, not a forecast.'
                 if local else 'The station is not representative of this route: use it only as general seasonal context.'),
    }
