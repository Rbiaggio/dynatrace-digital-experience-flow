/* LEITURA AO VIVO COMPARTILHADA (1.42). A janela relativa é exata ([agora - janela, agora]): o meio sai das fatias
   guardadas e a cabeça (antes da 1ª fatia inteira) e a cauda (depois da última fatia gravada) saem da cópia. Na 1.42.0
   cada leitor (aplicações, setas, views, erros e os três Apdex) lia a própria cabeça e a própria cauda: a mesma cópia
   relida até 9 vezes por carga (o custo voltava ao da 1.40). Agora a cabeça e a
   cauda de todos os grupos saem de UMA leitura (qTrechoAoVivo), guardada nesta aba por 5 min (como o cache das telas) e
   servida a todos os leitores e escopos da mesma janela; cada leitor lê só as fatias guardadas do MESMO trecho e as
   funções juntar* somam a cabeça e a cauda com as mesmas regras do DQL do leitor (filtros, agrupamento, campos
   calculados, ordem e limite). Provado por valor contra a leitura direta da cópia na janela inteira Sem dependência do SDK (roda também em Node). */
import { trechosAoVivo, qTrechoAoVivo, exemplosDe, percentilDasFaixas, N_FAIXAS, semTempoRealEmUso, type Trecho } from "./agregados";

type Linha = Record<string, unknown>;
type Linhas = Linha[];
export interface TrechoAoVivo { t: Trecho; linhas: Promise<Linhas>; lidoEm: number }
/** Quanto a leitura ao vivo serve nesta aba (o mesmo dos caches das telas; o Atualizar relê). */
export const VALIDADE_TRECHO_MS = 5 * 60000;
const lidos = new Map<string, TrechoAoVivo>();

/** O trecho ao vivo da janela: o intervalo sai na hora (os leitores começam juntos, com o mesmo `t`) e as linhas chegam
    pela promessa. Uma leitura por janela a cada VALIDADE_TRECHO_MS nesta aba; `minimo` = só vale o lido depois disto
    (Atualizar). Falha: a próxima chamada lê de novo. */
export function lerTrecho(janela: string, ler: (q: string) => Promise<Linhas>, minimo = 0, agora = Date.now()): TrechoAoVivo {
  // 1.46.0, sem tempo real: o trecho vai até a última fatia gravada, sem cabeça nem cauda; nada é lido da cópia
  if (semTempoRealEmUso()) return { t: trechosAoVivo(janela, agora), linhas: Promise.resolve([]), lidoEm: agora };
  const e = lidos.get(janela);
  if (e && agora - e.lidoEm < VALIDADE_TRECHO_MS && e.lidoEm >= minimo) return e;
  const t = trechosAoVivo(janela, agora);
  const novo: TrechoAoVivo = { t, linhas: ler(qTrechoAoVivo(t)), lidoEm: agora };
  lidos.set(janela, novo);
  novo.linhas.catch(() => { if (lidos.get(janela) === novo) lidos.delete(janela); });
  return novo;
}
export const esquecerTrechos = () => lidos.clear();
/** Um leitor com o trecho: lê só as fatias guardadas do trecho e soma a cabeça e a cauda (`juntar`). Sem trecho (janela
    "início/fim" ou leitura pela cópia), o leitor como sempre; se a leitura do trecho falhar, a leitura completa do leitor
    (cabeça + fatias + cauda numa consulta), com o mesmo resultado. */
export async function comTrecho<T>(tr: TrechoAoVivo | null, ler: (t?: Trecho) => Promise<T>, juntar: (x: T, linhas: Linhas) => T): Promise<T> {
  if (!tr) return ler();
  const [x, linhas] = await Promise.all([ler(tr.t), tr.linhas.catch(() => null)]);
  return linhas ? juntar(x, linhas) : ler();
}

const txt = (x: unknown) => (x == null ? null : String(x));
const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const chave = (...xs: unknown[]) => xs.map((x) => (x == null ? "\u0000" : String(x))).join("\u0001");
const doGrupo = (tr: Linhas, k: string) => tr.filter((l) => l.k === k);
// os filtros dos leitores (lib/agregados.ts), linha a linha
const daApp = (app: string, l: Linha) => app === "*" || l.app === app;
const semRobo = (robos: boolean, l: Linha) => robos || l.usuario == null || l.usuario !== "robot";
const semQuadro = (quadros: boolean, l: Linha) => quadros || l.aba == null || l.aba !== "duplicated";
const proprio = (l: Linha) => l.provedor == null || l.provedor !== "third_party" || String(l.app ?? "").includes("-");

/** Soma por chave: as linhas do leitor (já agrupadas) e as do trecho, com `novo` criando a linha que só existe no trecho e
    `somar` acumulando. Mantém a ordem do leitor; as novas vão para o fim. */
function somarPor(base: Linhas, chaveBase: (l: Linha) => string, extra: Linhas, chaveExtra: (l: Linha) => string, novo: (l: Linha) => Linha, somar: (alvo: Linha, l: Linha) => void): Linhas {
  const m = new Map<string, Linha>();
  const saida: Linhas = [];
  for (const l of base) { const c = { ...l }; m.set(chaveBase(l), c); saida.push(c); }
  for (const l of extra) {
    const k = chaveExtra(l);
    let alvo = m.get(k);
    if (!alvo) { alvo = novo(l); m.set(k, alvo); saida.push(alvo); }
    somar(alvo, l);
  }
  return saida;
}
const porNDesc = (campo: string) => (a: Linha, b: Linha) => num(b[campo]) - num(a[campo]);

/** BAS-01: navegações por aplicação (entidade e nome da 1ª linha que tiver), maiores primeiro, até 200. */
export function juntarAplicacoes(ls: Linhas, tr: Linhas): Linhas {
  const r = somarPor(ls, (l) => chave(l["dt.rum.application.id"]), doGrupo(tr, "nav"), (l) => chave(l.app),
    (l) => ({ "dt.rum.application.id": l.app ?? null, nome: null, entidade: null, navegacoes: 0, sessoes: 0 }),
    (a, l) => { a.navegacoes = num(a.navegacoes) + num(l.n); if (a.entidade == null && l.entidade != null) a.entidade = l.entidade; if (a.nome == null && l.nome != null) a.nome = l.nome; });
  for (const a of r) if (a.nome == null) a.nome = a["dt.rum.application.id"];
  return r.sort(porNDesc("navegacoes")).slice(0, 200);
}
/** BAS-02: setas página -> página e entradas da aplicação (ou todas), sem robôs e sem frames se pedido. */
export function juntarArestas(ls: Linhas, tr: Linhas, app: string, robos: boolean, quadros: boolean, limite: number): Linhas {
  const ext = doGrupo(tr, "nav").filter((l) => daApp(app, l) && semRobo(robos, l) && semQuadro(quadros, l));
  return somarPor(ls, (l) => chave(l.app, l.de, l.para, l.tipo), ext, (l) => chave(l.app, l.origem, l.pagina, l.navegacao),
    (l) => ({ app: l.app ?? null, de: l.origem ?? null, para: l.pagina ?? null, tipo: l.navegacao ?? null, n: 0, sessoes: 0 }),
    (a, l) => { a.n = num(a.n) + num(l.n); }).sort(porNDesc("n")).slice(0, limite);
}
/** BAS-04: erros próprios por página, por tipo. */
/** BAS-10 pelas fatias (1.46.1, grupo orig): origens recuperadas (aba nova ou frame) somadas com o trecho ao vivo, sem robôs
    se pedido; quadro = a carga foi de frame (aba "duplicated"). Mesmas colunas de qOrigensRecuperadas. */
export function juntarOrigens(ls: Linhas, tr: Linhas, app: string, robos: boolean): Linhas {
  const q = (x: unknown) => String(x === true || x === "true");
  const ext = doGrupo(tr, "orig").filter((l) => daApp(app, l) && semRobo(robos, l));
  return somarPor(ls, (l) => chave(l.app, l.de, l.para, l.tipo, q(l.quadro)), ext, (l) => chave(l.app, l.origem, l.pagina, l.navegacao, q(l.aba === "duplicated")),
    (l) => ({ app: l.app ?? null, de: l.origem ?? null, para: l.pagina ?? null, tipo: l.navegacao ?? null, quadro: l.aba === "duplicated", n: 0 }),
    (a, l) => { a.n = num(a.n) + num(l.n); });
}
export function juntarErros(ls: Linhas, tr: Linhas, app: string, robos: boolean): Linhas {
  const ext = doGrupo(tr, "erro").filter((l) => proprio(l) && daApp(app, l) && semRobo(robos, l));
  const r = somarPor(ls, (l) => chave(l.app, l.view), ext, (l) => chave(l.app, l.pagina),
    (l) => ({ app: l.app ?? null, view: l.pagina ?? null, excecoes: 0, falhas: 0, outros: 0, erros: 0 }),
    (a, l) => {
      const t = txt(l.etipo), n = num(l.n);
      if (t === "exception") a.excecoes = num(a.excecoes) + n; else if (t === "request") a.falhas = num(a.falhas) + n; else a.outros = num(a.outros) + n;
    });
  for (const a of r) a.erros = num(a.excecoes) + num(a.falhas) + num(a.outros);
  return r.slice(0, 4000);
}
/** BAS-03: views por página, a soma e as medições do tempo em 1º plano e o tempo médio (ms). */
export function juntarViews(ls: Linhas, tr: Linhas, app: string, robos: boolean): Linhas {
  const ext = doGrupo(tr, "view").filter((l) => daApp(app, l) && semRobo(robos, l));
  const r = somarPor(ls, (l) => chave(l.app, l.view), ext, (l) => chave(l.app, l.pagina),
    (l) => ({ app: l.app ?? null, view: l.pagina ?? null, views: 0, soma: 0, medidos: 0, sessoes: 0 }),
    (a, l) => { a.views = num(a.views) + num(l.n); a.soma = num(a.soma) + num(l.soma); a.medidos = num(a.medidos) + num(l.medidos); });
  for (const a of r) a.tempo_ms = num(a.medidos) > 0 ? num(a.soma) / num(a.medidos) / 1000000 : null;
  return r.slice(0, 4000);
}
/** APX-02, linhas "carga" de qApdex: soma das notas e cargas medidas por aplicação e página da carga; Apdex, perda e
    medições refeitos; ordem perda desc, Apdex asc; até 200. As outras linhas (métrica nativa) ficam como vieram. Com
    `nomes`, só as aplicações deles. medidos da linha do leitor = perda + soma (perda = medidos - soma). */
export function juntarApdexCarga(linhas: Linhas, tr: Linhas, nomes: string[] | null): Linhas {
  const cargas = linhas.filter((l) => l.tipo === "carga"), outras = linhas.filter((l) => l.tipo !== "carga");
  const ext = doGrupo(tr, "carga").filter((l) => !nomes || nomes.includes(String(l.frontend)));
  const r = somarPor(cargas.map((l) => ({ ...l, medidos: num(l.perda) + num(l.soma) })), (l) => chave(l.frontend, l.view), ext, (l) => chave(l.frontend, l.carga),
    (l) => ({ tipo: "carga", frontend: l.frontend ?? null, view: l.carga ?? null, apdex: 0, soma: 0, medidos: 0, perda: 0, medicoes: null }),
    (a, l) => { a.soma = num(a.soma) + num(l.soma); a.medidos = num(a.medidos) + num(l.n); });
  for (const a of r) {
    const md = num(a.medidos), sm = num(a.soma);
    a.apdex = md > 0 ? sm / md : 0; a.perda = md - sm; a.medicoes = num(a.apdex) > 0 ? sm / num(a.apdex) : null;
    delete a.medidos;
  }
  r.sort((a, b) => num(b.perda) - num(a.perda) || num(a.apdex) - num(b.apdex));
  return [...outras, ...r.slice(0, 200)];
}
/** APX-03, linhas "base" e "item" de qApdexMobile: contagens por faixa somadas (base por aplicação, item, frontend,
    sistema e faixa; item por aplicação, item, tela, ação e tipo de abertura), perda do item refeita; ordem linha asc,
    perda desc, n desc; até 1.000. Série, escopo de 7 dias e abertura ficam como vieram. */
export function juntarApdexMobile(linhas: Linhas, tr: Linhas, apps: string[], so: string | null): Linhas {
  const bi = linhas.filter((l) => l.linha === "base" || l.linha === "item"), outras = linhas.filter((l) => l.linha !== "base" && l.linha !== "item");
  const ext = doGrupo(tr, "amob").filter((l) => apps.includes(String(l.app)) && (!so || l.sistema === so));
  const dupla = ext.flatMap((l) => [{ ...l, _linha: "base" }, { ...l, _linha: "item" }]);
  const cBase = (l: Linha) => (l.linha ?? l._linha) === "base"
    ? chave("base", l.app, l.item, l.frontend, l.sistema, l.faixa)
    : chave("item", l.app, l.item, l.view ?? l.pagina, l.acao, l.tipoAbertura ?? l.abertura);
  const cExt = (l: Linha) => l._linha === "base" ? chave("base", l.app, l.item, l.frontend, l.sistema, l.faixa) : chave("item", l.app, l.item, l.pagina, l.acao, l.abertura);
  const r = somarPor(bi, cBase, dupla, cExt,
    (l) => l._linha === "base"
      ? { linha: "base", app: l.app ?? null, item: l.item ?? null, frontend: l.frontend ?? null, sistema: l.sistema ?? null, faixa: l.faixa ?? null, view: null, acao: null, tipoAbertura: null, n: 0, sat: 0, tol: 0, erro: 0, lento: 0, perda: null }
      : { linha: "item", app: l.app ?? null, item: l.item ?? null, frontend: null, sistema: null, faixa: null, view: l.pagina ?? null, acao: l.acao ?? null, tipoAbertura: l.abertura ?? null, n: 0, sat: 0, tol: 0, erro: 0, lento: 0, perda: 0 },
    (a, l) => {
      const n = num(l.n), f = txt(l.faixa);
      a.n = num(a.n) + n;
      if (f === "satisfeito") a.sat = num(a.sat) + n; else if (f === "tolerante") a.tol = num(a.tol) + n;
      else if (f === "frustrado_erro") a.erro = num(a.erro) + n; else if (f === "frustrado_tempo") a.lento = num(a.lento) + n;
    });
  for (const a of r) if (a.linha === "item") a.perda = num(a.n) - num(a.sat) - num(a.tol) / 2;
  r.sort((a, b) => (String(a.linha) < String(b.linha) ? -1 : String(a.linha) > String(b.linha) ? 1 : 0) || num(b.perda) - num(a.perda) || num(b.n) - num(a.n));
  return [...r.slice(0, 1000), ...outras];
}
/** APX-04: contagem por canal, aplicação, lugar e faixa das aplicações pedidas; só as com contagem; até 3.000. */
export function juntarLugares(ls: Linhas, tr: Linhas, apps: string[]): Linhas {
  const ext = doGrupo(tr, "lugar").filter((l) => apps.includes(String(l.app)));
  return somarPor(ls, (l) => chave(l.canal, l.app, l.pais, l.regiao, l.faixa), ext, (l) => chave(l.canal, l.app, l.pais, l.regiao, l.faixa),
    (l) => ({ canal: l.canal ?? null, app: l.app ?? null, pais: l.pais ?? null, regiao: l.regiao ?? null, faixa: l.faixa ?? null, n: 0 }),
    (a, l) => { a.n = num(a.n) + num(l.n); }).filter((l) => num(l.n) > 0).slice(0, 3000);
}

/* ---- Erros ao vivo (1.43, agregados errx) ------------------------------------------------------------------------- */
const vazioNulo = (x: unknown) => (x == null || x === "" ? null : x);
const maisRecente = (a: unknown, b: unknown) => { const x = txt(a), y = txt(b); return !x ? y : !y ? x : x > y ? x : y; };
/** Os 3 exemplos mais recentes de uma linha somada: os gravados (JSON das fatias) e os da ponta (_ext); a lista de traces e
    a de sessões saem deles. */
function fecharExemplos(r: Linhas) {
  for (const a of r) {
    const ex = exemplosDe(a, ...((a._ext as Linhas | undefined) ?? []));
    a.exemplos = ex; a.amostra_t = ex.map((x) => x.t).filter(Boolean); a.amostra_s = ex.map((x) => x.s).filter(Boolean);
    delete a._ext; delete a.amostras_j; delete a.amostras;
  }
  return r;
}
/** ERR-01: erros como o cliente sentiu (próprios), ocorrências, páginas, último e exemplos; ordem pelas ocorrências, até 300. */
export function juntarErrosCliente(ls: Linhas, tr: Linhas, app: string, robos: boolean): Linhas {
  const ext = doGrupo(tr, "errx").filter((l) => proprio(l) && daApp(app, l) && semRobo(robos, l));
  const r = somarPor(ls, (l) => chave(l.app, l.tipo, l.status, l.caminho, l.dominio, vazioNulo(l.msg)), ext, (l) => chave(l.app, l.etipo, l.status, l.caminho, l.dominio, vazioNulo(l.msg)),
    (l) => ({ app: l.app ?? null, tipo: l.etipo ?? null, status: l.status ?? null, caminho: l.caminho ?? null, dominio: l.dominio ?? null, msg: vazioNulo(l.msg), n: 0, paginas: [], ultimo: null }),
    (a, l) => {
      a.n = num(a.n) + num(l.n);
      a.paginas = [...new Set([...(Array.isArray(a.paginas) ? a.paginas : []), ...(l.pagina != null ? [String(l.pagina)] : [])])];
      a.ultimo = maisRecente(a.ultimo, l.ultimo); ((a._ext ??= []) as Linhas).push(l);
    });
  for (const a of r) a.sessoes = 0;
  return fecharExemplos(r.sort(porNDesc("n")).slice(0, 300));
}
/** ERR-02: os erros de uma página (o nome como o painel mostra), com as chamadas que falharam e os exemplos; até 100. */
export function juntarErrosPagina(ls: Linhas, tr: Linhas, app: string, view: string | string[], robos: boolean): Linhas {
  const paginas = new Set(Array.isArray(view) ? view : [view]);
  const ext = doGrupo(tr, "errx").filter((l) => l.app === app && paginas.has(String(l.pagina ?? "")) && semRobo(robos, l));
  const terceiro = (l: Linha) => l.provedor === "third_party" && !String(l.app ?? "").includes("-");
  const r = somarPor(ls, (l) => chave(l.tipo, vazioNulo(l.msg), l.status, l.caminho, l.dominio, l.excecao_tipo, l.terceiro === true || l.terceiro === "true"), ext,
    (l) => chave(l.etipo, vazioNulo(l.msg), l.status, l.caminho, l.dominio, l.excecao, terceiro(l)),
    (l) => ({ tipo: l.etipo ?? null, msg: vazioNulo(l.msg), status: l.status ?? null, caminho: l.caminho ?? null, dominio: l.dominio ?? null, excecao_tipo: l.excecao ?? null, terceiro: terceiro(l), n: 0, ultimo: null }),
    (a, l) => { a.n = num(a.n) + num(l.n); a.ultimo = maisRecente(a.ultimo, l.ultimo); ((a._ext ??= []) as Linhas).push(l); });
  for (const a of r) if (!a.nome) a.nome = a.msg ? a.msg : `${a.status ?? "?"}: ${a.dominio ?? ""}${a.caminho ?? ""}`;
  return fecharExemplos(r.sort(porNDesc("n")).slice(0, 100));
}
/** A cabeça e a cauda na série de erros (as fatias não as têm): a cabeça no início do período, a cauda no fim das fatias. */
export function serieDoTrecho(tr: Linhas, t: Trecho, app: string, robos: boolean): { app: string; view: string | null; t: string; n: number }[] {
  const out = new Map<string, { app: string; view: string | null; t: string; n: number }>();
  for (const l of doGrupo(tr, "erro").filter((x) => proprio(x) && daApp(app, x) && semRobo(robos, x))) {
    const quando = new Date(l.parte === "cabeca" ? t.ini : t.fimFatias).toISOString(), k = chave(l.app, l.pagina, quando);
    const a = out.get(k) ?? { app: String(l.app ?? ""), view: l.pagina == null ? null : String(l.pagina), t: quando, n: 0 };
    a.n += num(l.n); out.set(k, a);
  }
  return [...out.values()].filter((x) => x.n > 0);
}

/* ---- Painel da página no período escolhido (1.43.6): cliques e tempo de carga ao vivo ------------------------------ */
/** PAG-01: cliques e teclas da página por elemento, os 25 mais usados. */
export function juntarCliques(ls: Linhas, tr: Linhas, app: string, view: string, robos: boolean): Linhas {
  const ext = doGrupo(tr, "clique").filter((l) => l.app === app && l.pagina === view && semRobo(robos, l));
  return somarPor(ls, (l) => chave(l.tipo, l.elemento, l.tag), ext, (l) => chave(l.itipo, l.elemento, l.tag),
    (l) => ({ tipo: l.itipo ?? null, elemento: l.elemento ?? null, tag: l.tag ?? null, n: 0, sessoes: 0 }),
    (a, l) => { a.n = num(a.n) + num(l.n); }).sort(porNDesc("n")).slice(0, 25);
}
/** PAG-05: tempo de carga da página no período: quantidade, média e p75 (pelas faixas). */
export function juntarCarga(ls: Linhas, tr: Linhas, app: string, view: string, robos: boolean): { n: number; mediaMs: number | null; p75Ms: number | null } {
  const f = Array.from({ length: N_FAIXAS }, () => 0);
  let n = 0, soma = 0;
  const somar = (l: Linha) => { const k = num(l.n); n += k; soma += num(l.soma); const i = Number(l.ft); if (Number.isInteger(i) && i >= 0 && i < N_FAIXAS) f[i] += k; };
  for (const l of ls) somar(l);
  for (const l of doGrupo(tr, "tcar")) if (l.app === app && l.pagina === view && semRobo(robos, l)) somar(l);
  return { n, mediaMs: n > 0 ? soma / n : null, p75Ms: percentilDasFaixas(f) };
}
