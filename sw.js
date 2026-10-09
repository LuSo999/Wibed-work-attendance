// Service worker: offline načtení aplikačního shellu.
// - vlastní soubory: network-first (online vždy aktuální verze, offline z cache)
// - CDN (Tailwind, Firebase SDK – pevné verze v URL): cache-first
// - Firestore / Auth API: neřeší se, offline data obsluhuje Firestore SDK samo
const VERSION = 'v10';
const CACHE = `dochazka-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './js/app.js',
  './js/auth.js',
  './js/calc.js',
  './js/csv.js',
  './js/firebase.js',
  './js/firebase-config.js',
  './js/i18n.js',
  './js/i18n/cs.js',
  './js/i18n/en.js',
  './js/plan.js',
  './js/plan-view.js',
  './js/store.js',
  './js/theme.js',
  './js/time24.js',
  './js/ui.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const CDN_HOSTS = ['cdn.tailwindcss.com', 'www.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dochazka-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return cache.match('./index.html');
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (CDN_HOSTS.includes(url.hostname) && (url.hostname !== 'www.gstatic.com' || url.pathname.startsWith('/firebasejs/'))) {
    event.respondWith(cacheFirst(request));
  }
});
