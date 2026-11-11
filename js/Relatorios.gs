/**
 * RELATÓRIOS DE EVIDÊNCIAS — Rotas de Execução
 * ---------------------------------------------
 * Todo dia: monta uma planilha por relatório (no Drive, pasta RotasApp_Relatorios/AAAA-MM),
 * exporta PDF + Excel e envia por e-mail para quem estiver na aba "destinatarios".
 * Dia 1 do mês: envia o FECHAMENTO do mês anterior (evidência final).
 *
 * Relatórios: PROPRIETARIO, GV, SV (os 3 supervisores juntos), TRADE_40, TRADE_10, GC.
 * Funções para rodar pelo editor:
 *   instalarGatilhoRelatorios()  -> cria o envio automático diário (7h)
 *   testarRelatorios()           -> gera todos e manda só para você (dono do script)
 *   enviarRelatoriosDiarios()    -> o que o gatilho roda
 */

var PASTA_RELATORIOS = 'RotasApp_Relatorios';
var CAB_DESTINATARIOS = ['relatorio', 'emails', 'descricao'];

var OBJ_NOMES = {
  FDS: 'FDS (P de presença)', COACHING: 'Coaching – rotina básica', RGB_COMPASS: 'Maiores potenciais RGB (COMPASS) – Bar',
  RGB_QUEDA: 'Maiores quedas RGB', RGB: 'Foco em RGB', ROTA_FECHAMENTO: 'Rota completa com o vendedor',
  TRADE: 'Alavancas de Trade Marketing', FDS_BAIXA: 'Baixa performance no FDS (4Ps)'
};

// Regras de cada relatório (metas conforme as regras de cada rota)
var RELATORIOS = {
  PROPRIETARIO: { titulo: 'Rota Proprietário / Diretor', perfis: ['PROPRIETARIO'], minimo: 20,
    objetivos: [['RGB_COMPASS', 10], ['RGB_QUEDA', 10]],
    regra: 'Mínimo 20 PDVs diferentes: 10 maiores potenciais RGB (COMPASS, Bar) + 10 maiores quedas RGB. Um objetivo por PDV.' },
  GV: { titulo: 'Rota GV – Gerente de Vendas', perfis: ['GV'], minimo: 50,
    objetivos: [['FDS', 20], ['COACHING', 20], ['RGB_COMPASS', 10]],
    regra: 'Mínimo 50 PDVs diferentes: 20 FDS + 20 coaching + 10 potencial COMPASS em RGB (Bar). Um objetivo por PDV.' },
  SV: { titulo: 'Rota SV – Supervisores de Vendas', perfis: ['SV'], minimo: 30,
    objetivos: [['FDS', 10], ['COACHING', 5, 'porVendedor'], ['RGB', 20], ['ROTA_FECHAMENTO', 1]],
    regra: 'Mínimo 30 PDVs (10 FDS + 20 RGB) + coaching (5 PDVs por vendedor) + 1 rota completa com o pior vendedor do ranking.' },
  TRADE_40: { titulo: 'Rota Trade Marketing – 40 PDVs (alavancas)', perfis: ['TRADE'], minimo: 40,
    objetivos: [['TRADE', 40]],
    regra: 'Mínimo 40 PDVs diferentes com foco nas alavancas de Trade. FDS, SKUs por PDV e vitoriosos para todos os PDVs.' },
  TRADE_10: { titulo: 'Rota Trade Marketing – 10 PDVs de baixa performance no FDS', perfis: ['TRADE'], minimo: 10,
    objetivos: [['FDS_BAIXA', 10]],
    regra: 'Mínimo 10 PDVs de baixa performance no P de presença, com a performance aberta dos 4 Ps (Presença, Visibilidade, Preço e Posicionamento).' },
  GC: { titulo: 'Rota GC – Gerente Comercial', perfis: ['GC'], minimo: 30,
    objetivos: [['FDS', 10], ['COACHING', 10], ['RGB_QUEDA', 10]],
    regra: 'Mínimo 30 PDVs diferentes: 10 FDS + 10 coaching + 10 maiores quedas RGB (causa obrigatória). Um objetivo por PDV.' }
};

/* ============================ PARTE PURA (testável) ============================ */

function jsonSeguro_(t) { try { return JSON.parse(t || '{}') || {}; } catch (e) { return {}; } }
function txt_(v) { return v == null ? '' : String(v).trim(); }
function pctTxt_(a, b) { return b ? Math.round(a / b * 1000) / 10 : ''; }
function simNao_(v) { return v === 'S' ? 'Sim' : v === 'N' ? 'Não' : v === 'P' ? 'Parcial' : txt_(v); }
function precoTxt_(p) { if (!p) return ''; if (p.na) return 'N/A'; return [p.ttc ? 'TTC ' + p.ttc : '', p.ttv ? 'TTV ' + p.ttv : ''].filter(String).join(' / ') + (p.marca ? ' (' + (p.marca === 'Outra' ? p.marcaOutra : p.marca) + ')' : ''); }

/** Converte as linhas de rotas_respostas em objetos (só o mês pedido). */
function lerVisitas(matriz, mes) {
  var cab = matriz[0] || [], ix = {}, out = [];
  cab.forEach(function (c, i) { ix[String(c).trim()] = i; });
  for (var i = 1; i < matriz.length; i++) {
    var r = matriz[i], m = mes_(r[ix.mes]);
    if (mes && m !== mes) continue;
    var v = {}; cab.forEach(function (c, j) { v[String(c).trim()] = r[j]; });
    v.mes = m; v.login = txt_(v.login).toLowerCase(); v.cod_cli = txt_(v.cod_cli); v.vendedor = txt_(v.vendedor);
    v.data = data_(v.data_visita) || txt_(v.data_visita); v.r = jsonSeguro_(v.json);
    v.recebido = v.recebido_em instanceof Date ? v.recebido_em.getTime() : Date.parse(v.recebido_em) || 0;
    out.push(v);
  }
  return out;
}

/** Monta o conteúdo de um relatório.  dados = { visitas, usuarios:[{login,nome,perfil,sup}], vendPorSup:{100:[...]}, mes, agora } */
function montarModeloRelatorio(tipo, dados) {
  var cfg = RELATORIOS[tipo], mes = dados.mes;
  var pessoas = dados.usuarios.filter(function (u) { return cfg.perfis.indexOf(u.perfil) >= 0; });
  // inclui quem tem visita mas não está mais na aba usuarios
  dados.visitas.forEach(function (v) {
    if (cfg.perfis.indexOf(String(v.perfil).toUpperCase()) >= 0 && !pessoas.some(function (p) { return p.login === v.login; }))
      pessoas.push({ login: v.login, nome: v.nome, perfil: String(v.perfil).toUpperCase(), sup: txt_(v.supervisor) });
  });
  var idsObj = cfg.objetivos.map(function (o) { return o[0]; });
  var vis = dados.visitas.filter(function (v) { return pessoas.some(function (p) { return p.login === v.login; }) && idsObj.indexOf(v.objetivo) >= 0; });
  var multi = pessoas.length > 1, pend = [], ontem = (dados.agora || Date.now()) - 864e5;

  var resumoPessoas = pessoas.map(function (p) {
    var vp = vis.filter(function (v) { return v.login === p.login; });
    var objs = cfg.objetivos.map(function (o) {
      var id = o[0], meta = o[1], doObj = vp.filter(function (v) { return v.objetivo === id; }), feito = doObj.length, porVend = null;
      if (o[2] === 'porVendedor') {
        var vends = (dados.vendPorSup[p.sup] || []).slice(), cont = {};
        doObj.forEach(function (v) { cont[v.vendedor] = (cont[v.vendedor] || 0) + 1; if (vends.indexOf(v.vendedor) < 0) vends.push(v.vendedor); });
        porVend = vends.sort().map(function (vd) { return { vend: vd, feito: cont[vd] || 0, meta: meta, ok: (cont[vd] || 0) >= meta }; });
        feito = porVend.reduce(function (s, x) { return s + Math.min(meta, x.feito); }, 0);
        meta = meta * Math.max(1, porVend.length);
      }
      return { id: id, nome: OBJ_NOMES[id] || id, meta: meta, feito: feito, ok: feito >= meta, porVend: porVend, pdvs: doObj.length };
    });
    var pdvs = {}, dup = {}, todas = dados.visitas.filter(function (v) { return v.login === p.login && v.objetivo !== 'ROTA_FECHAMENTO'; });
    todas.forEach(function (v) { if (idsObj.indexOf(v.objetivo) < 0) return; pdvs[v.cod_cli] = v.objetivo; });
    var porCod = {}; todas.forEach(function (v) { (porCod[v.cod_cli] = porCod[v.cod_cli] || {})[v.objetivo] = 1; });
    Object.keys(porCod).forEach(function (c) { if (Object.keys(porCod[c]).length > 1 && pdvs[c]) dup[c] = 1; });
    Object.keys(dup).forEach(function (c) { pend.push([p.nome, '', 'Vários', c, '', 'PDV registrado em mais de um objetivo (não é aceito)']); });
    var nPdvs = Object.keys(pdvs).length;
    var minimoPdvs = tipo === 'SV' ? 30 : cfg.minimo;
    var pdvsObjetivo = tipo === 'SV' ? vp.filter(function (v) { return v.objetivo === 'FDS' || v.objetivo === 'RGB'; }).length : nPdvs;
    var ok = objs.every(function (o) { return o.ok; }) && pdvsObjetivo >= minimoPdvs;
    return { login: p.login, nome: p.nome || p.login, sup: p.sup, objetivos: objs, pdvs: nPdvs, pdvsObjetivo: pdvsObjetivo, minimo: minimoPdvs, ok: ok,
      novas: vp.filter(function (v) { return v.recebido >= ontem; }).length,
      faltam: objs.filter(function (o) { return !o.ok; }).map(function (o) { return o.nome + ': faltam ' + (o.meta - o.feito); }) };
  });

  // ---- abas de evidência (uma por objetivo)
  var abas = cfg.objetivos.map(function (o) {
    var id = o[0], linhas = vis.filter(function (v) { return v.objetivo === id; })
      .sort(function (a, b) { return (a.nome + a.recebido) < (b.nome + b.recebido) ? -1 : 1; });
    var def = colunasObjetivo_(id), cols = def.cols.slice();
    if (multi) cols.unshift(['Responsável', 18]);
    var rows = linhas.map(function (v) {
      var problemas = def.pendencias(v);
      problemas.forEach(function (pb) { pend.push([v.nome, v.data, OBJ_NOMES[id], v.cod_cli, txt_(v.fantasia), pb]); });
      var lin = def.valores(v).map(function (x) { return x == null || (typeof x === 'number' && isNaN(x)) ? '' : x; }); lin.push(problemas.length ? '⚠ ' + problemas.join('; ') : 'OK');
      if (multi) lin.unshift(v.nome);
      return lin;
    });
    cols.push(['Validação', 22]);
    return { id: id, nome: abaNome_(id), titulo: OBJ_NOMES[id] + ' – ' + linhas.length + ' registro(s)', colunas: cols, linhas: rows };
  });

  var okGeral = resumoPessoas.length > 0 && resumoPessoas.every(function (p) { return p.ok; });
  return { tipo: tipo, titulo: cfg.titulo, regra: cfg.regra, mes: mes, gerado: dados.agoraTxt || '', pessoas: resumoPessoas, abas: abas, pendencias: pend,
    ok: okGeral, novas: resumoPessoas.reduce(function (s, p) { return s + p.novas; }, 0) };
}

function abaNome_(id) {
  return { FDS: 'FDS', COACHING: 'Coaching', RGB_COMPASS: 'RGB COMPASS', RGB_QUEDA: 'RGB Quedas', RGB: 'RGB', ROTA_FECHAMENTO: 'Rota completa', TRADE: 'Trade 40', FDS_BAIXA: '4Ps baixa performance' }[id] || id;
}

/** Colunas, valores e regras de "despontua" de cada objetivo */
function colunasObjetivo_(id) {
  var base = [['Data', 10], ['Código', 11], ['PDV', 24], ['Cidade', 13], ['Vendedor', 9], ['Canal', 13]];
  var vBase = function (v) { return [v.data, v.cod_cli, txt_(v.fantasia), txt_(v.cidade), v.vendedor, txt_(v.canal_validado)]; };
  var fdsPct = function (v) { return pctTxt_(Number(v.fds_pontos) || 0, Number(v.fds_meta) || 0); };
  var fo = function (v, obr) { var e = []; if (obr && !txt_(v.pontos_fortes)) e.push('Sem pontos fortes'); if (obr && !txt_(v.oportunidades)) e.push('Sem oportunidades'); return e; };
  var semFds = function (v) { return txt_(v.fds_meta) === '' ? ['Sem P de presença'] : Number(v.fds_meta) === 0 ? ['PDV sem matriz FDS'] : []; };
  var precos = function (v) { var p = v.r.precos || {}; return ['Heineken', 'Original', 'Amstel', 'M1'].map(function (m) { return precoTxt_(p[m]); }); };
  var colPrecos = [['Heineken TTC/TTV', 14], ['Original TTC/TTV', 14], ['Amstel TTC/TTV', 14], ['M1 TTC/TTV', 16]];

  if (id === 'FDS') return {
    cols: base.concat([['P presença (pts)', 9], ['Meta FDS', 8], ['Presença %', 9], ['Visibilidade', 9], ['Geladeira/Refrig.', 10], ['Precificação', 9], ['SKUs', 6], ['Vitoriosos', 18], ['Pontos fortes', 28], ['Oportunidades', 28]]),
    valores: function (v) { return vBase(v).concat([v.fds_pontos, v.fds_meta, fdsPct(v), v.visib_pontos, v.ativos_pontos, v.preco_pontos, v.skus_qtd, txt_(v.skus_vitoriosos), txt_(v.pontos_fortes), txt_(v.oportunidades)]); },
    pendencias: function (v) { return semFds(v); } };

  if (id === 'COACHING') return {
    cols: base.concat([['Nota rotina %', 9], ['Gerou pedido', 8], ['Feedback na hora', 9], ['Presença FDS %', 9], ['Pontos fortes', 28], ['Oportunidades', 28], ['Compromisso do vendedor', 28]]),
    valores: function (v) { var c = v.r.coaching || {}; return vBase(v).concat([v.nota_coaching, simNao_(c.pedido), simNao_(c.feedback), fdsPct(v), txt_(v.pontos_fortes), txt_(v.oportunidades), txt_(c.compromisso)]); },
    pendencias: function (v) { return fo(v, true); } };

  if (id === 'RGB_COMPASS' || id === 'RGB_QUEDA' || id === 'RGB') return {
    cols: base.concat([['Critério', 16], ['Share RGB %', 8], ['SKUs RGB nossos', 8], ['SKUs RGB conc.', 8], ['Concorrente RGB', 13], ['TTC conc.', 8], ['TTV conc.', 8]]).concat(colPrecos)
      .concat([['Motivo da queda', 18], ['Ação combinada', 26], ['Presença FDS %', 9], ['Oportunidades', 26]]),
    valores: function (v) {
      var g = v.r.rgb || {}, conc = g.concNA ? 'N/A (não trabalha)' : (g.marcaConc === 'Outra' ? g.marcaConcOutra : g.marcaConc);
      return vBase(v).concat([id === 'RGB_QUEDA' ? 'Maiores quedas' : id === 'RGB_COMPASS' ? 'Potencial COMPASS' : txt_(g.tipo), g.share, g.skusNossos, g.skusConc, txt_(conc), g.concNA ? '' : g.ttcConc, g.concNA ? '' : g.ttvConc])
        .concat(precos(v)).concat([txt_(g.motivo), txt_(g.acao), fdsPct(v), txt_(v.oportunidades)]);
    },
    pendencias: function (v) {
      var g = v.r.rgb || {}, e = [];
      if (txt_(g.share) === '') e.push('Sem share RGB');
      if (!g.concNA && txt_(g.skusConc) === '') e.push('Sem SKUs RGB da concorrência');
      if ((id === 'RGB_QUEDA' || g.tipo === 'Maiores quedas') && !txt_(g.motivo)) e.push('Sem causa da queda');
      return e;
    } };

  if (id === 'ROTA_FECHAMENTO') return {
    cols: [['Data', 10], ['Vendedor', 9], ['Dia da rota', 10], ['Ranking mês anterior', 11], ['Nota do vendedor (1-5)', 9], ['Checklist %', 8],
      ['Visitou todos', 8], ['TTV sugerido', 8], ['Coleta no app', 8], ['Atitude', 8], ['EPIs', 7],
      ['FDS da rota', 30], ['Ativos da rota', 30], ['SKUs da rota', 26], ['Plano FDS', 26], ['Plano ativos', 22], ['Plano produtos', 22], ['Pontos fortes', 26], ['Oportunidades da rota', 26]],
    valores: function (v) {
      var r = v.r, c = r.check || {};
      return [v.data, v.vendedor, txt_(v.dia), txt_(r.ranking), r.nota, v.nota_coaching, simNao_(c.todos), simNao_(c.ttv), simNao_(c.coleta), simNao_(c.atitude), simNao_(c.epi),
        txt_(r.fdsRota), txt_(r.ativosRota), txt_(r.skusRota), txt_(r.planoFds), txt_(r.planoAtivos), txt_(r.planoProd), txt_(v.pontos_fortes), txt_(v.oportunidades)];
    },
    pendencias: function (v) { var e = fo(v, true); if (!txt_(v.r.ranking)) e.push('Sem colocação no ranking'); return e; } };

  if (id === 'TRADE') return {
    cols: base.concat([['Presença FDS %', 9], ['SKUs no PDV', 7], ['Vitoriosos', 18], ['Visibilidade', 9], ['Geladeira/Refrig.', 10], ['Precificação', 9], ['Alavancas trabalhadas', 34], ['Pontos fortes', 26], ['Oportunidades', 26]]),
    valores: function (v) { return vBase(v).concat([fdsPct(v), v.skus_qtd, txt_(v.skus_vitoriosos), v.visib_pontos, v.ativos_pontos, v.preco_pontos, txt_((v.r.trade || {}).alavancasTexto), txt_(v.pontos_fortes), txt_(v.oportunidades)]); },
    pendencias: function (v) { var e = semFds(v).concat(fo(v, true)); if (!txt_((v.r.trade || {}).alavancasTexto)) e.push('Sem alavancas'); return e; } };

  if (id === 'FDS_BAIXA') return {
    cols: base.concat([['P1 Presença (FDS %)', 10], ['P2 Visibilidade', 9], ['P3 Preço (precificação)', 10], ['P4 Posicionamento', 10], ['Média 4Ps', 8]]).concat(colPrecos)
      .concat([['Plano de ação FDS', 30], ['Alavancas trabalhadas', 30], ['Pontos fortes', 24], ['Oportunidades', 24]]),
    valores: function (v) {
      var ps = [fdsPct(v), Number(v.visib_pontos), Number(v.preco_pontos), Number(v.ativos_pontos)].filter(function (x) { return x !== '' && !isNaN(x); });
      var media = ps.length ? Math.round(ps.reduce(function (s, x) { return s + Number(x); }, 0) / ps.length * 10) / 10 : '';
      return vBase(v).concat([fdsPct(v), v.visib_pontos, v.preco_pontos, v.ativos_pontos, media]).concat(precos(v))
        .concat([txt_((v.r.trade || {}).planoFds), txt_((v.r.trade || {}).alavancasTexto), txt_(v.pontos_fortes), txt_(v.oportunidades)]);
    },
    pendencias: function (v) { var e = semFds(v).concat(fo(v, true)); if (!txt_((v.r.trade || {}).planoFds)) e.push('Sem plano de ação FDS'); return e; } };

  return { cols: base, valores: vBase, pendencias: function () { return []; } };
}

/** Resumo em HTML para o corpo do e-mail (tabelas simples, funciona em qualquer leitor de e-mail). */
function modeloParaHtml(m, links) {
  var V = '#154026', O = '#c49f44';
  var st = function (ok) { return ok ? '<span style="color:#0a7a3c;font-weight:bold">✔ Meta batida</span>' : '<span style="color:#c0392b;font-weight:bold">✘ Pendente</span>'; };
  var th = 'style="background:' + V + ';color:#fff;padding:6px 8px;text-align:left;font-size:13px"', td = 'style="padding:6px 8px;border-bottom:1px solid #e5e5e5;font-size:13px"';
  var h = '<div style="font-family:Arial,Helvetica,sans-serif;color:#1d2420;max-width:760px">' +
    '<div style="background:' + V + ';color:#fff;padding:14px 16px;border-bottom:4px solid ' + O + '"><div style="font-size:18px;font-weight:bold">' + m.titulo + '</div>' +
    '<div style="font-size:13px;color:#e5d3a3">Mês ' + m.mes.split('-').reverse().join('/') + ' · atualizado em ' + m.gerado + '</div></div>' +
    '<p style="font-size:13px;color:#555">' + m.regra + '</p>' +
    '<p style="font-size:15px"><b>Situação geral:</b> ' + st(m.ok) + (m.novas ? ' · ' + m.novas + ' registro(s) novo(s) nas últimas 24h' : '') + '</p>';
  m.pessoas.forEach(function (p) {
    h += '<h3 style="color:' + V + ';margin:18px 0 6px">' + p.nome + (p.sup ? ' – supervisor ' + p.sup : '') + ' &nbsp;' + st(p.ok) + '</h3>' +
      '<table cellspacing="0" style="border-collapse:collapse;width:100%"><tr><th ' + th + '>Objetivo</th><th ' + th + '>Meta</th><th ' + th + '>Feito</th><th ' + th + '>Status</th></tr>';
    p.objetivos.forEach(function (o) {
      h += '<tr><td ' + td + '>' + o.nome + '</td><td ' + td + '>' + o.meta + '</td><td ' + td + '><b>' + o.feito + '</b></td><td ' + td + '>' + (o.ok ? '✔' : '✘ faltam ' + (o.meta - o.feito)) + '</td></tr>';
      if (o.porVend) h += '<tr><td colspan="4" ' + td + '><small>' + o.porVend.map(function (x) { return 'vend ' + x.vend + ': ' + x.feito + '/' + x.meta + (x.ok ? ' ✔' : ''); }).join(' · ') + '</small></td></tr>';
    });
    h += '<tr><td ' + td + '><b>PDVs diferentes' + (m.tipo === 'SV' ? ' (FDS + RGB)' : '') + '</b></td><td ' + td + '>' + p.minimo + '</td><td ' + td + '><b>' + p.pdvsObjetivo + '</b></td><td ' + td + '>' + (p.pdvsObjetivo >= p.minimo ? '✔' : '✘ faltam ' + (p.minimo - p.pdvsObjetivo)) + '</td></tr></table>';
  });
  h += '<h3 style="color:' + V + '">Itens que despontuam (' + m.pendencias.length + ')</h3>' +
    (m.pendencias.length ? '<ul style="font-size:13px">' + m.pendencias.slice(0, 30).map(function (x) { return '<li>' + [x[0], x[1], x[3], x[4]].filter(String).join(' · ') + ': <b>' + x[5] + '</b></li>'; }).join('') + '</ul>' : '<p style="font-size:13px">Nenhum. Todas as informações obrigatórias foram preenchidas.</p>');
  if (links) h += '<p style="font-size:13px">📎 Em anexo: PDF (para ler) e Excel (para filtrar). <a href="' + links.planilha + '">Abrir a planilha no Drive</a> · <a href="' + links.pasta + '">Pasta de evidências do mês</a></p>';
  return h + '<p style="font-size:11px;color:#888">Gerado automaticamente pelo app Rotas de Execução – Lince Distribuidora.</p></div>';
}

/* ============================ PARTE GOOGLE (planilha, PDF, e-mail) ============================ */

function lerDadosRelatorio_(mes) {
  var ss = ss_();
  var visitas = lerVisitas(abaOuCria_('rotas_respostas', CAB_RESPOSTAS).getDataRange().getValues(), mes);
  var usuarios = lerUsuarios_().map(function (u) { var p = perfilPublico_(u); return { login: p.login, nome: p.nome, perfil: p.perfil, sup: p.sup }; });
  var b = lerAba_(ss, 'base_clientes'), ib = idx_(b[0]), vendPorSup = {};
  for (var i = 1; i < b.length; i++) {
    var sup = semPrefixo_(b[i][ib.SupCliCod]), vd = semPrefixo_(b[i][ib.VendCliCod]);
    if (!sup || sup === '-') continue;
    var l = vendPorSup[sup] = vendPorSup[sup] || [];
    if (l.indexOf(vd) < 0) l.push(vd);
  }
  var agora = new Date();
  return { visitas: visitas, usuarios: usuarios, vendPorSup: vendPorSup, mes: mes, agora: agora.getTime(),
    agoraTxt: Utilities.formatDate(agora, 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') };
}

function pastaRelatoriosMes_(mes) {
  var raiz = pastaDrive_(PASTA_RELATORIOS), it = raiz.getFoldersByName(mes);
  return it.hasNext() ? it.next() : raiz.createFolder(mes);
}

/** Escreve o modelo numa planilha Google (cria ou reaproveita a do mês). */
function escreverPlanilha_(m, pasta) {
  var nome = 'Evidências ' + m.titulo + ' – ' + m.mes, it = pasta.getFilesByName(nome), ss;
  if (it.hasNext()) ss = SpreadsheetApp.openById(it.next().getId());
  else { ss = SpreadsheetApp.create(nome); DriveApp.getFileById(ss.getId()).moveTo(pasta); }
  var V = '#154026', O = '#c49f44', VC = '#eaf1ec', VERM = '#fdeaea';
  var abas = [{ nome: 'Resumo' }].concat(m.abas).concat([{ nome: 'Pendências' }]);
  // cria/limpa abas
  abas.forEach(function (a, i) {
    var sh = ss.getSheetByName(a.nome) || ss.insertSheet(a.nome, i);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
    sh.clear(); sh.clearFormats(); a.sh = sh;
  });
  ss.getSheets().forEach(function (sh) { if (!abas.some(function (a) { return a.sh.getSheetId() === sh.getSheetId(); })) ss.deleteSheet(sh); });

  // ---- Resumo
  var R = abas[0].sh, lin = 1;
  R.getRange(lin, 1, 1, 6).merge().setValue(m.titulo).setFontSize(16).setFontWeight('bold').setFontColor('#fff').setBackground(V); lin++;
  R.getRange(lin, 1, 1, 6).merge().setValue('Mês ' + m.mes.split('-').reverse().join('/') + ' · atualizado em ' + m.gerado).setFontColor('#e5d3a3').setBackground(V); lin++;
  R.getRange(lin, 1, 1, 6).merge().setValue(m.regra).setWrap(true).setFontColor('#555'); R.setRowHeight(lin, 36); lin++;
  R.getRange(lin, 1, 1, 6).merge().setValue('SITUAÇÃO GERAL: ' + (m.ok ? '✔ METAS BATIDAS' : '✘ PENDENTE')).setFontWeight('bold').setFontSize(13)
    .setBackground(m.ok ? VC : VERM).setFontColor(m.ok ? '#0a7a3c' : '#c0392b'); lin += 2;
  m.pessoas.forEach(function (p) {
    R.getRange(lin, 1, 1, 6).merge().setValue(p.nome + (p.sup ? ' – supervisor ' + p.sup : '') + '   ' + (p.ok ? '✔ Meta batida' : '✘ Pendente'))
      .setFontWeight('bold').setFontSize(12).setFontColor(V).setBackground('#f7efdb').setBorder(false, false, true, false, false, false, O, SpreadsheetApp.BorderStyle.SOLID_MEDIUM); lin++;
    var t = [['Objetivo', 'Meta', 'Realizado', '%', 'Status', 'Detalhe']];
    p.objetivos.forEach(function (o) {
      t.push([o.nome, o.meta, o.feito, o.meta ? Math.min(1, o.feito / o.meta) : 0, o.ok ? '✔ OK' : '✘ Faltam ' + (o.meta - o.feito),
        o.porVend ? o.porVend.map(function (x) { return x.vend + ': ' + x.feito + '/' + x.meta + (x.ok ? ' ✔' : ''); }).join('  ·  ') : (o.pdvs !== o.feito ? o.pdvs + ' registro(s)' : '')]);
    });
    t.push(['PDVs diferentes' + (m.tipo === 'SV' ? ' (FDS + RGB)' : ''), p.minimo, p.pdvsObjetivo, p.minimo ? Math.min(1, p.pdvsObjetivo / p.minimo) : 0,
      p.pdvsObjetivo >= p.minimo ? '✔ OK' : '✘ Faltam ' + (p.minimo - p.pdvsObjetivo), 'Total de PDVs visitados: ' + p.pdvs]);
    var rg = R.getRange(lin, 1, t.length, 6); rg.setValues(t).setVerticalAlignment('middle');
    R.getRange(lin, 1, 1, 6).setBackground(V).setFontColor('#fff').setFontWeight('bold');
    R.getRange(lin + 1, 4, t.length - 1, 1).setNumberFormat('0%');
    for (var k = 1; k < t.length; k++) R.getRange(lin + k, 5).setBackground(String(t[k][4]).indexOf('✔') === 0 ? VC : VERM).setFontWeight('bold');
    R.getRange(lin + t.length - 1, 1, 1, 6).setFontWeight('bold');
    rg.setBorder(true, true, true, true, true, true, '#dfe5e1', SpreadsheetApp.BorderStyle.SOLID);
    lin += t.length + 1;
  });
  R.getRange(lin, 1, 1, 6).merge().setValue('Itens que despontuam: ' + m.pendencias.length + ' (detalhes na aba Pendências)')
    .setFontWeight('bold').setBackground(m.pendencias.length ? VERM : VC);
  [34, 9, 10, 8, 16, 60].forEach(function (w, i) { R.setColumnWidth(i + 1, w * 7); });
  R.getRange(1, 6, lin, 1).setWrap(true);

  // ---- abas de evidência
  m.abas.forEach(function (a, n) {
    var sh = abas[n + 1].sh, nc = a.colunas.length;
    sh.getRange(1, 1, 1, nc).merge().setValue(a.titulo).setFontWeight('bold').setFontSize(13).setFontColor('#fff').setBackground(V);
    sh.getRange(2, 1, 1, nc).setValues([a.colunas.map(function (c) { return c[0]; })]).setFontWeight('bold').setBackground(O).setWrap(true).setVerticalAlignment('middle');
    if (a.linhas.length) {
      sh.getRange(3, 1, a.linhas.length, nc).setValues(a.linhas).setWrap(true).setVerticalAlignment('top').setFontSize(9)
        .setBorder(true, true, true, true, true, true, '#dfe5e1', SpreadsheetApp.BorderStyle.SOLID);
      a.linhas.forEach(function (l, i) {
        var c = sh.getRange(3 + i, nc); c.setFontWeight('bold').setBackground(l[nc - 1] === 'OK' ? VC : VERM);
        if (i % 2) sh.getRange(3 + i, 1, 1, nc - 1).setBackground('#f8faf9');
      });
    } else sh.getRange(3, 1, 1, nc).merge().setValue('Nenhum registro ainda neste mês.').setFontColor('#888');
    a.colunas.forEach(function (c, i) { sh.setColumnWidth(i + 1, Math.max(50, c[1] * 7)); });
    sh.setFrozenRows(2);
  });

  // ---- pendências
  var P = abas[abas.length - 1].sh, tp = [['Responsável', 'Data', 'Objetivo', 'Código', 'PDV', 'O que falta (despontua)']].concat(m.pendencias);
  P.getRange(1, 1, tp.length, 6).setValues(tp).setWrap(true).setVerticalAlignment('top');
  P.getRange(1, 1, 1, 6).setBackground(V).setFontColor('#fff').setFontWeight('bold');
  if (m.pendencias.length === 0) P.getRange(2, 1, 1, 6).merge().setValue('Nenhuma pendência. Todas as informações obrigatórias foram preenchidas. ✔').setBackground(VC);
  [20, 10, 26, 11, 26, 50].forEach(function (w, i) { P.setColumnWidth(i + 1, w * 7); });
  P.setFrozenRows(1);
  SpreadsheetApp.flush();
  return ss;
}

function exportar_(ssId, formato, nome) {
  var url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=' + formato +
    (formato === 'pdf' ? '&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=true&pagenum=CENTER&fzr=true&top_margin=0.4&bottom_margin=0.4&left_margin=0.3&right_margin=0.3' : '');
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Falha ao exportar ' + formato + ': ' + resp.getResponseCode());
  return resp.getBlob().setName(nome);
}

function lerDestinatarios_() {
  var sh = abaOuCria_('destinatarios', CAB_DESTINATARIOS), v = sh.getDataRange().getValues(), out = {};
  if (v.length === 1) { // primeira vez: cria as linhas para preencher
    var lin = [['PROPRIETARIO', '', 'Rota Proprietário / Diretor'], ['GV', '', 'Rota GV'], ['SV', '', 'Os 3 supervisores (um relatório só)'],
      ['TRADE_40', '', 'Trade – 40 PDVs alavancas'], ['TRADE_10', '', 'Trade – 10 PDVs baixa performance FDS'], ['GC', '', 'Rota GC']];
    sh.getRange(2, 1, lin.length, 3).setValues(lin);
    v = sh.getDataRange().getValues();
  }
  for (var i = 1; i < v.length; i++) if (v[i][0]) out[String(v[i][0]).trim().toUpperCase()] = String(v[i][1] || '').split(/[;,\s]+/).filter(function (e) { return e.indexOf('@') > 0; });
  return out;
}

/** Gera um relatório (planilha + PDF + Excel no Drive) e envia. */
function gerarEEnviar_(tipo, mes, dados, destinos, fechamento) {
  var m = montarModeloRelatorio(tipo, dados);
  var temGente = m.pessoas.length > 0;
  if (!temGente) { Logger.log(tipo + ': sem usuários com esse perfil, relatório não gerado.'); return null; }
  var pasta = pastaRelatoriosMes_(mes), ss = escreverPlanilha_(m, pasta);
  var base = (fechamento ? 'FECHAMENTO ' : '') + 'Evidências ' + m.titulo + ' – ' + mes;
  var pdf = exportar_(ss.getId(), 'pdf', base + '.pdf'), xlsx = exportar_(ss.getId(), 'xlsx', base + '.xlsx');
  // guarda o PDF do mês na pasta (substitui o do dia anterior)
  var velhos = pasta.getFilesByName(base + '.pdf'); while (velhos.hasNext()) velhos.next().setTrashed(true);
  pasta.createFile(pdf.copyBlob().setName(base + '.pdf'));
  if (destinos && destinos.length) {
    MailApp.sendEmail({
      to: destinos.join(','),
      subject: (fechamento ? '[FECHAMENTO ' + mes + '] ' : '[Rotas ' + mes + '] ') + m.titulo + ' – ' + (m.ok ? '✔ metas batidas' : '✘ pendente'),
      htmlBody: modeloParaHtml(m, { planilha: ss.getUrl(), pasta: pasta.getUrl() }),
      attachments: [pdf, xlsx], name: 'Rotas de Execução – Lince'
    });
  } else Logger.log(tipo + ': sem e-mail na aba destinatarios (relatório salvo no Drive).');
  return m;
}

/** O que o gatilho diário roda. Dia 1: fechamento do mês anterior. Demais dias: parcial do mês. */
function enviarRelatoriosDiarios() {
  var hoje = new Date(), dest = lerDestinatarios_(), fechamento = hoje.getDate() === 1;
  var ref = fechamento ? new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1) : hoje;
  var mes = Utilities.formatDate(ref, 'America/Sao_Paulo', 'yyyy-MM'), dados = lerDadosRelatorio_(mes);
  Object.keys(RELATORIOS).forEach(function (tipo) {
    try { gerarEEnviar_(tipo, mes, dados, dest[tipo], fechamento); }
    catch (e) { Logger.log('Erro no relatório ' + tipo + ': ' + e); }
  });
}

/** Teste: gera todos os relatórios do mês atual e manda só para você. */
function testarRelatorios() {
  var eu = Session.getEffectiveUser().getEmail(), mes = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM'), dados = lerDadosRelatorio_(mes);
  lerDestinatarios_();
  Object.keys(RELATORIOS).forEach(function (tipo) {
    try { gerarEEnviar_(tipo, mes, dados, [eu], false); } catch (e) { Logger.log('Erro ' + tipo + ': ' + e); }
  });
  Logger.log('Relatórios enviados para ' + eu + ' e salvos na pasta ' + PASTA_RELATORIOS + '/' + mes);
}

/** Cria o envio automático todo dia às 7h. */
function instalarGatilhoRelatorios() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'enviarRelatoriosDiarios') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviarRelatoriosDiarios').timeBased().everyDays(1).atHour(7).inTimezone('America/Sao_Paulo').create();
  lerDestinatarios_();
  Logger.log('Envio diário às 7h criado. Preencha os e-mails na aba "destinatarios".');
}
