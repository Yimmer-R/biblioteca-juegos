// Cache de la carcasa para que la app abra sin conexion.
// Red primero: si hay internet siempre ves la ultima version; si no, tira del cache.
const CACHE = 'calidad-por-hora-v4';
const SHELL = ['.', 'index.html', 'styles.css', 'app.js', 'lib.js', 'sync.js', 'config.js', 'manifest.webmanifest', 'data/seed.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Las consultas a RAWG y las portadas no pasan por aqui.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 'no-cache' no significa "sin cache": obliga a preguntarle al servidor si el
  // archivo cambio (con ETag, respuesta 304 y casi sin datos). Sin esto, GitHub
  // Pages responde desde la cache del navegador hasta 10 minutos y la app
  // seguiria vieja despues de publicar.
  e.respondWith(
    fetch(new Request(e.request, { cache: 'no-cache' }))
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});
