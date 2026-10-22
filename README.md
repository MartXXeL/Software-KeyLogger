# Software KeyLogger

Keylogger educativo con arquitectura cliente-servidor desarrollado como trabajo practico para la **Universidad de Deusto** en la asignatura de Tecnologias Emergentes. Demuestra tecnicas de captura de pulsaciones a bajo nivel, comunicacion en red, reconstruccion de texto, deteccion de credenciales y analisis de patrones de escritura en un entorno controlado de laboratorio.

> **Uso exclusivamente educativo.** Este software esta disenado para fines de aprendizaje en seguridad informatica. Usalo solo en equipos propios o con autorizacion explicita. El uso indebido de software de keylogging es ilegal en la mayoria de jurisdicciones.

---

## Indice

1. [Arquitectura general](#arquitectura-general)
2. [Cliente (C++)](#cliente-c)
3. [Servidor (Node.js)](#servidor-nodejs)
4. [Base de datos (MongoDB)](#base-de-datos-mongodb)
5. [Dashboard web](#dashboard-web)
6. [Requisitos del sistema](#requisitos-del-sistema)
7. [Instalacion y arranque](#instalacion-y-arranque)
8. [Instalacion desde USB](#instalacion-desde-usb)
9. [Detener y desinstalar](#detener-y-desinstalar)
10. [API REST completa](#api-rest-completa)
11. [Estructura del proyecto](#estructura-del-proyecto)
12. [Tests y CI/CD](#tests-y-cicd)
13. [Configuracion avanzada](#configuracion-avanzada)
14. [Licencia](#licencia)

---

## Arquitectura general

El sistema sigue una arquitectura cliente-servidor con tres componentes principales:

```
┌──────────────────┐    HTTP POST      ┌──────────────────┐     ┌───────────┐
│     Cliente      │ ────────────────► │    Servidor      │ ──► │  MongoDB  │
│   (C++ / Win32)  │  /api/keystroke   │   (Node.js +     │     │           │
│                  │                   │    Express)      │     │ 3 colecciones:
│ - Hook WH_KEYBOARD_LL               │                  │     │ · keystrokes
│ - ToUnicodeEx    │                   │ - wordBuilder.js │     │ · words
│ - Cola async     │                   │ - Deteccion de   │     │ · credentials
│ - Log local      │                   │   credenciales   │     │           │
└──────────────────┘                   └────────┬─────────┘     └───────────┘
                                                │
                                        /stats.html
                                       (dashboard web
                                        con auto-refresh
                                        cada 3 segundos)
```

**Flujo de datos:**

1. El cliente instala un hook global de teclado (`WH_KEYBOARD_LL`) que intercepta todas las pulsaciones del sistema operativo.
2. Cada pulsacion se traduce al caracter real usando `ToUnicodeEx`, teniendo en cuenta el estado de Shift, CapsLock, AltGr y la distribucion del teclado.
3. La pulsacion se encola en una cola productor/consumidor thread-safe y un hilo de fondo la envia por HTTP POST al servidor.
4. El servidor almacena la pulsacion cruda en MongoDB y la pasa al modulo `wordBuilder`, que reconstruye palabras en tiempo real.
5. Cuando una palabra se completa (espacio, Enter, Tab, cambio de ventana), se guarda en la coleccion `words` y se analiza en busca de patrones (emails, posibles contrasenas).
6. El dashboard web consulta la API cada 3 segundos y muestra estadisticas en tiempo real.

---

## Cliente (C++)

**Archivo principal:** `cliente/klog_main.cpp`

### Hook de teclado

El cliente utiliza la API de Windows `SetWindowsHookEx` con el tipo `WH_KEYBOARD_LL` (hook de teclado de bajo nivel). Este hook intercepta todas las pulsaciones del sistema, independientemente de la ventana activa, incluyendo combinaciones con teclas modificadoras.

El callback `HookCallback` se ejecuta en el hilo del hook y solo procesa eventos `WM_KEYDOWN` y `WM_SYSKEYDOWN` (tecla pulsada, incluyendo combinaciones con Alt).

### Traduccion de teclas

La funcion `RenderKey` traduce el codigo virtual de la tecla (`vkCode`) al caracter real que el usuario ha escrito:

- **Teclas especiales** (Enter, Backspace, Tab, flechas, etc.): se traducen a etiquetas legibles como `[ENTER]`, `[BACKSPACE]`.
- **Teclas de modificacion** (Shift, Control, Alt, Win, CapsLock): se registran como etiquetas pero no producen caracter.
- **Teclas de caracter**: se traducen usando `ToUnicodeEx`, que tiene en cuenta:
  - Estado de **Shift** y **CapsLock** para mayusculas/minusculas.
  - Estado de **AltGr** (Ctrl+Alt derecho) para caracteres especiales del teclado espanol: `@`, `#`, `€`, `{`, `}`, `[`, `]`, `~`, etc.
  - **Dead keys** (acentos, tildes): cuando `ToUnicodeEx` devuelve -1, indica que es un acento muerto. No se limpia el estado para que la siguiente pulsacion produzca el caracter combinado (ej: ` ´ ` + `a` = `á`).
  - **Layout del teclado** activo: se obtiene con `GetKeyboardLayout` del hilo de la ventana en primer plano.

El estado del teclado se construye manualmente con `GetAsyncKeyState` (estado hardware real) en lugar de `GetKeyboardState`, que no refleja el estado correcto desde un hook de bajo nivel.

### Cola productor/consumidor

El envio HTTP no se hace en el hilo del hook (bloquearia la entrada del sistema). En su lugar, se usa una cola thread-safe con `std::deque`, protegida por `std::mutex` y `std::condition_variable`:

- **Productor** (hilo del hook): encola el evento (`EnqueueKey`).
- **Consumidor** (hilo `HttpWorker`): desencola y envia por HTTP. Si el envio falla, reencola el evento y espera 2 segundos antes de reintentar.

### Envio HTTP

La funcion `PostJson` usa la API `WinHTTP` de Windows para enviar un POST con body JSON al servidor. Soporta HTTP y HTTPS (configurable con `USE_HTTPS`).

Cada evento enviado contiene:

```json
{
  "host":      "NOMBRE-PC",
  "window":    "Google Chrome - Gmail",
  "key":       "a",
  "timestamp": "2026-10-22T11:30:45"
}
```

### Registro de ventana activa

Con cada pulsacion se registra el titulo de la ventana en primer plano (`GetForegroundWindow` + `GetWindowTextA`). Esto permite saber en que aplicacion estaba escribiendo el usuario.

### Log local

Si `LOCAL_LOG` esta activado (por defecto lo esta), se guarda un respaldo en archivos locales en la carpeta `logs/`. Los archivos se rotan cada hora con formato `2026-10-22__11-00-00.log`. Cada vez que cambia la ventana activa se anota el nuevo titulo.

### Modo sigiloso

La funcion `Stealth()` oculta la ventana de consola al inicio. La configuracion se controla con macros de compilacion:

| Macro | Efecto |
|-------|--------|
| `invisible` | Oculta la ventana y libera la consola |
| `visible` | Muestra la ventana (modo depuracion) |
| `bootwait` | Espera a que el sistema termine de arrancar |
| `nowait` | Inicia inmediatamente |

### Compilacion

El script `cliente/build.bat` detecta automaticamente el compilador disponible:

**Con MSVC (Visual Studio Build Tools):**
```
cl /EHsc /std:c++17 /O2 /Fe:keylogger.exe klog_main.cpp /link winhttp.lib user32.lib
```

**Con MinGW-w64 (g++):**
```
g++ -std=c++17 -O2 -o keylogger.exe klog_main.cpp -lwinhttp -luser32 -lgdi32 -static -mwindows
```

La flag `-mwindows` en MinGW crea un ejecutable de tipo Windows (sin ventana de consola). La flag `-static` enlaza las librerias estaticamente para que el ejecutable no dependa de DLLs externas.

---

## Servidor (Node.js)

**Archivo principal:** `servidor/server.js`

### API REST con Express

El servidor expone una API REST sobre Express que:

- Recibe pulsaciones individuales del cliente en `POST /api/keystroke`.
- Almacena cada pulsacion en la coleccion `keystrokes` de MongoDB.
- Procesa cada tecla a traves del modulo `wordBuilder` para reconstruir palabras.
- Ofrece endpoints de estadisticas y analisis.
- Sirve el dashboard web desde `public/stats.html`.

### Reconstruccion de palabras (wordBuilder.js)

El modulo `wordBuilder.js` reconstruye palabras completas a partir de pulsaciones individuales. Funciona con un **buffer en memoria por host**:

**Mecanismo:**

1. Cada caracter recibido se acumula en el buffer del host correspondiente.
2. Cuando llega un **separador** (espacio, Enter, Tab, flechas, Escape, etc.), la palabra acumulada se "cierra" y se guarda en MongoDB.
3. Si cambia la **ventana activa**, la palabra en curso tambien se cierra.
4. **Backspace** borra el ultimo caracter del buffer.
5. Las teclas **modificadoras** (Shift, Ctrl, Alt, Win, CapsLock) se ignoran sin cerrar la palabra.

**Procesamiento sincrono:** `handleKey` es deliberadamente sincrono. Las teclas se procesan en el orden exacto en que llegan. Las escrituras a MongoDB se lanzan en segundo plano (fire-and-forget) para no bloquear el procesamiento.

**Limites:** Las palabras deben tener entre 2 y 200 caracteres. Las que quedan fuera de ese rango se descartan.

### Deteccion de credenciales

El sistema detecta automaticamente dos tipos de informacion sensible:

**1. Emails:**
- Cuando una palabra completa cumple el patron `usuario@dominio.ext`, se guarda en la coleccion `credentials`.
- La palabra que se escribe **justo despues** del email se registra como `nextWord` (posible contrasena, ya que en formularios de login el campo de contrasena suele ir despues del email).

**2. Clasificacion de complejidad:**
Cada palabra se clasifica segun su composicion:

| Nivel | Etiqueta | Criterio | Ejemplo |
|-------|----------|----------|---------|
| Alto | `strong` | Mayuscula + minuscula + numero + caracter especial | `P@ssw0rd` |
| Medio | `mixed-case-num` | Mayuscula + minuscula + numero | `Pass123` |
| Basico | `alphanumeric` | Letras + numeros | `abc123` |
| Ninguno | `null` | No cumple ningun patron | `hola` |

La clasificacion tiene en cuenta caracteres del espanol (n con tilde, vocales acentuadas).

### Shutdown graceful

Al recibir SIGINT o SIGTERM, el servidor vacia todos los buffers de palabras en memoria (`flushAll`) y cierra la conexion a MongoDB. Esto garantiza que no se pierden palabras parcialmente escritas.

---

## Base de datos (MongoDB)

El sistema utiliza tres colecciones en MongoDB:

### Coleccion `keystrokes`

Almacena cada pulsacion individual.

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `host` | String (indexado) | Nombre del equipo |
| `window` | String (indexado) | Titulo de la ventana activa |
| `key` | String (requerido) | Tecla pulsada (caracter o etiqueta) |
| `timestamp` | Date (indexado) | Momento de la pulsacion |
| `receivedAt` | Date | Momento de recepcion en el servidor |

### Coleccion `words`

Almacena las palabras reconstruidas por `wordBuilder`.

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `host` | String (indexado) | Nombre del equipo |
| `window` | String (indexado) | Ventana donde se escribio |
| `word` | String (requerido, indexado) | Palabra reconstruida |
| `length` | Number (indexado) | Longitud de la palabra |
| `complexity` | String (indexado) | Nivel de complejidad (`null`, `alphanumeric`, `mixed-case-num`, `strong`) |
| `timestamp` | Date (indexado) | Inicio de escritura de la palabra |

Indice compuesto: `{ host: 1, word: 1 }` para consultas rapidas de palabras por host.

### Coleccion `credentials`

Almacena las credenciales detectadas.

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `host` | String (indexado) | Nombre del equipo |
| `window` | String | Ventana donde se detecto |
| `email` | String (requerido, indexado) | Email detectado |
| `nextWord` | String | Palabra escrita justo despues (posible contrasena) |
| `timestamp` | Date (indexado) | Momento de deteccion |

---

## Dashboard web

**Archivo:** `servidor/public/stats.html`

Panel de estadisticas accesible en `http://127.0.0.1:3000/stats.html` que se actualiza automaticamente cada 3 segundos.

### Secciones

**Indicadores principales (KPIs):**
- Palabras totales
- Palabras unicas
- Longitud media de palabra
- Hosts activos

**Graficos y tablas:**
- **Pulsaciones por hora del dia**: grafico de barras con las 24 horas (agrega sobre `keystrokes`).
- **Palabras mas usadas**: tabla con ranking de frecuencia.
- **Ventanas con mas escritura**: tabla de ventanas ordenadas por numero de palabras.
- **Palabras por host**: desglose por equipo.
- **Distribucion por longitud**: histograma de longitud de palabras.

**Seccion de seguridad (deteccion de credenciales):**
- KPIs: emails detectados, contrasenas fuertes/medias/alfanumericas.
- Tabla de emails detectados con la palabra siguiente y la ventana de origen.
- Tablas separadas de posibles contrasenas por nivel de complejidad (fuerte, media, alfanumerica).

### Filtros

El dashboard permite filtrar por:
- **Host**: nombre del equipo.
- **Rango de fechas**: desde/hasta con selector datetime-local.
- **Limite**: numero maximo de resultados por tabla (5-500).
- **Flush buffers**: boton para forzar el volcado de los buffers en memoria a la base de datos.

---

## Requisitos del sistema

| Componente | Requisito |
|------------|-----------|
| Sistema operativo | Windows 10/11 (el cliente usa la API Win32) |
| Base de datos | MongoDB 5.0+ (local, Docker o servicio) |
| Runtime | Node.js 18 LTS o superior |
| Compilador C++ | Visual Studio Build Tools (`cl.exe`) o MinGW-w64 (`g++`) |
| Gestor de paquetes | `winget` (incluido en Windows 11; necesario para instalacion automatica) |

> El script `iniciar.vbs` instala automaticamente Node.js, MongoDB y MinGW-w64 si no estan presentes, usando `winget`.

---

## Instalacion y arranque

### Arranque automatico (un solo clic)

```
Doble clic en iniciar.vbs
```

`iniciar.vbs` es un lanzador VBScript que ejecuta `iniciar.bat` de forma completamente oculta (sin ventanas visibles). `iniciar.bat` realiza los siguientes pasos en orden:

| Paso | Accion | Detalle |
|------|--------|---------|
| 1 | Instalar Node.js | Comprueba si `node` esta en el PATH. Si no, lo instala con `winget install OpenJS.NodeJS.LTS`. |
| 2 | Arrancar MongoDB | Intenta: servicio de Windows → ejecutable local → Docker → instalacion con `winget`. Crea `mongo_data/` como directorio de datos. |
| 3 | Instalar dependencias npm | Ejecuta `npm install` en `servidor/` si no existe `node_modules/`. |
| 4 | Arrancar servidor | Lanza `node servidor/server.js` en segundo plano si el puerto 3000 no esta ocupado. |
| 5 | Compilar y arrancar cliente | Busca un compilador C++. Si no hay, instala WinLibs (MinGW-w64) con `winget`. Compila con `build.bat` y lanza `keylogger.exe` en segundo plano. |
| 6 | Registrar autostart | Crea un acceso directo `KeyloggerLab.lnk` en la carpeta de Inicio de Windows (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`). Esto hace que el keylogger arranque automaticamente con cada inicio de sesion. |

Todos los procesos se ejecutan en segundo plano y sin ventanas visibles.

### Arranque manual (paso a paso)

**1. Arrancar MongoDB:**
```bash
mongod --dbpath ./mongo_data
```
O con Docker:
```bash
docker run -d --name keylogger-mongo -p 27017:27017 mongo
```

**2. Arrancar el servidor:**
```bash
cd servidor
npm install
node server.js
```

**3. Compilar y arrancar el cliente:**
```bash
cd cliente
build.bat
keylogger.exe
```

### Ver estadisticas

Abrir en el navegador:
```
http://127.0.0.1:3000/stats.html
```

---

## Instalacion desde USB

El archivo `instalacion.bat` permite instalar el proyecto desde un pendrive con un solo doble clic.

**Flujo:**

1. Introduces el pendrive en el equipo.
2. Haces doble clic en `instalacion.bat`.
3. El script copia todo el proyecto a `C:\Users\%USERNAME%\MiPrograma`, excluyendo la carpeta `.git`.
4. Lee `.gitignore` y elimina del destino los archivos/carpetas que coincidan (compilados, logs, node_modules, etc.).
5. Se elimina a si mismo y el `.gitignore` de la copia destino.
6. Ejecuta automaticamente `iniciar.vbs` de la copia local, que arranca todo el sistema.

Despues de esto puedes retirar el USB. El sistema queda funcionando de forma autonoma en el equipo.

---

## Detener y desinstalar

### Detener todo (mantener autostart)

```
Doble clic en detener.bat
```

Detiene con feedback visual:
1. Mata `keylogger.exe`.
2. Detiene el servidor (proceso en el puerto 3000).
3. Detiene MongoDB (contenedor Docker o proceso directo).

### Desinstalar completamente

```
Doble clic en desinstalar.bat
```

Hace lo mismo que `detener.bat` pero ademas:
- Elimina el acceso directo `KeyloggerLab.lnk` de la carpeta de Inicio, desactivando el arranque automatico con Windows.

### Autostart

El sistema de autostart usa un acceso directo en la carpeta de Inicio de Windows (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`). Este metodo:

- Es el metodo oficial documentado por Microsoft.
- Aparece visible en el Administrador de Tareas > Inicio.
- No requiere permisos de administrador.
- Se desinstala borrando el acceso directo (lo hace `desinstalar.bat` o `uninstall-autostart.ps1`).

Los scripts de autostart tambien estan disponibles de forma independiente en `cliente/autostart/`:
- `install-autostart.ps1`: instala el autostart manualmente.
- `uninstall-autostart.ps1`: desinstala el autostart.

---

## API REST completa

Todos los endpoints aceptan parametros de query para filtrado. El servidor escucha en `http://127.0.0.1:3000` por defecto.

### Recepcion de datos

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `POST` | `/api/keystroke` | Recibe una pulsacion individual |

**Body (JSON):**
```json
{
  "host": "NOMBRE-PC",
  "window": "Chrome - Gmail",
  "key": "a",
  "timestamp": "2026-10-22T11:30:45"
}
```

**Respuesta:** `201 Created` con `{ "id": "<ObjectId>" }`

**Validacion:**
- `key` es obligatorio y debe ser un string no vacio.
- `host` usa `"unknown"` si no se proporciona.
- `timestamp` usa la hora actual si no se proporciona o es invalido (devuelve 400).

### Consulta de datos

| Metodo | Ruta | Query params | Descripcion |
|--------|------|--------------|-------------|
| `GET` | `/api/keystrokes` | `host`, `limit`, `from`, `to` | Lista pulsaciones (por defecto las 200 mas recientes) |
| `GET` | `/api/stats/top-words` | `host`, `window`, `limit`, `from`, `to` | Ranking de las palabras mas usadas |
| `GET` | `/api/stats/summary` | `host`, `window`, `from`, `to` | Resumen general: totales, unicas, longitud media, por host, histograma |
| `GET` | `/api/stats/top-windows` | `host`, `limit`, `from`, `to` | Ventanas ordenadas por numero de palabras escritas |
| `GET` | `/api/stats/by-hour` | `host`, `from`, `to` | Pulsaciones agrupadas por hora del dia (0-23), siempre 24 entradas |
| `GET` | `/api/stats/credentials` | `host`, `limit`, `from`, `to` | Emails detectados con la palabra siguiente |
| `GET` | `/api/stats/password-patterns` | `host`, `window`, `limit`, `from`, `to`, `complexity` | Palabras filtradas por nivel de complejidad |
| `GET` | `/api/stats/password-summary` | `host`, `window`, `from`, `to` | Conteo de palabras por tipo de complejidad + total de emails |

### Operaciones

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `POST` | `/api/stats/flush` | Fuerza el volcado de los buffers de palabras en memoria a MongoDB |
| `GET` | `/api/health` | Health check (`{ "ok": true }`) |

### Notas sobre los parametros

- `limit`: por defecto 200 para keystrokes, 25 para top-words, 15 para top-windows, 50 para credenciales y patrones. Maximo 1000 (500 en algunos endpoints).
- `from` y `to`: formato ISO 8601 (ej: `2026-10-22T00:00:00.000Z`). Si son invalidos, devuelve 400.
- `complexity`: valores posibles: `strong`, `mixed-case-num`, `alphanumeric`.

---

## Estructura del proyecto

```
Software-KeyLogger/
│
├── cliente/                        # Cliente keylogger (C++ / Win32)
│   ├── klog_main.cpp               # Codigo fuente principal
│   ├── build.bat                   # Script de compilacion (MSVC / MinGW)
│   └── autostart/                  # Scripts de persistencia en Windows
│       ├── install-autostart.ps1   # Crea acceso directo en carpeta de Inicio
│       ├── uninstall-autostart.ps1 # Elimina el acceso directo
│       └── README.md               # Documentacion del autostart
│
├── servidor/                       # Servidor API + dashboard
│   ├── server.js                   # API REST con Express
│   ├── wordBuilder.js              # Reconstruccion de palabras y deteccion de credenciales
│   ├── models/                     # Esquemas Mongoose
│   │   ├── Keystroke.js            # Modelo: pulsacion individual
│   │   ├── Word.js                 # Modelo: palabra reconstruida + complejidad
│   │   └── Credential.js          # Modelo: email detectado + palabra siguiente
│   ├── public/
│   │   └── stats.html              # Dashboard de estadisticas (auto-refresh 3s)
│   ├── tests/
│   │   ├── wordBuilder.unit.test.js    # Tests unitarios del reconstructor de palabras
│   │   ├── api.integration.test.js     # Tests de integracion de la API
│   │   ├── perf.test.js                # Tests de rendimiento
│   │   └── dbHelper.js                 # Helper para conexion a MongoDB en tests
│   ├── package.json
│   ├── package-lock.json
│   ├── jest.config.js              # Configuracion de Jest
│   └── .env.example                # Variables de entorno de ejemplo
│
├── iniciar.vbs                     # Lanzador silencioso (doble clic, sin ventanas)
├── iniciar.bat                     # Script maestro: instala, arranca todo, configura autostart
├── detener.bat                     # Detiene todos los procesos (con feedback)
├── desinstalar.bat                 # Detiene todo + elimina autostart
├── instalacion.bat                 # Instalador desde USB
│
├── .github/
│   └── workflows/
│       └── tests.yml               # CI: tests automaticos en cada push
│
├── .gitignore
└── README.md
```

---

## Tests y CI/CD

### Suite de tests

Los tests estan en `servidor/tests/` y usan **Jest** como framework:

| Archivo | Tipo | Que prueba |
|---------|------|------------|
| `wordBuilder.unit.test.js` | Unitario | Reconstruccion de palabras, backspace, separadores, deteccion de emails, clasificacion de complejidad, mayusculas, caracteres especiales, AltGr |
| `api.integration.test.js` | Integracion | Endpoints de la API completa con MongoDB real |
| `perf.test.js` | Rendimiento | Velocidad de procesamiento bajo carga |

**Ejecutar tests:**

```bash
cd servidor
npm test              # Unitarios + integracion
npm run test:perf     # Rendimiento
```

Los tests de integracion requieren una instancia de MongoDB corriendo. Usan una base de datos separada (`keylogger-test`) para no interferir con los datos de produccion.

### GitHub Actions (CI)

El workflow `.github/workflows/tests.yml` se ejecuta automaticamente en cada push a cualquier rama y en cada pull request a `main`:

1. Levanta un contenedor MongoDB 7 como servicio.
2. Instala Node.js 20 con cache de npm.
3. Ejecuta `npm ci` (o `npm install` como fallback).
4. Ejecuta los tests unitarios e integracion.
5. Ejecuta los tests de rendimiento.

---

## Configuracion avanzada

### Variables de entorno del servidor

Crear un archivo `servidor/.env` (ver `.env.example`):

```
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/keylogger
```

### Configuracion del cliente (macros en klog_main.cpp)

| Macro | Valores | Descripcion |
|-------|---------|-------------|
| `invisible` / `visible` | Define uno u otro | Visibilidad de la ventana de consola |
| `bootwait` / `nowait` | Define uno u otro | Esperar al arranque del sistema antes de iniciar |
| `FORMAT` | `0`, `10`, `16` | Formato de teclas: nombre legible, decimal, hexadecimal |
| `mouseignore` | Definida o no | Ignorar clicks de raton |
| `SERVER_HOST` | String wide | IP o hostname del servidor (`L"127.0.0.1"`) |
| `SERVER_PORT` | Entero | Puerto del servidor (`3000`) |
| `SERVER_PATH` | String wide | Ruta del endpoint (`L"/api/keystroke"`) |
| `USE_HTTPS` | `0` o `1` | HTTP o HTTPS |
| `LOCAL_LOG` | `0` o `1` | Guardar log local en `logs/` como respaldo |

---

## Licencia

Proyecto educativo — Universidad de Deusto, Tecnologias Emergentes.
