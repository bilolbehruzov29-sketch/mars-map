import asyncio
import math
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend.config.settings import ROOT
from backend.expedition.conditions import (TRIPLE_POINT_PA, declination, frost_likely, point_conditions,
                                           pressure_reference, sun_distance_au, sun_times)
from backend.terrain.grid import distance_km
from backend.expedition.planner import MAX_STOPS, VEHICLES, ExpeditionError, plan_expedition
from backend.layers.routes import weather_summary_or_none
from backend.mission.routes import MISSIONS
from backend.terrain.grid import elevation, normalize_lon
from backend.weather import STATION, solar_longitude

router = APIRouter(prefix='/api/expeditions', tags=['Expeditions'])


class Stop(BaseModel):
    name: str = Field(default='', max_length=60)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=360)

    @field_validator('lat', 'lon')
    @classmethod
    def finite(cls, value):
        if not math.isfinite(value):
            raise ValueError('must be finite')
        return value

    @field_validator('name')
    @classmethod
    def clean(cls, value):
        value = ' '.join(value.split())
        if any(ch in value for ch in '<>'):
            raise ValueError('contains characters that are not allowed')
        return value


class ExpeditionRequest(BaseModel):
    stops: List[Stop] = Field(min_length=2, max_length=MAX_STOPS)
    roundTrip: bool = False
    maxSlopeDeg: float = Field(default=15, ge=2, le=30)
    vehicle: str = 'crewed'
    departure: Optional[date] = None
    stopSols: float = Field(default=1, ge=0, le=60)

    @field_validator('departure')
    @classmethod
    def sensible_date(cls, value):
        if value and not date(2000, 1, 1) <= value <= date(2100, 12, 31):
            raise ValueError('must be between 2000 and 2100')
        return value


@router.get('/bases')
async def bases():
    """Mission sites and candidate regions that can be used as stops."""
    out = []
    for key, m in MISSIONS.items():
        if key == 'overview':
            continue
        out.append({'id': key, 'name': m.get('name', key), 'lat': m['lat'], 'lon': normalize_lon(m['lon']),
                    'kind': 'candidate' if m.get('candidate') else 'mission',
                    'elevationM': round(elevation(m['lat'], m['lon']))})
    return {'bases': out, 'vehicles': {k: {'name': v['name'], 'note': v['note']} for k, v in VEHICLES.items()}}


@router.get('/conditions')
async def conditions(lat: float, lon: float, day: Optional[date] = None):
    """Computed conditions at one place on one date, plus the nearest real weather observation."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 360):
        raise HTTPException(400, 'Coordinates are out of range.')
    when = datetime.combine(day or datetime.now(timezone.utc).date(), datetime.min.time(), timezone.utc).replace(hour=12)
    ls = solar_longitude(when)
    weather = await weather_summary_or_none()
    reference = pressure_reference(weather, elevation(STATION['lat'], STATION['lon']))
    h = elevation(lat, lon)
    point = point_conditions(lat, h, ls, reference)
    sunrise, sunset = sun_times(lat, ls)
    station = None
    if weather:
        latest = weather['latest']
        station = {'name': STATION['name'], 'date': latest['date'], 'ageDays': weather['ageDays'],
                   'distanceKm': round(distance_km(lat, lon, STATION['lat'], STATION['lon'])),
                   'minTempC': latest['minTempC'], 'maxTempC': latest['maxTempC'], 'pressurePa': latest['pressurePa'],
                   'opacity': latest['opacity'], 'uv': latest['uv']}
    return {
        'lat': lat, 'lon': normalize_lon(lon), 'date': when.date().isoformat(), 'ls': round(ls, 1),
        'elevationM': round(h), **point,
        'declinationDeg': round(declination(ls), 2), 'sunDistanceAu': round(sun_distance_au(ls), 4),
        'sunriseLmst': None if sunrise is None else round(sunrise, 2), 'sunsetLmst': None if sunset is None else round(sunset, 2),
        'dustStormSeason': 180 <= ls < 360, 'frostLikely': frost_likely(lat, ls),
        'liquidWaterPossible': point['pressurePa'] >= TRIPLE_POINT_PA,
        'pressureReference': reference[2], 'station': station,
        'note': 'Computed from orbital geometry and a barometric model; not a forecast. Temperature and wind here are not measured.',
    }


@router.post('/plan')
async def plan(request: ExpeditionRequest):
    if request.vehicle not in VEHICLES:
        raise HTTPException(400, 'Unknown vehicle.')
    weather = await weather_summary_or_none()
    departure = None
    if request.departure:
        departure = datetime.combine(request.departure, datetime.min.time(), timezone.utc).replace(hour=12)
    try:
        result = await asyncio.to_thread(
            plan_expedition, [s.model_dump() for s in request.stops], max_slope=request.maxSlopeDeg,
            vehicle=request.vehicle, departure=departure, round_trip=request.roundTrip,
            stop_sols=request.stopSols, weather_summary=weather)
    except ExpeditionError as error:
        raise HTTPException(400, str(error))
    station = None
    if weather:
        station = {'name': STATION['name'], 'date': weather['latest']['date'], 'sol': weather['latest']['sol'],
                   'ageDays': weather['ageDays'], 'minTempC': weather['latest']['minTempC'], 'maxTempC': weather['latest']['maxTempC'],
                   'pressurePa': weather['latest']['pressurePa'], 'opacity': weather['latest']['opacity'],
                   'uv': weather['latest']['uv'], 'season': weather['season']}
    return {**result, 'station': station, 'safe': False, 'status': 'Planning sketch · safety unverified'}
