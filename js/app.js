/* ROTAS DE EXECUÇÃO — app offline (PWA) */
const S = {
  usuario: null, token: null, pacote: null, clientes: [], porCod: {},
  visitasServ: [], outbox: [], tela: 'login', objetivo: null,
  filtros: { sup: '', vend: '', dia: '', cidade: '', busca: '', soBar: true, equip: '' },
  draft: null, passo: 0, msg: null, sincronizando: false
};
const $app = document.getElementById('app');
const mesAtual = () => new Date().toISOString().slice(0, 7);
const hoje = () => new Date().toLocaleDateString('pt-BR');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n2 = v => (v == null || v === '' ? '–' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const n1 = v => (v == null || v === '' ? '–' : (Math.round(Number(v) * 10) / 10).toLocaleString('pt-BR'));
const perfilCfg = () => PERFIS[S.usuario.perfil] || PERFIS.SV;
const objCfg = id => perfilCfg().objetivos.find(o => o.id === id) || { id, nome: id, bloco: 'fds' };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------------------------- INICIALIZAÇÃO ---------------------------- */
async function iniciar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  S.token = await DB.get('token');
  S.usuario = await DB.get('usuario');
  S.outbox = (await DB.get('outbox')) || [];
  S.visitasServ = (await DB.get('visitas')) || [];
  const pac = await DB.get('pacote');
  if (pac) carregarPacote(pac);
  S.draft = (await DB.get('rascunho')) || null;
  if (S.draft && (!S.draft.cod || S.outbox.some(v => v.id === S.draft.id))) { S.draft = null; await DB.del('rascunho'); }
  S.enviados = (await DB.get('enviados')) || [];
  S.rota = (await DB.get('rota')) || null;
  if (S.rota && S.rota.mes !== mesAtual()) { S.rota = null; await DB.del('rota'); }
  S.tela = S.token && S.pacote ? 'resumo' : 'login';
  render();
  if (S.tela === 'resumo') sincronizar();
  window.addEventListener('online', () => { render(); sincronizar(); });
  window.addEventListener('offline', render);
}

function carregarPacote(p) {
  S.pacote = p;
  const cols = p.colsClientes;
  S.clientes = p.clientes.map(a => { const o = {}; cols.forEach((c, i) => o[c] = a[i]); return o; });
  S.porCod = {}; S.clientes.forEach(c => S.porCod[c.cod] = c);
  if (S.usuario && S.usuario.perfil === 'SV' && S.usuario.sup) S.filtros.sup = S.usuario.sup;
}

/* ------------------------------ SINCRONIA ------------------------------ */
async function sincronizar(forcarDados) {
  if (S.sincronizando || !S.token || !navigator.onLine) return;
  S.sincronizando = true; render();
  try {
    // 1) envia pendentes
    for (const v of [...S.outbox]) {
      const r = await API.chamar({ acao: 'enviar', token: S.token, visita: v }, 120000);
      if (r.erro === 'SESSAO_EXPIRADA') return sair('Sessão expirada. Entre novamente.');
      if (r.ok) {
        S.outbox = S.outbox.filter(x => x.id !== v.id);
        // cópia local do que já foi enviado: a visita nunca some da tela, mesmo se a lista do servidor atrasar
        S.enviados = (S.enviados || []).filter(x => x.mes === mesAtual() && x.id !== v.id);
        S.enviados.push({ enviadoEm: Date.now(), id: v.id, data: v.data, mes: v.mes, cod: v.cod, objetivo: v.objetivo, objetivoNome: v.objetivoNome, vendedor: v.vend, ...v.resumo });
        await DB.set('enviados', S.enviados);
      }
      else { v.erroEnvio = r.msg || r.erro; }
      await DB.set('outbox', S.outbox);
    }
    // 2) versão da base
    const ver = await API.chamar({ acao: 'versao', token: S.token });
    if (ver.erro === 'SESSAO_EXPIRADA') return sair('Sessão expirada. Entre novamente.');
    if (forcarDados || !S.pacote || ver.versao !== S.pacote.versao) await baixarDados();
    // 3) visitas do mês (de todos)
    const vs = await API.chamar({ acao: 'visitas', token: S.token, mes: mesAtual() });
    if (vs.ok) {
      S.visitasServ = vs.visitas; await DB.set('visitas', vs.visitas); await DB.set('ultimaSync', new Date().toISOString());
      // A planilha manda: a cópia local só vale até a planilha listar a visita (ou por 10 min).
      // Se as respostas forem apagadas na planilha, o app também zera.
      const naPlanilha = new Set(vs.visitas.map(x => x.id));
      S.enviados = (S.enviados || []).filter(x => !naPlanilha.has(x.id) && x.enviadoEm && Date.now() - x.enviadoEm < 10 * 60 * 1000);
      await DB.set('enviados', S.enviados);
    }
  } catch (e) {
    console.warn('sync', e);
  } finally { S.sincronizando = false; render(); }
}

async function baixarDados() {
  const r = await API.chamar({ acao: 'dados', token: S.token }, 180000);
  if (!r.ok) throw new Error(r.erro);
  S.usuario = r.usuario; await DB.set('usuario', r.usuario);
  await DB.set('pacote', r.pacote); carregarPacote(r.pacote);
  aquecerImagens();
}

// Baixa em segundo plano as imagens dos produtos da base, para aparecerem também sem internet.
async function aquecerImagens() {
  const P = S.pacote, cods = new Set();
  Object.values(P.fdsRepresentantes || {}).forEach(l => l.forEach(c => cods.add(c)));
  Object.values(P.skus || {}).forEach(l => l.forEach(x => cods.add(x[0])));
  Object.values(P.fdsProdutos || {}).forEach(g => Object.values(g).forEach(l => l.forEach(x => cods.add(x[0]))));
  for (const c of cods) {
    if (!navigator.onLine) return;
    const ok = await fetch(`img/produtos/${c}.png`).then(r => r.ok).catch(() => false);
    if (!ok) await fetch(`img/produtos/${c}.jpg`).catch(() => {});
  }
}

async function sair(msg) {
  if (S.outbox.length && !confirm('Há ' + S.outbox.length + ' visita(s) não enviadas. Sair mesmo assim? (elas ficam salvas no aparelho)')) return;
  await DB.del('token'); S.token = null; S.tela = 'login'; S.msg = msg || null; S.sincronizando = false; render();
}

/* ------------------------------ CONSULTAS ------------------------------ */
function minhasVisitas() {
  const mes = mesAtual(), me = S.usuario.login;
  const env = S.visitasServ.filter(v => String(v.login).toLowerCase() === me && String(v.mes).slice(0, 7) === mes);
  const ids = new Set(env.map(v => v.id));
  const locais = (S.enviados || []).filter(v => v.mes === mes && !ids.has(v.id));
  locais.forEach(v => ids.add(v.id));
  const pend = S.outbox.filter(v => v.mes === mes && !ids.has(v.id)).map(v => ({
    id: v.id, data: v.data, cod: v.cod, objetivo: v.objetivo, objetivoNome: v.objetivoNome, vendedor: v.vend,
    pendente: true, erro: v.erroEnvio, ...v.resumo }));
  return [...pend, ...locais, ...env];
}
function visitasDeOutros(cod) {
  return S.visitasServ.filter(v => v.cod === cod && v.login !== S.usuario.login && v.mes === mesAtual());
}
function jaFizEste(cod) { return minhasVisitas().some(v => v.cod === cod); }

function progresso() {
  const vs = minhasVisitas(), out = {};
  perfilCfg().objetivos.forEach(o => {
    const doObj = vs.filter(v => v.objetivo === o.id);
    let feito = doObj.length, meta = o.min, detalhe = '', porVend = null;
    if (o.porVendedor) {
      const pv = {}; doObj.forEach(v => pv[v.vendedor] = (pv[v.vendedor] || 0) + 1);
      const vends = vendedoresDoEscopo();
      meta = o.min * Math.max(1, vends.length);
      feito = vends.reduce((s, vd) => s + Math.min(o.min, pv[vd] || 0), 0);
      porVend = vends.map(vd => [vd, pv[vd] || 0]);
    }
    if (o.contaRotas) {
      const fech = vs.filter(v => v.objetivo === 'ROTA_FECHAMENTO');
      feito = fech.length; detalhe = fech.length + ' rota(s) fechada(s)' + (S.rota ? ' · 1 em andamento' : '');
    }
    out[o.id] = { feito, meta, detalhe, pdvs: doObj.length, porVend, min: o.min };
  });
  out.total = new Set(vs.filter(v => !String(v.cod).startsWith('ROTA-')).map(v => v.cod)).size;
  return out;
}
function vendedoresDoEscopo(sup) {
  sup = sup != null ? sup : (S.usuario.perfil === 'SV' ? S.usuario.sup : S.filtros.sup);
  return [...new Set(S.clientes.filter(c => !sup || c.sup === sup).map(c => c.vend))].sort();
}
const uniq = arr => [...new Set(arr)].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

/* ------------------------------- RENDER ------------------------------- */
function render() {
  const telas = { login: tLogin, resumo: tResumo, objetivos: tObjetivos, pdv: tPdv, visita: tVisita, rotaSel: tRotaSel, rota: tRota, rotaFech: tRotaFech };
  $app.innerHTML = (S.tela !== 'login' ? cabecalho() : '') + (telas[S.tela] || tLogin)();
  marcarSugestoes();
  if (typeof iniciarAssinaturas === 'function') iniciarAssinaturas();
  if (S.tela === 'pdv') { const b = document.getElementById('busca'); if (b && S._focoBusca) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }
}

// Botões de sugestão já usados ficam marcados (✓) e não inserem de novo
function marcarSugestoes() {
  document.querySelectorAll('[data-acao="sugerir"],[data-acao="rotaSugerir"]').forEach(b => {
    const k = b.dataset.k, v = b.dataset.v;
    const at = b.dataset.acao === 'sugerir' ? (S.draft ? getPath(R(), k) : '') : (S.rota && S.rota.aval ? S.rota.aval[k] : '');
    const usado = !!(v && at && String(at).includes(v));
    b.classList.toggle('usado', usado);
    if (usado && !b.textContent.startsWith('✓')) b.textContent = '✓ ' + b.textContent.replace(/^[+✨]\s*/u, '');
  });
}
function cabecalho() {
  const on = navigator.onLine;
  return `<header class="top">
    <img class="marca" src="img/icone-192.png" alt="">
    <div class="quem"><b>${esc(S.usuario.nome || S.usuario.login)}</b><small>${esc(perfilCfg().nome)}</small></div>
    <div class="st ${on ? 'on' : 'off'}">${S.sincronizando ? '⟳ sincronizando' : on ? '● online' : '● offline'}${S.outbox.length ? ` · ${S.outbox.length} pendente(s)` : ''}</div>
  </header>`;
}

/* TELA 1 — LOGIN */
function tLogin() {
  return `<section class="login">
    <div class="logo"><img src="img/logo.png" alt="Lince Distribuidora"><span>Rotas de execução</span></div>
    ${S.msg ? `<div class="aviso erro">${esc(S.msg)}</div>` : ''}
    <form id="fLogin">
      <label>Login<input name="login" autocomplete="username" autocapitalize="none" required value="${esc(S._loginDigitado || S.usuario?.login || '')}"></label>
      <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
      <button class="btn pri" type="submit">Entrar</button>
    </form>
    <p class="dica">No primeiro acesso é preciso internet para baixar sua base. Depois o app funciona sem sinal.</p>
    <p class="dica" style="text-align:center">versão 35</p>
  </section>`;
}
async function fazerLogin(form) {
  const login = form.login.value.trim(), senha = form.senha.value;
  S._loginDigitado = login;
  S.msg = 'Entrando...'; render();
  try {
    const r = await API.chamar({ acao: 'login', login, senha });
    if (!r.ok) { S.msg = r.erro; return render(); }
    if (S.usuario && S.usuario.login !== r.usuario.login) { await DB.clear(); S.outbox = []; S.visitasServ = []; S.enviados = []; S.draft = null; S.pacote = null; }
    S.token = r.token; S.usuario = r.usuario;
    await DB.set('token', r.token); await DB.set('usuario', r.usuario);
    S.msg = 'Baixando sua base de clientes...'; render();
    await baixarDados();
    S.msg = null; S.tela = 'resumo'; render(); sincronizar();
  } catch (e) {
    S.msg = e.message === 'OFFLINE' ? 'Sem internet. Conecte-se para o primeiro acesso.' : 'Falha: ' + e.message; render();
  }
}

/* TELA 2 — RESUMO */
function tResumo() {
  const p = progresso(), cfg = perfilCfg(), vs = minhasVisitas();
  const barra = (f, m) => `<div class="barra"><i style="width:${Math.min(100, m ? f / m * 100 : 0)}%"></i></div>`;
  const pct = cfg.minimoTotal ? Math.min(100, Math.round(p.total / cfg.minimoTotal * 100)) : 100;
  return `<section>
    ${S.rota ? `<div class="aviso info">Rota completa em andamento: <b>vendedor ${esc(S.rota.vend)} – ${esc(S.rota.dia)}</b> (${clientesDaRota().length} PDVs · etapa ${(S.rota.passo || 0) + 1} de 4: ${PASSOS_ROTA[S.rota.passo || 0]})
      <div class="lin"><button class="btn pri" data-acao="rotaContinuar">Abrir a rota</button></div></div>` : ''}
    ${S.draft ? `<div class="aviso info">Você tem uma visita em andamento: <b>${esc(S.draft.fantasia)}</b>
      <div class="lin"><button class="btn pri" data-acao="continuarRascunho">Continuar</button><button class="btn" data-acao="descartarRascunho">Descartar</button></div></div>` : ''}
    <div class="card destaque">
      <div class="big">${p.total}<small>/${cfg.minimoTotal}</small></div>
      <div>PDVs diferentes no mês ${mesAtual().split('-').reverse().join('/')}</div>
      ${barra(p.total, cfg.minimoTotal)}<small>${esc(cfg.regra)} (${pct}%)</small>
    </div>
    ${cfg.objetivos.map(o => `<div class="card">
      <div class="lin sp"><b>${esc(o.curto)}</b><span class="tag ${p[o.id].feito >= p[o.id].meta ? 'ok' : ''}">${p[o.id].feito}/${p[o.id].meta}${o.contaRotas ? ' rota' : ''}</span></div>
      ${barra(p[o.id].feito, p[o.id].meta)}
      ${p[o.id].detalhe ? `<small>${esc(p[o.id].detalhe)}</small>` : ''}
      ${p[o.id].porVend ? gradeVendedores(p[o.id].porVend, p[o.id].min, o.id) : ''}
    </div>`).join('')}
    <button class="btn pri grande" data-acao="novaVisita">+ Nova visita</button>
    <h3>Minhas visitas (${vs.length})</h3>
    ${vs.length ? `<ul class="lista">${vs.slice(0, 80).map(v => {
      const c = S.porCod[v.cod] || {};
      if (String(v.cod).startsWith('ROTA-')) return `<li><div><b>🚚 Rota completa – vendedor ${esc(v.vendedor)}</b><small>${esc(v.data)} · ${esc(String(v.cod).split('-').pop())} · fechamento</small></div>
        <span class="tag ${v.pendente ? 'pend' : 'ok'}">${v.pendente ? 'pendente' : 'enviado'}</span></li>`;
      return `<li><div><b>${esc(v.cod)} – ${esc(c.fantasia || '')}</b><small>${esc(v.data)} · ${esc(objCfg(v.objetivo).curto || v.objetivoNome)}${v.vendedor ? ' · vend ' + esc(v.vendedor) : ''}</small>
        ${v.erro ? `<small class="erro">Erro: ${esc(v.erro)}</small>` : ''}</div>
        <span class="tag ${v.pendente ? 'pend' : 'ok'}">${v.pendente ? 'pendente' : 'enviado'}</span></li>`;
    }).join('')}</ul>` : '<p class="dica">Nenhuma visita registrada neste mês.</p>'}
    <div class="lin rod">
      <button class="btn" data-acao="sync">Sincronizar</button>
      <button class="btn" data-acao="sair">Sair</button>
    </div>
    ${S.modalResumo && S.draft ? `<div class="modal"><div class="caixa">
      <h3>Você tem uma visita em andamento</h3>
      <p><b>${esc(S.draft.cod)} – ${esc(S.draft.fantasia || '')}</b><small>${esc(objCfg(S.draft.objetivo).curto || '')} · iniciada em ${esc(S.draft.data || '')}</small></p>
      <button class="btn pri grande" data-acao="continuarRascunho">Continuar esta visita</button>
      <div class="lin"><button class="btn" data-acao="descartarENova">Descartar e começar outra</button><button class="btn" data-acao="fecharModalResumo">Cancelar</button></div>
    </div></div>` : ''}
    <p class="dica">Base atualizada em ${esc(S.pacote?.atualizado || '–')} · ${S.clientes.length} clientes</p>
  </section>`;
}

// Coaching por vendedor: um quadrinho por vendedor com realizado/mínimo (verde quando completou)
function gradeVendedores(porVend, min, objId, ativo) {
  const ok = porVend.filter(x => x[1] >= min).length;
  return `<small>${ok} de ${porVend.length} vendedores completos · toque para fazer o coaching</small>
    <div class="vends">${porVend.map(([vd, n]) => `<button class="vend-chip ${n >= min ? 'ok' : n ? 'parcial' : ''} ${ativo === vd ? 'at' : ''}" data-acao="coachingVend" data-v="${esc(vd)}" data-o="${objId}">
      <b>${esc(vd)}</b><span>${n}/${min}</span><i style="width:${Math.min(100, n / min * 100)}%"></i></button>`).join('')}</div>`;
}

/* TELA 3 — OBJETIVO DA ROTA */
function tObjetivos() {
  const p = progresso();
  return `<section>
    <button class="voltar" data-acao="ir" data-v="resumo">‹ Resumo</button>
    <h2>Qual o objetivo desta visita?</h2>
    ${perfilCfg().objetivos.map(o => `<button class="card opcao" data-acao="escolherObjetivo" data-v="${o.id}">
      <div class="lin sp"><b>${esc(o.nome)}</b><span class="tag">${p[o.id].feito}/${p[o.id].meta}</span></div>
      <small>${esc(o.desc)}</small></button>`).join('')}
    <p class="dica">Lembrete: um PDV só pode ser registrado por você uma vez no mês, em um único objetivo.</p>
  </section>`;
}

/* ---- volumes RGB x descartável (caixas) ---- */
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function nomeMes(voltar) { // 0 = mês atual da base, 1 = anterior, 2 = retrasado
  const [a, m] = String(S.pacote.mes || mesAtual()).split('-').map(Number), d = new Date(a, m - 1 - voltar, 1);
  return MESES[d.getMonth()];
}
const volDe = cod => (S.pacote.vol && S.pacote.vol[cod]) || [0, 0, 0, 0, 0, 0];
const shareRgb = (r, d) => r + d ? Math.round(r / (r + d) * 1000) / 10 : 0;
const ORDENS_RGB = [['pot', 'Potencial RGB (volume descartável)'], ['rgb', 'Volume RGB'], ['total', 'Volume total'], ['share', 'Share RGB %'], ['queda', 'Queda RGB']];
// Por que o PDV entra no foco RGB (automático):
//  não comprador = comprou RGB nos meses anteriores e não comprou neste · queda = mês anterior < retrasado · senão maiores clientes
function tipoRgbAuto(cod) {
  const v = volDe(cod);
  if (!v[0] && (v[2] > 0 || v[4] > 0)) return TIPOS_RGB[2];
  if (v[2] < v[4]) return TIPOS_RGB[1];
  return TIPOS_RGB[0];
}
const tendRgb = v => v[2] > v[4] ? '<span class="sobe">▲ subindo</span>' : v[2] < v[4] ? '<span class="erro">▼ caindo</span>' : '= estável';
const ordemRgb = o => S.filtros.ordem || (o.ordenarQueda ? 'queda' : 'pot');

/* TELA 4 — ESCOLHA DO PDV */
// FDS do PDV: mês anterior (comprou algum produto do item, aba vendas) x mês atual (aba FDS)
function fdsAntAtual(cod) {
  const l = S.pacote.fds[cod] || [], ant = (S.pacote.fdsAnt || {})[cod] || [];
  const meta = l.reduce((s, x) => s + x[2], 0);
  const antPts = l.filter(x => ant.includes(x[0])).reduce((s, x) => s + x[2], 0), atPts = l.reduce((s, x) => s + x[3], 0);
  return { total: l.length, antOk: l.filter(x => ant.includes(x[0])).length, atOk: l.filter(x => x[1]).length, meta, antPts, atPts,
    antPct: meta ? antPts / meta * 100 : 0, atPct: meta ? atPts / meta * 100 : 0 };
}
// Filtro de equipamento em comodato (base refrigeracao_comodatos): geladeira (Freezer) e chopeira
const FILTROS_EQUIP = [['gel', 'Com geladeira'], ['chop', 'Com chopeira'], ['gelchop', 'Com geladeira ou chopeira'], ['sem', 'Sem geladeira nem chopeira']];
function equipDe(cod) { const P = S.pacote; return { gel: (P.geladeiras[cod] || []).length, chop: (P.chopeiras[cod] || []).length }; }
function passaEquip(cod, f) {
  if (!f) return true; const e = equipDe(cod);
  return f === 'gel' ? e.gel > 0 : f === 'chop' ? e.chop > 0 : f === 'gelchop' ? e.gel + e.chop > 0 : f === 'sem' ? !e.gel && !e.chop : true;
}
const ORDENS_FDS = [['fdsAnt', 'FDS mês anterior (%)'], ['fdsAt', 'FDS mês atual (%)']];
function clientesFiltrados() {
  const f = S.filtros, o = objCfg(S.objetivo), b = f.busca.trim().toLowerCase();
  let l = S.clientes.filter(c =>
    (!f.sup || c.sup === f.sup) && (!f.vend || c.vend === f.vend) && (!f.dia || c.dia === f.dia) &&
    (!f.cidade || c.cidade === f.cidade) && passaEquip(c.cod, f.equip) && (!o.soBar || !f.soBar || /^bar/i.test(c.canal)) &&
    (!b || c.cod.includes(b) || c.fantasia.toLowerCase().includes(b) || c.razao.toLowerCase().includes(b)));
  if (o.bloco === 'rgb') {
    const k = ordemRgb(o), sinal = (f.dir || 'desc') === 'desc' ? -1 : 1;
    const val = c => { const v = volDe(c.cod); return { pot: v[3], rgb: v[2], share: shareRgb(v[2], v[3]), total: v[2] + v[3], queda: v[4] - v[2] }[k]; };
    l = l.map(c => [c, val(c)]).sort((a, b2) => sinal * (a[1] - b2[1])).map(x => x[0]);
  }
  if (o.bloco === 'trade') {
    const hlAnt = c => ((S.pacote.hl || {})[c.cod] || [0, 0])[1];
    if (o.fdsBaixa) l = l.filter(c => (S.pacote.fds[c.cod] || []).length && (f.soCompradores === false || hlAnt(c) > 0));
    const k = f.ordem || (o.fdsBaixa ? 'fdsAnt' : ''), sinal = (f.dir || (o.fdsBaixa ? 'asc' : 'desc')) === 'desc' ? -1 : 1;
    // empate no %: PDVs que mais compraram (HL do mês anterior) primeiro
    if (k) l = l.map(c => { const x = fdsAntAtual(c.cod); return [c, k === 'fdsAnt' ? x.antPct : x.atPct, hlAnt(c)]; })
      .sort((a, b2) => sinal * (a[1] - b2[1]) || b2[2] - a[2]).map(x => x[0]);
  }
  return l;
}
function tPdv() {
  const f = S.filtros, o = objCfg(S.objetivo), ehSV = S.usuario.perfil === 'SV';
  const base = S.clientes.filter(c => !f.sup || c.sup === f.sup);
  const baseV = base.filter(c => !f.vend || c.vend === f.vend);
  const baseD = baseV.filter(c => !f.dia || c.dia === f.dia);
  const contVend = {}; if (o.porVendedor) minhasVisitas().filter(v => v.objetivo === o.id).forEach(v => contVend[v.vendedor] = (contVend[v.vendedor] || 0) + 1);
  const rotulo = (k, x) => k === 'vend' && o.porVendedor ? `${x} – ${contVend[x] || 0}/${o.min}${(contVend[x] || 0) >= o.min ? ' ✔' : ''}` : x;
  const sel = (k, rot, opts, todos = 'Todos', dis) => `<label>${rot}<select data-filtro="${k}" ${dis ? 'disabled' : ''}>
      <option value="">${todos}</option>${opts.map(x => `<option ${x === f[k] ? 'selected' : ''} value="${esc(x)}">${esc(rotulo(k, x))}</option>`).join('')}</select></label>`;
  const lista = clientesFiltrados(), mostrar = lista.slice(0, 150);
  return `<section>
    <button class="voltar" data-acao="ir" data-v="objetivos">‹ Objetivos</button>
    <h2>${esc(o.nome)}</h2>
    <div class="filtros">
      ${sel('sup', 'Supervisor', uniq(S.clientes.map(c => c.sup)), 'Todos', ehSV)}
      ${sel('vend', 'Vendedor' + (o.exigeVendedor ? ' *' : ''), uniq(base.map(c => c.vend)), o.exigeVendedor ? 'Escolha o vendedor' : 'Todos')}
      ${sel('dia', 'Dia (pasta)', ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].filter(d => baseV.some(c => c.dia === d)).concat(uniq(baseV.map(c => c.dia)).filter(d => d.startsWith('Outros'))))}
      ${sel('cidade', 'Cidade', uniq(baseD.map(c => c.cidade)))}
      <label>Equipamento<select data-filtro="equip"><option value="">Todos os PDVs</option>${FILTROS_EQUIP.map(([k, t]) => `<option value="${k}" ${f.equip === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    ${o.porVendedor ? (() => { const pr = progresso()[o.id]; return `<div class="card">${gradeVendedores(pr.porVend.filter(x => uniq(base.map(c => c.vend)).includes(x[0]) || !f.sup), pr.min, o.id, f.vend)}</div>`; })() : ''}
    ${o.soBar ? `<label class="chk"><input type="checkbox" data-filtro="soBar" ${f.soBar ? 'checked' : ''}> Mostrar só segmento BAR</label>` : ''}
    <input id="busca" class="busca" type="search" placeholder="Buscar código ou nome fantasia" value="${esc(f.busca)}" data-filtro="busca">
    ${o.exigeVendedor && !f.vend ? '<div class="aviso info">Escolha o vendedor acompanhado para listar os PDVs.</div>' : `
    ${o.bloco === 'rgb' ? `<div class="filtros">
      <label>Ordenar por<select data-filtro="ordem">${ORDENS_RGB.map(([k, t]) => `<option value="${k}" ${ordemRgb(o) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Ordem<select data-filtro="dir"><option value="desc" ${(f.dir || 'desc') === 'desc' ? 'selected' : ''}>Maior → menor</option><option value="asc" ${f.dir === 'asc' ? 'selected' : ''}>Menor → maior</option></select></label>
    </div>` : ''}
    ${o.fdsBaixa ? `<label class="chk"><input type="checkbox" data-filtro="soCompradores" ${f.soCompradores !== false ? 'checked' : ''}> Só PDVs que compraram em ${nomeMes(1)} (tira PDVs parados)</label>` : ''}
    ${o.bloco === 'trade' ? `<div class="filtros">
      <label>Ordenar por<select data-filtro="ordem"><option value="">Padrão (código)</option>${ORDENS_FDS.map(([k, t]) => `<option value="${k}" ${(f.ordem || (o.fdsBaixa ? 'fdsAnt' : '')) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Ordem<select data-filtro="dir"><option value="asc" ${(f.dir || (o.fdsBaixa ? 'asc' : 'desc')) === 'asc' ? 'selected' : ''}>Piores primeiro</option><option value="desc" ${(f.dir || (o.fdsBaixa ? 'asc' : 'desc')) === 'desc' ? 'selected' : ''}>Melhores primeiro</option></select></label>
    </div>` : ''}
    <p class="dica">${lista.length} PDV(s)${lista.length > 150 ? ' – mostrando 150, use os filtros' : ''}${o.bloco === 'rgb' ? ` · volumes em caixas de ${nomeMes(1)} (mês anterior). Potencial = volume descartável que pode virar RGB.` : ''}</p>
    <ul class="lista pdvs">${mostrar.map(c => {
      const meu = jaFizEste(c.cod), outros = visitasDeOutros(c.cod), v = volDe(c.cod), eq = equipDe(c.cod);
      const icEq = (eq.gel ? `<span class="eq" title="Geladeira(s) em comodato">🧊${eq.gel > 1 ? eq.gel : ''}</span>` : '') + (eq.chop ? `<span class="eq" title="Chopeira(s) em comodato">🍺${eq.chop > 1 ? eq.chop : ''}</span>` : '');
      const queda = (o.bloco !== 'rgb' ? '' : `<small class="vol"><b>${nomeMes(1)}:</b> RGB ${n1(v[2])} cx · Desc ${n1(v[3])} cx · <b>${n1(shareRgb(v[2], v[3]))}% RGB</b></small>` +
        (ordemRgb(o) === 'queda' ? `<small class="${v[2] < v[4] ? 'erro' : ''}">RGB ${nomeMes(2)} ${n1(v[4])} → ${nomeMes(1)} ${n1(v[2])} cx</small>` : '') +
        (o.escolheTipoRgb ? `<small><span class="tag">${tipoRgbAuto(c.cod)}</span> ${tendRgb(v)}</small>` : '')) +
        (o.bloco === 'trade' && (S.pacote.fds[c.cod] || []).length ? (x => `<small class="vol">${o.fdsBaixa ? `${n1(((S.pacote.hl || {})[c.cod] || [0, 0])[1])} HL em ${nomeMes(1)} · ` : ''}<b>FDS ${nomeMes(1)}:</b> ${x.antOk}/${x.total} itens (${n1(x.antPct)}%) · <b>${nomeMes(0)}:</b> ${x.atOk}/${x.total} itens (${n1(x.atPct)}%)</small>`)(fdsAntAtual(c.cod)) : '');
      return `<li class="${meu ? 'feito' : ''}" data-acao="${meu ? 'jaFeito' : 'abrirPdv'}" data-v="${c.cod}">
        <span class="ck">${meu ? '✔' : ''}</span>
        <div><b>${esc(c.cod)} – ${esc(c.fantasia)}</b>${icEq}<small>${esc(c.canal)} · ${esc(c.cidade)} · vend ${esc(c.vend)} · ${esc(c.dia)}</small>${queda}</div>
        ${outros.length ? `<span class="tag alerta" title="Já visitado por outro perfil">⚠ ${outros.length}</span>` : ''}
      </li>`;
    }).join('')}</ul>`}
    ${S.modal || ''}
  </section>`;
}

function modalPdv(cod) {
  const c = S.porCod[cod], outros = visitasDeOutros(cod);
  S.modal = `<div class="modal"><div class="caixa">
    <h3>${esc(c.cod)} – ${esc(c.fantasia)}</h3><small>${esc(c.razao)} · ${esc(c.cidade)}</small>
    ${outros.length ? `<div class="aviso alerta"><b>⚠ Este PDV já foi visitado este mês:</b>${outros.map(v => `
      <div class="hist"><b>${esc(v.nome)} (${esc(v.perfil)})</b> – ${esc(v.data)} – ${esc(v.objetivoNome)}<br>
      FDS ${n1(v.fds)}/${n1(v.fdsMeta)} · Visib ${n1(v.visib)} · Ativos ${n1(v.ativos)} · Preço ${n1(v.preco)} · SKUs ${n1(v.skus)}
      ${v.fortes ? `<br><i>Fortes:</i> ${esc(v.fortes)}` : ''}${v.oport ? `<br><i>Oportunidades:</i> ${esc(v.oport)}` : ''}</div>`).join('')}
      <small>Você pode visitar, mas confira o que já foi registrado.</small></div>` : ''}
    <div class="campo"><b>Canal no cadastro: ${esc(c.canal)}</b>
      <div class="lin"><label class="radio"><input type="radio" name="cc" value="S" checked data-acao="canalOk"> Correto</label>
      <label class="radio"><input type="radio" name="cc" value="N" data-acao="canalErrado"> Não está correto</label></div>
      <select id="canalNovo" class="${'oculto'}"><option value="">Selecione o canal correto</option>${S.pacote.canais.map(x => `<option>${esc(x)}</option>`).join('')}</select>
    </div>
    <div class="lin"><button class="btn" data-acao="fecharModal">Cancelar</button><button class="btn pri" data-acao="iniciarVisita" data-v="${cod}">Iniciar visita</button></div>
  </div></div>`;
  render();
}

/* ------------------------------ VISITA ------------------------------ */
const PASSOS = [
  { id: 'fds', nome: 'FDS – Presença' }, { id: 'visib', nome: 'Visibilidade' }, { id: 'ativos', nome: 'Ativos no PDV' },
  { id: 'preco', nome: 'Preço' }, { id: 'skus', nome: 'SKUs no PDV' }, { id: 'obj', nome: 'Análise' }, { id: 'rev', nome: 'Revisão' }
];

function novaVisita(cod, canalNovo) {
  const c = S.porCod[cod], o = objCfg(S.objetivo);
  S.draft = {
    id: uid(), mes: mesAtual(), data: hoje(), objetivo: o.id, objetivoNome: o.nome,
    cod, fantasia: c.fantasia, sup: c.sup, vend: c.vend, cidade: c.cidade, dia: c.dia,
    canalCadastro: c.canal, canal: canalNovo || c.canal, canalCorreto: !canalNovo,
    respostas: { visib: {}, ativos: { gel: (S.pacote.geladeiras[cod] || []).length ? 'SIM' : 'NAO' }, precos: {}, fdsVisto: {}, skusConf: {},
      coaching: { vendedor: o.id === 'ROTA_COMPLETA' && S.rota ? S.rota.vend : o.exigeVendedor ? (S.filtros.vend || c.vend) : '', notas: {} }, rgb: {}, rota: {}, trade: { alavancas: [] } },
    fotos: []
  };
  if (o.bloco === 'rgb') { // share e SKUs RGB do mês atual já vêm preenchidos
    const v = volDe(cod), r = S.draft.respostas.rgb;
    r.share = String(shareRgb(v[0], v[1])); r.skusNossos = String(((S.pacote.rgbSkus || {})[cod] || []).length);
    if (o.escolheTipoRgb) r.tipo = tipoRgbAuto(cod);
  }
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => { if (S.draft) { S.draft.lat = p.coords.latitude; S.draft.lng = p.coords.longitude; salvarRascunho(); } }, () => {}, { timeout: 8000 });
  S.passo = 0; S.modal = null; S.tela = 'visita'; salvarRascunho(); render(); scrollTo(0, 0);
}
const temAtivos = cod => !!(S.pacote.geladeiras[cod] || S.pacote.vasilhames[cod] || S.pacote.chopeiras[cod]);
let _tmr; function salvarRascunho() { clearTimeout(_tmr); _tmr = setTimeout(() => { if (S.draft) { S.draft.passo = S.passo; DB.set('rascunho', S.draft); } }, 300); }
const R = () => S.draft.respostas;
function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(k => o = o[k] = o[k] || {}); o[ks[ks.length - 1]] = val; }
function getPath(obj, path) { return path.split('.').reduce((o, k) => o == null ? undefined : o[k], obj); }

function tVisita() {
  const d = S.draft, p = PASSOS[S.passo], o = objCfg(d.objetivo);
  const corpo = { fds: pFds, visib: pVisib, ativos: pAtivos, preco: pPreco, skus: pSkus, obj: pObj, rev: pRev }[p.id]();
  return `<section class="visita">
    <button class="voltar" data-acao="sairVisita">‹ Resumo (a visita fica salva)</button>
    <div class="pdvtopo"><b>${esc(d.cod)} – ${esc(d.fantasia)}</b><small>${esc(o.curto)} · ${esc(d.canal)}${d.canalCorreto ? '' : ' (corrigido)'} · vend ${esc(d.vend)}</small></div>
    <nav class="passos">${PASSOS.map((x, i) => `<button class="${i === S.passo ? 'at' : i < S.passo ? 'ok' : ''}" data-acao="passo" data-v="${i}">${i + 1}<span>${x.nome}</span></button>`).join('')}</nav>
    <h2>${S.passo + 1}. ${p.id === 'obj' ? tituloObj(o) : p.nome}</h2>
    ${corpo}
    <div id="erros"></div>
    <div class="navfix">
      <button class="btn" data-acao="${S.passo ? 'anterior' : 'sairVisita'}">${S.passo ? '‹ Voltar' : 'Sair'}</button>
      ${p.id === 'rev' ? '<button class="btn pri" data-acao="salvarVisita">Salvar visita ✔</button>' : '<button class="btn pri" data-acao="proximo">Próximo ›</button>'}
    </div>
  </section>`;
}
const tituloObj = o => ({ coaching: 'Coaching do vendedor', rgb: 'Foco em RGB', rota: 'Rota completa', trade: 'Alavancas de Trade', fds: 'Análise da visita' }[o.bloco]);

/* ---- cálculos ---- */
function calcFds() {
  const l = S.pacote.fds[S.draft.cod] || [];
  return { real: l.reduce((s, x) => s + x[3], 0), meta: l.reduce((s, x) => s + x[2], 0), ok: l.filter(x => x[1]).length, total: l.length,
    faltam: l.filter(x => !x[1]).map(x => NOMES_FDS[x[0]] || x[0]) };
}
function itensVisib() { return VISIBILIDADE[CANAL_PARA_VISIB[S.draft.canal] || 'DEMAIS']; }
function calcVisib() { const it = itensVisib(); return it.reduce((s, x, i) => s + (R().visib[i] ? x[1] : 0), 0); }
// Geladeira: posicionamento (20 + 20 + 60) · Sem ativos: refrigeração (50 + 50)
const POSIC_GELADEIRA = [['gelCia', 'Há cerveja da Cia refrigerada?', 20], ['gelAbast', 'Geladeira está com no mínimo 75% abastecida?', 20], ['gelNaoInvadida', 'Geladeira NÃO está invadida (sem concorrência)?', 60]];
const temGelBase = cod => !!(S.pacote.geladeiras[cod] || []).length;
function temGeladeira() { const a = R().ativos; return (a.gel || (temGelBase(S.draft.cod) ? 'SIM' : 'NAO')) === 'SIM'; }
function statusGiroGel() { // pior status entre as geladeiras do PDV
  const l = S.pacote.geladeiras[S.draft.cod] || [], st = l.map(g => String(g[7] || ''));
  return st.find(x => /zero/i.test(x)) || st.find(x => /baixo/i.test(x)) || st.find(x => /ok/i.test(x)) || (l.length ? 'Sem dado de giro' : 'Fora da base');
}
const giroRuim = () => /zero|baixo/i.test(statusGiroGel());
// Histórico de giro (3 meses) de cada equipamento: a[7] atual, a[8] mês anterior, a[9] retrasado · a[6], a[10], a[11] = giro HL
const ruimG = st => /zero|baixo/i.test(st || ''), okG = st => /ok/i.test(st || ''), zeroG = st => /zero/i.test(st || '');
// Diagnóstico pelos meses FECHADOS (anterior e retrasado). O mês atual é parcial: não conta como queda, é o alvo do plano.
function diagGiro(a) {
  const s0 = a[7], s1 = a[8], s2 = a[9];
  if (!s1 && !s2) return s0 ? { tipo: 'semhist', rot: 'Sem histórico – acompanhar', plano: false } : { tipo: 'sem', rot: 'Sem dado de giro', plano: false };
  if (zeroG(s1) && zeroG(s2) && !(Number(a[6]) > 0)) return { tipo: 'recolher', rot: 'Giro zero nos meses fechados', plano: true };
  if (okG(s1) && (okG(s2) || !s2)) return { tipo: 'acompanhar', rot: 'Vem batendo a meta – acompanhar', plano: false };
  if (okG(s1)) return { tipo: 'recuperou', rot: `Recuperou em ${nomeMes(1)} – manter`, plano: false };
  if (ruimG(s1) && ruimG(s2)) return { tipo: 'critico', rot: `Abaixo da meta em ${nomeMes(2)} e ${nomeMes(1)}`, plano: true };
  return { tipo: 'queda', rot: `Caiu em ${nomeMes(1)} – recuperar em ${nomeMes(0)}`, plano: true };
}
// Ritmo do mês atual: giro parcial até hoje projetado para o mês inteiro
function ritmoMes(g) {
  const h = new Date(), dia = h.getDate(), dias = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
  return Number(g) > 0 ? Number(g) / dia * dias : 0;
}
function equipAtivos() { // equipamentos considerados na análise de giro
  const P = S.pacote, cod = S.draft.cod;
  return [].concat(temGeladeira() ? (P.geladeiras[cod] || []).map(a => ['Geladeira', a]) : [],
    (P.chopeiras[cod] || []).map(a => ['Chopeira', a]), (P.vasilhames[cod] || []).map(a => ['Vasilhame', a]));
}
const precisaPlanoGiro = () => equipAtivos().some(([, a]) => diagGiro(a).plano);
function sugestaoPlanoGiro() {
  const dia = new Date().getDate(), m0 = nomeMes(0), m1 = nomeMes(1), m2 = nomeMes(2), out = [];
  equipAtivos().forEach(([tp, a]) => {
    const d = diagGiro(a), nm = `${tp} ${a[0]}`, proj = ritmoMes(a[6]);
    const parcial = `${m0} até o dia ${dia}: ${n2(a[6])}${proj ? ` (no ritmo atual fecharia ~${n2(proj)}; ${m1} fechou ${n2(a[10])})` : ''}`;
    if (d.tipo === 'recolher') out.push(`${nm}: giro zero em ${m2} e ${m1} e nada em ${m0} até agora. Confirmar com o PDV se há interesse em retomar a compra; se não houver, recolher/remanejar para um PDV com potencial.`);
    if (d.tipo === 'critico') out.push(`${nm}: abaixo da meta em ${m2} (${n2(a[11])}) e ${m1} (${n2(a[10])}). ${parcial}. Plano para bater a meta em ${m0}: pedido de ___ cx, positivar ___, revisar preço e abastecimento; se não reagir até o fechamento, avaliar remanejamento.`);
    if (d.tipo === 'queda') out.push(`${nm}: ${m2} OK (${n2(a[11])}) e caiu em ${m1} (${n2(a[10])}). ${parcial}. Plano para voltar à meta em ${m0}: entender o motivo (concorrência, preço, ruptura) e combinar pedido de ___ cx.`);
    if (d.tipo === 'recuperou') out.push(`${nm}: recuperou em ${m1} (${n2(a[10])}) depois de ${m2} abaixo. ${parcial}. Manter a frequência de pedido para não voltar a cair.`);
    if (d.tipo === 'acompanhar') out.push(`${nm}: PDV vem batendo a meta mês a mês (${m2} e ${m1} OK); ${m0} ainda está em andamento (dia ${dia}) – acompanhar o giro até o fechamento.`);
  });
  return [...new Set(out)].join('\n');
}
function calcAtivos() {
  const a = R().ativos;
  if (temGeladeira()) return POSIC_GELADEIRA.reduce((t, [k, , p]) => t + (a[k] === 'S' ? p : 0), 0);
  return (a.ciaRefrig === 'S' ? 50 : 0) + (a.obrigRefrig === 'S' ? 50 : 0);
}
function calcPreco() { return R().precificadas === 'S' ? 100 : R().precificadas === 'N' ? 0 : null; }
// SKUs do mês atual + mês anterior: [cod, nome, estratégico, segmento, meses(bits 1=atual 2=ant 4=retrasado), presente]
// Comprado no mês = presente. Comprado só nos meses anteriores = o usuário confirma se ainda tem no estoque do PDV.
function skusHistPdv() {
  const P = S.pacote, cod = S.draft.cod, conf = R().skusConf || {}, m = {};
  (P.skus[cod] || []).forEach(x => m[x[0]] = [x[0], x[1], x[2], x[3], 1]);
  ((P.skusHist || {})[cod] || []).forEach(x => {
    if (!(x[1] & 3)) return; // só mês atual e mês anterior (o retrasado não entra)
    const s = m[x[0]] = m[x[0]] || [x[0], (P.prodNome || {})[x[0]] || x[0], x[3], x[2], 0];
    s[4] |= x[1] & 3; if (x[3]) s[2] = 1; if (!s[3] && x[2]) s[3] = x[2];
  });
  return Object.values(m).map(s => [...s, s[4] & 1 ? 1 : conf[s[0]] === 'S' ? 1 : 0])
    .sort((a, b) => (b[4] & 1) - (a[4] & 1) || (b[3] ? 1 : 0) - (a[3] ? 1 : 0) || a[1].localeCompare(b[1]));
}
const skusAConfirmar = () => skusHistPdv().filter(s => !(s[4] & 1));
function skusDoPdv() { return skusHistPdv().filter(s => s[5]); }
const mesesSku = b => [[2, 1], [1, 0]].filter(([bit]) => b & bit).map(([, i]) => nomeMes(i));
const ehLono = s => SKUS_LONO.includes(String(s[0])) || s[3] === 'Lono';
function vitoriosos() {
  const o = {}; SEGMENTOS_VITORIOSOS.forEach(s => o[s] = []);
  skusDoPdv().forEach(s => {
    if (s[3] && s[3] !== 'Lono') o[s[3]].push(s[1]);
    if (ehLono(s)) o.Lono.push(s[1]);
  });
  return o;
}
function notaCoaching() {
  const n = R().coaching.notas || {}; let s = 0, m = 0;
  COACHING.forEach(e => e.itens.forEach((_, i) => { m += 2; s += Number(n[e.id + i] || 0); }));
  return m ? Math.round(s / m * 100) : 0;
}

/* ---- componentes ---- */
// Imagens por código do produto: img/produtos/<ProdCod>.png (ou .jpg). Tenta cada código até achar uma.
function imgProd(cods, rotulo, cls = '') {
  const lista = [...new Set(cods.filter(Boolean))].flatMap(c => [`img/produtos/${c}.png`, `img/produtos/${c}.jpg`]);
  if (!lista.length) return `<span class="prod ph ${cls}">${esc(String(rotulo).slice(0, 3))}</span>`;
  return `<img class="prod ${cls}" src="${lista[0]}" data-alt="${lista.slice(1).join('|')}" data-rot="${esc(String(rotulo).slice(0, 3))}" alt="" onerror="proxImg(this)">`;
}
function proxImg(el) {
  const alt = el.dataset.alt ? el.dataset.alt.split('|') : [];
  if (alt.length) { el.dataset.alt = alt.slice(1).join('|'); el.src = alt[0]; return; }
  const s = document.createElement('span'); s.className = el.className + ' ph'; s.textContent = el.dataset.rot; el.replaceWith(s);
}
const imgFds = (g, vendidos) => imgProd([...(vendidos || []).map(p => p[0]), ...((S.pacote.fdsRepresentantes || {})[g] || [])], g);
const radio = (path, opts, rr = true) => { const v = getPath(R(), path); return `<div class="seg">${opts.map(([val, rot]) =>
  `<label class="${v === val ? 'on' : ''}"><input type="radio" name="${path}" value="${val}" ${v === val ? 'checked' : ''} data-k="${path}" ${rr ? 'data-rr' : ''}>${rot}</label>`).join('')}</div>`; };
const texto = (path, rot, ph = '', req) => `<label class="campo">${rot}${req ? ' *' : ''}<textarea data-k="${path}" rows="3" placeholder="${esc(ph)}">${esc(getPath(R(), path) || '')}</textarea></label>`;
const numero = (path, rot, attrs = '') => `<label class="num">${rot}<input type="number" inputmode="decimal" step="0.01" data-k="${path}" value="${esc(getPath(R(), path) ?? '')}" ${attrs}></label>`;
const fotoBtn = (tipo, rot) => { const fs = S.draft.fotos.filter(f => f.tipo === tipo); return `<div class="fotos">
  ${fs.map(f => `<div class="mini"><img src="${f.dados}"><button data-acao="delFoto" data-v="${S.draft.fotos.indexOf(f)}">×</button></div>`).join('')}
  <label class="btn">📷 ${rot}<input type="file" accept="image/*" capture="environment" data-foto="${tipo}" hidden></label></div>`; };

/* ---- PASSO 1: FDS ---- */
function pFds() {
  const l = S.pacote.fds[S.draft.cod] || [], prods = S.pacote.fdsProdutos[S.draft.cod] || {}, c = calcFds();
  if (!l.length) return '<div class="aviso info">Este PDV não tem matriz FDS na base deste mês.</div>';
  const an = fdsAntAtual(S.draft.cod), antL = (S.pacote.fdsAnt || {})[S.draft.cod] || [], dif = c.real - an.antPts;
  return `<div class="card destaque lin sp"><div><div class="big">${n1(c.real)}<small>/${n1(c.meta)}</small></div>pontos de presença</div>
    <div class="big">${c.ok}<small>/${c.total}</small></div></div>
    <div class="card fdsant lin sp"><div><small>${nomeMes(1)} (mês anterior)</small><b>${n1(an.antPts)}/${n1(an.meta)} pts · ${an.antOk}/${an.total} itens</b></div>
      <span class="tag ${dif > 0 ? 'ok' : dif < 0 ? 'alerta' : ''}">${dif > 0 ? `▲ ${nomeMes(0)} já supera em ${n1(dif)} pts` : dif < 0 ? `faltam ${n1(-dif)} pts p/ igualar ${nomeMes(1)}` : `= igual a ${nomeMes(1)}`}</span></div>
    ${l.some(x => !x[1] && antL.includes(x[0])) ? `<div class="aviso info">Recompra: ${l.filter(x => !x[1] && antL.includes(x[0])).map(x => NOMES_FDS[x[0]] || x[0]).join(', ')} – comprado(s) em ${nomeMes(1)} e ainda não em ${nomeMes(0)}.</div>` : ''}
    <p class="dica">Vem automático da aba FDS e das vendas do mês. Marque "visto no PDV" se encontrou um item faltante na loja (fica registrado como oportunidade de positivação).</p>
    <ul class="lista fds">${l.map(x => `<li class="${x[1] ? 'okk' : 'falta'}">${imgFds(x[0], prods[x[0]])}
      <div><b>${esc(NOMES_FDS[x[0]] || x[0])}</b> <small>(${esc(x[0])})</small>
      ${(prods[x[0]] || []).map(p => `<small class="vend">${imgProd([p[0]], p[1], 'mini')} ✔ ${esc(p[1])} <i>(${esc(p[0])})</i></small>`).join('')}
      ${!x[1] ? `<label class="chk"><input type="checkbox" data-k="fdsVisto.${x[0]}" ${R().fdsVisto[x[0]] ? 'checked' : ''}> visto no PDV</label>` : ''}</div>
      <span class="pts">${n1(x[3])}/${n1(x[2])}<small class="ant ${antL.includes(x[0]) ? 'sobe' : 'erro'}">${nomeMes(1)} ${antL.includes(x[0]) ? '✔' : '✘'}</small></span></li>`).join('')}</ul>
    <p class="dica">${nomeMes(1)}: itens da matriz atual que o PDV comprou no mês anterior (aba de vendas).</p>`;
}
/* ---- PASSO 2: VISIBILIDADE ---- */
function pVisib() {
  const it = itensVisib();
  return `<div class="card destaque"><div class="big">${calcVisib()}<small>/100</small></div>Visibilidade – ${esc(CANAL_PARA_VISIB[S.draft.canal] || 'demais canais')}</div>
    <ul class="lista">${it.map((x, i) => `<li><label class="chk grande"><input type="checkbox" data-k="visib.${i}" data-rr ${R().visib[i] ? 'checked' : ''}>
      <span>${esc(x[0])}</span></label><span class="pts">${x[1]} pts</span></li>`).join('')}</ul>
    ${fotoBtn('visibilidade', 'Foto da visibilidade')}`;
}
/* ---- PASSO 3: ATIVOS ---- */
function histGiro(a) {
  const d = diagGiro(a), cel = (m, g, st, parcial) => `<span>${m}<b>${g === '' || g == null ? '–' : n2(g)}</b><i class="${parcial ? '' : ruimG(st) ? 'erro' : okG(st) ? 'sobe' : ''}">${esc(st || '–')}</i></span>`;
  return `<div class="hist"><small>Giro HL – últimos 3 meses (${nomeMes(0)} ainda em andamento, não conta como queda)</small><div class="grid3">${cel(nomeMes(2), a[11], a[9])}${cel(nomeMes(1), a[10], a[8])}${cel(nomeMes(0) + ' (parcial)', a[6], a[7], 1)}</div>
    <span class="tag ${d.plano ? 'alerta' : d.tipo === 'ok' || d.tipo === 'acompanhar' ? 'ok' : ''}">${esc(d.rot)}${d.plano ? ' · precisa de plano' : ''}</span></div>`;
}
function tabelaAtivos(titulo, l, extra) {
  if (!l || !l.length) return '';
  return `<div class="card"><b>${titulo} (${l.length})</b>${l.map(a => `<div class="ativo">
    <div><b>${esc(a[0])}</b> <small>${esc(a[1])}</small></div>
    <div class="grid4"><span>Emissão<b>${esc(a[2])}</b></span><span>Vencimento<b>${esc(a[3])}</b></span>
    <span>Qtd<b>${n1(a[4])}</b></span><span>Dias p/ vencer<b class="${a[5] < 0 ? 'erro' : ''}">${n1(a[5])}</b></span>
    </div>${histGiro(a)}</div>`).join('')}${extra || ''}</div>`;
}
function pAtivos() {
  const cod = S.draft.cod, a = R().ativos, P = S.pacote, gelBase = temGelBase(cod);
  if (!a.gel) a.gel = gelBase ? 'SIM' : 'NAO'; // automático pela base (refrigeracao_comodatos, Cmd_Grupo = Freezer)
  const outros = (P.chopeiras[cod] || []).length + (P.vasilhames[cod] || []).length;
  return `<div class="campo"><b>O PDV possui geladeira da Cia?</b>${radio('ativos.gel', [['SIM', 'Sim'], ['NAO', 'Não']])}
      <small>${gelBase ? `Automático: ${P.geladeiras[cod].length} geladeira(s) em comodato na base.` : 'Automático: nenhuma geladeira (Freezer) em comodato na base.'}${(a.gel === 'SIM') !== gelBase ? ' <b class="erro">Resposta diferente da base – explique na observação.</b>' : ''}</small></div>
    ${a.gel === 'SIM' ? `
      ${tabelaAtivos('🧊 Geladeiras', P.geladeiras[cod])}
      <div class="card"><b>Posicionamento de nossos produtos</b>
        ${POSIC_GELADEIRA.map(([k, t, p]) => `<div class="item"><span>${t} (${p} pts)</span>${radio('ativos.' + k, [['S', 'Sim'], ['N', 'Não']])}</div>`).join('')}
        <div class="lin sp" style="margin-top:8px"><span>Pontuação</span><span class="pts">${calcAtivos()}/100</span></div></div>
      ${fotoBtn('geladeira', 'Foto da geladeira')}` : `
      <div class="card"><b>Refrigeração (PDV sem geladeira da Cia)</b>
        <div class="item"><span>Há cerveja da Cia refrigerada? (50 pts)</span>${radio('ativos.ciaRefrig', [['S', 'Sim'], ['N', 'Não']])}</div>
        <div class="item"><span>SKUs obrigatórios presentes estão refrigerados? (50 pts)</span>${radio('ativos.obrigRefrig', [['S', 'Sim'], ['N', 'Não']])}</div>
        <div class="lin sp" style="margin-top:8px"><span>Pontuação</span><span class="pts">${calcAtivos()}/100</span></div></div>`}
    ${outros ? `<h3>Outros equipamentos em comodato</h3>${tabelaAtivos('🍺 Chopeiras / outros', P.chopeiras[cod])}${tabelaAtivos('📦 Vasilhames', P.vasilhames[cod])}` : ''}
    ${equipAtivos().length ? `<div class="card"><b>Plano de ação do giro</b>
      ${precisaPlanoGiro() ? '<div class="aviso alerta">Há equipamento que não bateu a meta no mês anterior: o plano para recuperar neste mês é obrigatório.</div>'
        : '<small>Nenhum equipamento precisa de plano (bateu a meta no mês anterior). Opcional.</small>'}
      ${texto('ativos.planoGiro', 'Plano de ação / acompanhamento', 'Toque em ✨ para preencher pelo histórico e complete os ___', precisaPlanoGiro())}
      <button class="btn peq" data-acao="sugerir" data-k="ativos.planoGiro" data-v="${esc(sugestaoPlanoGiro())}">✨ Sugerir pelo histórico de giro</button></div>` : ''}
    ${texto('ativos.obs', 'Observação dos ativos', 'Ex.: geladeira com concorrente, vasilhame parado, chopeira sem uso...')}`;
}
/* ---- PASSO 4: PREÇO ---- */
function pPreco() {
  const pr = R().precos;
  return `<div class="campo"><b>Todas as nossas cervejas estão precificadas?</b>${radio('precificadas', [['S', 'Sim (100 pts)'], ['N', 'Não (0 pts)']])}</div>
    <p class="dica">TTC = preço ao consumidor (prateleira). Marque N/A se a marca não está no PDV.</p>
    ${MARCAS_PRECO.map(m => { const x = pr[m] || {}; return `<div class="card preco ${x.na ? 'na' : ''}">
      <div class="lin sp"><b>${m}</b><label class="chk"><input type="checkbox" data-k="precos.${m}.na" data-rr ${x.na ? 'checked' : ''}> N/A</label></div>
      ${x.na ? '' : `${m === 'M1' ? `<label>Marca Ambev<select data-k="precos.M1.marca" data-rr><option value="">Selecione</option>${MARCAS_M1.map(b => `<option ${x.marca === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      ${x.marca === 'Outra' ? `<label>Qual marca? *<input type="text" data-k="precos.M1.marcaOutra" value="${esc(x.marcaOutra || '')}" placeholder="Digite a marca"></label>` : ''}` : ''}
      <div class="lin">${numero(`precos.${m}.ttc`, 'TTC R$')}</div>`}</div>`; }).join('')}
    <details><summary>Desejável (opcional): promoção e posicionamento</summary>
      ${texto('promocao', 'Promoção', 'Ação promocional nossa ou da concorrência')}
      <div class="campo"><b>Posicionamento na geladeira/gôndola</b>${radio('posicionamento', [['bom', 'Bom'], ['regular', 'Regular'], ['ruim', 'Ruim']])}</div>
    </details>`;
}
/* ---- PASSO 5: SKUs (mês atual + anterior) ---- */
function linhaSku(s, conf) {
  const tags = `${s[3] && s[3] !== 'Lono' ? `<span class="tag ok">${s[3]}</span>` : ''}${ehLono(s) ? '<span class="tag ok">Lono</span>' : ''}${s[2] ? '<span class="tag">estratégico</span>' : ''}`;
  const meses = [[2, 1], [1, 0]].map(([bit, i]) => `<i class="mes ${s[4] & bit ? 'on' : ''}">${nomeMes(i)}</i>`).join('');
  return `<li class="sku">${imgProd([s[0]], s[1], 'mini')}<div style="flex:1"><span>${esc(s[1])} <small>${esc(s[0])}</small></span><div class="meses">${meses}${tags}</div>
    ${conf ? `<div class="item"><span>Ainda tem no estoque do PDV?</span>${radio('skusConf.' + s[0], [['S', 'Sim'], ['N', 'Não']])}</div>` : ''}</div></li>`;
}
const doSeg = (s, k) => k === 'Outros' ? !(s[3] && s[3] !== 'Lono') && !ehLono(s) : k === 'Lono' ? ehLono(s) : s[3] === k;
function pSkus() {
  if (S._segCod !== S.draft.cod) { S._segCod = S.draft.cod; S.segAberto = ''; }
  const todos = skusHistPdv(), conf = (R().skusConf = R().skusConf || {}), l = skusDoPdv(), v = vitoriosos();
  const tot = l.filter(s => s[3] || ehLono(s)).length, ab = S.segAberto;
  const segs = SEGMENTOS_VITORIOSOS.concat(todos.some(s => doSeg(s, 'Outros')) ? ['Outros'] : []);
  const info = k => { const t = todos.filter(s => doSeg(s, k)), ant = t.filter(s => !(s[4] & 1));
    return { t, ant, pend: ant.filter(s => !conf[s[0]]).length, pres: t.filter(s => s[5]).length }; };
  const pres = SEGMENTOS_VITORIOSOS.filter(k => v[k].length), aus = SEGMENTOS_VITORIOSOS.filter(k => !v[k].length);
  const semEst = todos.filter(s => !(s[4] & 1) && conf[s[0]] === 'N' && (s[3] || ehLono(s) || s[2])).map(s => s[1]);
  const sugestao = (pres.length ? 'Vitoriosos presentes: ' + pres.map(k => `${k} (${v[k].length})`).join(', ') + '.' : 'Nenhum SKU vitorioso presente.') +
    (aus.length ? ' Ausentes: ' + aus.join(', ') + '.' : ' Todos os segmentos presentes.') +
    (semEst.length ? ' Comprados antes e sem estoque hoje (reposição): ' + semEst.slice(0, 6).join(', ') + '.' : '');
  const pendTot = todos.filter(s => !(s[4] & 1) && !conf[s[0]]).length;
  const painel = k => { const x = info(k), atual = x.t.filter(s => s[4] & 1);
    return `<div class="card segpainel"><div class="lin sp"><b>${k}</b><button class="btn peq" data-acao="segAbrir" data-v="">Fechar ✕</button></div>
      ${x.ant.length ? `<small>Vendidos em ${nomeMes(1)} e ainda não em ${nomeMes(0)} – ainda tem no PDV?</small>
        <ul class="lista mini">${x.ant.map(s => linhaSku(s, true)).join('')}</ul>` : ''}
      ${atual.length ? `<small>Comprados em ${nomeMes(0)} (contam automático)</small><ul class="lista mini">${atual.map(s => linhaSku(s, false)).join('')}</ul>` : ''}
      ${!x.t.length ? '<small>Nenhum SKU deste segmento no mês atual nem no anterior.</small>' : ''}</div>`; };
  return `<div class="card destaque lin sp"><div><div class="big">${l.length}</div>SKUs presentes</div><div><div class="big">${tot}</div>vitoriosos</div></div>
    <div class="segs">${segs.map(k => { const x = info(k), n = k === 'Outros' ? x.pres : v[k].length;
      return `<button class="seg-t ${n ? 'ok' : 'falta'} ${ab === k ? 'aberto' : ''}" data-acao="segAbrir" data-v="${k}"><b>${n}</b>${k}
        ${x.pend ? `<span class="badge">+${x.pend} ${nomeMes(1)}</span>` : x.ant.length ? '<span class="badge ok">✔ conferido</span>' : ''}</button>`; }).join('')}</div>
    ${ab ? painel(ab) : ''}
    ${pendTot ? `<div class="aviso alerta">Há <b>${pendTot}</b> SKU(s) vendidos em ${nomeMes(1)} para conferir. Toque nos segmentos com a etiqueta laranja.
      <div class="lin" style="margin-top:6px"><button class="btn peq" data-acao="skusTodos" data-v="S">Todos ainda têm</button><button class="btn peq" data-acao="skusTodos" data-v="N">Nenhum tem</button></div></div>`
      : `<p class="dica">Considera ${nomeMes(1)} (mês anterior) e ${nomeMes(0)}. Toque num segmento para ver os produtos.</p>`}
    ${texto('resumoSkus', 'Resumo do PDV com os SKUs vitoriosos presentes', 'Descreva os vitoriosos presentes e o que falta', true)}
    <button class="btn peq" data-acao="sugerir" data-k="resumoSkus" data-v="${esc(sugestao)}">✨ Preencher sugestão</button>`;
}
/* ---- PASSO 6: OBJETIVO ---- */
function sugestaoOport() {
  const f = calcFds(), v = vitoriosos(), out = [];
  if (f.faltam.length) out.push('Positivar FDS: ' + f.faltam.join(', '));
  if (calcVisib() < 100) out.push('Completar visibilidade do canal (' + calcVisib() + '/100)');
  const aus = SEGMENTOS_VITORIOSOS.filter(k => !v[k].length); if (aus.length) out.push('Incluir vitoriosos: ' + aus.join(', '));
  if (R().precificadas === 'N') out.push('Precificar todas as nossas cervejas');
  if (!temGeladeira()) out.push('Avaliar implantação de geladeira');
  return out.join('. ') + (out.length ? '.' : '');
}
function sugestaoAlavancas() {
  const f = calcFds(), v = vitoriosos(), out = [];
  if (f.faltam.length) out.push('FDS: trabalhar positivação de ' + f.faltam.slice(0, 4).join(', '));
  out.push(`Visibilidade: ${calcVisib()}/100 no canal ${S.draft.canal}`);
  if (temGeladeira()) out.push(`Geladeira: posicionamento ${calcAtivos()}/100, ${statusGiroGel()}`);
  else out.push('Geladeira: PDV sem geladeira da Cia – avaliar implantação');
  const aus = SEGMENTOS_VITORIOSOS.filter(k => !v[k].length); if (aus.length) out.push('SKUs vitoriosos ausentes: ' + aus.join(', '));
  out.push(`SKUs por PDV: ${skusDoPdv().length} SKU(s) comprados no mês`);
  if (R().precificadas === 'N') out.push('Preço: cervejas sem precificação');
  return out.join('. ') + '.';
}
function blocoFortesOport(req) {
  return `${texto('fortes', 'Pontos fortes', 'O que o PDV / vendedor faz bem', req)}
    ${texto('oport', 'Oportunidades', 'O que precisa melhorar', req)}
    <button class="btn peq" data-acao="sugerir" data-k="oport" data-v="${esc(sugestaoOport())}">✨ Sugerir oportunidades a partir da visita</button>`;
}
function pObj() {
  const o = objCfg(S.draft.objetivo), r = R();
  if (o.bloco === 'coaching') {
    const n = r.coaching.notas;
    return `<label>Vendedor acompanhado *<select data-k="coaching.vendedor">${vendedoresDoEscopo(S.draft.sup).map(v => `<option ${r.coaching.vendedor === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="card destaque"><div class="big">${notaCoaching()}<small>%</small></div>Nota da rotina básica</div>
      ${COACHING.map(e => `<div class="card"><b>${e.nome}</b>${e.itens.map((it, i) => `<div class="item"><span>${esc(it)}</span>
        ${radio(`coaching.notas.${e.id}${i}`, [['2', 'Sim'], ['1', 'Parcial'], ['0', 'Não']])}</div>`).join('')}</div>`).join('')}
      <div class="campo"><b>Gerou pedido nesta visita?</b>${radio('coaching.pedido', [['S', 'Sim'], ['N', 'Não']])}</div>
      ${r.coaching.pedido === 'S' ? numero('coaching.valorPedido', 'Valor do pedido R$') : ''}
      ${blocoFortesOport(true)}
      ${texto('coaching.compromisso', 'Compromisso do vendedor (o que vai fazer diferente até a próxima visita)', 'Ex.: oferecer Heineken 600 em todos os bares da pasta de terça', true)}
      <div class="campo"><b>Deu o feedback ao vendedor na hora?</b>${radio('coaching.feedback', [['S', 'Sim'], ['N', 'Não']])}</div>`;
  }
  if (o.bloco === 'rgb') {
    const tipo = o.id === 'RGB_QUEDA' ? 'Maiores quedas' : r.rgb.tipo, v = volDe(S.draft.cod), skusRgb = (S.pacote.rgbSkus || {})[S.draft.cod] || [];
    return `${o.escolheTipoRgb ? `<label>Por que este PDV foi escolhido? (automático pela base) *<select data-k="rgb.tipo" data-rr><option value="">Selecione</option>${TIPOS_RGB.map(t => `<option ${r.rgb.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
      <div class="card destaque"><b>Volume em caixas – RGB x descartável</b>
        <div class="grid4">
          <span>${nomeMes(1)} RGB<b>${n1(v[2])}</b></span><span>${nomeMes(1)} desc.<b>${n1(v[3])}</b></span><span>${nomeMes(1)} share<b>${n1(shareRgb(v[2], v[3]))}%</b></span>
          <span>${nomeMes(0)} RGB<b>${n1(v[0])}</b></span><span>${nomeMes(0)} desc.<b>${n1(v[1])}</b></span><span>${nomeMes(0)} share<b>${n1(shareRgb(v[0], v[1]))}%</b></span>
        </div>
        <small>RGB ${nomeMes(2)} ${n1(v[4])} → ${nomeMes(1)} ${n1(v[2])} → ${nomeMes(0)} ${n1(v[0])} cx · ${tendRgb(v)}</small>
      </div>
      <div class="lin">${numero('rgb.share', `Share RGB no PDV % (${nomeMes(0)}, automático)`, 'min="0" max="100"')}</div>
      <div class="card"><b>SKUs RGB comprados em ${nomeMes(0)} (${skusRgb.length})</b>
        ${skusRgb.length ? `<ul class="lista mini">${skusRgb.map(x => `<li>${imgProd([x[0]], x[1], 'mini')}<span style="flex:1">${esc(x[1])} <small>${esc(x[0])}</small></span><span class="tag ok">${n1(x[2])} cx</span></li>`).join('')}</ul>`
          : '<small>Nenhum produto retornável comprado neste mês.</small>'}
      </div>
      <div class="lin">${numero('rgb.skusNossos', 'SKUs RGB nossos')}${numero('rgb.skusConc', 'SKUs RGB concorrência *')}</div>
      <div class="card preco ${r.rgb.concNA ? 'na' : ''}">
        <div class="lin sp"><b>Principal concorrente RGB</b><label class="chk"><input type="checkbox" data-k="rgb.concNA" data-rr ${r.rgb.concNA ? 'checked' : ''}> N/A</label></div>
        ${r.rgb.concNA ? '<small>PDV não trabalha com retornável da concorrência.</small>' : `
        <label>Marca *<select data-k="rgb.marcaConc" data-rr><option value="">Selecione</option>${MARCAS_M1.map(b => `<option ${r.rgb.marcaConc === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
        ${r.rgb.marcaConc === 'Outra' ? `<label>Qual marca? *<input type="text" data-k="rgb.marcaConcOutra" value="${esc(r.rgb.marcaConcOutra || '')}" placeholder="Digite a marca"></label>` : ''}
        <div class="lin">${numero('rgb.ttcConc', 'TTC conc. R$')}</div>`}</div>
      ${tipo === 'Maiores quedas' ? `<label>Motivo da queda *<select data-k="rgb.motivo"><option value="">Selecione</option>${MOTIVOS_QUEDA.map(m => `<option ${r.rgb.motivo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        ${texto('rgb.acao', 'Ação combinada para recuperar o volume', '', true)}` : ''}
      ${blocoFortesOport(false)}`;
  }
  if (o.bloco === 'rota') {
    return `<div class="aviso info">PDV da rota do vendedor <b>${esc(r.coaching.vendedor || S.draft.vend)}</b>. A avaliação completa (checklist, planos, oportunidades e nota) é feita no <b>fechamento da rota</b>.</div>
      <div class="campo"><b>Visita seguiu o planejamento diário do vendedor?</b>${radio('rota.seguiuPlano', [['S', 'Sim'], ['N', 'Não']])}</div>
      ${blocoFortesOport(false)}`;
  }
  if (o.bloco === 'trade') {
    const x = fdsAntAtual(S.draft.cod);
    return `${o.fdsBaixa ? `<div class="card destaque"><b>FDS do PDV</b><div class="grid4">
        <span>${nomeMes(1)} itens<b>${x.antOk}/${x.total}</b></span><span>${nomeMes(1)} pontos<b>${n1(x.antPct)}%</b></span><span>&nbsp;<b>${x.atPct > x.antPct ? '<span class="sobe">▲</span>' : x.atPct < x.antPct ? '<span class="erro">▼</span>' : '='}</b></span>
        <span>${nomeMes(0)} itens<b>${x.atOk}/${x.total}</b></span><span>${nomeMes(0)} pontos<b>${n1(x.atPct)}%</b></span></div></div>
      ${texto('trade.planoFds', 'Plano de ação para melhorar o FDS deste PDV', 'Ex.: positivar Heineken 600 e Amstel Lata no próximo pedido; reposicionar na geladeira', true)}
      <button class="btn peq" data-acao="sugerir" data-k="trade.planoFds" data-v="${esc(calcFds().faltam.length ? 'Positivar: ' + calcFds().faltam.join(', ') + '.' : '')}">✨ Sugerir pelos itens faltantes</button>` : ''}
      ${texto('trade.alavancasTexto', 'Alavancas trabalhadas neste PDV', 'Descreva o que foi trabalhado. Toque nos exemplos abaixo para inserir e complete os ___', true)}
      <div class="chips">${EXEMPLOS_ALAVANCAS.map(([t, ex]) => `<button class="btn peq" data-acao="sugerir" data-k="trade.alavancasTexto" data-v="${esc(ex)}">+ ${esc(t)}</button>`).join('')}</div>
      <button class="btn peq" data-acao="sugerir" data-k="trade.alavancasTexto" data-v="${esc(sugestaoAlavancas())}">✨ Sugerir pelo que a visita encontrou</button>
      ${blocoFortesOport(true)}`;
  }
  return `${blocoFortesOport(false)}`;
}
/* ---- Nota do PDV (4Ps): Presença 50% + Visibilidade 30% + Posicionamento 10% + Preço 10% ---- */
function notaPdv(s) {
  const partes = [[s.fdsMeta ? Math.min(100, s.fds / s.fdsMeta * 100) : null, .5], [s.visib, .3], [s.ativos, .1], [s.preco, .1]].filter(x => x[0] != null && x[0] !== '');
  const peso = partes.reduce((t, x) => t + x[1], 0);
  return peso ? Math.round(partes.reduce((t, x) => t + Number(x[0]) * x[1], 0) / peso * 10) / 10 : '';
}
/* ---- PASSO 7: REVISÃO ---- */
function resumoVisita() {
  const f = calcFds(), v = vitoriosos(), r = R(), o = objCfg(S.draft.objetivo);
  return { fds: f.real, fdsMeta: f.meta, visib: calcVisib(), ativos: calcAtivos(), preco: calcPreco(), skus: skusDoPdv().length,
    vitoriosos: SEGMENTOS_VITORIOSOS.filter(k => v[k].length).map(k => k + ':' + v[k].length).join(', '),
    fortes: r.fortes || '', oport: r.oport || '', obs: [r.ativos.obs, r.ativos.planoGiro ? 'Plano giro: ' + r.ativos.planoGiro : ''].filter(Boolean).join(' | '),
    notaCoaching: o.bloco === 'coaching' ? notaCoaching() : '' };
}
function pRev() {
  const s = resumoVisita(), erros = PASSOS.slice(0, 6).flatMap((_, i) => validar(i)), nota = notaPdv(s);
  return `${nota !== '' ? `<div class="card destaque lin sp"><div><div class="big" style="color:${nota >= 80 ? '#0a7a3c' : nota >= 60 ? '#9a6200' : '#c0392b'}">${n1(nota)}<small>/100</small></div>Nota do PDV (4Ps)</div>
      <small style="text-align:right">Presença 50%<br>Visibilidade 30%<br>Posicionamento 10%<br>Preço 10%</small></div>` : ''}
    <div class="card"><ul class="rev">
      <li>FDS – presença<b>${n1(s.fds)}/${n1(s.fdsMeta)}</b></li><li>Visibilidade<b>${s.visib}/100</b></li>
      <li>${temGeladeira() ? 'Posicionamento geladeira' : 'Refrigeração'}<b>${s.ativos + '/100'}</b></li><li>Precificação<b>${s.preco ?? '–'}</b></li>
      <li>SKUs presentes<b>${s.skus}</b></li><li>Vitoriosos<b>${esc(s.vitoriosos || '–')}</b></li>
      ${s.notaCoaching !== '' ? `<li>Nota coaching<b>${s.notaCoaching}%</b></li>` : ''}
      <li>Fotos<b>${S.draft.fotos.length}</b></li></ul></div>
    ${fotoBtn('geral', 'Foto geral do PDV')}
    ${texto('obsGeral', 'Observação geral (opcional)')}
    ${erros.length ? `<div class="aviso erro"><b>Faltam informações:</b><ul>${erros.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '<div class="aviso ok">Tudo certo! A visita fica salva no aparelho e é enviada quando houver internet.</div>'}`;
}

/* ---- validação ---- */
function validar(i) {
  const r = R(), o = objCfg(S.draft.objetivo), e = [], txt = (v, n = 10) => (v || '').trim().length >= n;
  const id = PASSOS[i].id;
  if (id === 'ativos') {
    if (temGeladeira()) {
      if (POSIC_GELADEIRA.some(([k]) => !r.ativos[k])) e.push('Responda as perguntas de posicionamento da geladeira');
    } else if (!r.ativos.ciaRefrig || !r.ativos.obrigRefrig) e.push('Responda as perguntas de refrigeração');
    if (precisaPlanoGiro() && (r.ativos.planoGiro || '').trim().length < 10) e.push('Descreva o plano de ação do giro dos equipamentos');
    if ((r.ativos.planoGiro || '').includes('___')) e.push('Complete os campos ___ no plano de giro');
  }
  if (id === 'preco') {
    if (!r.precificadas) e.push('Informe se as cervejas estão precificadas');
    MARCAS_PRECO.forEach(m => { const x = r.precos[m] || {}; if (!x.na && (x.ttc === undefined || x.ttc === '')) e.push(`Preencha o TTC de ${m} ou marque N/A`); });
    if (r.precos.M1 && !r.precos.M1.na && !r.precos.M1.marca) e.push('Escolha a marca Ambev do M1');
    if (r.precos.M1 && !r.precos.M1.na && r.precos.M1.marca === 'Outra' && !(r.precos.M1.marcaOutra || '').trim()) e.push('Digite qual é a outra marca do M1');
  }
  if (id === 'skus') {
    const pend = skusAConfirmar().filter(s => !(r.skusConf || {})[s[0]]).length;
    if (pend) { const sg = [...SEGMENTOS_VITORIOSOS, 'Outros'].filter(k => skusAConfirmar().some(x => doSeg(x, k) && !(r.skusConf || {})[x[0]]));
      e.push(`Confira os ${pend} SKU(s) vendidos em ${nomeMes(1)} (toque em: ${sg.join(', ')})`); }
    if (!txt(r.resumoSkus)) e.push('Descreva o resumo dos SKUs vitoriosos');
  }
  if (id === 'obj') {
    const fo = () => { if (!txt(r.fortes)) e.push('Descreva os pontos fortes'); if (!txt(r.oport)) e.push('Descreva as oportunidades'); };
    if (o.bloco === 'coaching') {
      if (!r.coaching.vendedor) e.push('Escolha o vendedor');
      const falt = COACHING.reduce((s, et) => s + et.itens.filter((_, k) => r.coaching.notas[et.id + k] == null).length, 0);
      if (falt) e.push(`Avalie todos os itens do checklist (${falt} sem resposta)`);
      if (!r.coaching.pedido) e.push('Informe se gerou pedido');
      fo(); if (!txt(r.coaching.compromisso)) e.push('Registre o compromisso do vendedor');
    }
    if (o.bloco === 'rgb') {
      if (o.escolheTipoRgb && !r.rgb.tipo) e.push('Escolha o tipo de foco RGB');
      if (r.rgb.share === undefined || r.rgb.share === '') e.push('Informe o share RGB no PDV');
      if (!r.rgb.concNA && (r.rgb.skusConc === undefined || r.rgb.skusConc === '')) e.push('Informe os SKUs RGB da concorrência (ou marque N/A no concorrente)');
      if (!r.rgb.concNA && !r.rgb.marcaConc) e.push('Escolha a marca do principal concorrente RGB ou marque N/A');
      if (!r.rgb.concNA && r.rgb.marcaConc === 'Outra' && !(r.rgb.marcaConcOutra || '').trim()) e.push('Digite qual é a marca do concorrente');
      if ((o.id === 'RGB_QUEDA' || r.rgb.tipo === 'Maiores quedas') && (!r.rgb.motivo || !txt(r.rgb.acao, 5))) e.push('Informe motivo da queda e ação');
    }
    if (o.bloco === 'rota' && !r.rota.seguiuPlano) e.push('Informe se a visita seguiu o planejamento do vendedor');
    if (o.bloco === 'trade') {
      if (!txt(r.trade.alavancasTexto)) e.push('Descreva as alavancas trabalhadas neste PDV');
      if ((r.trade.alavancasTexto || '').includes('___')) e.push('Complete os campos ___ nas alavancas');
      if (o.fdsBaixa && !txt(r.trade.planoFds)) e.push('Descreva o plano de ação do FDS');
      fo();
    }
  }
  return e;
}

/* Espelho da visita: tudo o que a pessoa viu e respondeu, para a ficha do relatório */
function espelhoVisita() {
  const P = S.pacote, d = S.draft, cod = d.cod, r = R(), o = objCfg(d.objetivo), sn = v => v === 'S' ? 'Sim' : v === 'N' ? 'Não' : v === 'P' ? 'Parcial' : (v || '');
  const prods = P.fdsProdutos[cod] || {};
  const e = {
    nota: notaPdv(resumoVisita()),
    fdsAnt: (x => ({ mes: nomeMes(1), pts: x.antPts, meta: x.meta, ok: x.antOk, total: x.total }))(fdsAntAtual(cod)),
    // FDS: [item, positivado(1/0), meta, pontos, produtos comprados no mês, visto no PDV(1/0)]
    fds: (P.fds[cod] || []).map(x => [NOMES_FDS[x[0]] || x[0], x[1], x[2], x[3], (prods[x[0]] || []).map(p => p[1]).join('; '), r.fdsVisto[x[0]] ? 1 : 0, ((P.fdsAnt || {})[cod] || []).includes(x[0]) ? 1 : 0]),
    visib: { tabela: CANAL_PARA_VISIB[d.canal] || 'DEMAIS CANAIS', itens: itensVisib().map((x, i) => [x[0], x[1], r.visib[i] ? 1 : 0]) },
    ativos: temGeladeira()
      ? { gel: 1, geladeiras: (P.geladeiras[cod] || []).map(g => [g[0], g[2], g[3], g[6], g[7], g[11], g[9], g[10], g[8], diagGiro(g).rot]), perguntas: POSIC_GELADEIRA.map(([k, t, p]) => [t, sn(r.ativos[k]), r.ativos[k] === 'S' ? p : 0, p]),
          giro: statusGiroGel(), planoGiro: r.ativos.planoGiro || '' }
      : { gel: 0, perguntas: [['Há cerveja da Cia refrigerada?', sn(r.ativos.ciaRefrig), r.ativos.ciaRefrig === 'S' ? 50 : 0, 50], ['SKUs obrigatórios presentes estão refrigerados?', sn(r.ativos.obrigRefrig), r.ativos.obrigRefrig === 'S' ? 50 : 0, 50]] },
    // outros: [tipo, material, qtd, status atual, giro atual, giro/status retrasado, giro/status anterior, diagnóstico]
    outrosAtivos: [].concat((P.chopeiras[cod] || []).map(x => ['Chopeira', x]), (P.vasilhames[cod] || []).map(x => ['Vasilhame', x]))
      .map(([t, x]) => [t, x[0], x[4], x[7], x[6], x[11], x[9], x[10], x[8], diagGiro(x).rot]),
    mesesGiro: [nomeMes(2), nomeMes(1), nomeMes(0)], planoGiro: r.ativos.planoGiro || '',
    obsAtivos: r.ativos.obs || '',
    preco: { precificadas: sn(r.precificadas), marcas: MARCAS_PRECO.map(m => { const x = r.precos[m] || {}; return [m === 'M1' && x.marca ? 'M1 (' + (x.marca === 'Outra' ? x.marcaOutra : x.marca) + ')' : m, x.na ? 'N/A' : (x.ttc || '')]; }),
      promocao: r.promocao || '', posicionamento: r.posicionamento || '' },
    // SKUs 3 meses: [nome, segmento, estratégico, meses comprados, situação]
    skus: { lista: skusHistPdv().map(x => [x[1], [x[3], ehLono(x) && x[3] !== 'Lono' ? 'Lono' : ''].filter(Boolean).join(' + '), x[2] ? 1 : 0, mesesSku(x[4]).join('/'),
      x[4] & 1 ? 'Comprou no mês' : (r.skusConf || {})[x[0]] === 'S' ? 'Em estoque' : 'Sem estoque']), resumo: r.resumoSkus || '' },
    obsGeral: r.obsGeral || ''
  };
  if (o.bloco === 'coaching') e.coaching = { etapas: COACHING.map(et => [et.nome, et.itens.map((it, i) => [it, ({ 2: 'Sim', 1: 'Parcial', 0: 'Não' })[r.coaching.notas[et.id + i]] || ''])]),
    nota: notaCoaching(), pedido: sn(r.coaching.pedido), valorPedido: r.coaching.valorPedido || '', feedback: sn(r.coaching.feedback), compromisso: r.coaching.compromisso || '' };
  if (o.bloco === 'rgb') { const v = volDe(cod); e.rgb = { mesAnt: nomeMes(1), mesAt: nomeMes(0), vol: v, skusRgb: ((P.rgbSkus || {})[cod] || []).map(x => [x[1], x[2]]) }; }
  return e;
}
async function salvarVisita() {
  const erros = PASSOS.slice(0, 6).flatMap((_, i) => validar(i));
  if (erros.length) { alert('Faltam informações:\n- ' + erros.join('\n- ')); return; }
  if (jaFizEste(S.draft.cod)) { alert('Você já registrou este PDV neste mês.'); return; }
  const d = S.draft;
  if (d.respostas.coaching.vendedor) d.vend = d.respostas.coaching.vendedor;
  d.resumo = resumoVisita();
  d.respostas.espelho = espelhoVisita();
  if (d.respostas.obsGeral) d.resumo.obs = [d.resumo.obs, d.respostas.obsGeral].filter(Boolean).join(' | ');
  S.outbox.push(d); await DB.set('outbox', S.outbox);
  clearTimeout(_tmr); S.draft = null; await DB.del('rascunho');
  S.tela = d.objetivo === 'ROTA_COMPLETA' && S.rota ? 'rota' : 'resumo'; render(); scrollTo(0, 0);
  sincronizar();
}

/* ---- fotos (comprime para ~1280px JPEG) ---- */
function comprimir(file) {
  return new Promise((ok, err) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = img.width * k; cv.height = img.height * k;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url); ok(cv.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = err; img.src = url;
  });
}

/* ------------------------------ EVENTOS ------------------------------ */
document.addEventListener('submit', e => { if (e.target.id === 'fLogin') { e.preventDefault(); fazerLogin(e.target); } });

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-acao]'); if (!el) return;
  const a = el.dataset.acao, v = el.dataset.v;
  if (a.startsWith('rota')) { e.preventDefault(); return acaoRota(a, v, el); }
  if (a === 'canalOk' || a === 'canalErrado') { document.getElementById('canalNovo').classList.toggle('oculto', a === 'canalOk'); return; }
  if (a === 'alavanca') { const al = R().trade.alavancas, x = ALAVANCAS_TRADE[v]; el.checked ? al.push(x) : al.splice(al.indexOf(x), 1); salvarRascunho(); return render(); }
  e.preventDefault();
  switch (a) {
    case 'ir': S.tela = v; S.modal = null; break;
    case 'novaVisita':
      if (S.draft) { S.modalResumo = true; break; }
      S.tela = 'objetivos'; break;
    case 'fecharModalResumo': S.modalResumo = false; break;
    case 'descartarENova': clearTimeout(_tmr); S.draft = null; await DB.del('rascunho'); S.modalResumo = false; S.tela = 'objetivos'; break;
    case 'continuarRascunho': S.modalResumo = false; S.objetivo = S.draft.objetivo; S.tela = 'visita'; S.passo = S.draft.passo || 0; scrollTo(0, 0); break;
    case 'descartarRascunho': if (!confirm('Descartar a visita em andamento?')) return; clearTimeout(_tmr); S.draft = null; await DB.del('rascunho'); break;
    case 'escolherObjetivo': S.objetivo = v; S.filtros.vend = ''; S.filtros.busca = ''; S.filtros.ordem = ''; S.filtros.dir = objCfg(v).bloco === 'trade' ? '' : 'desc';
      S.tela = v === 'ROTA_COMPLETA' ? (S.rota ? 'rota' : 'rotaSel') : 'pdv'; S.rotaVendSel = null; scrollTo(0, 0); break;
    case 'abrirPdv': return modalPdv(v);
    case 'jaFeito': { const m = minhasVisitas().find(x => x.cod === v); alert(`Você já registrou este PDV em ${m.data} (${objCfg(m.objetivo).curto}). Cada PDV só pode ser feito uma vez por você no mês.`); return; }
    case 'fecharModal': S.modal = null; break;
    case 'coachingVend':
      if (S.tela === 'resumo' && S.draft) { S.modalResumo = true; break; }
      S.objetivo = el.dataset.o; S.filtros.vend = v; S.filtros.dia = ''; S.filtros.cidade = ''; S.filtros.busca = ''; S.tela = 'pdv'; scrollTo(0, 0); break;
    case 'iniciarVisita': {
      const errado = document.querySelector('input[name=cc][value=N]').checked, novo = document.getElementById('canalNovo').value;
      if (errado && !novo) return alert('Selecione o canal correto.');
      return novaVisita(v, errado ? novo : null);
    }
    case 'passo': if (Number(v) > S.passo) { for (let i = S.passo; i < Number(v); i++) if (validar(i).length) { S.passo = i; render(); return mostrarErros(validar(i)); } } S.passo = Number(v); break;
    case 'proximo': { const er = validar(S.passo); if (er.length) return mostrarErros(er); S.passo++; salvarRascunho(); scrollTo(0, 0); break; }
    case 'anterior': S.passo--; salvarRascunho(); scrollTo(0, 0); break;
    case 'sairVisita': salvarRascunho(); S.tela = 'resumo'; scrollTo(0, 0); break; // rascunho fica salvo
    case 'salvarVisita': return salvarVisita();
    case 'delFoto': S.draft.fotos.splice(Number(v), 1); salvarRascunho(); break;
    case 'sugerir': { // insere só uma vez: se o texto já está no campo, não repete
      const k = el.dataset.k, at = getPath(R(), k) || '';
      if (!v || at.includes(v)) return;
      setPath(R(), k, at.trim() ? at.trimEnd() + '\n' + v : v); salvarRascunho(); break; }
    case 'segAbrir': S.segAberto = S.segAberto === v ? '' : v; break;
    case 'skusTodos': { const r = R(); r.skusConf = r.skusConf || {}; skusAConfirmar().forEach(x => r.skusConf[x[0]] = v); salvarRascunho(); break; }
    case 'sync': sincronizar(true); return;
    case 'sair': return sair();
  }
  render();
});

function mostrarErros(er) {
  const d = document.getElementById('erros');
  d.innerHTML = `<div class="aviso erro">${er.map(esc).join('<br>')}</div>`; d.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.filtro === 'busca') { S.filtros.busca = t.value; S._focoBusca = true; clearTimeout(S._tb); S._tb = setTimeout(render, 250); return; }
  if (t.dataset.k && (t.tagName === 'TEXTAREA' || t.type === 'number' || t.type === 'text')) { setPath(R(), t.dataset.k, t.value); salvarRascunho(); }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.filtro && t.dataset.filtro !== 'busca') {
    const k = t.dataset.filtro; S.filtros[k] = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'sup') { S.filtros.vend = ''; S.filtros.dia = ''; S.filtros.cidade = ''; }
    if (k === 'vend') { S.filtros.dia = ''; S.filtros.cidade = ''; }
    if (k === 'dia') S.filtros.cidade = '';
    S._focoBusca = false; return render();
  }
  if (t.dataset.foto) {
    for (const f of t.files) S.draft.fotos.push({ tipo: t.dataset.foto, dados: await comprimir(f) });
    salvarRascunho(); return render();
  }
  if (t.dataset.k) {
    const val = t.type === 'checkbox' ? t.checked : t.value;
    setPath(R(), t.dataset.k, val);
    if (t.dataset.k === 'rgb.concNA' && val) R().rgb.skusConc = '0'; // sem concorrência retornável = 0 SKUs
    salvarRascunho();
    if (t.dataset.rr !== undefined || t.type === 'radio' || t.tagName === 'SELECT' && t.dataset.rr !== undefined) render();
  }
});

iniciar();
