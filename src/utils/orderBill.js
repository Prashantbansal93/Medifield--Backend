function buildOrderTimeline(order) {
  const stages = [
    { stage: 'ORDER_PLACED', label: 'Order placed', at: order.createdAt },
    { stage: 'ACCEPTED', label: 'Accepted by wholesaler', at: order.acceptedAt },
    { stage: 'PACKED', label: 'Packed for pickup', at: order.packedAt },
    { stage: 'PICKED', label: 'Picked up by delivery partner', at: order.pickedAt },
    { stage: 'OUT_FOR_DELIVERY', label: 'Out for delivery', at: order.pickedAt },
    { stage: 'DELIVERED', label: 'Delivered', at: order.deliveredAt },
  ];

  return stages
    .filter((s) => s.at)
    .map((s) => ({
      stage: s.stage,
      label: s.label,
      at: s.at,
    }));
}

function formatBillItem(item) {
  const price = Number(item.price) || 0;
  const quantity = Number(item.quantity) || 0;
  return {
    medicineId: item.medicine?._id || item.medicine,
    name: item.medicineName || item.medicine?.name || 'Medicine',
    company: item.medicine?.company || '',
    quantity,
    unitPrice: price,
    lineTotal: price * quantity,
  };
}

function formatOrderBill(order) {
  const items = (order.items || []).map(formatBillItem);
  const orderedAt = order.createdAt;
  const deliveredAt = order.deliveredAt || null;
  const deliveryTimeMinutes =
    deliveredAt && orderedAt
      ? Math.max(0, Math.round((new Date(deliveredAt) - new Date(orderedAt)) / 60000))
      : null;

  return {
    orderId: order._id,
    billNumber: order.billNumber || null,
    status: order.status,
    slot: order.slot,
    slotWindowLabel: order.slotWindowLabel || null,
    deliveryDateLabel: order.deliveryDateLabel || null,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    items,
    totalAmount: order.totalAmount,
    orderedAt,
    acceptedAt: order.acceptedAt || null,
    packedAt: order.packedAt || null,
    pickedAt: order.pickedAt || null,
    deliveredAt,
    cancelledAt: order.cancelledAt || null,
    cancelRequest: order.cancelRequest || null,
    offlineChallanImageUrl: order.offlineChallanImageUrl || null,
    deliveryTimeMinutes,
    deliveryTimeLabel: deliveryTimeMinutes != null ? `${deliveryTimeMinutes} min` : null,
    timeline: buildOrderTimeline(order),
    deliveryPartner: order.deliveryPartner
      ? { name: order.deliveryPartner.name, phone: order.deliveryPartner.phone }
      : null,
  };
}

module.exports = { formatOrderBill, buildOrderTimeline };
