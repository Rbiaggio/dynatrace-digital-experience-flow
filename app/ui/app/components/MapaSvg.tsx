import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MinusIcon, PlusIcon } from "@dynatrace/strato-icons";
import { LARGURA, Y_BASE, Y_TOPO, PAISES, ESTADOS_BR } from "../lib/mapaDados";
import { t } from "../lib/i18n";
import { formatarInt } from "../lib/graph";

/** Mapa de bolhas em SVG próprio (sem biblioteca e sem rede): mapa-múndi e estados do Brasil embutidos (Natural Earth
    1:50m, lib/mapaDados.ts, ~40 KB em gzip), na mesma projeção (Web Mercator, mundo com 10.000 unidades). Bolha: área
    proporcional ao valor; saúde do lugar (vermelho ou âmbar) no anel (sessões) ou na cor (erros); anel tracejado =
    carga lenta. Clique, Enter ou
    espaço na bolha chamam aoClicar (o filtro de país/região). Abre no Brasil; "Brasil | Mundo", aproximar, afastar e
    arrastar mudam o quadro; um lugar fora do quadro ("Fora do mapa" ou o filtro escolhido) leva o mapa até ele. Cores só por classes: o tema claro/escuro vem do CSS. */

type Caixa = [number, number, number, number];             // x0, y0, x1, y1 (unidades do mapa)
export interface BolhaMapa {
  chave: string;
  /** id da forma em lib/mapaDados: "BR-SP" (estado) ou "PT" (país); null = usa o centro (lat/lon) */
  forma: string | null;
  /** centro (latitude, longitude) para país sem contorno no mapa (VA, MV, TV...) */
  centro: [number, number] | null;
  rotulo: string;
  sigla: string;
  valor: number;
  /** cor da bolha: azul (onde estão as sessões) ou a da saúde do lugar (onde estão os erros: vermelho, âmbar ou cinza) */
  cor: "sessoes" | "erros";
  /** saúde do lugar: anel (sessões) ou preenchimento (erros) vermelho (impacta o cliente), âmbar (atenção) ou nenhum */
  anel: "erro" | "atencao" | null;
  /** desde 18/10/2026: o mesmo desenho nos dois mapas, preenchida na cor do estado do lugar (verde = bom, âmbar, vermelho,
      cinza = sem medição); quando vem, vale no lugar de cor e anel */
  tom?: "bom" | "atencao" | "erro" | "sem";
  lenta: boolean;
  /** linhas do balão (já no idioma da tela) */
  detalhe: string[];
  clicavel: boolean;
}
interface Props {
  bolhas: BolhaMapa[];
  /** altura em px; sem ela, sai da largura (largura x fator, entre 200 px e alturaMax) */
  altura?: number;
  fator?: number;
  alturaMax?: number;
  selecionado: string | null;
  /** "brasil" = o Brasil inteiro no quadro (estados); "dados" = só os pontos que somam 97% do valor */
  enquadramento: "brasil" | "dados";
  aoClicar: (chave: string) => void;
  rotuloAria: string;
}

const POR_PAIS = new Map(PAISES.map((p) => [p[0], p]));
const POR_UF = new Map(ESTADOS_BR.map((e) => [e[0], e]));
const BR = POR_PAIS.get("BR");
const CAIXA_BR: Caixa = BR ? [BR[4], BR[5], BR[6], BR[7]] : [2944, 4854, 4033, 5997];
/** latitude/longitude → unidades do mapa (a mesma Web Mercator de mapaDados: y = 307 em 84°N e 7096 em 60°S) */
const projetar = (lat: number, lon: number): [number, number] => {
  const f = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * LARGURA, LARGURA / 2 - (LARGURA / (2 * Math.PI)) * Math.log(Math.tan(Math.PI / 4 + f / 2))];
};
interface Local { x: number; y: number; caixa: Caixa }
function localizar(b: BolhaMapa): Local | null {
  const e = b.forma?.startsWith("BR-") ? POR_UF.get(b.forma) : undefined;
  if (e) return { x: e[3], y: e[4], caixa: [e[5], e[6], e[7], e[8]] };
  const p = b.forma ? POR_PAIS.get(b.forma) : undefined;
  if (p) return { x: p[2], y: p[3], caixa: [p[4], p[5], p[6], p[7]] };
  if (!b.centro) return null;
  const [x, y] = projetar(b.centro[0], b.centro[1]);
  return { x, y, caixa: [x - 40, y - 40, x + 40, y + 40] };
}

/** Os pontos que somam `fatia` do total (do maior para o menor; pelo menos 1): o que o quadro enquadra. */
function principais(xs: { chave: string; valor: number }[], fatia = 0.97): Set<string> {
  const ordem = xs.filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
  const total = ordem.reduce((s, x) => s + x.valor, 0);
  const sel = new Set<string>();
  let soma = 0;
  for (const x of ordem) { if (sel.size > 0 && soma >= fatia * total) break; sel.add(x.chave); soma += x.valor; }
  return sel;
}

/** Caixa de visão (x, y, largura, altura): a união das caixas, com folga, tamanho mínimo (~25 graus) e a proporção do quadro. */
function enquadrar(caixas: Caixa[], proporcao: number): [number, number, number, number] {
  let [x0, y0, x1, y1] = caixas.reduce<Caixa>((u, c) => [Math.min(u[0], c[0]), Math.min(u[1], c[1]), Math.max(u[2], c[2]), Math.max(u[3], c[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  if (!isFinite(x0)) [x0, y0, x1, y1] = [0, Y_TOPO, LARGURA, Y_BASE];
  const MIN = 700;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let w = Math.max(MIN, (x1 - x0) * 1.12), h = Math.max(MIN * 0.6, (y1 - y0) * 1.12);
  if (w / h < proporcao) w = h * proporcao; else h = w / proporcao;
  w = Math.min(w, LARGURA); h = Math.min(h, Y_BASE - Y_TOPO);
  if (w / h < proporcao) h = w / proporcao; else w = h * proporcao;
  const x = Math.max(0, Math.min(LARGURA - w, cx - w / 2));
  const y = Math.max(Y_TOPO, Math.min(Y_BASE - h, cy - h / 2));
  return [x, y, w, h];
}

type Visao = [number, number, number, number];               // x, y, largura, altura (unidades do mapa)
const MUNDO: Caixa = [0, Y_TOPO, LARGURA, Y_BASE];
/** Mantém o centro e a largura, acerta a altura pela proporção do quadro e não deixa sair do mundo (zoom de 300 unidades,
    ~10 graus, até o mundo inteiro). */
function ajustar(v: Visao, proporcao: number): Visao {
  const cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2;
  let w = Math.min(LARGURA, Math.max(300, v[2])), h = w / proporcao;
  if (h > Y_BASE - Y_TOPO) { h = Y_BASE - Y_TOPO; w = h * proporcao; }
  return [Math.max(0, Math.min(LARGURA - w, cx - w / 2)), Math.max(Y_TOPO, Math.min(Y_BASE - h, cy - h / 2)), w, h];
}
/** Até onde o mapa cresce quando o cartão oferece mais altura (px). */
const ALTURA_TETO = 620;
const dentroDe = (v: Visao, l: Local) => l.x >= v[0] && l.x <= v[0] + v[2] && l.y >= v[1] && l.y <= v[1] + v[3];

export const MapaSvg: React.FC<Props> = ({ bolhas, altura: alturaFixa, fator = 0.56, alturaMax = 300, selecionado, enquadramento, aoClicar, rotuloAria }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(480);
  // altura que o cartão oferece ao mapa (19/10/2026): o quadro do mapa é um item flexível na coluna do cartão; quando a linha
  // da Visão geral é mais alta (o cartão de Apdex ao lado tem mais conteúdo), ele estica e o mapa cresce até ALTURA_TETO em
  // vez de deixar um vazio abaixo. A altura base (largura x fator, até alturaMax) continua sendo o mínimo.
  const [disponivel, setDisponivel] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setLargura(el.clientWidth || 480);
    const ro = new ResizeObserver(([e]) => { setLargura(Math.round(e.contentRect.width) || 480); setDisponivel(Math.round(e.contentRect.height)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [foco, setFoco] = useState<string | null>(null);
  const alturaBase = alturaFixa ?? Math.round(Math.max(200, Math.min(alturaMax, largura * fator)));
  const altura = alturaFixa ?? Math.max(alturaBase, Math.min(ALTURA_TETO, disponivel));
  const proporcao = largura / altura;

  // o quadro automático (Brasil, ou os pontos que somam 97% do valor) e o escolhido por quem usa: Brasil, Mundo, arrastar,
  // aproximar ou ir até um país de fora; null = o automático. Volta ao automático quando o enquadramento muda.
  const [manual, setManual] = useState<{ modo: "brasil" | "mundo" | "livre"; v: Visao } | null>(null);
  useEffect(() => { setManual(null); }, [enquadramento]);
  const { locais, visaoAuto } = useMemo(() => {
    const locais = bolhas.filter((b) => b.valor > 0).map((b) => ({ b, local: localizar(b) })).filter((x): x is { b: BolhaMapa; local: Local } => !!x.local);
    const nucleo = principais(locais.map((x) => ({ chave: x.b.chave, valor: x.b.valor })));
    const caixas = enquadramento === "brasil" ? [CAIXA_BR] : locais.filter((x) => nucleo.has(x.b.chave)).map((x) => x.local.caixa);
    return { locais, visaoAuto: enquadrar(caixas, proporcao) as Visao };
  }, [bolhas, enquadramento, proporcao]);
  const visao = manual ? ajustar(manual.v, proporcao) : visaoAuto;
  const chaveVisao = visao.map((n) => n.toFixed(1)).join(" ");

  const { pontos, fora, comDado, siglas } = useMemo(() => {
    const k = largura / visao[2];                                  // px por unidade do mapa
    const max = Math.max(1, ...locais.map((x) => x.b.valor));
    const rMax = Math.max(12, Math.min(28, altura / 9)), rMin = 3;
    const pontos = locais.filter((x) => dentroDe(visao, x.local)).map((x) => ({ ...x, r: (rMin + (rMax - rMin) * Math.sqrt(x.b.valor / max)) / k }))
      .sort((a, b) => b.r - a.r);                                  // menores por cima
    // vizinhos grandes (SP, RJ, MG, PR) se cobrem no cartão estreito: todas as bolhas encolhem na mesma proporção até
    // dois vizinhos se sobreporem no máximo 30% da soma dos raios (nunca abaixo de 60% do tamanho; pontos quase no mesmo
    // lugar, como DF e GO, não contam). A proporção entre as bolhas não muda.
    let escala = 1;
    for (let i = 0; i < pontos.length; i++) {
      for (let j = i + 1; j < pontos.length; j++) {
        const a = pontos[i], b = pontos[j];
        const d = Math.hypot(a.local.x - b.local.x, a.local.y - b.local.y);
        if (d * k < 14 || b.r * k < 6) continue;
        escala = Math.min(escala, d / (0.7 * (a.r + b.r)));
      }
    }
    escala = Math.max(0.6, Math.min(1, escala));
    for (const p of pontos) p.r *= escala;
    const fora = locais.filter((x) => !dentroDe(visao, x.local)).sort((a, b) => b.b.valor - a.b.valor);
    const comDado = new Set(locais.map((x) => x.b.forma ?? ""));
    if ([...comDado].some((c) => c.startsWith("BR-"))) comDado.add("BR");
    // siglas: só em bolha com espaço para o texto e sem encostar numa sigla já posta (das maiores para as menores)
    const postas: { x: number; y: number }[] = [];
    const siglas = pontos.filter(({ local, r }) => {
      if (r * k < 9 || postas.some((p) => Math.hypot((p.x - local.x) * k, (p.y - local.y) * k) < 22)) return false;
      postas.push(local);
      return true;
    });
    return { pontos, fora, comDado, siglas };
  }, [locais, chaveVisao, largura, altura]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ir até um lugar fora do quadro: enquadra o lugar junto com o Brasil (quando o Brasil tem dado), para não perder o contexto
  // (com 40 px livres no topo: os botões do quadro ficam ali e cobririam um país no alto, como Portugal)
  const irPara = (l: Local) => {
    const v = enquadrar(comDado.has("BR") ? [CAIXA_BR, l.caixa] : [l.caixa], proporcao) as Visao;
    const h = v[3] * altura / Math.max(80, altura - 40), w = h * proporcao;
    setManual({ modo: "livre", v: [v[0] + v[2] / 2 - w / 2, v[1] + v[3] - h, w, h] });
  };
  // o lugar escolhido (pela lista ou pelo filtro) fora do quadro: o mapa vai até ele
  useEffect(() => {
    const p = selecionado ? locais.find((x) => x.b.chave === selecionado) : null;
    if (p && !dentroDe(visao, p.local)) irPara(p.local);
  }, [selecionado]);   // eslint-disable-line react-hooks/exhaustive-deps
  const zoom = (f: number) => {
    const w = visao[2] * f, h = w / proporcao;
    setManual({ modo: "livre", v: [visao[0] + visao[2] / 2 - w / 2, visao[1] + visao[3] / 2 - h / 2, w, h] });
  };
  const verBrasil = () => setManual(enquadramento === "brasil" ? null : { modo: "brasil", v: enquadrar([CAIXA_BR], proporcao) as Visao });
  const verMundo = () => setManual({ modo: "mundo", v: enquadrar([MUNDO], proporcao) as Visao });
  const modo = manual?.modo ?? (enquadramento === "brasil" ? "brasil" : "livre");

  // arrastar move o mapa; um clique sem arrastar segue para a bolha (filtro)
  const arrasto = useRef<{ x: number; y: number; v: Visao; moveu: boolean } | null>(null);
  const arrastou = useRef(false);
  const [arrastando, setArrastando] = useState(false);
  const aoApertar = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    arrastou.current = false;
    arrasto.current = { x: e.clientX, y: e.clientY, v: visao, moveu: false };
  };
  const aoMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const a = arrasto.current;
    if (!a) return;
    const dx = e.clientX - a.x, dy = e.clientY - a.y;
    if (!a.moveu) {
      if (Math.hypot(dx, dy) < 4) return;
      a.moveu = true; setArrastando(true); setFoco(null);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const kk = largura / a.v[2];
    setManual({ modo: "livre", v: [a.v[0] - dx / kk, a.v[1] - dy / kk, a.v[2], a.v[3]] });
  };
  const aoSoltar = () => { arrastou.current = !!arrasto.current?.moveu; arrasto.current = null; setArrastando(false); };
  const clicar = (chave: string) => { if (arrastou.current) { arrastou.current = false; return; } aoClicar(chave); };

  const k = largura / visao[2];
  const brasilNoQuadro = visao[0] < CAIXA_BR[2] && visao[0] + visao[2] > CAIXA_BR[0] && visao[1] < CAIXA_BR[3] && visao[1] + visao[3] > CAIXA_BR[1];
  const balao = pontos.find((p) => p.b.chave === foco);
  const formaSel = bolhas.find((b) => b.chave === selecionado)?.forma ?? null;
  const ativar = (b: BolhaMapa) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoClicar(b.chave); } };

  return (
    <div className={`mp${arrastando ? " arrastando" : ""}`} ref={ref} style={alturaFixa ? { height: altura } : { flex: `1 1 ${alturaBase}px`, minHeight: alturaBase }}>
      <svg viewBox={chaveVisao} width={largura} height={altura} role="img" aria-label={rotuloAria} preserveAspectRatio="xMidYMid meet"
           onPointerDown={aoApertar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}>
        <g className="mp-terra">
          {PAISES.map((p, i) => <path key={p[0] || i} d={p[1]} className={`${comDado.has(p[0]) ? "com-dado" : ""}${formaSel === p[0] ? " selecionado" : ""}`} />)}
        </g>
        {brasilNoQuadro && (
          <g className="mp-ufs">
            {ESTADOS_BR.map((e) => <path key={e[0]} d={e[2]} className={`${comDado.has(e[0]) ? "com-dado" : ""}${formaSel === e[0] ? " selecionado" : ""}`} />)}
          </g>
        )}
        <g className="mp-bolhas">
          {pontos.map(({ b, local, r }) => (
            <g key={b.chave} className={`mp-ponto${b.chave === selecionado ? " selecionado" : ""}${b.clicavel ? "" : " sem-acao"}`} role={b.clicavel ? "button" : undefined} tabIndex={b.clicavel ? 0 : undefined}
               aria-label={`${b.rotulo}: ${b.detalhe.join(", ")}`} aria-pressed={b.clicavel ? b.chave === selecionado : undefined}
               onClick={b.clicavel ? () => clicar(b.chave) : undefined} onKeyDown={b.clicavel ? ativar(b) : undefined}
               onMouseEnter={() => { if (!arrasto.current?.moveu) setFoco(b.chave); }} onMouseLeave={() => setFoco(null)} onFocus={() => setFoco(b.chave)} onBlur={() => setFoco(null)}>
              {b.lenta && <circle className="mp-lenta" cx={local.x} cy={local.y} r={r + 3.5 / k} />}
              <circle className={b.tom ? `mp-bolha tom-${b.tom}` : `mp-bolha ${b.cor}${b.anel ? ` anel-${b.anel}` : ""}`} cx={local.x} cy={local.y} r={r} />
            </g>
          ))}
        </g>
        {/* siglas por cima de todas as bolhas (a bolha grande de SP fica embaixo das vizinhas) */}
        <g className="mp-siglas" aria-hidden="true">
          {siglas.map(({ b, local }) => <text key={b.chave} className="mp-sigla" x={local.x} y={local.y} style={{ fontSize: 10 / k }}>{b.sigla}</text>)}
        </g>
      </svg>
      <div className="mp-controles">
        <div className="mp-seg" role="group" aria-label={t("Enquadramento do mapa", "Map framing")}>
          <button className={modo === "brasil" ? "ativo" : ""} aria-pressed={modo === "brasil"} onClick={verBrasil} title={t("Enquadrar o Brasil · arraste o mapa para mover", "Frame Brazil · drag the map to move it")}>{t("Brasil", "Brazil")}</button>
          <button className={modo === "mundo" ? "ativo" : ""} aria-pressed={modo === "mundo"} onClick={verMundo} title={t("Mapa-múndi · arraste o mapa para mover", "World map · drag the map to move it")}>{t("Mundo", "World")}</button>
        </div>
        <button className="mp-zoom" onClick={() => zoom(0.6)} aria-label={t("Aproximar", "Zoom in")} title={t("Aproximar · arraste o mapa para mover", "Zoom in · drag the map to move it")}><PlusIcon /></button>
        <button className="mp-zoom" onClick={() => zoom(1 / 0.6)} aria-label={t("Afastar", "Zoom out")} title={t("Afastar · arraste o mapa para mover", "Zoom out · drag the map to move it")}><MinusIcon /></button>
      </div>
      {balao && (
        <div className={`mp-balao${(balao.local.y - visao[1]) * k < 96 ? " abaixo" : ""}`}
             style={{ left: Math.max(90, Math.min(largura - 90, (balao.local.x - visao[0]) * k)), top: (balao.local.y - visao[1]) * k + ((balao.local.y - visao[1]) * k < 96 ? balao.r * k : -balao.r * k) }}>
          <b>{balao.b.rotulo}</b>
          {balao.b.detalhe.map((l) => <span key={l}>{l}</span>)}
          {balao.b.clicavel && <span className="mp-balao-acao">{balao.b.chave === selecionado ? t("Clique para tirar o filtro", "Click to clear the filter") : t("Clique para filtrar a visão geral", "Click to filter the overview")}</span>}
        </div>
      )}
      {fora.length > 0 && (
        <div className="mp-fora">
          <span>{t("Fora do mapa:", "Off the map:")}</span>
          {fora.slice(0, 3).map(({ b, local }) => (
            <button key={b.chave} className="painel-link" onClick={() => irPara(local)} title={t("Mostrar no mapa", "Show on the map")}>{b.rotulo} ({formatarInt(b.valor)})</button>
          ))}
          {fora.length > 3 && <button className="painel-link" onClick={verMundo} title={t("Ver o mapa-múndi", "See the world map")}>+{fora.length - 3}</button>}
        </div>
      )}
    </div>
  );
};
