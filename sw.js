// Service worker: guarda o app no aparelho para abrir sem internet.
// Com internet: sempre busca a versão mais nova no GitHub (e atualiza a cópia).
// Sem internet: usa a cópia guardada.
const VERSAO = 'rotas-v29';
const ARQUIVOS = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/regras.js', 'js/db.js', 'js/rota.js', 'js/app.js',
  'manifest.webmanifest', 'img/icone-192.png', 'img/logo.png'];

self.addEventListener('install', e => {
  // cada arquivo separado: se um faltar no GitHub, os outros continuam sendo guardados
  e.waitUntil(caches.open(VERSAO).then(c => Promise.all(ARQUIVOS.map(a => c.add(a).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.startsWith(VERSAO)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API vai direto para a rede
  const nome = url.pathname.includes('/img/produtos/') ? VERSAO + '-img' : VERSAO;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(resp => {
    if (resp.ok) { const cp = resp.clone(); caches.open(nome).then(c => c.put(e.request, cp)); }
    return resp;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || new Response('', { status: 404 }))));
});
