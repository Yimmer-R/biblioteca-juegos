# Calidad por hora

Biblioteca de juegos que calcula la **calidad por hora** de cada juego, igual que el Excel
`steam_juegos.xlsx` del que nace: `promedio de notas ÷ duración en horas`.

Funciona en el navegador del ordenador y en el móvil (es una PWA: se puede instalar en la
pantalla de inicio y abrir sin conexión). No tiene servidor ni base de datos: la biblioteca se
guarda en el propio dispositivo.

## Qué hace

- Añadir juegos de **cualquier plataforma**: Steam, Epic, GOG, PlayStation, Xbox, Nintendo,
  Android, iOS o lo que escribas a mano.
- Buscar automáticamente, por cada juego:
  - **nota de críticos** (Metacritic, escalada a 0-10),
  - **nota de jugadores** (votos de usuarios, escalada a 0-10),
  - **duración media en horas**.
- Calcular promedio y **calidad por hora**, y ordenar la biblioteca por cualquier columna.
- Editar a mano cualquier dato (las horas de RAWG son orientativas: ahí es donde más conviene
  corregir).
- Exportar a CSV con las mismas columnas que el Excel original, y guardar/restaurar una copia
  JSON para pasar la biblioteca entre el PC y el móvil.
- Completar en bloque los juegos que no tienen nota o duración.

## Clave de RAWG (gratis)

La búsqueda automática usa [RAWG](https://rawg.io/apidocs), que en una sola consulta cubre PC,
consolas y móvil y devuelve Metacritic, notas de jugadores y horas medias.

1. Entra en <https://rawg.io/apidocs> y crea una cuenta.
2. Copia tu *API key*.
3. En la app: `⋯` → **Clave de RAWG** → pegar → Guardar.

La clave se guarda solo en tu dispositivo (`localStorage`); no se envía a ningún otro sitio.
Sin clave la app funciona igual, pero las notas y las horas las escribes tú.

## Limitaciones conscientes

- La **duración** de RAWG es la media que declaran sus usuarios, en horas enteras, y en juegos
  pequeños suele venir vacía. No es HowLongToBeat (no tiene API pública). Edita el campo a mano
  cuando te importe la precisión.
- La **nota de críticos** es Metacritic; muchos indies no tienen, y entonces el promedio se
  calcula solo con la nota de jugadores.
- SteamDB no tiene API pública; las notas de Steam llegan indirectamente, como notas de
  jugadores de RAWG.
- La biblioteca vive **en cada dispositivo**. Para pasarla del PC al móvil: `⋯` → *Guardar copia
  (JSON)* y luego *Restaurar copia* en el otro.

## Uso local

```bash
python -m http.server 8123
```

Y abre <http://localhost:8123>. Hace falta un servidor (aunque sea este): abrir `index.html` con
doble clic no funciona porque el navegador bloquea los módulos JavaScript en `file://`.

Comprobación de la lógica de cálculo:

```bash
node test.mjs
```

## Archivos

| Archivo | Para qué |
| --- | --- |
| `index.html` | Estructura y diálogos |
| `styles.css` | Estilos (tabla en escritorio, tarjetas en móvil) |
| `lib.js` | Cálculos, mapeo de RAWG, orden y CSV (sin DOM) |
| `app.js` | Estado, render, llamadas a RAWG, importar/exportar |
| `test.mjs` | Autochequeo de `lib.js` |
| `data/seed.json` | Los 171 juegos importados de `steam_juegos.xlsx` |
| `sw.js`, `manifest.webmanifest` | PWA: instalable y sin conexión |
