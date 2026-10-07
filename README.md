# Software KeyLogger

Keylogger educativo con arquitectura cliente-servidor desarrollado como trabajo práctico para la **Universidad de Deusto**. Demuestra técnicas de captura de pulsaciones, comunicación en red y análisis de patrones de escritura en un entorno controlado de laboratorio.

> **⚠️ Uso exclusivamente educativo.** Este software está diseñado para fines de aprendizaje en seguridad informática. Úsalo solo en equipos propios o con autorización explícita.

## Arquitectura

```
┌──────────────┐    HTTP POST     ┌──────────────┐     ┌─────────┐
│   Cliente    │ ───────────────► │  Servidor    │ ──► │ MongoDB │
│  (C++/Win)   │  /api/keystroke  │  (Node.js)   │     │         │
└──────────────┘                  └──────┬───────┘     └─────────┘
                                         │
                                   stats.html
                                   (dashboard)
```

### Cliente (`cliente/`)

- Programa en C++ para Windows que utiliza un hook de teclado de bajo nivel (`WH_KEYBOARD_LL`).
- Captura todas las pulsaciones del sistema y las envía por HTTP al servidor en tiempo real.
- Traduce las pulsaciones al carácter real usando `ToUnicodeEx`: detecta Shift, CapsLock, AltGr y combinaciones del teclado español (@, #, !, etc.).
- Registra la tecla, la ventana activa, timestamp y hostname.
- Opcionalmente guarda un log local en `logs/` como respaldo.
- Compilable con MSVC o MinGW-w64.

### Servidor (`servidor/`)

- API REST con Express + MongoDB (Mongoose).
- Recibe pulsaciones en `POST /api/keystroke` y las almacena.
- **Reconstrucción de palabras** en tiempo real: acumula caracteres y detecta separadores (espacio, Enter, Tab, puntuación).
- **Detección de credenciales**:
  - Identifica emails (patrones con `@` y `.`).
  - Captura la palabra escrita justo después de un email (posible contraseña).
  - Clasifica palabras por complejidad:
    - `strong`: mayúscula + minúscula + número + carácter especial.
    - `mixed-case-num`: mayúscula + minúscula + número.
    - `alphanumeric`: letras + números.
- Dashboard web (`stats.html`) con estadísticas en tiempo real.

## Requisitos

- **Windows 10/11** (el cliente usa la API de Windows).
- **MongoDB** (local o Docker).
- **Node.js** (LTS).
- **Compilador C++**: Visual Studio Build Tools (cl.exe) o MinGW-w64 (g++).

> El script `iniciar.vbs` instala automáticamente Node.js, MongoDB y MinGW-w64 si no están presentes (requiere `winget`).

## Inicio rápido

### Arrancar todo (un solo clic)

```
Doble clic en iniciar.vbs
```

Esto automáticamente:
1. Instala dependencias del sistema si faltan (Node.js, MongoDB, compilador C++).
2. Arranca MongoDB.
3. Instala paquetes npm y arranca el servidor.
4. Compila (si es necesario) y arranca el keylogger.
5. Registra el autostart para que arranque con Windows.

Todo se ejecuta en segundo plano, sin ventanas visibles.

### Ver estadísticas

```
http://127.0.0.1:3000/stats.html
```

### Detener todo

```
Doble clic en desinstalar.bat
```

Mata todos los procesos y elimina el autostart de Windows.

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/keystroke` | Recibe una pulsación `{host, window, key, timestamp}` |
| `GET` | `/api/keystrokes` | Lista pulsaciones `?host=&limit=&from=&to=` |
| `GET` | `/api/stats/top-words` | Palabras más usadas |
| `GET` | `/api/stats/summary` | Resumen general |
| `GET` | `/api/stats/top-windows` | Ventanas con más escritura |
| `GET` | `/api/stats/by-hour` | Pulsaciones por hora del día |
| `GET` | `/api/stats/credentials` | Emails detectados + palabra siguiente |
| `GET` | `/api/stats/password-patterns` | Palabras por complejidad `?complexity=` |
| `GET` | `/api/stats/password-summary` | Conteo por tipo de complejidad |
| `POST` | `/api/stats/flush` | Fuerza el volcado de buffers en memoria |
| `GET` | `/api/health` | Health check |

## Estructura del proyecto

```
Software-KeyLogger/
├── cliente/
│   ├── klog_main.cpp          # Cliente keylogger (C++)
│   ├── build.bat              # Script de compilación
│   └── autostart/             # Scripts de autostart en Windows
├── servidor/
│   ├── server.js              # Servidor Express
│   ├── wordBuilder.js         # Reconstrucción de palabras
│   ├── models/
│   │   ├── Keystroke.js       # Modelo de pulsación
│   │   ├── Word.js            # Modelo de palabra
│   │   └── Credential.js      # Modelo de credencial detectada
│   └── public/
│       └── stats.html         # Dashboard de estadísticas
├── iniciar.vbs                # Lanzador silencioso (doble clic)
├── iniciar.bat                # Script de arranque completo
├── desinstalar.bat            # Detener todo + quitar autostart
└── detener.bat                # Solo detener procesos
```

## Tests

```bash
cd servidor
npm test              # Tests unitarios e integración
npm run test:perf     # Tests de rendimiento
```

Los tests se ejecutan automáticamente en cada push mediante GitHub Actions.

## Licencia

Proyecto educativo — Universidad de Deusto.
