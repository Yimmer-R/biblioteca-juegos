// Lógica pura: puntuaciones, calidad/hora, mapeo de RAWG, orden y CSV.
// Sin DOM, para poder probarla con `node test.mjs`.

export const round2 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 100) / 100);

// Normaliza a 0-10 lo que escriba el usuario (acepta 85 de Metacritic o 8.5).
export function toScore10(value) {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (value === '' || value == null || Number.isNaN(n)) return null;
  if (n < 0) return null;
  return round2(n > 10 ? n / 10 : n);
}

// Horas: acepta coma decimal, descarta 0 y lo que no sea un numero positivo.
export function toHours(value) {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (value === '' || value == null || Number.isNaN(n) || n <= 0) return null;
  return round2(n);
}

export function average(critic, user) {
  const vals = [critic, user].filter((v) => v != null);
  if (!vals.length) return null;
  return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// La fórmula del Excel original: promedio de notas ÷ horas de duración.
export function qualityPerHour(critic, user, hours) {
  const avg = average(critic, user);
  if (avg == null || !hours || hours <= 0) return null;
  return round2(avg / hours);
}

export function withDerived(game) {
  return { ...game, avg: average(game.critic, game.user), qph: qualityPerHour(game.critic, game.user, game.hours) };
}

// RAWG manda parent_platforms (PC, PlayStation...) y, en algunas respuestas, solo platforms (PS5, PS4...).
const platformsOf = (g) => (g.parent_platforms || g.platforms || []).map((p) => (p.platform ? p.platform.name : p.name)).filter(Boolean);
const storesOf = (g) => (g.stores || []).map((s) => (s.store ? s.store.name : s.name)).filter(Boolean);

// RAWG: metacritic es 0-100 (críticos), rating es 0-5 (jugadores), playtime son horas medias.
export function fromRawg(g) {
  const stores = storesOf(g);
  return {
    id: 'rawg-' + g.id,
    rawgId: g.id,
    name: g.name,
    year: g.released ? Number(g.released.slice(0, 4)) : null,
    // Una biblioteca es personal: el juego esta en UNA plataforma, la tuya.
    // El resto de tiendas donde se vende quedan en `store`, solo informativo.
    platform: stores[0] || platformsOf(g)[0] || null,
    store: stores.join(', ') || null,
    critic: g.metacritic ? round2(g.metacritic / 10) : null,
    user: g.ratings_count ? round2(g.rating * 2) : null,
    hours: g.playtime ? round2(g.playtime) : null,
    cover: g.background_image || null,
  };
}

// Ficha de Steam, sin ninguna clave: metacritic 0-100, el % de resenas
// positivas (la nota de jugadores del propio launcher) y la mediana de horas
// jugadas por quien resena. Menos de 30 resenas no dice nada.
export function fromSteamJuego(d) {
  return {
    id: 'steam-' + d.appid,
    appid: d.appid,
    name: d.nombre,
    platform: 'Steam',
    year: d.anio || null,
    critic: d.metacritic ? round2(d.metacritic / 10) : null,
    user: d.positivo != null && d.resenas >= 30 ? round2(d.positivo * 10) : null,
    hours: d.horas || null,
    cover: d.cover || null,
    rawgId: null,
  };
}

export const SORTS = {
  qph: 'Calidad por hora',
  name: 'Nombre',
  critic: 'Críticos',
  user: 'Jugadores',
  avg: 'Promedio',
  hours: 'Duración',
};

export function sortGames(games, key, dir) {
  const rows = games.map(withDerived);
  return rows.sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name, 'es') * dir;
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return a.name.localeCompare(b.name, 'es');
    if (av == null) return 1; // los vacíos siempre al final
    if (bv == null) return -1;
    return (av - bv) * dir || a.name.localeCompare(b.name, 'es');
  });
}

// Pestanas de plataforma: las que mas juegos tienen primero.
export function platformIndex(games) {
  const counts = new Map();
  for (const g of games) {
    const name = (g.platform || 'Sin plataforma').trim() || 'Sin plataforma';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
}

export function filterByPlatform(games, platform) {
  if (!platform) return games;
  return games.filter((g) => ((g.platform || 'Sin plataforma').trim() || 'Sin plataforma') === platform);
}

// Las portadas de RAWG vienen a 1920px; esta ruta sirve la version pequena.
export function thumb(url) {
  if (!url) return null;
  return url.includes('/media/') && !url.includes('/media/resize/') ? url.replace('/media/', '/media/resize/420/-/') : url;
}

// Una lista pegada por el usuario: un juego por linea, sin numeracion ni vacios.
export function parseList(text) {
  const seen = new Set();
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[\d]+[.)\-\s]+/, '').trim())
    .filter((line) => line.length > 1)
    .filter((line) => {
      const k = dedupeKey(line);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function filterGames(games, query) {
  const q = query.trim().toLowerCase();
  if (!q) return games;
  return games.filter((g) => (g.name + ' ' + (g.platform || '') + ' ' + (g.store || '')).toLowerCase().includes(q));
}

export function stats(games) {
  const rows = games.map(withDerived);
  const hours = rows.reduce((a, g) => a + (g.hours || 0), 0);
  const avgs = rows.map((g) => g.avg).filter((v) => v != null);
  const qphs = rows.map((g) => g.qph).filter((v) => v != null);
  return {
    count: rows.length,
    hours: round2(hours),
    avg: avgs.length ? round2(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null,
    qph: qphs.length ? round2(qphs.reduce((a, b) => a + b, 0) / qphs.length) : null,
    incomplete: rows.filter((g) => g.avg == null || !g.hours).length,
  };
}

// Excel en español: separador ';' y coma decimal.
export function toCsv(games) {
  const head = ['Nombre del juego', 'Plataforma', 'Tienda', 'Puntuación críticos', 'Puntuación usuarios', 'Promedio puntuación', 'Duración (horas)', 'Calidad media por hora'];
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const lines = games.map(withDerived).map((g) => [g.name, g.platform, g.store, g.critic, g.user, g.avg, g.hours, g.qph].map(cell).join(';'));
  return '﻿' + [head.join(';'), ...lines].join('\r\n');
}

export function dedupeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
