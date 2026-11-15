import unittest
from datetime import date
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app, _rate
from backend.terrain.grid import elevation, distance_km, normalize_lon
from backend.terrain.planner import plan_route
from datetime import datetime, timezone
from backend.weather import summarize, season, route_weather, solar_longitude

FEED = {'soles': [
    {'sol': '4995', 'terrestrial_date': '2026-08-25', 'ls': '341', 'min_temp': '-71', 'max_temp': '-5', 'pressure': '777',
     'wind_speed': '--', 'atmo_opacity': 'Sunny', 'sunrise': '06:46', 'sunset': '18:51'},
    {'sol': '4994', 'terrestrial_date': '2026-08-24', 'ls': '340', 'min_temp': '-70', 'max_temp': '-7', 'pressure': '770'},
    {'sol': 'x', 'terrestrial_date': 'bad'},
]}


class Topography(unittest.TestCase):
    def test_known_landmarks(self):
        self.assertGreater(elevation(18.65, 226.2), 18000)      # Olympus Mons summit region
        self.assertLess(elevation(-42.4, 70.5), -5000)          # Hellas basin floor
        self.assertAlmostEqual(elevation(-4.59, 137.44), -4450, delta=400)  # Gale crater floor
        self.assertAlmostEqual(elevation(0, 179.999), elevation(0, -180.001), delta=50)  # seam continuity

    def test_geometry(self):
        self.assertAlmostEqual(distance_km(0, 0, 0, 1), 59.16, places=1)
        self.assertEqual(normalize_lon(190), -170)


class Planner(unittest.TestCase):
    def test_detour_respects_slope_limit_around_olympus(self):
        r = plan_route((15, -140), (22, -128), max_slope=5)
        self.assertFalse(r['direct']['passable'])
        self.assertGreater(r['direct']['steepSegments'], 0)
        self.assertIsNotNone(r['detour'])
        self.assertLessEqual(r['detour']['maxSlopeDeg'], 5.5)
        self.assertGreater(r['detour']['distanceKm'], r['direct']['distanceKm'])
        first, last = r['detour']['points'][0], r['detour']['points'][-1]
        self.assertEqual((first['lat'], first['lon']), (15, -140))
        self.assertEqual((last['lat'], last['lon']), (22, -128))

    def test_antimeridian_route_stays_short(self):
        r = plan_route((0, 179), (2, -178), max_slope=15)
        self.assertLess(r['detour']['distanceKm'], 1.2 * r['direct']['distanceKm'])
        self.assertTrue(all(-180 <= p['lon'] < 180 for p in r['detour']['points']))

    def test_impossible_limit_reports_no_detour(self):
        r = plan_route((18.65, -133.8), (18.65, -128), max_slope=2)
        if r['detour'] is None:
            self.assertIn('No path', r['detourError'])
        else:
            self.assertLessEqual(r['detour']['maxSlopeDeg'], 2.2)

    def test_polar_rejected(self):
        with self.assertRaises(ValueError):
            plan_route((89.5, 0), (80, 0))


class Weather(unittest.TestCase):
    def test_summary(self):
        s = summarize(FEED, today=date(2026, 11, 15))
        self.assertEqual(s['latest']['sol'], '4995')
        self.assertIsNone(s['latest']['windMs'])
        self.assertEqual(s['trend7Sols']['pressurePa'], 7)
        self.assertFalse(s['season']['dustStormSeason'])  # Ls ~22 on 2026-11-15
        self.assertTrue(summarize(FEED, today=date(2026, 8, 26))['season']['dustStormSeason'])  # Ls ~342
        self.assertTrue(any('days old' in w for w in s['warnings']))
        self.assertEqual(len(s['soles']), 2)
        with self.assertRaises(ValueError):
            summarize({'soles': []})

    def test_seasons(self):
        self.assertAlmostEqual(solar_longitude(datetime(2026, 8, 25, 12, tzinfo=timezone.utc)), 341, delta=1.5)  # REMS Ls
        self.assertEqual(season(45)['northern'], 'spring')
        self.assertEqual(season(270)['southern'], 'summer')
        self.assertFalse(season(100)['dustStormSeason'])

    def test_route_weather_relevance(self):
        s = summarize(FEED, today=date(2026, 8, 26))
        self.assertTrue(route_weather(s, [(-4.59, 137.44), (-4.6, 137.45)])['local'])
        self.assertFalse(route_weather(s, [(18.4, 77.4)])['local'])
        self.assertFalse(route_weather(None, [(0, 0)])['available'])


class API(unittest.TestCase):
    def setUp(self):
        _rate.clear()
        self.client = TestClient(app)

    async def _no_weather(*args, **kwargs):
        return None

    def test_plan_endpoint(self):
        with patch('backend.terrain.routes.weather_summary_or_none', self._no_weather):
            r = self.client.post('/api/routes/plan', json={'start': {'lat': -4.59, 'lon': 137.44}, 'target': {'lat': -5.0, 'lon': 137.8}})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertFalse(body['safe'])
        self.assertFalse(body['weather']['available'])
        self.assertEqual(r.headers['cache-control'], 'no-store')

    def test_plan_validation(self):
        bad = self.client.post('/api/routes/plan', json={'start': {'lat': 120, 'lon': 0}, 'target': {'lat': 0, 'lon': 0}})
        self.assertEqual(bad.status_code, 400)
        self.assertIn('error', bad.json())
        self.assertEqual(self.client.post('/api/routes/plan', json={'start': {'lat': 89.5, 'lon': 0}, 'target': {'lat': 0, 'lon': 0}}).status_code, 400)

    def test_elevation_endpoint(self):
        r = self.client.get('/api/terrain/elevation', params={'lat': 18.65, 'lon': 226.2})
        self.assertGreater(r.json()['elevationM'], 18000)
        self.assertEqual(self.client.get('/api/terrain/elevation', params={'lat': 100, 'lon': 0}).status_code, 400)

    def test_rate_limits_are_per_endpoint(self):
        for _ in range(12):
            self.client.post('/api/si/chat', json={})
        self.assertEqual(self.client.post('/api/si/chat', json={}).status_code, 429)
        with patch('backend.terrain.routes.weather_summary_or_none', self._no_weather):
            r = self.client.post('/api/routes/plan', json={'start': {'lat': 0, 'lon': 0}, 'target': {'lat': 0.5, 'lon': 0.5}})
        self.assertEqual(r.status_code, 200)

    def test_unknown_api_and_method_errors_are_json(self):
        self.assertEqual(self.client.get('/api/nope').json(), {'error': 'API endpoint not found.'})
        self.assertIn('error', self.client.put('/healthz').json())


if __name__ == '__main__':
    unittest.main()


class Patch(unittest.TestCase):
    def setUp(self):
        _rate.clear()
        self.client = TestClient(app)

    def test_patch_base_grid(self):
        import os
        with patch.dict(os.environ, {'DEM_HIRES': '0'}):
            r = self.client.get('/api/terrain/patch', params={'lat': 18.65, 'lon': -133.8, 'radiusKm': 400})
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual(len(d['heights']), d['size'] ** 2)
        self.assertGreater(d['maxM'], 18000)       # Olympus Mons summit inside the patch
        self.assertEqual(d['hiRes'], 'disabled')
        self.assertEqual(d['dem']['ppd'], 4)
        self.assertEqual(self.client.get('/api/terrain/patch', params={'lat': 89, 'lon': 0}).status_code, 400)
        self.assertEqual(self.client.get('/api/terrain/patch', params={'lat': 0, 'lon': 0, 'radiusKm': 5000}).status_code, 400)

    def test_patch_orientation(self):
        from backend.terrain.patch import build_patch
        d = build_patch(18.65, -133.8, 800)   # Olympus Mons: summit near the centre
        n = d['size']
        centre = d['heights'][(n // 2) * n + n // 2]
        self.assertGreater(centre, d['heights'][0])
        self.assertGreater(centre, d['heights'][-1])

    def test_high_resolution_grid_when_cached(self):
        import os
        from pathlib import Path
        from backend.terrain import hires
        cache = Path('/tmp/claude-0/dem/megt90n000eb.img')
        if not cache.is_file():
            self.skipTest('16 ppd grid not downloaded on this machine')
        with patch.dict(os.environ, {'DEM_CACHE_DIR': str(cache.parent), 'DEM_HIRES': '1'}):
            hires.grid(); hires.wait(60)
            data = hires.grid()
            self.assertIsNotNone(data)
            self.assertAlmostEqual(hires.elevation(data, 18.65, 226.2), 20000, delta=600)
            r = self.client.get('/api/terrain/patch', params={'lat': -5.08, 'lon': 137.85, 'radiusKm': 150}).json()
        self.assertEqual(r['dem']['ppd'], 16)
        self.assertFalse(r['interpolated'])


class Origins(unittest.TestCase):
    def setUp(self):
        _rate.clear()
        self.client = TestClient(app)

    def test_proxy_origin_allowed_only_when_listed(self):
        import os
        body = {'start': {'lat': 0, 'lon': 0}, 'target': {'lat': 0.5, 'lon': 0.5}}
        headers = {'Origin': 'https://mars-map.netlify.app'}
        async def no_weather(*a, **k):
            return None
        with patch('backend.terrain.routes.weather_summary_or_none', no_weather):
            # Netlify sites work out of the box.
            self.assertEqual(self.client.post('/api/routes/plan', json=body, headers=headers).status_code, 200)
            self.assertEqual(self.client.post('/api/routes/plan', json=body, headers={'Origin': 'http://mars-map.netlify.app'}).status_code, 403)
            self.assertEqual(self.client.post('/api/routes/plan', json=body, headers={'Origin': 'https://netlify.app.evil.example'}).status_code, 403)
            with patch.dict(os.environ, {'ALLOWED_ORIGIN_SUFFIXES': ''}):
                self.assertEqual(self.client.post('/api/routes/plan', json=body, headers=headers).status_code, 403)
            with patch.dict(os.environ, {'ALLOWED_ORIGIN_SUFFIXES': '', 'ALLOWED_ORIGINS': 'https://other.example, https://mars-map.netlify.app/'}):
                self.assertEqual(self.client.post('/api/routes/plan', json=body, headers=headers).status_code, 200)
