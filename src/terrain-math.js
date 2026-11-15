// Pure helpers for the 3D terrain viewer (no DOM / WebGL, unit-tested in Node).
export const KM_PER_DEG = 2 * Math.PI * 3389.5 / 360;

/** Bilinear height (m) at local east/north km from a patch. */
export function patchHeight(patch, eastKm, northKm) {
  const n = patch.size, s = patch.spacingKm, r = patch.radiusKm;
  const x = (eastKm + r) / s, y = (r - northKm) / s;
  if (x < 0 || y < 0 || x > n - 1 || y > n - 1) return null;
  const c0 = Math.min(n - 2, Math.floor(x)), r0 = Math.min(n - 2, Math.floor(y));
  const fx = x - c0, fy = y - r0, h = patch.heights;
  const top = h[r0 * n + c0] * (1 - fx) + h[r0 * n + c0 + 1] * fx;
  const bottom = h[(r0 + 1) * n + c0] * (1 - fx) + h[(r0 + 1) * n + c0 + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Lat/lon → local east/north km around the patch centre (same tangent-plane as the server). */
export function toLocal(patch, lat, lon) {
  const cos = Math.max(0.05, Math.cos(patch.lat * Math.PI / 180));
  const dLon = ((lon - patch.lon + 540) % 360) - 180;
  return { east: dLon * KM_PER_DEG * cos, north: (lat - patch.lat) * KM_PER_DEG };
}

const RAD = Math.PI / 180;

/**
 * Sun position for a latitude, solar declination and local mean solar time (Mars hours 0–24).
 * Returns elevation (deg above horizon) and azimuth (deg clockwise from north).
 */
export function sunPosition(latDeg, declinationDeg, lmstHours) {
  const phi = latDeg * RAD, dec = declinationDeg * RAD, h = (lmstHours - 12) * 15 * RAD;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const azimuth = Math.atan2(-Math.sin(h) * Math.cos(dec), Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(h));
  return { elevation: elevation / RAD, azimuth: ((azimuth / RAD) + 360) % 360 };
}

/** Unit vector toward the Sun in the viewer's world frame (x = east, y = up, z = south). */
export function sunVector(sun) {
  const el = sun.elevation * RAD, az = sun.azimuth * RAD;
  return { x: Math.cos(el) * Math.sin(az), y: Math.sin(el), z: -Math.cos(el) * Math.cos(az) };
}

/** Direct-beam irradiance on a horizontal surface (W/m²) through dust of optical depth tau. */
export function directIrradiance(topFluxWm2, elevationDeg, tau) {
  if (elevationDeg <= 0) return 0;
  const mu = Math.sin(elevationDeg * RAD);
  return topFluxWm2 * mu * Math.exp(-tau / Math.max(mu, 0.05));
}

/** Sky gradient for a sun elevation and dust load: butterscotch by day, blue around a low Sun, dark at night. */
export function skyColors(elevationDeg, tau) {
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
  const hex = c => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  const dusty = Math.min(1, tau / 4);
  const day = { top: mix([186, 140, 102], [150, 108, 78], dusty), horizon: mix([222, 186, 146], [176, 128, 90], dusty) };
  const dusk = { top: [52, 62, 96], horizon: [126, 160, 206] };                 // Martian blue sunset glow
  const night = { top: [6, 9, 18], horizon: [16, 22, 38] };
  let top, horizon;
  if (elevationDeg >= 20) ({ top, horizon } = day);
  else if (elevationDeg >= 0) { const t = Math.pow(elevationDeg / 20, 1.5); top = mix(dusk.top, day.top, t); horizon = mix(dusk.horizon, day.horizon, t); }
  else { const t = Math.min(1, -elevationDeg / 12); top = mix(dusk.top, night.top, t); horizon = mix(dusk.horizon, night.horizon, t); }
  return { top: hex(top), horizon: hex(horizon) };
}

export const DUST_LEVELS = [
  { id: 'clear', label: 'Clear', tau: 0.3 },
  { id: 'typical', label: 'Typical', tau: 0.6 },
  { id: 'hazy', label: 'Hazy', tau: 1.5 },
  { id: 'storm', label: 'Dust storm', tau: 4 },
];

/** Default dust level from the season and the latest REMS opacity word. */
export function defaultDust(dustStormSeason, opacity) {
  if (opacity && /dust|storm/i.test(opacity)) return 'hazy';
  return dustStormSeason ? 'hazy' : 'typical';
}

export function formatLmst(hours) {
  const total = Math.round(((hours % 24) + 24) % 24 * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
