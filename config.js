// Configuracion de los servicios externos. Nada de esto es secreto:
// la config de Firebase es publica por diseno (la seguridad esta en las reglas
// de Firestore) y el proxy de Steam guarda la clave de Steam en su propio
// servidor, nunca aqui.

// firebase.google.com -> tu proyecto -> Configuracion -> Tus apps -> Web
export const FIREBASE = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};

// URL del Worker de Cloudflare que lee tu biblioteca de Steam.
// Ejemplo: https://steam-proxy.tunombre.workers.dev
export const STEAM_PROXY = '';
