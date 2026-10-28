import React, { useState } from "react";
import type { AppInfo } from "../lib/graph";
import { formatarInt, formatarMs } from "../lib/graph";
import { localidade, t } from "../lib/i18n";
import { FAIXAS_APDEX, arredondarApdex, formatarApdex, notaApdex, pioresPaginas, taxaTravamentos, textoEstado, textoIgnorados, textoNota, tomNota, type Apdex, type ApdexMobile, type NotaApdex, type PiorMobile } from "../lib/apdex";
import { DesktopIcon, MobileIcon } from "@dynatrace/strato-icons";
import type { AbaPagina } from "./DetailPanel";

/** Visão geral: "Experiência (Apdex)". O Apdex de Web Vitals das páginas web do escopo (métrica de um pipeline de
    user.events do ambiente, docs/apdex.md; consulta de métrica: não é cobrada), com a nota, a linha do período e as páginas que mais puxam o número
    para baixo. Ação: cada página abre no Flow; o número (ou "Ver mais páginas") abre a lista completa; "Por aplicação"
    escolhe a aplicação. Verde em Bom e Excelente (0,85 a 1); âmbar em Razoável; vermelho só em Ruim e Inaceitável (lib/apdex.ts, tomNota).
    Com app mobile no escopo: CartaoExperiencia, com o Apdex mobile do DEF (agregados "amob", lib/agregados.ts)
    ao lado. */

interface Props {
  apdex: Apdex | null;
  carregando: boolean;
  apps: AppInfo[];
  /** escopo "Todas as aplicações" com mais de uma aplicação: mostra o Apdex por aplicação */
  multi: boolean;
  /** período do cartão: o da Visão geral, ou "7d" quando o escopo não teve medição agora e quem usa pediu 7 dias */
  janela: string;
  janelaPagina: string;
  aoTrocarJanela: (j: string | null) => void;
  aoEscolherApp: (id: string) => void;
  aoAbrirPagina: (app: string, view: string, aba?: AbaPagina) => void;
}

const PERIODO: Record<string, [string, string]> = {
  "10m": ["nos últimos 10 minutos", "in the last 10 minutes"], "30m": ["nos últimos 30 minutos", "in the last 30 minutes"], "60m": ["na última hora", "in the last hour"],
  "24h": ["nas últimas 24 horas", "in the last 24 hours"], "7d": ["nos últimos 7 dias", "in the last 7 days"],
};
const periodo = (j: string) => { const p = PERIODO[j]; return p ? t(p[0], p[1]) : t(`em ${j}`, `in ${j}`); };
const pctTexto = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);
const curto = (nome: string) => nome.replace(/^.*?\|\s*/, "");

export const CartaoApdex: React.FC<Props> = ({ apdex, carregando, apps, multi, janela, janelaPagina, aoTrocarJanela, aoEscolherApp, aoAbrirPagina }) => {
  const [mais, setMais] = useState(false);
  const cabecalho = (resumo?: React.ReactNode) => (
    <div className="ex-cabecalho">
      <h3>{t("Experiência (Apdex)", "Experience (Apdex)")}<span>{t("Web Vitals das páginas web", "Web Vitals of the web pages")}</span></h3>
      {resumo}
    </div>
  );
  if (!apdex) return carregando ? <section className="in-cartao ex-cartao ex-apdex">{cabecalho()}<p className="in-estado">{t("Lendo o Apdex…", "Reading the Apdex…")}</p></section> : null;
  const voltar = janela !== janelaPagina
    ? <button className="painel-link ex-voltar" onClick={() => aoTrocarJanela(null)}>{t("Voltar ao período da página", "Back to the page timeframe")}</button> : null;

  if (apdex.estado === "sem-dado") {
    return (
      <section className="in-cartao ex-cartao ex-apdex">
        {cabecalho()}
        <div className="ex-apdex-vazio">
          <span>{t(`Nenhuma página web deste escopo foi medida ${periodo(janela)}.`, `No web page in this scope was measured ${periodo(janela)}.`)}</span>
          {apdex.medicoes7d != null && apdex.medicoes7d > 0 && janela !== "7d" &&
            <button className="painel-link" onClick={() => aoTrocarJanela("7d")}>{t(`Ver os últimos 7 dias (${formatarInt(Math.round(apdex.medicoes7d))} cargas medidas) ›`, `See the last 7 days (${formatarInt(Math.round(apdex.medicoes7d))} measured loads) ›`)}</button>}
          {voltar}
        </div>
      </section>
    );
  }
  if (apdex.estado === "sem-medicao" || apdex.estado === "indisponivel") {
    // sem nenhuma medição em 7 dias (ou sem a métrica no ambiente): o cartão fica, com o motivo, o que fazer e quem faz
    const indisp = apdex.estado === "indisponivel";
    return (
      <section className="in-cartao ex-cartao ex-apdex">
        {cabecalho()}
        <div className="ex-apdex-vazio ex-apdex-acao">
          <span>{indisp
            ? t("A métrica de Apdex de Web Vitals (custom.rum.web_vitals.apdex_score) não é gravada neste ambiente.", "The Web Vitals Apdex metric (custom.rum.web_vitals.apdex_score) is not written in this environment.")
            : t("Nenhuma página web deste escopo mandou Web Vitals nos últimos 7 dias, então ainda não há nota.", "No web page in this scope sent Web Vitals in the last 7 days, so there is no score yet.")}</span>
          <span className="ex-acao"><b>{t("O que fazer: ", "What to do: ")}</b>{indisp
            ? t("calcular o Apdex de Web Vitals num pipeline de user.events (exemplo no README do app, docs/apdex.md) e aplicar a Configuração de novo.", "compute the Web Vitals Apdex in a user.events pipeline (example in the app's README, docs/apdex.md) and apply the Configuration again.")
            : t("conferir se o RUM da aplicação manda o resumo de página; numa SPA ele sai quando a página é descarregada.", "check that the application's RUM sends the page summary; in a SPA it is sent when the page is unloaded.")}</span>
          <span className="ex-quem">{t("Quem faz: ", "Who: ")}{indisp ? t("Observabilidade", "Observability") : t("time do frontend (RUM)", "frontend team (RUM)")}</span>
        </div>
      </section>
    );
  }
  if (apdex.estado !== "ok" || apdex.apdex == null || !apdex.nota) return null;

  const tom = tomNota(apdex.nota);
  const paginas = pioresPaginas(apdex, mais ? 10 : 3);
  const totalPiores = pioresPaginas(apdex, 10).length;
  const ignorados = textoIgnorados(apdex);
  const nomeApp = (id: string | null) => apps.find((a) => a.id === id)?.nome ?? null;
  const porApp = multi ? apdex.apps.filter((a) => a.app && apps.some((x) => x.id === a.app)) : [];
  const mobile = apps.filter((a) => a.canal === "mobile");

  return (
    <section className="in-cartao ex-cartao ex-apdex">
      {cabecalho(janela !== janelaPagina ? <span className="pb-selo ok">{t("últimos 7 dias", "last 7 days")}</span> : undefined)}
      <button className="ex-apdex-topo" onClick={() => setMais((v) => !v)} aria-expanded={mais}
              title={t("Apdex de 0 a 1: cada carga de página recebe a média das notas de LCP, FCP, CLS e INP (1 bom, 0,5 a melhorar, 0 ruim). Clique para ver mais páginas.",
                       "Apdex from 0 to 1: each page load gets the average of the LCP, FCP, CLS and INP scores (1 good, 0.5 needs improvement, 0 poor). Click to see more pages.")}>
        <span className={`ex-apdex-valor ${tom}`}>{formatarApdex(apdex.apdex)}</span>
        <span className="ex-apdex-nota">
          <span className={`ex-nota ${tom}`}>{textoNota(apdex.nota)}</span>
          <span className="ex-apdex-medicoes">{apdex.medicoes != null
            ? t(`${formatarInt(Math.round(apdex.medicoes))} cargas de página medidas ${periodo(janela)}`, `${formatarInt(Math.round(apdex.medicoes))} page loads measured ${periodo(janela)}`)
            : periodo(janela)}{apdex.amostraPequena && <span className="ex-pouco">{t(" · poucas medições", " · few measurements")}</span>}</span>
        </span>
      </button>
      <Escala valor={apdex.apdex} nota={apdex.nota} />
      {apdex.serie.some((v) => v != null) && <Linha serie={apdex.serie} inicio={apdex.inicioSerie} passoMs={apdex.passoMs} tom={tom} />}
      {porApp.length > 1 && (
        <p className="ex-por-app"><span>{t("Por aplicação:", "By application:")}</span>{porApp.map((a, i) => (
          <React.Fragment key={a.frontend}>{i > 0 && <span className="ex-sep"> · </span>}
            <span className="ex-por-app-item">
              <button className="painel-link" onClick={() => a.app && aoEscolherApp(a.app)} title={t("Ver os indicadores desta aplicação", "See this application's indicators")}>{curto(nomeApp(a.app) ?? a.frontend)}</button>{" "}
              <b className={`ex-nota-txt ${tomNota(a.nota)}`}>{formatarApdex(a.apdex)}</b></span></React.Fragment>))}
        </p>
      )}
      {paginas.length > 0 && (
        <div className="ex-piores">
          <h4>{t("Páginas que mais puxam o Apdex para baixo", "Pages pulling the Apdex down the most")}</h4>
          <ul>
            {paginas.map((p) => {
              const abre = !!p.app && apps.some((a) => a.id === p.app);
              return (
                <li key={`${p.frontend}|${p.view}`}>
                  <span className="ex-pagina">
                    <span className="ex-pagina-nome" title={p.view}>{p.view}</span>
                    <span className="ex-pagina-sub" title={t("Parte do que falta para o Apdex do escopo chegar a 1,00 que vem desta página (cargas medidas x o que cada uma perdeu)", "Share of the gap to 1.00 in the scope's Apdex that comes from this page (measured loads x what each one lost)")}>
                      {[multi && p.app ? curto(nomeApp(p.app) ?? "") : null, p.medicoes != null ? t(`${formatarInt(Math.round(p.medicoes))} cargas`, `${formatarInt(Math.round(p.medicoes))} loads`) : null,
                        t(`${pctTexto(p.pctPerda)} da queda do Apdex`, `${pctTexto(p.pctPerda)} of the Apdex drop`)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <b className={`ex-nota-txt ${tomNota(p.nota)}`} title={textoNota(p.nota)}>{formatarApdex(p.apdex)}</b>
                  {abre ? <button className="painel-link ex-ver" onClick={() => aoAbrirPagina(p.app!, p.view)}>{t("Ver no Flow ›", "See in Flow ›")}</button> : <span className="ex-ver" />}
                </li>
              );
            })}
          </ul>
          {totalPiores > 3 && <button className="pb-mais ex-mais" onClick={() => setMais((v) => !v)}>{mais ? t("Mostrar só as 3 piores", "Show only the worst 3") : t(`Ver mais páginas (${totalPiores})`, `See more pages (${totalPiores})`)}</button>}
        </div>
      )}
      {(ignorados || (apdex.pctRobos != null && apdex.pctRobos > 1) || (multi && apdex.mobileFora > 0) || voltar) && (
        <div className="ex-rodape">
          {ignorados && <span className="ex-aviso">{ignorados}</span>}
          {apdex.pctRobos != null && apdex.pctRobos > 1 && <span className="ex-aviso">{t(`Inclui ${pctTexto(apdex.pctRobos)} de cargas de robôs: a métrica não separa`, `Includes ${pctTexto(apdex.pctRobos)} robot loads: the metric does not separate them`)}</span>}
          {multi && apdex.mobileFora > 0 && <span className="ex-nota-rodape">{mobile.length === 1
            ? t(`${curto(mobile[0].nome)} fica fora: app mobile não tem Web Vitals`, `${curto(mobile[0].nome)} is not included: mobile apps have no Web Vitals`)
            : t(`${apdex.mobileFora} apps mobile ficam fora: não têm Web Vitals`, `${apdex.mobileFora} mobile apps are not included: they have no Web Vitals`)}</span>}
          {voltar}
        </div>
      )}
    </section>
  );
};

/* ---- Web + mobile -----------------------------------------------------------------
   Escopo com página web e app mobile medidos: as duas notas lado a lado, cada uma na régua dela (nunca média misturada),
   e embaixo o detalhe do canal escolhido no formato do cartão de hoje. Abre no canal com a nota pior; o canal não escolhido
   mostra, no próprio quadro, a pior página ou ação. Só web: o cartão de hoje (CartaoApdex, sem mudança). Só mobile: o
   cartão mobile (mesma forma). Crash e ANR: frustrados na nota e indicador próprio, com a taxa por sessão. */

interface PropsExperiencia extends Props {
  mobile: ApdexMobile | null;
  /** sessões das aplicações mobile do escopo no mesmo período (Visão geral), para a taxa de crash; null sem a base */
  sessoesMobile: number | null;
  /** o escopo tem app mobile (sem ele, o mobile nunca aparece) */
  temMobile: boolean;
}

export const CartaoExperiencia: React.FC<PropsExperiencia> = (p) => {
  const { apdex, mobile, carregando, temMobile } = p;
  if (carregando && !apdex && !mobile) return <CartaoApdex {...p} />;
  const webOk = !!apdex && apdex.estado === "ok" && apdex.apdex != null && !!apdex.nota;
  const mobOk = temMobile && !!mobile && mobile.estado === "ok" && mobile.apdex != null;
  if (webOk && mobOk) return <NotasEDetalhe {...p} web={apdex!} mobile={mobile!} />;
  if (mobOk && (!apdex || apdex.estado !== "ok")) return <CartaoMobile {...p} mobile={mobile!} />;
  if (temMobile && mobile && !mobOk && (!apdex || apdex.estado === "so-mobile")) return <CartaoMobileVazio mobile={mobile} janela={p.janela} />;
  return <CartaoApdex {...p} />;
};

const CabecalhoXa: React.FC<{ sub: string }> = ({ sub }) => (
  <div className="ex-cabecalho"><h3>{t("Experiência (Apdex)", "Experience (Apdex)")}<span>{sub}</span></h3></div>
);

/** Canal: ícone, nome e o recorte (aplicações). */
const RotuloCanal: React.FC<{ canal: "web" | "mobile"; detalhe: string }> = ({ canal, detalhe }) => (
  <span className="xa-canal">{canal === "web" ? <DesktopIcon size={14} /> : <MobileIcon size={14} />}<b>{canal === "web" ? "Web" : "Mobile"}</b><span>{detalhe}</span></span>
);

/** Número grande, nota e o que foi medido. */
const NotaXa: React.FC<{ valor: number; medido: React.ReactNode; pequeno?: boolean }> = ({ valor, medido, pequeno }) => {
  const nota = notaApdex(valor), tom = tomNota(nota);
  return (
    <div className={`xa-nota${pequeno ? " pequeno" : ""}`}>
      <span className={`ex-apdex-valor ${tom}`}>{formatarApdex(valor)}</span>
      <span className="ex-apdex-nota"><span className={`ex-nota ${tom}`}>{textoNota(nota)}</span><span className="ex-apdex-medicoes">{medido}</span></span>
    </div>
  );
};

const medidoWeb = (w: Apdex, janela: string, curtoP: boolean) => w.medicoes != null
  ? t(`${formatarInt(Math.round(w.medicoes))} cargas de página${curtoP ? "" : " " + periodo(janela)}`, `${formatarInt(Math.round(w.medicoes))} page loads${curtoP ? "" : " " + periodo(janela)}`)
  : periodo(janela);
const medidoMobile = (m: ApdexMobile, janela: string, curtoP: boolean) => {
  const partes = [
    m.acoes > 0 ? t(`${formatarInt(m.acoes)} ações`, `${formatarInt(m.acoes)} actions`) : null,
    m.telas > 0 ? t(`${formatarInt(m.telas)} telas`, `${formatarInt(m.telas)} screens`) : null,
    m.aberturas > 0 ? t(`${formatarInt(m.aberturas)} aberturas`, `${formatarInt(m.aberturas)} app starts`) : null,
  ].filter((x): x is string => !!x);
  const texto = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} ${t("e", "and")} ${partes[partes.length - 1]}` : partes[0] ?? "";
  return <>{curtoP ? texto : `${texto} ${periodo(janela)}`}{m.amostraPequena && <span className="ex-pouco">{t(" · poucas medições", " · few measurements")}</span>}</>;
};

/** "Por aplicação" ou "Por sistema", em uma linha (só com 2 ou mais). */
const PorItem: React.FC<{ rotulo: string; itens: { chave: string; nome: string; apdex: number; aoClicar?: () => void }[] }> = ({ rotulo, itens }) => itens.length < 2 ? null : (
  <p className="ex-por-app"><span>{rotulo}</span>{itens.map((a, i) => (
    <React.Fragment key={a.chave}>{i > 0 && <span className="ex-sep"> · </span>}
      <span className="ex-por-app-item">{a.aoClicar ? <button className="painel-link" onClick={a.aoClicar}>{a.nome}</button> : <span>{a.nome}</span>}{" "}
        <b className={`ex-nota-txt ${tomNota(notaApdex(a.apdex))}`}>{formatarApdex(a.apdex)}</b></span></React.Fragment>))}
  </p>
);

const ROTULO_ABERTURA: Record<string, [string, string]> = { cold: ["a frio", "cold"], warm: ["morna", "warm"], hot: ["quente", "hot"] };
const rotuloAbertura = (tipo: string) => { const r = ROTULO_ABERTURA[tipo] ?? ROTULO_ABERTURA.cold; return t(r[0], r[1]); };

/** Abertura do app: p75 por tipo (métrica nativa), com a cor da faixa de cada tipo (mesmos limites da nota). */
const Aberturas: React.FC<{ m: ApdexMobile }> = ({ m }) => {
  const comP75 = m.aberturasPorTipo.filter((a) => a.p75Ms != null);
  if (!comP75.length) return null;
  return (
    <p className="xa-aberturas"><span>{t("Abertura do app (p75):", "App start (p75):")}</span>{comP75.map((a, i) => {
      const [l1, l2] = LIMITES_ABERTURA_MS[a.tipo];
      const tom = a.p75Ms! <= l1 ? "ok" : a.p75Ms! <= l2 ? "atencao" : "erro";
      return <React.Fragment key={a.tipo}>{i > 0 && <span className="ex-sep"> · </span>}<span className="ex-por-app-item">{rotuloAbertura(a.tipo)} <b className={`ex-nota-txt ${tom}`}>{formatarMs(a.p75Ms)}</b></span></React.Fragment>;
    })}</p>
  );
};
/** Mesmos limites das regras (lib/prerequisitos.ts, LIMITES_ABERTURA), em ms. */
const LIMITES_ABERTURA_MS: Record<string, [number, number]> = { cold: [2000, 5000], warm: [1000, 2000], hot: [500, 1500] };

/** Crash e ANR: quantos e quanto das sessões (vermelho quando houve: a sessão acabou para o cliente). */
const textoTravamentos = (m: ApdexMobile, sessoes: number | null, curtoP = false) => {
  const taxa = taxaTravamentos(m, sessoes);
  // no quadro (curto) só o que houve; na linha do detalhe, crash e ANR sempre
  return [
    !curtoP || m.crashes > 0 ? t(`${formatarInt(m.crashes)} ${m.crashes === 1 ? "crash" : "crashes"}`, `${formatarInt(m.crashes)} ${m.crashes === 1 ? "crash" : "crashes"}`) : null,
    !curtoP || m.anrs > 0 ? `${formatarInt(m.anrs)} ANR` : null,
    taxa != null ? t(`${taxaTexto(taxa)} das sessões`, `${taxaTexto(taxa)} of sessions`) : null,
  ].filter(Boolean).join(" · ");
};
const taxaTexto = (p: number) => (p > 0 && p < 0.1 ? "<0,1%" : `${p.toLocaleString(localidade(), { maximumFractionDigits: p < 10 ? 1 : 0 })}%`);
const Travamentos: React.FC<{ m: ApdexMobile; sessoes: number | null }> = ({ m, sessoes }) => {
  const houve = m.crashes + m.anrs > 0;
  return (
    <p className="xa-aberturas xa-travamentos" title={t("Crash e ANR (app sem responder) encerram a sessão: cada um vale 0 na nota. Taxa = crashes e ANR ÷ sessões das aplicações mobile na mesma janela (Última hora ou Últimas 24 horas); nos outros períodos, só a contagem.",
                                                          "Crashes and ANRs (app not responding) end the session: each one scores 0. Rate = crashes and ANRs ÷ sessions of the mobile applications over the same window (Last hour or Last 24 hours); in other timeframes, the count only.")}>
      <span>{t("Crash e ANR:", "Crashes and ANRs:")}</span>
      {houve ? <b className="ex-nota-txt erro">{textoTravamentos(m, sessoes)}</b> : <span>{t("nenhum no período", "none in the timeframe")}</span>}
    </p>
  );
};

const nomeItemMobile = (x: PiorMobile) => x.tipo === "abertura" ? t(`Abertura do app ${rotuloAbertura(x.nome)}`, `${rotuloAbertura(x.nome)} app start`.replace(/^./, (c) => c.toUpperCase()))
  : x.tipo === "crash" ? t(`Crash em ${x.nome}`, `Crash on ${x.nome}`) : x.tipo === "anr" ? t(`ANR em ${x.nome}`, `ANR on ${x.nome}`) : x.nome;
const pctDe = (parte: number, n: number) => pctTexto(n > 0 ? (100 * parte) / n : 0);
const motivoMobile = (x: PiorMobile) => {
  if (x.tipo === "crash") return t(`${formatarInt(x.n)} ${x.n === 1 ? "sessão encerrada" : "sessões encerradas"} pelo crash`, `${formatarInt(x.n)} ${x.n === 1 ? "session" : "sessions"} ended by the crash`);
  if (x.tipo === "anr") return t(`${formatarInt(x.n)} ANR (app sem responder)`, `${formatarInt(x.n)} ANR (app not responding)`);
  if (x.tipo === "tela") return t(`com erro em ${pctDe(x.erro, x.n)}`, `with an error in ${pctDe(x.erro, x.n)}`);
  if (x.tipo === "abertura") {
    const [l1, l2] = (LIMITES_ABERTURA_MS[x.nome] ?? LIMITES_ABERTURA_MS.cold).map((v) => formatarMs(v));
    return [x.lento > 0 ? t(`acima de ${l2} em ${pctDe(x.lento, x.n)}`, `above ${l2} in ${pctDe(x.lento, x.n)}`) : null,
            x.tol > 0 ? t(`entre ${l1} e ${l2} em ${pctDe(x.tol, x.n)}`, `between ${l1} and ${l2} in ${pctDe(x.tol, x.n)}`) : null].filter(Boolean).join(" · ");
  }
  return [x.erro > 0 ? t(`com erro em ${pctDe(x.erro, x.n)}`, `with an error in ${pctDe(x.erro, x.n)}`) : null,
          x.lento > 0 ? t(`acima de 12 s em ${pctDe(x.lento, x.n)}`, `above 12 s in ${pctDe(x.lento, x.n)}`) : null,
          x.tol > 0 ? t(`de 3 a 12 s em ${pctDe(x.tol, x.n)}`, `3 to 12 s in ${pctDe(x.tol, x.n)}`) : null].filter(Boolean).join(" · ");
};
const unidadeMobile = (x: PiorMobile) => x.tipo === "acao" ? t(`${formatarInt(x.n)} ações`, `${formatarInt(x.n)} actions`) : x.tipo === "abertura" ? t(`${formatarInt(x.n)} aberturas`, `${formatarInt(x.n)} starts`)
  : x.tipo === "tela" ? t(`${formatarInt(x.n)} telas`, `${formatarInt(x.n)} screens`) : null;

const ListaWeb: React.FC<{ w: Apdex; apps: AppInfo[]; max: number; comApp: boolean; aoAbrirPagina: (app: string, view: string) => void }> = ({ w, apps, max, comApp, aoAbrirPagina }) => {
  const paginas = pioresPaginas(w, max);
  if (!paginas.length) return null;
  const nomeApp = (id: string | null) => apps.find((a) => a.id === id)?.nome ?? null;
  return (
    <div className="ex-piores">
      <h4>{t("Páginas que mais puxam o Apdex web para baixo", "Pages pulling the web Apdex down the most")}</h4>
      <ul>{paginas.map((p) => {
        const abre = !!p.app && apps.some((a) => a.id === p.app);
        return (
          <li key={`${p.frontend}|${p.view}`}>
            <span className="ex-pagina"><span className="ex-pagina-nome" title={p.view}>{p.view}</span>
              <span className="ex-pagina-sub">{[comApp && p.app ? curto(nomeApp(p.app) ?? "") : null, p.medicoes != null ? t(`${formatarInt(Math.round(p.medicoes))} cargas`, `${formatarInt(Math.round(p.medicoes))} loads`) : null,
                t(`${pctTexto(p.pctPerda)} da queda`, `${pctTexto(p.pctPerda)} of the drop`)].filter(Boolean).join(" · ")}</span></span>
            <b className={`ex-nota-txt ${tomNota(p.nota)}`} title={textoNota(p.nota)}>{formatarApdex(p.apdex)}</b>
            {abre ? <button className="painel-link ex-ver" onClick={() => aoAbrirPagina(p.app!, p.view)}>{t("Ver no Flow ›", "See in Flow ›")}</button> : <span className="ex-ver" />}
          </li>
        );
      })}</ul>
    </div>
  );
};

const ListaMobile: React.FC<{ m: ApdexMobile; apps: AppInfo[]; max: number; aoAbrirPagina: (app: string, view: string) => void }> = ({ m, apps, max, aoAbrirPagina }) => {
  const itens = m.piores.slice(0, max);
  if (!itens.length) return null;
  const comAcao = m.acoes > 0;
  return (
    <div className="ex-piores">
      <h4>{comAcao ? t("Ações e telas que mais puxam o Apdex mobile para baixo", "Actions and screens pulling the mobile Apdex down the most")
        : t("Telas que mais puxam o Apdex mobile para baixo", "Screens pulling the mobile Apdex down the most")}</h4>
      <ul>{itens.map((x) => {
        const tela = x.tipo === "abertura" ? null : x.tela;
        const abre = !!tela && apps.some((a) => a.id === x.app);
        const nota = notaApdex(x.apdex);
        return (
          <li key={`${x.app}|${x.tipo}|${x.nome}|${x.tela ?? ""}`}>
            <span className="ex-pagina"><span className="ex-pagina-nome" title={nomeItemMobile(x)}>{nomeItemMobile(x)}</span>
              <span className="ex-pagina-sub" title={[motivoMobile(x), x.tipo === "acao" ? x.tela : null].filter(Boolean).join(" · ")}>
                {[motivoMobile(x), t(`${pctTexto(x.pctPerda)} da queda`, `${pctTexto(x.pctPerda)} of the drop`), unidadeMobile(x), x.tipo === "acao" ? x.tela : null].filter(Boolean).join(" · ")}</span></span>
            <b className={`ex-nota-txt ${tomNota(nota)}`} title={textoNota(nota)}>{formatarApdex(x.apdex)}</b>
            {abre ? <button className="painel-link ex-ver" onClick={() => aoAbrirPagina(x.app, tela!)}>{t("Ver no Flow ›", "See in Flow ›")}</button> : <span className="ex-ver" />}
          </li>
        );
      })}</ul>
    </div>
  );
};

/** Rodapé: o "Validar:" das telas no lugar das ações e a régua de cada canal. */
const RodapeXa: React.FC<{ m: ApdexMobile; apps: AppInfo[]; soMobile?: boolean; extra?: React.ReactNode }> = ({ m, apps, soMobile, extra }) => {
  const semAcao = m.apps.filter((a) => a.porTelas);
  const nome = (id: string) => curto(apps.find((a) => a.id === id)?.nome ?? id);
  return (
    <div className="ex-rodape">
      {semAcao.length > 0 && <span className="ex-aviso">{semAcao.length === m.apps.length
        ? t("Validar: o app não manda ação de toque, só a abertura; a nota usa as telas (tela com erro = 0)", "Validate: the app sends no tap actions, only app start; the score uses screens (screen with an error = 0)")
        : t(`Validar: ${semAcao.map((a) => nome(a.app)).join(", ")} não manda ação de toque; a nota dele usa as telas (tela com erro = 0)`, `Validate: ${semAcao.map((a) => nome(a.app)).join(", ")} sends no tap actions; its score uses screens (screen with an error = 0)`)}</span>}
      {extra}
      <span className="ex-nota-rodape" title={t("Mobile: ação até 3 s = 1, até 12 s = 0,5, acima ou com erro = 0; abertura a frio até 2 s = 1, até 5 s = 0,5 (morna 1 e 2 s, quente 0,5 e 1,5 s); sem ação de toque, tela sem erro = 1 e com erro = 0; crash ou ANR = 0",
                                                  "Mobile: action up to 3 s = 1, up to 12 s = 0.5, above or with an error = 0; cold start up to 2 s = 1, up to 5 s = 0.5 (warm 1 and 2 s, hot 0.5 and 1.5 s); without tap actions, screen without an error = 1, with an error = 0; crash or ANR = 0")}>
        {soMobile ? t("Ação até 3 s vale 1, até 12 s vale 0,5; com erro, crash ou ANR vale 0. Abertura a frio até 2 s vale 1, até 5 s vale 0,5.", "An action up to 3 s scores 1, up to 12 s 0.5; with an error, crash or ANR 0. Cold start up to 2 s scores 1, up to 5 s 0.5.")
          : t("Web: Web Vitals da carga · Mobile: tempo e erro das ações, abertura do app e crash. Notas separadas, cada uma na sua régua.", "Web: Web Vitals of the load · Mobile: action time and errors, app start and crashes. Separate scores, each on its own scale.")}</span>
    </div>
  );
};

const appsWeb = (w: Apdex, apps: AppInfo[], aoEscolherApp: (id: string) => void) => w.apps.filter((a) => a.app && apps.some((x) => x.id === a.app))
  .map((a) => ({ chave: a.frontend, nome: curto(apps.find((x) => x.id === a.app)?.nome ?? a.frontend), apdex: a.apdex, aoClicar: () => a.app && aoEscolherApp(a.app) }));
const appsMobile = (m: ApdexMobile, apps: AppInfo[], aoEscolherApp: (id: string) => void) => m.apps.filter((a) => apps.some((x) => x.id === a.app))
  .map((a) => ({ chave: a.app, nome: curto(apps.find((x) => x.id === a.app)?.nome ?? a.app), apdex: a.apdex, aoClicar: () => aoEscolherApp(a.app) }));
const sistemas = (m: ApdexMobile) => m.porSistema.map((s) => ({ chave: s.nome, nome: s.nome, apdex: s.apdex }));
const nWeb = (w: Apdex, apps: AppInfo[]) => Math.max(1, w.apps.filter((a) => a.app && apps.some((x) => x.id === a.app)).length);
const nomeMobile = (m: ApdexMobile, apps: AppInfo[]) => m.apps.length === 1 ? curto(apps.find((x) => x.id === m.apps[0].app)?.nome ?? m.apps[0].frontend ?? "") : t(`${m.apps.length} apps`, `${m.apps.length} apps`);

/** Detalhe do mobile: a linha do período, por app e sistema, crash e ANR, abertura e a lista. */
const DetalheMobile: React.FC<{ m: ApdexMobile; apps: AppInfo[]; sessoes: number | null; max: number; aoEscolherApp: (id: string) => void; aoAbrirPagina: (app: string, view: string) => void }> = ({ m, apps, sessoes, max, aoEscolherApp, aoAbrirPagina }) => <>
  {m.serie.some((v) => v != null) && <Linha serie={m.serie} inicio={m.inicioSerie} passoMs={m.passoMs} tom={tomNota(m.nota!)} />}
  <PorItem rotulo={t("Por app:", "By app:")} itens={appsMobile(m, apps, aoEscolherApp)} />
  <PorItem rotulo={t("Por sistema:", "By OS:")} itens={sistemas(m)} />
  <Travamentos m={m} sessoes={sessoes} />
  <Aberturas m={m} />
  <ListaMobile m={m} apps={apps} max={max} aoAbrirPagina={aoAbrirPagina} />
</>;

const NotasEDetalhe: React.FC<PropsExperiencia & { web: Apdex; mobile: ApdexMobile }> = ({ web, mobile, apps, janela, sessoesMobile, aoAbrirPagina, aoEscolherApp }) => {
  // abre no canal com a nota pior (na nota mostrada, 2 casas): o que precisa de atenção aparece sem clique
  const [canal, setCanal] = useState<"web" | "mobile">(arredondarApdex(mobile.apdex!) < arredondarApdex(web.apdex!) ? "mobile" : "web");
  const [mais, setMais] = useState(false);
  const piorWeb = pioresPaginas(web, 1)[0], piorMobile = mobile.piores[0];
  const total = canal === "web" ? pioresPaginas(web, 10).length : Math.min(10, mobile.piores.length);
  const tile = (c: "web" | "mobile") => {
    const valor = c === "web" ? web.apdex! : mobile.apdex!, nota = notaApdex(valor);
    const pior = canal !== c ? (c === "web" ? (piorWeb ? { nome: piorWeb.view, apdex: piorWeb.apdex } : null) : (piorMobile ? { nome: nomeItemMobile(piorMobile), apdex: piorMobile.apdex } : null)) : null;
    return (
      <button role="tab" aria-selected={canal === c} className={`xa-tile${canal === c ? " ativo" : ""}`} onClick={() => { setCanal(c); setMais(false); }}>
        <RotuloCanal canal={c} detalhe={c === "web" ? t(`${nWeb(web, apps)} ${nWeb(web, apps) === 1 ? "aplicação" : "aplicações"}`, `${nWeb(web, apps)} ${nWeb(web, apps) === 1 ? "application" : "applications"}`) : nomeMobile(mobile, apps)} />
        <NotaXa valor={valor} medido={c === "web" ? medidoWeb(web, janela, true) : medidoMobile(mobile, janela, true)} pequeno />
        <Escala valor={valor} nota={nota} />
        {c === "mobile" && mobile.crashes + mobile.anrs > 0 && <span className="xa-crash">{textoTravamentos(mobile, sessoesMobile, true)}</span>}
        {pior && <span className="xa-pior" title={pior.nome}><span>{c === "web" ? t("Pior página:", "Worst page:") : t("Pior item:", "Worst item:")}</span> <span className="xa-pior-nome">{pior.nome}</span> <b className={`ex-nota-txt ${tomNota(notaApdex(pior.apdex))}`}>{formatarApdex(pior.apdex)}</b></span>}
      </button>
    );
  };
  return (
    <section className="in-cartao ex-cartao ex-apdex xa xa-a2">
      <CabecalhoXa sub={t(`web e mobile, cada um na sua régua · ${periodo(janela)}`, `web and mobile, each on its own scale · ${periodo(janela)}`)} />
      <div className="xa-tiles" role="tablist" aria-label={t("Canal", "Channel")}>{tile("web")}{tile("mobile")}</div>
      <div className="xa-detalhe" role="tabpanel">
        {canal === "web" ? <>
          {web.serie.some((v) => v != null) && <Linha serie={web.serie} inicio={web.inicioSerie} passoMs={web.passoMs} tom={tomNota(web.nota!)} />}
          <PorItem rotulo={t("Por aplicação:", "By application:")} itens={appsWeb(web, apps, aoEscolherApp)} />
          <ListaWeb w={web} apps={apps} max={mais ? 10 : 3} comApp aoAbrirPagina={aoAbrirPagina} />
        </> : <DetalheMobile m={mobile} apps={apps} sessoes={sessoesMobile} max={mais ? 10 : 3} aoEscolherApp={aoEscolherApp} aoAbrirPagina={aoAbrirPagina} />}
        {total > 3 && <button className="pb-mais ex-mais" onClick={() => setMais((v) => !v)}>{mais ? t("Mostrar só as 3 piores", "Show only the worst 3")
          : canal === "web" ? t(`Ver mais páginas (${total})`, `See more pages (${total})`) : t(`Ver mais ações e telas (${total})`, `See more actions and screens (${total})`)}</button>}
      </div>
      <RodapeXa m={mobile} apps={apps} extra={web.ignorados.length ? <span className="ex-aviso">{textoIgnorados(web)}</span> : null} />
    </section>
  );
};

/** Só mobile (ou web sem medição): a mesma forma do cartão web de hoje. */
const CartaoMobile: React.FC<PropsExperiencia & { mobile: ApdexMobile }> = ({ mobile, apdex, apps, janela, sessoesMobile, aoAbrirPagina, aoEscolherApp }) => {
  const [mais, setMais] = useState(false);
  const total = Math.min(10, mobile.piores.length);
  const web = apdex && apdex.estado !== "so-mobile" && apdex.estado !== "ok" ? textoEstado(apdex, periodo(janela)) : null;
  return (
    <section className="in-cartao ex-cartao ex-apdex xa xa-so-mobile">
      <CabecalhoXa sub={t("tempo e erro das ações, abertura do app e crash", "action time and errors, app start and crashes")} />
      <NotaXa valor={mobile.apdex!} medido={medidoMobile(mobile, janela, false)} />
      <Escala valor={mobile.apdex!} nota={mobile.nota!} />
      <DetalheMobile m={mobile} apps={apps} sessoes={sessoesMobile} max={mais ? 10 : 3} aoEscolherApp={aoEscolherApp} aoAbrirPagina={aoAbrirPagina} />
      {total > 3 && <button className="pb-mais ex-mais" onClick={() => setMais((v) => !v)}>{mais ? t("Mostrar só as 3 piores", "Show only the worst 3") : t(`Ver mais ações e telas (${total})`, `See more actions and screens (${total})`)}</button>}
      <RodapeXa m={mobile} apps={apps} soMobile extra={web ? <span className="ex-nota-rodape">{t(`Web: ${web}`, `Web: ${web}`)}</span> : null} />
    </section>
  );
};

/** Só mobile, sem nota: o motivo, o que fazer e quem faz. */
const CartaoMobileVazio: React.FC<{ mobile: ApdexMobile; janela: string }> = ({ mobile, janela }) => {
  const indisp = mobile.estado === "indisponivel";
  return (
    <section className="in-cartao ex-cartao ex-apdex xa">
      <CabecalhoXa sub={t("tempo e erro das ações, abertura do app e crash", "action time and errors, app start and crashes")} />
      <div className="ex-apdex-vazio ex-apdex-acao">
        <span>{indisp
          ? t("Os agregados do Apdex mobile não têm dado deste app nos últimos 7 dias.", "The mobile Apdex aggregates have no data for this app in the last 7 days.")
          : t(`Nenhuma ação, tela ou abertura do app foi medida ${periodo(janela)}.`, `No app action, screen or start was measured ${periodo(janela)}.`)}</span>
        {indisp && <span className="ex-acao"><b>{t("O que fazer: ", "What to do: ")}</b>{t("conferir na Configuração se o app está habilitado e se o workflow está rodando; os agregados só contam eventos novos.", "check in the Configuration that the app is enabled and the workflow is running; the aggregates only count new events.")}</span>}
        {indisp && <span className="ex-quem">{t("Quem faz: ", "Who: ")}{t("administrador do Digital Experience Flow", "Digital Experience Flow administrator")}</span>}
      </div>
    </section>
  );
};

/** Régua de 0 a 1 com as cinco faixas e o ponto do valor: a faixa da nota ganha a cor dela, as outras ficam neutras. */
const Escala: React.FC<{ valor: number; nota: NotaApdex }> = ({ valor, nota }) => {
  const faixas = [...FAIXAS_APDEX].reverse();            // de 0 para 1
  return (
    <div className="ex-escala" aria-hidden="true">
      <div className="ex-escala-trilho">
        {faixas.map((f, i) => {
          const fim = i + 1 < faixas.length ? faixas[i + 1].min : 1;
          return <span key={f.nota} className={`ex-faixa${f.nota === nota ? ` atual ${tomNota(f.nota)}` : ""}`} style={{ width: `${(fim - f.min) * 100}%` }} title={`${textoNota(f.nota)}: ${formatarApdex(f.min)}`} />;
        })}
        <span className={`ex-escala-ponto ${tomNota(nota)}`} style={{ left: `${Math.max(0, Math.min(1, valor)) * 100}%` }} />
      </div>
      <div className="ex-escala-rotulos">
        {faixas.slice(1).map((f) => <span key={f.nota} style={{ left: `${f.min * 100}%` }}>{formatarApdex(f.min)}</span>)}
      </div>
    </div>
  );
};

/** Linha do Apdex no período (uma faixa por intervalo da série; vazio = sem medição na faixa), com a referência 0,85 (Bom).
    1.45.12: o mouse (ou o dedo) sobre a linha mostra o intervalo, o Apdex e a nota dele, com a guia e o ponto marcados. */
const Linha: React.FC<{ serie: (number | null)[]; inicio: string | null; passoMs: number | null; tom: string }> = ({ serie, inicio, passoMs, tom }) => {
  const [foco, setFoco] = useState<number | null>(null);
  const W = 300, H = 46, n = serie.length;
  const vals = serie.filter((v): v is number => v != null);
  const min = Math.min(0.7, Math.floor((Math.min(...vals) - 0.04) * 20) / 20);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v: number) => 3 + (1 - (v - min) / (1 - min)) * (H - 6);
  // segmentos contínuos (sem ligar faixas sem medição)
  const trechos: string[] = [];
  let atual = "";
  serie.forEach((v, i) => { if (v == null) { if (atual) trechos.push(atual); atual = ""; } else atual += `${atual ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; });
  if (atual) trechos.push(atual);
  const ultimo = [...serie.keys()].reverse().find((i) => serie[i] != null);
  const hora = (ms: number) => new Date(ms).toLocaleTimeString(localidade(), { hour: "2-digit", minute: "2-digit" });
  const ini = inicio ? new Date(inicio).getTime() : NaN;
  const mover = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (n < 1 || r.width <= 0) return;
    setFoco(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };
  const vf = foco != null ? serie[foco] : null, pf = foco != null ? (x(foco) / W) * 100 : 0;
  return (
    <div className="ex-linha-grafico" onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setFoco(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t("Apdex ao longo do período", "Apdex over the timeframe")}>
        <line className="ex-ref" x1="0" x2={W} y1={y(0.85)} y2={y(0.85)} />
        {trechos.map((d) => <path key={d} className="ex-traco" d={d} />)}
        {foco != null && <line className="ex-guia" x1={x(foco)} x2={x(foco)} y1="0" y2={H} />}
      </svg>
      {ultimo != null && foco !== ultimo && <span className={`ex-linha-ponto ${tom}`} style={{ left: `${(x(ultimo) / W) * 100}%`, top: y(serie[ultimo]!) }} />}
      {foco != null && vf != null && <span className={`ex-linha-ponto foco ${tomNota(notaApdex(vf))}`} style={{ left: `${pf}%`, top: y(vf) }} />}
      {foco != null && (
        <div className={`ex-linha-dica${pf < 18 ? " esq" : pf > 82 ? " dir" : ""}`} style={{ left: `${pf}%` }} role="status">
          {vf != null
            ? <span className={`ex-dica-valor ${tomNota(notaApdex(vf))}`}><b>{formatarApdex(vf)}</b> {textoNota(notaApdex(vf))}</span>
            : <span className="ex-dica-valor">{t("Sem medição", "Not measured")}</span>}
          {!isNaN(ini) && passoMs ? <span className="ex-dica-hora">{t(`${hora(ini + foco * passoMs)} a ${hora(ini + (foco + 1) * passoMs)}`, `${hora(ini + foco * passoMs)} to ${hora(ini + (foco + 1) * passoMs)}`)}</span> : null}
        </div>
      )}
      <div className="ex-linha-eixo">
        <span>{!isNaN(ini) ? hora(ini) : ""}</span>
        <span className="ex-ref-rotulo">{t("tracejado: 0,85 (Bom)", "dashed: 0.85 (Good)")}</span>
        <span>{!isNaN(ini) && passoMs ? hora(ini + n * passoMs) : ""}</span>
      </div>
    </div>
  );
};
