// ==========================================
// NASA API КЛИЕНТ
// 1) Mars Trek WMTS  — тайлы и метаданные слоёв
// 2) NASA Image Library — снимки и описания по запросу
// 3) Mars Rover Photos — манифест миссии марсохода
// ==========================================

import { NASA_CONFIG as C } from './config.js';

// ---------- Базовый запрос с таймаутом ----------
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), C.timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// 1. MARS TREK: метаданные слоя (WMTS GetCapabilities)
// ==========================================

const capabilitiesCache = new Map();

// Достаём первый элемент по локальному имени (XML-пространства имён игнорируем)
const first = (root, name) => root?.getElementsByTagNameNS('*', name)[0];
const textOf = (root, name) => first(root, name)?.textContent?.trim() ?? '';

// Разбор XML возвращает: название, описание, шаблон URL тайлов и список уровней детализации
export function parseCapabilities(xml, layerId) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');

  const layer = first(doc, 'Layer');
  const template = [...doc.getElementsByTagNameNS('*','ResourceURL')].find(e => e.getAttribute('resourceType') === 'tile')?.getAttribute('template');
  if (template && !new URL(template).hostname.endsWith('.nasa.gov')) throw new Error('External tile provider: only nasa.gov is allowed');
  if (!layer || !template) throw new Error('No layer or tile template in Capabilities');

  const style = textOf(first(layer, 'Style'), 'Identifier') || 'default';
  const matrixSetId = textOf(first(layer, 'TileMatrixSetLink'), 'TileMatrixSet');

  // Определение набора матриц лежит в <Contents>, а ссылка на него — внутри <Layer>
  const matrixSet = [...doc.getElementsByTagNameNS('*', 'TileMatrixSet')].find(
    el =>
      el.parentNode?.localName === 'Contents' &&
      (!matrixSetId || textOf(el, 'Identifier') === matrixSetId)
  );
  if (!matrixSet) throw new Error('TileMatrixSet not found');

  const levels = [...matrixSet.getElementsByTagNameNS('*', 'TileMatrix')].map(m => ({
    id: textOf(m, 'Identifier'),
    cols: Number(textOf(m, 'MatrixWidth')),
    rows: Number(textOf(m, 'MatrixHeight')),
    tileW: Number(textOf(m, 'TileWidth')) || 256,
    tileH: Number(textOf(m, 'TileHeight')) || 256
  }));

  return {
    id: layerId,
    title: textOf(layer, 'Title'),
    abstract: textOf(layer, 'Abstract'),
    // Подставляем стиль и набор матриц; {TileMatrix}/{TileRow}/{TileCol} заполняются позже
    template: template
      .replace('/1.0.0//', '/1.0.0/').replace('{Style}', style)
      .replace('{TileMatrixSet}', textOf(matrixSet, 'Identifier')),
    levels
  };
}

// Запрос Capabilities одного слоя (результат кэшируется)
export function getTrekCapabilities(layerId) {
  if (!capabilitiesCache.has(layerId)) {
    const request = fetchWithTimeout(`${C.trekBase}/${layerId}/1.0.0/WMTSCapabilities.xml`)
      .then(r => r.text())
      .then(xml => parseCapabilities(xml, layerId));

    // Неудачный результат не кэшируем, чтобы можно было повторить
    request.catch(() => capabilitiesCache.delete(layerId));
    capabilitiesCache.set(layerId, request);
  }
  return capabilitiesCache.get(layerId);
}

// ==========================================
// 2. MARS TREK: склейка тайлов в одну текстуру
// ==========================================

export function loadImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous'; // нужно, чтобы рисовать тайлы в canvas
    const timer = setTimeout(() => { image.src = ''; resolve(null); }, C.timeoutMs);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); resolve(null); }; // нет тайла = нет покрытия, это нормально
    image.src = url;
  });
}

// Собирает canvas из тайлов нужного уровня. onProgress(loaded, total) — для индикатора.
export async function loadTrekTexture(caps, zoom, maxTextureSize, onProgress = () => {}) {
  // Берём самый детальный уровень, не превышающий zoom и лимит видеокарты
  const level =
    [...caps.levels]
      .filter(l => Number(l.id) <= zoom && l.cols * l.tileW <= maxTextureSize)
      .pop() ?? caps.levels[0];

  const canvas = document.createElement('canvas');
  canvas.width = level.cols * level.tileW;
  canvas.height = level.rows * level.tileH;

  const ctx = canvas.getContext('2d');
  // Transparent gaps preserve the NASA base layer.

  const jobs = [];
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) jobs.push({ row, col });
  }

  let done = 0;
  let loaded = 0;

  // Пул воркеров: каждый берёт следующий тайл из общей очереди
  const worker = async () => {
    while (jobs.length) {
      const { row, col } = jobs.shift();
      const url = caps.template
        .replace('{TileMatrix}', level.id)
        .replace('{TileRow}', row)
        .replace('{TileCol}', col);

      const image = await loadImage(url);
      if (image) {
        ctx.drawImage(image, col * level.tileW, row * level.tileH, level.tileW, level.tileH);
        loaded++;
      }
      onProgress(++done, level.cols * level.rows);
    }
  };

  await Promise.all(Array.from({ length: C.tileConcurrency }, worker));

  if (!loaded) throw new Error('No tiles loaded (CORS or missing coverage)');
  return { canvas, loaded, total: level.cols * level.rows };
}

// ==========================================
// 3. NASA IMAGE LIBRARY: снимки и описания
// ==========================================

export async function searchNasaImages(query, limit = 3) {
  const url = `${C.imagesApi}/search?q=${encodeURIComponent(query)}&media_type=image&page_size=${limit}`;
  const json = await (await fetchWithTimeout(url)).json();

  return (json.collection?.items ?? []).slice(0, limit).map(item => ({
    id: item.data?.[0]?.nasa_id,
    title: item.data?.[0]?.title ?? 'Untitled',
    date: item.data?.[0]?.date_created?.slice(0, 10) ?? '',
    thumb: item.links?.[0]?.href ?? '',
    page: `https://images.nasa.gov/details/${encodeURIComponent(item.data?.[0]?.nasa_id ?? '')}`
  }));
}

// ==========================================
// 4. MARS ROVER PHOTOS: манифест миссии марсохода
// ==========================================

export async function getRoverManifest(rover) {
  const url = `${C.apiBase}/mars-photos/api/v1/manifests/${rover}?api_key=${C.apiKey}`;
  const json = await (await fetchWithTimeout(url)).json();
  const m = json.photo_manifest;

  return {
    name: m.name,
    status: m.status,
    landingDate: m.landing_date,
    maxSol: m.max_sol,
    maxDate: m.max_date,
    totalPhotos: m.total_photos
  };
}