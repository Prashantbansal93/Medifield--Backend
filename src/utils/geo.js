const EARTH_RADIUS_KM = 6371;
const DEFAULT_SPEED_KMH = 25;
const ETA_BUFFER_MINUTES = 3;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasValidCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function computeEtaMinutes(distanceKm, speedKmh = DEFAULT_SPEED_KMH, bufferMinutes = ETA_BUFFER_MINUTES) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return null;
  const travelMinutes = (distanceKm / speedKmh) * 60;
  return Math.max(1, Math.round(travelMinutes + bufferMinutes));
}

function computeDeliveryEta(tracking) {
  if (!tracking) return null;
  const { currentLat, currentLng, retailerLat, retailerLng } = tracking;
  if (!hasValidCoords(currentLat, currentLng) || !hasValidCoords(retailerLat, retailerLng)) {
    return null;
  }
  const distanceKm = haversineKm(currentLat, currentLng, retailerLat, retailerLng);
  const etaMinutes = computeEtaMinutes(distanceKm);
  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    etaMinutes,
    etaLabel: etaMinutes ? `ETA ${etaMinutes} min` : null,
  };
}

module.exports = {
  EARTH_RADIUS_KM,
  DEFAULT_SPEED_KMH,
  ETA_BUFFER_MINUTES,
  haversineKm,
  hasValidCoords,
  computeEtaMinutes,
  computeDeliveryEta,
};
