# Mars Map for Windows

The Windows app is the same Mars Map as the website — map, Navigator, expeditions, 3D terrain,
weather and S.A.M — packed into one program, **MarsMap.exe**. It starts the Python server on your
computer and opens it in its own window (Microsoft Edge WebView2, built into Windows 10/11).
Nothing else needs to be installed. An internet connection is needed for NASA imagery.

## Get MarsMap.exe — automatic build on GitHub (easiest)
1. Push the project to GitHub (`git add -A`, `git commit -m "..."`, `git push`).
2. On GitHub open **Actions → Windows app**. The build starts by itself (about 5–8 minutes);
   you can also press **Run workflow**.
3. When it is green, open the run and download **MarsMap-windows**. Inside:
   * **MarsMap-Setup.exe** — the installer (Start-menu entry, optional desktop icon, uninstaller,
     no administrator rights needed; checks for WebView2);
   * **MarsMap.exe** — the same program as one portable file, no installation.
4. For a public download page create a tag, e.g. `git tag v1.0.0` and `git push --tags`:
   the exe is attached to a GitHub Release.

## Build it yourself on Windows
1. Install Python 3.12 from python.org (tick **Add python.exe to PATH**). Node.js is optional.
2. Double-click `desktop\build_windows.bat` (or run it in a terminal from the `spacemap` folder).
3. The program appears in `dist-desktop\MarsMap.exe`. If Inno Setup 6 is installed
   (https://jrsoftware.org/isdl.php), the installer `dist-desktop\MarsMap-Setup.exe` is built too.

## First start
* Windows SmartScreen may warn about an unknown publisher (the exe is not code-signed):
  **More info → Run anyway**.
* If the window stays white on an old Windows 10, install the free
  “Microsoft Edge WebView2 Runtime” from microsoft.com.
* The precise 3.7 km elevation grid (33 MB) is downloaded once on first use of 3D terrain into
  `%LOCALAPPDATA%\MarsMap\dem`.
* Optional S.A.M chat: create `%LOCALAPPDATA%\MarsMap\settings.env` with the line
  `GEMINI_API_KEY=your-key`.

## Run from source (any OS, for development)
```
python -m pip install -r requirements.txt -r desktop/requirements.txt
python desktop/app.py
```

## Install from the browser instead (no download)
On the hosted site (or http://127.0.0.1:8000) open Edge or Chrome → menu → **Apps → Install
Mars Map**. It gets its own window, Start-menu entry and icon.

---

### Коротко по-русски
* **Проще всего:** сделайте `git push` → на GitHub откройте **Actions → Windows app** → дождитесь
  зелёной галочки → скачайте **MarsMap-windows** → внутри **`MarsMap-Setup.exe`** (установщик: ярлык в «Пуск»,
  на рабочем столе, удаление через «Приложения», без прав администратора) и `MarsMap.exe` (без установки).
* Для всех желающих: `git tag v1.0.0` → `git push --tags` → установщик появится на странице **Releases**.
* **Самому на Windows:** установите Python 3.12 (галочка «Add to PATH») → запустите
  `desktop\build_windows.bat` → готовый файл: `dist-desktop\MarsMap.exe`.
* При первом запуске Windows может предупредить «неизвестный издатель» → **Подробнее → Выполнить в любом случае**.
* В приложении всё то же, что на сайте.
