/* Sub-aba "Sobre" da aba Documentação, manual enxuto (1.45), em quatro abas: O que é (o app, onde fica cada coisa,
   idioma e tema), De onde vêm os dados, Segurança e dados e Versão e novidades (versão, id e tenant lidos do SDK da
   plataforma, as três últimas versões e o autor). O detalhe técnico (consultas, fontes por tela, App State, retenção,
   histórico de versões) fica no código e em docs/ do repositório. Genérica: vale para qualquer
   tenant. Montada só com as peças de ./Kit. */
import React from "react";
import { getAppId, getAppVersion, getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { AiIcon, AppsIcon, DatabaseIcon, FlowIcon, GrailIcon, HomeIcon, InformationIcon, LineChartIcon, LockIcon, PathIcon, SmartscapeIcon, StorageIcon, UserEventsIcon, ViewOffIcon, WorkflowSimpleIcon } from "@dynatrace/strato-icons";
import { t } from "../../lib/i18n";
import { Doc, Secao, Par, Lista, Tabela, Nota, Figura, Cod, Sub, Cartoes } from "./Kit";

const I = 16;

/** Leitura segura do SDK: fora da plataforma (prévia local, testes) as funções lançam; aí mostra "-". */
const seguro = (f: () => string) => { try { return f(); } catch { return "-"; } };

export const DocSobre: React.FC = () => (
  <Doc titulo={t("Sobre", "About")}
       resumo={t("O que é o Digital Experience Flow, de onde vêm os dados, como ele trata os dados do tenant e qual versão está instalada.",
                 "What Digital Experience Flow is, where the data comes from, how it handles the tenant's data and which version is installed.")}>

    <Secao id="o-que-e" titulo={t("O que é", "What it is")}>
      <Par>{t("O Digital Experience Flow é um app do Dynatrace que mostra como os clientes navegam pelas aplicações web e mobile: por onde entram, onde encontram erro, onde desistem e que backend cada página aciona.",
              "Digital Experience Flow is a Dynatrace app that shows how customers move through web and mobile applications: where they enter, where they hit errors, where they give up and which backend each page triggers.")}</Par>
      <Cartoes itens={[
        { icone: <HomeIcon size={I} />, titulo: t("Visão geral", "Overview"), texto: t("Como os clientes estão usando as aplicações, o que está afetando a experiência deles e o que fazer primeiro.", "How customers are using the applications, what is affecting their experience and what to do first.") },
        { icone: <FlowIcon size={I} />, titulo: "Flow", texto: t("O caminho entre as páginas e, à direita de cada uma, os serviços que ela chama, até os bancos de dados.", "The path between pages and, to the right of each one, the services it calls, down to the databases.") },
        { icone: <PathIcon size={I} />, titulo: t("Jornadas e funis", "Journeys and funnels"), texto: t("O negócio define jornadas, acompanha a conversão de cada passo e vê por que as sessões param.", "The business defines journeys, follows each step's conversion and sees why sessions stop.") },
        { icone: <AiIcon size={I} />, titulo: t("IA", "AI"), texto: t("O Dynatrace Assist analisa um problema e resume as oportunidades de melhoria; o relatório sai em PDF.", "Dynatrace Assist analyzes a problem and sums up the improvement opportunities; the report comes out as a PDF.") },
      ]} />
      <Sub>{t("Onde fica cada coisa", "Where everything is")}</Sub>
      <Lista itens={[
        { rotulo: t("Visão geral e Flow.", "Overview and Flow."), texto: t("As duas telas de dados, nas abas do cabeçalho. Cada item da Visão geral abre o Flow no ponto certo.", "The two data screens, in the header tabs. Each Overview item opens the Flow at the right spot.") },
        { rotulo: t("Barra comum.", "Common toolbar."), texto: t("Aplicação, filtro, período e Atualizar valem para as duas telas.", "Application, filter, timeframe and Refresh apply to both screens.") },
        { rotulo: t("Engrenagem.", "Gear."), texto: t("A Configuração, só para administradores (sub-aba Pré-requisitos).", "The Configuration, administrators only (Prerequisites sub-tab).") },
      ]} />
      <Sub>{t("Idioma e tema", "Language and theme")}</Sub>
      <Lista itens={[
        { rotulo: "PT | EN.", texto: t("O seletor no cabeçalho troca toda a interface, inclusive esta documentação; a escolha fica salva neste navegador.", "The selector in the header switches the whole interface, including this documentation; the choice is kept in this browser.") },
        { rotulo: t("Tema.", "Theme."), texto: t("O app segue o tema claro ou escuro do Dynatrace.", "The app follows the Dynatrace light or dark theme.") },
      ]} />
      <Figura id="visao-geral" legenda={t("A Visão geral, com as aplicações do laboratório.", "The Overview, with the lab's applications.")} />
    </Secao>

    <Secao id="dados" titulo={t("De onde vêm os dados", "Where the data comes from")}>
      <Par>{t("Tudo o que o app mostra é lido do próprio tenant, de quatro fontes:", "Everything the app shows is read from the tenant itself, from four sources:")}</Par>
      <Cartoes itens={[
        { icone: <UserEventsIcon size={I} />, titulo: t("RUM no Grail", "RUM on Grail"), texto: t("As sessões das aplicações habilitadas. Uma regra do OpenPipeline separa uma cópia enxuta delas, que é a base de tudo.", "The sessions of the enabled applications. An OpenPipeline rule sets aside a lean copy of them, which is the basis of everything.") },
        { icone: <WorkflowSimpleIcon size={I} />, titulo: t("Agregados", "Aggregates"), texto: t("Um único workflow, a cada 5 minutos, resume a cópia: números por página, erros com exemplos, sessões da última hora e a análise de hora em hora.", "A single workflow, every 5 minutes, sums up the copy: numbers per page, errors with examples, last-hour sessions and the hourly analysis.") },
        { icone: <LineChartIcon size={I} />, titulo: t("Métricas nativas", "Native metrics"), texto: t("Requisições, falhas e tempo de resposta dos serviços, Web Vitals e o Apdex que o ambiente já calcula.", "Service requests, failures and response time, Web Vitals and the Apdex the environment already calculates.") },
        { icone: <SmartscapeIcon size={I} />, titulo: t("Modelo de entidades", "Entity model"), texto: t("Quem chama quem no backend e o nome dos serviços, o mesmo modelo do Smartscape.", "Who calls whom in the backend and the service names, the same model as Smartscape.") },
      ]} />
      <Nota>{t("O app não cria métricas próprias e não tem banco nem servidor. Toda leitura roda com a identidade e as permissões de quem está usando: cada pessoa só vê o que já pode ler no Grail.",
               "The app creates no custom metrics and has no database or server of its own. Every read runs with the identity and permissions of the person using it: each person only sees what they can already read in Grail.")}</Nota>
      <Figura id="flow-grafo" legenda={t("O Flow do laboratório: as páginas vêm do RUM; o backend, à direita, do modelo de entidades e das métricas nativas.", "The lab's Flow: the pages come from RUM; the backend, on the right, from the entity model and the native metrics.")} />
    </Secao>

    <Secao id="seguranca" titulo={t("Segurança e dados", "Security and data")}>
      <Cartoes itens={[
        { icone: <DatabaseIcon size={I} />, titulo: t("O que o app grava", "What the app writes"), texto: t("Só o que um administrador aplica na Configuração e o que o workflow grava, com o prefixo do app. Nenhuma regra existente muda. A lista está em Pré-requisitos, aba O que é criado.", "Only what an administrator applies in the Configuration and what the workflow writes, with the app prefix. No existing rule changes. The list is in Prerequisites, What is created tab.") },
        { icone: <StorageIcon size={I} />, titulo: t("O que fica no App State", "What stays in App State"), texto: t("O armazenamento da plataforma reservado ao app: jornadas, cache compartilhado das consultas, sessões da última hora, horas já analisadas, preços do cartão de consumo, o id das aplicações mobile, os frames das últimas 24 horas e análises de IA.", "The platform storage reserved to the app: journeys, shared query cache, last-hour sessions, hours already analyzed, consumption card prices, the mobile applications' ids, the frames of the last 24 hours and AI analyses.") },
        { icone: <ViewOffIcon size={I} />, titulo: t("Dados sensíveis", "Sensitive data"), texto: t("A cópia não leva quem navega: nada de nome, login, e-mail ou IP. Todo texto enviado à IA passa antes por uma máscara de documentos, cartões, telefones, e-mails, IPs e tokens.", "The copy does not carry who browses: no name, login, e-mail or IP. All text sent to AI first goes through a mask for tax ids, cards, phones, e-mails, IPs and tokens.") },
        { icone: <LockIcon size={I} />, titulo: t("Acesso por política IAM", "Access by IAM policy"), texto: t("Quem abre o app, quem configura e quem usa a IA é decidido pela política de acesso da conta (Pré-requisitos, aba Permissões).", "Who opens the app, who configures it and who uses AI is decided by the account's access policy (Prerequisites, Permissions tab).") },
      ]} />
      <Nota>{t("Nada sai do tenant por iniciativa do app. Só a análise do Dynatrace Assist e a por LLM (para usuários liberados) enviam dados, já mascarados, e só quando alguém pede.",
               "Nothing leaves the tenant on the app's initiative. Only the Dynatrace Assist analysis and the LLM one (for allowed users) send data, already masked, and only when someone asks.")}</Nota>
      <Nota tipo="atencao">{t("Mensagens de erro e caminhos de URL chegam como o RUM os recebe. Se as aplicações põem dados pessoais nesses campos, faça uma revisão de segurança e mascare-os no OpenPipeline antes de habilitá-las.",
               "Error messages and URL paths arrive as RUM receives them. If the applications put personal data in those fields, run a security review and mask them in OpenPipeline before enabling them.")}</Nota>
    </Secao>

    <Secao id="versao" titulo={t("Versão e novidades", "Version and what's new")}>
      <Cartoes itens={[
        { icone: <InformationIcon size={I} />, titulo: t("Versão", "Version"), texto: <Cod>{seguro(getAppVersion)}</Cod>, rodape: t("Do pacote instalado.", "Of the installed package.") },
        { icone: <AppsIcon size={I} />, titulo: t("Id do app", "App id"), texto: <Cod>{seguro(getAppId)}</Cod>, rodape: t("Identifica o app na plataforma.", "Identifies the app on the platform.") },
        { icone: <GrailIcon size={I} />, titulo: "Tenant", texto: <Cod>{seguro(getEnvironmentId)}</Cod>, rodape: t("Onde o app lê e grava tudo.", "Where the app reads and writes everything.") },
      ]} />
      <Par>{t("Os três valores são lidos da plataforma ao abrir esta aba; cite-os em pedidos de suporte. Esta documentação acompanha a versão instalada. O id ", "The three values are read from the platform when this tab opens; quote them in support requests. This documentation goes with the installed version. The id ")}<Cod>my.digital.experience.flow</Cod>{t(" é o que a política de acesso usa para liberar o app.", " is what the access policy uses to grant the app.")}</Par>
      <Sub>{t("O que há de novo", "What's new")}</Sub>
      <Tabela compacta cabecalho={[t("Versão", "Version"), t("Novidade", "What changed")]} linhas={[
        ["1.47.2", t("O resultado da análise estrutural fica do geral para o detalhe: o resumo em números (sessões por mês recuperáveis, causas comuns e por onde começar), as causas comuns em cartões, a ordem de ataque numa tabela com benefício e esforço, o plano de 30, 60 e 90 dias e cada oportunidade recolhida, com as evidências só quando alguém abre", "The structural analysis result goes from the overview to the detail: the summary in numbers (recoverable sessions per month, common causes and where to start), the common causes in cards, the order of attack in a table with benefit and effort, the 30, 60 and 90 day plan and each opportunity collapsed, with the evidence only when someone opens it")],
        ["1.46.3", t("\"Por quê?\" e \"Isolar\" em período maior que 1 hora: o veredito sai do funil das horas analisadas (com quem seguiu tendo erro na página anterior); \"Para onde foram\", as sessões e \"Isolar\" ficam na última hora, com o aviso", "\"Why?\" and \"Isolate\" in a timeframe longer than 1 hour: the verdict comes from the analyzed hours' funnel (with those who continued having an error on the previous page); \"Where they went\", the sessions and \"Isolate\" use the last hour, with a notice")],
        ["1.46.2",t("Correção da 1.46.1: as horas já analisadas voltam a valer, sem o workflow refazer as 24 horas", "Fix for 1.46.1: hours already analyzed count again, without the workflow redoing the 24 hours")],
        ["1.46.1", t("O grafo tira a origem das páginas abertas em aba nova ou dentro de frame dos totais de 5 minutos do workflow, sem reler a cópia do período a cada abertura (o período de 24 horas fica perto do custo do de 30 minutos); com filtro, robôs ou frames, o período vai no máximo até a última hora, com aviso ao lado do seletor", "The graph takes the origin of pages opened in a new tab or inside a frame from the workflow's 5-minute totals, without rereading the copy of the timeframe at each opening (the 24-hour timeframe costs close to the 30-minute one); with a filter, robots or frames, the timeframe goes up to the last hour at most, with a notice next to the selector")],
        ["1.46.0", t("Configuração › Atualização dos números: \"A cada 5 minutos\" faz erros, Apdex e o grafo irem até a última fatia gravada pelo workflow, sem ler a cópia ao vivo a cada abertura; \"Tempo real\" continua o padrão", "Configuration › How numbers update: \"Every 5 minutes\" makes errors, Apdex and the graph go up to the last slice written by the workflow, without reading the live copy at each opening; \"Real time\" remains the default")],
        ["1.45.12", t("O mouse sobre a linha do Apdex mostra o Apdex, a nota e o horário de cada intervalo", "Hovering over the Apdex line shows the Apdex, the score and the time of each interval")],
        ["1.45.11", t("A Visão geral fala a mesma língua do grafo nos frames: páginas mais visitadas, principais fluxos, funis, \"Por quê?\", lista de sessões e cartões de erro deixam de contar o frame como página, e o erro dele conta na página que o contém. As 24 horas já analisadas são refeitas uma vez, sem buraco na troca", "The Overview speaks the same language as the graph on frames: most visited pages, top flows, funnels, \"Why?\", the session list and error cards no longer count a frame as a page, and its errors count on the page that contains it. The 24 hours already analyzed are redone once, with no gap during the switch")],
        ["1.45.10", t("Frames reconhecidos também pelo comportamento: a página que carregou dentro de outra na maior parte das vezes nas últimas 24 horas deixa de ser passo, mesmo nas cargas que o navegador não marca como frame; some o leque de frames com abandono falso, e a navegação que saía do frame sai da página que o contém. As chamadas ao backend feitas de dentro do frame contam na página. Sem consulta nova: a lista sai da análise de hora em hora", "Frames also recognized by behavior: a page that loaded inside another page most of the time in the last 24 hours stops being a step, even in the loads the browser does not mark as a frame; the fan of frames with false drop-off is gone, and navigation that left from the frame leaves from the page that contains it. Backend calls made from inside the frame count on the page. No new query: the list comes from the hourly analysis")],
      ]} />
      <Sub>{t("Autor", "Author")}</Sub>
      <Par><b>Rodrigo Biaggio</b> · github.com/Rbiaggio</Par>
      <Par>{t("Os prints desta documentação são de um laboratório com aplicações de demonstração e tráfego simulado; os números deles não são de nenhum cliente.",
              "The screenshots in this documentation are from a lab with demo applications and simulated traffic; their numbers belong to no customer.")}</Par>
    </Secao>
  </Doc>
);
