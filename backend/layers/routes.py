from fastapi import APIRouter, HTTPException
from backend.nasa import get_json
from backend.weather import FEED_URL, summarize

router = APIRouter(prefix='/api/nasa', tags=['NASA'])


@router.get('/weather')
async def weather():
    """Raw NASA REMS feed (kept for compatibility; ~1 MB)."""
    return await get_json(FEED_URL, ttl=900)


async def weather_summary_or_none():
    try:
        return summarize(await get_json(FEED_URL, ttl=900))
    except (HTTPException, ValueError):
        return None


@router.get('/weather/summary')
async def weather_summary():
    """Latest REMS observations, 7-sol trend and Martian season."""
    try:
        return summarize(await get_json(FEED_URL, ttl=900))
    except ValueError as error:
        raise HTTPException(502, 'NASA weather feed has no usable observations.') from error
