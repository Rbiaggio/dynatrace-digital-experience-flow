/* Sub-aba "Flow e jornadas" da aba Documentação, manual enxuto (1.45), em cinco abas: O grafo (os nós, as linhas, de
   quando são os números e o aviso de coleta), Explorar (mouse, teclado, cartões da esquerda e Isolar), Painel da página
   (o painel da direita, as abas da página e "Onde falha no backend?"), Jornadas (criar, ler o funil e "Por quê?") e
   Filtros e atalhos (segmento, robôs, frames e as telas nativas). O detalhe técnico (fontes, consultas, regras exatas)
   fica no código e em docs/ do repositório. Genérica: vale para qualquer tenant. Montada só
   com as peças de ./Kit. */
import React from "react";
import { ApplicationsIcon, DatabaseIcon, DocumentIcon, FlowIcon, PathIcon, ServicesIcon, SuccessIcon, UserSessionsIcon } from "@dynatrace/strato-icons";
import { t } from "../../lib/i18n";
import { Doc, Secao, Par, Lista, Tabela, Nota, Figura, Cod, Sub, Cartoes, Passos } from "./Kit";

const I = 16;

export const DocFlow: React.FC = () => (
  <Doc titulo={t("Flow e jornadas", "Flow and journeys")}
       resumo={t("Como os clientes navegam pelas aplicações, quais serviços cada página chama, onde eles param e por quê.",
                 "How customers move through the applications, which services each page calls, where they stop and why.")}>

    <Secao id="grafo" titulo={t("O grafo", "The graph")}>
      <Par>{t("O caminho dos clientes, da esquerda para a direita: a aplicação, as páginas que eles percorrem e o backend que elas chamam. O backend começa escondido: \"+ Backend\", na barra do alto, mostra os serviços e bancos, e o vermelho marca os que tiveram requisições com falha no período.",
              "The customers' path, from left to right: the application, the pages they go through and the backend those pages call. The backend starts hidden: \"+ Backend\", on the top bar, shows the services and databases, and red marks the ones with failed requests in the timeframe.")}</Par>
      <Cartoes itens={[
        { icone: <ApplicationsIcon size={I} />, titulo: t("Aplicação", "Application"), texto: t("A entrada do fluxo, web ou mobile. Embaixo, as entradas: sessões que começaram ali. No app mobile, a entrada é a 1ª tela da sessão; no Android, a tela da abertura do app.", "The entry of the flow, web or mobile. Below it, the entries: sessions that started there. In a mobile app, the entry is the session's first screen; on Android, the app start screen.") },
        { icone: <DocumentIcon size={I} />, titulo: t("Página", "Page"), texto: t("Página web ou tela do app. Embaixo, quantos chegam e o abandono: quem não segue para outra página.", "Web page or app screen. Below it, how many come in and the drop-off: those who do not go on to another page.") },
        { icone: <ServicesIcon size={I} />, titulo: t("Serviço", "Service"), texto: t("Servidor web, gateway, API ou microsserviço, na ordem das chamadas. Embaixo, as requisições recebidas; em vermelho, com o número, quando houve requisições com falha.", "Web server, gateway, API or microservice, in call order. Below it, the requests received; in red, with the number, when there were failed requests.") },
        { icone: <DatabaseIcon size={I} />, titulo: t("Banco de dados", "Database"), texto: t("Chamado pelos serviços; o fabricante vem entre parênteses no nome.", "Called by the services; the vendor shows in parentheses in the name.") },
      ]} />
      <Sub>{t("Como ler as linhas", "How to read the lines")}</Sub>
      <Tabela cabecalho={[t("No grafo", "On the graph"), t("Quer dizer", "Means")]} linhas={[
        [t("Seta com porcentagem", "Arrow with a percentage"), t("Navegação entre páginas: a fatia de quem sai da página de origem e segue por ali. Mais grossa, mais navegações.", "Navigation between pages: the share of those leaving the origin page who take that path. Thicker, more navigations.")],
        [t("Arco tracejado", "Dashed arc"), t("Volta: o cliente voltou para uma página anterior.", "Back: the customer returned to an earlier page.")],
        [t("Linha fina contínua", "Thin solid line"), t("A página chama aquele serviço.", "The page calls that service.")],
        [t("Linha pontilhada", "Dotted line"), t("Um serviço chama outro serviço ou um banco.", "A service calls another service or a database.")],
        [t("Número vermelho no nó", "Red number on the node"), t("Erros da página: chamadas ao servidor com falha mais erros na tela, sem os de terceiros, como analytics e anúncios.", "Page errors: failed server calls plus errors on the screen, without third-party ones, such as analytics and ads.")],
      ]} />
      <Sub>{t("De quando são os números", "When the numbers are from")}</Sub>
      <Lista itens={[
        { rotulo: t("Números ao vivo.", "Live numbers."), texto: t("Porcentagens, chegadas, abandono e erros são do período escolhido.", "Percentages, arrivals, drop-off and errors are from the chosen timeframe.") },
        { rotulo: t("Só o que aconteceu.", "Only what happened."), texto: t("O grafo mostra as páginas e as setas que tiveram navegação no período escolhido.", "The graph shows the pages and arrows that had navigation in the chosen timeframe.") },
      ]} />
      <Nota tipo="atencao">{t("Se uma aplicação habilitada não teve nenhuma navegação no período, ela não aparece no grafo e o aviso \"Sem coleta\" no alto diz qual. Caso típico: um app mobile cujo aparelho parou de mandar dados.",
                              "If an enabled application had no navigation in the timeframe, it does not show in the graph and the \"No data collected\" notice at the top says which. Typical case: a mobile app whose device stopped sending data.")}</Nota>
      <Figura id="flow-grafo" legenda={t("O grafo: as aplicações à esquerda, as páginas no meio e o backend à direita.", "The graph: the applications on the left, the pages in the middle and the backend on the right.")} />
    </Secao>

    <Secao id="explorar" titulo={t("Explorar", "Explore")}>
      <Sub>{t("Mouse e teclado", "Mouse and keyboard")}</Sub>
      <Tabela cabecalho={[t("Ação", "Action"), t("O que faz", "What it does")]} linhas={[
        [t("Arrastar o fundo", "Drag the background"), t("Move a vista.", "Pans the view.")],
        [t("Arrastar um nó", "Drag a node"), t("Move o nó. A caixa da aplicação leva junto as páginas dela; o primeiro serviço, o backend que ele alcança.", "Moves the node. The application box takes its pages along; the first service, the backend it reaches.")],
        [t("Roda do mouse ou pinça", "Mouse wheel or pinch"), t("Aproxima e afasta; os botões do rodapé também ajustam o grafo à tela.", "Zooms in and out; the footer buttons also fit the graph to the screen.")],
        [t("Pairar sobre uma página", "Hover a page"), t("Acende em azul o caminho dela no backend.", "Lights up its backend path in blue.")],
        [t("Clicar num nó", "Click a node"), <>{t("Abre o menu: ", "Opens the menu: ")}<Cod>{t("Isolar", "Isolate")}</Cod>, <Cod>{t("Ver topologia", "View topology")}</Cod>{t(" e ", " and ")}<Cod>{t("Abrir detalhes", "Open details")}</Cod>{t(", que abre o painel da direita.", ", which opens the right panel.")}</>],
        [t("Clicar numa seta", "Click an arrow"), t("Mostra origem, destino e volume.", "Shows origin, destination and volume.")],
        [<Cod>Ctrl+F</Cod>, t("Busca nós por nome ou ID; o resto fica apagado.", "Finds nodes by name or ID; the rest is dimmed.")],
        [<Cod>Esc</Cod>, t("Fecha o menu ou sai do isolamento.", "Closes the menu or exits isolation.")],
        [<Cod>{t("Reorganizar", "Reset layout")}</Cod>, t("Devolve os nós ao lugar calculado.", "Puts the nodes back in their computed place.")],
      ]} />
      <Sub>{t("Cartões à esquerda", "Cards on the left")}</Sub>
      <Lista itens={[
        { rotulo: t("Layout.", "Layout."), texto: t("Horizontal (padrão), Vertical ou Force.", "Horizontal (default), Vertical or Force.") },
        { rotulo: t("Esconder caminhos raros.", "Hide rare paths."), texto: t("Tira as setas com menos de 5% das saídas; o limite vai de 1% a 50%.", "Removes arrows with less than 5% of the exits; the threshold goes from 1% to 50%.") },
        { rotulo: t("Nós.", "Nodes."), texto: t("A busca, o destaque dos nós com erro e os tipos de nó; o olho esconde serviços ou bancos.", "The search, the highlight of nodes with errors and the node types; the eye hides services or databases.") },
        { rotulo: t("Muitas páginas.", "Many pages."), texto: <>{t("Acima de 40 páginas, a aplicação abre com as 40 mais visitadas; ", "Above 40 pages, the application opens with the 40 most visited; ")}<Cod>{t("Mostrar todas as páginas", "Show all pages")}</Cod>{t(" traz o resto.", " brings the rest.")}</> },
      ]} />
      <Sub>{t("Isolar", "Isolate")}</Sub>
      <Par>{t("Mostra só o fluxo que passa por um nó. Isolando uma página, os números passam a ser só das sessões que passaram por ela, e o backend fica só com o que ela chama. \"Níveis em volta do nó\" diz quantos passos entram de cada lado; Esc ou \"Sair do isolamento\" volta ao fluxo inteiro.",
              "Shows only the flow that goes through a node. Isolating a page, the numbers become those of the sessions that went through it, and the backend keeps only what it calls. \"Levels around the node\" sets how many steps enter on each side; Esc or \"Exit isolation\" goes back to the whole flow.")}</Par>
      <Nota>{t("Em período maior que 1 hora, as sessões que passaram pelo nó são as da última hora; o painel diz \"na última hora\".", "In a timeframe longer than 1 hour, the sessions that went through the node are those of the last hour; the panel says \"in the last hour\".")}</Nota>
    </Secao>

    <Secao id="painel" titulo={t("Painel da página", "Page panel")}>
      <Par>{t("O painel da direita muda conforme o que está escolhido no grafo.", "The right panel changes with what is selected on the graph.")}</Par>
      <Cartoes itens={[
        { icone: <FlowIcon size={I} />, titulo: t("Nada escolhido", "Nothing selected"), texto: t("A visão geral do fluxo: destaques com quem resolve, páginas mais visitadas, onde as sessões terminam e backend usado.", "The flow overview: highlights with who fixes them, most visited pages, where sessions end and backend used.") },
        { icone: <ApplicationsIcon size={I} />, titulo: t("Uma aplicação", "An application"), texto: t("Entradas, páginas no fluxo, erros e por qual página as sessões começam.", "Entries, pages in the flow, errors and which page sessions start on.") },
        { icone: <ServicesIcon size={I} />, titulo: t("Um serviço ou banco", "A service or database"), texto: <>{t("Requisições, % com falha, tempo médio, quem chama e quem é chamado. ", "Requests, % failed, average time, callers and callees. ")}<Cod>{t("Abrir no Dynatrace", "Open in Dynatrace")}</Cod>{t(" leva à tela do serviço.", " goes to the service screen.")}</> },
      ]} />
      <Sub>{t("Uma página escolhida", "A selected page")}</Sub>
      <Par>{t("No alto: visitas, quantos seguem, quantos encerram a sessão ali, erros e tempo de carga (média e p75 aproximado), com os atalhos Isolar no fluxo, Ver erros e \"Onde falha no backend?\". Embaixo, cinco abas:",
              "At the top: visits, how many go on, how many end the session there, errors and load time (average and approximate p75), with the shortcuts Isolate in the flow, See errors and \"Where does it fail in the backend?\". Below, five tabs:")}</Par>
      <Tabela cabecalho={[t("Aba", "Tab"), t("O que mostra", "What it shows")]} linhas={[
        ["Flow", t("Para onde os clientes vão e de onde vêm, em porcentagem. Clicar num nome escolhe aquela página.", "Where customers go and where they come from, as percentages. Clicking a name selects that page.")],
        [t("Erros", "Errors"), t("Agrupados pelo nome, com as ocorrências e os 3 exemplos mais recentes de cada um (hora, duração, trace e sessão). O nome abre o Error Inspector; falhas de terceiros ficam à parte.", "Grouped by name, with the occurrences and the 3 most recent examples of each (time, duration, trace and session). The name opens Error Inspector; third-party failures are kept apart.")],
        [t("Cliques", "Clicks"), t("Os 25 elementos mais clicados, com a fatia de cada um.", "The 25 most clicked elements, with each one's share.")],
        ["Backend", t("Os serviços que as chamadas da página atravessam, na ordem, com volume, falhas e tempo; e as chamadas de API que falharam.", "The services the page's calls go through, in order, with volume, failures and time; and the API calls that failed.")],
        ["Traces", t("Com erro: os 3 mais recentes de cada erro. Mais lentas: as 3 requisições mais lentas. Todos com trace e sessão. Ao abrir um trace, o app confere antes se ele tem spans; se a chamada foi para um serviço que o Dynatrace não monitora no ambiente (um terceiro, ou um backend sem OneAgent), aparece \"trace sem spans\" no lugar do atalho.", "With errors: the 3 most recent of each error. Slowest: the 3 slowest requests. All with trace and session. When a trace is opened, the app first checks that it has spans; if the call went to a service Dynatrace does not monitor in the environment (a third party, or a backend without OneAgent), \"trace without spans\" shows instead of the shortcut.")],
      ]} />
      <Nota>{t("Tudo é do período escolhido, menos o caminho no backend e as requisições mais lentas, que somam as últimas 24 horas analisadas.", "Everything is from the chosen timeframe, except the backend path and the slowest requests, which add up the last 24 analyzed hours.")}</Nota>
      <Figura id="flow-painel-pagina" legenda={t("Uma página escolhida: os números no alto e as abas do painel.", "A selected page: the numbers at the top and the panel tabs.")} />
      <Sub>{t("Onde falha no backend?", "Where does it fail in the backend?")}</Sub>
      <Par>{t("Aparece quando há chamada ao servidor com falha. O app lê os traces das falhas mais recentes e diz em qual serviço a falha nasce, em quantas chamadas e quem corrige, com atalhos para um trace e para o serviço. Gateways e proxies que só repassam o erro não contam como origem.",
              "It shows when there is a failed server call. The app reads the traces of the most recent failures and says in which service the failure starts, in how many calls and who fixes it, with shortcuts to a trace and to the service. Gateways and proxies that only pass the error on do not count as the origin.")}</Par>
      <Nota tipo="dica">{t("Se as falhas não levam trace, em geral porque a API está em outro domínio, o bloco aponta o ajuste em \"Para ver o fluxo completo\".", "If the failures carry no trace, usually because the API is on another domain, the block points to the fix in \"To see the whole flow\".")}</Nota>
    </Secao>

    <Secao id="jornadas" titulo={t("Jornadas", "Journeys")}>
      <Par>{t("Uma jornada é uma sequência de páginas que o cliente percorre em ordem, como entrar, escolher e confirmar. Cada uma tem um cartão na faixa Jornadas, com o funil em miniatura, a conversão e os erros; clicar nele numera os passos no grafo e abre o funil.",
              "A journey is a sequence of pages the customer goes through in order, such as sign in, choose and confirm. Each one has a card on the Journeys strip, with a miniature funnel, the conversion and the errors; clicking it numbers the steps on the graph and opens the funnel.")}</Par>
      <Sub>{t("Criar uma jornada", "Create a journey")}</Sub>
      <Passos itens={[
        { titulo: t("Nova jornada", "New journey"), texto: t("Clicar em \"Nova jornada\" na faixa Jornadas.", "Click \"New journey\" on the Journeys strip.") },
        { titulo: t("Escolher os passos", "Pick the steps"), texto: t("Clicar nas páginas do grafo na ordem da jornada, pelo menos 2. Serviços clicados viram o backend relacionado.", "Click the graph pages in the journey order, at least 2. Clicked services become the related backend.") },
        { titulo: t("Salvar", "Save"), texto: t("Dar um nome e teclar Enter. A jornada vale para todos os usuários; editar e excluir ficam no painel dela.", "Give it a name and press Enter. The journey applies to all users; edit and delete are in its panel.") },
      ]} />
      <Sub>{t("Ler o funil", "Read the funnel")}</Sub>
      <Lista itens={[
        { rotulo: t("Conversão.", "Conversion."), texto: t("Sessões que chegaram ao último passo divididas pelas que entraram no primeiro.", "Sessions that reached the last step divided by those that entered the first.") },
        { rotulo: t("Cada passo.", "Each step."), texto: t("Sessões e a fatia sobre quem começou, com os erros da página.", "Sessions and the share over those who started, with the page errors.") },
        { rotulo: t("N saíram.", "N left."), texto: t("Quem fez o passo anterior e não chegou ao seguinte; \"N depois de um erro\" é a parte com erro na página anterior. \"Maior perda\" marca o maior degrau.", "Those who did the previous step and did not reach the next one; \"N after an error\" is the part with an error on the previous page. \"Biggest loss\" marks the biggest drop.") },
      ]} />
      <Nota>{t("O funil conta sessões: uma sessão só conta num passo se passou pelo anterior antes. Sem filtros, ele soma as últimas 24 horas analisadas.", "The funnel counts sessions: a session only counts in a step if it went through the previous one first. Without filters, it adds up the last 24 analyzed hours.")}</Nota>
      <Sub>{t("Por quê?", "Why?")}</Sub>
      <Par>{t("Em cada perda do funil, \"Por quê?\" analisa quem parou, em três partes:", "On each funnel loss, \"Why?\" analyzes those who stopped, in three parts:")}</Par>
      <Cartoes itens={[
        { icone: <SuccessIcon size={I} />, titulo: t("Veredito", "Verdict"), texto: t("O erro na página anterior explica a perda? Compara quem parou com quem seguiu.", "Does the error on the previous page explain the loss? It compares those who stopped with those who continued.") },
        { icone: <PathIcon size={I} />, titulo: t("Para onde foram", "Where they went"), texto: t("A primeira página depois de parar, a volta a um passo anterior ou a saída da aplicação.", "The first page after stopping, a return to an earlier step or leaving the application.") },
        { icone: <UserSessionsIcon size={I} />, titulo: t("Sessões", "Sessions"), texto: t("Até 25 sessões que pararam ali, erros primeiro, com Replay, Sessão e Erros.", "Up to 25 sessions that stopped there, errors first, with Replay, Session and Errors.") },
      ]} />
      <Nota>{t("Em período maior que 1 hora, o veredito sai do funil das jornadas salvas (as horas analisadas, o mesmo período do funil), e \"Para onde foram\" e as sessões são da última hora, com o aviso \"na última hora\". Jornada ainda não salva, ou com filtro, robôs ou frames, fica toda na última hora.", "In a timeframe longer than 1 hour, the verdict comes from the saved journeys' funnel (the analyzed hours, the same period as the funnel), and \"Where they went\" and the sessions are from the last hour, with the \"in the last hour\" notice. A journey not saved yet, or with a filter, robots or frames, is all from the last hour.")}</Nota>
      <Figura id="flow-jornada"legenda={t("Uma jornada ativa: os passos numerados no grafo e o funil no painel.", "An active journey: the numbered steps on the graph and the funnel in the panel.")} />
    </Secao>

    <Secao id="filtros" titulo={t("Filtros e atalhos", "Filters and shortcuts")}>
      <Sub>{t("Filtros", "Filters")}</Sub>
      <Par>{t("O botão de filtro da barra recorta por sistema operacional, navegador, versão do app, país e região, na Visão geral e em todo o Flow.",
              "The filter button on the bar narrows by operating system, browser, app version, country and region, in the Overview and across the Flow.")}</Par>
      <Lista itens={[
        { rotulo: t("Robôs.", "Robots."), texto: t("Ficam fora por padrão; \"Incluir sessões de robôs\", no cartão à esquerda, os traz.", "Left out by default; \"Include robot sessions\", in the card on the left, brings them in.") },
        { rotulo: t("Frames.", "Frames."), texto: t("São partes da página que os contém, não passos: o fluxo mostra só as trocas reais de página, o painel da página lista o que ela carrega em frames e os erros do que só existe como frame contam nela. A página que carregou dentro de outra na maior parte das vezes nas últimas 24 horas também conta como frame, mesmo nas cargas em que o navegador não a marca assim, e a navegação que sai dela sai da página que a contém. A Visão geral conta do mesmo jeito: o frame não é página visitada, passo de fluxo ou de funil nem fim de sessão, e o erro dele conta na página que o contém. \"Mostrar frames das páginas\" mostra cada frame como passo.", "They are parts of the page that contains them, not steps: the flow shows only real page changes, the page panel lists what it loads in frames, and errors of what exists only as a frame count on that page. A page that loaded inside another page most of the time in the last 24 hours also counts as a frame, even in the loads the browser does not mark that way, and navigation leaving it leaves from the page that contains it. The Overview counts the same way: a frame is not a visited page, a flow or funnel step or a session end, and its errors count on the page that contains it. \"Show page frames\" shows each frame as a step.") },
      ]} />
      <Nota tipo="atencao">{t("Com filtro de segmento, robôs ou frames, a tela lê os dados do período sob demanda, com custo de consulta maior, e o período vai no máximo até a última hora (aparece \"com filtro: última hora\" ao lado do seletor). Limpar os filtros volta à leitura padrão e ao período escolhido.", "With a segment filter, robots or frames, the screen reads the timeframe's data on demand, at a higher query cost, and the timeframe goes up to the last hour at most (\"with filter: last hour\" shows next to the selector). Clearing the filters goes back to the default read and to the chosen timeframe.")}</Nota>
      <Sub>{t("Atalhos para as telas nativas", "Shortcuts to the native screens")}</Sub>
      <Par>{t("Cada atalho abre a tela nativa do Dynatrace já filtrada.", "Each shortcut opens the native Dynatrace screen already filtered.")}</Par>
      <Tabela cabecalho={[t("Atalho", "Shortcut"), t("Onde fica", "Where it is"), t("Abre", "Opens")]} linhas={[
        [<Cod>{t("Ver topologia", "View topology")}</Cod>, t("Menu do nó", "Node menu"), "Smartscape"],
        [<><Cod>{t("Ver erros", "See errors")}</Cod>{t(" e o nome do erro", " and the error name")}</>, t("Painel da página", "Page panel"), "Error Inspector"],
        [<Cod>{t("Abrir trace", "Open trace")}</Cod>, t("Abas Erros e Traces", "Errors and Traces tabs"), "Distributed Tracing"],
        [<><Cod>{t("Sessão", "Session")}</Cod>{t(" e ", " and ")}<Cod>Replay</Cod></>, t("Painel da página e \"Por quê?\"", "Page panel and \"Why?\""), t("Users & Sessions, com o replay quando foi gravado", "Users & Sessions, with the replay when it was recorded")],
        [<><Cod>{t("Ver um trace com falha", "See a failing trace")}</Cod>{t(" e ", " and ")}<Cod>{t("Ver o serviço", "See the service")}</Cod></>, t("Onde falha no backend?", "Where does it fail in the backend?"), t("Distributed Tracing e a tela do serviço", "Distributed Tracing and the service screen")],
        [<Cod>{t("Abrir no Dynatrace", "Open in Dynatrace")}</Cod>, t("Painel do serviço ou banco", "Service or database panel"), t("A tela do serviço", "The service screen")],
      ]} />
      <Nota tipo="dica">{t("O botão Replay fica cinza quando o replay está desligado na aplicação; a dica diz o motivo.", "The Replay button is gray when replay is off on the application; its tooltip says why.")}</Nota>
    </Secao>
  </Doc>
);
