/**
 * ROTAS DE EXECUÇÃO — Backend (Google Apps Script)
 * ------------------------------------------------
 * A planilha NÃO é compartilhada com ninguém. O app conversa só com este script,
 * que roda como o dono da planilha e confere login/senha/token a cada chamada.
 *
 * Abas lidas: base_clientes, fds, produtos, skus_pdv, refrigeracao_comodatos,
 *   refrigeracao_giro, vasilhames_comodatos, vasilhames_giro, chopeiras_giro,
 *   _atualizacao e as abas vendas_AAAA-MM indicadas em _atualizacao.
 * Abas criadas pelo script: usuarios, rotas_respostas.
 */

var PLANILHA_ID = '1CpEuodj724QpcOM-rPdo4hy7lYs9JUtPXmi2-D4j9Gw';
var PREFIXO = '2216-';                 // prefixo da revenda removido dos códigos
var DIAS_TOKEN = 30;                   // login vale 30 dias (permite trabalhar offline)
var PASTA_DADOS = 'RotasApp_Dados';    // pasta no Drive para os pacotes JSON
var PASTA_FOTOS = 'RotasApp_Fotos';    // pasta no Drive para as fotos
var SEGMENTOS_VITORIOSOS = ['Craft', 'Mainstream', 'Premium', 'Economy', 'Fys', 'Lono'];

var CAB_USUARIOS = ['login', 'senha', 'senha_hash', 'nome', 'perfil', 'sup_cod', 'ger_cod', 'ativo'];
var CAB_RESPOSTAS = ['id', 'recebido_em', 'data_visita', 'mes', 'login', 'nome', 'perfil',
  'objetivo', 'objetivo_nome', 'cod_cli', 'fantasia', 'supervisor', 'vendedor', 'cidade', 'dia',
  'canal_cadastro', 'canal_validado', 'canal_correto', 'fds_pontos', 'fds_meta', 'visib_pontos',
  'ativos_pontos', 'preco_pontos', 'skus_qtd', 'skus_vitoriosos', 'resumo_skus', 'pontos_fortes',
  'oportunidades', 'nota_coaching', 'observacoes', 'fotos', 'lat', 'lng', 'json'];

/* ============================== API ============================== */

function doGet() {
  return json_({ ok: true, app: 'rotas', hora: new Date().toISOString() });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var acao = req.acao;
    if (acao === 'login') return json_(login_(req.login, req.senha));
    var u = validarToken_(req.token);
    if (!u) return json_({ ok: false, erro: 'SESSAO_EXPIRADA' });
    if (acao === 'versao') return json_({ ok: true, versao: versaoDados_() });
    if (acao === 'dados') return json_(dadosDoUsuario_(u));
    if (acao === 'visitas') return json_({ ok: true, visitas: listarVisitas_(req.mes) });
    if (acao === 'enviar') return json_(gravarVisita_(u, req.visita));
    return json_({ ok: false, erro: 'ACAO_INVALIDA' });
  } catch (err) {
    return json_({ ok: false, erro: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================ USUÁRIOS ============================ */

function ss_() { return SpreadsheetApp.openById(PLANILHA_ID); }

function abaOuCria_(nome, cab) {
  var ss = ss_(), sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function pepper_() {
  var p = PropertiesService.getScriptProperties(), v = p.getProperty('PEPPER');
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('PEPPER', v); }
  return v;
}

function hash_(login, senha) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    String(login).toLowerCase().trim() + '|' + senha + '|' + pepper_(), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function lerUsuarios_() {
  var sh = abaOuCria_('usuarios', CAB_USUARIOS);
  var v = sh.getDataRange().getValues(), cab = v[0], out = [];
  for (var i = 1; i < v.length; i++) {
    var o = { _linha: i + 1 };
    cab.forEach(function (c, j) { o[c] = v[i][j]; });
    if (o.login) out.push(o);
  }
  return out;
}

/** Menu: troca as senhas digitadas na coluna "senha" por hash e apaga o texto. */
function criptografarSenhas() {
  var sh = abaOuCria_('usuarios', CAB_USUARIOS);
  var v = sh.getDataRange().getValues(), cab = v[0];
  var iS = cab.indexOf('senha'), iH = cab.indexOf('senha_hash'), iL = cab.indexOf('login'), n = 0;
  for (var i = 1; i < v.length; i++) {
    if (v[i][iL] && String(v[i][iS]).length) {
      sh.getRange(i + 1, iH + 1).setValue(hash_(v[i][iL], String(v[i][iS])));
      sh.getRange(i + 1, iS + 1).setValue('');
      n++;
    }
  }
  avisar_(n + ' senha(s) criptografada(s).');
}

function avisar_(msg) { try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); } }

/** Rodar uma vez pelo editor: cria as abas usuarios e rotas_respostas e pede as autorizações. */
function prepararPlanilha() {
  abaOuCria_('usuarios', CAB_USUARIOS);
  abaOuCria_('rotas_respostas', CAB_RESPOSTAS);
  pepper_(); pastaDrive_(PASTA_DADOS); pastaDrive_(PASTA_FOTOS);
  Logger.log('Pronto. Versão dos dados: ' + versaoDados_());
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rotas App')
    .addItem('Criptografar senhas digitadas', 'criptografarSenhas')
    .addItem('Gerar pacotes de dados agora', 'gerarTodosPacotes')
    .addItem('Criar gatilho automático (a cada hora)', 'instalarGatilho')
    .addToUi();
}

function login_(login, senha) {
  login = String(login || '').toLowerCase().trim();
  var cache = CacheService.getScriptCache(), kF = 'falhas_' + login;
  var falhas = Number(cache.get(kF) || 0);
  if (falhas >= 5) return { ok: false, erro: 'Muitas tentativas. Aguarde 15 minutos.' };
  var u = lerUsuarios_().filter(function (x) { return String(x.login).toLowerCase().trim() === login; })[0];
  var valido = u && String(u.ativo).toUpperCase() !== 'NAO' && String(u.ativo).toUpperCase() !== 'NÃO'
    && u.senha_hash && u.senha_hash === hash_(login, String(senha || ''));
  if (!valido) {
    cache.put(kF, String(falhas + 1), 900);
    return { ok: false, erro: 'Login ou senha inválidos.' };
  }
  cache.remove(kF);
  var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  var props = PropertiesService.getScriptProperties();
  limparTokens_(props);
  props.setProperty('tk_' + token, JSON.stringify({ login: login, exp: Date.now() + DIAS_TOKEN * 864e5 }));
  return { ok: true, token: token, usuario: perfilPublico_(u) };
}

function perfilPublico_(u) {
  var sup = String(u.sup_cod || '').trim(), ger = String(u.ger_cod || '').trim();
  return {
    login: String(u.login).toLowerCase().trim(), nome: u.nome, perfil: String(u.perfil).toUpperCase().trim(),
    sup: sup ? norm3_(sup) : '', ger: ger ? norm3_(ger) : ''
  };
}

function norm3_(c) { // "2216-100" ou 100 -> "100";  1 -> "001"
  c = String(c).replace(PREFIXO, '').trim();
  return /^\d+$/.test(c) && c.length < 3 ? ('000' + c).slice(-3) : c;
}

function limparTokens_(props) {
  var all = props.getProperties(), agora = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('tk_') === 0) {
      try { if (JSON.parse(all[k]).exp < agora) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
    }
  });
}

function validarToken_(token) {
  if (!token) return null;
  var raw = PropertiesService.getScriptProperties().getProperty('tk_' + token);
  if (!raw) return null;
  var t = JSON.parse(raw);
  if (t.exp < Date.now()) return null;
  var u = lerUsuarios_().filter(function (x) { return String(x.login).toLowerCase().trim() === t.login; })[0];
  if (!u || String(u.ativo).toUpperCase().indexOf('N') === 0) return null;
  return perfilPublico_(u);
}

/* ========================= PACOTE DE DADOS ========================= */

function lerAba_(ss, nome) {
  var sh = ss.getSheetByName(nome);
  return sh ? sh.getDataRange().getValues() : [[]];
}

function infoAtualizacao_(ss) {
  var v = lerAba_(ss || ss_(), '_atualizacao'), o = {};
  v.forEach(function (r) { if (r[0]) o[r[0]] = r[1]; });
  return o;
}

function versaoDados_() {
  var info = infoAtualizacao_();
  var at = info.atualizado_em;
  if (at instanceof Date) at = Utilities.formatDate(at, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss');
  return String(at || 'sem-versao') + '|v4';
}

function escopoDe_(u) {
  if (u.perfil === 'SV' && u.sup) return 'SUP-' + u.sup;
  if (u.ger) return 'GER-' + u.ger;
  return 'TODOS';
}

function pastaDrive_(nome) {
  var it = DriveApp.getFoldersByName(nome);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nome);
}

function dadosDoUsuario_(u) {
  var versao = versaoDados_(), escopo = escopoDe_(u);
  var nomeArq = 'pacote_' + escopo + '_' + versao.replace(/[^0-9A-Za-z]/g, '') + '.json';
  var pasta = pastaDrive_(PASTA_DADOS), it = pasta.getFilesByName(nomeArq), txt;
  if (it.hasNext()) {
    txt = it.next().getBlob().getDataAsString();
  } else {
    txt = JSON.stringify(gerarPacote_(escopo, versao));
    pasta.createFile(nomeArq, txt, 'application/json');
  }
  return { ok: true, usuario: u, pacote: JSON.parse(txt) };
}

function gerarPacote_(escopo, versao) {
  var ss = ss_(), info = infoAtualizacao_(ss);
  var T = {
    base_clientes: lerAba_(ss, 'base_clientes'), fds: lerAba_(ss, 'fds'), produtos: lerAba_(ss, 'produtos'),
    skus_pdv: lerAba_(ss, 'skus_pdv'), refrigeracao_comodatos: lerAba_(ss, 'refrigeracao_comodatos'),
    refrigeracao_giro: lerAba_(ss, 'refrigeracao_giro'), vasilhames_comodatos: lerAba_(ss, 'vasilhames_comodatos'),
    vasilhames_giro: lerAba_(ss, 'vasilhames_giro'), chopeiras_giro: lerAba_(ss, 'chopeiras_giro'),
    vendas_atual: lerAba_(ss, info.vendas_mes_atual), vendas_ant: lerAba_(ss, info.vendas_mes_anterior),
    vendas_ant2: lerAba_(ss, info.vendas_mes_anterior_2)
  };
  return montarPacote(T, escopo, { versao: versao, mes: String(info.mes_referencia || ''), atualizado: String(info.atualizado_em || '') });
}

/** Pré-gera os pacotes de todos os escopos (rodar pelo menu ou pelo gatilho). */
function gerarTodosPacotes() {
  var versao = versaoDados_(), pasta = pastaDrive_(PASTA_DADOS), escopos = {};
  lerUsuarios_().forEach(function (u) { escopos[escopoDe_(perfilPublico_(u))] = 1; });
  var tag = versao.replace(/[^0-9A-Za-z]/g, '');
  // apaga pacotes de versões antigas
  var fs = pasta.getFiles();
  while (fs.hasNext()) { var f = fs.next(); if (f.getName().indexOf(tag) < 0) f.setTrashed(true); }
  Object.keys(escopos).forEach(function (esc) {
    var nome = 'pacote_' + esc + '_' + tag + '.json';
    if (!pasta.getFilesByName(nome).hasNext())
      pasta.createFile(nome, JSON.stringify(gerarPacote_(esc, versao)), 'application/json');
  });
}

function instalarGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'gerarTodosPacotes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('gerarTodosPacotes').timeBased().everyHours(1).create();
}

/* ---------- Montagem (função pura: recebe as abas como matrizes) ---------- */

function normCli_(c) {
  c = String(c == null ? '' : c).trim();
  var m = c.match(/^\d+-(\d{4}-\d{4})$/);
  return m ? m[1] : c;
}
function semPrefixo_(c) { return String(c == null ? '' : c).trim().replace(/^\d{4}-/, ''); }
function num_(v) { var n = Number(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; }
function r2_(n) { return Math.round(n * 100) / 100; }
function data_(v) {
  if (v instanceof Date) return ('0' + v.getDate()).slice(-2) + '/' + ('0' + (v.getMonth() + 1)).slice(-2) + '/' + v.getFullYear();
  return String(v == null ? '' : v);
}
function idx_(cab) { var o = {}; cab.forEach(function (c, i) { o[String(c).trim()] = i; }); return o; }

/** Pasta (rota) -> dia da semana.  1/1511/1521 = Seg ... 5/1515/1525 = Sex */
function diaDaPasta(p) {
  p = semPrefixo_(p);
  var dias = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado' };
  var d = null;
  if (/^[1-6]$/.test(p)) d = Number(p);
  else { var m = p.match(/^15[12]([1-6])$/); if (m) d = Number(m[1]); }
  return d ? dias[d] : (p ? 'Outros (' + p + ')' : 'Sem pasta');
}

function montarPacote(T, escopo, meta) {
  var pac = { versao: meta.versao, mes: meta.mes, atualizado: meta.atualizado, escopo: escopo,
    colsClientes: ['cod', 'fantasia', 'razao', 'vend', 'sup', 'ger', 'pasta', 'dia', 'canalCod', 'canal', 'canalGrp', 'canalDiv', 'cidade'],
    clientes: [], canais: [], fds: {}, fdsProdutos: {}, skus: {}, geladeiras: {}, chopeiras: {}, vasilhames: {}, rgb: {} };

  // ---- clientes do escopo
  var b = T.base_clientes, ib = idx_(b[0]), noEscopo = {}, canais = {};
  var tipo = escopo.split('-')[0], cod = escopo.slice(tipo.length + 1);
  for (var i = 1; i < b.length; i++) {
    var r = b[i], sup = semPrefixo_(r[ib.SupCliCod]), ger = semPrefixo_(r[ib.GerCliCod]);
    var c = normCli_(r[ib.CodCli]);
    if (!c || sup === '-' || sup === '') continue;
    if (tipo === 'SUP' && sup !== cod) continue;
    if (tipo === 'GER' && ger !== cod) continue;
    noEscopo[c] = 1;
    var canal = String(r[ib.Canal]).trim();
    if (canal && canal !== '-') canais[canal] = 1;
    pac.clientes.push([c, String(r[ib.Fantasia]).trim(), String(r[ib.RazaoSocial]).trim(), semPrefixo_(r[ib.VendCliCod]),
      sup, ger, semPrefixo_(r[ib.PastaCliCod]), diaDaPasta(r[ib.PastaCliCod]), String(r[ib.CanalCod]),
      canal, String(r[ib.CanalGrp]), String(r[ib.CanalDiv]), String(r[ib.Cidade]).trim()]);
  }
  pac.canais = Object.keys(canais).sort();

  // ---- produtos: ProdCod -> grupos ; descrição
  var p = T.produtos, ip = idx_(p[0]), grupos = {}, descr = {}, embal = {};
  for (i = 1; i < p.length; i++) {
    var pc = String(Number(p[i][ip.ProdCod])), g = String(p[i][ip.GrpParam_Descr]).trim();
    descr[pc] = String(p[i][ip.ProdDescr]).trim();
    embal[pc] = String(p[i][ip.Tipo_Embalagem]).trim();
    (grupos[pc] = grupos[pc] || {})[g] = 1;
  }

  // ---- produtos de cada grupo FDS (para mostrar a imagem quando o PDV não comprou)
  pac.fdsRepresentantes = {};
  for (i = 1; i < p.length; i++) {
    var gr = String(p[i][ip.GrpParam_Descr]).trim(), pcr = String(Number(p[i][ip.ProdCod]));
    var lst = pac.fdsRepresentantes[gr] = pac.fdsRepresentantes[gr] || [];
    if (lst.indexOf(pcr) < 0 && lst.length < 8) lst.push(pcr);
  }

  // ---- FDS (P de presença): [ProdFDS, ok(1/0), meta, real]
  var f = T.fds, iff = idx_(f[0]);
  for (i = 1; i < f.length; i++) {
    c = normCli_(f[i][iff.CodCli]);
    if (!noEscopo[c]) continue;
    (pac.fds[c] = pac.fds[c] || []).push([String(f[i][iff.ProdFDS]).trim(),
      String(f[i][iff.FdsStatus]).trim().toUpperCase() === 'OK' ? 1 : 0,
      num_(f[i][iff.MetaPontuacao]), num_(f[i][iff.RealPontuacao])]);
  }

  // ---- vendas do mês atual -> produtos vendidos por grupo FDS
  var va = T.vendas_atual || [[]], iv = idx_(va[0] || []), vendidos = {};
  for (i = 1; i < va.length; i++) {
    c = normCli_(va[i][iv.CodCli]);
    if (!noEscopo[c] || !pac.fds[c]) continue;
    pc = String(Number(va[i][iv.ProdCod]));
    (vendidos[c] = vendidos[c] || {})[pc] = String(va[i][iv.ProdDescr] || descr[pc] || pc).trim();
  }
  Object.keys(vendidos).forEach(function (cc) {
    var porGrupo = {};
    pac.fds[cc].forEach(function (it) {
      Object.keys(vendidos[cc]).forEach(function (pc2) {
        if (grupos[pc2] && grupos[pc2][it[0]]) (porGrupo[it[0]] = porGrupo[it[0]] || []).push([pc2, vendidos[cc][pc2]]);
      });
    });
    if (Object.keys(porGrupo).length) pac.fdsProdutos[cc] = porGrupo;
  });

  // ---- SKUs presentes: [ProdCod, descr, estrategico, segmento]
  var s = T.skus_pdv, is = idx_(s[0]);
  for (i = 1; i < s.length; i++) {
    c = normCli_(s[i][is.CodCli]);
    if (!noEscopo[c]) continue;
    pc = String(Number(s[i][is.ProdCod]));
    var seg = '', d = String(s[i][is.ProdDescr]).trim();
    for (var k = 0; k < SEGMENTOS_VITORIOSOS.length; k++) {
      var sg = SEGMENTOS_VITORIOSOS[k];
      if (grupos[pc] && grupos[pc][sg]) { seg = sg; break; }
    }
    if (!seg && /lono/i.test(d)) seg = 'Lono';
    (pac.skus[c] = pac.skus[c] || []).push([pc, d, num_(s[i][is.SkuEstrategico]) ? 1 : 0, seg]);
  }

  // ---- giros
  function mapaGiro(tab, chaveFn) {
    var o = {}; if (!tab || !tab[0] || !tab[0].length) return o;
    var ig = idx_(tab[0]);
    for (var j = 1; j < tab.length; j++) {
      var cc = normCli_(tab[j][ig.CodCli]); if (!noEscopo[cc]) continue;
      o[chaveFn(tab[j], ig, cc)] = [r2_(num_(tab[j][ig.GiroMesAtual])), String(tab[j][ig.StatusGiroMesAtual] || '-')];
    }
    return o;
  }
  var gGel = mapaGiro(T.refrigeracao_giro, function (r, ig, cc) { return cc + '|' + String(r[ig.Cmd_Grupo]).trim(); });
  var gVas = mapaGiro(T.vasilhames_giro, function (r, ig, cc) { return cc + '|' + String(r[ig.Cmd_SubGrupo]).trim(); });
  var gCho = mapaGiro(T.chopeiras_giro, function (r, ig, cc) { return cc; });

  // ---- comodatos: [material, subgrupo, emissao, vencimento, qtd, diasVenc, giro, statusGiro]
  var rc = T.refrigeracao_comodatos, ir = idx_(rc[0]);
  for (i = 1; i < rc.length; i++) {
    c = normCli_(rc[i][ir.CodCli]); if (!noEscopo[c]) continue;
    var grp = String(rc[i][ir.Cmd_Grupo]).trim(), sub = String(rc[i][ir.Cmd_SubGrupo]).trim();
    var ehChop = /chopeira/i.test(sub) || /chopeira/i.test(String(rc[i][ir.Cmd_Material]));
    var giro = ehChop ? gCho[c] : gGel[c + '|' + grp];
    var lin = [String(rc[i][ir.Cmd_Material]).trim(), sub, data_(rc[i][ir.DataEmissaoComodato]),
      data_(rc[i][ir.DataVencimentoComodato]), num_(rc[i][ir.QtdMaterial]), num_(rc[i][ir.DiasVencimentoComodato]),
      giro ? giro[0] : null, giro ? giro[1] : 'Sem giro'];
    var alvo = ehChop ? pac.chopeiras : pac.geladeiras;
    (alvo[c] = alvo[c] || []).push(lin);
  }
  var vc = T.vasilhames_comodatos, ivc = idx_(vc[0]);
  for (i = 1; i < vc.length; i++) {
    c = normCli_(vc[i][ivc.CodCli]); if (!noEscopo[c]) continue;
    sub = String(vc[i][ivc.Cmd_SubGrupo]).trim();
    giro = gVas[c + '|' + sub];
    (pac.vasilhames[c] = pac.vasilhames[c] || []).push([String(vc[i][ivc.Cmd_Material]).trim(), sub,
      data_(vc[i][ivc.DataEmissaoComodato]), data_(vc[i][ivc.DataVencimentoComodato]), num_(vc[i][ivc.QtdMaterial]),
      num_(vc[i][ivc.DiasVencimentoComodato]), giro ? giro[0] : null, giro ? giro[1] : 'Sem giro']);
  }

  // ---- RGB (retornável) em HL: [mês anterior, mês retrasado] -> sugere "maiores quedas"
  function somaRGB(tab, pos) {
    if (!tab || !tab[0] || !tab[0].length) return;
    var it2 = idx_(tab[0]);
    for (var j = 1; j < tab.length; j++) {
      var cc = normCli_(tab[j][it2.CodCli]); if (!noEscopo[cc]) continue;
      var p2 = String(Number(tab[j][it2.ProdCod]));
      if (embal[p2] !== 'Retornável') continue;
      var a = pac.rgb[cc] = pac.rgb[cc] || [0, 0];
      a[pos] += num_(tab[j][it2.QtdeSaidaHL]);
    }
  }
  somaRGB(T.vendas_ant, 0); somaRGB(T.vendas_ant2, 1);
  Object.keys(pac.rgb).forEach(function (cc) { pac.rgb[cc] = [r2_(pac.rgb[cc][0]), r2_(pac.rgb[cc][1])]; });

  return pac;
}

/* ============================ VISITAS ============================ */

function listarVisitas_(mes) {
  var sh = abaOuCria_('rotas_respostas', CAB_RESPOSTAS), v = sh.getDataRange().getValues(), ix = idx_(v[0]), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i];
    if (mes && String(r[ix.mes]) !== mes) continue;
    out.push({ id: r[ix.id], data: data_(r[ix.data_visita]) || String(r[ix.data_visita]), mes: String(r[ix.mes]), login: r[ix.login], nome: r[ix.nome],
      perfil: r[ix.perfil], objetivo: r[ix.objetivo], objetivoNome: r[ix.objetivo_nome], cod: String(r[ix.cod_cli]),
      vendedor: String(r[ix.vendedor]), fds: r[ix.fds_pontos], fdsMeta: r[ix.fds_meta], visib: r[ix.visib_pontos],
      ativos: r[ix.ativos_pontos], preco: r[ix.preco_pontos], skus: r[ix.skus_qtd], fortes: r[ix.pontos_fortes],
      oport: r[ix.oportunidades], obs: r[ix.observacoes] });
  }
  return out;
}

function gravarVisita_(u, vis) {
  if (!vis || !vis.id || !vis.cod) return { ok: false, erro: 'Visita incompleta.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = abaOuCria_('rotas_respostas', CAB_RESPOSTAS), v = sh.getDataRange().getValues(), ix = idx_(v[0]);
    for (var i = 1; i < v.length; i++) {
      if (v[i][ix.id] === vis.id) return { ok: true, id: vis.id, repetido: true }; // reenvio offline
      if (String(v[i][ix.login]).toLowerCase() === u.login && String(v[i][ix.cod_cli]) === String(vis.cod) && String(v[i][ix.mes]) === vis.mes)
        return { ok: false, erro: 'DUPLICADO', msg: 'Você já registrou este PDV em ' + data_(v[i][ix.data_visita]) + ' (' + v[i][ix.objetivo_nome] + ').' };
    }
    // fotos -> Drive (privado)
    var links = [];
    if (vis.fotos && vis.fotos.length) {
      var pasta = pastaDrive_(PASTA_FOTOS);
      vis.fotos.forEach(function (ft, n) {
        var b64 = String(ft.dados).split(',').pop();
        var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg',
          vis.mes + '_' + u.login + '_' + vis.cod + '_' + (ft.tipo || 'foto') + '_' + (n + 1) + '.jpg');
        links.push((ft.tipo || 'foto') + ': ' + pasta.createFile(blob).getUrl());
      });
    }
    var R = vis.resumo || {};
    var linha = {
      id: vis.id, recebido_em: new Date(), data_visita: vis.data, mes: vis.mes, login: u.login, nome: u.nome, perfil: u.perfil,
      objetivo: vis.objetivo, objetivo_nome: vis.objetivoNome, cod_cli: vis.cod, fantasia: vis.fantasia, supervisor: vis.sup,
      vendedor: vis.vend, cidade: vis.cidade, dia: vis.dia, canal_cadastro: vis.canalCadastro, canal_validado: vis.canal,
      canal_correto: vis.canalCorreto ? 'Sim' : 'Não', fds_pontos: R.fds, fds_meta: R.fdsMeta, visib_pontos: R.visib,
      ativos_pontos: R.ativos, preco_pontos: R.preco, skus_qtd: R.skus, skus_vitoriosos: R.vitoriosos,
      resumo_skus: vis.respostas && vis.respostas.resumoSkus, pontos_fortes: R.fortes, oportunidades: R.oport,
      nota_coaching: R.notaCoaching, observacoes: R.obs, fotos: links.join('\n'), lat: vis.lat, lng: vis.lng,
      json: JSON.stringify(vis.respostas || {}).slice(0, 49000)
    };
    sh.appendRow(CAB_RESPOSTAS.map(function (c) { return linha[c] == null ? '' : linha[c]; }));
    return { ok: true, id: vis.id };
  } finally {
    lock.releaseLock();
  }
}
