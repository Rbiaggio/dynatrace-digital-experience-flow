/* Apdex de Web Vitals da Visão geral: monta o cartão a partir das linhas de qApdexNomes e qApdex (lib/queries.ts). Sem
   consulta aqui e sem import de valor (os scripts em Node usam o mesmo arquivo). O modelo guarda só DADOS (vai para o
   cache); os textos saem na hora de desenhar (textoNota, textoEstado), no idioma escolhido.
   Regras: nota pelo valor mostrado (2 casas); vermelho só em Ruim e Inaceitável (impacta o cliente), âmbar em Razoável;
   só web (mobile não tem Web Vitals); país, região e versão não filtram a métrica; robôs entram sempre.
   O Apdex mobile (métrica do DEF rum_flow.mobile_apdex, régua própria) está no fim do arquivo (montarApdexMobile). */
import type { Segmento } from "./queries";

// idioma da interface (lib/i18n.ts): cópia local, porque os scripts em Node usam este arquivo sem import de valor
const t = (pt: string, en: string) => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? en : pt);
const loc = () => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "en-US" : "pt-BR");

export type NotaApdex = "excelente" | "bom" | "razoavel" | "ruim" | "inaceitavel";
/** Faixas do Apdex: limite inferior de cada nota. */
export const FAIXAS_APDEX: { nota: NotaApdex; min: number }[] = [
  { nota: "excelente", min: 0.94 }, { nota: "bom", min: 0.85 }, { nota: "razoavel", min: 0.7 }, { nota: "ruim", min: 0.5 }, { nota: "inaceitavel", min: 0 },
];
/** Apdex com 2 casas, o mesmo valor da tela; a nota sai dele (0,9372 aparece 0,94 e é Excelente, não Bom). */
export const arredondarApdex = (v: number) => Math.round(v * 100 + 1e-9) / 100;
export const notaApdex = (v: number): NotaApdex => { const r = arredondarApdex(v); return (FAIXAS_APDEX.find((f) => r >= f.min) ?? FAIXAS_APDEX[4]).nota; };
export const textoNota = (n: NotaApdex) => ({ excelente: t("Excelente", "Excellent"), bom: t("Bom", "Good"), razoavel: t("Razoável", "Fair"), ruim: t("Ruim", "Poor"), inaceitavel: t("Inaceitável", "Unacceptable") })[n];
/** Tom da nota na tela: "erro" (vermelho #C42B3F sobre #FDEEF0) só em Ruim e Inaceitável; "atencao" (âmbar) em Razoável. */
export const tomNota = (n: NotaApdex): "ok" | "atencao" | "erro" => (n === "ruim" || n === "inaceitavel" ? "erro" : n === "razoavel" ? "atencao" : "ok");
export const formatarApdex = (v: number) => arredondarApdex(v).toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Linha de qApdex já convertida (números do Grail chegam como texto). */
export interface LinhaApdex {
  tipo: string; frontend: string | null; view: string | null; apdex: number | null; soma: number | null; medicoes: number | null;
  perda: number | null; serie: (number | null)[] | null; inicio: string | null; passoMs: number | null; usuario: string | null; cargas: number | null;
}
const numOuNulo = (v: unknown) => (v == null || v === "" ? null : Number(v));
const textoOuNulo = (v: unknown) => (v == null ? null : String(v));
/** Registro de qApdex (Grail devolve números como texto e o intervalo em nanossegundos) para LinhaApdex. */
export const linhaApdex = (l: Record<string, unknown>): LinhaApdex => {
  const tf = l.timeframe as { start?: unknown } | null | undefined;
  return {
    tipo: String(l.tipo), frontend: textoOuNulo(l.frontend), view: textoOuNulo(l.view), apdex: numOuNulo(l.apdex), soma: numOuNulo(l.soma),
    medicoes: numOuNulo(l.medicoes), perda: numOuNulo(l.perda), serie: Array.isArray(l.serie) ? l.serie.map(numOuNulo) : null,
    inicio: textoOuNulo(tf?.start), passoMs: l.interval ? Number(l.interval) / 1e6 : null, usuario: textoOuNulo(l.usuario), cargas: numOuNulo(l.cargas),
  };
};
/** Linha de qApdexNomes. */
export interface ParApdex { entidade: string; frontend: string }
export const parApdex = (l: Record<string, unknown>): ParApdex => ({ entidade: String(l.entidade), frontend: String(l.frontend) });
/** Escopo da Visão geral, do lado do app: entidades web (APPLICATION-...) e quantas mobile ficaram de fora. */
export interface EscopoApdex { entidades: string[] | null; mobile: number; ignorados: (keyof Segmento)[] }

/** ok · sem-dado: o escopo tem medição em 7 dias, não nesta janela (ação: período maior) · sem-medicao: o escopo não
    mandou nenhum resumo de página com Web Vitals em 7 dias (ação: quem cuida da página) · so-mobile: escopo sem página
    web (cartão não aparece) · indisponivel: o ambiente não tem a métrica (cartão não aparece; item em "o que falta"). */
export type EstadoApdex = "ok" | "sem-dado" | "sem-medicao" | "so-mobile" | "indisponivel";
export interface AppApdex { frontend: string; entidade: string | null; app: string | null; apdex: number; nota: NotaApdex; medicoes: number | null }
export interface PaginaApdex extends AppApdex { view: string; perda: number; pctPerda: number }
/** Abaixo disso a nota oscila com uma ou duas cargas: o cartão mostra o número com "poucas medições". */
export const MIN_MEDICOES = 10;
export interface Apdex {
  estado: EstadoApdex;
  /** menos de MIN_MEDICOES cargas medidas no período */
  amostraPequena: boolean;
  apdex: number | null; nota: NotaApdex | null;
  /** cargas de página medidas (page summaries com Web Vitals); null quando todas tiveram nota 0 (a métrica não dá o número) */
  medicoes: number | null;
  medicoes7d: number | null;
  serie: (number | null)[]; inicioSerie: string | null; passoMs: number | null;
  apps: AppApdex[];
  /** piores primeiro: pela perda (medições x (1 - Apdex)); pctPerda = parte do que falta ao escopo para Apdex 1 */
  paginas: PaginaApdex[];
  mobileFora: number;
  ignorados: (keyof Segmento)[];
  /** % das cargas de página do recorte que vieram de robôs (a métrica de Apdex não separa); null sem dado */
  pctRobos: number | null;
  /** entidades web do escopo sem frontend.name em 7 dias (sem RUM): ficam fora do Apdex */
  semNome: string[];
  /** frontend.name usado por mais de uma entidade: o Apdex delas sai somado */
  repetidos: string[];
}

/** Escopo a partir das aplicações da Visão geral (AppInfo) e da escolhida. Todas = as aplicações web da lista (já só as
    habilitadas quando o filtro está ligado); lista vazia = sem recorte. */
export function escopoApdex(apps: { id: string; entidade?: string | null; canal?: string }[], app: string, todas: string, ignorados: (keyof Segmento)[]): EscopoApdex {
  const alvo = app === todas ? apps : apps.filter((a) => a.id === app);
  const web = alvo.filter((a) => a.canal !== "mobile" && a.canal !== "custom");
  const entidade = (a: { id: string; entidade?: string | null }) => a.entidade ?? (/^[0-9a-f]{16}$/.test(a.id) ? `APPLICATION-${a.id.toUpperCase()}` : null);
  return {
    entidades: app === todas && apps.length === 0 ? null : web.map(entidade).filter((e): e is string => !!e),
    mobile: alvo.filter((a) => a.canal === "mobile").length,
    ignorados,
  };
}

/** Nomes (frontend.name) do escopo, entidade de cada nome (para o "Ver no Flow") e os casos que o usuário precisa saber. */
export function nomesDoEscopo(pares: ParApdex[], escopo: EscopoApdex) {
  const entidadesDoNome = new Map<string, Set<string>>();
  for (const p of pares) (entidadesDoNome.get(p.frontend) ?? entidadesDoNome.set(p.frontend, new Set()).get(p.frontend)!).add(p.entidade);
  const alvo = escopo.entidades ? new Set(escopo.entidades) : null;
  const nomes = alvo ? [...new Set(pares.filter((p) => alvo.has(p.entidade)).map((p) => p.frontend))].sort() : null;
  const comNome = new Set(pares.map((p) => p.entidade));
  const entidadeDe = (frontend: string): string | null => {
    const es = [...(entidadesDoNome.get(frontend) ?? [])];
    return es.find((e) => !alvo || alvo.has(e)) ?? es[0] ?? null;
  };
  return {
    nomes,
    entidadeDe,
    semNome: escopo.entidades ? escopo.entidades.filter((e) => !comNome.has(e)) : [],
    repetidos: [...entidadesDoNome].filter(([f, es]) => es.size > 1 && (!nomes || nomes.includes(f))).map(([f]) => f),
  };
}

/** id do DEF (dt.rum.application.id) a partir da entidade web: o inverso de entidadeDaApp (components/Links.tsx). */
export const appDaEntidade = (entidade: string | null) => (entidade && entidade.startsWith("APPLICATION-") ? entidade.slice(12).toLowerCase() : null);

const vazio = (estado: EstadoApdex, escopo: EscopoApdex, extra: Partial<Apdex> = {}): Apdex => ({
  estado, amostraPequena: false, apdex: null, nota: null, medicoes: null, medicoes7d: null, serie: [], inicioSerie: null, passoMs: null, apps: [], paginas: [],
  mobileFora: escopo.mobile, ignorados: escopo.ignorados, pctRobos: null, semNome: [], repetidos: [], ...extra,
});

/** Precisa consultar? Não quando o escopo não tem página web ou nenhuma das aplicações web tem nome em 7 dias. */
export const consultarApdex = (n: ReturnType<typeof nomesDoEscopo>, escopo: EscopoApdex) =>
  !(escopo.entidades && escopo.entidades.length === 0) && !(n.nomes && n.nomes.length === 0);

/** Linhas da lista de páginas: as da página da CARGA ("carga", métrica do DEF por page.name) para cada aplicação que as tem;
    as outras aplicações ficam com o view.name da métrica de Apdex ("pagina"), que numa SPA é a tela em que o cliente saiu. */
const paginasDaLista = (carga: LinhaApdex[], pagina: LinhaApdex[]) => {
  const validas = carga.filter((l) => l.apdex != null && l.frontend);
  const comCarga = new Set(validas.map((l) => l.frontend));
  return [...validas, ...pagina.filter((l) => l.apdex != null && l.frontend && !comCarga.has(l.frontend))];
};

export function montarApdex(linhas: LinhaApdex[], n: ReturnType<typeof nomesDoEscopo>, escopo: EscopoApdex): Apdex {
  const extra = { semNome: n.semNome, repetidos: n.repetidos };
  if (escopo.entidades && escopo.entidades.length === 0) return vazio(escopo.mobile > 0 ? "so-mobile" : "sem-medicao", escopo);
  if (n.nomes && n.nomes.length === 0) return vazio("sem-medicao", escopo, extra);   // aplicações web sem RUM em 7 dias
  const de = (tipo: string) => linhas.filter((l) => l.tipo === tipo);
  const ambiente = de("ambiente")[0];
  if (!ambiente || !ambiente.soma) return vazio("indisponivel", escopo);
  const e7 = de("escopo7d")[0];
  const medicoes7d = e7?.apdex != null ? (e7.medicoes ?? null) : null;
  const total = de("total")[0];
  if (!total || total.apdex == null) return vazio(e7?.apdex != null ? "sem-dado" : "sem-medicao", escopo, { ...extra, medicoes7d });
  const comApp = <T extends { frontend: string | null }>(l: T) => { const entidade = l.frontend ? n.entidadeDe(l.frontend) : null; return { entidade, app: appDaEntidade(entidade) }; };
  const perdaTotal = total.medicoes != null && total.soma != null ? total.medicoes - total.soma : null;
  const usuarios = de("usuarios");
  const cargas = usuarios.reduce((s, u) => s + (u.cargas ?? 0), 0);
  const serie = de("serie")[0];
  return {
    estado: "ok",
    amostraPequena: total.medicoes != null && total.medicoes < MIN_MEDICOES,
    apdex: total.apdex, nota: notaApdex(total.apdex), medicoes: total.medicoes, medicoes7d,
    serie: serie?.serie ?? [], inicioSerie: serie?.inicio ?? null, passoMs: serie?.passoMs ?? null,
    apps: de("app").filter((l) => l.apdex != null && l.frontend).map((l) => ({ frontend: l.frontend!, ...comApp(l), apdex: l.apdex!, nota: notaApdex(l.apdex!), medicoes: l.medicoes }))
      .sort((a, b) => (b.medicoes ?? 0) - (a.medicoes ?? 0)),
    // página da carga (rum_flow.web_apdex do DEF) para as aplicações que a têm; as outras ficam no view.name da métrica de Apdex
    paginas: paginasDaLista(de("carga"), de("pagina")).map((l) => {
      const perda = l.perda ?? 0;
      return { frontend: l.frontend!, view: l.view ?? "(no name)", ...comApp(l), apdex: l.apdex!, nota: notaApdex(l.apdex!), medicoes: l.medicoes, perda,
               pctPerda: perdaTotal ? (100 * perda) / perdaTotal : 0 };
    }).sort((a, b) => b.perda - a.perda || a.apdex - b.apdex),
    mobileFora: escopo.mobile, ignorados: escopo.ignorados,
    pctRobos: cargas > 0 ? (100 * usuarios.filter((u) => u.usuario === "robot").reduce((s, u) => s + (u.cargas ?? 0), 0)) / cargas : null,
    ...extra,
  };
}

/** Piores páginas para a lista aberta pelo cartão: só as que perderam algo, na ordem da perda. */
export const pioresPaginas = (a: Apdex, max = 5) => a.paginas.filter((p) => p.perda > 0).slice(0, max);

/** Texto curto do estado (rótulo do cartão), sem travessão. */
export function textoEstado(a: Apdex, periodo: string): string {
  switch (a.estado) {
    case "sem-dado": return t(`Sem medição de Web Vitals em ${periodo}`, `No Web Vitals measurement in ${periodo}`);
    case "sem-medicao": return t("Nenhuma página deste escopo mandou Web Vitals em 7 dias", "No page in this scope sent Web Vitals in 7 days");
    case "so-mobile": return t("Apdex mede páginas web; app mobile não tem Web Vitals", "Apdex measures web pages; mobile apps have no Web Vitals");
    case "indisponivel": return t("Apdex indisponível neste ambiente", "Apdex not available in this environment");
    default: return a.nota ? textoNota(a.nota) : "";
  }
}
/** Etiqueta dos filtros que o Apdex não aplica (texto âmbar no cartão). */
export const textoIgnorados = (a: Apdex) => {
  if (!a.ignorados.length) return null;
  const nomes = a.ignorados.map((k) => ({ pais: t("país", "country"), regiao: t("região", "region"), versao: t("versão", "version") } as Record<string, string>)[k] ?? k);
  return t(`Sem o filtro de ${nomes.join(" e ")}: a métrica não tem essa informação`, `Without the ${nomes.join(" and ")} filter: the metric does not have it`);
};

/* ---- Apdex mobile ---------------------------------------------------------------------------------------------------
   Lado mobile do cartão, a partir das linhas de qApdexMobile (lib/queries.ts): métrica rum_flow.mobile_apdex do DEF,
   contador por item e faixa (regras em lib/prerequisitos.ts, REGRAS_APDEX_MOBILE). Apdex = (satisfeitos + tolerantes / 2)
   / total, na régua de 0 a 1 do web, mas nunca somado com ele. Por aplicação: com ação de toque no período contam ação,
   abertura, crash e ANR; sem ação de toque (o app só manda a ação de abertura), cada tela (view_summary) conta no lugar da
   ação, sem erro = 1 e com erro = 0, e o cartão marca "Validar:". Crash e ANR contam sempre (0) e têm indicador próprio,
   com a taxa por sessão (sessões da Visão geral). */
export type ItemMobile = "acao" | "abertura" | "tela" | "crash" | "anr";
export interface LinhaApdexMobile {
  linha: string; app: string | null; frontend: string | null; sistema: string | null; item: string | null; faixa: string | null;
  view: string | null; acao: string | null; tipoAbertura: string | null; n: number; sat: number; tol: number; erro: number; lento: number; perda: number;
  p75: number | null; serie: (number | null)[] | null; inicio: string | null; passoMs: number | null;
}
const num0 = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
/** Registro de qApdexMobile (números do Grail chegam como texto; intervalo em nanossegundos) para LinhaApdexMobile. */
export const linhaApdexMobile = (l: Record<string, unknown>): LinhaApdexMobile => {
  const tf = l.timeframe as { start?: unknown } | null | undefined;
  return {
    linha: String(l.linha), app: textoOuNulo(l.app), frontend: textoOuNulo(l.frontend), sistema: textoOuNulo(l.sistema), item: textoOuNulo(l.item), faixa: textoOuNulo(l.faixa),
    view: textoOuNulo(l.view), acao: textoOuNulo(l.acao), tipoAbertura: textoOuNulo(l.tipoAbertura), n: num0(l.n), sat: num0(l.sat), tol: num0(l.tol), erro: num0(l.erro),
    lento: num0(l.lento), perda: num0(l.perda), p75: numOuNulo(l.p75), serie: Array.isArray(l.serie) ? l.serie.map(numOuNulo) : null,
    inicio: textoOuNulo(tf?.start), passoMs: l.interval ? Number(l.interval) / 1e6 : null,
  };
};
export interface AberturaMobile { tipo: "cold" | "warm" | "hot"; p75Ms: number | null; n: number; apdex: number | null }
/** Item que puxa o Apdex mobile para baixo. nome: a ação (acao), o tipo de abertura (abertura) ou a tela (tela, crash, anr). */
export interface PiorMobile { app: string; tipo: ItemMobile; nome: string; tela: string | null; n: number; apdex: number; perda: number; pctPerda: number; erro: number; lento: number; tol: number }
export interface AppApdexMobile { app: string; frontend: string | null; apdex: number; nota: NotaApdex; unidades: number; porTelas: boolean; crashes: number; anrs: number }
/** ok · sem-dado: a métrica tem contagem em 7 dias, não nesta janela · indisponivel: nada em 7 dias (regra não aplicada,
    aplicação nova ou sem tráfego) */
export type EstadoApdexMobile = "ok" | "sem-dado" | "indisponivel";
export interface ApdexMobile {
  estado: EstadoApdexMobile;
  apdex: number | null; nota: NotaApdex | null;
  /** menos de MIN_MEDICOES itens medidos */
  amostraPequena: boolean;
  /** itens que entram na nota e cada parte deles */
  unidades: number; acoes: number; aberturas: number; telas: number; crashes: number; anrs: number;
  /** alguma aplicação do escopo sem ação de toque: a nota dela usa as telas ("Validar:") */
  porTelas: boolean;
  apps: AppApdexMobile[];
  porSistema: { nome: string; apdex: number; nota: NotaApdex; n: number }[];
  aberturasPorTipo: AberturaMobile[];
  /** piores primeiro, pela perda (itens x o que cada um perdeu); pctPerda = parte do que falta ao escopo para 1 */
  piores: PiorMobile[];
  serie: (number | null)[]; inicioSerie: string | null; passoMs: number | null;
  /** crashes e ANR por aplicação e tela (base da regra M1 das oportunidades) */
  travamentos: { app: string; tela: string; crashes: number; anrs: number }[];
}
const ITENS_COM_ACAO = new Set(["acao", "abertura", "crash", "anr"]);
const ITENS_COM_TELA = new Set(["tela", "abertura", "crash", "anr"]);
const ORDEM_ABERTURA = ["cold", "warm", "hot"] as const;
const apdexDe = (n: number, sat: number, tol: number) => (n > 0 ? (sat + tol / 2) / n : null);
const vazioMobile = (estado: EstadoApdexMobile): ApdexMobile => ({
  estado, apdex: null, nota: null, amostraPequena: false, unidades: 0, acoes: 0, aberturas: 0, telas: 0, crashes: 0, anrs: 0, porTelas: false,
  apps: [], porSistema: [], aberturasPorTipo: [], piores: [], serie: [], inicioSerie: null, passoMs: null, travamentos: [],
});

export function montarApdexMobile(linhas: LinhaApdexMobile[]): ApdexMobile {
  const de = (x: string) => linhas.filter((l) => l.linha === x);
  const base = de("base").filter((l) => l.app && l.item && l.faixa && l.n > 0);
  if (!base.length) return vazioMobile((de("escopo7d")[0]?.n ?? 0) > 0 ? "sem-dado" : "indisponivel");
  // por aplicação: ação de toque no período? sem ela, as telas contam no lugar da ação
  const porTelas = new Map<string, boolean>();
  for (const l of base) porTelas.set(l.app!, (porTelas.get(l.app!) ?? true) && l.item !== "acao");
  const entra = (l: { app: string | null; item: string | null }) => !!l.app && !!l.item && (porTelas.get(l.app) ? ITENS_COM_TELA : ITENS_COM_ACAO).has(l.item);
  const usados = base.filter(entra);
  const soma = (ls: LinhaApdexMobile[]) => ls.reduce((s, l) => ({ n: s.n + l.n, sat: s.sat + (l.faixa === "satisfeito" ? l.n : 0), tol: s.tol + (l.faixa === "tolerante" ? l.n : 0) }), { n: 0, sat: 0, tol: 0 });
  const doItem = (i: string) => usados.filter((l) => l.item === i).reduce((s, l) => s + l.n, 0);
  const total = soma(usados);
  const apdex = apdexDe(total.n, total.sat, total.tol)!;
  const agrupar = (chave: (l: LinhaApdexMobile) => string | null) => {
    const m = new Map<string, LinhaApdexMobile[]>();
    for (const l of usados) { const k = chave(l); if (k != null) (m.get(k) ?? m.set(k, []).get(k)!).push(l); }
    return m;
  };
  const contaItem = (ls: LinhaApdexMobile[], i: string) => ls.filter((l) => l.item === i).reduce((x, l) => x + l.n, 0);
  const apps: AppApdexMobile[] = [...agrupar((l) => l.app).entries()].map(([app, ls]) => {
    const s = soma(ls), a = apdexDe(s.n, s.sat, s.tol)!;
    return { app, frontend: ls.find((l) => l.frontend)?.frontend ?? null, apdex: a, nota: notaApdex(a), unidades: s.n, porTelas: !!porTelas.get(app), crashes: contaItem(ls, "crash"), anrs: contaItem(ls, "anr") };
  }).sort((a, b) => b.unidades - a.unidades);
  const porSistema = [...agrupar((l) => l.sistema).entries()].map(([nome, ls]) => { const s = soma(ls), a = apdexDe(s.n, s.sat, s.tol)!; return { nome, apdex: a, nota: notaApdex(a), n: s.n }; })
    .sort((a, b) => b.n - a.n);
  // piores: itens do modo de cada aplicação (crash e ANR por tela), pela perda
  const perdaTotal = total.n - total.sat - total.tol / 2;
  const itens = de("item").filter((l) => entra(l) && l.n > 0);
  const piores: PiorMobile[] = itens.map((l) => {
    const tipo = l.item as ItemMobile;
    const nome = tipo === "acao" ? (l.acao ?? l.view ?? "") : tipo === "abertura" ? (l.tipoAbertura ?? "cold") : (l.view ?? "");
    const perda = l.n - l.sat - l.tol / 2;
    return { app: l.app!, tipo, nome, tela: l.view, n: l.n, apdex: apdexDe(l.n, l.sat, l.tol)!, perda, pctPerda: perdaTotal > 0 ? (100 * perda) / perdaTotal : 0, erro: l.erro, lento: l.lento, tol: l.tol };
  }).filter((p) => p.perda > 0).sort((a, b) => b.perda - a.perda || a.apdex - b.apdex);
  const porTela = new Map<string, { app: string; tela: string; crashes: number; anrs: number }>();
  for (const l of itens.filter((x) => x.item === "crash" || x.item === "anr")) {
    const k = `${l.app}|${l.view ?? ""}`, x = porTela.get(k) ?? { app: l.app!, tela: l.view ?? "", crashes: 0, anrs: 0 };
    if (l.item === "crash") x.crashes += l.n; else x.anrs += l.n;
    porTela.set(k, x);
  }
  // abertura: p75 da métrica nativa por tipo e a nota de cada tipo pela métrica do DEF
  const nativa = de("abertura");
  const aberturasPorTipo: AberturaMobile[] = ORDEM_ABERTURA.map((tipo) => {
    const s = itens.filter((l) => l.item === "abertura" && (l.tipoAbertura ?? "cold") === tipo).reduce((x, l) => ({ n: x.n + l.n, sat: x.sat + l.sat, tol: x.tol + l.tol }), { n: 0, sat: 0, tol: 0 });
    const nat = nativa.find((l) => l.tipoAbertura === tipo);
    return { tipo, p75Ms: nat?.p75 ?? null, n: Math.max(s.n, nat?.n ?? 0), apdex: apdexDe(s.n, s.sat, s.tol) };
  }).filter((a) => a.n > 0);
  // linha do período: por faixa de tempo, só os itens que entram na nota de cada aplicação
  const series = de("serie").filter((l) => entra(l) && l.serie);
  const nPontos = series.reduce((m, l) => Math.max(m, l.serie!.length), 0);
  const serie = Array.from({ length: nPontos }, (_, i) => {
    let n = 0, sat = 0, tol = 0;
    for (const l of series) { const v = l.serie![i] ?? 0; n += v; if (l.faixa === "satisfeito") sat += v; else if (l.faixa === "tolerante") tol += v; }
    return n > 0 ? Math.round(apdexDe(n, sat, tol)! * 1000) / 1000 : null;
  });
  return {
    estado: "ok", apdex, nota: notaApdex(apdex), amostraPequena: total.n < MIN_MEDICOES,
    unidades: total.n, acoes: doItem("acao"), aberturas: doItem("abertura"), telas: doItem("tela"), crashes: contaItem(base, "crash"), anrs: contaItem(base, "anr"),
    porTelas: apps.some((a) => a.porTelas), apps, porSistema, aberturasPorTipo, piores,
    serie, inicioSerie: series[0]?.inicio ?? null, passoMs: series[0]?.passoMs ?? null,
    travamentos: [...porTela.values()].sort((a, b) => b.crashes + b.anrs - a.crashes - a.anrs),
  };
}
/** Aplicações mobile do escopo (dt.rum.application.id = UUID) e as entidades delas (métrica nativa da abertura). */
export function escopoApdexMobile(apps: { id: string; entidade?: string | null; canal?: string }[], app: string, todas: string) {
  const mob = (app === todas ? apps : apps.filter((a) => a.id === app)).filter((a) => a.canal === "mobile");
  return { apps: mob.map((a) => a.id), entidades: mob.map((a) => a.entidade).filter((e): e is string => !!e) };
}
/** As sessões de cada aplicação na MESMA janela dos crashes e ANR (1.44.6): no escopo padrão, a última hora só com a
    janela "Última hora" e as 24 h analisadas só com "Últimas 24 horas"; fora dele, as da Visão geral, que são do período
    escolhido, só quando o Apdex está nesse mesmo período. Em outra janela, null: a tela mostra a contagem, sem a taxa
    (dividir crashes de 7 dias por sessões de 1 hora inflava a taxa). */
export function sessoesNaJanela(d: { porApp: { app: string; sessoes: number }[]; porApp24?: { app: string; sessoes: number }[]; periodos?: unknown } | null | undefined,
                                janelaCrash: string, janelaTela: string): Map<string, number> | null {
  if (!d) return null;
  const base = d.periodos ? (janelaCrash === "60m" ? d.porApp : janelaCrash === "24h" ? d.porApp24 ?? null : null) : (janelaCrash === janelaTela ? d.porApp : null);
  return base ? new Map(base.map((r) => [r.app, r.sessoes])) : null;
}
/** Entrada da regra M1 das oportunidades (lib/oportunidades.ts, EntradaMobile.falhas): crashes e ANR por aplicação, da
    métrica do Apdex mobile, com as sessões de cada aplicação na Visão geral (o crash encerra a sessão: 1 crash = 1 sessão). */
export const falhasMobile = (m: ApdexMobile | null, sessoes: Map<string, number> | null) =>
  m && m.estado === "ok" && sessoes ? m.apps.map((a) => ({ app: a.app, sessoes: sessoes.get(a.app) ?? 0, crash: a.crashes, anr: a.anrs })) : null;
/** Crashes e ANR por sessão (%), com as sessões das aplicações mobile do escopo no mesmo período; null sem sessões. */
export const taxaTravamentos = (m: ApdexMobile, sessoes: number | null | undefined) => (sessoes && sessoes > 0 ? (100 * (m.crashes + m.anrs)) / sessoes : null);
