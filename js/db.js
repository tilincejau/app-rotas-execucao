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
      let r;
      try {
        r = await fetch(API_URL, {
          method: 'POST', body: JSON.stringify(corpo), signal: ctl.signal,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' } // evita preflight CORS no Apps Script
        });
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('O servidor demorou demais para responder. Tente de novo em instantes.');
        // "Failed to fetch": o navegador não conseguiu falar com o Apps Script (implantação arquivada, acesso restrito ou rede bloqueando)
        throw new Error('Não foi possível falar com o servidor (Apps Script). Abra este link no navegador: ' + API_URL +
          ' — se aparecer {"ok":true,"app":"rotas"} o servidor está OK (verifique a internet/rede da empresa); se aparecer página de erro ou de login, a implantação precisa ser corrigida.');
      }
      const txt = await r.text();
      try { return JSON.parse(txt); } catch (_) { throw new Error(explicarHtml(txt)); }
    } finally { clearTimeout(t); }
  }
};

// O Apps Script devolveu uma página HTML em vez de dados: traduz a causa provável.
function explicarHtml(html) {
  const limpo = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (/accounts\.google|ServiceLogin|Fazer login|Sign in/i.test(html))
    return 'O Apps Script pediu login do Google. Na implantação, "Quem pode acessar" precisa ser "Qualquer pessoa" (não "Qualquer pessoa com conta Google"). Depois crie uma Nova versão.';
  if (/doPost|Script function not found|Função de script não encontrada/i.test(limpo))
    return 'O Code.gs implantado não tem a função doPost. Cole o Code.gs do app e implante uma Nova versão.';
  if (/autoriza|authoriz|permiss/i.test(limpo))
    return 'O script ainda não foi autorizado. No editor do Apps Script, execute "prepararPlanilha" e aceite as permissões. Depois implante uma Nova versão.';
  return 'O servidor respondeu com erro: ' + limpo.slice(0, 220);
}
