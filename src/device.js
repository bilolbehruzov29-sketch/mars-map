// Rendering quality chosen once from the device's capabilities.
// Phones, tablets, low-memory laptops and data-saver mode get a lighter profile.
export function detectQuality(env = globalThis) {
  const nav = env.navigator || {};
  const memory = nav.deviceMemory || 8;              // GB (Chromium only; others → assume enough)
  const cores = nav.hardwareConcurrency || 8;
  const saveData = Boolean(nav.connection?.saveData);
  const coarse = Boolean(env.matchMedia?.('(pointer: coarse)').matches);
  const shortSide = Math.min(env.screen?.width || 1920, env.screen?.height || 1080);
  const dpr = env.devicePixelRatio || 1;
  const reducedMotion = Boolean(env.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const low = saveData || memory <= 4 || cores <= 4 || (coarse && shortSide < 820);
  return {
    low,
    reducedMotion,
    // A 3× phone screen at 1.5× still looks sharp but renders 4× fewer pixels.
    pixelRatio: Math.min(dpr, low ? 1.5 : 2),
    // MSAA is wasted work on dense screens; keep it for 1× desktop displays.
    antialias: !low && dpr < 2,
    sphereSegments: low ? [192, 96] : [384, 192],
    tileZoom: low ? 2 : 3,                // 2048×1024 vs 4096×2048 base texture
    tileConcurrency: low ? 4 : 8,
    idleRenderMs: low ? 1000 : 500        // safety redraw while nothing moves
  };
}
