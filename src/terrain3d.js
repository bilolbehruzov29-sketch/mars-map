// Local 3D terrain viewer.
// MOLA elevation draped with the NASA Viking colour mosaic, lit by the real Sun position for the chosen
// date and local time, under a Martian sky with adjustable dust, plus computed surface conditions.
// Loaded on demand (dynamic import) so the main bundle stays small.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { getTrekCapabilities, loadImage } from './nasa-api.js';
import {
  KM_PER_DEG, patchHeight, toLocal, sunPosition, sunVector, directIrradiance, skyColors,
  DUST_LEVELS, defaultDust, formatLmst
} from './terrain-math.js';

const RADII = [100, 250, 500, 800];
const EXAGGERATIONS = [1, 2, 5, 10];
const IMAGERY_LAYER = 'Mars_Viking_MDIM21_ClrMosaic_global_232m';
const LOW_POWER = document.documentElement.classList.contains('low-power');
const RAMP = [[0, '#1b2a6b'], [0.2, '#2e7fb8'], [0.4, '#41b6a6'], [0.6, '#d9c27a'], [0.8, '#e0703a'], [1, '#f5efe6']].map(([t, c]) => [t, new THREE.Color(c)]);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const coords = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
const compassWord = az => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(az / 22.5) % 16];
const today = () => new Date().toISOString().slice(0, 10);

export function rampColor(t, target = new THREE.Color()) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
      return target.copy(c0).lerp(c1, (t - t0) / (t1 - t0));
    }
  }
  return target.copy(RAMP.at(-1)[1]);
}

/** Compose NASA Trek tiles covering the patch into one canvas (default plane UVs then match exactly). */
async function loadImagery(patch, isCurrent) {
  const caps = await getTrekCapabilities(IMAGERY_LAYER);
  const cos = Math.max(0.05, Math.cos(patch.lat * Math.PI / 180));
  const halfLon = patch.radiusKm / (KM_PER_DEG * cos), halfLat = patch.radiusKm / KM_PER_DEG;
  const west = patch.lon - halfLon, north = patch.lat + halfLat, widthDeg = 2 * halfLon, heightDeg = 2 * halfLat;
  const target = LOW_POWER ? 1024 : 2048;
  // Finest level whose tiles still fit a sensible budget; stop once it is sharp enough.
  let level = caps.levels[0];
  for (const l of caps.levels) {
    const tiles = (Math.ceil(widthDeg / (360 / l.cols)) + 1) * (Math.ceil(heightDeg / (180 / l.rows)) + 1);
    if (tiles > 64) break;
    level = l;
    if (widthDeg * l.cols * l.tileW / 360 >= target) break;
  }
  const pxLon = level.cols * level.tileW / 360, pxLat = level.rows * level.tileH / 180;
  const scale = Math.min(1, 4096 / Math.max(widthDeg * pxLon, heightDeg * pxLat));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(widthDeg * pxLon * scale));
  canvas.height = Math.max(2, Math.round(heightDeg * pxLat * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#9a6a48';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const c0 = Math.floor((west + 180) / 360 * level.cols), c1 = Math.floor((west + widthDeg + 180) / 360 * level.cols);
  const r0 = Math.max(0, Math.floor((90 - north) / 180 * level.rows)), r1 = Math.min(level.rows - 1, Math.floor((90 - north + heightDeg) / 180 * level.rows));
  const jobs = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) jobs.push({ r, c });
  let drawn = 0;
  const worker = async () => {
    while (jobs.length && isCurrent()) {
      const { r, c } = jobs.shift();
      const col = ((c % level.cols) + level.cols) % level.cols;
      const url = caps.template.replace('{TileMatrix}', level.id).replace('{TileRow}', r).replace('{TileCol}', col);
      const img = await loadImage(url);
      if (!img) continue;
      const tileWest = -180 + 360 * c / level.cols, tileNorth = 90 - 180 * r / level.rows;
      ctx.drawImage(img, (tileWest - west) * pxLon * scale, (north - tileNorth) * pxLat * scale, level.tileW * scale + 0.5, level.tileH * scale + 0.5);
      drawn++;
    }
  };
  await Promise.all(Array.from({ length: LOW_POWER ? 4 : 8 }, worker));
  if (!drawn) throw new Error('No imagery tiles');
  return { canvas, title: 'NASA Viking MDIM 2.1 colour mosaic', metresPerPixel: Math.round(KM_PER_DEG * 1000 / pxLon / scale * cos) };
}

let viewer = null;

export function openTerrain3d(options) {
  if (!viewer) viewer = createViewer();
  viewer.open(options);
  return viewer;
}

function createViewer() {
  const root = document.createElement('section');
  root.className = 'terrain-dialog';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'terrainTitle');
  root.hidden = true;
  root.innerHTML = `
    <div class="terrain-window">
      <header class="terrain-head">
        <div><span class="terrain-eyebrow">3D TERRAIN · NASA MOLA + VIKING</span><h2 id="terrainTitle">—</h2></div>
        <div class="terrain-head-actions">
          <button type="button" data-act="north" title="Look north">N ↑</button>
          <button type="button" data-act="top" title="View from above">Top</button>
          <button type="button" data-act="ground" title="Low view across the land">Low</button>
          <button type="button" data-act="reset" title="Reset view">Reset</button>
          <button type="button" class="terrain-close" data-act="close" aria-label="Close 3D terrain">×</button>
        </div>
      </header>
      <div class="terrain-stage">
        <canvas aria-label="3D terrain. Drag to rotate, scroll or pinch to zoom, right-drag to pan."></canvas>
        <aside class="terrain-weather" aria-label="Conditions at this place">
          <button type="button" class="terrain-weather-toggle" aria-expanded="true">Conditions here <span aria-hidden="true">⌄</span></button>
          <div class="terrain-weather-body"><p class="terrain-muted">Loading conditions…</p></div>
        </aside>
        <div class="terrain-compass" aria-hidden="true"><span>N</span></div>
        <div class="terrain-readout" aria-live="polite"></div>
        <div class="terrain-loading"><i></i><span>Loading elevation…</span></div>
      </div>
      <footer class="terrain-foot">
        <div class="terrain-row">
          <label class="terrain-time">Local time <output data-out="time">13:00</output>
            <input type="range" data-ctl="time" min="0" max="24" step="0.25" value="13" aria-label="Local solar time on Mars"></label>
          <button type="button" class="terrain-play" data-act="play" aria-label="Play a day">▶</button>
          <label>Date <input type="date" data-ctl="date" min="2000-01-01" max="2100-12-31"></label>
          <div class="terrain-seg" role="group" aria-label="Dust in the air">${DUST_LEVELS.map(d => `<button type="button" data-dust="${d.id}" title="Dust optical depth τ ${d.tau}">${d.label}</button>`).join('')}</div>
        </div>
        <div class="terrain-row">
          <div class="terrain-seg" role="group" aria-label="Surface"><button type="button" data-mode="photo">Photo</button><button type="button" data-mode="elevation">Elevation</button></div>
          <label>Radius <select data-ctl="radius">${RADII.map(r => `<option value="${r}">${r} km</option>`).join('')}</select></label>
          <div class="terrain-seg" role="group" aria-label="Vertical exaggeration"><span>Height ×</span>${EXAGGERATIONS.map(e => `<button type="button" data-exag="${e}">${e}</button>`).join('')}</div>
          <div class="terrain-legend"><span data-legend="min"></span><i></i><span data-legend="max"></span></div>
        </div>
        <p class="terrain-meta"></p>
      </footer>
    </div>`;
  document.body.append(root);

  const $ = s => root.querySelector(s);
  const canvas = $('canvas'), stage = $('.terrain-stage'), title = $('#terrainTitle'), readout = $('.terrain-readout');
  const loading = $('.terrain-loading'), meta = $('.terrain-meta'), compass = $('.terrain-compass span');
  const weatherBody = $('.terrain-weather-body'), legend = $('.terrain-legend');
  const radiusSelect = $('[data-ctl="radius"]'), timeInput = $('[data-ctl="time"]'), dateInput = $('[data-ctl="date"]'), timeOut = $('[data-out="time"]');

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !LOW_POWER && window.devicePixelRatio < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW_POWER ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#d9b38c', 1, 10);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.005, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 0.08;
  controls.maxDistance = 6;

  const ambient = new THREE.HemisphereLight('#e9cfb0', '#3a2414', 0.5);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight('#fff3e2', 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(LOW_POWER ? 1024 : 2048, LOW_POWER ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.1, far: 8 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // Stars (night) and blowing dust (hazy / storm).
  const stars = (() => {
    const n = 900, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random() * 0.5 + 0.5, th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
      p.set([20 * Math.sin(ph) * Math.cos(th), 20 * Math.cos(ph), 20 * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 0.13, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
    pts.visible = false; scene.add(pts); return pts;
  })();
  const dust = (() => {
    const n = LOW_POWER ? 1500 : 3500, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) p.set([Math.random() * 2.6 - 1.3, Math.random() * 0.45, Math.random() * 2.6 - 1.3], i * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: '#d2a57a', size: 0.007, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false }));
    pts.visible = false; scene.add(pts); return pts;
  })();

  const world = new THREE.Group(); // 1 unit = patch radius; heights scaled by exaggeration
  scene.add(world);
  let terrain = null, routeLine = null, pin = null, imagery = null, imageryInfo = null;
  let state = { lat: 0, lon: 0, radius: 250, exag: 2, mode: 'photo', time: 13, date: today(), dust: null, getRoute: () => null, onClose: () => {} };
  let patch = null, cond = null, request = 0, retry = null, raf = 0, dirty = true, playing = false, lastFrame = 0;

  const requestDraw = () => { dirty = true; };
  controls.addEventListener('change', requestDraw);

  function resize() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (routeLine) routeLine.material.resolution.set(w, h);
    requestDraw();
  }
  new ResizeObserver(resize).observe(stage);

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    if (controls.update()) dirty = true;
    if (playing) {
      state.time = (state.time + dt * 1.2) % 24;   // ~20 s per sol
      timeInput.value = state.time;
      updateSun();
    }
    if (dust.visible) {
      const pos = dust.geometry.attributes.position, wind = (0.04 + 0.08 * Math.min(1, tau() / 4)) * dt;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i) + wind, y = pos.getY(i) + Math.sin(now / 900 + i) * 0.0004;
        if (x > 1.3) x -= 2.6;
        pos.setXY(i, x, Math.max(0, Math.min(0.45, y)));
      }
      pos.needsUpdate = true;
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    compass.style.transform = `rotate(${(controls.getAzimuthalAngle() * 180 / Math.PI).toFixed(1)}deg)`;
    renderer.render(scene, camera);
  }

  function setView(kind) {
    const d = 2.1;
    if (kind === 'top') camera.position.set(0, d * 1.2, 0.001);
    else if (kind === 'north') camera.position.set(0, d * 0.75, d);
    else if (kind === 'ground') camera.position.set(0.15, 0.12, 0.9);
    else camera.position.set(d * 0.55, d * 0.7, d * 0.9);
    controls.target.set(0, 0, 0);
    controls.update();
    requestDraw();
  }

  const tau = () => DUST_LEVELS.find(d => d.id === state.dust)?.tau ?? 0.6;
  const scaleFor = () => state.exag / 1000 / state.radius; // metres → world units

  function surfaceMaterial() {
    const photo = state.mode === 'photo' && imagery;
    return new THREE.MeshStandardMaterial({ map: photo ? imagery : null, vertexColors: !photo, roughness: 1, metalness: 0 });
  }

  function buildTerrain() {
    if (terrain) { world.remove(terrain); terrain.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
    const n = patch.size;
    const geometry = new THREE.PlaneGeometry(2, 2, n - 1, n - 1);  // x: east, y: north, row 0 = north
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const span = Math.max(1, patch.maxM - patch.minM), color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, patch.heights[i] - patch.centerM);
      rampColor((patch.heights[i] - patch.minM) / span, color).toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrain = new THREE.Mesh(geometry, surfaceMaterial());
    terrain.rotation.x = -Math.PI / 2;  // plane XY → ground XZ, north = -Z, height = +Y
    terrain.castShadow = terrain.receiveShadow = true;
    terrain.add(buildSkirt(n));
    world.add(terrain);
    applyExaggeration();
  }

  // Earth-coloured side walls so the patch reads as a cut-out block of ground, not a floating sheet.
  function buildSkirt(n) {
    const base = patch.minM - patch.centerM - Math.max(400, (patch.maxM - patch.minM) * 0.15);
    const edge = [];
    for (let j = 0; j < n; j++) edge.push([j, 0]);
    for (let i = 1; i < n; i++) edge.push([n - 1, i]);
    for (let j = n - 2; j >= 0; j--) edge.push([j, n - 1]);
    for (let i = n - 2; i >= 0; i--) edge.push([0, i]);
    const pos = [];
    const xy = (j, i) => [-1 + 2 * j / (n - 1), 1 - 2 * i / (n - 1)];
    for (let k = 0; k < edge.length - 1; k++) {
      const [j0, i0] = edge[k], [j1, i1] = edge[k + 1];
      const [x0, y0] = xy(j0, i0), [x1, y1] = xy(j1, i1);
      const h0 = patch.heights[i0 * n + j0] - patch.centerM, h1 = patch.heights[i1 * n + j1] - patch.centerM;
      pos.push(x0, y0, h0, x0, y0, base, x1, y1, h1, x1, y1, h1, x0, y0, base, x1, y1, base);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const skirt = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#4a2c1b', roughness: 1, side: THREE.DoubleSide }));
    skirt.receiveShadow = true;
    return skirt;
  }

  function refreshMaterial() {
    if (!terrain) return;
    terrain.material.dispose();
    terrain.material = surfaceMaterial();
    legend.hidden = state.mode !== 'elevation';
    root.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
    requestDraw();
  }

  function applyExaggeration() {
    updateMeta();
    root.querySelectorAll('[data-exag]').forEach(b => b.classList.toggle('active', Number(b.dataset.exag) === state.exag));
    if (!terrain) return;
    terrain.scale.set(1, 1, scaleFor());
    terrain.geometry.computeVertexNormals();
    buildOverlays();
    requestDraw();
  }

  function worldPoint(east, north, h) {
    return new THREE.Vector3(east / patch.radiusKm, (h - patch.centerM) * scaleFor(), -north / patch.radiusKm);
  }

  function buildOverlays() {
    for (const obj of [routeLine, pin]) if (obj) { world.remove(obj); obj.geometry.dispose(); obj.material.dispose(); }
    routeLine = pin = null;
    pin = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 16), new THREE.MeshBasicMaterial({ color: '#4cc9f0', fog: false }));
    pin.rotation.x = Math.PI;
    pin.position.copy(worldPoint(0, 0, patch.centerM)).add(new THREE.Vector3(0, 0.04, 0));
    world.add(pin);
    const route = state.getRoute?.();
    if (!route?.length) return;
    const pts = [];
    for (let i = 0; i < route.length; i++) {
      const a = toLocal(patch, route[i].lat, route[i].lon);
      const b = i + 1 < route.length ? toLocal(patch, route[i + 1].lat, route[i + 1].lon) : null;
      const steps = b ? Math.max(1, Math.ceil(Math.hypot(b.east - a.east, b.north - a.north) / (patch.spacingKm / 2))) : 1;
      for (let k = 0; k < steps; k++) {
        const t = k / steps, e = b ? a.east + (b.east - a.east) * t : a.east, nn = b ? a.north + (b.north - a.north) * t : a.north;
        const h = patchHeight(patch, e, nn);
        pts.push(h == null ? null : worldPoint(e, nn, h).add(new THREE.Vector3(0, 0.004, 0)));
      }
    }
    let best = [], run = [];
    for (const p of [...pts, null]) { if (p) run.push(p); else { if (run.length > best.length) best = run; run = []; } }
    if (best.length < 2) return;
    const material = new LineMaterial({ color: '#ff7a45', linewidth: 3, depthTest: true });
    material.resolution.set(stage.clientWidth || 1, stage.clientHeight || 1);
    routeLine = new Line2(new LineGeometry().setPositions(best.flatMap(p => p.toArray())), material);
    world.add(routeLine);
  }

  // ---- Sun, sky, dust -------------------------------------------------------------------
  function updateSun() {
    timeOut.textContent = formatLmst(state.time);
    const position = cond ? sunPosition(state.lat, cond.declinationDeg, state.time) : { elevation: 35, azimuth: 300 };
    const v = sunVector(position), t = tau(), el = position.elevation;
    sun.position.set(v.x * 3, Math.max(v.y, 0.02) * 3, v.z * 3);
    const mu = Math.max(Math.sin(el * Math.PI / 180), 0);
    const beam = el > 0 ? Math.exp(-t / Math.max(mu, 0.05)) : 0;
    sun.intensity = 3.4 * beam;
    sun.color.set(el < 8 ? '#ffd2a6' : '#fff3e2');
    ambient.intensity = el > -6 ? 0.18 + 0.55 * Math.min(1, t / 4) * Math.min(1, (el + 6) / 20) + 0.25 * Math.min(1, Math.max(0, (el + 6) / 30)) : 0.26;
    ambient.color.set(el > 0 ? '#e9cfb0' : '#8fa4cc');
    const sky = skyColors(el, t);
    stage.style.background = `linear-gradient(to top, ${sky.horizon} 0%, ${sky.top} 70%)`;
    scene.fog.color.set(sky.horizon);
    scene.fog.near = 0.8;
    scene.fog.far = 2.2 + 9 / (1 + t);
    stars.visible = el < -4;
    stars.material.opacity = Math.min(0.9, (-el - 4) / 10) * (t > 2 ? 0.3 : 1);
    dust.visible = t >= 1.5;
    dust.material.opacity = Math.min(0.75, 0.25 + t * 0.12);
    dust.material.color.set(sky.horizon);
    renderer.toneMappingExposure = el > 0 ? 1.05 : 1.2;
    updateLive(position);
    requestDraw();
  }

  function updateLive(position) {
    const box = weatherBody.querySelector('[data-live]');
    if (!box) return;
    const flux = cond ? 1361 / (cond.sunDistanceAu ** 2) : 590;
    const direct = directIrradiance(flux, position.elevation, tau());
    box.innerHTML = position.elevation > 0
      ? `<b>${fmt(position.elevation)}°</b> above the horizon, ${compassWord(position.azimuth)} (${fmt(position.azimuth)}°) · direct sunlight ≈ <b>${fmt(direct)} W/m²</b> with dust τ ${tau()}`
      : `Sun is <b>${fmt(-position.elevation)}°</b> below the horizon — night`;
  }

  function renderConditions() {
    if (!cond) { weatherBody.innerHTML = '<p class="terrain-muted">Conditions are unavailable right now.</p>'; return; }
    const c = cond, st = c.station;
    const hemi = c.lat >= 0 ? 'northern' : 'southern';
    const sunTimes = c.sunriseLmst == null ? 'polar night — the Sun does not rise' : c.sunriseLmst === 0 && c.sunsetLmst === 24 ? 'polar day — the Sun does not set'
      : `sunrise ${formatLmst(c.sunriseLmst)} · sunset ${formatLmst(c.sunsetLmst)}`;
    weatherBody.innerHTML = `
      <dl>
        <dt>Date</dt><dd>${esc(c.date)} · Ls ${c.ls}° · ${hemi} ${esc(c.season)}</dd>
        <dt>Daylight</dt><dd>${fmt(c.daylightH, 1)} h · ${sunTimes}</dd>
        <dt>Sun now</dt><dd data-live></dd>
        <dt>Sunlight</dt><dd>${fmt(c.insolationWm2)} W/m² sol average at the top of the atmosphere · noon Sun ${fmt(c.noonSunDeg)}°</dd>
        <dt>Air pressure</dt><dd>≈ <b>${fmt(c.pressurePa)} Pa</b> at ${fmt(c.elevationM)} m ${c.liquidWaterPossible ? '(above water’s triple point)' : '(too thin for liquid water)'}</dd>
        <dt>Frost</dt><dd>${c.frostLikely ? '<span class="terrain-warn">CO₂ / water frost likely</span>' : 'not expected'}</dd>
        <dt>Dust season</dt><dd>${c.dustStormSeason ? '<span class="terrain-warn">yes — regional storms possible</span>' : 'no (clearer half of the year)'}</dd>
        <dt>Nearest station</dt><dd>${st ? `${esc(st.name)} · ${fmt(st.distanceKm)} km away · ${esc(st.date)}${st.ageDays > 2 ? ` (${st.ageDays} days old)` : ''}<br>${st.minTempC ?? '–'} … ${st.maxTempC ?? '–'} °C · ${st.pressurePa ?? '–'} Pa · ${esc(st.opacity || 'opacity n/a')}` : 'REMS data unavailable'}</dd>
      </dl>
      <p class="terrain-muted">${esc(c.note)} Sky, haze and blowing dust are visualisations.</p>`;
    updateSun();
  }

  function updateMeta() {
    if (!patch) return;
    const relief = patch.maxM - patch.minM;
    meta.innerHTML = `<b>Elevation:</b> ${esc(patch.dem.dataset)} · grid ${patch.size}×${patch.size}, ${patch.spacingKm.toFixed(1)} km${patch.interpolated ? ' (smoothed)' : ''} · relief ${fmt(relief)} m · <a href="${esc(patch.dem.url)}" target="_blank" rel="noreferrer">PDS ↗</a>` +
      (imageryInfo ? ` · <b>Surface:</b> ${esc(imageryInfo.title)} (~${fmt(imageryInfo.metresPerPixel)} m/px)` : state.mode === 'photo' ? ' · <span class="terrain-muted">loading NASA imagery…</span>' : '') +
      (patch.hiRes === 'loading' ? '<br><span class="terrain-note">Downloading the 3.7 km NASA elevation grid… the view will sharpen automatically.</span>' : '') +
      `<br><span class="terrain-note">${state.exag === 1 ? 'True vertical scale.' : `Heights exaggerated ×${state.exag}.`} Features smaller than the grid (boulders, small craters) are not resolved.</span>`;
  }

  async function loadConditions() {
    cond = null;
    try {
      const r = await fetch(`/api/expeditions/conditions?lat=${state.lat.toFixed(4)}&lon=${state.lon.toFixed(4)}&day=${state.date}`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) cond = await r.json();
    } catch { cond = null; }
    if (!state.dust) state.dust = defaultDust(cond?.dustStormSeason, cond?.station?.opacity);
    root.querySelectorAll('[data-dust]').forEach(b => b.classList.toggle('active', b.dataset.dust === state.dust));
    renderConditions();
  }

  async function load() {
    const id = ++request;
    clearTimeout(retry);
    loading.hidden = false;
    readout.textContent = '';
    try {
      const url = `/api/terrain/patch?lat=${state.lat.toFixed(4)}&lon=${state.lon.toFixed(4)}&radiusKm=${state.radius}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (id !== request) return;
      const sameArea = patch && patch.lat === data.lat && patch.lon === data.lon && patch.radiusKm === data.radiusKm;
      patch = data;
      if (!sameArea) { imagery?.dispose(); imagery = null; imageryInfo = null; }
      buildTerrain();
      refreshMaterial();
      title.textContent = `${coords(patch.lat, patch.lon)} · ${fmt(patch.centerM)} m`;
      $('[data-legend="min"]').textContent = `${fmt(patch.minM)} m`;
      $('[data-legend="max"]').textContent = `${fmt(patch.maxM)} m`;
      updateMeta();
      if (patch.hiRes === 'loading') retry = setTimeout(() => { if (!root.hidden) load(); }, 5000);
      if (!imagery) {
        loadImagery(patch, () => id === request).then(({ canvas: img, title: t, metresPerPixel }) => {
          if (id !== request) return;
          imagery = new THREE.CanvasTexture(img);
          imagery.colorSpace = THREE.SRGBColorSpace;
          imagery.anisotropy = renderer.capabilities.getMaxAnisotropy();
          imageryInfo = { title: t, metresPerPixel };
          refreshMaterial(); updateMeta();
        }).catch(() => { if (id === request && state.mode === 'photo') { state.mode = 'elevation'; refreshMaterial(); meta.insertAdjacentHTML('beforeend', '<br><span class="terrain-error">NASA imagery is unavailable; showing elevation colours.</span>'); } });
      }
    } catch (error) {
      if (id !== request) return;
      meta.innerHTML = `<span class="terrain-error">Elevation data is unavailable: ${esc(error.name === 'TimeoutError' ? 'the server took too long' : error.message)}</span>`;
    } finally {
      if (id === request) loading.hidden = true;
      requestDraw();
    }
  }

  // Hover read-out: coordinates and elevation under the pointer.
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  canvas.addEventListener('pointermove', event => {
    if (!terrain || !patch) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(terrain, false)[0];
    if (!hit) { readout.textContent = ''; return; }
    const east = hit.point.x * patch.radiusKm, north = -hit.point.z * patch.radiusKm;
    const h = patchHeight(patch, east, north);
    const lat = patch.lat + north / KM_PER_DEG;
    const lon = ((patch.lon + east / (KM_PER_DEG * Math.max(0.05, Math.cos(patch.lat * Math.PI / 180))) + 540) % 360) - 180;
    readout.textContent = `${coords(lat, lon)} · ${fmt(h)} m · ${fmt(Math.hypot(east, north))} km from centre`;
  });
  canvas.addEventListener('pointerleave', () => { readout.textContent = ''; });

  root.addEventListener('click', event => {
    const el = event.target.closest('[data-act],[data-exag],[data-mode],[data-dust]');
    if (!el) return;
    if (el.dataset.act === 'close') return close();
    if (el.dataset.act === 'play') { playing = !playing; el.textContent = playing ? '❚❚' : '▶'; el.setAttribute('aria-label', playing ? 'Pause' : 'Play a day'); return; }
    if (el.dataset.act) return setView(el.dataset.act);
    if (el.dataset.exag) { state.exag = Number(el.dataset.exag); applyExaggeration(); }
    if (el.dataset.mode) { state.mode = el.dataset.mode; refreshMaterial(); updateMeta(); }
    if (el.dataset.dust) { state.dust = el.dataset.dust; root.querySelectorAll('[data-dust]').forEach(b => b.classList.toggle('active', b === el)); updateSun(); }
  });
  $('.terrain-weather-toggle').addEventListener('click', event => {
    const aside = $('.terrain-weather'), collapsed = !aside.classList.toggle('collapsed');
    event.currentTarget.setAttribute('aria-expanded', String(collapsed));
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !root.hidden) { event.stopPropagation(); close(); } }, true);
  radiusSelect.addEventListener('change', () => { state.radius = Number(radiusSelect.value); load(); });
  timeInput.addEventListener('input', () => { state.time = Number(timeInput.value); updateSun(); });
  dateInput.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) { state.date = dateInput.value; loadConditions(); } });

  let returnFocus = null;
  function open({ lat, lon, radius, getRoute, onClose }) {
    const moved = lat !== state.lat || lon !== state.lon;
    state = { ...state, lat, lon, radius: radius || state.radius, getRoute: getRoute || (() => null), onClose: onClose || (() => {}) };
    radiusSelect.value = String(state.radius);
    dateInput.value = state.date;
    timeInput.value = state.time;
    if (window.matchMedia('(max-width: 760px)').matches) $('.terrain-weather').classList.add('collapsed');
    returnFocus = document.activeElement;
    root.hidden = false;
    document.body.classList.add('terrain-open');
    resize();
    setView('reset');
    if (!raf) { lastFrame = 0; raf = requestAnimationFrame(loop); }
    if (moved || !cond) loadConditions();
    load();
    $('.terrain-close').focus();
  }

  function close() {
    root.hidden = true;
    playing = false;
    $('[data-act="play"]').textContent = '▶';
    document.body.classList.remove('terrain-open');
    cancelAnimationFrame(raf); raf = 0;
    clearTimeout(retry);
    state.onClose();
    returnFocus?.focus?.();
  }

  return { open, close, get isOpen() { return !root.hidden; } };
}
