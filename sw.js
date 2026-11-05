// Service worker: guarda o app no aparelho para abrir sem internet.
// Ao publicar uma nova versão, aumente o número abaixo.
const VERSAO = 'rotas-v1';
const ARQUIVOS = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/regras.js', 'js/db.js', 'js/app.js',
  'manifest.webmanifest', 'img/icone.svg', 'img/icone-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API vai direto para a rede
  // imagens de produto: cache conforme forem aparecendo
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
    if (resp.ok && url.pathname.includes('/img/')) { const cp = resp.clone(); caches.open(VERSAO).then(c => c.put(e.request, cp)); }
    return resp;
  }).catch(() => r)));
});
