// Armazenamento local (IndexedDB) — guarda base, rascunho e visitas pendentes no aparelho.
const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) dbp = new Promise((ok, err) => {
      const r = indexedDB.open('rotas-app', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => err(r.error);
    });
    return dbp;
  }
  async function tx(modo, fn) {
    const db = await open();
    return new Promise((ok, err) => {
      const t = db.transaction('kv', modo), st = t.objectStore('kv'), req = fn(st);
      t.oncomplete = () => ok(req && req.result);
      t.onerror = () => err(t.error);
    });
  }
  return {
    get: k => tx('readonly', s => s.get(k)),
    set: (k, v) => tx('readwrite', s => s.put(v, k)),
    del: k => tx('readwrite', s => s.delete(k)),
    clear: () => tx('readwrite', s => s.clear())
  };
})();

const API = {
  async chamar(corpo, timeoutMs = 60000) {
    if (!navigator.onLine) throw new Error('OFFLINE');
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(API_URL, {
        method: 'POST', body: JSON.stringify(corpo), signal: ctl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' } // evita preflight CORS no Apps Script
      });
      return await r.json();
    } finally { clearTimeout(t); }
  }
};
