/* =====================================================================
   ROTA COMPLETA COM O VENDEDOR
   1) Ranking dos vendedores (mês anterior) -> escolhe o vendedor (sugere o pior)
   2) Escolhe o dia (pasta) -> painel da rota: clientes, FDS geral, produtos + e - vendidos
   3) Visita cada PDV (passos normais)
   4) Fecha a rota: checklist de performance, planos de ação, oportunidades e nota 1–5
   ===================================================================== */

const CHECK_ROTA = [
  ['todos', 'Visitou todos os PDVs da rota'],
  ['ttv', 'Aderência ao TTV sugerido (preço ponta)'],
  ['coleta', 'Coleta de dados / pesquisa no app'],
  ['atitude', 'Atitude e postura no varejista'],
  ['epi', 'Utilizou os EPIs em toda a rota']
];
const ORDENS_RANK = [['fat', 'Faturamento'], ['hl', 'Volume (HL)'], ['pos', 'Positivação %'], ['tick', 'Faturamento por cliente']];
const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const moeda = v => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');

function rankingVendedores() {
  const sup = S.usuario.perfil === 'SV' ? S.usuario.sup : (S.filtros.sup || '');
  const vends = vendedoresDoEscopo(sup), R0 = S.pacote.vendRank || {};
  const l = vends.map(vd => {
    const r = R0[vd] || [0, 0, 0, S.clientes.filter(c => c.vend === vd).length];
    return { vend: vd, fat: r[0], hl: r[1], posit: r[2], cart: r[3], pos: r[3] ? r[2] / r[3] * 100 : 0, tick: r[2] ? r[0] / r[2] : 0 };
  }).filter(x => x.cart > 0);
  const k = S.filtros.ordemRank || 'fat';
  l.sort((a, b) => b[k] - a[k]);              // 1º = melhor
  l.forEach((x, i) => { x.pos_rank = i + 1; x.total = l.length; });
  return l;
}
const posicaoVend = vd => (rankingVendedores().find(x => x.vend === vd) || {});

function clientesDaRota(rota = S.rota) { return rota ? S.clientes.filter(c => c.vend === rota.vend && c.dia === rota.dia) : []; }
function visitasDaRota(rota = S.rota) {
  const cods = new Set(clientesDaRota(rota).map(c => c.cod));
  return minhasVisitas().filter(v => v.objetivo === 'ROTA_COMPLETA' && cods.has(v.cod));
}

/* ---------- TELA: escolher vendedor ---------- */
function tRotaSel() {
  const l = rankingVendedores(), k = S.filtros.ordemRank || 'fat', pior = l[l.length - 1];
  return `<section>
    <button class="voltar" data-acao="ir" data-v="objetivos">‹ Objetivos</button>
    <h2>Rota completa – escolha o vendedor</h2>
    <p class="dica">Ranking de ${nomeMes(1)} (mês anterior). A regra pede a rota do vendedor com <b>pior resultado</b>, que é o último da lista.</p>
    <label>Ranking por<select data-filtro="ordemRank">${ORDENS_RANK.map(([v, t]) => `<option value="${v}" ${k === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <ul class="lista rank">${l.slice().reverse().map(x => `<li class="${x === pior ? 'pior' : ''} ${S.rotaVendSel === x.vend ? 'aberto' : ''}" data-acao="rotaVend" data-v="${esc(x.vend)}">
      <span class="pos">${x.pos_rank}º</span>
      <div><b>Vendedor ${esc(x.vend)}</b> ${x === pior ? '<span class="tag alerta">pior resultado</span>' : ''}
        <small>${moeda(x.fat)} · ${n1(x.hl)} HL · positivação ${n1(x.pos)}% (${x.posit}/${x.cart}) · ${moeda(x.tick)}/cliente</small>
        ${S.rotaVendSel === x.vend ? `<div class="dias">${DIAS.map(d => { const n = S.clientes.filter(c => c.vend === x.vend && c.dia === d).length;
          return n ? `<button class="btn" data-acao="rotaIniciar" data-v="${d}">${d}<small>${n} PDVs</small></button>` : ''; }).join('')}</div>` : ''}
      </div></li>`).join('')}</ul>
  </section>`;
}

/* ---------- TELA: painel da rota ---------- */
function fdsDaRota() {
  const cli = clientesDaRota(), grupos = {}; let real = 0, meta = 0;
  cli.forEach(c => (S.pacote.fds[c.cod] || []).forEach(([g, ok, m, r]) => {
    const x = grupos[g] = grupos[g] || { g, ok: 0, total: 0, faltam: [] };
    x.total++; if (ok) x.ok++; else x.faltam.push(c.fantasia); real += r; meta += m;
  }));
  return { lista: Object.values(grupos).sort((a, b) => a.ok / a.total - b.ok / b.total), real, meta };
}
function tRota() {
  const r = S.rota, cli = clientesDaRota(), vis = visitasDaRota(), feitos = new Set(vis.map(v => v.cod));
  const rk = posicaoVend(r.vend), fds = fdsDaRota(), prod = (S.pacote.vendProd || {})[r.vend] || { mais: [], menos: [] };
  return `<section>
    <button class="voltar" data-acao="ir" data-v="resumo">‹ Resumo (a rota fica salva)</button>
    <div class="card destaque"><div class="lin sp"><div><b>Rota do vendedor ${esc(r.vend)} – ${esc(r.dia)}</b>
      <small>Ranking ${nomeMes(1)}: ${rk.pos_rank || '–'}º de ${rk.total || '–'} · ${moeda(rk.fat)} · positivação ${n1(rk.pos)}%</small></div>
      <div class="big">${feitos.size}<small>/${cli.length}</small></div></div>
      <div class="barra"><i style="width:${cli.length ? feitos.size / cli.length * 100 : 0}%"></i></div><small>PDVs da rota visitados</small></div>

    <details open><summary>FDS da rota – ${n1(fds.meta ? fds.real / fds.meta * 100 : 0)}% dos pontos (positivados x faltantes)</summary>
      <ul class="lista mini">${fds.lista.map(x => `<li><span style="flex:1"><b>${esc(NOMES_FDS[x.g] || x.g)}</b>
        ${x.faltam.length ? `<small>Faltam: ${esc(x.faltam.slice(0, 6).join(', '))}${x.faltam.length > 6 ? '…' : ''}</small>` : ''}</span>
        <span class="tag ${x.ok === x.total ? 'ok' : x.ok / x.total < .5 ? 'alerta' : ''}">${x.ok}/${x.total}</span></li>`).join('')}</ul></details>

    <details><summary>Produtos do vendedor em ${nomeMes(1)}: mais e menos vendidos</summary>
      <b class="sub">⬆ Mais vendidos</b><ul class="lista mini">${prod.mais.map(p => `<li>${imgProd([p[0]], p[1], 'mini')}<span style="flex:1">${esc(p[1])}</span><span class="tag ok">${n1(p[2])} cx</span></li>`).join('')}</ul>
      <b class="sub">⬇ Menos vendidos</b><ul class="lista mini">${prod.menos.map(p => `<li>${imgProd([p[0]], p[1], 'mini')}<span style="flex:1">${esc(p[1])}</span><span class="tag alerta">${n1(p[2])} cx</span></li>`).join('')}</ul></details>

    <h3>PDVs da rota</h3>
    <ul class="lista pdvs">${cli.map(c => {
      const f = S.pacote.fds[c.cod] || [], ok = f.filter(x => x[1]).length, feito = feitos.has(c.cod), outroObj = !feito && jaFizEste(c.cod);
      return `<li class="${feito || outroObj ? 'feito' : ''}" data-acao="${feito || outroObj ? 'jaFeito' : 'rotaPdv'}" data-v="${c.cod}">
        <span class="ck">${feito ? '✔' : ''}</span>
        <div><b>${esc(c.cod)} – ${esc(c.fantasia)}</b><small>${esc(c.canal)} · ${esc(c.cidade)}${outroObj ? ' · já registrado em outro objetivo' : ''}</small></div>
        <span class="tag ${f.length && ok === f.length ? 'ok' : ''}">FDS ${ok}/${f.length}</span></li>`;
    }).join('')}</ul>
    <button class="btn pri grande" data-acao="rotaFechar">Fechar rota e avaliar o vendedor ›</button>
    <button class="btn" data-acao="rotaCancelar" style="width:100%">Cancelar esta rota</button>
    ${S.modal || ''}
  </section>`;
}

/* ---------- TELA: fechamento / avaliação ---------- */
const AV = () => S.rota.aval = S.rota.aval || { check: {} };
const rRadio = (path, opts) => { const v = getPath(AV(), path); return `<div class="seg">${opts.map(([val, rot]) =>
  `<label class="${String(v) === String(val) ? 'on' : ''}"><input type="radio" name="r_${path}" value="${val}" ${String(v) === String(val) ? 'checked' : ''} data-rk="${path}">${rot}</label>`).join('')}</div>`; };
const rTexto = (path, rot, ph, req, ajuda) => `<label class="campo"><b>${rot}${req ? ' *' : ''}</b>${ajuda ? `<small>${ajuda}</small>` : ''}<textarea data-rk="${path}" rows="4" placeholder="${esc(ph || '')}">${esc(getPath(AV(), path) || '')}</textarea></label>`;

function sugestoesRota() {
  const fds = fdsDaRota(), prod = (S.pacote.vendProd || {})[S.rota.vend] || { mais: [], menos: [] };
  return {
    fds: 'Positivar na rota: ' + fds.lista.filter(x => x.ok < x.total).slice(0, 5).map(x => `${NOMES_FDS[x.g] || x.g} (${x.total - x.ok} PDVs)`).join(', ') + '.',
    prod: (prod.mais[0] ? `Manter giro de ${prod.mais[0][1]}. ` : '') + (prod.menos.length ? 'Trabalhar: ' + prod.menos.slice(0, 3).map(p => p[1]).join(', ') + '.' : '')
  };
}
function tRotaFech() {
  const a = AV(), cli = clientesDaRota(), vis = visitasDaRota(), rk = posicaoVend(S.rota.vend), sg = sugestoesRota();
  if (a.check.todos == null && cli.length) a.check.todos = vis.length >= cli.length ? 'S' : vis.length ? 'P' : 'N';
  return `<section>
    <button class="voltar" data-acao="rotaVoltarPainel">‹ Voltar para a rota</button>
    <h2>Fechamento da rota – vendedor ${esc(S.rota.vend)}</h2>
    <div class="card destaque"><small>${esc(S.rota.dia)} · ${vis.length} de ${cli.length} PDVs visitados · ranking ${rk.pos_rank || '–'}º de ${rk.total || '–'} (${nomeMes(1)})</small></div>
    <div class="card"><b>Checklist de performance da rota *</b>
      ${CHECK_ROTA.map(([k, t]) => `<div class="item"><span>${t}</span>${rRadio('check.' + k, [['S', 'Sim'], ['P', 'Parcial'], ['N', 'Não']])}</div>`).join('')}</div>
    ${rTexto('planoFds', 'Plano de ação – FDS da rota', 'Itens que faltaram positivar e como vamos positivar', true)}
    <button class="btn peq" data-acao="rotaSugerir" data-k="planoFds" data-v="${esc(sg.fds)}">✨ Sugerir pelos faltantes</button>
    ${rTexto('planoProd', 'Plano de ação – produtos (mais e menos vendidos)', '', true)}
    <button class="btn peq" data-acao="rotaSugerir" data-k="planoProd" data-v="${esc(sg.prod)}">✨ Sugerir pelos produtos</button>
    ${rTexto('fortes', 'Pontos fortes da rota', 'O que o vendedor fez bem', true)}
    ${rTexto('oport', 'OPORTUNIDADES DA ROTA', 'Ex.: baixo share de RGB no bairro X, falta de sinalização de TTV nos bares menores, estoques desorganizados no cliente final', true, 'O que precisa melhorar para a próxima visita?')}
    <div class="card"><b>Qual a sua nota para a execução do seu vendedor? *</b><small>1 = muito ruim · 5 = excelente</small>
      ${rRadio('nota', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']])}</div>
    <div id="erros"></div>
    <button class="btn pri grande" data-acao="rotaSalvar">Salvar fechamento da rota ✔</button>
  </section>`;
}
function validarRota() {
  const a = AV(), e = [], t = (v, n = 10) => (v || '').trim().length >= n;
  if (CHECK_ROTA.some(([k]) => !a.check[k])) e.push('Responda todo o checklist de performance');
  if (!t(a.planoFds)) e.push('Descreva o plano de ação do FDS');
  if (!t(a.planoProd)) e.push('Descreva o plano de ação dos produtos');
  if (!t(a.fortes)) e.push('Descreva os pontos fortes da rota');
  if (!t(a.oport)) e.push('Descreva as oportunidades da rota');
  if (!a.nota) e.push('Dê a nota de 1 a 5 para o vendedor');
  if (!visitasDaRota().length) e.push('Visite ao menos um PDV da rota antes de fechar');
  return e;
}
async function salvarRota() {
  const er = validarRota();
  if (er.length) { document.getElementById('erros').innerHTML = `<div class="aviso erro">${er.map(esc).join('<br>')}</div>`; return; }
  const r = S.rota, a = AV(), cli = clientesDaRota(), vis = visitasDaRota(), rk = posicaoVend(r.vend), fds = fdsDaRota();
  const notaChk = Math.round(CHECK_ROTA.reduce((s, [k]) => s + ({ S: 2, P: 1, N: 0 }[a.check[k]] || 0), 0) / (CHECK_ROTA.length * 2) * 100);
  const reg = {
    id: uid(), mes: mesAtual(), data: hoje(), objetivo: 'ROTA_FECHAMENTO', objetivoNome: 'Fechamento de rota completa',
    cod: `ROTA-${r.vend}-${r.dia}`, fantasia: `Rota vendedor ${r.vend} – ${r.dia}`, sup: (cli[0] || {}).sup || S.usuario.sup, vend: r.vend,
    cidade: [...new Set(cli.map(c => c.cidade))].join(', '), dia: r.dia, canalCadastro: '', canal: '', canalCorreto: true,
    respostas: { ...a, ranking: rk.pos_rank + 'º de ' + rk.total, criterioRanking: S.filtros.ordemRank || 'fat', clientesRota: cli.length,
      visitados: vis.map(v => v.cod), fdsRota: fds.lista.map(x => `${x.g}:${x.ok}/${x.total}`).join(' ') },
    resumo: { fds: fds.real, fdsMeta: fds.meta, fortes: a.fortes, oport: a.oport, notaCoaching: notaChk,
      obs: `Nota vendedor: ${a.nota}/5 · ${vis.length}/${cli.length} PDVs · ranking ${rk.pos_rank}º de ${rk.total} · Plano FDS: ${a.planoFds} · Plano produtos: ${a.planoProd}` },
    fotos: []
  };
  S.outbox.push(reg); await DB.set('outbox', S.outbox);
  S.rota = null; await DB.del('rota');
  S.tela = 'resumo'; render(); scrollTo(0, 0); sincronizar();
}

/* ---------- ações ---------- */
async function acaoRota(a, v, el) {
  switch (a) {
    case 'rotaVend': S.rotaVendSel = S.rotaVendSel === v ? null : v; break;
    case 'rotaIniciar': {
      const vd = S.rotaVendSel; if (!vd) return;
      S.rota = { id: uid(), vend: vd, dia: v, mes: mesAtual(), inicio: new Date().toISOString() };
      await DB.set('rota', S.rota); S.objetivo = 'ROTA_COMPLETA'; S.tela = 'rota'; scrollTo(0, 0); break;
    }
    case 'rotaPdv': S.objetivo = 'ROTA_COMPLETA'; return modalPdv(v);
    case 'rotaContinuar': S.objetivo = 'ROTA_COMPLETA'; S.tela = 'rota'; break;
    case 'rotaFechar': S.tela = 'rotaFech'; scrollTo(0, 0); break;
    case 'rotaVoltarPainel': S.tela = 'rota'; break;
    case 'rotaCancelar': if (!confirm('Cancelar esta rota? As visitas já salvas continuam valendo.')) return; S.rota = null; await DB.del('rota'); S.tela = 'resumo'; break;
    case 'rotaSugerir': { const k = el.dataset.k, at = AV()[k]; AV()[k] = at ? at + '\n' + v : v; await DB.set('rota', S.rota); break; }
    case 'rotaSalvar': return salvarRota();
  }
  render();
}
document.addEventListener('input', e => {
  const t = e.target; if (!t.dataset.rk || !S.rota) return;
  setPath(AV(), t.dataset.rk, t.value); clearTimeout(S._trk); S._trk = setTimeout(() => DB.set('rota', S.rota), 300);
});
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset.rk || !S.rota || t.type !== 'radio') return;
  setPath(AV(), t.dataset.rk, t.value); DB.set('rota', S.rota); render();
});
