"""Optional high-resolution MOLA topography (16 pixels/degree, ~3.7 km).

The 33 MB global grid is not shipped with the app. On first use the server
downloads it once from the NASA PDS Geosciences Node into a cache directory
(DEM_CACHE_DIR, default: the system temp dir) and keeps it in memory. Until it
is ready — or if the download is disabled (DEM_HIRES=0) or fails — callers fall
back to the bundled 4 pixels/degree grid.
"""
import array
import math
import os
import tempfile
import threading
from pathlib import Path

import httpx

URL = 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img'
PPD = 16
ROWS, COLS = 180 * PPD, 360 * PPD
SIZE = ROWS * COLS * 2
SOURCE = {
    'dataset': 'MGS MOLA MEGDR topography, 16 pixels/degree (~3.7 km at the equator)',
    'product': 'megt90n000eb.img',
    'url': 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/',
    'ppd': PPD,
}

_lock = threading.Lock()
_state = {'grid': None, 'status': 'idle', 'error': None, 'thread': None}


def enabled():
    return os.getenv('DEM_HIRES', '1').lower() not in ('0', 'false', 'no')


def cache_path():
    return Path(os.getenv('DEM_CACHE_DIR') or Path(tempfile.gettempdir()) / 'marsmap') / 'megt90n000eb.img'


def _load(path):
    grid = array.array('h')
    with open(path, 'rb') as handle:
        grid.frombytes(handle.read())
    if len(grid) != ROWS * COLS:
        raise ValueError('Unexpected DEM size')
    if array.array('h', [1]).tobytes() != b'\x00\x01':
        grid.byteswap()
    return grid


def _download():
    path = cache_path()
    try:
        if not (path.is_file() and path.stat().st_size == SIZE):
            path.parent.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix('.part')
            with httpx.Client(timeout=httpx.Timeout(30, read=120), follow_redirects=False) as client:
                with client.stream('GET', URL) as response:
                    response.raise_for_status()
                    with open(partial, 'wb') as out:
                        for chunk in response.iter_bytes(1 << 20):
                            out.write(chunk)
            if partial.stat().st_size != SIZE:
                partial.unlink(missing_ok=True)
                raise ValueError('Incomplete DEM download')
            partial.replace(path)
        grid = _load(path)
        with _lock:
            _state.update(grid=grid, status='ready', error=None)
    except (OSError, ValueError, httpx.HTTPError) as error:
        with _lock:
            _state.update(status='failed', error=type(error).__name__)


def grid(start=True):
    """The 16 ppd grid if loaded; otherwise None (and start loading in the background)."""
    if not enabled():
        return None
    with _lock:
        if _state['grid'] is not None:
            return _state['grid']
        if start and _state['status'] in ('idle', 'failed'):
            _state['status'] = 'loading'
            thread = threading.Thread(target=_download, name='mola-16ppd', daemon=True)
            _state['thread'] = thread
            thread.start()
        return None


def status():
    if not enabled():
        return 'disabled'
    return _state['status']


def wait(timeout=None):
    """Testing helper: wait for a background load to finish."""
    thread = _state.get('thread')
    if thread:
        thread.join(timeout)


def elevation(data, lat, lon):
    """Bilinear elevation (m) from the 16 ppd grid."""
    y = (90.0 - lat) * PPD - 0.5
    x = (lon % 360.0) * PPD - 0.5
    r0, c0 = math.floor(y), math.floor(x)
    fy, fx = y - r0, x - c0
    def px(r, c):
        return data[min(ROWS - 1, max(0, r)) * COLS + (c % COLS)]
    top = px(r0, c0) * (1 - fx) + px(r0, c0 + 1) * fx
    bottom = px(r0 + 1, c0) * (1 - fx) + px(r0 + 1, c0 + 1) * fx
    return top * (1 - fy) + bottom * fy
