const { formatOrderBill } = require('../src/utils/orderBill');

describe('orderBill', () => {
  test('formatOrderBill generates bill with timeline and delivery time', () => {
    const order = {
      _id: '507f1f77bcf86cd799439099',
      billNumber: 'BILL-TEST1234',
      slot: 'Afternoon',
      totalAmount: 250,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      acceptedAt: new Date('2026-01-01T10:05:00Z'),
      packedAt: new Date('2026-01-01T10:20:00Z'),
      pickedAt: new Date('2026-01-01T10:35:00Z'),
      deliveredAt: new Date('2026-01-01T11:00:00Z'),
      items: [
        {
          medicineName: 'Paracetamol',
          quantity: 2,
          price: 50,
          medicine: { name: 'Paracetamol', company: 'ABC' },
        },
        {
          medicineName: 'Ibuprofen',
          quantity: 1,
          price: 150,
          medicine: { name: 'Ibuprofen', company: 'XYZ' },
        },
      ],
    };

    const bill = formatOrderBill(order);
    expect(bill.billNumber).toBe('BILL-TEST1234');
    expect(bill.totalAmount).toBe(250);
    expect(bill.items).toHaveLength(2);
    expect(bill.items[0].lineTotal).toBe(100);
    expect(bill.timeline.length).toBeGreaterThan(0);
    expect(bill.deliveryTimeMinutes).toBeGreaterThan(0);
    expect(bill.deliveryTimeLabel).toMatch(/min/);
  });
});
