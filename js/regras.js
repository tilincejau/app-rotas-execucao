// =====================================================================
// REGRAS DO NEGÓCIO — edite aqui para mudar mínimos, pontos e textos.
// =====================================================================

const PERFIS = {
  PROPRIETARIO: {
    nome: 'Proprietário / Diretor', minimoTotal: 20,
    regra: 'Mínimo 20 PDVs diferentes. Um PDV vale para um único objetivo.',
    objetivos: [
      { id: 'RGB_COMPASS', nome: 'Maiores potenciais RGB (COMPASS) – Bar', curto: 'Potencial RGB', min: 10, bloco: 'rgb', soBar: true,
        desc: '10 PDVs de maior potencial RGB na base COMPASS, segmento BAR, independente do histórico de compra.' },
      { id: 'RGB_QUEDA', nome: 'Maiores quedas RGB do mês anterior', curto: 'Quedas RGB', min: 10, bloco: 'rgb', ordenarQueda: true,
        desc: '10 PDVs com maiores quedas de RGB no mês anterior. A lista já vem ordenada pela maior queda.' }
    ]
  },
  GV: {
    nome: 'Gerente de Vendas', minimoTotal: 50,
    regra: 'Mínimo 50 PDVs diferentes. Um PDV vale para um único objetivo.',
    objetivos: [
      { id: 'FDS', nome: 'FDS', curto: 'FDS', min: 20, bloco: 'fds', desc: '20 PDVs – P de presença conforme matriz FDS.' },
      { id: 'COACHING', nome: 'Coaching com vendedor – rotina básica', curto: 'Coaching', min: 20, bloco: 'coaching', exigeVendedor: true,
        desc: '20 PDVs acompanhando o vendedor na rotina básica.' },
      { id: 'RGB_COMPASS', nome: 'Potencial COMPASS em RGB – Bar', curto: 'Potencial RGB', min: 10, bloco: 'rgb', soBar: true,
        desc: '10 PDVs nos maiores potenciais de RGB no segmento BAR.' }
    ]
  },
  SV: {
    nome: 'Supervisor de Vendas', minimoTotal: 30,
    regra: 'Mínimo 30 PDVs (FDS + RGB) + coaching (5 por vendedor) + 1 rota completa.',
    objetivos: [
      { id: 'FDS', nome: 'Foco em FDS', curto: 'FDS', min: 10, bloco: 'fds', desc: '10 PDVs com foco em FDS.' },
      { id: 'COACHING', nome: 'Coaching – rotina básica do vendedor', curto: 'Coaching', min: 5, porVendedor: true, bloco: 'coaching', exigeVendedor: true,
        desc: 'Mínimo 5 PDVs por vendedor.' },
      { id: 'RGB', nome: 'Foco em RGB', curto: 'RGB', min: 20, bloco: 'rgb', escolheTipoRgb: true, ordenarQueda: true,
        desc: '20 PDVs: maiores clientes, maiores quedas ou maiores COMPASS não compradores.' },
      { id: 'ROTA_COMPLETA', nome: 'Rota completa com o vendedor', curto: 'Rota completa', min: 1, bloco: 'rota', exigeVendedor: true, contaRotas: true,
        desc: 'Análise geral da rota (FDS, ativos e SKUs) do vendedor com pior resultado no mês anterior.' }
    ]
  },
  TRADE: {
    nome: 'Supervisor de Trade e Marketing', minimoTotal: 40,
    regra: 'Mínimo 40 PDVs diferentes com foco nas alavancas de Trade.',
    objetivos: [
      { id: 'TRADE', nome: 'Alavancas de Trade Marketing', curto: 'Trade', min: 40, bloco: 'trade',
        desc: '4Ps, FDS, SKUs/PDV, vitoriosos, geladeira, plataformas/KSMs/inovações e cadastro x BWC.' }
    ]
  }
};
// ADM: vê tudo e pode usar qualquer objetivo (para testes e acompanhamento).
PERFIS.ADM = {
  nome: 'Administrador', minimoTotal: 0, regra: 'Acesso total para testes e acompanhamento.',
  objetivos: [...PERFIS.GV.objetivos, ...PERFIS.SV.objetivos, ...PERFIS.PROPRIETARIO.objetivos, ...PERFIS.TRADE.objetivos]
    .filter((o, i, a) => a.findIndex(x => x.id === o.id) === i)
};
// Hierarquia: quem pode repetir um PDV já feito por outro perfil (só gera aviso).
const ORDEM_PERFIL = { SV: 1, GV: 2, TRADE: 3, PROPRIETARIO: 4, ADM: 5 };

// Nomes amigáveis dos grupos FDS (aba fds, coluna ProdFDS). Imagem: img/fds/<código>.png
const NOMES_FDS = {
  'Amsln': 'Amstel Long Neck', 'Amslt': 'Amstel Lata', 'Amsret': 'Amstel Retornável',
  'Bad600+Chopp': 'Baden 600ml + Chopp', 'Badlt350': 'Baden Lata 350', 'Blue': 'Blue',
  'Fys': 'FYS', 'Hnk0.0': 'Heineken 0.0', 'Hnkln330': 'Heineken Long Neck 330',
  'Hnklt269': 'Heineken Lata 269', 'Hnklt350': 'Heineken Lata 350', 'Hnkret': 'Heineken 600 Retornável',
  'Hnkshot': 'Heineken Shot', 'Itub': 'Itubaína', 'Praya': 'Praya', 'Schret': 'Schin Retornável'
};

// Visibilidade por canal (canal validado na tela do PDV)
const VISIBILIDADE = {
  'BAR A/B': [['Impacto – Luminoso', 15], ['Impacto – Quadro', 15], ['Serviço – Balde ou Cervejeira', 40], ['Gráfico – Estar no cardápio', 30]],
  'BAR C/D': [['Serviço – Balde ou Cervejeira', 50], ['Gráfico – Cartaz/cartop ou Faixa', 50]],
  'ENTRETENIMENTOS ESPECIAIS': [['Gráfico – Estar no cardápio', 100]],
  'RESTAURANTE A/B': [['Impacto – Luminoso ou Quadro', 30], ['Serviço – Balde ou Cervejeira', 30], ['Gráfico – Estar no cardápio', 40]],
  'RESTAURANTE C/D': [['Impacto – Quadro ou Cartaz/cartop', 30], ['Serviço – Balde ou Cervejeira', 30], ['Gráfico – Estar no cardápio ou Cartaz/cartop', 40]],
  'LANCHONETE': [['Impacto – Cartop/Cartaz', 50], ['Gráfico – Estar no cardápio ou Cartaz/Cartop', 50]],
  'ARMAZÉM/MERCEARIA': [['Gráfico – Cartaz multimarcas e Adesivo de geladeira multimarcas', 100]],
  'MINI A/B': [['Ponto natural: Wobbler, Stopper e Faixa de gôndola', 40], ['Capa pallet, Bobina, Forração e Precificador de ilha', 30], ['Display', 30]],
  'MINI C/D': [['Wobbler, Stopper e Faixa de gôndola', 40], ['Capa pallet, Bobina, Forração e Precificador de ilha', 30], ['Display', 30]],
  'SUPER A/B': [['Wobbler, Stopper e Faixa de gôndola', 40], ['Capa pallet, Bobina, Forração e Precificador de ilha', 30], ['Display', 30]],
  'SUPER C/D': [['Wobbler, Stopper e Faixa de gôndola', 40], ['Capa pallet, Bobina, Forração e Precificador de ilha', 30], ['Display', 30]],
  'ADEGA': [['Faixa ou Cartaz ilha ou Cartaz multimarcas', 100]],
  'DEMAIS': [['Gráfico – Estar no cardápio ou Adesivo de geladeira multimarcas', 100]]
};
const CANAL_PARA_VISIB = {
  'Bar A/B': 'BAR A/B', 'Bar C/D': 'BAR C/D', 'Entretenimento Espec': 'ENTRETENIMENTOS ESPECIAIS',
  'Restaurante A/B': 'RESTAURANTE A/B', 'Restaurante C/D': 'RESTAURANTE C/D', 'Lanchonete': 'LANCHONETE',
  'Armazem/Mercearia': 'ARMAZÉM/MERCEARIA', 'Mini A/B': 'MINI A/B', 'Mini C/D': 'MINI C/D',
  'Super A/B': 'SUPER A/B', 'Super C/D': 'SUPER C/D', 'Hipermercado': 'SUPER A/B', 'Cash & Carry': 'SUPER A/B',
  'Adega': 'ADEGA'
};

// Preços digitados (TTC = preço ao consumidor, TTV = preço de venda ao PDV)
const MARCAS_PRECO = ['Heineken', 'Original', 'Amstel', 'M1'];
const MARCAS_M1 = ['Skol', 'Brahma', 'Antarctica', 'Budweiser', 'Itaipava', 'Petra', 'Outra'];

const SEGMENTOS_VITORIOSOS = ['Craft', 'Mainstream', 'Premium', 'Economy', 'Fys', 'Lono'];
// LONO: códigos (ProdCod) que contam como Lono, além do segmento original (Premium/Mainstream/Craft)
const SKUS_LONO = ['903991', '903996', '904895', '904961', '905362', '904931', '904632', '905541', '905603',
  '419448', '634957', '905451', '905661', '905411', '905422'];

// Coaching: 5 etapas, cada uma com comportamentos observáveis (Sim=2, Parcial=1, Não=0)
const COACHING = [
  { id: 'plan', nome: 'Planejamento (Minuto de ouro)', itens: [
    'Revisou histórico de compra e FDS do PDV antes de entrar',
    'Definiu objetivo da visita (SKU foco / item FDS faltante)',
    'Conferiu pendências: título, troca, comodato' ] },
  { id: 'leitura', nome: 'Leitura de loja', itens: [
    'Checou geladeira/ativos (pureza, abastecimento, temperatura)',
    'Checou presença FDS e ruptura nas prateleiras',
    'Checou preço e ações da concorrência' ] },
  { id: 'foto', nome: 'Fotografia do sucesso', itens: [
    'Executou ou pediu a visibilidade correta do canal',
    'Organizou geladeira/gôndola conforme padrão' ] },
  { id: 'acordo', nome: 'Acordo e negociação', itens: [
    'Ofereceu os itens FDS faltantes',
    'Usou argumento de giro/rentabilidade para o cliente',
    'Contornou objeções sem dar desconto de primeira' ] },
  { id: 'fech', nome: 'Fechamento e acompanhamento', itens: [
    'Fechou pedido e confirmou entrega',
    'Combinou próximos passos com o cliente',
    'Registrou informações no sistema / app' ] }
];

const TIPOS_RGB = ['Maiores clientes', 'Maiores quedas', 'Maiores COMPASS não compradores'];
const MOTIVOS_QUEDA = ['Preço da concorrência', 'Falta de vasilhame', 'Ruptura / entrega', 'Comprou de outro distribuidor', 'Sazonalidade', 'Mudança de mix', 'Crédito / financeiro', 'Outro'];
const ALAVANCAS_TRADE = [
  'Avaliação e performance dos 4Ps', 'FDS (P de presença)', 'SKUs por PDV', 'SKUs vitoriosos',
  'Implantação, giro e invasão de geladeira', 'Plataformas de marca / KSMs / programas / inovações',
  'Validação do cadastro do PDV x BWC'
];
