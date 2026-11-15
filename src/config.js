// ==========================================
// КОНФИГУРАЦИЯ: NASA API, слои, миссии
// Всё, что нужно менять руками, лежит здесь.
// ==========================================

// ---------- Настройки NASA API ----------
export const NASA_CONFIG = {
  // Ключ api.nasa.gov. DEMO_KEY имеет жёсткие лимиты — получи свой бесплатно: https://api.nasa.gov
  // Ключ NASA публичный по своей природе, но для продакшена лучше проксировать через свой сервер.
  apiKey: 'DEMO_KEY',

  apiBase: 'https://api.nasa.gov', // Mars Rover Photos (манифесты миссий)
  imagesApi: 'https://images-api.nasa.gov', // NASA Image and Video Library (ключ не нужен)
  trekBase: 'https://trek.nasa.gov/tiles/Mars/EQ', // Mars Trek WMTS (тайлы слоёв, ключ не нужен)

  tileZoom: 3, // Уровень детализации тайлов: 3 → сетка 16×8 тайлов (~4096×2048 px)
  tileConcurrency: 8, // Сколько тайлов грузится одновременно
  timeoutMs: 15000 // Таймаут одного запроса
};

// ---------- Слои ----------
// trek: список ID слоёв Mars Trek по приоритету. Берётся первый, чей WMTSCapabilities.xml ответил.
// Если ни один не найден, тематическая карта отсутствует; видна только подложка NASA.
// ID и ResourceURL проверяются через WMTS GetCapabilities.
// Ошибки не заменяются синтетическими измерениями.
// Нашёл нужный ID слоя на https://trek.nasa.gov/mars/ — просто добавь его в список trek.
export const LAYERS = {
  planet: { name: 'SURFACE · NASA', trek: ['Mars_Viking_MDIM21_ClrMosaic_global_232m'], instrument: 'Viking · global base; local CTX / HiRISE on zoom', query: 'Mars CTX global mosaic' },
  optical: {
    name: 'OPTICAL LAYER',
    trek: ['Mars_Viking_MDIM21_ClrMosaic_global_232m'],
    instrument: 'Viking Orbiter · MDIM 2.1 mosaic',
    query: 'Mars Viking global color mosaic'
  },
  thermal: {
    name: 'THERMAL INFRARED LAYER',
    trek: [
      'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018',
      'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018'
    ],
    instrument: 'Mars Odyssey · THEMIS infrared imagery',
    query: 'Mars THEMIS thermal infrared'
  },
  spectral: {
    sourceUrl: 'https://trek.nasa.gov/mars/',
    name: 'SPECTRAL LAYER',
    trek: ['T1303_FeMgSmectite_Mineral_Indicator_SP'],
    instrument: 'MRO · CRISM · Fe/Mg smectites, regional product 1303',
    query: 'Mars CRISM mineral spectral'
  },
  topographic: {
    name: 'TOPOGRAPHIC LAYER',
    trek: ['Mars_MGS_MOLA_ClrShade_merge_global_463m'],
    instrument: 'Mars Global Surveyor · MOLA laser altimeter',
    query: 'Mars MOLA topography elevation'
  },
  geophysical: {
    name: 'MOLA ROUGHNESS',
    trek: ['mola_roughness'],
    instrument: 'MGS · MOLA · surface roughness',
    query: 'Mars MOLA surface roughness'
  },
  atmospheric: {
    name: 'ATMOSPHERIC LAYER',
    trek: ['TES_Dust'],
    instrument: 'MGS · TES · archival dust map (not current weather)',
    query: 'Mars TES dust index'
  },
  radiation: {
    name: 'THERMAL INERTIA · TES',
    trek: ['TES_Thermal_Inertia'],
    instrument: 'MGS · TES · thermal inertia',
    query: 'Mars TES thermal inertia'
  },
  chemical: {
    name: 'MINERAL LAYER',
    trek: ['TES_Glass_Clay'],
    instrument: 'MGS · TES · glass/clay minerals',
    query: 'Mars TES glass clay minerals'
  }
};

// ---------- Missions / регионы ----------
// lat/lon — центр региона (долгота 0…360 °E, нормализуется в main.js).
// description — офлайн-описание, показывается сразу, пока грузятся данные NASA.
// query — поисковый запрос для NASA Image Library; rover — ID марсохода для манифеста.
import missionCatalog from './data/missions.json' with { type: 'json' };
export const MISSIONS = missionCatalog;

export const DETAIL_LAYERS = [
 {id:'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', lat:18.44,lon:77.45,range:1},
 {id:'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0',lat:18.44,lon:77.45,range:4},
 {id:'curiosity_ctx_mosaic',lat:-4.59,lon:137.44,range:4},
 {id:'Gusev_CTX_BlockAdj_dd',lat:-14.57,lon:175.47,range:4},
 {id:'opportunity_hirise_mosaic',lat:-1.95,lon:-5.47,range:2}
];
