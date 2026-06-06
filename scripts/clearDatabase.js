/**
 * Drops the entire database named in MONGO_URI (destructive).
 * Run from server folder: node scripts/clearDatabase.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI in .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const name = mongoose.connection.db.databaseName;
  await mongoose.connection.dropDatabase();
  console.log(`Dropped database: ${name}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
