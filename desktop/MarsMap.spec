# PyInstaller build for the Mars Map desktop app (run from the spacemap folder):
#   pyinstaller --noconfirm desktop/MarsMap.spec
# Produces dist-desktop/MarsMap.exe on Windows (a single file; no Python or Node needed to run it).
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).parent
datas = [
    (str(ROOT / 'dist'), 'dist'),                                   # the built website
    (str(ROOT / 'src' / 'data'), 'src/data'),                       # mission catalogue
    (str(ROOT / 'backend' / 'terrain' / 'data'), 'backend/terrain/data'),     # bundled 4 px/deg MOLA grid
    (str(ROOT / 'backend' / 'mission' / 'images'), 'backend/mission/images'), # NASA panoramas
    (str(ROOT / 'backend' / 'mission' / 'records'), 'backend/mission/records'),
]
hidden = collect_submodules('uvicorn') + collect_submodules('backend')

a = Analysis(
    [str(ROOT / 'desktop' / 'app.py')],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=hidden,
    excludes=['tkinter', 'pytest', 'numpy', 'psycopg'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name='MarsMap',
    icon=str(ROOT / 'desktop' / 'mars.ico'),
    console=False,          # windowed app: no black console window
    upx=False,
    disable_windowed_traceback=False,
)
