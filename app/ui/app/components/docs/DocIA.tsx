/* Sub-aba "IA" da aba Documentação, manual enxuto (1.45), em cinco abas: Onde aparece (os botões do app), Dynatrace
   Assist (a análise de um problema e o resumo), Análise por LLM (quem pede, aceite, coleta e custo), Resultado da
   do LLM e Privacidade. O detalhe
   técnico (campos do pedido, bases de tempo por campo, dossiê, limites internos, mensagens de erro) fica na documentação técnica (código e docs/ do repositório). Genérica: vale para qualquer tenant. Montada só com as peças de ./Kit. */
import React from "react";
import { AccountIcon, AiIcon, AnalyticsIcon, CalendarIcon, CheckmarkIcon, DocumentIcon, DownloadIcon, LockIcon, RepairIcon, SupportIcon, ViewOffIcon } from "@dynatrace/strato-icons";
import { t } from "../../lib/i18n";
import { Doc, Secao, Par, Lista, Tabela, Nota, Figura, Cod, Sub, Cartoes, Passos } from "./Kit";

const I = 16;

export const DocIA: React.FC = () => (
  <Doc titulo={t("Inteligência artificial", "Artificial intelligence")}
       resumo={t("Duas análises por IA, sempre a pedido de quem usa: o Dynatrace Assist, dentro do Dynatrace, e a análise estrutural por LLM. O que cada uma faz, o que envia e o que nunca sai do ambiente.",
                 "Two AI analyses, always at the user's request: Dynatrace Assist, inside Dynatrace, and the structural LLM analysis. What each one does, what it sends and what never leaves the environment.")}>

    <Secao id="ia-onde" titulo={t("Onde aparece", "Where it shows up")}>
      <Par>{t("Nenhuma análise roda sozinha: cada uma começa por um clique e lê o ambiente com a identidade de quem clicou. A IA entra depois dos números, nunca no lugar deles.", "No analysis runs on its own: each one starts with a click and reads the environment with the identity of whoever clicked. AI comes after the numbers, never instead of them.")}</Par>
      <Cartoes itens={[
        { icone: <AiIcon size={I} />, titulo: "Dynatrace Assist", texto: t("\"Analisar com o Dynatrace Assist\", nos cartões de \"O que está afetando os clientes\" e nas oportunidades: análise do problema, causa raiz e ações para correção.", "\"Analyze with Dynatrace Assist\", on the \"What is affecting customers\" cards and on the opportunities: problem analysis, root cause and corrective actions.") },
        { icone: <DocumentIcon size={I} />, titulo: t("Resumo do Assist", "Assist summary"), texto: t("\"Resumo do Dynatrace Assist\", no rodapé das oportunidades: um parágrafo sobre o que mais custa ao cliente e o que fazer primeiro.", "\"Dynatrace Assist summary\", in the opportunities footer: one paragraph on what costs customers the most and what to do first.") },
        { icone: <SupportIcon size={I} />, titulo: t("Análise por LLM", "LLM analysis"), texto: t("\"Analisar com LLM\", no rodapé das oportunidades, só para usuários liberados: causa raiz estrutural e plano em ondas.", "\"Analyze with an LLM\", in the opportunities footer, for allowed users only: structural root cause and a plan in waves.") },
        { icone: <DownloadIcon size={I} />, titulo: t("Relatório em PDF", "PDF report"), texto: t("\"Gerar relatório\", no rodapé das oportunidades, para todos: o que a tela já avaliou, sem IA e sem consulta nova.", "\"Generate report\", in the opportunities footer, for everyone: what the screen already evaluated, with no AI and no new query.") },
      ]} />
      <Figura id="oportunidades" legenda={t("Oportunidades de melhoria: as três que mais pesam, as demais na lista e, no rodapé, \"Gerar relatório\" e \"Analisar com LLM\".", "Improvement opportunities: the three that weigh the most, the others in the list and, in the footer, \"Generate report\" and \"Analyze with an LLM\".")} />
    </Secao>

    <Secao id="ia-assist" titulo="Dynatrace Assist">
      <Par>{t("A IA generativa da Dynatrace analisa um problema a partir do que o app já mediu. Roda dentro da plataforma, em nome de quem clicou e com a permissão de IA da própria Dynatrace.", "Dynatrace generative AI analyzes a problem from what the app already measured. It runs inside the platform, on behalf of whoever clicked and with Dynatrace's own AI permission.")}</Par>
      <Sub>{t("Como funciona", "How it works")}</Sub>
      <Passos itens={[
        { titulo: t("Clicar no botão", "Click the button"), texto: t("\"Analisar com o Dynatrace Assist\" abre o painel no próprio cartão. Se o cenário já foi analisado nas últimas 24 horas, a análise aparece na hora, com o selo \"pronta\".", "\"Analyze with Dynatrace Assist\" opens the panel inside the card. If the scenario was already analyzed in the last 24 hours, the analysis shows right away, with the \"ready\" badge.") },
        { titulo: t("O app junta as evidências", "The app gathers the evidence"), texto: t("Com a sua identidade: os números da tela e o que o ambiente já tem sobre o problema (traces, exceções, problemas do Davis e mudanças).", "With your identity: the on-screen numbers and what the environment already has about the problem (traces, exceptions, Davis problems and changes).") },
        { titulo: t("O Dynatrace Assist escreve", "Dynatrace Assist writes"), texto: t("Em geral em menos de 1 minuto, em três partes: Análise do problema, Causa raiz e Ações para correção. Fechar o painel não interrompe.", "Usually in under a minute, in three parts: Problem analysis, Root cause and Corrective actions. Closing the panel does not stop it.") },
      ]} />
      <Sub>{t("O que é enviado", "What is sent")}</Sub>
      <Lista itens={[
        { rotulo: t("Só o que já está no ambiente.", "Only what is already in the environment."), texto: t("Os números da tela e as evidências lidas no ambiente. A IA não recebe mais nada.", "The on-screen numbers and the evidence read in the environment. AI receives nothing else.") },
        { rotulo: t("Mascarado.", "Masked."), texto: <>{t("Todo texto passa pela máscara do app: CPF, CNPJ, e-mail, IP, tokens e identificadores viram marcadores como ", "All text goes through the app's mask: CPF, CNPJ, e-mail, IP, tokens and identifiers become markers such as ")}<Cod>[cpf]</Cod>{t(" e ", " and ")}<Cod>[id]</Cod>{t(". O corpo de resposta do servidor nunca vai.", ". The server response body never goes.")}</> },
        { rotulo: t("Com o período de cada número.", "With each number's period."), texto: t("O pedido diz de quando é cada número (o período escolhido ou as últimas 24 horas analisadas).", "The request states when each number is from (the chosen timeframe or the last 24 analyzed hours).") },
      ]} />
      <Sub>{t("Depois de pronta", "Once ready")}</Sub>
      <Lista itens={[
        { rotulo: t("Uma por cenário, por 24 horas.", "One per scenario, for 24 hours."), texto: t("Cenário é a página com o erro principal. A análise fica guardada para todos com acesso, com quem gerou, quando e \"dados de <período>\".", "A scenario is the page with its main error. The analysis is kept for everyone with access, with who generated it, when and \"data from <timeframe>\".") },
        { rotulo: t("\"Exportar PDF\".", "\"Export PDF\"."), texto: t("Gerado no navegador, com o aviso \"Confira antes de agir\".", "Generated in the browser, with the \"Verify before acting\" notice.") },
        { rotulo: t("\"Investigar mais no Dynatrace Assist\".", "\"Investigate further in Dynatrace Assist\"."), texto: t("Abre o chat do Dynatrace Assist com a mesma pergunta e os números da tela, para continuar a conversa.", "Opens the Dynatrace Assist chat with the same question and the on-screen numbers, to continue the conversation.") },
        { rotulo: t("\"Resumo do Dynatrace Assist\".", "\"Dynatrace Assist summary\"."), texto: t("Usa só o que a tela já mostra, mascarado. Um por escopo, pronto para todos por 24 horas, e entra no PDF de \"Gerar relatório\".", "Uses only what the screen already shows, masked. One per scope, ready for everyone for 24 hours, and it goes into the \"Generate report\" PDF.") },
      ]} />
      <Nota>{t("Os botões aparecem para quem tem a permissão de IA generativa (davis-copilot) e com a IA generativa ligada no ambiente. Cada análise nova consome AI Units da Dynatrace; abrir uma pronta não consome. A política está em Pré-requisitos e o custo, em Custos.", "The buttons show for whoever has the generative AI permission (davis-copilot) and with generative AI enabled in the environment. Each new analysis consumes Dynatrace AI Units; opening a ready one does not. The policy is in Prerequisites and the cost in Costs.")}</Nota>
    </Secao>

    <Secao id="ia-llm" titulo={t("Análise por LLM", "LLM analysis")}>
      <Par>{t("\"Analisar com LLM\" pede uma análise estrutural de causa raiz das oportunidades de melhoria, feita por um LLM configurado no app fora do ambiente Dynatrace. Leva cerca de 3 minutos.", "\"Analyze with an LLM\" requests a structural root cause analysis of the improvement opportunities, made by an LLM configured in the app outside the Dynatrace environment. It takes about 3 minutes.")}</Par>
      <Nota tipo="atencao">{t("Só usuários liberados na configuração do LLM pedem a análise. A regra vale no servidor e nenhuma política de acesso a libera para outros e-mails; para os demais, o botão e a análise guardada não aparecem.", "Only users allowed in the LLM configuration request the analysis. The rule applies on the server and no access policy opens it to other e-mails; for everyone else, neither the button nor the stored analysis shows.")}</Nota>
      <Sub>{t("Como funciona", "How it works")}</Sub>
      <Passos itens={[
        { titulo: t("Aceite", "Consent"), texto: t("A janela mostra as oportunidades (as primeiras da lista, até 8), o que será lido e enviado e o que não sai. Nada é lido antes do aceite e de \"Coletar e pedir a análise\".", "The window shows the opportunities (the first ones in the list, up to 8), what will be read and sent and what never leaves. Nothing is read before the consent and \"Collect and request the analysis\".") },
        { titulo: t("Coleta", "Collection"), texto: t("Com a sua identidade, um dossiê de evidências por oportunidade: amostra de traces, métricas, Davis, deploys, RUM e números de negócio. Sanitizado e verificado duas vezes, no navegador e na função do app.", "With your identity, one evidence dossier per opportunity: a trace sample, metrics, Davis, deployments, RUM and business numbers. Sanitized and checked twice, in the browser and in the app function.") },
        { titulo: t("Análise", "Analysis"), texto: t("O LLM analisa as oportunidades em paralelo e depois monta a síntese. Se a janela fechar, o que terminou fica guardado e \"Continuar a análise\" roda só o que falta.", "The LLM analyzes the opportunities in parallel and then builds the synthesis. If the window closes, what finished is kept and \"Continue the analysis\" runs only what is missing.") },
      ]} />
      <Figura id="llm-aceite" legenda={t("A janela de aceite, aqui com quatro oportunidades.", "The consent window, here with four opportunities.")} />
      <Sub>{t("Leitura e custo", "Reading and cost")}</Sub>
      <Lista itens={[
        { rotulo: t("Leitura com orçamento.", "Reading with a budget."), texto: t("A coleta mede os bytes lidos no Grail e mostra o custo pelo preço de consulta em uso (Configuração › Consumo do app). Num ambiente grande, cerca de 455 GiB por análise; o teto é 1.200 GiB.", "The collection measures the bytes read in Grail and shows the cost at the query price in use (Configuration › App consumption). In a large environment, about 455 GiB per analysis; the ceiling is 1,200 GiB.") },
        { rotulo: t("O modelo é cobrado pelo provedor do LLM.", "The model is billed by the LLM provider."), texto: t("O ambiente paga só a leitura das evidências.", "The environment pays only for reading the evidence.") },
      ]} />
      <Figura id="llm-progresso" legenda={t("Em andamento: as evidências lidas (consultas, MB e custo) e as oportunidades analisadas em paralelo.", "In progress: the evidence read (queries, MB and cost) and the opportunities analyzed in parallel.")} />
    </Secao>

    <Secao id="ia-llm-resultado" titulo={t("Resultado do LLM", "LLM result")}>
      <Par>{t("A janela mostra a análise pronta do geral para o detalhe; o PDF traz as mesmas partes:", "The window shows the ready analysis from the overview to the detail; the PDF has the same parts:")}</Par>
      <Cartoes itens={[
        { icone: <AnalyticsIcon size={I} />, titulo: t("Resumo e causas comuns", "Summary and common causes"), texto: t("Em números: sessões por mês recuperáveis (a soma das oportunidades com medida), quantas causas comuns e por onde começar. Cada causa comum num cartão, com as oportunidades que explica, a confiança, o impacto e o que fazer; as evidências abrem sob demanda.", "In numbers: recoverable sessions per month (the sum of the opportunities with a measure), how many common causes and where to start. Each common cause in a card, with the opportunities it explains, the confidence, the impact and what to do; the evidence opens on demand.") },
        { icone: <CalendarIcon size={I} />, titulo: t("Por onde começar e plano", "Where to start and plan"), texto: t("A ordem de ataque numa tabela, com benefício, esforço e o motivo, e o plano de 30, 60 e 90 dias, com o indicador do app que prova o ganho.", "The order of attack in a table, with benefit, effort and the reason, and the 30, 60 and 90 day plan, with the app indicator that proves the gain.") },
        { icone: <RepairIcon size={I} />, titulo: t("Cada oportunidade", "Each opportunity"), texto: t("Recolhida, com o esforço no título. Aberta (a primeira da ordem já vem aberta), quatro campos curtos: problema, causa raiz com a confiança, correção rápida e benefício em sessões por mês; o detalhe completo (números, todas as soluções, a conta do benefício e a cadeia de evidências) abre num clique.", "Collapsed, with the effort in the title. Open (the first in the order comes open), four short fields: problem, root cause with the confidence, quick fix and benefit in sessions per month; the full detail (numbers, all solutions, the benefit math and the evidence chain) opens with one click.") },
        { icone: <SupportIcon size={I} />, titulo: t("Iniciativas", "Initiatives"), texto: t("\"Iniciativas recomendadas\": tipos de iniciativa (performance, SRE, instrumentação, jornadas) ligados às oportunidades, de um catálogo editável.", "\"Recommended initiatives\": initiative types (performance, SRE, instrumentation, journeys) tied to the opportunities, from an editable catalog.") },
      ]} />
      <Figura id="llm-resultado" legenda={t("Um resultado pronto, com o LLM simulado dos testes e as quatro oportunidades do laboratório: o resumo em números, as causas comuns, por onde começar, o plano, cada oportunidade e iniciativas recomendadas.", "A ready result, with the test's simulated LLM and four lab opportunities: the summary in numbers, the common causes, where to start, the plan, each opportunity and recommended initiatives.")} />
      <Nota>{t("A análise fica guardada no ambiente para os usuários liberados. Para compartilhar, \"Baixar PDF\", no alto da janela. \"O que foi enviado\" mostra os dossiês como saíram.", "The analysis stays stored in the environment for allowed users. To share it, \"Download PDF\", at the top of the window. \"What was sent\" shows the dossiers as they left.")}</Nota>
    </Secao>

    <Secao id="ia-privacidade" titulo={t("Privacidade", "Privacy")}>
      <Cartoes itens={[
        { icone: <AccountIcon size={I} />, titulo: t("Sua identidade", "Your identity"), texto: t("Tudo é lido com a identidade e as permissões de quem clicou. A chave do LLM fica só na função do app, nunca no navegador.", "Everything is read with the identity and permissions of whoever clicked. The LLM key stays only in the app function, never in the browser.") },
        { icone: <ViewOffIcon size={I} />, titulo: t("Máscara antes de sair", "Masking before leaving"), texto: t("Todo texto livre passa pela máscara do app. Na análise por LLM, uma verificação dupla: achou dado proibido, nada é enviado.", "All free text goes through the app's mask. In the LLM analysis, a double check: if it finds forbidden data, nothing is sent.") },
        { icone: <LockIcon size={I} />, titulo: t("O que nunca sai", "What never leaves"), texto: t("Id de sessão, usuários, IP, e-mail, CPF, CNPJ, cartão, telefone, tokens, parâmetros de URL, ids de trace e de span e corpo de resposta.", "Session id, users, IP, e-mail, CPF, CNPJ, card, phone, tokens, URL parameters, trace and span ids and response bodies.") },
        { icone: <CheckmarkIcon size={I} />, titulo: t("Confira antes de agir", "Verify before acting"), texto: t("Toda saída de IA leva o aviso. A análise apoia a decisão, com as evidências citadas para conferir.", "Every AI output carries the notice. The analysis supports the decision, with the cited evidence to check.") },
      ]} />
      <Tabela cabecalho={[t("O quê", "What"), t("Sai do ambiente?", "Leaves the environment?"), t("Para onde", "Where to")]} linhas={[
        [t("Telas do app", "App screens"), t("Não", "No"), t("Tudo é lido e mostrado dentro do Dynatrace.", "Everything is read and shown inside Dynatrace.")],
        ["Dynatrace Assist", t("Sim, mascarado", "Yes, masked"), t("IA generativa da Dynatrace, em nome de quem clicou.", "Dynatrace generative AI, on behalf of whoever clicked.")],
        [t("Análise por LLM", "LLM analysis"), t("Sim, com aceite", "Yes, with consent"), t("LLM configurado no app, pela função do app.", "LLM configured in the app, through the app function.")],
        [t("PDFs", "PDFs"), t("Não", "No"), t("Gerados no navegador; quem baixa decide com quem compartilhar.", "Generated in the browser; whoever downloads decides whom to share with.")],
      ]} />
      <Nota tipo="atencao">{t("Antes de ligar a IA num ambiente: revisão de segurança e privacidade para o processamento fora do ambiente; a permissão de IA só para o grupo que pode gerar análises; máscara na origem (OpenPipeline) se páginas, URLs ou mensagens de erro podem trazer nomes ou endereços de pessoas, que a máscara do app não reconhece; e, para a análise por LLM, o endereço do modelo na lista de conexões externas do AppEngine.", "Before enabling AI in an environment: a security and privacy review for processing outside the environment; the AI permission only for the group that may generate analyses; masking at the source (OpenPipeline) if pages, URLs or error messages may carry people's names or addresses, which the app's mask does not recognize; and, for the LLM analysis, the model address in the AppEngine external connections list.")}</Nota>
    </Secao>
  </Doc>
);
