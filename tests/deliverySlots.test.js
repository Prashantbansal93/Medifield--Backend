const { resolveDeliverySlot } = require('../src/utils/deliverySlots');

describe('resolveDeliverySlot', () => {
  test('before noon → Afternoon 2–4 PM same day', () => {
    // 2026-07-14 10:30 IST = 2026-07-14 05:00 UTC
    const result = resolveDeliverySlot(new Date('2026-07-14T05:00:00.000Z'));
    expect(result.slot).toBe('Afternoon');
    expect(result.windowLabel).toBe('2 PM – 3 PM');
    expect(result.isNextDay).toBe(false);
  });

  test('after noon → Evening 7–9 PM same day', () => {
    // 2026-07-14 15:00 IST = 2026-07-14 09:30 UTC
    const result = resolveDeliverySlot(new Date('2026-07-14T09:30:00.000Z'));
    expect(result.slot).toBe('Evening');
    expect(result.windowLabel).toBe('7 PM – 9 PM');
    expect(result.isNextDay).toBe(false);
  });

  test('after 9 PM → next-day Afternoon', () => {
    // 2026-07-14 21:30 IST = 2026-07-14 16:00 UTC
    const result = resolveDeliverySlot(new Date('2026-07-14T16:00:00.000Z'));
    expect(result.slot).toBe('Afternoon');
    expect(result.isNextDay).toBe(true);
    expect(result.notice).toMatch(/next-day/i);
  });
});
