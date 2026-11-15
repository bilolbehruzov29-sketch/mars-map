import asyncio
import math
from collections import OrderedDict

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from backend.layers.routes import weather_summary_or_none
from backend.terrain import hires
from backend.terrain.grid import SOURCE, elevation, normalize_lon
from backend.terrain.patch import build_patch
from backend.terrain.planner import MAX_LAT, plan_route
from backend.weather import route_weather

router = APIRouter(tags=['Terrain'])
_plans = OrderedDict()


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=360)

    @field_validator('lat', 'lon')
    @classmethod
    def finite(cls, value):
        if not math.isfinite(value):
            raise ValueError('must be finite')
        return value


class PlanRequest(BaseModel):
    start: Point
    target: Point
    maxSlopeDeg: float = Field(default=15, ge=2, le=30)


@router.get('/api/terrain/elevation')
async def terrain_elevation(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=360)):
    return {'lat': lat, 'lon': normalize_lon(lon), 'elevationM': round(elevation(lat, lon)), 'source': SOURCE}


@router.post('/api/routes/plan')
async def plan(request: PlanRequest):
    """Compare the straight great-circle line with a slope-limited detour on MOLA topography."""
    start = (request.start.lat, normalize_lon(request.start.lon))
    target = (request.target.lat, normalize_lon(request.target.lon))
    if max(abs(start[0]), abs(target[0])) > MAX_LAT:
        raise HTTPException(400, f'Routes are limited to latitudes within ±{MAX_LAT:g}°.')
    key = (*(round(v, 4) for v in (*start, *target)), round(request.maxSlopeDeg, 1))
    result = _plans.get(key)
    if result is None:
        result = await asyncio.to_thread(plan_route, start, target, request.maxSlopeDeg)
        _plans[key] = result
        while len(_plans) > 128:
            _plans.popitem(last=False)
    else:
        _plans.move_to_end(key)
    path = result['detour']['points'] if result['detour'] else result['direct']['profile']
    weather = route_weather(await weather_summary_or_none(), [(p['lat'], p['lon']) for p in path])
    return {**result, 'weather': weather, 'safe': False, 'status': 'Planning sketch · safety unverified'}


@router.get('/api/terrain/patch')
async def terrain_patch(lat: float = Query(ge=-88, le=88), lon: float = Query(ge=-180, le=360),
                        radiusKm: float = Query(default=250, ge=40, le=800)):
    """Elevation grid around a point for the 3D terrain view (16 ppd MOLA once cached, 4 ppd before)."""
    data = hires.grid()
    result = await asyncio.to_thread(build_patch, lat, lon, radiusKm, data)
    return {**result, 'hiRes': hires.status()}
