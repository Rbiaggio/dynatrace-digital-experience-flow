import React, { useEffect, useRef, useState } from "react";
import { InformationIcon, ViewIcon, ViewOffIcon, ChevronDownIcon, ChevronRightIcon, SmartscapeIcon } from "@dynatrace/strato-icons";
import { Grafo, Niveis, NoFluxo, TipoNo, formatarInt } from "../lib/graph";
import { Modo } from "../lib/layout";
import { IconeTipo, tipoRotulo } from "./FlowGraph";
import { t } from "../lib/i18n";
const t_ = t;   // apelido: no laço dos tipos de nó a variável t é o TipoNo

export interface EstadoIsolado { nome: string; niveis: Niveis; fonte: "sessoes" | "trafego" | "carregando"; sessoes: number | null; ultimaHora?: boolean }
export type Realce = TipoNo | "erro" | null;

interface Props {
  grafo: Grafo;
  isolado?: EstadoIsolado | null;
  aoMudarNiveis?: (n: Niveis) => void;
  aoSairIsolado?: () => void;
  modo: Modo; aoMudarModo: (m: Modo) => void;
  pctMinimo: number; aoMudarPctMinimo: (v: number) => void;
  robos: boolean; aoMudarRobos: (v: boolean) => void;
  quadros?: boolean; aoMudarQuadros?: (v: boolean) => void;
  soHabilitadas?: boolean; aoMudarSoHabilitadas?: (v: boolean) => void;   // sem a lista de habilitadas, o interruptor some
  busca: string; aoMudarBusca: (v: string) => void;
  ocultos?: Set<TipoNo>;                              // tipos escondidos do grafo (serviços de backend, bancos)
  aoMudarOcultos?: (ocultos: Set<TipoNo>) => void;
  contagens?: { servico: number; banco: number };     // quantos existem antes de esconder
  dominante?: { porApp: { app: string; nome: string; total: number; mostradas: number }[]; mostrarTudo: boolean } | null;   // canais limitados ao caminho dominante
  aoMostrarTudo?: (v: boolean) => void;
  realce?: Realce; aoMudarRealce?: (r: Realce) => void;   // "Node types"/"Node status": clicar realça (filtra) na hora
  selecionado?: string | null; aoSelecionarNo?: (id: string) => void;
}

const NIVEIS: { valor: Niveis; rotulo: string }[] = [{ valor: 1, rotulo: "1" }, { valor: 2, rotulo: "2" }, { valor: 3, rotulo: "3" }, { valor: "tudo", rotulo: "" }];
const MODOS: { valor: Modo; rotulo: string }[] = [{ valor: "force", rotulo: "Force" }, { valor: "vertical", rotulo: "Vertical" }, { valor: "horizontal", rotulo: "Horizontal" }];
const ajudaLayout = () => t("Force: layout por física, que espalha os nós para reduzir a sobreposição.\nVertical: camadas de cima para baixo. Grafos rasos ou de um nível podem se espalhar para os lados.\nHorizontal: camadas da esquerda para a direita. Grafos rasos ou de um nível podem se empilhar.",
  "Force: physics-based layout that spreads nodes to reduce overlap.\nVertical: top-to-bottom layers. Flat or single-level graphs may spread sideways.\nHorizontal: left-to-right layers. Flat or single-level graphs may stack vertically.");
const TIPOS: TipoNo[] = ["app", "view", "servico", "banco"];

/** Cartão recolhível, no padrão do Smartscape: ícone, título, chevron. Abre fechado (o grafo fica livre). */
const Cartao: React.FC<{ icone: React.ReactNode; titulo: React.ReactNode; children: React.ReactNode }> = ({ icone, titulo, children }) => {
  const [aberto, setAberto] = useState(false);
  return (
    <section className={`cartao${aberto ? "" : " recolhido"}`}>
      <button className="cartao-cabecalho" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <span className="cartao-icone">{icone}</span>
        <h2 className="cartao-titulo">{titulo}</h2>
        <span className="cartao-chevron" aria-hidden="true"><ChevronDownIcon size={16} /></span>
      </button>
      {aberto && <div className="cartao-corpo">{children}</div>}
    </section>
  );
};

/** Cartões flutuantes à esquerda, no padrão do Smartscape: o fluxo (layout e interruptores) e "Nodes". */
export const ControlPanel: React.FC<Props> = (p) => {
  const ocultos = p.ocultos ?? new Set<TipoNo>();
  const [abertos, setAbertos] = useState<Set<TipoNo>>(new Set());
  const busca = useRef<HTMLInputElement>(null);
  // Ctrl+F (Cmd+F) vai para a busca de nós, como no Smartscape
  useEffect(() => {
    const aoTecla = (ev: KeyboardEvent) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") { ev.preventDefault(); busca.current?.focus(); } };
    window.addEventListener("keydown", aoTecla);
    return () => window.removeEventListener("keydown", aoTecla);
  }, []);
  const porTipo = (t: TipoNo) => p.grafo.nos.filter((n) => n.tipo === t);
  const contagem = (t: TipoNo) => (t === "servico" ? p.contagens?.servico ?? porTipo(t).length : t === "banco" ? p.contagens?.banco ?? porTipo(t).length : porTipo(t).length);
  const comErro = p.grafo.nos.filter((n) => n.erros > 0).length;
  const alternarOculto = (tipo: TipoNo) => { const novo = new Set(ocultos); if (novo.has(tipo)) novo.delete(tipo); else novo.add(tipo); p.aoMudarOcultos?.(novo); };
  const alternarAberto = (tipo: TipoNo) => setAbertos((a) => { const n = new Set(a); if (n.has(tipo)) n.delete(tipo); else n.add(tipo); return n; });
  const realcar = (r: Realce) => p.aoMudarRealce?.(p.realce === r ? null : r);
  const exemplo = (t: TipoNo): Pick<NoFluxo, "tipo" | "canal"> => ({ tipo: t, canal: t === "app" ? "web" : null });

  return (
    <div className="cartoes">
      <Cartao icone={<SmartscapeIcon size={18} />} titulo="Digital Experience Flow">
        <p className="cartao-texto">{t("Veja como os clientes navegam pelas aplicações e quais serviços cada página chama.", "See how users move through your applications and which services each page calls.")}</p>
        {p.dominante && p.dominante.porApp.length > 0 && (
          <div className="dominante-bloco">
            {p.dominante.porApp.map((x) => (
              <p key={x.app} className="dominante-texto">
                {p.dominante!.mostrarTudo
                  ? <>{t("Mostrando", "Showing")} <b>{t(`todas as ${formatarInt(x.total)}`, `all ${formatarInt(x.total)}`)}</b> {t("páginas de", "pages of")} {x.nome}.</>
                  : <>{t("Mostrando", "Showing")} <b>{formatarInt(x.mostradas)} {t("de", "of")} {formatarInt(x.total)}</b> {t("páginas de", "pages of")} {x.nome}{t(": as mais visitadas (caminho dominante).", ": the most visited (dominant path).")}</>}
                {x.total > 200 && <span className="dominante-alerta"> {t("Páginas demais para uma aplicação: revise as regras de nome de página do RUM (ids na URL viram páginas separadas).", "Too many pages for one application: check the RUM page naming rules (ids in the URL become separate pages).")}</span>}
              </p>
            ))}
            <button className="botao-leve" onClick={() => p.aoMostrarTudo?.(!p.dominante!.mostrarTudo)}>{p.dominante.mostrarTudo ? t("Voltar ao caminho dominante", "Back to dominant path") : t("Mostrar todas as páginas", "Show all pages")}</button>
          </div>
        )}
        {p.isolado && (
          <div className="isolado-bloco">
            <div className="isolado-chip">
              <span className="isolado-rotulo">{t("Isolado", "Isolated")}</span>
              <b className="isolado-nome" title={p.isolado.nome}>{p.isolado.nome}</b>
              <button className="isolado-fechar" onClick={p.aoSairIsolado} title={t("Sair do isolamento (Esc)", "Exit isolation (Esc)")} aria-label={t("Sair do isolamento", "Exit isolation")}>×</button>
            </div>
            <div className="cartao-rotulo">{t("Níveis em volta do nó", "Levels around the node")}</div>
            <div className="segmentado" role="tablist">
              {NIVEIS.map((n) => (
                <button key={String(n.valor)} role="tab" aria-selected={p.isolado!.niveis === n.valor} className={p.isolado!.niveis === n.valor ? "ativo" : ""} onClick={() => p.aoMudarNiveis?.(n.valor)}>{n.valor === "tudo" ? t("Todos", "All") : n.rotulo}</button>
              ))}
            </div>
            <p className="cartao-texto isolado-fonte">
              {p.isolado.fonte === "sessoes" ? <>{t("Números das", "Numbers from the")} <b>{formatarInt(p.isolado.sessoes ?? 0)}</b> {t("sessões que passaram por", "sessions that went through")} {p.isolado.nome}{p.isolado.ultimaHora ? t(" na última hora (período maior que 1 hora)", " in the last hour (timeframe longer than 1 hour)") : ""}.</>
                : p.isolado.fonte === "carregando" ? t("Recalculando pelas sessões que passaram aqui…", "Recalculating from the sessions that went through here…")
                : t("Números de todo o tráfego (a visão por sessão precisa da cópia das sessões ou de uma página).", "Numbers from all traffic (the per-session view needs the session copy or a page).")}
            </p>
          </div>
        )}
        <div className="cartao-rotulo com-ajuda">{t("Layout do grafo", "Graph layout")} <span className="ajuda" title={ajudaLayout()} aria-label={ajudaLayout()}><InformationIcon size={14} /></span></div>
        <div className="segmentado" role="tablist">
          {MODOS.map((m) => (
            <button key={m.valor} role="tab" aria-selected={p.modo === m.valor} className={p.modo === m.valor ? "ativo" : ""} onClick={() => p.aoMudarModo(m.valor)}>{m.rotulo}</button>
          ))}
        </div>
        <label className="alternador">
          <input type="checkbox" checked={p.pctMinimo > 0} onChange={(e) => p.aoMudarPctMinimo(e.target.checked ? 5 : 0)} />
          <span>{t("Esconder caminhos raros", "Hide rare paths")}</span>
          {p.pctMinimo > 0 && (
            <span className="alternador-extra">{t("abaixo de", "below")} <input type="number" min={1} max={50} value={p.pctMinimo} onChange={(e) => p.aoMudarPctMinimo(Math.max(1, Number(e.target.value) || 1))} />%</span>
          )}
        </label>
        <label className="alternador">
          <input type="checkbox" checked={p.robos} onChange={(e) => p.aoMudarRobos(e.target.checked)} />
          <span>{t("Incluir sessões de robôs", "Include robot sessions")}</span>
        </label>
        {p.aoMudarQuadros && (
          <label className="alternador" title={t("Aplicações montadas com frames (iframes) carregam vários documentos dentro de uma página; cada frame chega como uma navegação sem origem. Escondidos por padrão, para o fluxo mostrar só as trocas reais de página.", "Applications built with frames (iframes) load several documents inside one page; each frame arrives as a navigation without origin. Hidden by default so the flow shows only real page changes.")}>
            <input type="checkbox" checked={!!p.quadros} onChange={(e) => p.aoMudarQuadros!(e.target.checked)} />
            <span>{t("Mostrar frames das páginas", "Show page frames")}</span>
          </label>
        )}
        {p.aoMudarSoHabilitadas && (
          <label className="alternador" title={t("Só as aplicações habilitadas em Configuração; uma aplicação desligada continua nos agregados até o período passar", "Only the applications enabled in Configuration; a disabled application stays in the aggregates until the timeframe passes")}>
            <input type="checkbox" checked={!!p.soHabilitadas} onChange={(e) => p.aoMudarSoHabilitadas!(e.target.checked)} />
            <span>{t("Mostrar só as aplicações habilitadas", "Show only enabled applications")}</span>
          </label>
        )}
      </Cartao>

      <Cartao icone={<span className="icone-nos" aria-hidden="true" />} titulo={<>{t("Nós", "Nodes")} <span className="cartao-contagem">{formatarInt(p.grafo.nos.length)}</span></>}>
        <div className="busca-nos">
          <input ref={busca} className="busca" type="search" placeholder={t("Buscar nós por nome ou ID", "Find nodes by name or ID")} value={p.busca} onChange={(e) => p.aoMudarBusca(e.target.value)} />
          <span className="atalho" aria-hidden="true"><kbd>Ctrl</kbd><kbd>F</kbd></span>
        </div>
        {comErro > 0 && <>
          <div className="cartao-rotulo">{t("Estado dos nós", "Node status")}</div>
          <button className={`tipo-linha${p.realce === "erro" ? " ativo" : ""}`} onClick={() => realcar("erro")} title={t("Destacar os nós com erro", "Highlight the nodes with errors")}>
            <span className="tipo-chevron" />
            <span className="status-erro" aria-hidden="true" />
            <span className="tipo-nome">{t("Com erro", "With errors")}</span>
            <span className="tipo-contagem">{formatarInt(comErro)}</span>
          </button>
        </>}
        <div className="cartao-rotulo">{t("Tipos de nó", "Node types")}</div>
        {TIPOS.filter((t) => contagem(t) > 0 || ocultos.has(t)).map((t) => {
          const lista = porTipo(t).sort((a, b) => a.nome.localeCompare(b.nome));
          const podeOcultar = t === "servico" || t === "banco";
          const oculto = ocultos.has(t) || (t === "banco" && ocultos.has("servico"));
          return (
            <div key={t} className="tipo-grupo">
              <div className={`tipo-linha${p.realce === t ? " ativo" : ""}${oculto ? " oculto" : ""}`}>
                <button className="tipo-chevron" onClick={() => alternarAberto(t)} aria-label={abertos.has(t) ? t_("Recolher", "Collapse") : t_("Expandir", "Expand")} aria-expanded={abertos.has(t)}>
                  {abertos.has(t) ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                </button>
                <button className="tipo-rotulo" onClick={() => realcar(t)} title={t_(`Destacar os nós ${tipoRotulo({ tipo: t })}`, `Highlight ${tipoRotulo({ tipo: t })} nodes`)}>
                  <IconeTipo no={exemplo(t)} tamanho={16} />
                  <span className="tipo-nome">{tipoRotulo({ tipo: t })}</span>
                  <span className="tipo-contagem">{formatarInt(contagem(t))}</span>
                </button>
                {podeOcultar && (
                  <button className="tipo-olho" onClick={() => alternarOculto(t)} disabled={t === "banco" && ocultos.has("servico")} title={oculto ? t_("Mostrar no grafo", "Show in the graph") : t_("Esconder do grafo", "Hide from the graph")} aria-label={oculto ? t_("Mostrar", "Show") : t_("Esconder", "Hide")}>
                    {oculto ? <ViewOffIcon size={16} /> : <ViewIcon size={16} />}
                  </button>
                )}
              </div>
              {abertos.has(t) && (
                <ul className="tipo-nos">
                  {lista.slice(0, 60).map((n) => (
                    <li key={n.id}><button className={`tipo-no-item${p.selecionado === n.id ? " ativo" : ""}`} onClick={() => p.aoSelecionarNo?.(n.id)} title={n.id}>{n.nome}</button></li>
                  ))}
                  {lista.length > 60 && <li className="tipo-mais">{t_(`mais ${formatarInt(lista.length - 60)} · use a busca`, `${formatarInt(lista.length - 60)} more · use the search`)}</li>}
                </ul>
              )}
            </div>
          );
        })}
      </Cartao>
    </div>
  );
};
