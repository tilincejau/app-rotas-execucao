/* =====================================================================
   ROTA COMPLETA COM O VENDEDOR
   1) Ranking dos vendedores (mês anterior) -> escolhe o vendedor (sugere o pior)
   2) Escolhe o dia (pasta) -> análise GERAL da rota (não é PDV a PDV):
      FDS (mês anterior x atual) · Ativos (giro e potenciais de geladeira) · SKUs da rota
   3) Fecha a rota: checklist de performance, planos de ação, oportunidades e nota 1–5
   ===================================================================== */

const CHECK_ROTA = [
  ['todos', 'Visitou todos os PDVs da rota'],
  ['ttv', 'Aderência ao TTV sugerido (preço ponta)'],
  ['coleta', 'Coleta de dados / pesquisa no app'],
  ['atitude', 'Atitude e postura no varejista'],
  ['epi', 'Utilizou os EPIs em toda a rota']
];
const ORDENS_RANK = [['cx', 'Caixas vendidas'], ['hl', 'Volume (HL)'], ['pos', 'Positivação % (clientes vendidos / base)'], ['cxcli', 'Caixas por cliente vendido']];
const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function rankingVendedores() {
  const sup = S.usuario.perfil === 'SV' ? S.usuario.sup : (S.filtros.sup || '');
  const vends = vendedoresDoEscopo(sup), R0 = S.pacote.vendRank || {};
  const l = vends.map(vd => {
    const r = R0[vd] || [0, 0, 0, S.clientes.filter(c => c.vend === vd).length];
    return { vend: vd, cx: r[0], hl: r[1], posit: r[2], cart: r[3], pos: r[3] ? r[2] / r[3] * 100 : 0, cxcli: r[2] ? r[0] / r[2] : 0 };
  }).filter(x => x.cart > 0);
  const k = S.filtros.ordemRank || 'cx';
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
  const l = rankingVendedores(), k = S.filtros.ordemRank || 'cx', pior = l[l.length - 1];
  return `<section>
    <button class="voltar" data-acao="ir" data-v="objetivos">‹ Objetivos</button>
    <h2>Rota completa – escolha o vendedor</h2>
    <p class="dica">Ranking de ${nomeMes(1)} (mês anterior). A regra pede a rota do vendedor com <b>pior resultado</b>, que é o último da lista.</p>
    <label>Ranking por<select data-filtro="ordemRank">${ORDENS_RANK.map(([v, t]) => `<option value="${v}" ${k === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <ul class="lista rank">${l.slice().reverse().map(x => `<li class="${x === pior ? 'pior' : ''} ${S.rotaVendSel === x.vend ? 'aberto' : ''}" data-acao="rotaVend" data-v="${esc(x.vend)}">
      <span class="pos">${x.pos_rank}º</span>
      <div><b>Vendedor ${esc(x.vend)}</b> ${x === pior ? '<span class="tag alerta">pior resultado</span>' : ''}
        <div class="grid4 rk">
          <span>Caixas<b>${n1(x.cx)}</b></span><span>HL<b>${n1(x.hl)}</b></span>
          <span>Clientes vendidos<b>${x.posit} de ${x.cart}</b></span><span>Positivação<b>${n1(x.pos)}%</b></span>
        </div>
        ${S.rotaVendSel === x.vend ? `<div class="dias">${DIAS.map(d => { const n = S.clientes.filter(c => c.vend === x.vend && c.dia === d).length;
          return n ? `<button class="btn" data-acao="rotaIniciar" data-v="${d}">${d}<small>${n} PDVs</small></button>` : ''; }).join('')}</div>` : ''}
      </div></li>`).join('')}</ul>
  </section>`;
}

/* ---------- ANÁLISE GERAL DA ROTA ---------- */
const PASSOS_ROTA = ['FDS', 'Ativos', 'SKUs', 'Fechamento'];
const pct = (a, b) => b ? a / b * 100 : 0;

function fdsDaRota() {
  const cli = clientesDaRota(), grupos = {}; let real = 0, meta = 0;
  cli.forEach(c => {
    const ant = (S.pacote.fdsAnt || {})[c.cod] || [];
    (S.pacote.fds[c.cod] || []).forEach(([g, ok, m, r]) => {
      const x = grupos[g] = grupos[g] || { g, ok: 0, ant: 0, total: 0, faltam: [] };
      x.total++; if (ok) x.ok++; else x.faltam.push(c.fantasia); if (ant.includes(g)) x.ant++;
      real += r; meta += m;
    });
  });
  const lista = Object.values(grupos).sort((a, b) => a.ok / a.total - b.ok / b.total);
  return { lista, real, meta, okT: lista.reduce((s, x) => s + x.ok, 0), antT: lista.reduce((s, x) => s + x.ant, 0), totT: lista.reduce((s, x) => s + x.total, 0) };
}
function ativosDaRota() {
  const P = S.pacote, cli = clientesDaRota(), meta = P.metaGel || 2;
  const comGel = cli.filter(c => (P.geladeiras[c.cod] || []).length);
  const pior = c => { const st = (P.geladeiras[c.cod] || []).map(g => String(g[7] || '')); return st.find(x => /zero/i.test(x)) ? 'Giro Zero' : st.find(x => /baixo/i.test(x)) ? 'Giro Baixo' : st.find(x => /ok/i.test(x)) ? 'Giro OK' : 'Sem dado'; };
  const giro = { 'Giro OK': [], 'Giro Baixo': [], 'Giro Zero': [], 'Sem dado': [] };
  comGel.forEach(c => giro[pior(c)].push(c));
  const soma = (tab, cs) => cs.reduce((s, c) => s + (P[tab][c.cod] || []).reduce((t, x) => t + (x[4] || 0), 0), 0);
  const comChop = cli.filter(c => (P.chopeiras[c.cod] || []).length), comVas = cli.filter(c => (P.vasilhames[c.cod] || []).length);
  const potenciais = cli.filter(c => !(P.geladeiras[c.cod] || []).length && ((P.hl || {})[c.cod] || [0, 0])[1] >= meta)
    .map(c => ({ c, hl: P.hl[c.cod][1] })).sort((a, b) => b.hl - a.hl);
  return { cli, meta, comGel, giro, qGel: soma('geladeiras', comGel), comChop, qChop: soma('chopeiras', comChop), comVas, qVas: soma('vasilhames', comVas), potenciais, pior };
}
function skusDaRota(mes = 0) { // 0 = mês atual (skus_pdv) · 1 = mês anterior (vendas)
  const P = S.pacote, cli = clientesDaRota(), cont = {}, seg = {}; let tot = 0, compraram = 0;
  SEGMENTOS_VITORIOSOS.forEach(k => seg[k] = 0);
  cli.forEach(c => {
    const l = mes ? ((P.skusHist || {})[c.cod] || []).filter(x => x[1] & 2).map(x => [x[0], (P.prodNome || {})[x[0]] || x[0], x[3], x[2]]) : (P.skus[c.cod] || []);
    if (l.length) { compraram++; tot += l.length; }
    const temSeg = {};
    l.forEach(s => { (cont[s[0]] = cont[s[0]] || [s[0], s[1], 0])[2]++; if (s[3] && s[3] !== 'Lono') temSeg[s[3]] = 1; if (ehLono(s)) temSeg.Lono = 1; });
    Object.keys(temSeg).forEach(k => seg[k]++);
  });
  const ranking = Object.values(cont).sort((a, b) => b[2] - a[2]);
  return { cli, compraram, media: compraram ? tot / compraram : 0, seg, top: ranking.slice(0, 10), poucos: ranking.filter(x => x[2] <= 2).slice(-8).reverse() };
}

function tRota() {
  const r = S.rota, cli = clientesDaRota(), rk = posicaoVend(r.vend), passo = r.passo || 0;
  const corpo = [pRotaFds, pRotaAtivos, pRotaSkus, tRotaFechCorpo][passo]();
  return `<section>
    <button class="voltar" data-acao="ir" data-v="resumo">‹ Resumo (a rota fica salva)</button>
    <div class="card destaque"><b>Rota do vendedor ${esc(r.vend)} – ${esc(r.dia)} · ${cli.length} PDVs</b>
      <small>Ranking ${nomeMes(1)}: ${rk.pos_rank || '–'}º de ${rk.total || '–'} · ${n1(rk.cx)} cx · ${n1(rk.hl)} HL · ${rk.posit || 0} de ${rk.cart || 0} clientes vendidos (${n1(rk.pos)}%)</small></div>
    <nav class="passos">${PASSOS_ROTA.map((x, i) => `<button class="${i === passo ? 'at' : i < passo ? 'ok' : ''}" data-acao="rotaPasso" data-v="${i}">${i + 1}<span>${x}</span></button>`).join('')}</nav>
    ${corpo}
    ${passo < 3 ? `<div class="navfix"><button class="btn" data-acao="${passo ? 'rotaPasso' : 'rotaCancelar'}" data-v="${passo - 1}">${passo ? '‹ Voltar' : 'Cancelar rota'}</button>
      <button class="btn pri" data-acao="rotaPasso" data-v="${passo + 1}">Próximo ›</button></div>` : ''}
  </section>`;
}

/* 1. FDS da rota: mês anterior x mês atual */
function pRotaFds() {
  const f = fdsDaRota(), prod = (S.pacote.vendProd || {})[S.rota.vend] || { mais: [], menos: [] };
  const seta = (a, b) => b > a ? `<span class="sobe">▲ ${b - a}</span>` : b < a ? `<span class="erro">▼ ${a - b}</span>` : '=';
  return `<h2>1. FDS da rota</h2>
    <div class="card destaque lin sp">
      <div><small>${nomeMes(1)} (anterior)</small><div class="big">${n1(pct(f.antT, f.totT))}<small>%</small></div></div>
      <div><small>${nomeMes(0)} até agora</small><div class="big">${n1(pct(f.okT, f.totT))}<small>%</small></div></div>
      <div><small>pontos ${nomeMes(0)}</small><div class="big">${n1(pct(f.real, f.meta))}<small>%</small></div></div></div>
    <p class="dica">Positivação dos itens FDS nos PDVs da rota. ${nomeMes(1)} = comprou algum produto do item no mês anterior (aba vendas); ${nomeMes(0)} = status da aba FDS.</p>
    <table class="tab"><thead><tr><th>Item FDS</th><th>${nomeMes(1)}</th><th>${nomeMes(0)}</th><th></th></tr></thead><tbody>
      ${f.lista.map(x => `<tr><td><b>${esc(NOMES_FDS[x.g] || x.g)}</b>${x.faltam.length ? `<small>Faltam ${x.faltam.length}: ${esc(x.faltam.slice(0, 4).join(', '))}${x.faltam.length > 4 ? '…' : ''}</small>` : ''}</td>
        <td>${x.ant}/${x.total}</td><td><b>${x.ok}/${x.total}</b></td><td>${seta(x.ant, x.ok)}</td></tr>`).join('')}
    </tbody></table>
    <details><summary>Produtos do vendedor em ${nomeMes(1)}: mais e menos vendidos</summary>
      <b class="sub">⬆ Mais vendidos</b><ul class="lista mini">${prod.mais.map(p => `<li>${imgProd([p[0]], p[1], 'mini')}<span style="flex:1">${esc(p[1])}</span><span class="tag ok">${n1(p[2])} cx</span></li>`).join('')}</ul>
      <b class="sub">⬇ Menos vendidos</b><ul class="lista mini">${prod.menos.map(p => `<li>${imgProd([p[0]], p[1], 'mini')}<span style="flex:1">${esc(p[1])}</span><span class="tag alerta">${n1(p[2])} cx</span></li>`).join('')}</ul></details>
    <details><summary>FDS por PDV (${clientesDaRota().length})</summary><ul class="lista mini">${clientesDaRota().map(c => {
      const l = S.pacote.fds[c.cod] || [], ok = l.filter(x => x[1]).length, ant = ((S.pacote.fdsAnt || {})[c.cod] || []).length;
      return `<li><span style="flex:1">${esc(c.cod)} – ${esc(c.fantasia)}<small>${esc(c.canal)}</small></span><span class="tag">${nomeMes(1)} ${ant}/${l.length}</span><span class="tag ${l.length && ok === l.length ? 'ok' : ''}">${nomeMes(0)} ${ok}/${l.length}</span></li>`; }).join('')}</ul></details>`;
}

/* 2. Ativos da rota */
function pRotaAtivos() {
  const a = ativosDaRota(), n = a.cli.length;
  const lista = (cs, extra) => `<ul class="lista mini">${cs.map(c => `<li><span style="flex:1">${esc(c.cod)} – ${esc(c.fantasia)}<small>${esc(c.canal)}</small></span>${extra(c)}</li>`).join('')}</ul>`;
  const hlAnt = c => n1(((S.pacote.hl || {})[c.cod] || [0, 0])[1]);
  return `<h2>2. Ativos da rota</h2>
    <div class="segs">
      <div class="ok"><b>${a.comGel.length}</b>PDVs com geladeira<small>${n1(a.qGel)} geladeira(s)</small></div>
      <div><b>${a.comChop.length}</b>PDVs com chopeira<small>${n1(a.qChop)} un.</small></div>
      <div><b>${a.comVas.length}</b>PDVs com vasilhame<small>${n1(a.qVas)} cx</small></div>
    </div>
    <p class="dica">${n1(pct(a.comGel.length, n))}% dos PDVs da rota têm geladeira da Cia.</p>
    <div class="card"><b>Giro das geladeiras</b>
      <div class="segs">${['Giro OK', 'Giro Baixo', 'Giro Zero', 'Sem dado'].map(k => `<div class="${k === 'Giro OK' ? 'ok' : k === 'Sem dado' ? '' : 'falta'}"><b>${a.giro[k].length}</b>${k}</div>`).join('')}</div>
      ${a.comGel.length ? `<details><summary>PDVs com geladeira (${a.comGel.length})</summary>${lista(a.comGel, c => `<span class="tag">${hlAnt(c)} HL</span><span class="tag ${/ok/i.test(a.pior(c)) ? 'ok' : /zero|baixo/i.test(a.pior(c)) ? 'alerta' : ''}">${a.pior(c)}</span>`)}</details>` : ''}
    </div>
    <div class="card"><b>Potenciais para geladeira (${a.potenciais.length})</b>
      <small>PDVs <b>sem geladeira</b> que compraram ${n1(a.meta)} HL ou mais em ${nomeMes(1)} (meta de giro de 1 geladeira pela aba refrigeracao_giro).</small>
      ${a.potenciais.length ? lista(a.potenciais.map(x => x.c), c => `<span class="tag ok">${hlAnt(c)} HL</span>`) : '<small>Nenhum PDV sem geladeira atinge a meta de giro.</small>'}
    </div>`;
}

/* 3. SKUs da rota */
function pRotaSkus() {
  const at = skusDaRota(0), an = skusDaRota(1), n = at.cli.length, m = S.rota.mesSkus || 0, k = m ? an : at;
  const seta = (a, b) => b > a ? `<span class="sobe">▲</span>` : b < a ? `<span class="erro">▼</span>` : '';
  return `<h2>3. SKUs da rota</h2>
    <table class="tab"><thead><tr><th></th><th>${nomeMes(1)}</th><th>${nomeMes(0)} até agora</th><th></th></tr></thead><tbody>
      <tr><td>Média SKUs/PDV</td><td>${n1(an.media)}</td><td><b>${n1(at.media)}</b></td><td>${seta(an.media, at.media)}</td></tr>
      <tr><td>PDVs que compraram</td><td>${an.compraram}/${n}</td><td><b>${at.compraram}/${n}</b></td><td>${seta(an.compraram, at.compraram)}</td></tr>
      ${SEGMENTOS_VITORIOSOS.map(s => `<tr><td>PDVs com ${s}</td><td>${an.seg[s]}</td><td><b>${at.seg[s]}</b></td><td>${seta(an.seg[s], at.seg[s])}</td></tr>`).join('')}
    </tbody></table>
    <div class="seg"><label class="${!m ? 'on' : ''}" data-acao="rotaMesSkus" data-v="0">Lista de ${nomeMes(0)}</label><label class="${m ? 'on' : ''}" data-acao="rotaMesSkus" data-v="1">Lista de ${nomeMes(1)}</label></div>
    <details open><summary>SKUs mais presentes na rota (${m ? nomeMes(1) : nomeMes(0)})</summary>${k.top.length ? `<ul class="lista mini">${k.top.map(x => `<li>${imgProd([x[0]], x[1], 'mini')}<span style="flex:1">${esc(x[1])}</span><span class="tag ok">${x[2]} PDVs</span></li>`).join('')}</ul>` : '<small>Sem compras neste mês ainda.</small>'}</details>
    ${k.poucos.length ? `<details><summary>SKUs presentes em poucos PDVs</summary><ul class="lista mini">${k.poucos.map(x => `<li>${imgProd([x[0]], x[1], 'mini')}<span style="flex:1">${esc(x[1])}</span><span class="tag alerta">${x[2]} PDV(s)</span></li>`).join('')}</ul></details>` : ''}`;
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
    prod: (prod.mais[0] ? `Manter giro de ${prod.mais[0][1]}. ` : '') + (prod.menos.length ? 'Trabalhar: ' + prod.menos.slice(0, 3).map(p => p[1]).join(', ') + '.' : ''),
    ativos: (() => { const a = ativosDaRota(); return `Reverter giro em ${a.giro['Giro Zero'].length + a.giro['Giro Baixo'].length} geladeira(s) (zero/baixo)` +
      (a.potenciais.length ? `. Avaliar implantação de geladeira: ${a.potenciais.slice(0, 5).map(x => x.c.fantasia).join(', ')}.` : '.'); })()
  };
}
function tRotaFech() { S.rota.passo = 3; return tRota(); }
function tRotaFechCorpo() {
  const a = AV(), cli = clientesDaRota(), sg = sugestoesRota();
  return `<h2>4. Fechamento da rota</h2>
    <div class="card"><b>Checklist de performance da rota *</b>
      ${CHECK_ROTA.map(([k, t]) => `<div class="item"><span>${t}</span>${rRadio('check.' + k, [['S', 'Sim'], ['P', 'Parcial'], ['N', 'Não']])}</div>`).join('')}</div>
    ${rTexto('planoFds', 'Plano de ação – FDS da rota', 'Itens que faltaram positivar e como vamos positivar', true)}
    <button class="btn peq" data-acao="rotaSugerir" data-k="planoFds" data-v="${esc(sg.fds)}">✨ Sugerir pelos faltantes</button>
    ${rTexto('planoAtivos', 'Plano de ação – ativos (giro e potenciais de geladeira)', '', false)}
    <button class="btn peq" data-acao="rotaSugerir" data-k="planoAtivos" data-v="${esc(sg.ativos)}">✨ Sugerir pelos ativos</button>
    ${rTexto('planoProd', 'Plano de ação – produtos e SKUs', '', true)}
    <button class="btn peq" data-acao="rotaSugerir" data-k="planoProd" data-v="${esc(sg.prod)}">✨ Sugerir pelos produtos</button>
    ${rTexto('fortes', 'Pontos fortes da rota', 'O que o vendedor fez bem', true)}
    ${rTexto('oport', 'OPORTUNIDADES DA ROTA', 'Ex.: baixo share de RGB no bairro X, falta de sinalização de TTV nos bares menores, estoques desorganizados no cliente final', true, 'O que precisa melhorar para a próxima visita?')}
    <div class="card"><b>Qual a sua nota para a execução do seu vendedor? *</b><small>1 = muito ruim · 5 = excelente</small>
      ${rRadio('nota', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']])}</div>
    <div class="card"><b>Assinaturas *</b><small>Assine com o dedo dentro do quadro. Elas saem no boletim da rota.</small>
      ${[['assVend', 'Vendedor ' + esc(S.rota.vend)], ['assSup', 'Supervisor ' + esc(S.usuario.nome || '')]].map(([k, rot]) => `
      <div class="assin"><canvas data-assin="${k}"></canvas><div class="lin sp"><small>${rot}</small>
        <button class="btn peq" data-acao="rotaLimparAss" data-v="${k}">Limpar</button></div></div>`).join('')}
    </div>
    <div id="erros"></div>
    <div class="lin"><button class="btn" data-acao="rotaPasso" data-v="2" style="flex:1">‹ Voltar</button>
      <button class="btn pri" data-acao="rotaSalvar" style="flex:2">Salvar fechamento da rota ✔</button></div>
    <button class="btn" data-acao="rotaCancelar" style="width:100%;margin-top:8px">Cancelar esta rota</button>`;
}
function validarRota() {
  const a = AV(), e = [], t = (v, n = 10) => (v || '').trim().length >= n;
  if (CHECK_ROTA.some(([k]) => !a.check[k])) e.push('Responda todo o checklist de performance');
  if (!t(a.planoFds)) e.push('Descreva o plano de ação do FDS');
  if (!t(a.planoProd)) e.push('Descreva o plano de ação dos produtos');
  if (!t(a.fortes)) e.push('Descreva os pontos fortes da rota');
  if (!t(a.oport)) e.push('Descreva as oportunidades da rota');
  if (!a.nota) e.push('Dê a nota de 1 a 5 para o vendedor');
  if (!a.assVend) e.push('Falta a assinatura do vendedor');
  if (!a.assSup) e.push('Falta a assinatura do supervisor');
  return e;
}
// Dados completos da rota para o boletim do relatório (PDV a PDV, produtos, ativos, SKUs)
// Códigos de produto do item FDS para a foto: os comprados na rota primeiro, depois os do grupo
function imgsFds(g) {
  const P = S.pacote, cont = {};
  clientesDaRota().forEach(c => (((P.fdsProdutos || {})[c.cod] || {})[g] || []).forEach(p => cont[p[0]] = (cont[p[0]] || 0) + 1));
  const vendidos = Object.keys(cont).sort((a, b) => cont[b] - cont[a]);
  return [...new Set(vendidos.concat((P.fdsRepresentantes || {})[g] || []))].slice(0, 5);
}
// SKUs estratégicos (aba skus_pdv, coluna SkuEstrategico) no mês atual
function estrategicosDaRota() {
  const P = S.pacote, cont = {}; let pdvs = 0;
  clientesDaRota().forEach(c => { const l = (P.skus[c.cod] || []).filter(s => s[2]); if (l.length) pdvs++; l.forEach(s => (cont[s[0]] = cont[s[0]] || [String(s[1]).slice(0, 40), 0])[1]++); });
  return { pdvs, total: clientesDaRota().length, lista: Object.values(cont).sort((a, b) => b[1] - a[1]).slice(0, 6) };
}
function detalheRota(rk, fds, at, sk) {
  const P = S.pacote, curto = (t, n = 34) => String(t || '').slice(0, n), prod = (P.vendProd || {})[S.rota.vend] || { mais: [], menos: [] };
  const skAnt = skusDaRota(1);
  return {
    mesAt: nomeMes(0), mesAnt: nomeMes(1),
    rank: { pos: rk.pos_rank, total: rk.total, cx: Math.round(rk.cx || 0), hl: Math.round((rk.hl || 0) * 10) / 10, posit: rk.posit, cart: rk.cart },
    fds: { antPct: Math.round(pct(fds.antT, fds.totT) * 10) / 10, atPct: Math.round(pct(fds.okT, fds.totT) * 10) / 10, ptsPct: Math.round(pct(fds.real, fds.meta) * 10) / 10,
      // [nome, PDVs positivados mês anterior, PDVs positivados mês atual, PDVs com o item, códigos de produto para a foto]
      itens: fds.lista.map(x => [NOMES_FDS[x.g] || x.g, x.ant, x.ok, x.total, imgsFds(x.g)]) },
    cidades: [...new Set(clientesDaRota().map(c => c.cidade))].sort(),
    // [código, PDV, canal, FDS ant, FDS atual, itens FDS, pontos %, HL mês ant, SKUs no mês, geladeira/giro, SKUs (nomes)]
    pdvs: clientesDaRota().map(c => {
      const l = P.fds[c.cod] || [], ant = (P.fdsAnt || {})[c.cod] || [], skus = P.skus[c.cod] || [];
      const pts = l.reduce((s, x) => s + x[3], 0), meta = l.reduce((s, x) => s + x[2], 0);
      const gel = (P.geladeiras[c.cod] || []).length ? at.pior(c) : '';
      return [c.cod, curto(c.fantasia, 30), c.canal, l.filter(x => ant.includes(x[0])).length, l.filter(x => x[1]).length, l.length,
        Math.round(pct(pts, meta)), Math.round(((P.hl || {})[c.cod] || [0, 0])[1] * 10) / 10, skus.length, gel, skus.slice(0, 8).map(x => curto(x[1], 28)).join('; ')];
    }),
    prodMais: prod.mais.map(p => [curto(p[1], 40), p[2]]), prodMenos: prod.menos.map(p => [curto(p[1], 40), p[2]]),
    ativos: { pdvs: at.cli.length, comGel: at.comGel.length, qGel: at.qGel, giroOk: at.giro['Giro OK'].length, giroBaixo: at.giro['Giro Baixo'].length,
      giroZero: at.giro['Giro Zero'].length, semDado: at.giro['Sem dado'].length, comChop: at.comChop.length, qChop: at.qChop, comVas: at.comVas.length, qVas: at.qVas,
      metaGel: at.meta, potenciais: at.potenciais.slice(0, 25).map(x => [x.c.cod, curto(x.c.fantasia, 30), x.c.canal, x.hl]) },
    skus: { media: Math.round(sk.media * 10) / 10, mediaAnt: Math.round(skAnt.media * 10) / 10, compraram: sk.compraram, seg: sk.seg,
      top: sk.top.map(x => [curto(x[1], 40), x[2]]), poucos: sk.poucos.map(x => [curto(x[1], 40), x[2]]),
      segAnt: skAnt.seg, compraramAnt: skAnt.compraram, estrategicos: estrategicosDaRota() }
  };
}
async function salvarRota() {
  const er = validarRota();
  if (er.length) { document.getElementById('erros').innerHTML = `<div class="aviso erro">${er.map(esc).join('<br>')}</div>`; return; }
  const r = S.rota, a = AV(), cli = clientesDaRota(), rk = posicaoVend(r.vend), fds = fdsDaRota(), at = ativosDaRota(), sk = skusDaRota();
  const notaChk = Math.round(CHECK_ROTA.reduce((s, [k]) => s + ({ S: 2, P: 1, N: 0 }[a.check[k]] || 0), 0) / (CHECK_ROTA.length * 2) * 100);
  const reg = {
    id: uid(), mes: mesAtual(), data: hoje(), objetivo: 'ROTA_FECHAMENTO', objetivoNome: 'Fechamento de rota completa',
    cod: `ROTA-${r.vend}-${r.dia}`, fantasia: `Rota vendedor ${r.vend} – ${r.dia}`, sup: (cli[0] || {}).sup || S.usuario.sup, vend: r.vend,
    cidade: [...new Set(cli.map(c => c.cidade))].join(', '), dia: r.dia, canalCadastro: '', canal: '', canalCorreto: true,
    respostas: { ...a, ranking: rk.pos_rank + 'º de ' + rk.total, criterioRanking: S.filtros.ordemRank || 'cx', clientesRota: cli.length,
      fdsRota: fds.lista.map(x => `${x.g}: ant ${x.ant}/${x.total} atual ${x.ok}/${x.total}`).join(' · '),
      ativosRota: `geladeiras ${at.comGel.length} PDVs (OK ${at.giro['Giro OK'].length}, baixo ${at.giro['Giro Baixo'].length}, zero ${at.giro['Giro Zero'].length}) · chopeiras ${at.comChop.length} · vasilhames ${at.comVas.length} · potenciais ${at.potenciais.map(x => x.c.cod).join(', ')}`,
      skusRota: `${nomeMes(1)}: média ${n1(skusDaRota(1).media)} SKUs/PDV · ${nomeMes(0)}: média ${n1(sk.media)} SKUs/PDV · ${sk.compraram}/${cli.length} compraram · ` + SEGMENTOS_VITORIOSOS.map(k => k + ' ' + sk.seg[k]).join(', '),
      detalhe: detalheRota(rk, fds, at, sk) },
    resumo: { fds: fds.real, fdsMeta: fds.meta, skus: n1(sk.media), fortes: a.fortes, oport: a.oport, notaCoaching: notaChk,
      obs: `Nota vendedor: ${a.nota}/5 · ${cli.length} PDVs · ranking ${rk.pos_rank}º de ${rk.total} · FDS ${n1(pct(fds.antT, fds.totT))}% → ${n1(pct(fds.okT, fds.totT))}% · Plano FDS: ${a.planoFds} · Plano ativos: ${a.planoAtivos || '-'} · Plano produtos: ${a.planoProd}` },
    fotos: [a.assVend ? { tipo: 'assinatura_vendedor', dados: a.assVend } : null, a.assSup ? { tipo: 'assinatura_supervisor', dados: a.assSup } : null].filter(Boolean)
  };
  delete reg.respostas.assVend; delete reg.respostas.assSup;   // as imagens vão como fotos, não no texto
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
      S.rota = { id: uid(), vend: vd, dia: v, mes: mesAtual(), inicio: new Date().toISOString(), passo: 0 };
      await DB.set('rota', S.rota); S.objetivo = 'ROTA_COMPLETA'; S.tela = 'rota'; scrollTo(0, 0); break;
    }
    case 'rotaPasso': S.rota.passo = Math.max(0, Math.min(3, Number(v))); await DB.set('rota', S.rota); scrollTo(0, 0); break;
    case 'rotaContinuar': S.objetivo = 'ROTA_COMPLETA'; S.tela = 'rota'; break;
    case 'rotaCancelar': if (!confirm('Cancelar esta rota? As visitas já salvas continuam valendo.')) return; S.rota = null; await DB.del('rota'); S.tela = 'resumo'; break;
    case 'rotaSugerir': { const k = el.dataset.k, at = AV()[k] || ''; if (!v || at.includes(v)) return; AV()[k] = at.trim() ? at.trimEnd() + '\n' + v : v; await DB.set('rota', S.rota); break; }
    case 'rotaMesSkus': S.rota.mesSkus = Number(v); break;
    case 'rotaLimparAss': delete AV()[v]; await DB.set('rota', S.rota); break;
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

/* ---------- assinatura com o dedo ---------- */
function iniciarAssinaturas() {
  document.querySelectorAll('canvas[data-assin]').forEach(cv => {
    const k = cv.dataset.assin, dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1d2420';
    if (AV()[k]) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, w, h); im.src = AV()[k]; }
    let desenhando = false, ult = null;
    const ponto = ev => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    cv.onpointerdown = ev => { desenhando = true; ult = ponto(ev); cv.setPointerCapture(ev.pointerId); ev.preventDefault(); };
    cv.onpointermove = ev => { if (!desenhando) return; const p = ponto(ev); ctx.beginPath(); ctx.moveTo(ult[0], ult[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); ult = p; ev.preventDefault(); };
    cv.onpointerup = cv.onpointercancel = () => {
      if (!desenhando) return; desenhando = false;
      const out = document.createElement('canvas'); out.width = 600; out.height = Math.round(600 * h / w);
      const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(cv, 0, 0, out.width, out.height);
      AV()[k] = out.toDataURL('image/jpeg', 0.8); DB.set('rota', S.rota);
    };
  });
}
