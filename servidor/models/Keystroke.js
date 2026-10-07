const mongoose = require('mongoose');

const keystrokeSchema = new mongoose.Schema({
  host:      { type: String, index: true },
  window:    { type: String, index: true },
  key:       { type: String, required: true },
  timestamp: { type: Date,   default: Date.now, index: true },
  receivedAt:{ type: Date,   default: Date.now }
});

module.exports = mongoose.model('Keystroke', keystrokeSchema);
