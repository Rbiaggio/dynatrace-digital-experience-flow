/* Sub-aba "Visão geral" da aba Documentação, manual enxuto (1.45), em seis abas: Como ler (a barra, de quando é cada parte
   e as cores), Indicadores (a faixa e a tabela de aplicações), Experiência e mapas, O que afeta os clientes (os cartões,
   as ações e as oportunidades), Fluxos e páginas (com "Para ver o fluxo completo") e Sessões com erro. O detalhe técnico
   (regras, limites, leituras) fica no código e em docs/ do repositório. Genérica: vale para
   qualquer tenant. Montada só com as peças de ./Kit. */
import React from "react";
import {
  AiIcon, ApplicationsIcon, ArrowDownRightIcon, BugReportIcon, CalendarIcon, CriticalIcon, DesktopIcon, DocumentIcon, FilterIcon, FlowIcon,
  LogoutIcon, MobileIcon, PathIcon, RefreshIcon, ReplayIcon, ServicesIcon, UserSessionsIcon, WarningIcon, WorldmapIcon,
} from "@dynatrace/strato-icons";
import { t } from "../../lib/i18n";
import { Doc, Secao, Par, Lista, Tabela, Nota, Figura, Sub, Cartoes, FigurasLado } from "./Kit";

const I = 16;

export const DocVisaoGeral: React.FC = () => (
  <Doc titulo={t("Visão geral", "Overview")}
       resumo={t("A tela inicial mostra quantos clientes usaram a aplicação, como foi a experiência, onde eles estão, o que os está afetando, que caminhos fazem e o que fazer. Cada item abre o Flow no ponto certo.",
                 "The home screen shows how many customers used the application, how the experience was, where they are, what is affecting them, which paths they take and what to do. Each item opens the Flow at the right spot.")}>

    <Secao id="ler" titulo={t("Como ler", "How to read")}>
      <Sub>{t("A barra no alto", "The bar at the top")}</Sub>
      <Par>{t("A Visão geral e o Flow dividem a mesma barra. Tudo o que está na tela obedece a ela.", "The Overview and the Flow share the same bar. Everything on screen follows it.")}</Par>
      <Cartoes itens={[
        { icone: <ApplicationsIcon size={I} />, titulo: t("Aplicação", "Application"), texto: t("Uma aplicação ou \"Todas as aplicações\". Com todas, cada item ganha a etiqueta da aplicação.", "One application or \"All applications\". With all of them, each item gets the application tag.") },
        { icone: <FilterIcon size={I} />, titulo: t("Filtro", "Filter"), texto: t("Sistema operacional, navegador, versão do app, país e região. \"Limpar filtros\" tira todos.", "Operating system, browser, app version, country and region. \"Clear filters\" removes them all.") },
        { icone: <CalendarIcon size={I} />, titulo: t("Período", "Timeframe"), texto: t("De 10 minutos a 7 dias; o padrão é 30 minutos. Vale para o que é ao vivo: erros, Apdex e os números do grafo.", "From 10 minutes to 7 days; the default is 30 minutes. It applies to what is live: errors, Apdex and the graph numbers.") },
        { icone: <RefreshIcon size={I} />, titulo: t("Atualizar", "Refresh"), texto: t("Lê os dados de novo. Quando parte da tela veio de uma leitura guardada, aparece \"dados de hh:mm\" ao lado.", "Reads the data again. When part of the screen came from a saved read, \"data as of hh:mm\" shows next to it.") },
      ]} />
      <Par>{t("No canto direito ficam o idioma (PT ou EN), o Sobre e, só para administradores, a Configuração.", "In the right corner are the language (PT or EN), About and, for administrators only, Configuration.")}</Par>

      <Sub>{t("De quando é cada parte", "When each part is from")}</Sub>
      <Par>{t("Cada parte tem a sua base de tempo. A legenda no alto da Visão geral diz qual é, com o horário, e a nota de cada seção repete.", "Each part has its own time base. The legend at the top of the Overview says which one, with the time, and each section note repeats it.")}</Par>
      <Tabela cabecalho={[t("Base de tempo", "Time base"), t("O que segue essa base", "What follows it")]} linhas={[
        [<b>{t("Período escolhido, ao vivo", "Chosen timeframe, live")}</b>, t("Os erros (cartões, etapas dos fluxos e exemplos), o Apdex web e mobile, a cor do mapa de clientes e os números do grafo do Flow.", "Errors (cards, flow steps and examples), web and mobile Apdex, the color of the customer map and the Flow graph numbers.")],
        [<b>{t("Última hora", "Last hour")}</b>, t("Os indicadores de sessão, a tabela de aplicações, a lista de sessões com erro e os mapas (tamanho das bolhas e cor do mapa de erros).", "Session indicators, the applications table, the list of sessions with errors and the maps (bubble size and error map color).")],
        [<b>{t("Últimas 24 horas analisadas", "Last 24 analyzed hours")}</b>, t("Principais fluxos, páginas mais visitadas, funis das jornadas, onde as sessões terminam e \"Para ver o fluxo completo\".", "Main flows, most visited pages, journey funnels, where sessions end and \"To see the whole flow\".")],
      ]} />
      <Nota tipo="atencao">{t("Com sessões de robôs, frames das páginas ou um filtro em uso, todas as partes passam a ser do período escolhido, até no máximo a última hora (aparece \"com filtro: última hora\" ao lado do seletor).", "With robot sessions, page frames or a filter in use, every part becomes of the chosen timeframe, up to the last hour at most (\"with filter: last hour\" shows next to the selector).")}</Nota>
      <Nota>{t("Com a Configuração em \"A cada 5 minutos\", o período escolhido termina na última fatia gravada pelo workflow, de 5 a 10 minutos atrás, e a legenda diz até que horas. A abertura lê menos: só o que o workflow já agregou.", "With the Configuration set to \"Every 5 minutes\", the chosen timeframe ends at the last slice written by the workflow, 5 to 10 minutes ago, and the legend says up to what time. Opening reads less: only what the workflow already aggregated.")}</Nota>

      <Sub>{t("Cores", "Colors")}</Sub>
      <Lista itens={[
        { rotulo: t("Vermelho:", "Red:"), texto: t("só quando há impacto no cliente (erro, desistência, Apdex Ruim ou Inaceitável).", "only when customers are impacted (errors, giving up, Poor or Unacceptable Apdex).") },
        { rotulo: t("Âmbar:", "Amber:"), texto: t("atenção, ainda sem impacto direto.", "attention, no direct impact yet.") },
        { rotulo: t("Verde e cinza:", "Green and grey:"), texto: t("bom; sem medição.", "good; no measurement.") },
      ]} />
      <Par>{t("Os blocos maiores abrem recolhidos, com um resumo no cabeçalho; um clique abre o conteúdo.", "The larger blocks open collapsed, with a summary in the header; one click opens the content.")}</Par>
    </Secao>

    <Secao id="indicadores" titulo={t("Indicadores", "Indicators")}>
      <Par>{t("Quatro números no alto da tela, da última hora. Sessões de robôs ficam de fora.", "Four numbers at the top of the screen, from the last hour. Robot sessions are left out.")}</Par>
      <Cartoes itens={[
        { icone: <UserSessionsIcon size={I} />, titulo: t("Sessões", "Sessions"), texto: t("Quantas sessões usaram a aplicação. Embaixo, quantas páginas foram vistas.", "How many sessions used the application. Below, how many pages were viewed.") },
        { icone: <DocumentIcon size={I} />, titulo: t("Páginas por sessão", "Pages per session"), texto: t("A média de páginas por sessão e quantos viram uma página só.", "The average pages per session and how many saw only one page.") },
        { icone: <CriticalIcon size={I} />, titulo: t("Sessões com erro", "Sessions with errors"), texto: t("A parte das sessões com pelo menos um erro: chamada ao servidor com falha, erro na tela ou crash.", "The share of sessions with at least one error: failed server call, error on the screen or crash.") },
        { icone: <LogoutIcon size={I} />, titulo: t("Saíram após um erro", "Left after an error"), texto: t("As sessões que terminaram na página do erro. É a medida mais direta de quem desistiu.", "Sessions that ended on the error page. It is the most direct measure of who gave up.") },
      ]} />
      <Par>{t("Os dois últimos ficam vermelhos quando passam de zero. Um clique neles abre a lista de sessões com erro.", "The last two turn red when above zero. Clicking them opens the list of sessions with errors.")}</Par>
      <Nota>{t("Conta toda sessão com navegação ou erro na última hora, inclusive a que só mandou erro, sem abrir tela.", "Every session with a navigation or an error in the last hour counts, including one that only sent errors, without opening a screen.")}</Nota>
      <Figura id="faixa-indicadores" legenda={t("A faixa de indicadores.", "The indicator strip.")} />
      <Sub>{t("Aplicações", "Applications")}</Sub>
      <Par>{t("Com \"Todas as aplicações\" na barra, uma tabela repete os quatro indicadores por aplicação, também da última hora. Clicar numa linha escolhe a aplicação, e a tela inteira passa a mostrar só ela.", "With \"All applications\" in the bar, a table repeats the four indicators per application, also from the last hour. Clicking a row picks the application, and the whole screen shows only it.")}</Par>
      <Figura id="aplicacoes" legenda={t("A tabela de aplicações.", "The applications table.")} />
    </Secao>

    <Secao id="experiencia" titulo={t("Experiência e mapas", "Experience and maps")}>
      <Sub>{t("Experiência (Apdex)", "Experience (Apdex)")}</Sub>
      <Par>{t("Uma nota de 0 a 1 para o que o cliente sentiu, no período escolhido. Web e mobile têm notas separadas; com os dois, os quadros ficam lado a lado e o cartão abre no de nota pior.", "A score from 0 to 1 for what the customer felt, in the chosen timeframe. Web and mobile have separate scores; with both, the tiles sit side by side and the card opens on the one with the worse score.")}</Par>
      <Cartoes itens={[
        { icone: <DesktopIcon size={I} />, titulo: "Web", texto: t("Vem dos Web Vitals de cada carga de página (LCP, FCP, CLS e INP). Com menos de 10 cargas, o cartão avisa \"poucas medições\".", "It comes from the Web Vitals of each page load (LCP, FCP, CLS and INP). With fewer than 10 loads, the card warns \"few measurements\".") },
        { icone: <MobileIcon size={I} />, titulo: "Mobile", texto: t("Cada ação, abertura do app e tela vale 1 (rápida), 0,5 (tolerável) ou 0 (lenta ou com erro). Crash e ANR valem 0.", "Each action, app start and screen scores 1 (fast), 0.5 (tolerable) or 0 (slow or with errors). Crashes and ANRs score 0.") },
        { icone: <ArrowDownRightIcon size={I} />, titulo: t("O que puxa para baixo", "What pulls it down"), texto: t("As páginas, ações e telas que mais pesam, com a parte da queda de cada uma. \"Ver no Flow\" abre a página.", "The pages, actions and screens that weigh most, with each one's share of the drop. \"See in Flow\" opens the page.") },
      ]} />
      <Tabela cabecalho={[t("Cor da nota", "Score color"), t("Faixas", "Bands")]} linhas={[
        [<b>{t("Verde", "Green")}</b>, t("Excelente (0,94 a 1,00) e Bom (0,85 a 0,93)", "Excellent (0.94 to 1.00) and Good (0.85 to 0.93)")],
        [<b>{t("Âmbar", "Amber")}</b>, t("Razoável (0,70 a 0,84)", "Fair (0.70 to 0.84)")],
        [<b>{t("Vermelho", "Red")}</b>, t("Ruim (0,50 a 0,69) e Inaceitável (abaixo de 0,50): o cliente é impactado", "Poor (0.50 to 0.69) and Unacceptable (below 0.50): customers are impacted")],
      ]} />
      <Par>{t("A linha embaixo da nota é o Apdex ao longo do período, com a referência 0,85 (Bom) tracejada; o mouse sobre ela mostra o Apdex, a nota e o horário de cada intervalo.", "The line below the score is the Apdex over the timeframe, with the 0.85 (Good) reference dashed; hovering over it shows the Apdex, the score and the time of each interval.")}</Par>
      <Par>{t("O quadro mobile mostra ainda os crashes, os ANR e o tempo de abertura do app. Sem medição no período, o cartão oferece os últimos 7 dias ou diz o motivo e quem resolve.", "The mobile tile also shows crashes, ANRs and the app start time. With no measurement in the timeframe, the card offers the last 7 days or says why and who fixes it.")}</Par>
      <FigurasLado>
        <Figura id="experiencia-apdex" legenda={t("O cartão de experiência das páginas web.", "The web pages' experience card.")} />
        <Figura id="apdex-mobile" legenda={t("O mesmo cartão com web e mobile lado a lado.", "The same card with web and mobile side by side.")} />
      </FigurasLado>

      <Sub>{t("Os dois mapas", "The two maps")}</Sub>
      <Cartoes itens={[
        { icone: <WorldmapIcon size={I} />, titulo: t("Onde estão os clientes", "Where customers are"), texto: t("A bolha tem o tamanho das sessões do lugar. A cor é o Apdex do lugar: verde a partir de 0,85, âmbar de 0,70 a 0,84, vermelho abaixo de 0,70, cinza sem medição. Anel tracejado: carga lenta (p75 de 3 s ou mais).", "The bubble is sized by the place's sessions. The color is the place Apdex: green from 0.85, amber from 0.70 to 0.84, red below 0.70, grey without measurement. Dashed ring: slow load (p75 of 3 s or more).") },
        { icone: <WarningIcon size={I} />, titulo: t("Onde acontecem os erros", "Where errors happen"), texto: t("A bolha tem o tamanho das sessões com erro (ou dos erros, pelo seletor). A cor é a parte das sessões do lugar com erro: vermelho a partir de 25%, âmbar a partir de 10%. Um lugar bem acima da média também muda de cor.", "The bubble is sized by sessions with errors (or by errors, through the selector). The color is the share of the place's sessions with errors: red from 25%, amber from 10%. A place well above the average also changes color.") },
      ]} />
      <Lista itens={[
        { rotulo: t("Clique para filtrar.", "Click to filter."), texto: t("Uma bolha ou uma linha da lista filtra a Visão geral inteira por aquele lugar; o \"×\" no cabeçalho tira o filtro.", "A bubble or a list row filters the whole Overview by that place; the \"×\" in the header clears it.") },
        { rotulo: t("Brasil | Mundo.", "Brazil | World."), texto: t("Os botões trocam o enquadramento: estados do Brasil ou países. Dá para aproximar, afastar e arrastar; o mouse sobre a bolha mostra os números.", "The buttons switch the frame: Brazilian states or countries. You can zoom in, zoom out and drag; hovering a bubble shows its numbers.") },
        { rotulo: t("Sem localização.", "No location."), texto: t("Sessões sem IP público (rede interna) aparecem só na lista.", "Sessions without a public IP (internal network) show only in the list.") },
      ]} />
      <Figura id="mapas" legenda={t("Os dois mapas, com as listas e as legendas.", "The two maps, with their lists and legends.")} />
    </Secao>

    <Secao id="afetando" titulo={t("O que afeta os clientes", "What affects customers")}>
      <Par>{t("Um cartão por página com erro, do maior impacto para o menor: primeiro quem desistiu ou não concluiu, depois quantos foram afetados. \"Mostrar mais\" abre o resto.", "One card per page with errors, from the biggest impact to the smallest: first who gave up or did not complete, then how many were affected. \"Show more\" opens the rest.")}</Par>
      <Sub>{t("O selo diz o que está em jogo", "The tag says what is at stake")}</Sub>
      <Cartoes itens={[
        { icone: <LogoutIcon size={I} />, titulo: t("Clientes desistindo", "Customers giving up"), texto: t("Alguém encerrou a sessão logo depois do erro.", "Someone ended the session right after the error.") },
        { icone: <PathIcon size={I} />, titulo: t("Clientes não concluem", "Customers can't complete"), texto: t("Alguém com erro não chegou à etapa seguinte do fluxo.", "Someone with an error did not reach the next step of the flow.") },
        { icone: <CriticalIcon size={I} />, titulo: t("Clientes com erro", "Customers with errors"), texto: t("Houve erro, sem desistência registrada.", "There were errors, with no recorded giving up.") },
      ]} />
      <Sub>{t("Como ler um cartão", "How to read a card")}</Sub>
      <Lista itens={[
        { rotulo: t("Clientes afetados:", "Customers affected:"), texto: t("a rosca mostra a parte de quem usou a página e teve erro.", "the donut shows the share of those who used the page and had errors.") },
        { rotulo: t("Quem parou:", "Who stopped:"), texto: t("quantos não chegaram à próxima etapa e quantos encerraram a sessão logo após o erro.", "how many did not reach the next step and how many ended the session right after the error.") },
        { rotulo: t("O erro:", "The error:"), texto: t("o que mais aconteceu (chamada ao servidor com o status e o caminho, crash ou erro na tela), com a miniatura dos erros no período.", "what happened most (server call with the status and path, crash or error on the screen), with the sparkline of errors over the timeframe.") },
        { rotulo: t("O caminho:", "The path:"), texto: t("as etapas do fluxo que passa pela página, com a etapa que falha em vermelho.", "the steps of the flow through the page, with the failing step in red.") },
        { rotulo: t("O que fazer e quem faz:", "What to do and who does it:"), texto: t("a correção sugerida e o time responsável.", "the suggested fix and the team in charge.") },
      ]} />
      <Par>{t("Problemas do caminho sem erro registrado, como muitos clientes parando numa tela ou indo e voltando entre duas, ganham cartão com o selo \"Atenção\".", "Path problems without recorded errors, such as many customers stopping on a screen or going back and forth between two, get a card with the \"Attention\" tag.")}</Par>
      <Sub>{t("As ações", "The actions")}</Sub>
      <Cartoes itens={[
        { icone: <ReplayIcon size={I} />, titulo: t("Ver sessões e Replay", "See sessions and Replay"), texto: t("Abre a lista de sessões com erro nesta página. Fica só \"Ver sessões\" quando a aplicação não grava replay.", "Opens the list of sessions with errors on this page. It reads just \"See sessions\" when the application does not record replay.") },
        { icone: <FlowIcon size={I} />, titulo: t("Ver no Flow", "See in Flow"), texto: t("Abre a página no Flow, já nos erros. \"Ver erros ↗\" abre o Error Inspector.", "Opens the page in the Flow, on its errors. \"See errors ↗\" opens Error Inspector.") },
        { icone: <ServicesIcon size={I} />, titulo: t("Onde falha no backend?", "Where does it fail in the backend?"), texto: t("Em chamada ao servidor com falha: o serviço onde a falha nasce, o caminho até ele e um trace de exemplo.", "For a failed server call: the service where the failure starts, the path to it and a sample trace.") },
        { icone: <AiIcon size={I} />, titulo: "Dynatrace Assist", texto: t("A IA escreve a análise, a causa raiz e as ações. Para quem tem a permissão de IA; uma análise já feita aparece como \"pronta\".", "The AI writes the analysis, the root cause and the actions. For those with the AI permission; an analysis already made shows as \"ready\".") },
      ]} />
      <Figura id="afetando-clientes" legenda={t("Cartões de \"O que está afetando os clientes\": os números à esquerda, o erro, o caminho e o que fazer à direita.", "\"What is affecting customers\" cards: the numbers on the left, the error, the path and what to do on the right.")} />
      <Sub>{t("Oportunidades de melhoria", "Improvement opportunities")}</Sub>
      <Par>{t("Logo abaixo, o que a tela já leu vira oportunidades, ordenadas pelo impacto no cliente e pelo esforço, cada uma com a evidência, o que fazer e quem faz. O rodapé traz \"Resumo do Dynatrace Assist\", \"Gerar relatório\" (PDF) e, para usuários liberados, \"Analisar com LLM\", explicados na sub-aba IA.", "Right below, what the screen already read becomes opportunities, ordered by customer impact and effort, each with the evidence, what to do and who does it. The footer holds \"Dynatrace Assist summary\", \"Generate report\" (PDF) and, for allowed users, \"Analyze with an LLM\", explained in the AI sub-tab.")}</Par>
    </Secao>

    <Secao id="fluxos" titulo={t("Fluxos e páginas", "Flows and pages")}>
      <Sub>{t("Principais fluxos", "Main flows")}</Sub>
      <Par>{t("Os 5 caminhos que os clientes mais fazem, etapa por etapa, como um funil. Recargas da mesma tela não contam, e o caminho é contado pelas 6 primeiras etapas (\"…\" quando continua).", "The 5 paths customers take most, step by step, as a funnel. Reloads of the same screen do not count, and the path is counted by its first 6 steps (\"…\" when it goes on).")}</Par>
      <Lista itens={[
        { rotulo: t("No topo:", "At the top:"), texto: t("a parte das sessões que faz o caminho completo e o selo \"desistiram após um erro\", \"Etapa com erro\" ou \"Sem erro\".", "the share of sessions taking the whole path and the tag \"gave up after an error\", \"Step with errors\" or \"No errors\".") },
        { rotulo: t("As barras:", "The bars:"), texto: t("quantos chegaram a cada etapa; a parte vermelha é quem teve erro naquela página.", "how many reached each step; the red part is who had errors on that page.") },
        { rotulo: t("Entre as barras:", "Between the bars:"), texto: t("quem não seguiu: foi para outra página, encerrou a sessão sem erro ou saiu depois de um erro. A legenda \"Como ler\" mostra as cores.", "who did not continue: went to another page, ended the session with no error or left after an error. The \"How to read\" legend shows the colors.") },
        { rotulo: t("Etapa com erro:", "Step with errors:"), texto: t("uma linha com o erro principal, se os clientes concluíram a etapa seguinte mesmo assim e os botões \"Ver sessões\", \"Ver erros ↗\" e \"Onde falha no backend?\".", "a line with the main error, whether customers still completed the next step and the \"See sessions\", \"See errors ↗\" and \"Where does it fail in the backend?\" buttons.") },
        { rotulo: t("Nome da etapa:", "Step name:"), texto: t("abre a página no Flow.", "opens the page in the Flow.") },
      ]} />
      <Figura id="principais-fluxos" legenda={t("Um fluxo como funil, com a etapa que falha e a linha do erro embaixo.", "A flow as a funnel, with the failing step and the error line below.")} />
      <Sub>{t("Páginas mais visitadas", "Most visited pages")}</Sub>
      <Par>{t("As 6 páginas com mais visitas, com a parte de cada uma, o tempo de carga (p75 aproximado, \"p75 ≈\") e os erros; uma rosca mostra a mesma divisão. Clicar numa linha abre a página no Flow, e o número de erros abre os erros dela.", "The 6 pages with the most views, with each one's share, the load time (approximate p75, \"p75 ≈\") and the errors; a donut shows the same split. Clicking a row opens the page in the Flow, and the error count opens its errors.")}</Par>
      <Sub>{t("Para ver o fluxo completo", "To see the whole flow")}</Sub>
      <Par>{t("Só aparece quando falta algo no monitoramento: não afeta o cliente, mas esconde parte do caminho. Cada item traz a correção e quem faz.", "It only shows when something is missing in the monitoring: it does not affect customers, but it hides part of the path. Each item brings the fix and who does it.")}</Par>
      <Tabela cabecalho={[t("Ajuste", "Fix"), t("O que acontece", "What happens"), t("Quem faz", "Who")]} linhas={[
        [t("Telas sem nome", "Screens without names"), t("As sessões do app mobile não mostram fluxo.", "Mobile app sessions show no flow."), t("time do app", "app team")],
        [t("WebView do Android sem monitoramento híbrido", "Android WebView without hybrid monitoring"), t("As páginas web dentro do app Android não se ligam à tela do app que as abriu; o aviso diz também se o iOS já está com o híbrido ligado.", "Web pages inside the Android app are not linked to the app screen that opened them; the notice also says whether iOS already has hybrid monitoring on."), t("time do app Android", "Android app team")],
        [t("Páginas abrem em aba nova sem origem", "Pages open in a new tab without origin"), t("Páginas web dentro do app nativo (WebView) começam cada uma um fluxo próprio.", "Web pages inside the native app (WebView) each start a flow of their own."), t("time do app", "app team")],
        [t("Chamadas de API sem trace", "API calls without trace"), t("As páginas não se ligam ao backend.", "Pages are not linked to the backend."), t("times do app e da API", "app and API teams")],
      ]} />
    </Secao>

    <Secao id="sessoes" titulo={t("Sessões com erro", "Sessions with errors")}>
      <Par>{t("A lista abre logo abaixo dos indicadores, pelo clique em \"Sessões com erro\" ou \"Saíram após um erro\", ou pelo \"Ver sessões\" de um cartão ou fluxo. Vinda de um cartão, traz só as sessões com erro naquela página; o × da etiqueta \"Erro na página\" tira o filtro.", "The list opens right below the indicators, by clicking \"Sessions with errors\" or \"Left after an error\", or through \"See sessions\" on a card or flow. Coming from a card, it brings only the sessions with errors on that page; the × on the \"Error on page\" tag removes the filter.")}</Par>
      <Lista itens={[
        { rotulo: t("Duas abas:", "Two tabs:"), texto: t("\"Todas com erro\" e \"Saíram após o erro\", com as 50 sessões mais recentes da última hora.", "\"All with errors\" and \"Left after the error\", with the 50 most recent sessions of the last hour.") },
        { rotulo: t("Cada linha:", "Each row:"), texto: t("a hora de início, o primeiro erro e a página dele, onde a sessão terminou e quantas páginas e erros teve. O selo \"Saiu após o erro\" marca quem desistiu.", "the start time, the first error and its page, where the session ended and how many pages and errors it had. The \"Left after the error\" tag marks who gave up.") },
        { rotulo: t("Mais lentas:", "Slowest:"), texto: t("embaixo, as sessões das 3 requisições mais lentas das últimas 24 horas, com a duração, o endpoint e a página.", "below, the sessions of the 3 slowest requests of the last 24 hours, with the duration, the endpoint and the page.") },
      ]} />
      <Sub>{t("Os botões de cada sessão", "Each session's buttons")}</Sub>
      <Cartoes itens={[
        { icone: <ReplayIcon size={I} />, titulo: "Replay", texto: t("Abre a gravação da sessão no Users & Sessions. O Dynatrace grava a sessão alguns minutos depois que ela termina.", "Opens the session recording in Users & Sessions. Dynatrace records the session a few minutes after it ends.") },
        { icone: <UserSessionsIcon size={I} />, titulo: t("Sessão", "Session"), texto: t("Abre o detalhe da sessão no Users & Sessions.", "Opens the session details in Users & Sessions.") },
        { icone: <BugReportIcon size={I} />, titulo: t("Erros", "Errors"), texto: t("Abre os erros desta sessão no Error Inspector.", "Opens this session's errors in Error Inspector.") },
      ]} />
      <Nota>{t("O Replay fica cinza quando a aplicação não grava replay, ou quando o app mobile grava só em crash e a sessão não teve crash; a dica do botão diz o motivo. Trocar o período ou a aplicação fecha a lista, e Atualizar lê de novo.", "Replay turns grey when the application does not record replay, or when the mobile app records only on crash and the session had no crash; the button tooltip says why. Changing the timeframe or the application closes the list, and Refresh reads again.")}</Nota>
      <Figura id="lista-sessoes" legenda={t("A lista de sessões com erro, com os botões Replay, Sessão e Erros.", "The list of sessions with errors, with the Replay, Session and Errors buttons.")} />
    </Secao>
  </Doc>
);
