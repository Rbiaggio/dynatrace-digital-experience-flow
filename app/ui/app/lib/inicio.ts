/* Visão geral (tela inicial): os indicadores da aplicação em linguagem simples. Responde, nesta ordem: quantos
   clientes, quanto navegam, quantos tiveram erro, onde param e por quê, que erros sentiram, o que mais e menos usam e
   que caminhos fazem. Monta a partir das linhas da cópia enxuta (qInicio* em queries.ts); o "o que melhorar" vem do
   grafo (destaques.ts e qualidade.ts). Sem consulta aqui e sem import de valor (os scripts em Node usam o mesmo arquivo).
   O modelo guarda só DADOS (vai para o cache); os textos saem na hora de desenhar (textoMotivo, tituloErro...), no
   idioma escolhido. Cada erro fica uma vez só, em erros; saídas e problemas guardam a chave dele (ErroCliente.chave),
   sem cópia, para o modelo caber no cache (problemasComErros devolve os problemas com os erros completos). */
import type { LinhaLugar } from "./lugares";
import type { ExemploErro } from "./agregados";
/** Os 3 exemplos mais recentes de duas listas (sem repetir trace e sessão). */
const juntarExemplos = (a: ExemploErro[], b: ExemploErro[]) => { const vistos = new Set<string>(); return [...a, ...b].filter((x) => !vistos.has(`${x.t}|${x.s}`) && vistos.add(`${x.t}|${x.s}`)).sort((x, y) => (y.h ?? "").localeCompare(x.h ?? "")).slice(0, 3); };
// mesmas regras de destaques.ts (cópia local: só tipos importados, para os scripts em Node rodarem)
const NOME_ERRO = /erro|falha|fail/i;
const NOME_FIM = /sair|logout|logoff|fimsessao|fim-sessao|session.?expired|sessao.?expirada|encerr|comprovante|sucesso|success|exit/i;
// idioma da interface (lib/i18n.ts): cópia local, porque os scripts em Node usam este arquivo sem import de valor
const t = (pt: string, en: string) => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? en : pt);
const loc = () => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "en-US" : "pt-BR");

export interface LinhaFim { app: string; fim: string | null; fins: number; finsErro: number; uma: number; comErro: number; navs: number }
export interface LinhaPaginaInicio { app: string; view: string | null; visitas: number; erros: number; sessoes: number; sessoesErro: number; mediaMs: number | null; p75Ms: number | null }
export interface LinhaCaminho { app: string; caminho: string; n: number; fimErro: number; erros: string[] }   // erros: páginas com erro, uma entrada por sessão
export interface LinhaErroInicio { app: string; tipo: string; status: string | null; caminho: string | null; dominio: string | null; msg: string | null; n: number; sessoes: number; paginas: string[];
  /** 1.43: até 3 traces e 3 sessões de exemplo e o último instante (lista de erros ao vivo, agregados errx) */
  amostrasTrace?: string[]; amostrasSessao?: string[]; ultimo?: string | null; exemplos?: ExemploErro[] }
export interface LinhaSerie { app: string; view: string | null; t: string; n: number }
/** lugares: linhas "lugar" de qInicioPaginas (a mesma varredura das páginas), cruas; o mapa sai de lib/lugares.ts
    (montarMapa) na hora de desenhar. */
export interface LinhasInicio { fins: LinhaFim[]; paginas: LinhaPaginaInicio[]; caminhos: LinhaCaminho[]; erros: LinhaErroInicio[]; serie?: LinhaSerie[]; lugares?: LinhaLugar[] }

export interface ResumoApp { app: string; sessoes: number; navs: number; paginasPorSessao: number; pctUmaPagina: number; pctComErro: number; pctSaiuComErro: number; saiuComErro: number; comErro: number }
export type TipoErroCliente = "servidor" | "tela" | "crash" | "outro";
export interface ErroCliente { chave: string; app: string; tipo: TipoErroCliente; status: string | null; caminho: string | null; dominio: string | null; msg: string; n: number; sessoes: number; pctSessoes: number; paginas: string[];
  amostrasTrace?: string[]; amostrasSessao?: string[]; ultimo?: string | null; exemplos?: ExemploErro[] }
export type TipoMotivo = "erro" | "pagina-erro" | "lenta" | "nenhum";
/** erro: chave (em Inicio.erros) do erro principal da página, quando o motivo é "erro". */
export interface Saida { app: string; view: string; fins: number; visitas: number; pctSaida: number; pctSessoes: number; motivo: TipoMotivo; pctErro: number; erro: string | null; p75Ms: number | null }
export interface PaginaInicio { app: string; view: string; visitas: number; erros: number; sessoes: number; pctVisitas: number; p75Ms: number | null }
/** Fluxo frequente como FUNIL: n = sessões que fizeram o fluxo inteiro; por etapa, contando todas as sessões que
    chegaram até ela pelo mesmo caminho (mesmo que depois tenham ido para outro lado): quantas chegaram, quantas tiveram
    erro na página da etapa, quantas encerraram ali e quantas encerraram ali depois do erro. */
export interface Caminho { app: string; passos: string[]; continua: boolean; n: number; pct: number; chegaram: number[]; comErro: number[]; sairam: number[]; sairamAposErro: number[];
  /** dos que tiveram erro na etapa: quantos seguiram mesmo assim para a próxima etapa do fluxo */
  comErroSeguiram: number[];
  /** dos que tiveram erro e NÃO seguiram direto: quantos chegaram à próxima etapa mais adiante na mesma sessão (tentaram de novo) */
  comErroDepois: number[];
  /** dos que tiveram erro e NÃO seguiram: para onde foram (até 3 páginas) */
  destinosErro: { pagina: string; n: number }[][];
  /** entre a etapa i e a i+1, quem não seguiu: foi para outra página (foram, com as páginas em destinos) ou encerrou a
      sessão ali (sairam, sairamAposErro). chegaram[i] = chegaram[i+1] + foram[i] + sairam[i]. */
  foram: number[];
  destinos: { pagina: string; n: number }[][];
}
/** Problema que afeta o cliente, por página com erro: quantos clientes, que fatia de quem usou a página, quantos
    desistiram logo depois do erro, os erros (o principal primeiro) e onde fica no fluxo mais usado que passa por ela. */
export interface ProblemaPagina {
  app: string; view: string; afetados: number; visitantes: number; pctAfetados: number; desistiram: number; erros: ErroCliente[];
  fluxo: { indice: number; etapa: number; chegaram: number; seguiram: number | null; proxima: string | null; naoConcluiram: number } | null;
}
/** O problema como fica no modelo (e no cache): os erros pela chave em Inicio.erros, o principal primeiro. */
export interface ProblemaGuardado extends Omit<ProblemaPagina, "erros"> { erros: string[] }
/** Erros ao longo do período por página ("app|view" → um valor por faixa de tempo, da mais antiga à mais recente). */
export type SeriesErros = Record<string, number[]>;
export interface Inicio { total: ResumoApp; porApp: ResumoApp[]; saidas: Saida[]; finsNaturais: number; erros: ErroCliente[]; problemas: ProblemaGuardado[]; maisVisitadas: PaginaInicio[]; outrasVisitas: number; totalVisitas: number; menosVisitadas: PaginaInicio[]; caminhos: Caminho[]; series: SeriesErros;
  /** onde estão as sessões e os erros (país e, no Brasil, estado): linhas cruas para o mapa (lib/lugares.ts) */
  lugares: LinhaLugar[];
  /** quando os dados foram lidos (ms): numa janela relativa, o período dos números é [geradoEm - janela, geradoEm] */
  geradoEm: number;
  /** 1.43: de quando é cada bloco (sem isto, tudo é do período escolhido, como antes) */
  periodos?: PeriodosInicio;
  /** 1.44.6, escopo padrão: sessões das 24 h analisadas (total e porApp são da última hora); a base das contas com dado de 24 h */
  total24?: ResumoApp; porApp24?: ResumoApp[];
  /** 1.43.6: as sessões com erro mais recentes da última hora (a lista dos indicadores, sem leitura a mais) */
  sessoesHora?: Record<string, unknown>[] }
/** Bases de tempo da Visão geral (1.43): indicadores de sessão, aplicações e mapa = última hora; onde as sessões terminam,
    caminhos e páginas = as 24 horas analisadas; erros, série e Apdex = o período escolhido, ao vivo. */
export interface PeriodosInicio { ultimaHora: { de: number; ate: number } | null; dia: { de: number; ate: number; horas: number } | null }

/** Carga lenta: p75 a partir de 3 s (referência de "carregamento bom" do RUM é até ~2,5 s). */
export const CARGA_LENTA_MS = 3000;
/** Página sem nome (view.name vazio). */
export const SEM_NOME = "(no name)";
const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);
const seg = (ms: number) => `${(ms / 1000).toLocaleString(loc(), { maximumFractionDigits: ms < 10000 ? 1 : 0 })} s`;
const corte = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function resumir(app: string, fins: LinhaFim[]): ResumoApp {
  const s = fins.reduce((acc, l) => ({ sessoes: acc.sessoes + l.fins, navs: acc.navs + l.navs, uma: acc.uma + l.uma, comErro: acc.comErro + l.comErro, saiu: acc.saiu + l.finsErro }), { sessoes: 0, navs: 0, uma: 0, comErro: 0, saiu: 0 });
  return { app, sessoes: s.sessoes, navs: s.navs, paginasPorSessao: s.sessoes ? s.navs / s.sessoes : 0, pctUmaPagina: pct(s.uma, s.sessoes), pctComErro: pct(s.comErro, s.sessoes),
           pctSaiuComErro: pct(s.saiu, s.sessoes), saiuComErro: s.saiu, comErro: s.comErro };
}

/** Erro como o cliente sentiu: a chamada ao servidor falhou, a tela deu erro, o app fechou. */
const tipoErro = (tipo: string): TipoErroCliente => (tipo === "request" ? "servidor" : tipo === "crash" ? "crash" : tipo === "exception" ? "tela" : "outro");

// ---- textos (na hora de desenhar, no idioma escolhido) ----------------------------------------------------------
export function tituloErro(e: ErroCliente): string {
  if (e.tipo === "servidor") return t(`Chamada ao servidor falhou${e.status ? ` (HTTP ${e.status})` : ""}`, `Server call failed${e.status ? ` (HTTP ${e.status})` : ""}`);
  if (e.tipo === "crash") return t("O app fechou (crash)", "The app closed (crash)");
  if (e.tipo === "tela") return t("Erro na tela", "Error on the screen");
  return t("Erro", "Error");
}
export function detalheErro(e: ErroCliente): string {
  if (e.tipo === "servidor") return `${e.caminho ?? "?"}${e.dominio ? t(` em ${e.dominio}`, ` on ${e.dominio}`) : ""}`;
  return e.msg || e.caminho || t("sem mensagem", "no message");
}
/** Resumo de uma linha do erro, para explicar a saída de uma página. */
export function curtoErro(e: ErroCliente): string {
  if (e.tipo === "servidor") return t(`HTTP ${e.status ?? "erro"} em ${e.caminho ?? "?"}`, `HTTP ${e.status ?? "error"} on ${e.caminho ?? "?"}`);
  if (e.tipo === "crash") return t("o app fechou (crash)", "the app closed (crash)");
  return e.msg ? `"${corte(e.msg)}"` : t("erro na tela", "error on the screen");
}
/** Resumo de um erro cru da cópia (tipo, status, caminho, mensagem): para a lista de sessões. */
export const erroCurtoDe = (tipo: string | null, status: string | null, caminho: string | null, msg: string | null) =>
  curtoErro({ chave: "", app: "", tipo: tipoErro(tipo ?? ""), status, caminho, dominio: null, msg: (msg ?? "").trim(), n: 0, sessoes: 0, pctSessoes: 0, paginas: [] });
/** Erros do modelo pela chave (para ler Saida.erro e ProblemaGuardado.erros). */
export const errosPorChave = (erros: ErroCliente[]): Map<string, ErroCliente> => new Map(erros.map((e) => [e.chave, e]));
/** O erro pela chave. Entrada do cache gravada pela versão anterior traz a cópia do erro no lugar da chave: vale ela. */
const resolverErro = (x: string | ErroCliente | null | undefined, porChave: Map<string, ErroCliente>): ErroCliente | null =>
  x == null ? null : typeof x === "string" ? porChave.get(x) ?? null : x;
/** Os problemas do modelo com os erros completos (o principal primeiro), para desenhar e para o Dynatrace Assist. */
export function problemasComErros(d: Pick<Inicio, "problemas" | "erros">): ProblemaPagina[] {
  const porChave = errosPorChave(d.erros);
  return d.problemas.map((p) => ({ ...p, erros: (p.erros as (string | ErroCliente)[]).map((x) => resolverErro(x, porChave)).filter((e): e is ErroCliente => !!e) }));
}
/** Por que os clientes saem desta página (motivo provável, quando o dado mostra). */
export function textoMotivo(s: Saida, porChave: Map<string, ErroCliente>): string {
  const erro = resolverErro(s.erro, porChave);
  if (s.motivo === "erro") { const p = Math.round(s.pctErro); return erro ? t(`${p}% tiveram erro aqui: ${curtoErro(erro)}`, `${p}% had an error here: ${curtoErro(erro)}`) : t(`${p}% tiveram erro aqui`, `${p}% had an error here`); }
  if (s.motivo === "pagina-erro") return t("É uma página de erro", "This is an error page");
  if (s.motivo === "lenta" && s.p75Ms != null) return t(`Carga lenta: ${seg(s.p75Ms)} (p75)`, `Slow to load: ${seg(s.p75Ms)} (p75)`);
  return t("Nenhum erro ou carga lenta registrados aqui", "No error or slow load recorded here");
}

/** Repetição seguida da mesma tela (recarga) sai do caminho; mostra até `max` passos. */
export function limparCaminho(texto: string, separador: string, max = 6): { passos: string[]; continua: boolean } {
  const todos = texto.split(separador).filter((p, i, a) => i === 0 || p !== a[i - 1]);
  return { passos: todos.slice(0, max), continua: todos.length > max };
}

/** Faixas da janela relativa ("2h" → 24 faixas de 5 min); fora disso, as faixas vêm do próprio dado. */
const MIN = { s: 1 / 60, m: 1, h: 60, d: 1440 } as Record<string, number>;
const INTERVALO_MIN: Record<string, number> = { "10m": 1, "30m": 1, "60m": 5, "24h": 60, "7d": 360 };
export function montarSeries(linhas: LinhaSerie[], janela: string, agora = Date.now()): SeriesErros {
  const m = /^(\d+)([smhd])$/.exec(janela);
  const passoMin = INTERVALO_MIN[janela] ?? 5;
  const ts = linhas.map((x) => new Date(x.t).getTime()).filter((x) => !isNaN(x));
  const fim = m ? agora : Math.max(...ts, 0), ini = m ? agora - +m[1] * MIN[m[2]] * 60000 : Math.min(...ts, fim);
  const passo = passoMin * 60000, faixas = Math.max(2, Math.ceil((fim - ini) / passo));
  const out: SeriesErros = {};
  for (const x of linhas) {
    if (!x.view) continue;
    const i = Math.floor((new Date(x.t).getTime() - ini) / passo);
    if (isNaN(i) || i < 0 || i >= faixas) continue;
    const k = `${x.app}|${x.view}`;
    (out[k] ??= new Array(faixas).fill(0))[i] += x.n;
  }
  return out;
}

export function montarInicio(entrada: LinhasInicio, separador: string, janela = "2h", agora = Date.now()): Inicio {
  // qInicioPaginas também traz as linhas do mapa (tipo "lugar", app "*"): quem chamar sem separar não as conta como página
  const l = { ...entrada, paginas: entrada.paginas.filter((p) => p.app !== "*") };
  const apps = [...new Set([...l.fins.map((x) => x.app), ...l.paginas.map((x) => x.app)])];
  const porApp = apps.map((a) => resumir(a, l.fins.filter((x) => x.app === a))).sort((x, y) => y.sessoes - x.sessoes);
  const total = resumir("*", l.fins);
  const sessoesApp = new Map(porApp.map((r) => [r.app, r.sessoes]));
  const visitasDe = new Map(l.paginas.map((p) => [`${p.app}|${p.view ?? SEM_NOME}`, p]));

  // erros como o cliente sentiu: servidor por status + caminho + domínio; tela e crash pela mensagem
  const errosMap = new Map<string, ErroCliente>();
  for (const x of l.erros) {
    const tipo = tipoErro(x.tipo), msg = (x.msg ?? "").trim();
    const chave = tipo === "servidor" ? `${x.app}|${tipo}|${x.status}|${x.caminho}|${x.dominio}` : `${x.app}|${tipo}|${msg}`;
    const atual = errosMap.get(chave);
    const juntar3 = (a?: string[], b?: string[]) => [...new Set([...(a ?? []), ...(b ?? [])])].slice(0, 3);
    if (atual) {
      atual.n += x.n; atual.sessoes += x.sessoes; atual.paginas = [...new Set([...atual.paginas, ...x.paginas])];
      atual.amostrasTrace = juntar3(atual.amostrasTrace, x.amostrasTrace); atual.amostrasSessao = juntar3(atual.amostrasSessao, x.amostrasSessao);
      atual.exemplos = juntarExemplos(atual.exemplos ?? [], x.exemplos ?? []);
      if (x.ultimo && (!atual.ultimo || x.ultimo > atual.ultimo)) atual.ultimo = x.ultimo;
    }
    else errosMap.set(chave, { chave, app: x.app, tipo, status: x.status, caminho: x.caminho, dominio: x.dominio, msg, n: x.n, sessoes: x.sessoes, pctSessoes: 0, paginas: x.paginas.filter(Boolean),
                               amostrasTrace: x.amostrasTrace ?? [], amostrasSessao: x.amostrasSessao ?? [], ultimo: x.ultimo ?? null, exemplos: x.exemplos ?? [] });
  }
  const erros = [...errosMap.values()].map((e) => ({ ...e, pctSessoes: pct(e.sessoes, sessoesApp.get(e.app) ?? total.sessoes) })).sort((a, b) => b.sessoes - a.sessoes || b.n - a.n);
  // erro principal de cada página (para explicar a saída), pela chave
  const erroDaPagina = (app: string, view: string) => erros.find((e) => e.app === app && e.paginas.includes(view))?.chave ?? null;

  // onde param: última página das sessões; fim natural (comprovante, sair...) não é abandono
  let finsNaturais = 0;
  const saidas: Saida[] = [];
  for (const f of l.fins) {
    const view = f.fim ?? SEM_NOME;
    if (f.fim && NOME_FIM.test(f.fim)) { finsNaturais += f.fins; continue; }
    const p = visitasDe.get(`${f.app}|${view}`);
    const visitas = Math.max(p?.visitas ?? 0, f.fins);
    const pctErro = pct(f.finsErro, f.fins);
    const p75Ms = p?.p75Ms ?? null;
    const motivo: TipoMotivo = pctErro >= 20 ? "erro" : f.fim && NOME_ERRO.test(f.fim) ? "pagina-erro" : p75Ms != null && p75Ms >= CARGA_LENTA_MS ? "lenta" : "nenhum";
    saidas.push({ app: f.app, view, fins: f.fins, visitas, pctSaida: pct(f.fins, visitas), pctSessoes: pct(f.fins, sessoesApp.get(f.app) ?? total.sessoes),
                  motivo, pctErro, erro: motivo === "erro" ? erroDaPagina(f.app, view) : null, p75Ms });
  }
  saidas.sort((a, b) => b.fins - a.fins);

  // mais e menos visitadas (fatia de TODAS as visitas do escopo; página sem nome fica de fora do ranking)
  const totalVisitas = l.paginas.reduce((soma, p) => soma + p.visitas, 0);
  const paginas: PaginaInicio[] = l.paginas.filter((p) => p.view && p.visitas > 0).map((p) => ({ app: p.app, view: p.view!, visitas: p.visitas, erros: p.erros, sessoes: p.sessoes, pctVisitas: pct(p.visitas, totalVisitas), p75Ms: p.p75Ms }))
    .sort((a, b) => b.visitas - a.visitas);
  const maisVisitadas = paginas.slice(0, 6);
  const outrasVisitas = Math.max(0, totalVisitas - maisVisitadas.reduce((soma, p) => soma + p.visitas, 0));
  const menosVisitadas = paginas.length > 8 ? paginas.slice(-5).reverse() : [];

  // fluxos: sem recarga seguida da mesma tela; os 5 caminhos completos mais feitos (até 6 etapas na tela) e, para cada
  // etapa, o funil de quem chegou até ela pelo mesmo caminho (prefixo), com erro e saída naquela etapa
  const rotas = l.caminhos.map((c) => {
    const { passos } = limparCaminho(c.caminho, separador, 12);
    const erroPorPagina = new Map<string, number>();
    for (const v of c.erros) if (v) erroPorPagina.set(v, (erroPorPagina.get(v) ?? 0) + 1);
    return { app: c.app, passos, n: c.n, fimErro: c.fimErro, erroPorPagina };
  });
  const completos = new Map<string, { app: string; passos: string[]; continua: boolean; n: number }>();
  for (const r of rotas) {
    const passos = r.passos.slice(0, 6), continua = r.passos.length > 6;
    const chave = `${r.app}|${passos.join("\u0001")}|${continua ? 1 : 0}`;
    const atual = completos.get(chave);
    if (atual) atual.n += r.n; else completos.set(chave, { app: r.app, passos, continua, n: r.n });
  }
  const comPrefixo = (r: { app: string; passos: string[] }, app: string, prefixo: string[]) => r.app === app && prefixo.every((p, i) => r.passos[i] === p);
  const caminhos: Caminho[] = [...completos.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((f) => {
    const foram: number[] = [], destinos: { pagina: string; n: number }[][] = [];
    const chegaram: number[] = [], comErro: number[] = [], sairam: number[] = [], sairamAposErro: number[] = [], comErroSeguiram: number[] = [], comErroDepois: number[] = [], destinosErro: { pagina: string; n: number }[][] = [];
    f.passos.forEach((pagina, i) => {
      const daqui = rotas.filter((r) => comPrefixo(r, f.app, f.passos.slice(0, i + 1)));
      const acabaram = daqui.filter((r) => r.passos.length === i + 1);
      chegaram.push(daqui.reduce((soma, r) => soma + r.n, 0));
      comErro.push(daqui.reduce((soma, r) => soma + (r.erroPorPagina.get(pagina) ?? 0), 0));
      sairam.push(acabaram.reduce((soma, r) => soma + r.n, 0));
      sairamAposErro.push(acabaram.reduce((soma, r) => soma + r.fimErro, 0));
      // quem teve erro aqui: seguiu mesmo assim para a próxima etapa do fluxo, ou foi para onde?
      let seguiram = 0, depois = 0;
      const destino = new Map<string, number>();
      for (const r of daqui) {
        const e = r.erroPorPagina.get(pagina) ?? 0;
        if (!e) continue;
        if (i + 1 < f.passos.length && r.passos[i + 1] === f.passos[i + 1]) seguiram += e;
        else if (r.passos.length > i + 1) {
          destino.set(r.passos[i + 1], (destino.get(r.passos[i + 1]) ?? 0) + e);
          if (i + 1 < f.passos.length && r.passos.slice(i + 2).includes(f.passos[i + 1])) depois += e;
        }
      }
      comErroSeguiram.push(seguiram);
      comErroDepois.push(depois);
      // quem chegou aqui e foi para outra página (saiu deste caminho), e para quais
      const outras = new Map<string, number>();
      let desviaram = 0;
      if (i + 1 < f.passos.length) for (const r of daqui) {
        if (r.passos.length > i + 1 && r.passos[i + 1] !== f.passos[i + 1]) { desviaram += r.n; outras.set(r.passos[i + 1], (outras.get(r.passos[i + 1]) ?? 0) + r.n); }
      }
      foram.push(desviaram);
      destinos.push([...outras].map(([d, n]) => ({ pagina: d, n })).sort((a, b) => b.n - a.n).slice(0, 3));
      destinosErro.push([...destino].map(([d, n]) => ({ pagina: d, n })).sort((a, b) => b.n - a.n).slice(0, 3));
    });
    return { ...f, pct: pct(f.n, sessoesApp.get(f.app) ?? total.sessoes), chegaram, comErro, sairam, sairamAposErro, comErroSeguiram, comErroDepois, destinosErro, foram, destinos };
  });

  // problemas por página com erro: impacto no cliente (afetados, fatia de quem usou, desistências) e onde fica no fluxo
  const desistencias = new Map(l.fins.map((f) => [`${f.app}|${f.fim ?? SEM_NOME}`, f.finsErro]));
  const problemas: ProblemaGuardado[] = l.paginas.filter((p) => p.view && p.sessoesErro > 0).map((p) => {
    const view = p.view!;
    const visitantes = Math.max(p.sessoes, p.sessoesErro);
    const i = caminhos.findIndex((c) => c.app === p.app && c.passos.includes(view));
    const etapa = i >= 0 ? caminhos[i].passos.indexOf(view) : -1;
    return { app: p.app, view, afetados: p.sessoesErro, visitantes, pctAfetados: pct(p.sessoesErro, visitantes), desistiram: desistencias.get(`${p.app}|${view}`) ?? 0,
             erros: erros.filter((e) => e.app === p.app && e.paginas.includes(view)).map((e) => e.chave),
             fluxo: i >= 0 ? {
               indice: i, etapa, chegaram: caminhos[i].chegaram[etapa],
               seguiram: etapa + 1 < caminhos[i].passos.length ? caminhos[i].chegaram[etapa + 1] : null,
               proxima: etapa + 1 < caminhos[i].passos.length ? caminhos[i].passos[etapa + 1] : null,
               // tiveram erro aqui e não chegaram à próxima etapa do fluxo (nem direto, nem depois): o que se perde
               naoConcluiram: etapa + 1 < caminhos[i].passos.length ? Math.max(0, caminhos[i].comErro[etapa] - caminhos[i].comErroSeguiram[etapa] - caminhos[i].comErroDepois[etapa]) : 0,
             } : null };
  // ordem pelo que se perde: quem desistiu ou não concluiu por causa do erro; depois, quantos foram afetados
  }).sort((a, b) => Math.max(b.desistiram, b.fluxo?.naoConcluiram ?? 0) - Math.max(a.desistiram, a.fluxo?.naoConcluiram ?? 0) || b.afetados - a.afetados);

  return { total, porApp, saidas, finsNaturais, erros, problemas, maisVisitadas, outrasVisitas, totalVisitas, menosVisitadas, caminhos, series: montarSeries(l.serie ?? [], janela, agora), lugares: l.lugares ?? [], geradoEm: agora };
}

// ---- textos do problema (na hora de desenhar): o que acontece, o impacto no fluxo, o que fazer e quem faz ----------
/** O que o cliente vive na página, a partir do erro principal. */
export function oQueAcontece(p: ProblemaPagina): string {
  const e = p.erros[0];
  const outros = p.erros.length - 1;
  const mais = outros > 0 ? (outros === 1 ? t(" Há mais 1 tipo de erro nesta página.", " There is 1 more error type on this page.") : t(` Há mais ${outros} tipos de erro nesta página.`, ` There are ${outros} more error types on this page.`)) : "";
  if (!e) return t(`Os clientes encontram erro em ${p.view}.`, `Customers hit an error on ${p.view}.`);
  if (e.tipo === "servidor") return t(`Quando o cliente está em ${p.view}, a chamada ${e.caminho ?? "?"} ao servidor responde com erro (HTTP ${e.status ?? "?"}) e o que ele estava fazendo não é concluído.${mais}`,
                                      `When the customer is on ${p.view}, the server call ${e.caminho ?? "?"} answers with an error (HTTP ${e.status ?? "?"}) and what they were doing is not completed.${mais}`);
  if (e.tipo === "crash") return t(`Em ${p.view}, o app fecha sozinho (crash)${e.msg ? `: "${corte(e.msg, 90)}"` : ""}.${mais}`, `On ${p.view}, the app closes by itself (crash)${e.msg ? `: "${corte(e.msg, 90)}"` : ""}.${mais}`);
  return t(`Em ${p.view}, a tela mostra um erro${e.msg ? `: "${corte(e.msg, 90)}"` : ""}.${mais}`, `On ${p.view}, the screen shows an error${e.msg ? `: "${corte(e.msg, 90)}"` : ""}.${mais}`);
}
/** O que aconteceu com quem teve erro na etapa i do fluxo: seguiu mesmo assim, foi para outra página ou encerrou ali. */
export function depoisDoErro(c: Caminho, i: number): string {
  const comErro = c.comErro[i] ?? 0;
  if (!comErro) return "";
  const prox = i + 1 < c.passos.length ? c.passos[i + 1] : null;
  const seguiram = c.comErroSeguiram[i] ?? 0, encerraram = c.sairamAposErro[i] ?? 0, depois = c.comErroDepois[i] ?? 0;
  const nome = (v: string) => (v === SEM_NOME ? "(?)" : v);
  const destinos = (c.destinosErro[i] ?? []).map((d) => `${nome(d.pagina)} (${d.n.toLocaleString(loc())})`).join(", ");
  const partes: string[] = [];
  if (prox) {
    if (seguiram === comErro) partes.push(t(`todos seguiram mesmo assim para ${nome(prox)} (o erro não os impediu)`, `all of them still went on to ${nome(prox)} (the error did not stop them)`));
    else if (seguiram === 0) partes.push(t(`nenhum seguiu direto para ${nome(prox)}`, `none went straight on to ${nome(prox)}`));
    else partes.push(t(`${seguiram.toLocaleString(loc())} seguiram mesmo assim para ${nome(prox)} e ${(comErro - seguiram).toLocaleString(loc())} não`, `${seguiram.toLocaleString(loc())} still went on to ${nome(prox)} and ${(comErro - seguiram).toLocaleString(loc())} did not`));
  }
  if (destinos) partes.push(t(`foram para ${destinos}`, `went to ${destinos}`));
  if (prox && seguiram < comErro) partes.push(depois > 0
    ? t(`${depois.toLocaleString(loc())} tentaram de novo e chegaram a ${nome(prox)} depois`, `${depois.toLocaleString(loc())} tried again and reached ${nome(prox)} later`)
    : t(`nenhum chegou a ${nome(prox)} depois`, `none reached ${nome(prox)} later`));
  if (encerraram) partes.push(t(`${encerraram.toLocaleString(loc())} encerraram a sessão ali`, `${encerraram.toLocaleString(loc())} ended the session there`));
  return partes.join("; ");
}

/** Impacto no fluxo mais usado que passa pela página: quantos chegaram, quantos tiveram erro e quantos seguiram. */
export function impactoNoFluxo(p: Pick<ProblemaPagina, "view" | "fluxo">, caminhos: Caminho[]): string | null {
  if (!p.fluxo) return null;
  const c = caminhos[p.fluxo.indice];
  if (!c) return null;
  const { etapa, chegaram, seguiram } = p.fluxo;
  const comErro = c.comErro[etapa] ?? 0, prox = seguiram != null ? c.passos[etapa + 1] : null;
  const depois = depoisDoErro(c, etapa);
  const segue = prox && seguiram != null ? t(` e ${seguiram.toLocaleString(loc())} (${Math.round(pct(seguiram, chegaram))}%) seguiram para ${prox}`, ` and ${seguiram.toLocaleString(loc())} (${Math.round(pct(seguiram, chegaram))}%) went on to ${prox}`) : "";
  // o caminho até a página (o índice do fluxo pode estar escondido atrás do "Mostrar mais")
  const nomes = c.passos.slice(0, etapa + 1).map((x) => (x === SEM_NOME ? "(?)" : x));
  const ate = (nomes.length > 4 ? [nomes[0], "…", ...nomes.slice(-2)] : nomes).join(" → ");
  const comQuem = depois ? ` (${depois})` : "";
  if (etapa === 0) return t(`${chegaram.toLocaleString(loc())} clientes começaram a sessão em ${p.view}: ${comErro.toLocaleString(loc())} tiveram erro${comQuem}${segue}.`,
                            `${chegaram.toLocaleString(loc())} customers started the session on ${p.view}: ${comErro.toLocaleString(loc())} had an error${comQuem}${segue}.`);
  return t(`Pelo caminho ${ate}, ${chegaram.toLocaleString(loc())} clientes chegaram em ${p.view}: ${comErro.toLocaleString(loc())} tiveram erro${comQuem}${segue}.`,
           `Through the path ${ate}, ${chegaram.toLocaleString(loc())} customers reached ${p.view}: ${comErro.toLocaleString(loc())} had an error${comQuem}${segue}.`);
}
export function oQueFazer(p: ProblemaPagina): string {
  const e = p.erros[0];
  if (e?.tipo === "servidor") return t(`Corrigir a chamada ${e.caminho ?? "?"} (HTTP ${e.status ?? "?"}). Comece pelos erros e por algumas sessões com Replay para achar o padrão (horário, versão do app, tipo de cliente).`,
                                       `Fix the call ${e.caminho ?? "?"} (HTTP ${e.status ?? "?"}). Start with the errors and a few sessions with Replay to find the pattern (time, app version, customer type).`);
  return t(`Corrigir o erro da tela ${p.view}. Comece pelos erros e por algumas sessões com Replay para ver o que o cliente fez antes do erro.`,
           `Fix the error on the ${p.view} screen. Start with the errors and a few sessions with Replay to see what the customer did before the error.`);
}
export function quemFaz(p: ProblemaPagina): string {
  const e = p.erros[0];
  if (e?.tipo === "servidor") return t(`time do serviço que responde ${e.caminho ?? "a chamada"}`, `team that owns the service behind ${e.caminho ?? "the call"}`);
  if (e?.tipo === "crash") return t("time do app", "app team");
  return t("time da tela (frontend ou app)", "screen team (frontend or app)");
}
