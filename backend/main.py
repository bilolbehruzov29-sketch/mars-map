import os
import time
from urllib.parse import urlsplit
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException
from backend.config.settings import ROOT
from backend.layers.routes import router as nasa_router
from backend.mission.routes import router as mission_router
from backend.si import router as si_router
from backend.terrain.routes import router as terrain_router
from backend.expedition.routes import router as expedition_router

app = FastAPI(title='SpaceMap Python API', docs_url='/api/docs', openapi_url='/api/openapi.json')
for router in (nasa_router, mission_router, si_router, terrain_router, expedition_router):
    app.include_router(router)


class TextGZip(GZipMiddleware):
    """Compress HTML/JS/CSS/JSON (about 4× smaller); skip already-compressed panorama JPEGs."""
    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http' and scope['path'].startswith('/api/missions/') and scope['path'].endswith('/image'):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


app.add_middleware(TextGZip, minimum_size=1024, compresslevel=6)

# Per-endpoint POST limits: (requests per window, message).
RATE_LIMITS = {
    '/api/si/chat': (12, 'Please wait before asking S.A.M again.'),
    '/api/routes/plan': (30, 'Too many route requests. Please wait a minute.'),
    '/api/expeditions/plan': (20, 'Too many expedition requests. Please wait a minute.'),
}
DEFAULT_LIMIT = (30, 'Too many requests. Please wait a minute.')
WINDOW = 60
MAX_BODY = 48_000
_rate = {}


def error(status, message, headers=None):
    return JSONResponse({'error': message}, status_code=status, headers={'Cache-Control': 'no-store', **(headers or {})})


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return error(exc.status_code, exc.detail if isinstance(exc.detail, str) else 'Request failed.', exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    problems = [f"{'.'.join(str(p) for p in e.get('loc', ())[1:]) or 'body'}: {e.get('msg', 'invalid')}" for e in exc.errors()[:5]]
    return error(400, 'Invalid request. ' + '; '.join(problems))


def origin_allowed(origin, host):
    """Same-site requests, plus sites listed in ALLOWED_ORIGINS that proxy /api/* to this server (e.g. Netlify)."""
    if urlsplit(origin).netloc == host:
        return True
    origin = origin.rstrip('/').lower()
    allowed = {o.strip().rstrip('/').lower() for o in os.getenv('ALLOWED_ORIGINS', '').split(',') if o.strip()}
    if origin in allowed:
        return True
    # HTTPS sites on these hosts may proxy the API without extra setup (comma-separated; empty disables).
    parts = urlsplit(origin)
    suffixes = [s.strip().lower() for s in os.getenv('ALLOWED_ORIGIN_SUFFIXES', '.netlify.app').split(',') if s.strip()]
    return parts.scheme == 'https' and any(parts.hostname and parts.hostname.endswith(sfx) for sfx in suffixes)


def allow(identity, path, now):
    limit, message = RATE_LIMITS.get(path, DEFAULT_LIMIT)
    key = (path, identity)
    start, count = _rate.get(key, (now, 0))
    if now - start > WINDOW:
        start, count = now, 0
    if count >= limit:
        return message
    _rate[key] = (start, count + 1)
    if len(_rate) > 4000:
        for k, (began, _) in list(_rate.items()):
            if now - began > WINDOW:
                _rate.pop(k, None)
    return None


@app.middleware('http')
async def limits(request: Request, call_next):
    path = request.url.path
    if path.startswith('/api/') and request.method == 'POST':
        origin = request.headers.get('origin')
        if origin and not origin_allowed(origin, request.headers.get('host')):
            return error(403, 'This request origin is not allowed.')
        declared = request.headers.get('content-length')
        if declared and declared.isdigit() and int(declared) > MAX_BODY:
            return error(413, 'The request is too large.')
        identity = request.client.host if request.client else 'local'
        message = allow(identity, path, time.monotonic())
        if message:
            return error(429, message, {'Retry-After': str(WINDOW)})
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > MAX_BODY:
                return error(413, 'The request is too large.')
        request._body = bytes(raw)
    response = await call_next(request)
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    if path.startswith(('/api/si/', '/api/routes/', '/api/expeditions/plan')):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/healthz')
async def health():
    return {'status': 'ok', 'backend': 'python'}


@app.get('/{resource:path}', include_in_schema=False)
async def frontend(resource: str):
    if resource.startswith('api/'):
        raise HTTPException(404, 'API endpoint not found.')
    if any(part.startswith('.') for part in resource.split('/')):
        raise HTTPException(403, 'Forbidden.')
    root = (ROOT / 'dist').resolve()
    target = (root / (resource or 'index.html')).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(404, 'File not found. Build the frontend with npm run build.')
    # Vite emits content-hashed file names under assets/, so they can be cached for a long time.
    cache = 'public, max-age=31536000, immutable' if resource.startswith('assets/') else 'no-cache'
    media = 'application/manifest+json' if target.suffix == '.webmanifest' else None
    return FileResponse(target, media_type=media, headers={'Cache-Control': cache})
