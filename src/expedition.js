// Expedition planner: base → stops → base, routed around steep terrain by the Python server,
// with a sol-by-sol timeline, computed road conditions and an elevation profile.

export const LEG_COLORS = [0xff7a45, 0x4cc9f0, 0xffd166, 0xb388ff, 0x06d6a0, 0xff8fab, 0x90e0ef, 0xf4a261, 0xa3b8ff, 0xc7f464];
const MAX_STOPS = 10;
const hex = n => `#${n.toString(16).padStart(6, '0')}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, digits = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const km = v => `${num(v, v < 100 ? 1 : 0)} km`;
const m = v => `${num(v)} m`;
const range = (r, unit, digits = 0) => r.min === r.max ? `${num(r.min, digits)}${unit}` : `${num(r.min, digits)}–${num(r.max, digits)}${unit}`;
const normLon = lon => ((Number(lon) + 540) % 360) - 180;

export function encodePlan(state) {
  const json = JSON.stringify(state);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePlan(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(data.stops) || data.stops.length < 2 || data.stops.length > MAX_STOPS) throw new Error('Invalid plan');
  data.stops = data.stops.map(s => ({ base: typeof s.base === 'string' ? s.base : '', name: String(s.name || '').slice(0, 60), lat: Number(s.lat), lon: Number(s.lon) }))
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Math.abs(s.lat) <= 90);
  if (data.stops.length < 2) throw new Error('Invalid plan');
  return data;
}

export function profileSvg(profile, legs, width = 340, height = 150) {
  if (!profile?.length) return '';
  const pad = { l: 42, r: 8, t: 10, b: 22 };
  const maxKm = profile.at(-1).km || 1;
  let lo = Math.min(...profile.map(p => p.elevationM)), hi = Math.max(...profile.map(p => p.elevationM));
  if (hi - lo < 200) { lo -= 100; hi += 100; }
  const x = k => pad.l + (k / maxKm) * (width - pad.l - pad.r);
  const y = e => pad.t + (1 - (e - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const paths = legs.map((leg, i) => {
    const pts = profile.filter(p => p.leg === i);
    if (!pts.length) return '';
    const line = pts.map((p, j) => `${j ? 'L' : 'M'}${x(p.km).toFixed(1)},${y(p.elevationM).toFixed(1)}`).join('');
    const area = `${line}L${x(pts.at(-1).km).toFixed(1)},${height - pad.b}L${x(pts[0].km).toFixed(1)},${height - pad.b}Z`;
    const color = leg.blocked ? '#ff4d6d' : hex(LEG_COLORS[i % LEG_COLORS.length]);
    return `<path d="${area}" fill="${color}" opacity=".12"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.6"/>`;
  }).join('');
  let edge = 0;
  const marks = legs.slice(0, -1).map(leg => { edge += leg.distanceKm; return `<line x1="${x(edge)}" x2="${x(edge)}" y1="${pad.t}" y2="${height - pad.b}" stroke="#555" stroke-dasharray="3 3"/>`; }).join('');
  const ticks = [lo, (lo + hi) / 2, hi].map(v => `<text x="${pad.l - 5}" y="${y(v) + 3}" text-anchor="end">${num(v / 1000, 1)} km</text>`).join('');
  return `<svg class="profile-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Elevation profile from ${num(lo)} to ${num(hi)} metres over ${num(maxKm)} kilometres">
    <rect x="${pad.l}" y="${pad.t}" width="${width - pad.l - pad.r}" height="${height - pad.t - pad.b}" fill="#0c1222"/>
    ${marks}${paths}${ticks}
    <text x="${pad.l}" y="${height - 6}">0</text><text x="${width - pad.r}" y="${height - 6}" text-anchor="end">${num(maxKm)} km</text>
    <line class="profile-cursor" x1="0" x2="0" y1="${pad.t}" y2="${height - pad.b}" stroke="#fff" opacity="0"/>
  </svg><div class="profile-readout" aria-live="polite"></div>`;
}

export function initExpedition({ missions, onPlan, onPickMode, onError = () => {} }) {
  const form = document.querySelector('#expeditionForm');
  const list = document.querySelector('#stopList');
  const result = document.querySelector('#routeResult');
  const pickButton = document.querySelector('#pickOnMap');
  const bases = Object.entries(missions).filter(([id]) => id !== 'overview')
    .map(([id, mission]) => ({ id, name: mission.name, lat: mission.lat, lon: normLon(mission.lon), candidate: Boolean(mission.candidate) }));
  const byId = Object.fromEntries(bases.map(b => [b.id, b]));
  let stops = [];
  let picking = false;
  let request = 0;
  let lastPlan = null;

  document.querySelector('#departure').value = new Date().toISOString().slice(0, 10);

  const baseOptions = selected => `<option value="">Custom point</option>
    <optgroup label="Mission sites">${bases.filter(b => !b.candidate).map(b => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</optgroup>
    <optgroup label="Candidate base regions">${bases.filter(b => b.candidate).map(b => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</optgroup>`;

  function renderStops() {
    list.innerHTML = stops.map((s, i) => `
      <li class="stop-row" data-index="${i}">
        <span class="stop-dot" style="background:${i === 0 ? '#4cc9f0' : i === stops.length - 1 ? '#ffb547' : '#ffe08a'}">${i + 1}</span>
        <div class="stop-fields">
          <select aria-label="Stop ${i + 1} base">${baseOptions(s.base)}</select>
          <div class="input-pair"><input aria-label="Stop ${i + 1} latitude" type="number" min="-88" max="88" step="any" value="${+Number(s.lat).toFixed(4)}" data-field="lat"><input aria-label="Stop ${i + 1} longitude" type="number" min="-180" max="180" step="any" value="${+Number(s.lon).toFixed(4)}" data-field="lon"></div>
        </div>
        <div class="stop-actions">
          <button type="button" data-move="-1" aria-label="Move stop ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-move="1" aria-label="Move stop ${i + 1} down" ${i === stops.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-remove aria-label="Remove stop ${i + 1}" ${stops.length <= 2 ? 'disabled' : ''}>×</button>
        </div>
      </li>`).join('');
    document.querySelector('#addStop').disabled = stops.length >= MAX_STOPS;
    list.querySelectorAll('.stop-row').forEach(row => {
      const i = Number(row.dataset.index);
      row.querySelector('select').addEventListener('change', event => {
        const base = byId[event.target.value];
        stops[i] = base ? { base: base.id, name: base.name, lat: base.lat, lon: base.lon } : { ...stops[i], base: '', name: '' };
        renderStops();
      });
      row.querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
        stops[i] = { ...stops[i], base: '', name: '', [input.dataset.field]: Number(input.value) };
        row.querySelector('select').value = '';
      }));
      row.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => {
        const j = i + Number(button.dataset.move);
        [stops[i], stops[j]] = [stops[j], stops[i]];
        renderStops();
      }));
      row.querySelector('[data-remove]').addEventListener('click', () => { stops.splice(i, 1); renderStops(); });
    });
  }

  function addStop(stop) {
    if (stops.length >= MAX_STOPS) return false;
    stops.push(stop);
    renderStops();
    list.lastElementChild?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function setPicking(on) {
    picking = on;
    pickButton.classList.toggle('active', on);
    pickButton.textContent = on ? 'Click the map… (Esc to stop)' : 'Pick on map';
    onPickMode(on);
  }

  document.querySelector('#addStop').addEventListener('click', () => {
    const last = stops.at(-1);
    addStop({ base: '', name: '', lat: Number((last?.lat ?? 0).toFixed(2)), lon: Number(normLon((last?.lon ?? 0) + 5).toFixed(2)) });
  });
  pickButton.addEventListener('click', () => setPicking(!picking));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && picking) setPicking(false); });

  function readState() {
    return {
      stops: stops.map(s => ({ base: s.base, name: s.name, lat: s.lat, lon: s.lon })),
      roundTrip: form.roundTrip.checked, vehicle: form.vehicle.value, maxSlopeDeg: Number(form.maxSlope.value),
      departure: form.departure.value, stopSols: Number(form.stopSols.value)
    };
  }

  function applyState(state) {
    stops = state.stops.map(s => ({ ...s, lon: normLon(s.lon) }));
    if (typeof state.roundTrip === 'boolean') form.roundTrip.checked = state.roundTrip;
    if (state.vehicle && form.vehicle.querySelector(`option[value="${state.vehicle}"]`)) form.vehicle.value = state.vehicle;
    if (Number.isFinite(state.maxSlopeDeg)) form.maxSlope.value = state.maxSlopeDeg;
    if (/^\d{4}-\d{2}-\d{2}$/.test(state.departure || '')) form.departure.value = state.departure;
    if (Number.isFinite(state.stopSols)) form.stopSols.value = state.stopSols;
    renderStops();
  }

  function validate(state) {
    if (state.stops.length < 2) return 'Add at least two stops.';
    for (const [i, s] of state.stops.entries()) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon) || Math.abs(s.lat) > 88 || Math.abs(s.lon) > 180) return `Stop ${i + 1}: latitude −88…88°, longitude −180…180°.`;
    }
    if (!(state.maxSlopeDeg >= 2 && state.maxSlopeDeg <= 30)) return 'Max slope must be 2–30°.';
    if (!(state.stopSols >= 0 && state.stopSols <= 60)) return 'Stay at stops must be 0–60 sols.';
    return '';
  }

  function stopName(s, i) { return s.name || `Point ${i + 1} (${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}°)`; }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (picking) setPicking(false);
    const state = readState();
    const problem = validate(state);
    if (problem) { result.innerHTML = `<span class="route-warn">${esc(problem)}</span>`; onError(problem); return; }
    const id = ++request;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    result.innerHTML = '<div class="planning"><i></i>Routing every leg around steep terrain…</div>';
    try {
      const response = await fetch('/api/expeditions/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ stops: state.stops.map((s, i) => ({ name: stopName(s, i), lat: s.lat, lon: s.lon })),
          roundTrip: state.roundTrip, vehicle: state.vehicle, maxSlopeDeg: state.maxSlopeDeg, departure: state.departure || null, stopSols: state.stopSols })
      });
      const plan = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(plan.error || (response.status === 404 ? 'The Mars Map server is not reachable from this address (/api not found). Static hosts such as Netlify must forward /api/* to the Python server — see netlify.toml.' : `Planner HTTP ${response.status}`));
      if (id !== request) return;
      lastPlan = plan;
      history.replaceState(history.state, '', `${location.pathname}?expedition=${encodePlan(state)}${location.hash}`);
      result.innerHTML = renderPlan(plan);
      wireResult(plan);
      onPlan(plan);
    } catch (error) {
      if (id !== request) return;
      const text = error.name === 'TimeoutError' ? 'The planner took too long. Try fewer or closer stops.' : error.message;
      result.innerHTML = `<span class="route-warn">${esc(text)}</span>`;
      onError(text);
    } finally {
      if (id === request) submit.disabled = false;
    }
  });

  function renderPlan(plan) {
    const t = plan.totals;
    const station = plan.station;
    const legs = plan.legs.map((leg, i) => {
      const c = leg.conditions;
      const ls = Array.isArray(c.ls) ? (c.ls[1] - c.ls[0] >= 359 ? 'all seasons' : `Ls ${c.ls[0]}–${c.ls[1]}°`) : `Ls ${c.ls}°`;
      return `<details class="leg-card" ${i === 0 ? 'open' : ''}>
        <summary><span class="leg-swatch" style="background:${leg.blocked ? '#ff4d6d' : hex(LEG_COLORS[i % LEG_COLORS.length])}"></span>
          <b>${i + 1}. ${esc(leg.from)} → ${esc(leg.to)}</b><span>${km(leg.distanceKm)} · ${num(leg.sols, 1)} sols</span></summary>
        <dl>
          <dt>Path</dt><dd>${km(leg.distanceKm)}${leg.extraKm > 0.5 ? ` (+${km(leg.extraKm)} detour vs straight line)` : ' (≈ straight line)'}${leg.blocked ? `<br><span class="route-warn">${esc(leg.blockedReason || 'No path within the slope limit.')}</span>` : ''}</dd>
          <dt>Terrain</dt><dd>max slope ${leg.maxSlopeDeg}° · climb ${m(leg.ascentM)} · descent ${m(leg.descentM)}<br>elevation ${m(leg.minElevationM)} … ${m(leg.maxElevationM)}${leg.steepSegmentsOnDirect ? `<br>straight line would cross ${leg.steepSegmentsOnDirect} too-steep step(s)` : ''}</dd>
          <dt>Time</dt><dd>${leg.start.date} → ${leg.end.date} · ${num(leg.sols, 1)} sols<br>${num(leg.kmPerSol, 2)} km/sol${leg.driveHoursPerSol != null ? ` · ${num(leg.driveHoursPerSol, 1)} h driving/sol` : ''}</dd>
          <dt>Road conditions</dt><dd>${ls} · ${c.seasons.join(', ')}<br>daylight ${range(c.daylightH, ' h', 1)} · noon Sun ${range(c.noonSunDeg, '°')}<br>sunlight (top of atmosphere) ${range(c.insolationWm2, ' W/m²')}<br>air pressure ≈ ${range(c.pressurePa, ' Pa')}</dd>
        </dl>
        ${c.warnings.length ? `<ul class="leg-warnings">${c.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="leg-ok">No seasonal or terrain flags on this leg.</p>'}
      </details>`;
    }).join('');
    return `
      <div class="exp-summary">
        <div><span>Distance</span><b>${km(t.distanceKm)}</b><small>straight ${km(t.directKm)}</small></div>
        <div><span>Duration</span><b>${num(t.totalSols, 1)} sols</b><small>${num(t.earthDays, 0)} Earth days</small></div>
        <div><span>Arrival</span><b>${esc(t.arrival.date)}</b><small>Ls ${t.arrival.ls}°</small></div>
        <div><span>Climb</span><b>${m(t.ascentM)}</b><small>max slope ${t.maxSlopeDeg}°</small></div>
      </div>
      <p class="exp-vehicle"><b>${esc(plan.vehicle.name)}</b> · ${esc(plan.vehicle.note)}<br>Driving ${num(t.drivingSols, 1)} sols + ${num(t.stopSols, 1)} sols at stops. Departure ${esc(plan.departure.date)} (Ls ${plan.departure.ls}°).</p>
      ${plan.warnings.length ? `<ul class="exp-warnings">${plan.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <h3 class="exp-heading">Elevation profile</h3>
      <div class="profile-wrap">${profileSvg(plan.profile, plan.legs)}</div>
      <h3 class="exp-heading">Legs</h3>
      ${legs}
      <h3 class="exp-heading">Weather reference</h3>
      <p class="exp-station">${station ? `${esc(station.name)} · sol ${esc(station.sol)} · ${esc(station.date)}${station.ageDays > 2 ? ` (${station.ageDays} days old)` : ''}<br>
        air ${station.minTempC ?? '–'} … ${station.maxTempC ?? '–'} °C · ${station.pressurePa ?? '–'} Pa · ${esc(station.opacity || 'opacity n/a')} · UV ${esc(station.uv || 'n/a')}<br>` : 'Curiosity REMS observations are unavailable right now.<br>'}
        Pressure along the route is scaled from: ${esc(plan.pressureReference)}.</p>
      <div class="exp-actions"><button type="button" class="secondary-button" id="shareExpedition">Copy share link</button><span id="shareNote" role="status"></span></div>
      <p class="drawer-footnote"><b>${esc(plan.status)}.</b> ${plan.limitations.map(esc).join(' ')}</p>`;
  }

  function wireResult(plan) {
    document.querySelector('#shareExpedition')?.addEventListener('click', async () => {
      const note = document.querySelector('#shareNote');
      try { await navigator.clipboard.writeText(location.href); note.textContent = 'Link copied.'; }
      catch { note.textContent = location.href; }
    });
    const svg = result.querySelector('.profile-chart');
    if (!svg) return;
    const readout = result.querySelector('.profile-readout');
    const cursor = svg.querySelector('.profile-cursor');
    const maxKm = plan.profile.at(-1).km || 1;
    svg.addEventListener('pointermove', event => {
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const sx = (event.clientX - rect.left) / rect.width * vb.width;
      const kmAt = Math.max(0, Math.min(maxKm, (sx - 42) / (vb.width - 50) * maxKm));
      const point = plan.profile.reduce((best, p) => Math.abs(p.km - kmAt) < Math.abs(best.km - kmAt) ? p : best, plan.profile[0]);
      cursor.setAttribute('x1', sx); cursor.setAttribute('x2', sx); cursor.setAttribute('opacity', '.5');
      readout.textContent = `${num(point.km)} km · ${num(point.elevationM)} m · leg ${point.leg + 1}`;
    });
    svg.addEventListener('pointerleave', () => { cursor.setAttribute('opacity', '0'); readout.textContent = ''; });
  }

  // Start from a shared link, or a sensible default: Curiosity → InSight and back.
  let initial = null;
  const shared = new URLSearchParams(location.search).get('expedition');
  if (shared && /^[A-Za-z0-9_-]+$/.test(shared)) { try { initial = decodePlan(shared); } catch { initial = null; } }
  applyState(initial || { stops: ['curiosity', 'insight'].filter(id => byId[id]).map(id => ({ base: id, name: byId[id].name, lat: byId[id].lat, lon: byId[id].lon })), roundTrip: true });

  return {
    get picking() { return picking; },
    get plan() { return lastPlan; },
    autoPlan: Boolean(initial),
    submit() { form.requestSubmit(); },
    // Used by the navigator: replace the stops with A → B (one way) and plan with the current vehicle settings.
    route(points) {
      if (picking) setPicking(false);
      applyState({ stops: points.map(p => ({ base: p.base || '', name: p.name || '', lat: Number(p.lat.toFixed(4)), lon: Number(normLon(p.lon).toFixed(4)) })), roundTrip: false });
      form.requestSubmit();
    },
    bases,
    addPoint(lat, lon) {
      if (!addStop({ base: '', name: '', lat: Number(lat.toFixed(3)), lon: Number(normLon(lon).toFixed(3)) })) setPicking(false);
      if (stops.length >= MAX_STOPS) setPicking(false);
    },
    addBase(id) {
      const base = byId[id];
      if (base) addStop({ base: id, name: base.name, lat: base.lat, lon: base.lon });
    }
  };
}
