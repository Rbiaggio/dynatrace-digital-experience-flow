# Digital Experience Flow

**Um app do Dynatrace que transforma o RUM on Grail num "service flow" do frontend**: como as pessoas navegam pelas
aplicações web e mobile, onde encontram erro, onde desistem e quais serviços do backend cada página chama.

[English](README.md) · [Instalação](#instalação) · [Como testar](#como-testar) · [Como funciona](#como-funciona) · [Custos](#custos)

![Visão geral](app/ui/assets/docs/grande/visao-geral.jpg)

> Não é um produto oficial da Dynatrace. Os prints são de um laboratório de demonstração com tráfego simulado (`lab/`);
> nenhum dado de cliente.

## O que ele faz

### Visão geral: o que está afetando os clientes agora

- Sessões, páginas por sessão, sessões com erro e sessões que terminaram logo depois de um erro.
- Apdex de Web Vitals com as páginas que puxam a nota para baixo, e mapas de onde estão os clientes e os erros.
- "O que está afetando os clientes": cada cartão de erro mostra o caminho até a etapa que falha, quantos não seguiram,
  o que corrigir e quem faz, com atalhos para as sessões, o Session Replay, os erros e o backend.
- Oportunidades de melhoria ordenadas pelo impacto no cliente e pelo esforço, com relatório em PDF.
- Principais fluxos como funil, páginas mais visitadas e a lista de sessões (erros primeiro).

### Flow: o grafo de navegação, até o banco de dados

- Páginas como nós e navegação como setas, com o percentual de quem saiu por cada caminho. O backend (serviços e
  bancos) aparece ligado às páginas que o chamam, pelas entidades do Smartscape e pelos traces.
- Jornadas de negócio: escolha as páginas na ordem e ganhe um funil por sessão. "Por quê?" num passo compara quem parou
  com quem seguiu (erros na página anterior, para onde foram, as sessões).
- Clique numa página para o detalhe: os erros com os exemplos mais recentes, as chamadas com falha e as mais lentas
  com trace e sessão, o caminho no backend na ordem das chamadas e "Onde falha no backend?", que lê os traces das
  falhas mais recentes e diz em qual serviço a falha nasce e quem corrige.
- "Isolar" uma página para ver só as sessões que passaram por ela.

### IA, só a pedido

- O Dynatrace Assist (Davis CoPilot) explica um problema ou uma oportunidade, dentro do Dynatrace.
- Análise estrutural de causa raiz por um LLM que você configura (com a sua chave), opcional: problema, causa raiz,
  solução e benefício por oportunidade, causas comuns e plano de 30, 60 e 90 dias. Só evidências mascaradas, com o
  aceite de quem pede.

### Feito para quem opera

- Documentação dentro do app, em português e inglês, tema claro e escuro.
- Uma tela de Configuração que grava as regras do OpenPipeline e os buckets por você, uma calculadora de custo e um
  cartão de consumo real (pelos eventos de cobrança da Dynatrace).

| Flow | Funil da jornada |
|---|---|
| ![Flow](app/ui/assets/docs/grande/flow-grafo.jpg) | ![Jornada](app/ui/assets/docs/grande/flow-jornada.jpg) |

| Principais fluxos como funil (Visão geral) | O que está afetando os clientes |
|---|---|
| ![Principais fluxos](app/ui/assets/docs/grande/principais-fluxos.jpg) | ![O que está afetando os clientes](app/ui/assets/docs/grande/afetando-clientes.jpg) |

| Detalhe da página: erros e onde a falha nasce | Traces: com falha e as mais lentas | Caminho da página no backend |
|---|---|---|
| ![Erros da página e onde falha no backend](docs/img/drilldown-erros.jpg) | ![Traces da página](docs/img/drilldown-traces.jpg) | ![Caminho no backend](docs/img/drilldown-backend.jpg) |

## Como funciona

- **A cópia.** Duas regras do OpenPipeline separam os poucos campos de que o app precisa (navegação, erros, chamadas de
  API e experiência) como business events, nos buckets do próprio app, com 1 dia de retenção. Nada mais nos seus
  pipelines muda: se os user.events já vão para um pipeline seu, as regras entram nele (modo integrado), e o app
  recusa aplicar se alguma regra existente mudaria.
- **O workflow.** A cada 5 minutos, um workflow simples (sem cobrança de hora de workflow) roda a ação do app: lê cada
  fatia de 5 minutos da cópia uma vez e grava os totais (grafo, Apdex, mapas, cliques), os erros com três exemplos e a
  análise de hora em hora (sessões, funis, requisições, ligação página → serviço).
- **A tela.** Cada abertura lê os buckets pequenos de agregados e o começo e o fim do período ao vivo, com um cache
  compartilhado de 5 minutos. O modo opcional "A cada 5 minutos" dispensa a parte ao vivo e lê ainda menos.
- **Nenhum segredo no navegador.** Tudo roda com a identidade e as permissões de quem clicou. A chave opcional do LLM
  fica só no pacote da função do app.

O diagrama está no [README em inglês](README.md#how-it-works).

## Requisitos

- Dynatrace SaaS com AppEngine, Grail e OpenPipeline.
- RUM on Grail nas aplicações web e mobile que você quer analisar.
- Para publicar: Node.js 20.19 ou mais novo e um usuário (ou platform token) com permissão para instalar apps
  (`app-engine:apps:install`).

## Instalação

1. **Clone e aponte para o seu ambiente.**

   ```bash
   git clone https://github.com/Rbiaggio/dynatrace-digital-experience-flow.git
   cd dynatrace-digital-experience-flow/app
   ```

   No `app.config.json`, troque o `environmentUrl` por `https://<id-do-seu-ambiente>.apps.dynatrace.com/`.

2. **Instale as dependências e publique.**

   ```bash
   npm ci
   npm run deploy            # abre o navegador para o login; instala o app no ambiente
   ```

   Sem interação (CI): crie um platform token com `app-engine:apps:install` e rode
   `DT_APP_PLATFORM_TOKEN=<token> npm run deploy -- --non-interactive --no-open`.

3. **Dê acesso.** Em Account Management > Identity & access management, crie as políticas do
   [README em inglês](README.md#install) (quem usa, quem configura, dono do workflow e, se quiser, quem usa o Dynatrace
   Assist) e ligue cada uma a um grupo com escopo no ambiente. A mesma lista está dentro do app, em Documentação >
   Pré-requisitos > Permissões.

4. **Configure.** Abra o app, clique na engrenagem (só administradores), marque as aplicações e clique em **Aplicar
   configuração**. A lista acima do botão diz o que será criado: 2 regras de extração, 7 buckets com o prefixo
   `rum_flow_`, 1 pipeline de business events com a rota dele.

5. **Crie o workflow.** Clique em **Criar o workflow**: o app Workflows abre já preenchido, é só salvar.

Os primeiros números aparecem em até 10 minutos; fluxos, páginas mais visitadas e funis (últimas 24 horas) completam
ao longo do primeiro dia.

### Extras opcionais

- **Apdex de Web Vitals.** O cartão Experiência lê a métrica `custom.rum.web_vitals.apdex_score`. Se o seu ambiente
  ainda não calcula, o [docs/apdex.md](docs/apdex.md) traz um pipeline pronto do OpenPipeline (Core Web Vitals com os
  limites públicos do Google), validado pela API de Settings.
- **Análise por LLM.** Desligada por padrão. O [docs/llm.md](docs/llm.md) explica a chave, a lista de liberados e a
  conexão de saída.

## Como testar

| O quê | Comando | Precisa de tenant? |
|---|---|---|
| Testes: análise por LLM (com LLM simulado), modelo de custo, mapas, Session Replay | `cd app && npm test` | Não |
| Checagem de tipos (tela e função do app) | `npm run typecheck` e `npm run typecheck:api` | Não |
| Montar o pacote do app | `npm run build` | Não |
| Rodar a tela local contra o seu ambiente | `npm start` (servidor do dt-app, login pelo navegador) | Sim |
| Gerar tráfego RUM de verdade: banco de demonstração com OneAgent e gerador de carga | ver [docs/demo-lab.md](docs/demo-lab.md) | Sim |

Foi assim que o app foi provado: o gerador de carga segue proporções conhecidas (por exemplo, 80% de quem entra clica
em "Entrar"), grava essas proporções num gabarito, e o grafo do app tem que mostrar os mesmos números.

## Custos

O Grail cobra consulta pelos GiB lidos, então o app foi desenhado para ler agregados pequenos em vez dos eventos crus:

- **Fixo:** o workflow, o que ele grava e a retenção dos buckets do app.
- **Por uso:** cada abertura de tela lê os agregados e o começo e o fim do período ao vivo. Filtros, "Isolar" e
  "Por quê?" leem a cópia sob demanda, limitados à última hora em períodos longos; "Onde falha no backend?" lê uma
  janela curta de spans.
- **Sem custo:** métricas nativas, entidades e App State.

Dentro do app, Documentação > Custos tem uma calculadora (com os seus volumes e as suas tarifas) e Configuração >
Consumo do app mostra o que o app consumiu de verdade, pelos eventos de cobrança da Dynatrace.

## Estrutura

```text
app/                      o app do Dynatrace (dt-app)
  app.config.json         id my.digital.experience.flow, endereço do ambiente, escopos
  ui/app/                 tela em React (Strato), consultas (lib/queries.ts), grafo, aba de documentação
  actions/def-agregar.*   ação do workflow: fatias de 5 minutos e análise de hora em hora
  api/                    função do app da análise por LLM (opcional)
  scripts/                apoio do build e o executor dos testes (npm test)
lab/                      ambiente de demonstração: banco de demonstração (3 canais web), API gateway, BFFs,
                          serviços de domínio com Postgres e Redis, OneAgent application-only, gerador de carga Playwright
docs/                     pipeline de Apdex, configuração do LLM, laboratório
```

## Licença

[MIT](LICENSE) © Rodrigo Biaggio
