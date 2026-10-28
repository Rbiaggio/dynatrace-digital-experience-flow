import React, { useEffect, useState } from "react";
import { AiIcon, BugReportIcon, DesktopIcon, FlowIcon, GroupIcon, LogoutIcon, MobileIcon, PathIcon, RepairIcon, ReplayIcon, ServicesIcon, SparklineIcon, TargetNodeIcon, WarningIcon } from "@dynatrace/strato-icons";
import type { AppInfo, Grafo, NoFluxo } from "../lib/graph";
import { formatarInt } from "../lib/graph";
import { SEM_NOME, detalheErro, oQueFazer, quemFaz, tituloErro, type Caminho, type ProblemaPagina } from "../lib/inicio";
import { calcularDestaques, type Destaque } from "../lib/destaques";
import { t, localidade } from "../lib/i18n";
import { montarPerguntaAssist, periodoLocal, type DadosAssist } from "../lib/assist";
import { lerEvidencias } from "../lib/evidencias";
import { analiseGuardada, type AnaliseIA } from "../lib/assistIA";
import { INTERVALO_SERIE, JANELAS, filtrosEmUso } from "../lib/queries";
import { replayDaApp, replayPorEscopo, rotuloVerSessoes, useReplayApps } from "../lib/replay";
import { entidadeDaApp, hrefErrosPagina, intervaloDe } from "./Links";
import { AnaliseAssist } from "./AnaliseAssist";
import type { FiltroSessoes } from "./ListaSessoes";
import type { AbaPagina } from "./DetailPanel";
import { OrigemBackend } from "./OrigemBackend";

/** "O que está afetando os clientes": um cartão por problema, do maior impacto para o menor. À ESQUERDA os indicadores,
    visuais: a rosca com a fatia de quem usou a página e teve erro, os dois números que doem (não concluíram / encerraram a
    sessão) com ícone, e os erros ao longo do período em miniatura. À DIREITA a história: o erro (ícone pelo tipo), o
    caminho do cliente em etiquetas com a etapa que falha em vermelho, o que fazer e quem faz, e as ações. */

interface Props {
  problemas: ProblemaPagina[]; caminhos: Caminho[]; series: Record<string, number[]>; geradoEm?: number; grafo: Grafo;
  /** 1.44.6: o período das 24 h analisadas (escopo padrão), base dos clientes afetados e do caminho no pedido ao Assist */
  periodoImpacto?: { de: number; ate: number } | null;
  /** botão "Analisar com o Dynatrace Assist" (só no Preview do lab, ver App.tsx) */
  assist?: boolean; apps: AppInfo[]; janela: string; robos: boolean;
  chipApp: ((id: string) => React.ReactNode) | null;
  aoVerSessoes: (f: FiltroSessoes) => void; aoDestacar: (d: Destaque) => void; aoAbrirPagina: (app: string, view: string, aba?: AbaPagina) => void;
}

const VISIVEIS = 4;
const nomePagina = (v: string) => (v === SEM_NOME ? t("(sem nome)", "(no name)") : v);
const pctTexto = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);

export const Problemas: React.FC<Props> = ({ problemas, caminhos, series, geradoEm, periodoImpacto, assist, grafo, apps, janela, robos, chipApp, aoVerSessoes, aoDestacar, aoAbrirPagina }) => {
  // cartões sem página (fluxo): "Ver sessões e Replay" só se alguma aplicação da tela grava replay (lib/replay.ts)
  const mapaReplay = useReplayApps();
  const rotuloFluxo = rotuloVerSessoes(mapaReplay && apps.length > 0 && apps.every((a) => replayDaApp(a.id, apps, mapaReplay) === "desligado") ? "desligado" : "desconhecido");
  const [todos, setTodos] = useState(false);
  const nomeApp = (id: string | null) => apps.find((a) => a.id === id)?.nome ?? id ?? "";
  const chave = (app: string | null, view: string) => `${app}|${view}`;
  const comProblema = new Set(problemas.map((p) => chave(p.app, p.view)));
  // o que o fluxo mostra: ligado a uma página com erro vira frase no cartão dela ("tentam de novo"); o resto, cartão próprio
  const extras = new Map<string, Destaque[]>();
  const soltos: Destaque[] = [];
  for (const d of calcularDestaques(grafo, nomeApp, 12)) {
    const nos = d.nos.map((id) => grafo.nos.find((n) => n.id === id)).filter((n): n is NoFluxo => !!n);
    const alvo = nos.find((n) => comProblema.has(chave(n.app, n.nome)));
    if (alvo) { if (d.tipo === "laco-erro" || d.tipo === "vai-erro") { const k = chave(alvo.app, alvo.nome); extras.set(k, [...(extras.get(k) ?? []), d]); } continue; }
    soltos.push(d);
  }
  const itens = [...problemas.map((p) => ({ tipo: "pagina" as const, p })), ...soltos.map((d) => ({ tipo: "fluxo" as const, d }))];
  if (itens.length === 0) return <p className="painel-vazio">{t("Nada afetando os clientes neste período: nenhum erro da aplicação e nenhuma etapa onde muitos param.", "Nothing affecting customers in this timeframe: no application errors and no step where many stop.")}</p>;
  const lista = todos ? itens : itens.slice(0, VISIVEIS);

  return (
    <>
      <ol className="pc-lista">
        {lista.map((x, i) => x.tipo === "pagina"
          ? <CartaoPagina key={`p|${x.p.app}|${x.p.view}`} ordem={i + 1} p={x.p} caminhos={caminhos} serie={series[chave(x.p.app, x.p.view)]} janela={janela} robos={robos}
                          geradoEm={geradoEm ?? Date.now()} periodoImpacto={periodoImpacto ?? null} assist={!!assist} appNome={nomeApp(x.p.app)} canal={apps.find((a) => a.id === x.p.app)?.canal ?? (x.p.app.includes("-") ? "mobile" : "web")} entidade={entidadeDaApp(apps, x.p.app)}
                          extras={extras.get(chave(x.p.app, x.p.view)) ?? []} chip={chipApp ? chipApp(x.p.app) : null}
                          hrefErros={hrefErrosPagina(entidadeDaApp(apps, x.p.app), x.p.view, janela)}
                          aoVerSessoes={() => aoVerSessoes({ soSaiu: false, view: x.p.view, appView: x.p.app })} aoAbrir={() => aoAbrirPagina(x.p.app, x.p.view, "erros")} />
          : <CartaoFluxo key={`d|${x.d.id}`} ordem={i + 1} d={x.d} rotulo={rotuloFluxo} aoDestacar={() => aoDestacar(x.d)}
                         aoVerSessoes={x.d.temErro ? () => { const n = grafo.nos.find((y) => y.id === x.d.foco); if (n?.app) aoVerSessoes({ soSaiu: false, view: n.nome, appView: n.app }); } : undefined} />)}
      </ol>
      {itens.length > VISIVEIS && (
        <button className="pb-mais" onClick={() => setTodos((v) => !v)}>{todos ? t("Mostrar só os principais", "Show only the main ones") : t(`Mostrar mais ${itens.length - VISIVEIS}`, `Show ${itens.length - VISIVEIS} more`)}</button>
      )}
    </>
  );
};

/** Dos que tiveram erro na etapa i do caminho: concluíram a etapa seguinte mesmo assim? */
function conclusao(c: Caminho, i: number): string {
  const comErro = c.comErro[i] ?? 0;
  const prox = i + 1 < c.passos.length ? c.passos[i + 1] : null;
  const concluiram = (c.comErroSeguiram[i] ?? 0) + (c.comErroDepois[i] ?? 0), encerraram = c.sairamAposErro[i] ?? 0;
  if (prox) {
    if (concluiram === 0) return t(`nenhum chegou a ${nomePagina(prox)}`, `none reached ${nomePagina(prox)}`);
    if (concluiram === comErro) return t(`todos chegaram a ${nomePagina(prox)} mesmo assim`, `all still reached ${nomePagina(prox)}`);
    return t(`${formatarInt(concluiram)} chegaram a ${nomePagina(prox)} mesmo assim, ${formatarInt(comErro - concluiram)} não`, `${formatarInt(concluiram)} still reached ${nomePagina(prox)}, ${formatarInt(comErro - concluiram)} did not`);
  }
  if (encerraram > 0) return encerraram === 1 ? t("1 encerrou a sessão ali", "1 ended the session there") : t(`${formatarInt(encerraram)} encerraram a sessão ali`, `${formatarInt(encerraram)} ended the session there`);
  return "";
}

const CartaoPagina: React.FC<{ ordem: number; p: ProblemaPagina; caminhos: Caminho[]; serie?: number[]; janela: string; robos: boolean; geradoEm: number; periodoImpacto: { de: number; ate: number } | null; assist: boolean; appNome: string; canal: string; entidade: string | null; extras: Destaque[]; chip: React.ReactNode; hrefErros: string | null; aoVerSessoes: () => void; aoAbrir: () => void }> =
  ({ ordem, p, caminhos, serie, janela, robos, geradoEm, periodoImpacto, assist, appNome, canal, entidade, extras, chip, hrefErros, aoVerSessoes, aoAbrir }) => {
  const mapaReplay = useReplayApps();   // "Ver sessões e Replay" só quando a aplicação grava replay (lib/replay.ts)
  const [backend, setBackend] = useState(false);
  const [analise, setAnalise] = useState(false);
  const [pronta, setPronta] = useState<AnaliseIA | null>(null);
  const e = p.erros[0];
  const naoConcluiram = p.fluxo?.proxima ? p.fluxo.naoConcluiram : 0;
  const grave = p.desistiram > 0 || naoConcluiram > 0;
  const c = p.fluxo ? caminhos[p.fluxo.indice] : null;
  const IconeErro = e?.tipo === "servidor" ? ServicesIcon : e?.tipo === "crash" ? MobileIcon : DesktopIcon;
  // Dynatrace Assist: o agente de causa raiz analisa o problema (análise, causa raiz, correção) e o relatório aparece aqui
  const { from, to } = intervaloDe(janela, geradoEm);   // o período dos números do cartão, não o de agora
  const filtros = filtrosEmUso(robos);
  const dadosAssist = (): DadosAssist => {
    const j = JANELAS.find((x) => x.valor === janela);
    return { appNome, appId: p.app, canal, entidade, problema: p, caminho: c && p.fluxo ? c : null, serie, intervalo: INTERVALO_SERIE[janela] ?? "5m",
      periodo: { de: from, ate: to, rotulo: j ? t(j.pt, j.en) : t("período escolhido", "chosen timeframe"), relativa: /^\d+[smhd]$/.test(janela) },
      filtros, quem: quemFaz(p), extras: extras.map((d) => d.detalhe),
      periodoImpacto: periodoImpacto ? { de: new Date(periodoImpacto.de).toISOString(), ate: new Date(periodoImpacto.ate).toISOString() } : null };
  };
  // com as evidências do ambiente (só roda quando ninguém analisou este cenário nas últimas 24 h)
  const montarAssist = async () => montarPerguntaAssist({ ...dadosAssist(), evidencias: await lerEvidencias(p.app, p.view, janela, robos, entidade, { de: from, ate: to }, e?.tipo === "servidor") });
  // o cenário é a página com o erro (ErroCliente.chave: aplicação + tipo + status + endpoint ou mensagem), não a janela nem
  // o filtro de quem olha: uma análise por cenário, pronta para todos
  const cenario = e ? `${p.view}|${e.chave}` : `${p.app}|${p.view}|-`;
  useEffect(() => {
    if (!assist) return;
    let vivo = true;
    analiseGuardada(cenario).then((a) => { if (vivo) setPronta(a); }, () => undefined);
    return () => { vivo = false; };
  }, [assist, cenario]);
  const selo = p.desistiram > 0 ? t("Clientes desistindo", "Customers giving up") : naoConcluiram > 0 ? t("Clientes não concluem", "Customers can't complete") : t("Clientes com erro", "Customers with errors");
  return (
    <li className={`pc${grave ? " pc-grave" : ""}`}>
      <header className="pc-topo">
        <span className="pc-ordem">{ordem}</span>
        <b className="pc-pagina" title={p.view}>{nomePagina(p.view)}</b>
        {chip}
        <span className={`pb-selo${grave ? " grave" : ""} pc-selo`}>{selo}</span>
      </header>
      <div className="pc-corpo">
        <aside className="pc-ind">
          <div className="pc-afetados">
            <Rosca pct={p.pctAfetados} />
            <div className="pc-afetados-texto">
              <b>{formatarInt(p.afetados)}</b>
              <span>{p.afetados === 1 ? t("cliente afetado", "customer affected") : t("clientes afetados", "customers affected")}</span>
              <small>{t(`de ${formatarInt(p.visitantes)} que usaram a página`, `of ${formatarInt(p.visitantes)} who used the page`)}</small>
            </div>
          </div>
          <ul className="pc-kpis">
            {p.fluxo?.proxima && (
              <li className={naoConcluiram > 0 ? "critico" : ""}><TargetNodeIcon size={16} /><b>{formatarInt(naoConcluiram)}</b><span>{t(`não chegaram a ${nomePagina(p.fluxo.proxima)}`, `did not reach ${nomePagina(p.fluxo.proxima)}`)}</span></li>
            )}
            <li className={p.desistiram > 0 ? "critico" : ""}><LogoutIcon size={16} /><b>{formatarInt(p.desistiram)}</b><span>{t("encerraram a sessão logo após o erro", "ended the session right after the error")}</span></li>
          </ul>
          <Linha serie={serie} />
        </aside>
        <div className="pc-det">
          <div className="pc-linha">
            <IconeErro size={16} />
            <span className="pc-linha-texto"><b>{e ? tituloErro(e) : t("Erro na página", "Error on the page")}</b>{e ? ` · ${detalheErro(e)}` : ""}{p.erros.length > 1 && <small> · {p.erros.length === 2 ? t("mais 1 tipo de erro", "1 more error type") : t(`mais ${p.erros.length - 1} tipos de erro`, `${p.erros.length - 1} more error types`)}</small>}</span>
          </div>
          {c && p.fluxo
            ? <Caminho c={c} etapa={p.fluxo.etapa} />
            : <div className="pc-linha"><PathIcon size={16} /><span className="pc-linha-texto pc-apagado">{t("Fora dos principais fluxos", "Outside the main flows")}</span></div>}
          {extras.map((d) => <div key={d.id} className="pc-linha"><WarningIcon size={16} /><span className="pc-linha-texto">{d.detalhe}</span></div>)}
          <div className="pc-linha">
            <RepairIcon size={16} />
            <span className="pc-linha-texto">{oQueFazer(p)}<span className="pc-quem"><GroupIcon size={14} />{quemFaz(p)}</span></span>
          </div>
          <div className="pc-acoes">
            <button className="painel-link" onClick={aoVerSessoes}><ReplayIcon size={14} />{rotuloVerSessoes(replayPorEscopo(entidade, canal === "mobile", mapaReplay))}</button>
            {hrefErros && <a className="painel-link" href={hrefErros} target="_blank" rel="noreferrer"><BugReportIcon size={14} />{t("Ver erros ↗", "See errors ↗")}</a>}
            <button className="painel-link" onClick={aoAbrir}><FlowIcon size={14} />{t("Ver no Flow", "See in Flow")}</button>
            {e?.tipo === "servidor" && <button className="painel-link" onClick={() => setBackend((v) => !v)} aria-expanded={backend}><ServicesIcon size={14} />{t("Onde falha no backend?", "Where does it fail in the backend?")}</button>}
            {assist && (pronta
              ? <button className="painel-link pc-assist" onClick={() => setAnalise((v) => !v)} aria-expanded={analise} title={t(`Análise pronta: gerada por ${pronta.por || "alguém"} em ${new Date(pronta.quando).toLocaleString(localidade(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`, `Analysis ready: generated by ${pronta.por || "someone"} on ${new Date(pronta.quando).toLocaleString(localidade(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`)}><AiIcon size={14} />{t("Ver análise do Dynatrace Assist", "See the Dynatrace Assist analysis")}<span className="pc-pronta">{t("pronta", "ready")}</span></button>
              : <button className="painel-link pc-assist" onClick={() => setAnalise((v) => !v)} aria-expanded={analise} title={t("Peça ajuda ao Dynatrace Assist na análise do problema, na causa raiz e nas ações para correção", "Ask Dynatrace Assist for help with the problem analysis, the root cause and the corrective actions")}><AiIcon size={14} />{t("Analisar com o Dynatrace Assist", "Analyze with Dynatrace Assist")}</button>)}
          </div>
          {backend && <div className="pc-backend"><OrigemBackend app={p.app} view={p.view} janela={janela} robos={robos} aberto /></div>}
          {analise && <AnaliseAssist chave={cenario} aoPronta={setPronta} montar={montarAssist} montarBasico={() => montarPerguntaAssist(dadosAssist())} pagina={nomePagina(p.view)} app={appNome} periodo={periodoLocal(from, to)} aoFechar={() => setAnalise(false)} />}
        </div>
      </div>
    </li>
  );
};

/** O caminho do cliente até a etapa que falha, em etiquetas: número, página e quantos chegaram; a etapa com erro em vermelho. */
const Caminho: React.FC<{ c: Caminho; etapa: number }> = ({ c, etapa }) => {
  const comErro = c.comErro[etapa] ?? 0;
  const fim = conclusao(c, etapa);
  const frase = `${comErro === 1 ? t("1 teve erro", "1 had an error") : t(`${formatarInt(comErro)} tiveram erro`, `${formatarInt(comErro)} had errors`)}${fim ? ` · ${fim}` : ""}`;
  return (
    <div className="pc-linha pc-caminho">
      <PathIcon size={16} />
      <div className="pc-caminho-corpo">
        <ol className="pc-chips">
          {c.passos.map((p, i) => (
            <li key={i} className={`pc-chip${i === etapa ? " erro" : ""}${i > etapa + 1 ? " depois" : ""}`}>
              {i > 0 && <span className="pc-seta" aria-hidden="true">→</span>}
              <span className="pc-chip-n">{i + 1}</span>
              <span className="pc-chip-nome" title={p}>{nomePagina(p)}</span>
              <small>{formatarInt(c.chegaram[i] ?? 0)}</small>
            </li>
          ))}
          {c.continua && <li className="pc-chip depois"><span className="pc-seta" aria-hidden="true">→</span><span className="pc-chip-nome">…</span></li>}
        </ol>
        <span className="pc-caminho-frase">{frase}</span>
      </div>
    </div>
  );
};

/** Rosca: a fatia de quem usou a página e teve erro. */
const Rosca: React.FC<{ pct: number }> = ({ pct }) => {
  const r = 29, C = 2 * Math.PI * r, a = Math.max(0, Math.min(100, pct));
  return (
    <svg className="pc-rosca" viewBox="0 0 76 76" width="76" height="76" role="img" aria-label={t(`${pctTexto(pct)} dos clientes da página tiveram erro`, `${pctTexto(pct)} of the page's customers had an error`)}>
      <circle cx="38" cy="38" r={r} className="pc-rosca-trilho" strokeWidth="9" fill="none" />
      <circle cx="38" cy="38" r={r} className="pc-rosca-arco" strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray={`${(C * a) / 100} ${C}`} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle" className="pc-rosca-pct">{pctTexto(pct)}</text>
    </svg>
  );
};

/** Erros ao longo do período, em miniatura (um ponto por faixa de tempo). */
const Linha: React.FC<{ serie?: number[] }> = ({ serie }) => {
  if (!serie || serie.length < 2) return null;
  const total = serie.reduce((s, v) => s + v, 0);
  if (total === 0) return null;
  const W = 200, H = 34, max = Math.max(1, ...serie);
  const pts = serie.map((v, i) => [(i / (serie.length - 1)) * W, H - 3 - (v / max) * (H - 8)] as const);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const ultimo = pts[pts.length - 1];
  return (
    <div className="pc-spark" title={t("Erros desta página ao longo do período", "Errors on this page over the timeframe")}>
      <span className="pc-spark-rotulo"><SparklineIcon size={14} />{t("erros no período", "errors over the timeframe")}<b>{formatarInt(total)}</b></span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pc-spark-svg" aria-hidden="true">
        <path d={`${d} L${W} ${H} L0 ${H} Z`} className="pc-spark-area" />
        <path d={d} className="pc-spark-linha" vectorEffect="non-scaling-stroke" />
        <circle cx={ultimo[0]} cy={ultimo[1]} r="2.5" className="pc-spark-ponto" />
      </svg>
    </div>
  );
};

/** O que o fluxo mostra sem erro registrado na página (clientes que param, que vão e voltam). */
const CartaoFluxo: React.FC<{ ordem: number; d: Destaque; rotulo?: string; aoDestacar: () => void; aoVerSessoes?: () => void }> = ({ ordem, d, rotulo, aoDestacar, aoVerSessoes }) => (
  <li className={`pc${d.impacto ? "" : " pc-atencao"}`}>
    <header className="pc-topo">
      <span className="pc-ordem">{ordem}</span>
      <b className="pc-pagina">{d.titulo}</b>
      <span className={`pb-selo${d.impacto ? "" : " atencao"} pc-selo`}>{d.impacto ? t("Clientes com erro", "Customers with errors") : t("Atenção", "Attention")}</span>
    </header>
    <div className="pc-det pc-det-so">
      <div className="pc-linha"><WarningIcon size={16} /><span className="pc-linha-texto">{d.detalhe} <small>{d.explicacao}</small></span></div>
      <div className="pc-linha"><RepairIcon size={16} /><span className="pc-linha-texto">{d.acao}<span className="pc-quem"><GroupIcon size={14} />{d.quem}</span></span></div>
      <div className="pc-acoes">
        {aoVerSessoes && <button className="painel-link" onClick={aoVerSessoes}><ReplayIcon size={14} />{rotulo ?? t("Ver sessões e Replay", "See sessions and Replay")}</button>}
        <button className="painel-link" onClick={aoDestacar}><FlowIcon size={14} />{t("Ver no Flow", "See in Flow")}</button>
      </div>
    </div>
  </li>
);
