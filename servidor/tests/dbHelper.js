const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const wordBuilder = require('../wordBuilder');

let mongo;

async function connect() {
  const uri = process.env.MONGO_TEST_URI;
  if (uri) {
    await mongoose.connect(uri);
  } else {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  }
}

async function disconnect() {
  await mongoose.connection.close();
  if (mongo) {
    await mongo.stop();
    mongo = null;
  }
}

async function clearAll() {
  await wordBuilder.flushAll();
  wordBuilder.reset();
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

module.exports = { connect, disconnect, clearAll };
