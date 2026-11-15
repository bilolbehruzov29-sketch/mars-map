# Mars Map · Python server

Start and host the whole application using Python. See DEPLOYMENT.md for Windows/Linux commands, Docker and Render. The included dist build is ready to serve; Node is required only if you change frontend source and rebuild it. No JavaScript server or development launcher is included.

Sidebar missions have been restored. The separate Mission goals form and Home navigation button are removed. The SpaceMap brand still opens the greeting page.

Routes: the straight great-circle line (orange) is compared with a terrain detour (green) computed by the Python server. The planner runs A* on bundled NASA MGS MOLA MEGDR topography (4 px/degree, `backend/terrain/data`, source PDS Geosciences Node): every grid step steeper than the chosen max slope (default 15°) is impassable and gentler slopes are penalised, so the route bends around crater walls, scarps and volcano flanks. Slopes are averaged over ~15 km cells (coarser for long routes); boulders, small craters, dunes and soil strength are not modelled, so a plan is never marked safe.

Weather: `/api/nasa/weather/summary` reduces the ~1 MB REMS feed to the latest sols, a 7-sol trend and warnings. The current Martian season and dust-storm season (Ls 180–360°) are computed astronomically for today's date (Allison & McEwen 2000), not taken from a possibly old observation. Route plans state how far the route is from the only station (Curiosity, Gale crater).

Expeditions: the “Plan expedition” panel plans a traverse from base to base. Pick mission sites or candidate base regions, type coordinates, or click points on the map (up to 10 stops, optional return to the first base). Every leg is routed around steep terrain with the MOLA planner. A vehicle model (pressurized crew rover ~10 km/h for up to 8 h of daylight per sol, Apollo-LRV-class open rover ~8 km/h for 4 h, or a robotic rover ~150 m/sol — all stated planning assumptions) turns distance into a sol-by-sol timeline from the chosen departure date. For each leg the server computes “road conditions” for its travel window: solar longitude and local season, daylight hours, noon Sun elevation, top-of-atmosphere sunlight (W/m²), and surface pressure scaled with the barometric formula from the latest Curiosity REMS reading, plus flags for polar night, seasonal CO₂ frost latitudes, the dust-storm season and long multi-season legs. The panel shows the totals, a colour-coded elevation profile, per-leg cards and a share link (`?expedition=…`). Temperature and wind along the route are not modelled and are never invented.

Navigator: the “Navigator” item in the top menu (or the N key on the map) opens an A → B bar. Press A over Mars to set the start at the cursor and B for the destination, or choose a base, or use “Set on map” and click. The route is planned automatically (S swaps, Enter re-routes, Esc closes); “Details” opens the full expedition plan.

3D terrain: “⛰ 3D terrain” in the map toolbar (then click Mars), the T key over the map, or the button on a mission card opens a local 3D model of the surface. It uses NASA MGS MOLA MEGDR elevation at 16 pixels/degree (~3.7 km): the 33 MB grid is downloaded once from the PDS Geosciences Node into DEM_CACHE_DIR (system temp by default; DEM_HIRES=0 disables it) and the bundled 4 px/deg grid is shown until it is ready. The surface is draped with the NASA Viking MDIM 2.1 colour mosaic (Mars Trek tiles; “Elevation” switches to a height colour scale). The Sun is placed from the site’s latitude, the date’s solar declination and a local-time slider (with a play-a-day button), casting real shadows across the relief; the sky shifts from butterscotch by day to a blue sunset glow and stars at night, and a dust selector (τ 0.3–4) controls haze, diffuse light and blowing dust. A conditions panel lists the season, daylight and sunrise/sunset in local solar time, the Sun’s current height and direction, direct sunlight through the chosen dust, air pressure at that elevation, frost and dust-season flags and the nearest REMS observation — all computed or measured values are labelled as such; temperature and wind along the surface are not modelled. Radius 100–800 km, height exaggeration ×1/2/5/10, hover read-out of coordinates and height, compass, north/top/reset views, and the planned route draped on the surface.

API: `GET /api/terrain/patch?lat=&lon=&radiusKm=` · `POST /api/expeditions/plan` · `GET /api/expeditions/bases` · `GET /api/expeditions/conditions?lat=&lon=&day=` · `POST /api/routes/plan` `{start:{lat,lon}, target:{lat,lon}, maxSlopeDeg}` · `GET /api/terrain/elevation?lat=&lon=` · `GET /api/nasa/weather/summary` · docs at `/api/docs`.

The unavailable radiation layer has been replaced with NASA MGS TES Thermal Inertia (WMTS ID TES_Thermal_Inertia, verified available). Other NASA layers and the weather footer remain.

Historical NASA panorama images and their API metadata are bundled under backend/mission/images and records. They are the same verified, aspect-preserving downsampled NASA mosaics, not generated images. Python serves them through the panorama API without requiring a fresh NASA download. NASA source and original-image links are set immediately, including on errors. InSight covers 290°, other registered panoramas cover 360° horizontally, with limited vertical coverage. They describe mission regions, not live rover positions.

Arcadia Planitia is an illustrative regional ice-resource candidate (40°N, 170°W), not an approved landing coordinate. Gale/Mount Sharp is a science reference near Curiosity, not a confirmed safe human landing site. The map cards explain evidence and uncertainties. NASA's resource criteria and proximity to rover study areas do not establish astronaut safety.

Sources:
- https://trek.nasa.gov/mars/
- https://www.nasa.gov/solar-system/nasas-treasure-map-for-water-ice-on-mars/
- https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/
- https://mars.nasa.gov/mars2020/multimedia/raw-images/
- https://pds.nasa.gov/ds-view/pds/viewCollection.jsp?identifier=urn:nasa:pds:mars2020_navcam_ops_mesh:data
- https://images-api.nasa.gov/

The PDS collection supplies terrain meshes, not ready-made 360 photos. Raw-camera images require calibration/mosaicking. The viewer therefore uses verified NASA panorama mosaics, retaining catalogue source links and angular-coverage labels.

Performance: the map is redrawn only when something changes (camera, tiles, routes) instead of 60 times a second; phones, tablets, low-memory laptops and data-saver mode get a lighter profile (pixel ratio ≤ 1.5, no MSAA, fewer sphere segments, 2048 px base textures, fewer parallel tile downloads, smaller tile cache — see src/device.js). The server gzips HTML/JS/CSS/JSON, three.js ships as its own long-cached chunk, and prefers-reduced-motion is respected.

Windows app: see DESKTOP.md — MarsMap.exe bundles the website and the Python server (pywebview + PyInstaller, built automatically by the GitHub Actions workflow “Windows app”); the site is also installable as an app from Edge/Chrome (web manifest + service worker).

Checks: npm test; python -m unittest discover -s backend/tests -v; npm run build. Docker/WebGL visual verification is unavailable in this environment. Live Gemini responses require your GEMINI_API_KEY; missing-key and mocked-response checks are included.
