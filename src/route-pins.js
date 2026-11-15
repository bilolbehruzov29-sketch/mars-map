import { latLonToVector3, latLonToPlane } from './geo.js';

// Labelled HTML pins (A, B, 1, 2, …) for route stops, projected onto the map every frame.
export function createRoutePins({ root, camera, getMode }) {
  let pins = [];
  return {
    set(list) {
      root.replaceChildren();
      pins = list.map(pin => {
        const el = document.createElement('span');
        el.className = `route-pin ${pin.kind || 'stop'}`;
        el.textContent = pin.label;
        if (pin.title) el.title = pin.title;
        root.append(el);
        return { ...pin, el };
      });
    },
    update() {
      const width = root.clientWidth, height = root.clientHeight, mode = getMode();
      for (const pin of pins) {
        const p = mode === '3d' ? latLonToVector3(pin.lat, pin.lon, 1.000002) : latLonToPlane(pin.lat, pin.lon, 0.000002);
        const front = mode !== '3d' || p.clone().normalize().dot(camera.position.clone().sub(p)) > 0;
        const ndc = p.clone().project(camera);
        const hidden = !front || ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05;
        pin.el.hidden = hidden;
        if (!hidden) pin.el.style.transform = `translate(${(ndc.x + 1) * width / 2}px,${(1 - ndc.y) * height / 2}px) translate(-50%,calc(-100% - 7px))`;
      }
    }
  };
}
