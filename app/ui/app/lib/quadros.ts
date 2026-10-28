/* Frames (1.45.8). Página montada com frames (num portal real: cerca de 1 carga de frame para cada 2 trocas de página;
   blank.jsf, blocos de menu e saldo, micro-frontend de alertas) carrega cada frame como uma navegação com
   navigation.tab_state = "duplicated", e o navegador informa a página que contém o frame (page.source.url.path, 1.028 de
   1.042). Os frames são PARTES da página, não passos: com eles escondidos, a leitura das origens recuperadas (BAS-10,
   qOrigensRecuperadas) traz também os frames (quadro = true), e aqui cada frame fica com a página que mais o contém; o erro
   de uma página que só existe como frame (não é troca de página no grafo) conta na página que a contém, em vez de ficar num
   nó escondido. Sem dependência do SDK. */

/** Frame: a página que o contém, quantas vezes carregou nela e, quando só existe como frame, os erros dele (que contam na
    página). */
export interface LinhaQuadro { app: string; pagina: string; quadro: string; cargas: number; soQuadro: boolean; erros: number; falhas: number; excecoes: number }
type Linha = Record<string, unknown>;
const txt = (v: unknown) => (v == null || v === "" ? null : String(v));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const ehQuadro = (l: Linha) => l.quadro === true || l.quadro === "true";

/** As linhas de frame de BAS-10 (app, de = página que contém, para = frame, n) -> app|frame -> página -> cargas. */
export function mapaDeQuadros(origens: Linha[]): Map<string, Map<string, number>> {
  const contem = new Map<string, Map<string, number>>();
  for (const l of origens) {
    if (!ehQuadro(l)) continue;
    const app = txt(l.app) ?? "", de = txt(l.de), para = txt(l.para);
    if (!de || !para) continue;
    const k = `${app}|${para}`, m = contem.get(k) ?? new Map<string, number>();
    m.set(de, (m.get(de) ?? 0) + num(l.n));
    contem.set(k, m);
  }
  return contem;
}

/** Os frames (cada um com a página que mais o contém) e os erros por página com os dos frames que só existem como frame
    somados na página que os contém. `naTela` = app|página que aparecem como troca de página no grafo. A soma dos erros não
    muda: só troca de página. */
export function juntarQuadros(contem: Map<string, Map<string, number>>, naTela: Set<string>, errosPorPagina: Linha[]) {
  const quadros: LinhaQuadro[] = [];
  for (const [k, m] of contem) {
    const i = k.indexOf("|"), app = k.slice(0, i), quadro = k.slice(i + 1);
    const [pagina] = [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
    quadros.push({ app, pagina, quadro, cargas: [...m.values()].reduce((s, x) => s + x, 0), soQuadro: !naTela.has(k), erros: 0, falhas: 0, excecoes: 0 });
  }
  const daPagina = new Map(quadros.filter((q) => q.soQuadro).map((q) => [`${q.app}|${q.quadro}`, q]));
  const juntos = new Map<string, Linha>();
  for (const l of errosPorPagina) {
    const q = daPagina.get(`${txt(l.app)}|${txt(l.view)}`);
    if (q) { q.erros += num(l.erros); q.falhas += num(l.falhas); q.excecoes += num(l.excecoes); }
    const view = q ? q.pagina : txt(l.view), k = `${txt(l.app)}|${view}`, a = juntos.get(k);
    if (a) { a.erros = num(a.erros) + num(l.erros); a.falhas = num(a.falhas) + num(l.falhas); a.excecoes = num(a.excecoes) + num(l.excecoes); }
    else juntos.set(k, { ...l, view });
  }
  return { quadros, erros: [...juntos.values()] };
}

/* 1.45.10: frames reconhecidos pelo comportamento nas últimas 24 h. Num portal real, o RUM marca só parte das
   cargas de frame (de 70% a 80% delas); as outras chegam como troca
   de página comum, com a origem da página anterior, e o grafo abria um leque de frames saindo da página de login, com
   abandono falso, e a navegação seguinte saía do frame. A análise de hora em hora (qHoraReq, grupo 8quadro) guarda, por
   página que carregou como frame, as cargas dela, as marcadas como frame e a página que a contém; somadas as 24 h, a
   página que carrega como frame em pelo menos metade das vezes (e 5 vezes ou mais) é frame em todas as cargas. */
export type HoraQuadro = [app: string, pagina: string, cargas: number, comoFrame: number, contem: Record<string, number>];
export interface EstadoQuadros { v: 1; horas: Record<string, HoraQuadro[]> }
export const MIN_CARGAS_FRAME = 5;
export const PARTE_FRAME = 0.5;
const MS_JANELA_QUADROS = 25 * 3_600_000;   // 24 h analisadas, com folga para a hora que ainda não foi analisada

/** As linhas do grupo 8quadro de uma hora, no formato do App State. */
export function linhasQuadroDaHora(linhas: Linha[]): HoraQuadro[] {
  const out: HoraQuadro[] = [];
  for (const l of linhas) {
    if (l.g !== "8quadro") continue;
    const app = txt(l.app), pagina = txt(l.pagina);
    if (!app || !pagina) continue;
    const contem: Record<string, number> = {};
    for (const c of Array.isArray(l.q_contem) ? l.q_contem : []) { const p = txt(c); if (p && p !== "?" && p !== pagina) contem[p] = (contem[p] ?? 0) + 1; }
    out.push([app, pagina, num(l.n), num(l.q_dup), contem]);
  }
  return out;
}

/** O estado com a hora nova (ou refeita) e sem as horas fora da janela. */
export function juntarHoraQuadros(estado: EstadoQuadros | null, hora: number, linhas: HoraQuadro[], agora: number): EstadoQuadros {
  const desde = agora - MS_JANELA_QUADROS, horas: Record<string, HoraQuadro[]> = {};
  for (const [h, ls] of Object.entries(estado?.horas ?? {})) if (Date.parse(h) >= desde && Array.isArray(ls)) horas[h] = ls;
  if (hora >= desde) horas[new Date(hora).toISOString()] = linhas;
  return { v: 1, horas };
}

/** app|página -> página que a contém, para as páginas que são frame nas últimas 24 h. Frame dentro de frame fica com a
    página de cima. */
export function componentesDe(estado: EstadoQuadros | null, agora: number): Map<string, string> {
  const desde = agora - MS_JANELA_QUADROS;
  const soma = new Map<string, { cargas: number; frame: number; contem: Map<string, number> }>();
  for (const [h, ls] of Object.entries(estado?.horas ?? {})) {
    if (!(Date.parse(h) >= desde) || !Array.isArray(ls)) continue;
    for (const [app, pagina, cargas, frame, contem] of ls) {
      const k = `${app}|${pagina}`, s = soma.get(k) ?? { cargas: 0, frame: 0, contem: new Map<string, number>() };
      s.cargas += num(cargas); s.frame += num(frame);
      for (const [p, c] of Object.entries(contem ?? {})) s.contem.set(p, (s.contem.get(p) ?? 0) + num(c));
      soma.set(k, s);
    }
  }
  const direto = new Map<string, string>();   // na ordem das cargas como frame (o texto da consulta leva os maiores)
  for (const [k, s] of [...soma].sort((a, b) => b[1].frame - a[1].frame || (a[0] < b[0] ? -1 : 1))) {
    if (s.frame < MIN_CARGAS_FRAME || s.frame < PARTE_FRAME * s.cargas || !s.contem.size) continue;
    direto.set(k, [...s.contem].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0][0]);
  }
  const out = new Map<string, string>();
  for (const [k, p] of direto) {
    const app = k.slice(0, k.indexOf("|")), vistos = new Set([k]);
    let topo = p;
    while (direto.has(`${app}|${topo}`) && !vistos.has(`${app}|${topo}`)) { vistos.add(`${app}|${topo}`); topo = direto.get(`${app}|${topo}`)!; }
    if (!direto.has(`${app}|${topo}`)) out.set(k, topo);   // frame que contém o próprio frame (ciclo): fica como está
  }
  return out;
}

/** As setas com os frames de 24 h (componentesDe): a carga do frame sai dos passos e conta na página que o contém
    (`contem`, para o painel e os erros); a navegação que sai do frame passa a sair da página que o contém (a recarga da
    mesma página o grafo já ignora). */
export function aplicarComponentes<A extends { app: string; appDe?: string | null; de: string | null; para: string; n: number }>(
  arestas: A[], componentes: Map<string, string>, contem: Map<string, Map<string, number>>): A[] {
  if (!componentes.size) return arestas;
  const out: A[] = [];
  for (const a of arestas) {
    const k = `${a.app}|${a.para}`, pai = componentes.get(k);
    if (pai) { const m = contem.get(k) ?? new Map<string, number>(); m.set(pai, (m.get(pai) ?? 0) + a.n); contem.set(k, m); continue; }
    const paiDe = a.de ? componentes.get(`${a.appDe ?? a.app}|${a.de}`) : undefined;
    out.push(paiDe ? { ...a, de: paiDe } : a);
  }
  return out;
}

/** A ligação página -> serviço com as chamadas dos frames que só existem como frame na página que os contém. */
export function paginasComQuadros<P extends { app: string; view: string; servico: string; chamadas: number }>(paginas: P[], quadros: LinhaQuadro[] | undefined): P[] {
  const pai = new Map((quadros ?? []).filter((q) => q.soQuadro).map((q) => [`${q.app}|${q.quadro}`, q.pagina]));
  if (!pai.size) return paginas;
  const m = new Map<string, P>();
  for (const p of paginas) {
    const view = pai.get(`${p.app}|${p.view}`) ?? p.view, k = `${p.app}|${view}|${p.servico}`, a = m.get(k);
    m.set(k, a ? { ...a, chamadas: a.chamadas + p.chamadas } : view === p.view ? p : { ...p, view });
  }
  return [...m.values()];
}

/** 1.45.11: nas linhas de erro da Visão geral (cartões: `paginas`; série: `view`), a página do frame vira a página que o
    contém, como no grafo; o "Ver no Flow" do cartão cai num nó que existe. As contagens não mudam (a série soma por
    página e hora). */
export function errosComComponentes<L extends Linha>(linhas: L[], componentes: Map<string, string>): L[] {
  if (!componentes.size) return linhas;
  return linhas.map((l) => {
    const app = txt(l.app) ?? "", troca = (p: unknown) => { const v = txt(p); return v ? componentes.get(`${app}|${v}`) ?? v : p; };
    const x: Linha = { ...l };
    if (Array.isArray(l.paginas)) x.paginas = [...new Set(l.paginas.map((p) => String(troca(p))))];
    if ("view" in l) x.view = troca(l.view);
    return x as L;
  });
}
