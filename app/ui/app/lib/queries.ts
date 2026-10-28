/* Consultas DQL do app (montam texto; a única que executa é carregarBackend, que recebe o executor). Testáveis fora
   do navegador. Regra de custo: toda consulta filtra por aplicação (ou pelas aplicações com tráfego) e janela curta. */

import type { LinhaChamadaEstado, LinhaTerceiro } from "./oportunidades";
import { qApdexCargaAgregado, qApdexMobileAgregado, qApdexLugaresAgregado, qCliquesAgregado, semTempoRealEmUso, trechosAoVivo, type Trecho } from "./agregados";

export const aspas = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Janela relativa ("2h", "30m"), instante absoluto ISO-8601 ("2026-10-06T19:00:00Z") ou intervalo fechado
    "início/fim" em ISO-8601 (usado na comparação com a leitura direta: métrica e eventos crus precisam ver o mesmo intervalo,
    porque `timeseries` alinha a janela ao minuto e `fetch` não). */
export const desde = (janela: string) => {
  if (/^\d+[smhd]$/.test(janela)) {
    // 1.46.0, a cada 5 minutos (Configuração): a janela relativa termina na última fatia gravada, como os agregados; métrica,
    // cópia e spans do período param no mesmo instante (o custo de leitura é o mesmo)
    if (semTempoRealEmUso()) { const t = trechosAoVivo(janela); return `"${new Date(t.ini).toISOString()}", to: "${new Date(t.fim).toISOString()}"`; }
    return `now()-${janela}`;
  }
  const [ini, fim] = janela.split("/");
  return fim ? `"${ini}", to: "${fim}"` : `"${ini}"`;
};

/** Falha de requisição de terceiros (analytics, anúncios, CDN de outro dono) não é erro da página do cliente. SÓ NA WEB:
    no mobile o agente marca TODA chamada como third_party, inclusive a API do próprio app (num app real, milhares de falhas
    da API do próprio banco marcadas assim). Mobile = dt.rum.application.id com hífen (UUID). */
const SO_PROPRIO = '(isNull(url.provider) or url.provider != "third_party" or contains(dt.rum.application.id, "-"))';
/** Chamada de API de uma tela: na web, XHR/fetch (request.type fetch_xhr); no app nativo o agente não usa esse tipo, então toda
    chamada do mobile conta (dt.rum.application.id com hífen = UUID do app). Antes (até a 1.38.4) o painel da página e as
    traces filtravam só fetch_xhr e o app mobile ficava sem chamadas e sem traces, embora 99% delas tenham trace. */
const CHAMADA_API = '(request.type == "fetch_xhr" or contains(dt.rum.application.id, "-"))';

/** A ligação página -> serviço lê os spans: no máximo a última hora, qualquer que seja a janela (custo por carga). */
export const JANELA_MAX_SPANS_MIN = 60;
const minutosDe = (janela: string) => { const m = /^(\d+)([smhd])$/.exec(janela); return m ? +m[1] * ({ s: 1 / 60, m: 1, h: 60, d: 1440 } as Record<string, number>)[m[2]] : null; };
export const desdeLimitado = (janela: string, maxMin: number) => {
  const min = minutosDe(janela);
  if (min != null) return min > maxMin ? `now()-${maxMin}m` : desde(janela);
  const [, fim] = janela.split("/");
  const f = fim ? new Date(fim) : new Date();
  return `"${new Date(f.getTime() - maxMin * 60000).toISOString()}", to: "${f.toISOString()}"`;
};
const inicioLimitado = (janela: string, maxMin: number) => {
  const min = minutosDe(janela);
  if (min != null) return min > maxMin ? `now()-${maxMin}m` : `now()-${janela}`;
  const [, fim] = janela.split("/");
  const f = fim ? new Date(fim) : new Date();
  return `toTimestamp("${new Date(f.getTime() - maxMin * 60000).toISOString()}")`;
};
/** Lado da cópia na ligação página -> serviço: lê só o trecho que os spans cobrem (no máximo maxMin), sem passar do
    início da própria janela; o filtro start_time >= início continua. O registro da cópia tem timestamp >= start_time
    (medido no LAB: 0 registros com timestamp < start_time), então ler só esse trecho devolve as mesmas linhas. */
const desdeCopiaLimitada = (janela: string, maxMin: number) => {
  if (minutosDe(janela) != null) return desdeLimitado(janela, maxMin);
  const [ini, fim] = janela.split("/");
  const f = fim ? new Date(fim) : new Date();
  return f.getTime() - new Date(ini).getTime() > maxMin * 60000 ? desdeLimitado(janela, maxMin) : desde(janela);
};

/** 1.46.1: com filtro de segmento, sessões de robôs ou frames das páginas, o que muda de fonte lê a cópia crua do período (as
    fatias não têm as dimensões do filtro; as horas analisadas deixam robôs e frames fora): o período vai no máximo até
    MAX_JANELA_FILTRO_MIN. Um filtro em 24 h lia 48 vezes a cópia de 30 min. */
export const MAX_JANELA_FILTRO_MIN = 60;
export const limitarJanelaFiltro = (janela: string, filtro: boolean) => (filtro && (minutosDe(janela) ?? 0) > MAX_JANELA_FILTRO_MIN ? `${MAX_JANELA_FILTRO_MIN}m` : janela);

/** Valor do seletor que significa "todas as aplicações". */
export const TODAS = "*";

/** Foco no online: 10, 30 e 60 minutos; 24 horas e 7 dias somam os agregados (lib/agregados.ts).
    A cópia das sessões guarda 1 dia: o que lê por sessão vai até 24 horas. */
export const JANELAS = [
  { valor: "10m", pt: "Últimos 10 minutos", en: "Last 10 minutes" },
  { valor: "30m", pt: "Últimos 30 minutos", en: "Last 30 minutes" },
  { valor: "60m", pt: "Última hora", en: "Last hour" },
  { valor: "24h", pt: "Últimas 24 horas", en: "Last 24 hours" },
  { valor: "7d", pt: "Últimos 7 dias", en: "Last 7 days" },
];

const filtroApp = (app: string) => (app === TODAS ? "" : ` and dt.rum.application.id == "${aspas(app)}"`);
const filtroRobos = (robos: boolean) => (robos ? "" : ' and dt.rum.user_type != "robot"');

/** Nome da página sem o parâmetro de caminho: tudo a partir do primeiro ";" sai ("/x.jsf;jsessionid=<id>" -> "/x.jsf"), a
    mesma regra do processador de nomes do DEF (lib/prerequisitos.ts, DQL_NOMES) e de um processador rum.page comum. As métricas do
    DEF já vêm limpas do pipeline; a cópia enxuta e o user.events trazem o nome cru, então toda leitura de sessão corta na
    origem (fonteSessao / base): filtros por página, chaves de agrupamento e caminhos ficam iguais aos das métricas. Nome
    nulo continua nulo. Dado antigo das métricas (séries gravadas antes do processador) é reagrupado na leitura. */
export const semParametro = (campo: string) => `if(indexOf(${campo}, ";") >= 0, substring(${campo}, from: 0, to: indexOf(${campo}, ";")), else: ${campo})`;
const NOMES_LIMPOS = `fieldsAdd view.name = ${semParametro("view.name")}, view.source.name = ${semParametro("view.source.name")}`;

/** Cópia enxuta de navegação/erro (business events "journeyflow.passo"), extraída pelo OpenPipeline com ~30 campos.
    Quando existe, funil, drill e isolar leem só ela: 100% das sessões, sem varrer os eventos completos. Mesmos nomes de
    campo do user.events, então as consultas são as mesmas.
    Etapa 6: a cópia fica em 3 buckets, um por grupo de registro (navegação, erro e o resto, que são as requisições;
    cada registro em exatamente um: prerequisitos.ts), e cada leitura pede só os buckets em que pode haver registro que o
    filtro dela aceita (o Grail cobra os bytes dos buckets lidos na janela; filtro de campo dentro do bucket não reduz:
    medido no LAB em 17/10). Os buckets só têm a cópia (a rota de business events do DEF só leva "journeyflow.passo"),
    então o filtro event.type saiu. Transição: o bucket único de antes (rum_flow_passos) continua sendo lido pelas
    janelas que começam antes do último registro dele (ver bucketsDaLeitura). */
export const BUCKET_PASSOS_PADRAO = "rum_flow_passos";
export const BUCKETS_COPIA = { nav: "rum_flow_passos_nav", erro: "rum_flow_passos_erro", req: "rum_flow_passos_req" } as const;
export type GrupoCopia = keyof typeof BUCKETS_COPIA;
export const TIPO_PASSO = "journeyflow.passo";
/** Onde está a cópia e até quando cada lado tem registro. `novosAte`/`antigoAte` = instante (ms, relógio do Grail) do
    último registro nos 3 buckets e no antigo, nos últimos 7 dias (null = nenhum). O lado com o registro mais novo é o que
    recebe agora e é lido em toda janela; o outro só é lido pelas janelas que começam antes do último registro dele (com
    MARGEM_COPIA_MS). `desvio` = relógio do Grail menos o do navegador, medido na verificação. */
export interface EstadoCopia { buckets: Record<GrupoCopia, string>; antigo: string; novosAte: number | null; antigoAte: number | null; desvio: number }
export const MARGEM_COPIA_MS = 5 * 60000;
/** Rótulo da cópia nas chaves de cache: com um bucket só (usarPassos), o nome dele, como antes; com os 3 buckets, outro
    rótulo, para uma aba com a versão anterior (que só lê o bucket único) não gravar por cima depois da troca. */
export const ROTULO_COPIA_3 = "rum_flow_passos_3b";
let copia: EstadoCopia | null = null;
let passosAtivo: string | null = null;
const umBucketSo = (e: EstadoCopia) => Object.values(e.buckets).every((b) => b === e.antigo);
export const usarCopia = (e: EstadoCopia | null) => { copia = e; passosAtivo = !e ? null : umBucketSo(e) ? e.antigo : ROTULO_COPIA_3; };
/** Um bucket só para tudo, como até a etapa 5 (scripts e provas): todas as leituras pedem esse bucket. */
export const usarPassos = (bucket: string | null) => usarCopia(bucket ? { buckets: { nav: bucket, erro: bucket, req: bucket }, antigo: bucket, novosAte: null, antigoAte: Infinity, desvio: 0 } : null);
export const passosEmUso = () => passosAtivo;
/** Verificação da cópia (PRE-02N nos 3 buckets e PRE-02A no antigo): o último registro nos últimos 7 dias e o relógio do
    Grail. Com sort timestamp desc e limit 1 o Grail lê de trás para frente e para no primeiro bloco com registro: o custo é o
    do bloco mais novo de cada bucket (LAB, 17/10: 0,4 MB nos 3 buckets e 0,12 MB no antigo parado, contra 1,6 a 1,9 MB da
    contagem de 10 min de antes); sem o sort ele devolve um registro qualquer desse bloco. Bucket que não existe: 0 B. */
export const qCopiaUltimo = (buckets: string[]) => `fetch bizevents, from: now()-7d, bucket: {${buckets.map((b) => `"${aspas(b)}"`).join(", ")}}
| sort timestamp desc
| limit 1
| fields ultimo = timestamp, agora = now()`;
/** Estado da cópia a partir das duas verificações (linhas de qCopiaUltimo; null = a consulta falhou). Sem registro nas
    últimas 2 h em nenhum lado: sem cópia (null), o mesmo sim/não da verificação de antes. */
export function estadoCopia(novos: Record<string, unknown>[] | null, antigo: Record<string, unknown>[] | null, agoraNavegador = Date.now()): EstadoCopia | null {
  const ms = (v: unknown) => { const t = v == null ? NaN : Date.parse(String(v)); return isNaN(t) ? null : t; };
  const n = ms(novos?.[0]?.ultimo), a = ms(antigo?.[0]?.ultimo);
  const agora = ms(novos?.[0]?.agora) ?? ms(antigo?.[0]?.agora);
  const desvio = agora == null ? 0 : agora - agoraNavegador;
  const ultimo = Math.max(n ?? -Infinity, a ?? -Infinity);
  if (!(ultimo >= (agora ?? agoraNavegador) - 2 * 3600000)) return null;
  return { buckets: { ...BUCKETS_COPIA }, antigo: BUCKET_PASSOS_PADRAO, novosAte: n, antigoAte: a, desvio };
}
/** Início (ms, relógio do Grail) do trecho que um `from:` lê: now()-N ou instante ISO (null = não sei). */
const inicioDoTrecho = (de: string, desvio: number) => {
  const r = /^now\(\)-(\d+)([smhd])$/.exec(de);
  if (r) return Date.now() + desvio - +r[1] * ({ s: 1e3, m: 6e4, h: 36e5, d: 864e5 } as Record<string, number>)[r[2]];
  const iso = /^"([^"]+)"/.exec(de);
  const t = iso ? Date.parse(iso[1]) : NaN;
  return isNaN(t) ? null : t;
};
/** Buckets de uma leitura da cópia, para os grupos que o filtro dela aceita: (1) os novos, se recebem agora, se tiveram
    registro no trecho lido ou se ainda não tiveram registro nenhum (não existem ou estão vazios: 0 B, e se a divisão for
    aplicada com o app aberto a leitura seguinte já os pega); (2) o antigo, se recebe agora ou se o trecho começa antes do
    último registro dele (transição: depois da troca, só as janelas que começam antes dela; 7 dias depois, nenhuma; num
    bucket parado, ler um trecho sem registro ainda custa o bloco que encosta nele). */
export const bucketsDaLeitura = (grupos: GrupoCopia[], de: string) => {
  const c = copia!;
  const ini = inicioDoTrecho(de, c.desvio);
  const novosVivo = c.novosAte != null && (c.antigoAte == null || c.novosAte >= c.antigoAte);
  const noTrecho = (ate: number | null) => ate != null && (ini == null || ini <= ate + MARGEM_COPIA_MS);
  const novos = novosVivo || c.novosAte == null || noTrecho(c.novosAte);
  const antigo = c.antigoAte != null && (!novosVivo || noTrecho(c.antigoAte));
  return [...new Set([...(novos ? grupos.map((g) => c.buckets[g]) : []), ...(antigo ? [c.antigo] : [])])];
};
/** Grupos de registro que cada filtro aceita (o que a leitura pode precisar). Navegação nunca tem request.type
    "fetch_xhr" (é "doc" quando tem a requisição do documento: LAB, 7 dias, 213 mil navegações), então quem lê só XHR/fetch
    (requisições do painel e traces) não lê navegação; quem lê por has_request lê os 3 (navegação com has_request tem trace). */
const NAV: GrupoCopia[] = ["nav"], ERRO: GrupoCopia[] = ["erro"], NAV_ERRO: GrupoCopia[] = ["nav", "erro"], ERRO_REQ: GrupoCopia[] = ["erro", "req"], TODOS: GrupoCopia[] = ["nav", "erro", "req"];
const gruposDoClassificador = (c: string): GrupoCopia[] => (c === "navigation" ? NAV : c === "error" ? ERRO : c === "request" ? ["req"] : TODOS);
/** Filtros de segmento: sistema, navegador, versão do app, país e região. Com algum ativo, o grafo sai da cópia
    enxuta (que guarda esses campos) em vez das métricas: as métricas não levam essas dimensões para não multiplicar
    o número de séries (e o custo). Sem filtro, nada muda. */
export interface Segmento { os?: string; navegador?: string; versao?: string; pais?: string; regiao?: string }
export const CAMPOS_SEGMENTO: Record<keyof Segmento, string> = {
  os: "os.name", navegador: "browser.name", versao: "app.short_version", pais: "geo.country.iso_code", regiao: "geo.region.name",
};
let segmento: Segmento = {};
export const usarSegmento = (s: Segmento) => { segmento = { ...s }; };
export const segmentoAtivo = () => Object.values(segmento).some(Boolean);
// chave em ordem fixa: os mesmos filtros escolhidos em outra ordem reaproveitam o mesmo cache
export const chaveSegmentoDe = (s: Segmento) => (Object.values(s).some(Boolean)
  ? JSON.stringify(Object.fromEntries((Object.entries(s) as [string, string | undefined][]).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b))))
  : "-");
export const chaveSegmento = () => chaveSegmentoDe(segmento);
/** O Apdex web tem as linhas "carga" (agregados) só sem filtro de sistema e de navegador (qApdex). */
export const apdexComCarga = () => !(segmento.os || segmento.navegador);
/** O filtro de sistema do segmento (o Apdex mobile filtra por ele). */
export const sistemaDoSegmento = () => segmento.os ?? null;
const filtroSegmento = () => (Object.entries(segmento) as [keyof Segmento, string | undefined][])
  .filter(([, v]) => v).map(([k, v]) => ` and ${CAMPOS_SEGMENTO[k]} == "${aspas(v!)}"`).join("");

/** Origem das consultas por sessão: a cópia enxuta, só nos buckets dos `grupos` de registro que o filtro da consulta
    aceita. Já aplica os filtros de segmento. `de` = início da leitura, quando não é a janela inteira. Desde a 1.41 não
    existe mais a leitura de user.events (Digital Experience Monitoring - Query): sem a cópia, as telas por sessão
    avisam que falta configurar (quem chama confere passosEmUso()). */
const fonteSessao = (grupos: GrupoCopia[], janela: string, comSegmento = true, de = desde(janela)) => {
  const seg = comSegmento ? filtroSegmento() : "";
  // sem a verificação da cópia (scripts, ou antes de ela voltar): os 3 buckets dos grupos, sem mexer no estado do módulo
  const buckets = copia ? bucketsDaLeitura(grupos, de) : [...new Set(grupos.map((g) => BUCKETS_COPIA[g]))];
  return `fetch bizevents, from: ${de}, bucket: {${buckets.map((b) => `"${aspas(b)}"`).join(", ")}}
| ${NOMES_LIMPOS}${seg ? `\n| filter ${seg.slice(" and ".length)}` : ""}`;
};

/** Valores disponíveis para os filtros, na janela (uma varredura da cópia, só navegações). */
export const qValoresSegmento = (janela: string) => `${fonteSessao(NAV, janela, false)}
| filter characteristics.classifier == "navigation"
| summarize os = collectDistinct(os.name), navegador = collectDistinct(browser.name), versao = collectDistinct(app.short_version), pais = collectDistinct(geo.country.iso_code), regiao = collectDistinct(geo.region.name)`;
/** Páginas distintas por aplicação na última meia hora (Configuração, CFG-04): navegações da cópia. */
export const qPaginasPorAplicacao = () => `${fonteSessao(NAV, "30m", false)}
| filter characteristics.classifier == "navigation"
| summarize paginas = countDistinct(view.name), by:{dt.rum.application.id}`;

const lista = (ids: string[]) => `array(${ids.map((i) => `"${aspas(i)}"`).join(", ")})`;

/** Eventos de um tipo: user.events (grafo pelo Grail, sem métricas) ou, com filtro de segmento, a cópia filtrada. */
/** Frames (iframes) de aplicações montadas em frames, como portais antigos: cada frame carregado dentro da página chega como
    navegação com navigation.tab_state = "duplicated", quase sempre sem origem (vira entrada falsa e nó solto).
    Fora do fluxo por padrão; "Show page frames" mostra. Dado antigo sem o campo continua entrando. */
let quadrosVisiveis = false;
export const usarQuadros = (v: boolean) => { quadrosVisiveis = v; };
export const quadrosEmUso = () => quadrosVisiveis;
const SEM_QUADRO = '(isNull(navigation.tab_state) or navigation.tab_state != "duplicated")';
const filtroQuadros = () => (quadrosVisiveis ? "" : ` and ${SEM_QUADRO}`);
/** 1.45.11: os frames reconhecidos nas últimas 24 h (lib/quadros.ts, componentesDe; app|página -> página que a contém)
    nas leituras por SESSÃO (Visão geral, funis, "Por quê?", lista de sessões e a análise de hora em hora): a carga do
    frame sai (não é passo, visita nem fim de sessão) e o erro dele conta na página que o contém, como no grafo. Com
    "Mostrar frames das páginas", nada muda. Sem custo de leitura: a lista vai no texto da consulta, num texto JSON só do
    comando data (o tamanho da consulta não cresce com a lista); até MAX_COMPONENTES_DQL frames, os de mais cargas. */
export const MAX_COMPONENTES_DQL = 200;
let componentes: [string, string][] = [];
export const usarComponentes = (m: Map<string, string> | null) => { componentes = m ? [...m].slice(0, MAX_COMPONENTES_DQL) : []; };
export const componentesEmUso = () => componentes.length;
/** As etapas do remapeamento, logo depois da limpeza dos nomes; `apps` = a aplicação do escopo (TODAS = todas) ou as
    aplicações da jornada (só os frames delas entram no texto). */
export const remapQuadros = (apps: string | Iterable<string>) => {
  const de = typeof apps === "string" ? (apps === TODAS ? null : new Set([apps])) : new Set(apps);
  const xs = componentes.filter(([k, c]) => (!de || de.has(k.slice(0, k.indexOf("|")))) && !`${k}${c}`.includes('"""'));
  if (quadrosVisiveis || !xs.length) return "";
  return `
| fieldsAdd qk = concat(dt.rum.application.id, "|", view.name)
| lookup [data json: """${JSON.stringify(xs.map(([k, c]) => ({ k, c })))}"""], sourceField: qk, lookupField: k, prefix: "qf."
| filter not(characteristics.classifier == "navigation" and isNotNull(qf.c))
| fieldsAdd view.name = coalesce(qf.c, view.name)
| fieldsRemove qk, qf.k, qf.c`;
};
/** Os filtros que produziram os números da visão geral, em DQL, para quem for investigar os mesmos dados (Dynatrace Assist). */
export const filtrosEmUso = (robos: boolean): string[] => [
  ...(Object.entries(segmento) as [keyof Segmento, string | undefined][]).filter(([, v]) => v).map(([k, v]) => `${CAMPOS_SEGMENTO[k]} == "${aspas(v!)}"`),
  ...(robos ? [] : ['dt.rum.user_type != "robot"']),
  ...(quadrosVisiveis ? [] : [SEM_QUADRO]),
  SO_PROPRIO,
];
const filtroQuadrosMetrica = () => (quadrosVisiveis ? "" : `\n| filter ${SEM_QUADRO}`);

const base = (app: string, janela: string, robos: boolean, classificador: string) =>
  `${fonteSessao(gruposDoClassificador(classificador), janela)}
| filter characteristics.classifier == "${classificador}"${filtroApp(app)}${filtroRobos(robos)}${classificador === "navigation" ? filtroQuadros() : ""}`;

/** Nome atual da aplicação, seja web (APPLICATION-), mobile (MOBILE_APPLICATION-) ou custom (CUSTOM_APPLICATION-):
    entityName devolve null quando o tipo não bate, e o coalesce pega o que existir. */
const nomeAplicacao = (campo: string) => `entityName(${campo}, type: "dt.entity.application"), entityName(${campo}, type: "dt.entity.mobile_application"), entityName(${campo}, type: "dt.entity.custom_application")`;

/** Aplicações com navegações na janela, com o nome ATUAL da entidade. */
export const qAplicacoes = (janela: string) => `${fonteSessao(NAV, janela)}
| filter characteristics.classifier == "navigation"
| summarize navegacoes = count(), sessoes = countDistinct(dt.rum.session.id), by:{dt.rum.application.id, dt.rum.application.entity, frontend.name}
| fieldsAdd entidade = dt.rum.application.entity, nome = coalesce(${nomeAplicacao("dt.rum.application.entity")}, frontend.name, dt.rum.application.id)
| sort navegacoes desc
| limit 200`;

/** Origem da navegação; vazia = entrada (ligada ao canal). Mesma regra das métricas (MATCHER_ENTRADA): na web vale a
    origem que vier (micro-frontend recarrega a página e o contador volta a 1 a cada módulo); no mobile a 1ª view da
    sessão traz a última página da sessão anterior, então a origem dela é descartada. Web = entidade APPLICATION-. */
const ORIGEM = 'if(coalesce(view.sequence_number, 0) != 1 or startsWith(toString(dt.rum.application.entity), "APPLICATION-"), view.source.name)';

/** Arestas do fluxo: de onde o usuário veio -> para onde foi (sem origem = entrada na aplicação), por aplicação. */
export const qArestas = (app: string, janela: string, robos: boolean) => `${base(app, janela, robos, "navigation")}
| summarize n = count(), sessoes = countDistinct(dt.rum.session.id), by:{app = dt.rum.application.id, de = ${ORIGEM}, para = view.name, tipo = navigation.type}
| sort n desc
| limit 4000`;

/** Origem que o RUM não ligou: a tela abriu em ABA NOVA ou dentro de um FRAME, e o RUM só liga telas da mesma aba
    (view.source.name vazio). O navegador ainda informa a página anterior (page.source.url.path: referrer ou página que
    contém o frame). Normalizada como o nome da view (minúsculas, sem ";jsessionid..."); o app só usa quando ela é uma
    página conhecida da mesma aplicação, e desconta da entrada. Em canais de micro-frontend reais, de 60% a 80% das telas sem origem.
    1.45.8: também os FRAMES (quadro = true), sempre: o navegador informa a página que contém o frame (num portal real,
    quase todas as cargas de frame). Com os frames escondidos, eles não viram passo: dizem de que página fazem parte
    (App.tsx: os erros de uma página que só existe como frame contam na página que a contém). Mesma leitura, mesmo custo. */
export const qOrigensRecuperadas = (app: string, janela: string, robos: boolean) => `${fonteSessao(NAV, janela)}
| filter characteristics.classifier == "navigation" and isNotNull(page.source.url.path) and (isNull(view.source.name) or navigation.tab_state == "duplicated")${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd p = toString(page.source.url.path), quadro = coalesce(navigation.tab_state == "duplicated", false)
| fieldsAdd de = lower(if(indexOf(p, ";") >= 0, substring(p, from: 0, to: indexOf(p, ";")), else: p))
| filter de != "" and de != view.name
| summarize n = count(), by:{app = dt.rum.application.id, de, para = view.name, tipo = navigation.type, quadro}
| limit 4000`;

/** HÍBRIDO: com o monitoramento híbrido ligado no app nativo, a página web aberta numa WebView traz dt.rum.adk =
    "<instância>_<sessão>_<app mobile>_m" (a sessão do APP). A 1ª página de cada WebView (sem origem) liga à última tela
    nativa antes dela na mesma sessão do app. Os apps com o híbrido ligado já mandam; no Android, é comum o híbrido
    estar desligado no app (aí não manda). */
export const qHibrido = (appsMobile: string[], janela: string, robos: boolean) => `${fonteSessao(NAV, janela)}
| filter characteristics.classifier == "navigation" and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m") and isNull(view.source.name)${filtroRobos(robos)}
| fieldsAdd partes = splitString(dt.rum.adk, "_")
| fieldsAdd sessao_app = concat(partes[0], "_", partes[1]), app_mobile = partes[2], tw = start_time
| filter in(app_mobile, ${lista(appsMobile)})
| join [${fonteSessao(NAV, janela)} | filter characteristics.classifier == "navigation" and in(dt.rum.application.id, ${lista(appsMobile)}) | fields sid = dt.rum.session.id, tm = start_time, tela = view.name],
       on: {left[sessao_app] == right[sid]}, kind: inner
| filter right.tm <= tw
| summarize antes = arrayLast(arraySort(collectArray(record(t = right.tm, v = right.tela)))), by:{app_web = dt.rum.application.id, app_mobile, pagina = view.name, tw, sessao_web = dt.rum.session.id}
| fieldsAdd tela = antes[v]
| filter isNotNull(tela)
| summarize n = count(), by:{app_mobile, tela, app_web, pagina}
| limit 2000`;

/** Entrada de app MOBILE real (corrigida na 1.45.5). A sessão mobile começa pela ABERTURA
    do app (evento app_start, que não está na cópia de navegação) e a 1ª navegação já é a 2ª tela:
    - Android: a origem da 1ª navegação é a tela da abertura, da MESMA sessão (quase todas as sessões). Essa tela é a
      entrada, e a ligação dela para a 2ª tela é um passo de verdade (fica);
    - iOS: a abertura costuma vir sem nome e a origem da 1ª navegação é uma tela de FORA da sessão (a última da anterior):
      a entrada é a 1ª tela navegada, e a origem dela ("de") é a ligação falsa entre sessões, que o grafo desconta.
    Antes, a regra do iOS valia para as duas plataformas e, no Android, apagava a ligação verdadeira e punha a entrada na
    2ª tela. view.sequence_number não serve: vem vazio ou nunca é 1 na navegação. No Android, quando a 1ª tela navegada
    vem sem nome, a sessão em geral não começou pela abertura e a origem é de fora: fica a regra do iOS. Na prática
    (sessões cuja 1ª tela tem nome, entrada na tela certa x a fonte): a entrada passou a cair na tela certa em quase
    todas as sessões. */
export const qEntradasMobile = (apps: string[], janela: string, robos: boolean) => `${fonteSessao(NAV, janela)}
| filter characteristics.classifier == "navigation" and in(dt.rum.application.id, ${lista(apps)})${filtroRobos(robos)}
| summarize primeira = arrayFirst(arraySort(collectArray(record(t = start_time, v = view.name, s = view.source.name)))), sistema = takeFirst(os.name), by:{app = dt.rum.application.id, sessao = dt.rum.session.id}
| fieldsAdd android = sistema == "Android" and isNotNull(primeira[s]) and isNotNull(primeira[v])
| fieldsAdd para = if(android, primeira[s], else: primeira[v]), de = if(not android, primeira[s])
| filter isNotNull(para)
| summarize n = count(), by:{app, para, de}
| limit 4000`;

/** Isolar: navegações SÓ das sessões que passaram pela página (a pergunta vira "de quem passou por X, para onde
    foi e de onde veio"). Mesma forma de qArestas; varre só o bucket quando ele existe. */
const baseNavSessao = (app: string, janela: string, robos: boolean) => `${fonteSessao(NAV, janela)}
| filter characteristics.classifier == "navigation"${filtroApp(app)}${filtroRobos(robos)}${filtroQuadros()}`;
export const qFluxoDoNo = (app: string, view: string, janela: string, robos: boolean) => `${baseNavSessao(app, janela, robos)}
| fieldsAdd sessao = dt.rum.session.id
| join [ ${baseNavSessao(app, janela, robos)}
  | filter view.name == "${aspas(view)}"
  | summarize passagens = count(), by:{sessao = dt.rum.session.id} ], on: {left[sessao] == right[sessao]}, kind: inner
| summarize n = count(), sessoes = countDistinct(sessao), by:{app = dt.rum.application.id, de = ${ORIGEM}, para = view.name, tipo = navigation.type}
| sort n desc
| limit 4000`;

/** Isolar: quantas sessões passaram pela página na janela. */
export const qSessoesDoNo = (app: string, view: string, janela: string, robos: boolean) => `${baseNavSessao(app, janela, robos)}
| filter view.name == "${aspas(view)}"
| summarize sessoes = countDistinct(dt.rum.session.id)`;

/** Métricas por tela: sessões e tempo em primeiro plano. */
export const qViews = (app: string, janela: string, robos: boolean) => (segmentoAtivo() && passosAtivo
  // a cópia não tem view_summary: com filtro, views = navegações para a página e o tempo por página fica de fora
  ? `${base(app, janela, robos, "navigation")}
| summarize views = count(), sessoes = countDistinct(dt.rum.session.id), by:{app = dt.rum.application.id, view = view.name}
| limit 4000`
  : `${base(app, janela, robos, "view_summary")}
| summarize views = count(), sessoes = countDistinct(dt.rum.session.id), tempo_ms = avg(view.foreground_time) / 1000000.0, by:{app = dt.rum.application.id, view = view.name}
| limit 4000`);

/** Erros por tela, contados nos próprios eventos de erro (os contadores do view_summary não registram
    a exceção quando a sessão termina logo depois dela). */
export const qErrosPorView = (app: string, janela: string, robos: boolean) => `${base(app, janela, robos, "error")}
| filter ${SO_PROPRIO}
| summarize excecoes = countIf(error.type == "exception"), falhas = countIf(error.type == "request"), outros = countIf(error.type != "exception" and error.type != "request"), by:{app = dt.rum.application.id, view = view.name}
| fieldsAdd erros = excecoes + falhas + outros
| limit 4000`;

/* ---- Backend pelo modelo de entidades (o mesmo dado que o Smartscape desenha) ----------------------------
   Quem chama quem já está no Dynatrace: canal (aplicação RUM) -> serviço, serviço -> serviço e serviço -> banco
   (relação "calls"). Consulta de entidade não varre o Grail (0 bytes) e não precisa de métrica extraída, então o
   backend não tem custo. O que esse dado não tem: quantas chamadas passam em cada ligação (o volume fica no nó,
   pela métrica nativa de requisições do serviço) e qual página chama o serviço (a ligação sai do canal). */
const TIPOS_CANAL: [string, string][] = [["APPLICATION-", "dt.entity.application"], ["MOBILE_APPLICATION-", "dt.entity.mobile_application"], ["CUSTOM_APPLICATION-", "dt.entity.custom_application"]];

/* As listas de relação das entidades vêm cortadas em 100 itens no DQL (a frente de um canal grande pode "chamar"
   100 pela lista e mais que isso pela direção contrária). Por isso cada ligação é lida nas DUAS direções: "chama" de quem
   chama e "é chamado por" de quem é chamado. Só se perde a ligação quando as duas listas passam de 100. */

/** Canal -> serviço: os serviços que cada aplicação RUM chama (entidades das aplicações do fluxo). */
export const qCanaisServicos = (entidades: string[]) => {
  const partes = TIPOS_CANAL
    .map(([prefixo, tabela]) => [tabela, entidades.filter((e) => e.startsWith(prefixo))] as const)
    .filter(([, ids]) => ids.length)
    .flatMap(([tabela, ids]) => [
      `fetch ${tabela}\n| filter in(id, ${lista(ids)})\n| fields canal = id, servico = calls[\`dt.entity.service\`]\n| expand servico`,
      `fetch dt.entity.service\n| fields servico = id, canal = called_by[\`${tabela}\`]\n| expand canal\n| filter in(canal, ${lista(ids)})`,
    ]);
  if (!partes.length) return null;
  return `${partes[0]}${partes.slice(1).map((p) => `\n| append [${p}]`).join("")}
| filter isNotNull(servico) and isNotNull(canal)
| dedup {canal, servico}
| limit 5000`;
};

/** Serviço -> serviço (inclui bancos, que são serviços do tipo DATABASE_SERVICE): quem os serviços do fluxo chamam. */
export const qChamadasEntidades = (ids: string[]) => `fetch dt.entity.service
| filter in(id, ${lista(ids)})
| fields de = id, para = calls[\`dt.entity.service\`]
| expand para
| append [fetch dt.entity.service
  | fields para = id, de = called_by[\`dt.entity.service\`]
  | expand de
  | filter in(de, ${lista(ids)})]
| filter isNotNull(de) and isNotNull(para)
| dedup {de, para}
| limit 50000`;

/** Nome, tipo e tecnologia dos serviços; nos bancos, o fabricante (PostgreSQL, Oracle...). */
export const qServicos = (ids: string[]) => `fetch dt.entity.service
| filter in(id, ${lista(ids)})
| fields id, nome = entity.name, tipo = serviceType, tecnologia = agentTechnologyType, fabricante = databaseVendor`;

/** Requisições recebidas e com falha por serviço na janela (métricas nativas: consulta de métrica não é cobrada). A falha
    (1.45.9) é a da detecção do Dynatrace (dt.service.request.failure_count) e deixa o nó do serviço vermelho no grafo. */
export const qVolumeServicos = (ids: string[], janela: string) => `timeseries {n = sum(dt.service.request.count, scalar: true), f = sum(dt.service.request.failure_count, scalar: true)}, by:{dt.entity.service}, from: ${desde(janela)}
| filter in(dt.entity.service, ${lista(ids)})
| fields servico = dt.entity.service, n, f`;

/** Página -> serviços: as requisições de cada página (cópia enxuta, com trace.id) cruzadas com TODOS os spans de
    servidor do mesmo trace. Devolve todos os serviços que as chamadas da página atravessam (servidor web, gateway,
    ingress, BFF, domínio); o grafo liga a página ao primeiro serviço de negócio e o painel mostra a lista inteira.
    Lê os spans da janela: é a parte do app com custo de consulta (estimar antes de produção). Os dois lados leem só o
    trecho dos spans (a última hora). As linhas mais chamadas vêm primeiro e o limite fica acima do que um ambiente grande deve ter
    (estimativa de 16.704 linhas em "Todas"; o Grail cobra os bytes lidos, não as linhas devolvidas). */
export const LIMITE_LIGACAO = 30000;
export const qPaginasServicos = (app: string, janela: string, robos: boolean) => `fetch spans, from: ${desdeLimitado(janela, JANELA_MAX_SPANS_MIN)}
| filter span.kind == "server" and isNotNull(dt.entity.service) and isNotNull(trace.id)
| fields back_trace = toString(trace.id), servico = dt.entity.service
| join [${fonteSessao(TODOS, janela, true, desdeCopiaLimitada(janela, JANELA_MAX_SPANS_MIN))}
        | filter characteristics.has_request == true and isNotNull(trace.id)${filtroApp(app)}${filtroRobos(robos)}
        | filter start_time >= ${inicioLimitado(janela, JANELA_MAX_SPANS_MIN)}
        | fields app = dt.rum.application.id, view = view.name, rum_trace = toString(trace.id)],
       on: {left[back_trace] == right[rum_trace]}, kind: inner
| summarize chamadas = countDistinct(back_trace), by:{app = right.app, view = right.view, servico}
| sort chamadas desc, app asc, view asc, servico asc
| limit ${LIMITE_LIGACAO}`;

/** Saltos depois da porta de entrada do canal. Como num banco típico: servidor web -> gateway da DMZ -> ingress -> BFF ->
    domínio -> domínio -> banco (no lab, web -> banco são 5). */
export const SALTOS_BACKEND = 6;

/** Carrega o backend do fluxo: canal -> serviço de entrada -> até SALTOS_BACKEND saltos, com nome, tipo, fabricante
    (bancos) e requisições na janela. Recebe o executor de DQL para rodar igual na UI e nos testes.
    `canais` = entidade da aplicação RUM -> dt.rum.application.id usado no grafo; `extras` = serviços que também
    precisam de nome e volume (os atingidos pelas páginas), mesmo fora da cadeia; pode ser a promessa da leitura de spans
    (os saltos começam pelos canais enquanto ela não chega: carregarCadeia). `linhasCanais` = resultado (ou promessa) de
    qCanaisServicos (o app lê em paralelo com os spans); sem ele, a consulta roda aqui. O executor recebe também o id da
    consulta no lista de consultas (BCK-02 a BCK-05), que o app manda no dt-client-context. */
export async function carregarBackend(dql: Executor, canais: Map<string, string>, janela: string, extras: string[] | Promise<string[]> = [], linhasCanais?: Linhas | Promise<Linhas>) {
  const c = await carregarCadeia(dql, canais, extras, linhasCanais);
  const todos = c.vistos;
  const [chamadas, servicos] = await Promise.all([c.chamadas, todos.length
    ? Promise.all([dql(qServicos(todos), 5000, "BCK-04"), dql(qVolumeServicos(todos, janela), 5000, "BCK-05")]).then(([svc, vol]) => {
        const volume = new Map(vol.map((l) => [txt(l.servico), Number(l.n ?? 0)])), falhas = new Map(vol.map((l) => [txt(l.servico), Number(l.f ?? 0)]));
        return svc.map((l) => ({ ...infoServico(l), requisicoes: volume.get(txt(l.id)) ?? 0, falhas: falhas.get(txt(l.id)) ?? 0 }));
      })
    : Promise.resolve([] as (InfoServico & { requisicoes: number; falhas: number })[])]);
  return { backend: c.backend, servicos, chamadas };
}

/** Executor de DQL do backend: consulta, maxRecords e o id da consulta no lista de consultas (BCK-02 a BCK-06). */
export type Executor = (q: string, max?: number, id?: string) => Promise<Linhas>;
const txt = (v: unknown) => (v == null ? "" : String(v));
interface InfoServico { id: string; nome: string; tipo: string; tecnologia: string; fabricante: string | null }
const infoServico = (l: Record<string, unknown>): InfoServico => ({ id: txt(l.id), nome: txt(l.nome), tipo: txt(l.tipo), tecnologia: txt(l.tecnologia), fabricante: l.fabricante == null ? null : txt(l.fabricante) });
/** Limite de linhas de cada leitura de saltos (qChamadasEntidades). */
const LIMITE_SALTO = 50000;
/** Ids por lista in(...) nas leituras de entidade e de volume do global: o DQL recusa listas grandes demais (no LAB, 6 mil
    ids passam e 12 mil não: TOO_MANY_ELEMENTS_IN_REPETITIVE_GROUP); acima disto, em lotes. */
export const LOTE_IDS = 5000;
const emLotes = async (ids: string[], f: (lote: string[]) => Promise<Linhas>) => {
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += LOTE_IDS) lotes.push(ids.slice(i, i + LOTE_IDS));
  return (await Promise.all(lotes.map(f))).flat();
};
interface Chamada { de: string; para: string }

/** Os saltos de quem chama quem a partir das sementes, sobre ligações já lidas e na ordem em que vieram: o mesmo laço da
    leitura salto a salto (cada salto pega, na ordem, as ligações que saem da fronteira; quem aparece primeiro entra
    primeiro). Sobre as ligações de uma consulta só com todos os serviços expandidos, dá a mesma lista e a mesma ordem da
    leitura salto a salto, porque o Grail devolve as ligações de um subconjunto na mesma ordem em que aparecem na do
    conjunto inteiro (conferido no LAB). */
export function saltosSobre(sementes: Iterable<string>, ligacoes: Chamada[], saltos = SALTOS_BACKEND) {
  const vistos = new Set(sementes);
  let fronteira = new Set(vistos);
  const chamadas: Chamada[] = [];
  for (let salto = 0; salto < saltos && fronteira.size; salto++) {
    const novos = new Set<string>();
    for (const c of ligacoes) {
      if (!fronteira.has(c.de)) continue;
      chamadas.push({ de: c.de, para: c.para });
      if (!vistos.has(c.para)) { vistos.add(c.para); novos.add(c.para); }
    }
    fronteira = novos;
  }
  return { vistos, chamadas };
}

/** A cadeia pelo modelo de entidades (0 bytes): canal -> serviço (BCK-02) e até SALTOS_BACKEND saltos (BCK-03) a partir
    dos serviços dos canais e dos `extras` (os serviços das páginas). Com `extras` ainda por chegar (a promessa da leitura
    de spans), os saltos começam já pelos canais e, quando os spans chegam, só se lê o que falta: cada serviço é lido uma
    vez (R8). No fim, uma consulta com todos os serviços expandidos devolve as ligações na ordem do Grail, e os saltos
    são refeitos sobre ela (saltosSobre): a mesma lista e a mesma ordem da leitura salto a salto de antes (a ordem decide,
    num ciclo, que chamada o desenho corta). Essa consulta corre junto com nomes e volume. `chamadas` é essa promessa;
    `vistos` sai antes (o mesmo conjunto). `cortada` = alguma leitura passou do limite de linhas. */
export async function carregarCadeia(dql: Executor, canais: Map<string, string>, extras: string[] | Promise<string[]> = [], linhasCanais?: Linhas | Promise<Linhas>) {
  let chegaram = Array.isArray(extras);
  const pExtras = Promise.resolve(extras).then((e) => { chegaram = true; return e; });
  pExtras.catch(() => { /* quem chamou trata */ });
  const backend: { app: string; servico: string }[] = [];
  const q = qCanaisServicos([...canais.keys()]);
  if (q) for (const l of await (linhasCanais ?? dql(q, 5000, "BCK-02"))) {
    const app = canais.get(txt(l.canal)) ?? "", servico = txt(l.servico);
    if (app && servico) backend.push({ app, servico });
  }
  // ligações de cada serviço já lido nesta carga (a mesma consulta em voo serve a quem pedir de novo)
  const lidas = new Map<string, Promise<Chamada[]>>();
  let cortada = false;
  const ler = (ids: string[]) => {
    const faltam = ids.filter((id) => !lidas.has(id));
    if (faltam.length) {
      const p = dql(qChamadasEntidades(faltam), LIMITE_SALTO, "BCK-03").then((linhas) => {
        if (linhas.length >= LIMITE_SALTO) cortada = true;
        const por = new Map<string, Chamada[]>(faltam.map((id) => [id, []]));
        for (const l of linhas) { const de = txt(l.de), para = txt(l.para); if (de && para) por.get(de)?.push({ de, para }); }
        return por;
      });
      for (const id of faltam) { const d = p.then((por) => por.get(id) ?? []); d.catch(() => { /* quem espera trata */ }); lidas.set(id, d); }
    }
    return Promise.all(ids.map((id) => lidas.get(id)!));
  };
  const busca = async (sementes: string[], parar?: () => boolean) => {
    const vistos = new Set(sementes);
    let fronteira = [...vistos];
    const expandidos: string[] = [];
    for (let salto = 0; salto < SALTOS_BACKEND && fronteira.length; salto++) {
      if (parar?.()) return null;
      const listas = await ler(fronteira);
      expandidos.push(...fronteira);
      const novos: string[] = [];
      for (const lista of listas) for (const c of lista) if (!vistos.has(c.para)) { vistos.add(c.para); novos.push(c.para); }
      fronteira = novos;
    }
    return { vistos, expandidos };
  };
  const doCanal = backend.map((x) => x.servico);
  // os saltos a partir dos canais começam enquanto os spans não chegam; param no salto em que eles chegarem
  if (!chegaram) void busca(doCanal, () => chegaram).catch(() => { /* a busca final relê o que faltar e acusa a falha */ });
  const sementes = [...doCanal, ...(await pExtras)];
  const final = (await busca(sementes))!;
  /** ligacoes = as ligações de todos os serviços expandidos, na ordem do Grail (a da consulta única) ou, se ela não
      servir, na da leitura por serviço; chamadas = os saltos sobre elas (o que a cadeia devolve) */
  const ordenar = async (): Promise<{ ligacoes: Chamada[]; chamadas: Chamada[] }> => {
    const porServico = (await Promise.all(final.expandidos.map((id) => lidas.get(id)!))).flat();
    const com = (ligacoes: Chamada[]) => ({ ligacoes, chamadas: saltosSobre(sementes, ligacoes).chamadas });
    // (com mais serviços do que cabe numa lista, ou se a consulta falhar, fica a ordem da leitura por serviço: o mesmo
    // conjunto; só o corte de um ciclo no desenho pode mudar)
    if (cortada || !final.expandidos.length || final.expandidos.length > LOTE_IDS) return com(porServico);
    const linhas = await dql(qChamadasEntidades(final.expandidos), LIMITE_SALTO, "BCK-03").catch(() => null);
    if (!linhas || linhas.length >= LIMITE_SALTO) return com(porServico);
    const naOrdem = linhas.map((l) => ({ de: txt(l.de), para: txt(l.para) })).filter((c) => c.de && c.para);
    // o mesmo conjunto (o modelo de entidades pode mudar entre uma leitura e outra): senão, fica a leitura por serviço
    const k = (c: Chamada) => `${c.de}\u0001${c.para}`;
    const lidasK = new Set(porServico.map(k));
    return com(naOrdem.length === porServico.length && naOrdem.every((c) => lidasK.has(k(c))) ? naOrdem : porServico);
  };
  const ordem = ordenar();
  const chamadas = ordem.then((o) => o.chamadas), ligacoes = ordem.then((o) => o.ligacoes);
  for (const p of [ordem, chamadas, ligacoes]) p.catch(() => { /* quem chamou trata */ });
  return { backend, vistos: [...final.vistos], chamadas, ligacoes, cortada: () => cortada };
}

/* ---- Backend global (etapa 5) ----------------------------------------------------------------------------------
   Sem filtro de segmento, a ligação página -> serviço (spans x cópia, a parte cara do Flow) e a cadeia pelo modelo de
   entidades são lidas UMA vez para todas as aplicações por classe de janela, e cada escopo (aplicação x robôs) sai delas
   no navegador (comporBackend), com o mesmo resultado da leitura por escopo:
   - os spans são do ambiente inteiro (não têm aplicação); o que muda de um escopo para outro é só o lado da cópia
     (aplicação e robôs). A leitura global agrupa também por robô e não filtra nada; o navegador filtra a aplicação e
     soma ou tira os robôs (sem a coluna robo, "sem robôs" mostraria as chamadas dos robôs);
   - 2 h, 6 h, 24 h e 7 d leem o mesmo texto que 60 min (spans e start_time presos a JANELA_MAX_SPANS_MIN): duas
     classes, 30m e 60m;
   - a cadeia global parte dos canais de todas as aplicações e de todos os serviços da ligação global; a do escopo parte
     de um subconjunto, então tudo o que ela expande também foi expandido na global, e os saltos são refeitos no
     navegador a partir da fronteira do escopo (saltosSobre), na mesma ordem.
   Com filtro de segmento, o backend continua lido por escopo (o filtro está no lado da cópia, e o global mostraria
   contagens sem filtro). */

/** Classe da janela na ligação: acima de JANELA_MAX_SPANS_MIN, a ligação lê o mesmo texto que a da própria classe. */
export const classeLigacao = (janela: string) => { const m = minutosDe(janela); return m != null && m > JANELA_MAX_SPANS_MIN ? `${JANELA_MAX_SPANS_MIN}m` : janela; };
/** A maior janela do seletor na classe (a cadeia global da classe cobre as aplicações dela). */
export const janelaMaiorDaClasse = (classe: string) => [...JANELAS].reverse().find((j) => classeLigacao(j.valor) === classe)?.valor ?? classe;
/** Linhas da ligação global: bem acima das de "Todas" num ambiente grande (dezenas de milhares, com a coluna robo); passou disto,
    a leitura vem cortada (as menores ficam de fora) e cada aplicação volta a ler por escopo. */
export const LIMITE_LIGACAO_GLOBAL = 100000;
/** A ligação de todas as aplicações (qPaginasServicos sem os filtros de aplicação e de robôs), com robo =
    dt.rum.user_type == "robot": true, false ou null (sem tipo). "Sem robôs" (o filtro dt.rum.user_type != "robot" de
    hoje) fica com as linhas robo == false; com robôs, todas. Sem filtro de segmento (só é usada sem ele). */
export const qPaginasServicosGlobal = (classe: string) => `fetch spans, from: ${desdeLimitado(classe, JANELA_MAX_SPANS_MIN)}
| filter span.kind == "server" and isNotNull(dt.entity.service) and isNotNull(trace.id)
| fields back_trace = toString(trace.id), servico = dt.entity.service
| join [${fonteSessao(TODOS, classe, false, desdeCopiaLimitada(classe, JANELA_MAX_SPANS_MIN))}
        | filter characteristics.has_request == true and isNotNull(trace.id)
        | filter start_time >= ${inicioLimitado(classe, JANELA_MAX_SPANS_MIN)}
        | fields app = dt.rum.application.id, view = view.name, robo = dt.rum.user_type == "robot", rum_trace = toString(trace.id)],
       on: {left[back_trace] == right[rum_trace]}, kind: inner
| summarize chamadas = countDistinct(back_trace), by:{app = right.app, view = right.view, robo = right.robo, servico}
| sort chamadas desc, app asc, view asc, servico asc, robo asc
| limit ${LIMITE_LIGACAO_GLOBAL}`;

/* ---- Ligação na hora, com spans amostrados (1.42) -------------------------------------------------------------
   A ligação página -> serviço é lida ao abrir o Flow, para o período escolhido (no máximo a última hora, como sempre),
   com o cache compartilhado de 5 min. O que mudou desde a 1.40 é o lado dos spans: num ambiente grande eles somam um volume muito grande por hora
   e, lidos inteiros, passavam dos 128 MB do lado direito do join. Agora: o volume de spans de servidor da última hora sai
   de uma amostra de 1/10.000 (qContarSpans, relida no máximo de hora em hora), a amostragem é escolhida para o lado dos
   spans ficar abaixo de LINHAS_SPANS_LIGACAO linhas (razaoLigacao) e a cópia (lado esquerdo) é cruzada com os spans
   amostrados (lado direito, pequeno). As chamadas saem multiplicadas pela amostragem REAL (dt.system.sampling_ratio: o
   Grail pode aplicar 1/10 quando se pede mais, e a amostra é por span, não por trace): com amostragem acima de 1, a
   contagem é uma estimativa ("≈" na tela). No LAB o volume é pequeno e a amostragem é 1 (exata). Formato de
   qPaginasServicosGlobal (app, view, robo, servico, chamadas). Na 1.41 isto era calculado de hora em hora por um workflow;
   voltou a ser na hora (tempo real). */
export const RAZOES_AMOSTRA = [1, 10, 100, 1000, 10000] as const;
export const LINHAS_SPANS_LIGACAO = 500_000;
/** Amostragem da ligação para N spans de servidor estimados na hora. */
export const razaoLigacao = (spansHora: number) => RAZOES_AMOSTRA.find((r) => spansHora / r <= LINHAS_SPANS_LIGACAO) ?? 10000;
/** Spans de servidor com serviço e trace no intervalo, por amostra de 1/10.000 (multiplicar por 10.000). */
export const qContarSpans = (de: string, ate: string) => `fetch spans, from: "${de}", to: "${ate}", samplingRatio: 10000
| filter span.kind == "server" and isNotNull(dt.entity.service) and isNotNull(trace.id)
| summarize n = count(), razao = max(dt.system.sampling_ratio)
| fieldsAdd n = n * coalesce(razao, 10000)`;
/** O intervalo da ligação para a janela: no máximo os últimos JANELA_MAX_SPANS_MIN minutos dela (ISO). */
export const intervaloLigacao = (janela: string, agora = Date.now()) => {
  const m = minutosDe(janela);
  const [, fim] = m != null ? [] : janela.split("/");
  const ate = m != null ? agora : fim ? Date.parse(fim) : agora;
  const de = ate - Math.min(m ?? JANELA_MAX_SPANS_MIN, JANELA_MAX_SPANS_MIN) * 60000;
  return { de: new Date(de).toISOString(), ate: new Date(ate).toISOString() };
};
/** Os filtros de segmento em uso, para o lado da cópia da ligação (" and ..."; vazio sem filtro). */
export const filtroSegmentoDaCopia = () => filtroSegmento();
/** A ligação de todas as aplicações no intervalo, com os spans amostrados a 1/razao. `filtro` = filtros de segmento no
    lado da cópia (os spans não têm segmento). */
export const qLigacaoAmostrada = (de: string, ate: string, razao: number, filtro = "") => `fetch bizevents, from: "${de}", to: "${ate}", bucket: {${Object.values(BUCKETS_COPIA).map((b) => `"${b}"`).join(", ")}}
| filter characteristics.has_request == true and isNotNull(trace.id)${filtro}
| fields app = dt.rum.application.id, view = ${semParametro("view.name")}, robo = dt.rum.user_type == "robot", rum_trace = toString(trace.id)
| join [fetch spans, from: "${de}", to: "${ate}"${razao > 1 ? `, samplingRatio: ${razao}` : ""}
        | filter span.kind == "server" and isNotNull(dt.entity.service) and isNotNull(trace.id)
        | fields back_trace = toString(trace.id), servico = dt.entity.service, razao_real = dt.system.sampling_ratio
        | dedup {back_trace, servico}],
       on: {left[rum_trace] == right[back_trace]}, kind: inner
| summarize chamadas = countDistinct(rum_trace), razao_real = max(right.razao_real), by:{app, view, robo, servico = right.servico}
| fieldsAdd chamadas = chamadas * coalesce(razao_real, ${razao})
| fieldsRemove razao_real
| sort chamadas desc, app asc, view asc, servico asc, robo asc
| limit ${LIMITE_LIGACAO_GLOBAL}`;

/** A ligação do escopo (aplicação e robôs) a partir das linhas de qLigacaoAmostrada, como comporLigacao faz com a global: sem robôs,
    só as linhas robo == false; com robôs, somadas por página e serviço. */
export function ligacaoDoEscopo(linhas: Linhas, app: string, robos: boolean) {
  const ag = new Map<string, { app: string; view: string; servico: string; chamadas: number }>();
  for (const l of linhas) {
    const a = txt(l.app), v = txt(l.view), s = txt(l.servico), robo = l.robo === true || l.robo === "true" ? 1 : l.robo === false || l.robo === "false" ? 0 : 2;
    if (!s || (app !== TODAS && a !== app) || (!robos && robo !== 0)) continue;
    const k = `${a}\u0001${v}\u0001${s}`, atual = ag.get(k);
    if (atual) atual.chamadas += Number(l.chamadas ?? 0); else ag.set(k, { app: a, view: v, servico: s, chamadas: Number(l.chamadas ?? 0) });
  }
  return [...ag.values()].sort((a, b) => b.chamadas - a.chamadas || cmpTexto(a.app, b.app) || cmpTexto(a.view, b.view) || cmpTexto(a.servico, b.servico)).slice(0, LIMITE_LIGACAO);
}

/** O que a leitura global guarda (App State, compactado: dicionários e índices). */
export interface BackendGlobal {
  v: 1;
  classe: string;
  /** serviços: dicionário único da ligação e da cadeia */
  ids: string[];
  /** ligação de todas as aplicações: 5 números por linha (aplicação, página, serviço, robô 0 = não, 1 = sim, 2 = sem
      tipo, chamadas), na ordem do Grail; null = sem a cópia (o Flow abre sem ligação, como hoje) */
  lig: { apps: string[]; views: string[]; l: number[]; cortada: boolean } | null;
  /** a ligação falhou (mensagem); a cadeia veio */
  aviso: string | null;
  /** entidades das aplicações cuja cadeia foi lida e canal -> serviço (índice em canais, índice em ids), na ordem do Grail */
  canais: string[];
  pares: number[];
  /** serviço -> serviço (de, para): as ligações de todos os serviços expandidos, na ordem do Grail (carregarCadeia) */
  chamadas: number[];
  /** [índice, nome, tipo, tecnologia, fabricante] */
  servicos: (string | number | null)[][];
  /** alguma leitura de saltos passou do limite: a cadeia de um escopo pode não estar inteira aqui */
  cadeiaCortada: boolean;
}
export const ehBackendGlobal = (x: unknown): x is BackendGlobal => {
  const g = x as BackendGlobal;
  return !!g && g.v === 1 && Array.isArray(g.ids) && Array.isArray(g.canais) && Array.isArray(g.pares) && Array.isArray(g.chamadas) && Array.isArray(g.servicos)
    && (g.lig === null || (!!g.lig && Array.isArray(g.lig.l) && Array.isArray(g.lig.apps) && Array.isArray(g.lig.views)));
};

/** Lê o backend global de uma classe: a ligação (`ligacao`, null sem a cópia) em paralelo com a cadeia, que começa pelos
    canais das `entidades` (todas as aplicações) enquanto os spans não chegam. `aoVistos` recebe os serviços da cadeia
    (idsDoGlobal do resultado) assim que se sabem, para o volume da janela ser lido junto com nomes e ordem. Falha da
    ligação vira `aviso`; falha da cadeia lança (como carregarBackend). */
export async function carregarBackendGlobal(dql: Executor, classe: string, entidades: string[] | Promise<string[]>, ligacao: (() => Promise<Linhas>) | null, aoVistos?: (ids: string[]) => void): Promise<BackendGlobal> {
  const pLig = ligacao
    ? ligacao().then((linhas) => ({ linhas, aviso: null as string | null }), (e) => ({ linhas: [] as Linhas, aviso: e instanceof Error ? e.message : String(e) }))
    : Promise.resolve({ linhas: [] as Linhas, aviso: null as string | null });
  // a ligação no formato da de hoje (App.tsx: app e página vazios viram "", linha sem serviço sai)
  const linhas = pLig.then((r) => r.linhas.map((l) => ({ app: txt(l.app), view: txt(l.view), servico: txt(l.servico), robo: l.robo === true || l.robo === "true" ? 1 : l.robo === false || l.robo === "false" ? 0 : 2, chamadas: Number(l.chamadas ?? 0) })).filter((x) => x.servico));
  const ents = [...new Set((await entidades).filter(Boolean))];
  const canais = new Map(ents.map((e) => [e, e]));            // a cadeia guarda o canal; a aplicação sai da base de cada escopo
  const c = await carregarCadeia(dql, canais, linhas.then((ls) => [...new Set(ls.map((x) => x.servico))]));
  aoVistos?.([...c.vistos].sort());
  const [ligacoes, svc, lig, r] = await Promise.all([c.ligacoes, emLotes(c.vistos, (ids) => dql(qServicos(ids), Math.max(5000, ids.length), "BCK-04")), linhas, pLig]);
  const ids: string[] = [], pos = new Map<string, number>();
  const id = (s: string) => { let i = pos.get(s); if (i == null) { i = ids.length; pos.set(s, i); ids.push(s); } return i; };
  const dic = () => { const lista: string[] = [], m = new Map<string, number>(); return { lista, i: (s: string) => { let i = m.get(s); if (i == null) { i = lista.length; m.set(s, i); lista.push(s); } return i; } }; };
  const apps = dic(), views = dic();
  const l: number[] = [];
  for (const x of lig) l.push(apps.i(x.app), views.i(x.view), id(x.servico), x.robo, x.chamadas);
  const iCanal = new Map(ents.map((e, i) => [e, i]));
  return {
    v: 1, classe,
    lig: ligacao ? { apps: apps.lista, views: views.lista, l, cortada: r.linhas.length >= LIMITE_LIGACAO_GLOBAL } : null,
    aviso: r.aviso,
    canais: ents,
    pares: c.backend.flatMap((b) => [iCanal.get(b.app)!, id(b.servico)]),
    chamadas: ligacoes.flatMap((x) => [id(x.de), id(x.para)]),
    servicos: svc.map((s) => { const x = infoServico(s); return [id(x.id), x.nome, x.tipo, x.tecnologia, x.fabricante]; }),
    cadeiaCortada: c.cortada(),
    ids,                                                      // preenchido pelas linhas acima
  };
}

interface GlobalAberto { lig: { app: string; view: string; servico: string; robo: number; chamadas: number }[]; canais: Set<string>; pares: [string, string][]; chamadas: Chamada[]; info: Map<string, InfoServico> }
const abertos = new WeakMap<BackendGlobal, GlobalAberto>();
/** O global em objetos (uma vez por entrada: cada troca de aplicação compõe sobre o mesmo). */
function abrir(g: BackendGlobal): GlobalAberto {
  let a = abertos.get(g);
  if (a) return a;
  const L = g.lig, lig: GlobalAberto["lig"] = [];
  if (L) for (let i = 0; i + 4 < L.l.length; i += 5) lig.push({ app: L.apps[L.l[i]], view: L.views[L.l[i + 1]], servico: g.ids[L.l[i + 2]], robo: L.l[i + 3], chamadas: L.l[i + 4] });
  const pares: [string, string][] = [];
  for (let i = 0; i + 1 < g.pares.length; i += 2) pares.push([g.canais[g.pares[i]], g.ids[g.pares[i + 1]]]);
  const chamadas: Chamada[] = [];
  for (let i = 0; i + 1 < g.chamadas.length; i += 2) chamadas.push({ de: g.ids[g.chamadas[i]], para: g.ids[g.chamadas[i + 1]] });
  const info = new Map(g.servicos.map((s) => { const id = g.ids[Number(s[0])]; return [id, { id, nome: String(s[1] ?? ""), tipo: String(s[2] ?? ""), tecnologia: String(s[3] ?? ""), fabricante: s[4] == null ? null : String(s[4]) }]; }));
  a = { lig, canais: new Set(g.canais), pares, chamadas, info };
  abertos.set(g, a);
  return a;
}
const cmpTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** A ligação página -> serviço do escopo, a partir da global: a aplicação (ou todas), sem as linhas de robô (e as sem
    tipo, que o filtro de hoje também tira) ou com elas somadas por página e serviço; na ordem e no limite de
    qPaginasServicos (chamadas desc, aplicação, página, serviço). */
export function comporLigacao(g: BackendGlobal, app: string, robos: boolean): { app: string; view: string; servico: string; chamadas: number }[] {
  const ag = new Map<string, { app: string; view: string; servico: string; chamadas: number }>();
  for (const x of abrir(g).lig) {
    if (app !== TODAS && x.app !== app) continue;
    if (!robos && x.robo !== 0) continue;
    const k = `${x.app}\u0001${x.view}\u0001${x.servico}`;
    const atual = ag.get(k);
    if (atual) atual.chamadas += x.chamadas;            // um trace é de uma requisição só: a contagem distinta soma
    else ag.set(k, { app: x.app, view: x.view, servico: x.servico, chamadas: x.chamadas });
  }
  return [...ag.values()].sort((a, b) => b.chamadas - a.chamadas || cmpTexto(a.app, b.app) || cmpTexto(a.view, b.view) || cmpTexto(a.servico, b.servico)).slice(0, LIMITE_LIGACAO);
}
/** Os serviços com nome no global. */
export const servicosDoGlobal = (g: BackendGlobal) => g.servicos.map((s) => g.ids[Number(s[0])]);
/** Todos os serviços da cadeia global (os vistos da busca, em ordem fixa): o volume da janela é lido para eles, numa
    consulta de métrica (R$ 0), com a chave pelo resumo da lista. */
export const idsDoGlobal = (g: BackendGlobal) => [...g.ids].sort();
/** Volume da janela dos serviços (qVolumeServicos, em lotes de LOTE_IDS): as linhas da métrica. */
export const lerVolume = (dql: Executor, ids: string[], janela: string) => emLotes(ids, (lote) => dql(qVolumeServicos(lote, janela), Math.max(5000, lote.length), "BCK-05"));
/** O backend do escopo (o que carregarBackend e a ligação por escopo devolveriam), a partir do global: a ligação
    (comporLigacao), canal -> serviço dos canais do escopo (`canais` = entidade -> aplicação, como em carregarBackend),
    os saltos refeitos a partir da fronteira do escopo e os serviços com o volume da janela. null = o global não cobre o
    escopo (aplicação fora dos canais lidos, cadeia cortada): lê a cadeia do escopo à parte (0 bytes). */
export function comporBackend(g: BackendGlobal, app: string, robos: boolean, canais: Map<string, string>, volume: Map<string, number>, falhas: Map<string, number> = new Map()) {
  const a = abrir(g);
  if (g.cadeiaCortada) return null;
  for (const e of canais.keys()) if (!a.canais.has(e)) return null;
  const paginas = comporLigacao(g, app, robos);
  const backend: { app: string; servico: string }[] = [];
  for (const [canal, servico] of a.pares) { const x = canais.get(canal); if (x) backend.push({ app: x, servico }); }
  const { vistos, chamadas } = saltosSobre([...backend.map((x) => x.servico), ...new Set(paginas.map((x) => x.servico))], a.chamadas);
  const servicos = [...vistos].filter((id) => a.info.has(id)).map((id) => ({ ...a.info.get(id)!, requisicoes: volume.get(id) ?? 0, falhas: falhas.get(id) ?? 0 }));
  return { backend, servicos, chamadas, paginas };
}

/** Cliques e teclas dentro de uma tela. */
/** Cliques e teclas da página pelos agregados (lib/agregados.ts; sem contagem de sessões distintas, como a métrica de antes). */
export const qCliques = (app: string, janela: string, robos: boolean, view: string, so?: Trecho) => qCliquesAgregado(app, janela, robos, view, so);

/** Requisições XHR/fetch disparadas a partir de uma tela.
    Atenção: requisição que FALHOU (4xx/5xx) não vira evento "request"; vira evento "error" com
    characteristics.has_request = true. Por isso o filtro é pelo has_request, não pelo classifier. */
export const qRequisicoes = (app: string, janela: string, robos: boolean, view: string) => `${fonteSessao(ERRO_REQ, janela)}
| filter characteristics.has_request == true${filtroApp(app)}${filtroRobos(robos)}
| filter view.name == "${aspas(view)}" and ${CHAMADA_API}
| summarize n = count(), erros = countIf(characteristics.has_failed_request == true), dur_ms = avg(duration) / 1000000.0, ligadas = countIf(isNotNull(trace.id)), by:{caminho = url.path, dominio = url.domain}
| sort n desc
| limit 25`;

/** Erros registrados numa tela: exceções JS e requisições que falharam, agrupados pelo nome. */
export const qErros = (app: string, janela: string, robos: boolean, view: string) => `${fonteSessao(ERRO, janela)}
| filter characteristics.classifier == "error"${filtroApp(app)}${filtroRobos(robos)}
| filter view.name == "${aspas(view)}"
| summarize n = count(), sessoes = countDistinct(dt.rum.session.id), ultimo = max(start_time), by:{tipo = error.type, nome = coalesce(exception.message, error.display_name, concat(coalesce(toString(http.response.status_code), "?"), ": ", coalesce(url.domain, ""), coalesce(url.path, ""))), status = http.response.status_code, excecao_tipo = exception.type, terceiro = url.provider == "third_party" and not(contains(dt.rum.application.id, "-"))}
| sort n desc
| limit 30`;

/** Tempo de CARREGAMENTO da página (duração do evento de navegação; o "Time on page" é outro: tempo aberta). */
export const qCargaPagina = (app: string, janela: string, robos: boolean, view: string) => `${fonteSessao(NAV, janela)}
| filter characteristics.classifier == "navigation"${filtroApp(app)}${filtroRobos(robos)}
| filter view.name == "${aspas(view)}" and isNotNull(duration)
| summarize n = count(), media_ms = avg(toDouble(duration)) / 1000000.0, p75_ms = percentile(toDouble(duration), 75) / 1000000.0`;

/** Requisições recentes de uma tela que têm trace no backend (falhas primeiro), para abrir no Distributed Tracing. */
export const qTraces = (app: string, janela: string, robos: boolean, view: string, limite = 12) => `${fonteSessao(ERRO_REQ, janela)}
| filter characteristics.has_request == true${filtroApp(app)}${filtroRobos(robos)}
| filter view.name == "${aspas(view)}" and ${CHAMADA_API} and isNotNull(trace.id)
| fields start_time, caminho = url.path, trace = toString(trace.id), status = http.response.status_code, falhou = coalesce(characteristics.has_failed_request, false), dur_ms = duration / 1000000.0, sessao = dt.rum.session.id
| sort falhou desc, start_time desc
| limit ${limite}`;

/** Funil de uma jornada: por sessão, o instante da primeira passagem em cada passo; o passo k só conta se
    veio depois do passo k-1 (p0 = entraram no 1º passo, pN = concluíram). Devolve UMA linha: sessoes, p0..pN, q1..qN e
    erros0..errosN (erros na tela de cada passo: exceções JS + requisições com falha, na janela). Os erros saem da mesma
    leitura (soma de e_i); antes vinham de outra consulta que lia a mesma janela de novo. */
export const qFunil = (passos: { app: string; view: string }[], janela: string, robos: boolean) => {
  const cond = (p: { app: string; view: string }) => `(dt.rum.application.id == "${aspas(p.app)}" and view.name == "${aspas(p.view)}")`;
  // por sessão: instante da primeira passagem em cada passo e quantos erros a sessão teve em cada tela da jornada
  const tempos = passos.map((p, i) => `t${i} = min(if(${cond(p)} and characteristics.classifier == "navigation", start_time))`).join(", ");
  const erros = passos.map((p, i) => `e${i} = countIf(${cond(p)} and characteristics.classifier == "error")`).join(", ");
  const alcancou = (i: number) => passos.slice(0, i + 1).map((_, k) => (k === 0 ? "isNotNull(t0)" : `isNotNull(t${k}) and t${k} >= t${k - 1}`)).join(" and ");
  const contagens = passos.map((_, i) => `p${i} = countIf(${alcancou(i)})`).join(", ");
  // q_k: fizeram o passo k-1, não chegaram ao passo k E tiveram erro na tela do passo k-1 (abandono ligado a erro)
  const comErro = passos.slice(1).map((_, j) => { const k = j + 1; return `q${k} = countIf(${alcancou(k - 1)} and not (isNotNull(t${k}) and t${k} >= t${k - 1}) and e${k - 1} > 0)`; }).join(", ");
  // erros na tela do passo i = soma dos e_i de todas as sessões (mesmos registros que um count() dos erros dessa tela)
  const errosPasso = passos.map((_, i) => `erros${i} = sum(e${i})`).join(", ");
  return `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(passos.map((p) => p.app))}
| filter (characteristics.classifier == "navigation" or characteristics.classifier == "error") and (${passos.map(cond).join(" or ")})${filtroRobos(robos)}
| summarize ${tempos}, ${erros}, by:{dt.rum.session.id}
| summarize sessoes = count(), ${contagens}${comErro ? ", " + comErro : ""}, ${errosPasso}`;
};

/* ---- Quem não seguiu de um passo para o próximo (análise de abandono) ----------------------------------
   k = índice do passo de DESTINO (>= 1); a origem é passos[k-1]. "Chegou à origem" = cadeia até k-1 em ordem;
   "seguiu" = chegou ao destino depois da origem. Erros = eventos de erro na tela de origem, na mesma sessão. */
const baseAbandono = (passos: { app: string; view: string }[], k: number, janela: string, robos: boolean) => {
  const apps = [...new Set(passos.map((p) => p.app))];
  const cond = (p: { app: string; view: string }) => `(dt.rum.application.id == "${aspas(p.app)}" and view.name == "${aspas(p.view)}")`;
  const origem = passos[k - 1];
  const tempos = passos.slice(0, k + 1).map((p, i) => `t${i} = min(if(${cond(p)} and characteristics.classifier == "navigation", start_time))`).join(", ");
  const cadeia = passos.slice(0, k).map((_, i) => (i === 0 ? "isNotNull(t0)" : `isNotNull(t${i}) and t${i} >= t${i - 1}`)).join(" and ");
  return `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(apps)}
| filter in(dt.rum.application.id, ${lista(apps)}) and (characteristics.classifier == "navigation" or (characteristics.classifier == "error" and ${cond(origem)}))${filtroRobos(robos)}
| summarize ${tempos}, erros_origem = countIf(characteristics.classifier == "error"), ultimo = max(start_time), by:{sessao = dt.rum.session.id}
| filter ${cadeia}
| fieldsAdd t_origem = t${k - 1}, seguiu = isNotNull(t${k}) and t${k} >= t${k - 1}`;
};

/** Tem relação com erro? Sessões que chegaram à origem, separadas entre quem seguiu e quem não, com quantas tiveram erro na tela. */
export const qAbandonoCorrelacao = (passos: { app: string; view: string }[], k: number, janela: string, robos: boolean) => `${baseAbandono(passos, k, janela, robos)}
| summarize sessoes = count(), com_erro = countIf(erros_origem > 0), by:{seguiu}`;

/** Para onde foram: primeira tela visitada depois da origem por quem não seguiu (quem não aparece encerrou a sessão ali). */
export const qAbandonoDestinos = (passos: { app: string; view: string }[], k: number, janela: string, robos: boolean) => {
  const apps = [...new Set(passos.map((p) => p.app))];
  return `${fonteSessao(NAV, janela)}${remapQuadros(apps)}
| filter characteristics.classifier == "navigation" and in(dt.rum.application.id, ${lista(apps)})${filtroRobos(robos)}
| fields sessao = dt.rum.session.id, t = start_time, view = view.name
| join [${baseAbandono(passos, k, janela, robos)}
| filter not seguiu
| fields sessao, t_origem, erros_origem], on: {left[sessao] == right[sessao]}, kind: inner
| filter t > right.t_origem and view != "${aspas(passos[k - 1].view)}"
| sort t asc
| summarize proximo = takeFirst(view), erros_origem = takeFirst(right.erros_origem), by:{sessao}
| summarize sessoes = count(), com_erro = countIf(erros_origem > 0), by:{proximo}
| sort sessoes desc
| limit 20`;
};

/** As sessões que não seguiram (erros primeiro), com o início (t_origem) e o último registro na cópia. Desde a 1.41 sem o
    detalhe do user.sessions (replay, duração, motivo do fim): o Replay segue a configuração da aplicação. */
export const qAbandonoSessoes = (passos: { app: string; view: string }[], k: number, janela: string, robos: boolean, limite = 25) => `${baseAbandono(passos, k, janela, robos)}
| filter not seguiu
| fields sessao, t_origem, ultimo, erros_origem
| sort erros_origem desc, t_origem desc
| limit ${limite}`;

/* ---- Métricas próprias até a 1.40 (o app não usa mais) ----------------------------------------------------
   As 10 métricas extraídas pelo OpenPipeline (cobradas por série e minuto) deram lugar aos agregados por fatia
   (lib/agregados.ts). As consultas ficam para uma prova comparar as duas fontes enquanto as métricas
   ainda existem num ambiente; o app não as usa. */
export const METRICAS = {
  navegacao: "rum_flow.navigation",     // counter · navegação dentro da sessão · dims: dt.rum.application.id, dt.rum.application.entity, view.source.name, view.name, navigation.type, dt.rum.user_type
  entrada: "rum_flow.entry",            // counter · 1ª página da sessão (ligada ao canal) · dims: dt.rum.application.id, dt.rum.application.entity, view.name, navigation.type, dt.rum.user_type
  erro: "rum_flow.error",               // counter · dims: dt.rum.application.id, view.name, error.type, dt.rum.user_type
  view: "rum_flow.view",                // counter · 1 por view_summary (mesma definição de "views" do Grail) · dims: dt.rum.application.id, view.name, dt.rum.user_type
  tempoView: "rum_flow.view_time",      // value   · view.foreground_time (ns) · dims: dt.rum.application.id, view.name, dt.rum.user_type
};
const filtroRobosMetrica = (robos: boolean) => (robos ? "" : '\n| filter dt.rum.user_type != "robot"');
const filtroAppMetrica = (app: string) => (app === TODAS ? "" : `\n| filter dt.rum.application.id == "${aspas(app)}"`);

/** Verificação do pré-requisito: a métrica de navegação tem dados nas últimas 24 h? */
export const qMetricaDisponivel = () => `timeseries n = sum(${METRICAS.navegacao}, scalar: true), from: now()-24h`;

/** Entidades candidatas para um id de aplicação do RUM, quando a aplicação só aparece na cópia (erro ou requisição, sem
    navegação na janela) e a base por métricas não trouxe o nome: web "0123456789abcdef" -> APPLICATION-0123456789ABCDEF
    (ou CUSTOM_APPLICATION-); mobile, UUID "1a2b3c4d-5e6f-4a7b-8c9d-..." -> MOBILE_APPLICATION-1A2B3C4D5E6F4A7B (16 primeiros
    hexas). Exemplo: um app mobile que só manda erros apareceria pelo UUID na Visão geral. */
export const entidadesDoIdRum = (id: string): string[] => {
  const hex = id.replace(/-/g, "").toUpperCase();
  if (id.includes("-") && /^[0-9A-F]{32}$/.test(hex)) return [`MOBILE_APPLICATION-${hex.slice(0, 16)}`];
  if (/^[0-9A-F]{16}$/.test(hex)) return [`APPLICATION-${hex}`, `CUSTOM_APPLICATION-${hex}`];
  return [];
};
/** BAS-12: nome atual das entidades candidatas (consulta de entidades, R$ 0). */
/** Nome atual das aplicações pelas entidades (modelo de entidades, R$ 0). 30 dias: sem período, só vêm as entidades com
    atividade nas últimas horas, e a aplicação parada (o app mobile sem coleta no desenho de 24 h) ficava pelo id. */
export const qNomesAplicacoes = (entidades: string[]) => `fetch dt.entity.application, from: now()-30d
| filter in(id, ${lista(entidades)})
| fields entidade = id, nome = entity.name
| append [fetch dt.entity.mobile_application, from: now()-30d
| filter in(id, ${lista(entidades)})
| fields entidade = id, nome = entity.name]
| append [fetch dt.entity.custom_application, from: now()-30d
| filter in(id, ${lista(entidades)})
| fields entidade = id, nome = entity.name]`;

export const qAplicacoesMetrica = (janela: string) => `timeseries n = sum(${METRICAS.navegacao}, scalar: true), by:{dt.rum.application.id, dt.rum.application.entity}, from: ${desde(janela)}
| append [timeseries n = sum(${METRICAS.entrada}, scalar: true), by:{dt.rum.application.id, dt.rum.application.entity}, from: ${desde(janela)}]
| filter n > 0
| fieldsAdd nome = coalesce(${nomeAplicacao("dt.rum.application.entity")}, dt.rum.application.id)
| summarize navegacoes = sum(n), nome = takeFirst(nome), entidade = takeFirst(dt.rum.application.entity), by:{dt.rum.application.id}
| fieldsAdd sessoes = 0
| sort navegacoes desc
| limit 200`;

/** Ligações página -> página pelas métricas (consulta de métrica não é cobrada): o limite fica bem acima das ligações
    distintas que um ambiente grande deve ter (milhares em 30 min), para nenhuma página sumir do grafo, da busca e do isolar. */
export const LIMITE_ARESTAS_METRICA = 20000;
export const qArestasMetrica = (app: string, janela: string, robos: boolean) => `timeseries n = sum(${METRICAS.navegacao}, scalar: true), by:{dt.rum.application.id, view.source.name, view.name, navigation.type, dt.rum.user_type, navigation.tab_state}, from: ${desde(janela)}
| filter n > 0${filtroAppMetrica(app)}${filtroRobosMetrica(robos)}${filtroQuadrosMetrica()}
| append [timeseries n = sum(${METRICAS.entrada}, scalar: true), by:{dt.rum.application.id, view.name, navigation.type, dt.rum.user_type, navigation.tab_state}, from: ${desde(janela)}
  | filter n > 0${filtroAppMetrica(app)}${filtroRobosMetrica(robos)}${filtroQuadrosMetrica()}]
| ${NOMES_LIMPOS}
| summarize n = sum(n), by:{app = dt.rum.application.id, de = view.source.name, para = view.name, tipo = navigation.type}
| fieldsAdd sessoes = 0
| sort n desc
| limit ${LIMITE_ARESTAS_METRICA}`;

export const qErrosPorViewMetrica = (app: string, janela: string, robos: boolean) => `timeseries n = sum(${METRICAS.erro}, scalar: true), by:{dt.rum.application.id, view.name, error.type, dt.rum.user_type, url.provider}, from: ${desde(janela)}
| filter n > 0${filtroAppMetrica(app)}${filtroRobosMetrica(robos)}
| filter ${SO_PROPRIO}
| fieldsAdd view.name = ${semParametro("view.name")}
| summarize excecoes = sum(if(error.type == "exception", n, else: 0)), falhas = sum(if(error.type == "request", n, else: 0)), outros = sum(if(error.type != "exception" and error.type != "request", n, else: 0)), by:{app = dt.rum.application.id, view = view.name}
| fieldsAdd erros = excecoes + falhas + outros
| limit 4000`;

/** Views e tempo por tela. Views vêm do contador rum_flow.view (1 por view_summary, igual ao Grail; inclui views sem
    tempo em primeiro plano). O tempo médio vem da métrica de valor: em métrica `count()` conta pontos/séries, não
    medições, então o número de medições de cada série sai de soma/média e a média final é ponderada por ele. */
export const qViewsMetrica = (app: string, janela: string, robos: boolean) => `timeseries { tempo = avg(${METRICAS.tempoView}, scalar: true), soma = sum(${METRICAS.tempoView}, scalar: true) }, by:{dt.rum.application.id, view.name, dt.rum.user_type}, from: ${desde(janela)}
| filter soma > 0${filtroAppMetrica(app)}${filtroRobosMetrica(robos)}
| fieldsAdd medidos = soma / tempo, views = 0
| append [ timeseries views = sum(${METRICAS.view}, scalar: true), by:{dt.rum.application.id, view.name, dt.rum.user_type}, from: ${desde(janela)}
  | filter views > 0${filtroAppMetrica(app)}${filtroRobosMetrica(robos)}
  | fieldsAdd soma = 0, medidos = 0 ]
| fieldsAdd view.name = ${semParametro("view.name")}
| summarize soma = sum(soma), medidos = sum(medidos), views = sum(views), by:{app = dt.rum.application.id, view = view.name}
| fieldsAdd tempo_ms = soma / medidos / 1000000.0, sessoes = 0
| fieldsRemove soma, medidos
| limit 4000`;

/** Saúde dos serviços (painel de detalhes): requisições, falhas (detecção do Dynatrace) e tempo de resposta médio, das
    métricas nativas do serviço (dt.service.request.*; response_time em microssegundos). */
export const qSaudeServicos = (ids: string[], janela: string) => `timeseries { n = sum(dt.service.request.count, scalar: true), falhas = sum(dt.service.request.failure_count, scalar: true), rt_us = avg(dt.service.request.response_time, scalar: true) }, by:{dt.entity.service}, from: ${desde(janela)}
| filter in(dt.entity.service, ${lista(ids)})
| fields servico = dt.entity.service, n, falhas, rt_us`;

/** Qualidade do dado por aplicação (cópia enxuta, barata): telas abertas em aba nova sem origem nem página anterior,
    frames, telas sem nome e chamadas próprias sem trace. Ver lib/qualidade.ts. */
export const qQualidadeDado = (app: string, janela: string, robos: boolean) => `${fonteSessao(TODOS, janela)}
| filter (characteristics.classifier == "navigation" or characteristics.has_request == true)${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation", req = characteristics.has_request == true and ${SO_PROPRIO}
| summarize navs = countIf(nav), nova_aba_sem_origem = countIf(nav and isNull(view.source.name) and (isNull(page.source.url.path) or page.source.url.path == "") and navigation.tab_state == "new"),
    frames = countIf(nav and navigation.tab_state == "duplicated"), sem_nome = countIf(nav and isNull(view.name)), genericas = countIf(nav and endsWith(view.name, "Activity")), hibridas = countIf(nav and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m")),
    wv_and = countIf(nav and browser.name == "Android WebView"), wv_and_hib = countIf(nav and browser.name == "Android WebView" and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m")), ios_hib = countIf(nav and in(os.name, array("iOS", "iPadOS")) and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m")),
    reqs = countIf(req), reqs_trace = countIf(req and isNotNull(trace.id)), by:{app = dt.rum.application.id}
| limit 500`;
/** Domínio que mais recebe chamadas sem trace, por aplicação. */
export const qDominiosSemTrace = (app: string, janela: string, robos: boolean) => `${fonteSessao(TODOS, janela)}
| filter characteristics.has_request == true and isNull(trace.id) and ${SO_PROPRIO}${filtroApp(app)}${filtroRobos(robos)}
| summarize n = count(), by:{app = dt.rum.application.id, dominio = url.domain}
| sort n desc
| limit 500`;

/* ---- Visão geral (tela inicial) ------------------------------------------------------------------------------------
   Indicadores por SESSÃO, da cópia enxuta: onde cada sessão termina (e se teve erro naquela página), visitas e tempo de
   carga por página, caminhos mais comuns e os erros agrupados pelo que o cliente sentiu. Uma varredura da cópia por
   consulta; terceiros e frames ficam fora, como no fluxo. Montagem em lib/inicio.ts. */
const NAV_OU_ERRO = () => `((characteristics.classifier == "navigation"${filtroQuadros()}) or (characteristics.classifier == "error" and ${SO_PROPRIO}))`;

/** Por última página da sessão: quantas sessões terminam ali, quantas tiveram erro NAQUELA página (saiu depois de um
    erro), quantas viram uma página só, quantas tiveram algum erro e o total de navegações (páginas por sessão). */
export const qInicioFins = (app: string, janela: string, robos: boolean) => `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(app)}
| filter ${NAV_OU_ERRO()}${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation", err = characteristics.classifier == "error"
| summarize navs = countIf(nav), erros = countIf(err), ultima = arrayLast(arraySort(arrayRemoveNulls(collectArray(if(nav, record(t = start_time, v = view.name)))))), ultima_err = arrayLast(arraySort(arrayRemoveNulls(collectArray(if(err, record(t = start_time, v = view.name)))))), views_erro = collectDistinct(if(err, view.name)), by:{app = dt.rum.application.id, sessao = dt.rum.session.id}
| filter navs > 0 or erros > 0
| fieldsAdd fim = coalesce(ultima[v], ultima_err[v])
| fieldsAdd saiu_erro = arrayIndexOf(views_erro, fim) >= 0
| summarize fins = count(), fins_erro = countIf(saiu_erro), uma = countIf(navs == 1), com_erro = countIf(erros > 0), navs = sum(navs), by:{app, fim}
| limit 4000`;

/** Países em que o mapa abre por região (estado). Os demais ficam inteiros (uma bolha por país). */
export const PAISES_COM_REGIAO = ["BR"];
/** Onde a sessão está: país (ISO 3166-1 alfa-2, "BR") e, nos PAISES_COM_REGIAO, a região como o RUM grava em
    geo.region.name (nome em inglês do provedor de geolocalização, com acento: "São Paulo"; o DF pode vir como
    "Federal District" ou "Distrito Federal"). Vazio = sem local. A casa com a UF fica em lib/lugares.ts (na hora de
    desenhar); o filtro usa sempre o valor cru. */
const LUGAR_PAIS = 'coalesce(geo.country.iso_code, "")';
const LUGAR_REGIAO = () => `if(in(geo.country.iso_code, ${lista(PAISES_COM_REGIAO)}), coalesce(geo.region.name, ""), else: "")`;
/** Teto de linhas de lugar em qInicioPaginas: vêm antes das páginas (ordem por tipo) e o limite cresce na mesma
    medida. 300 cobre todos os países (~250 códigos ISO) e os 27 estados: os lugares nunca tiram espaço das páginas. */
export const LIMITE_LUGARES = 300;

/** Visitas, erros e tempo de CARGA por página (duração da navegação; no app nativo vem zerada e fica de fora) e, NA
    MESMA VARREDURA, os mesmos números por lugar (mapa da visão geral): cada evento entra duas vezes no resumo (expand
    de 2 chaves), uma pela página (tipo "pagina", como sempre) e outra pelo lugar (tipo "lugar": país e, no Brasil, o
    estado; app "*" porque o mapa é do escopo inteiro). A cobrança do Grail é pelos bytes da janela varrida, não pelas
    colunas nem pelas linhas do resumo (medido no LAB em 16/10: count() e 12 campos leram os mesmos 8.887.383 B), então
    o mapa sai sem custo de leitura. Linhas de página: idênticas às de antes (provado por valor no LAB). */
export const qInicioPaginas = (app: string, janela: string, robos: boolean) => `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(app)}
| filter ${NAV_OU_ERRO()}${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation"
| fieldsAdd d = if(nav and toDouble(duration) > 0, toDouble(duration))
| fieldsAdd grupo = array(record(tipo = "pagina", app = dt.rum.application.id, view = view.name), record(tipo = "lugar", app = "${TODAS}", pais = ${LUGAR_PAIS}, regiao = ${LUGAR_REGIAO()}))
| expand grupo
| summarize visitas = countIf(nav), erros = countIf(not nav), sessoes = countDistinct(dt.rum.session.id), sessoes_erro = countDistinct(if(not nav, dt.rum.session.id)), media_ms = avg(d) / 1000000.0, p75_ms = percentile(d, 75) / 1000000.0, by:{tipo = grupo[tipo], app = grupo[app], view = grupo[view], pais = grupo[pais], regiao = grupo[regiao]}
| sort tipo asc
| limit ${4000 + LIMITE_LUGARES}`;

/** O mesmo resumo por lugar numa consulta própria. NÃO é usada pela tela (o mapa vem de qInicioPaginas, sem varredura
    a mais): fica como referência e plano B se o expand pesar num ambiente grande (aí custa 1 varredura da cópia, a mesma
    de cada consulta da visão geral, e entra no mesmo cache de 5 min da visão geral). */
export const qInicioLugares = (app: string, janela: string, robos: boolean) => `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(app)}
| filter ${NAV_OU_ERRO()}${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation"
| fieldsAdd d = if(nav and toDouble(duration) > 0, toDouble(duration))
| summarize visitas = countIf(nav), erros = countIf(not nav), sessoes = countDistinct(dt.rum.session.id), sessoes_erro = countDistinct(if(not nav, dt.rum.session.id)), media_ms = avg(d) / 1000000.0, p75_ms = percentile(d, 75) / 1000000.0, by:{pais = ${LUGAR_PAIS}, regiao = ${LUGAR_REGIAO()}}
| limit ${LIMITE_LUGARES}`;

/** Caminho de cada sessão (até 12 telas, em ordem), agrupado. Repetição seguida da mesma tela sai no app. */
export const SEPARADOR_CAMINHO = " › ";
/** Com o caminho vêm as páginas onde cada sessão teve erro (erros = uma entrada por sessão e página) e quantas
    sessões terminaram na página do erro (fim_erro): a etapa com erro fica vermelha no fluxo. */
export const qInicioCaminhos = (app: string, janela: string, robos: boolean) => `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(app)}
| filter ${NAV_OU_ERRO()}${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation"
| summarize telas = arraySort(arrayRemoveNulls(collectArray(if(nav, record(t = start_time, v = coalesce(view.name, "(no name)")))))), verro = arrayRemoveNulls(collectDistinct(if(not nav, view.name))), by:{app = dt.rum.application.id, sessao = dt.rum.session.id}
| filter arraySize(telas) > 0
| fieldsAdd caminho = arrayToString(arraySlice(iCollectArray(telas[][v]), from: 0, to: 12), delimiter: "${SEPARADOR_CAMINHO}"), ultima = arrayLast(telas)[v]
| fieldsAdd fim_erro = arrayIndexOf(verro, ultima) >= 0
| summarize n = count(), fim_erro = countIf(fim_erro), erros = arrayFlatten(collectArray(verro)), by:{app, caminho}
| sort n desc
| limit 2000`;

/** Erros por página ao longo do período, em faixas (o cartão desenha a linha): intervalo pelo tamanho da janela. Uma linha
    por aplicação x página, com a contagem de cada faixa (antes era uma linha por faixa e o limite de 5000 cortava o
    fim do período em janelas com muitas páginas). As faixas são as mesmas de bin(start_time, intervalo). */
export const INTERVALO_SERIE: Record<string, string> = { "10m": "1m", "30m": "1m", "60m": "5m", "24h": "1h", "7d": "6h" };
export const qInicioSerieErros = (app: string, janela: string, robos: boolean) => `${fonteSessao(ERRO, janela)}
| filter characteristics.classifier == "error" and ${SO_PROPRIO}${filtroApp(app)}${filtroRobos(robos)}
| makeTimeseries n = count(), by:{app = dt.rum.application.id, view = view.name}, interval: ${INTERVALO_SERIE[janela] ?? "5m"}, time: start_time
| limit 5000`;
/** Linhas de qInicioSerieErros (n = contagem por faixa, timeframe e interval em ns) -> uma linha por faixa com erro
    {app, view, t, n}, o formato que a Visão geral monta (montarSeries). */
export const linhasDaSerieErros = (linhas: Record<string, unknown>[]) => linhas.flatMap((l) => {
  const tf = l.timeframe as { start?: string } | undefined, ini = Date.parse(String(tf?.start ?? "")), passo = Number(l.interval) / 1e6;
  if (isNaN(ini) || !(passo > 0) || !Array.isArray(l.n)) return [];
  const app = l.app == null ? "" : String(l.app), view = l.view == null ? null : String(l.view);
  return (l.n as unknown[]).map((v, k) => ({ app, view, t: new Date(ini + k * passo).toISOString(), n: v == null || v === "" ? 0 : Number(v) })).filter((x) => x.n > 0);
});

/** Erros da própria aplicação agrupados pelo que o cliente sentiu: chamada ao servidor que falhou (status + caminho),
    erro na tela (mensagem) ou o app que fechou; com sessões afetadas e as páginas onde aconteceu. */
export const qInicioErros = (app: string, janela: string, robos: boolean) => `${fonteSessao(ERRO, janela)}
| filter characteristics.classifier == "error" and ${SO_PROPRIO}${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd msg = substring(coalesce(exception.message, error.display_name, ""), from: 0, to: 140)
| summarize n = count(), sessoes = countDistinct(dt.rum.session.id), paginas = collectDistinct(view.name), by:{app = dt.rum.application.id, tipo = error.type, status = http.response.status_code, caminho = url.path, dominio = url.domain, msg}
| sort sessoes desc
| limit 300`;

/** Sessões com erro (as mais recentes primeiro), para a lista aberta pelos indicadores e pelo "o que melhorar":
    onde e qual foi o 1º erro, onde a sessão terminou e se terminou na página do erro. `soSaiu` = só as que terminaram
    na página onde o erro aconteceu; `view` = só as que tiveram erro nessa página. */
export const qInicioSessoes = (app: string, janela: string, robos: boolean, filtro: { soSaiu?: boolean; view?: string | null }, limite = 50) => {
  // com página escolhida, o erro mostrado é o daquela página
  const erroAlvo = filtro.view ? `not nav and view.name == "${aspas(filtro.view)}"` : "not nav";
  return `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(app)}
| filter ${NAV_OU_ERRO()}${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation"
| fieldsAdd msg = substring(coalesce(exception.message, error.display_name, ""), from: 0, to: 140)
| summarize inicio = min(start_time), ultimo = max(start_time), navs = countIf(nav), erros = countIf(not nav),
    ultima = arrayLast(arraySort(arrayRemoveNulls(collectArray(if(nav, record(t = start_time, v = view.name)))))),
    primeiro = arrayFirst(arraySort(arrayRemoveNulls(collectArray(if(${erroAlvo}, record(t = start_time, v = view.name, tipo = error.type, status = http.response.status_code, caminho = url.path, msg = msg)))))),
    verro = arrayRemoveNulls(collectDistinct(if(not nav, view.name))), by:{app = dt.rum.application.id, sessao = dt.rum.session.id}
| filter erros > 0
| fieldsAdd fim = ultima[v], saiu_erro = arrayIndexOf(verro, ultima[v]) >= 0${filtro.soSaiu ? "\n| filter saiu_erro" : ""}${filtro.view ? `\n| filter arrayIndexOf(verro, "${aspas(filtro.view)}") >= 0` : ""}
| fields app, sessao, inicio, ultimo, navs, erros, fim, saiu_erro, erro_view = primeiro[v], erro_tipo = primeiro[tipo], erro_status = primeiro[status], erro_caminho = primeiro[caminho], erro_msg = primeiro[msg]
| sort inicio desc
| limit ${limite}`;
};

/* ---- Onde falha no backend (sob demanda, na visão geral) -----------------------------------------------------------
   1) as falhas de chamada ao servidor mais recentes da página, com trace (cópia enxuta);
   2) os spans com falha desses traces, lendo SÓ a janela em volta das falhas (custo baixo);
   3) quem chama quem entre os serviços com falha (modelo de entidades): a origem é o serviço com falha que não chama
      outro serviço com falha (os proxies, gateway e ingress repassam o erro e também aparecem com falha). */
export const qFalhasComTrace = (app: string, view: string, janela: string, robos: boolean, limite = 15) => `${fonteSessao(ERRO, janela)}
| filter characteristics.classifier == "error" and error.type == "request" and isNotNull(trace.id) and ${SO_PROPRIO}${filtroApp(app)}${filtroRobos(robos)}
| filter view.name == "${aspas(view)}"
| sort start_time desc
| limit ${limite}
| fields t = start_time, trace = toString(trace.id), caminho = url.path, status = http.response.status_code`;
/** Filtro de trace direto no campo cru (toUid nos valores, não toString no campo): o Grail descarta os blocos que não
    têm o trace (medido no LAB em 19/10: 9,7 MB contra 88,2 MB com toString(trace.id)). */
export const filtroTraces = (traces: string[]) => `in(trace.id, array(${traces.map((x) => `toUid("${aspas(x)}")`).join(", ")}))`;
/** razao > 1 = spans amostrados (samplingRatio): a origem tenta primeiro 1/10 e relê exata quando a amostra acha menos
    de 3 traces (lib/evidencias.ts). */
export const qSpansComFalha = (traces: string[], de: string, ate: string, razao = 1) => `fetch spans, from: "${de}", to: "${ate}"${razao > 1 ? `, samplingRatio: ${razao}` : ""}
| filter ${filtroTraces(traces)}
| filter span.kind == "server" and isNotNull(dt.entity.service) and (request.is_failed == true or span.status_code == "error")
| fields trace = toString(trace.id), servico = dt.entity.service, nome = entityName(dt.entity.service), status = http.response.status_code, inicio = start_time
| limit 2000`;
/** Exceções dos spans com falha nos mesmos traces e janela de qSpansComFalha (a mensagem é cortada em 200). */
export const qExcecoesFalha = (traces: string[], de: string, ate: string) => `fetch spans, from: "${de}", to: "${ate}"
| filter ${filtroTraces(traces)}
| filter isNotNull(dt.entity.service) and (request.is_failed == true or span.status_code == "error")
| expand ev = span.events
| filter ev[span_event.name] == "exception"
| summarize n = count(), by:{servico = entityName(dt.entity.service), tipo = ev[exception.type], msg = substring(ev[exception.message], from: 0, to: 200)}
| sort n desc
| limit 10`;
/** Problemas do Davis que tocam a aplicação ou os serviços (afetados ou causa), no período. */
export const qProblemasDavis = (entidades: string[], de: string, ate: string) => `fetch dt.davis.problems, from: "${de}", to: "${ate}"
| filter iAny(in(affected_entity_ids[], ${lista(entidades)})) or in(root_cause_entity_id, ${lista(entidades)})
| dedup display_id, sort: {timestamp desc}
| fields id = display_id, nome = event.name, estado = event.status, categoria = event.category, inicio = event.start, causa = root_cause_entity_name
| sort inicio desc
| limit 5`;
/** Deploys e mudanças de configuração nos serviços nas 24 h antes do fim do período. */
export const qMudancas = (servicos: string[], ate: string) => `fetch events, from: "${new Date(Date.parse(ate) - 864e5).toISOString()}", to: "${ate}"
| filter event.kind == "SDLC_EVENT" or in(event.type, {"CUSTOM_DEPLOYMENT", "CUSTOM_CONFIGURATION", "MARKED_FOR_TERMINATION"})
| filter iAny(in(affected_entity_ids[], ${lista(servicos)})) or in(dt.entity.service, ${lista(servicos)})
| fields t = timestamp, tipo = coalesce(event.type, event.kind), nome = event.name, versao = coalesce(deployment.version, dt.event.deployment_version)
| sort t desc
| limit 5`;
export const qChamadasEntre = (ids: string[]) => `fetch dt.entity.service
| filter in(id, ${lista(ids)})
| fields id, chama = calls[\`dt.entity.service\`]`;

/* ---- Apdex de Web Vitals (Visão geral) -----------------------------------------------------------------------------
   Fonte: custom.rum.web_vitals.apdex_score, métrica de um pipeline de user.events do ambiente (exemplo em docs/apdex.md). Uma
   medição por resumo de página (page_summary) com ao menos um Web Vital; valor = média das notas de FCP, LCP, CLS e INP
   (1 / 0,5 / 0). A média ponderada da métrica é o Apdex e soma / média dá o número de medições (count() conta pontos, não
   medições). Consulta de métrica não é cobrada. Dimensões usadas: frontend.name, browser.name, os.name, view.name.
   Não tem a aplicação (id/entidade), país, região, versão nem dt.rum.user_type: a aplicação do DEF vira frontend.name pelas
   métricas nativas (qApdexNomes); país, região e versão não filtram; robôs entram. Só web (mobile não tem Web Vitals).
   Montagem em lib/apdex.ts. */
export const METRICA_APDEX = "custom.rum.web_vitals.apdex_score";

/** Par entidade web -> frontend.name dos últimos 7 dias. frontend.name não é o nome da entidade ("Banco_Demo__PF" x
    "Banco Demo | PF") e muda se a aplicação for renomeada, então o par vem do dado: métricas nativas do RUM que têm as
    duas dimensões (carga de página e requisição). Janela fixa de 7 dias para achar o nome mesmo de quem não teve tráfego
    agora (o "sem medição em 7 dias" depende disso). Grátis. */
export const qApdexNomes = () => `timeseries n = sum(dt.frontend.web.navigation.load_event_end, scalar: true), by:{dt.rum.application.entity, frontend.name}, from: now()-7d
| append [timeseries n = sum(dt.frontend.request.count, scalar: true), by:{dt.rum.application.entity, frontend.name}, from: now()-7d]
| filter startsWith(toString(dt.rum.application.entity), "APPLICATION-") and isNotNull(frontend.name)
| summarize n = sum(n), by:{entidade = dt.rum.application.entity, frontend = frontend.name}
| limit 2000`;

/** Recorte da métrica de Apdex: frontend.name das aplicações do escopo (null = sem recorte) e os filtros de segmento que
    ela tem (sistema e navegador). País, região e versão não existem nela (ver apdexIgnorados). */
const filtroApdex = (nomes: string[] | null) => {
  const partes = [
    ...(nomes ? [`in(frontend.name, ${lista(nomes)})`] : []),
    ...(segmento.os ? [`os.name == "${aspas(segmento.os)}"`] : []),
    ...(segmento.navegador ? [`browser.name == "${aspas(segmento.navegador)}"`] : []),
  ];
  return partes.length ? `, filter: { ${partes.join(" and ")} }` : "";
};
/** Filtros de segmento ativos que o Apdex não aplica (a métrica não tem a dimensão). */
export const apdexIgnorados = (): (keyof Segmento)[] => (["pais", "regiao", "versao"] as (keyof Segmento)[]).filter((k) => !!segmento[k]);
/** Séries de Apdex por página reagrupadas pelo nome limpo (semParametro; dado gravado antes do processador de nomes, ou a
    métrica de Apdex, que lê o view.name cru): a nota volta ponderada pelas medições (soma / média) e, com um nome já
    limpo, é a mesma série de antes. Série com média 0 não diz quantas medições tem: conta como 1 (a mesma convenção da
    perda no mínimo 1), para a carga frustrada não sumir quando ela é fundida com outra série do mesmo nome (revisão de
    19/10: sozinha, nota 0 e perda 1 como antes; fundida com uma série de nota 1, 0,5 e perda 1). */
const REAGRUPAR_APDEX = (campo: string) => `fieldsAdd view.name = ${semParametro(campo)}, medidos = if(apdex > 0, soma / apdex, else: 1.0)
  | summarize soma = sum(soma), medidos = sum(medidos), by:{frontend.name, view.name}
  | fieldsAdd apdex = if(medidos > 0, soma / medidos, else: 0.0)`;

/** O cartão inteiro numa consulta (grátis). Linhas por `tipo`:
    total    · Apdex do escopo (média ponderada pelo motor) e medições (soma / média);
    app      · Apdex e medições por aplicação (frontend.name), para "Todas";
    pagina   · por aplicação e página (view.name), ordenadas pela perda (medições que não tiveram nota 1: o que mais puxa o
               Apdex do escopo para baixo); com média 0 o número de medições não sai da métrica e a perda fica no mínimo, 1;
    carga    · o mesmo por página da CARGA (page.name, agregados "carga" do DEF, lib/agregados.ts: numa SPA o view.name
               da métrica de Apdex é a tela em que o cliente saiu), que a lista usa no lugar de "pagina" quando existe
               (os agregados não têm sistema nem navegador: com esses filtros, fica o view.name);
    serie    · Apdex por faixa do período (a linha do cartão), no mesmo intervalo da série de erros da Visão geral;
    escopo7d · medições do escopo em 7 dias: separa "sem medição agora" de "esta aplicação não manda Web Vitals";
    ambiente · medições do ambiente inteiro em 7 dias: sem nada, a métrica não existe ou está desligada neste ambiente;
    usuarios · medições de LCP por tipo de usuário (métrica nativa dos mesmos resumos de página, mesmo recorte): quanto de
               robô entra no Apdex, que a métrica de Apdex não separa. */
export const qApdex = (nomes: string[] | null, janela: string, t?: Trecho) => {
  const f = filtroApdex(nomes), de = desde(janela), M = METRICA_APDEX, N = "dt.frontend.web.page.largest_contentful_paint";
  return `timeseries { apdex = avg(${M}, scalar: true), soma = sum(${M}, scalar: true) }, from: ${de}${f}
| fieldsAdd tipo = "total"
| append [timeseries { apdex = avg(${M}, scalar: true), soma = sum(${M}, scalar: true) }, by:{frontend.name}, from: ${de}${f}
  | fieldsAdd tipo = "app"]
| append [timeseries { apdex = avg(${M}, scalar: true), soma = sum(${M}, scalar: true) }, by:{frontend.name, view.name}, from: ${de}${f}
  | ${REAGRUPAR_APDEX("view.name")}
  | fieldsAdd tipo = "pagina", perda = if(apdex > 0, soma / apdex - soma, else: 1.0)
  | sort perda desc, apdex asc
  | limit 200]${segmento.os || segmento.navegador ? "" : `
| append [${qApdexCargaAgregado(nomes, janela, t).split("\n").join("\n  ")}]`}
| append [timeseries serie = avg(${M}), from: ${de}, interval: ${INTERVALO_SERIE[janela] ?? "5m"}${f}
  | fieldsAdd tipo = "serie"]
| append [timeseries { apdex = avg(${M}, scalar: true), soma = sum(${M}, scalar: true) }, from: now()-7d${f}
  | fieldsAdd tipo = "escopo7d"]
| append [timeseries soma = sum(${M}, scalar: true), from: now()-7d
  | fieldsAdd tipo = "ambiente"]
| append [timeseries { t = avg(${N}, scalar: true), s = sum(${N}, scalar: true) }, by:{dt.rum.user_type}, from: ${de}${f}
  | fieldsAdd tipo = "usuarios", cargas = s / t]
| fieldsAdd medicoes = if(apdex > 0, soma / apdex)
| fields tipo, frontend = frontend.name, view = view.name, apdex, soma, medicoes, perda, serie, timeframe, interval, usuario = dt.rum.user_type, cargas`;
};

/* ---- Apdex mobile (Visão geral) -------------------------------------------------------------------------------------
   Fonte: os agregados "amob" (lib/agregados.ts): por aplicação, tela, sistema, ação, tipo de abertura, item (acao,
   abertura, tela, crash, anr) e faixa (satisfeito = 1, tolerante = 0,5, frustrado_tempo e frustrado_erro = 0), pelas
   regras de REGRAS_APDEX_MOBILE (lib/prerequisitos.ts). Até a 1.40 era a métrica rum_flow.mobile_apdex, com as mesmas
   dimensões e regras. A abertura do app (p75 por tipo) vem da métrica nativa dt.frontend.mobile.app_start.duration (ms,
   consulta de métrica: grátis). Filtro de sistema aplicado; país, região e versão não existem nos agregados. Montagem em
   lib/apdex.ts (montarApdexMobile), que escolhe por aplicação ação ou tela. */

/* ---- Apdex por lugar (mapa "Onde estão os clientes") ----------------------------------------------------------------
   Fonte: os agregados "lugar" (lib/agregados.ts): por canal, aplicação, país, estado e faixa (satisfeito = 1, tolerante =
   0,5, frustrado = 0). Sem filtro de segmento. Montagem em lib/lugares.ts (montarMapa). */
/** APX-04: contagem por canal, aplicação, lugar e faixa. */
export const qApdexLugares = (apps: string[], janela: string, t?: Trecho) => qApdexLugaresAgregado(apps, janela, t);

/** O lado mobile do cartão (grátis a abertura; os agregados, centavos). Linhas por `linha`:
    base     · contagem por aplicação, frontend, sistema, item e faixa (nota do escopo, por aplicação e por sistema);
    item     · por aplicação, item, tela, nome da ação e tipo de abertura, com as faixas somadas e a perda (o que falta
               para 1): as que mais puxam o Apdex para baixo primeiro;
    serie    · contagem por faixa do período, por aplicação e item (a linha do cartão), em faixas de pelo menos 5 min;
    escopo7d · contagem das aplicações em 7 dias: separa "sem medição agora" de "a regra não grava nada";
    abertura · p75 e quantidade da abertura do app por tipo (métrica nativa), pelas entidades mobile do escopo. */
export const qApdexMobile = (apps: string[], entidades: string[], janela: string, t?: Trecho) => {
  const so = segmento.os ? ` and os.name == "${aspas(segmento.os)}"` : "";
  const abertura = entidades.length ? `
| append [timeseries { p75 = percentile(dt.frontend.mobile.app_start.duration, 75, scalar: true), n = sum(dt.frontend.mobile.app_start.count, scalar: true) }, by:{app_start.type}, from: ${desde(janela)}, filter: { in(dt.rum.application.entity, ${lista(entidades)})${so} }
  | fields linha = "abertura", tipoAbertura = app_start.type, p75, n]` : `
| fieldsAdd p75 = if(false, 0.0)`;                           // sem entidade, sem a abertura: o campo existe vazio
  return `${qApdexMobileAgregado(apps, janela, segmento.os ?? null, INTERVALO_SERIE[janela], t)}${abertura}
| fields linha, app, frontend, sistema, item, faixa, view, acao, tipoAbertura, n, sat, tol, erro, lento, perda, p75, serie, timeframe, interval`;
};

/* ---- Consultas juntadas (etapa 4 do plano de DPS) ------------------------------------------------------------------
   A leitura da cópia é cobrada pelos bytes da janela varrida, não pelas colunas nem pelas linhas do resumo: consultas que
   leem o mesmo bucket na mesma janela passam a ser UMA leitura. Cada registro entra em um ou mais grupos (expand, como os
   lugares da qInicioPaginas) com o filtro e a agregação da consulta de hoje, e o resultado vem ordenado pelo grupo;
   separarGrupos devolve as linhas que cada consulta de hoje devolveria, com os mesmos campos. Grupo que hoje sai sem sort
   (o limit corta qualquer linha) vem antes e só vale inteiro: passou do limite, é transbordo e roda a consulta de hoje
   (plano B, lib/juntas.ts). Grupo que hoje sai com sort vem depois e vale o topo dele. As consultas de hoje continuam
   aqui: são o plano B e a leitura acima da guarda de tamanho. */

/** Um grupo de uma consulta juntada: a consulta de hoje que ele substitui, o limite dela e se ela ordena antes do limite. */
export interface GrupoJunto { nome: string; limite: number; ordenado: boolean }
export type Linhas = Record<string, unknown>[];
/** Linhas de uma consulta juntada -> as de cada consulta de hoje (null = transbordo: refazer pela consulta de hoje). Os
    grupos vêm na ordem do sort da consulta; limiteTotal = o limit dela (vieram limiteTotal linhas: o fim pode ter sido
    cortado, e o grupo cortado, ou os que viriam depois dele, só valem se forem ordenados e tiverem o topo inteiro). */
export function separarGrupos(linhas: Linhas, grupoDe: (l: Record<string, unknown>) => string, grupos: GrupoJunto[], limiteTotal: number): Record<string, Linhas | null> {
  const por = new Map<string, Linhas>(grupos.map((g) => [g.nome, []]));
  let ultimo = -1;
  for (const l of linhas) {
    const g = grupoDe(l), i = grupos.findIndex((x) => x.nome === g);
    if (i < 0) continue;
    por.get(g)!.push(l);
    if (i > ultimo) ultimo = i;
  }
  const cortado = linhas.length >= limiteTotal;
  const r: Record<string, Linhas | null> = {};
  grupos.forEach((g, i) => {
    const ls = por.get(g.nome)!, completo = !cortado || i < ultimo;
    r[g.nome] = g.ordenado ? (completo || ls.length >= g.limite ? ls.slice(0, g.limite) : null) : (completo && ls.length <= g.limite ? ls : null);
  });
  return r;
}
/** A linha da consulta de hoje a partir da linha juntada: { campo de hoje: campo da juntada }. */
const campos = (l: Record<string, unknown>, mapa: Record<string, string>) => Object.fromEntries(Object.entries(mapa).map(([hoje, junta]) => [hoje, l[junta] ?? null]));
const mapear = (ls: Linhas | null, mapa: Record<string, string>) => (ls ? ls.map((l) => campos(l, mapa)) : null);

/** FUN-T: os funis de várias jornadas numa leitura. Por sessão, o instante da 1ª passagem e os erros de cada tela DISTINTA
    das jornadas (t<u>, e<u>: a mesma tela em duas jornadas, ou duas vezes na mesma, é lida uma vez); por jornada n, a
    cadeia "chegou ao passo i em ordem" vira um campo por passo (a<n>_<i> = a<n>_<i-1> e o passo i depois do i-1: o mesmo
    teste de qFunil, sem repetir a cadeia inteira em cada contagem) e as contagens de qFunil saem com os nomes
    j<n>_sessoes, j<n>_p<i>, j<n>_q<k> e j<n>_erros<i>. Uma linha. Mesmo resultado de qFunil jornada a jornada: a sessão
    que não passou pelas telas de uma jornada tem t nulo e e = 0 nelas e não conta em nada dessa jornada; sessoes =
    sessões com navegação ou erro numa tela da jornada (o count() das sessões que o filtro de qFunil deixa). A tela é
    reconhecida pela chave "aplicação|tela" (o filtro já deixou só registros com aplicação e tela das jornadas; o id da
    aplicação não tem "|", e se tiver a chave sai e vale a condição de qFunil). */
export interface PassoQ { app: string; view: string }
/** Telas distintas de um conjunto de jornadas, na ordem em que aparecem, e o índice de cada (app, tela). */
const telasDistintas = (jornadas: PassoQ[][]) => {
  const indice = new Map<string, number>(), telas: PassoQ[] = [];
  for (const ps of jornadas) for (const p of ps) { const k = JSON.stringify([p.app, p.view]); if (!indice.has(k)) { indice.set(k, telas.length); telas.push(p); } }
  return { telas, u: (p: PassoQ) => indice.get(JSON.stringify([p.app, p.view]))! };
};
export const qFunisJuntos = (jornadas: PassoQ[][], janela: string, robos: boolean) => {
  const { telas, u } = telasDistintas(jornadas);
  // o filtro de qFunil (o or das telas) agrupado por aplicação: o mesmo conjunto de registros, sem um or por tela (100
  // telas num or passam do aninhamento que o DQL aceita)
  const porApp = new Map<string, string[]>();
  for (const p of telas) porApp.set(p.app, [...(porApp.get(p.app) ?? []), p.view]);
  const filtroTelas = [...porApp].map(([a, vs]) => `(dt.rum.application.id == "${aspas(a)}" and in(view.name, ${lista(vs)}))`).join(" or ");
  const comChave = telas.every((p) => !p.app.includes("|"));
  const naTela = (p: PassoQ) => (comChave ? `k == "${aspas(`${p.app}|${p.view}`)}"` : `(dt.rum.application.id == "${aspas(p.app)}" and view.name == "${aspas(p.view)}")`);
  const porSessao = telas.flatMap((p, i) => [`t${i} = min(if(nav and ${naTela(p)}, start_time))`, `e${i} = countIf(not nav and ${naTela(p)})`]);
  const t = (ps: PassoQ[], i: number) => `t${u(ps[i])}`, e = (ps: PassoQ[], i: number) => `e${u(ps[i])}`;
  // um fieldsAdd por passo (o campo do passo i usa o do passo i-1, que o DQL só enxerga no comando seguinte)
  const cadeias = Array.from({ length: Math.max(0, ...jornadas.map((ps) => ps.length)) }, (_, i) => jornadas.flatMap((ps, n) => (i < ps.length ? [`a${n}_${i} = ${i === 0 ? `isNotNull(${t(ps, 0)})` : `a${n}_${i - 1} and isNotNull(${t(ps, i)}) and ${t(ps, i)} >= ${t(ps, i - 1)}`}`] : [])).join(", "));
  const contagens = jornadas.flatMap((ps, n) => [
    `j${n}_sessoes = countIf(${[...new Set(ps.map(u))].map((x) => `isNotNull(t${x}) or e${x} > 0`).join(" or ")})`,
    ...ps.map((_, i) => `j${n}_p${i} = countIf(a${n}_${i})`),
    // 1.46.3: r_k = chegaram ao passo k-1 com erro na tela dele; c_k = desses, os que seguiram para o passo k. O "parou com erro"
    // de antes (q_k) é r_k - c_k (linhasDosFunis), e c_k dá o veredito do "Por quê?" pelas horas analisadas, no mesmo tamanho
    // de consulta (as duas contagens usam a cadeia a_n_k já calculada)
    ...ps.slice(1).flatMap((_, x) => { const k = x + 1; return [`j${n}_r${k} = countIf(a${n}_${k - 1} and ${e(ps, k - 1)} > 0)`, `j${n}_c${k} = countIf(a${n}_${k} and ${e(ps, k - 1)} > 0)`]; }),
    ...ps.map((_, i) => `j${n}_erros${i} = sum(${e(ps, i)})`),
  ]);
  return `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(telas.map((p) => p.app))}
| filter (characteristics.classifier == "navigation" or characteristics.classifier == "error") and (${filtroTelas})${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation"${comChave ? ', k = concat(dt.rum.application.id, "|", view.name)' : ""}
| summarize ${porSessao.join(", ")}, by:{dt.rum.session.id}
${cadeias.map((c) => `| fieldsAdd ${c}\n`).join("")}| summarize ${contagens.join(", ")}`;
};
/** Tamanho de uma consulta para o limite do DQL de 1000 expressões por consulta (TOO_MANY_EXPRESSIONS_IN_QUERY, o mesmo
    que hoje faz a qFunil de 10 passos falhar): conta nomes de campo, funções, literais e operadores depois do fetch.
    Medido no LAB em 17/10 com este FUN-T (comando data, sem varrer o Grail; 28 formatos, de 1 a 40 jornadas e de 1 a 25
    passos): todos os que falharam tinham 1242 ou mais nesta conta, e passaram todos até 1212 (5 jornadas de 4 passos =
    1052). LIMITE_EXPRESSOES_FUNIL fica abaixo disso; o que passar ainda assim volta com DQL-LIMIT-REACHED e o lote se
    divide (lib/juntas.ts). */
export const LIMITE_EXPRESSOES_FUNIL = 1150;
const PALAVRAS_DQL = new Set(["filter", "summarize", "by", "fetch", "from", "to", "fieldsAdd"]);
export const custoExpressoes = (q: string) => (q.split("\n").slice(1).join("\n").match(/"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|[A-Za-z_][\w.]*\(|==|!=|>=|<=|\band\b|\bor\b|\bnot\b|[<>]|\b\d+\b|[A-Za-z_][\w.]*/g) ?? []).filter((x) => !PALAVRAS_DQL.has(x)).length;
/** Lotes do FUN-T: jornadas na ordem, cada lote o maior que couber em LIMITE_EXPRESSOES_FUNIL (o custo é medido no texto
    do lote, com a janela e os robôs da leitura). Jornada que sozinha não cabe fica fora (lê pela qFunil, como hoje). */
export const lotesFunis = (jornadas: PassoQ[][], janela: string, robos: boolean, limite = LIMITE_EXPRESSOES_FUNIL) => {
  const lotes: number[][] = [], fora: number[] = [];
  let atual: number[] = [];
  const cabe = (ids: number[]) => custoExpressoes(qFunisJuntos(ids.map((i) => jornadas[i]), janela, robos)) <= limite;
  jornadas.forEach((_, i) => {
    if (!cabe([i])) { fora.push(i); return; }
    if (atual.length && !cabe([...atual, i])) { lotes.push(atual); atual = []; }
    atual.push(i);
  });
  if (atual.length) lotes.push(atual);
  return { lotes, fora };
};
/** A linha de cada jornada no formato de qFunil (sessoes, p<i>, q<k>, erros<i>), a partir da linha de qFunisJuntos ({}
    sem linha: o funil sai zerado, como qFunil sem linha). */
export const linhasDosFunis = (linha: Record<string, unknown> | undefined, jornadas: PassoQ[][]) => jornadas.map((ps, n) => {
  const r: Record<string, unknown> = {};
  if (!linha) return r;
  const nn = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
  r.sessoes = linha[`j${n}_sessoes`] ?? null;
  ps.forEach((_, i) => {
    r[`p${i}`] = linha[`j${n}_p${i}`] ?? null;
    if (i) {
      // 1.46.3: q = r - c; hora analisada antes da troca traz q (as somas das horas juntam as duas formas)
      const q = linha[`j${n}_q${i}`], rr = linha[`j${n}_r${i}`], c = linha[`j${n}_c${i}`];
      r[`q${i}`] = q == null && rr == null ? null : nn(q) + nn(rr) - nn(c);
      r[`c${i}`] = c ?? null;
    }
    r[`erros${i}`] = linha[`j${n}_erros${i}`] ?? null;
  });
  // c_ok: "seguiu com erro" em todas as horas somadas (funisDas24 diz) ou na leitura direta (tem o campo)
  r.c_ok = linha.j_c_ok != null ? linha.j_c_ok === true : ps.length < 2 || linha[`j${n}_c1`] != null;
  return r;
});

/** INI-A: qInicioFins + qInicioCaminhos numa leitura: o mesmo resumo por sessão (as duas listas de telas, cada uma como a
    sua consulta monta) e dois agrupamentos, "1fim" (fins, sem sort hoje: até 4000) e "2caminho" (caminhos, os 2000 mais
    comuns). Sessão = qualquer sessão com navegação OU erro na janela (desde 18/10/2026): a sessão que só mandou erro,
    sem nenhuma tela (app preso na MainActivity), conta como sessão, termina na tela do último erro e entra em
    "saíram após um erro"; só não tem caminho. Antes ela contava em "sessões com erro" e não em "sessões", e o mapa
    mostrava 19 sessões com erro num lugar com 1 sessão. */
export const LIMITE_INI_A = 6000;
export const qInicioA = (app: string, janela: string, robos: boolean) => `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(app)}
| filter ${NAV_OU_ERRO()}${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation", err = characteristics.classifier == "error"
| summarize navs = countIf(nav), erros = countIf(err), ultima = arrayLast(arraySort(arrayRemoveNulls(collectArray(if(nav, record(t = start_time, v = view.name)))))), ultima_err = arrayLast(arraySort(arrayRemoveNulls(collectArray(if(err, record(t = start_time, v = view.name)))))), views_erro = collectDistinct(if(err, view.name)),
    telas = arraySort(arrayRemoveNulls(collectArray(if(nav, record(t = start_time, v = coalesce(view.name, "(no name)")))))), verro = arrayRemoveNulls(collectDistinct(if(not nav, view.name))), by:{app = dt.rum.application.id, sessao = dt.rum.session.id}
| filter navs > 0 or erros > 0
| fieldsAdd fim = coalesce(ultima[v], ultima_err[v]), caminho = arrayToString(arraySlice(iCollectArray(telas[][v]), from: 0, to: 12), delimiter: "${SEPARADOR_CAMINHO}"), ultima_tela = arrayLast(telas)[v]
| fieldsAdd saiu_erro = arrayIndexOf(views_erro, fim) >= 0, fim_erro = arrayIndexOf(verro, ultima_tela) >= 0
| fieldsAdd g = if(navs > 0, array(record(grupo = "1fim", chave = fim), record(grupo = "2caminho", chave = caminho)), else: array(record(grupo = "1fim", chave = fim)))
| expand g
| summarize n = count(), fins_erro = countIf(saiu_erro), uma = countIf(navs == 1), com_erro = countIf(erros > 0), navs = sum(navs), fim_erro = countIf(fim_erro), erros = arrayFlatten(collectArray(if(g[grupo] == "2caminho", verro))), by:{grupo = g[grupo], app, chave = g[chave]}
| sort grupo asc, n desc
| limit ${LIMITE_INI_A}`;
export const separarInicioA = (linhas: Linhas) => {
  const s = separarGrupos(linhas, (l) => String(l.grupo), [{ nome: "1fim", limite: 4000, ordenado: false }, { nome: "2caminho", limite: 2000, ordenado: true }], LIMITE_INI_A);
  return { fins: mapear(s["1fim"], { app: "app", fim: "chave", fins: "n", fins_erro: "fins_erro", uma: "uma", com_erro: "com_erro", navs: "navs" }),
           caminhos: mapear(s["2caminho"], { app: "app", caminho: "chave", n: "n", fim_erro: "fim_erro", erros: "erros" }) };
};

/** INI-B: qInicioPaginas (páginas e lugares do mapa, como na 1.31) + qInicioErros numa leitura: cada evento entra pela
    página e pelo lugar e, se for erro, também pelo erro (tipo "erro", com a chave e a agregação de qInicioErros). Páginas e
    lugares vêm antes (hoje: sort tipo asc, limit 4300, sem ordem entre as páginas) e os erros depois, pelas sessões. */
export const LIMITE_INI_B = 4000 + LIMITE_LUGARES + 300;
/** Variante do retrato agendado (lib/agendado.ts): os lugares também por aplicação (tipo "lugarapp") e até 1.500 erros, para
    o mesmo retrato servir qualquer aplicação escolhida (os erros de uma aplicação pequena não somem atrás dos 300 maiores). */
export const ERROS_RETRATO = 1500, LIMITE_LUGARES_RETRATO = 6000;
export const LIMITE_INI_B_RETRATO = 4000 + LIMITE_LUGARES + LIMITE_LUGARES_RETRATO + ERROS_RETRATO;
export const qInicioB = (app: string, janela: string, robos: boolean, retrato = false) => {
  const pagina = "record(tipo = \"pagina\", app = dt.rum.application.id, view = view.name)";
  const lugar = `record(tipo = "lugar", app = "${TODAS}", pais = ${LUGAR_PAIS}, regiao = ${LUGAR_REGIAO()})${retrato ? `, record(tipo = "lugarapp", app = dt.rum.application.id, pais = ${LUGAR_PAIS}, regiao = ${LUGAR_REGIAO()})` : ""}`;
  const erro = "record(tipo = \"erro\", app = dt.rum.application.id, etipo = error.type, status = http.response.status_code, caminho = url.path, dominio = url.domain, msg = substring(coalesce(exception.message, error.display_name, \"\"), from: 0, to: 140))";
  return `${fonteSessao(NAV_ERRO, janela)}${remapQuadros(app)}
| filter ${NAV_OU_ERRO()}${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation"
| fieldsAdd d = if(nav and toDouble(duration) > 0, toDouble(duration))
| fieldsAdd grupo = if(nav, array(${pagina}, ${lugar}), else: array(${pagina}, ${lugar}, ${erro}))
| expand grupo
| summarize visitas = countIf(nav), erros = countIf(not nav), sessoes = countDistinct(dt.rum.session.id), sessoes_erro = countDistinct(if(not nav, dt.rum.session.id)), media_ms = avg(d) / 1000000.0, p75_ms = percentile(d, 75) / 1000000.0,
    paginas = collectDistinct(if(grupo[tipo] == "erro", view.name)),
    by:{tipo = grupo[tipo], app = grupo[app], view = grupo[view], pais = grupo[pais], regiao = grupo[regiao], etipo = grupo[etipo], status = grupo[status], caminho = grupo[caminho], dominio = grupo[dominio], msg = grupo[msg]}
| fieldsAdd ordem = if(tipo == "erro", 1, else: 0)
| sort ordem asc, sessoes_erro desc
| limit ${retrato ? LIMITE_INI_B_RETRATO : LIMITE_INI_B}`;
};
export const separarInicioB = (linhas: Linhas, retrato = false) => {
  const s = separarGrupos(linhas, (l) => (l.tipo === "erro" ? "2erro" : "1pagina"), [{ nome: "1pagina", limite: 4000 + LIMITE_LUGARES + (retrato ? LIMITE_LUGARES_RETRATO : 0), ordenado: false }, { nome: "2erro", limite: retrato ? ERROS_RETRATO : 300, ordenado: true }], retrato ? LIMITE_INI_B_RETRATO : LIMITE_INI_B);
  return { paginas: mapear(s["1pagina"], { tipo: "tipo", app: "app", view: "view", pais: "pais", regiao: "regiao", visitas: "visitas", erros: "erros", sessoes: "sessoes", sessoes_erro: "sessoes_erro", media_ms: "media_ms", p75_ms: "p75_ms" }),
           erros: mapear(s["2erro"], { app: "app", tipo: "etipo", status: "status", caminho: "caminho", dominio: "dominio", msg: "msg", n: "erros", sessoes: "sessoes_erro", paginas: "paginas" }) };
};

/** PAG-U: qRequisicoes + qErros da página numa leitura ("1req": XHR/fetch, os 25 mais chamados; "2err": erros, os 30 mais
    frequentes). Traces, carga e cliques continuam em consultas próprias. */
export const LIMITE_PAG_U = 5000;
export const qPainelJunto = (app: string, janela: string, robos: boolean, view: string) => `${fonteSessao(ERRO_REQ, janela)}
| filter (characteristics.has_request == true or characteristics.classifier == "error")${filtroApp(app)}${filtroRobos(robos)}
| filter view.name == "${aspas(view)}"
| fieldsAdd req = characteristics.has_request == true and ${CHAMADA_API}, err = characteristics.classifier == "error"
| filter req or err
| fieldsAdd g = if(req and err, array("1req", "2err"), else: if(req, array("1req"), else: array("2err")))
| expand g
| summarize n = count(), erros = countIf(characteristics.has_failed_request == true), dur_ms = avg(duration) / 1000000.0, ligadas = countIf(isNotNull(trace.id)), sessoes = countDistinct(dt.rum.session.id), ultimo = max(start_time),
    by:{g, caminho = if(g == "1req", url.path), dominio = if(g == "1req", url.domain), tipo = if(g == "2err", error.type), nome = if(g == "2err", coalesce(exception.message, error.display_name, concat(coalesce(toString(http.response.status_code), "?"), ": ", coalesce(url.domain, ""), coalesce(url.path, "")))),
        status = if(g == "2err", http.response.status_code), excecao_tipo = if(g == "2err", exception.type), terceiro = if(g == "2err", url.provider == "third_party" and not(contains(dt.rum.application.id, "-")))}
| sort g asc, n desc
| limit ${LIMITE_PAG_U}`;
export const separarPainel = (linhas: Linhas) => {
  const s = separarGrupos(linhas, (l) => String(l.g), [{ nome: "1req", limite: 25, ordenado: true }, { nome: "2err", limite: 30, ordenado: true }], LIMITE_PAG_U);
  return { requisicoes: mapear(s["1req"], { caminho: "caminho", dominio: "dominio", n: "n", erros: "erros", dur_ms: "dur_ms", ligadas: "ligadas" }),
           erros: mapear(s["2err"], { tipo: "tipo", nome: "nome", status: "status", excecao_tipo: "excecao_tipo", terceiro: "terceiro", n: "n", sessoes: "sessoes", ultimo: "ultimo" }) };
};

/** QUA-U: qQualidadeDado + qDominiosSemTrace numa leitura ("1app": uma linha por aplicação, sem sort hoje: até 500;
    "2dom": domínios das chamadas próprias sem trace, os 500 com mais chamadas) e, na MESMA varredura, as entradas das
    Oportunidades de melhoria (lib/oportunidades.ts, R$ 0 a mais):
    "3chamada": chamadas próprias (requisições e falhas de requisição) por aplicação, endpoint (url.path) e estado (região
      do Brasil; fora dele, vazio), com falhas, sessões com falha, lentas (acima de 3 s), p75 e até 5 páginas (W1c, W3
      regional e a taxa de W3 e M4): as 1500 com mais falhas + lentas;
    "4terceiro": domínios de terceiros nas páginas web, com falhas, p75, sessões e até 5 páginas (W7): os 200 com mais
      chamadas.
    As falhas de requisição (classifier error, error.type request) entram só nos grupos novos (velho = o filtro de antes):
    1app e 2dom saem como antes. Provado no LAB em 17/10 (2 h, 09:10 a 11:10 UTC): 1app e 2dom idênticas às da consulta de
    antes, scannedBytes 16.303.778 x 16.303.795. */
export const LIMITE_QUA_U = 2700;
/** Estado da chamada: região do Brasil como o RUM grava; fora do Brasil, vazio (a regra regional é por UF). */
const ESTADO_BR = 'if(in(geo.country.iso_code, array("BR")), coalesce(geo.region.name, ""), else: "")';
export const qQualidadeJunta = (app: string, janela: string, robos: boolean) => `${fonteSessao(TODOS, janela)}
| filter (characteristics.classifier == "navigation" or characteristics.has_request == true or (characteristics.classifier == "error" and error.type == "request"))${filtroApp(app)}${filtroRobos(robos)}
| fieldsAdd nav = characteristics.classifier == "navigation", req = characteristics.has_request == true and ${SO_PROPRIO}
| fieldsAdd velho = characteristics.classifier == "navigation" or characteristics.has_request == true, falha = characteristics.classifier == "error" and error.type == "request", pedido = characteristics.classifier == "request"
| fieldsAdd terceiro = (pedido or falha) and url.provider == "third_party" and not(contains(dt.rum.application.id, "-"))
| fieldsAdd g = arrayRemoveNulls(array(if(velho, "1app"), if(velho and req and isNull(trace.id), "2dom"), if((pedido or falha) and ${SO_PROPRIO}, "3chamada"), if(terceiro, "4terceiro")))
| expand g
| filter isNotNull(g)
| summarize navs = countIf(nav), nova_aba_sem_origem = countIf(nav and isNull(view.source.name) and (isNull(page.source.url.path) or page.source.url.path == "") and navigation.tab_state == "new"),
    frames = countIf(nav and navigation.tab_state == "duplicated"), sem_nome = countIf(nav and isNull(view.name)), genericas = countIf(nav and endsWith(view.name, "Activity")), hibridas = countIf(nav and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m")),
    wv_and = countIf(nav and browser.name == "Android WebView"), wv_and_hib = countIf(nav and browser.name == "Android WebView" and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m")), ios_hib = countIf(nav and in(os.name, array("iOS", "iPadOS")) and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m")),
    reqs = countIf(req), reqs_trace = countIf(req and isNotNull(trace.id)), n = count(), falhas = countIf(falha), sessoes_falha = countDistinct(if(falha and g == "3chamada", dt.rum.session.id)), lentas = countIf(pedido and toDouble(duration) > 3000000000.0),
    p75_ms = percentile(if(pedido and (g == "3chamada" or g == "4terceiro"), toDouble(duration)), 75) / 1000000.0, sessoes = countDistinct(if(g == "4terceiro", dt.rum.session.id)),
    paginas = collectDistinct(if(g == "3chamada" or g == "4terceiro", view.name), maxLength: 5),
    by:{g, app = dt.rum.application.id, dominio = if(g == "2dom" or g == "4terceiro", url.domain), caminho = if(g == "3chamada", url.path), regiao = if(g == "3chamada", ${ESTADO_BR})}
| fieldsAdd ordem = if(g == "2dom" or g == "4terceiro", n, else: if(g == "3chamada", falhas + lentas, else: 0))
| sort g asc, ordem desc
| limit ${LIMITE_QUA_U}`;
const lista5 = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x != null && x !== "").map(String).slice(0, 5) : []);
const numOuNulo = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** Linha do grupo "3chamada" no formato da regra (lib/oportunidades.ts LinhaChamadaEstado). */
export const linhaChamadaEstado = (l: Record<string, unknown>): LinhaChamadaEstado => ({
  app: String(l.app ?? ""), caminho: String(l.caminho ?? ""), regiao: l.regiao == null || l.regiao === "" ? null : String(l.regiao),
  total: Number(l.n ?? 0), falhas: Number(l.falhas ?? 0), sessoesFalha: Number(l.sessoes_falha ?? 0), lentas: Number(l.lentas ?? 0), p75Ms: numOuNulo(l.p75_ms), paginas: lista5(l.paginas),
});
/** Linha do grupo "4terceiro" no formato da regra (LinhaTerceiro). */
export const linhaTerceiro = (l: Record<string, unknown>): LinhaTerceiro => ({
  app: String(l.app ?? ""), dominio: String(l.dominio ?? ""), n: Number(l.n ?? 0), falhas: Number(l.falhas ?? 0), p75Ms: numOuNulo(l.p75_ms), sessoes: Number(l.sessoes ?? 0), paginas: lista5(l.paginas),
});
/** As linhas de cada consulta de antes (qualidade, domínios) e as dos grupos novos já no formato das regras (chamadas,
    terceiros); null = transbordo (qualidade e domínios relêem pela consulta de antes; chamadas e terceiros ficam sem dado). */
export const separarQualidade = (linhas: Linhas) => {
  const s = separarGrupos(linhas, (l) => String(l.g), [{ nome: "1app", limite: 500, ordenado: false }, { nome: "2dom", limite: 500, ordenado: true }, { nome: "3chamada", limite: 1500, ordenado: true }, { nome: "4terceiro", limite: 200, ordenado: true }], LIMITE_QUA_U);
  return { qualidade: mapear(s["1app"], { app: "app", navs: "navs", nova_aba_sem_origem: "nova_aba_sem_origem", frames: "frames", sem_nome: "sem_nome", genericas: "genericas", hibridas: "hibridas", wv_and: "wv_and", wv_and_hib: "wv_and_hib", ios_hib: "ios_hib", reqs: "reqs", reqs_trace: "reqs_trace" }),
           dominios: mapear(s["2dom"], { app: "app", dominio: "dominio", n: "n" }),
           chamadas: s["3chamada"] ? s["3chamada"].map(linhaChamadaEstado) : null,
           terceiros: s["4terceiro"] ? s["4terceiro"].map(linhaTerceiro) : null };
};

/** ISO-U: qFluxoDoNo + qSessoesDoNo numa leitura (o mesmo join; "0total" = sessões que passaram pela página, que é o
    countDistinct das sessões do join; "1aresta" = as 4000 ligações com mais navegações). */
export const LIMITE_ISO_U = 4001;
export const qIsolarJunto = (app: string, view: string, janela: string, robos: boolean) => `${baseNavSessao(app, janela, robos)}
| fieldsAdd sessao = dt.rum.session.id
| join [ ${baseNavSessao(app, janela, robos)}
  | filter view.name == "${aspas(view)}"
  | summarize passagens = count(), by:{sessao = dt.rum.session.id} ], on: {left[sessao] == right[sessao]}, kind: inner
| fieldsAdd g = array("0total", "1aresta")
| expand g
| summarize n = count(), sessoes = countDistinct(sessao), by:{g, app = if(g == "1aresta", dt.rum.application.id), de = if(g == "1aresta", ${ORIGEM}), para = if(g == "1aresta", view.name), tipo = if(g == "1aresta", navigation.type)}
| sort g asc, n desc
| limit ${LIMITE_ISO_U}`;
export const separarIsolar = (linhas: Linhas) => {
  const s = separarGrupos(linhas, (l) => String(l.g), [{ nome: "0total", limite: 1, ordenado: false }, { nome: "1aresta", limite: 4000, ordenado: true }], LIMITE_ISO_U);
  return { arestas: mapear(s["1aresta"], { app: "app", de: "de", para: "para", tipo: "tipo", n: "n", sessoes: "sessoes" }),
           sessoes: s["0total"] ? [{ sessoes: s["0total"][0]?.sessoes ?? 0 }] : null };
};

/** DRL-U: qAbandonoCorrelacao + qAbandonoSessoes numa leitura ("0grupo": quem seguiu e quem não, com erro na origem;
    "1sessao": as 25 que não seguiram, erros primeiro). O destino (DRL-02, com join) continua à parte. */
export const LIMITE_DRL_U = 27;
export const qPorqueJunto = (passos: { app: string; view: string }[], k: number, janela: string, robos: boolean) => `${baseAbandono(passos, k, janela, robos)}
| fieldsAdd g = if(seguiu, array("0grupo"), else: array("0grupo", "1sessao"))
| expand g
| summarize sessoes = count(), com_erro = countIf(erros_origem > 0), t_origem = max(t_origem), ultimo = max(ultimo), erros_origem = max(erros_origem), by:{g, seguiu = if(g == "0grupo", seguiu), sessao = if(g == "1sessao", sessao)}
| sort g asc, erros_origem desc, t_origem desc
| limit ${LIMITE_DRL_U}`;
export const separarPorque = (linhas: Linhas) => {
  const s = separarGrupos(linhas, (l) => String(l.g), [{ nome: "0grupo", limite: 2, ordenado: false }, { nome: "1sessao", limite: 25, ordenado: true }], LIMITE_DRL_U);
  return { correlacao: mapear(s["0grupo"], { seguiu: "seguiu", sessoes: "sessoes", com_erro: "com_erro" }),
           sessoes: mapear(s["1sessao"], { sessao: "sessao", t_origem: "t_origem", ultimo: "ultimo", erros_origem: "erros_origem" }) };
};

/** BAS-S: a base do grafo pela cópia (filtro de segmento ligado): qViews, qErrosPorView, qAplicacoes e qArestas numa
    leitura. Cada um com o filtro dele: as aplicações contam todas as navegações (sem aplicação, robôs nem frames, como
    hoje); páginas e ligações, as do escopo sem frames; erros, os próprios do escopo. Páginas e erros (sem sort hoje: até
    4000) vêm antes; aplicações (as 200 com mais navegações) e ligações (as 4000 com mais navegações) depois. Só vale com
    a cópia e o filtro de segmento (é quando a base lê a cópia: base() e qViews). */
export const LIMITE_BAS_S = 4000 + 4000 + 200 + 4000 + 2000;
export const qBaseJunta = (app: string, janela: string, robos: boolean) => `${fonteSessao(NAV_ERRO, janela)}
| filter characteristics.classifier == "navigation" or characteristics.classifier == "error"
| fieldsAdd nav = characteristics.classifier == "navigation", esc = true${filtroApp(app)}${filtroRobos(robos)}, semq = true${filtroQuadros()}
| fieldsAdd g = if(nav, if(esc and semq, array("1view", "3app", "4aresta"), else: array("3app")), else: if(esc and ${SO_PROPRIO}, array("2erro")))
| expand g
| filter isNotNull(g)
| summarize n = count(), sessoes = countDistinct(dt.rum.session.id), excecoes = countIf(error.type == "exception"), falhas = countIf(error.type == "request"), outros = countIf(error.type != "exception" and error.type != "request"),
    by:{g, id = if(g == "3app", dt.rum.application.id), ent = if(g == "3app", dt.rum.application.entity), fe = if(g == "3app", frontend.name), app = if(g != "3app", dt.rum.application.id),
        de = if(g == "4aresta", ${ORIGEM}), para = if(g == "4aresta", view.name), tipo = if(g == "4aresta", navigation.type), view = if(g == "1view" or g == "2erro", view.name)}
| fieldsAdd erros = excecoes + falhas + outros, nome = if(g == "3app", coalesce(${nomeAplicacao("ent")}, fe, id)), ordem = if(g == "3app" or g == "4aresta", n, else: 0)
| sort g asc, ordem desc
| limit ${LIMITE_BAS_S}`;
export const separarBase = (linhas: Linhas) => {
  const s = separarGrupos(linhas, (l) => String(l.g), [{ nome: "1view", limite: 4000, ordenado: false }, { nome: "2erro", limite: 4000, ordenado: false }, { nome: "3app", limite: 200, ordenado: true }, { nome: "4aresta", limite: 4000, ordenado: true }], LIMITE_BAS_S);
  return {
    aplicacoes: mapear(s["3app"], { "dt.rum.application.id": "id", "dt.rum.application.entity": "ent", "frontend.name": "fe", navegacoes: "n", sessoes: "sessoes", entidade: "ent", nome: "nome" }),
    arestas: mapear(s["4aresta"], { app: "app", de: "de", para: "para", tipo: "tipo", n: "n", sessoes: "sessoes" }),
    views: mapear(s["1view"], { app: "app", view: "view", views: "n", sessoes: "sessoes" }),
    erros: mapear(s["2erro"], { app: "app", view: "view", excecoes: "excecoes", falhas: "falhas", outros: "outros", erros: "erros" }),
  };
};
