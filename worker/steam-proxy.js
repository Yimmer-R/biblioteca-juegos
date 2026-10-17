// Intermediario entre la app y Steam.
//
// Existe por dos razones: Steam no manda cabeceras CORS (el navegador no puede
// leer sus respuestas) y la clave de la Web API de Steam no puede viajar al
// navegador. Aqui vive como secreto (STEAM_KEY) y nunca sale.
//
// Desplegar:  npx wrangler deploy
// Clave:      npx wrangler secret put STEAM_KEY

const ALLOWED = ['https://yimmer-r.github.io', 'http://localhost:8123'];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      Vary: 'Origin',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET') return json({ error: 'metodo_no_permitido' }, 405);
    if (!env.STEAM_KEY) return json({ error: 'falta_clave_steam' }, 500);

    const url = new URL(req.url);
    try {
      if (url.pathname === '/biblioteca') return json(...(await biblioteca(url, env)));
      if (url.pathname === '/juego') return json(...(await juego(url)));
      return json({ error: 'ruta_desconocida' }, 404);
    } catch (e) {
      return json({ error: 'fallo_interno' }, 500);
    }
  },
};

async function biblioteca(url, env) {
  let steamid = url.searchParams.get('steamid');
  const vanity = url.searchParams.get('vanity');

  if (!steamid && vanity) {
    const r = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${env.STEAM_KEY}&vanityurl=${encodeURIComponent(vanity)}`
    );
    const d = await r.json();
    if (!d.response || d.response.success !== 1) return [{ error: 'no_encontrado' }, 404];
    steamid = d.response.steamid;
  }
  if (!/^\d{17}$/.test(steamid || '')) return [{ error: 'no_encontrado' }, 400];

  const r = await fetch(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${env.STEAM_KEY}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1&format=json`
  );
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

async function juego(url) {
  const appid = url.searchParams.get('appid');
  if (!/^\d{1,8}$/.test(appid || '')) return [{ error: 'appid_invalido' }, 400];

  const [det, rev] = await Promise.all([
    fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,metacritic`).then((r) => r.json()).catch(() => ({})),
    fetch(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`)
      .then((r) => r.json())
      .catch(() => ({})),
  ]);

  const data = (det[appid] && det[appid].data) || {};
  const q = rev.query_summary || {};
  return [
    {
      appid: Number(appid),
      nombre: data.name || null,
      metacritic: (data.metacritic && data.metacritic.score) || null,
      // % de reseñas positivas de Steam: la nota de jugadores mas honesta que hay.
      positivo: q.total_reviews ? q.total_positive / q.total_reviews : null,
      resenas: q.total_reviews || 0,
      cover: data.header_image || null,
    },
  ];
}
