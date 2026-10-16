// Autochequeo: node test.mjs
import assert from 'node:assert/strict';
import { average, qualityPerHour, toScore10, toHours, fromRawg, sortGames, toCsv, stats } from './lib.js';

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
assert.equal(g.platform, 'PC, PlayStation');
assert.equal(g.store, 'Steam, Epic Games');
// Si RAWG no manda parent_platforms, tira de platforms.
assert.equal(fromRawg({ id: 2, name: 'Y', platforms: [{ platform: { name: 'PlayStation 5' } }] }).platform, 'PlayStation 5');
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
