// Navigator: a simple "From → To" card docked at the bottom of the map.
// Keys on the map page (not while typing): A = From at cursor, B = To at cursor,
// S = swap, Enter = route again, N = open/close, Esc = stop picking / close.

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const coords = p => `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? 'E' : 'W'}`;
const day = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const span = (r, unit) => Math.round(r.min) === Math.round(r.max) ? `${fmt(r.min)} ${unit}` : `${fmt(r.min)}–${fmt(r.max)} ${unit}`;

export function isTyping(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

export function initNavigator({ bases, getCursor, onPickRequest, onPoints, onRoute, onDetails }) {
  const bar = document.querySelector('#navBar');
  const toggle = document.querySelector('#openNavigator');
  const stage = bar.closest('.map-stage');
  const points = { from: null, to: null };
  const LABEL = { from: 'From', to: 'To' };
  let picking = null;
  let busy = false;

  const baseOptions = `<optgroup label="Mission sites">${bases.filter(b => !b.candidate).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</optgroup>
    <optgroup label="Candidate base regions">${bases.filter(b => b.candidate).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</optgroup>`;
  const field = key => `
    <div class="nav-field ${key}" data-slot="${key}">
      <span class="nav-dot" aria-hidden="true"></span>
      <label class="nav-select">
        <span class="nav-field-label">${LABEL[key]}</span>
        <select aria-label="${LABEL[key]}"><option value="">Choose a place…</option>${baseOptions}</select>
      </label>
      <button type="button" class="nav-pin" aria-label="${LABEL[key]}: pick a point on the map" title="Pick on the map">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>
      </button>
    </div>`;

  bar.innerHTML = `
    <div class="nav-card">
      <div class="nav-points">
        ${field('from')}
        <span class="nav-line" aria-hidden="true"></span>
        ${field('to')}
        <button type="button" class="nav-swap" aria-label="Swap From and To" title="Swap (S)">⇅</button>
      </div>
      <div class="nav-panel" aria-live="polite"></div>
      <button type="button" class="nav-close" aria-label="Close navigator" title="Close (Esc)">×</button>
    </div>`;
  const panel = bar.querySelector('.nav-panel');

  const keyHint = '<p class="nav-keys">Tip: hover Mars and press <kbd>A</kbd> for From, <kbd>B</kbd> for To</p>';

  function showHint() {
    let text;
    if (picking) text = `Click on Mars to set <b>${LABEL[picking]}</b>`;
    else if (!points.from && !points.to) text = 'Choose where to start and where to go';
    else if (!points.from) text = 'Now choose <b>From</b>';
    else text = 'Now choose <b>To</b>';
    panel.className = 'nav-panel empty';
    panel.innerHTML = `<p class="nav-message">${text}</p>${keyHint}`;
  }

  function render(notify = true) {
    for (const key of ['from', 'to']) {
      const el = bar.querySelector(`[data-slot="${key}"]`);
      const p = points[key];
      const select = el.querySelector('select');
      select.options[0].textContent = p && !p.base ? `Point on map · ${coords(p)}` : 'Choose a place…';
      select.value = p?.base || '';
      el.classList.toggle('set', Boolean(p));
      el.classList.toggle('picking', picking === key);
      el.title = p ? coords(p) : '';
    }
    bar.querySelector('.nav-swap').disabled = !points.from && !points.to;
    if (notify) onPoints({ ...points });
  }

  function set(key, point) {
    points[key] = point;
    if (picking === key) stopPicking(false);
    render();
    if (points.from && points.to) route();
    else showHint();
  }

  function pointFrom(lat, lon) {
    return { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)), base: '', name: '' };
  }

  function setAtCursor(key) {
    const c = getCursor();
    if (c?.lat == null || c?.lon == null) return warn('Move the cursor over Mars first, then press the key.');
    if (Math.abs(c.lat) > 88) return warn('Pick a point between 88°S and 88°N.');
    set(key, pointFrom(c.lat, c.lon));
  }

  function startPicking(key) {
    picking = key;
    onPickRequest((lat, lon) => {
      if (Math.abs(lat) > 88) return warn('Pick a point between 88°S and 88°N.');
      set(key, pointFrom(lat, lon));
    });
    render(false);
    showHint();
  }

  function stopPicking(update = true) {
    if (!picking) return;
    picking = null;
    onPickRequest(null);
    if (update) { render(false); if (!busy && !(points.from && points.to)) showHint(); }
  }

  function warn(text) {
    panel.className = 'nav-panel empty';
    panel.innerHTML = `<p class="nav-message warn">${esc(text)}</p>${keyHint}`;
  }

  function route() {
    if (!points.from || !points.to) return showHint();
    if (Math.abs(points.from.lat - points.to.lat) < 1e-4 && Math.abs(points.from.lon - points.to.lon) < 1e-4) return warn('From and To are the same place.');
    busy = true;
    panel.className = 'nav-panel loading';
    panel.innerHTML = '<p class="nav-message"><i class="nav-spin"></i>Finding a route around steep terrain…</p>';
    const name = (p, fallback) => p.name || `${fallback} (${coords(p)})`;
    onRoute([{ ...points.from, name: name(points.from, 'Start') }, { ...points.to, name: name(points.to, 'Destination') }]);
  }

  function open() {
    bar.hidden = false;
    stage?.classList.add('nav-open');
    toggle.classList.add('active');
    toggle.setAttribute('aria-expanded', 'true');
    if (!busy && !(points.from && points.to)) showHint();
    if (window.matchMedia('(max-width: 850px)').matches) bar.scrollIntoView({ block: 'end', behavior: 'smooth' });
    else bar.querySelector('select').focus({ preventScroll: true });
  }

  function close() {
    stopPicking(false);
    bar.hidden = true;
    stage?.classList.remove('nav-open');
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function clear() {
    stopPicking(false);
    points.from = points.to = null;
    busy = false;
    render();
    showHint();
  }

  toggle.addEventListener('click', () => (bar.hidden ? open() : close()));
  bar.querySelector('.nav-close').addEventListener('click', close);
  bar.querySelector('.nav-swap').addEventListener('click', () => {
    [points.from, points.to] = [points.to, points.from];
    render();
    if (points.from && points.to) route(); else showHint();
  });
  for (const key of ['from', 'to']) {
    const el = bar.querySelector(`[data-slot="${key}"]`);
    el.querySelector('select').addEventListener('change', event => {
      const base = bases.find(b => b.id === event.target.value);
      if (base) set(key, { lat: base.lat, lon: base.lon, base: base.id, name: base.name });
      else { points[key] = null; render(); showHint(); }
    });
    el.querySelector('.nav-pin').addEventListener('click', () => (picking === key ? stopPicking() : startPicking(key)));
  }

  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
    if (!document.querySelector('#mapPage')?.classList.contains('active')) return;
    const key = event.key.toLowerCase();
    if (key === 'n') { event.preventDefault(); bar.hidden ? open() : close(); return; }
    if (bar.hidden) return;
    if (key === 'a') { event.preventDefault(); setAtCursor('from'); }
    else if (key === 'b') { event.preventDefault(); setAtCursor('to'); }
    else if (key === 's') { event.preventDefault(); bar.querySelector('.nav-swap').click(); }
    else if (key === 'enter' && !event.target.closest?.('button')) { event.preventDefault(); route(); }
    else if (key === 'escape') { event.preventDefault(); picking ? stopPicking() : close(); }
  });

  render(false);
  showHint();
  return {
    open, close,
    get isOpen() { return !bar.hidden; },
    showPlan(plan) {
      busy = false;
      render(false); // keep the drawn route; only refresh the controls
      const t = plan.totals;
      const leg = plan.legs[0];
      const extra = t.distanceKm - t.directKm;
      const warning = plan.warnings[0];
      panel.className = 'nav-panel result';
      panel.innerHTML = `
        <div class="nav-stats">
          <div><span>Distance</span><b>${fmt(t.distanceKm, t.distanceKm < 100 ? 1 : 0)} km</b><small>${extra > 0.5 ? `+${fmt(extra)} km detour` : 'almost straight'}</small></div>
          <div><span>Travel time</span><b>${fmt(t.totalSols, t.totalSols < 10 ? 1 : 0)} sols</b><small>${fmt(t.earthDays)} Earth days</small></div>
          <div><span>Arrival</span><b>${esc(day(t.arrival.date))}</b><small>${esc(t.arrival.date.slice(0, 4))} · daylight ${span(leg.conditions.daylightH, 'h')}</small></div>
        </div>
        ${warning ? `<p class="nav-alert">⚠ ${esc(warning)}</p>` : `<p class="nav-ok">✓ Max slope ${t.maxSlopeDeg}° — no seasonal warnings</p>`}
        <div class="nav-actions">
          <button type="button" class="nav-details">Route details →</button>
          <button type="button" class="nav-clear">New route</button>
        </div>`;
      panel.querySelector('.nav-details').addEventListener('click', onDetails);
      panel.querySelector('.nav-clear').addEventListener('click', clear);
    },
    showError(text) {
      busy = false;
      render(false);
      warn(text);
    }
  };
}
