import os
from pathlib import Path

# MARSMAP_ROOT lets the packaged desktop app point at its unpacked resources.
ROOT = Path(os.environ.get('MARSMAP_ROOT') or Path(__file__).resolve().parents[2])
# Load server-only settings without requiring dotenv or exposing them to Vite.
def load_env(path=ROOT / '.env'):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
load_env()
# Desktop app: optional per-user settings file (for example a Gemini key for S.A.M).
if os.environ.get('MARSMAP_ENV_FILE'):
    load_env(Path(os.environ['MARSMAP_ENV_FILE']))
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-3.8-flash')
