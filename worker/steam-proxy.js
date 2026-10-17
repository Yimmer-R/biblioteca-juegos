// Intermediario entre la app y Steam.
//
// Existe por una sola razon: Steam no manda cabeceras CORS, asi que el
// navegador no puede leer sus respuestas directamente. NO guarda ninguna clave:
// buscar, la ficha de un juego y sus resenas son endpoints publicos de Steam.
//
// La unica parte que necesita una clave de Steam es leer la biblioteca privada
// de una cuenta, y esa clave la pone cada persona (cabecera X-Steam-Key): llega
// por HTTPS, se usa para esa peticion y no se guarda en ningun sitio.
//
// Desplegar:  npx wrangler deploy

import { eligeHoras, estimaHoras } from '../lib.js';

const ALLOWED = ['https://yimmer-r.github.io', 'http://localhost:8123'];
const UA = 'calidad-por-hora/1.0 (+https://yimmer-r.github.io/biblioteca-juegos/)';

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'X-Steam-Key',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET') return json({ error: 'metodo_no_permitido' }, 405);

    const url = new URL(req.url);
    try {
      if (url.pathname === '/buscar') return json(...(await buscar(url)));
      if (url.pathname === '/juego') return json(...(await juego(url, env)));
      if (url.pathname === '/biblioteca') return json(...(await biblioteca(url, req)));
      return json({ error: 'ruta_desconocida' }, 404);
    } catch (e) {
      return json({ error: 'fallo_interno' }, 500);
    }
  },
};

const pedir = (u) => fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' } });

/* ---------- IGDB: la duracion de verdad ---------- */
//
// Steam no publica cuanto se tarda en pasarse un juego. IGDB si, en
// game_time_to_beats, y es la unica fuente con API oficial y gratuita. Pide
// credenciales de una aplicacion de Twitch, que viven aqui como secretos.
// Si no estan configuradas, todo sigue funcionando con la estimacion de Steam.

let token = null;
let tokenCaduca = 0;

async function igdbToken(env) {
  if (token && Date.now() < tokenCaduca) return token;
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(env.IGDB_ID)}&client_secret=${encodeURIComponent(env.IGDB_SECRET)}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  const d = await r.json();
  if (!d.access_token) throw new Error('igdb_sin_token');
  token = d.access_token;
  tokenCaduca = Date.now() + (d.expires_in - 600) * 1000; // 10 min de margen
  return token;
}

async function igdb(env, endpoint, query, reintento = true) {
  const r = await fetch('https://api.igdb.com/v4/' + endpoint, {
    method: 'POST',
    headers: { 'Client-ID': env.IGDB_ID, Authorization: 'Bearer ' + (await igdbToken(env)), 'Content-Type': 'text/plain' },
    body: query,
  });
  if (r.status === 401 && reintento) {
    token = null; // el token caduco antes de tiempo
    return igdb(env, endpoint, query, false);
  }
  if (!r.ok) throw new Error('igdb_' + r.status);
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

const aHoras = (segundos) => (segundos ? Math.round((segundos / 3600) * 10) / 10 : null);

async function duracionDeJuegoIgdb(env, gameId) {
  // El campo se llama game_id en unas versiones y game en otras.
  let filas = await igdb(env, 'game_time_to_beats', `fields normally,hastily,completely,count; where game_id = ${gameId}; limit 1;`).catch(() => []);
  if (!filas.length) {
    filas = await igdb(env, 'game_time_to_beats', `fields normally,hastily,completely,count; where game = ${gameId}; limit 1;`).catch(() => []);
  }
  const d = filas[0];
  if (!d) return null;
  return { normal: aHoras(d.normally), rapido: aHoras(d.hastily), completo: aHoras(d.completely), muestra: d.count || 0 };
}

// De un appid de Steam a su ficha en IGDB: coincidencia exacta por
// identificador, sin adivinar por nombre. category = 1 es Steam.
async function duracionPorAppid(env, appid) {
  if (!env.IGDB_ID || !env.IGDB_SECRET) return null;
  try {
    const ext = await igdb(env, 'external_games', `fields game; where category = 1 & uid = "${appid}"; limit 1;`);
    const gameId = ext[0] && (ext[0].game && ext[0].game.id ? ext[0].game.id : ext[0].game);
    return gameId ? await duracionDeJuegoIgdb(env, gameId) : null;
  } catch (e) {
    return null; // sin IGDB se sigue con la estimacion
  }
}

// Buscador de la tienda de Steam. Sin clave.
async function buscar(url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) return [{ error: 'consulta_corta' }, 400];

  const r = await pedir(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=spanish&cc=ES`);
  if (!r.ok) return [{ error: 'steam_' + r.status }, 502];
  const d = await r.json();

  return [
    {
      resultados: (d.items || []).slice(0, 8).map((it) => ({
        appid: it.id,
        nombre: it.name,
        critic: it.metascore ? Number(it.metascore) / 10 : null,
        // La imagen del buscador es diminuta; la de cabecera se ve bien en una tarjeta.
        cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${it.id}/header.jpg`,
      })),
    },
  ];
}

// Ficha + resenas de un juego. Sin clave.
async function juego(url, env) {
  const appid = url.searchParams.get('appid');
  if (!/^\d{1,8}$/.test(appid || '')) return [{ error: 'appid_invalido' }, 400];

  const [det, rev, duracion] = await Promise.all([
    pedir(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,metacritic,genres,release_date&l=spanish&cc=ES`)
      .then((r) => r.json())
      .catch(() => ({})),
    // 'recent' en vez de 'all': las resenas mas utiles son de gente que ha
    // jugado muchisimo y disparan la estimacion de horas.
    pedir(`https://store.steampowered.com/appreviews/${appid}?json=1&num_per_page=100&language=all&purchase_type=all&filter=recent`)
      .then((r) => r.json())
      .catch(() => ({})),
    duracionPorAppid(env, appid),
  ]);

  const data = (det[appid] && det[appid].data) || {};
  const q = rev.query_summary || {};

  // playtime_forever antes que playtime_at_review: mide mejor (ratio 0,91
  // frente a 0,84 contra duraciones conocidas).
  const minutos = (rev.reviews || []).map((r) => (r.author && (r.author.playtime_forever || r.author.playtime_at_review)) || 0);
  const { horas, fuenteHoras } = eligeHoras(duracion, estimaHoras(minutos));

  const anio = (data.release_date && (data.release_date.date || '').match(/\d{4}/)) || null;

  return [
    {
      appid: Number(appid),
      nombre: data.name || null,
      metacritic: (data.metacritic && data.metacritic.score) || null,
      // % de resenas positivas de Steam: la nota de jugadores del propio launcher.
      positivo: q.total_reviews ? q.total_positive / q.total_reviews : null,
      resenas: q.total_reviews || 0,
      horas,
      fuenteHoras,
      duracion,
      muestraHoras: minutos.filter((m) => m > 0).length,
      cover: data.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
      anio: anio ? Number(anio[0]) : null,
    },
  ];
}

// Biblioteca de una cuenta de Steam. Es lo unico que necesita una clave, y la
// pone quien la usa: llega en la cabecera X-Steam-Key y no se guarda.
async function biblioteca(url, req) {
  const key = req.headers.get('X-Steam-Key');
  if (!key) return [{ error: 'falta_clave_usuario' }, 401];

  let steamid = url.searchParams.get('steamid');
  const vanity = url.searchParams.get('vanity');

  if (!steamid && vanity) {
    const r = await pedir(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(vanity)}`
    );
    if (r.status === 403) return [{ error: 'clave_invalida' }, 403];
    const d = await r.json().catch(() => ({}));
    if (!d.response || d.response.success !== 1) return [{ error: 'no_encontrado' }, 404];
    steamid = d.response.steamid;
  }
  if (!/^\d{17}$/.test(steamid || '')) return [{ error: 'no_encontrado' }, 400];

  const r = await pedir(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1&format=json`
  );
  if (r.status === 403) return [{ error: 'clave_invalida' }, 403];
  if (!r.ok) return [{ error: 'steam_' + r.status }, 502];
  const d = await r.json();
  // Steam devuelve un objeto vacio, no un error, cuando el perfil es privado.
  if (!d.response || !d.response.games) return [{ error: 'perfil_privado' }, 403];

  return [
    {
      steamid,
      games: d.response.games.map((g) => ({ appid: g.appid, name: g.name, playtime_forever: g.playtime_forever || 0 })),
    },
  ];
}
