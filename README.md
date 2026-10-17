# Calidad por hora

Biblioteca de juegos que calcula la **calidad por hora** de cada juego:
`promedio de notas ÷ duración en horas`.

Funciona en el navegador del ordenador, en el móvil (PWA instalable, con modo sin
conexión) y como **app Android**. Con sesión de Google, la misma biblioteca se ve en
todos tus dispositivos.

**App:** <https://yimmer-r.github.io/biblioteca-juegos/>

## Qué hace

- **Cualquier plataforma**: Steam, Epic, GOG, PlayStation, Xbox, Nintendo, Android,
  iOS o lo que escribas a mano. Cada juego vive en una plataforma y hay una
  **pestaña por plataforma**.
- **Busca los datos por ti**: nota de críticos (Metacritic), nota de jugadores,
  duración media y **carátula**.
- **Dos vistas**: tabla ordenable por cualquier columna, o cuadrícula de carátulas
  con la calidad/hora encima.
- **Conecta con Steam**: trae tu biblioteca real, con tus horas jugadas.
- **Importa pegando una lista** de nombres, para las plataformas que no tienen API.
- **Sincroniza con tu cuenta de Google** o funciona sin cuenta, solo en el
  dispositivo.
- Exporta a CSV (Excel) y copia de seguridad en JSON.

## De dónde salen los datos

**Buscar un juego y traer todos sus datos no necesita ninguna clave, ni tuya ni
de nadie.** Todo sale de endpoints públicos de Steam, servidos a través del
Worker porque Steam no manda cabeceras CORS.

| Dato | Fuente | Clave |
| --- | --- | --- |
| Nota de críticos | Metacritic en la ficha de Steam | ninguna |
| Nota de jugadores | % de reseñas positivas de Steam | ninguna (mínimo 30 reseñas) |
| Duración | Mediana de horas jugadas por quien reseña | ninguna |
| Carátula y año | Ficha de Steam | ninguna |
| Consolas y móvil | RAWG | la del propio usuario, opcional |
| Tu biblioteca de Steam | Steam Web API | **la del propio usuario** |

Sobre la duración: Steam no publica "cuánto se tarda en pasárselo", así que se usa
la **mediana de horas de las reseñas recientes**. Es sorprendentemente buena
(Hades sale 23,6 h y lo real son ~21 h) pero tiende a pasarse en juegos largos,
porque quien reseña suele jugar más que la media. Es un campo editable.

Lo que **no** se puede hacer, y por qué:

- **Epic Games y GOG no tienen API pública** para leer tu biblioteca. Solo existen
  librerías no oficiales que piden tus credenciales. Para esas plataformas usa
  *Importar lista de juegos*: pega los nombres y la app busca el resto.
- **La biblioteca de Steam sin clave ya no funciona**: el endpoint XML de los
  perfiles públicos ahora redirige a la pantalla de inicio de sesión. Por eso esa
  única función pide la clave de quien la usa.
- **SteamDB y HowLongToBeat no tienen API pública.**

## Puesta en marcha

### 1. Nada

Abre la app y empieza a añadir juegos. Los de PC salen completos sin configurar
nada: nota de críticos, nota de jugadores, duración y carátula.

### 1b. Clave de RAWG (opcional, solo para consolas y móvil)

1. Entra en <https://rawg.io/apidocs>, crea una cuenta y copia tu *API key*
   (**32 caracteres hexadecimales**: cópiala entera).
2. En la app: **☰ → Clave de RAWG** → pegar → Guardar. La app hace una consulta
   de prueba y te dice si responde.

> Si la clave está mal, RAWG contesta `401` **sin cabeceras CORS**, y el navegador
> lo enseña como un error de red. Por eso la app comprueba la longitud y hace una
> consulta de prueba al guardarla.

### 2. Sincronización con Google

Ya está montado sobre el proyecto `calidad-por-hora-d22290`: solo hay que pulsar
**Entrar** en la app. Para reproducirlo en otro proyecto:

```bash
firebase login
firebase projects:create <id> --display-name "Calidad por hora"
firebase apps:create WEB "web" --project <id>
firebase apps:sdkconfig WEB <appId> --project <id>   # -> config.js
firebase deploy --only firestore:rules --project <id>  # crea la BD y publica las reglas
```

Dos cosas **no** se pueden hacer por CLI y hay que hacerlas en la consola:
activar el proveedor **Google** en *Authentication* (la API pide un `client_id`
que solo autocrea la consola) e inicializar Auth (por API exige facturación).
El dominio autorizado sí se puede añadir después por API.

La `apiKey` de `config.js` es pública por diseño: viaja al navegador en cualquier
app web de Firebase. Lo que protege los datos son las reglas.

Cada biblioteca se guarda en `bibliotecas/{uid}` y solo la puede leer su dueño.
Gana siempre el último cambio.

### 3. Traer tu biblioteca de Steam (opcional)

Es lo único que pide una clave de Steam, y es **la de quien la usa**: se saca en
<https://steamcommunity.com/dev/apikey>, se guarda en tu propio navegador y viaja
en la cabecera `X-Steam-Key` solo en esa petición. El Worker no guarda ninguna.

El Worker (en [`worker/`](worker/)) existe porque Steam no manda cabeceras CORS.
Se despliega en el plan gratuito de Cloudflare, sin tarjeta:

```bash
cd worker
npx wrangler deploy
```

Luego pon la URL que te dé Cloudflare en `STEAM_PROXY`, en [`config.js`](config.js).
No hay secretos que configurar.

Tu perfil de Steam debe tener *Detalles del juego* en **Público**.

## Uso local

```bash
python -m http.server 8123
```

Y abre <http://localhost:8123>. Hace falta un servidor: abrir `index.html` con doble
clic no funciona porque el navegador bloquea los módulos JavaScript en `file://`.

Comprobación de la lógica de cálculo:

```bash
node test.mjs
```

## App Android (APK)

La app Android es un envoltorio de la web (TWA): se genera con
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) a partir de la URL
publicada, y se actualiza sola cuando se actualiza la web.

Para que se vea a pantalla completa, sin barra de navegador, el dominio debe
publicar `/.well-known/assetlinks.json` con la huella SHA-256 de la clave de firma.
En GitHub Pages ese archivo va en la **raíz** del dominio (repositorio
`<usuario>.github.io`), no dentro de este repositorio.

## Archivos

| Archivo | Para qué |
| --- | --- |
| `index.html` | Estructura, menú y diálogos |
| `styles.css` | Estilos: tabla en escritorio, tarjetas en móvil, cuadrícula de carátulas |
| `lib.js` | Cálculos, mapeo de RAWG y Steam, orden, pestañas y CSV (sin DOM) |
| `app.js` | Estado, render, llamadas a las APIs, importar y exportar |
| `sync.js` | Login con Google y copia en Firestore (se carga solo si hace falta) |
| `config.js` | Tus datos de Firebase y la URL del Worker |
| `firestore.rules` | Reglas de seguridad de la base de datos |
| `worker/` | El intermediario de Steam |
| `test.mjs` | Autochequeo de `lib.js` |
| `data/seed.json` | Los 171 juegos del Excel inicial |
| `sw.js`, `manifest.webmanifest` | PWA: instalable y sin conexión |
