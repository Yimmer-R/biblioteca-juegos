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

| Dato | Fuente | Detalle |
| --- | --- | --- |
| Nota de críticos | Metacritic vía RAWG, o vía Steam si el juego es de Steam | Escala 0-10 |
| Nota de jugadores | RAWG, o el **% de reseñas positivas de Steam** | Steam solo cuenta si hay 30 reseñas o más |
| Duración media | RAWG (`playtime`) | Horas enteras; en juegos pequeños suele venir vacía |
| Carátula | RAWG, o la imagen oficial de Steam | |
| Tu biblioteca de Steam | Steam Web API, a través del Worker | Incluye tus horas jugadas |

Lo que **no** se puede hacer, y por qué:

- **Epic Games y GOG no tienen API pública** para leer tu biblioteca. Solo existen
  librerías no oficiales que piden tus credenciales. Para esas plataformas usa
  *Importar lista de juegos*.
- **SteamDB no tiene API pública**. Las notas de jugadores de Steam llegan por el
  endpoint oficial de reseñas, que es la misma información de base.
- **HowLongToBeat tampoco tiene API**, así que la duración es la de RAWG. Si te
  importa la precisión, edita las horas a mano: es un campo editable.

## Puesta en marcha

### 1. Clave de RAWG (gratis, obligatoria para la búsqueda automática)

1. Entra en <https://rawg.io/apidocs>, crea una cuenta y copia tu *API key*.
   Son **32 caracteres hexadecimales**: cópiala entera.
2. En la app: **☰ → Clave de RAWG** → pegar → Guardar. La app hace una consulta de
   prueba y te dice si responde.

La clave se guarda solo en tu dispositivo.

> Si la clave está mal, RAWG contesta `401` **sin cabeceras CORS**, y el navegador
> lo enseña como un error de red. Por eso la app comprueba la longitud y hace una
> consulta de prueba al guardarla.

### 2. Sincronización con Google (opcional)

1. Crea un proyecto en <https://console.firebase.google.com>.
2. **Authentication → Google → Habilitar**, y añade tu dominio en
   *Authentication → Settings → Dominios autorizados*.
3. **Firestore Database → Crear**, y pega el contenido de [`firestore.rules`](firestore.rules)
   en la pestaña *Reglas*.
4. Registra una app **Web** y copia el `firebaseConfig` en [`config.js`](config.js).

Cada biblioteca se guarda en `bibliotecas/{uid}` y solo la puede leer su dueño.
Gana siempre el último cambio.

### 3. Conectar con Steam (opcional)

Steam no manda cabeceras CORS y su clave no puede viajar al navegador, así que hace
falta un intermediario. Está en [`worker/`](worker/) y es un Worker de Cloudflare
(plan gratuito, sin tarjeta):

```bash
cd worker
npx wrangler deploy
npx wrangler secret put STEAM_KEY
```

Luego pon la URL que te dé Cloudflare en `STEAM_PROXY`, en [`config.js`](config.js).
Tu clave de Steam se saca en <https://steamcommunity.com/dev/apikey> y **solo** vive
dentro del Worker.

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
