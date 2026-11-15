import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { PanoramaViewer } from './src/panorama.js';
import { createMissionHotspots } from './src/mission-hotspots.js';
import { routeWidth } from './src/routes.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NASA_CONFIG, LAYERS, MISSIONS } from './src/config.js';
import { detectQuality } from './src/device.js';

// Lighter rendering on phones, tablets and low-end laptops (see src/device.js).
const QUALITY = detectQuality();
NASA_CONFIG.tileZoom = QUALITY.tileZoom;
NASA_CONFIG.tileConcurrency = QUALITY.tileConcurrency;
document.documentElement.classList.toggle('low-power', QUALITY.low);
import {
  getTrekCapabilities,
  loadTrekTexture,
  searchNasaImages,
  getRoverManifest
} from './src/nasa-api.js';
import { initAIPanel } from './src/ai-api.js';
import { CanvasMapRenderer } from './src/canvas-fallback.js';
import { TrekLOD } from './src/lod.js';
import { fetchWeather, WEATHER_PAGE } from './src/weather.js';
import { initExpedition, LEG_COLORS } from './src/expedition.js';
import { initNavigator } from './src/navigator.js';
import { createRoutePins } from './src/route-pins.js';
import {
  latLonToVector3,
  vector3ToLatLon,
  latLonToPlane,
  greatCircleDistance,
  greatCircleArc
} from './src/geo.js';

// ==========================================
// 1. ОСНОВНЫЕ НАСТРОЙКИ THREE.JS
// ==========================================

const mount = document.querySelector('#globe');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0f1c');

const camera = new THREE.PerspectiveCamera(42, 1, 0.000001, 100);

camera.position.set(0, 0, 4.2);

let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: QUALITY.antialias, alpha: false, powerPreference: 'high-performance' }); }
catch { renderer = new CanvasMapRenderer(); }

renderer.setPixelRatio(QUALITY.pixelRatio);

// Render on demand: the scene is redrawn only after something changed, instead of 60 times a second.
let framesToRender = 2;
function requestRender(frames = 2) { framesToRender = Math.max(framesToRender, frames); }

renderer.outputColorSpace = THREE.SRGBColorSpace;

mount.appendChild(renderer.domElement);

// Управление камерой мышью
const controls = new OrbitControls(camera, renderer.domElement);

controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 1.00003;
controls.maxDistance = 7;
controls.rotateSpeed = 0.55;

// ==========================================
// 2. ОСВЕЩЕНИЕ
// ==========================================

scene.add(new THREE.AmbientLight(0xffffff, 1.15));

const keyLight = new THREE.DirectionalLight(0xffe0c0, 2.2);

keyLight.position.set(3, 2, 4);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x6688cc, 0.8);

rimLight.position.set(-4, -1, -3);
scene.add(rimLight);

// ==========================================
// 3. СОЗДАНИЕ СФЕРЫ
// ==========================================

const planetGroup = new THREE.Group();
scene.add(planetGroup);

const radius = 1;

const sphereGeometry = new THREE.SphereGeometry(radius, ...QUALITY.sphereSegments);

// ==========================================
// 4. СОЗДАНИЕ ВОСЬМИ СЛОЁВ (3D-сфера + 2D-плоскость)
// ==========================================

const layerMeshes = {}; // сферы — для 3D-режима
const flatMeshes = {}; // плоскости — для 2D-режима

// Контейнер плоской карты (равнопромежуточная проекция 4×2)
const flatGroup = new THREE.Group();
flatGroup.visible = false;
scene.add(flatGroup);

const flatGeometry = new THREE.PlaneGeometry(4, 2);

for (const key of Object.keys(LAYERS)) {
  // Сначала у каждого слоя процедурный макет; настоящая текстура NASA подменит его позже
  const map = new THREE.DataTexture(new Uint8Array([36,28,25,255]),1,1);
  map.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: key !== 'optical',
    opacity: key === 'optical' ? 1 : 0.97,
    depthWrite: true
  });

  const mesh = new THREE.Mesh(sphereGeometry, material);
  mesh.visible = key === 'optical';
  layerMeshes[key] = mesh;
  planetGroup.add(mesh);

  // Плоская копия того же слоя (общая текстура, без освещения)
  const flat = new THREE.Mesh(
    flatGeometry,
    new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide })
  );
  flat.visible = key === 'optical';
  flatMeshes[key] = flat;
  flatGroup.add(flat);
}

// Атмосферная оболочка (только 3D)
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.035, 64, 48),
  new THREE.MeshBasicMaterial({
    color: 0xd77b54,
    transparent: true,
    opacity: 0.075,
    side: THREE.BackSide
  })
);
planetGroup.add(atmosphere);

// ==========================================
// 5. ЗВЁЗДНЫЙ ФОН
// ==========================================

const starGeometry = new THREE.BufferGeometry();

const starPositions = [];

for (let i = 0; i < 900; i++) {
  const v = new THREE.Vector3(
    (Math.random() - 0.5) * 36,
    (Math.random() - 0.5) * 24,
    (Math.random() - 0.5) * 24
  );

  if (v.length() < 5) {
    v.setLength(5 + Math.random() * 10);
  }

  starPositions.push(v.x, v.y, v.z);
}

starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));

const stars = new THREE.Points(
  starGeometry,
  new THREE.PointsMaterial({
    color: 0xc8d4ed,
    size: 0.018,
    transparent: true,
    opacity: 0.72
  })
);

scene.add(stars);

// ==========================================
// 6. СЛОИ И РЕЖИМ 2D / 3D
// ==========================================

let activeLayer = 'planet';
let viewMode = '3d';

// Показывает только активный слой и только активный режим (сфера или плоскость)
function applyVisibility() {
  requestRender();
  for (const key of Object.keys(LAYERS)) {
    layerMeshes[key].visible = (key === activeLayer && layerState[key]?.textureLoaded) || key === 'planet';
    flatMeshes[key].visible = (key === activeLayer && layerState[key]?.textureLoaded) || key === 'planet';
  }

  planetGroup.visible = viewMode === '3d';
  flatGroup.visible = viewMode === '2d';
}

function setLayer(key) {
  if (!LAYERS[key]) return;

  activeLayer = key;
  lod.clear();
  applyVisibility();

  document.querySelectorAll('.layer-button').forEach(button => {
    const selected = button.dataset.layer === key;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  document.querySelector('#activeLayerName').textContent = LAYERS[key].name;

  setStatusText();
  document.querySelector('#detailStatus').textContent=layerState[key]?.caps?'NASA · loading detail…':'No thematic map · showing NASA base imagery';
  renderLayerInfo(); // карточка с метаданными слоя
  loadLayerImagery(key); // подгрузка реальных тайлов NASA (один раз)
  loadLayerImages(key);
  scheduleLOD(); // подгрузка описаний из NASA Image Library
}

document.querySelectorAll('.layer-button').forEach(button => {
  button.addEventListener('click', () => setLayer(button.dataset.layer));
});

// Сброс камеры: для 3D — на расстояние до сферы, для 2D — чтобы вся карта влезла в кадр
function resetView() {
  controls.target.set(0, 0, 0);

  if (viewMode === '3d') {
    camera.position.set(0, 0, 4.2);
  } else {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(1 / t, 2 / (t * camera.aspect)) * 1.05;
    camera.position.set(0, 0, distance);
  }

  controls.update();
}

// Переключение режима: меняем видимость, поведение мыши/касаний и дистанции камеры
function setViewMode(mode) {
  requestRender(3);
  viewMode = mode;

  const is3d = mode === '3d';

  controls.enableRotate = is3d; // в 2D вращение отключено
  controls.mouseButtons.LEFT = is3d ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  controls.touches.ONE = is3d ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
  controls.screenSpacePanning = true;
  controls.minDistance = is3d ? 1.00003 : 0.00005;
  controls.maxDistance = is3d ? 7 : 12;

  document.querySelectorAll('.mode-button').forEach(button => {
    button.classList.toggle('active', button.dataset.view === mode);
  });

  applyVisibility();
  resetView();

  setStatusText();
  lod.clear(); scheduleLOD();
}

// Local mission goals and NASA observation panel.
let weatherData = null;
function poiMarkers() { return Object.entries(MISSIONS).filter(([id])=>id!=='overview').map(([id,m])=>({lat:m.lat,lon:((m.lon+540)%360)-180,color:m.candidate?0xffe08a:0x4cc9f0,id})); }
const lod=new TrekLOD({camera,controls,planetGroup,flatGroup,onChange:()=>requestRender(),concurrency:QUALITY.low?3:6,maxTiles:QUALITY.low?80:160,onStatus:message=>{document.querySelector('#detailStatus').textContent=message;}});
let lodTimer;
function scheduleLOD(){clearTimeout(lodTimer);lodTimer=setTimeout(()=>{
 const state=layerState[activeLayer];
 lod.update(state?.caps,activeLayer,viewMode).catch(()=>{document.querySelector('#detailStatus').textContent='Detailed NASA tiles are unavailable.';});
},400);}
controls.addEventListener('change',()=>{requestRender();scheduleLOD();});
// ==========================================
// 7. МАРКЕРЫ И МАРШРУТЫ (рисуются в обоих режимах)
// ==========================================

// Состояние оверлея — по нему перерисовываем сцену при смене режима
const overlay = { markers: [], expedition: null };
let routeMaterials=[];

const routePins = createRoutePins({ root: document.querySelector('#routePins'), camera, getMode: () => viewMode });
const globeOverlay = new THREE.Group(); // объекты на сфере
const flatOverlay = new THREE.Group(); // объекты на плоскости
planetGroup.add(globeOverlay);
flatGroup.add(flatOverlay);

function clearGroup(group) {
  [...group.children].forEach(object => {
    group.remove(object);
    object.geometry?.dispose();
    object.material?.dispose();
  });
}

// Маркер: точка + кольцо. normal — куда «смотрит» кольцо (наружу от сферы или на камеру)
function addMarkerMeshes(group, position, normal, color, scale = 1) {
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.025 * scale, 16, 16),
    new THREE.MeshBasicMaterial({ color })
  );
  dot.position.copy(position);
  group.add(dot);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.035 * scale, 0.048 * scale, 32),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  ring.position.copy(position).add(normal.clone().multiplyScalar(0.0000001)); // чуть выше точки, вдоль нормали
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  group.add(ring);
}

function drawExpedition(expedition) {
  const material=color=>{const m=new LineMaterial({color,linewidth:2,transparent:true,opacity:0.98,depthTest:true});m.resolution.set(mount.clientWidth||1,mount.clientHeight||1);routeMaterials.push(m);return m;};
  expedition.legs.forEach((leg,i)=>{
    const pts=leg.points;if(!pts||pts.length<2)return;
    const color=leg.blocked?0xff4d6d:LEG_COLORS[i%LEG_COLORS.length];
    const globePts=pts.flatMap(p=>latLonToVector3(p.lat,p.lon,1).normalize().multiplyScalar(1.0008).toArray());
    const g=new Line2(new LineGeometry().setPositions(globePts),material(color));g.renderOrder=11;globeOverlay.add(g);
    const flat=[];for(let j=1;j<pts.length;j++){const a=pts[j-1],b=pts[j];if(Math.abs(a.lon-b.lon)>180)continue;flat.push(...latLonToPlane(a.lat,a.lon,0.000004).toArray(),...latLonToPlane(b.lat,b.lon,0.000004).toArray());}
    if(flat.length){const f=new LineSegments2(new LineSegmentsGeometry().setPositions(flat),material(color));f.renderOrder=11;flatOverlay.add(f);}
  });
}

// Перерисовка всего оверлея по состоянию
function redrawOverlay() {
  requestRender();
  routeMaterials=[];
  clearGroup(globeOverlay);
  clearGroup(flatOverlay);

  overlay.markers.forEach(({ lat, lon, color }) => {
    const p = latLonToVector3(lat, lon, 1.000002);
    addMarkerMeshes(globeOverlay, p, p.clone().normalize(), color);
    addMarkerMeshes(flatOverlay, latLonToPlane(lat, lon), new THREE.Vector3(0, 0, 1), color, 0.8);
  });

  if (overlay.expedition) drawExpedition(overlay.expedition);
}

function setMarkers(markers, expedition = null) {
  overlay.markers = [...poiMarkers(), ...markers];
  routePins.set(markers.filter(marker => marker.label));
  overlay.expedition = expedition;
  redrawOverlay();
}

// ==========================================
// 8. ФОРМА ВВОДА КООРДИНАТ
// ==========================================

let expeditionUI = null;
let mapPick = null; // (lat, lon) => void while the expedition planner or the navigator waits for a map click
let navigatorUI = null;
let navigatorPending = false;

function showExpedition(plan) {
  const stops = plan.stops;
  const roundTrip = stops.length > 2 && plan.roundTrip;
  const shown = roundTrip ? stops.slice(0, -1) : stops; // the return stop is the first base again
  const markers = shown.map((stop, i) => {
    const first = i === 0, last = i === shown.length - 1 && (!roundTrip || shown.length === 2);
    return { lat: stop.lat, lon: stop.lon, title: stop.name,
      color: first ? 0x4cc9f0 : last ? 0xffb547 : 0xffe08a,
      label: shown.length === 2 ? (first ? 'A' : 'B') : String(i + 1), kind: first ? 'from' : last ? 'to' : 'stop' };
  });
  setMarkers(markers, { legs: plan.legs.map(leg => ({ points: leg.points, blocked: leg.blocked })) });
  // Turn the globe towards the middle of the expedition (average of the stop vectors).
  const centre = stops.reduce((sum, stop) => sum.add(latLonToVector3(stop.lat, stop.lon, 1)), new THREE.Vector3());
  if (centre.lengthSq() < 1e-6) return;
  const direction = centre.normalize();
  const spread = Math.max(...stops.map(stop => direction.angleTo(latLonToVector3(stop.lat, stop.lon, 1).normalize())));
  if (viewMode === '3d') {
    controls.target.set(0, 0, 0);
    camera.position.copy(direction.clone().multiplyScalar(1 + Math.min(3.2, Math.max(0.3, spread * 2.6))));
  } else {
    const { lat, lon } = vector3ToLatLon(direction);
    const p = latLonToPlane(lat, lon, 0);
    controls.target.set(p.x, p.y, 0);
    camera.position.set(p.x, p.y, Math.min(4, Math.max(0.25, spread * 3)));
  }
  controls.update();
  scheduleLOD();
}

// ==========================================
// 9. КОСМИЧЕСКИЕ МИССИИ (+ данные NASA)
// ==========================================

let currentMission = null;
const missionCache = {}; // key → { images, rover } — чтобы не дёргать API повторно

// Наведение камеры на точку. В 3D — поворот к точке, в 2D — сдвиг карты
function focusOn(lat, lon) {
  if (viewMode === '3d') {
    const direction = latLonToVector3(lat, lon, 1).normalize();
    controls.target.set(0, 0, 0);
    camera.position.copy(direction.multiplyScalar(1.0008));
  } else {
    const p = latLonToPlane(lat, lon, 0);
    controls.target.set(p.x, p.y, 0);
    camera.position.set(p.x, p.y, 0.002);
  }

  controls.update();
  scheduleLOD();
}

// ==========================================
// 10. БОКОВАЯ ПАНЕЛЬ КООРДИНАТ
// ==========================================

const drawer = document.querySelector('#coordinateDrawer');

const backdrop = document.querySelector('#drawerBackdrop');

function openDrawer() {
  drawer.classList.add('open');

  backdrop.classList.add('visible');

  drawer.setAttribute('aria-hidden', 'false');
  drawer.inert=false;
}

function closeDrawer() {
  drawer.classList.remove('open');

  backdrop.classList.remove('visible');

  drawer.setAttribute('aria-hidden', 'true');
  drawer.inert=true;
}

document.querySelector('#openCoordinates').addEventListener('click', openDrawer);

document.querySelector('#closeCoordinates').addEventListener('click', closeDrawer);

backdrop.addEventListener('click', closeDrawer);

// ==========================================
// 11. ПЕРЕКЛЮЧЕНИЕ СТРАНИЦ
// ==========================================

function showPage(page, updateHistory = true) {
  requestRender(3);
  document.querySelectorAll('.page').forEach(element => {
    element.classList.toggle('active', element.id === `${page}Page`);
  });

  document.querySelectorAll('.nav-link[data-page]').forEach(element => {
    element.classList.toggle('active', element.dataset.page === page);
  });

  document.querySelector('#openCoordinates').hidden = page !== 'map';
  document.querySelector('#weatherFooter').hidden = page !== 'map';
  if (page !== 'map') navigatorUI?.close();
  closeDrawer();
  if (page === 'map') {
    resizeRenderer();
  }
  if (updateHistory && location.hash !== `#${page}`) history.pushState(null,'',`#${page}`);
}

document.querySelectorAll('[data-page]').forEach(button => {
  button.addEventListener('click', () => {
    showPage(button.dataset.page);
  });
});

document.querySelector('#homeLink').addEventListener('click', event => {
  event.preventDefault();

  showPage('welcome');
});

document.querySelector('#backToMap').addEventListener('click', () => {
  showPage('map');
});

// ==========================================
// 12. КНОПКИ: СБРОС КАМЕРЫ И 2D / 3D
// ==========================================

document.querySelector('#resetView').addEventListener('click', resetView);

document.querySelectorAll('.mode-button').forEach(button => {
  button.addEventListener('click', () => setViewMode(button.dataset.view));
});

// ==========================================
// 13. АДАПТАЦИЯ РАЗМЕРА
// ==========================================

function resizeRenderer() {
  requestRender();
  const width = mount.clientWidth || 1;
  const height = mount.clientHeight || 1;

  camera.aspect = width / height;
  // Centre the planet in the free area to the right of the floating side panel (desktop/tablet).
  const panelOpen = window.matchMedia('(min-width: 901px)').matches && !document.querySelector('#mapPage')?.classList.contains('sidebar-hidden');
  const shift = panelOpen ? Math.min(186, width * 0.2) : 0;
  if (shift) camera.setViewOffset(width, height, -shift, 0, width, height); else camera.clearViewOffset();

  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}

const resizeObserver = new ResizeObserver(resizeRenderer);

resizeObserver.observe(mount);

window.addEventListener('resize', resizeRenderer);

resizeRenderer();

// ==========================================
// 14. ОПРЕДЕЛЕНИЕ КООРДИНАТ ПОД КУРСОРОМ (3D и 2D)
// ==========================================

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const lastCursor = { lat: null, lon: null }; // нужно для контекста ИИ

let pressAt = null;
renderer.domElement.addEventListener('pointerdown', event => { pressAt = { x: event.clientX, y: event.clientY }; });
renderer.domElement.addEventListener('pointerup', event => {
  if (!mapPick || !pressAt || Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(viewMode === '3d' ? layerMeshes[activeLayer] : flatMeshes[activeLayer], false);
  if (!hits.length) return;
  const point = hits[0].point;
  const { lat, lon } = viewMode === '3d' ? vector3ToLatLon(point) : { lat: point.y * 90, lon: (point.x / 2) * 180 };
  if (Math.abs(lat) > 88) return;
  mapPick(lat, lon);
});

renderer.domElement.addEventListener('pointermove', event => {
  const rect = renderer.domElement.getBoundingClientRect();

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  // Лучом проверяем сферу (3D) или плоскость (2D)
  const target = viewMode === '3d' ? layerMeshes[activeLayer] : flatMeshes[activeLayer];
  const hits = raycaster.intersectObject(target, false);

  if (!hits.length) return;

  const point = hits[0].point;
  let lat, lon;

  if (viewMode === '3d') {
    ({ lat, lon } = vector3ToLatLon(point));
  } else {
    lon = (point.x / 2) * 180;
    lat = point.y * 90;
  }

  lastCursor.lat = lat;
  lastCursor.lon = lon;

  document.querySelector('#coordinateReadout').innerHTML = `
    LATITUDE <b>${lat.toFixed(1)}°</b> LONGITUDE <b>${lon.toFixed(1)}°</b>
  `;
});

// ==========================================
// 15. ГЛАВНЫЙ ЦИКЛ
// ==========================================

const panoramaViewer=new PanoramaViewer();
const routePinsUpdate=()=>routePins.update();
const updateMissionHotspots=createMissionHotspots({missions:MISSIONS,camera,getMode:()=>viewMode,onSelect:id=>{const m=MISSIONS[id];if(mapPick){mapPick(m.lat,((m.lon+540)%360)-180);return;}currentMission=id;if(expeditionUI&&document.querySelector('#coordinateDrawer').classList.contains('open')){expeditionUI.addBase(id);return;}if(m.candidate){chooseMission(id);}else panoramaViewer.open(id);}});
let lastRender = 0;
function animate(now = 0) {
  requestAnimationFrame(animate);
  if (!document.querySelector('#mapPage').classList.contains('active')) return;
  controls.rotateSpeed = viewMode === '3d' ? Math.min(0.55, Math.max(0.00002, (camera.position.length()-1)*0.4)) : 0.55;
  if (controls.update()) requestRender();          // true while the camera moves (incl. damping)
  if (framesToRender <= 0 && now - lastRender < QUALITY.idleRenderMs) return; // idle: occasional safety redraw only
  framesToRender = Math.max(0, framesToRender - 1);
  lastRender = now;
  const height = viewMode==='3d'?camera.position.length()-1:camera.position.distanceTo(controls.target);
  const scale = Math.min(1,Math.max(0.00003,height*0.25));
  // Only marker meshes shrink with zoom; route lines (Line2 is also a Mesh) keep their geometry.
  for(const group of [globeOverlay,flatOverlay]) for(const obj of group.children) if(obj.isMesh&&!obj.isLine2&&!obj.isLineSegments2) obj.scale.setScalar(scale);
  for(const material of routeMaterials){material.linewidth=routeWidth(height);material.resolution.set(mount.clientWidth||1,mount.clientHeight||1);}
  updateMissionHotspots();
  routePinsUpdate();
  renderer.render(scene, camera);
}

animate();

// ==========================================
// 16. ДАННЫЕ NASA ДЛЯ СЛОЁВ
// ==========================================

// Состояние каждого слоя: источник данных, метаданные, снимки, статус загрузки
const layerState = {};

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function setStatusText() {
  const online = Object.values(layerState).some(s => s.source === 'nasa');
  document.querySelector('#dataStatusText').textContent =
    `${viewMode.toUpperCase()} · ${layerState[activeLayer]?.textureLoaded ? 'NASA TREK' : 'LOADING / NO DATA'}`;
}

// Бейдж «NASA / МАКЕТ» на кнопке слоя
function markLayerButton(key) {
  const button = document.querySelector(`.layer-button[data-layer="${key}"]`);
  let badge = button.querySelector('.src-badge');

  if (!badge) {
    badge = document.createElement('em');
    badge.className = 'src-badge';
    button.querySelector('kbd').before(badge);
  }

  const nasa = layerState[key].source === 'nasa';
  badge.classList.toggle('nasa', nasa);
  badge.textContent = nasa ? 'NASA' : 'NO MAP';
}

// При старте запрашиваем метаданные (WMTS Capabilities) сразу для всех слоёв
async function initLayerMetadata() {
  await Promise.all(
    Object.entries(LAYERS).map(async ([key, config]) => {
      const state = (layerState[key] = {
        source: 'unavailable',
        caps: null,
        status: '',
        images: null,
        loading: false,
        textureLoaded: false
      });

      // Пробуем ID по порядку, берём первый рабочий
      for (const id of config.trek) {
        try {
          state.caps = await getTrekCapabilities(id);
          state.source = 'nasa';
          break;
        } catch (error) {
          console.warn(`[NASA Trek] layer ${id} unavailable:`, error.message);
        }
      }

      markLayerButton(key);
    })
  );

  setStatusText();
  renderLayerInfo();
}

const metadataReady = initLayerMetadata();

expeditionUI = initExpedition({
  missions: MISSIONS,
  onPlan(plan) {
    showExpedition(plan);
    if (navigatorPending) { navigatorPending = false; navigatorUI?.showPlan(plan); }
  },
  onError(text) {
    if (navigatorPending) { navigatorPending = false; navigatorUI?.showError(text); }
  },
  onPickMode(on) {
    mapPick = on ? (lat, lon) => {
      expeditionUI.addPoint(lat, lon);
      const picked = overlay.markers.filter(marker => marker.picked);
      setMarkers([...picked, { lat, lon, color: 0xffe08a, picked: true, label: '+', kind: 'stop' }], overlay.expedition);
    } : null;
    renderer.domElement.style.cursor = on ? 'crosshair' : '';
    document.body.classList.toggle('picking-on-map', on);
    // The dimmed backdrop would swallow map clicks while picking.
    backdrop.classList.toggle('visible', !on && drawer.classList.contains('open'));
  }
});

navigatorUI = initNavigator({
  bases: expeditionUI.bases,
  getCursor: () => lastCursor,
  onPickRequest(handler) {
    mapPick = handler;
    renderer.domElement.style.cursor = handler ? 'crosshair' : '';
  },
  onPoints({ from, to }) {
    if (navigatorPending) return;
    const markers = [];
    if (from) markers.push({ lat: from.lat, lon: from.lon, color: 0x4cc9f0, label: 'A', kind: 'from' });
    if (to) markers.push({ lat: to.lat, lon: to.lon, color: 0xffb547, label: 'B', kind: 'to' });
    setMarkers(markers, null);
  },
  onRoute(points) {
    navigatorPending = true;
    expeditionUI.route(points);
  },
  onDetails() {
    openDrawer();
    document.querySelector('#routeResult')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
});
document.querySelector('#openNavigator').addEventListener('click', () => {
  if (!document.querySelector('#mapPage').classList.contains('active')) { showPage('map'); navigatorUI.open(); }
});


// Загрузка и подмена текстуры слоя на настоящие тайлы NASA (один раз на слой)
async function loadLayerImagery(key) {
  await metadataReady;

  const state = layerState[key];
  if (state.source !== 'nasa' || state.textureLoaded || state.loading) return;

  state.loading = true;
  state.status = 'Loading tiles…';
  renderLayerInfo();

  try {
    const { canvas, loaded, total } = await loadTrekTexture(
      state.caps,
      NASA_CONFIG.tileZoom,
      renderer.capabilities.maxTextureSize,
      (done, all) => {
        state.status = `Loading tiles: ${done}/${all}`;
        if (activeLayer === key && done % 8 === 0) renderLayerInfo();
      }
    );

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // Подменяем текстуру на сфере и на плоскости, старую освобождаем
    const sphereMaterial = layerMeshes[key].material;
    const oldMap = sphereMaterial.map;
    sphereMaterial.map = texture;
    flatMeshes[key].material.map = texture;
    sphereMaterial.needsUpdate = true;
    flatMeshes[key].material.needsUpdate = true;
    oldMap.dispose();

    state.textureLoaded = true;
    requestRender();
    if(key !== 'planet') {
      sphereMaterial.transparent=true; flatMeshes[key].material.transparent=true;
      layerMeshes[key].scale.setScalar(1.0000001); flatMeshes[key].position.z=0.0000001;
    }
    applyVisibility(); setStatusText(); scheduleLOD();
    state.status = `Tiles: ${loaded}/${total}`;
  } catch (error) {
    console.warn(`[NASA Trek] ${key}:`, error.message);
    state.source = 'unavailable'; // откат на макет
    markLayerButton(key);
    setStatusText();
  } finally {
    state.loading = false;
    renderLayerInfo();
  }
}

// Описания и снимки по теме слоя из NASA Image Library
async function loadLayerImages(key) {
  await metadataReady;

  const state = layerState[key];
  if (state.images !== null) return;

  state.images = []; // защита от повторных запросов

  try {
    state.images = await searchNasaImages(LAYERS[key].query, 3);
  } catch (error) {
    console.warn(`[NASA Images] ${key}:`, error.message);
  }

  renderLayerInfo();
}

// Карточка активного слоя
function renderLayerInfo() {
  const key = activeLayer;
  const config = LAYERS[key];
  const state = layerState[key];
  const box = document.querySelector('#layerInfo');

  if (!state) {
    box.innerHTML = '<p class="muted">Requesting NASA metadata…</p>';
    return;
  }

  const nasa = state.source === 'nasa';

  let html = `<h3>${escapeHtml(config.instrument)}</h3>`;

  html += nasa
    ? `<p>Source: NASA Mars Trek (WMTS)<br><span class="muted">${escapeHtml(state.caps.title || state.caps.id)}</span></p>`
    : '<p>This thematic map is unavailable. Only NASA base imagery is shown, without thematic measurements. NASA reference material is listed below.</p>';

  if (nasa && state.caps.abstract) {
    html += `<p class="muted">${escapeHtml(state.caps.abstract.slice(0, 220))}</p>`;
  }

  if (state.status) html += `<p class="muted">${escapeHtml(state.status)}</p>`;

  if (state.images?.length) {
    html +=
      '<ul>' +
      state.images
        .map(
          img =>
            `<li><a href="${escapeHtml(img.page)}" target="_blank" rel="noreferrer">${escapeHtml(img.title)}</a></li>`
        )
        .join('') +
      '</ul>';
  }

  box.innerHTML = html;
}

setLayer('planet');
loadLayerImagery('planet');

// ==========================================
// 17. ИИ-ПОМОЩНИК (интерфейс готов, API отключён)
// ==========================================

// Контекст, который уходит на сервер вместе с вопросом
initAIPanel({
  getContext: () => ({
    layer: activeLayer,
    viewMode,
    mission: currentMission,
    cursor: lastCursor,
    layerInfo: {name:LAYERS[activeLayer].name,instrument:LAYERS[activeLayer].instrument,coverageLoaded:Boolean(layerState[activeLayer]?.textureLoaded)},
    missionInfo: currentMission ? MISSIONS[currentMission] : null,
    weather: weatherData,
    expedition: expeditionUI?.plan ? (({totals,vehicle,departure,warnings,pressureReference,legs,stops})=>({totals,vehicle:vehicle.name,departure,warnings,pressureReference,note:'Planning sketch: coarse MOLA terrain, computed (not forecast) conditions, assumed vehicle speeds.',
      stops:stops.map(s=>({name:s.name,lat:s.lat,lon:s.lon,elevationM:s.elevationM,arrival:s.arrival?.date})),
      legs:legs.map(l=>({from:l.from,to:l.to,distanceKm:l.distanceKm,extraKm:l.extraKm,maxSlopeDeg:l.maxSlopeDeg,sols:l.sols,start:l.start.date,end:l.end.date,blocked:l.blocked,conditions:(({ls,daylightH,noonSunDeg,insolationWm2,pressurePa,seasons})=>({ls,daylightH,noonSunDeg,insolationWm2,pressurePa,seasons}))(l.conditions)}))}))(expeditionUI.plan) : null,
    nasaSources: ['https://trek.nasa.gov/mars/','https://science.nasa.gov/mars/','https://mars.nasa.gov/layout/embed/image/mslweather/',...(currentMission && MISSIONS[currentMission].source?[MISSIONS[currentMission].source]:[])]
  })
});
if(renderer.isFallback){document.querySelector('[data-view="3d"]').disabled=true;document.querySelector('[data-view="3d"]').title='WebGL is unavailable in this browser';setViewMode('2d');}
setMarkers([]);
async function refreshWeather(){
 const box=document.querySelector('#weatherInfo');box.textContent='Requesting NASA observations…';
 try {weatherData=await fetchWeather(); const w=weatherData;
 const age=Math.floor((Date.now()-Date.parse(w.date+'T00:00:00Z'))/86400000);
 const val=(v,unit)=>v==null?'no data':`${v} ${unit}`;
 box.innerHTML=`<b>${escapeHtml(w.station)}</b><p>Sol ${escapeHtml(w.sol)} · ${escapeHtml(w.date)}<br>${age>2?'Archived observations · '+age+' days ago':'Latest available observations'}</p><p>Air temperature: ${val(w.min,'°C')} … ${val(w.max,'°C')}<br>Pressure: ${val(w.pressure,'Pa')}<br>Wind: ${val(w.wind,'m/s')}</p>${w.season?`<p>Season now (Ls ${Number(w.season.ls).toFixed(0)}°): northern ${escapeHtml(w.season.northern)} · ${w.season.dustStormSeason?'dust-storm season':'outside dust-storm season'}</p>`:''}<p>Local observations; not a planet-wide forecast.</p>`;
 }catch{weatherData=null;box.textContent='NASA weather is unavailable (network, CORS, or service issue). No substitute readings are shown. Open the official report below.';}
}
document.querySelector('#refreshWeather').onclick=refreshWeather;refreshWeather();


const openLocationPage=()=>{const page=location.hash.slice(1)||(new URLSearchParams(location.search).has('expedition')?'map':'');showPage(['map','about','welcome'].includes(page)?page:'welcome',false);};
window.addEventListener('popstate',openLocationPage);
window.addEventListener('hashchange',openLocationPage);
openLocationPage();
if (expeditionUI.autoPlan) { openDrawer(); expeditionUI.submit(); }

function chooseMission(id){
 const m=MISSIONS[id];currentMission=id;
 if(id==='overview')resetView();else focusOn(m.lat,((m.lon+540)%360)-180);
 document.querySelectorAll('.mission').forEach(b=>b.classList.toggle('active',b.dataset.mission===id));
 const box=document.querySelector('#missionInfo');box.replaceChildren();const text=document.createElement('p');text.textContent=m.description;box.append(text);
 if(m.source){const a=document.createElement('a');a.href=m.source;a.target='_blank';a.rel='noopener noreferrer';a.textContent='NASA source ↗';box.append(a);}
 if(m.panorama){const b=document.createElement('button');b.className='primary-button';b.textContent='осмотр местности · Panorama';b.onclick=()=>panoramaViewer.open(id);box.append(b);}
 if(id!=='overview'){const add=document.createElement('button');add.className='secondary-button';add.textContent='+ Add to expedition';add.onclick=()=>{expeditionUI?.addBase(id);openDrawer();};const t3=document.createElement('button');t3.className='secondary-button';t3.textContent='⛰ 3D terrain';t3.onclick=()=>openTerrainAt(m.lat,((m.lon+540)%360)-180);box.append(add,t3);}
}
document.querySelectorAll('.mission').forEach(b=>b.onclick=()=>chooseMission(b.dataset.mission));

// ==========================================
// Floating panels: hide/show the side panel and collapse the weather card.
// Preferences are remembered per browser (storage may be unavailable: then defaults apply).
// ==========================================
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const recall = key => { try { return localStorage.getItem(key); } catch { return null; } };
{
  const page = document.querySelector('#mapPage');
  const toggle = document.querySelector('#sidebarToggle');
  const sidebar = document.querySelector('#mapSidebar');
  const setSidebar = hidden => {
    page.classList.toggle('sidebar-hidden', hidden);
    toggle.setAttribute('aria-expanded', String(!hidden));
    toggle.title = hidden ? 'Show panel' : 'Hide panel';
    sidebar.inert = hidden && window.matchMedia('(min-width: 901px)').matches;
    remember('marsmap.sidebarHidden', hidden ? '1' : '0');
    resizeRenderer();
  };
  toggle.addEventListener('click', () => setSidebar(!page.classList.contains('sidebar-hidden')));
  setSidebar(recall('marsmap.sidebarHidden') === '1');

  const card = document.querySelector('#weatherFooter');
  const weatherToggle = document.querySelector('#weatherToggle');
  const setWeather = collapsed => {
    card.classList.toggle('collapsed', collapsed);
    weatherToggle.setAttribute('aria-expanded', String(!collapsed));
    remember('marsmap.weatherCollapsed', collapsed ? '1' : '0');
  };
  weatherToggle.addEventListener('click', () => setWeather(!card.classList.contains('collapsed')));
  const savedWeather = recall('marsmap.weatherCollapsed');
  setWeather(savedWeather === null ? window.matchMedia('(max-width: 1100px)').matches : savedWeather === '1');
}

// ==========================================
// Local 3D terrain (loaded on demand): toolbar button + click, T key at the cursor, mission cards.
// ==========================================
let terrainPicking = false;
async function openTerrainAt(lat, lon) {
  const { openTerrain3d } = await import('./src/terrain3d.js');
  openTerrain3d({ lat, lon, getRoute: () => expeditionUI?.plan?.legs?.flatMap(leg => leg.points) || null });
}
function setTerrainPicking(on) {
  terrainPicking = on;
  document.querySelector('#terrain3dButton').classList.toggle('active', on);
  document.body.classList.toggle('picking-terrain', on);
  renderer.domElement.style.cursor = on ? 'crosshair' : '';
  mapPick = on ? (lat, lon) => { setTerrainPicking(false); openTerrainAt(lat, lon); } : null;
}
document.querySelector('#terrain3dButton').addEventListener('click', () => setTerrainPicking(!terrainPicking));
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (!document.querySelector('#mapPage').classList.contains('active') || document.body.classList.contains('terrain-open')) return;
  if (event.key === 'Escape' && terrainPicking) setTerrainPicking(false);
  if (event.key.toLowerCase() === 't' && lastCursor.lat != null && Math.abs(lastCursor.lat) <= 88) { event.preventDefault(); openTerrainAt(lastCursor.lat, lastCursor.lon); }
});

// Installable app (PWA): register the service worker on secure origins (https or localhost).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
