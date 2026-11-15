
// ГЕОМЕТРИЯ: координаты, дуги, расстояния (чистые функции)

import * as THREE from 'three';

// Latitude/долгота → точка на сфере (3D)
export function latLonToVector3(lat, lon, r = 1.018) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);

  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

// Точка на сфере → широта/долгота (обратное преобразование)
export function vector3ToLatLon(vector) {
  const n = vector.clone().normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(n.y));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(n.z, -n.x)) - 180;

  return { lat, lon: ((lon + 540) % 360) - 180 };
}

// Latitude/долгота → точка на плоской карте (2D): x ∈ [−2, 2], y ∈ [−1, 1]
export function latLonToPlane(lat, lon, z = 0.000002) {
  return new THREE.Vector3((lon / 180) * 2, lat / 90, z);
}

export function greatCircleDistance(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;

  const a1 = lat1 * rad;
  const a2 = lat2 * rad;

  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;

  const a = Math.min(1,Math.max(0,Math.sin(dLat / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(dLon / 2) ** 2));

  // Средний радиус Marsа: 3389.5 km

  return 3389.5 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Great-circle distance: возвращает массив единичных векторов
export function greatCircleArc(start, target, steps = 100) {
  const a = latLonToVector3(start.lat, start.lon, 1).normalize();
  const b = latLonToVector3(target.lat, target.lon, 1).normalize();
  const angle = a.angleTo(b);

  if (angle < 1e-8) return [a, b];
  if (Math.PI-angle < 1e-6) {
    // Antipodes have infinitely many shortest paths; choose one deterministic plane.
    const axis=new THREE.Vector3().crossVectors(a,Math.abs(a.y)<0.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize();
    return Array.from({length:steps+1},(_,i)=>a.clone().applyAxisAngle(axis,Math.PI*i/steps));
  }

  const points = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(
      a
        .clone()
        .multiplyScalar(Math.sin((1 - t) * angle))
        .add(b.clone().multiplyScalar(Math.sin(t * angle)))
        .normalize()
    );
  }

  return points;
}