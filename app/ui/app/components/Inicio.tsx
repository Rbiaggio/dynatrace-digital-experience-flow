import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AppInfo, Grafo } from "../lib/graph";
import { formatarDec, formatarInt, formatarMs } from "../lib/graph";
import { problemasComErros, type Inicio as DadosInicio, type PaginaInicio } from "../lib/inicio";
import type { Destaque } from "../lib/destaques";
import { avaliarQualidade, type LinhaQualidade } from "../lib/qualidade";
import { t } from "../lib/i18n";
import { entidadeDaApp, hrefErrosPagina } from "./Links";
import { ListaSessoes, type FiltroSessoes } from "./ListaSessoes";
import type { SessaoLenta } from "./ListaSessoes";
import { Problemas } from "./InicioProblemas";
import { Fluxos } from "./InicioFluxos";
import { CartaoExperiencia } from "./InicioExperiencia";
import { CartoesMapas, type FiltroLugar } from "./InicioMapas";
import { InicioOportunidades, type AjudaLlm } from "./InicioOportunidades";
import { avaliarOportunidades, numerosVisaoGeral, type EntradaOportunidades, type JornadaOp, type LinhaChamadaEstado, type LinhaTerceiro, type OrigemOp } from "../lib/oportunidades";
import { origemJaLida, ouvirOrigens } from "../lib/evidencias";
import { analisarComLlm, continuarAnalise, mensagemDoErro, usoDaTela, type FabricaLlm, type ProgressoLlm, type ResultadoLlm } from "../lib/llmCliente";
import type { ColetaDossie } from "../lib/dossie";
import { MAX_OPORTUNIDADES } from "../lib/llmPacote";
import { falhasMobile, sessoesNaJanela, textoNota, type Apdex, type ApdexMobile } from "../lib/apdex";
import { ufDe, type LinhaApdexLugar, type LinhaLugar } from "../lib/lugares";
import { ChipApp } from "./ChipApp";
import { semTempoRealEmUso, fimDosAgregados } from "../lib/agregados";
import type { AbaPagina } from "./DetailPanel";
import { IconeTipo } from "./FlowGraph";
import { DocumentStackIcon, GroupIcon, LogoutIcon, RepairIcon, UserSessionsIcon, WarningIcon } from "@dynatrace/strato-icons";

/** Tela inicial (Visão geral): o impacto no cliente antes do mapa, em linguagem simples. Ordem:
    1) os números (sessões, páginas por sessão, sessões com erro e quem saiu depois do erro, com a lista das sessões);
       logo abaixo, a experiência (Apdex de Web Vitals, com as páginas que mais o puxam para baixo) e os dois mapas:
       onde estão os clientes e onde acontecem os erros (clicar num lugar filtra a visão geral por ele);
    2) o que está afetando os clientes (um cartão por problema: impacto, o que acontece, o que fazer, quem faz);
    3) os principais fluxos como funil (onde chegam, onde erram, onde desistem);
    4) as páginas mais visitadas; 5) o que falta no monitoramento para ver o fluxo inteiro.
    Cada item abre o Flow no ponto certo. Vermelho só para erro. */

interface Props {
  /** 1.43: as sessões das 3 requisições mais lentas das 24 horas analisadas (lista de exemplos) */
  lerLentas?: () => Promise<SessaoLenta[]>;
  /** "Analisar com o Dynatrace Assist" nos cartões (só no Preview do lab) */
  assist?: boolean;
  apps: AppInfo[];
  app: string;                       // TODAS = "*"
  todas: string;
  janela: string;
  robos: boolean;
  versao: number;                    // botão Atualizar
  barra: React.ReactNode;            // aplicação, filtro, período e refresh (os mesmos do Flow)
  dados: DadosInicio | null;
  carregando: boolean;
  erro: string | null;
  semCopia: boolean;
  grafo: Grafo;
  qualidade: LinhaQualidade[];
  aoEscolherApp: (id: string) => void;
  aoAbrirFluxo: () => void;
  aoDestacar: (d: Destaque) => void;
  aoAbrirPagina: (app: string, view: string, aba?: AbaPagina) => void;
  /** Apdex de Web Vitals (lib/apdex.ts, consulta de métrica, grátis); null = lendo ou sem leitura */
  apdex?: Apdex | null;
  /** Apdex mobile (agregados do DEF, lib/agregados.ts, qApdexMobileAgregado); null = sem app mobile no escopo, lendo ou sem leitura */
  apdexMobile?: ApdexMobile | null;
  carregandoApdex?: boolean;
  /** aplicações do escopo sem o filtro de lugar (o Apdex não tem lugar); sem ela, as da tela */
  appsApdex?: AppInfo[];
  /** período do cartão do Apdex ("7d" quando quem usa pediu 7 dias por falta de medição no período da página) */
  janelaApdex?: string;
  aoTrocarJanelaApdex?: (j: string | null) => void;
  /** filtro de país e região em uso, para marcar o lugar escolhido nos mapas */
  filtroLugar?: { pais?: string; regiao?: string };
  /** com um lugar escolhido: os lugares do mesmo escopo SEM o filtro de lugar (os mapas continuam inteiros, o escolhido
      marcado); null = ainda não lidos (os mapas mostram só o que veio com o filtro) */
  lugaresBase?: LinhaLugar[] | null;
  /** Apdex por lugar (APX-04), a cor do mapa "Onde estão os clientes" */
  apdexLugares?: LinhaApdexLugar[] | null;
  /** clique num lugar dos mapas: aplica o filtro de país/região (o mesmo lugar de novo, ou null, tira) */
  aoFiltrarLugar?: (f: FiltroLugar | null) => void;
  /** modo inicial do mapa de erros (a prévia abre direto em "erros") */
  modoErros?: "sessoes" | "erros";
  /** Oportunidades de melhoria: as jornadas salvas do escopo com o funil que o FUN-T já leu (null = ainda lendo) */
  jornadas?: JornadaOp[] | null;
  /** chamadas por endpoint e estado e terceiros, da mesma leitura da qualidade (QUA-U); null = sem dado (regras "sem dado") */
  chamadas?: LinhaChamadaEstado[] | null;
  terceiros?: LinhaTerceiro[] | null;
  /** "Analisar com LLM" (montagem do pacote e as duas etapas da função); null = desligado neste ambiente */
  llm?: FabricaLlm | null;
}

const pctTexto = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);
/** Cores das fatias do gráfico de páginas (sem vermelho: vermelho é só para erro). */
const CORES = ["#1966FF", "#00A3E0", "#00B39B", "#7C5CFF", "#F2A900", "#E05FB3"];
const COR_OUTRAS = "var(--sc-outras)";

export const Inicio: React.FC<Props> = ({ lerLentas, assist, apps, app, todas, janela, robos, versao, barra, dados, carregando, erro, semCopia, grafo, qualidade, aoEscolherApp, aoAbrirFluxo, aoDestacar, aoAbrirPagina,
                                          apdex = null, apdexMobile = null, carregandoApdex = false, appsApdex, janelaApdex, aoTrocarJanelaApdex, filtroLugar, lugaresBase, apdexLugares = null, aoFiltrarLugar, modoErros,
                                          jornadas = null, chamadas = null, terceiros = null, llm = null }) => {
  const nomeApp = (id: string | null) => apps.find((a) => a.id === id)?.nome ?? id ?? "";
  const umaApp = app !== todas;
  const multi = !umaApp && (dados?.porApp.length ?? 0) > 1;
  const titulo = umaApp ? nomeApp(app) : t("Todas as aplicações", "All applications");
  const ajustes = useMemo(() => avaliarQualidade(grafo, qualidade, nomeApp), [grafo, qualidade, apps, t("pt", "en")]);   // eslint-disable-line react-hooks/exhaustive-deps
  const tot = dados?.total;
  // lista de sessões com erro: aberta pelos indicadores vermelhos ou pelo "Ver sessões" de um problema
  const [sessoes, setSessoes] = useState<FiltroSessoes | null>(null);
  const refSessoes = useRef<HTMLDivElement>(null);
  useEffect(() => { setSessoes(null); }, [app, janela]);
  useEffect(() => { if (sessoes) refSessoes.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [sessoes?.soSaiu, sessoes?.view]);
  const alternarSessoes = (f: FiltroSessoes) => setSessoes((atual) => (atual && atual.soSaiu === f.soSaiu && !atual.view ? null : f));
  const erroDaPagina = (appP: string, view: string) => dados?.erros.find((e) => e.app === appP && e.paginas.includes(view)) ?? null;
  // escopo "Todas as aplicações": cada item leva a etiqueta da aplicação
  const chipApp = multi ? (id: string) => <ChipApp apps={apps} id={id} /> : null;
  // resumo de cada seção no cabeçalho: dá para saber se vale abrir sem abrir. "Desistiram" e "não concluíram" têm uma
  // definição só (lib/oportunidades.ts numerosVisaoGeral), a mesma das Oportunidades de melhoria
  const { desistiram, naoConcluiram } = dados ? numerosVisaoGeral(dados) : { desistiram: 0, naoConcluiram: 0 };
  const fluxosComErro = dados ? dados.caminhos.filter((c) => c.comErro.some((x) => x > 0)).length : 0;
  const maisVista = dados?.maisVisitadas[0];

  // Oportunidades de melhoria: as regras (lib/oportunidades.ts) sobre o que a tela já leu, sem consulta. O "Onde falha no
  // backend?" entra quando alguém já o abriu (nesta aba, neste escopo, nos últimos 5 min): ouvirOrigens recalcula
  const [origensLidas, setOrigensLidas] = useState(0);
  useEffect(() => ouvirOrigens(() => setOrigensLidas((v) => v + 1)), []);
  const comLugar = !!(filtroLugar?.pais || filtroLugar?.regiao);
  const entradaOp = useMemo<Omit<EntradaOportunidades, "inicio">>(() => {
    const mob = apdexMobile && apdexMobile.estado === "ok" ? apdexMobile : null;
    // crash e ANR por sessão: as sessões na mesma janela dos crashes (sessoesNaJanela); com filtro de lugar ou em outra janela,
    // sem taxa (a métrica não tem lugar)
    const sessoes = sessoesNaJanela(dados, janelaApdex ?? janela, janela);
    // abertura do app (métrica nativa, já lida pelo Apdex mobile): por tipo, sem a aplicação; só com uma app mobile no escopo
    const aberturas = mob && mob.apps.length === 1 ? mob.aberturasPorTipo.filter((a) => a.p75Ms != null && a.n > 0).map((a) => ({ app: mob.apps[0].app, tipo: a.tipo, n: a.n, p75Ms: a.p75Ms!, lentas: null, acima5s: null })) : null;
    const backend: OrigemOp[] = (dados?.problemas ?? []).filter((p) => p.view).map((p) => ({ app: p.app, view: p.view!, origem: origemJaLida(p.app, p.view!, janela, robos) })).filter((o) => o.origem);
    return {
      apps: apps.map((a) => ({ id: a.id, nome: a.nome, canal: a.canal })),
      qualidade, apdex, ajustesExistentes: ajustes, ufDe,
      jornadas: jornadas ?? null, backend: backend.length ? backend : null,
      chamadas: chamadas ?? null, terceiros: terceiros ?? null, vitais: null,
      mobile: mob ? { falhas: comLugar ? null : falhasMobile(mob, sessoes), aberturas } : null,
    };
  }, [apps, qualidade, apdex, apdexMobile, ajustes, jornadas, chamadas, terceiros, dados, janela, janelaApdex, robos, comLugar, origensLidas]);
  const op = useMemo(() => (dados ? avaliarOportunidades({ ...entradaOp, inicio: dados }) : null), [dados, entradaOp, t("pt", "en")]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Apdex mobile como o relatório mostra (o do cartão de experiência)
  const apdexMobileOp = apdexMobile && apdexMobile.estado === "ok" && apdexMobile.apdex != null && apdexMobile.nota
    ? { apdex: apdexMobile.apdex, nota: textoNota(apdexMobile.nota), validar: apdexMobile.porTelas ? t("pelas telas", "by screens") : null } : null;
  // "Analisar com LLM": as oportunidades na ordem da tela; a coleta dos dossiês só quando alguém pede; as
  // oportunidades em paralelo e a síntese (lib/llmCliente.ts), com a retomada pelo status
  const parcialLlm = useRef<ResultadoLlm | null>(null);
  const coletaLlm = useRef<ColetaDossie | null>(null);
  const ajudaLlm = useMemo<AjudaLlm | null>(() => {
    if (!llm || !op) return null;
    const pronta = (r: ResultadoLlm | null) => (r ? { resultado: r, quando: r.quando, por: { nome: r.por.nome } } : null);
    const fim = (p: ProgressoLlm) => {
      if (p.resultado) parcialLlm.current = p.resultado;
      return { ok: p.fase === "pronto", mensagem: p.erro ? mensagemDoErro(p.erro) : undefined, uso: usoDaTela(p.uso), analise: pronta(p.resultado) };
    };
    return {
      oportunidades: op.itens.slice(0, MAX_OPORTUNIDADES).map((o) => ({ titulo: o.titulo })), contato: llm.contato,
      enviado: () => coletaLlm.current?.dossies ?? null,
      aoConsultarUso: async () => {
        const s = await llm.statusLlm();
        if (!s.ok) return { ok: false, mensagem: mensagemDoErro(s) };
        if (s.analise) parcialLlm.current = s.analise;
        return { ok: true, uso: usoDaTela(s.uso, (s as { llmConfigurado?: boolean }).llmConfigurado !== false)!, analise: pronta(s.analise) };
      },
      aoPedirAnalise: async (aoProgresso) => fim(await analisarComLlm(async (cb) => {
        const c = await llm.coletar({ oportunidades: op.itens, jornadas: jornadas ?? null, chamadas: chamadas ?? null }, cb);
        coletaLlm.current = c;
        return c;
      }, aoProgresso, { idioma: llm.idioma })),
      aoContinuar: async (aoProgresso) => {
        const parcial = parcialLlm.current;
        if (!parcial) return { ok: false, mensagem: t("A análise não foi encontrada neste ambiente. Comece uma nova.", "The analysis was not found in this environment. Start a new one."), analise: null };
        return fim(await continuarAnalise(parcial, aoProgresso, { idioma: llm.idioma }));
      },
    };
  }, [llm, op, jornadas, chamadas]);
  // "Para ver o fluxo completo": os ajustes de hoje e os novos das oportunidades (Q1, Q2 e W8 que ainda não estavam)
  const ajustesTela = [...ajustes, ...(op?.ajustes ?? [])];

  return (
    <div className="inicio">
      <div className="in-topo">
        <div className="in-titulo">
          <h2 title={titulo}>{titulo}</h2>
          <span>{t("Como os clientes usam a aplicação, o que os está afetando e o que fazer.", "How customers use the application, what is affecting them and what to do.")}</span>
          {janela === "7d" && !dados?.periodos && <span className="in-aviso-periodo">{t("Em 7 dias, o Apdex e a cor do mapa \"Onde estão os clientes\" somam os 7 dias; os números por sessão cobrem as últimas 24 horas, que é o que a cópia das sessões guarda.", "Over 7 days, the Apdex and the color of the \"Where customers are\" map add up the 7 days; the per-session numbers cover the last 24 hours, which is what the session copy keeps.")}</span>}
        </div>
        <div className="in-topo-acoes">
          <div className="in-barra" role="toolbar" aria-label={t("Escopo", "Scope")}>{barra}</div>
        </div>
      </div>

      {erro ? <p className="in-estado erro">{t("Erro", "Error")}: {erro}</p>
        : semCopia ? <p className="in-estado">{t("A visão geral lê a cópia das sessões do Digital Experience Flow, que não está ligada neste ambiente. Abra o Flow, ou peça a um administrador para ligar em Configuração.", "The overview reads the session copy of the Digital Experience Flow, which is not enabled in this environment. Open the Flow, or ask an administrator to enable it in Configuration.")}</p>
        : !dados ? <p className="in-estado">{carregando ? t("Lendo as sessões…", "Reading the sessions…") : t("Ainda sem dados.", "No data yet.")}</p>
        : tot && tot.sessoes === 0 ? <p className="in-estado">{t("Nenhuma sessão neste período para a aplicação escolhida.", "No sessions in this timeframe for the selected application.")}</p>
        : tot && <>
          {dados.periodos && <p className="in-periodos">{legendaPeriodos(dados.periodos)}</p>}
          <div className="in-kpis">
            <Kpi icone={<UserSessionsIcon size={16} />} rotulo={t("Sessões", "Sessions")} valor={formatarInt(tot.sessoes)} nota={t(`${formatarInt(tot.navs)} páginas vistas`, `${formatarInt(tot.navs)} page views`)} />
            <Kpi icone={<DocumentStackIcon size={16} />} rotulo={t("Páginas por sessão", "Pages per session")} valor={formatarDec(tot.paginasPorSessao)} nota={t(`${pctTexto(tot.pctUmaPagina)} viram uma página só`, `${pctTexto(tot.pctUmaPagina)} saw only one page`)} />
            <Kpi icone={<WarningIcon size={16} />} rotulo={t("Sessões com erro", "Sessions with errors")} valor={pctTexto(tot.pctComErro)} nota={t(`${formatarInt(tot.comErro)} sessões tiveram pelo menos um erro`, `${formatarInt(tot.comErro)} sessions had at least one error`)}
                 critico={tot.comErro > 0} acao={tot.comErro > 0 ? t("Ver as sessões ›", "See the sessions ›") : undefined} ativo={!!sessoes && !sessoes.soSaiu && !sessoes.view}
                 aoClicar={tot.comErro > 0 ? () => alternarSessoes({ soSaiu: false }) : undefined} />
            <Kpi icone={<LogoutIcon size={16} />} rotulo={t("Saíram após um erro", "Left after an error")} valor={pctTexto(tot.pctSaiuComErro)} nota={t(`${formatarInt(tot.saiuComErro)} sessões terminaram na página onde o erro aconteceu`, `${formatarInt(tot.saiuComErro)} sessions ended on the page where the error happened`)}
                 critico={tot.saiuComErro > 0} acao={tot.saiuComErro > 0 ? t("Ver as sessões ›", "See the sessions ›") : undefined} ativo={!!sessoes && sessoes.soSaiu && !sessoes.view}
                 aoClicar={tot.saiuComErro > 0 ? () => alternarSessoes({ soSaiu: true }) : undefined} />
          </div>

          {sessoes && (
            <div ref={refSessoes}>
              <ListaSessoes app={app} todas={todas} apps={apps} janela={janela} robos={robos} versao={versao} filtro={sessoes} totais={{ comErro: tot.comErro, saiu: tot.saiuComErro }}
                            aoMudar={setSessoes} aoFechar={() => setSessoes(null)} aoAbrirPagina={aoAbrirPagina}
                            linhasProntas={dados.periodos ? dados.sessoesHora : undefined} lerLentas={dados.periodos ? lerLentas : undefined} />
            </div>
          )}

          {(() => {
            // experiência e mapas: uma linha logo abaixo dos indicadores (o Apdex sai quando o escopo não tem página web)
            // o cartão aparece sempre que o escopo tem página web; sem medição, ele diz o motivo, o que fazer e quem faz
            // com app mobile no escopo, o cartão aparece também sem página web (o Apdex mobile tem régua própria)
            const appsDoCartao = (appsApdex ?? apps).filter((a) => !umaApp || a.id === app);
            const idsMobile = new Set(appsDoCartao.filter((a) => a.canal === "mobile").map((a) => a.id));
            const temMobile = idsMobile.size > 0 && !!apdexMobile;
            const comApdex = (apdex ? apdex.estado !== "so-mobile" : carregandoApdex) || temMobile;
            // taxa de crash: sessões das aplicações mobile no mesmo período (sem filtro de lugar: o Apdex não tem lugar)
            // as sessões na mesma janela dos crashes (lib/apdex.ts sessoesNaJanela); em outra janela, sem taxa
            const naJanela = filtroLugar?.pais || filtroLugar?.regiao ? null : sessoesNaJanela(dados, janelaApdex ?? janela, janela);
            const sessoesMobile = naJanela ? [...naJanela].filter(([a]) => idsMobile.has(a)).reduce((x, [, n]) => x + n, 0) || null : null;
            const lugares = (filtroLugar?.pais || filtroLugar?.regiao) && lugaresBase?.length ? lugaresBase : dados.lugares ?? [];
            const comMapa = !!aoFiltrarLugar && lugares.some((l) => l.sessoes > 0);
            if (!comApdex && !comMapa) return null;
            return (
              <div className={`ex-linha${comApdex ? "" : " sem-apdex"}${comMapa ? "" : " so-apdex"}`}>
                {comApdex && <CartaoExperiencia apdex={apdex} mobile={apdexMobile} temMobile={temMobile} sessoesMobile={sessoesMobile} carregando={carregandoApdex} apps={appsApdex ?? apps} multi={multi}
                                                janela={janelaApdex ?? janela} janelaPagina={janela} aoTrocarJanela={(j) => aoTrocarJanelaApdex?.(j)} aoEscolherApp={aoEscolherApp} aoAbrirPagina={aoAbrirPagina} />}
                {comMapa && aoFiltrarLugar && <CartoesMapas lugares={lugares} filtro={filtroLugar ?? {}} aoFiltrar={aoFiltrarLugar} modoErros={modoErros} apdexLugares={apdexLugares} ultimaHora={!!dados.periodos?.ultimaHora} />}
              </div>
            );
          })()}

          {!umaApp && dados.porApp.length > 0 && (
            <Cartao aberto titulo={t("Aplicações", "Applications")} nota={`${dados.periodos?.ultimaHora ? `${t("última hora", "last hour")} · ` : ""}${t("clique numa para ver os indicadores dela", "click one to see its indicators")}`}
                    resumo={<span className="in-resumo">{t(`${dados.porApp.length} aplicações`, `${dados.porApp.length} applications`)}</span>}>
              <table className="in-tabela">
                <thead><tr><th>{t("Aplicação", "Application")}</th><th>{t("Sessões", "Sessions")}</th><th>{t("Páginas por sessão", "Pages per session")}</th><th>{t("Sessões com erro", "Sessions with errors")}</th><th>{t("Saíram após um erro", "Left after an error")}</th></tr></thead>
                <tbody>
                  {dados.porApp.map((a) => (
                    <tr key={a.app} onClick={() => aoEscolherApp(a.app)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") aoEscolherApp(a.app); }}>
                      <td><button className="painel-link in-app-nome"><IconeTipo no={{ tipo: "app", canal: apps.find((x) => x.id === a.app)?.canal ?? "web" }} tamanho={14} />{nomeApp(a.app)}</button></td>
                      <td>{formatarInt(a.sessoes)}</td>
                      <td>{formatarDec(a.paginasPorSessao)}</td>
                      <td><Medidor pct={a.pctComErro} ativo={a.comErro > 0} /></td>
                      <td><Medidor pct={a.pctSaiuComErro} ativo={a.saiuComErro > 0} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Cartao>
          )}

          <Cartao titulo={t("O que está afetando os clientes", "What is affecting customers")}
                  resumo={dados.problemas.length === 0 ? <span className="in-resumo">{t("nenhuma página com erro", "no page with errors")}</span>
                    : <>{desistiram > 0 && <span className="pb-selo grave">{t(`${formatarInt(desistiram)} desistiram após um erro`, `${formatarInt(desistiram)} gave up after an error`)}</span>}
                        {naoConcluiram > 0 && <span className="pb-selo grave">{t(`${formatarInt(naoConcluiram)} não concluíram por erro`, `${formatarInt(naoConcluiram)} did not complete due to an error`)}</span>}
                        <span className="pb-selo">{dados.problemas.length === 1 ? t("1 página com erro", "1 page with errors") : t(`${dados.problemas.length} páginas com erro`, `${dados.problemas.length} pages with errors`)}</span></>} nota={`${dados.periodos?.dia ? `${t("erros do período escolhido, ao vivo; saídas das últimas 24 h", "errors from the chosen timeframe, live; exits from the last 24 h")} · ` : ""}${t("do maior impacto para o menor · cada item diz o que fazer e quem faz", "from the biggest impact to the smallest · each item says what to do and who does it")}`}>
            <Problemas problemas={problemasComErros(dados)} caminhos={dados.caminhos} series={dados.series} geradoEm={dados.geradoEm} periodoImpacto={dados.periodos?.dia ?? null} assist={assist} grafo={grafo} apps={apps} janela={janela} robos={robos} chipApp={chipApp}
                       aoVerSessoes={setSessoes} aoDestacar={aoDestacar} aoAbrirPagina={aoAbrirPagina} />
          </Cartao>

          <InicioOportunidades dados={dados} resultado={op} entrada={entradaOp} apps={apps} app={app} todas={todas} janela={janela} robos={robos} assist={assist}
                               aoVerSessoes={(p) => setSessoes({ soSaiu: false, view: p.view, appView: p.app })} aoAbrirPagina={aoAbrirPagina}
                               llm={ajudaLlm} apdexMobile={apdexMobileOp} carregando={carregando} />

          <Cartao titulo={t("Principais fluxos", "Main flows")}
                  resumo={<>{fluxosComErro > 0 && <span className="pb-selo">{t(`${fluxosComErro} com etapa com erro`, `${fluxosComErro} with a failing step`)}</span>}
                            <span className="in-resumo">{t(`${dados.caminhos.length} fluxos`, `${dados.caminhos.length} flows`)}</span></>} nota={`${dados.periodos?.dia ? `${textoDia(dados.periodos.dia)} · ` : ""}${t("os caminhos que os clientes mais fazem, etapa por etapa, e onde eles têm erro ou desistem", "the paths customers take most, step by step, and where they hit errors or give up")}`}>
            {dados.caminhos.length === 0 ? <p className="painel-vazio">{t("Nenhum fluxo neste período.", "No flows in this timeframe.")}</p>
              : <Fluxos caminhos={dados.caminhos} chipApp={chipApp} janela={janela} robos={robos} erroDaPagina={erroDaPagina} hrefErros={(a, v) => hrefErrosPagina(entidadeDaApp(apps, a), v, janela)}
                        aoVerSessoes={setSessoes} aoAbrirPagina={aoAbrirPagina} />}
          </Cartao>

          <Cartao titulo={t("Páginas mais visitadas", "Most visited pages")}
                  resumo={maisVista ? <span className="in-resumo">{t(`a mais visitada: ${maisVista.view} (${pctTexto(maisVista.pctVisitas)})`, `most visited: ${maisVista.view} (${pctTexto(maisVista.pctVisitas)})`)}</span> : undefined} nota={dados.periodos?.dia ? `${textoDia(dados.periodos.dia)} · ${t("fatia de todas as páginas vistas", "share of all page views")}` : t("fatia de todas as páginas vistas no período", "share of all page views in the timeframe")}>
            <Paginas dados={dados} chipApp={chipApp} aoAbrirPagina={aoAbrirPagina} />
          </Cartao>

          {ajustesTela.length > 0 && (
            <Cartao titulo={t("Para ver o fluxo completo", "To see the whole flow")}
                    resumo={<span className="in-resumo">{ajustesTela.length === 1 ? t("1 ajuste", "1 fix") : t(`${ajustesTela.length} ajustes`, `${ajustesTela.length} fixes`)}</span>} nota={t("ajustes de monitoramento: não afetam o cliente, mas escondem parte do caminho", "monitoring fixes: they don't affect customers, but hide part of the path")}>
              <ul className="aj-lista">
                {ajustesTela.map((q, i) => (
                  <li key={q.id} data-op={i >= ajustes.length ? "1" : undefined}>
                    <div className="pc-linha"><WarningIcon size={16} /><span className="pc-linha-texto"><b>{q.titulo}</b> · {q.detalhe}</span></div>
                    <div className="pc-linha"><RepairIcon size={16} /><span className="pc-linha-texto">{q.correcao}<span className="pc-quem"><GroupIcon size={14} />{q.quem}</span></span></div>
                  </li>
                ))}
              </ul>
            </Cartao>
          )}
        </>}
    </div>
  );
};

/** Hora curta (hh:mm) na língua da tela. */
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(t("pt-BR", "en-US"), { hour: "2-digit", minute: "2-digit" });
/** "últimas 24 h analisadas, até hh:mm" (com menos horas, quantas). */
const textoDia = (d: { de: number; ate: number; horas: number }) => (d.horas >= 24
  ? t(`últimas 24 h analisadas, até ${hhmm(d.ate)}`, `last 24 h analyzed, up to ${hhmm(d.ate)}`)
  : t(`últimas ${d.horas} h analisadas, até ${hhmm(d.ate)}`, `last ${d.horas} h analyzed, up to ${hhmm(d.ate)}`));
/** A legenda das bases de tempo da Visão geral (1.43): de quando é cada parte. */
function legendaPeriodos(p: NonNullable<DadosInicio["periodos"]>) {
  const partes = [
    p.ultimaHora ? t(`Sessões, aplicações e mapa: última hora (${hhmm(p.ultimaHora.de)} a ${hhmm(p.ultimaHora.ate)})`, `Sessions, applications and map: last hour (${hhmm(p.ultimaHora.de)} to ${hhmm(p.ultimaHora.ate)})`) : null,
    p.dia ? t(`fluxos, saídas e páginas: ${textoDia(p.dia)}`, `flows, exits and pages: ${textoDia(p.dia)}`) : t("fluxos, saídas e páginas: a primeira hora ainda está sendo analisada", "flows, exits and pages: the first hour is still being analyzed"),
    // 1.46.0: no modo "a cada 5 minutos" (Configuração), o período termina na última fatia gravada
    semTempoRealEmUso()
      ? t(`erros e Apdex: período escolhido, até ${hhmm(fimDosAgregados())} (atualiza a cada 5 min)`, `errors and Apdex: chosen timeframe, up to ${hhmm(fimDosAgregados())} (updates every 5 min)`)
      : t("erros e Apdex: período escolhido, ao vivo", "errors and Apdex: chosen timeframe, live"),
  ].filter(Boolean);
  return partes.join(" · ");
}
/** Fatia em barra fina, para comparar as aplicações de relance: trilho neutro, preenchimento vermelho, valor ao lado. */
const Medidor: React.FC<{ pct: number; ativo: boolean }> = ({ pct, ativo }) => (
  <span className={`in-medidor${ativo ? " erro" : ""}`}>
    <span className="in-medidor-trilho" aria-hidden="true"><span style={{ width: `${ativo ? Math.max(3, Math.min(100, pct)) : 0}%` }} /></span>
    <b>{pctTexto(pct)}</b>
  </span>
);

const Kpi: React.FC<{ icone?: React.ReactNode; rotulo: string; valor: string; nota?: string; critico?: boolean; acao?: string; ativo?: boolean; aoClicar?: () => void }> = ({ icone, rotulo, valor, nota, critico, acao, ativo, aoClicar }) => {
  const corpo = <>
    <span className="in-kpi-rotulo">{icone}{rotulo}</span>
    <span className="in-kpi-valor">{valor}</span>
    {nota && <span className="in-kpi-nota">{nota}</span>}
    {acao && <span className="in-kpi-acao">{acao}</span>}
  </>;
  return aoClicar
    ? <button className={`in-kpi clicavel${critico ? " critico" : ""}${ativo ? " ativo" : ""}`} onClick={aoClicar} aria-expanded={ativo}>{corpo}</button>
    : <div className={`in-kpi${critico ? " critico" : ""}`}>{corpo}</div>;
};

/** Seção recolhível: carrega fechada (a não ser `aberto`); o cabeçalho mostra o resumo para decidir se vale abrir. */
const Cartao: React.FC<{ titulo: string; nota?: string; resumo?: React.ReactNode; aberto?: boolean; children: React.ReactNode }> = ({ titulo, nota, resumo, aberto, children }) => {
  const [aberta, setAberta] = useState(!!aberto);
  return (
    <section className={`in-cartao${aberta ? "" : " fechado"}`}>
      <button className="in-cartao-cabecalho" onClick={() => setAberta((v) => !v)} aria-expanded={aberta}>
        <span className={`in-chevron${aberta ? " aberto" : ""}`} aria-hidden="true">›</span>
        <h3>{titulo}{nota && <span>{nota}</span>}</h3>
        {resumo && <span className="in-cartao-resumo">{resumo}</span>}
      </button>
      {aberta && <div className="in-cartao-corpo">{children}</div>}
    </section>
  );
};

/** Páginas mais visitadas: tabela compacta (fatia, visitas, carga, erros) e gráfico de rosca com a mesma distribuição. */
const Paginas: React.FC<{ dados: DadosInicio; chipApp: ((id: string) => React.ReactNode) | null; aoAbrirPagina: (app: string, view: string, aba?: AbaPagina) => void }> = ({ dados, chipApp, aoAbrirPagina }) => {
  const fatias = [...dados.maisVisitadas.map((p, i) => ({ chave: `${p.app}|${p.view}`, rotulo: p.view, visitas: p.visitas, cor: CORES[i % CORES.length] })),
                  ...(dados.outrasVisitas > 0 ? [{ chave: "__outras", rotulo: t("Outras páginas", "Other pages"), visitas: dados.outrasVisitas, cor: COR_OUTRAS }] : [])];
  const pctOutras = dados.totalVisitas ? (100 * dados.outrasVisitas) / dados.totalVisitas : 0;
  return (
    <div className="in-paginas">
      <div className="in-paginas-tabela">
        <table className="in-tabela compacta">
          <thead><tr><th>{t("Página", "Page")}</th><th>%</th><th>{t("Visitas", "Views")}</th><th title={t("Tempo de carga (p75); no app nativo não é medido", "Load time (p75); not measured in native apps")}>{t("Carga", "Load")}</th><th>{t("Erros", "Errors")}</th></tr></thead>
          <tbody>
            {dados.maisVisitadas.map((p: PaginaInicio, i) => (
              <tr key={`${p.app}|${p.view}`} onClick={() => aoAbrirPagina(p.app, p.view)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") aoAbrirPagina(p.app, p.view); }}>
                <td><span className="in-cor" style={{ background: CORES[i % CORES.length] }} aria-hidden="true" /><span className="in-pagina-nome" title={p.view}>{p.view}</span>{chipApp && <span className="in-pagina-chip">{chipApp(p.app)}</span>}</td>
                <td><b>{pctTexto(p.pctVisitas)}</b></td>
                <td>{formatarInt(p.visitas)}</td>
                <td>{p.p75Ms != null && p.p75Ms > 0 ? formatarMs(p.p75Ms) : "–"}</td>
                <td className={p.erros > 0 ? "erro" : "in-apagado"}>{p.erros > 0 ? <button className="painel-link erro" onClick={(e) => { e.stopPropagation(); aoAbrirPagina(p.app, p.view, "erros"); }}>{formatarInt(p.erros)}</button> : "0"}</td>
              </tr>
            ))}
            {dados.outrasVisitas > 0 && (
              <tr className="in-outras"><td><span className="in-cor" style={{ background: COR_OUTRAS }} aria-hidden="true" />{t("Outras páginas", "Other pages")}</td><td><b>{pctTexto(pctOutras)}</b></td><td>{formatarInt(dados.outrasVisitas)}</td><td /><td /></tr>
            )}
          </tbody>
        </table>
        {dados.menosVisitadas.length > 0 && (
          <p className="in-menos-linha"><span>{t("Menos visitadas:", "Least visited:")}</span> {dados.menosVisitadas.map((p, i) => <React.Fragment key={`${p.app}|${p.view}`}>{i > 0 && " · "}<button className="painel-link" onClick={() => aoAbrirPagina(p.app, p.view)} title={p.view}>{p.view}</button> ({formatarInt(p.visitas)})</React.Fragment>)}</p>
        )}
      </div>
      <Rosca fatias={fatias} total={dados.totalVisitas} />
    </div>
  );
};

/** Gráfico de rosca (SVG): uma fatia por página, com o total no meio. */
const Rosca: React.FC<{ fatias: { chave: string; rotulo: string; visitas: number; cor: string }[]; total: number }> = ({ fatias, total }) => {
  const R = 64, L = 24, C = 2 * Math.PI * R;
  let acumulado = 0;
  return (
    <svg className="in-rosca" viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={t("Distribuição das visitas por página", "Page views by page")}>
      <g transform="rotate(-90 90 90)">
        <circle cx="90" cy="90" r={R} fill="none" style={{ stroke: "var(--sc-caixa)" }} strokeWidth={L} />
        {fatias.map((f) => {
          const tam = total > 0 ? (C * f.visitas) / total : 0;
          const el = <circle key={f.chave} cx="90" cy="90" r={R} fill="none" style={{ stroke: f.cor }} strokeWidth={L} strokeDasharray={`${Math.max(0, tam - 1.5)} ${C}`} strokeDashoffset={-acumulado}>
            <title>{`${f.rotulo}: ${pctTexto(total ? (100 * f.visitas) / total : 0)} (${formatarInt(f.visitas)})`}</title></circle>;
          acumulado += tam;
          return el;
        })}
      </g>
      <text x="90" y="88" textAnchor="middle" className="in-rosca-total">{formatarInt(total)}</text>
      <text x="90" y="106" textAnchor="middle" className="in-rosca-rotulo">{t("visitas", "views")}</text>
    </svg>
  );
};
