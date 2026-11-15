import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.expedition.conditions import daylight_hours, mean_insolation, noon_sun_elevation, pressure_at, declination
from backend.expedition.planner import ExpeditionError, plan_expedition
from backend.main import app, _rate

GALE = {'name': 'Curiosity', 'lat': -4.5895, 'lon': 137.4417}
INSIGHT = {'name': 'InSight', 'lat': 4.5024, 'lon': 135.6234}
SPIRIT = {'name': 'Spirit', 'lat': -14.5684, 'lon': 175.4726}
DAY = datetime(2026, 11, 15, 12, tzinfo=timezone.utc)
WINTER = datetime(2027, 4, 16, 12, tzinfo=timezone.utc)


class Conditions(unittest.TestCase):
    def test_orbital_geometry(self):
        self.assertAlmostEqual(declination(90), 25.19, places=2)          # northern summer solstice
        self.assertAlmostEqual(daylight_hours(0, 123), 24.6597 / 2, places=3)  # equator: always half a sol
        self.assertAlmostEqual(daylight_hours(80, 90), 24.6597, places=3)      # polar day
        self.assertEqual(daylight_hours(-80, 90), 0)                            # polar night
        self.assertAlmostEqual(noon_sun_elevation(25.19, 90), 90, places=2)
        # Perihelion (Ls 251) delivers ~45% more sunlight than aphelion (Ls 71).
        self.assertGreater(mean_insolation(0, 251) / mean_insolation(0, 71), 1.35)

    def test_barometric_scaling(self):
        ref = (777, -4450, 'test')
        self.assertEqual(round(pressure_at(-4450, ref)), 777)
        self.assertLess(pressure_at(21000, ref), 0.15 * 777)   # Olympus Mons summit air is thin


class Expedition(unittest.TestCase):
    def test_round_trip_timeline(self):
        r = plan_expedition([GALE, INSIGHT, SPIRIT], vehicle='crewed', round_trip=True, departure=DAY, stop_sols=2)
        self.assertEqual([l['from'] for l in r['legs']], ['Curiosity', 'InSight', 'Spirit'])
        self.assertEqual(r['legs'][-1]['to'], 'Curiosity')
        self.assertEqual(len(r['stops']), 4)
        self.assertEqual(r['totals']['stopSols'], 4)
        self.assertAlmostEqual(r['totals']['totalSols'], r['totals']['drivingSols'] + 4, delta=0.2)
        self.assertGreater(r['totals']['distanceKm'], r['totals']['directKm'] * 0.99)
        for a, b in zip(r['legs'], r['legs'][1:]):
            self.assertLessEqual(a['end']['sol'], b['start']['sol'])
        self.assertEqual(r['legs'][0]['driveHoursPerSol'], 8.0)
        self.assertTrue(r['profile'][0]['km'] == 0 and r['profile'][-1]['km'] > 5000)

    def test_daylight_limits_crewed_driving_in_polar_night(self):
        winter = WINTER  # Ls ~90: southern winter solstice
        r = plan_expedition([{'lat': -78, 'lon': 0}, {'lat': -79, 'lon': 20}], vehicle='crewed', departure=winter)
        leg = r['legs'][0]
        self.assertEqual(leg['driveHoursPerSol'], 0)
        self.assertTrue(any('daylight' in w.lower() for w in leg['conditions']['warnings']))

    def test_slow_rover_spans_years(self):
        r = plan_expedition([{'lat': 40, 'lon': -170}, {'lat': 41, 'lon': 22}], vehicle='robotic', departure=DAY)
        self.assertEqual(r['legs'][0]['conditions']['ls'], [0, 360])
        self.assertIn('Mars years', r['warnings'][0])

    def test_validation(self):
        with self.assertRaises(ExpeditionError):
            plan_expedition([GALE], departure=DAY)
        with self.assertRaises(ExpeditionError):
            plan_expedition([GALE, GALE], departure=DAY)
        with self.assertRaises(ExpeditionError):
            plan_expedition([GALE, {'lat': 89.5, 'lon': 0}], departure=DAY)
        with self.assertRaises(ExpeditionError):
            plan_expedition([GALE, INSIGHT], vehicle='teleporter', departure=DAY)


class API(unittest.TestCase):
    def setUp(self):
        _rate.clear()
        self.client = TestClient(app)

    async def _weather(*args, **kwargs):
        return None

    def test_bases_and_conditions(self):
        data = self.client.get('/api/expeditions/bases').json()
        ids = {b['id'] for b in data['bases']}
        self.assertTrue({'jezero', 'curiosity', 'arcadia'} <= ids)
        self.assertNotIn('overview', ids)
        self.assertIn('crewed', data['vehicles'])
        with patch('backend.expedition.routes.weather_summary_or_none', self._weather):
            c = self.client.get('/api/expeditions/conditions', params={'lat': 0, 'lon': 0, 'day': '2026-11-15'}).json()
        self.assertAlmostEqual(c['daylightH'], 12.33, delta=0.01)
        self.assertIn('610 Pa', c['pressureReference'])

    def test_plan_endpoint(self):
        body = {'stops': [GALE, INSIGHT], 'vehicle': 'open', 'departure': '2026-11-15', 'roundTrip': True}
        with patch('backend.expedition.routes.weather_summary_or_none', self._weather):
            r = self.client.post('/api/expeditions/plan', json=body)
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertFalse(data['safe'])
        self.assertIsNone(data['station'])
        self.assertEqual(len(data['legs']), 2)
        self.assertEqual(data['legs'][0]['driveHoursPerSol'], 4.0)
        self.assertEqual(r.headers['cache-control'], 'no-store')

    def test_plan_validation(self):
        bad = [
            {'stops': [GALE]},
            {'stops': [GALE, INSIGHT], 'vehicle': 'teleporter'},
            {'stops': [GALE, {**INSIGHT, 'name': '<b>x</b>'}]},
            {'stops': [GALE, INSIGHT], 'departure': '1990-01-01'},
            {'stops': [GALE] * 11},
        ]
        for body in bad:
            self.assertEqual(self.client.post('/api/expeditions/plan', json=body).status_code, 400, body)


if __name__ == '__main__':
    unittest.main()


class LocalConditions(unittest.TestCase):
    def setUp(self):
        _rate.clear()
        self.client = TestClient(app)

    async def _weather(*args, **kwargs):
        return None

    def test_sun_times_frost_and_polar_night(self):
        with patch('backend.expedition.routes.weather_summary_or_none', self._weather):
            eq = self.client.get('/api/expeditions/conditions', params={'lat': 0, 'lon': 0, 'day': '2026-11-15'}).json()
            south_winter = self.client.get('/api/expeditions/conditions', params={'lat': -80, 'lon': 0, 'day': '2027-04-16'}).json()
        self.assertAlmostEqual(eq['sunriseLmst'] + eq['sunsetLmst'], 24, places=1)   # symmetric about noon
        self.assertAlmostEqual(eq['sunsetLmst'] - eq['sunriseLmst'], 12, delta=0.3)
        self.assertFalse(eq['frostLikely'])
        self.assertIsNone(south_winter['sunriseLmst'])                                # polar night
        self.assertTrue(south_winter['frostLikely'])
        self.assertIn('not a forecast', eq['note'])
        self.assertGreater(eq['sunDistanceAu'], 1.38)
