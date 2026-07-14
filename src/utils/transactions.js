const mongoose = require('mongoose');

let transactionsSupported = null;

function isTransactionUnsupportedError(err) {
  const msg = String(err?.message || '');
  return (
    err?.code === 20 ||
    err?.codeName === 'IllegalOperation' ||
    msg.includes('Transaction numbers are only allowed') ||
    msg.includes('replica set') ||
    msg.includes('mongos')
  );
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  try {
    if (transactionsSupported === false) {
      return work(null);
    }

    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    transactionsSupported = true;
    return result;
  } catch (err) {
    if (transactionsSupported !== true && isTransactionUnsupportedError(err)) {
      transactionsSupported = false;
      console.warn(
        '[transactions] Standalone MongoDB detected — falling back to non-transactional writes'
      );
      return work(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = { withTransaction, isTransactionUnsupportedError };
