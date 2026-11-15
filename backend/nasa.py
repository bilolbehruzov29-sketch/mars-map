import asyncio
import time
from urllib.parse import urlsplit
import httpx
from fastapi import HTTPException

_cache = {}
_locks = {}

def nasa_url(value):
    parsed = urlsplit(value)
    if parsed.hostname is None or not (parsed.hostname == 'nasa.gov' or parsed.hostname.endswith('.nasa.gov')):
        raise ValueError('Only NASA sources are allowed')
    return parsed._replace(scheme='https').geturl()

async def get_json(url, ttl=3600):
    url = nasa_url(url)
    now = time.monotonic()
    cached = _cache.get(url)
    if cached and cached[0] > now:
        return cached[1]
    lock = _locks.setdefault(url, asyncio.Lock())
    async with lock:
        cached = _cache.get(url)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        try:
            async with httpx.AsyncClient(timeout=25, follow_redirects=False) as client:
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(502, 'NASA data is temporarily unavailable. No substitute data was generated.') from error
        if len(_cache) >= 64:
            _cache.pop(next(iter(_cache)))
        _cache[url] = (time.monotonic() + ttl, data)
        return data
