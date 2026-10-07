const mongoose = require('mongoose');

// Palabra reconstruida a partir de las pulsaciones.
// Se guarda cada palabra como un documento; los conteos se calculan por agregacion.
const wordSchema = new mongoose.Schema({
  host:      { type: String, index: true },
  window:    { type: String, index: true },
  word:      { type: String, required: true, index: true },
  length:    { type: Number, index: true },
  timestamp: { type: Date,   default: Date.now, index: true }
});

wordSchema.index({ host: 1, word: 1 });

module.exports = mongoose.model('Word', wordSchema);
