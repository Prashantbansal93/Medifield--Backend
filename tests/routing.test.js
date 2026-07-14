jest.mock('../src/models/Wholesaler', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  aggregate: jest.fn(),
}));
jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
}));
jest.mock('../src/models/Order');
jest.mock('../src/realtime', () => ({
  emitOrderEvent: jest.fn(),
}));

const Wholesaler = require('../src/models/Wholesaler');
const User = require('../src/models/User');
const {
  routeToWholesaler,
  findWholesalerByPriority,
  wholesalerHasStock,
} = require('../src/utils/orderHelpers');

const medId = '507f1f77bcf86cd799439011';

function makeOrder(items = [{ medicine: medId, quantity: 2 }]) {
  return {
    retailer: 'retailer1',
    items,
    attemptedWholesalers: [],
  };
}

function wholesaler(id, rank, qty, lat, lng, approved = true) {
  return {
    _id: id,
    priorityRank: rank,
    user: approved ? { _id: 'u' + id } : null,
    location: { coordinates: [lng, lat] },
    inventory: [{ medicine: { _id: medId }, quantity: qty, price: 10 }],
  };
}

describe('routeToWholesaler', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses priority fallback when retailer has no coordinates', async () => {
    User.findById.mockReturnValue({
      select: () => Promise.resolve({ profile: {} }),
    });
    Wholesaler.find.mockReturnValue({
      populate: () => ({
        populate: () => ({
          sort: () => [wholesaler('w1', 1, 5), wholesaler('w2', 2, 5)],
        }),
      }),
    });

    const result = await routeToWholesaler(makeOrder());
    expect(result._id).toBe('w1');
    expect(Wholesaler.aggregate).not.toHaveBeenCalled();
  });

  test('geo path selects nearest wholesaler with stock', async () => {
    User.findById.mockReturnValue({
      select: () => Promise.resolve({ profile: { lat: 26.91, lng: 75.78 } }),
    });

    Wholesaler.aggregate.mockResolvedValue([
      { _id: 'near', distanceMeters: 500, user: 'u1' },
      { _id: 'far', distanceMeters: 5000, user: 'u2' },
    ]);

    Wholesaler.findById.mockImplementation((id) => ({
      populate: () =>
        Promise.resolve(
          id === 'near'
            ? wholesaler('near', 50, 5, 26.911, 75.781)
            : wholesaler('far', 1, 5, 26.95, 75.85)
        ),
    }));

    const result = await routeToWholesaler(makeOrder());
    expect(result._id).toBe('near');
    expect(Wholesaler.aggregate).toHaveBeenCalled();
  });

  test('skips nearest wholesaler when out of stock', async () => {
    User.findById.mockReturnValue({
      select: () => Promise.resolve({ profile: { lat: 26.91, lng: 75.78 } }),
    });

    Wholesaler.aggregate.mockResolvedValue([
      { _id: 'near', distanceMeters: 100 },
      { _id: 'far', distanceMeters: 8000 },
    ]);

    Wholesaler.findById.mockImplementation((id) => ({
      populate: () =>
        Promise.resolve(
          id === 'near'
            ? wholesaler('near', 1, 1, 26.911, 75.781)
            : wholesaler('far', 5, 10, 26.95, 75.85)
        ),
    }));

    const result = await routeToWholesaler(makeOrder());
    expect(result._id).toBe('far');
  });
});

describe('wholesalerHasStock', () => {
  test('returns false when quantity insufficient', () => {
    const w = wholesaler('w1', 1, 1);
    expect(wholesalerHasStock(w, { [medId]: 5 })).toBe(false);
  });
});

describe('findWholesalerByPriority', () => {
  test('returns lowest priorityRank with stock', async () => {
    Wholesaler.find.mockReturnValue({
      populate: () => ({
        populate: () => ({
          sort: () => [wholesaler('w1', 1, 5), wholesaler('w2', 2, 5)],
        }),
      }),
    });
    const result = await findWholesalerByPriority(makeOrder());
    expect(result._id).toBe('w1');
  });
});
