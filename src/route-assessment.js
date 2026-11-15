import { greatCircleDistance } from './geo.js';
// A local station observation cannot certify an entire traversal. No synthetic hazards.
export function assessRoute(start, target, weather, now = new Date()) {
  const distance = greatCircleDistance(start.lat,start.lon,target.lat,target.lon);
  const reasons = ['No numerical obstacle, soil-bearing, or slope model is available along this line.'];
  let weatherRelevant = false;
  if (!weather) reasons.push('NASA weather observations are unavailable.');
  else {
    const age = (now - new Date(`${weather.date}T00:00:00Z`))/86400000;
    const range = Math.max(greatCircleDistance(start.lat,start.lon,weather.lat,weather.lon),greatCircleDistance(target.lat,target.lon,weather.lat,weather.lon));
    weatherRelevant = age >= 0 && age <= 2 && range <= 10 && distance <= 10;
    if (age > 2 || age < 0) reasons.push(`Observations from ${weather.date} are not current route weather.`);
    if (range > 10 || distance > 10) reasons.push('The line extends beyond the local REMS area (10 km proximity check, not guaranteed coverage).');
    if (weather.wind == null) reasons.push('Wind measurements are missing; dust hazards cannot be assessed.');
    reasons.push('Local observations are not a weather forecast along the route.');
  }
  return {distance, weatherRelevant, safe: false, status: 'Safety unverified', reasons};
}
