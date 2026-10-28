/* Sub-aba "Pré-requisitos" da aba Documentação, manual enxuto (1.45), em quatro abas: Instalação (o que o ambiente
   precisa ter e os três passos), O que é criado, Permissões e Para ver tudo (o que precisa estar ligado e as
   limitações). O detalhe técnico (consultas, registros de controle, reprocessamento) fica na documentação técnica (código e docs/ do repositório). Genérica: vale para qualquer tenant. Montada só com as peças de ./Kit. */
import React from "react";
import { AccountIcon, AiIcon, GrailIcon, DatabaseIcon, FilterIcon, FlowIcon, KeyIcon, RepairIcon, UserEventsIcon, WorkflowSimpleIcon } from "@dynatrace/strato-icons";
import { t } from "../../lib/i18n";
import { Doc, Secao, Par, Lista, Tabela, Nota, Figura, Cod, Sub, Cartoes, Passos, Politica, Politicas } from "./Kit";

const I = 16;

export const DocPreRequisitos: React.FC = () => (
  <Doc titulo={t("Pré-requisitos", "Prerequisites")}
       resumo={t("O que o ambiente precisa ter, como instalar, o que o app cria no tenant e quem pode fazer o quê.",
                 "What the environment needs, how to install, what the app creates in the tenant and who can do what.")}>

    <Secao id="instalacao" titulo={t("Instalação", "Installation")}>
      <Sub>{t("O que o ambiente precisa ter", "What the environment needs")}</Sub>
      <Cartoes itens={[
        { icone: <GrailIcon size={I} />, titulo: t("AppEngine e Grail", "AppEngine and Grail"), texto: t("Dynatrace SaaS. O app roda no AppEngine e lê os dados do Grail.", "Dynatrace SaaS. The app runs on AppEngine and reads data from Grail.") },
        { icone: <UserEventsIcon size={I} />, titulo: t("RUM no Grail", "RUM on Grail"), texto: t("Nas aplicações que vão ser analisadas. É a fonte de tudo: navegações, erros, chamadas de API e experiência.", "On the applications to be analyzed. It is the source of everything: navigation, errors, API calls and experience.") },
        { icone: <FlowIcon size={I} />, titulo: "OpenPipeline", texto: t("Onde o app grava as regras que separam os dados de que ele precisa.", "Where the app writes the rules that set aside the data it needs.") },
      ]} />
      <Sub>{t("Três passos", "Three steps")}</Sub>
      <Passos itens={[
        { titulo: t("Instalar o app", "Install the app"), texto: t("No ambiente, como qualquer app do AppEngine.", "In the environment, like any AppEngine app.") },
        { titulo: t("Aplicar a configuração", "Apply the configuration"), texto: t("Na Configuração (engrenagem no alto, só para administradores), marcar as aplicações e clicar em \"Aplicar configuração\". A lista acima do botão diz o que será criado ou configurado.", "In the Configuration (gear at the top, administrators only), select the applications and click \"Apply configuration\". The list above the button says what will be created or configured.") },
        { titulo: t("Criar o workflow", "Create the workflow"), texto: t("Clicar em \"Criar o workflow\": o app abre o app Workflows já preenchido; é só salvar. Até a primeira execução, o cartão do workflow mostra \"aguardando a primeira execução\".", "Click \"Create the workflow\": the app opens the Workflows app already filled in; just save it. Until the first run, the workflow card shows \"waiting for the first run\".") },
      ]} />
      <Nota tipo="dica">{t("Em até 10 minutos os primeiros números aparecem. Fluxos, páginas mais visitadas e funis, que somam as últimas 24 horas, completam ao longo do primeiro dia.", "The first numbers show up within 10 minutes. Flows, most visited pages and funnels, which add up the last 24 hours, fill in over the first day.")}</Nota>
      <Par>{t("Em \"Atualização dos números\", o administrador escolhe para todos os usuários: \"Tempo real\" (padrão), em que erros, Apdex e os números do grafo vão até agora, ou \"A cada 5 minutos\", em que vão até a última fatia gravada pelo workflow e cada abertura lê menos. O workflow é o mesmo nos dois.", "In \"How numbers update\", the administrator chooses for all users: \"Real time\" (default), where errors, Apdex and the graph numbers go up to now, or \"Every 5 minutes\", where they go up to the last slice written by the workflow and each opening reads less. The workflow is the same in both.")}</Par>
      <Figura id="configuracao" legenda={t("A tela de Configuração: a situação no alto, as aplicações, o Aplicar, o workflow, a atualização dos números e o consumo do app.", "The Configuration screen: the status at the top, the applications, Apply, the workflow, how numbers update and the app consumption.")} />
    </Secao>

    <Secao id="criado" titulo={t("O que é criado", "What is created")}>
      <Par>{t("Tudo o que o app grava no tenant, com o prefixo do app no nome:", "Everything the app writes to the tenant, with the app prefix in the name:")}</Par>
      <Cartoes itens={[
        { icone: <FilterIcon size={I} />, titulo: t("2 regras de extração", "2 extraction rules"), texto: t("No pipeline de user.events que já recebe as aplicações (ou num pipeline próprio, quando nenhum recebe). Separam uma cópia enxuta das sessões.", "In the user.events pipeline that already receives the applications (or in an own pipeline, when none does). They set aside a lean copy of the sessions.") },
        { icone: <DatabaseIcon size={I} />, titulo: t("7 buckets", "7 buckets"), texto: <>{t("A cópia das sessões (1 dia), os agregados e os erros com exemplos (8 dias) e a análise de hora em hora (3 dias), com o prefixo ", "The session copy (1 day), the aggregates and the errors with examples (8 days) and the hourly analysis (3 days), prefixed ")}<Cod>rum_flow_</Cod>.</> },
        { icone: <FlowIcon size={I} />, titulo: t("1 pipeline de business events", "1 business events pipeline"), texto: t("Com a rota dele, leva cada dado do app ao seu bucket.", "With its route, it takes each piece of app data to its bucket.") },
        { icone: <WorkflowSimpleIcon size={I} />, titulo: t("1 workflow simples", "1 simple workflow"), texto: t("A cada 5 minutos, grava os agregados, as sessões da última hora e a análise de hora em hora. Não paga a hora de workflow.", "Every 5 minutes, it writes the aggregates, the last-hour sessions and the hourly analysis. It does not pay the workflow hour.") },
      ]} />
      <Nota>{t("Nada do que já existe no ambiente muda: o app confere o pipeline antes de gravar e recusa se alguma regra existente mudaria. O app não cria métricas e não grava em spans, logs ou serviços. Desmarcar todas as aplicações e aplicar tira as regras; os buckets ficam vazios e não custam nada sem dado.", "Nothing that already exists in the environment changes: the app checks the pipeline before writing and refuses if any existing rule would change. The app creates no metrics and writes nothing to spans, logs or services. Clearing all applications and applying removes the rules; the buckets stay empty and cost nothing without data.")}</Nota>
    </Secao>

    <Secao id="permissoes" titulo={t("Permissões", "Permissions")}>
      <Par>{t("Cada perfil vira uma política IAM ligada a um grupo com escopo no ambiente (Account Management > Identity & access management).", "Each profile becomes an IAM policy attached to a group scoped to the environment (Account Management > Identity & access management).")}</Par>
      <Politicas>
        <Politica icone={<AccountIcon size={I} />} perfil={t("Quem usa o app", "App users")} descricao={t("Analistas, negócio e operação.", "Analysts, business and operations.")} linhas={[
          'ALLOW app-engine:apps:run WHERE shared:app-id IN ("my.digital.experience.flow", "dynatrace.launcher");',
          "ALLOW storage:buckets:read;", "ALLOW storage:bizevents:read;", "ALLOW storage:user.events:read;", "ALLOW storage:spans:read;",
          "ALLOW storage:metrics:read;", "ALLOW storage:entities:read;", "ALLOW storage:events:read;",
          "ALLOW state:app-states:read;", "ALLOW state:app-states:write;", "ALLOW settings:objects:read;", "ALLOW settings:schemas:read;",
        ]} />
        <Politica icone={<RepairIcon size={I} />} perfil={t("Quem configura", "Administrators")} descricao={t("Além da de quem usa.", "Besides the app users one.")} linhas={[
          "ALLOW settings:objects:write;", "ALLOW openpipeline:configurations:read;", "ALLOW openpipeline:configurations:write;",
          "ALLOW storage:bucket-definitions:read;", "ALLOW storage:bucket-definitions:write;", "ALLOW storage:system:read;", "ALLOW automation:workflows:read;",
        ]} extra={t("E permissão para criar workflows no app Workflows.", "And permission to create workflows in the Workflows app.")} />
        <Politica icone={<AiIcon size={I} />} perfil={t("Quem usa a IA", "AI users")} descricao={t("A análise de um problema pelo Dynatrace Assist.", "Analyzing a problem with Dynatrace Assist.")} linhas={[
          'ALLOW app-engine:apps:run WHERE shared:app-id = "dynatrace.davis.copilot";',
          "ALLOW davis-copilot:conversations:execute;", "ALLOW davis-copilot:nl2dql:execute;", "ALLOW davis-copilot:dql2nl:execute;",
        ]} />
        <Politica icone={<KeyIcon size={I} />} perfil={t("Dono do workflow", "Workflow owner")} descricao={t("Quem salva o workflow. Além da de quem usa; o workflow roda com as permissões dessa pessoa.", "Whoever saves the workflow. Besides the app users one; the workflow runs with that person's permissions.")} linhas={[
          "ALLOW storage:events:write;",
        ]} />
      </Politicas>
      <Nota>{t("A análise por LLM não depende de política: só usuários liberados na configuração do LLM a pedem.", "The LLM analysis does not depend on a policy: only users allowed in the LLM configuration request it.")}</Nota>
    </Secao>

    <Secao id="ver-tudo" titulo={t("Para ver tudo", "To see everything")}>
      <Par>{t("O app mostra o que o monitoramento entrega. Quando falta algo, o bloco \"Para ver o fluxo completo\" diz o efeito, a correção e quem faz.", "The app shows what the monitoring delivers. When something is missing, the \"To see the whole flow\" block says the effect, the fix and who does it.")}</Par>
      <Tabela cabecalho={[t("Recurso do monitoramento", "Monitoring feature"), t("O que depende dele", "What depends on it")]} linhas={[
        [t("Web Vitals e a métrica de Apdex de Web Vitals do ambiente", "Web Vitals and the environment's Web Vitals Apdex metric"), t("A nota de experiência das páginas web.", "The web pages' experience score.")],
        [t("Propagação de trace nas chamadas de API, também entre domínios", "Trace propagation on API calls, also across domains"), t("A ligação página → serviço e os traces de exemplo.", "The page → service link and the example traces.")],
        [t("Nome em cada tela do app mobile", "A name on each mobile app screen"), t("O fluxo das sessões mobile.", "The mobile sessions' flow.")],
        [t("Monitoramento híbrido (WebView no app nativo)", "Hybrid monitoring (WebView in the native app)"), t("A página da WebView ligada à tela que a abriu. Quando ele está desligado, \"Para ver o fluxo completo\" avisa e diz a situação do Android e do iOS.", "The WebView page linked to the screen that opened it. When it is off, \"To see the whole flow\" warns and says the Android and iOS status.")],
        [t("Session Replay na aplicação", "Session Replay on the application"), t("O botão Replay nas listas de sessões.", "The Replay button in the session lists.")],
        [t("Acesso pela internet (IP público)", "Internet access (public IP)"), t("Os mapas de onde estão os clientes e os erros.", "The maps of where customers and errors are.")],
        [t("Backend instrumentado (OneAgent ou OpenTelemetry)", "Instrumented backend (OneAgent or OpenTelemetry)"), t("O caminho entre os serviços.", "The path between services.")],
      ]} />
      <Figura id="fluxo-completo" legenda={t("O bloco \"Para ver o fluxo completo\", com o ajuste e quem faz.", "The \"To see the whole flow\" block, with the fix and who does it.")} />
      <Sub>{t("Limitações", "Limitations")}</Sub>
      <Lista itens={[
        { rotulo: t("Bases de tempo.", "Time bases."), texto: t("Erros, Apdex e os números do grafo são do período escolhido; indicadores de sessão e mapas, da última hora; fluxos, páginas e funis, das últimas 24 horas. A legenda no alto da Visão geral diz de quando é cada parte.", "Errors, Apdex and the graph numbers are from the chosen timeframe; session indicators and maps, from the last hour; flows, pages and funnels, from the last 24 hours. The legend at the top of the Overview says when each part is from.") },
        { rotulo: t("Erros por ocorrência.", "Errors by occurrence."), texto: t("A lista de erros conta ocorrências; quem foi afetado aparece nos exemplos e na lista de sessões com erro.", "The error list counts occurrences; who was affected shows in the examples and in the list of sessions with errors.") },
        { rotulo: t("Hora corrente.", "Current hour."), texto: t("Uma página nova entra nos fluxos e nas páginas mais visitadas depois que a hora dela é analisada; o grafo e os números ao vivo já a mostram.", "A new page enters the flows and the most visited pages after its hour is analyzed; the graph and the live numbers already show it.") },
        { rotulo: t("p75 aproximado.", "Approximate p75."), texto: t("O p75 do tempo de carga das 24 horas sai de faixas de tempo, e a tela mostra \"p75 ≈\".", "The 24-hour load time p75 comes from time bands, and the screen shows \"p75 ≈\".") },
        { rotulo: t("Segmento, robôs e frames.", "Segment, robots and frames."), texto: t("Com esses filtros a tela lê os dados do período sob demanda, com custo de consulta maior; o resultado fica guardado por 5 minutos.", "With these filters the screen reads the timeframe's data on demand, at a higher query cost; the result is kept for 5 minutes.") },
      ]} />
    </Secao>
  </Doc>
);
