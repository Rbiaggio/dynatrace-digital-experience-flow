/* Pré-requisitos do Digital Experience Flow num tenant: as extrações da cópia enxuta no pipeline de user.events (próprio ou
   o de um pipeline existente, modo integrado), o pipeline de business events com os 4 buckets da cópia e o dos agregados, roteamentos.
   Sem métricas próprias desde a 1.41 (lib/agregados.ts). O backend não tem
   pré-requisito: vem do modelo de entidades (quem chama quem) e da métrica nativa dos serviços.
   Sem dependência do SDK: recebe um cliente HTTP (no app, @dynatrace-sdk/http-client com a identidade do usuário;
   em Node, fetch com token) para a mesma lógica ser testada fora do navegador. */

export interface RespostaHttp { status: number; dados: any }
export interface ClienteHttp { chamar(metodo: string, url: string, corpo?: unknown, params?: Record<string, string>): Promise<RespostaHttp> }

/** Versões até 1.3.x criavam métricas de spans (rum_flow.span.*) e este bucket; o Aplicar remove a rota e o pipeline
    de spans do DEF e o bucket fica (tem dados), só com o aviso de que pode ser apagado. */
export const BUCKET_SPANS_LEGADO = "rum_flow_spans";
/** Bucket único da cópia até a etapa 6. Depois da divisão fica com o que já tinha até a retenção (7 dias) e o app ainda o
    lê nas janelas que começam antes do último registro dele (lib/queries.ts, bucketsDaLeitura). */
export const BUCKET_PASSOS = "rum_flow_passos";
/** Etapa 6: a cópia em 3 buckets, um por grupo de registro, para cada consulta ler só o que precisa (o Grail cobra os bytes
    dos buckets lidos na janela). Os mesmos nomes de BUCKETS_COPIA em lib/queries.ts. */
export const BUCKETS_PASSOS = { nav: "rum_flow_passos_nav", erro: "rum_flow_passos_erro", req: "rum_flow_passos_req", exp: "rum_flow_passos_exp" } as const;
/** Arquitetura de 19/10/2026 (lib/agregados.ts): a cópia ganha os registros de EXPERIÊNCIA (resumo da tela, clique, ação e
    abertura do app, nota de Apdex da carga) num 4º bucket, que só a ação de agregação lê, e os agregados que ela grava vão
    para um bucket próprio, pequeno. Os três tipos de evento passam pelo mesmo pipeline de business events do DEF. */
export const TIPO_PASSO = "journeyflow.passo";
export const TIPO_EXPERIENCIA = "journeyflow.experiencia";
export const TIPO_AGREGADO = "journeyflow.agregado";
export const BUCKET_AGREGADOS = "rum_flow_agregados";
/** 1.43: os erros com exemplos (grupo errx das fatias) e a análise de hora em hora em buckets próprios: quem lê 24 h ou 7
    dias de um deles não varre os outros (num ambiente grande, os erros com exemplos são várias vezes o resto dos agregados). */
export const TIPO_ERRO_AMOSTRA = "journeyflow.erro";
export const TIPO_HORA = "journeyflow.hora";
export const BUCKET_ERROS = "rum_flow_erros";
export const BUCKET_HORAS = "rum_flow_horas";
/** Cada registro em exatamente um bucket: navegação, erro e o resto (as requisições XHR/fetch e as do mobile; também um
    registro sem classificador, que hoje não existe na cópia), pelo tipo de evento da cópia; experiência e agregados pelo
    tipo de evento deles. Condições que se excluem e cobrem tudo, então não depende de o estágio de armazenamento parar na
    primeira que casa. */
const DA_COPIA = `event.type == "${TIPO_PASSO}"`;
export const MATCHERS_PASSOS = {
  nav: `${DA_COPIA} and characteristics.classifier == "navigation"`,
  erro: `${DA_COPIA} and characteristics.classifier == "error"`,
  req: `${DA_COPIA} and (isNull(characteristics.classifier) or (characteristics.classifier != "navigation" and characteristics.classifier != "error"))`,
  exp: `event.type == "${TIPO_EXPERIENCIA}"`,
} as const;
export const MATCHER_AGREGADOS = `event.type == "${TIPO_AGREGADO}"`;
export const MATCHER_ERROS = `event.type == "${TIPO_ERRO_AMOSTRA}"`;
export const MATCHER_HORAS = `event.type == "${TIPO_HORA}"`;
const NOMES_BUCKETS_PASSOS = { nav: "Digital Experience Flow - copia: navegacao", erro: "Digital Experience Flow - copia: erro", req: "Digital Experience Flow - copia: requisicao", exp: "Digital Experience Flow - copia: experiencia" } as const;
const NOME_BUCKET_AGREGADOS = "Digital Experience Flow - agregados por fatia de 5 min";
const NOME_BUCKET_ERROS = "Digital Experience Flow - erros com exemplos por fatia de 5 min";
const NOME_BUCKET_HORAS = "Digital Experience Flow - analise de hora em hora";
const CAMPOS_PASSO = ["start_time", "dt.rum.session.id", "dt.rum.application.id", "characteristics.classifier", "view.name", "view.source.name", "navigation.type", "dt.rum.user_type", "error.type", "error.display_name", "exception.message", "exception.type", "http.response.status_code", "characteristics.has_request", "characteristics.has_failed_request", "request.type", "url.path", "url.domain", "duration", "trace.id", "view.sequence_number", "dt.rum.application.entity", "os.name", "browser.name", "app.short_version", "geo.country.iso_code", "geo.region.name", "navigation.tab_state", "url.provider", "page.source.url.path", "dt.rum.adk", "characteristics.has_crash", "characteristics.has_anr"];
/** Registros de experiência (4º bucket): o que os agregados de view, clique, Apdex web da carga, Apdex mobile e Apdex por
    lugar precisam; nada de sessão. Exclui o que já vai na cópia de navegação, erro e requisição (cada registro numa cópia só). */
const CAMPOS_EXPERIENCIA = ["start_time", "dt.rum.application.id", "characteristics.classifier", "view.name", "dt.rum.user_type", "view.foreground_time", "error.count", "interaction.type", "ui_element.detected_name", "ui_element.tag_name",
  "frontend.name", "page.name", "apdex_score", "os.name", "user_action.name", "user_action.type", "app_start.type", "duration", "geo.country.iso_code", "geo.region.name"];
export const MATCHER_COPIA = 'characteristics.classifier == "navigation" or characteristics.classifier == "error" or (characteristics.classifier == "request" and (request.type == "fetch_xhr" or frontend.type == "mobile"))';
export const MATCHER_EXPERIENCIA = `not (${MATCHER_COPIA}) and (characteristics.classifier == "view_summary" or characteristics.classifier == "user_interaction" or (frontend.type == "mobile" and (characteristics.classifier == "user_action" or characteristics.classifier == "app_start")) or isNotNull(apdex_score))`;
export const RETENCAO_PASSOS = 1;   // a cópia é para o online e para a agregação: 1 dia
export const RETENCAO_AGREGADOS = 8;   // 7 dias da maior janela + 1
export const RETENCAO_ERROS = 8;       // os erros ao vivo também servem a janela de 7 dias
export const RETENCAO_HORAS = 3;       // a tela soma as últimas 24 horas analisadas; a ação confere 23 horas para trás
export const PIPELINE_ID = "rum-flow";
export const SCHEMAS = {
  pipelinesEventos: "builtin:openpipeline.user.events.pipelines",
  rotaEventos: "builtin:openpipeline.user.events.routing",
  pipelinesSpans: "builtin:openpipeline.spans.pipelines",
  rotaSpans: "builtin:openpipeline.spans.routing",
  pipelinesBiz: "builtin:openpipeline.bizevents.pipelines",
  rotaBiz: "builtin:openpipeline.bizevents.routing",
};
const SETTINGS = "/platform/classic/environment-api/v2/settings/objects";
const BUCKETS = "/platform/storage/management/v1/bucket-definitions";

const dims = (...campos: string[]) => campos.map((c) => ({ strategy: "equals", extractionType: "field", sourceFieldName: c }));
const processador = (id: string, type: string, matcher: string, description: string, extra: Record<string, unknown>) => ({ id, type, enabled: true, matcher, description, ...extra });

/** Nome da página sem o parâmetro de caminho (";jsessionid=<id>" de aplicação Java com URL rewriting): tudo a partir do
    primeiro ";" sai, a mesma regra de um processador rum.page comum. A cópia leva o nome cru; a agregação (lib/agregados.ts) e as
    leituras da cópia (lib/queries.ts) cortam. Até a 1.40 um processador do pipeline gravava o nome limpo em campos def.*
    para as métricas. */
export const semParametro = (campo: string) => `if(indexOf(${campo}, ";") >= 0, substring(${campo}, from: 0, to: indexOf(${campo}, ";")), else: ${campo})`;

/** Apdex mobile: as regras que a agregação aplica a cada registro do app (lib/agregados.ts, grupo "amob"; até a 1.40 eram
    regras de métrica do rum_flow.mobile_apdex), com o item e a faixa (satisfeito = 1, tolerante = 0,5, frustrado_tempo e
    frustrado_erro = 0). Apdex = (satisfeitos + tolerantes / 2) / total, por aplicação, tela, sistema ou item.
    Régua:
      acao     · ação do usuário (toque), sem a ação de abertura: até 3 s = 1, até 12 s = 0,5, acima ou com erro = 0;
      abertura · abertura do app a frio até 2 s = 1, até 5 s = 0,5, acima = 0 (morna 1 e 2 s; quente 0,5 e 1,5 s);
      tela     · resumo da tela (view_summary): sem erro = 1, com erro = 0. O app só usa as telas quando a aplicação não
                 manda ação de toque (lib/apdex.ts); a regra grava as duas e a escolha é na consulta;
      crash e anr · crash ou ANR = 0 (error.type "crash" ou "anr", ou characteristics.has_crash / has_anr: no LAB, em
                 17/10, o crash real chegou como error.type "crash", has_crash true e error.is_fatal true).
    Uma regra por item e faixa; cada evento casa no máximo uma (as condições se excluem). duration é do tipo duração: a
    comparação é com literal de duração (3000ms); com número (3000000000) ela dá nulo e a regra nunca casa (provado no LAB
    em 17/10). frontend.type "mobile" vira, na agregação, o id de aplicação com hífen (a cópia não leva frontend.type). */
const MOBILE = 'frontend.type == "mobile"';
const ms = (s: number) => `${Math.round(s * 1000)}ms`;
const SEM_ERRO = "(isNull(error.count) or error.count <= 0)";
const ACAO = `${MOBILE} and characteristics.classifier == "user_action" and (isNull(user_action.type) or user_action.type != "app_start")`;
const ABERTURA = `${MOBILE} and characteristics.classifier == "app_start"`;
const TELA = `${MOBILE} and characteristics.classifier == "view_summary"`;
const ERRO_MOBILE = `${MOBILE} and characteristics.classifier == "error"`;
const E_CRASH = '(error.type == "crash" or characteristics.has_crash == true)';
/** Limites da abertura por tipo, em segundos: [até aqui = 1, até aqui = 0,5]; sem tipo (ou outro) vale a régua a frio. */
export const LIMITES_ABERTURA: Record<"cold" | "warm" | "hot", [number, number]> = { cold: [2, 5], warm: [1, 2], hot: [0.5, 1.5] };
const tipoAbertura = (t: string) => t === "cold" ? '(isNull(app_start.type) or (app_start.type != "warm" and app_start.type != "hot"))' : `app_start.type == "${t}"`;
const abertura = (cond: (a: string, b: string) => string) =>
  `${ABERTURA} and (${Object.entries(LIMITES_ABERTURA).map(([tipo, [a, b]]) => `(${tipoAbertura(tipo)} and ${cond(ms(a), ms(b))})`).join(" or ")})`;
export const REGRAS_APDEX_MOBILE: { id: string; item: "acao" | "abertura" | "tela" | "crash" | "anr"; faixa: "satisfeito" | "tolerante" | "frustrado_tempo" | "frustrado_erro"; matcher: string; descricao: string }[] = [
  { id: "acao-satisfeito", item: "acao", faixa: "satisfeito", matcher: `${ACAO} and ${SEM_ERRO} and duration <= ${ms(3)}`, descricao: "acao ate 3 s sem erro (1)" },
  { id: "acao-tolerante", item: "acao", faixa: "tolerante", matcher: `${ACAO} and ${SEM_ERRO} and duration > ${ms(3)} and duration <= ${ms(12)}`, descricao: "acao de 3 a 12 s sem erro (0,5)" },
  { id: "acao-lenta", item: "acao", faixa: "frustrado_tempo", matcher: `${ACAO} and ${SEM_ERRO} and duration > ${ms(12)}`, descricao: "acao acima de 12 s (0)" },
  { id: "acao-erro", item: "acao", faixa: "frustrado_erro", matcher: `${ACAO} and error.count > 0`, descricao: "acao com erro (0)" },
  { id: "abertura-satisfeito", item: "abertura", faixa: "satisfeito", matcher: abertura((a) => `duration <= ${a}`), descricao: "abertura ate 2 s a frio, 1 s morna, 0,5 s quente (1)" },
  { id: "abertura-tolerante", item: "abertura", faixa: "tolerante", matcher: abertura((a, b) => `duration > ${a} and duration <= ${b}`), descricao: "abertura ate 5 s a frio, 2 s morna, 1,5 s quente (0,5)" },
  { id: "abertura-lenta", item: "abertura", faixa: "frustrado_tempo", matcher: abertura((_a, b) => `duration > ${b}`), descricao: "abertura acima disso (0)" },
  { id: "tela-satisfeito", item: "tela", faixa: "satisfeito", matcher: `${TELA} and ${SEM_ERRO}`, descricao: "tela sem erro (1)" },
  { id: "tela-erro", item: "tela", faixa: "frustrado_erro", matcher: `${TELA} and error.count > 0`, descricao: "tela com erro (0)" },
  { id: "crash", item: "crash", faixa: "frustrado_erro", matcher: `${ERRO_MOBILE} and ${E_CRASH}`, descricao: "crash (0)" },
  { id: "anr", item: "anr", faixa: "frustrado_erro", matcher: `${ERRO_MOBILE} and (error.type == "anr" or characteristics.has_anr == true) and (isNull(error.type) or error.type != "crash") and (isNull(characteristics.has_crash) or characteristics.has_crash != true)`, descricao: "ANR (0)" },
];
/** Apdex por lugar (mapa "Onde estão os clientes"): faixa web pela nota apdex_score do pipeline hospedeiro por carga
    (1 = satisfeito, 0,5 = tolerante, 0 = frustrado); mobile, pelas regras acima, somadas por faixa (frustrado = tempo ou
    erro). A agregação aplica (lib/agregados.ts, grupo "lugar"). */
export const FAIXAS_LUGAR = ["satisfeito", "tolerante", "frustrado"] as const;
export const faixaLugar = (f: string): (typeof FAIXAS_LUGAR)[number] => (f === "satisfeito" ? "satisfeito" : f === "tolerante" ? "tolerante" : "frustrado");

/** Pipeline de user.events do DEF: só as duas extrações para business events, a cópia enxuta (navegação, erro e chamada de
    API) e a de experiência (views, cliques, Apdex). Sem métricas próprias e sem bucket próprio: os eventos ficam no bucket
    padrão de user.events. Até a 1.40 havia ainda o processador de nomes limpos e 24 regras de 10 métricas rum_flow.*. */
export const definirPipelineEventos = () => ({
  customId: PIPELINE_ID, displayName: "Digital Experience Flow", routing: "routable",
  processing: { processors: [] as ReturnType<typeof processador>[] },
  metricExtraction: { processors: [] as ReturnType<typeof processador>[] },
  storage: { processors: [] },
  dataExtraction: { processors: [
    processador("rum-flow-passo", "bizevent", MATCHER_COPIA, "Digital Experience Flow: copia enxuta de navegacao/erro (funil, drill, isolar)",
      { bizevent: { eventType: { type: "constant", constant: TIPO_PASSO }, eventProvider: { type: "constant", constant: "journey-flow" }, fieldExtraction: { type: "include", include: dims(...CAMPOS_PASSO) } } }),
    processador("rum-flow-experiencia", "bizevent", MATCHER_EXPERIENCIA, "Digital Experience Flow: copia de experiencia (views, cliques, Apdex) para os agregados",
      { bizevent: { eventType: { type: "constant", constant: TIPO_EXPERIENCIA }, eventProvider: { type: "constant", constant: "journey-flow" }, fieldExtraction: { type: "include", include: dims(...CAMPOS_EXPERIENCIA) } } }),
  ] },
});

/** Pipeline de business events: a cópia enxuta vai para os 3 buckets próprios (navegação, erro e requisição), a de
    experiência para o 4º e os agregados para o bucket deles. */
export const definirPipelinePassos = () => ({
  customId: PIPELINE_ID, displayName: "Digital Experience Flow", routing: "routable",
  processing: { processors: [] },
  storage: { processors: [
    processador("rum-flow-passos-nav", "bucketAssignment", MATCHERS_PASSOS.nav, "Digital Experience Flow: copia, navegacao", { bucketAssignment: { bucketName: BUCKETS_PASSOS.nav } }),
    processador("rum-flow-passos-erro", "bucketAssignment", MATCHERS_PASSOS.erro, "Digital Experience Flow: copia, erro", { bucketAssignment: { bucketName: BUCKETS_PASSOS.erro } }),
    processador("rum-flow-passos-req", "bucketAssignment", MATCHERS_PASSOS.req, "Digital Experience Flow: copia, requisicao (o resto)", { bucketAssignment: { bucketName: BUCKETS_PASSOS.req } }),
    processador("rum-flow-passos-exp", "bucketAssignment", MATCHERS_PASSOS.exp, "Digital Experience Flow: copia, experiencia", { bucketAssignment: { bucketName: BUCKETS_PASSOS.exp } }),
    processador("rum-flow-agregados", "bucketAssignment", MATCHER_AGREGADOS, "Digital Experience Flow: agregados por fatia de 5 min", { bucketAssignment: { bucketName: BUCKET_AGREGADOS } }),
    processador("rum-flow-erros", "bucketAssignment", MATCHER_ERROS, "Digital Experience Flow: erros com exemplos por fatia de 5 min", { bucketAssignment: { bucketName: BUCKET_ERROS } }),
    processador("rum-flow-horas", "bucketAssignment", MATCHER_HORAS, "Digital Experience Flow: analise de hora em hora", { bucketAssignment: { bucketName: BUCKET_HORAS } }),
  ] },
});
/** Matcher do roteamento de business events do DEF: os três tipos de evento. */
export const MATCHER_ROTA_BIZ = `event.type == "${TIPO_PASSO}" or event.type == "${TIPO_EXPERIENCIA}" or event.type == "${TIPO_AGREGADO}" or event.type == "${TIPO_ERRO_AMOSTRA}" or event.type == "${TIPO_HORA}"`;
/** O armazenamento do pipeline da cópia já é o dos 3 buckets? (false = ainda o bucket único de antes, ou outro) */
export const copiaDividida = (pipelinePassos: { value: any } | null) =>
  JSON.stringify(((pipelinePassos?.value?.storage?.processors ?? []) as any[]).map((p) => [p.matcher, p.bucketAssignment?.bucketName, p.enabled !== false]))
  === JSON.stringify(definirPipelinePassos().storage.processors.map((p: any) => [p.matcher, p.bucketAssignment.bucketName, true]));

/** MODO INTEGRADO: quando o tenant já tem um pipeline de user.events cuja rota pega os eventos das aplicações (ex.: o
    um pipeline de Apdex do ambiente), uma rota própria do DEF roubaria esses eventos (na frente) ou ficaria sem eles (atrás): cada
    evento vai para UM pipeline só. Então as regras do DEF (as duas extrações da cópia) entram DENTRO desse pipeline, com
    ids "def_" e o filtro das aplicações habilitadas, no fim do estágio de extração (depois dos processadores do pipeline:
    a cópia de experiência leva o apdex_score que o pipeline do ambiente calcula); nada do que já existe muda. Aplicar
    tira as regras "def_" de antes de todos os estágios (até a 1.40, o processador de nomes e as 24 regras de métrica). */
export const PREFIXO_INTEGRADO = "def_";
export const ehRegraDef = (p: any) => String(p?.id ?? "").startsWith(PREFIXO_INTEGRADO);
export const LIMITE_MATCHER = 4096;
export function regrasIntegradas(apps: string[]) {
  const base = definirPipelineEventos();
  const filtro = matcherApps(apps);
  const comFiltro = (p: any) => ({ ...p, id: PREFIXO_INTEGRADO + p.id, matcher: `(${p.matcher}) and (${filtro})` });
  return { processamento: base.processing.processors.map(comFiltro), metricas: base.metricExtraction.processors.map(comFiltro), copia: base.dataExtraction.processors.map(comFiltro) };
}
/** Valor novo do pipeline hospedeiro: tira as regras "def_" antigas e põe as novas no fim; o resto fica idêntico. */
export function integrarNoPipeline(valor: any, apps: string[]) {
  const novo = JSON.parse(JSON.stringify(valor));
  const { processamento, metricas, copia } = apps.length ? regrasIntegradas(apps) : { processamento: [] as any[], metricas: [] as any[], copia: [] as any[] };
  for (const [estagio, regras] of [["processing", processamento], ["metricExtraction", metricas], ["dataExtraction", copia]] as const) {
    novo[estagio] = novo[estagio] ?? { processors: [] };
    novo[estagio].processors = [...(novo[estagio].processors ?? []).filter((p: any) => !ehRegraDef(p)), ...regras];
  }
  return novo;
}
/** As aplicações do modo integrado, lidas do filtro da regra da cópia ("def_rum-flow-passo"); até a 1.40, também da regra de
    métrica de navegação, que ainda pode estar num pipeline não reaplicado. */
const appsDoHospedeiro = (valor: any) => appsDoMatcher(
  ((valor?.dataExtraction?.processors ?? []) as any[]).find((p) => p.id === `${PREFIXO_INTEGRADO}rum-flow-passo`)?.matcher
  ?? ((valor?.metricExtraction?.processors ?? []) as any[]).find((p) => p.id === `${PREFIXO_INTEGRADO}rum-flow-navigation`)?.matcher);

/** Matcher de roteamento de user.events: lista de igualdades (in()/array() não são aceitos). */
export const matcherApps = (ids: string[]) => ids.map((a) => `dt.rum.application.id == "${a.toLowerCase().replace(/^(mobile_)?application-/i, "")}"`).join(" or ");
/** Ids das aplicações habilitadas, lidos de volta do matcher (fonte da verdade). */
export const appsDoMatcher = (matcher: string | undefined) => [...(matcher ?? "").matchAll(/dt\.rum\.application\.id == "([0-9a-f-]+)"/g)].map((m) => m[1]);

export interface EstadoPrereq {
  buckets: Record<string, { retentionDays: number; status: string; version: number; displayName: string; table: string } | null>;
  pipelineEventos: { objectId: string; value: any } | null;
  pipelineSpans: { objectId: string; value: any } | null;
  rotaEventos: { objectId: string; value: any } | null;
  rotaSpans: { objectId: string; value: any } | null;
  pipelinePassos: { objectId: string; value: any } | null;
  rotaPassos: { objectId: string; value: any } | null;
  appsHabilitadas: string[];
  matcherSpans: string | null;
  erros: string[];
  /** todos os pipelines de user.events (para escolher onde integrar) */
  pipelinesEventosTodos: { objectId: string; value: any }[];
  /** pipeline de outro dono que já tem as regras "def_" (modo integrado) */
  hospedeiro: { objectId: string; value: any } | null;
  /** rotas de user.events que não são do DEF (ex.: a de um pipeline de Apdex do ambiente) */
  rotasCliente: { pipelineId: string; nome: string; matcher: string; descricao: string; ativa: boolean }[];
  modo: "proprio" | "integrado";
}

/** Só as aplicações habilitadas (regra do DEF no roteamento de user.events), sem ler o resto. null = sem permissão
    de ler Settings ou o DEF não está configurado. */
export async function lerAppsHabilitadas(c: ClienteHttp): Promise<string[] | null> {
  const r = await c.chamar("GET", SETTINGS, undefined, { schemaIds: SCHEMAS.rotaEventos, scopes: "environment", fields: "objectId,value", pageSize: "100" });
  if (r.status !== 200) return null;
  const entradas: any[] = r.dados?.items?.[0]?.value?.routingEntries ?? [];
  const def = entradas.find((x) => /Digital Experience Flow|Journey Flow|RUM Flow/.test(String(x.description ?? "")));
  if (def) return appsDoMatcher(def.matcher);
  // modo integrado: as aplicações estão no filtro das regras "def_" dentro do pipeline do ambiente
  const p = await c.chamar("GET", SETTINGS, undefined, { schemaIds: SCHEMAS.pipelinesEventos, scopes: "environment", fields: "objectId,value", pageSize: "100" });
  if (p.status !== 200) return null;
  const host = ((p.dados?.items ?? []) as any[]).find((o) => o.value?.customId !== PIPELINE_ID && ["metricExtraction", "dataExtraction"].some((st) => ((o.value?.[st]?.processors ?? []) as any[]).some(ehRegraDef)));
  return host ? appsDoHospedeiro(host.value) : null;
}

export async function lerEstado(c: ClienteHttp): Promise<EstadoPrereq> {
  const e: EstadoPrereq = { buckets: { [BUCKET_SPANS_LEGADO]: null, [BUCKET_PASSOS]: null, ...Object.fromEntries(Object.values(BUCKETS_PASSOS).map((b) => [b, null])), [BUCKET_AGREGADOS]: null, [BUCKET_ERROS]: null, [BUCKET_HORAS]: null, default_user_events: null, default_spans: null, default_bizevents: null }, pipelineEventos: null, pipelineSpans: null, rotaEventos: null, rotaSpans: null, pipelinePassos: null, rotaPassos: null, appsHabilitadas: [], matcherSpans: null, erros: [], pipelinesEventosTodos: [], hospedeiro: null, rotasCliente: [], modo: "proprio" };
  const b = await c.chamar("GET", BUCKETS);
  if (b.status === 200) {
    for (const x of b.dados.buckets ?? []) if (x.bucketName in e.buckets) e.buckets[x.bucketName] = x;
  } else {
    e.erros.push(`buckets: HTTP ${b.status}`);
  }
  const objetos = async (schema: string) => {
    const r = await c.chamar("GET", SETTINGS, undefined, { schemaIds: schema, scopes: "environment", fields: "objectId,value", pageSize: "100" });
    if (r.status !== 200) { e.erros.push(`${schema}: HTTP ${r.status}`); return [] as any[]; }
    return (r.dados.items ?? []) as any[];
  };
  const pe = await objetos(SCHEMAS.pipelinesEventos); e.pipelineEventos = pe.find((o) => o.value?.customId === PIPELINE_ID) ?? null;
  const ps = await objetos(SCHEMAS.pipelinesSpans); e.pipelineSpans = ps.find((o) => o.value?.customId === PIPELINE_ID) ?? null;
  const re = await objetos(SCHEMAS.rotaEventos); e.rotaEventos = re[0] ?? null;
  const rs = await objetos(SCHEMAS.rotaSpans); e.rotaSpans = rs[0] ?? null;
  const pb = await objetos(SCHEMAS.pipelinesBiz); e.pipelinePassos = pb.find((o) => o.value?.customId === PIPELINE_ID) ?? null;
  const rb = await objetos(SCHEMAS.rotaBiz);
  e.rotaPassos = rb[0] && (rb[0].value?.routingEntries ?? []).some((x: any) => String(x.matcher ?? "").includes(TIPO_PASSO)) ? rb[0] : null;
  if (!e.rotaPassos && rb[0]) (e as any).rotaPassosObjeto = rb[0];
  const entradaEventos = (e.rotaEventos?.value?.routingEntries ?? []).find((x: any) => x.pipelineId === e.pipelineEventos?.objectId || String(x.description ?? "").match(/Digital Experience Flow|Journey Flow|RUM Flow/));
  e.appsHabilitadas = appsDoMatcher(entradaEventos?.matcher);
  e.pipelinesEventosTodos = pe;
  e.hospedeiro = pe.find((o) => o.value?.customId !== PIPELINE_ID && ["metricExtraction", "dataExtraction"].some((st) => ((o.value?.[st]?.processors ?? []) as any[]).some(ehRegraDef))) ?? null;
  const nomePipeline = (id: string) => pe.find((o) => o.objectId === id)?.value?.displayName ?? pe.find((o) => o.objectId === id)?.value?.customId ?? id;
  e.rotasCliente = ((e.rotaEventos?.value?.routingEntries ?? []) as any[])
    .filter((x) => x.pipelineType === "custom" && x.pipelineId !== e.pipelineEventos?.objectId && !/Digital Experience Flow|Journey Flow|RUM Flow/.test(String(x.description ?? "")))
    .map((x) => ({ pipelineId: x.pipelineId, nome: nomePipeline(x.pipelineId), matcher: String(x.matcher ?? ""), descricao: String(x.description ?? ""), ativa: x.enabled !== false }));
  if (e.hospedeiro) { e.modo = "integrado"; e.appsHabilitadas = appsDoHospedeiro(e.hospedeiro.value); }
  const entradaSpans = (e.rotaSpans?.value?.routingEntries ?? []).find((x: any) => x.pipelineId === e.pipelineSpans?.objectId || String(x.description ?? "").match(/Digital Experience Flow|Journey Flow|RUM Flow/));
  e.matcherSpans = entradaSpans?.matcher ?? null;
  return e;
}

// idioma da interface (lib/i18n.ts): cópia local, porque os scripts em Node usam este arquivo sem import de valor
const t = (pt: string, en: string) => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? en : pt);

export interface PassoResultado { passo: string; ok: boolean; detalhe: string }
/** A configuração é sempre a mesma; o administrador escolhe as aplicações e ONDE ficam as regras: pipeline próprio
    (hospedeiroId null) ou dentro de um pipeline de user.events que já existe (hospedeiroId = objectId dele).
    Sem hospedeiroId: mantém o modo atual (integrado se já houver regras "def_" num pipeline do ambiente). */
export interface OpcoesAplicar { apps: string[]; validarApenas?: boolean; hospedeiroId?: string | null }
const DO_DEF = /Digital Experience Flow|Journey Flow|RUM Flow/;

/** Espera os buckets criados ficarem ativos (até ~90 s). */
async function bucketsAtivos(c: ClienteHttp, nomes: string[]) {
  for (let i = 0; i < 30; i++) {
    const b = await c.chamar("GET", BUCKETS);
    const st = new Map(((b.dados?.buckets ?? []) as any[]).map((x) => [x.bucketName, x.status]));
    if (b.status === 200 && nomes.every((n) => st.get(n) === "active")) return true;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  return false;
}

/** Aplica tudo na ordem bucket -> pipeline -> roteamento (idempotente). Com validarApenas só valida. */
export async function aplicar(c: ClienteHttp, o: OpcoesAplicar, estado?: EstadoPrereq): Promise<PassoResultado[]> {
  const e = estado ?? await lerEstado(c);
  const r: PassoResultado[] = [];
  const resumo = (d: any) => { try { const s = JSON.stringify(d); return s.length > 300 ? s.slice(0, 300) + "…" : s; } catch { return String(d); } };
  const bucket = async (nome: string, tabela: string, displayName: string, padrao: string, retPadrao: number, retFixa?: number) => {
    const ret = retFixa ?? e.buckets[padrao]?.retentionDays ?? retPadrao;
    const atual = e.buckets[nome];
    if (o.validarApenas) { r.push({ passo: `bucket ${nome}`, ok: true, detalhe: atual ? t(`existe (${atual.retentionDays} dias; alvo ${ret} dias)`, `exists (${atual.retentionDays} days; target ${ret} days)`) : t(`seria criado com ${ret} dias`, `would be created with ${ret} days`) }); return; }
    if (!atual) {
      const x = await c.chamar("POST", BUCKETS, { bucketName: nome, table: tabela, displayName, retentionDays: ret });
      r.push({ passo: `bucket ${nome}`, ok: x.status === 201 || x.status === 200, detalhe: x.status === 201 ? t(`criado (${ret} dias)`, `created (${ret} days)`) : resumo(x.dados) });
    } else if (atual.retentionDays !== ret) {
      const x = await c.chamar("PUT", `${BUCKETS}/${nome}`, { ...atual, retentionDays: ret }, { "optimistic-locking-version": String(atual.version) });
      r.push({ passo: `bucket ${nome}`, ok: x.status === 202 || x.status === 200, detalhe: x.status === 202 ? t(`retenção ${atual.retentionDays} → ${ret} dias (assíncrono)`, `retention ${atual.retentionDays} → ${ret} days (asynchronous)`) : resumo(x.dados) });
    } else r.push({ passo: `bucket ${nome}`, ok: true, detalhe: t(`já existe (${ret} dias)`, `already exists (${ret} days)`) });
  };
  const objeto = async (rotulo: string, schema: string, value: unknown, existente: { objectId: string } | null): Promise<string | null> => {
    const valida = existente
      ? await c.chamar("PUT", `${SETTINGS}/${existente.objectId}`, { value }, { validateOnly: "true" })
      : await c.chamar("POST", SETTINGS, [{ schemaId: schema, scope: "environment", value }], { validateOnly: "true" });
    const okValida = existente ? valida.status < 300 : valida.status === 200 && (valida.dados ?? []).every((x: any) => x.code === 200);
    if (!okValida) { r.push({ passo: rotulo, ok: false, detalhe: `${t("validação", "validation")}: ${resumo(valida.dados)}` }); return null; }
    if (o.validarApenas) { r.push({ passo: rotulo, ok: true, detalhe: existente ? t("válido (atualizaria)", "valid (would update)") : t("válido (criaria)", "valid (would create)") }); return existente?.objectId ?? null; }
    if (existente) {
      const x = await c.chamar("PUT", `${SETTINGS}/${existente.objectId}`, { value });
      r.push({ passo: rotulo, ok: x.status < 300, detalhe: x.status < 300 ? t("atualizado", "updated") : resumo(x.dados) });
      return x.status < 300 ? existente.objectId : null;
    }
    const x = await c.chamar("POST", SETTINGS, [{ schemaId: schema, scope: "environment", value }]);
    const ok = x.status === 200 && (x.dados ?? []).every((y: any) => y.code === 200);
    r.push({ passo: rotulo, ok, detalhe: ok ? t("criado", "created") : resumo(x.dados) });
    return ok ? x.dados[0].objectId : null;
  };
  const rota = async (rotulo: string, schema: string, existente: { objectId: string; value: any } | null, pipelineId: string | null, matcher: string, descricao: string, noFim = false) => {
    if (!pipelineId) { r.push({ passo: rotulo, ok: false, detalhe: t("sem pipeline", "no pipeline") }); return; }
    const entradas: any[] = [...(existente?.value?.routingEntries ?? [])];
    const nova = { enabled: true, pipelineType: "custom", pipelineId, matcher, description: descricao };
    const i = entradas.findIndex((x) => x.pipelineId === pipelineId || DO_DEF.test(String(x.description ?? "")));
    if (i >= 0) entradas.splice(i, 1);
    if (noFim) entradas.push(nova); else entradas.unshift(nova);
    await objeto(rotulo, schema, { routingEntries: entradas }, existente);
  };

  // 1.45.3: PRIMEIRO os buckets, o pipeline e a rota de business events do DEF, e só depois as regras que copiam os eventos
  // (antes a cópia era ligada antes da rota e os primeiros eventos caíam no bucket padrão de business events do tenant).
  // Bucket recém-criado leva alguns segundos para receber: o pipeline só entra com eles ativos.
  const antesBiz = r.length;
  const novos = [...Object.values(BUCKETS_PASSOS), BUCKET_AGREGADOS, BUCKET_ERROS, BUCKET_HORAS].filter((b) => !e.buckets[b]);
  for (const [g, b] of Object.entries(BUCKETS_PASSOS) as [keyof typeof BUCKETS_PASSOS, string][]) await bucket(b, "bizevents", NOMES_BUCKETS_PASSOS[g], "default_bizevents", 35, RETENCAO_PASSOS);
  await bucket(BUCKET_AGREGADOS, "bizevents", NOME_BUCKET_AGREGADOS, "default_bizevents", 35, RETENCAO_AGREGADOS);
  await bucket(BUCKET_ERROS, "bizevents", NOME_BUCKET_ERROS, "default_bizevents", 35, RETENCAO_ERROS);
  await bucket(BUCKET_HORAS, "bizevents", NOME_BUCKET_HORAS, "default_bizevents", 35, RETENCAO_HORAS);
  const prontos = !!o.validarApenas || !novos.length || await bucketsAtivos(c, novos);
  if (!prontos) r.push({ passo: t("pipeline de business events (cópia das sessões)", "business events pipeline (session copy)"), ok: false, detalhe: t("os buckets novos ainda estão sendo criados: aplique de novo em 1 minuto (nada foi ligado)", "the new buckets are still being created: apply again in 1 minute (nothing was turned on)") });
  const pp = prontos ? await objeto(t("pipeline de business events (cópia das sessões em 4 buckets e os agregados)", "business events pipeline (session copy in 4 buckets and the aggregates)"), SCHEMAS.pipelinesBiz, definirPipelinePassos(), e.pipelinePassos) : null;
  if (prontos) await rota(t("roteamento de business events", "business events routing"), SCHEMAS.rotaBiz, e.rotaPassos ?? (e as any).rotaPassosObjeto ?? null, pp ?? e.pipelinePassos?.objectId ?? null, MATCHER_ROTA_BIZ, "Digital Experience Flow: copia enxuta de navegacao/erro");
  // sem a rota de business events pronta, a cópia não é ligada (iria para o bucket padrão do tenant)
  if (!o.validarApenas && (!prontos || r.slice(antesBiz).some((x) => !x.ok))) {
    r.push({ passo: t("regras de cópia", "copy rules"), ok: false, detalhe: t("não ligadas: os buckets e a rota de business events do DEF precisam estar prontos antes; aplique de novo", "not turned on: the DEF buckets and business events route must be ready first; apply again") });
    return r;
  }

  const hospedeiroId = o.hospedeiroId !== undefined ? o.hospedeiroId : e.hospedeiro?.objectId ?? null;
  if (hospedeiroId) {
    // ---- modo integrado: regras do DEF dentro do pipeline escolhido; rota e regras do pipeline intactas
    const host = e.pipelinesEventosTodos.find((x) => x.objectId === hospedeiroId);
    const nome = host?.value?.displayName ?? host?.value?.customId ?? hospedeiroId;
    if (!host) { r.push({ passo: t("pipeline de user.events", "user.events pipeline"), ok: false, detalhe: t("o pipeline escolhido não foi encontrado", "the chosen pipeline was not found") }); return r; }
    const novo = integrarNoPipeline(host.value, o.apps);
    const longo = [...(novo.processing?.processors ?? []), ...(novo.metricExtraction?.processors ?? []), ...(novo.dataExtraction?.processors ?? [])].find((p: any) => ehRegraDef(p) && String(p.matcher).length > LIMITE_MATCHER);
    if (longo) { r.push({ passo: t(`regras do DEF dentro de "${nome}"`, `DEF rules inside "${nome}"`), ok: false, detalhe: t(`filtro com mais de ${LIMITE_MATCHER} caracteres: habilite menos aplicações`, `filter longer than ${LIMITE_MATCHER} characters: enable fewer applications`) }); return r; }
    const doCliente = (v: any) => JSON.stringify(["processing", "metricExtraction", "dataExtraction", "storage"].map((st) => ((v?.[st]?.processors ?? []) as any[]).filter((p) => !ehRegraDef(p))));
    if (doCliente(novo) !== doCliente(host.value)) { r.push({ passo: t(`regras do DEF dentro de "${nome}"`, `DEF rules inside "${nome}"`), ok: false, detalhe: t("trava de segurança: as regras do próprio pipeline mudariam; nada foi gravado", "safety check: the pipeline's own rules would change; nothing was written") }); return r; }
    await objeto(t(`regras do DEF dentro de "${nome}" (${o.apps.length ? `cópia das sessões e de experiência, ${o.apps.length} aplicação(ões)` : "removidas"})`, `DEF rules inside "${nome}" (${o.apps.length ? `session and experience copy, ${o.apps.length} application(s)` : "removed"})`), SCHEMAS.pipelinesEventos, novo, host);
    // rota: a do pipeline fica; só ganha as aplicações mobile que ela não pega, e a rota própria do DEF (se houver) sai
    const entradas: any[] = [...(e.rotaEventos?.value?.routingEntries ?? [])];
    const doDef = (x: any) => x.pipelineId === e.pipelineEventos?.objectId || DO_DEF.test(String(x.description ?? ""));
    const semDef = entradas.filter((x) => !doDef(x));
    const ih = semDef.findIndex((x) => x.pipelineId === hospedeiroId);
    let rotaOk = true;
    if (ih < 0) { r.push({ passo: t("roteamento de user.events", "user.events routing"), ok: false, detalhe: t(`"${nome}" não tem rota: os eventos nunca chegam`, `"${nome}" has no route: its events never arrive`) }); rotaOk = false; }
    else {
      const faltam = o.apps.filter((a) => a.includes("-") && !String(semDef[ih].matcher ?? "").includes(`"${a}"`));
      if (faltam.length) semDef[ih] = { ...semDef[ih], matcher: `${semDef[ih].matcher} or ${matcherApps(faltam)}` };
      if (faltam.length || semDef.length !== entradas.length) {
        const rotulo = [faltam.length ? t(`+${faltam.length} aplicação(ões) mobile na rota de "${nome}"`, `+${faltam.length} mobile application(s) on the "${nome}" route`) : "", semDef.length !== entradas.length ? t("rota própria do DEF removida", "DEF's own route removed") : ""].filter(Boolean).join(" · ");
        rotaOk = (await objeto(`${t("roteamento de user.events", "user.events routing")} (${rotulo})`, SCHEMAS.rotaEventos, { routingEntries: semDef }, e.rotaEventos)) !== null || !!o.validarApenas;
      } else r.push({ passo: t("roteamento de user.events", "user.events routing"), ok: true, detalhe: t(`sem mudança: a rota de "${nome}" já traz os eventos`, `unchanged: the "${nome}" route already brings the events`) });
    }
    // pipeline próprio de uma configuração anterior: sai depois que a rota dele saiu
    if (e.pipelineEventos) {
      if (o.validarApenas) r.push({ passo: t("pipeline próprio de user.events do DEF", "DEF's own user.events pipeline"), ok: true, detalhe: t("seria removido (as regras agora ficam dentro do pipeline escolhido)", "would be removed (rules now live inside the chosen pipeline)") });
      else if (!rotaOk) r.push({ passo: t("pipeline próprio de user.events do DEF", "DEF's own user.events pipeline"), ok: false, detalhe: t("mantido: a rota não foi atualizada", "kept: the route was not updated") });
      else { const x = await c.chamar("DELETE", `${SETTINGS}/${e.pipelineEventos.objectId}`); r.push({ passo: t("pipeline próprio de user.events do DEF", "DEF's own user.events pipeline"), ok: x.status < 300, detalhe: x.status < 300 ? t("removido", "removed") : resumo(x.dados) }); }
    }
  } else {
    // ---- modo próprio: pipeline e rota do DEF
    const pe = await objeto(t("pipeline de user.events", "user.events pipeline"), SCHEMAS.pipelinesEventos, definirPipelineEventos(), e.pipelineEventos);
    if (o.apps.length === 0) r.push({ passo: t("roteamento de user.events", "user.events routing"), ok: false, detalhe: t("nenhuma aplicação habilitada", "no application enabled") });
    else await rota(t("roteamento de user.events", "user.events routing"), SCHEMAS.rotaEventos, e.rotaEventos, pe ?? e.pipelineEventos?.objectId ?? null, matcherApps(o.apps), "Digital Experience Flow: aplicacoes habilitadas");
    if (e.rotasCliente.length) r.push({ passo: t("atenção", "attention"), ok: true, detalhe: t(`este tenant também roteia user.events para ${e.rotasCliente.map((x) => `"${x.nome}"`).join(", ")}; a rota do DEF vem antes e tira deles os eventos das aplicações escolhidas`, `this tenant also routes user.events to ${e.rotasCliente.map((x) => `"${x.nome}"`).join(", ")}; the DEF route comes first and takes the selected applications' events away from them`) });
  }
  // legado (até 1.3.x): métricas de spans. Tira a rota do DEF (os spans voltam ao pipeline padrão) e depois o pipeline.
  const entradasSpans: any[] = e.rotaSpans?.value?.routingEntries ?? [];
  const semDef = entradasSpans.filter((x) => !(x.pipelineId === e.pipelineSpans?.objectId || DO_DEF.test(String(x.description ?? ""))));
  let rotaLimpa = true;
  if (e.rotaSpans && semDef.length !== entradasSpans.length) rotaLimpa = (await objeto(t("roteamento de spans (tira a rota antiga do DEF)", "spans routing (remove the old DEF route)"), SCHEMAS.rotaSpans, { routingEntries: semDef }, e.rotaSpans)) !== null;
  if (e.pipelineSpans) {
    if (o.validarApenas) r.push({ passo: t("pipeline de spans (antigo)", "spans pipeline (old)"), ok: true, detalhe: t("seria removido", "would be removed") });
    else if (!rotaLimpa) r.push({ passo: t("pipeline de spans (antigo)", "spans pipeline (old)"), ok: false, detalhe: t("mantido: a rota antiga não foi removida", "kept: the old route was not removed") });
    else {
      const x = await c.chamar("DELETE", `${SETTINGS}/${e.pipelineSpans.objectId}`);
      r.push({ passo: t("pipeline de spans (antigo)", "spans pipeline (old)"), ok: x.status < 300, detalhe: x.status < 300 ? t("removido (as métricas rum_flow.span.* param)", "removed (rum_flow.span.* metrics stop)") : resumo(x.dados) });
    }
  }
  return r;
}
