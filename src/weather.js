export const WEATHER_URL = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json';
export const WEATHER_PAGE = 'https://mars.nasa.gov/layout/embed/image/mslweather/';
export function numeric(value) {
  if (value == null || String(value).trim() === '' || value === '--') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
export function parseWeather(json) {
  const rows = (json.soles || []).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.terrestrial_date));
  rows.sort((a,b) => b.terrestrial_date.localeCompare(a.terrestrial_date) || Number(b.sol)-Number(a.sol));
  if (!rows.length) throw new Error('NASA returned no observations');
  const r = rows[0];
  return { station: 'Curiosity · REMS · Gale Crater', lat: -4.5895, lon: 137.4417,
    date: r.terrestrial_date, sol: r.sol, min: numeric(r.min_temp), max: numeric(r.max_temp),
    pressure: numeric(r.pressure), wind: numeric(r.wind_speed), opacity: r.atmo_opacity || null,
    source: WEATHER_URL };
}
export async function fetchWeather() {
  // Server-side summary: a few KB instead of the ~1 MB raw feed; keeps the raw `soles` rows.
  const response = await fetch('/api/nasa/weather/summary', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`NASA HTTP ${response.status}`);
  const json = await response.json();
  return { ...parseWeather(json), season: json.season || null, warnings: json.warnings || [], trend: json.trend7Sols || null };
}
