/* Evidências de um problema da visão geral, lidas no ambiente com consultas pequenas: onde a falha nasce no backend
   (traces das falhas mais recentes, só a janela em volta delas, no máximo 10 minutos), as exceções desses serviços, os
   problemas do Davis no período e as mudanças (deploy, configuração) nas últimas 24 h. Servem o "Onde falha no
   backend?" e a análise da IA (lib/assist.ts), que não consulta o ambiente sozinha. Cache compartilhado de 5 min
   (lib/compartilhado.ts): o "Onde falha" é o mesmo para os dois (a análise da IA reaproveita o que o botão leu e
   vice-versa) e cada evidência da IA fica guardada pelo texto da consulta. */
import { dql, num, texto, qFalhasComTrace, qSpansComFalha, qChamadasEntre, qExcecoesFalha, qProblemasDavis, qMudancas } from "./dql";
import { lerCompartilhado, chaveBloco, type Bloco } from "./compartilhado";

export interface Origem { servico: string; nome: string; traces: number; status: string[] }
export interface ResultadoOrigem {
  analisadas: number; origens: Origem[]; caminho: string[]; exemplo: { trace: string; t: string } | null; semTrace: boolean;
  /** o que a leitura usou: as outras evidências olham os mesmos traces e serviços */
  base?: { de: string; ate: string; traces: string[]; servicos: string[] };
}
export interface Evidencias {
  origem: ResultadoOrigem | null;
  excecoes: { servico: string; tipo: string; msg: string; n: number }[];
  problemas: { id: string; nome: string; estado: string; categoria: string; inicio: string; causa: string | null }[];
  mudancas: { t: string; tipo: string; nome: string; versao: string | null }[];
}

const JANELA_MAX_MS = 10 * 60000;

/** Em que serviço a falha nasce: por trace, o serviço com falha que não chama outro serviço com falha (gateway, ingress e
    proxies repassam o erro e também aparecem com falha). funcionalidade = quem pediu ("Onde falha no backend?" ou a
    análise da IA), para o dt-client-context das consultas. */
export async function lerOrigemBackend(app: string, view: string, janela: string, robos: boolean, funcionalidade: "ondefalha" | "ia" = "ondefalha"): Promise<ResultadoOrigem> {
  return (await lerOrigemBackendBloco(app, view, janela, robos, funcionalidade)).dados;
}
/** O mesmo, com quando a leitura começou e se veio de cache (rótulo "dados de hh:mm"). O texto da 1a consulta e a chave
    saem agora, com o filtro de segmento e a cópia de agora; as seguintes dependem só do que ela trouxe. */
export async function lerOrigemBackendBloco(app: string, view: string, janela: string, robos: boolean, funcionalidade: "ondefalha" | "ia" = "ondefalha"): Promise<Bloco<ResultadoOrigem>> {
  const q1 = qFalhasComTrace(app, view, janela, robos, 15);
  const chave = chaveBloco(app, view, janela, robos, 15);
  const b = await lerCompartilhado("ondefalha", chave, () => origemNoTenant(q1, funcionalidade),
    { aceitar: (x) => !!x && Array.isArray(x.origens) && Array.isArray(x.caminho) });
  if (b) { origensLidas.set(chave, { origem: b.dados, desde: b.desde }); for (const f of ouvintesOrigem) f(); }
  return b!;   // sem desistir: só null para quem desiste
}
/* "Onde falha no backend?" já lido nesta aba (pelo botão do cartão, pelo painel da página, pelas Oportunidades ou pela
   análise da IA): as Oportunidades de melhoria usam a origem (regra W4) sem consultar nada. Chave = a do bloco (aplicação,
   página, janela, robôs, cópia, frames, cliques e filtro de segmento): só vale para o escopo em que foi lido, e por 5 min
   (a validade do cache compartilhado). */
const origensLidas = new Map<string, { origem: ResultadoOrigem; desde: number }>();
const ouvintesOrigem = new Set<() => void>();
const VALIDADE_ORIGEM_MS = 5 * 60000;
/** A origem já lida desta página no escopo de agora (null = ninguém abriu "Onde falha" nela nos últimos 5 min). */
export function origemJaLida(app: string, view: string, janela: string, robos: boolean): ResultadoOrigem | null {
  const x = origensLidas.get(chaveBloco(app, view, janela, robos, 15));
  return x && Date.now() - x.desde <= VALIDADE_ORIGEM_MS ? x.origem : null;
}
/** Avisa quando uma origem nova é lida (a tela recalcula as oportunidades). Devolve o cancelamento. */
export function ouvirOrigens(f: () => void): () => void { ouvintesOrigem.add(f); return () => { ouvintesOrigem.delete(f); }; }
async function origemNoTenant(q1: string, funcionalidade: "ondefalha" | "ia"): Promise<ResultadoOrigem> {
  const falhas = await dql(q1, { contexto: `${funcionalidade}/OBK-01`, maxRecords: 15 });
  if (falhas.length === 0) return { analisadas: 0, origens: [], caminho: [], exemplo: null, semTrace: true };
  // só as falhas dos 10 minutos mais recentes: a leitura dos spans fica pequena
  const ult = new Date(texto(falhas[0].t) ?? "").getTime();
  const usar = falhas.filter((f) => ult - new Date(texto(f.t) ?? "").getTime() <= JANELA_MAX_MS);
  const ts = usar.map((f) => new Date(texto(f.t) ?? "").getTime());
  const de = new Date(Math.min(...ts) - 60000).toISOString(), ate = new Date(Math.max(...ts) + 60000).toISOString();
  const ids = usar.map((f) => texto(f.trace) ?? "").filter(Boolean);
  // spans amostrados 1/10 primeiro (custa ~1/10). A origem compara os spans com falha de cada trace: a amostra só vale com
  // pelo menos 3 traces (ou todos os pedidos, se forem menos) e 2 spans por trace em média; senão relê exata (no LAB, em
  // 20/10, a amostra trouxe 1 span por trace e a leitura exata com toUid custou 3,6 MB)
  const minimo = Math.min(3, ids.length);
  let spans = await dql(qSpansComFalha(ids, de, ate, 10), { contexto: `${funcionalidade}/OBK-02A`, maxRecords: 2000 });
  const tracesNaAmostra = new Set(spans.map((s) => texto(s.trace))).size;
  if (tracesNaAmostra < minimo || spans.length < 2 * tracesNaAmostra) spans = await dql(qSpansComFalha(ids, de, ate), { contexto: `${funcionalidade}/OBK-02`, maxRecords: 2000 });
  const servicos = [...new Set(spans.map((s) => texto(s.servico) ?? ""))].filter(Boolean);
  const chama = new Map<string, Set<string>>();
  if (servicos.length) for (const l of await dql(qChamadasEntre(servicos), { contexto: `${funcionalidade}/OBK-03`, maxRecords: 500 })) chama.set(texto(l.id) ?? "", new Set((Array.isArray(l.chama) ? l.chama : []).map(String)));
  const nomes = new Map(spans.map((s) => [texto(s.servico) ?? "", texto(s.nome) ?? texto(s.servico) ?? ""]));
  const porTrace = new Map<string, Map<string, string | null>>();
  for (const s of spans) { const tr = texto(s.trace) ?? "", sv = texto(s.servico) ?? ""; if (!porTrace.has(tr)) porTrace.set(tr, new Map()); porTrace.get(tr)!.set(sv, texto(s.status)); }
  const origens = new Map<string, Origem>();
  for (const [, falhos] of porTrace) {
    const lista = [...falhos.keys()];
    const raiz = lista.filter((sv) => !lista.some((outro) => outro !== sv && chama.get(sv)?.has(outro)));
    for (const sv of raiz.length ? raiz : lista.slice(-1)) {
      const o = origens.get(sv) ?? { servico: sv, nome: nomes.get(sv) ?? sv, traces: 0, status: [] };
      o.traces += 1; const st = falhos.get(sv); if (st && !o.status.includes(st)) o.status.push(st);
      origens.set(sv, o);
    }
  }
  // caminho: dos serviços com falha, do que ninguém chama (porta de entrada) até a origem principal
  const principal = [...origens.values()].sort((a, b) => b.traces - a.traces)[0];
  const caminho: string[] = [];
  if (principal) {
    let atual = servicos.find((sv) => !servicos.some((x) => x !== sv && chama.get(x)?.has(sv))) ?? principal.servico;
    const vistos = new Set<string>();
    while (atual && !vistos.has(atual)) {
      vistos.add(atual); caminho.push(nomes.get(atual) ?? atual);
      if (atual === principal.servico) break;
      atual = [...(chama.get(atual) ?? [])].find((x) => servicos.includes(x) && !vistos.has(x)) ?? "";
    }
  }
  return {
    analisadas: porTrace.size || ids.length, origens: [...origens.values()].sort((a, b) => b.traces - a.traces), caminho,
    exemplo: ids[0] ? { trace: ids[0], t: texto(usar[0].t) ?? "" } : null, semTrace: false, base: { de, ate, traces: ids, servicos },
  };
}

/** Tudo o que a IA precisa saber do ambiente. Cada parte que falhar fica vazia (a análise segue com o resto). */
export async function lerEvidencias(app: string, view: string, janela: string, robos: boolean, entidadeApp: string | null, periodo: { de: string; ate: string }, servidor: boolean): Promise<Evidencias> {
  const origem = servidor ? await lerOrigemBackend(app, view, janela, robos, "ia").catch(() => null) : null;
  const b = origem?.base;
  const entidades = [...(b?.servicos ?? []), ...(entidadeApp ? [entidadeApp] : [])];
  const umaHoraAntes = new Date(Date.parse(periodo.de) - 36e5).toISOString();
  // texto com instantes fixos: a chave é o próprio texto (a mesma evidência do mesmo período serve quem vier depois)
  const ia = (id: string, q: string, max: number) => lerCompartilhado("ia", chaveBloco(id, q), () => dql(q, { contexto: `ia/${id}`, maxRecords: max })).then((x) => x?.dados ?? []);
  const [excecoes, problemas, mudancas] = await Promise.all([
    b && b.traces.length ? ia("IA-01", qExcecoesFalha(b.traces, b.de, b.ate), 10).then((r) => r.map((x) => ({ servico: texto(x.servico) ?? "", tipo: texto(x.tipo) ?? "", msg: texto(x.msg) ?? "", n: num(x.n) }))).catch(() => []) : Promise.resolve([]),
    entidades.length ? ia("IA-02", qProblemasDavis(entidades, umaHoraAntes, periodo.ate), 5).then((r) => r.map((x) => ({ id: texto(x.id) ?? "", nome: texto(x.nome) ?? "", estado: texto(x.estado) ?? "", categoria: texto(x.categoria) ?? "", inicio: texto(x.inicio) ?? "", causa: texto(x.causa) }))).catch(() => []) : Promise.resolve([]),
    b && b.servicos.length ? ia("IA-03", qMudancas(b.servicos, periodo.ate), 5).then((r) => r.map((x) => ({ t: texto(x.t) ?? "", tipo: texto(x.tipo) ?? "", nome: texto(x.nome) ?? "", versao: texto(x.versao) }))).catch(() => []) : Promise.resolve([]),
  ]);
  return { origem, excecoes, problemas, mudancas };
}
