import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, BugReportIcon, CursorIcon, DesktopIcon, DocumentStackIcon, ExternalLinkIcon, FilterIcon, GroupIcon, LogoutIcon, PathIcon, RepairIcon, ServicesIcon, StopwatchIcon, TracesIcon, UserSessionsIcon, WarningIcon } from "@dynatrace/strato-icons";
import { dql, num, texto, qCliques, qTraces, qSaudeServicos, qCargaPagina, chaveSegmento, JANELA_MAX_SPANS_MIN } from "../lib/dql";
import { qErrosPaginaAgregado, qCargaPaginaAgregado, janelaRelativa, LIMITE_LINHAS_FATIA, type ExemploErro } from "../lib/agregados";
import { lerTrecho, comTrecho, juntarErrosPagina, juntarCliques, juntarCarga } from "../lib/aovivo";
import type { ExemploLento } from "../lib/horaria";
import type { LinhaQuadro } from "../lib/quadros";
import { qTraceTemSpans, tracesConferidos } from "../lib/traces";
import { lerReq24 } from "../lib/horas";
import { fimMinimo } from "../lib/compartilhado";
import { planoPainel } from "../lib/juntas";
import { AppInfo, ArestaFluxo, Grafo, NoFluxo, formatarInt, formatarMs, formatarPctFino } from "../lib/graph";
import { IconeTipo, tipoRotulo } from "./FlowGraph";
import { Destaque, calcularDestaques } from "../lib/destaques";
import { LinhaQualidade, avaliarQualidade } from "../lib/qualidade";
import { Abas, Barras, CabecalhoPainel, Carregando, Distribuicao, Indicadores, ListaBarras, RoscaPainel, Secao, type LinhaIndicador } from "./PainelBlocos";
import { t, idiomaAtual } from "../lib/i18n";
import { LinkErroInspector, hora, hrefErrosPagina, linkIntent } from "./Links";
import { ChipApp } from "./ChipApp";
import { OrigemBackend } from "./OrigemBackend";
import { lerCompartilhado, chaveBloco } from "../lib/compartilhado";
import { useDadoNaTela } from "./DadosDe";

/** Painel de detalhes do nó clicado no Flow, no mesmo padrão dos cartões da visão geral: cabeçalho (ícone, tipo, nome,
    aplicação e selo), ações com ícone, os números em destaque de forma visual (rosca, número principal e linhas com
    ícone) e as abas com o detalhe (para onde vão e de onde vêm em barra de distribuição, erros, cliques, backend,
    traces). Vermelho só para erro/falha. */

export type AbaPagina = "fluxo" | "erros" | "cliques" | "backend" | "traces";
interface Props { abaInicial?: { id: string; aba: AbaPagina } | null; janela: string; robos: boolean; grafo: Grafo; apps: AppInfo[]; no: NoFluxo | null; aoSelecionar: (id: string) => void; aoIsolar?: (id: string) => void; isoladoId?: string | null; versao?: number; aoDestacar?: (d: Destaque) => void; destaqueAtivo?: string | null; qualidade?: LinhaQualidade[];
  /** Flow esperando o backend do grafo: "carregando" em vez de "sem backend"; aguardandoNo = o nó escolhido ainda não chegou */
  backendPendente?: boolean; aguardandoNo?: boolean;
  /** frames das páginas (1.45.8): de que página cada um faz parte, as cargas e os erros dos que só existem como frame */
  quadros?: LinhaQuadro[];
  /** o backend carregou com falha (aviso no grafo): "não carregou" em vez de "nenhuma ligação" */
  backendFalhou?: "ligacao" | "cadeia" | null;
  /** a base do grafo não carregou (erro no grafo): os destaques não dizem "nada chama atenção" */
  baseFalhou?: boolean }

interface Clique { tipo: string; elemento: string; tag: string; n: number; sessoes: number }
interface Requisicao { caminho: string; dominio: string; n: number; erros: number; durMs: number | null; ligadas: number }
interface Erro { tipo: string; nome: string; status: string | null; excecaoTipo: string | null; n: number; sessoes: number; terceiro: boolean;
  /** 1.43 (erros ao vivo): exemplos e o endpoint da chamada que falhou */
  amostrasTrace?: string[]; amostrasSessao?: string[]; ultimo?: string | null; caminho?: string | null; dominio?: string | null; exemplos?: ExemploErro[] }
interface Trace { inicio: string; caminho: string; trace: string; status: string | null; falhou: boolean; durMs: number | null }
interface Saude { n: number; falhas: number; rtMs: number | null }

const janelaEmTorno = (iso: string, minutos = 10) => {
  const t = new Date(iso).getTime();
  return isNaN(t) ? undefined : { from: new Date(t - minutos * 60000).toISOString(), to: new Date(t + minutos * 60000).toISOString() };
};
/** Atalho do trace no Distributed Tracing (1.45.6): abre no intervalo da requisição (sem ele, nas últimas 24 h) e, no
    clique, confere antes se o trace tem spans (lib/traces.ts); sem spans, diz por quê em vez de abrir "Trace not found". */
const LinkTrace: React.FC<{ trace: string; inicio?: string | null; rotulo?: string }> = ({ trace, inicio, rotulo }) => {
  const [estado, setEstado] = useState<"livre" | "conferindo" | "existe" | "sem-spans">(() => {
    const c = tracesConferidos.get(trace);
    return c === true ? "existe" : c === false ? "sem-spans" : "livre";
  });
  const tf = inicio ? janelaEmTorno(inicio) : { from: new Date(Date.now() - 24 * 3600000).toISOString(), to: new Date().toISOString() };
  const href = linkIntent({ "trace.id": trace, ...(tf ? { "dt.timeframe": tf } : {}) }, "dynatrace.distributedtracing", "view-trace");
  const texto_ = rotulo ?? `${trace.slice(0, 8)}…`;
  if (!href) return <code title={trace}>{texto_}</code>;
  if (estado === "sem-spans") return (
    <span className="dp-trace-sem" title={t(`O trace ${trace} não tem spans neste ambiente: a chamada foi para um serviço que o Dynatrace não monitora aqui (terceiro, como Firebase, ou backend sem OneAgent).`, `Trace ${trace} has no spans in this environment: the call went to a service Dynatrace does not monitor here (a third party, such as Firebase, or a backend without OneAgent).`)}>
      {t("trace sem spans", "trace without spans")}
    </span>);
  const abrir = async (ev: React.MouseEvent<HTMLAnchorElement>) => {
    const q = inicio ? qTraceTemSpans(trace, inicio) : null;
    if (estado !== "livre" || !q) return;                      // conferido, ou sem horário (análise antiga): abre direto
    ev.preventDefault();
    const janela = window.open("about:blank", "_blank");          // aberta no clique (depois do await o navegador bloquearia)
    setEstado("conferindo");
    let existe = true;                                            // na dúvida (erro na consulta), abre
    try { existe = num((await dql(q, { contexto: "painel/TRC-01", maxRecords: 1 }))[0]?.n) > 0; } catch { /* abre */ }
    tracesConferidos.set(trace, existe);
    setEstado(existe ? "existe" : "sem-spans");
    if (!janela) return;                                          // janela bloqueada: o próximo clique abre direto
    if (existe) janela.location.href = href; else janela.close();
  };
  return <a className="painel-link" href={href} target="_blank" rel="noreferrer" onClick={abrir} title={t(`Abrir o trace ${trace} no Distributed Tracing`, `Open trace ${trace} in Distributed Tracing`)}>{estado === "conferindo" ? t("conferindo…", "checking…") : `${texto_} ↗`}</a>;
};
const hrefServico = (id: string) => (id && id.startsWith("SERVICE-") ? linkIntent({ "dt.entity.service": id }) : null);
/** Link da sessão em Users & Sessions (perto do instante do exemplo, quando se sabe). */
const LinkSessao: React.FC<{ id: string; quando?: string | null; rotulo?: string }> = ({ id, quando, rotulo }) => {
  const href = linkIntent({ "dt.rum.session.id": id, ...(quando ? { start_time: quando } : {}) }, "dynatrace.users.sessions", "session-details-from-event");
  const r = rotulo ?? t("Sessão", "Session");
  return href ? <a className="painel-link" href={href} target="_blank" rel="noreferrer" title={t(`Abrir a sessão ${id} em Users & Sessions`, `Open session ${id} in Users & Sessions`)}>{r} ↗</a> : <code title={id}>{r}</code>;
};
/** Os exemplos de um erro (1.43.6): os 3 mais recentes, um por linha, com a hora, a duração da chamada (erro de
    requisição), o trace (abre no Distributed Tracing) e a sessão (abre em Users & Sessions). */
export const ExemplosErro: React.FC<{ exemplos?: ExemploErro[] }> = ({ exemplos }) => {
  if (!exemplos?.length) return null;
  return (
    <ul className="dp-exemplos">
      {exemplos.map((x, i) => (
        <li key={i}>
          <span className="dp-exemplo-hora">{x.h ? hora(x.h) : "-"}</span>
          {x.d != null && <span className="dp-exemplo-dur">{formatarMs(x.d)}</span>}
          {x.t && <LinkTrace trace={x.t} inicio={x.h ?? undefined} rotulo={t("Abrir trace", "Open trace")} />}
          {x.s && <LinkSessao id={x.s} quando={x.h} />}
        </li>
      ))}
    </ul>
  );
};
const pctDe = (parte: number, todo: number) => (todo > 0 ? (100 * parte) / todo : 0);
const pctFalha = (s?: Saude) => (s && s.n > 0 ? (100 * s.falhas) / s.n : null);
const textoPct = formatarPctFino;
/** nó "de mentira" só para escolher o ícone de quem não está no grafo */
const noDoTipo = (tipo: NoFluxo["tipo"]) => ({ tipo, canal: null } as unknown as NoFluxo);
const TituloIcone: React.FC<{ icone: React.ReactNode; children: React.ReactNode }> = ({ icone, children }) => <span className="dp-titulo-icone">{icone}{children}</span>;

// ---- painel -------------------------------------------------------------------------------------------------------

export const DetailPanel: React.FC<Props> = ({ abaInicial, janela, robos, grafo, apps, no, aoSelecionar, aoIsolar, isoladoId, versao, aoDestacar, destaqueAtivo, qualidade, backendPendente, aguardandoNo, backendFalhou, baseFalhou, quadros }) => {
  const [cliques, setCliques] = useState<Clique[] | null>(null);
  const [reqs, setReqs] = useState<Requisicao[] | null>(null);
  const [erros, setErros] = useState<Erro[] | null>(null);
  const [traces, setTraces] = useState<Trace[] | null>(null);
  const [saude, setSaude] = useState<Map<string, Saude> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carga, setCarga] = useState<{ n: number; mediaMs: number | null; p75Ms: number | null } | null>(null);
  // escopo padrão: erros, exemplos, cliques e tempo de carga ao vivo, no período escolhido; as 3 mais lentas das 24 horas analisadas
  const [lentas, setLentas] = useState<ExemploLento[] | null>(null);
  const [modoNovo, setModoNovo] = useState(false);
  const [abaPagina, setAbaPagina] = useState<AbaPagina>("fluxo");
  const [backendAberto, setBackendAberto] = useState(false);
  const [desdeCache, setDesdeCache] = useState<number | null>(null);   // o painel veio do cache: rótulo "dados de hh:mm"
  useDadoNaTela(desdeCache);
  const nomeApp = (id: string | null) => apps.find((a) => a.id === id)?.nome ?? id ?? "";
  // filtro de segmento em uso (o App acerta o estado do módulo de consultas antes de desenhar): trocar o filtro relê o
  // painel, que antes ficava com os números do filtro anterior
  const segmento = chaveSegmento();

  // serviços cujo estado (requisições, falhas, tempo) o painel mostra: os do caminho da página ou o serviço e vizinhos
  const idsSaude = !no ? [] : no.tipo === "view" ? (no.servicosAtingidos ?? []).map((s) => s.id)
    : no.tipo === "servico" || no.tipo === "banco" ? [no.id, ...grafo.arestas.filter((a) => a.de === no.id).map((a) => a.para), ...grafo.arestas.filter((a) => a.para === no.id && a.tipo === "call").map((a) => a.de)]
    : [];
  const chaveSaude = [...new Set(idsSaude)].filter((i) => i.startsWith("SERVICE-")).sort().join(",");

  // aba ao abrir: a pedida pela visão geral (ex.: Erros da página com erro no fluxo) ou o Flow
  useEffect(() => { setAbaPagina(abaInicial && abaInicial.id === no?.id ? abaInicial.aba : "fluxo"); setBackendAberto(false); }, [no?.id, abaInicial]);

  // frames desta página; os que só existem como frame entram nos erros dela
  const quadrosPagina = useMemo(() => (no?.tipo === "view" ? (quadros ?? []).filter((q) => q.app === no.app && q.pagina === no.nome).sort((a, b) => b.cargas - a.cargas) : []), [quadros, no?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const paginasDosErros = quadrosPagina.filter((q) => q.soQuadro).map((q) => q.quadro).join("\u0001");
  useEffect(() => {
    setCliques(null); setReqs(null); setErros(null); setTraces(null); setErro(null); setCarga(null); setDesdeCache(null); setLentas(null);
    if (!no || no.tipo !== "view" || !no.app) return;
    let vivo = true;
    const novo = !robos && segmento === "-";
    setModoNovo(novo);
    if (novo) {
      // MODELO POR FEATURE: só o que importa. Erros da página, as chamadas que falharam, 3 exemplos de cada erro, os cliques
      // e o tempo de carga, AO VIVO no período escolhido (agregados + a ponta da aba; lib/aovivo.ts, juntarErrosPagina,
      // juntarCliques e juntarCarga); as 3 requisições mais lentas, das 24 horas analisadas (lib/horaria.ts). Nenhuma
      // leitura da cópia ao abrir o painel.
      const app = no.app, view = no.nome;
      const comQuadros = [view, ...(paginasDosErros ? paginasDosErros.split("\u0001") : [])];
      (async () => {
        try {
          const tr = janelaRelativa(janela) ? lerTrecho(janela, (q) => dql(q, { contexto: "painel/PAG-00", maxRecords: LIMITE_LINHAS_FATIA }), fimMinimo()) : null;
          const [e, c, le, pg] = await Promise.all([
            comTrecho(tr, (t) => dql(qErrosPaginaAgregado(app, comQuadros, janela, false, t), { contexto: "painel/ERR-02", maxRecords: 100 }), (x, l) => juntarErrosPagina(x, l, app, comQuadros, false)),
            comTrecho(tr, (t) => dql(qCliques(app, janela, false, view, t), { contexto: "painel/PAG-01" }), (x, l) => juntarCliques(x, l, app, view, false)).catch(() => [] as Record<string, unknown>[]),
            lerReq24().then((r) => r?.lentas ?? new Map<string, ExemploLento[]>()).catch(() => new Map<string, ExemploLento[]>()),
            (async () => {
              const ls = await (tr ? Promise.all([dql(qCargaPaginaAgregado(app, view, janela, false, tr.t), { contexto: "painel/PAG-05" }), tr.linhas]) : Promise.all([dql(qCargaPaginaAgregado(app, view, janela, false), { contexto: "painel/PAG-05" }), Promise.resolve([] as Record<string, unknown>[])]));
              return juntarCarga(ls[0], ls[1], app, view, false);
            })().catch(() => ({ n: 0, mediaMs: null, p75Ms: null })),
          ]);
          if (!vivo) return;
          const lista = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
          const es: Erro[] = e.map((x) => ({ tipo: texto(x.tipo) ?? "", nome: texto(x.nome) ?? t("(sem nome)", "(no name)"), status: texto(x.status), excecaoTipo: texto(x.excecao_tipo), n: num(x.n), sessoes: 0,
            terceiro: x.terceiro === true || x.terceiro === "true", amostrasTrace: lista(x.amostra_t), amostrasSessao: lista(x.amostra_s), ultimo: texto(x.ultimo), caminho: texto(x.caminho), dominio: texto(x.dominio), exemplos: Array.isArray(x.exemplos) ? (x.exemplos as ExemploErro[]) : [] }));
          setErros(es);
          // chamadas de API da página: só as que falharam (endpoint, status), dos mesmos erros
          const porEndpoint = new Map<string, Requisicao>();
          for (const x of es.filter((y) => y.tipo === "request" && !y.terceiro)) {
            const k = `${x.dominio ?? ""}|${x.caminho ?? ""}`, a = porEndpoint.get(k) ?? { caminho: x.caminho ?? "?", dominio: x.dominio ?? "", n: 0, erros: 0, durMs: null, ligadas: 0 };
            a.n += x.n; a.erros += x.n; a.ligadas += (x.amostrasTrace ?? []).length; porEndpoint.set(k, a);
          }
          setReqs([...porEndpoint.values()].sort((a, b) => b.erros - a.erros));
          setCliques(c.map((x) => ({ tipo: texto(x.tipo) ?? "", elemento: texto(x.elemento) ?? t("(sem nome)", "(no name)"), tag: texto(x.tag) ?? "", n: num(x.n), sessoes: num(x.sessoes) })));
          setCarga(pg);
          setLentas(le.get(`${app}|${view}`) ?? []);
          setTraces([]);
        } catch (err) { if (vivo) setErro(err instanceof Error ? err.message : String(err)); }
      })();
      return () => { vivo = false; };
    }
    // cache compartilhado de 5 min (lib/compartilhado.ts): texto e chave montados agora, com o filtro de agora; guarda as
    // linhas cruas (o texto da tela sai no idioma de quem vê). O Atualizar (versao) relê: fim mínimo. Requisições e erros
    // numa leitura (PAG-U, lib/juntas.ts); o cache guarda as mesmas 5 listas de antes
    const app = no.app, view = no.nome;
    const q = [qCliques(app, janela, robos, view), qTraces(app, janela, robos, view), qCargaPagina(app, janela, robos, view)];
    const reqErros = planoPainel(app, janela, robos, view);
    (async () => {
      try {
        const b = await lerCompartilhado("painel", chaveBloco(app, view, janela, robos), async (ctx) => {
          const [c, [r, e], tr, cg] = await Promise.all([dql(q[0], { contexto: "painel/PAG-01" }), reqErros(), dql(q[1], { contexto: "painel/PAG-04" }),
            dql(q[2], { contexto: "painel/PAG-05" }).catch(() => { ctx.naoGuardar(); return [] as Record<string, unknown>[]; })]);
          return [c, r, e, tr, cg];
        }, { desistir: () => !vivo, aceitar: (x) => Array.isArray(x) && x.length === 5 && x.every(Array.isArray) });
        if (!vivo || !b) return;
        const [c, r, e, tr, cg] = b.dados;
        setDesdeCache(b.deCache ? b.desde : null);
        const l = cg[0];
        setCarga(l && num(l.n) > 0 ? { n: num(l.n), mediaMs: l.media_ms == null ? null : num(l.media_ms), p75Ms: l.p75_ms == null ? null : num(l.p75_ms) } : { n: 0, mediaMs: null, p75Ms: null });
        setErros(e.map((x) => ({ tipo: texto(x.tipo) ?? "", nome: texto(x.nome) ?? t("(sem nome)", "(no name)"), status: texto(x.status), excecaoTipo: texto(x.excecao_tipo), n: num(x.n), sessoes: num(x.sessoes), terceiro: x.terceiro === true || x.terceiro === "true" })));
        setCliques(c.map((x) => ({ tipo: texto(x.tipo) ?? "", elemento: texto(x.elemento) ?? t("(sem nome)", "(no name)"), tag: texto(x.tag) ?? "", n: num(x.n), sessoes: num(x.sessoes) })));
        setReqs(r.map((x) => ({ caminho: texto(x.caminho) ?? "", dominio: texto(x.dominio) ?? "", n: num(x.n), erros: num(x.erros), durMs: x.dur_ms == null ? null : num(x.dur_ms), ligadas: num(x.ligadas) })));
        setTraces(tr.map((x) => ({ inicio: texto(x.start_time) ?? "", caminho: texto(x.caminho) ?? "", trace: texto(x.trace) ?? "", status: texto(x.status), falhou: x.falhou === true || x.falhou === "true", durMs: x.dur_ms == null ? null : num(x.dur_ms) })));
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { vivo = false; };
  }, [janela, robos, no?.id, versao, segmento, paginasDosErros]);

  useEffect(() => {
    setSaude(null);
    if (!chaveSaude) return;
    let vivo = true;
    // métrica nativa do serviço: consulta de métrica, sem custo de leitura do Grail
    dql(qSaudeServicos(chaveSaude.split(","), janela), { contexto: "painel/PAG-06" }).then((linhas) => {
      if (!vivo) return;
      setSaude(new Map(linhas.map((x) => [String(x.servico), { n: num(x.n), falhas: num(x.falhas), rtMs: x.rt_us == null ? null : num(x.rt_us) / 1000 }])));
    }).catch(() => { if (vivo) setSaude(new Map()); });
    return () => { vivo = false; };
  }, [janela, chaveSaude, versao]);

  const textoLigando = t("Ligando as páginas aos serviços do backend…", "Linking pages to backend services…");
  if (!no && aguardandoNo) return <aside className="painel dp"><Carregando texto={textoLigando} /></aside>;
  if (!no) {
    return (
      <aside className="painel dp">
        <h2 className="painel-titulo">{t("Visão geral do fluxo", "Flow overview")}</h2>
        {baseFalhou ? <p className="painel-vazio">{t("O fluxo não carregou (veja a mensagem no grafo).", "The flow did not load (see the message on the graph).")}</p>
          : <Destaques grafo={grafo} apps={apps} aoDestacar={aoDestacar} ativo={destaqueAtivo ?? null} />}
        <QualidadeDado grafo={grafo} apps={apps} linhas={qualidade ?? []} />
        <Resumo grafo={grafo} apps={apps} />
      </aside>
    );
  }

  const noDe = (id: string) => grafo.nos.find((n) => n.id === id);
  const nome = (id: string) => noDe(id)?.nome ?? id;
  const linkNo = (id: string) => <button className="painel-link" onClick={() => aoSelecionar(id)} title={nome(id)}>{nome(id)}</button>;
  const saidas = grafo.arestas.filter((a) => a.de === no.id).sort((a, b) => b.n - a.n);
  const chegadas = grafo.arestas.filter((a) => a.para === no.id).sort((a, b) => b.n - a.n);
  const nav = (lista: ArestaFluxo[]) => lista.filter((a) => a.tipo === "nav");
  const chip = no.app && apps.length > 0 ? <ChipApp apps={apps} id={no.app} /> : undefined;
  const linkIsolar = aoIsolar ? (
    <button className={`painel-link${isoladoId === no.id ? " ativo" : ""}`} onClick={() => aoIsolar(no.id)}
            title={t("Mostra só o fluxo que passa por este nó, com os números das sessões que passaram por ele (Esc sai)", "Show only the flow through this node, with the numbers of the sessions that went through it (Esc exits)")}>
      <FilterIcon size={14} />{isoladoId === no.id ? t("Sair do isolamento", "Exit isolation") : t("Isolar no fluxo", "Isolate in the flow")}
    </button>
  ) : null;

  // ---- aplicação (frontend)
  if (no.tipo === "app") {
    const paginas = grafo.nos.filter((n) => n.tipo === "view" && n.app === no.app);
    const errosApp = paginas.reduce((s, n) => s + n.erros, 0);
    return (
      <aside className="painel dp">
        <CabecalhoPainel icone={<IconeTipo no={no} tamanho={22} />} tipo={tipoRotulo(no)} titulo={no.nome}
          selo={errosApp > 0 ? <span className="pb-selo grave">{t(`${formatarInt(errosApp)} erros`, `${formatarInt(errosApp)} errors`)}</span> : undefined} />
        <Indicadores numero={formatarInt(no.saidas)} rotulo={t("entradas", "entries")} sub={t("sessões que começam numa carga de página", "sessions starting on a page load")} linhas={[
          { icone: <DocumentStackIcon size={16} />, valor: formatarInt(paginas.length), texto: t("páginas no fluxo", "pages in the flow") },
          { icone: <WarningIcon size={16} />, valor: formatarInt(errosApp), texto: t("erros nas páginas (chamadas ao servidor com falha e erros na tela)", "errors on the pages (failed server calls and screen errors)"), critico: errosApp > 0 },
        ]} />
        <Secao titulo={<TituloIcone icone={<ArrowRightIcon size={14} />}>{t("Primeira página", "First page")}</TituloIcone>}>
          <Distribuicao vazio={t("Nenhuma navegação neste período.", "No navigation in this timeframe.")} itens={nav(saidas).map((a) => ({ chave: a.para, rotulo: linkNo(a.para), n: a.n }))} />
        </Secao>
      </aside>
    );
  }

  // ---- serviço de backend ou banco de dados
  if (no.tipo === "servico" || no.tipo === "banco") {
    const s = saude?.get(no.id);
    const pf = pctFalha(s);
    const paginas = chegadas.filter((a) => a.tipo === "req" && !a.de.startsWith("app|"));
    const canais = chegadas.filter((a) => a.tipo === "req" && a.de.startsWith("app|"));
    const servicos = chegadas.filter((a) => a.tipo === "call");
    const totalPaginas = paginas.reduce((t, a) => t + a.n, 0);
    const chamadores = paginas.length + canais.length + servicos.length;
    const href = hrefServico(no.id);
    const itemVizinho = (id: string) => {
      const sv = saude?.get(id), p = pctFalha(sv), n = noDe(id);
      return (
        <li key={id} className="dp-vizinho">
          <span className="dp-vizinho-icone"><IconeTipo no={n ?? noDoTipo("servico")} tamanho={16} /></span>
          <span className="dp-vizinho-nome">{linkNo(id)}</span>
          <span className="dp-vizinho-meta">{sv ? <>{formatarInt(sv.n)} req · <span className={p && p > 0 ? "erro" : ""}>{textoPct(p)} {t("com falha", "failed")}</span>{sv.rtMs != null ? ` · ${formatarMs(sv.rtMs)}` : ""}</> : saude ? "" : "…"}</span>
        </li>
      );
    };
    return (
      <aside className="painel dp">
        <CabecalhoPainel icone={<IconeTipo no={no} tamanho={22} />} tipo={tipoRotulo(no)} titulo={no.nome}
          selo={pf != null && pf > 0 ? <span className="pb-selo grave">{t(`${textoPct(pf)} com falha`, `${textoPct(pf)} failed`)}</span> : undefined}
          links={<>{linkIsolar}{href && <a className="painel-link" href={href} target="_blank" rel="noreferrer" title={t("Falhas, tempo de resposta e traces deste serviço", "Failures, response time and traces of this service")}><ExternalLinkIcon size={14} />{t("Abrir no Dynatrace", "Open in Dynatrace")}</a>}</>} />
        <Indicadores
          rosca={<RoscaPainel pct={pf ?? 0} tom="erro" rotulo={textoPct(pf)} titulo={t(`${textoPct(pf)} das requisições com falha`, `${textoPct(pf)} of requests failed`)} />}
          numero={s ? formatarInt(s.n) : formatarInt(no.chamadas)} rotulo={t("requisições", "requests")} sub={s ? t(`${formatarInt(s.falhas)} com falha no período`, `${formatarInt(s.falhas)} failed in the timeframe`) : undefined}
          linhas={[
            { icone: <StopwatchIcon size={16} />, valor: s?.rtMs != null ? formatarMs(s.rtMs) : "-", texto: t("de tempo de resposta, em média", "response time, on average") },
            { icone: <ArrowLeftIcon size={16} />, valor: formatarInt(chamadores), texto: t("chamam este serviço (páginas, frontends e serviços)", "call this service (pages, frontends and services)") },
            { icone: <ArrowRightIcon size={16} />, valor: formatarInt(saidas.length), texto: t("serviços chamados por ele", "services it calls") },
          ]} />
        <Secao titulo={<TituloIcone icone={<ArrowLeftIcon size={14} />}>{t("Chamado por", "Called by")}</TituloIcone>}>
          {chamadores === 0 && <p className="painel-vazio">{t("Ninguém do fluxo chama este serviço.", "Nothing in the flow calls this service.")}</p>}
          {paginas.length > 0 && <ListaBarras vazio="" itens={paginas.map((a) => ({ chave: a.de, rotulo: linkNo(a.de), detalhe: apps.length > 1 ? nomeApp(noDe(a.de)?.app ?? null) : undefined, pct: pctDe(a.n, totalPaginas), valor: `${formatarInt(a.n)} req` }))} />}
          {(canais.length > 0 || servicos.length > 0) && <ul className="dp-vizinhos">
            {canais.map((a) => <li key={a.de} className="dp-vizinho"><span className="dp-vizinho-icone"><IconeTipo no={noDe(a.de) ?? noDoTipo("app")} tamanho={16} /></span><span className="dp-vizinho-nome">{linkNo(a.de)}</span></li>)}
            {servicos.map((a) => itemVizinho(a.de))}
          </ul>}
        </Secao>
        <Secao titulo={<TituloIcone icone={<ArrowRightIcon size={14} />}>{t("Chama", "Calls")}</TituloIcone>}>
          {saidas.length === 0 ? <p className="painel-vazio">{t("Não chama outros serviços.", "Calls no other services.")}</p> : <ul className="dp-vizinhos">{saidas.map((a) => itemVizinho(a.para))}</ul>}
        </Secao>
        <p className="dp-nota">{t("Páginas: requisições cruzadas com os spans do backend pelo trace, das últimas 24 h analisadas, de hora em hora (com filtro de segmento, lidas ao abrir o Flow, no máximo a última hora; em ambientes grandes, com amostragem). Frontends e serviços: modelo de entidades da Dynatrace (o mesmo do Smartscape). Requisições, falhas e tempo de resposta: métricas do serviço.", "Pages: requests matched with the backend spans by trace, from the last 24 h analyzed, hour by hour (with a segment filter, read when the Flow opens, at most the last hour; sampled in large environments). Frontends and services: Dynatrace entity model (the same as Smartscape). Requests, failures and response time: service metrics.")}</p>
      </aside>
    );
  }

  // ---- página
  const pctFim = pctDe(no.fim, no.entradas);
  const totalCliques = (cliques ?? []).reduce((t, c) => t + c.n, 0);
  const caminho = [...(no.servicosAtingidos ?? [])].sort((a, b) => a.ordem - b.ordem || b.chamadas - a.chamadas);
  const infoApp = apps.find((a) => a.id === no.app);
  const entidadeApp = infoApp?.entidade ?? (no.app && /^[0-9a-f]{16}$/.test(no.app) ? `APPLICATION-${no.app.toUpperCase()}` : null);
  const hrefErros = no.erros > 0 ? hrefErrosPagina(entidadeApp, no.nome, janela) : null;
  // página chama API e nenhuma chamada tem trace: em aplicações reais é comum a API ficar em OUTRO domínio e o agente RUM só manda o
  // contexto de trace para outro domínio quando a aplicação permite (request.trace_context_hint = cross_origin)
  const qApp = modoNovo ? (qualidade ?? []).find((l) => l.app === no.app) : undefined;
  const totalReqs = modoNovo ? qApp?.reqs ?? 0 : (reqs ?? []).reduce((t, r) => t + r.n, 0), comTrace = modoNovo ? qApp?.reqsTrace ?? 0 : (reqs ?? []).reduce((t, r) => t + r.ligadas, 0);
  const dominios = modoNovo ? (qApp?.dominioSemTrace ? [qApp.dominioSemTrace] : []) : [...new Set((reqs ?? []).map((r) => r.dominio).filter(Boolean))].slice(0, 3);
  // no escopo padrão a conta é da aplicação (a qualidade do dado, por aplicação); fora dele, das chamadas desta página
  const semTraceCrossOrigin = (modoNovo ? !!qApp : !!reqs) && totalReqs > 0 && comTrace === 0
    ? modoNovo ? t(`Nenhuma das ${formatarInt(totalReqs)} chamadas de API desta aplicação leva trace. Elas vão para ${dominios.join(", ")}${dominios.length ? " " : ""}e o agente RUM só manda o contexto de trace para outro domínio quando a aplicação permite (propagação de trace entre domínios nas configurações RUM da aplicação; a API também precisa aceitar o cabeçalho traceparent). Até lá, as páginas desta aplicação não têm ligação página → serviço.`,
        `None of this application's ${formatarInt(totalReqs)} API calls carries a trace. They go to ${dominios.join(", ")}${dominios.length ? " " : ""}and the RUM agent only sends the trace context to another domain when the application allows it (cross-origin trace propagation in the application's RUM settings; the API must also accept the traceparent header). Until then this application's pages have no page → service link.`)
    : t(`Nenhuma das ${formatarInt(totalReqs)} chamadas de API desta página leva trace. Elas vão para ${dominios.join(", ")}${dominios.length ? " " : ""}e o agente RUM só manda o contexto de trace para outro domínio quando a aplicação permite (propagação de trace entre domínios nas configurações RUM da aplicação; a API também precisa aceitar o cabeçalho traceparent). Até lá, esta página não tem ligação página → serviço.`,
        `None of this page's ${formatarInt(totalReqs)} API calls carries a trace. They go to ${dominios.join(", ")}${dominios.length ? " " : ""}and the RUM agent only sends the trace context to another domain when the application allows it (cross-origin trace propagation in the application's RUM settings; the API must also accept the traceparent header). Until then there is no page → service link for this page.`)
    : null;
  const papel = (s: { proxy: boolean; ordem: number; id: string }) =>
    noDe(s.id)?.tipo === "banco" ? "database" : s.proxy ? "forwards" : s.ordem === 1 ? "entry" : "service";
  const rotuloPapel = (p: string) => (p === "database" ? t("banco", "database") : p === "forwards" ? t("repassa", "forwards") : p === "entry" ? t("entrada", "entry") : t("serviço", "service"));
  const linhas: LinhaIndicador[] = [
    { icone: <LogoutIcon size={16} />, valor: textoPct(pctFim), texto: t(`encerram a sessão aqui (${formatarInt(no.fim)})`, `end the session here (${formatarInt(no.fim)})`), critico: false },
    { icone: <WarningIcon size={16} />, valor: formatarInt(no.erros), texto: no.erros === 0 ? t("erros neste período", "errors in this timeframe") : t(`erros: ${formatarInt(no.falhas)} chamadas ao servidor com falha, ${formatarInt(no.excecoes)} na tela`, `errors: ${formatarInt(no.falhas)} failed server calls, ${formatarInt(no.excecoes)} on the screen`), critico: no.erros > 0 },
    { icone: <StopwatchIcon size={16} />, valor: carga?.mediaMs != null ? formatarMs(carga.mediaMs) : carga ? "-" : "…",
      texto: carga?.p75Ms != null ? (modoNovo ? t(`para carregar, em média (p75 ≈ ${formatarMs(carga.p75Ms)})`, `to load, on average (p75 ≈ ${formatarMs(carga.p75Ms)})`) : t(`para carregar, em média (p75 ${formatarMs(carga.p75Ms)})`, `to load, on average (p75 ${formatarMs(carga.p75Ms)})`)) : t("para carregar", "to load"),
      titulo: no.tempoMs != null ? t(`Os clientes ficam ${formatarMs(no.tempoMs)} nesta página, em média`, `Customers stay ${formatarMs(no.tempoMs)} on this page, on average`) : undefined },
  ];
  return (
    <aside className="painel dp">
      <CabecalhoPainel icone={<IconeTipo no={no} tamanho={22} />} tipo={tipoRotulo(no)} titulo={no.nome} sub={chip}
        selo={no.erros > 0 ? <span className="pb-selo grave">{t(`${formatarInt(no.erros)} erros`, `${formatarInt(no.erros)} errors`)}</span> : undefined}
        links={<>
          {linkIsolar}
          {hrefErros && <a className="painel-link" href={hrefErros} target="_blank" rel="noreferrer" title={t("Os erros desta página no Error Inspector", "This page's errors in Error Inspector")}><BugReportIcon size={14} />{t("Ver erros ↗", "See errors ↗")}</a>}
          {no.falhas > 0 && no.app && <button className="painel-link" onClick={() => setBackendAberto((v) => !v)} aria-expanded={backendAberto}><ServicesIcon size={14} />{t("Onde falha no backend?", "Where does it fail in the backend?")}</button>}
        </>} />
      {backendAberto && no.app && <div className="dp-backend-origem"><OrigemBackend app={no.app} view={no.nome} janela={janela} robos={robos} aberto /></div>}
      <Indicadores
        rosca={<RoscaPainel pct={100 - pctFim} tom="fluxo" rotulo={textoPct(100 - pctFim)} titulo={t(`${textoPct(100 - pctFim)} dos clientes seguem para outra página`, `${textoPct(100 - pctFim)} of customers go on to another page`)} />}
        numero={formatarInt(no.entradas)} rotulo={t("visitas", "visits")}
        sub={t(`${textoPct(100 - pctFim)} seguem para outra página`, `${textoPct(100 - pctFim)} go on to another page`)} linhas={linhas} />
      <Abas<AbaPagina> ativa={abaPagina} aoMudar={setAbaPagina} abas={[
        { id: "fluxo", rotulo: "Flow" },
        { id: "erros", rotulo: t("Erros", "Errors"), contagem: no.erros, critico: true },
        { id: "cliques", rotulo: t("Cliques", "Clicks"), contagem: cliques ? totalCliques : null },
        { id: "backend", rotulo: "Backend", contagem: backendPendente || backendFalhou ? null : caminho.length },
        { id: "traces", rotulo: "Traces", contagem: modoNovo ? (erros && lentas ? erros.filter((e) => !e.terceiro).reduce((s2, e) => s2 + (e.exemplos ?? []).filter((x) => x.t).length, 0) + lentas.length : null) : traces ? traces.length : null },
      ]} />

      {abaPagina === "fluxo" && <>
        <Secao titulo={<TituloIcone icone={<ArrowRightIcon size={14} />}>{t("Para onde vão", "Where they go")}</TituloIcone>}>
          <Distribuicao vazio={t("Ninguém segue daqui: fim da jornada.", "Nobody continues from here: end of the journey.")}
            itens={[
              ...nav(saidas).map((a) => ({ chave: a.para, rotulo: linkNo(a.para), n: a.n })),
              ...(no.fim > 0 ? [{ chave: "__fim", rotulo: <span className="dp-fim">{t("encerram a sessão aqui", "end the session here")}</span>, n: no.fim, apagado: true }] : []),
            ]} />
        </Secao>
        <Secao titulo={<TituloIcone icone={<ArrowLeftIcon size={14} />}>{t("De onde vêm", "Where they come from")}</TituloIcone>}>
          <Distribuicao vazio={t("Nenhuma origem registrada.", "No origin recorded.")}
            itens={nav(chegadas).map((a) => ({ chave: a.de, rotulo: noDe(a.de)?.tipo === "app" ? <span className="dp-inicio">{t("início da sessão", "session start")}</span> : linkNo(a.de), n: a.n, apagado: noDe(a.de)?.tipo === "app" }))} />
        </Secao>
        {quadrosPagina.length > 0 && (
          <Secao titulo={<TituloIcone icone={<DocumentStackIcon size={14} />}>{t("Carrega em frames", "Loads in frames")}</TituloIcone>}
                 nota={t("partes da página, não passos do fluxo; os erros do que só existe como frame contam nesta página", "parts of the page, not flow steps; errors of what exists only as a frame count on this page")}>
            <ul className="dp-lista">
              {quadrosPagina.map((q) => (
                <li key={q.quadro} className="dp-lista-item">
                  <div className="dp-lista-texto">
                    <code>{q.quadro}</code>
                    <span className="dp-lista-meta">{t(`${formatarInt(q.cargas)} cargas`, `${formatarInt(q.cargas)} loads`)}{q.soQuadro && q.erros > 0 ? <> · <span className="dp-erro-num">{t(`${formatarInt(q.erros)} erros`, `${formatarInt(q.erros)} errors`)}</span></> : null}{!q.soQuadro ? ` · ${t("também é página do fluxo", "also a flow page")}` : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Secao>
        )}
      </>}

      {abaPagina === "erros" && (erros == null && !erro ? <Carregando /> : (
        <section className="dp-bloco">
          {(erros ?? []).filter((e) => !e.terceiro).length === 0 ? <p className="painel-vazio">{t("Nenhum erro neste período.", "No errors in this timeframe.")}</p> : (
            <ul className="dp-erros">
              {(erros ?? []).filter((e) => !e.terceiro).map((e, i) => (
                <li key={i} className="dp-erro">
                  <span className="dp-erro-icone">{e.tipo === "exception" ? <DesktopIcon size={16} /> : <ServicesIcon size={16} />}</span>
                  <div className="dp-erro-texto">
                    <span className="dp-erro-tipo">{e.tipo === "exception" ? t(`Erro na tela${e.excecaoTipo ? ` (${e.excecaoTipo})` : ""}`, `Error on the screen${e.excecaoTipo ? ` (${e.excecaoTipo})` : ""}`) : e.tipo === "request" ? t(`Chamada ao servidor falhou${e.status ? ` (HTTP ${e.status})` : ""}`, `Server call failed${e.status ? ` (HTTP ${e.status})` : ""}`) : e.tipo}</span>
                    <LinkErroInspector entidade={entidadeApp} view={no.nome} tipo={e.tipo || undefined} janela={janela}>{e.nome}</LinkErroInspector>
                    {modoNovo
                      ? <span className="dp-lista-meta">{formatarInt(e.n)} {e.n === 1 ? t("ocorrência", "occurrence") : t("ocorrências", "occurrences")}{e.ultimo ? ` · ${t("última", "last")} ${hora(e.ultimo)}` : ""}</span>
                      : <span className="dp-lista-meta"><UserSessionsIcon size={12} /> {formatarInt(e.sessoes)} {e.sessoes === 1 ? t("sessão", "session") : t("sessões", "sessions")} · {formatarInt(e.n)} {e.n === 1 ? t("erro", "error") : t("erros", "errors")}</span>}
                    {modoNovo && <ExemplosErro exemplos={e.exemplos} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {abaPagina === "erros" && (erros ?? []).some((e) => e.terceiro) && (
        <Secao recolhivel fechada titulo={`${t("Requisições de terceiros que falharam", "Third-party requests that failed")} (${formatarInt((erros ?? []).filter((e) => e.terceiro).reduce((soma, e) => soma + e.n, 0))})`} nota={t("analytics, anúncios, outros donos · não contam como erro da página", "analytics, ads, other owners · not counted as page errors")}>
          <ul className="dp-lista">
            {(erros ?? []).filter((e) => e.terceiro).map((e, i) => (
              <li key={i} className="dp-lista-item"><span className="dp-chip ok">HTTP {e.status ?? "?"}</span>
                <div className="dp-lista-texto"><span>{e.nome}</span><span className="dp-lista-meta">{modoNovo ? `${formatarInt(e.n)} ${t("ocorrências", "occurrences")}` : `${formatarInt(e.n)} · ${formatarInt(e.sessoes)} ${t("sessões", "sessions")}`}</span></div></li>
            ))}
          </ul>
        </Secao>
      )}

      {abaPagina === "cliques" && (cliques == null && !erro ? <Carregando /> : (
        <Secao titulo={<TituloIcone icone={<CursorIcon size={14} />}>{t("O que os clientes clicam", "What customers click")}</TituloIcone>} >
          <ListaBarras vazio={t("Nenhuma interação registrada.", "No interactions recorded.")}
            itens={(cliques ?? []).map((c, i) => ({ chave: `${c.elemento}|${i}`, rotulo: <code>{c.elemento}</code>, detalhe: `${c.tipo}${c.tag ? ` · ${c.tag}` : ""}`, pct: pctDe(c.n, totalCliques), valor: formatarInt(c.n) }))} />
        </Secao>
      ))}

      {abaPagina === "backend" && <>
        <Secao titulo={<TituloIcone icone={<PathIcon size={14} />}>{t("Caminho das chamadas", "Call path")}</TituloIcone>} nota={<span title={t("A ligação página → serviço vem das últimas 24 h analisadas, de hora em hora (com filtro de segmento, é lida ao abrir o Flow, no máximo a última hora); em ambientes grandes os traces são amostrados e a contagem é uma estimativa.", "The page → service link comes from the last 24 h analyzed, hour by hour (with a segment filter, it is read when the Flow opens, at most the last hour); in large environments traces are sampled and the count is an estimate.")}>{t("na ordem das chamadas", "in call order")}</span>}>
          {backendPendente ? <Carregando texto={textoLigando} /> : caminho.length === 0 ? <p className="painel-vazio">{semTraceCrossOrigin ?? (backendFalhou === "cadeia"
            ? t("O backend não carregou neste período (veja o aviso no grafo).", "The backend did not load for this timeframe (see the notice on the graph).")
            : backendFalhou ? t("A ligação desta página aos serviços não carregou neste período (veja o aviso no grafo).", "This page's link to backend services did not load for this timeframe (see the notice on the graph).")
            : null) ?? t("Nenhuma requisição desta página ligada a um trace do backend neste período.", "No request from this page linked to a backend trace in this timeframe.")}</p> : (
            <ol className="dp-cadeia">
              {caminho.map((s, i) => {
                const sv = saude?.get(s.id), p = pctFalha(sv), n = noDe(s.id);
                return (
                  <li key={s.id} className={`dp-passo${i === caminho.length - 1 ? " ultimo" : ""}${p && p > 0 ? " com-falha" : ""}`}>
                    <span className="dp-passo-numero">{s.ordem < 99 ? s.ordem : "·"}</span>
                    <div className="dp-passo-corpo">
                      <div className="dp-passo-topo">
                        <span className="dp-vizinho-icone"><IconeTipo no={n ?? noDoTipo("servico")} tamanho={16} /></span>
                        <span className="dp-passo-nome">{n ? linkNo(s.id) : <b title={s.nome}>{s.nome}</b>}</span>
                        <span className={`dp-papel ${papel(s)}`}>{rotuloPapel(papel(s))}</span>
                      </div>
                      <span className="dp-lista-meta">{formatarInt(s.chamadas)} {t("requisições da página", "page requests")}{sv ? <> · <span className={p && p > 0 ? "erro" : ""}>{textoPct(p)} {t("com falha", "failed")}</span>{sv.rtMs != null ? ` · ${formatarMs(sv.rtMs)} ${t("em média", "avg")}` : ""}</> : ""}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Secao>
        <Secao titulo={<TituloIcone icone={<ServicesIcon size={14} />}>{modoNovo ? t("Chamadas de API que falharam", "API calls that failed") : t("Chamadas de API desta página", "API calls from this page")}</TituloIcone>} nota={modoNovo ? t("período escolhido, ao vivo", "chosen timeframe, live") : undefined}>
          {reqs == null && !erro ? <Carregando /> : (reqs ?? []).length === 0 ? <p className="painel-vazio">{modoNovo ? t("Nenhuma chamada de API desta página falhou neste período.", "No API call from this page failed in this timeframe.") : t("Esta página não faz chamadas XHR/fetch.", "This page makes no XHR/fetch calls.")}</p> : (
            <ul className="dp-lista">
              {(reqs ?? []).map((r, i) => (
                <li key={i} className="dp-lista-item">
                  <div className="dp-lista-texto">
                    <code title={r.dominio}>{r.caminho}</code>
                    {modoNovo
                      ? <span className="dp-lista-meta"><span className="erro">{formatarInt(r.erros)} {r.erros === 1 ? t("falha", "failure") : t("falhas", "failures")}</span>{r.dominio ? ` · ${r.dominio}` : ""}</span>
                      : <span className="dp-lista-meta">{formatarInt(r.n)} {t("chamadas", "calls")} · {r.erros > 0 ? <span className="erro">{formatarInt(r.erros)} {t("com erro", "with errors")}</span> : t("sem erro", "no errors")}{r.durMs != null ? ` · ${formatarMs(r.durMs)} ${t("em média", "avg")}` : ""} · {formatarInt(r.ligadas)} {t("com trace", "with trace")}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </>}

      {abaPagina === "traces" && modoNovo && (erros == null && !erro ? <Carregando /> : <>
        <Secao titulo={<TituloIcone icone={<TracesIcon size={14} />}>{t("Com erro", "With errors")}</TituloIcone>} nota={t("os 3 mais recentes de cada erro · período escolhido, ao vivo", "the 3 most recent of each error · chosen timeframe, live")}>
          {(() => {
            const linhas = (erros ?? []).filter((e) => !e.terceiro).flatMap((e) => (e.exemplos ?? []).filter((x) => x.t).map((x) => ({ e, x })));
            return linhas.length === 0
              ? <p className="painel-vazio">{semTraceCrossOrigin ?? t("Nenhum erro com trace nesta página neste período.", "No error with a trace on this page in this timeframe.")}</p> : (
              <ul className="dp-lista">
                {linhas.map(({ e, x }, i) => (
                  <li key={i} className="dp-lista-item">
                    <span className="dp-chip falha">{e.status ?? t("falhou", "failed")}</span>
                    <div className="dp-lista-texto">
                      <code>{e.caminho ?? e.nome}</code>
                      <span className="dp-lista-meta">{[x.h ? hora(x.h) : "", x.d != null ? formatarMs(x.d) : ""].filter(Boolean).map((v) => `${v} · `).join("")}<LinkTrace trace={x.t!} inicio={x.h ?? undefined} rotulo={t("Abrir trace", "Open trace")} />{x.s ? <> · <LinkSessao id={x.s} quando={x.h} /></> : null}</span>
                    </div>
                  </li>
                ))}
              </ul>
            );
          })()}
        </Secao>
        <Secao titulo={<TituloIcone icone={<StopwatchIcon size={14} />}>{t("Mais lentas", "Slowest")}</TituloIcone>} nota={t("as 3 requisições mais lentas da página · últimas 24 h", "the page's 3 slowest requests · last 24 h")}>
          {lentas == null ? <Carregando /> : lentas.length === 0 ? <p className="painel-vazio">{semTraceCrossOrigin ?? t("Nenhuma requisição com trace nesta página nas últimas 24 h.", "No request with a trace on this page in the last 24 h.")}</p> : (
            <ul className="dp-lista">
              {lentas.map((x, i) => (
                <li key={i} className="dp-lista-item">
                  <span className="dp-chip ok">{formatarMs(x.d)}</span>
                  <div className="dp-lista-texto">
                    <code>{x.c ?? "?"}</code>
                    <span className="dp-lista-meta">{x.h ? `${hora(x.h)} · ` : ""}<LinkTrace trace={x.t} inicio={x.h} rotulo={t("Abrir trace", "Open trace")} />{x.s ? <> · <LinkSessao id={x.s} quando={x.h ?? undefined} /></> : null}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </>)}
      {abaPagina === "traces" && !modoNovo && (traces == null && !erro ? <Carregando /> : (
        <Secao titulo={<TituloIcone icone={<TracesIcon size={14} />}>{t("Traces recentes", "Recent traces")}</TituloIcone>} nota={t("falhas primeiro · abre no Distributed Tracing", "failures first · open in Distributed Tracing")}>
          {(traces ?? []).length === 0 ? <p className="painel-vazio">{semTraceCrossOrigin ?? t("Nenhuma requisição com trace do backend nesta página.", "No request with a backend trace on this page.")}</p> : (
            <ul className="dp-lista">
              {(traces ?? []).map((tr, i) => (
                <li key={i} className="dp-lista-item">
                  <span className={`dp-chip ${tr.falhou ? "falha" : "ok"}`}>{tr.falhou ? (tr.status ?? t("falhou", "failed")) : (tr.status ?? "OK")}</span>
                  <div className="dp-lista-texto">
                    <code>{tr.caminho}</code>
                    <span className="dp-lista-meta">{hora(tr.inicio)}{tr.durMs != null ? ` · ${formatarMs(tr.durMs)}` : ""} · <LinkTrace trace={tr.trace} inicio={tr.inicio} rotulo={t("Abrir trace", "Open trace")} /></span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      ))}
      {erro && <p className="painel-erro">{t("Erro na consulta", "Query error")}: {erro}</p>}
    </aside>
  );
};

const Resumo: React.FC<{ grafo: Grafo; apps: AppInfo[] }> = ({ grafo, apps }) => {
  const nomeApp = (id: string | null) => apps.find((a) => a.id === id)?.nome ?? "";
  const multi = apps.length > 1;
  const telas = grafo.nos.filter((n) => n.tipo === "view").sort((a, b) => b.entradas - a.entradas).slice(0, 10);
  const fins = [...grafo.nos.filter((n) => n.tipo === "view")].sort((a, b) => b.fim - a.fim).filter((n) => n.fim > 0).slice(0, 5);
  const servicos = grafo.nos.filter((n) => n.tipo === "servico" || n.tipo === "banco").sort((a, b) => b.chamadas - a.chamadas).slice(0, 10);
  const maxTela = telas[0]?.entradas ?? 0, maxServ = servicos[0]?.chamadas ?? 0;
  const detalhe = (n: NoFluxo) => (multi ? nomeApp(n.app) : undefined);
  return (
    <>
      <Barras recolhivel fechada titulo={<TituloIcone icone={<DocumentStackIcon size={14} />}>{t("Páginas mais visitadas", "Most visited pages")}</TituloIcone>} vazio={t("Nenhuma navegação neste período.", "No navigation in this timeframe.")} mostrarPct={false}
              itens={telas.map((n) => ({ chave: n.id, rotulo: n.nome, detalhe: detalhe(n), pct: pctDe(n.entradas, maxTela), valor: `${formatarInt(n.entradas)} ${t("visitas", "views")}` }))} />
      <Barras recolhivel fechada titulo={<TituloIcone icone={<LogoutIcon size={14} />}>{t("Onde as sessões terminam", "Where sessions end")}</TituloIcone>} vazio={t("Nenhuma sessão termina nestas páginas.", "No session ends on these pages.")}
              itens={fins.map((n) => ({ chave: n.id, rotulo: n.nome, detalhe: detalhe(n), pct: pctDe(n.fim, n.entradas), valor: `${formatarInt(n.fim)} ${t("de", "of")} ${formatarInt(n.entradas)}`, apagado: true }))} />
      {servicos.length > 0 && <Barras recolhivel fechada titulo={<TituloIcone icone={<ServicesIcon size={14} />}>{t("Backend usado", "Backend used")}</TituloIcone>} vazio="" mostrarPct={false}
              itens={servicos.map((n) => ({ chave: n.id, rotulo: n.nome, pct: pctDe(n.chamadas, maxServ), valor: `${formatarInt(n.chamadas)} req` }))} />}
    </>
  );
};

/** Destaques: o que chama atenção no fluxo, em primeiro lugar. Clicar acende o trecho no grafo e abre os detalhes. */
const Destaques: React.FC<{ grafo: Grafo; apps: AppInfo[]; aoDestacar?: (d: Destaque) => void; ativo: string | null }> = ({ grafo, apps, aoDestacar, ativo }) => {
  const nomeApp = (id: string | null) => apps.find((a) => a.id === id)?.nome ?? "";
  // com memo: antes recalculava a cada render do App (busca, seleção, pairar); o idioma entra porque o texto sai nele
  const idioma = idiomaAtual();
  const lista = useMemo(() => calcularDestaques(grafo, nomeApp), [grafo, apps, idioma]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Secao titulo={<TituloIcone icone={<WarningIcon size={14} />}>{t("Destaques", "Highlights")}</TituloIcone>} nota={t("o que chama atenção · clique para ver no fluxo", "what stands out · click to see it in the flow")}>
      {lista.length === 0 ? <p className="painel-vazio">{t("Nada chama atenção neste período: nenhum laço com erro, nenhuma etapa onde muitos param e nenhuma página com muitos erros.", "Nothing stands out in this timeframe: no loops with errors, no step where many users stop and no page with many errors.")}</p> : (
        <ul className="dp-destaques-lista">
          {lista.map((d) => (
            <li key={d.id}>
              <button className={`dp-destaque${d.impacto ? " impacto" : ""}${ativo === d.id ? " ativo" : ""}`} onClick={() => aoDestacar?.(d)}>
                <span className="dp-destaque-icone" aria-hidden="true">{d.impacto ? <WarningIcon size={16} /> : <PathIcon size={16} />}</span>
                <span className="dp-destaque-textos"><b>{d.titulo}</b><span>{d.detalhe}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
};

/** Qualidade do dado: por que o fluxo de um app sai quebrado e o que o time do app precisa ajustar (lib/qualidade.ts). */
const QualidadeDado: React.FC<{ grafo: Grafo; apps: AppInfo[]; linhas: LinhaQualidade[] }> = ({ grafo, apps, linhas }) => {
  const nomeApp = (id: string | null) => apps.find((a) => a.id === id)?.nome ?? "";
  const lista = avaliarQualidade(grafo, linhas, nomeApp);
  if (lista.length === 0) return null;
  return (
    <Secao recolhivel fechada titulo={<TituloIcone icone={<RepairIcon size={14} />}>{t(`Para ver o fluxo completo (${lista.length})`, `To see the whole flow (${lista.length})`)}</TituloIcone>} nota={t("ajustes de monitoramento", "monitoring fixes")}>
      <ul className="dp-qualidade">
        {lista.map((q) => (
          <li key={q.id}>
            <div className="pc-linha"><WarningIcon size={16} /><span className="pc-linha-texto"><b>{q.titulo}</b> · {q.detalhe}</span></div>
            <div className="pc-linha"><RepairIcon size={16} /><span className="pc-linha-texto">{q.correcao}<span className="pc-quem"><GroupIcon size={14} />{q.quem}</span></span></div>
          </li>
        ))}
      </ul>
    </Secao>
  );
};
