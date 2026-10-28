/* Dossiê de evidências da análise por LLM ("Analisar com LLM"), uma por oportunidade priorizada pelo motor
   (lib/oportunidades.ts, as primeiras MAX_OPORTUNIDADES). Estende lib/evidencias.ts (que lê só a origem da falha de uma
   página para o "Onde falha no backend?" e o Dynatrace Assist): aqui a coleta vai até a causa, com a mesma regra de
   sempre, SOB DEMANDA (só quando alguém pede a análise por LLM), no navegador e com a identidade de quem pediu.

   Coleta ENXUTA, com orçamento explícito e medido (ORCAMENTO_PADRAO; cada consulta devolve o scannedBytes do Grail):
   - negócio: o que a Visão geral já leu (cartões, fluxos, jornadas, chamadas por estado: R$ 0), as sessões por dia
     (entradas) e os erros por página pelos agregados por fatia de 5 min (lib/agregados.ts; até a 1.40, as métricas
     rum_flow.entry e rum_flow.error) e as novas tentativas por sessão pela cópia enxuta (DOS-02);
   - backend: uma AMOSTRA de chamadas da cópia (DOS-01, com samplingRatio quando o volume é grande: só os trace ids das
     chamadas que falham e das que dão certo, ou das lentas e rápidas, até 10 por classe e endpoint) e UMA leitura de spans
     filtrada por esses trace ids na janela em volta deles (DOS-03; o Grail cobra a janela, por isso uma consulta só para
     todas as oportunidades e nunca a janela inteira da tela). Daí: cadeia de serviços, serviço de origem, exceção e
     mensagem mascaradas com arquivo e linha, tempo por salto p50 e p95, banco e chamadas externas, novas tentativas e
     timeouts, e o que a origem chama quando dá certo;
   - saúde por métrica (R$ 0): serviços e endpoints em 48 h, CPU e memória dos hosts dos traces (DOS-04, DOS-05);
   - Davis (problemas com causa raiz, 24 h) e eventos de deploy, configuração e reinício (48 h) dos serviços (DOS-08, DOS-09);
   - frontend e mobile: no MÁXIMO 4 consultas em user.events, janela curta (30 min no fim do período) e amostragem pelo
     volume, uma por necessidade e para todas as oportunidades: o que segura o LCP (DOS-10), erros de JavaScript com a pilha
     mascarada, navegador e sistema (DOS-11), falhas e crash do app por versão, rede e sistema (DOS-12).
   As consultas de user.events rodam uma de cada vez e param no orçamento (a medida da anterior estima a próxima).

   Tudo que sai passa por lib/llmPacote.ts (sanitizarDossie, ajustarDossie até ~14 KB e verificarDossie); a função
   do app sanitiza e verifica de novo. Nada de trace id, span id, id de entidade, id de sessão ou IP no dossiê. */
import { precoDeLista } from "./precos";
import { dql, aspas, bucketsDaLeitura, passosEmUso, BUCKETS_COPIA, filtroTraces, type Linha } from "./dql";
import { fonteAgregados } from "./agregados";
import type { Oportunidade, LinhaChamadaEstado, JornadaOp } from "./oportunidades";
import type { Inicio } from "./inicio";
import {
  ajustarDossie, bytesDe, sanitizarContexto, sanitizarDossie, textoDossie, verificarContexto, verificarDossie, sanitizarDominio,
  MAX_OPORTUNIDADES, MAX_BYTES_DOSSIE, type ContextoAnalise, type DossieLlm, type TipoDossie,
} from "./llmPacote";

// idioma da interface (lib/i18n.ts): cópia local, como em lib/inicio.ts
const t = (pt: string, en: string) => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? en : pt);
const loc = () => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "en-US" : "pt-BR");

/* ---- Orçamento ---------------------------------------------------------------------------------------------------------- */
const GIB = 1024 ** 3;
export interface Orcamento {
  maxOportunidades: number;
  /** alvo de cada dossiê (bytes do JSON) */
  maxBytesDossie: number;
  /** teto de leitura da coleta inteira (bytes lidos no Grail, somados): parou nele, as consultas que faltam ficam de fora */
  maxBytesLidos: number;
  /** janela da amostra da cópia e de user.events: os últimos N minutos do período da tela */
  janelaMin: number;
  /** traces por endpoint e classe (falha e sucesso; lenta e rápida) e no total */
  maxTracesPorClasse: number;
  maxTraces: number;
  maxConsultasUserEvents: number;
  /** chamada lenta a partir de (ms) */
  limiarLentoMs: number;
  /** R$ por GiB lido: o preço de consulta em uso no cartão "Consumo do app" (o de lista ou o do contrato que o
      administrador digitou); a tela passa, e o padrão é o de lista */
  tarifaRsPorGiB: number;
}
export const ORCAMENTO_PADRAO: Orcamento = {
  maxOportunidades: MAX_OPORTUNIDADES, maxBytesDossie: MAX_BYTES_DOSSIE, maxBytesLidos: 1200 * GIB, janelaMin: 30,
  maxTracesPorClasse: 10, maxTraces: 160, maxConsultasUserEvents: 4, limiarLentoMs: 3000, tarifaRsPorGiB: precoDeLista("consulta", null),
};
/** Leitura esperada num ambiente grande por consulta (GiB), pelas medidas de um ambiente grande: o Grail
    lê blocos de cerca de 1 h, então janela curta não reduz na proporção; a amostragem reduz. Só para a documentação e a
    tela (estimativa); a coleta corta pela medida real. */
export const ESTIMATIVA_GRANDE_GIB = {
  copia: 15,            // cópia enxuta, buckets de erro e de requisição, 30 min (DOS-01 e DOS-02)
  spans: 210,           // spans por trace ids, janela de até 35 min, sem amostragem (DOS-03)
  userEvents: 70,       // user.events 30 min com samplingRatio 10 a 100 (DOS-10 a DOS-12), cada
  davisEventos: 5,      // dt.davis.problems 24 h e events 48 h (DOS-08 e DOS-09), juntas
  metricas: 0,          // timeseries (DOS-04 a DOS-07): sem cobrança de leitura
};
/** GiB lidos por análise num ambiente grande (pela estimativa acima). */
export const estimativaGibAnalise = (uePorAnalise = 3) =>
  2 * ESTIMATIVA_GRANDE_GIB.copia + ESTIMATIVA_GRANDE_GIB.spans + uePorAnalise * ESTIMATIVA_GRANDE_GIB.userEvents + ESTIMATIVA_GRANDE_GIB.davisEventos;
export const estimativaGrandeRs = (uePorAnalise = 3, o: Orcamento = ORCAMENTO_PADRAO) => estimativaGibAnalise(uePorAnalise) * o.tarifaRsPorGiB;

/* ---- Tipos ----------------------------------------------------------------------------------------------------------- */
export type FonteConsulta = "copia" | "spans" | "user.events" | "metrica" | "agregados" | "davis" | "eventos";
export interface ConsultaMedida { id: string; fonte: FonteConsulta; bytes: number | null; linhas: number; ms: number; erro?: string; pulada?: string; amostragem?: number }
export type Executor = (q: string, o: { id: string; fonte: FonteConsulta; maxRecords: number }) => Promise<{ linhas: Linha[]; bytes: number | null }>;
export interface ProgressoColeta { etapa: "amostra" | "traces" | "metricas" | "frontend" | "pronto"; consultas: number; bytes: number }
export interface EntradaDossie {
  /** as oportunidades na ordem da tela (lib/oportunidades.ts avaliarOportunidades().itens) */
  oportunidades: Oportunidade[];
  inicio: Pick<Inicio, "total" | "porApp" | "problemas" | "erros" | "caminhos" | "saidas" | "geradoEm" | "periodos" | "porApp24">;
  apps: { id: string; nome: string; canal?: string }[];
  /** período dos números da tela, em instantes ISO */
  periodo: { de: string; ate: string; rotulo: string };
  /** nome do escopo ("Todas as aplicações" ou a aplicação) */
  escopo: string;
  robos: boolean;
  /** chamadas por endpoint e estado (QUA-U "3chamada"), já lidas pela tela */
  chamadas?: LinhaChamadaEstado[] | null;
  jornadas?: JornadaOp[] | null;
  idioma?: "pt" | "en";
  versaoApp?: string | null;
  orcamento?: Partial<Orcamento>;
  executar?: Executor;
  aoProgresso?: (p: ProgressoColeta) => void;
  agora?: () => number;
}
export interface ColetaDossie {
  dossies: DossieLlm[];
  contexto: ContextoAnalise;
  consultas: ConsultaMedida[];
  bytes: number;
  custoRs: number;
  duracaoMs: number;
  /** a verificação de privacidade achou algo (onde e o quê, nunca o valor): nada pode ser enviado */
  achados: { onde: string; tipo: string }[];
}

/* ---- Utilitários ------------------------------------------------------------------------------------------------------ */
const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
const nn = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? r1((100 * a) / b) : 0);
const q = (xs: number[], p: number) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; return r1(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]); };
const unicos = <T,>(xs: T[]) => [...new Set(xs)];
const lista = (xs: string[]) => `array(${xs.map((x) => `"${aspas(x)}"`).join(", ")})`;
const txt = (v: unknown, max = 200) => (v == null ? null : textoDossie(String(v), max));
const contar = <T,>(arr: T[]) => { const m = new Map<string, number>(); for (const v of arr) { const s = JSON.stringify(v); m.set(s, (m.get(s) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ valor: JSON.parse(s) as T, n: c })); };
const iso = (ms: number) => new Date(ms).toISOString();
const hora = (ms: number) => new Date(ms).toLocaleString(loc(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const ROBO = (robos: boolean) => (robos ? "" : ' and dt.rum.user_type != "robot"');
/** Amostragem do Grail (potência de 10) para ler perto de `alvo` registros quando o volume estimado é maior. */
export const razaoAmostra = (volume: number, alvo: number) => { let r = 1; while (r < 1000 && volume / r > alvo) r *= 10; return r; };
const amostra = (r: number) => (r > 1 ? `, samplingRatio: ${r}` : "");

/* ---- O que coletar por oportunidade ---------------------------------------------------------------------------------- */
export interface PlanoOportunidade {
  op: Oportunidade; id: string; tipo: TipoDossie;
  paginas: { app: string; view: string }[];
  /** endpoints: falha (o que falha) ou lento (o que segura a página) */
  endpoints: { caminho: string; status: string | null; lento: boolean }[];
  lcp: boolean; js: boolean; mobile: boolean;
}
/** As primeiras oportunidades e o que cada uma precisa (pelo id e pelas regras do motor, sem consulta). */
export function planejar(e: Pick<EntradaDossie, "oportunidades" | "inicio" | "apps" | "chamadas">, max = MAX_OPORTUNIDADES): PlanoOportunidade[] {
  const canal = (app: string) => e.apps.find((a) => a.id === app)?.canal ?? (app.includes("-") ? "mobile" : "web");
  const porChave = new Map(e.inicio.erros.map((x) => [x.chave, x]));
  return e.oportunidades.slice(0, max).map((o, i) => {
    const partes = o.id.split("|");
    const paginas = (o.problemas.length ? o.problemas : o.pagina ? [o.pagina] : []).slice(0, 6);
    const endpoints: PlanoOportunidade["endpoints"] = [];
    const add = (caminho: string | null | undefined, status: string | null, lento: boolean) => { if (caminho && caminho !== "?" && !endpoints.some((x) => x.caminho === caminho && x.lento === lento)) endpoints.push({ caminho, status, lento }); };
    if (partes[0] === "srv") add(partes.slice(2).join("|"), partes[1] === "?" ? null : partes[1], false);
    if (partes[0] === "w1c") add(partes.slice(2).join("|"), null, true);
    // os erros de servidor das páginas por trás da oportunidade (o grupo de pequenos e o mobile com "HTTP 503" na tela)
    if (partes[0] === "grupo") for (const pg of paginas) {
      const p = e.inicio.problemas.find((x) => x.app === pg.app && x.view === pg.view);
      for (const k of p?.erros ?? []) { const er = porChave.get(k); if (er?.tipo === "servidor") add(er.caminho, er.status, false); }
    }
    if (partes[0] === "w1") {
      const view = partes.slice(1).join("|"), apps = new Set(o.apps);
      const linhas = (e.chamadas ?? []).filter((l) => apps.has(l.app) && l.paginas.includes(view));
      const porCaminho = new Map<string, { total: number; lentas: number; p75: number }>();
      for (const l of linhas) { const x = porCaminho.get(l.caminho) ?? { total: 0, lentas: 0, p75: 0 }; x.total += l.total - l.falhas; x.lentas += l.lentas; x.p75 = Math.max(x.p75, l.p75Ms ?? 0); porCaminho.set(l.caminho, x); }
      for (const [c, x] of [...porCaminho].sort((a, b) => b[1].lentas - a[1].lentas).slice(0, 2)) if (x.lentas > 0 || x.p75 > 3000) add(c, null, true);
    }
    const mobile = o.canal === "mobile" || o.apps.some((a) => canal(a) === "mobile");
    const js = o.canal === "web" && (partes[0] === "tela" || o.regras.includes("W2"));
    const lcp = partes[0] === "w1" || partes[0] === "w1c";
    const tipo: TipoDossie = endpoints.some((x) => !x.lento) ? "falha-backend" : partes[0] === "w1" ? "lentidao-pagina" : partes[0] === "w1c" ? "chamada-lenta"
      : js ? "erro-javascript" : partes[0] === "w7" ? "terceiro" : mobile ? "mobile" : "outro";
    return { op: o, id: `o${i + 1}`, tipo, paginas: lcp && !paginas.length ? [{ app: o.apps[0], view: partes[1] }] : paginas, endpoints: endpoints.slice(0, 4), lcp, js, mobile };
  });
}

/* ---- Consultas (texto) ------------------------------------------------------------------------------------------------ */
const bucketsCopia = (de: string) => (passosEmUso() ? bucketsDaLeitura(["erro", "req"], `"${de}"`) : [BUCKETS_COPIA.erro, BUCKETS_COPIA.req]);
/** DOS-01: amostra de chamadas da cópia, com o trace id, por aplicação, endpoint e classe (falha/sucesso ou lenta/rápida). */
export const qAmostraChamadas = (caminhos: string[], lentos: string[], de: string, ate: string, robos: boolean, porClasse: number, limiarMs: number, razao = 1) =>
  `fetch bizevents, from: "${de}", to: "${ate}", bucket: {${bucketsCopia(de).map((b) => `"${aspas(b)}"`).join(", ")}}${amostra(razao)}
| filter (characteristics.classifier == "request" or (characteristics.classifier == "error" and error.type == "request")) and isNotNull(trace.id)${ROBO(robos)}
| filter in(url.path, ${lista(caminhos)})
| fieldsAdd d = toDouble(duration) / 1000000.0, falha = characteristics.classifier == "error"
| fieldsAdd classe = if(in(url.path, ${lista(lentos.length ? lentos : ["-"])}), if(d > ${limiarMs}, "lenta", else: "rapida"), else: if(falha, "falha", else: "sucesso"))
| sort start_time desc
| summarize n = count(), sessoes = countDistinct(dt.rum.session.id), p50 = percentile(d, 50), p95 = percentile(d, 95), status = collectDistinct(http.response.status_code, maxLength: 4),
    amostra = collectArray(record(t = start_time, trace = toString(trace.id)), maxLength: ${porClasse}), by:{app = dt.rum.application.id, caminho = url.path, classe}
| limit 200`;
/** DOS-02: novas tentativas por sessão nos endpoints que falham (cópia): quantas vezes cada sessão chamou e se conseguiu. */
export const qTentativas = (caminhos: string[], de: string, ate: string, robos: boolean) =>
  `fetch bizevents, from: "${de}", to: "${ate}", bucket: {${bucketsCopia(de).map((b) => `"${aspas(b)}"`).join(", ")}}
| filter (characteristics.classifier == "request" or (characteristics.classifier == "error" and error.type == "request"))${ROBO(robos)}
| filter in(url.path, ${lista(caminhos)})
| summarize tent = count(), falhas = countIf(characteristics.classifier == "error"), by:{dt.rum.session.id, app = dt.rum.application.id, caminho = url.path}
| summarize sessoes = count(), com_falha = countIf(falhas > 0), uma = countIf(tent == 1), duas = countIf(tent == 2), tres_ou_mais = countIf(tent >= 3), tent_media = avg(tent), tent_max = max(tent),
    conseguiu_depois_de_falhar = countIf(falhas > 0 and tent > falhas), nunca_conseguiu = countIf(falhas == tent), by:{app, caminho}
| limit 40`;
/** DOS-03: todos os spans dos traces da amostra, na janela em volta deles. */
export const qSpansDosTraces = (traces: string[], de: string, ate: string) => `fetch spans, from: "${de}", to: "${ate}"
| filter ${filtroTraces(traces)}
| fields trace = toString(trace.id), id = span.id, pai = span.parent_id, kind = span.kind, svc = dt.service.name, ent = dt.entity.service, host = dt.entity.host, nome = span.name,
    t = start_time, d = toDouble(duration) / 1000000.0, status = http.response.status_code, f = request.is_failed, sst = span.status_code, alvo = server.address,
    db = db.system, dbop = db.operation.name, dbns = db.namespace, cf = code.filepath, cl = code.lineno, cfn = code.function, cns = code.namespace, ev = span.events
| limit 20000`;
/** DOS-04: serviços e endpoints dos traces em 48 h, por blocos de 6 h (métrica, R$ 0). */
export const qServicos48h = (servicos: string[], ate: string) =>
  `timeseries {req = sum(dt.service.request.count), falhas = sum(dt.service.request.failure_count), p95 = percentile(dt.service.request.response_time, 95)}, by:{dt.entity.service, endpoint.name}, filter: in(dt.entity.service, ${lista(servicos)}), from: "${iso(Date.parse(ate) - 48 * 36e5)}", to: "${ate}", interval: 6h
| fieldsAdd servico = entityName(dt.entity.service)
| fields servico, ent = dt.entity.service, endpoint = endpoint.name, req, falhas, p95, timeframe
| limit 300`;
/** DOS-05: CPU e memória dos hosts dos traces no período (métrica, R$ 0). */
export const qHosts = (hosts: string[], de: string, ate: string) =>
  `timeseries {cpu = avg(dt.host.cpu.usage), mem = avg(dt.host.memory.usage)}, by:{dt.entity.host}, filter: in(dt.entity.host, ${lista(hosts)}), from: "${de}", to: "${ate}", interval: 1h
| fieldsAdd host = entityName(dt.entity.host)
| fields host, ent = dt.entity.host, cpu, mem
| limit 60`;
/** DOS-06: sessões por dia por aplicação, 7 dias (primeira página da sessão: as entradas dos agregados, frações de MiB). */
export const qSessoesDia = (apps: string[], ate: string, robos: boolean) => {
  const de = iso(Date.parse(ate) - 8 * 864e5);
  return `${fonteAgregados(`${de}/${ate}`, ["nav"])}
| filter entrada == true and in(app, ${lista(apps)})${robos ? "" : ' and (isNull(usuario) or usuario != "robot")'}
| makeTimeseries entradas = sum(n), by:{app}, interval: 1d, time: timestamp, from: "${de}", to: "${ate}"
| fields app, entradas, timeframe`;
};
/** DOS-07: erros por página nas 48 h, por blocos de 6 h (agregados de erro, frações de MiB): quando começou do lado do
    cliente. Os agregados já têm o nome limpo da página; o consumidor soma os blocos das linhas da mesma página
    (somarErrosPagina). */
export const qErrosPagina48h = (apps: string[], paginas: string[], ate: string, robos: boolean) => {
  const de = iso(Date.parse(ate) - 48 * 36e5);
  return `${fonteAgregados(`${de}/${ate}`, ["erro"])}
| filter in(app, ${lista(apps)}) and in(pagina, ${lista(paginas)})${robos ? "" : ' and (isNull(usuario) or usuario != "robot")'}
| makeTimeseries erros = sum(n), by:{app, pagina, tipo = etipo}, interval: 6h, time: timestamp, from: "${de}", to: "${ate}"
| fields app, pagina, tipo, erros, timeframe
| limit 100`;
};
/** Linhas de qErrosPagina48h da mesma (aplicação, página, tipo) somadas bloco a bloco (séries cruas com ";jsessionid" fundidas). */
export const somarErrosPagina = (linhas: Record<string, unknown>[]) => {
  const por = new Map<string, Record<string, unknown>>();
  for (const l of linhas) {
    const k = `${l.app}|${l.pagina}|${l.tipo ?? ""}`, atual = por.get(k);
    if (!atual) { por.set(k, { ...l, erros: Array.isArray(l.erros) ? [...(l.erros as unknown[])] : l.erros }); continue; }
    const a = atual.erros as unknown[], b = Array.isArray(l.erros) ? (l.erros as unknown[]) : [];
    if (Array.isArray(a)) for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] == null ? null : Number(a[i]), y = b[i] == null ? null : Number(b[i]); a[i] = x == null && y == null ? null : (x ?? 0) + (y ?? 0); }
  }
  return [...por.values()];
};
/** DOS-08: problemas do Davis dos serviços (causa raiz ou afetado), 24 h. */
export const qDavis = (servicos: string[], ate: string) => `fetch dt.davis.problems, from: "${iso(Date.parse(ate) - 864e5)}", to: "${ate}"
| filter in(root_cause_entity_id, ${lista(servicos)}) or iAny(in(affected_entity_ids[], ${lista(servicos)}))
| dedup display_id, sort: {timestamp desc}
| fieldsAdd dur_min = toDouble(coalesce(event.end, now()) - event.start) / 60000000000.0
| summarize problemas = count(), abertos = countIf(event.status == "ACTIVE"), primeiro = min(event.start), ultimo = max(event.start), dur_p50_min = percentile(dur_min, 50),
    afetados = collectDistinct(affected_entity_ids, maxLength: 20), by:{nome = event.name, causa = root_cause_entity_name, causa_id = root_cause_entity_id, categoria = event.category}
| sort problemas desc
| limit 20`;
/** DOS-09: deploys, configuração, reinício e término nos serviços, 48 h. */
export const qMudancas48h = (servicos: string[], ate: string) => `fetch events, from: "${iso(Date.parse(ate) - 2 * 864e5)}", to: "${ate}"
| filter event.kind == "SDLC_EVENT" or in(event.type, {"CUSTOM_DEPLOYMENT", "CUSTOM_CONFIGURATION", "MARKED_FOR_TERMINATION", "PROCESS_RESTART"})
| filter iAny(in(affected_entity_ids[], ${lista(servicos)})) or in(dt.entity.service, ${lista(servicos)})
| summarize n = count(), primeiro = min(timestamp), ultimo = max(timestamp), nomes = collectDistinct(event.name, maxLength: 3), versoes = collectDistinct(coalesce(deployment.version, dt.event.deployment_version), maxLength: 3), by:{tipo = coalesce(event.type, event.kind)}
| limit 20`;
/** DOS-10: o que segura o LCP das páginas: por carga, o LCP e as requisições (XHR, recurso e script) e quais terminam
    logo antes dele (de 50 ms depois a 600 ms antes). */
/** Nome da página sem o parâmetro de caminho (";jsessionid=..."), como em lib/queries.ts (semParametro): as páginas chegam
    com o nome limpo (métricas do DEF) e o user.events traz o cru. */
const VIEW_LIMPA = 'fieldsAdd view.name = if(indexOf(view.name, ";") >= 0, substring(view.name, from: 0, to: indexOf(view.name, ";")), else: view.name)';
export const qLcp = (paginas: string[], de: string, ate: string, robos: boolean, razao = 1) => `fetch user.events, from: "${de}", to: "${ate}"${amostra(razao)}
| ${VIEW_LIMPA}
| filter frontend.type == "web"${ROBO(robos)} and in(view.name, ${lista(paginas)}) and in(characteristics.classifier, array("view_summary", "request"))
| fieldsAdd vs = characteristics.classifier == "view_summary"
| summarize lcp = max(if(vs, toDouble(web_vitals.largest_contentful_paint) / 1000000.0)), fcp = max(if(vs, toDouble(web_vitals.first_contentful_paint) / 1000000.0)),
    ttfb = max(if(vs, toDouble(web_vitals.time_to_first_byte) / 1000000.0)), cls = max(if(vs, toDouble(web_vitals.cumulative_layout_shift))), inp = max(if(vs, toDouble(web_vitals.interaction_to_next_paint) / 1000000.0)),
    lcp_tag = takeFirst(if(vs, lcp.ui_element.tag_name)), cls_tag = takeFirst(if(vs, cls.ui_element.tag_name)), cls_t = max(if(vs, toDouble(cls.ui_element.shift_time))),
    reqs = collectArray(if(not vs, record(p = url.path, ini = toDouble(performance.start_time) / 1000000.0, dur = toDouble(duration) / 1000000.0)), maxLength: 30), by:{view.instance_id, pagina = view.name}
| filter isNotNull(lcp)
| fieldsAdd lento = lcp > 4000
| expand r = reqs
| fieldsAdd caminho = r[p], dur = r[dur], delta = lcp - (r[ini] + r[dur])
| summarize cargas = countDistinct(view.instance_id), antes_do_lcp = countIf(delta >= -50 and delta <= 600), dur_p50 = percentile(dur, 50), dur_p75 = percentile(dur, 75), delta_p50 = percentile(if(delta >= -50 and delta <= 600, delta), 50),
    lcp_p75 = percentile(lcp, 75), fcp_p75 = percentile(fcp, 75), ttfb_p75 = percentile(ttfb, 75), cls_p75 = percentile(cls, 75), inp_p75 = percentile(inp, 75),
    lcp_tags = collectDistinct(lcp_tag, maxLength: 3), cls_tags = collectDistinct(cls_tag, maxLength: 3), cls_t_p50 = percentile(cls_t, 50), by:{pagina, lento, caminho}
| sort pagina asc, lento desc, antes_do_lcp desc
| limit 60`;
/** DOS-11: erros de JavaScript das páginas: assinatura (tipo, mensagem, arquivo, linha, pilha), quando acontece depois do
    início da página, se as chamadas da página deram certo nas cargas com erro, navegador e sistema. */
export const qJs = (paginas: string[], de: string, ate: string, robos: boolean, razao = 1) => `fetch user.events, from: "${de}", to: "${ate}"${amostra(razao)}
| ${VIEW_LIMPA}
| filter frontend.type == "web"${ROBO(robos)} and in(view.name, ${lista(paginas)}) and in(characteristics.classifier, array("view_summary", "error", "request"))
| fieldsAdd vs = characteristics.classifier == "view_summary", ex = characteristics.classifier == "error" and error.type == "exception", rf = characteristics.classifier == "error" and error.type == "request"
| summarize ini = min(if(vs, start_time)), t_err = min(if(ex, start_time)),
    sig = takeFirst(if(ex, record(tipo = exception.type, msg = substring(exception.message, from: 0, to: 160), arq = exception.file.path, linha = exception.line_number, col = exception.column_number, prov = exception.file.provider, pilha = substring(exception.stack_trace, from: 0, to: 400)))),
    req_n = countIf(characteristics.classifier == "request"), req_falha = countIf(rf), req_ms = max(if(characteristics.classifier == "request", toDouble(duration) / 1000000.0)),
    navegador = takeFirst(browser.name), so = takeFirst(os.name), by:{view.instance_id, pagina = view.name}
| filter isNotNull(ini)
| fieldsAdd com_erro = isNotNull(t_err), atraso = toDouble(t_err - ini) / 1000000.0
| summarize cargas = count(), com_erro = countIf(com_erro), atraso_p10 = percentile(atraso, 10), atraso_p50 = percentile(atraso, 50), atraso_p90 = percentile(atraso, 90),
    req_falhou_com_erro = countIf(com_erro and req_falha > 0), req_ok_com_erro = countIf(com_erro and req_n > 0 and req_falha == 0), req_ms_p75 = percentile(req_ms, 75),
    sigs = collectDistinct(if(com_erro, sig), maxLength: 3), by:{pagina, navegador, so}
| sort pagina asc, cargas desc
| limit 80`;
/** DOS-12: app mobile: falhas de requisição, exceções, crash e ANR por endpoint, status, rede, versão e sistema. */
export const qMobile = (apps: string[], caminhos: string[], de: string, ate: string, robos: boolean, razao = 1) => `fetch user.events, from: "${de}", to: "${ate}"${amostra(razao)}
| filter in(dt.rum.application.id, ${lista(apps)})${ROBO(robos)}
| filter characteristics.classifier == "error" or (characteristics.classifier == "request" and in(url.path, ${lista(caminhos.length ? caminhos : ["-"])}))
| fieldsAdd classe = if(characteristics.classifier == "request", "requisicao_ok", else: if(error.type == "request", "requisicao_falha", else: coalesce(error.type, "erro")))
| summarize n = count(), sessoes = countDistinct(dt.rum.session.id), ms_p50 = percentile(toDouble(duration), 50) / 1000000.0, ms_p95 = percentile(toDouble(duration), 95) / 1000000.0,
    sem_resposta = countIf(classe == "requisicao_falha" and isNull(http.response.status_code)), telas = collectDistinct(view.name, maxLength: 3),
    sig = takeFirst(record(tipo = exception.type, msg = substring(coalesce(exception.message, error.display_name), from: 0, to: 160), pilha = substring(exception.stack_trace, from: 0, to: 300))),
    by:{app = dt.rum.application.id, classe, caminho = url.path, status = http.response.status_code, rede = network.connection.type, versao = app.short_version, so = os.name}
| sort n desc
| limit 60`;

/* ---- Análise dos traces ------------------------------------------------------------------------------------------------ */
interface Span { trace: string; id: string; pai: string; kind: string; svc: string; ent: string | null; host: string | null; nome: string; t: number; d: number; status: string | null; f: boolean; sst: string | null; alvo: string | null; db: string | null; dbop: string | null; dbns: string | null; cf: string | null; cfn: string | null; cns: string | null; ev: Record<string, unknown>[] }
export const spanDe = (x: Linha): Span => ({
  trace: String(x.trace ?? ""), id: String(x.id ?? ""), pai: String(x.pai ?? ""), kind: String(x.kind ?? ""), svc: String(x.svc ?? "?"), ent: x.ent == null ? null : String(x.ent), host: x.host == null ? null : String(x.host),
  nome: String(x.nome ?? ""), t: Date.parse(String(x.t ?? "")) || 0, d: n(x.d), status: x.status == null ? null : String(x.status), f: x.f === true || x.f === "true", sst: x.sst == null ? null : String(x.sst),
  alvo: x.alvo == null ? null : String(x.alvo), db: x.db == null ? null : String(x.db), dbop: x.dbop == null ? null : String(x.dbop), dbns: x.dbns == null ? null : String(x.dbns),
  cf: x.cf == null ? null : String(x.cf), cfn: x.cfn == null ? null : String(x.cfn), cns: x.cns == null ? null : String(x.cns), ev: Array.isArray(x.ev) ? (x.ev as Record<string, unknown>[]) : [],
});
const proxy = (s: Span) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(s.nome) || /nginx|envoy|haproxy|apache/i.test(s.cns ?? "");
const rotulo = (s: Span) => (proxy(s) ? `${s.svc} (proxy)` : `${s.svc} ${s.nome}`);
const falhou = (s: Span) => s.f || s.sst === "error";
interface Excecao { servico: string; tipo: string; mensagem: string; local: string | null; pilha: string }
interface AnaliseTrace {
  cadeia: string[]; origem: Span | null; lentidao: Span | null; servidores: Span[]; excecoes: Excecao[];
  entrada: Span | null; proprioEntradaMs: number | null; abaixoEntradaMs: number | null; chamadasEntrada: Record<string, number>;
  origemChamou: { banco: number; http: number }; tentativas: { servico: string; alvo: string; vezes: number }[]; timeout: boolean;
  banco: { sistema: string; op: string | null; d: number }[]; externas: string[]; hosts: string[]; servicos: string[];
}
const excecoesDe = (s: Span): Excecao[] => s.ev.filter((e) => e["span_event.name"] === "exception").map((e) => {
  const arq = e["exception.file.full"] ?? e["code.filepath"], linha = e["exception.line_number"] ?? e["code.lineno"];
  const pilha = String(e["exception.stack_trace"] ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" < ");
  return { servico: s.svc, tipo: String(e["exception.type"] ?? ""), mensagem: textoDossie(String(e["exception.message"] ?? ""), 200), local: arq ? `${arq}${linha ? `:${linha}` : ""}` : null, pilha: textoDossie(pilha, 300) };
});
export function analisarTrace(xs: Span[]): AnaliseTrace | null {
  if (!xs.length) return null;
  const ids = new Set(xs.map((x) => x.id)), fil = new Map<string, Span[]>();
  for (const x of xs) { if (!fil.has(x.pai)) fil.set(x.pai, []); fil.get(x.pai)!.push(x); }
  const filhosServidores = (s: Span): Span[] => { const out: Span[] = []; const vai = (id: string, k: number) => { if (k > 6) return; for (const c of fil.get(id) ?? []) { if (c.kind === "server") out.push(c); else vai(c.id, k + 1); } }; vai(s.id, 0); return out; };
  const raizes = xs.filter((x) => !ids.has(x.pai)).sort((a, b) => a.t - b.t);
  let atual: Span | null = raizes.find((x) => x.kind === "server") ?? xs.filter((x) => x.kind === "server").sort((a, b) => a.t - b.t)[0] ?? null;
  const cadeia: Span[] = [], vistos = new Set<string>();
  while (atual && !vistos.has(atual.id) && cadeia.length < 12) {
    vistos.add(atual.id); cadeia.push(atual);
    const prox = filhosServidores(atual);
    if (!prox.length) break;
    atual = prox.find(falhou) ?? [...prox].sort((a, b) => b.d - a.d)[0];
  }
  const proprio = (s: Span) => s.d - (fil.get(s.id) ?? []).reduce((m, c) => m + c.d, 0);
  const falhos = cadeia.filter(falhou);
  const origem = falhos.length ? falhos[falhos.length - 1] : null;
  const lentidao = cadeia.length ? [...cadeia].sort((a, b) => proprio(b) - proprio(a))[0] : null;
  const entrada = cadeia.find((s) => !proxy(s)) ?? null;
  const chamadasEntrada: Record<string, number> = {};
  let abaixo = 0;
  if (entrada) for (const c of fil.get(entrada.id) ?? []) { const k = c.db ? `banco ${c.db}${c.dbop ? ` ${c.dbop}` : ""}` : `${c.kind === "client" ? "chama" : c.kind} ${c.alvo ?? c.nome}`; chamadasEntrada[k] = (chamadasEntrada[k] ?? 0) + 1; abaixo += c.d; }
  const origemChamou = { banco: 0, http: 0 };
  if (origem) for (const c of fil.get(origem.id) ?? []) { if (c.db) origemChamou.banco++; else if (c.kind === "client") origemChamou.http++; }
  const tentativas: AnaliseTrace["tentativas"] = [];
  for (const [pai, cs] of fil) {
    const p = xs.find((x) => x.id === pai); if (!p) continue;
    const porAlvo = new Map<string, number>();
    for (const c of cs) if (c.kind === "client" && !c.db) { const k = `${c.alvo ?? "?"} ${c.nome}`; porAlvo.set(k, (porAlvo.get(k) ?? 0) + 1); }
    for (const [alvo, vezes] of porAlvo) if (vezes >= 2) tentativas.push({ servico: p.svc, alvo: textoDossie(alvo, 80), vezes });
  }
  const excecoes = xs.flatMap(excecoesDe);
  const timeout = xs.some((s) => s.status === "504" || s.status === "408") || excecoes.some((e) => /time ?out|timed out|tempo esgotado|deadline/i.test(`${e.tipo} ${e.mensagem}`));
  const servicosDoTrace = new Set(xs.map((s) => s.alvo).filter(Boolean) as string[]);
  for (const s of xs) if (s.kind === "server") servicosDoTrace.add(s.svc);
  const externas = unicos(xs.filter((s) => s.kind === "client" && !s.db && s.alvo && !xs.some((y) => y.kind === "server" && (y.alvo === s.alvo || y.svc.startsWith(`${s.alvo}`)))).map((s) => sanitizarDominio(s.alvo!)));
  return {
    cadeia: cadeia.map((c) => `${rotulo(c)} (${c.status ?? (falhou(c) ? "falha" : "ok")})`), origem, lentidao, servidores: xs.filter((x) => x.kind === "server"), excecoes,
    entrada, proprioEntradaMs: entrada ? r1(proprio(entrada)) : null, abaixoEntradaMs: entrada ? r1(abaixo) : null, chamadasEntrada, origemChamou, tentativas, timeout,
    banco: xs.filter((s) => s.db).map((s) => ({ sistema: `${s.db}${s.dbns ? ` ${s.dbns}` : ""}`, op: s.dbop, d: s.d })), externas,
    hosts: unicos(xs.map((s) => s.host).filter(Boolean) as string[]), servicos: unicos(xs.map((s) => s.ent).filter(Boolean) as string[]),
  };
}

/** Resumo de um conjunto de traces (uma classe de um endpoint). */
export function resumirTraces(as: AnaliseTrace[], classe: string) {
  if (!as.length) return null;
  const tempos = new Map<string, number[]>();
  for (const a of as) for (const s of a.servidores) { const k = `${rotulo(s)}${s.status ? ` (${s.status})` : ""}`; if (!tempos.has(k)) tempos.set(k, []); tempos.get(k)!.push(s.d); }
  const exc = contar(as.flatMap((a) => a.excecoes.map((e) => `${e.servico} | ${e.tipo} | ${e.mensagem}${e.local ? ` | ${e.local}` : ""}${e.pilha ? ` | ${e.pilha}` : ""}`)));
  const falha = classe === "falha", lenta = classe === "lenta";
  const banco = new Map<string, { n: number; ms: number[]; ops: Set<string> }>();
  for (const a of as) for (const b of a.banco) { const x = banco.get(b.sistema) ?? { n: 0, ms: [], ops: new Set<string>() }; x.n++; x.ms.push(b.d); if (b.op) x.ops.add(b.op); banco.set(b.sistema, x); }
  const tent = contar(as.flatMap((a) => a.tentativas.map((x) => `${x.servico} -> ${x.alvo} (${x.vezes}x)`)));
  return {
    traces_analisados: as.length,
    cadeia_mais_comum: contar(as.map((a) => a.cadeia.join(" -> "))).slice(0, 2).map((x) => ({ cadeia: x.valor, traces: x.n })),
    ...(falha ? { origem_da_falha: contar(as.map((a) => (a.origem ? rotulo(a.origem) : "nenhum serviço com falha no trace"))).slice(0, 3).map((x) => ({ servico: x.valor, traces: x.n })) } : {}),
    ...(lenta ? { maior_tempo_proprio: contar(as.map((a) => (a.lentidao ? rotulo(a.lentidao) : "?"))).slice(0, 3).map((x) => ({ servico: x.valor, traces: x.n })) } : {}),
    excecoes: exc.length ? exc.slice(0, 3).map((x) => ({ servico_tipo_mensagem_local_pilha: x.valor, traces: x.n })) : "nenhuma exceção registrada nos spans destes traces",
    tempo_por_salto_ms: [...tempos].filter(([, v]) => v.length >= Math.min(3, as.length)).sort((a, b) => (q(b[1], 50) ?? 0) - (q(a[1], 50) ?? 0)).slice(0, 7).map(([k, v]) => ({ salto: k, n: v.length, p50: q(v, 50), p95: q(v, 95) })),
    servico_de_entrada: {
      chamadas_feitas: contar(as.map((a) => Object.entries(a.chamadasEntrada).map(([k, v]) => `${k} x${v}`).join("; ") || "nenhuma")).slice(0, 2).map((x) => ({ chamadas: x.valor, traces: x.n })),
      tempo_proprio_ms: { p50: q(as.map((a) => a.proprioEntradaMs ?? NaN), 50), p95: q(as.map((a) => a.proprioEntradaMs ?? NaN), 95) },
      tempo_das_chamadas_abaixo_ms: { p50: q(as.map((a) => a.abaixoEntradaMs ?? NaN), 50), p95: q(as.map((a) => a.abaixoEntradaMs ?? NaN), 95) },
    },
    ...(falha ? { o_que_a_origem_chamou_media: { banco: r1(as.reduce((s, a) => s + a.origemChamou.banco, 0) / as.length), http: r1(as.reduce((s, a) => s + a.origemChamou.http, 0) / as.length) } } : {}),
    banco_de_dados: [...banco].slice(0, 4).map(([k, x]) => ({ banco: k, chamadas_por_trace: r1(x.n / as.length), ms_p50: q(x.ms, 50), ms_p95: q(x.ms, 95), operacoes: [...x.ops].slice(0, 6) })),
    novas_tentativas_no_backend: tent.length ? tent.slice(0, 3).map((x) => ({ chamada: x.valor, traces: x.n })) : 0,
    traces_com_timeout: as.filter((a) => a.timeout).length,
    chamadas_externas: unicos(as.flatMap((a) => a.externas)).slice(0, 5),
  };
}

/* ---- Coleta ------------------------------------------------------------------------------------------------------------ */
const executorPadrao: Executor = async (texto, o) => {
  let bytes: number | null = null;
  const linhas = await dql(texto, { contexto: `llm/${o.id}`, maxRecords: o.maxRecords, aoGrail: (g) => { bytes = g.scannedBytes; } });
  return { linhas, bytes };
};

/** Coleta e monta os dossiês. Cada consulta que falhar deixa a parte dela vazia (a coleta segue com o resto). */
export async function coletarDossies(e: EntradaDossie): Promise<ColetaDossie> {
  const agora = e.agora ?? Date.now, inicio = agora();
  const orc: Orcamento = { ...ORCAMENTO_PADRAO, ...(e.orcamento ?? {}) };
  const exec = e.executar ?? executorPadrao;
  const consultas: ConsultaMedida[] = [];
  const gasto = () => consultas.reduce((s, c) => s + (c.bytes ?? 0), 0);
  const avisar = (etapa: ProgressoColeta["etapa"]) => e.aoProgresso?.({ etapa, consultas: consultas.filter((c) => !c.pulada).length, bytes: gasto() });
  const rodar = async (id: string, fonte: FonteConsulta, texto: string, maxRecords: number, extra: { amostragem?: number; orcamentoAntes?: number } = {}): Promise<Linha[] | null> => {
    if (extra.orcamentoAntes != null && gasto() + extra.orcamentoAntes > orc.maxBytesLidos) { consultas.push({ id, fonte, bytes: null, linhas: 0, ms: 0, pulada: "orçamento" }); return null; }
    const t0 = agora();
    try {
      const r = await exec(texto, { id, fonte, maxRecords });
      consultas.push({ id, fonte, bytes: r.bytes, linhas: r.linhas.length, ms: agora() - t0, ...(extra.amostragem && extra.amostragem > 1 ? { amostragem: extra.amostragem } : {}) });
      return r.linhas;
    } catch (err) {
      consultas.push({ id, fonte, bytes: null, linhas: 0, ms: agora() - t0, erro: (err instanceof Error ? err.message : String(err)).slice(0, 160) });
      return null;
    }
  };
  const planos = planejar(e, orc.maxOportunidades);
  const nomeApp = (id: string) => e.apps.find((a) => a.id === id)?.nome ?? id;
  const ate = e.periodo.ate, fimMs = Date.parse(ate);
  const deAmostraMs = Math.max(Date.parse(e.periodo.de), fimMs - orc.janelaMin * 60000), deAmostra = iso(deAmostraMs);
  const minutosTela = Math.max(1, (fimMs - Date.parse(e.periodo.de)) / 60000), minutosAmostra = (fimMs - deAmostraMs) / 60000;
  const sessoesNaAmostra = e.inicio.total.sessoes * (minutosAmostra / minutosTela);
  const endpoints = unicos(planos.flatMap((p) => p.endpoints.map((x) => x.caminho)));
  const lentos = unicos(planos.flatMap((p) => p.endpoints.filter((x) => x.lento).map((x) => x.caminho)));
  const falhando = unicos(planos.flatMap((p) => p.endpoints.filter((x) => !x.lento).map((x) => x.caminho)));
  const appsOps = unicos(planos.flatMap((p) => p.op.apps));
  const paginasOps = unicos(planos.flatMap((p) => p.paginas.map((x) => x.view)));
  avisar("amostra");

  // 1) em paralelo: amostra e tentativas (cópia), sessões por dia e erros por página (métrica); user.events numa fila à parte
  const razaoCopia = razaoAmostra(sessoesNaAmostra * 20, 200_000);
  const pAmostra = endpoints.length ? rodar("DOS-01", "copia", qAmostraChamadas(endpoints, lentos, deAmostra, ate, e.robos, orc.maxTracesPorClasse, orc.limiarLentoMs, razaoCopia), 200, { amostragem: razaoCopia }) : Promise.resolve(null);
  const pTent = falhando.length ? rodar("DOS-02", "copia", qTentativas(falhando, deAmostra, ate, e.robos), 40) : Promise.resolve(null);
  const pSessoes = appsOps.length ? rodar("DOS-06", "agregados", qSessoesDia(appsOps, ate, e.robos), 20) : Promise.resolve(null);
  const pErros = appsOps.length && paginasOps.length ? rodar("DOS-07", "agregados", qErrosPagina48h(appsOps, paginasOps, ate, e.robos), 100) : Promise.resolve(null);
  const razaoUE = razaoAmostra(sessoesNaAmostra * 80, 2_000_000);
  const filaUE = (async () => {
    const r: { lcp: Linha[] | null; js: Linha[] | null; mob: Linha[] | null } = { lcp: null, js: null, mob: null };
    let feitas = 0, ultima = 0;
    const ue = async (id: string, texto: string, max: number) => {
      if (feitas >= orc.maxConsultasUserEvents) { consultas.push({ id, fonte: "user.events", bytes: null, linhas: 0, ms: 0, pulada: "limite de consultas" }); return null; }
      feitas++;
      const x = await rodar(id, "user.events", texto, max, { amostragem: razaoUE, orcamentoAntes: ultima });
      ultima = Math.max(ultima, consultas[consultas.length - 1]?.bytes ?? 0);
      return x;
    };
    const pagsLcp = unicos(planos.filter((p) => p.lcp).flatMap((p) => p.paginas.map((x) => x.view)));
    const pagsJs = unicos(planos.filter((p) => p.js).flatMap((p) => p.paginas.map((x) => x.view)));
    const mobs = planos.filter((p) => p.mobile);
    const appsMob = unicos(mobs.flatMap((p) => p.op.apps.filter((a) => (e.apps.find((x) => x.id === a)?.canal ?? (a.includes("-") ? "mobile" : "web")) === "mobile")));
    // na ordem da prioridade: a primeira oportunidade que precisa de cada leitura decide a ordem
    const ordem: string[] = [...new Set(planos.map((p) => (p.js ? "js" : p.lcp ? "lcp" : p.mobile ? "mob" : "")).filter(Boolean))];
    for (const k of ["js", "lcp", "mob"]) if (!ordem.includes(k)) ordem.push(k);
    for (const k of ordem) {
      if (k === "lcp" && pagsLcp.length) { avisar("frontend"); r.lcp = await ue("DOS-10", qLcp(pagsLcp, deAmostra, ate, e.robos, razaoUE), 60); }
      if (k === "js" && pagsJs.length) { avisar("frontend"); r.js = await ue("DOS-11", qJs(pagsJs, deAmostra, ate, e.robos, razaoUE), 80); }
      if (k === "mob" && appsMob.length) { avisar("frontend"); r.mob = await ue("DOS-12", qMobile(appsMob, unicos(mobs.flatMap((p) => p.endpoints.map((x) => x.caminho))), deAmostra, ate, e.robos, razaoUE), 60); }
    }
    return r;
  })();

  // 2) spans dos traces da amostra (uma leitura para todas as oportunidades)
  const amostraLinhas = (await pAmostra) ?? [];
  avisar("traces");
  type Grupo = { app: string; caminho: string; classe: string; n: number; sessoes: number; p50: number | null; p95: number | null; status: string[]; traces: { t: number; trace: string }[] };
  const grupos: Grupo[] = amostraLinhas.map((l) => ({
    app: String(l.app ?? ""), caminho: String(l.caminho ?? ""), classe: String(l.classe ?? ""), n: n(l.n), sessoes: n(l.sessoes), p50: nn(l.p50), p95: nn(l.p95),
    status: (Array.isArray(l.status) ? l.status : []).filter(Boolean).map(String),
    traces: (Array.isArray(l.amostra) ? l.amostra : []).map((a) => ({ t: Date.parse(String((a as Linha)?.t ?? "")), trace: String((a as Linha)?.trace ?? "") })).filter((a) => /^[0-9a-f]{32}$/i.test(a.trace) && Number.isFinite(a.t)),
  }));
  // até maxTraces no total: corta igual entre os grupos
  let porGrupo = orc.maxTracesPorClasse;
  while (porGrupo > 1 && grupos.reduce((s, g) => s + Math.min(g.traces.length, porGrupo), 0) > orc.maxTraces) porGrupo--;
  for (const g of grupos) g.traces = g.traces.sort((a, b) => b.t - a.t).slice(0, porGrupo);
  const todos = grupos.flatMap((g) => g.traces);
  let spans: Span[] = [];
  if (todos.length) {
    const ts = todos.map((x) => x.t);
    const de = iso(Math.max(Math.min(...ts) - 60000, Math.max(...ts) - 35 * 60000)), fim = iso(Math.max(...ts) + 120000);
    const linhas = await rodar("DOS-03", "spans", qSpansDosTraces(unicos(todos.map((x) => x.trace)), de, fim), 20000, { orcamentoAntes: 0 });
    spans = (linhas ?? []).map(spanDe);
  }
  const porTrace = new Map<string, Span[]>();
  for (const s of spans) { if (!porTrace.has(s.trace)) porTrace.set(s.trace, []); porTrace.get(s.trace)!.push(s); }
  const analises = new Map<string, AnaliseTrace>();
  for (const [tr, xs] of porTrace) { const a = analisarTrace(xs); if (a) analises.set(tr, a); }

  // 3) métrica, Davis e mudanças dos serviços e hosts dos traces
  avisar("metricas");
  const servicos = unicos([...analises.values()].flatMap((a) => a.servicos)).slice(0, 30);
  const hosts = unicos([...analises.values()].flatMap((a) => a.hosts)).slice(0, 30);
  const [servLinhas, hostLinhas, davisLinhas, mudLinhas] = await Promise.all([
    servicos.length ? rodar("DOS-04", "metrica", qServicos48h(servicos, ate), 300) : Promise.resolve(null),
    hosts.length ? rodar("DOS-05", "metrica", qHosts(hosts, e.periodo.de, ate), 60) : Promise.resolve(null),
    servicos.length ? rodar("DOS-08", "davis", qDavis(servicos, ate), 20, { orcamentoAntes: 0 }) : Promise.resolve(null),
    servicos.length ? rodar("DOS-09", "eventos", qMudancas48h(servicos, ate), 20, { orcamentoAntes: 0 }) : Promise.resolve(null),
  ]);
  const [tentLinhas, sessLinhas, errLinhas, ue] = await Promise.all([pTent, pSessoes, pErros, filaUE]);

  // sessões por dia: o último dia inteiro com dado
  const sessoesPorDia: Record<string, number> = {};
  for (const l of sessLinhas ?? []) {
    const v = (Array.isArray(l.entradas) ? l.entradas : []).map((x) => nn(x));
    const inteiros = v.slice(0, -1).filter((x): x is number => x != null && x > 0);
    if (inteiros.length) sessoesPorDia[nomeApp(String(l.app))] = Math.round(inteiros[inteiros.length - 1]);
  }
  const blocos6h = (l: Linha, campo: string) => {
    const ini = Date.parse(String((l.timeframe as Linha | undefined)?.start ?? "")), v = Array.isArray(l[campo]) ? (l[campo] as unknown[]) : [];
    return v.map((x, i) => ({ de: Number.isFinite(ini) ? hora(ini + i * 6 * 36e5) : `bloco ${i + 1}`, v: nn(x) }));
  };

  // 4) um dossiê por oportunidade
  const dossies: DossieLlm[] = planos.map((p) => {
    const o = p.op, apps = new Set(o.apps);
    const secoes: Record<string, unknown> = {};
    // negócio: números da tela, sessões por dia, passo do fluxo, jornadas e tentativas
    const paginasNeg = p.paginas.map((pg) => {
      const pr = e.inicio.problemas.find((x) => x.app === pg.app && x.view === pg.view);
      if (!pr) return { aplicacao: nomeApp(pg.app), pagina: pg.view };
      const c = pr.fluxo ? e.inicio.caminhos[pr.fluxo.indice] : null, i = pr.fluxo?.etapa ?? -1;
      const conv = c && i >= 0 && i + 1 < c.passos.length ? {
        passos: c.passos.slice(Math.max(0, i - 1), i + 2), chegaram_ao_passo: c.chegaram[i], com_erro_no_passo: c.comErro[i],
        conversao_com_erro_pct: pct((c.comErroSeguiram[i] ?? 0) + (c.comErroDepois[i] ?? 0), c.comErro[i]), conversao_sem_erro_pct: pct(Math.max(0, c.chegaram[i + 1] - (c.comErroSeguiram[i] ?? 0)), c.chegaram[i] - c.comErro[i]),
        com_erro_tentaram_de_novo_e_seguiram: c.comErroDepois[i] ?? 0, sairam_apos_o_erro: c.sairamAposErro[i] ?? 0,
      } : null;
      const sd = e.inicio.saidas.find((x) => x.app === pg.app && x.view === pg.view);
      const saida = sd ? { sessoes_que_terminaram_na_pagina: sd.fins, pct_saida_com_o_erro: pct(pr.desistiram, pr.afetados), pct_saida_sem_o_erro: pct(Math.max(0, sd.fins - pr.desistiram), Math.max(0, pr.visitantes - pr.afetados)) } : null;
      return { aplicacao: nomeApp(pg.app), pagina: pg.view, clientes_com_erro: pr.afetados, visitantes: pr.visitantes, pct_afetados: r1(pr.pctAfetados), sairam_logo_apos_o_erro: pr.desistiram,
        nao_concluiram: pr.fluxo?.naoConcluiram ?? 0, ...(saida ? { saida_da_pagina: saida } : {}), passo_do_fluxo_principal: conv };
    });
    const jornadas = (e.jornadas ?? []).filter((j) => j.passos.some((s) => p.paginas.some((pg) => pg.app === s.app && pg.view === s.view))).slice(0, 2)
      .map((j) => ({ jornada: j.nome, entraram: j.funil.entraram, concluiram: j.funil.concluiram, conversao_pct: r1(j.funil.conversao), passos: j.funil.passos.map((s) => ({ pagina: s.view, sessoes: s.sessoes, nao_seguiram: s.dropOff, nao_seguiram_com_erro: s.dropOffComErro })) }));
    const tent = (tentLinhas ?? []).filter((l) => apps.has(String(l.app)) && p.endpoints.some((x) => !x.lento && x.caminho === l.caminho)).map((l) => ({
      aplicacao: nomeApp(String(l.app)), chamada: l.caminho, sessoes_que_chamaram: n(l.sessoes), sessoes_com_falha: n(l.com_falha), uma_vez: n(l.uma), duas_vezes: n(l.duas), tres_ou_mais: n(l.tres_ou_mais),
      tentativas_media: r1(n(l.tent_media)), tentativas_max: n(l.tent_max), conseguiu_depois_de_falhar: n(l.conseguiu_depois_de_falhar), nunca_conseguiu: n(l.nunca_conseguiu) }));
    secoes.negocio = {
      // listas (o nome da aplicação não vira chave: as chaves do dossiê são fixas)
      sessoes_por_dia: o.apps.map((a) => ({ aplicacao: nomeApp(a), sessoes: sessoesPorDia[nomeApp(a)] ?? null })),
      // no escopo padrão, as sessões da Visão geral são da última hora e as das páginas e caminhos, das 24 h analisadas
      ...(e.inicio.periodos
        ? { sessoes_na_ultima_hora: e.inicio.porApp.filter((x) => apps.has(x.app)).map((x) => ({ aplicacao: nomeApp(x.app), sessoes: x.sessoes })),
            sessoes_nas_24h_analisadas: (e.inicio.porApp24 ?? []).filter((x) => apps.has(x.app)).map((x) => ({ aplicacao: nomeApp(x.app), sessoes: x.sessoes })) }
        : { sessoes_no_periodo_da_tela: e.inicio.porApp.filter((x) => apps.has(x.app)).map((x) => ({ aplicacao: nomeApp(x.app), sessoes: x.sessoes })) }),
      paginas: paginasNeg, ...(jornadas.length ? { jornadas } : {}), ...(tent.length ? { novas_tentativas_por_sessao: tent } : {}),
    };
    // backend: amostra e traces por endpoint e classe
    if (p.endpoints.length) {
      secoes.backend = p.endpoints.map((ep) => {
        const gs = grupos.filter((g) => apps.has(g.app) && g.caminho === ep.caminho);
        const classes = ep.lento ? ["lenta", "rapida"] : ["falha", "sucesso"];
        const porClasse: Record<string, unknown> = {};
        for (const c of classes) {
          const gc = gs.filter((g) => g.classe === c);
          const as = gc.flatMap((g) => g.traces.map((x) => analises.get(x.trace)).filter((a): a is AnaliseTrace => !!a));
          porClasse[c] = {
            chamadas_na_janela_da_amostra: gc.reduce((s, g) => s + g.n, 0), sessoes: gc.reduce((s, g) => s + g.sessoes, 0), status_http: unicos(gc.flatMap((g) => g.status)).slice(0, 4),
            duracao_no_cliente_ms: gc.map((g) => ({ aplicacao: nomeApp(g.app), chamadas: g.n, p50: g.p50 != null ? r1(g.p50) : null, p95: g.p95 != null ? r1(g.p95) : null })),
            traces: resumirTraces(as, c) ?? "sem trace lido nesta classe",
          };
        }
        // a origem da falha quando dá certo: o que o mesmo serviço e endpoint chama nas chamadas sem falha
        let origemQuandoDaCerto: unknown = null;
        if (!ep.lento) {
          const origens = gs.filter((g) => g.classe === "falha").flatMap((g) => g.traces.map((x) => analises.get(x.trace)?.origem)).filter((s): s is Span => !!s);
          const alvo = contar(origens.map((s) => `${s.svc}|${s.nome}`))[0]?.valor;
          if (alvo) {
            const [svc, nome] = alvo.split("|");
            const ok = gs.filter((g) => g.classe === "sucesso").flatMap((g) => g.traces.map((x) => porTrace.get(x.trace) ?? [])).flat().filter((s) => s.kind === "server" && s.svc === svc && s.nome === nome && !falhou(s));
            const filhos = (s: Span) => spans.filter((c) => c.pai === s.id && c.trace === s.trace);
            const falhas = origens.filter((s) => s.svc === svc && s.nome === nome);
            origemQuandoDaCerto = ok.length ? {
              servico: proxy(ok[0]) ? `${svc} (proxy)` : `${svc} ${nome}`, spans_sem_falha: ok.length,
              duracao_ms_sem_falha_p50: q(ok.map((s) => s.d), 50), duracao_ms_com_falha_p50: q(falhas.map((s) => s.d), 50),
              chamadas_ao_banco_media_sem_falha: r1(ok.reduce((m, s) => m + filhos(s).filter((c) => c.db).length, 0) / ok.length),
              chamadas_http_media_sem_falha: r1(ok.reduce((m, s) => m + filhos(s).filter((c) => !c.db && c.kind === "client").length, 0) / ok.length),
            } : "o serviço de origem não aparece sem falha na amostra";
          }
        }
        return { chamada: ep.caminho, ...(ep.status ? { status_da_oportunidade: ep.status } : {}), papel: ep.lento ? "chamada que segura a página" : "chamada que falha", ...porClasse, ...(origemQuandoDaCerto ? { origem_quando_da_certo: origemQuandoDaCerto } : {}) };
      });
      // por estado: as chamadas por endpoint e estado que a tela já leu (QUA-U)
      const est = (e.chamadas ?? []).filter((l) => apps.has(l.app) && p.endpoints.some((x) => x.caminho === l.caminho) && l.regiao);
      if (est.length) {
        const porLugar = new Map<string, { total: number; falhas: number; lentas: number; p75: number | null }>();
        for (const l of est) { const k = `${l.caminho} | ${l.regiao}`; const x = porLugar.get(k) ?? { total: 0, falhas: 0, lentas: 0, p75: null }; x.total += l.total; x.falhas += l.falhas; x.lentas += l.lentas; x.p75 = l.p75Ms != null ? Math.max(x.p75 ?? 0, l.p75Ms) : x.p75; porLugar.set(k, x); }
        secoes.por_estado = [...porLugar].filter(([, x]) => x.total >= 10).sort((a, b) => b[1].total - a[1].total).slice(0, 12).map(([k, x]) => {
          const [chamada, estado] = k.split(" | ");
          return { chamada, estado, chamadas: x.total, pct_falha: pct(x.falhas, x.total), pct_lentas: pct(x.lentas, x.total - x.falhas), p75_ms: x.p75 };
        });
      }
    }
    // saúde por métrica e início do problema: serviços e hosts dos traces desta oportunidade
    const asOp = grupos.filter((g) => apps.has(g.app) && p.endpoints.some((x) => x.caminho === g.caminho)).flatMap((g) => g.traces.map((x) => analises.get(x.trace))).filter((a): a is AnaliseTrace => !!a);
    const servOp = new Set(asOp.flatMap((a) => a.servicos)), hostOp = new Set(asOp.flatMap((a) => a.hosts));
    const nomesEndpoints = new Set([...p.endpoints.map((x) => x.caminho), ...asOp.flatMap((a) => [a.origem, a.lentidao, a.entrada].filter((s): s is Span => !!s && !proxy(s)).map((s) => s.nome))]);
    const serie = (servLinhas ?? []).filter((l) => servOp.has(String(l.ent)) && [...nomesEndpoints].some((x) => String(l.endpoint ?? "").includes(x)))
      .sort((a, b) => (Array.isArray(b.falhas) ? (b.falhas as number[]).reduce((s, v) => s + n(v), 0) : 0) - (Array.isArray(a.falhas) ? (a.falhas as number[]).reduce((s, v) => s + n(v), 0) : 0)).slice(0, 4)
      .map((l) => {
        const req = blocos6h(l, "req"), fal = blocos6h(l, "falhas"), p95 = blocos6h(l, "p95");
        return { servico: String(l.servico ?? ""), endpoint: String(l.endpoint ?? ""), blocos_de_6h: req.map((x, i) => ({ de: x.de, chamadas: x.v ?? 0, pct_falha: pct(fal[i]?.v ?? 0, x.v ?? 0), p95_ms: p95[i]?.v == null ? null : r1(p95[i].v! / 1000) })).filter((x) => x.chamadas > 0) };
      });
    const errosPag = somarErrosPagina((errLinhas ?? []).filter((l) => apps.has(String(l.app)) && p.paginas.some((pg) => pg.view === l.pagina))).slice(0, 4)
      .map((l) => ({ aplicacao: nomeApp(String(l.app)), pagina: String(l.pagina), tipo: String(l.tipo ?? ""), erros_por_6h: blocos6h(l, "erros").map((x) => ({ de: x.de, erros: x.v ?? 0 })) }));
    if (serie.length || errosPag.length) secoes.inicio_do_problema = { ...(serie.length ? { endpoints_no_servidor_48h: serie } : {}), ...(errosPag.length ? { erros_no_cliente_48h: errosPag } : {}) };
    const hostsOp = (hostLinhas ?? []).filter((l) => hostOp.has(String(l.ent))).slice(0, 6).map((l) => ({ host: String(l.host ?? ""), cpu_pct: (Array.isArray(l.cpu) ? l.cpu : []).map((v) => (v == null ? null : r1(n(v)))), memoria_pct: (Array.isArray(l.mem) ? l.mem : []).map((v) => (v == null ? null : r1(n(v)))) }));
    if (hostsOp.length) secoes.saude_metricas = { hosts_dos_traces_por_hora: hostsOp };
    const davis = (davisLinhas ?? []).filter((l) => servOp.has(String(l.causa_id)) || (Array.isArray(l.afetados) && (l.afetados as unknown[]).flat().some((x) => servOp.has(String(x))))).slice(0, 5)
      .map((l) => ({ problema: String(l.nome ?? ""), causa_raiz_apontada: String(l.causa ?? ""), categoria: String(l.categoria ?? ""), quantos: n(l.problemas), abertos: n(l.abertos), primeiro: hora(Date.parse(String(l.primeiro))), ultimo: hora(Date.parse(String(l.ultimo))), duracao_p50_min: Math.round(n(l.dur_p50_min)) }));
    if (servOp.size) secoes.davis = davis.length ? davis : t("nenhum problema do Davis nos serviços dos traces em 24 h", "no Davis problem on the trace services in 24 h");
    if (servOp.size && mudLinhas) secoes.mudancas = mudLinhas.length ? mudLinhas.slice(0, 6).map((l) => ({ tipo: String(l.tipo ?? ""), eventos: n(l.n), primeiro: hora(Date.parse(String(l.primeiro))), ultimo: hora(Date.parse(String(l.ultimo))), nomes: (Array.isArray(l.nomes) ? l.nomes : []).slice(0, 3), versoes: (Array.isArray(l.versoes) ? l.versoes : []).filter(Boolean).slice(0, 3) }))
      : t("nenhum evento de deploy, configuração, reinício ou término nos serviços dos traces em 48 h", "no deployment, configuration, restart or termination event on the trace services in 48 h");
    // frontend: LCP e JavaScript
    const front: Record<string, unknown> = {};
    if (p.lcp && ue.lcp) {
      const vs = new Set(p.paginas.map((x) => x.view));
      const ls = ue.lcp.filter((l) => vs.has(String(l.pagina)));
      const porCarga = (lento: boolean) => ls.filter((l) => (l.lento === true || l.lento === "true") === lento);
      const bloco = (lento: boolean) => {
        const xs = porCarga(lento); if (!xs.length) return null;
        const b = xs[0];
        return { cargas: n(b.cargas), lcp_p75_ms: Math.round(n(b.lcp_p75)), fcp_p75_ms: Math.round(n(b.fcp_p75)), ttfb_documento_p75_ms: r1(n(b.ttfb_p75)), cls_p75: n(b.cls_p75), inp_p75_ms: nn(b.inp_p75),
          elemento_do_lcp: b.lcp_tags, elemento_que_desloca: b.cls_tags, deslocamento_ms_p50: Math.round(n(b.cls_t_p50)),
          o_que_termina_logo_antes_do_lcp: xs.filter((l) => l.caminho != null && n(l.antes_do_lcp) > 0).slice(0, 4).map((l) => ({ requisicao: txt(l.caminho, 120), cargas_em_que_termina_antes_do_lcp: n(l.antes_do_lcp), duracao_p50_ms: r1(n(l.dur_p50)), duracao_p75_ms: r1(n(l.dur_p75)), termina_antes_do_lcp_ms_p50: nn(l.delta_p50) == null ? null : r1(n(l.delta_p50)) })) };
      };
      front.lcp = { amostra_1_em: razaoUE, cargas_lentas_lcp_acima_4s: bloco(true), cargas_rapidas: bloco(false) };
    }
    if (p.js && ue.js) {
      const vs = new Set(p.paginas.map((x) => x.view));
      const ls = ue.js.filter((l) => vs.has(String(l.pagina)));
      const tot = ls.reduce((s, l) => s + n(l.cargas), 0), comErro = ls.reduce((s, l) => s + n(l.com_erro), 0);
      const sigs = contar(ls.flatMap((l) => (Array.isArray(l.sigs) ? l.sigs : []).filter(Boolean).map((s) => s as Linha).map((s) => ({ tipo: txt(s.tipo, 60), mensagem: txt(s.msg, 160), arquivo_linha_coluna: s.arq ? `${txt(s.arq, 80)}:${s.linha ?? "?"}:${s.col ?? "?"}` : null, origem_do_script: txt(s.prov, 30), pilha: txt(String(s.pilha ?? "").split("\n").slice(0, 3).map((x) => x.trim()).join(" < ").replace(/https?:\/\/[^/\s]+/g, ""), 300) }))));
      const pesos = ls.filter((l) => nn(l.atraso_p50) != null);
      front.javascript = {
        amostra_1_em: razaoUE, cargas: tot, cargas_com_erro: comErro, pct_cargas_com_erro: pct(comErro, tot),
        assinaturas: sigs.slice(0, 3).map((x) => x.valor),
        erro_acontece_depois_do_inicio_da_pagina_ms: pesos.length ? { p10_min: Math.min(...pesos.map((l) => n(l.atraso_p10))), p50_por_navegador: pesos.slice(0, 5).map((l) => r1(n(l.atraso_p50))), p90_max: Math.max(...pesos.map((l) => n(l.atraso_p90))) } : null,
        chamadas_da_pagina_nas_cargas_com_erro: { deram_certo: ls.reduce((s, l) => s + n(l.req_ok_com_erro), 0), falharam: ls.reduce((s, l) => s + n(l.req_falhou_com_erro), 0), duracao_p75_ms: q(ls.map((l) => n(l.req_ms_p75)), 50) },
        por_navegador_e_sistema: ls.slice(0, 8).map((l) => ({ pagina: String(l.pagina), navegador: txt(l.navegador, 40), sistema: txt(l.so, 40), cargas: n(l.cargas), com_erro: n(l.com_erro), pct: pct(n(l.com_erro), n(l.cargas)) })),
        // as outras páginas da mesma leitura (outras oportunidades de JavaScript): o mesmo momento e o mesmo arquivo em
        // páginas e mensagens diferentes apontam um mecanismo comum, que uma página sozinha não mostra
        ...(() => {
          const outras = [...new Set(ue.js!.map((l) => String(l.pagina)).filter((pg) => !vs.has(pg)))].slice(0, 3).map((pg) => {
            const xs = ue.js!.filter((l) => String(l.pagina) === pg), c = xs.reduce((s, l) => s + n(l.cargas), 0), k = xs.reduce((s, l) => s + n(l.com_erro), 0);
            const sig = xs.flatMap((l) => (Array.isArray(l.sigs) ? l.sigs : []).filter(Boolean) as Linha[])[0];
            const at = xs.filter((l) => nn(l.atraso_p50) != null).map((l) => n(l.atraso_p50));
            return { pagina: pg, cargas: c, pct_cargas_com_erro: pct(k, c), erro_depois_do_inicio_ms_p50: at.length ? r1(at.sort((a, b) => a - b)[Math.floor(at.length / 2)]) : null, tipo: sig ? txt(sig.tipo, 60) : null, arquivo_linha: sig?.arq ? `${txt(sig.arq, 80)}:${sig.linha ?? "?"}` : null };
          }).filter((x) => x.pct_cargas_com_erro > 0);
          return outras.length ? { outras_paginas_com_erro_na_mesma_leitura: outras } : {};
        })(),
      };
    }
    if (Object.keys(front).length) secoes.frontend = front;
    // mobile: falhas e crash do app
    if (p.mobile && ue.mob) {
      const caminhos = new Set(p.endpoints.map((x) => x.caminho));
      // telas genéricas (MainActivity, nome de pacote) não ligam uma exceção à oportunidade
      const telasOp = new Set(p.paginas.map((x) => x.view).filter((v) => !/Activity$/.test(v) && !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+\.[A-Z]\w*$/.test(v)));
      const ehReq = (l: Linha) => l.classe === "requisicao_ok" || l.classe === "requisicao_falha";
      const ls = ue.mob.filter((l) => apps.has(String(l.app)) && (ehReq(l) ? caminhos.has(String(l.caminho)) : (/crash|anr/i.test(String(l.classe)) || (Array.isArray(l.telas) && (l.telas as unknown[]).some((x) => telasOp.has(String(x)))))));
      secoes.mobile = {
        amostra_1_em: razaoUE,
        por_tipo_chamada_rede_versao_sistema: ls.slice(0, 14).map((l) => ({ evento: String(l.classe), chamada: l.caminho == null ? null : txt(l.caminho, 120), status: l.status == null ? null : String(l.status), rede: txt(l.rede, 30), versao_app: txt(l.versao, 30), sistema: txt(l.so, 30),
          ocorrencias: n(l.n), sessoes: n(l.sessoes), tempo_no_app_p50_ms: r1(n(l.ms_p50)), p95_ms: r1(n(l.ms_p95)), falhas_sem_resposta_de_rede: n(l.sem_resposta), telas: (Array.isArray(l.telas) ? l.telas : []).slice(0, 3),
          ...(l.classe !== "requisicao_ok" && l.classe !== "requisicao_falha" && l.sig ? { assinatura: { tipo: txt((l.sig as Linha).tipo, 80), mensagem: txt((l.sig as Linha).msg, 160), pilha: txt(String((l.sig as Linha).pilha ?? "").split("\n").slice(0, 3).map((x) => x.trim()).join(" < "), 300) } } : {}) })),
      };
    }
    const bruto: DossieLlm = {
      versao: 1, id: p.id, titulo: o.titulo, tipo: p.tipo, canal: o.canal, aplicacoes: o.apps.map(nomeApp), regras: o.regras,
      o_que_a_tela_mostra: { impacto: o.impactoTexto, evidencia: o.evidencia, acao_sugerida: o.acao,
        numeros: { nao_concluiram: o.impacto.naoConcluiram, sairam_apos_o_erro: o.impacto.encerraram, outros_afetados: o.impacto.afetados, lentos: o.impacto.lentos, com_falha: o.impacto.comFalha, pontuacao: o.pontuacao } },
      janelas: {
        tela: e.periodo.rotulo, amostra: `${hora(deAmostraMs)} a ${hora(fimMs)} (${Math.round(minutosAmostra)} min)`,
        traces: t(`até ${porGrupo} chamadas por classe e endpoint, as mais recentes da amostra`, `up to ${porGrupo} calls per class and endpoint, the most recent in the sample`),
        metricas: t("48 h em blocos de 6 h; sessões por dia: último dia inteiro", "48 h in 6 h blocks; sessions per day: last full day"),
      },
      secoes, cortes: [],
    };
    return ajustarDossie(sanitizarDossie(bruto), orc.maxBytesDossie);
  });

  const porFonte: Record<string, { consultas: number; bytes: number }> = {};
  for (const c of consultas.filter((x) => !x.pulada)) { const f = (porFonte[c.fonte] ??= { consultas: 0, bytes: 0 }); f.consultas++; f.bytes += c.bytes ?? 0; }
  const bytes = gasto();
  const custoRs = (bytes / GIB) * orc.tarifaRsPorGiB;
  const contexto = sanitizarContexto({
    versao: 1, periodo: e.periodo, escopo: e.escopo, aplicacoes: unicos(planos.flatMap((p) => p.op.apps)).map((a) => ({ nome: nomeApp(a), canal: e.apps.find((x) => x.id === a)?.canal ?? null })),
    idioma: e.idioma ?? "pt", versaoApp: e.versaoApp ?? null, sessoesPorDia,
    coleta: { consultas: consultas.filter((c) => !c.pulada).length, bytes, custoRs, duracaoMs: agora() - inicio, porFonte },
  });
  const achados = [...dossies.flatMap((d) => verificarDossie(d).map((a) => ({ onde: `${d.id}.${a.onde}`, tipo: a.tipo }))), ...verificarContexto(contexto).map((a) => ({ onde: `contexto.${a.onde}`, tipo: a.tipo }))];
  avisar("pronto");
  return { dossies, contexto, consultas, bytes, custoRs, duracaoMs: agora() - inicio, achados };
}

/** Bytes de um dossiê (para a tela). */
export const tamanhoDossie = (d: DossieLlm) => bytesDe(d);
