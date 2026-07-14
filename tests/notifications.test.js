jest.mock('../src/models/Notification');
jest.mock('../src/realtime', () => ({
  emitNotification: jest.fn(),
}));

const Notification = require('../src/models/Notification');
const { emitNotification } = require('../src/realtime');
const { createNotification, notifyOrderEvent } = require('../src/utils/notifications');

jest.mock('../src/models/User', () => ({
  find: jest.fn().mockResolvedValue([{ _id: 'admin1' }]),
}));

describe('notifications', () => {
  beforeEach(() => jest.clearAllMocks());

  test('createNotification persists and emits socket event', async () => {
    const doc = { _id: 'n1', title: 'Test', message: 'Hello' };
    Notification.create.mockResolvedValue(doc);

    const result = await createNotification({
      userId: 'user1',
      type: 'ORDER_PLACED',
      title: 'Test',
      message: 'Hello',
      orderId: 'order1',
    });

    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'user1', type: 'ORDER_PLACED' })
    );
    expect(emitNotification).toHaveBeenCalledWith('user1', doc);
    expect(result).toBe(doc);
  });

  test('notifyOrderEvent notifies retailer on ACCEPTED', async () => {
    Notification.create.mockImplementation((data) => Promise.resolve({ ...data, _id: 'n' }));

    await notifyOrderEvent(
      {
        _id: 'order1',
        billNumber: 'BILL-ABC',
        retailer: 'retailer1',
        wholesaler: { user: 'wholesalerUser1' },
        deliveryPartner: 'delivery1',
      },
      'ACCEPTED'
    );

    expect(Notification.create).toHaveBeenCalled();
    const userIds = Notification.create.mock.calls.map((c) => String(c[0].user));
    expect(userIds).toContain('retailer1');
    expect(userIds).toContain('delivery1');
  });
});
