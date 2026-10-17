import {
  SORTS, dedupeKey, filterByPlatform, filterGames, fromRawg, fromSteamJuego, parseList, platformIndex,
  sortGames, stats, thumb, toCsv, toHours, toScore10, withDerived,
} from './lib.js';
import { FIREBASE, STEAM_PROXY } from './config.js';
import { signIn, signOut, watchAuth, pullOnce, pullAnterior, push, watchRemote } from './sync.js';

const STORE_KEY = 'calidad-por-hora/v1';
const $ = (sel) => document.querySelector(sel);

const state = {
  games: [],
  sort: { key: 'qph', dir: -1 },
  query: '',
  platform: null,
  view: localStorage.getItem(STORE_KEY + '/vista') || 'lista',
  apiKey: localStorage.getItem(STORE_KEY + '/rawg') || '',
  steamKey: localStorage.getItem(STORE_KEY + '/steam') || '',
  user: null,
};

/* ---------- almacenamiento ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    toast('No se pudo leer la biblioteca guardada');
  }
  return [];
}

let pushTimer = 0;
function save({ sync = true } = {}) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.games));
  } catch (e) {
    toast('No se pudo guardar: almacenamiento lleno');
  }
  if (sync && state.user) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push(state.user.uid, state.games).catch(() => toast('No se pudo sincronizar')), 1200);
  }
}

function boot() {
  // Cada persona empieza con SU biblioteca, vacia. Los juegos de ejemplo se
  // cargan a mano desde el menu, nunca por defecto.
  state.games = load();
  render();
  if (FIREBASE.apiKey) watchAuth(FIREBASE, onUser);
}

/* ---------- utilidades de presentacion ---------- */

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = (n, d) => (n == null ? '' : n.toLocaleString('es-ES', { maximumFractionDigits: d == null ? 2 : d }));

const scoreClass = (n) => (n == null ? 'empty-val' : n >= 8 ? 'good' : n >= 6 ? 'mid' : 'low');

function num(value, label) {
  const txt = value == null ? '&mdash;' : esc(nf(value, 2));
  return `<span class="cell num ${scoreClass(value)}" data-label="${label}">${txt}</span>`;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  }, 2600);
}

const coverOf = (g) => thumb(g.cover) || (g.appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg` : null);

/* ---------- render ---------- */

function render() {
  const s = stats(state.games);
  $('#stats').innerHTML = [
    ['Juegos', s.count],
    ['Horas totales', nf(s.hours, 0)],
    ['Nota media', s.avg == null ? '&mdash;' : nf(s.avg, 2)],
    ['Calidad/hora media', s.qph == null ? '&mdash;' : nf(s.qph, 2)],
  ]
    .map(([label, value]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`)
    .join('');

  const plats = platformIndex(state.games);
  $('#tabs').innerHTML = state.games.length
    ? `<button class="tab" data-plat="" aria-pressed="${!state.platform}"><b>Todas</b><span>${state.games.length}</span></button>` +
      plats
        .map(
          (p) =>
            `<button class="tab" data-plat="${esc(p.name)}" aria-pressed="${state.platform === p.name}"><b>${esc(p.name)}</b><span>${p.count}</span></button>`
        )
        .join('')
    : '';
  $('#platform-list').innerHTML = plats.map((p) => `<option value="${esc(p.name)}">`).join('');

  const visible = sortGames(filterGames(filterByPlatform(state.games, state.platform), state.query), state.sort.key, state.sort.dir);
  const lista = state.view === 'lista';
  $('#table').hidden = !lista || !visible.length;
  $('#grid').hidden = lista || !visible.length;
  $('#btn-view').innerHTML = lista ? '&#9638;' : '&#9776;';
  $('#btn-view').title = lista ? 'Ver carátulas' : 'Ver lista';

  if (lista) {
    $('#rows').innerHTML = visible
      .map(
        (g) => `<button class="row" data-id="${esc(g.id)}">
        <span class="cell name">
          ${coverOf(g) ? `<img class="cover" src="${esc(coverOf(g))}" alt="" loading="lazy">` : '<span class="cover"></span>'}
          <span class="name-text"><b>${esc(g.name)}</b>${g.year ? `<small>${g.year}</small>` : ''}</span>
        </span>
        <span class="cell plat">${esc(g.platform || '')}</span>
        ${num(g.critic, 'Críticos')}
        ${num(g.user, 'Jugadores')}
        ${num(g.avg, 'Promedio')}
        <span class="cell num ${g.hours ? '' : 'empty-val'}" data-label="Horas">${g.hours ? esc(nf(g.hours, 1)) : '&mdash;'}</span>
        <span class="cell num qph ${g.qph == null ? 'empty-val' : ''}" data-label="Calidad/hora"><b>${g.qph == null ? '&mdash;' : esc(nf(g.qph, 2))}</b></span>
      </button>`
      )
      .join('');
  } else {
    $('#grid').innerHTML = visible
      .map(
        (g) => `<button class="card" data-id="${esc(g.id)}">
        ${coverOf(g) ? `<img class="shot" src="${esc(coverOf(g))}" alt="" loading="lazy">` : '<span class="shot no-shot">SIN CARÁTULA</span>'}
        <span class="badge">${g.qph == null ? '&mdash;' : esc(nf(g.qph, 2))}<small>CAL./HORA</small></span>
        <span class="meta"><b>${esc(g.name)}</b><small>${esc(g.platform || 'Sin plataforma')}${g.hours ? ' &middot; ' + esc(nf(g.hours, 0)) + ' h' : ''}</small></span>
      </button>`
      )
      .join('');
  }

  const hint = $('#hint');
  hint.hidden = visible.length > 0;
  if (!visible.length) {
    hint.innerHTML = state.games.length
      ? 'Ningún juego coincide con ese filtro.'
      : 'Tu biblioteca está vacía.<br>Pulsa <b>+ Juego</b> y escribe el nombre: la app busca nota, duración y carátula sola.';
  }

  for (const th of document.querySelectorAll('#head span')) {
    if (th.dataset.sort === state.sort.key) th.setAttribute('aria-sort', state.sort.dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }

  $('#m-fill-state').textContent = s.incomplete
    ? s.incomplete + ' juegos sin nota o sin duración'
    : state.games.length
      ? 'Todos tus juegos tienen datos'
      : 'Aún no tienes juegos';
  $('#m-key-state').textContent = state.apiKey ? 'Configurada' : 'Opcional: añade consolas y móvil';
  $('#m-steam-state').textContent = state.steamKey ? 'Clave configurada' : 'Necesita tu propia clave de Steam';
  $('#m-account-state').textContent = state.user
    ? 'Sincronizando como ' + state.user.email
    : FIREBASE.apiKey
      ? 'Entra con Google para verla en cualquier dispositivo'
      : 'Sin configurar';
  renderAccount();
}

function renderAccount() {
  const btn = $('#btn-account');
  if (state.user) {
    const letra = (state.user.name || state.user.email || '?').trim()[0].toUpperCase();
    btn.innerHTML = state.user.photo
      ? `<img src="${esc(state.user.photo)}" alt=""><span>${esc((state.user.name || '').split(' ')[0] || 'Cuenta')}</span>`
      : `<span class="avatar-letter">${esc(letra)}</span><span>${esc((state.user.name || '').split(' ')[0] || 'Cuenta')}</span>`;
  } else {
    btn.textContent = 'Entrar';
  }
}

/* ---------- Steam (sin claves) ---------- */

async function steam(path, params, headers) {
  if (!STEAM_PROXY) throw new Error('SIN_PROXY');
  const url = new URL(STEAM_PROXY.replace(/\/$/, '') + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { headers: headers || {} });
  } catch (e) {
    throw new Error('SIN_RED');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'ERROR_' + res.status);
  return data;
}

const buscarSteam = (q) => steam('/buscar', { q }).then((d) => d.resultados || []);
const fichaSteam = (appid) => steam('/juego', { appid }).then(fromSteamJuego);

const steamError = (e) =>
  ({
    SIN_PROXY: 'Falta configurar el intermediario de Steam',
    SIN_RED: 'No se pudo conectar con Steam',
    falta_clave_usuario: 'Hace falta tu clave de Steam',
    clave_invalida: 'Esa clave de Steam no es válida',
    perfil_privado: 'Tu perfil de Steam está en privado: pon "Detalles del juego" en Público',
    no_encontrado: 'No encuentro ese perfil de Steam',
    consulta_corta: 'Escribe al menos 2 letras',
  }[e.message] || 'Steam no respondió (' + e.message + ')');

/* ---------- RAWG (opcional, para consolas y móvil) ---------- */

async function rawg(path, params) {
  if (!state.apiKey) throw new Error('SIN_CLAVE');
  const url = new URL('https://api.rawg.io/api' + path);
  url.searchParams.set('key', state.apiKey);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    // RAWG no manda cabeceras CORS en sus errores 401, asi que una clave mal
    // puesta llega al navegador como un fallo de red, no como un 401.
    throw new Error('SIN_RED');
  }
  if (res.status === 401 || res.status === 403) throw new Error('CLAVE_INVALIDA');
  if (res.status === 429) throw new Error('LIMITE');
  if (!res.ok) throw new Error('ERROR_' + res.status);
  return res.json();
}

const rawgError = (e) =>
  ({
    SIN_CLAVE: 'Para consolas y móvil necesitas una clave de RAWG (menú)',
    CLAVE_INVALIDA: 'La clave de RAWG no es válida',
    SIN_RED: 'No se pudo conectar con RAWG: revisa tu clave o tu conexión',
    LIMITE: 'Demasiadas consultas: espera un momento',
  }[e.message] || 'RAWG no respondió (' + e.message + ')');

const searchRawg = (q) => rawg('/games', { search: q, page_size: 8, search_precise: true }).then((d) => d.results || []);

async function detailRawg(id) {
  try {
    return fromRawg(await rawg('/games/' + id));
  } catch (e) {
    return null;
  }
}

// Busca un juego por nombre en Steam y, si no esta, en RAWG. Solo acepta una
// ficha cuando el nombre coincide: vale mas un hueco vacio que un dato falso.
async function buscarFicha(nombre) {
  try {
    const hit = (await buscarSteam(nombre)).find((r) => dedupeKey(r.nombre) === dedupeKey(nombre));
    if (hit) return await fichaSteam(hit.appid);
  } catch (e) {
    /* si Steam falla, se intenta RAWG */
  }
  if (!state.apiKey) return null;
  const r = (await searchRawg(nombre))[0];
  if (!r || dedupeKey(r.name) !== dedupeKey(nombre)) return null;
  return (await detailRawg(r.id)) || fromRawg(r);
}

/* ---------- añadir ---------- */

const dlgAdd = $('#dlg-add');
let searchTimer = 0;
let searchSeq = 0;

function openAdd() {
  $('#search').value = '';
  $('#results').innerHTML = '<p class="hint">Escribe el nombre de un juego.</p>';
  dlgAdd.showModal();
  $('#search').focus();
}

const manualBtn = (q) =>
  `<button class="result" data-manual="1"><span class="cover"></span><span class="meta"><b>Añadir "${esc(q)}" a mano</b><small>Si no aparece arriba: consola, móvil o un juego muy nuevo</small></span></button>`;

function pintaSteam(resultados) {
  return resultados
    .map(
      (r) => `<button class="result" data-appid="${r.appid}">
        <img class="cover" src="${esc(r.cover)}" alt="" loading="lazy">
        <span class="meta"><b>${esc(r.nombre)}</b><small>Steam</small></span>
        <span class="nums">${r.critic == null ? '' : 'crit. ' + nf(r.critic, 1)}</span>
      </button>`
    )
    .join('');
}

function pintaRawg(juegos) {
  return juegos
    .map(
      (g) => `<button class="result" data-rawg="${g.rawgId}">
        ${g.cover ? `<img class="cover" src="${esc(thumb(g.cover))}" alt="" loading="lazy">` : '<span class="cover"></span>'}
        <span class="meta"><b>${esc(g.name)}</b><small>${esc([g.year, g.platform].filter(Boolean).join(' · ')) || 'Sin plataforma'}</small></span>
        <span class="nums">${g.critic == null ? 'sin nota' : 'crit. ' + nf(g.critic, 1)}<br>${g.hours ? nf(g.hours, 0) + ' h' : 'sin duración'}</span>
      </button>`
    )
    .join('');
}

async function runSearch(q) {
  const seq = ++searchSeq;
  $('#results').innerHTML = '<p class="hint">Buscando...</p>';

  let steamHtml = '';
  let aviso = '';
  try {
    const resultados = await buscarSteam(q);
    if (seq !== searchSeq) return; // una busqueda mas nueva ya respondio
    steamHtml = pintaSteam(resultados);
  } catch (e) {
    if (seq !== searchSeq) return;
    aviso = `<p class="hint">${esc(steamError(e))}</p>`;
  }

  // RAWG solo si hace falta (Steam no lo tiene) y si esta persona tiene clave.
  let rawgHtml = '';
  if (!steamHtml && state.apiKey) {
    try {
      const juegos = (await searchRawg(q)).map(fromRawg);
      if (seq !== searchSeq) return;
      rawgHtml = pintaRawg(juegos);
    } catch (e) {
      if (seq !== searchSeq) return;
      aviso = `<p class="hint">${esc(rawgError(e))}</p>`;
    }
  }

  const sinNada = !steamHtml && !rawgHtml;
  $('#results').innerHTML =
    aviso +
    steamHtml +
    rawgHtml +
    (sinNada && !state.apiKey
      ? '<p class="hint">Sin resultados en Steam. Para juegos de consola o móvil, añade una clave de RAWG en el menú, o añádelo a mano.</p>'
      : '') +
    manualBtn(q);
}

$('#search').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) {
    $('#results').innerHTML = '<p class="hint">Escribe al menos 2 letras.</p>';
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 350);
});

$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length >= 2) runSearch(q);
  }
});

$('#results').addEventListener('click', async (e) => {
  const btn = e.target.closest('.result');
  if (!btn) return;

  if (btn.dataset.manual) {
    dlgAdd.close();
    openEdit({ id: 'man-' + Date.now(), name: $('#search').value.trim(), platform: null, critic: null, user: null, hours: null, cover: null, rawgId: null }, true);
    return;
  }

  btn.disabled = true;
  let juego = null;
  try {
    juego = btn.dataset.appid ? await fichaSteam(Number(btn.dataset.appid)) : await detailRawg(Number(btn.dataset.rawg));
  } catch (err) {
    toast(steamError(err));
  }
  btn.disabled = false;
  if (juego) addGame(juego);
});

function addGame(game) {
  if (state.games.some((g) => dedupeKey(g.name) === dedupeKey(game.name))) {
    toast(game.name + ' ya está en tu biblioteca');
    return;
  }
  state.games.push(game);
  save();
  render();
  const d = withDerived(game);
  if (d.qph != null) {
    toast(`${game.name}: ${nf(d.qph, 2)} de calidad/hora`);
    return;
  }
  // Solo molesta al usuario cuando la busqueda no encontro lo necesario.
  toast(game.name + ': faltan datos, complétalos tú');
  dlgAdd.close();
  openEdit(game, false);
}

/* ---------- editar ---------- */

const dlgEdit = $('#dlg-edit');
let editing = null;
let editingIsNew = false;

function openEdit(game, isNew) {
  editing = game;
  editingIsNew = !!isNew;
  $('#edit-title').textContent = isNew ? 'Añadir a mano' : 'Editar juego';
  const cover = coverOf(game);
  $('#edit-cover').hidden = !cover;
  if (cover) $('#edit-cover').src = cover;
  $('#f-name').value = game.name || '';
  $('#f-platform').value = game.platform || '';
  $('#f-critic').value = game.critic == null ? '' : String(game.critic).replace('.', ',');
  $('#f-user').value = game.user == null ? '' : String(game.user).replace('.', ',');
  $('#f-hours').value = game.hours == null ? '' : String(game.hours).replace('.', ',');
  $('#btn-delete').hidden = !!isNew;
  $('#edit-source').textContent = game.appid
    ? 'Steam: críticos = Metacritic, jugadores = % de reseñas. Horas: ' +
      (game.fuenteHoras === 'igdb'
        ? 'duración medida (IGDB), lo que se tarda a ritmo normal.'
        : 'estimación a partir de quienes reseñan, puede desviarse; corrígela si te importa.')
    : game.rawgId
      ? 'Datos de RAWG: críticos = Metacritic, horas = media de sus usuarios.'
      : '';
  updatePreview();
  dlgEdit.showModal();
}

function readEditForm() {
  return {
    name: $('#f-name').value.trim(),
    platform: $('#f-platform').value.trim() || null,
    critic: toScore10($('#f-critic').value),
    user: toScore10($('#f-user').value),
    hours: toHours($('#f-hours').value),
  };
}

function updatePreview() {
  const f = readEditForm();
  const d = withDerived(f);
  $('#edit-preview').innerHTML =
    d.qph == null
      ? 'Faltan datos para calcular la calidad por hora (necesita al menos una nota y las horas).'
      : `Promedio <b>${nf(d.avg, 2)}</b> &divide; <b>${nf(f.hours, 1)} h</b> = <b>${nf(d.qph, 2)}</b> de calidad por hora`;
}

for (const id of ['#f-critic', '#f-user', '#f-hours']) $(id).addEventListener('input', updatePreview);

$('#btn-save').addEventListener('click', () => {
  const f = readEditForm();
  if (!f.name) {
    toast('Ponle un nombre al juego');
    return;
  }
  const updated = { ...editing, ...f };
  if (editingIsNew) {
    if (state.games.some((g) => dedupeKey(g.name) === dedupeKey(f.name))) {
      toast(f.name + ' ya está en tu biblioteca');
      return;
    }
    state.games.push(updated);
  } else {
    state.games = state.games.map((g) => (g.id === editing.id ? updated : g));
  }
  save();
  render();
  dlgEdit.close();
  toast('Guardado');
});

$('#btn-delete').addEventListener('click', () => {
  if (!confirm('¿Quitar "' + editing.name + '" de tu biblioteca?')) return;
  state.games = state.games.filter((g) => g.id !== editing.id);
  save();
  render();
  dlgEdit.close();
  toast('Eliminado');
});

$('#btn-refetch').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Buscando...';
  try {
    const data = editing.appid ? await fichaSteam(editing.appid) : await buscarFicha($('#f-name').value.trim() || editing.name);
    if (!data) {
      toast('No encuentro ese juego: escribe los datos a mano');
    } else {
      // Nunca borra lo que ya tenias: solo escribe lo que la fuente si conoce.
      if (data.critic != null) $('#f-critic').value = String(data.critic).replace('.', ',');
      if (data.user != null) $('#f-user').value = String(data.user).replace('.', ',');
      if (data.hours != null) $('#f-hours').value = String(data.hours).replace('.', ',');
      if (!$('#f-platform').value.trim() && data.platform) $('#f-platform').value = data.platform;
      editing = { ...editing, appid: data.appid || editing.appid, rawgId: data.rawgId || editing.rawgId, cover: editing.cover || data.cover, year: editing.year || data.year };
      const cover = coverOf(editing);
      $('#edit-cover').hidden = !cover;
      if (cover) $('#edit-cover').src = cover;
      updatePreview();
      toast('Datos encontrados: revisa y guarda');
    }
  } catch (err) {
    toast(steamError(err));
  }
  btn.disabled = false;
  btn.textContent = 'Buscar datos';
});

function openById(id) {
  const game = state.games.find((g) => String(g.id) === id);
  if (game) openEdit(game, false);
}

$('#rows').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (row) openById(row.dataset.id);
});

$('#grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) openById(card.dataset.id);
});

/* ---------- pestañas, vista, orden y filtro ---------- */

$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  state.platform = tab.dataset.plat || null;
  render();
});

$('#btn-view').addEventListener('click', () => {
  state.view = state.view === 'lista' ? 'caratulas' : 'lista';
  localStorage.setItem(STORE_KEY + '/vista', state.view);
  render();
});

$('#sort').innerHTML = Object.entries(SORTS)
  .map(([k, label]) => `<option value="${k}">${label}</option>`)
  .join('');
$('#sort').value = state.sort.key;

$('#sort').addEventListener('change', (e) => {
  state.sort = { key: e.target.value, dir: e.target.value === 'name' ? 1 : -1 };
  render();
});

$('#head').addEventListener('click', (e) => {
  const key = e.target.dataset.sort;
  if (!key) return;
  state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'name' ? 1 : -1 };
  if (key in SORTS) $('#sort').value = key;
  render();
});

$('#q').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

/* ---------- menu ---------- */

$('#btn-add').addEventListener('click', openAdd);
$('#btn-menu').addEventListener('click', () => $('#dlg-menu').showModal());

for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', (e) => e.target.closest('dialog').close());
}

$('#m-key').addEventListener('click', () => {
  $('#dlg-menu').close();
  $('#f-key').value = state.apiKey;
  $('#dlg-key').showModal();
});

$('#btn-key-save').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  state.apiKey = $('#f-key').value.trim();
  localStorage.setItem(STORE_KEY + '/rawg', state.apiKey);
  render();
  if (!state.apiKey) {
    $('#dlg-key').close();
    toast('Clave borrada');
    return;
  }
  // Una clave de RAWG son 32 caracteres hexadecimales. El fallo mas comun es
  // copiarla a medias, y como RAWG contesta 401 sin cabeceras CORS, el
  // navegador lo ensena como "error de red" y no se entiende nada.
  if (!/^[0-9a-f]{32}$/i.test(state.apiKey)) {
    toast(`Esa clave tiene ${state.apiKey.length} caracteres y deberían ser 32: cópiala entera`);
  }
  btn.disabled = true;
  btn.textContent = 'Comprobando...';
  try {
    await rawg('/games', { search: 'portal', page_size: 1 });
    $('#dlg-key').close();
    toast('Clave guardada: RAWG responde');
  } catch (err) {
    toast(rawgError(err));
  }
  btn.disabled = false;
  btn.textContent = 'Guardar';
});

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

$('#m-csv').addEventListener('click', () => {
  download('biblioteca-juegos-' + today() + '.csv', toCsv(sortGames(state.games, state.sort.key, state.sort.dir)), 'text/csv;charset=utf-8');
  $('#dlg-menu').close();
});

$('#m-json').addEventListener('click', () => {
  download('biblioteca-juegos-' + today() + '.json', JSON.stringify(state.games), 'application/json');
  $('#dlg-menu').close();
});

$('#m-import').addEventListener('click', () => $('#file').click());

$('#m-anterior').addEventListener('click', async () => {
  if (!state.user) {
    toast('Entra con Google para ver tu copia anterior');
    return;
  }
  try {
    const previa = await pullAnterior(state.user.uid);
    if (!previa) {
      toast('No hay ninguna versión anterior guardada');
      return;
    }
    const cuando = previa.actualizado ? new Date(previa.actualizado).toLocaleString('es-ES') : 'antes del último cambio';
    if (!confirm(`La copia anterior tiene ${previa.games.length} juegos (${cuando}).\n\n¿Recuperarla y sustituir los ${state.games.length} de ahora?`)) return;
    state.games = previa.games;
    save();
    render();
    $('#dlg-menu').close();
    toast(state.games.length + ' juegos recuperados');
  } catch (e) {
    toast('No se pudo leer la copia anterior');
  }
});

$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data) || !data.every((g) => g && typeof g.name === 'string')) throw new Error('formato');
    if (state.games.length && !confirm('¿Sustituir tus ' + state.games.length + ' juegos por los ' + data.length + ' de la copia?')) return;
    state.games = data.map((g, i) => ({ id: g.id || 'imp-' + i, ...g }));
    save();
    render();
    $('#dlg-menu').close();
    toast(state.games.length + ' juegos restaurados');
  } catch (err) {
    toast('Ese archivo no es una copia válida');
  }
  e.target.value = '';
});

$('#m-ejemplo').addEventListener('click', async () => {
  if (state.games.length && !confirm('Se añadirán los juegos de ejemplo que no tengas ya. ¿Seguir?')) return;
  try {
    const ejemplo = await (await fetch('data/seed.json')).json();
    let nuevos = 0;
    for (const g of ejemplo) {
      if (state.games.some((x) => dedupeKey(x.name) === dedupeKey(g.name))) continue;
      state.games.push(g);
      nuevos++;
    }
    save();
    render();
    $('#dlg-menu').close();
    toast(nuevos + ' juegos de ejemplo añadidos');
  } catch (e) {
    toast('No se pudo cargar el ejemplo');
  }
});

/* ---------- importar pegando una lista ---------- */

let importing = false;

$('#m-paste').addEventListener('click', () => {
  $('#dlg-menu').close();
  $('#f-paste').value = '';
  $('#paste-progress').hidden = true;
  $('#btn-paste-go').textContent = 'Importar';
  $('#dlg-paste').showModal();
});

$('#btn-paste-stop').addEventListener('click', () => {
  importing = false;
  $('#dlg-paste').close();
});

$('#btn-paste-go').addEventListener('click', async (e) => {
  if (importing) {
    importing = false;
    return;
  }
  const nombres = parseList($('#f-paste').value);
  if (!nombres.length) {
    toast('Pega al menos un nombre');
    return;
  }
  const plataforma = $('#f-paste-plat').value.trim() || null;
  const btn = e.currentTarget;
  const prog = $('#paste-progress');
  prog.hidden = false;
  importing = true;
  btn.textContent = 'Detener';
  let nuevos = 0;
  let repetidos = 0;
  for (const [i, nombre] of nombres.entries()) {
    if (!importing) break;
    prog.textContent = `${i + 1} de ${nombres.length}: ${nombre}`;
    if (state.games.some((g) => dedupeKey(g.name) === dedupeKey(nombre))) {
      repetidos++;
      continue;
    }
    let datos = null;
    try {
      datos = await buscarFicha(nombre);
    } catch (err) {
      /* un fallo puntual no debe cortar la importacion entera */
    }
    state.games.push(
      datos
        ? { ...datos, platform: plataforma || datos.platform }
        : { id: 'lista-' + Date.now() + '-' + i, name: nombre, platform: plataforma, critic: null, user: null, hours: null, cover: null, rawgId: null }
    );
    nuevos++;
    if (nuevos % 5 === 0) save({ sync: false });
    await new Promise((r) => setTimeout(r, 250)); // no castigar a las APIs
  }
  importing = false;
  save();
  render();
  btn.textContent = 'Importar';
  prog.textContent = `Listo: ${nuevos} juegos añadidos${repetidos ? ', ' + repetidos + ' ya los tenías' : ''}.`;
  toast(nuevos + ' juegos añadidos');
});

/* ---------- traer la biblioteca de Steam ---------- */

$('#m-steam').addEventListener('click', () => {
  $('#dlg-menu').close();
  $('#f-steam-key').value = state.steamKey;
  $('#steam-progress').hidden = true;
  $('#dlg-steam').showModal();
});

// Acepta el enlace completo del perfil, el /id/nombre o el nombre a secas.
function parseSteamProfile(raw) {
  const txt = raw.trim();
  const porId = txt.match(/profiles\/(\d{17})/) || txt.match(/^(\d{17})$/);
  if (porId) return { steamid: porId[1] };
  const porNombre = txt.match(/\/id\/([^/?#]+)/) || txt.match(/^([A-Za-z0-9_-]{2,64})$/);
  return porNombre ? { vanity: porNombre[1] } : null;
}

$('#btn-steam-go').addEventListener('click', async (e) => {
  if (filling) {
    filling = false; // el boton hace de "Detener" mientras rellena
    return;
  }
  const perfil = parseSteamProfile($('#f-steam').value);
  const clave = $('#f-steam-key').value.trim();
  if (!clave) {
    toast('Pega tu clave de Steam');
    return;
  }
  if (!perfil) {
    toast('Pega el enlace de tu perfil de Steam');
    return;
  }
  state.steamKey = clave;
  localStorage.setItem(STORE_KEY + '/steam', clave);

  const btn = e.currentTarget;
  const prog = $('#steam-progress');
  prog.hidden = false;
  prog.textContent = 'Pidiendo tu biblioteca a Steam...';
  btn.disabled = true;
  try {
    const data = await steam('/biblioteca', perfil, { 'X-Steam-Key': clave });
    const juegos = data.games || [];
    const nuevos = [];
    for (const j of juegos) {
      if (state.games.some((g) => g.appid === j.appid || dedupeKey(g.name) === dedupeKey(j.name))) continue;
      // Las horas que ha jugado esta persona NO son la duracion del juego:
      // la duracion se busca abajo, igual que para cualquier otro juego.
      const juego = { id: 'steam-' + j.appid, appid: j.appid, name: j.name, platform: 'Steam', critic: null, user: null, hours: null, cover: null, rawgId: null };
      state.games.push(juego);
      nuevos.push(juego);
    }
    save();
    render();
    toast(nuevos.length + ' juegos traídos de Steam');

    if (!nuevos.length) {
      prog.textContent = `${juegos.length} juegos en tu cuenta y ya los tenías todos.`;
      btn.disabled = false;
      return;
    }

    // Sin esto el usuario se queda con una lista de nombres vacios.
    btn.textContent = 'Detener';
    btn.disabled = false;
    filling = true;
    const { encontrados } = await completarDatos(nuevos, (t) => {
      prog.textContent = 'Buscando notas y duración... ' + t;
    });
    filling = false;
    btn.textContent = 'Traer mi biblioteca';
    prog.textContent = `Listo: ${nuevos.length} juegos nuevos, ${encontrados} con nota y duración.`;
  } catch (err) {
    prog.textContent = steamError(err);
    btn.disabled = false;
    return;
  }
  btn.disabled = false;
});

/* ---------- completar datos que faltan ---------- */

let filling = false;
const needsData = (g) => g.critic == null || g.user == null || !g.hours;

// Rellena los huecos de una lista de juegos. Lo usan el boton del menu y, sin
// que haya que pedirlo, la importacion de Steam: traer 200 juegos vacios y
// dejarlos ahi no le sirve a nadie.
async function completarDatos(pendientes, progreso) {
  let hechos = 0;
  let encontrados = 0;
  for (const game of pendientes) {
    if (!filling) break;
    progreso(`${hechos + 1} de ${pendientes.length}: ${game.name}`);
    try {
      const data = game.appid ? await fichaSteam(game.appid) : await buscarFicha(game.name);
      if (data) {
        const patch = {};
        if (game.critic == null && data.critic != null) patch.critic = data.critic;
        if (game.user == null && data.user != null) patch.user = data.user;
        if (!game.hours && data.hours) patch.hours = data.hours;
        if (!game.cover && data.cover) patch.cover = data.cover;
        if (!game.platform && data.platform) patch.platform = data.platform;
        if (Object.keys(patch).length) {
          Object.assign(game, patch, { appid: game.appid || data.appid, rawgId: game.rawgId || data.rawgId, year: game.year || data.year });
          encontrados++;
        }
      }
    } catch (e) {
      // Un juego que falla no corta la tanda: Steam devuelve fichas vacias a menudo.
      if (e.message === 'SIN_RED' || e.message === 'SIN_PROXY') {
        progreso(steamError(e));
        break;
      }
    }
    hechos++;
    if (hechos % 10 === 0) {
      save({ sync: false });
      render();
    }
    // Steam corta a las ~200 consultas por 5 minutos, y ese limite es por IP
    // del intermediario: lo comparten todos los que usen la app.
    await new Promise((r) => setTimeout(r, 1200));
  }
  save();
  render();
  return { hechos, encontrados };
}

$('#m-fill').addEventListener('click', () => {
  $('#dlg-menu').close();
  const pending = state.games.filter(needsData);
  $('#fill-text').textContent = pending.length
    ? pending.length + ' juegos sin nota o sin duración. Se buscarán uno a uno (unos ' + Math.ceil(pending.length * 0.8) + ' segundos).'
    : 'Todos tus juegos tienen nota y duración.';
  $('#btn-fill-start').disabled = !pending.length;
  $('#btn-fill-start').textContent = 'Empezar';
  $('#dlg-fill').showModal();
});

$('#btn-fill-stop').addEventListener('click', () => {
  filling = false;
  $('#dlg-fill').close();
});

$('#btn-fill-start').addEventListener('click', async () => {
  if (filling) {
    filling = false;
    return;
  }
  filling = true;
  const btn = $('#btn-fill-start');
  btn.textContent = 'Detener';
  const pending = state.games.filter(needsData);
  const { encontrados } = await completarDatos(pending, (t) => {
    $('#fill-text').textContent = t;
  });
  filling = false;
  btn.textContent = 'Empezar';
  btn.disabled = !state.games.some(needsData);
  $('#fill-text').textContent = `Listo: ${encontrados} de ${pending.length} juegos completados.`;
  toast(encontrados + ' juegos completados');
});

/* ---------- cuenta y sincronizacion ---------- */

function openAccount() {
  const body = $('#account-body');
  if (!FIREBASE.apiKey) {
    body.innerHTML = '<p class="hint" style="padding:8px 0">Esta copia de la app no tiene sincronización configurada.</p>';
    $('#btn-signin').hidden = true;
    $('#btn-signout').hidden = true;
  } else if (state.user) {
    body.innerHTML = `<p style="margin:0 0 6px"><b>${esc(state.user.name || state.user.email)}</b></p><p class="note" style="margin:0">${esc(state.user.email)}</p>`;
    $('#account-note').textContent = 'Tu biblioteca se guarda en tu cuenta y se actualiza sola en todos tus dispositivos. Gana siempre el último cambio.';
    $('#btn-signin').hidden = true;
    $('#btn-signout').hidden = false;
  } else {
    body.innerHTML = '<p class="hint" style="padding:8px 0">Entra con tu cuenta de Google para tener la misma biblioteca en el móvil y en el ordenador. Cada persona ve solo la suya.</p>';
    $('#account-note').textContent = 'Solo se guardan tus juegos y tu correo. Nadie más puede leerlos.';
    $('#btn-signin').hidden = false;
    $('#btn-signout').hidden = true;
  }
  $('#dlg-account').showModal();
}

$('#btn-account').addEventListener('click', openAccount);
$('#m-account').addEventListener('click', () => {
  $('#dlg-menu').close();
  openAccount();
});

$('#btn-signin').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  try {
    await signIn(FIREBASE);
  } catch (err) {
    toast('No se pudo entrar: ' + err.message);
  }
  e.currentTarget.disabled = false;
});

$('#btn-signout').addEventListener('click', async () => {
  await signOut();
  $('#dlg-account').close();
  toast('Sesión cerrada: la biblioteca sigue en este dispositivo');
});

let unwatchRemote = null;

async function onUser(user) {
  state.user = user;
  render();
  if (unwatchRemote) {
    unwatchRemote();
    unwatchRemote = null;
  }
  if (!user) return;
  $('#dlg-account').close();
  try {
    const remoto = await pullOnce(user.uid);
    if (!remoto) {
      await push(user.uid, state.games);
      if (state.games.length) toast('Biblioteca subida a tu cuenta');
    } else if (JSON.stringify(remoto) !== JSON.stringify(state.games)) {
      const usarNube =
        !state.games.length ||
        confirm(
          `Tu cuenta tiene ${remoto.length} juegos guardados y este dispositivo tiene ${state.games.length}.\n\nAceptar = usar los de tu cuenta.\nCancelar = subir los de este dispositivo.`
        );
      if (usarNube) {
        state.games = remoto;
        save({ sync: false });
      } else {
        await push(user.uid, state.games);
      }
      render();
    }
    unwatchRemote = watchRemote(user.uid, (juegos) => {
      if (JSON.stringify(juegos) === JSON.stringify(state.games)) return;
      state.games = juegos;
      save({ sync: false });
      render();
      toast('Biblioteca actualizada desde tu cuenta');
    });
  } catch (err) {
    toast('No se pudo sincronizar: ' + err.message);
  }
}

/* ---------- arranque ---------- */

boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
