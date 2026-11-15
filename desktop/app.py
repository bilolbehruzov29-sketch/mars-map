"""Mars Map desktop app.

Starts the same FastAPI server as the website on a free localhost port and shows it in a native
window (Microsoft Edge WebView2 on Windows). Everything the website shows is available here.

Run from source:   python desktop/app.py        (from the spacemap folder)
Packaged:          MarsMap.exe                   (built with desktop/MarsMap.spec)
Headless check:    MARSMAP_HEADLESS=1 python desktop/app.py   (prints the URL, no window)
"""
import os
import socket
import sys
import threading
import time
from pathlib import Path

APP_NAME = 'Mars Map'


def resource_root():
    # PyInstaller unpacks bundled files into sys._MEIPASS; from source it is the spacemap folder.
    return Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))


def user_data_dir():
    base = os.environ.get('LOCALAPPDATA') or os.environ.get('XDG_DATA_HOME') or str(Path.home() / '.local' / 'share')
    path = Path(base) / 'MarsMap'
    path.mkdir(parents=True, exist_ok=True)
    return path


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_for(port, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def main():
    data = user_data_dir()
    os.environ.setdefault('MARSMAP_ROOT', str(resource_root()))
    os.environ.setdefault('DEM_CACHE_DIR', str(data / 'dem'))        # 3.7 km elevation grid, downloaded once
    os.environ.setdefault('MARSMAP_ENV_FILE', str(data / 'settings.env'))  # optional GEMINI_API_KEY=...

    import uvicorn
    from backend.main import app

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning', access_log=False))
    thread = threading.Thread(target=server.run, name='marsmap-server', daemon=True)
    thread.start()
    if not wait_for(port):
        raise SystemExit('Mars Map server did not start.')
    url = f'http://127.0.0.1:{port}/#map'

    (data / 'last-url.txt').write_text(url)  # handy for checks; windowed builds have no console
    if os.environ.get('MARSMAP_HEADLESS'):
        if sys.stdout:
            print(url, flush=True)
        try:
            while thread.is_alive():
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
    else:
        import webview
        webview.create_window(APP_NAME, url, width=1440, height=900, min_size=(960, 640), background_color='#0A0F1C', text_select=True)
        webview.start(private_mode=False, storage_path=str(data / 'webview'))
    server.should_exit = True
    thread.join(timeout=5)


if __name__ == '__main__':
    # Allow "python desktop/app.py" from the spacemap folder.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    main()
