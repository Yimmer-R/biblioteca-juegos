// Configuracion de los servicios externos. Nada de esto es secreto:
// la config de Firebase es publica por diseno (va dentro de cualquier app web
// de Firebase y se ve en el navegador); quien protege los datos son las reglas
// de firestore.rules. El proxy de Steam guarda la clave de Steam en su propio
// servidor, nunca aqui.

// Proyecto: calidad-por-hora-d22290
export const FIREBASE = {
  apiKey: 'AIzaSyA4R89d6rsRrwsziSIdFWJTkXtrRwUHuJY',
  authDomain: 'calidad-por-hora-d22290.firebaseapp.com',
  projectId: 'calidad-por-hora-d22290',
  appId: '1:15204581526:web:322d5dafa30641e68bc2b7',
};

// URL del Worker de Cloudflare que lee tu biblioteca de Steam.
// Ejemplo: https://steam-proxy.tunombre.workers.dev
export const STEAM_PROXY = '';
