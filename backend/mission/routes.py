import asyncio
import io
import json
from collections import OrderedDict
import httpx
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from PIL import Image
from backend.config.settings import ROOT
from backend.nasa import get_json, nasa_url

router = APIRouter(prefix='/api/missions', tags=['Missions'])
MISSIONS = json.loads((ROOT / 'src/data/missions.json').read_text())
_image_cache = OrderedDict()
_image_locks = {}

@router.get('')
async def missions():
    return MISSIONS

async def resolve_panorama(mission_id):
    mission = MISSIONS.get(mission_id)
    if not mission or not mission.get('panorama'):
        raise HTTPException(404, 'No verified surface panorama is available for this location.')
    record_path = ROOT / 'backend/mission/records' / f'{mission_id}.json'
    if record_path.is_file():
        return json.loads(record_path.read_text())
    spec = mission['panorama']
    nasa_id = spec['nasaId']
    search, assets = await asyncio.gather(
        get_json(f'https://images-api.nasa.gov/search?nasa_id={nasa_id}'),
        get_json(f'https://images-api.nasa.gov/asset/{nasa_id}')
    )
    items = search.get('collection', {}).get('items', [])
    item = next((item for item in items if item.get('data', [{}])[0].get('nasa_id') == nasa_id), None)
    if not item:
        raise HTTPException(502, 'NASA did not return the verified panorama record.')
    metadata = item['data'][0]
    urls = [nasa_url(x['href']) for x in assets.get('collection', {}).get('items', []) if x.get('href', '').lower().endswith(('.jpg', '.jpeg', '.png'))]
    original = next((url for url in urls if '~orig.' in url), None)
    if not original:
        raise HTTPException(502, 'NASA panorama image is unavailable.')
    return {**spec, 'missionId': mission_id, 'missionName': mission.get('name', mission_id),
            'title': metadata.get('title', nasa_id), 'date': metadata.get('date_created', '')[:10],
            'description': metadata.get('description', ''), 'original': original,
            'image': f'/api/missions/{mission_id}/panorama/image', 'credit': 'NASA/JPL-Caltech · NASA Image and Video Library'}

@router.get('/{mission_id}/panorama')
async def panorama(mission_id: str):
    return await resolve_panorama(mission_id)

def resize_image(raw):
    with Image.open(io.BytesIO(raw)) as image:
        image.thumbnail((8192, 4096))
        output = io.BytesIO()
        image.convert('RGB').save(output, 'JPEG', quality=90)
        return output.getvalue()

@router.get('/{mission_id}/panorama/image')
async def panorama_image(mission_id: str):
    if mission_id not in MISSIONS or not MISSIONS[mission_id].get('panorama'):
        raise HTTPException(404, 'Panorama not found.')
    local_image = ROOT / 'backend/mission/images' / f'{mission_id}.jpg'
    if local_image.is_file():
        return FileResponse(local_image, media_type='image/jpeg')
    lock = _image_locks.setdefault(mission_id, asyncio.Lock())
    async with lock:
        if mission_id in _image_cache:
            _image_cache.move_to_end(mission_id)
            return Response(_image_cache[mission_id], media_type='image/jpeg', headers={'Cache-Control': 'public, max-age=86400'})
        record = await resolve_panorama(mission_id)
        raw = bytearray()
        try:
            async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
                async with client.stream('GET', record['original']) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > 40_000_000:
                            raise HTTPException(502, 'NASA original exceeds the panorama download limit.')
            content = await asyncio.to_thread(resize_image, bytes(raw))
        except (httpx.HTTPError, OSError, ValueError) as error:
            raise HTTPException(502, 'NASA panorama could not be loaded. Please try again later.') from error
        _image_cache[mission_id] = content
        while len(_image_cache) > 6:
            _image_cache.popitem(last=False)
        return Response(content, media_type='image/jpeg', headers={'Cache-Control': 'public, max-age=86400'})
