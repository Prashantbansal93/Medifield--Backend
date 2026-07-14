jest.mock('../src/models/Wholesaler', () => ({
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
}));
jest.mock('../src/realtime', () => ({
  emitOrderEvent: jest.fn(),
}));

const Wholesaler = require('../src/models/Wholesaler');
const { deductInventory } = require('../src/utils/orderHelpers');

const medA = '507f1f77bcf86cd799439011';
const medB = '507f1f77bcf86cd799439012';

describe('deductInventory atomic', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deducts stock with findOneAndUpdate per item', async () => {
    Wholesaler.findOneAndUpdate.mockResolvedValue({ _id: 'w1' });
    Wholesaler.findById.mockResolvedValue({ _id: 'w1', inventory: [] });

    await deductInventory('w1', [
      { medicine: medA, quantity: 2, medicineName: 'MedA' },
      { medicine: medB, quantity: 1, medicineName: 'MedB' },
    ]);

    expect(Wholesaler.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(Wholesaler.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      _id: 'w1',
      inventory: { $elemMatch: { medicine: medA, quantity: { $gte: 2 } } },
    });
  });

  test('throws INSUFFICIENT_STOCK when update returns null', async () => {
    Wholesaler.findOneAndUpdate.mockResolvedValue(null);

    await expect(
      deductInventory('w1', [{ medicine: medA, quantity: 99, medicineName: 'MedA' }])
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  test('simulated concurrent race — second call fails', async () => {
    Wholesaler.findOneAndUpdate
      .mockResolvedValueOnce({ _id: 'w1' })
      .mockResolvedValueOnce(null);
    Wholesaler.findById.mockResolvedValue({ _id: 'w1' });

    await deductInventory('w1', [{ medicine: medA, quantity: 1 }]);

    await expect(
      deductInventory('w1', [{ medicine: medA, quantity: 1 }])
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });
});
