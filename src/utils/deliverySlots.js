/**
 * Delivery slot rules (IST):
 * - Before 12:00 → Afternoon slot, delivery 2 PM – 4 PM (same day)
 * - 12:00–20:59 → Evening slot, delivery 7 PM – 9 PM (same day)
 * - From 21:00 → next-day Afternoon (2 PM – 4 PM) with notice
 */

const SLOT_LABELS = {
  Afternoon: '2 PM – 3 PM',
  Evening: '7 PM – 9 PM',
};

function getIstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: get('weekday'),
  };
}

function formatDeliveryDate(ist) {
  const d = new Date(Date.UTC(ist.year, ist.month - 1, ist.day, 6, 0, 0));
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function addDaysIst(ist, days) {
  const base = new Date(Date.UTC(ist.year, ist.month - 1, ist.day + days, 6, 0, 0));
  return getIstParts(base);
}

function resolveDeliverySlot(now = new Date()) {
  const ist = getIstParts(now);
  let slot;
  let deliveryIst = ist;
  let notice;

  if (ist.hour < 12) {
    slot = 'Afternoon';
    notice = `Order now for same-day delivery between ${SLOT_LABELS.Afternoon}. Cutoff is 12:00 PM.`;
  } else if (ist.hour < 21) {
    slot = 'Evening';
    notice = `Orders after 12:00 PM deliver same day between ${SLOT_LABELS.Evening}.`;
  } else {
    slot = 'Afternoon';
    deliveryIst = addDaysIst(ist, 1);
    notice = `Orders after 9:00 PM are scheduled for next-day delivery between ${SLOT_LABELS.Afternoon}.`;
  }

  return {
    slot,
    windowLabel: SLOT_LABELS[slot],
    deliveryDateLabel: formatDeliveryDate(deliveryIst),
    isNextDay: ist.hour >= 21,
    orderingOpen: true,
    notice,
    cutoffHint:
      ist.hour < 12
        ? 'Place before 12:00 PM for the 2–3 PM slot.'
        : ist.hour < 21
          ? 'Current orders go in the 7–9 PM slot.'
          : 'Next available slot is tomorrow 2–3 PM.',
  };
}

module.exports = {
  SLOT_LABELS,
  resolveDeliverySlot,
  getIstParts,
};
