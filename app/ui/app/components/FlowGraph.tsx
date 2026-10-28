import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ZoomInIcon, ZoomOutIcon, ZoomToFitIcon, ResetIcon, ServicesIcon, DatabaseIcon, MobileIcon, DocumentIcon, ViewIcon, SmartscapeIcon, ArrowRightIcon, ArrowDownIcon, ExternalLinkIcon } from "@dynatrace/strato-icons";
import { getIntentLink } from "@dynatrace-sdk/navigation";
import { ArestaFluxo, Grafo, NoFluxo, formatarInt, formatarPct, grupoDaAplicacao, ehEntradaBackend, grupoDoBackend } from "../lib/graph";
import { Modo, Ponto, RAIO, caixa, posicoesBase } from "../lib/layout";
import { Legend } from "./Legend";
import { t, idiomaAtual } from "../lib/i18n";

interface Props {
  grafo: Grafo;
  modo: Modo;
  busca: string;
  versaoReposicionar: number;      // muda quando o usuário pede para reposicionar os nós
  selecionado: string | null;
  aoSelecionar: (id: string | null) => void;
  aoAbrirDetalhes?: (id: string) => void;    // "Open details": painel da direita
  aoIsolar?: (id: string) => void;           // "Isolate"
  isoladoId?: string | null;
  aoReposicionar?: () => void;               // botão de voltar ao layout na barra de baixo
  entidades?: Map<string, string>;           // aplicação RUM -> entidade (APPLICATION-/MOBILE_APPLICATION-), para o Smartscape
  realceTipo?: NoFluxo["tipo"] | "erro" | null;   // "Node types" do painel: realça um tipo (ou os nós com erro)
  destaque?: Set<string> | null;   // jornada ativa: só estes nós (e as arestas entre eles) ficam acesos
  selecao?: string[] | null;       // modo de seleção: nós clicados, na ordem
  modoSelecao?: boolean;
  ordemJornada?: Map<string, number> | null;   // jornada ativa: número do passo por nó
}

interface Vista { x: number; y: number; k: number }
type Arraste =
  | { tipo: "pan"; x0: number; y0: number; vista0: Vista; moveu: boolean }
  | { tipo: "no"; id: string; x0: number; y0: number; grupo: Map<string, Ponto>; moveu: boolean };   // grupo: nós que se movem juntos (posição inicial)
type Popover = { tipo: "no"; id: string; x: number; y: number } | { tipo: "aresta"; de: string; para: string; x: number; y: number };

/** Nome do nó; selecionado, ganha fundo azul (como no Smartscape) com a largura medida do texto. */
function TituloNo({ texto, y }: { texto: string; y: number }) {
  const ref = useRef<SVGTextElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => { if (ref.current) setW(ref.current.getComputedTextLength()); }, [texto]);
  return (
    <>
      {w > 0 && <rect x={-w / 2 - 5} y={y - 12.5} width={w + 10} height={17} rx={4} className="fluxo-no-titulo-fundo" />}
      <text ref={ref} y={y} textAnchor="middle" className="fluxo-no-titulo">{texto}</text>
    </>
  );
}

const AREA_ESQ = 330;                // largura ocupada pelos cartões flutuantes à esquerda
const ZOOM_MIN = 0.25, ZOOM_MAX = 3;
const limitarZoom = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
/** Nova vista com zoom k mantendo parado o ponto (mx, my) da tela. */
const zoomEm = (v: Vista, k: number, mx: number, my: number): Vista => ({ k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k });
/** Nome curto no grafo: o FIM do caminho, que distingue as páginas (o começo, "/portal/telainicial/...", se repete). */
const abreviar = (s: string, max = 24) => {
  if (s.length <= max) return s;
  const partes = s.split("/").filter(Boolean);
  const fim = partes.length ? partes[partes.length - 1] : s;
  const curto = "…/" + fim;
  return curto.length <= max ? curto : "…" + s.slice(s.length - (max - 1));
};

/** Tipo do nó com os termos do Smartscape. */
export const tipoRotulo = (n: Pick<NoFluxo, "tipo">) => (n.tipo === "app" ? "FRONTEND" : n.tipo === "view" ? t("PÁGINA", "PAGE") : n.tipo === "banco" ? t("BANCO DE DADOS", "DATABASE") : t("SERVIÇO", "SERVICE"));

/** Janela de navegador: o ícone de FRONTEND do Smartscape (aplicação web). */
const IconeJanela: React.FC<{ tamanho?: number }> = ({ tamanho = 18 }) => {
  const s = tamanho / 18;
  return (
    <g className="no-icone-traco" transform={`scale(${s})`} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x={-8} y={-7} width={16} height={14} rx={2} />
      <path d="M -8 -3 H 8 M -5.5 -5 H -5 M -3 -5 H -2.5" />
    </g>
  );
};

/** Ícone do nó: os ícones de entidade do Dynatrace (serviço, banco, mobile, documento) e a janela do frontend web. */
export const IconeNo: React.FC<{ no: Pick<NoFluxo, "tipo" | "canal">; tamanho?: number }> = ({ no, tamanho = 18 }) => {
  const meio = -tamanho / 2;
  const strato = (Icone: typeof ServicesIcon) => <g transform={`translate(${meio} ${meio})`} className="no-icone"><Icone size={tamanho} /></g>;
  if (no.tipo === "servico") return strato(ServicesIcon);
  if (no.tipo === "banco") return strato(DatabaseIcon);
  if (no.tipo === "view") return strato(DocumentIcon);
  if (no.canal === "mobile" || no.canal === "custom") return strato(MobileIcon);
  return <IconeJanela tamanho={tamanho} />;
};
/** O mesmo ícone fora do SVG do grafo (menus e painel). */
export const IconeTipo: React.FC<{ no: Pick<NoFluxo, "tipo" | "canal">; tamanho?: number }> = ({ no, tamanho = 18 }) => (
  <svg className="icone-tipo" width={tamanho} height={tamanho} viewBox={`${-tamanho / 2} ${-tamanho / 2} ${tamanho} ${tamanho}`} aria-hidden="true"><IconeNo no={no} tamanho={tamanho} /></svg>
);

/** Links nativos (intents). Fora da plataforma getIntentLink lança; aí não há link. */
function linkIntent(payload: Record<string, unknown>, appId: string, intentId: string): string | null {
  try { return getIntentLink(payload as Parameters<typeof getIntentLink>[0], appId, intentId); } catch { return null; }
}

/* Desempenho (mesmo SVG, byte a byte): nós e ligações são componentes memo e a lista deles não depende da vista, então
   pan, zoom e pinça só trocam o transform do <g>; pairar e selecionar redesenham só os itens cujo estado visual mudou.
   Os textos chegam prontos do pai (idioma e números formatados). */

/** Ligação desenhada: só redesenha quando a geometria ou o estado visual dela muda. */
const ArestaSvg = React.memo(function ArestaSvg({ a, d, mx, my, w, classe, foco, rotulo, aoClicar }: {
  a: ArestaFluxo; d: string; mx: number; my: number; w: number; classe: string; foco: boolean; rotulo: string; aoClicar: (e: React.MouseEvent, a: ArestaFluxo) => void;
}) {
  return (
    <g className={classe}>
      <path className="traco" d={d} strokeWidth={w} markerEnd={`url(#${foco ? "seta-foco" : "seta"})`} />
      <path className="alvo" d={d} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => aoClicar(e, a)} />
      {rotulo && (
        <g transform={`translate(${mx} ${my})`} className="fluxo-rotulo-grupo" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => aoClicar(e, a)}>
          <rect x={-rotulo.length * 3.2 - 5} y={-8} width={rotulo.length * 6.4 + 10} height={16} rx={4} className="fluxo-rotulo-fundo" />
          <text y={3.5} textAnchor="middle" className="fluxo-rotulo">{rotulo}</text>
        </g>
      )}
    </g>
  );
});

/** Nó desenhado: só redesenha quando a posição, os textos ou o estado visual dele mudam. ordem: número do passo
    (seleção ou jornada), -1 sem número. */
const NoSvg = React.memo(function NoSvg({ n, x, y, classe, ordem, jornada, titulo, seloTitulo, seloTexto, sub, rotuloAria, aoApertar, aoEntrar, aoSair }: {
  n: NoFluxo; x: number; y: number; classe: string; ordem: number; jornada: boolean; titulo: string; seloTitulo: string; seloTexto: string; sub: string; rotuloAria: string;
  aoApertar: (ev: React.PointerEvent<SVGGElement>, id: string) => void; aoEntrar: (id: string) => void; aoSair: () => void;
}) {
  return (
    <g transform={`translate(${x} ${y})`} className={classe}
       onPointerDown={(ev) => aoApertar(ev, n.id)} onPointerEnter={() => aoEntrar(n.id)} onPointerLeave={() => aoSair()}
       role="button" tabIndex={0} aria-label={rotuloAria}>
      <title>{titulo}</title>
      {ordem >= 0 && (
        <g transform={`translate(${-RAIO - 2} ${-RAIO - 2})`} className={`fluxo-no-ordem${jornada ? " jornada" : ""}`}>
          <circle r={9} />
          <text y={3.5} textAnchor="middle">{ordem + 1}</text>
        </g>
      )}
      <circle r={RAIO + 5} className="fluxo-no-anel" />
      <circle r={RAIO} className="fluxo-no-circulo" />
      <IconeNo no={n} />
      {n.erros > 0 && (
        <g transform={`translate(${RAIO - 2} ${-RAIO + 1})`} className="fluxo-no-selo">
          <title>{seloTitulo}</title>
          <rect x={0} y={-8} width={16 + seloTexto.length * 6} height={16} rx={4} />
          <path d="M 7 -4 L 10.5 0 L 7 4 L 3.5 0 Z" className="fluxo-no-selo-losango" />
          <text x={13} y={3.5}>{seloTexto}</text>
        </g>
      )}
      <TituloNo texto={abreviar(n.nome)} y={RAIO + 15} />
      <text y={RAIO + 28} textAnchor="middle" className="fluxo-no-sub">{sub}</text>
    </g>
  );
});

export const FlowGraph: React.FC<Props> = ({ grafo, modo, busca, versaoReposicionar, selecionado, aoSelecionar, aoAbrirDetalhes, aoIsolar, isoladoId, aoReposicionar, entidades, realceTipo, destaque, selecao, modoSelecao, ordemJornada }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const base = useMemo(() => posicoesBase(grafo, modo), [grafo, modo]);
  const porId = useMemo(() => new Map(grafo.nos.map((n) => [n.id, n])), [grafo]);
  const [movidos, setMovidos] = useState<Map<string, Ponto>>(new Map());
  const [vista, setVista] = useState<Vista>({ x: 0, y: 0, k: 1 });
  const [pairado, setPairado] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [popover, setPopover] = useState<Popover | null>(null);
  const arraste = useRef<Arraste | null>(null);
  const pos = (id: string): Ponto => movidos.get(id) ?? base.get(id) ?? { x: 0, y: 0 };

  /** Enquadra os pontos na área livre (à direita dos cartões; na tela estreita do celular, a tela toda). */
  const enquadrar = (pontos: Map<string, Ponto>, tudo = false) => {
    const el = svgRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const esq = width < 700 ? 0 : AREA_ESQ;
    const c = caixa(pontos);
    const livreW = Math.max(200, width - esq - 24), livreH = Math.max(200, height - 48);
    // como o Smartscape, perto do tamanho real (mínimo 0,75, para os nomes continuarem legíveis): grafo grande fica
    // ancorado pela entrada à esquerda e o resto se alcança com pan, roda ou "Fit to screen"
    const k = Math.min(1.1, Math.max(tudo ? ZOOM_MIN : 0.75, Math.min(livreW / c.w, livreH / c.h)));
    const cabe = c.w * k <= livreW;
    setVista({ k, x: cabe ? esq + livreW / 2 - (c.x + c.w / 2) * k : esq + 24 - c.x * k, y: height / 2 - (c.y + c.h / 2) * k });
  };

  // novo grafo, novo layout ou "reposicionar": esquece arrastes, fecha o menu e enquadra tudo (sem arraste, mantém o
  // mesmo Map: evita um segundo render inteiro na montagem)
  useLayoutEffect(() => {
    setMovidos((m) => (m.size ? new Map() : m));
    setPopover(null);
    enquadrar(base);
  }, [base, versaoReposicionar]);

  // Esc fecha o menu do nó/ligação
  useEffect(() => {
    if (!popover) return;
    const aoTecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") setPopover(null); };
    window.addEventListener("keydown", aoTecla);
    return () => window.removeEventListener("keydown", aoTecla);
  }, [popover]);

  /** Botões de zoom (celular e quem não usa roda): aproxima ou afasta em torno do centro da tela. */
  const zoomPor = (fator: number) => {
    const el = svgRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPopover(null);
    setVista((v) => zoomEm(v, limitarZoom(v.k * fator), width / 2, height / 2));
  };

  // pinça com dois dedos: o SVG tem touch-action none (senão o navegador rola a página), então o zoom é nosso
  const toques = useRef(new Map<number, Ponto>());
  const pinca = useRef<{ d0: number; vista0: Vista; cx: number; cy: number } | null>(null);
  const registrarToque = (ev: React.PointerEvent) => {
    if (ev.pointerType !== "touch") return;
    const r = svgRef.current?.getBoundingClientRect();
    toques.current.set(ev.pointerId, { x: ev.clientX - (r?.left ?? 0), y: ev.clientY - (r?.top ?? 0) });
    if (toques.current.size === 2) {
      const [a, b] = [...toques.current.values()];
      pinca.current = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), vista0: vista, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      arraste.current = null;           // dois dedos = zoom, não arraste nem clique
      setArrastando(false);
      setPopover(null);
    }
  };

  // zoom pela roda do mouse (listener manual: o React registra wheel como passivo e não deixa cancelar o scroll)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const aoRolar = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      setPopover(null);
      setVista((v) => zoomEm(v, limitarZoom(v.k * Math.pow(1.1, -ev.deltaY / 100)), mx, my));
    };
    el.addEventListener("wheel", aoRolar, { passive: false });
    return () => el.removeEventListener("wheel", aoRolar);
  }, []);

  const iniciarPan = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (ev.button !== 0) return;
    registrarToque(ev);
    if (pinca.current) return;
    arraste.current = { tipo: "pan", x0: ev.clientX, y0: ev.clientY, vista0: vista, moveu: false };
    setArrastando(true);
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };
  const iniciarNo = (ev: React.PointerEvent<SVGGElement>, id: string) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    registrarToque(ev);
    if (pinca.current) return;
    // a caixa da aplicação arrasta a aplicação inteira (telas e backend exclusivo); um nó comum arrasta só ele
    const no = porId.get(id);
    // canal: move a aplicação; porta de entrada do backend: move o backend que ela alcança; o resto: só o nó
    const ids = no?.entrada && no.app ? grupoDaAplicacao(grafo, no.app) : ehEntradaBackend(grafo, id) ? grupoDoBackend(grafo, id) : [id];
    arraste.current = { tipo: "no", id, x0: ev.clientX, y0: ev.clientY, grupo: new Map(ids.map((i) => [i, pos(i)])), moveu: false };
    svgRef.current?.setPointerCapture(ev.pointerId);
  };
  const mover = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (toques.current.has(ev.pointerId)) {
      const r = ev.currentTarget.getBoundingClientRect();
      toques.current.set(ev.pointerId, { x: ev.clientX - r.left, y: ev.clientY - r.top });
      const p = pinca.current;
      if (p && toques.current.size >= 2) {
        const [a, b] = [...toques.current.values()];
        const k = limitarZoom(p.vista0.k * (Math.hypot(a.x - b.x, a.y - b.y) / p.d0));
        const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // zoom em torno do ponto entre os dedos e pan pelo deslocamento desse ponto
        const z = zoomEm(p.vista0, k, p.cx, p.cy);
        setVista({ k, x: z.x + meio.x - p.cx, y: z.y + meio.y - p.cy });
        return;
      }
    }
    const a = arraste.current;
    if (!a) return;
    const dx = ev.clientX - a.x0, dy = ev.clientY - a.y0;
    if (Math.hypot(dx, dy) > 3 && !a.moveu) { a.moveu = true; setPopover(null); }
    if (a.tipo === "pan") { if (a.moveu) setVista({ ...a.vista0, x: a.vista0.x + dx, y: a.vista0.y + dy }); return; }
    if (a.moveu) setMovidos((m) => { const novo = new Map(m); for (const [id, p0] of a.grupo) novo.set(id, { x: p0.x + dx / vista.k, y: p0.y + dy / vista.k }); return novo; });
  };
  const soltar = (ev: React.PointerEvent<SVGSVGElement>) => {
    toques.current.delete(ev.pointerId);
    if (pinca.current) {
      if (toques.current.size < 2) pinca.current = null;
      arraste.current = null;
      return;
    }
    const a = arraste.current;
    arraste.current = null;
    setArrastando(false);
    if (!a || a.moveu) return;
    if (a.tipo === "pan") { setPopover(null); if (!modoSelecao) aoSelecionar(null); return; }   // clique no fundo: fecha e desmarca
    aoSelecionar(a.id);
    if (!modoSelecao) { const p = pos(a.id); setPopover({ tipo: "no", id: a.id, x: p.x * vista.k + vista.x + (RAIO + 10) * vista.k, y: p.y * vista.k + vista.y - 12 }); }
  };
  /** Clique na ligação: menu com origem, relação e destino (posição do clique). */
  const abrirAresta = (ev: React.MouseEvent, a: ArestaFluxo) => {
    if (modoSelecao) return;
    const r = svgRef.current?.getBoundingClientRect();
    setPopover({ tipo: "aresta", de: a.de, para: a.para, x: ev.clientX - (r?.left ?? 0) + 8, y: ev.clientY - (r?.top ?? 0) + 8 });
  };
  // funções estáveis para os itens memo (chamam a versão atual, que lê o estado deste render)
  const iniciarNoRef = useRef(iniciarNo); iniciarNoRef.current = iniciarNo;
  const abrirArestaRef = useRef(abrirAresta); abrirArestaRef.current = abrirAresta;
  const aoApertarNo = useCallback((ev: React.PointerEvent<SVGGElement>, id: string) => iniciarNoRef.current(ev, id), []);
  const aoEntrarNo = useCallback((id: string) => setPairado(id), []);
  const aoSairNo = useCallback(() => setPairado(null), []);
  const aoClicarAresta = useCallback((ev: React.MouseEvent, a: ArestaFluxo) => abrirArestaRef.current(ev, a), []);

  const maxNav = useMemo(() => Math.max(1, ...grafo.arestas.filter((a) => a.tipo === "nav").map((a) => a.n)), [grafo]);
  const foco = pairado ?? selecionado;
  const termo = busca.trim().toLowerCase();
  const casaBusca = (n: NoFluxo) => !termo || n.nome.toLowerCase().includes(termo) || n.id.toLowerCase().includes(termo);
  const casaRealce = (n: NoFluxo) => !realceTipo || (realceTipo === "erro" ? n.erros > 0 : n.tipo === realceTipo);
  const ligada = (a: ArestaFluxo) => (destaque ? destaque.has(a.de) && destaque.has(a.para) : true);
  // página em foco (selecionada ou sob o mouse): o caminho PRÓPRIO dela no backend, só os serviços que as requisições
  // dela atravessam (servicosAtingidos, dos traces) e os bancos que eles chamam, pintado de azul sem apagar o resto
  const noFoco = foco ? porId.get(foco) : undefined;
  const caminho = useMemo(() => {
    if (!noFoco || noFoco.tipo !== "view" || !noFoco.servicosAtingidos?.length) return null;
    const ids = new Set(noFoco.servicosAtingidos.map((s) => s.id));
    const tipoDe = new Map(grafo.nos.map((n) => [n.id, n.tipo]));
    for (const a of grafo.arestas) if (a.tipo === "call" && ids.has(a.de) && tipoDe.get(a.para) === "banco") ids.add(a.para);
    return ids;
  }, [noFoco, grafo]);
  const noCaminho = (id: string) => !!caminho && caminho.has(id);
  const emFoco = (a: ArestaFluxo) => !!foco && !destaque && (a.de === foco || a.para === foco || (a.tipo === "call" && noCaminho(a.de) && noCaminho(a.para)));
  const ordemSelecao = (id: string) => (selecao ? selecao.indexOf(id) : -1);
  // ida e volta pelo conjunto dos pares (de, para): uma passada por grafo, em vez de varrer as ligações para cada ligação
  const pares = useMemo(() => new Set(grafo.arestas.map((a) => `${a.de}\u0000${a.para}`)), [grafo]);
  const temInversa = (a: ArestaFluxo) => pares.has(`${a.para}\u0000${a.de}`);

  /** Curva da aresta: reta entre vizinhos; arco para o lado quando volta, pula camadas ou tem aresta inversa. */
  const geometria = (a: ArestaFluxo) => {
    const p1 = pos(a.de), p2 = pos(a.para);
    const dx = p2.x - p1.x, dy = p2.y - p1.y, d = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / d, uy = dy / d;
    const ini = { x: p1.x + ux * (RAIO + 3), y: p1.y + uy * (RAIO + 3) };
    const fim = { x: p2.x - ux * (RAIO + 4), y: p2.y - uy * (RAIO + 4) };
    const camadas = Math.abs((porId.get(a.para)?.camada ?? 0) - (porId.get(a.de)?.camada ?? 0));
    // "lado" para onde os arcos se afastam da cadeia: baixo no horizontal, direita no vertical, normal da aresta na força
    const lado = modo === "horizontal" ? { x: 0, y: 1 } : modo === "vertical" ? { x: 1, y: 0 } : { x: -uy, y: ux };
    let desvio = 0;
    if (a.retorno) desvio = Math.min(170, 40 + 0.2 * d);
    else if (a.tipo === "nav" && camadas > 1) desvio = Math.min(130, 24 + 0.14 * d);
    else if (a.tipo === "req" && camadas > 1) desvio = Math.min(90, 10 + 0.08 * d);
    else if (temInversa(a)) desvio = -22;                                      // par ida/volta: a ida fica do lado oposto
    const cx = (ini.x + fim.x) / 2 + lado.x * desvio, cy = (ini.y + fim.y) / 2 + lado.y * desvio;
    const meio = { x: 0.25 * ini.x + 0.5 * cx + 0.25 * fim.x, y: 0.25 * ini.y + 0.5 * cy + 0.25 * fim.y };
    return { d: `M ${ini.x} ${ini.y} Q ${cx} ${cy} ${fim.x} ${fim.y}`, meio };
  };
  // geometria de todas as ligações uma vez por grafo, layout ou arraste (não a cada pan, zoom, pairar ou tecla da busca)
  const geo = useMemo(() => new Map(grafo.arestas.map((a) => [a, geometria(a)])), [grafo, base, movidos, modo, porId, pares]);   // eslint-disable-line react-hooks/exhaustive-deps

  // só a navegação leva rótulo (% de quem sai da página); o volume do backend aparece no menu da ligação e no nó
  // 1.45.4: número só onde houve navegação no período; a seta sem navegação fica clara e tracejada,
  // sem o chip "0" (com período curto e pouco tráfego o grafo virava um mar de zeros)
  const rotuloDe = (a: ArestaFluxo) => (a.tipo === "nav" && a.n > 0 ? formatarPct(a.pct) : "");
  /** Nó sem tráfego no período (está no desenho das 24 h): fica claro e sem o número embaixo do nome. */
  const semTrafego = (n: NoFluxo) => (n.entrada ? n.saidas === 0
    : n.tipo === "view" ? n.entradas === 0 && n.saidas === 0 && n.fim === 0 && n.erros === 0
    : n.chamadas === 0 && n.entradas === 0 && n.erros === 0);
  const relacao = (a: ArestaFluxo) => (a.tipo === "nav" ? t("navega para", "navigates to") : t("chama", "calls"));
  /** Embaixo do nome: só as partes que não são zero (1.45.4: "0 chegam" não aparece mais). */
  const subNo = (n: NoFluxo) => (n.entrada ? (n.saidas > 0 ? `${formatarInt(n.saidas)} ${t("entradas", "entries")}` : "")
    : n.tipo === "view" ? [n.entradas > 0 ? `${formatarInt(n.entradas)} ${t("chegam", "in")}` : "", n.fim > 0 ? `${formatarInt(n.fim)} ${t("abandono", "drop-off")}` : ""].filter(Boolean).join(" · ")
    : n.chamadas > 0 ? `${formatarInt(n.chamadas)} ${t("requisições", "requests")}` : "");
  const resumoNo = (n: NoFluxo) => (semTrafego(n) ? t("sem tráfego neste período", "no traffic in this timeframe") : n.entrada ? `${formatarInt(n.saidas)} ${t("entradas", "entries")}`
    : n.tipo === "view" ? t(`${formatarInt(n.entradas)} chegam · ${formatarInt(n.saidas)} saem · ${formatarInt(n.fim)} abandono`, `${formatarInt(n.entradas)} in · ${formatarInt(n.saidas)} out · ${formatarInt(n.fim)} drop-off`)
    : `${formatarInt(n.chamadas)} ${t("requisições", "requests")}`);
  const resumoAresta = (a: ArestaFluxo) => (a.tipo === "nav" && a.n === 0 && (a.dia ?? 0) > 0 ? t(`sem navegação neste período · ${formatarInt(a.dia ?? 0)} nas últimas 24 h`, `no navigation in this timeframe · ${formatarInt(a.dia ?? 0)} in the last 24 h`)
    : a.tipo === "nav" ? t(`${formatarInt(a.n)} navegações · ${formatarPct(a.pct)} das saídas`, `${formatarInt(a.n)} navigations · ${formatarPct(a.pct)} of exits`)
    : a.n > 0 ? t(`${formatarInt(a.n)} requisições (trace a trace)`, `${formatarInt(a.n)} requests (trace by trace)`) : "");
  /** Entidade do Dynatrace por trás do nó (para "View topology"): serviço/banco pelo id, frontend pela aplicação. */
  const entidadeDe = (n: NoFluxo) => (n.tipo === "servico" || n.tipo === "banco" ? (n.id.startsWith("SERVICE-") ? n.id : null) : n.tipo === "app" && n.app ? entidades?.get(n.app) ?? null : null);

  // nós e ligações: a lista não depende da vista (pan, zoom e pinça só mudam o transform do <g> que a envolve)
  const idioma = idiomaAtual();
  const popDe = popover?.tipo === "aresta" ? popover.de : null, popPara = popover?.tipo === "aresta" ? popover.para : null;
  const conteudo = useMemo(() => (
    <>
      {grafo.arestas.map((a) => {
        const { d, meio } = geo.get(a)!;
        const w = a.tipo === "nav" ? 0.9 + 1.5 * Math.sqrt(a.n / maxNav) : 1;   // mais finas, como no Smartscape
        const focada = emFoco(a);
        const aberta = popDe === a.de && popPara === a.para;
        return <ArestaSvg key={`${a.de}>${a.para}`} a={a} d={d} mx={meio.x} my={meio.y} w={w} rotulo={rotuloDe(a)} foco={focada || aberta} aoClicar={aoClicarAresta}
                          classe={`fluxo-aresta ${a.tipo}${ligada(a) ? "" : " apagada"}${a.retorno ? " retorno" : ""}${a.tipo === "nav" && a.n === 0 && (a.dia ?? 0) > 0 ? " sem-agora" : ""}${focada || aberta ? " foco" : ""}`} />;
      })}
      {grafo.nos.map((n) => {
        const p = pos(n.id);
        const apagado = !casaBusca(n) || !casaRealce(n) || (destaque ? !destaque.has(n.id) : false);
        const posSelecao = ordemSelecao(n.id);
        const passoJornada = posSelecao < 0 && ordemJornada ? ordemJornada.get(n.id) ?? -1 : -1;
        return <NoSvg key={n.id} n={n} x={p.x} y={p.y} ordem={posSelecao >= 0 ? posSelecao : passoJornada} jornada={passoJornada >= 0}
                      classe={`fluxo-no ${n.tipo}${n.entrada ? " entrada" : ""}${n.erros > 0 ? " com-erro" : ""}${selecionado === n.id || posSelecao >= 0 ? " selecionado" : ""}${noCaminho(n.id) ? " no-caminho" : ""}${passoJornada >= 0 ? " passo-jornada" : ""}${semTrafego(n) ? " sem-agora" : ""}${apagado ? " apagado" : ""}`}
                      titulo={`${tipoRotulo(n)}\n${n.nome}\n${resumoNo(n)}${n.erros > 0 ? ` · ${formatarInt(n.erros)} ${t("erros", "errors")}` : ""}`}
                      seloTitulo={n.erros > 0 ? (n.tipo === "servico" || n.tipo === "banco" ? t(`${formatarInt(n.falhas)} requisições com falha no período`, `${formatarInt(n.falhas)} failed requests in the timeframe`) : t(`${formatarInt(n.falhas)} requisições com falha · ${formatarInt(n.excecoes)} erros JS`, `${formatarInt(n.falhas)} failed requests · ${formatarInt(n.excecoes)} JS errors`)) : ""}
                      seloTexto={n.erros > 0 ? String(formatarInt(n.erros)) : ""}
                      sub={subNo(n)}
                      rotuloAria={`${tipoRotulo(n)} ${n.nome}`} aoApertar={aoApertarNo} aoEntrar={aoEntrarNo} aoSair={aoSairNo} />;
      })}
    </>
  ), [grafo, geo, maxNav, foco, caminho, destaque, popDe, popPara, termo, realceTipo, selecao, ordemJornada, selecionado, movidos, base, idioma]);   // eslint-disable-line react-hooks/exhaustive-deps

  const CabecalhoNo: React.FC<{ n: NoFluxo }> = ({ n }) => (
    <div className="sc-pop-entidade">
      <span className="sc-pop-icone"><IconeTipo no={n} tamanho={20} /></span>
      <span className="sc-pop-textos"><span className="sc-pop-tipo">{tipoRotulo(n)}</span><span className="sc-pop-nome" title={n.nome}>{n.nome}</span></span>
    </div>
  );
  const menu = (() => {
    if (!popover) return null;
    const el = svgRef.current?.getBoundingClientRect();
    const larg = 280, x = Math.max(8, Math.min(popover.x, (el?.width ?? 1200) - larg - 8)), y = Math.max(8, Math.min(popover.y, (el?.height ?? 800) - 220));
    if (popover.tipo === "no") {
      const n = porId.get(popover.id);
      if (!n) return null;
      const entidade = entidadeDe(n);
      const topologia = entidade ? linkIntent({ id: entidade }, "dynatrace.smartscape", "view_topology_in_context") : null;
      return (
        <div className="sc-popover" style={{ left: x, top: y, width: larg }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <CabecalhoNo n={n} />
          <div className="sc-pop-metrica">{resumoNo(n)}{n.erros > 0 ? <span className="sc-pop-erro"> · {formatarInt(n.erros)} {t("erros", "errors")}</span> : null}</div>
          <div className="sc-pop-acoes">
            {aoIsolar && <button className="sc-pop-acao" role="menuitem" onClick={() => { aoIsolar(n.id); setPopover(null); }}><ViewIcon size={16} /><span>{isoladoId === n.id ? t("Sair do isolamento", "Exit isolation") : t("Isolar", "Isolate")}</span></button>}
            {topologia && <a className="sc-pop-acao" role="menuitem" href={topologia} target="_blank" rel="noreferrer"><SmartscapeIcon size={16} /><span>{t("Ver topologia", "View topology")}</span><ExternalLinkIcon size={14} className="sc-pop-externo" /></a>}
            {aoAbrirDetalhes && <button className="sc-pop-acao" role="menuitem" onClick={() => { aoAbrirDetalhes(n.id); setPopover(null); }}><ArrowRightIcon size={16} /><span>{t("Abrir detalhes", "Open details")}</span></button>}
          </div>
        </div>
      );
    }
    const a = grafo.arestas.find((x) => x.de === popover.de && x.para === popover.para);
    const de = porId.get(popover.de), para = porId.get(popover.para);
    if (!a || !de || !para) return null;
    const resumo = resumoAresta(a);
    return (
      <div className="sc-popover" style={{ left: x, top: y, width: larg }} role="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <CabecalhoNo n={de} />
        <div className="sc-pop-relacao"><ArrowDownIcon size={14} /><span>{relacao(a)}</span></div>
        <CabecalhoNo n={para} />
        {resumo && <div className="sc-pop-metrica">{resumo}</div>}
        {aoAbrirDetalhes && (
          <div className="sc-pop-acoes">
            <button className="sc-pop-acao" onClick={() => { aoAbrirDetalhes(de.id); setPopover(null); }}><ArrowRightIcon size={16} /><span>{t("Abrir detalhes", "Open details")}</span></button>
          </div>
        )}
      </div>
    );
  })();

  return (
    <>
    <svg ref={svgRef} className={`fluxo${arrastando ? " arrastando" : ""}${modoSelecao ? " selecao" : ""}`} role="img" aria-label={t("Fluxo de navegação", "Navigation flow")}
         onPointerDown={iniciarPan} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
      <defs>
        {/* markerUnits=userSpaceOnUse: a ponta da seta tem sempre o mesmo tamanho, independentemente da espessura */}
        {["seta", "seta-foco"].map((id) => (
          <marker key={id} id={id} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={`fluxo-seta ${id}`} />
          </marker>
        ))}
      </defs>
      <g transform={`translate(${vista.x} ${vista.y}) scale(${vista.k})`}>{conteudo}</g>
    </svg>
    {menu}
    <div className="sc-rodape">
    <Legend />
    <div className="sc-barra-inferior" role="toolbar" aria-label={t("visão do grafo", "graph view")}>
      <button className="sc-barra-botao" onClick={() => zoomPor(1.25)} title={t("Aproximar", "Zoom in")} aria-label={t("Aproximar", "Zoom in")}><ZoomInIcon size={18} /></button>
      <button className="sc-barra-botao" onClick={() => zoomPor(0.8)} title={t("Afastar", "Zoom out")} aria-label={t("Afastar", "Zoom out")}><ZoomOutIcon size={18} /></button>
      <button className="sc-barra-botao" onClick={() => { setPopover(null); enquadrar(new Map(grafo.nos.map((n) => [n.id, pos(n.id)])), true); }} title={t("Ajustar à tela", "Fit to screen")} aria-label={t("Ajustar à tela", "Fit to screen")}><ZoomToFitIcon size={18} /></button>
      {aoReposicionar && <button className="sc-barra-botao" onClick={aoReposicionar} title={t("Reorganizar", "Reset layout")} aria-label={t("Reorganizar", "Reset layout")}><ResetIcon size={18} /></button>}
    </div>
    </div>
    </>
  );
};
