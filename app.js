import { SORTS, dedupeKey, filterGames, fromRawg, sortGames, stats, toCsv, toHours, toScore10, withDerived } from './lib.js';

const STORE_KEY = 'calidad-por-hora/v1';
const $ = (sel) => document.querySelector(sel);

const state = {
  games: [],
  sort: { key: 'qph', dir: -1 },
  query: '',
  apiKey: localStorage.getItem(STORE_KEY + '/rawg') || '',
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

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.games));
  } catch (e) {
    toast('No se pudo guardar: almacenamiento lleno');
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
      save();
      toast(state.games.length + ' juegos importados de tu Excel');
    } catch (e) {
      state.games = [];
    }
  }
  render();
}

/* ---------- utilidades de presentacion ---------- */

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = (n, d) => (n == null ? '' : n.toLocaleString('es-ES', { maximumFractionDigits: d == null ? 2 : d }));

const scoreClass = (n) => (n == null ? 'empty-val' : n >= 8 ? 'good' : n >= 6 ? 'mid' : 'low');

function num(value, label, extra) {
  const txt = value == null ? '&mdash;' : esc(nf(value, 2));
  return `<span class="cell num ${extra || ''} ${scoreClass(value)}" data-label="${label}">${txt}</span>`;
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

  const visible = sortGames(filterGames(state.games, state.query), state.sort.key, state.sort.dir);

  $('#rows').innerHTML = visible
    .map(
      (g) => `<button class="row" data-id="${esc(g.id)}">
        <span class="cell name">
          ${g.cover ? `<img class="cover" src="${esc(g.cover)}" alt="" loading="lazy">` : '<span class="cover"></span>'}
          <span class="name-text"><b>${esc(g.name)}</b>${g.year ? `<small>${g.year}</small>` : ''}</span>
        </span>
        <span class="cell plat">${esc(g.store || g.platform || '')}</span>
        ${num(g.critic, 'Críticos')}
        ${num(g.user, 'Jugadores')}
        ${num(g.avg, 'Promedio')}
        <span class="cell num ${g.hours ? '' : 'empty-val'}" data-label="Horas">${g.hours ? esc(nf(g.hours, 1)) : '&mdash;'}</span>
        <span class="cell num qph ${g.qph == null ? 'empty-val' : ''}" data-label="Calidad/hora"><b>${g.qph == null ? '&mdash;' : esc(nf(g.qph, 2))}</b></span>
      </button>`
    )
    .join('');

  const hint = $('#hint');
  $('#table').hidden = visible.length === 0;
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
    throw new Error('SIN_RED');
  }
  if (res.status === 401 || res.status === 403) throw new Error('CLAVE_INVALIDA');
  if (res.status === 429) throw new Error('LIMITE');
  if (!res.ok) throw new Error('ERROR_' + res.status);
  return res.json();
}

const rawgError = (e) =>
  ({
    SIN_CLAVE: 'Configura tu clave de RAWG en Opciones',
    CLAVE_INVALIDA: 'La clave de RAWG no es válida',
    SIN_RED: 'Sin conexión',
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
  const manual = `<button class="result" data-manual="1"><span class="cover"></span><span class="meta"><b>Añadir "${esc(q)}" a mano</b><small>Tu escribes las notas y las horas</small></span></button>`;
  if (!state.apiKey) {
    $('#results').innerHTML = manual;
    return;
  }
  $('#results').innerHTML = '<p class="hint">Buscando...</p>';
  try {
    const results = await searchRawg(q);
    if (seq !== searchSeq) return; // una búsqueda más nueva ya respondio
    $('#results').innerHTML =
      results
        .map(fromRawg)
        .map(
          (g) => `<button class="result" data-rawg="${g.rawgId}">
            ${g.cover ? `<img class="cover" src="${esc(g.cover)}" alt="" loading="lazy">` : '<span class="cover"></span>'}
            <span class="meta"><b>${esc(g.name)}</b><small>${esc([g.year, g.store || g.platform].filter(Boolean).join(' &middot; ')) || 'Sin plataforma'}</small></span>
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
    openEdit({ id: 'man-' + Date.now(), name: $('#search').value.trim(), platform: null, store: null, critic: null, user: null, hours: null, cover: null, rawgId: null }, true);
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
  const dup = state.games.find((g) => dedupeKey(g.name) === dedupeKey(game.name));
  if (dup) {
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
  $('#f-name').value = game.name || '';
  $('#f-platform').value = game.store || game.platform || '';
  $('#f-critic').value = game.critic == null ? '' : String(game.critic).replace('.', ',');
  $('#f-user').value = game.user == null ? '' : String(game.user).replace('.', ',');
  $('#f-hours').value = game.hours == null ? '' : String(game.hours).replace('.', ',');
  $('#btn-delete').hidden = !!isNew;
  $('#edit-source').textContent = game.rawgId ? 'Datos de RAWG (críticos = Metacritic, jugadores = notas de usuarios).' : '';
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
  const updated = { ...editing, ...f, store: f.platform };
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
    const name = $('#f-name').value.trim() || editing.name;
    const hit = (await searchRawg(name))[0];
    const data = hit ? (await detailRawg(hit.id)) || fromRawg(hit) : null;
    if (!data) {
      toast('RAWG no tiene ese juego');
    } else {
      // Nunca borra lo que ya tenías: solo escribe lo que RAWG si conoce.
      if (data.critic != null) $('#f-critic').value = String(data.critic).replace('.', ',');
      if (data.user != null) $('#f-user').value = String(data.user).replace('.', ',');
      if (data.hours != null) $('#f-hours').value = String(data.hours).replace('.', ',');
      if (data.store || data.platform) $('#f-platform').value = data.store || data.platform;
      editing = { ...editing, rawgId: data.rawgId, cover: editing.cover || data.cover, year: data.year };
      $('#edit-source').textContent = 'Datos de RAWG para "' + data.name + '".';
      updatePreview();
      toast('Datos actualizados: revisa y guarda');
    }
  } catch (err) {
    toast(rawgError(err));
  }
  btn.disabled = false;
  btn.textContent = 'Buscar datos';
});

$('#rows').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const game = state.games.find((g) => String(g.id) === row.dataset.id);
  if (game) openEdit(game, false);
});

/* ---------- orden y filtro ---------- */

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
  $('#sort').value = key in SORTS ? key : $('#sort').value;
  render();
});

$('#q').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

/* ---------- menu, clave, exportar, importar ---------- */

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

$('#btn-key-save').addEventListener('click', () => {
  state.apiKey = $('#f-key').value.trim();
  localStorage.setItem(STORE_KEY + '/rawg', state.apiKey);
  $('#dlg-key').close();
  render();
  toast(state.apiKey ? 'Clave guardada' : 'Clave borrada');
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

/* ---------- completar datos que faltan ---------- */

let filling = false;

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

const needsData = (g) => g.critic == null || g.user == null || !g.hours;

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
    try {
      const hit = (await searchRawg(game.name))[0];
      const data = hit ? (await detailRawg(hit.id)) || fromRawg(hit) : null;
      if (data && dedupeKey(data.name) === dedupeKey(game.name)) {
        const patch = {};
        if (game.critic == null && data.critic != null) patch.critic = data.critic;
        if (game.user == null && data.user != null) patch.user = data.user;
        if (!game.hours && data.hours) patch.hours = data.hours;
        if (!game.cover && data.cover) patch.cover = data.cover;
        if (!game.platform && data.platform) patch.platform = data.platform;
        if (!game.store && data.store) patch.store = data.store;
        if (Object.keys(patch).length) {
          Object.assign(game, patch, { rawgId: data.rawgId, year: game.year || data.year });
          found++;
        }
      }
    } catch (e) {
      $('#fill-text').textContent = rawgError(e);
      break;
    }
    done++;
    if (done % 10 === 0) save();
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

/* ---------- arranque ---------- */

boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
