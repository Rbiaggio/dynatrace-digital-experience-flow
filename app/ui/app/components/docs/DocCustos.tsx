/* Sub-aba "Custos" da aba Documentação, manual enxuto (1.45), em quatro abas: Como é cobrado (as quatro linhas de
   cobrança e o que não entra), O que muda o custo (as alavancas, em linguagem de quem usa), Acompanhar o consumo (o
   cartão "Consumo do app" da Configuração e como conferir por conta própria) e Calculadora por volumetria (lib/custos.ts,
   estimarCustos: função pura, estado local, sem rede). Os números da calculadora e do texto saem das constantes do modelo
   (MODELO), nunca de números fixos. O detalhe técnico (o que cada ação lê, fórmulas, registros de controle) fica na
   documentação técnica em docs/ do repositório. Genérica: vale para qualquer tenant; sem cliente,
   ambiente, contrato nem data. Montada com o kit (./Kit); a calculadora usa as classes calc-* e doc-calc do styles.css. */
import React, { useState } from "react";
import { AiIcon, ApplicationsIcon, BarChartIcon, CalendarIcon, ClockIcon, FilterIcon, IdeaIcon, LineChartIcon, MagnifyingGlassIcon, MoneyIcon,
         PathIcon, StorageIcon, TracesIcon, UploadIcon, WorkflowSimpleIcon } from "@dynatrace/strato-icons";
import { t, localidade } from "../../lib/i18n";
import { Doc, Secao, Par, Lista, Tabela, Nota, Figura, Cod, Sub, Cartoes } from "./Kit";
import { estimarCustos, MODELO, TARIFAS_LISTA, VOLUMETRIA_LAB, type Tarifas, type Volumetria } from "../../lib/custos";
import { CAMBIO_PADRAO } from "../../lib/precos";

const I = 16;

// ---- números na localidade do idioma (pt-BR ou en-US) ----
const loc = () => localidade();
const inteiro = (n: number) => Math.round(n).toLocaleString(loc());
const casas = (n: number, d: number) => n.toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d });
const padrao = (n: number) => n.toLocaleString(loc(), { maximumFractionDigits: 2 });
const gib = (n: number) => (n >= 100 ? casas(n, 0) : n >= 1 ? casas(n, 2) : casas(n, 4));
const dinheiro = (n: number, moeda: string) => `${moeda} ${n === 0 || n >= 0.01 ? casas(n, 2) : casas(n, 4)}`;

/** Execuções do workflow por dia: uma a cada fatia (as sessões da última hora e a análise de hora em hora vão junto). */
const EXEC_DIA = MODELO.minutosDia / MODELO.fatiaMin;
/** Retenção dos totais e dos erros com exemplos, numa frase só quando é a mesma. */
const retTotaisErros = () => MODELO.diasRetencaoAgregados === MODELO.diasRetencaoErros
  ? t(`os totais e os erros, ${MODELO.diasRetencaoAgregados} dias`, `the totals and the errors, ${MODELO.diasRetencaoAgregados} days`)
  : t(`os totais, ${MODELO.diasRetencaoAgregados} dias; os erros, ${MODELO.diasRetencaoErros} dias`, `the totals, ${MODELO.diasRetencaoAgregados} days; the errors, ${MODELO.diasRetencaoErros} days`);

// ---- calculadora: estado local (texto dos campos), modelo puro em lib/custos.ts ----
type Textos<T> = Record<keyof T, string>;
const emTexto = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as Textos<T>;
const numero = (s: string) => { const n = Number(String(s).trim().replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : 0; };

/** Um campo da calculadora: rótulo curto, entrada com unidade e, embaixo, o valor do laboratório. Fica fora do
    componente da calculadora para não ser recriado a cada tecla (perderia o foco). */
const Campo: React.FC<{ rotulo: string; dica?: string; unidade?: string; tipo?: "number" | "text"; valor: string; mudar: (x: string) => void }> = ({ rotulo, dica, unidade, tipo = "number", valor, mudar }) => (
  <label className="calc-campo">
    <span className="calc-rotulo">{rotulo}</span>
    <span className="calc-entrada">
      {tipo === "text"
        ? <input type="text" value={valor} onChange={(ev) => mudar(ev.target.value)} />
        : <input type="number" inputMode="decimal" min={0} step="any" value={valor} onChange={(ev) => mudar(ev.target.value)} />}
      {unidade && <span className="calc-unidade">{unidade}</span>}
    </span>
    {dica && <span className="calc-dica">{dica}</span>}
  </label>
);

const Calculadora: React.FC = () => {
  const [vol, setVol] = useState<Textos<Volumetria>>(() => emTexto(VOLUMETRIA_LAB));
  const [tar, setTar] = useState<Textos<Tarifas>>(() => emTexto(TARIFAS_LISTA));
  // 1.46.0: Configuração › Atualização dos números (a cada 5 minutos, a carga não lê a cópia ao vivo)
  const [tempoReal, setTempoReal] = useState(true);
  const v = Object.fromEntries((Object.keys(VOLUMETRIA_LAB) as (keyof Volumetria)[]).map((k) => [k, numero(vol[k])])) as unknown as Volumetria;
  const moeda = tar.moeda.trim() || TARIFAS_LISTA.moeda;
  const tf: Tarifas = {
    consultaPorGib: numero(tar.consultaPorGib), retencaoPorGibDia: numero(tar.retencaoPorGibDia),
    gravacaoPorGib: numero(tar.gravacaoPorGib), funcaoPorInvocacao: numero(tar.funcaoPorInvocacao), moeda,
  };
  const e = estimarCustos({ ...v, tempoReal }, tf);
  const $ = (n: number) => dinheiro(n, moeda);
  const lab = (k: keyof Volumetria) => t(`laboratório: ${padrao(Number(VOLUMETRIA_LAB[k]))}`, `lab: ${padrao(Number(VOLUMETRIA_LAB[k]))}`);
  type CampoVol = { k: keyof Volumetria; rotulo: string; unidade?: string; dica?: string };
  const grupos: { titulo: string; campos: CampoVol[]; extra?: React.ReactNode }[] = [
    { titulo: t("Tráfego das aplicações", "Application traffic"), campos: [
      { k: "sessoesDia", rotulo: t("Sessões por dia", "Sessions per day") },
      { k: "navegacoesPorSessao", rotulo: t("Navegações por sessão", "Navigations per session") },
      { k: "chamadasPorSessao", rotulo: t("Chamadas de API por sessão", "API calls per session") },
      { k: "errosPorSessao", rotulo: t("Erros por sessão", "Errors per session") },
      { k: "experienciaPorSessao", rotulo: t("Resumos, cliques e ações por sessão", "Summaries, clicks and actions per session") },
    ] },
    { titulo: t("Monitoramento", "Monitoring"), campos: [
      { k: "paginasDistintas", rotulo: t("Páginas distintas (todas as aplicações)", "Distinct pages (all applications)") },
      { k: "spansGibHora", rotulo: t("Spans do ambiente inteiro", "Spans of the whole environment"), unidade: "GiB/h" },
    ] },
    { titulo: t("Uso do app", "App usage"), campos: [
      { k: "horasUsoDia", rotulo: t("Horas do dia com alguém na Visão geral", "Hours of the day with someone on the Overview"), unidade: "h",
        dica: t("as sessões da última hora só são lidas nelas", "the last-hour sessions are only read in them") },
      { k: "jornadasSalvas", rotulo: t("Jornadas salvas", "Saved journeys"),
        dica: t("com alguma, entram os funis", "with any, the funnels come in") },
      { k: "cargasDia", rotulo: t("Cargas de tela por dia que vão ao Grail", "Screen loads per day that go to Grail"),
        dica: t("o cache de 5 min serve as repetidas", "the 5-minute cache serves repeated ones") },
      { k: "cargasFlowDia", rotulo: t("Aberturas do Flow por dia que vão ao Grail", "Flow openings per day that go to Grail") },
      { k: "aberturasFiltroDia", rotulo: t("Aberturas com filtro de segmento, robôs ou frames por dia", "Openings with a segment filter, robots or frames per day") },
      { k: "analisesDia", rotulo: t("\"Isolar\" e \"Por quê?\" por dia", "\"Isolate\" and \"Why?\" per day") },
      { k: "cliquesOndeFalhaDia", rotulo: t("Cliques em \"Onde falha no backend?\" por dia", "Clicks on \"Where does it fail in the backend?\" per day") },
      { k: "janelaMin", rotulo: t("Período típico das telas", "Typical timeframe of the screens"), unidade: "min" },
    ], extra: (
      <label className="calc-campo">
        <span className="calc-rotulo">{t("Atualização dos números (Configuração)", "How numbers update (Configuration)")}</span>
        <span className="calc-entrada">
          <select value={tempoReal ? "tempo-real" : "5min"} onChange={(ev) => setTempoReal(ev.target.value !== "5min")}>
            <option value="tempo-real">{t("Tempo real", "Real time")}</option>
            <option value="5min">{t("A cada 5 minutos", "Every 5 minutes")}</option>
          </select>
        </span>
        <span className="calc-dica">{t("a cada 5 minutos, a carga não lê a cópia ao vivo", "every 5 minutes, a load does not read the live copy")}</span>
      </label>
    ) },
  ];
  const camposTar: { k: keyof Tarifas; rotulo: string; texto?: boolean; unidade?: string }[] = [
    { k: "consultaPorGib", rotulo: t("Consulta", "Query"), unidade: t("por GiB lido", "per GiB scanned") },
    { k: "retencaoPorGibDia", rotulo: t("Retenção", "Retention"), unidade: t("por GiB-dia", "per GiB-day") },
    { k: "gravacaoPorGib", rotulo: t("Gravação de eventos", "Event ingest"), unidade: t("por GiB", "per GiB") },
    { k: "funcaoPorInvocacao", rotulo: t("Função de app (cada execução do workflow)", "App function (each workflow run)"), unidade: t("por execução", "per run") },
    { k: "moeda", rotulo: t("Moeda (rótulo)", "Currency (label)"), texto: true },
  ];
  const g = e.gravado, w = e.workflows;
  const partes = [
    { nome: t("Workflow: leituras", "Workflow: reads"), valor: w.custoMes },
    { nome: t("Workflow: execuções (funções)", "Workflow: runs (functions)"), valor: w.custoFuncoesMes },
    { nome: t("Gravado e retido pelo workflow", "Written and kept by the workflow"), valor: g.custoGravacaoMes + g.custoRetencaoMes },
    { nome: t(`Retenção da cópia (${MODELO.diasRetencaoCopia} dia)`, `Copy retention (${MODELO.diasRetencaoCopia} day)`), valor: e.retencao.custoMes },
    { nome: t("Cargas de tela", "Screen loads"), valor: e.cargas.custoMes },
    { nome: t("Leituras sob demanda", "On-demand reads"), valor: e.sobDemanda.custoMes },
  ];
  const maior = Math.max(0, ...partes.map((x) => x.valor));
  const restaurar = () => { setVol(emTexto(VOLUMETRIA_LAB)); setTar(emTexto(TARIFAS_LISTA)); setTempoReal(true); };
  const consulta = (gibMes: number) => $(gibMes * tf.consultaPorGib);
  const gravadoGibMes = (g.agregadosGibDia + g.errosGibDia + g.horasGibDia) * MODELO.diasMes;
  return (
    <>
      <div className="calc">
        <div className="calc-entradas">
          {grupos.map((gr) => (
            <section key={gr.titulo} className="calc-grupo">
              <h4>{gr.titulo}</h4>
              <div className="doc-calc">
                {gr.campos.map((c) => <Campo key={c.k} rotulo={c.rotulo} unidade={c.unidade} dica={c.dica ? `${c.dica}; ${lab(c.k)}` : lab(c.k)} valor={vol[c.k]} mudar={(x) => setVol({ ...vol, [c.k]: x })} />)}
                {gr.extra}
              </div>
            </section>
          ))}
          <section className="calc-grupo">
            <h4>{t("Tarifas", "Rates")}</h4>
            <p className="calc-nota">{t(`Valores iniciais: preço de lista da Dynatrace (referência pública) convertido a R$ pelo câmbio de referência (R$ ${CAMBIO_PADRAO.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} por US$), o mesmo do cartão "Consumo do app". Use as tarifas do seu contrato.`, `Initial values: Dynatrace list price (public reference) converted to BRL at the reference exchange rate (R$ ${CAMBIO_PADRAO.toFixed(2)} per USD), the same as the "App consumption" card. Use your contract's rates.`)}</p>
            <div className="doc-calc">
              {camposTar.map((c) => <Campo key={c.k} rotulo={c.rotulo} unidade={c.unidade} tipo={c.texto ? "text" : "number"} valor={tar[c.k]} mudar={(x) => setTar({ ...tar, [c.k]: x })} />)}
            </div>
          </section>
          <button type="button" className="botao-leve calc-restaurar" onClick={restaurar}>{t("Voltar aos valores do laboratório", "Back to the lab values")}</button>
        </div>
        <aside className="calc-resultado" aria-live="polite">
          <span className="calc-resultado-rotulo">{t("Estimativa mensal (teto)", "Monthly estimate (ceiling)")}</span>
          <p className="doc-calc-total calc-total">{$(e.totalMes)}</p>
          <p className="calc-sub">{t("Total por mês", "Total per month")} · {t("fixo", "fixed")}: <b>{$(e.fixoMes)}</b> · {t("uso", "use")}: <b>{$(e.usoMes)}</b></p>
          <p className="calc-sub">{t("por 1.000 sessões por dia", "per 1,000 sessions per day")}: <b>{$(e.custoPorMilSessoesDia)}</b></p>
          <ul className="calc-partes">
            {partes.map((x) => (
              <li key={x.nome}>
                <span className="calc-parte-nome">{x.nome}</span>
                <span className="calc-parte-valor">{$(x.valor)}</span>
                <span className="calc-barra" aria-hidden="true"><span style={{ width: `${maior > 0 ? Math.max(2, (x.valor / maior) * 100) : 0}%` }} /></span>
              </li>
            ))}
          </ul>
          <p className="calc-sub calc-aviso">{t("Teto: não desconta o que o cache de 5 minutos evita.", "Ceiling: it does not discount what the 5-minute cache avoids.")}</p>
        </aside>
      </div>
      <details className="calc-detalhe">
        <summary>{t("Detalhe por componente", "Breakdown by component")}</summary>
        <Tabela cabecalho={[t("Componente", "Component"), t("O que conta", "What counts"), t("Volume por mês", "Volume per month"), t("Custo por mês", "Cost per month")]} linhas={[
          [
            t(`Workflow: fatias de ${MODELO.fatiaMin} min`, `Workflow: ${MODELO.fatiaMin}-minute slices`),
            t(`cada fatia lida uma vez, ${EXEC_DIA} por dia`, `each slice read once, ${EXEC_DIA} per day`),
            `${gib(w.fatiasGibMes)} GiB`, consulta(w.fatiasGibMes),
          ],
          [
            t("Workflow: hora em hora, sessões e funis", "Workflow: hourly, sessions and funnels"),
            t(`cada hora uma vez, janela de ${MODELO.horaSessoesMin} min; funis só com jornada salva`, `each hour once, ${MODELO.horaSessoesMin}-minute window; funnels only with a saved journey`),
            `${gib(w.horaSessoesGibMes + w.horaFunisGibMes)} GiB`, consulta(w.horaSessoesGibMes + w.horaFunisGibMes),
          ],
          [
            t("Workflow: hora em hora, requisições e ligação página → serviço", "Workflow: hourly, requests and page → service link"),
            t(`cada hora uma vez; spans amostrados, até ${padrao(MODELO.ligacaoSpansMaxGib)} GiB por hora`, `each hour once; sampled spans, up to ${padrao(MODELO.ligacaoSpansMaxGib)} GiB per hour`),
            `${gib(w.horaReqGibMes + w.horaLigacaoGibMes)} GiB`, consulta(w.horaReqGibMes + w.horaLigacaoGibMes),
          ],
          [
            t("Workflow: sessões da última hora", "Workflow: last-hour sessions"),
            t(`a cada ${MODELO.ultimaHoraCadenciaMin} min, só nas horas de uso`, `every ${MODELO.ultimaHoraCadenciaMin} min, only during hours of use`),
            `${gib(w.ultimaHoraGibMes)} GiB`, consulta(w.ultimaHoraGibMes),
          ],
          [
            t("Workflow: execuções (funções)", "Workflow: runs (functions)"),
            t(`${EXEC_DIA} por dia, uma a cada ${MODELO.fatiaMin} min; sem hora de workflow`, `${EXEC_DIA} per day, one every ${MODELO.fatiaMin} min; no workflow hour`),
            t(`${inteiro(w.invocacoesMes)} execuções`, `${inteiro(w.invocacoesMes)} runs`), $(w.custoFuncoesMes),
          ],
          [
            t("Gravado pelo workflow: totais, erros e horas", "Written by the workflow: totals, errors and hours"),
            t(`gravação e retenção: ${retTotaisErros()}; as horas, ${MODELO.diasRetencaoHoras} dias`,
              `ingest and retention: ${retTotaisErros()}; the hours, ${MODELO.diasRetencaoHoras} days`),
            `${gib(gravadoGibMes)} GiB`, $(g.custoGravacaoMes + g.custoRetencaoMes),
          ],
          [
            t(`Retenção da cópia (${MODELO.diasRetencaoCopia} dia)`, `Copy retention (${MODELO.diasRetencaoCopia} day)`),
            t(`a cópia das sessões, guardada ${MODELO.diasRetencaoCopia} dia; sem custo de gravação`, `the session copy, kept ${MODELO.diasRetencaoCopia} day; no ingest cost`),
            `${gib(e.retencao.gibGuardado * MODELO.diasMes)} GiB-${t("dia", "day")}`, $(e.retencao.custoMes),
          ],
          [
            t("Cargas de tela", "Screen loads"),
            tempoReal
              ? t(`por carga, até ${MODELO.aoVivoMin} min da cópia e os totais já gravados; mais as aberturas do Flow`, `per load, up to ${MODELO.aoVivoMin} min of the copy and the totals already written; plus the Flow openings`)
              : t("por carga, só os totais já gravados (a cada 5 minutos, sem a cópia ao vivo); mais as aberturas do Flow", "per load, only the totals already written (every 5 minutes, without the live copy); plus the Flow openings"),
            `${gib(e.cargas.gibMes)} GiB`, $(e.cargas.custoMes),
          ],
          [
            t("Leituras sob demanda", "On-demand reads"),
            t("filtros de segmento, robôs e frames, \"Isolar\" e \"Por quê?\" (no máximo a última hora); \"Onde falha no backend?\"", "segment, robots and frames filters, \"Isolate\" and \"Why?\" (the last hour at most); \"Where does it fail in the backend?\""),
            `${gib(e.sobDemanda.gibMes)} GiB`, $(e.sobDemanda.custoMes),
          ],
        ]} />
      </details>
    </>
  );
};

export const DocCustos: React.FC = () => (
  <Doc titulo={t("Custos", "Costs")}
    resumo={t("O que o app consome, o que faz o custo variar, como acompanhar o consumo real e uma calculadora por volumetria.",
      "What the app consumes, what makes the cost vary, how to track the real consumption and a calculator by volume.")}>

    <Secao id="cobrado" titulo={t("Como é cobrado", "How it is charged")}>
      <Par>{t("O Digital Experience Flow não tem licença própria e não cria métricas. O que ele consome entra nas linhas normais de cobrança da plataforma Dynatrace, em quatro partes. A maior parte é fixa e pequena (o workflow, o que ele grava e o que fica guardado) e acompanha o tráfego das aplicações escolhidas. O resto depende do uso: cada tela aberta e cada leitura pedida.",
        "Digital Experience Flow has no license of its own and creates no metrics. What it consumes goes into the regular billing lines of the Dynatrace platform, in four parts. Most of it is fixed and small (the workflow, what it writes and what is kept) and follows the traffic of the chosen applications. The rest depends on use: each screen opened and each read requested.")}</Par>
      <Cartoes itens={[
        { icone: <MagnifyingGlassIcon size={I} />, titulo: t("Consultas no Grail", "Grail queries"),
          texto: t("Cobradas pelos GiB lidos. O workflow lê cada pedaço das sessões uma vez e grava o resultado; as telas leem esse resultado pronto e, quando preciso, os dados do período.",
            "Charged per GiB scanned. The workflow reads each piece of the sessions once and writes the result; the screens read that ready result and, when needed, the timeframe's data.") },
        { icone: <UploadIcon size={I} />, titulo: t("Gravação", "Ingest"),
          texto: t(`O que o workflow grava nos buckets do app: os totais a cada ${MODELO.fatiaMin} minutos, os erros com exemplos e a análise de hora em hora. Cobrada por GiB gravado.`,
            `What the workflow writes to the app's buckets: the totals every ${MODELO.fatiaMin} minutes, the errors with examples and the hourly analysis. Charged per GiB written.`) },
        { icone: <StorageIcon size={I} />, titulo: t("Retenção", "Retention"),
          texto: t(`O volume guardado, por GiB-dia: a cópia das sessões fica ${MODELO.diasRetencaoCopia} dia; ${retTotaisErros()}; a análise de hora em hora, ${MODELO.diasRetencaoHoras} dias.`,
            `The volume kept, per GiB-day: the session copy stays ${MODELO.diasRetencaoCopia} day; ${retTotaisErros()}; the hourly analysis, ${MODELO.diasRetencaoHoras} days.`) },
        { icone: <WorkflowSimpleIcon size={I} />, titulo: t("Execuções do workflow", "Workflow runs"),
          texto: t(`Um workflow simples, a cada ${MODELO.fatiaMin} minutos: ${EXEC_DIA} execuções por dia, cada uma cobrada como execução de função de app. Workflow simples não paga a hora de workflow.`,
            `One simple workflow, every ${MODELO.fatiaMin} minutes: ${EXEC_DIA} runs per day, each charged as an app function run. A simple workflow does not pay the workflow hour.`) },
      ]} />
      <Sub>{t("Não entra na conta do app", "Not part of the app's bill")}</Sub>
      <Lista itens={[
        { rotulo: t("Gravação da cópia das sessões.", "Ingest of the session copy."),
          texto: t("A cópia que o OpenPipeline separa não é cobrada como gravação; conta só a retenção dela.", "The copy that OpenPipeline sets aside is not charged as ingest; only its retention counts.") },
        { rotulo: t("Métricas e entidades.", "Metrics and entities."),
          texto: t("Ler métricas nativas e entidades não tem custo de consulta.", "Reading native metrics and entities has no query cost.") },
        { rotulo: t("RUM, Session Replay, spans e logs.", "RUM, Session Replay, spans and logs."),
          texto: t("São cobrados com ou sem o app. Ele só lê o que já existe.", "They are charged with or without the app. It only reads what already exists.") },
      ]} />
    </Secao>

    <Secao id="variar" titulo={t("O que muda o custo", "What changes the cost")}>
      <Par>{t("O custo fixo acompanha o tráfego e o número de páginas das aplicações escolhidas. O de uso depende de quantas vezes o app é aberto e do que se pede nele.",
        "The fixed cost follows the traffic and the number of pages of the chosen applications. The use cost depends on how often the app is opened and on what is requested in it.")}</Par>
      <Cartoes itens={[
        { icone: <ApplicationsIcon size={I} />, titulo: t("Aplicações e páginas", "Applications and pages"),
          texto: t(`Mais sessões aumentam a cópia que o workflow lê e guarda; mais páginas distintas, o que ele grava a cada ${MODELO.fatiaMin} minutos. Escolha na Configuração só as aplicações que vão ser analisadas.`,
            `More sessions grow the copy the workflow reads and keeps; more distinct pages, what it writes every ${MODELO.fatiaMin} minutes. In the Configuration, select only the applications to be analyzed.`) },
        { icone: <CalendarIcon size={I} />, titulo: t("Período", "Timeframe"),
          texto: t("Cada tela soma os totais já gravados: um período maior lê mais deles, até 7 dias. Telas repetidas em 5 minutos saem do cache.",
            "Each screen adds up the totals already written: a longer timeframe reads more of them, up to 7 days. Screens repeated within 5 minutes come from the cache.") },
        { icone: <FilterIcon size={I} />, titulo: t("Leituras sob demanda", "On-demand reads"),
          texto: t("Filtro de segmento, robôs ou frames, \"Isolar\" e \"Por quê?\" leem os dados do período na hora, com custo de consulta maior.",
            "A segment filter, robots or frames, \"Isolate\" and \"Why?\" read the timeframe's data on the spot, at a higher query cost.") },
        { icone: <PathIcon size={I} />, titulo: t("Jornadas salvas", "Saved journeys"),
          texto: t("Com alguma jornada salva, a análise de hora em hora também calcula os funis. Sem jornada, essa parte não lê nada.",
            "With any saved journey, the hourly analysis also calculates the funnels. Without a journey, that part reads nothing.") },
        { icone: <ClockIcon size={I} />, titulo: t("Horas de uso", "Hours of use"),
          texto: t("As sessões da última hora só são lidas enquanto alguém está com a Visão geral aberta.",
            "The last-hour sessions are only read while someone has the Overview open.") },
        { icone: <TracesIcon size={I} />, titulo: t("Spans", "Spans"),
          texto: t("A ligação página → serviço lê os spans de cada hora uma vez, amostrados e com teto. \"Onde falha no backend?\" lê spans só quando alguém clica; abrir um trace confere antes, em 10 min de spans, se ele existe.",
            "The page → service link reads each hour's spans once, sampled and capped. \"Where does it fail in the backend?\" reads spans only when someone clicks; opening a trace first checks, in 10 min of spans, that it exists.") },
        { icone: <AiIcon size={I} />, titulo: "Dynatrace Assist",
          texto: t("Cerca de 3 AI Units por análise nova. A análise fica guardada 24 horas e serve a todos sem custo novo. Sem uso, custo zero.",
            "About 3 AI Units per new analysis. The analysis is kept for 24 hours and serves everyone at no new cost. Without use, zero cost.") },
        { icone: <IdeaIcon size={I} />, titulo: t("Análise por LLM", "LLM analysis"),
          texto: t("Lê os dados do ambiente com um teto definido, só quando alguém pede. O modelo de IA é pago no provedor do LLM configurado.",
            "It reads the environment's data with a set ceiling, only when someone requests it. The AI model is paid at the configured LLM provider.") },
      ]} />
      <Nota tipo="dica">{t("O app foi feito para ler pouco: cada pedaço das sessões é lido uma vez, os resultados ficam gravados e o que foi lido nos últimos 5 minutos serve a todos os usuários.",
        "The app was built to read little: each piece of the sessions is read once, the results are written down and what was read in the last 5 minutes serves every user.")}</Nota>
    </Secao>

    <Secao id="consumo" titulo={t("Acompanhar o consumo", "Tracking consumption")}>
      <Par>{t("O cartão \"Consumo do app\", na Configuração, mostra o que o app consumiu de verdade, lido da cobrança da Dynatrace.",
        "The \"App consumption\" card, in the Configuration, shows what the app really consumed, read from Dynatrace billing.")}</Par>
      <Cartoes itens={[
        { icone: <CalendarIcon size={I} />, titulo: t("Hoje e últimos 7 dias", "Today and last 7 days"),
          texto: t("Consultas, gravação, retenção e execuções do workflow, em quantidade e em reais.", "Queries, ingest, retention and workflow runs, in quantity and in BRL.") },
        { icone: <LineChartIcon size={I} />, titulo: t("Projeção de 30 dias", "30-day projection"),
          texto: t("Aparece em cada parte quando ela tem 24 horas de dados, pelo ritmo dos últimos dias.", "It shows for each part once it has 24 hours of data, at the pace of the last days.") },
        { icone: <BarChartIcon size={I} />, titulo: t("Por funcionalidade", "By feature"),
          texto: t("As consultas de cada parte do app nas últimas 24 horas.", "The queries of each part of the app in the last 24 hours.") },
        { icone: <MoneyIcon size={I} />, titulo: t("Preços", "Prices"),
          texto: t("Por padrão, o preço de lista da Dynatrace, convertido por um câmbio editável. Em \"Editar preços\", o administrador digita os preços do contrato do ambiente.",
            "By default, the Dynatrace list price, converted by an editable exchange rate. In \"Edit prices\", the administrator types the environment's contract prices.") },
      ]} />
      <Figura id="configuracao" legenda={t("A Configuração: o cartão \"Consumo do app\" fica embaixo, com as consultas por funcionalidade ao lado.", "The Configuration: the \"App consumption\" card is at the bottom, with the queries by feature beside it.")} />
      <Sub>{t("Conferir por conta própria", "Checking it yourself")}</Sub>
      <Lista itens={[
        { rotulo: t("Consultas:", "Queries:"),
          texto: <><Cod>dt.system.query_executions</Cod>{t(" com ", " with ")}<Cod>client.application_context == "my.digital.experience.flow"</Cod>{t(" traz cada consulta do app, com os bytes lidos.", " returns each app query, with the bytes scanned.")}</> },
        { rotulo: t("Cobrança:", "Billing:"),
          texto: <><Cod>dt.system.events</Cod>{t(" com ", " with ")}<Cod>event.kind == "BILLING_USAGE_EVENT"</Cod>{t(" traz as consultas e as execuções pelo id do app e a gravação e a retenção pelos buckets ", " returns the queries and the runs by the app id and the ingest and retention by the buckets ")}<Cod>rum_flow_</Cod>.</> },
      ]} />
      <Nota>{t("Ler a cobrança exige a permissão ", "Reading billing requires the ")}<Cod>storage:system:read</Cod>{t(", que já está na política de quem configura.", " permission, already in the administrators' policy.")}</Nota>
    </Secao>

    <Secao id="calculadora" titulo={t("Calculadora por volumetria", "Calculator by volume")}>
      <Par>{t("Preencha a volumetria do seu ambiente e as tarifas do seu contrato. O resultado separa o que é fixo (o workflow, o que ele grava e a retenção) do que depende do uso (telas e leituras sob demanda). Os valores iniciais vêm do laboratório.",
        "Fill in your environment's volumes and your contract's rates. The result separates what is fixed (the workflow, what it writes and retention) from what depends on use (screens and on-demand reads). The initial values come from the lab.")}</Par>
      <Calculadora />
      <Nota>{t("A estimativa é um teto e não inclui as AI Units do Dynatrace Assist nem a análise por LLM, que só existem quando alguém pede. O consumo real está no cartão \"Consumo do app\".",
        "The estimate is a ceiling and does not include the Dynatrace Assist AI Units or the LLM analysis, which only exist when someone requests them. The real consumption is in the \"App consumption\" card.")}</Nota>
    </Secao>
  </Doc>
);
