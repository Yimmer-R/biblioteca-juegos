// Login con Google y copia de la biblioteca en Firestore.
// Todo se carga bajo demanda: si no hay Firebase configurado, esta app no
// descarga ni una linea del SDK.

const CDN = 'https://www.gstatic.com/firebasejs/12.1.0/';
const MAX_BYTES = 900 * 1024; // el limite de un documento de Firestore es 1 MB

let config = null;
let appPromise = null;

async function app(cfg) {
  if (cfg) config = cfg;
  if (!config || !config.apiKey) throw new Error('Firebase no está configurado');
  if (!appPromise) {
    appPromise = (async () => {
      const { initializeApp } = await import(CDN + 'firebase-app.js');
      return initializeApp(config);
    })();
  }
  return appPromise;
}

async function auth(cfg) {
  const [{ getAuth }, instance] = await Promise.all([import(CDN + 'firebase-auth.js'), app(cfg)]);
  return getAuth(instance);
}

async function db() {
  const [{ getFirestore }, instance] = await Promise.all([import(CDN + 'firebase-firestore.js'), app()]);
  return getFirestore(instance);
}

const lite = (u) => (u ? { uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL } : null);

export async function watchAuth(cfg, cb) {
  const [{ onAuthStateChanged, getRedirectResult }, a] = await Promise.all([import(CDN + 'firebase-auth.js'), auth(cfg)]);
  // Si volvemos de un login por redireccion (movil y app Android), esto lo recoge.
  getRedirectResult(a).catch(() => {});
  onAuthStateChanged(a, (user) => cb(lite(user)));
}

export async function signIn(cfg) {
  const [{ GoogleAuthProvider, signInWithPopup, signInWithRedirect }, a] = await Promise.all([
    import(CDN + 'firebase-auth.js'),
    auth(cfg),
  ]);
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(a, provider);
  } catch (e) {
    // En la app Android y en algunos navegadores moviles la ventana emergente
    // no existe o la bloquea el sistema: ahi la redireccion si funciona.
    if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
      await signInWithRedirect(a, provider);
      return;
    }
    throw e;
  }
}

export async function signOut() {
  const [{ signOut: fbSignOut }, a] = await Promise.all([import(CDN + 'firebase-auth.js'), auth()]);
  await fbSignOut(a);
}

export async function pullOnce(uid) {
  const [{ doc, getDoc }, base] = await Promise.all([import(CDN + 'firebase-firestore.js'), db()]);
  const snap = await getDoc(doc(base, 'bibliotecas', uid));
  return snap.exists() && Array.isArray(snap.data().games) ? snap.data().games : null;
}

export async function push(uid, games) {
  const [{ doc, setDoc }, base] = await Promise.all([import(CDN + 'firebase-firestore.js'), db()]);
  const payload = JSON.stringify(games);
  if (payload.length > MAX_BYTES) throw new Error('la biblioteca es demasiado grande para sincronizar');
  await setDoc(doc(base, 'bibliotecas', uid), { games: JSON.parse(payload), actualizado: Date.now() });
}

export function watchRemote(uid, cb) {
  let stop = () => {};
  let cancelled = false;
  (async () => {
    const [{ doc, onSnapshot }, base] = await Promise.all([import(CDN + 'firebase-firestore.js'), db()]);
    if (cancelled) return;
    stop = onSnapshot(doc(base, 'bibliotecas', uid), (snap) => {
      // hasPendingWrites = es nuestro propio cambio volviendo de rebote.
      if (snap.metadata.hasPendingWrites || !snap.exists()) return;
      const games = snap.data().games;
      if (Array.isArray(games)) cb(games);
    });
  })();
  return () => {
    cancelled = true;
    stop();
  };
}
