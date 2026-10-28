import React, { useState } from "react";
import { BugReportIcon, ReplayIcon, ServicesIcon } from "@dynatrace/strato-icons";
import { formatarInt } from "../lib/graph";
import { SEM_NOME, curtoErro, type Caminho, type ErroCliente } from "../lib/inicio";
import { OrigemBackend } from "./OrigemBackend";
import { t } from "../lib/i18n";
import type { FiltroSessoes } from "./ListaSessoes";
import type { AbaPagina } from "./DetailPanel";

/** Principais fluxos como FUNIL de colunas: uma barra por etapa, com a altura de quantos clientes chegaram até ela
    por este caminho e a parte vermelha de quem teve erro ali. Entre duas barras, uma faixa clara liga o topo de uma ao
    topo da outra (quem seguiu); o degrau que sobra em cima da faixa é quem não seguiu, marcado ali mesmo ("−174") e
    explicado em uma linha curta embaixo, alinhada ao vão. A etapa com erro ganha UMA linha discreta: qual erro, se
    concluíram a etapa seguinte mesmo assim, os atalhos e "Onde falha no backend?" (abre embaixo, sob demanda). */

interface Props {
  caminhos: Caminho[]; chipApp: ((id: string) => React.ReactNode) | null; janela: string; robos: boolean;
  erroDaPagina: (app: string, view: string) => ErroCliente | null;
  hrefErros: (app: string, view: string) => string | null;
  aoVerSessoes: (f: FiltroSessoes) => void; aoAbrirPagina: (app: string, view: string, aba?: AbaPagina) => void;
}

const nomePagina = (v: string) => (v === SEM_NOME ? t("(sem nome)", "(no name)") : v);
const pctTexto = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);

const VISIVEIS = 3;
// geometria do gráfico (unidades do viewBox: 100 por coluna; a altura é 1 unidade = 1 px, porque o SVG estica só na
// horizontal): a barra ocupa 30 unidades no meio da coluna; as barras vão de ALTO (cabe o número em cima) até BASE.
const COL = 100, BARRA = 30, ALTO = 20, BASE = 130, ALTURA = 134;

export const Fluxos: React.FC<Props> = ({ caminhos, chipApp, janela, robos, erroDaPagina, hrefErros, aoVerSessoes, aoAbrirPagina }) => {
  const [todos, setTodos] = useState(false);
  return (
  <>
    <ol className="fx-lista">
      {(todos ? caminhos : caminhos.slice(0, VISIVEIS)).map((c, i) => <Fluxo key={i} c={c} chip={chipApp ? chipApp(c.app) : null} janela={janela} robos={robos} erroDaPagina={(v) => erroDaPagina(c.app, v)} hrefErros={(v) => hrefErros(c.app, v)}
                                     aoVerSessoes={(v) => aoVerSessoes({ soSaiu: false, view: v, appView: c.app })} aoAbrir={(v, aba) => aoAbrirPagina(c.app, v, aba)} />)}
    </ol>
    {caminhos.length > VISIVEIS && <button className="pb-mais" onClick={() => setTodos((v) => !v)}>{todos ? t("Mostrar só os principais", "Show only the main ones") : t(`Mostrar mais ${caminhos.length - VISIVEIS}`, `Show ${caminhos.length - VISIVEIS} more`)}</button>}
    <p className="fx-legenda">
      <span>{t("Como ler: cada barra é quantos clientes chegaram à etapa por este caminho (em vermelho, os que tiveram erro ali); a faixa entre duas barras é quem seguiu. O degrau acima da faixa é quem não seguiu:", "How to read: each bar is how many customers reached the step through this path (in red, those who had an error there); the band between two bars is who went on. The step above the band is who did not continue:")}</span>
      <span><i className="fx-ponto outra" />{t("foi para outra página (outra jornada, não é abandono)", "went to another page (another journey, not abandonment)")}</span>
      <span><i className="fx-ponto sem-erro" />{t("encerrou a sessão sem erro (fechou ou ficou inativo; pode incluir sessões em andamento); em amarelo só quando é relevante", "ended the session with no error (closed or went idle; may include sessions still in progress); amber only when relevant")}</span>
      <span><i className="fx-ponto apos-erro" />{t("saiu depois de um erro", "left after an error")}</span>
    </p>
  </>
  );
};

/** Entre a etapa i e a i+1: quem não seguiu e o que fez. As três partes somam a queda: foi para outra página (outra
    jornada), saiu sem erro (fechou ou ficou inativo), saiu após um erro. */
interface Queda { i: number; antes: number; perdeu: number; outra: number; semErro: number; aposErro: number; destinos: { pagina: string; n: number }[] }
const quedas = (c: Caminho): Queda[] => c.passos.slice(0, -1).map((_, i) => {
  const antes = c.chegaram[i] ?? 0, depois = c.chegaram[i + 1] ?? 0;
  const aposErro = c.sairamAposErro[i] ?? 0, semErro = Math.max(0, (c.sairam[i] ?? 0) - aposErro), outra = c.foram[i] ?? 0;
  return { i, antes, perdeu: Math.max(0, antes - depois), outra, semErro, aposErro, destinos: c.destinos[i] ?? [] };
});

const Fluxo: React.FC<{ c: Caminho; chip: React.ReactNode; janela: string; robos: boolean; erroDaPagina: (v: string) => ErroCliente | null; hrefErros: (v: string) => string | null; aoVerSessoes: (v: string) => void; aoAbrir: (v: string, aba?: AbaPagina) => void }> =
  ({ c, chip, janela, robos, erroDaPagina, hrefErros, aoVerSessoes, aoAbrir }) => {
  const [backendAberto, setBackendAberto] = useState<number | null>(null);
  const topo = Math.max(1, ...c.chegaram);
  const ultima = c.passos.length - 1;
  const comErroTotal = Math.max(0, ...c.comErro);
  const desistiram = c.sairamAposErro.reduce((s, x) => s + x, 0);
  const colunas = c.passos.length + (c.continua ? 1 : 0);
  const largura = colunas * COL;
  const colMax = colunas <= 2 ? 260 : colunas === 3 ? 340 : 420;   // largura máxima de cada coluna, em px
  const topos = c.passos.map((_, i) => BASE - Math.max(3, ((BASE - ALTO) * (c.chegaram[i] ?? 0)) / topo));
  const centro = (i: number) => `${((i * COL + COL / 2) / largura) * 100}%`;     // centro da coluna i
  const vao = (i: number) => `${(((i + 1) * COL) / largura) * 100}%`;           // meio do vão entre i e i+1
  const qs = quedas(c);
  // a faixa de quem seguiu: do topo da barra i ao topo da barra i+1, em curva suave, até a base
  const faixa = (i: number) => {
    const xr = i * COL + COL / 2 + BARRA / 2, xl = (i + 1) * COL + COL / 2 - BARRA / 2, m = (xr + xl) / 2;
    return `M${xr} ${topos[i]} C${m} ${topos[i]} ${m} ${topos[i + 1]} ${xl} ${topos[i + 1]} L${xl} ${BASE} L${xr} ${BASE} Z`;
  };
  return (
    <li className="fx">
      <div className="fx-topo">
        <b className="fx-pct">{pctTexto(c.pct)}</b>
        <span className="fx-topo-texto">{t(`das sessões fazem este caminho completo · ${formatarInt(c.n)} sessões`, `of the sessions take this whole path · ${formatarInt(c.n)} sessions`)}</span>
        {chip}
        <span className="fx-topo-espaco" />
        {desistiram > 0 ? <span className="pb-selo grave">{desistiram === 1 ? t("1 desistiu após um erro", "1 gave up after an error") : t(`${formatarInt(desistiram)} desistiram após um erro`, `${formatarInt(desistiram)} gave up after an error`)}</span>
          : comErroTotal > 0 ? <span className="pb-selo">{t("Etapa com erro", "Step with errors")}</span>
          : <span className="pb-selo ok">{t("Sem erro", "No errors")}</span>}
      </div>
      <div className="fx-funil">
        <div className="fx-area-grafico" style={{ maxWidth: `${colunas * colMax}px` }}>
        <div className="fx-grafico" style={{ height: `${ALTURA}px` }}>
          <svg className="fx-svg" viewBox={`0 0 ${largura} ${ALTURA}`} preserveAspectRatio="none" aria-hidden="true">
            <line className="fx-base" x1={0} x2={largura} y1={BASE + 0.5} y2={BASE + 0.5} vectorEffect="non-scaling-stroke" />
            {c.passos.slice(0, -1).map((p, i) => (
              <path key={`f${i}`} className="fx-faixa" d={faixa(i)}>
                <title>{t(`${formatarInt(c.chegaram[i + 1] ?? 0)} seguiram de ${nomePagina(p)} para ${nomePagina(c.passos[i + 1])}`, `${formatarInt(c.chegaram[i + 1] ?? 0)} went on from ${nomePagina(p)} to ${nomePagina(c.passos[i + 1])}`)}</title>
              </path>
            ))}
            {c.passos.map((_, i) => {
              const chegaram = c.chegaram[i] ?? 0, comErro = c.comErro[i] ?? 0;
              const x = i * COL + COL / 2 - BARRA / 2, h = BASE - topos[i];
              const he = comErro > 0 ? Math.max(3, (h * comErro) / Math.max(1, chegaram)) : 0;
              return (
                <g key={`b${i}`}>
                  <rect className="fx-barra" x={x} y={topos[i]} width={BARRA} height={h} />
                  {he > 0 && <rect className="fx-barra-erro" x={x} y={BASE - he} width={BARRA} height={he} />}
                </g>
              );
            })}
          </svg>
          {c.passos.map((_, i) => {
            const chegaram = c.chegaram[i] ?? 0, comErro = c.comErro[i] ?? 0;
            return <span key={`v${i}`} className={`fx-valor${comErro > 0 ? " erro" : ""}`} style={{ left: centro(i), top: `${topos[i] - 3}px` }}>{formatarInt(chegaram)}</span>;
          })}
          {qs.map((q) => q.perdeu > 0 && (
            <span key={`q${q.i}`} className="fx-queda" style={{ left: vao(q.i), top: `${Math.max(16, (topos[q.i] + topos[q.i + 1]) / 2 - 4)}px` }}
                  title={t(`${formatarInt(q.perdeu)} de ${formatarInt(q.antes)} não seguiram (${pctTexto((100 * q.perdeu) / Math.max(1, q.antes))})`, `${formatarInt(q.perdeu)} of ${formatarInt(q.antes)} did not continue (${pctTexto((100 * q.perdeu) / Math.max(1, q.antes))})`)}>
              −{formatarInt(q.perdeu)}
            </span>
          ))}
        </div>
        <div className="fx-rotulos" style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}>
          {c.passos.map((p, i) => {
            const comErro = c.comErro[i] ?? 0;
            return (
              <div key={i} className={`fx-col${comErro > 0 ? " fx-col-erro" : ""}`}>
                <button className="fx-rotulo" onClick={() => aoAbrir(p, comErro > 0 ? "erros" : undefined)} title={`${i + 1}. ${p}`}>
                  <span className="fx-n">{i + 1}</span><span className="fx-nome">{nomePagina(p)}</span>
                </button>
                {comErro > 0 && <span className="fx-erro-txt">{t(`${formatarInt(comErro)} com erro`, `${formatarInt(comErro)} with errors`)}</span>}
              </div>
            );
          })}
          {c.continua && <div className="fx-col mais"><span className="fx-rotulo"><span className="fx-nome">…</span></span></div>}
        </div>
        {qs.some((q) => q.perdeu > 0) && (
          <div className="fx-quedas" style={{ gridTemplateColumns: `minmax(0, .5fr) repeat(${colunas - 1}, minmax(0, 1fr)) minmax(0, .5fr)` }}>
            {qs.map((q) => (
              <div key={q.i} className="fx-vao" style={{ gridColumn: q.i + 2 }}>
                {q.perdeu > 0 && <>
                  <span className="fx-vao-titulo">{q.perdeu === 1 ? t("1 não seguiu", "1 did not continue") : t(`${formatarInt(q.perdeu)} não seguiram`, `${formatarInt(q.perdeu)} did not continue`)} <span>({pctTexto((100 * q.perdeu) / Math.max(1, q.antes))})</span></span>
                  {q.outra > 0 && <span className="fx-vao-linha"><i className="fx-ponto outra" />{q.outra === 1 ? t("1 foi para outra página", "1 went to another page") : t(`${formatarInt(q.outra)} para outra página`, `${formatarInt(q.outra)} to another page`)}
                    {q.destinos.length > 0 && <span className="fx-vao-destinos">{" · "}{q.destinos.map((d) => `${nomePagina(d.pagina)} ${formatarInt(d.n)}`).join(", ")}</span>}</span>}
                  {q.semErro > 0 && (() => {
                    // abandono silencioso (fechou, ficou inativo ou a sessão ainda estava aberta): só chama atenção quando
                    // é relevante (pelo menos 3 sessões e 5% de quem chegou na etapa); senão fica como nota
                    const relevante = q.semErro >= 3 && q.semErro >= 0.05 * q.antes;
                    return <span className={`fx-vao-linha${relevante ? "" : " discreto"}`} title={t("A sessão terminou nesta página sem nenhum erro: fechou, ficou inativo ou ainda estava aberta no fim do período", "The session ended on this page with no error: closed, went idle or was still open at the end of the timeframe")}>
                      <i className={`fx-ponto ${relevante ? "sem-erro" : "neutro"}`} />{q.semErro === 1 ? t("1 encerrou a sessão aqui, sem erro", "1 ended the session here, no error") : t(`${formatarInt(q.semErro)} encerraram a sessão aqui, sem erro`, `${formatarInt(q.semErro)} ended the session here, no error`)}</span>;
                  })()}
                  {q.aposErro > 0 && <span className="fx-vao-linha erro"><i className="fx-ponto apos-erro" />{q.aposErro === 1 ? t("1 saiu após um erro", "1 left after an error") : t(`${formatarInt(q.aposErro)} saíram após um erro`, `${formatarInt(q.aposErro)} left after an error`)}</span>}
                </>}
              </div>
            ))}
          </div>
        )}
        </div>
        {c.passos.map((p, i) => {
          const comErro = c.comErro[i] ?? 0;
          if (comErro === 0) return null;
          const prox = i < ultima ? c.passos[i + 1] : null;
          const e = erroDaPagina(p), href = hrefErros(p);
          // o que importa para o negócio: quem teve erro conseguiu concluir a etapa seguinte mesmo assim?
          const concluiram = (c.comErroSeguiram[i] ?? 0) + (c.comErroDepois[i] ?? 0), encerraram = c.sairamAposErro[i] ?? 0;
          const conclusao = prox
            ? concluiram === 0 ? t(`nenhum chegou a ${nomePagina(prox)}`, `none reached ${nomePagina(prox)}`)
              : concluiram === comErro ? t(`todos chegaram a ${nomePagina(prox)} mesmo assim`, `all still reached ${nomePagina(prox)}`)
              : t(`${formatarInt(concluiram)} chegaram a ${nomePagina(prox)} mesmo assim, ${formatarInt(comErro - concluiram)} não`, `${formatarInt(concluiram)} still reached ${nomePagina(prox)}, ${formatarInt(comErro - concluiram)} did not`)
            : encerraram > 0 ? (encerraram === 1 ? t("1 encerrou a sessão ali", "1 ended the session there") : t(`${formatarInt(encerraram)} encerraram a sessão ali`, `${formatarInt(encerraram)} ended the session there`)) : "";
          const naoConcluiram = prox ? Math.max(0, comErro - concluiram) : encerraram;
          const aberto = backendAberto === i;
          return (
            <div key={`e${i}`} className="fx-erro">
              <div className="fx-erro-linha">
                <span className="fx-n fx-n-erro" aria-hidden="true">{i + 1}</span>
                <span className="fx-erro-texto" title={e ? curtoErro(e) : undefined}>
                  <b>{nomePagina(p)}</b> · {comErro === 1 ? t("1 teve erro", "1 had an error") : t(`${formatarInt(comErro)} tiveram erro`, `${formatarInt(comErro)} had an error`)}{e ? ` · ${curtoErro(e)}` : ""}{conclusao ? ` · ${conclusao}` : ""}
                </span>
                {naoConcluiram > 0 && <span className="pb-selo grave">{prox ? (naoConcluiram === 1 ? t("1 não concluiu", "1 did not complete") : t(`${formatarInt(naoConcluiram)} não concluíram`, `${formatarInt(naoConcluiram)} did not complete`)) : (naoConcluiram === 1 ? t("1 desistiu", "1 gave up") : t(`${formatarInt(naoConcluiram)} desistiram`, `${formatarInt(naoConcluiram)} gave up`))}</span>}
                <span className="fx-erro-acoes">
                  <button className="painel-link" onClick={() => aoVerSessoes(p)}><ReplayIcon size={14} />{t("Ver sessões", "See sessions")}</button>
                  {href && <a className="painel-link" href={href} target="_blank" rel="noreferrer"><BugReportIcon size={14} />{t("Ver erros ↗", "See errors ↗")}</a>}
                  {e?.tipo === "servidor" && <button className="painel-link" onClick={() => setBackendAberto(aberto ? null : i)} aria-expanded={aberto}><ServicesIcon size={14} />{t("Onde falha no backend?", "Where does it fail in the backend?")}</button>}
                </span>
              </div>
              {aberto && <div className="fx-erro-backend"><OrigemBackend app={c.app} view={p} janela={janela} robos={robos} aberto /></div>}
            </div>
          );
        })}
      </div>
    </li>
  );
};
