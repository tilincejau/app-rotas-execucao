# Rotas de Execução – App

App de celular (PWA) para as rotas de mercado do Proprietário, GV, SV e Trade.
O app abre e funciona **sem internet**: a base de clientes fica guardada no aparelho, e as visitas
são enviadas sozinhas quando o sinal volta.

```
GitHub Pages (o app)  ──►  Google Apps Script (confere login/senha)  ──►  Planilha no Drive (privada)
```

A planilha **não é compartilhada com ninguém**. Os usuários só acessam pelo app, com login e senha
próprios. Cada usuário recebe apenas os clientes do seu escopo (o SV vê só os dele).

---

## 1. Backend na planilha (uma vez só)

1. Abra a planilha `1CpEuodj724QpcOM-rPdo4hy7lYs9JUtPXmi2-D4j9Gw` → **Extensões › Apps Script**.
2. Apague o conteúdo e cole o arquivo `apps-script/Code.gs`.
   Em ⚙ *Configurações do projeto*, marque "Mostrar appsscript.json" e cole o `apps-script/appsscript.json`.
3. Escolha a função `prepararPlanilha`, clique em ▶ Executar e autorize. Ela cria as abas **usuarios** e **rotas_respostas**.
   Recarregue a planilha: aparece o menu **Rotas App**.
4. Preencha a aba **usuarios**:

| login | senha | senha_hash | nome | perfil | sup_cod | ger_cod | ativo |
|---|---|---|---|---|---|---|---|
| joao.dono | Troque@123 | | João | PROPRIETARIO | | 001 | SIM |
| marcos.gv | Troque@123 | | Marcos | GV | | 001 | SIM |
| carlos.sv100 | Troque@123 | | Carlos | SV | 100 | 001 | SIM |
| ana.sv200 | Troque@123 | | Ana | SV | 200 | 001 | SIM |
| paula.trade | Troque@123 | | Paula | TRADE | | 001 | SIM |

   - `perfil`: PROPRIETARIO, GV, SV ou TRADE.
   - `sup_cod`: só para o SV (100, 200, 300). É o que puxa os clientes dele automaticamente.
   - `ger_cod`: 001 = toda a gerência 2216-001. Deixe vazio para ver tudo.
   - Depois de digitar as senhas, use **Rotas App › Criptografar senhas digitadas**. A senha some e fica só o hash.
     Para trocar a senha de alguém, digite a nova na coluna `senha` e rode o menu de novo.
   - Para bloquear alguém: `ativo` = NAO.
5. **Implantar › Nova implantação › App da Web**.
   Executar como: *Eu*. Quem pode acessar: *Qualquer pessoa*. Copie a URL que termina em `/exec`.
6. Rode **Rotas App › Criar gatilho automático**. A cada hora o script prepara os pacotes de dados
   sempre que a aba `_atualizacao` mudar. Assim o download no celular fica rápido.

> As respostas caem na aba **rotas_respostas** (uma linha por PDV, com o JSON completo na última coluna).
> As fotos vão para a pasta **RotasApp_Fotos** no seu Drive, que também fica privada.

## 2. App no GitHub

1. Crie um repositório (ex.: `rotas-app`) e envie **todos os arquivos desta pasta**, exceto `apps-script/` se preferir.
2. Edite `js/config.js` e cole a URL `/exec` do passo 1.5.
3. **Settings › Pages** › Branch `main` / pasta `/ (root)` › Save.
   O app fica em `https://SEU-USUARIO.github.io/rotas-app/`.
4. No celular, abra o link no Chrome ou no Safari e escolha **Adicionar à tela inicial**. O app vira um ícone.

**Quando alterar o app:** aumente `VERSAO` em `sw.js` (`rotas-v1` → `rotas-v2`) para os celulares baixarem a nova versão.

## 3. Imagens dos produtos

Salve as imagens em `img/produtos/` com o **código do produto (ProdCod)** como nome: `905283.png`, `903478.jpg`...
Use .png ou .jpg, quadradas, de até 300×300 px.

- **FDS:** mostra a imagem do produto que o PDV comprou no mês. Se ele não comprou, usa um produto daquele grupo FDS.
- **Lista de SKUs:** cada SKU aparece com a sua imagem.
- **Sem imagem:** aparecem as iniciais.
- **Offline:** as imagens ficam guardadas no celular depois da primeira sincronização com internet.

## 4. Onde mudar as regras

Tudo fica em `js/regras.js`: mínimos por perfil, pontos de visibilidade por canal, checklist do coaching,
marcas de preço, alavancas de Trade e nomes dos itens FDS.

## Regras já implementadas

- O dia da visita sai da pasta: 1/1511/1521 = segunda … 5/1515/1525 = sexta. O prefixo `2216-` é removido de supervisor, vendedor e pasta.
- Cada usuário só registra **uma vez por mês** cada PDV, em um único objetivo. O PDV aparece com ✔ e fica bloqueado.
  Isso é conferido no aparelho e de novo no servidor.
- Perfis diferentes podem visitar o mesmo PDV. O app mostra um aviso ⚠ com quem visitou, quando e o que foi registrado.
- O FDS (P de presença) vem automático da aba `fds`, junto com os produtos vendidos no mês (vendas do mês atual × produtos).
- Ativos vêm de `refrigeracao_comodatos`, `vasilhames_comodatos`, `chopeiras_giro` e das abas de giro.
- SKUs e vitoriosos vêm de `skus_pdv` × `produtos` (Craft, Mainstream, Premium, Economy, Fys, Lono).
- Para o objetivo de quedas de RGB, a lista é ordenada pela maior queda de HL retornável do mês anterior em relação ao retrasado.
