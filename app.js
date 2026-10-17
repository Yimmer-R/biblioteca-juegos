import {
  SORTS, dedupeKey, filterByPlatform, filterGames, fromRawg, fromSteam, parseList, platformIndex,
  sortGames, stats, thumb, toCsv, toHours, toScore10, withDerived,
} from './lib.js';
import { FIREBASE, STEAM_PROXY } from './config.js';
import { signIn, signOut, watchAuth, pullOnce, push, watchRemote } from './sync.js';

const STORE_KEY = 'calidad-por-hora/v1';
const $ = (sel) => document.querySelector(sel);

const state = {
  games: [],
  sort: { key: 'qph', dir: -1 },
  query: '',
  platform: null,
  view: localStorage.getItem(STORE_KEY + '/vista') || 'lista',
  apiKey: localStorage.getItem(STORE_KEY + '/rawg') || '',
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
  return null;
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

async function boot() {
  const saved = load();
  if (saved) {
    state.games = saved;
  } else if (!localStorage.getItem(STORE_KEY + '/seeded')) {
    try {
      const res = await fetch('data/seed.json');
      state.games = await res.json();
      localStorage.setItem(STORE_KEY + '/seeded', '1');
      save({ sync: false });
      toast(state.games.length + ' juegos importados de tu Excel');
    } catch (e) {
      state.games = [];
    }
  }
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

function visibleGames() {
  return sortGames(filterGames(filterByPlatform(state.games, state.platform), state.query), state.sort.key, state.sort.dir);
}

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
  $('#tabs').innerHTML =
    `<button class="tab" data-plat="" aria-pressed="${!state.platform}"><b>Todas</b><span>${state.games.length}</span></button>` +
    plats
      .map(
        (p) =>
          `<button class="tab" data-plat="${esc(p.name)}" aria-pressed="${state.platform === p.name}"><b>${esc(p.name)}</b><span>${p.count}</span></button>`
      )
      .join('');
  $('#platform-list').innerHTML = plats.map((p) => `<option value="${esc(p.name)}">`).join('');

  const visible = visibleGames();
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
    hint.textContent = state.games.length
      ? 'Ningún juego coincide con ese filtro.'
      : 'Tu biblioteca está vacía. Pulsa "+ Juego" para empezar.';
  }

  for (const th of document.querySelectorAll('#head span')) {
    if (th.dataset.sort === state.sort.key) th.setAttribute('aria-sort', state.sort.dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }

  $('#m-fill-state').textContent = s.incomplete
    ? s.incomplete + ' juegos sin nota o sin duración'
    : 'Todos tus juegos tienen datos';
  $('#m-key-state').textContent = state.apiKey ? 'Configurada' : 'Sin configurar: la búsqueda automática no funciona';
  $('#m-steam-state').textContent = STEAM_PROXY ? 'Trae tu biblioteca con tus horas jugadas' : 'Falta configurar el intermediario';
  $('#m-account-state').textContent = state.user
    ? 'Sincronizando como ' + state.user.email
    : FIREBASE.apiKey
      ? 'Entra con Google para verla en cualquier dispositivo'
      : 'Falta configurar Firebase';
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

/* ---------- RAWG ---------- */

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
    SIN_CLAVE: 'Configura tu clave de RAWG en el menú',
    CLAVE_INVALIDA: 'La clave de RAWG no es válida',
    SIN_RED: 'No se pudo conectar con RAWG: revisa tu clave o tu conexión',
    LIMITE: 'Demasiadas consultas: espera un momento',
  }[e.message] || 'RAWG no respondió (' + e.message + ')');

const searchRawg = (q) => rawg('/games', { search: q, page_size: 8, search_precise: true }).then((d) => d.results || []);

// El detalle trae metacritic y tiendas completos; la lista a veces no.
async function detailRawg(id) {
  try {
    return fromRawg(await rawg('/games/' + id));
  } catch (e) {
    return null;
  }
}

// Busca un juego por nombre y devuelve sus datos solo si el nombre coincide.
async function lookup(name) {
  const hit = (await searchRawg(name))[0];
  if (!hit) return null;
  const data = (await detailRawg(hit.id)) || fromRawg(hit);
  return dedupeKey(data.name) === dedupeKey(name) ? data : { ...data, dudoso: true };
}

/* ---------- Steam ---------- */

async function steam(path, params) {
  if (!STEAM_PROXY) throw new Error('SIN_PROXY');
  const url = new URL(STEAM_PROXY.replace(/\/$/, '') + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('SIN_RED');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'ERROR_' + res.status);
  return data;
}

/* ---------- añadir ---------- */

const dlgAdd = $('#dlg-add');
let searchTimer = 0;
let searchSeq = 0;

function openAdd() {
  $('#search').value = '';
  $('#results').innerHTML = state.apiKey
    ? '<p class="hint">Escribe el nombre de un juego.</p>'
    : '<p class="hint">Sin clave de RAWG solo puedes añadir a mano.<br>Escribe el nombre y pulsa "Añadir a mano".</p>';
  dlgAdd.showModal();
  $('#search').focus();
}

async function runSearch(q) {
  const seq = ++searchSeq;
  const manual = `<button class="result" data-manual="1"><span class="cover"></span><span class="meta"><b>Añadir "${esc(q)}" a mano</b><small>Tú escribes las notas y las horas</small></span></button>`;
  if (!state.apiKey) {
    $('#results').innerHTML = manual;
    return;
  }
  $('#results').innerHTML = '<p class="hint">Buscando...</p>';
  try {
    const results = await searchRawg(q);
    if (seq !== searchSeq) return; // una busqueda mas nueva ya respondio
    $('#results').innerHTML =
      results
        .map(fromRawg)
        .map(
          (g) => `<button class="result" data-rawg="${g.rawgId}">
            ${g.cover ? `<img class="cover" src="${esc(thumb(g.cover))}" alt="" loading="lazy">` : '<span class="cover"></span>'}
            <span class="meta"><b>${esc(g.name)}</b><small>${esc([g.year, g.platform].filter(Boolean).join(' · ')) || 'Sin plataforma'}</small></span>
            <span class="nums">${g.critic == null ? 'sin nota' : 'crit. ' + nf(g.critic, 1)}<br>${g.hours ? nf(g.hours, 0) + ' h' : 'sin duración'}</span>
          </button>`
        )
        .join('') + manual;
  } catch (e) {
    if (seq !== searchSeq) return;
    $('#results').innerHTML = `<p class="hint">${esc(rawgError(e))}</p>` + manual;
  }
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
  const game = await detailRawg(Number(btn.dataset.rawg));
  btn.disabled = false;
  if (!game) {
    toast('No se pudieron traer los datos de ese juego');
    return;
  }
  addGame(game);
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
  toast(d.qph != null ? `${game.name}: ${nf(d.qph, 2)} de calidad/hora` : `${game.name} añadido: faltan datos, toca la fila`);
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
  $('#edit-source').textContent = [
    game.rawgId ? 'Datos de RAWG (críticos = Metacritic).' : '',
    game.appid ? 'Juego de Steam (' + game.appid + ').' : '',
    game.store && game.store !== game.platform ? 'También se vende en: ' + game.store + '.' : '',
  ]
    .filter(Boolean)
    .join(' ');
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
    const data = await lookup($('#f-name').value.trim() || editing.name);
    if (!data) {
      toast('RAWG no tiene ese juego');
    } else {
      // Nunca borra lo que ya tenias: solo escribe lo que RAWG si conoce.
      if (data.critic != null) $('#f-critic').value = String(data.critic).replace('.', ',');
      if (data.user != null) $('#f-user').value = String(data.user).replace('.', ',');
      if (data.hours != null) $('#f-hours').value = String(data.hours).replace('.', ',');
      if (!$('#f-platform').value.trim() && data.platform) $('#f-platform').value = data.platform;
      editing = { ...editing, rawgId: data.rawgId, cover: editing.cover || data.cover, year: data.year, store: data.store };
      const cover = coverOf(editing);
      $('#edit-cover').hidden = !cover;
      if (cover) $('#edit-cover').src = cover;
      $('#edit-source').textContent = 'Datos de RAWG para "' + data.name + '".' + (data.dudoso ? ' Ojo: el nombre no coincide exacto.' : '');
      updatePreview();
      toast('Datos actualizados: revisa y guarda');
    }
  } catch (err) {
    toast(rawgError(err));
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
  // Se prueba al guardar: si la clave esta mal, el navegador solo ve un fallo
  // de red, asi que mejor avisar aqui que dejar la busqueda muda.
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

$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data) || !data.every((g) => g && typeof g.name === 'string')) throw new Error('formato');
    if (!confirm('¿Sustituir tus ' + state.games.length + ' juegos por los ' + data.length + ' de la copia?')) return;
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
    if (state.apiKey) {
      try {
        datos = await lookup(nombre);
      } catch (err) {
        prog.textContent = rawgError(err);
        break;
      }
    }
    const juego = datos && !datos.dudoso
      ? { ...datos, platform: plataforma || datos.platform }
      : { id: 'lista-' + Date.now() + '-' + i, name: nombre, platform: plataforma, critic: null, user: null, hours: null, cover: null, rawgId: null };
    state.games.push(juego);
    nuevos++;
    if (nuevos % 5 === 0) save({ sync: false });
    if (state.apiKey) await new Promise((r) => setTimeout(r, 250)); // no castigar la API gratuita
  }
  importing = false;
  save();
  render();
  btn.textContent = 'Importar';
  prog.textContent = `Listo: ${nuevos} juegos añadidos${repetidos ? ', ' + repetidos + ' ya los tenías' : ''}.`;
  toast(nuevos + ' juegos añadidos');
});

/* ---------- conectar con Steam ---------- */

$('#m-steam').addEventListener('click', () => {
  $('#dlg-menu').close();
  if (!STEAM_PROXY) {
    toast('Falta configurar el intermediario de Steam');
    return;
  }
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
  const perfil = parseSteamProfile($('#f-steam').value);
  if (!perfil) {
    toast('Pega el enlace de tu perfil de Steam');
    return;
  }
  const btn = e.currentTarget;
  const prog = $('#steam-progress');
  prog.hidden = false;
  prog.textContent = 'Pidiendo tu biblioteca a Steam...';
  btn.disabled = true;
  try {
    const data = await steam('/biblioteca', perfil);
    const juegos = data.games || [];
    let nuevos = 0;
    for (const j of juegos) {
      if (state.games.some((g) => g.appid === j.appid || dedupeKey(g.name) === dedupeKey(j.name))) continue;
      state.games.push({
        id: 'steam-' + j.appid,
        appid: j.appid,
        name: j.name,
        platform: 'Steam',
        critic: null,
        user: null,
        hours: null,
        jugadas: j.playtime_forever ? Math.round((j.playtime_forever / 60) * 10) / 10 : null,
        cover: null,
        rawgId: null,
      });
      nuevos++;
    }
    save();
    render();
    prog.textContent = `${juegos.length} juegos en tu cuenta de Steam, ${nuevos} nuevos. Ahora usa "Completar datos que faltan" para las notas y la duración.`;
    toast(nuevos + ' juegos traídos de Steam');
  } catch (err) {
    prog.textContent =
      err.message === 'SIN_RED'
        ? 'No se pudo hablar con el intermediario'
        : err.message === 'perfil_privado'
          ? 'Tu perfil de Steam está en privado: cambia "Detalles del juego" a Público'
          : err.message === 'no_encontrado'
            ? 'No encuentro ese perfil de Steam'
            : 'Steam no respondió (' + err.message + ')';
  }
  btn.disabled = false;
});

/* ---------- completar datos que faltan ---------- */

let filling = false;
const needsData = (g) => g.critic == null || g.user == null || !g.hours;

$('#m-fill').addEventListener('click', () => {
  $('#dlg-menu').close();
  const pending = state.games.filter(needsData);
  $('#fill-text').textContent = pending.length
    ? pending.length + ' juegos sin nota o sin duración. Se consultará RAWG uno a uno (unos ' + Math.ceil(pending.length * 0.6) + ' segundos).'
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
  if (!state.apiKey) {
    toast('Configura primero tu clave de RAWG');
    return;
  }
  filling = true;
  const btn = $('#btn-fill-start');
  btn.textContent = 'Detener';
  const pending = state.games.filter(needsData);
  let done = 0;
  let found = 0;
  for (const game of pending) {
    if (!filling) break;
    $('#fill-text').textContent = `${done + 1} de ${pending.length}: ${game.name}`;
    // Para un juego de Steam, Steam es mejor fuente que RAWG: su % de resenas
    // es la nota de jugadores real del launcher. Si falla, seguimos con RAWG.
    if (game.appid && STEAM_PROXY) {
      try {
        const s = fromSteam(await steam('/juego', { appid: game.appid }));
        if (game.critic == null && s.critic != null) game.critic = s.critic;
        if (game.user == null && s.user != null) game.user = s.user;
        if (!game.cover && s.cover) game.cover = s.cover;
        if (!needsData(game)) found++;
        await new Promise((r) => setTimeout(r, 400)); // Steam limita las consultas
      } catch (e) {
        /* sin Steam, lo intenta RAWG */
      }
    }
    try {
      const data = needsData(game) ? await lookup(game.name) : null;
      if (data && !data.dudoso) {
        const patch = {};
        if (game.critic == null && data.critic != null) patch.critic = data.critic;
        if (game.user == null && data.user != null) patch.user = data.user;
        if (!game.hours && data.hours) patch.hours = data.hours;
        if (!game.cover && data.cover) patch.cover = data.cover;
        if (!game.platform && data.platform) patch.platform = data.platform;
        if (Object.keys(patch).length) {
          Object.assign(game, patch, { rawgId: data.rawgId, year: game.year || data.year, store: game.store || data.store });
          found++;
        }
      }
    } catch (e) {
      $('#fill-text').textContent = rawgError(e);
      break;
    }
    done++;
    if (done % 10 === 0) save({ sync: false });
    await new Promise((r) => setTimeout(r, 250)); // no castigar la API gratuita
  }
  filling = false;
  save();
  render();
  btn.textContent = 'Empezar';
  btn.disabled = !state.games.some(needsData);
  $('#fill-text').textContent = `Listo: ${found} de ${pending.length} juegos completados.`;
  toast(found + ' juegos completados');
});

/* ---------- cuenta y sincronizacion ---------- */

function openAccount() {
  const body = $('#account-body');
  if (!FIREBASE.apiKey) {
    body.innerHTML = '<p class="hint" style="padding:8px 0">Esta copia de la app todavía no tiene Firebase configurado, así que no hay sincronización.</p>';
    $('#btn-signin').hidden = true;
    $('#btn-signout').hidden = true;
  } else if (state.user) {
    body.innerHTML = `<p style="margin:0 0 6px"><b>${esc(state.user.name || state.user.email)}</b></p><p class="note" style="margin:0">${esc(state.user.email)}</p>`;
    $('#account-note').textContent = 'Tu biblioteca se guarda en tu cuenta y se actualiza sola en todos tus dispositivos. Gana siempre el último cambio.';
    $('#btn-signin').hidden = true;
    $('#btn-signout').hidden = false;
  } else {
    body.innerHTML = '<p class="hint" style="padding:8px 0">Entra con tu cuenta de Google para tener la misma biblioteca en el móvil y en el ordenador.</p>';
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
      toast('Biblioteca subida a tu cuenta');
    } else if (JSON.stringify(remoto) !== JSON.stringify(state.games)) {
      const usarNube = confirm(
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
