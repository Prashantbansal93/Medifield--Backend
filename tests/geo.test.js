const {
  haversineKm,
  hasValidCoords,
  computeEtaMinutes,
  computeDeliveryEta,
} = require('../src/utils/geo');

describe('geo utilities', () => {
  test('haversineKm returns 0 for same point', () => {
    expect(haversineKm(26.91, 75.78, 26.91, 75.78)).toBeCloseTo(0, 5);
  });

  test('haversineKm computes known distance approximately', () => {
    const km = haversineKm(28.6139, 77.209, 19.076, 72.8777);
    expect(km).toBeGreaterThan(1100);
    expect(km).toBeLessThan(1300);
  });

  test('hasValidCoords rejects invalid values', () => {
    expect(hasValidCoords(91, 0)).toBe(false);
    expect(hasValidCoords(26.9, 200)).toBe(false);
    expect(hasValidCoords(26.9, 75.7)).toBe(true);
  });

  test('computeEtaMinutes includes buffer', () => {
    expect(computeEtaMinutes(0)).toBe(3);
    expect(computeEtaMinutes(5)).toBeGreaterThan(10);
  });

  test('computeDeliveryEta decreases as rider approaches destination', () => {
    const tracking = {
      currentLat: 26.92,
      currentLng: 75.79,
      retailerLat: 26.915,
      retailerLng: 75.81,
    };
    const far = computeDeliveryEta(tracking);
    const near = computeDeliveryEta({
      ...tracking,
      currentLat: 26.916,
      currentLng: 75.805,
    });
    expect(near.etaMinutes).toBeLessThanOrEqual(far.etaMinutes);
    expect(near.distanceKm).toBeLessThan(far.distanceKm);
  });

  test('computeDeliveryEta returns null without coordinates', () => {
    expect(computeDeliveryEta({})).toBeNull();
  });
});
