// Autochequeo: node test.mjs
import assert from 'node:assert/strict';
import { average, qualityPerHour, toScore10, toHours, fromRawg, fromSteamJuego, estimaHoras, eligeHoras, sortGames, toCsv, stats, platformIndex, filterByPlatform, thumb, parseList } from './lib.js';

// La fórmula del Excel original (fila "Hitman: Sniper Challenge": 8.0 / 7.4 / 2h -> 3.85)
assert.equal(average(8.0, 7.4), 7.7);
assert.equal(qualityPerHour(8.0, 7.4, 2), 3.85);
// Una sola nota disponible: no promedia con cero.
assert.equal(average(9, null), 9);
assert.equal(qualityPerHour(9, null, 3), 3);
// Sin datos no inventa números (ni divide por cero).
assert.equal(average(null, null), null);
assert.equal(qualityPerHour(8, 8, 0), null);
assert.equal(qualityPerHour(8, 8, null), null);
// Entrada del usuario: acepta escala 0-100 y coma decimal.
assert.equal(toScore10('85'), 8.5);
assert.equal(toScore10('8,5'), 8.5);
assert.equal(toScore10(''), null);
assert.equal(toScore10('nada'), null);
assert.equal(toScore10(10), 10);
// Las horas no se reescalan nunca (74 h siguen siendo 74, no 7,4).
assert.equal(toHours('74'), 74);
assert.equal(toHours('2,5'), 2.5);
assert.equal(toHours('0'), null);
assert.equal(toHours(''), null);
assert.equal(toHours('-3'), null);

// Mapeo de RAWG.
const g = fromRawg({
  id: 3498, name: 'GTA V', released: '2013-09-17', metacritic: 92, rating: 4.47, ratings_count: 6000, playtime: 74,
  parent_platforms: [{ platform: { name: 'PC' } }, { platform: { name: 'PlayStation' } }],
  stores: [{ store: { name: 'Steam' } }, { store: { name: 'Epic Games' } }],
  background_image: 'http://img',
});
assert.equal(g.critic, 9.2);
assert.equal(g.user, 8.94);
assert.equal(g.hours, 74);
assert.equal(g.year, 2013);
// La plataforma es una sola (donde lo tienes), no la lista de donde se vende.
assert.equal(g.platform, 'Steam');
assert.equal(g.store, 'Steam, Epic Games');
// Sin tiendas, la plataforma sale de platforms/parent_platforms.
assert.equal(fromRawg({ id: 2, name: 'Y', platforms: [{ platform: { name: 'PlayStation 5' } }] }).platform, 'PlayStation 5');

// La duración medida de IGDB manda sobre la estimación de Steam.
assert.deepEqual(eligeHoras({ normal: 21 }, 38.5), { horas: 21, fuenteHoras: 'igdb' });
// Si IGDB no tiene ese juego, queda la estimación, marcada como tal.
assert.deepEqual(eligeHoras(null, 38.5), { horas: 38.5, fuenteHoras: 'estimacion' });
assert.deepEqual(eligeHoras({ normal: null, completo: 90 }, 38.5), { horas: 38.5, fuenteHoras: 'estimacion' });
// Sin nada, hueco vacío: nunca un número inventado.
assert.deepEqual(eligeHoras(null, null), { horas: null, fuenteHoras: null });

// Duración estimada: percentil 35 de las horas de quien reseña.
// 20 valores de 1 a 20 horas -> indice redondeado 0,35*19 = 7 -> 8 horas.
assert.equal(estimaHoras(Array.from({length:20}, (_, i) => (i + 1) * 60)), 8);
// Las horas vienen en minutos y los ceros no cuentan.
assert.equal(estimaHoras([0, 0, 60, 120]), null);
// Muestra pequeña = ruido: mejor vacío que un número inventado.
assert.equal(estimaHoras([60, 120, 180]), null);
assert.equal(estimaHoras([]), null);
assert.equal(estimaHoras(null), null);

// Ficha de Steam: metacritic a 0-10, % de reseñas como nota de jugadores y
// la mediana de horas tal cual.
const hades = fromSteamJuego({ appid: 1145360, nombre: 'Hades', metacritic: 93, positivo: 0.9799, resenas: 310046, horas: 23.6, anio: 2020, cover: 'x' });
assert.equal(hades.critic, 9.3);
assert.equal(hades.user, 9.8);
assert.equal(hades.hours, 23.6);
assert.equal(hades.platform, 'Steam');
assert.equal(hades.id, 'steam-1145360');
assert.equal(hades.year, 2020);
// Con cuatro reseñas el porcentaje no significa nada: mejor sin nota.
assert.equal(fromSteamJuego({ appid: 1, positivo: 1, resenas: 4 }).user, null);
assert.equal(fromSteamJuego({ appid: 1 }).critic, null);
// Un juego sin reseñas suficientes no inventa duración.
assert.equal(fromSteamJuego({ appid: 1, horas: null }).hours, null);

// Pestañas por plataforma: las más numerosas primero y los huecos agrupados.
const lib2 = [{ name: 'a', platform: 'Steam' }, { name: 'b', platform: 'Steam' }, { name: 'c', platform: 'GOG' }, { name: 'd', platform: null }];
assert.deepEqual(platformIndex(lib2), [
  { name: 'Steam', count: 2 },
  { name: 'GOG', count: 1 },
  { name: 'Sin plataforma', count: 1 },
]);
assert.equal(filterByPlatform(lib2, 'Steam').length, 2);
assert.equal(filterByPlatform(lib2, 'Sin plataforma').length, 1);
assert.equal(filterByPlatform(lib2, null).length, 4);

// Portadas: se pide la versión pequeña, y solo una vez.
assert.equal(thumb('https://media.rawg.io/media/games/x.jpg'), 'https://media.rawg.io/media/resize/420/-/games/x.jpg');
assert.equal(thumb('https://media.rawg.io/media/resize/420/-/games/x.jpg'), 'https://media.rawg.io/media/resize/420/-/games/x.jpg');
assert.equal(thumb(null), null);

// Lista pegada: quita numeración, vacíos y repetidos.
assert.deepEqual(parseList('1. Hollow Knight\n\n2) Celeste\n   \nHOLLOW KNIGHT\nHades'), ['Hollow Knight', 'Celeste', 'Hades']);
// Sin votos de jugadores -> null, no 0.
assert.equal(fromRawg({ id: 1, name: 'X', rating: 0, ratings_count: 0, playtime: 0 }).user, null);
assert.equal(fromRawg({ id: 1, name: 'X', metacritic: null, playtime: 0 }).hours, null);

// Orden: mayor calidad/hora primero y los incompletos al final.
const lib = [
  { name: 'Largo', critic: 9, user: 9, hours: 90 },
  { name: 'Corto', critic: 8, user: 8, hours: 2 },
  { name: 'Sin datos', critic: null, user: null, hours: null },
];
assert.deepEqual(sortGames(lib, 'qph', -1).map((x) => x.name), ['Corto', 'Largo', 'Sin datos']);
assert.deepEqual(sortGames(lib, 'name', 1).map((x) => x.name), ['Corto', 'Largo', 'Sin datos']);

// CSV para Excel español.
const csv = toCsv([{ name: 'Juego; raro', platform: 'PC', store: null, critic: 8, user: 7, hours: 4 }]);
assert.match(csv, /^﻿Nombre del juego;/);
assert.match(csv, /"Juego; raro";PC;;8;7;7,5;4;1,88/);

const s = stats(lib);
assert.equal(s.count, 3);
assert.equal(s.hours, 92);
assert.equal(s.incomplete, 1);

console.log('OK: todas las comprobaciones pasaron');
