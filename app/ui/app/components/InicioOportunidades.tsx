import React, { useEffect, useMemo, useState } from "react";
import { AiIcon, BugReportIcon, CheckmarkIcon, DesktopIcon, DownloadIcon, FlowIcon, GroupIcon, LockIcon, MobileIcon, RepairIcon, ReplayIcon, ServicesIcon, SupportIcon, XmarkIcon } from "@dynatrace/strato-icons";
import { AiLoadingIndicator, Markdown } from "@dynatrace/strato-components/content";
import { getCurrentUserDetails } from "@dynatrace-sdk/app-environment";
import type { AppInfo } from "../lib/graph";
import { formatarInt } from "../lib/graph";
import { t, localidade } from "../lib/i18n";
import { avaliarOportunidades, cenarioOportunidade, cenarioResumo, letraEsforco, nomeCurtoApp, perguntaOportunidade, perguntaResumo, textoEsforco, textoPeriodo, textoTipo,
         type EntradaOportunidades, type Oportunidade, type PaginaOp, type ResultadoOportunidades } from "../lib/oportunidades";
import { problemasComErros, quemFaz, type Inicio, type ProblemaPagina } from "../lib/inicio";
import { replayDaApp, rotuloVerSessoes, useReplayApps } from "../lib/replay";
import { analiseGuardada, analisarComIA, type AnaliseIA, type FaseIA } from "../lib/assistIA";
import { fraseFinal, mascarar, montarPerguntaAssist, periodoLocal, type DadosAssist } from "../lib/assist";
import { lerEvidencias } from "../lib/evidencias";
import { INTERVALO_SERIE, JANELAS, filtrosEmUso } from "../lib/queries";
import { baixarAnaliseLlm, baixarRelatorio, podeGerarRelatorio } from "../lib/relatorioLlm";
import type { Confianca, OportunidadeAnalisada, ProgressoLlm, ResultadoLlm } from "../lib/llmCliente";
import { nomeMotor } from "../lib/llmCliente";
import { AnaliseAssist } from "./AnaliseAssist";
import { OrigemBackend } from "./OrigemBackend";
import { entidadeDaApp, intervaloDe } from "./Links";
import { lerPrecos, precosEfetivos } from "../lib/consumo";
import { precoDeLista, formatarDinheiro } from "../lib/precos";
import { estimativaGibAnalise, ORCAMENTO_PADRAO } from "../lib/dossie";
import "../oportunidades.css";
/** GiB lidos por análise num ambiente grande e o teto da coleta (lib/dossie.ts). */
const GIB_ANALISE = Math.round(estimativaGibAnalise()), GIB_TETO = Math.round(ORCAMENTO_PADRAO.maxBytesLidos / 1024 ** 3);

/** "Oportunidades de melhoria" da Visão geral: logo depois de "O que está afetando os clientes",
    recolhível como as outras seções e aberta sozinha só quando há impacto no cliente. As 3 que mais pesam em cartões; o
    resto numa lista curta, e "Detalhes ›" abre no lugar a linha completa (evidência, o que fazer, quem faz e as ações).
    Rodapé: a ordem explicada, o "Resumo do Dynatrace Assist" (1 chamada por escopo, pronta para todos por 24 h),
    "Gerar relatório" (PDF, lib/relatorioLlm.ts) e o botão discreto "Analisar com LLM" (janela com o que
    será enviado, o que não sai, o uso e o aceite).
    As regras e os números saem de lib/oportunidades.ts (sem consulta); o envio e a regra de uso da análise por LLM
    chegam por props (aoConsultarUso, aoPedirAnalise), para o componente não depender da implementação deles.
    Vermelho só para impacto no cliente; âmbar para lentidão. */

/* ---- Análise por LLM: o que o componente recebe (o backend e a regra de uso são de app/api e lib/llm*.ts) ---- */
export interface UsoAnaliseLlm {
  /** quem está liberado (lista de liberados do llm.local.ts): sem limite */
  ilimitado: boolean;
  /** false = quem está logado não pode pedir a análise (só a lista de liberados): o botão não aparece */
  autorizado?: boolean;
  /** false = a função não tem a chave do LLM no pacote (llm.local.ts modelo): o botão não aparece, nada é coletado */
  configurado?: boolean;
  /** a análise está livre (regra de cota, desligada por padrão: só a lista de liberados pede) */
  disponivel: boolean;
  usada: { nome: string; quando: string } | null;
  emAndamento: { nome: string; quando: string } | null;
}
/** A análise estrutural pronta (ou parcial: oportunidades ou síntese faltando; ResultadoLlm.estado diz o que falta). */
export interface AnaliseLlmPronta { resultado: ResultadoLlm; quando: string; por?: { nome: string } | null }
export type RespostaUsoLlm = { ok: true; uso: UsoAnaliseLlm; analise?: AnaliseLlmPronta | null } | { ok: false; mensagem: string };
/** O fim de uma análise (nova ou continuada): pronta, ou erro com o que ficou (analise parcial). */
export interface FimAnaliseLlm { ok: boolean; mensagem?: string; uso?: UsoAnaliseLlm; analise: AnaliseLlmPronta | null }
export interface AjudaLlm {
  /** as oportunidades que vão para a análise (as primeiras da priorização, até 8) */
  oportunidades: { titulo: string }[];
  aoConsultarUso: () => Promise<RespostaUsoLlm>;
  /** a análise nova: coleta dos dossiês, cada oportunidade em paralelo e a síntese; aoProgresso alimenta a janela */
  aoPedirAnalise: (aoProgresso: (p: ProgressoLlm) => void) => Promise<FimAnaliseLlm>;
  /** só o que falta (oportunidades e síntese) da análise deste ambiente: não gasta a análise de novo */
  aoContinuar?: (aoProgresso: (p: ProgressoLlm) => void) => Promise<FimAnaliseLlm>;
  /** os dossiês da última coleta desta aba (o que foi enviado), para ver na janela e no anexo A do relatório */
  enviado?: () => unknown[] | null;
  /** link de contato (não usado) */
  contato?: string;
}

interface Props {
  /** modelo da Visão geral (null = ainda lendo) */
  dados: Inicio | null;
  /** a avaliação já feita pela tela (avaliarOportunidades com as mesmas entradas), para "Para ver o fluxo completo" usar os
      mesmos ajustes sem avaliar duas vezes; sem ela, o componente avalia */
  resultado?: ResultadoOportunidades | null;
  /** o resto das entradas das regras (qualidade, Apdex, jornadas, "Onde falha" e os dados novos quando existirem) */
  entrada: Omit<EntradaOportunidades, "inicio">;
  apps: AppInfo[];
  app: string;
  todas: string;
  janela: string;
  robos: boolean;
  /** Dynatrace Assist (análise por item e resumo): o mesmo interruptor do "Analisar com o Dynatrace Assist" da Visão geral */
  assist?: boolean;
  aoVerSessoes: (p: PaginaOp) => void;
  aoAbrirPagina: (app: string, view: string, aba?: "erros") => void;
  llm?: AjudaLlm | null;
  /** Apdex mobile do cartão de experiência, para o relatório */
  apdexMobile?: { apdex: number; nota: string; validar?: string | null } | null;
  carregando?: boolean;
  erro?: string | null;
  /** estado inicial (prévia): seção aberta, janela do LLM, resumo aberto, linha com detalhes */
  inicial?: { aberta?: boolean; janelaLlm?: boolean; resumo?: boolean; detalhes?: string[] };
  /** 1.47.4: a primeira hora ainda não foi analisada (instalação nova): o resumo e o texto da lista vazia */
  aguardando?: { resumo: React.ReactNode; corpo: string } | null;
}

const eu = () => { try { const n = getCurrentUserDetails().name || ""; return n.startsWith("dt.missing") ? "" : n; } catch { return ""; } };
const diaMes = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString(localidade(), { day: "2-digit", month: "2-digit" }); };
const horaDe = (ms: number) => new Date(ms).toLocaleTimeString(localidade(), { hour: "2-digit", minute: "2-digit" });
const limparResumo = (s: string) => s.replace(fraseFinal(), "").trim();
const CONTATO_PADRAO = "mailto:?subject=Digital%20Experience%20Flow";

export const InicioOportunidades: React.FC<Props> = (props) => {
  const { dados, entrada, apps, app, todas, janela, robos, assist, llm, carregando, erro, inicial, aguardando } = props;
  const r: ResultadoOportunidades | null = useMemo(() => props.resultado !== undefined ? props.resultado : dados ? avaliarOportunidades({ ...entrada, inicio: dados }) : null,
    [props.resultado, dados, entrada.apps, entrada.qualidade, entrada.apdex, entrada.jornadas, entrada.backend, entrada.chamadas, entrada.terceiros, entrada.vitais, entrada.mobile, entrada.ajustesExistentes, t("pt", "en")]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [manual, setManual] = useState<boolean | null>(inicial?.aberta ?? null);
  const aberta = manual ?? !!r?.impactoNoCliente;
  const escopo = app === todas ? t("Todas as aplicações", "All applications") : apps.find((a) => a.id === app)?.nome ?? app;
  const periodo = dados ? textoPeriodo(dados.geradoEm, janela) : "";

  const itens = r?.itens ?? [];
  const resumo = r ? (
    <>
      {r.numeros.naoConcluiram > 0 && <span className="pb-selo grave">{t(`${formatarInt(r.numeros.naoConcluiram)} não concluíram`, `${formatarInt(r.numeros.naoConcluiram)} did not complete`)}</span>}
      {r.numeros.sairamAposErro > 0 && <span className="pb-selo grave">{t(`${formatarInt(r.numeros.sairamAposErro)} saíram após um erro`, `${formatarInt(r.numeros.sairamAposErro)} left after an error`)}</span>}
      {itens.length === 0 && aguardando ? aguardando.resumo : <span className="in-resumo">{itens.length === 0 ? t("nenhuma oportunidade", "no opportunities") : itens.length === 1 ? t("1 oportunidade", "1 opportunity") : t(`${itens.length} oportunidades`, `${itens.length} opportunities`)}</span>}
    </>
  ) : <span className="in-resumo">{carregando ? t("avaliando", "checking") : ""}</span>;

  return (
    <section className={`in-cartao op-secao${aberta ? "" : " fechado"}`}>
      <button className="in-cartao-cabecalho" onClick={() => setManual(!aberta)} aria-expanded={aberta}>
        <span className={`in-chevron${aberta ? " aberto" : ""}`} aria-hidden="true">›</span>
        <h3>{t("Oportunidades de melhoria", "Improvement opportunities")}<span>{itens.length > 3 ? t("as 3 que mais pesam para o cliente; o resto logo abaixo", "the 3 that weigh the most for customers; the rest right below") : t("o que melhorar primeiro, com o impacto no cliente e o esforço", "what to improve first, with the customer impact and the effort")}</span></h3>
        <span className="in-cartao-resumo">{resumo}</span>
      </button>
      {aberta && (
        <div className="in-cartao-corpo">
          {erro && <p className="in-estado erro">{t("Erro", "Error")}: {erro}</p>}
          {!r ? <p className="in-estado">{carregando ? t("Avaliando as oportunidades…", "Checking the opportunities…") : t("Ainda sem dados.", "No data yet.")}</p>
            : itens.length === 0 ? <p className="painel-vazio">{aguardando ? aguardando.corpo : t(`Nada a melhorar com impacto no cliente neste período: ${r.verificacoes.length} regras avaliadas, nenhuma passou do limite.`, `Nothing to improve with customer impact in this timeframe: ${r.verificacoes.length} rules checked, none above the threshold.`)}</p>
            : <Corpo {...props} r={r} dados={dados!} escopo={escopo} periodo={periodo} />}
        </div>
      )}
    </section>
  );
};

/* ---- corpo (só com a seção aberta e com oportunidades) ---------------------------------------------------------------- */
const Corpo: React.FC<Props & { r: ResultadoOportunidades; dados: Inicio; escopo: string; periodo: string }> = (p) => {
  const { r, dados, apps, app, assist, llm, inicial, escopo, periodo } = p;
  const itens = r.itens, top = itens.slice(0, 3), resto = itens.slice(3);
  const [painel, setPainel] = useState<{ id: string; tipo: "assist" | "backend" } | null>(null);
  const [detalhes, setDetalhes] = useState<string[]>(inicial?.detalhes ?? []);
  const [janelaLlm, setJanelaLlm] = useState(!!inicial?.janelaLlm);
  const [uso, setUso] = useState<{ uso: UsoAnaliseLlm | null; analise: AnaliseLlmPronta | null; erro: string | null } | null>(null);
  const resumo = useResumo(assist ? cenarioResumo(app) : null, r, escopo, periodo, !!inicial?.resumo);
  const alternar = (id: string, tipo: "assist" | "backend") => setPainel((x) => (x && x.id === id && x.tipo === tipo ? null : { id, tipo }));
  // o uso da análise por LLM, para o rótulo do botão ("usada em 15/10"): uma consulta por abertura da seção
  const consultarUso = llm?.aoConsultarUso;
  useEffect(() => {
    if (!consultarUso) return;
    let vivo = true;
    consultarUso().then((x) => { if (vivo) setUso(x.ok ? { uso: x.uso, analise: x.analise ?? null, erro: null } : { uso: null, analise: null, erro: x.mensagem }); },
      (e) => { if (vivo) setUso({ uso: null, analise: null, erro: e instanceof Error ? e.message : String(e) }); });
    return () => { vivo = false; };
  }, [!!consultarUso]);   // eslint-disable-line react-hooks/exhaustive-deps
  const contexto = { ...p, escopo, periodo, painel, alternar };
  const gerar = () => baixarRelatorio({
    resultado: r, escopo, apps, periodo, sessoes: dados.total.sessoes, sessoesUltimaHora: !!dados.periodos, geradoEm: Date.now(), geradoPor: eu(),
    resumoAssist: resumo.analise ? limparResumo(resumo.analise.texto) : null,
    experiencia: { web: p.entrada.apdex && p.entrada.apdex.apdex != null && p.entrada.apdex.nota ? { apdex: p.entrada.apdex.apdex, nota: textoNota(p.entrada.apdex.nota) } : null, mobile: p.apdexMobile ?? null },
    ajustesExistentes: p.entrada.ajustesExistentes, dossie: llm?.enviado?.()?.[0] ?? null,
  });
  const cartaoAberto = painel && top.some((o) => o.id === painel.id) ? top.find((o) => o.id === painel.id)! : null;

  return (
    <div className="op op-b3">
      <ol className="op-cartoes">{top.map((o, i) => <Cartao key={o.id} o={o} ordem={i + 1} ctx={contexto} />)}</ol>
      {cartaoAberto && <div className="op-painel"><Painel o={cartaoAberto} ctx={contexto} /></div>}
      {resto.length > 0 && (
        <div className="op-resto">
          <h4 className="op-sub">{resto.length === 1 ? t("Mais 1 oportunidade", "1 more opportunity") : t(`Mais ${resto.length} oportunidades`, `${resto.length} more opportunities`)}</h4>
          <ul>
            {resto.map((o, k) => detalhes.includes(o.id)
              ? <Linha key={o.id} o={o} ordem={k + 4} ctx={contexto} aoFechar={() => setDetalhes((d) => d.filter((x) => x !== o.id))} />
              : (
                <li key={o.id} className="op-resto-linha">
                  <span className={`op-ordem pequena${o.tom === "atencao" ? " atencao" : ""}`}>{k + 4}</span>
                  <span className="op-resto-tit" title={o.titulo}>{o.titulo}</span>
                  <Chips o={o} apps={apps} />
                  <span className={`op-resto-imp ${o.tom}`} title={o.impactoTexto}>{o.impactoTexto}</span>
                  <Esf o={o} />
                  <button className="painel-link op-ver" onClick={() => setDetalhes((d) => [...d, o.id])} aria-expanded={false}>{t("Detalhes ›", "Details ›")}</button>
                </li>))}
          </ul>
        </div>
      )}
      {resumo.aberto && <ResumoAssist resumo={resumo} />}
      <div className="op-rodape">
        <p className="op-como">
          {t("Ordem: quem não concluiu ou saiu após o problema pesa 3, outros clientes afetados 1, lentidão 0,5, dividido pelo esforço (P 1, M 2, G 3).", "Order: customers who did not complete or left after the problem weigh 3, other affected customers 1, slowness 0.5, divided by the effort (S 1, M 2, L 3).")}
          {/* no escopo padrão (1.43) só os erros e o Apdex são do período escolhido; o resto segue a legenda das bases de tempo */}
          <br />{dados?.periodos ? t(`Período escolhido: ${periodo} (erros e Apdex); as outras partes seguem a legenda no alto da Visão geral.`, `Chosen timeframe: ${periodo} (errors and Apdex); the other parts follow the legend at the top of the Overview.`)
            : t(`Período: ${periodo}.`, `Timeframe: ${periodo}.`)}
        </p>
        <div className="op-barra" role="toolbar" aria-label={t("Ações das oportunidades", "Opportunity actions")}>
          {assist && (
            <button className="painel-link" onClick={resumo.alternar} aria-expanded={resumo.aberto} title={t("Um parágrafo sobre o que mais custa ao cliente e o que fazer primeiro; quem gera primeiro deixa pronto para todos por 24 horas", "One paragraph on what costs customers the most and what to do first; whoever generates it first leaves it ready for everyone for 24 hours")}>
              <AiIcon size={14} />{resumo.aberto ? t("Fechar o resumo", "Close the summary") : t("Resumo do Dynatrace Assist", "Dynatrace Assist summary")}
              {resumo.analise && <span className="pc-pronta">{t("pronto", "ready")}</span>}
            </button>
          )}
          {podeGerarRelatorio() && <button className="painel-link" onClick={gerar} title={t("Relatório em PDF: resumo, oportunidades, matriz impacto x esforço, plano em ondas e iniciativas recomendadas", "PDF report: summary, opportunities, impact x effort matrix, plan in waves and recommended initiatives")}><DownloadIcon size={14} />{t("Gerar relatório", "Generate report")}</button>}
          {/* só com o status respondido, autorizado (lista de liberados do llm.local.ts) e a chave no pacote: falha de status não mostra o botão a ninguém */}
          {llm && uso && uso.uso && uso.uso.autorizado === true && uso.uso.configurado !== false && <BotaoLlm uso={uso.uso} aoAbrir={() => setJanelaLlm(true)} />}
        </div>
      </div>
      {janelaLlm && llm && <JanelaLlm ajuda={llm} r={r} escopo={escopo} periodo={periodo} estado={uso} aoEstado={setUso} aoFechar={() => setJanelaLlm(false)} />}
    </div>
  );
};
const textoNota = (n: string) => ({ excelente: t("Excelente", "Excellent"), bom: t("Bom", "Good"), razoavel: t("Razoável", "Fair"), ruim: t("Ruim", "Poor"), inaceitavel: t("Inaceitável", "Unacceptable") } as Record<string, string>)[n] ?? n;

type Ctx = Props & { r: ResultadoOportunidades; dados: Inicio; escopo: string; periodo: string; painel: { id: string; tipo: "assist" | "backend" } | null; alternar: (id: string, tipo: "assist" | "backend") => void };

/* ---- peças ------------------------------------------------------------------------------------------------------------- */
const Chips: React.FC<{ o: Oportunidade; apps: AppInfo[] }> = ({ o, apps }) => (
  <span className="op-apps" title={o.apps.map((a) => apps.find((x) => x.id === a)?.nome ?? a).join(", ")}>
    {o.canal === "mobile" ? <MobileIcon size={14} /> : <DesktopIcon size={14} />}{o.apps.map((a) => nomeCurtoApp(apps.find((x) => x.id === a)?.nome ?? a)).join(" · ")}
  </span>
);
const Esf: React.FC<{ o: Oportunidade }> = ({ o }) => <span className="op-esforco" title={textoEsforco(o.esforco)}>{t("Esforço", "Effort")} {letraEsforco(o.esforco)}</span>;
const Tipo: React.FC<{ o: Oportunidade }> = ({ o }) => <span className="op-tipo">{textoTipo(o.tipo)}</span>;

/** As ações de um item. curto (cartão): só "Ver no Flow" e o Assist. */
const Acoes: React.FC<{ o: Oportunidade; ctx: Ctx; curto?: boolean }> = ({ o, ctx, curto }) => {
  const chave = chaveAssist(o, ctx.app);
  const [pronta, setPronta] = useState(false);
  useEffect(() => {
    if (!ctx.assist) return;
    let vivo = true;
    analiseGuardada(chave).then((a) => { if (vivo) setPronta(!!a); }, () => undefined);
    return () => { vivo = false; };
  }, [ctx.assist, chave, ctx.painel?.id]);
  const aberto = (tipo: "assist" | "backend") => ctx.painel?.id === o.id && ctx.painel.tipo === tipo;
  const mapaReplay = useReplayApps();   // "Ver sessões e Replay" só quando a aplicação grava replay (lib/replay.ts)
  return (
    <div className="pc-acoes op-acoes">
      {!curto && o.pagina && o.tom === "grave" && <button className="painel-link" onClick={() => ctx.aoVerSessoes(o.pagina!)}><ReplayIcon size={14} />{rotuloVerSessoes(replayDaApp(o.pagina.app, ctx.apps, mapaReplay))}</button>}
      {o.pagina && <button className="painel-link" onClick={() => ctx.aoAbrirPagina(o.pagina!.app, o.pagina!.view, o.problemas.length ? "erros" : undefined)}><FlowIcon size={14} />{t("Ver no Flow", "See in Flow")}</button>}
      {!curto && o.servidor && o.pagina && <button className="painel-link" onClick={() => ctx.alternar(o.id, "backend")} aria-expanded={aberto("backend")}><ServicesIcon size={14} />{t("Onde falha no backend?", "Where does it fail in the backend?")}</button>}
      {ctx.assist && (
        <button className="painel-link pc-assist" onClick={() => ctx.alternar(o.id, "assist")} aria-expanded={aberto("assist")}
                title={pronta ? t("Análise pronta: alguém já analisou este cenário nas últimas 24 horas", "Analysis ready: someone already analyzed this scenario in the last 24 hours") : t("Peça ajuda ao Dynatrace Assist na análise, na causa raiz e nas ações para correção", "Ask Dynatrace Assist for help with the analysis, the root cause and the corrective actions")}>
          <AiIcon size={14} />{pronta ? t("Ver análise do Dynatrace Assist", "See the Dynatrace Assist analysis") : t("Analisar com o Dynatrace Assist", "Analyze with Dynatrace Assist")}{pronta && <span className="pc-pronta">{t("pronta", "ready")}</span>}
        </button>
      )}
    </div>
  );
};

/** Cartão das 3 primeiras. */
const Cartao: React.FC<{ o: Oportunidade; ordem: number; ctx: Ctx }> = ({ o, ordem, ctx }) => (
  <li className="op-cartao">
    <header className="op-cartao-topo"><span className={`op-ordem${o.tom === "atencao" ? " atencao" : ""}`}>{ordem}</span><b className="op-titulo" title={o.titulo}>{o.titulo}</b></header>
    <div className="op-cartao-num"><b className={o.tom}>{formatarInt(o.numero.valor)}</b><span>{o.numero.rotulo}</span><Chips o={o} apps={ctx.apps} /></div>
    <p className="op-cartao-evid" title={o.evidencia}>{o.evidencia}</p>
    <div className="pc-linha"><RepairIcon size={16} /><span className="pc-linha-texto">{o.acao}</span></div>
    <div className="op-meta"><Esf o={o} /><Tipo o={o} /></div>
    <Acoes o={o} ctx={ctx} curto />
  </li>
);

/** A linha completa, aberta no lugar pelo "Detalhes ›". */
const Linha: React.FC<{ o: Oportunidade; ordem: number; ctx: Ctx; aoFechar: () => void }> = ({ o, ordem, ctx, aoFechar }) => (
  <li className="op-linha">
    <span className={`op-ordem${o.tom === "atencao" ? " atencao" : ""}`}>{ordem}</span>
    <div className="op-corpo">
      <div className="op-topo">
        <b className="op-titulo">{o.titulo}</b><Chips o={o} apps={ctx.apps} />
        <span className="op-meta"><Esf o={o} /><Tipo o={o} /><button className="aa-fechar" onClick={aoFechar} title={t("Fechar os detalhes", "Close the details")} aria-label={t("Fechar os detalhes", "Close the details")}><XmarkIcon size={14} /></button></span>
      </div>
      <div className={`op-impacto ${o.tom}`}><span className="op-ponto" />{o.impactoTexto}</div>
      <div className="pc-linha"><BugReportIcon size={16} /><span className="pc-linha-texto op-evid">{o.evidencia}</span></div>
      <div className="pc-linha"><RepairIcon size={16} /><span className="pc-linha-texto">{o.acao}<span className="pc-quem"><GroupIcon size={14} />{o.quem}</span></span></div>
      <Acoes o={o} ctx={ctx} />
      {ctx.painel?.id === o.id && <Painel o={o} ctx={ctx} />}
    </div>
  </li>
);

/* ---- painéis: "Onde falha no backend?" e o Dynatrace Assist ------------------------------------------------------------ */
/** A chave do Assist: a do cartão da página em "O que está afetando os clientes" (análise compartilhada com ele), ou uma
    própria da oportunidade quando ela não tem cartão (W1, W7, M2, M3). */
const chaveAssist = (o: Oportunidade, app: string) => o.cenario ?? cenarioOportunidade(app, o);

const Painel: React.FC<{ o: Oportunidade; ctx: Ctx }> = ({ o, ctx }) => {
  if (!ctx.painel || ctx.painel.id !== o.id) return null;
  const fechar = () => ctx.alternar(o.id, ctx.painel!.tipo);
  if (ctx.painel.tipo === "backend") return o.pagina ? <div className="pc-backend"><OrigemBackend app={o.pagina.app} view={o.pagina.view} janela={ctx.janela} robos={ctx.robos} aberto /></div> : null;
  return <AssistDoItem o={o} ctx={ctx} aoFechar={fechar} />;
};

/** O Dynatrace Assist de uma oportunidade: com cartão na Visão geral, o MESMO pedido e a mesma chave do cartão (o que um
    analisar, o outro mostra pronto); sem cartão, o pedido da oportunidade (lib/oportunidades.ts perguntaOportunidade). */
const AssistDoItem: React.FC<{ o: Oportunidade; ctx: Ctx; aoFechar: () => void }> = ({ o, ctx, aoFechar }) => {
  const { dados, janela, robos, apps } = ctx;
  const { from, to } = intervaloDe(janela, dados.geradoEm);
  const periodo = periodoLocal(from, to);
  const p: ProblemaPagina | undefined = useMemo(() => (o.cenario ? problemasComErros(dados).find((x) => x.erros[0] && `${x.view}|${x.erros[0].chave}` === o.cenario) : undefined), [dados, o.cenario]);
  if (p) {
    const appNome = apps.find((a) => a.id === p.app)?.nome ?? p.app;
    const entidade = entidadeDaApp(apps, p.app), canal = apps.find((a) => a.id === p.app)?.canal ?? (p.app.includes("-") ? "mobile" : "web");
    const j = JANELAS.find((x) => x.valor === janela);
    const c = p.fluxo ? dados.caminhos[p.fluxo.indice] ?? null : null;
    // como o cartão da página (components/InicioProblemas.tsx): os números da tela e, ao analisar, as evidências do ambiente
    const dadosAssist = (): DadosAssist => ({ appNome, appId: p.app, canal, entidade, problema: p, caminho: c && p.fluxo ? c : null, serie: dados.series[`${p.app}|${p.view}`], intervalo: INTERVALO_SERIE[janela] ?? "5m",
      periodo: { de: from, ate: to, rotulo: j ? t(j.pt, j.en) : t("período escolhido", "chosen timeframe"), relativa: /^\d+[smhd]$/.test(janela) }, filtros: filtrosEmUso(robos), quem: quemFaz(p), extras: [],
      periodoImpacto: dados.periodos?.dia ? { de: new Date(dados.periodos.dia.de).toISOString(), ate: new Date(dados.periodos.dia.ate).toISOString() } : null });
    const montar = async () => montarPerguntaAssist({ ...dadosAssist(), evidencias: await lerEvidencias(p.app, p.view, janela, robos, entidade, { de: from, ate: to }, p.erros[0]?.tipo === "servidor") });
    return <AnaliseAssist chave={o.cenario!} montar={montar} montarBasico={() => montarPerguntaAssist(dadosAssist())} pagina={p.view} app={appNome} periodo={periodo} aoFechar={aoFechar} />;
  }
  const pergunta = () => perguntaOportunidade(o, { escopo: ctx.escopo, periodo }, mascarar);
  return <AnaliseAssist chave={cenarioOportunidade(ctx.app, o)} montar={async () => pergunta()} montarBasico={pergunta} pagina={o.pagina?.view ?? o.titulo} app={ctx.escopo} periodo={periodo} aoFechar={aoFechar} />;
};

/* ---- Resumo do Dynatrace Assist: 1 chamada por escopo, pronta para todos por 24 h (lib/assistIA.ts) --------------------- */
interface Resumo { aberto: boolean; analise: AnaliseIA | null; fase: FaseIA | null; quem?: string; desde: number | null; erro: string | null; alternar: () => void; tentar: () => void }
function useResumo(cenario: string | null, r: ResultadoOportunidades, escopo: string, periodo: string, abrir: boolean): Resumo {
  const [aberto, setAberto] = useState(false);
  const [analise, setAnalise] = useState<AnaliseIA | null>(null);
  const [fase, setFase] = useState<FaseIA | null>(null);
  const [quem, setQuem] = useState<string | undefined>();
  const [desde, setDesde] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [, setTique] = useState(0);
  useEffect(() => {
    if (!cenario) return;
    let vivo = true;
    analiseGuardada(cenario).then((a) => { if (vivo && a) { setAnalise(a); if (abrir) setAberto(true); } }, () => undefined);
    return () => { vivo = false; };
  }, [cenario]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (desde == null) return; const i = setInterval(() => setTique((x) => x + 1), 1000); return () => clearInterval(i); }, [desde]);
  const gerar = () => {
    if (!cenario || desde != null) return;
    setErro(null); setDesde(Date.now()); setFase("ia");
    analisarComIA(cenario, async () => perguntaResumo(r, { escopo, periodo }, mascarar), { por: eu(), periodo }, (f, q) => { setFase(f); setQuem(q); })
      .then((a) => setAnalise(a), (e) => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => { setDesde(null); setFase(null); });
  };
  return {
    aberto, analise, fase, quem, desde, erro, tentar: gerar,
    alternar: () => { const novo = !aberto; setAberto(novo); if (novo && !analise) gerar(); },
  };
}
const ResumoAssist: React.FC<{ resumo: Resumo }> = ({ resumo }) => {
  const a = resumo.analise, seg = resumo.desde != null ? Math.max(0, Math.round((Date.now() - resumo.desde) / 1000)) : 0;
  return (
    <div className="op-resumo" aria-live="polite">
      <div className="op-resumo-topo">
        <AiIcon size={16} /><b>{t("Resumo do Dynatrace Assist", "Dynatrace Assist summary")}</b>
        {a && <span>{t(`gerado${a.por ? ` por ${a.por}` : ""} às ${horaDe(a.quando)} · pronto para todos por 24 h`, `generated${a.por ? ` by ${a.por}` : ""} at ${horaDe(a.quando)} · ready for everyone for 24 h`)}</span>}
      </div>
      {resumo.desde != null && <AiLoadingIndicator>{`${resumo.fase === "aguardando" ? t(`${resumo.quem || "Outra pessoa"} já está gerando este resumo; aguardando`, `${resumo.quem || "Someone"} is already generating this summary; waiting`) : t("A IA da Dynatrace está escrevendo o resumo", "Dynatrace AI is writing the summary")} · ${seg} s`}</AiLoadingIndicator>}
      {resumo.erro && <p className="op-resumo-erro">{resumo.erro} <button className="painel-link" onClick={resumo.tentar}>{t("Tentar de novo", "Try again")}</button></p>}
      {a && <div className="op-resumo-texto"><Markdown>{limparResumo(a.texto)}</Markdown></div>}
      {a && <span className="op-resumo-aviso">{t("Gerado com IA (Dynatrace Intelligence). Confira antes de agir.", "AI-generated (Dynatrace Intelligence). Verify before acting.")}</span>}
    </div>
  );
};

/* ---- "Analisar com LLM": botão discreto e janela (aceite, progresso e resultado) ------------------------------ */
const usadaPorOutro = (u: UsoAnaliseLlm | null) => !!u && !u.ilimitado && !u.disponivel && !!u.usada;
const BotaoLlm: React.FC<{ uso: UsoAnaliseLlm | null; aoAbrir: () => void }> = ({ uso, aoAbrir }) => {
  const usada = usadaPorOutro(uso);
  return (
    <button className="painel-link op-llm" onClick={aoAbrir}
            title={usada ? t(`Análise por LLM feita em ${diaMes(uso!.usada!.quando)} por ${uso!.usada!.nome}`, `LLM analysis done on ${diaMes(uso!.usada!.quando)} by ${uso!.usada!.nome}`) : t("Análise de causa raiz feita por um LLM fora deste ambiente, com o seu aceite", "Root cause analysis by an LLM outside this environment, with your consent")}>
      <SupportIcon size={14} />{usada ? t("Ver a análise por LLM", "See the LLM analysis") : t("Analisar com LLM", "Analyze with an LLM")}
      {usada && <span className="pc-pronta">{t(`usada em ${diaMes(uso!.usada!.quando)}`, `used on ${diaMes(uso!.usada!.quando)}`)}</span>}
    </button>
  );
};

type EstadoUso = { uso: UsoAnaliseLlm | null; analise: AnaliseLlmPronta | null; erro: string | null } | null;
type Fase = "aceite" | "andamento" | "pronta" | "erro";
const mb = (b: number) => (b / 1024 ** 2).toLocaleString(localidade(), { maximumFractionDigits: b < 1024 ** 2 ? 2 : 1 });
const seg = (ms: number | null) => (ms == null ? "" : `${Math.max(0, Math.round(ms / 1000))} s`);
const nOp = (id: string) => /^o(\d+)$/.exec(id)?.[1] ?? id;
const rotOps = (ids: string[]) => `${ids.length === 1 ? t("oportunidade", "opportunity") : t("oportunidades", "opportunities")} ${ids.map(nOp).join(", ")}`;
const textoConfianca = (c: Confianca) => ({ alta: t("confiança alta", "high confidence"), media: t("confiança média", "medium confidence"), baixa: t("confiança baixa", "low confidence") })[c];

const JanelaLlm: React.FC<{ ajuda: AjudaLlm; r: ResultadoOportunidades; escopo: string; periodo: string; estado: EstadoUso; aoEstado: (e: EstadoUso) => void; aoFechar: () => void }> = ({ ajuda, escopo, periodo, estado, aoEstado, aoFechar }) => {
  const [aceite, setAceite] = useState(false);
  // o preço de consulta em uso (Configuração > Consumo do app), para o custo da leitura no texto do aceite
  const [precoConsulta, setPrecoConsulta] = useState(() => precoDeLista("consulta", null));
  useEffect(() => { let vivo = true; lerPrecos().then((c) => { if (vivo) setPrecoConsulta(precosEfetivos(c).consulta); }); return () => { vivo = false; }; }, []);
  const [fase, setFase] = useState<Fase>("aceite");
  const [msg, setMsg] = useState<string | null>(null);
  const [resultado, setResultado] = useState<AnaliseLlmPronta | null>(null);
  const [progresso, setProgresso] = useState<ProgressoLlm | null>(null);
  const [verEnviado, setVerEnviado] = useState(false);
  const [nova, setNova] = useState(false);
  const [, setTique] = useState(0);
  useEffect(() => { if (fase !== "andamento") return; const i = setInterval(() => setTique((x) => x + 1), 1000); return () => clearInterval(i); }, [fase]);
  const uso = estado?.uso ?? null;
  const usada = usadaPorOutro(uso), andamento = !!uso && !uso.ilimitado && !uso.disponivel && !uso.usada && !!uso.emAndamento;
  const existente = estado?.analise ?? null;
  // a análise que aparece: a desta janela; senão a do ambiente, se já foi usada ou se parou no meio (para continuar)
  const pronta = resultado ?? (!nova && existente && (usada || !existente.resultado.estado.completa) ? existente : null);
  const incompleta = !!pronta && pronta.resultado.formato === "estrutural" && !pronta.resultado.estado.completa;
  const rodar = async (continuar: boolean) => {
    const pedir = continuar ? ajuda.aoContinuar : ajuda.aoPedirAnalise;
    if (!pedir) return;
    setFase("andamento"); setMsg(null); setProgresso(null);
    try {
      const x = await pedir((p) => setProgresso(p));
      if (x.uso) aoEstado({ uso: x.uso, analise: x.analise ?? estado?.analise ?? null, erro: null });
      if (x.analise) setResultado(x.analise);
      setMsg(x.ok ? null : x.mensagem ?? null);
      setFase(x.ok ? "pronta" : "erro");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setFase("erro"); }
  };
  const baixar = (a: AnaliseLlmPronta) => baixarAnaliseLlm({ resultado: a.resultado, escopo: a.resultado.contexto?.escopo || escopo, periodo: a.resultado.periodo || periodo, geradoEm: Date.now(), geradoPor: eu(), precoConsulta });
  const textoUso = uso?.ilimitado ? t("Você está na lista de liberados: análises sem limite.", "You are on the allowed list: unlimited analyses.")
    : t("A análise por LLM é pedida pelos usuários da lista de liberados (llm.local.ts). Para uma análise, fale com o administrador do app.", "The LLM analysis is requested by the users on the allowed list (llm.local.ts). For an analysis, contact the app administrator.");
  const contato = ajuda.contato ?? CONTATO_PADRAO;
  const enviado = ajuda.enviado?.() ?? null;
  const larga = fase === "andamento" || (!!pronta && (fase === "pronta" || fase === "erro" || usada || incompleta));
  // 1.47.0 (desenho aprovado no mock): com o resultado na tela, o cabeçalho leva o selo "pronta" e as ações à direita, e
  // uma linha de contexto (oportunidades, quando, evidências lidas, motor) substitui o parágrafo; o resultado corre na
  // própria janela, sem caixa com rolagem interna
  const mostrando = !!pronta && fase !== "andamento" && (fase === "pronta" || fase === "erro" || usada || incompleta);
  const estrutural = !!pronta && pronta.resultado.formato === "estrutural";
  const kbEnviado = enviado ? Math.max(1, Math.round(new TextEncoder().encode(JSON.stringify(enviado)).length / 1024)) : 0;
  const metaResultado = (a: AnaliseLlmPronta) => {
    const r = a.resultado, c = r.contexto?.coleta, partes = [r.oportunidades.length === 1 ? t("1 oportunidade", "1 opportunity") : t(`${r.oportunidades.length} oportunidades`, `${r.oportunidades.length} opportunities`)];
    if (r.quando) partes.push(`${diaMes(r.quando)} ${new Date(r.quando).toLocaleTimeString(localidade(), { hour: "2-digit", minute: "2-digit" })}`);
    if (c) partes.push(t(`evidências: ${c.consultas} consultas, ${mb(c.bytes)} MB lidos, ${formatarDinheiro((c.bytes / 1024 ** 3) * precoConsulta)}`, `evidence: ${c.consultas} queries, ${mb(c.bytes)} MB read, ${formatarDinheiro((c.bytes / 1024 ** 3) * precoConsulta)}`));
    partes.push(t(`gerada por ${nomeMotor(r.motor)}; confira antes de agir`, `generated by ${nomeMotor(r.motor)}; verify before acting`));
    return partes.join(" · ");
  };

  return (
    <div className="op-fundo" role="presentation" onClick={aoFechar}>
      <div className={`op-janela${larga ? " larga" : ""}`} role="dialog" aria-modal="true" aria-label={t("Analisar com LLM", "Analyze with an LLM")} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") aoFechar(); }}>
        <header><SupportIcon size={18} /><h3>{t("Analisar com LLM", "Analyze with an LLM")}{mostrando && estrutural && !incompleta && <span className="op-selo-pronta">{t("pronta", "ready")}</span>}</h3>
          {mostrando && <span className="op-acoes-topo">
            {estrutural && <button className="painel-link" onClick={() => baixar(pronta!)}><DownloadIcon size={14} />{t("Baixar PDF", "Download PDF")}</button>}
            {incompleta && ajuda.aoContinuar && <button className="painel-link" onClick={() => void rodar(true)}><ReplayIcon size={14} />{t("Continuar a análise", "Continue the analysis")}</button>}
            {enviado && <button className="painel-link" onClick={() => setVerEnviado((v) => !v)} aria-expanded={verEnviado} title={t(`Os dossiês como saíram (JSON, ${kbEnviado} KB)`, `The dossiers as they left (JSON, ${kbEnviado} KB)`)}><LockIcon size={14} />{t("O que foi enviado", "What was sent")}</button>}
            {uso?.ilimitado && <button className="painel-link" onClick={() => { setNova(true); setResultado(null); setFase("aceite"); setAceite(false); }}><AiIcon size={14} />{t("Nova análise", "New analysis")}</button>}
          </span>}
          <button className="aa-fechar" onClick={aoFechar} aria-label={t("Fechar", "Close")} autoFocus><XmarkIcon size={14} /></button></header>
        {fase === "andamento" ? <Progresso p={progresso} preco={precoConsulta} />
        : pronta && (fase === "pronta" || fase === "erro" || usada || incompleta) ? <>
          {estrutural && <p className="op-meta">{metaResultado(pronta)} · {t("guardada neste ambiente para os usuários liberados; para compartilhar, baixe o PDF", "stored in this environment for allowed users; to share it, download the PDF")}</p>}
          {fase === "erro" && msg && <p className="op-uso erro">{msg}</p>}
          {pronta.resultado.formato === "legado" ? <p>{t("Análise da versão anterior (só o texto).", "Analysis from the previous version (text only).")}</p>
            : incompleta ? <p>{t(`A análise parou no meio: ${pronta.resultado.estado.prontas} de ${pronta.resultado.estado.total} oportunidades prontas${pronta.resultado.estado.sintese ? "" : ", sem o resumo estrutural"}. Continuar roda só o que falta e não gasta outra análise.`, `The analysis stopped halfway: ${pronta.resultado.estado.prontas} of ${pronta.resultado.estado.total} opportunities ready${pronta.resultado.estado.sintese ? "" : ", without the structural summary"}. Continuing runs only what is missing and does not use another analysis.`)}</p>
            : usada && fase !== "pronta" ? <p>{t(`A análise por LLM foi feita em ${diaMes(uso!.usada!.quando)} por ${uso!.usada!.nome}.`, `The LLM analysis was done on ${diaMes(uso!.usada!.quando)} by ${uso!.usada!.nome}.`)}</p>
            : null}
          {verEnviado && enviado && <pre className="op-pre">{JSON.stringify(enviado, null, 1)}</pre>}
          {pronta.resultado.formato === "legado" ? <div className="op-analise"><Markdown>{pronta.resultado.markdown}</Markdown></div> : <ResultadoEstrutural r={pronta.resultado} />}
          <footer className="op-rodape-resultado"><span className="op-uso">{textoUso}</span><button className="op-botao" onClick={aoFechar}>{t("Fechar", "Close")}</button></footer>
        </> : usada ? <>
          <p>{t(`A análise por LLM foi feita em ${diaMes(uso!.usada!.quando)} por ${uso!.usada!.nome}.`, `The LLM analysis was done on ${diaMes(uso!.usada!.quando)} by ${uso!.usada!.nome}.`)}</p>
          <p className="op-uso">{textoUso}</p>
          <footer><button className="op-botao" onClick={aoFechar}>{t("Fechar", "Close")}</button></footer>
        </> : andamento ? <>
          <p>{t(`Uma análise deste ambiente está sendo gerada por ${uso!.emAndamento!.nome}. Abra de novo em alguns minutos.`, `An analysis for this environment is being generated by ${uso!.emAndamento!.nome}. Open it again in a few minutes.`)}</p>
          <footer><button className="op-botao" onClick={aoFechar}>{t("Fechar", "Close")}</button></footer>
        </> : <>
          <p>{t("Uma análise de causa raiz destas oportunidades, feita por um LLM configurado no app fora deste ambiente Dynatrace. Para cada uma, o app lê aqui as evidências e o LLM devolve o problema, a causa raiz, a solução e o benefício, com um resumo estrutural e um plano em ondas. Leva cerca de 3 minutos.", "A root cause analysis of these opportunities, by an LLM configured in the app outside this Dynatrace environment. For each one, the app reads the evidence here and the LLM returns the problem, the root cause, the solution and the benefit, with a structural summary and a plan in waves. It takes about 3 minutes.")}</p>
          <div className="op-bloco">
            <h4><CheckmarkIcon size={14} />{ajuda.oportunidades.length === 1 ? t("O que será analisado (1 oportunidade)", "What will be analyzed (1 opportunity)") : t(`O que será analisado (${ajuda.oportunidades.length} oportunidades)`, `What will be analyzed (${ajuda.oportunidades.length} opportunities)`)}</h4>
            <ol className="op-lista-num">{ajuda.oportunidades.map((o, i) => <li key={i}>{o.titulo}</li>)}</ol>
          </div>
          <div className="op-bloco">
            <h4><ServicesIcon size={14} />{t("O que será lido aqui e enviado, mascarado", "What will be read here and sent, masked")}</h4>
            <ul>
              <li>{t("uma amostra de até 10 chamadas com falha e 10 sem falha por endpoint e os spans só desses traces: cadeia de serviços, exceção e linha do código, tempos, banco e chamadas externas", "a sample of up to 10 failing and 10 successful calls per endpoint and the spans of those traces only: service chain, exception and code line, timings, database and external calls")}</li>
              <li>{t("métricas de serviço e de host, sessões por dia e erros por página (sem custo de leitura); problemas do Davis e eventos de deploy dos serviços", "service and host metrics, sessions per day and errors per page (no read cost); Davis problems and deployment events of the services")}</li>
              <li>{t("o que segura o LCP, erros de JavaScript e falhas do app, em até 4 leituras curtas do RUM; os números da tela, fluxos e jornadas", "what holds the LCP, JavaScript errors and app failures, in up to 4 short RUM reads; the on-screen numbers, flows and journeys")}</li>
            </ul>
            <p>{t(`Leitura com orçamento e medida no fim (bytes do Grail e o custo pelo preço de consulta em uso, o da Configuração › Consumo do app). Num ambiente grande, cerca de ${formatarInt(GIB_ANALISE)} GiB por análise (${formatarDinheiro(GIB_ANALISE * precoConsulta)}); teto de ${formatarInt(GIB_TETO)} GiB (${formatarDinheiro(GIB_TETO * precoConsulta)}).`,
              `Read with a budget and measured at the end (Grail bytes and the cost at the query price in use, the one in Configuration › App consumption). In a large environment, about ${formatarInt(GIB_ANALISE)} GiB per analysis (${formatarDinheiro(GIB_ANALISE * precoConsulta)}); ceiling of ${formatarInt(GIB_TETO)} GiB (${formatarDinheiro(GIB_TETO * precoConsulta)}).`)}</p>
          </div>
          <div className="op-bloco">
            <h4><LockIcon size={14} />{t("O que não sai daqui", "What never leaves")}</h4>
            <p>{t("Id de sessão, usuários e tags de usuário, IP, e-mail, CPF ou CNPJ, token, parâmetros de URL, ids nos caminhos, IDs de trace e de span e corpo de resposta do servidor. As evidências são verificadas aqui e de novo na função do app antes do envio.", "Session id, users and user tags, IP, e-mail, CPF or CNPJ, token, URL parameters, ids in paths, trace and span IDs and server response bodies. The evidence is checked here and again in the app function before sending.")}</p>
          </div>
          {estado?.erro && <p className="op-uso erro">{t(`Não deu para consultar o uso agora (${estado.erro}); a regra vale do mesmo jeito no envio.`, `Could not check the usage now (${estado.erro}); the rule still applies when sending.`)}</p>}
          {fase === "erro" && msg && <p className="op-uso erro">{msg}</p>}
          <p className="op-uso">{textoUso}</p>
          <label className="op-aceite"><input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />{t("Concordo com a leitura das evidências e o envio dos dossiês mascarados para o LLM.", "I agree to reading the evidence and sending the masked dossiers to the LLM.")}</label>
          <footer>
            <button className="op-botao primario" disabled={!aceite || !ajuda.oportunidades.length} onClick={() => void rodar(false)}>{fase === "erro" ? t("Tentar de novo", "Try again") : t("Coletar e pedir a análise", "Collect and request the analysis")}</button>
            <button className="op-botao" onClick={aoFechar}>{t("Cancelar", "Cancel")}</button>
          </footer>
        </>}
      </div>
    </div>
  );
};

/** O progresso: a coleta das evidências, cada oportunidade (em paralelo) e o resumo estrutural. */
const Progresso: React.FC<{ p: ProgressoLlm | null; preco: number }> = ({ p, preco }) => {
  const agora = Date.now(), total = p ? agora - p.inicio : 0;
  const estadoTexto = (estado: string, desde: number | null, ms: number | null, erro: string | null) => estado === "pronta" ? t(`pronta${ms != null ? ` · ${seg(ms)}` : ""}`, `ready${ms != null ? ` · ${seg(ms)}` : ""}`)
    : estado === "analisando" ? t(`analisando · ${seg(desde != null ? agora - desde : null)}`, `analyzing · ${seg(desde != null ? agora - desde : null)}`)
    : estado === "falhou" ? t(`não terminou: ${erro ?? ""}`, `did not finish: ${erro ?? ""}`) : t("na fila", "queued");
  const titulo = !p || p.fase === "coleta" ? t("Lendo as evidências no ambiente, com a sua identidade", "Reading the evidence in the environment, with your identity")
    : p.fase === "iniciando" ? t("Enviando os dossiês para o LLM", "Sending the dossiers to the LLM")
    : p.fase === "oportunidades" ? t("O LLM está analisando cada oportunidade", "The LLM is analyzing each opportunity")
    : t("O LLM está montando o resumo estrutural e o plano", "The LLM is building the structural summary and the plan");
  const c = p?.coleta;
  return (
    <div className="op-progresso" aria-live="polite">
      <AiLoadingIndicator>{`${titulo} · ${seg(total)}`}</AiLoadingIndicator>
      <ol className="op-passos">
        <li className={c?.etapa === "pronto" ? "pronta" : "analisando"}>
          <span className="op-passo-nome">{t("Evidências no ambiente", "Evidence in the environment")}</span>
          <span className="op-passo-estado">{c ? t(`${c.consultas} consultas · ${mb(c.bytes)} MB lidos${c.custoRs != null ? ` · ${formatarDinheiro((c.bytes / 1024 ** 3) * preco)}` : ""}`, `${c.consultas} queries · ${mb(c.bytes)} MB read${c.custoRs != null ? ` · ${formatarDinheiro((c.bytes / 1024 ** 3) * preco)}` : ""}`) : ""}</span>
        </li>
        {(p?.oportunidades ?? []).map((o) => (
          <li key={o.indice} className={o.estado}>
            <span className="op-passo-nome">{o.indice + 1}. {o.titulo}</span>
            <span className="op-passo-estado">{estadoTexto(o.estado, o.desde, o.ms, o.erro)}</span>
          </li>
        ))}
        <li className={p?.sintese.estado ?? "aguardando"}>
          <span className="op-passo-nome">{t("Resumo estrutural, prioridade e plano em ondas", "Structural summary, priority and plan in waves")}</span>
          <span className="op-passo-estado">{p ? estadoTexto(p.sintese.estado, p.sintese.desde, p.sintese.ms, p.sintese.erro) : ""}</span>
        </li>
      </ol>
      <p className="op-uso">{t("Leva cerca de 3 minutos. Se fechar a janela, o que já terminou fica guardado e dá para continuar depois.", "It takes about 3 minutes. If you close the window, what already finished is saved and you can continue later.")}</p>
    </div>
  );
};

/** O resultado (1.47.0, desenho aprovado no mock), do geral para o detalhe: o resumo em números (sessões por mês somando
   as oportunidades com medida, quantas causas comuns, por onde começar) e a primeira frase do resumo; as causas comuns em
   cartões; a ordem de ataque em tabela; o plano com duas ações por onda; cada oportunidade recolhida (aberta só a
   primeira da ordem) em quatro campos curtos; as iniciativas como etiquetas. O texto longo do modelo fica a um clique
   ("mais", "Ver o detalhe completo"): nada é cortado, só recolhido. Só campos da análise: nada é calculado além da soma e
   da contagem. */
const palavraEsforco = (e: "P" | "M" | "G") => ({ P: t("pequeno", "small"), M: t("médio", "medium"), G: t("grande", "large") })[e];
/** A primeira frase de um texto (até o primeiro ponto final seguido de espaço) e o resto, para o "mais". */
const primeiraFrase = (s: string): [string, string] => {
  const m = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(s.trim());
  return m ? [m[1], m[2]] : [s.trim(), ""];
};
const Mais: React.FC<{ rotulo: string; children: React.ReactNode }> = ({ rotulo, children }) => (
  <details className="op-mais"><summary>{rotulo}</summary>{children}</details>
);
const ResultadoEstrutural: React.FC<{ r: ResultadoLlm }> = ({ r }) => {
  const s = r.sintese;
  const porId = new Map(r.oportunidades.map((o) => [o.id, o]));
  const medidas = r.oportunidades.flatMap((o) => (o.resultado?.beneficio.sessoesRecuperadasMes != null ? [o.resultado.beneficio.sessoesRecuperadasMes] : []));
  const totalMes = medidas.length ? medidas.reduce((a, b) => a + b, 0) : null;
  const total = r.oportunidades.length;
  const causas = s?.causasComuns ?? [];
  const cobertas = new Set(causas.flatMap((c) => c.oportunidades)).size;
  const ordem = [...(s?.priorizacao ?? [])].sort((a, b) => a.ordem - b.ordem);
  const primeira = (ordem.length ? porId.get(ordem[0].id) : undefined) ?? r.oportunidades.find((o) => o.resultado);
  const acao = primeira?.resultado?.solucao.rapida[0]?.acao ?? null;
  const [fraseResumo, restoResumo] = primeiraFrase(s?.resumoExecutivo ?? "");
  return (
    <div className="op-analise op-resultado">
      <section className="op-res-bloco">
        <h5>{t("Resumo", "Summary")}</h5>
        <div className="op-res-numeros">
          {totalMes != null && <div className="op-res-num"><b>≈ {formatarInt(totalMes)}</b><span>{medidas.length === total ? t(`sessões por mês recuperáveis, somando as ${total} oportunidades`, `sessions per month recoverable, adding up the ${total} opportunities`) : t(`sessões por mês recuperáveis, somando as ${medidas.length} oportunidades com medida`, `sessions per month recoverable, adding up the ${medidas.length} opportunities with a measure`)}</span></div>}
          {causas.length > 0 && <div className="op-res-num"><b>{causas.length}</b><span>{causas.length === 1 ? t("causa comum explica", "common cause explains") : t("causas comuns explicam", "common causes explain")} {cobertas >= total ? t(`as ${total} oportunidades`, `all ${total} opportunities`) : t(`${cobertas} de ${total} oportunidades`, `${cobertas} of ${total} opportunities`)}</span></div>}
          {primeira && <div className="op-res-num acao"><span>{t("Começar por", "Start with")}</span><b>{acao ?? primeira.titulo}</b>{acao && <span>{t("oportunidade", "opportunity")} {nOp(primeira.id)}: {primeira.titulo}</span>}</div>}
        </div>
        {fraseResumo && <p className="op-res-frase">{fraseResumo}</p>}
        {restoResumo && <Mais rotulo={t("Ler o resumo inteiro", "Read the whole summary")}><p className="op-res-frase">{restoResumo}</p></Mais>}
      </section>
      {causas.length > 0 && <section className="op-res-bloco">
        <h5>{t("Causas comuns", "Common causes")}</h5>
        <div className="op-res-causas">{causas.map((c, i) => (
          <article key={i} className="op-res-causa">
            <b>{c.causa}</b>
            <div className="op-res-chips">
              {c.oportunidades.length > 0 && <span className="op-chip">{rotOps(c.oportunidades)}</span>}
              <span className={`op-chip conf-${c.confianca}`}>{textoConfianca(c.confianca)}</span>
              {c.beneficioSessoesMes != null && <span className="op-chip impacto">{t(`≈ ${formatarInt(c.beneficioSessoesMes)} sessões por mês`, `≈ ${formatarInt(c.beneficioSessoesMes)} sessions per month`)}</span>}
            </div>
            <p><span className="op-sub">{t("O que fazer", "What to do")}:</span> {c.mudancaEstrutural}</p>
            {(c.evidencias.length > 0 || c.oQueSepara) && <details className="op-detalhe">
              <summary>{t(`Ver as evidências (${c.evidencias.length})`, `See the evidence (${c.evidencias.length})`)}</summary>
              {c.evidencias.length > 0 && <ul>{c.evidencias.map((e, k) => <li key={k}>{e}</li>)}</ul>}
              {c.oQueSepara && <p className="op-sub">{t("O que a distingue", "What sets it apart")}: {c.oQueSepara}</p>}
            </details>}
          </article>))}</div>
      </section>}
      {ordem.length > 0 && <section className="op-res-bloco">
        <h5>{t("Por onde começar", "Where to start")}</h5>
        <div className="op-res-rolagem"><table className="op-res-tabela">
          <thead><tr><th aria-label={t("Ordem", "Order")} /><th>{t("Oportunidade", "Opportunity")}</th><th>{t("Benefício", "Benefit")}</th><th>{t("Esforço", "Effort")}</th><th>{t("Por quê", "Why")}</th></tr></thead>
          <tbody>{ordem.map((p, i) => {
            const o = porId.get(p.id), x = o?.resultado;
            const [porQue, resto] = primeiraFrase(p.razao);
            return (
              <tr key={p.id}>
                <td><span className="op-ordem pequena">{i + 1}</span></td>
                <td>{o?.titulo ?? p.id} <span className="op-sub">· {t("op.", "opp.")} {nOp(p.id)}</span></td>
                <td className="op-res-n">{x?.beneficio.sessoesRecuperadasMes != null ? t(`${formatarInt(x.beneficio.sessoesRecuperadasMes)} sessões por mês`, `${formatarInt(x.beneficio.sessoesRecuperadasMes)} sessions per month`) : <span className="op-sub">{t("sem medida", "no measure")}</span>}</td>
                <td>{x && <span className={`op-chip esf-${x.esforco.nivel}`} title={textoEsforco(x.esforco.nivel)}>{palavraEsforco(x.esforco.nivel)}</span>}</td>
                <td title={resto ? p.razao : undefined}>{porQue}{resto ? " …" : ""}</td>
              </tr>);
          })}</tbody>
        </table></div>
      </section>}
      {s && s.ondas.length > 0 && <section className="op-res-bloco">
        <h5>{t("Plano", "Plan")}</h5>
        <div className="op-ondas">{(["30", "60", "90"] as const).map((onda) => s.ondas.filter((w) => w.onda === onda).map((w, i) => {
          const resto = w.acoes.slice(2);
          return (
            <div key={`${onda}${i}`} className="op-onda"><b>{onda} {t("dias", "days")}</b><span className="op-sub">{w.objetivo}</span>
              <ul>{w.acoes.slice(0, 2).map((a, k) => <li key={k}>{a}</li>)}</ul>
              {(resto.length > 0 || w.indicadorDef) && <Mais rotulo={resto.length ? (resto.length === 1 ? t("mais 1 ação", "1 more action") : t(`mais ${resto.length} ações`, `${resto.length} more actions`)) : t("como provar", "how to prove it")}>
                {resto.length > 0 && <ul>{resto.map((a, k) => <li key={k}>{a}</li>)}</ul>}
                {w.indicadorDef && <span className="op-onda-prova">{t("Prova no app", "Proof in the app")}: {w.indicadorDef}</span>}
              </Mais>}
            </div>);
        }))}</div>
      </section>}
      <section className="op-res-bloco">
        <h5>{t("Cada oportunidade", "Each opportunity")}</h5>
        <div className="op-res-ops">{r.oportunidades.map((o) => <CartaoPcsb key={o.indice} o={o} aberto={o === primeira} />)}</div>
      </section>
      {s && s.iniciativasRecomendadas.length > 0 && <section className="op-res-bloco">
        <h5>{t("Iniciativas recomendadas", "Recommended initiatives")}</h5>
        <div className="op-res-chips">{s.iniciativasRecomendadas.map((a) => <span key={a.servico} className="op-chip op-inic" title={`${a.oportunidades.length ? `${rotOps(a.oportunidades)}: ` : ""}${a.comoAjuda}`}>{t(a.nomeServico, a.nomeServicoEn ?? a.nomeServico)}</span>)}</div>
      </section>}
    </div>
  );
};
/** Uma oportunidade recolhida (o título e o esforço); aberta, quatro campos curtos (problema, causa raiz com a confiança,
   correção rápida, benefício) e o detalhe completo a um clique. */
const CartaoPcsb: React.FC<{ o: OportunidadeAnalisada; aberto?: boolean }> = ({ o, aberto }) => {
  const x = o.resultado;
  const rapida = x?.solucao.rapida[0] ?? null;
  return (
    <details className="op-pcsb" open={aberto}>
      <summary>
        <span className="op-ordem pequena">{o.indice + 1}</span><b>{o.titulo}</b>
        {x && <span className={`op-chip esf-${x.esforco.nivel}`} title={textoEsforco(x.esforco.nivel)}>{palavraEsforco(x.esforco.nivel)}</span>}
      </summary>
      <div className="op-pcsb-corpo">
      {!x ? <p className="op-uso erro">{o.estado === "erro" ? t(`Não foi analisada: ${o.erro?.mensagem ?? ""}`, `Not analyzed: ${o.erro?.mensagem ?? ""}`) : t("Ainda não analisada.", "Not analyzed yet.")}</p> : <>
        <div className="op-grade op-grade-curta">
          <div><h6>{t("Problema", "Problem")}</h6><p>{x.problema.resumo}</p></div>
          <div><h6>{t("Causa raiz", "Root cause")} <span className={`op-chip conf-${x.causaRaiz.confianca}`}>{textoConfianca(x.causaRaiz.confianca)}</span></h6><p>{x.causaRaiz.afirmacao}</p></div>
          <div><h6>{rapida ? t("Correção rápida", "Quick fix") : t("Correção", "Fix")}</h6><p>{rapida?.acao ?? x.solucao.estrutural[0]?.acao ?? t("sem correção sugerida", "no fix suggested")}</p></div>
          <div><h6>{t("Benefício", "Benefit")}</h6>
            <p>{x.beneficio.sessoesRecuperadasMes != null ? t(`≈ ${formatarInt(x.beneficio.sessoesRecuperadasMes)} sessões por mês`, `≈ ${formatarInt(x.beneficio.sessoesRecuperadasMes)} sessions per month`) : t("sem medida para recuperar sessões", "no measure to recover sessions")}
              {x.beneficio.conversaoAtualPct != null && x.beneficio.conversaoEsperadaPct != null ? t(`; conversão de ${x.beneficio.conversaoAtualPct}% para ${x.beneficio.conversaoEsperadaPct}%`, `; conversion from ${x.beneficio.conversaoAtualPct}% to ${x.beneficio.conversaoEsperadaPct}%`) : ""}</p></div>
        </div>
        <details className="op-detalhe">
          <summary>{t("Ver o detalhe completo: números, soluções, cadeia de evidências e como provar no app", "See the full detail: numbers, solutions, evidence chain and how to prove it in the app")}</summary>
          {x.problema.numerosChave.length > 0 && <p><b>{t("Números", "Numbers")}:</b> {x.problema.numerosChave.join(" · ")}</p>}
          <p><b>{t("Causa estrutural", "Structural cause")}:</b> {x.causaRaiz.causaEstrutural}</p>
          {x.solucao.rapida.map((a, i) => <p key={`r${i}`}><b>{t("Rápida", "Quick")}:</b> {a.acao} <span className="op-sub">({a.onde}; {a.prazo})</span></p>)}
          {x.solucao.estrutural.map((a, i) => <p key={`e${i}`}><b>{t("Estrutural", "Structural")}:</b> {a.acao}</p>)}
          {x.beneficio.conta && <p><b>{t("Conta do benefício", "Benefit math")}:</b> {x.beneficio.conta}</p>}
          <ol>{x.causaRaiz.cadeia.map((e, i) => <li key={i}>{e.evidencia}{e.prova ? `: ${e.prova}` : ""} <span className="op-sub">({e.fonte})</span></li>)}</ol>
          {x.causaRaiz.descartadas.length > 0 && <p><b>{t("Descartadas", "Ruled out")}:</b> {x.causaRaiz.descartadas.map((h) => `${h.hipotese} (${h.porQue})`).join("; ")}</p>}
          {x.causaRaiz.emAberto.length > 0 && <p><b>{t("Em aberto", "Open")}:</b> {x.causaRaiz.emAberto.map((h) => `${h.hipotese} (${h.comoConfirmar})`).join("; ")}</p>}
          <p><b>{t("Prova no app", "Proof in the app")}:</b> {x.validacao.indicadorDef} ({t("hoje", "today")} {x.validacao.linhaDeBase}; {t("meta", "target")} {x.validacao.meta})</p>
          {x.beneficio.naoMedido && <p className="op-sub">{t("Não medido", "Not measured")}: {x.beneficio.naoMedido}</p>}
          {x.riscos.length > 0 && <p className="op-sub">{t("Riscos", "Risks")}: {x.riscos.join("; ")}</p>}
        </details>
      </>}
      </div>
    </details>
  );
};
