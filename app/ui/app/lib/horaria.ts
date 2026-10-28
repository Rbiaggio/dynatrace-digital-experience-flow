/* ANÁLISE DE HORA EM HORA (1.43, modelo por feature definido em 20/10/2026). O que é por SESSÃO (onde as
   sessões terminam, caminhos, páginas por sessão com o tempo de carga, funis), a qualidade do dado, as chamadas por
   endpoint, os terceiros, as 3 requisições mais lentas de cada página, os valores dos filtros e a ligação página ->
   serviço não se leem mais na hora: a ação def-agregar (parte "hora" do ciclo) analisa cada hora UMA vez e grava o
   resultado no bucket rum_flow_horas; a tela soma as últimas 24 horas analisadas (consulta pequena, só nesse bucket).
     sessoes · cada sessão entra na hora em que TERMINOU (último evento), lida com 30 min para trás (o começo dela) e 30 min
               para a frente (a sessão só termina depois de 30 min sem evento): somar as horas não conta sessão duas vezes.
               A hora só é analisada 30 min (+ o atraso de chegada) depois de acabar. Sessão que começou mais de 30 min antes da hora perde o começo (cada 30 min a mais de volta relê meio dia de navegação e erro por dia).
     funis   · o mesmo, para as jornadas salvas (a chave das jornadas entra na unidade: jornada nova refaz as 24 h).
     req     · as requisições da hora (qualidade do dado, domínios sem trace, chamadas por endpoint e estado, terceiros,
               as 3 mais lentas de cada página, sem tempo mínimo, com trace e sessão) e os valores dos filtros.
     ligacao · a ligação página -> serviço da hora, com os spans amostrados pelo volume da própria hora.
   Escopo da análise: sem robôs, sem frames, erros só da própria aplicação (o padrão da tela). O p75 de 24 h sai de faixas
   de tempo somadas (aproximado: interpolação dentro da faixa). Sessões distintas de "req" (sessões com falha, de
   terceiros) somam por hora (a sessão que atravessa a hora conta nas duas). Sem dependência do SDK. */
import { semParametro, BUCKETS_PASSOS, BUCKET_HORAS, TIPO_HORA } from "./prerequisitos";
import { VERSAO_AGREGADOS, ATRASO_MIN, FAIXAS_MS, N_FAIXAS, faixaDql, somasFaixas, percentilDasFaixas, faixasDaLinha, type EventoAgregado } from "./agregados";
export { FAIXAS_MS, percentilDasFaixas, faixasDaLinha };
import { SEPARADOR_CAMINHO, aspas, LIMITE_LIGACAO_GLOBAL, remapQuadros, TODAS, type PassoQ } from "./queries";

export const MS_HORA = 3600000;
/** Até onde a leitura das sessões volta (o começo da sessão que termina na hora) e quanto espera depois da hora. */
export const VOLTA_SESSAO_MIN = 30;
export const FIM_SESSAO_MIN = 30;
/** Horas que a tela soma e horas que a ação confere para trás (refaz as que faltam). */
export const HORAS_ANALISE = 24;
export const HORAS_CONFERIDAS = 23;   // a ingestão de business events recusa evento com mais de 24 h
export type ParteHora = "sessoes" | "req" | "ligacao" | "funis";
export const PARTES_HORA: ParteHora[] = ["sessoes", "req", "ligacao", "funis"];
const iso = (ms: number) => new Date(ms).toISOString();
export const inicioDaHora = (ms: number) => Math.floor(ms / MS_HORA) * MS_HORA;
const porSessao = (p: ParteHora) => p === "sessoes" || p === "funis";
/** A hora h (início, ms) já pode ser analisada nesta parte. */
export const horaPronta = (h: number, parte: ParteHora, agora: number) => agora >= h + MS_HORA + (porSessao(parte) ? FIM_SESSAO_MIN * 60000 : 0) + ATRASO_MIN * 60000;
/** Unidade de trabalho: hora + parte (+ a chave das jornadas nos funis). */
export const unidadeDe = (h: number, parte: ParteHora, extra = "") => `${iso(h)}|${parte}${extra ? `|${extra}` : ""}`;
export interface Unidade { hora: number; parte: ParteHora; unidade: string }
/** As unidades que faltam nas HORAS_CONFERIDAS mais recentes, da hora mais recente para a mais antiga (a tela usa as 24 h;
    a recente importa mais). `funis` = chave das jornadas (null = sem jornada salva). */
export function unidadesPendentes(agora: number, feitas: Set<string>, funis: string | null): Unidade[] {
  const ultima = inicioDaHora(agora) - MS_HORA, lista: Unidade[] = [];
  for (let i = 0; i < HORAS_CONFERIDAS; i++) {
    const h = ultima - i * MS_HORA;
    for (const parte of PARTES_HORA) {
      if ((parte === "funis" && !funis) || !horaPronta(h, parte, agora)) continue;
      const unidade = unidadeDe(h, parte, parte === "funis" ? funis! : "");
      if (!feitas.has(unidade)) lista.push({ hora: h, parte, unidade });
    }
  }
  return lista;
}
/** Chave curta das jornadas (o mesmo texto = a mesma chave). */
export function chaveJornadas(jornadas: PassoQ[][]): string {
  const s = JSON.stringify(jornadas);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `j${(h >>> 0).toString(36)}${jornadas.length}`;
}

/* ---- Consultas da ação (uma por unidade) -------------------------------------------------------------------------- */
const SO_PROPRIO = '(isNull(url.provider) or url.provider != "third_party" or contains(dt.rum.application.id, "-"))';
const SEM_QUADRO = '(isNull(navigation.tab_state) or navigation.tab_state != "duplicated")';
const SEM_ROBO = 'dt.rum.user_type != "robot"';
const LIMPAR_NOMES = `| fieldsAdd view.name = ${semParametro("view.name")}, view.source.name = ${semParametro("view.source.name")}`;
const de = (ini: number, fim: number, buckets: string[]) => `fetch bizevents, from: "${iso(ini)}", to: "${iso(fim)}", bucket: {${buckets.map((b) => `"${b}"`).join(", ")}}`;
/** Caminhos com menos sessões que isto numa hora não são gravados (a cauda longa); a ação grava até CAMINHOS_POR_HORA. */
export const MIN_SESSOES_CAMINHO = 2;
export const CAMINHOS_POR_HORA = 3000;
export const LIMITE_LINHAS_HORA = 60000;

/** Sessões que terminaram na hora h: por fim (1fim, como INI-A), por caminho (2caminho) e por página (3pagina, como INI-B:
    visitas, erros, sessões, sessões com erro, soma e quantidade do tempo de carga e as faixas). Primeiro por sessão e página,
    depois por sessão (o caminho sai da lista ordenada das navegações de todas as páginas), filtra as sessões cujo último
    evento cai na hora e então agrupa. */
export const qHoraSessoes = (h: number) => {
  const pagRec = `record(grupo = "3pagina", chave = pags[][p], vi = pags[][vi], er = pags[][er], so = pags[][so], nd = pags[][nd], ${Array.from({ length: N_FAIXAS }, (_, i) => `f${i} = pags[][f${i}]`).join(", ")})`;
  const vazio = `vi = 0, er = 0, so = 0.0, nd = 0, ${Array.from({ length: N_FAIXAS }, (_, i) => `f${i} = 0`).join(", ")}`;
  return `${de(h - VOLTA_SESSAO_MIN * 60000, h + MS_HORA + FIM_SESSAO_MIN * 60000, [BUCKETS_PASSOS.nav, BUCKETS_PASSOS.erro])}
${LIMPAR_NOMES}${remapQuadros(TODAS)}
| filter ((characteristics.classifier == "navigation" and ${SEM_QUADRO}) or (characteristics.classifier == "error" and ${SO_PROPRIO})) and ${SEM_ROBO}
| fieldsAdd nav = characteristics.classifier == "navigation", err = characteristics.classifier == "error"
| fieldsAdd d = if(nav and toDouble(duration) > 0, toDouble(duration) / 1000000.0)
| fieldsAdd fx = ${faixaDql("d")}
| summarize visitas = countIf(nav), errosp = countIf(err), tv = arrayRemoveNulls(collectArray(if(nav, record(t = start_time, v = view.name)))), te = max(if(err, start_time)), tult = max(start_time), soma = sum(d), nd = countIf(isNotNull(d)),
    ${somasFaixas((i) => `countIf(fx == ${i})`)}, by:{app = dt.rum.application.id, sessao = dt.rum.session.id, pagina = view.name}
| summarize fim_t = max(tult), navs = sum(visitas), erros = sum(errosp), seq = arraySort(arrayFlatten(collectArray(tv))), ue = arrayLast(arraySort(arrayRemoveNulls(collectArray(if(errosp > 0, record(t = te, v = pagina)))))),
    verro = arrayRemoveNulls(collectDistinct(if(errosp > 0, pagina))), pags = collectArray(record(p = pagina, vi = visitas, er = errosp, so = soma, nd = nd, ${Array.from({ length: N_FAIXAS }, (_, i) => `f${i} = f${i}`).join(", ")})), by:{app, sessao}
| filter fim_t >= toTimestamp("${iso(h)}") and fim_t < toTimestamp("${iso(h + MS_HORA)}") and (navs > 0 or erros > 0)
| fieldsAdd fim = coalesce(arrayLast(seq)[v], ue[v]), caminho = arrayToString(arraySlice(iCollectArray(coalesce(seq[][v], "(no name)")), from: 0, to: 12), delimiter: "${SEPARADOR_CAMINHO}"), ultima_tela = coalesce(arrayLast(seq)[v], "(no name)")
| fieldsAdd saiu_erro = arrayIndexOf(verro, fim) >= 0, fim_erro = arrayIndexOf(verro, ultima_tela) >= 0
| fieldsAdd g1 = arrayRemoveNulls(array(record(grupo = "1fim", chave = fim, ${vazio}), if(navs > 0, record(grupo = "2caminho", chave = caminho, ${vazio}))))
| fieldsAdd g2 = iCollectArray(${pagRec})
| fieldsAdd g = arrayConcat(g1, g2)
| expand g
| summarize n = count(), fins_erro = countIf(saiu_erro), uma = countIf(navs == 1), com_erro = countIf(erros > 0), navs = sum(navs), fim_erro = countIf(fim_erro), erros = arrayFlatten(arrayRemoveNulls(collectArray(if(g[grupo] == "2caminho", verro)))),
    visitas = sum(g[vi]), errosp = sum(g[er]), sessoes_erro = countIf(g[er] > 0), soma = sum(g[so]), nd = sum(g[nd]), ${somasFaixas((i) => `sum(g[f${i}])`)},
    by:{grupo = g[grupo], app, chave = g[chave]}
| filter grupo != "2caminho" or n >= ${MIN_SESSOES_CAMINHO}
| sort grupo asc, n desc
| limit ${LIMITE_LINHAS_HORA}`;
};

/** As requisições da hora: qualidade (1app), domínios sem trace (2dom), chamadas por endpoint e estado (3chamada),
    terceiros (4terceiro) como QUA-U (p75 por faixas), as 3 mais lentas de cada página (5lenta, sem piso desde a 1.43.6:
    toda página com requisição tem as suas; numa página com mais de 2.000 requisições com trace na hora, as 3 mais lentas
    entre as 2.000 primeiras) e os valores dos filtros (6valores). */
const ESTADO_BR = 'if(in(geo.country.iso_code, array("BR")), coalesce(geo.region.name, ""), else: "")';
const FILTRO_REQ = `(characteristics.classifier == "navigation" or characteristics.has_request == true or (characteristics.classifier == "error" and error.type == "request")) and ${SEM_ROBO}`;
const GRUPOS_REQ = `arrayRemoveNulls(array(if(velho, "1app"), if(velho and req and isNull(trace.id), "2dom"), if((pedido or falha) and ${SO_PROPRIO}, "3chamada"), if(terceiro, "4terceiro"), if(pedido and isNotNull(trace.id) and isNotNull(dq), "5lenta"), if(nav, "6valores"), if(nav, "8quadro")))`;
/** 1.45.10, grupo "8quadro" (não vai para o bucket): uma linha por página que carregou como frame na hora (marca do RUM,
    navigation.tab_state = "duplicated"), com as cargas dela (n), as cargas como frame (q_dup) e a página que contém o
    frame em até 100 dessas cargas (q_contem, pelo referrer). A ação junta as 24 h no App State (lib/quadros.ts) e a tela
    reconhece como frame a página que quase sempre carrega dentro de outra, também nas cargas que o RUM não marca. */
const DUP = 'g == "8quadro" and navigation.tab_state == "duplicated"';
const CONTEM = `lower(if(indexOf(toString(page.source.url.path), ";") >= 0, substring(toString(page.source.url.path), from: 0, to: indexOf(toString(page.source.url.path), ";")), else: toString(page.source.url.path)))`;
/** RQL (1.45.2): as requisições da hora e a ligação página -> serviço da MESMA hora numa leitura só da cópia (antes eram
    duas: qHoraReq e qLigacaoAmostrada, cada uma lendo navegação, erro e requisição da hora inteira). Sem `ligacao`, o
    texto é o de qHoraReq de sempre. Com ela, cada registro entra pelos grupos das requisições (os de sempre, só se passar
    no filtro delas) e, se tiver requisição com trace, pela ligação: a junção com os spans amostrados (o mesmo lado direito
    de qLigacaoAmostrada, um registro por trace com os serviços dele, para a junção à esquerda não repetir o registro) e um
    grupo "7lig" por serviço, com as chamadas = traces distintos × a razão real da amostra, como lá. separarReqLigacao
    devolve as linhas das duas como as consultas separadas devolviam. */
export const LIMITE_REQ_LIGACAO = LIMITE_LINHAS_HORA + LIMITE_LIGACAO_GLOBAL;
export const qHoraReq = (h: number, ligacao?: { razao: number }) => {
  const de0 = iso(h), ate0 = iso(h + MS_HORA);
  const lig = ligacao != null;
  const amostra = lig && ligacao.razao > 1 ? `, samplingRatio: ${ligacao.razao}` : "";
  return `${de(h, h + MS_HORA, [BUCKETS_PASSOS.nav, BUCKETS_PASSOS.erro, BUCKETS_PASSOS.req])}
${LIMPAR_NOMES}
${lig ? `| fieldsAdd base_req = ${FILTRO_REQ}, lig = characteristics.has_request == true and isNotNull(trace.id)
| filter base_req or lig` : `| filter ${FILTRO_REQ}`}
| fieldsAdd nav = characteristics.classifier == "navigation", req = characteristics.has_request == true and ${SO_PROPRIO}
| fieldsAdd velho = characteristics.classifier == "navigation" or characteristics.has_request == true, falha = characteristics.classifier == "error" and error.type == "request", pedido = characteristics.classifier == "request"
| fieldsAdd terceiro = (pedido or falha) and url.provider == "third_party" and not(contains(dt.rum.application.id, "-"))
| fieldsAdd dq = if(pedido and toDouble(duration) > 0, toDouble(duration) / 1000000.0)
| fieldsAdd fx = ${faixaDql("dq")}
${lig ? `| fieldsAdd rum_trace = if(lig, toString(trace.id))
| join [fetch spans, from: "${de0}", to: "${ate0}"${amostra}
        | filter span.kind == "server" and isNotNull(dt.entity.service) and isNotNull(trace.id)
        | fields back_trace = toString(trace.id), servico = dt.entity.service, razao_real = dt.system.sampling_ratio
        | dedup {back_trace, servico}
        | summarize servicos = collectArray(servico), razao_real = max(razao_real), by:{back_trace}],
       on: {left[rum_trace] == right[back_trace]}, kind: leftOuter
| fieldsAdd g = arrayConcat(if(base_req, ${GRUPOS_REQ}, else: array("-")), if(isNotNull(right.servicos), iCollectArray(concat("7lig|", right.servicos[])), else: array("-")))
| expand g
| filter g != "-"
| fieldsAdd servico = if(startsWith(g, "7lig|"), substring(g, from: 5)), g = if(startsWith(g, "7lig|"), "7lig", else: g)` : `| fieldsAdd g = ${GRUPOS_REQ}
| expand g`}
| summarize navs = countIf(nav and g == "1app"), nova_aba_sem_origem = countIf(g == "1app" and nav and isNull(view.source.name) and (isNull(page.source.url.path) or page.source.url.path == "") and navigation.tab_state == "new"),
    frames = countIf(g == "1app" and nav and navigation.tab_state == "duplicated"), sem_nome = countIf(g == "1app" and nav and isNull(view.name)), genericas = countIf(g == "1app" and nav and endsWith(view.name, "Activity")), hibridas = countIf(g == "1app" and nav and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m")),
    wv_and = countIf(g == "1app" and nav and browser.name == "Android WebView"), wv_and_hib = countIf(g == "1app" and nav and browser.name == "Android WebView" and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m")),
    ios_hib = countIf(g == "1app" and nav and in(os.name, array("iOS", "iPadOS")) and isNotNull(dt.rum.adk) and endsWith(dt.rum.adk, "_m")),
    reqs = countIf(g == "1app" and req), reqs_trace = countIf(g == "1app" and req and isNotNull(trace.id)), n = count(), falhas = countIf(falha), sessoes_falha = countDistinct(if(falha and g == "3chamada", dt.rum.session.id)), lentas = countIf(pedido and dq > 3000),
    sessoes = countDistinct(if(g == "4terceiro", dt.rum.session.id)), paginas = collectDistinct(if(g == "3chamada" or g == "4terceiro", view.name), maxLength: 5),
    ${somasFaixas((i) => `countIf(pedido and (g == "3chamada" or g == "4terceiro") and fx == ${i})`)},
    exemplos = arraySlice(arraySort(arrayRemoveNulls(collectArray(if(g == "5lenta", record(d = dq, t = toString(trace.id), s = dt.rum.session.id, c = url.path, h = start_time)), maxLength: 2000)), direction: "descending"), from: 0, to: 3),
    v_os = collectDistinct(if(g == "6valores", os.name), maxLength: 300), v_nav = collectDistinct(if(g == "6valores", browser.name), maxLength: 300), v_ver = collectDistinct(if(g == "6valores", app.short_version), maxLength: 300),
    v_pais = collectDistinct(if(g == "6valores", geo.country.iso_code), maxLength: 300), v_reg = collectDistinct(if(g == "6valores", geo.region.name), maxLength: 600),
    q_dup = countIf(${DUP}), q_contem = collectArray(if(${DUP}, ${CONTEM}), maxLength: 100),${lig ? `
    chamadas = countDistinct(if(g == "7lig", rum_trace)), razao_lig = max(if(g == "7lig", right.razao_real)),` : ""}
    by:{g, app = if(g != "6valores", dt.rum.application.id), dominio = if(g == "2dom" or g == "4terceiro", url.domain), caminho = if(g == "3chamada", url.path), regiao = if(g == "3chamada", ${ESTADO_BR}), ${lig ? `pagina = if(g == "5lenta" or g == "7lig" or g == "8quadro", view.name), servico, robo = if(g == "7lig", dt.rum.user_type == "robot")` : `pagina = if(g == "5lenta" or g == "8quadro", view.name)`}}${lig ? `
| fieldsAdd chamadas = if(g == "7lig", chamadas * coalesce(razao_lig, ${ligacao.razao}))` : ""}
| filter g != "8quadro" or q_dup > 0
| sort g asc, n desc
| limit ${lig ? LIMITE_REQ_LIGACAO : LIMITE_LINHAS_HORA}`;
};
/** As linhas de qHoraReq(h, { razao }) separadas como as duas consultas devolviam: `req` como qHoraReq(h) (os mesmos
    campos, até LIMITE_LINHAS_HORA, na ordem da leitura) e `ligacao` como qLigacaoAmostrada (app, view, robo, servico,
    chamadas, ordenadas e cortadas como lá). `completo` = nada ficou de fora pelo limite da leitura junta (senão a ação
    lê as duas separadas, como antes). */
const SO_DA_LIGACAO = ["servico", "robo", "chamadas", "razao_lig"];
const cmpLig = (a: unknown, b: unknown) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
export function separarReqLigacao(linhas: Record<string, unknown>[]) {
  const req: Record<string, unknown>[] = [], ligacao: Record<string, unknown>[] = [];
  for (const l of linhas) {
    if (l.g === "7lig") ligacao.push({ app: l.app ?? null, view: l.pagina ?? null, robo: l.robo ?? null, servico: l.servico ?? null, chamadas: l.chamadas ?? null });
    else { const x = { ...l }; for (const c of SO_DA_LIGACAO) delete x[c]; req.push(x); }
  }
  ligacao.sort((a, b) => Number(b.chamadas ?? 0) - Number(a.chamadas ?? 0) || cmpLig(a.app, b.app) || cmpLig(a.view, b.view) || cmpLig(a.servico, b.servico) || cmpLig(a.robo, b.robo));
  return { req: req.slice(0, LIMITE_LINHAS_HORA), ligacao: ligacao.slice(0, LIMITE_LIGACAO_GLOBAL), completo: linhas.length < LIMITE_REQ_LIGACAO };
}
/** 1.45.10: as linhas do grupo 8quadro (frames da hora, para o App State; não vão para o bucket) separadas das outras, e os
    campos delas tirados das outras (senão todo registro da hora levaria q_dup = 0). */
export function separarQuadrosHora(linhas: Record<string, unknown>[]) {
  const req: Record<string, unknown>[] = [], quadros: Record<string, unknown>[] = [];
  for (const l of linhas) {
    if (l.g === "8quadro") { quadros.push(l); continue; }
    const x = { ...l }; delete x.q_dup; delete x.q_contem; req.push(x);
  }
  return { req, quadros };
}

/** Funis das jornadas salvas, por sessão que terminou na hora (último evento nas telas das jornadas): a qFunisJuntos com a
    janela da hora (30 min para trás, 30 para a frente) e o filtro da hora. Recebe o texto de qFunisJuntos(..., janela
    qualquer, robos false) e troca a origem e acrescenta o filtro (a montagem dos passos é a mesma). */
export const qHoraFunis = (h: number, funisJuntos: string) => {
  const linhas = funisJuntos.split("\n");
  const ini = linhas.findIndex((l) => l.startsWith("| summarize "));
  if (ini < 0) throw new Error("qFunisJuntos sem summarize");
  // tira só a limpeza de nomes da cópia (a da hora vem em LIMPAR_NOMES); a troca do frame pela página que o contém fica
  const corpo = linhas.slice(1, ini).filter((l) => !(l.startsWith("| fieldsAdd view.name =") && l.includes("view.source.name =")));
  const resto = linhas.slice(ini);
  resto[0] = resto[0].replace("| summarize ", "| summarize fim_t = max(start_time), ");
  return [de(h - VOLTA_SESSAO_MIN * 60000, h + MS_HORA + FIM_SESSAO_MIN * 60000, [BUCKETS_PASSOS.nav, BUCKETS_PASSOS.erro]), LIMPAR_NOMES, ...corpo,
    resto[0], `| filter fim_t >= toTimestamp("${iso(h)}") and fim_t < toTimestamp("${iso(h + MS_HORA)}")`, ...resto.slice(1)].join("\n");
};

/** Sessões da ÚLTIMA HORA (tarefa "sessoes" a cada 15 min com a Visão geral aberta, ou a tela sob demanda): numa leitura,
    os fins por aplicação (como INI-A "1fim": os indicadores de sessão) e os lugares do mapa (como INI-B "lugar", e por
    aplicação, "lugarapp"): sessões, sessões com erro, visitas, erros, soma e quantidade do tempo de carga e as faixas. */
/** Linhas da última hora: fins e lugares (poucos milhares num ambiente grande) e, depois, as sessões com erro mais recentes. */
export const LIMITE_ULTIMA_HORA = 15000;
/** Sessões com erro que a última hora guarda (as mais recentes): a lista da Visão geral mostra 50, com e sem "saíram após o erro". */
export const SESSOES_ULTIMA_HORA = 300;
export const qUltimaHora = (ini: number, fim: number) => {
  const lug = (grupo: string, app: string) => `record(grupo = "${grupo}", app2 = ${app}, chave = "", pais = lugs[][pa], regiao = lugs[][re], vi = lugs[][vi], er = lugs[][er], so = lugs[][so], nd = lugs[][nd], ${Array.from({ length: N_FAIXAS }, (_, k) => `f${k} = lugs[][f${k}]`).join(", ")})`;
  return `${de(ini, fim, [BUCKETS_PASSOS.nav, BUCKETS_PASSOS.erro])}
${LIMPAR_NOMES}${remapQuadros(TODAS)}
| filter ((characteristics.classifier == "navigation" and ${SEM_QUADRO}) or (characteristics.classifier == "error" and ${SO_PROPRIO})) and ${SEM_ROBO}
| fieldsAdd nav = characteristics.classifier == "navigation", err = characteristics.classifier == "error"
| fieldsAdd d = if(nav and toDouble(duration) > 0, toDouble(duration) / 1000000.0)
| fieldsAdd fx = ${faixaDql("d")}
| fieldsAdd pa = coalesce(geo.country.iso_code, ""), re = if(in(geo.country.iso_code, array("BR")), coalesce(geo.region.name, ""), else: "")
| summarize visitas = countIf(nav), errosp = countIf(err), un = arrayLast(arraySort(arrayRemoveNulls(collectArray(if(nav, record(t = start_time, v = view.name)))))), ue = arrayLast(arraySort(arrayRemoveNulls(collectArray(if(err, record(t = start_time, v = view.name)))))),
    pe = arrayFirst(arraySort(arrayRemoveNulls(collectArray(if(err, record(t = start_time, v = view.name, tipo = error.type, status = toString(http.response.status_code), caminho = url.path, msg = substring(coalesce(exception.message, error.display_name, ""), from: 0, to: 140))))))),
    tmin = min(start_time), tmax = max(start_time),
    verro = arrayRemoveNulls(collectDistinct(if(err, view.name))), soma = sum(d), nd = countIf(isNotNull(d)), ${somasFaixas((i) => `countIf(fx == ${i})`)}, by:{app = dt.rum.application.id, sessao = dt.rum.session.id, pa, re}
| summarize navs = sum(visitas), erros = sum(errosp), un = arrayLast(arraySort(arrayRemoveNulls(collectArray(un)))), ue = arrayLast(arraySort(arrayRemoveNulls(collectArray(ue)))), verro = arrayDistinct(arrayFlatten(collectArray(verro))),
    pe = arrayFirst(arraySort(arrayRemoveNulls(collectArray(pe)))), inicio = min(tmin), ultimo = max(tmax),
    lugs = collectArray(record(pa = pa, re = re, vi = visitas, er = errosp, so = soma, nd = nd, ${Array.from({ length: N_FAIXAS }, (_, i) => `f${i} = f${i}`).join(", ")})), by:{app, sessao}
| filter navs > 0 or erros > 0
| fieldsAdd fim = coalesce(un[v], ue[v])
| fieldsAdd saiu_erro = arrayIndexOf(verro, fim) >= 0
| fieldsAdd g1 = array(record(grupo = "1fim", app2 = app, chave = fim, pais = "", regiao = "", vi = 0, er = 0, so = 0.0, nd = 0, ${Array.from({ length: N_FAIXAS }, (_, i) => `f${i} = 0`).join(", ")}))
| fieldsAdd g2 = iCollectArray(${lug("4lugar", '"*"')})
| fieldsAdd g3 = iCollectArray(${lug("5lugarapp", "app")})
| fieldsAdd g4 = arrayRemoveNulls(array(if(erros > 0, record(grupo = "6sessao", app2 = app, chave = sessao, pais = "", regiao = "", vi = 0, er = 0, so = 0.0, nd = 0, ${Array.from({ length: N_FAIXAS }, (_, i) => `f${i} = 0`).join(", ")}))))
| fieldsAdd g = arrayConcat(g1, g2, g3, g4)
| expand g
| summarize n = count(), fins_erro = countIf(saiu_erro), uma = countIf(navs == 1), com_erro = countIf(erros > 0), navs = sum(navs), visitas = sum(g[vi]), errosp = sum(g[er]), sessoes_erro = countIf(g[er] > 0), soma = sum(g[so]), nd = sum(g[nd]),
    ${somasFaixas((i) => `sum(g[f${i}])`)}, s_inicio = min(if(g[grupo] == "6sessao", inicio)), s_ultimo = max(if(g[grupo] == "6sessao", ultimo)), s_navs = sum(if(g[grupo] == "6sessao", navs)), s_erros = sum(if(g[grupo] == "6sessao", erros)),
    s_fim = takeFirst(if(g[grupo] == "6sessao", fim)), s_saiu = takeFirst(if(g[grupo] == "6sessao", saiu_erro)), s_pe = takeFirst(if(g[grupo] == "6sessao", pe)), s_verro = takeFirst(if(g[grupo] == "6sessao", verro)),
    by:{grupo = g[grupo], app = g[app2], chave = g[chave], pais = g[pais], regiao = g[regiao]}
| fieldsAdd ordem = if(grupo == "6sessao", s_ultimo)
| sort grupo asc, ordem desc
| limit ${LIMITE_ULTIMA_HORA}`;
};
/** Linhas de qUltimaHora -> fins (formato de INI-A "1fim") e lugares (formato de INI-B "lugar"/"lugarapp", média e p75 em ms). */
export function ultimaHoraParaLinhas(ls: Record<string, unknown>[]) {
  const n = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
  return {
    fins: ls.filter((l) => l.grupo === "1fim").map((l) => ({ app: l.app, fim: l.chave ?? null, fins: n(l.n), fins_erro: n(l.fins_erro), uma: n(l.uma), com_erro: n(l.com_erro), navs: n(l.navs) })),
    lugares: ls.filter((l) => l.grupo === "4lugar" || l.grupo === "5lugarapp").map((l) => ({ tipo: l.grupo === "4lugar" ? "lugar" : "lugarapp", app: l.app, view: null, pais: l.pais ?? "", regiao: l.regiao ?? "",
      visitas: n(l.visitas), erros: n(l.errosp), sessoes: n(l.n), sessoes_erro: n(l.sessoes_erro), media_ms: n(l.nd) > 0 ? n(l.soma) / n(l.nd) : null, p75_ms: percentilDasFaixas(faixasDaLinha(l)) })),
    // as sessões com erro mais recentes, no formato de qInicioSessoes (a lista da Visão geral) e as páginas com erro de cada uma
    sessoes: ls.filter((l) => l.grupo === "6sessao").slice(0, SESSOES_ULTIMA_HORA).map((l) => {
      const pe = (l.s_pe ?? {}) as Record<string, unknown>;
      return { app: l.app, sessao: l.chave, inicio: l.s_inicio ?? null, ultimo: l.s_ultimo ?? null, navs: n(l.s_navs), erros: n(l.s_erros), fim: l.s_fim ?? null, saiu_erro: l.s_saiu === true || l.s_saiu === "true",
               erro_view: pe.v ?? null, erro_tipo: pe.tipo ?? null, erro_status: pe.status ?? null, erro_caminho: pe.caminho ?? null, erro_msg: pe.msg ?? null, verro: Array.isArray(l.s_verro) ? (l.s_verro as unknown[]).map(String) : [] };
    }),
  };
}

/* ---- Gravação (na ação) ------------------------------------------------------------------------------------------- */
const ORIGEM = "def.agregador";
type Valor = string | number | boolean;
/** Contagem de uma lista de nomes como texto ("nome\tN" por linha): o caminho guarda assim as páginas com erro. */
export const contagemTexto = (xs: unknown[]) => { const m = new Map<string, number>(); for (const x of xs) if (x != null) m.set(String(x), (m.get(String(x)) ?? 0) + 1); return [...m].map(([k, v]) => `${k}\t${v}`).join("\n"); };
export const lerContagemTexto = (s: unknown): Map<string, number> => { const m = new Map<string, number>(); if (typeof s === "string") for (const l of s.split("\n")) { const i = l.lastIndexOf("\t"); if (i > 0) m.set(l.slice(0, i), (m.get(l.slice(0, i)) ?? 0) + (Number(l.slice(i + 1)) || 0)); } return m; };
/** Campos numéricos das consultas da hora (o DQL devolve long como texto; gravado como texto, a soma da leitura falha). */
const NUMERICOS = /^(n|fins_erro|uma|com_erro|navs|fim_erro|visitas|errosp|sessoes_erro|soma|nd|f\d+|nova_aba_sem_origem|frames|sem_nome|genericas|hibridas|reqs|reqs_trace|falhas|sessoes_falha|lentas|sessoes|chamadas|j\d+_.+)$/;
/** Um evento por linha: k do grupo, a hora, a chave (unidade + execução); números e textos como vieram, listas como JSON. */
export function eventosDaHora(linhas: Record<string, unknown>[], kDe: (l: Record<string, unknown>) => string | null, h: number, unidade: string, exec: string): EventoAgregado[] {
  const chave = `${unidade}|${exec}`, out: EventoAgregado[] = [];
  linhas.forEach((l, i) => {
    const k = kDe(l);
    if (!k) return;
    const data: Record<string, Valor> = { k, hora: iso(h), chave, versao: VERSAO_AGREGADOS };
    for (const [c, v] of Object.entries(l)) {
      if (c === "g" || c === "grupo" || v == null || v === "") continue;
      if (c === "chave") { data.item = String(v); continue; }          // a chave do grupo (página, caminho, fim): "chave" é a da unidade
      if (NUMERICOS.test(c) && typeof v === "string" && v !== "" && Number.isFinite(Number(v))) { data[c] = Number(v); continue; }   // o DQL devolve long como texto
      if (c === "erros" && Array.isArray(v)) { const t = contagemTexto(v); if (t) data.erros_t = t; continue; }
      if (Array.isArray(v)) { const xs = v.filter((x) => x != null && x !== ""); if (xs.length) data[`${c}_j`] = JSON.stringify(xs); continue; }
      data[c] = typeof v === "number" || typeof v === "boolean" ? v : String(v);
    }
    out.push({ specversion: "1.0", id: `${chave}|${i}`, source: ORIGEM, type: TIPO_HORA, time: iso(h), data });
  });
  return out;
}
/** O registro de controle da unidade (grava por último; sem ele, a unidade não conta). */
export function controleDaHora(u: Unidade, exec: string, m: { linhas: number; bytes: number | null; ms: number; extra?: Record<string, Valor> }): EventoAgregado {
  const data: Record<string, Valor> = { k: "hora", hora: iso(u.hora), parte: u.parte, unidade: u.unidade, chave: `${u.unidade}|${exec}`, exec, versao: VERSAO_AGREGADOS, vq: VERSAO_QUADROS, linhas: m.linhas, ms: m.ms, ...(m.extra ?? {}) };
  if (m.bytes != null) data.bytes = m.bytes;
  return { specversion: "1.0", id: `${u.unidade}|${exec}|hora`, source: ORIGEM, type: TIPO_HORA, time: iso(u.hora), data };
}
/** Registro de cada execução da tarefa "hora" (1.44.1), com a hora em que rodou: o controle das unidades leva a hora
    analisada (sempre mais de 1 hora atrás) e uma execução sem hora pendente não grava unidade; é por este registro que a
    Configuração sabe que o workflow roda. */
export function execucaoDaHora(t: number, m: { pendentes: number; feitas: number; bytes: number; ms: number }): EventoAgregado {
  const exec = t.toString(36);
  return { specversion: "1.0", id: `hora_exec|${exec}`, source: ORIGEM, type: TIPO_HORA, time: iso(t),
           data: { k: "hora_exec", exec, versao: VERSAO_AGREGADOS, pendentes: m.pendentes, feitas: m.feitas, bytes: m.bytes, ms: m.ms } };
}
/** k de cada grupo das consultas da hora. */
export const K_SESSOES: Record<string, string> = { "1fim": "h_fim", "2caminho": "h_cam", "3pagina": "h_pag" };
export const K_REQ: Record<string, string> = { "1app": "h_app", "2dom": "h_dom", "3chamada": "h_cha", "4terceiro": "h_ter", "5lenta": "h_len", "6valores": "h_val" };
/** As linhas de sessões que a ação grava: tudo, menos a cauda dos caminhos (até CAMINHOS_POR_HORA, os de mais sessões). */
export function linhasSessoesParaGravar(linhas: Record<string, unknown>[]) {
  let caminhos = 0;
  return linhas.filter((l) => l.grupo !== "2caminho" || ++caminhos <= CAMINHOS_POR_HORA);
}
/** Unidades feitas (registro de controle) nas HORAS_CONFERIDAS mais recentes. */
export const qHorasFeitas = (agora: number) => `fetch bizevents, from: "${iso(inicioDaHora(agora) - (HORAS_CONFERIDAS + 1) * MS_HORA)}", to: "${iso(inicioDaHora(agora) + MS_HORA)}", bucket: {"${BUCKET_HORAS}"}
| filter k == "hora" and versao >= ${VERSAO_AGREGADOS}
| fields unidade, parte, vq
| limit 5000`;
/** 1.45.11: versão dos frames nas partes por sessão. Sessões e funis analisados antes dela (sem os frames das 24 h) são
    refeitos uma vez; a leitura fica com a execução mais recente de cada unidade (fonteHoras), sem buraco na troca. */
export const VERSAO_QUADROS = 1;
const PARTES_COM_QUADROS = new Set(["sessoes", "funis"]);
/** As unidades feitas de qHorasFeitas, sem as partes por sessão de antes da versão dos frames. */
export const unidadesFeitas = (linhas: Record<string, unknown>[]) => new Set(linhas
  .filter((l) => !PARTES_COM_QUADROS.has(String(l.parte)) || Number(l.vq ?? 0) >= VERSAO_QUADROS).map((l) => String(l.unidade)));

/* ---- Leitura (no app) ---------------------------------------------------------------------------------------------- */
/** As horas analisadas de cada parte nas últimas HORAS_CONFERIDAS: a mais recente (fim = início + 1 h) e quantas. */
export const qHorasAnalisadas = (funis: string | null) => `fetch bizevents, from: now()-${HORAS_CONFERIDAS + 2}h, bucket: {"${BUCKET_HORAS}"}
| filter k == "hora" and versao >= ${VERSAO_AGREGADOS}${funis ? ` and (parte != "funis" or endsWith(unidade, "|${aspas(funis)}"))` : ' and parte != "funis"'}
| summarize ultima = max(toTimestamp(hora)), horas = countDistinct(hora), bytes = sum(bytes), by:{parte}`;
/** Período das 24 h de cada parte: [fim - 24 h, fim), fim = fim da hora analisada mais recente. */
export interface PeriodoHoras { de: number; ate: number; horas: number }
export function periodosDasHoras(linhas: Record<string, unknown>[]): Partial<Record<ParteHora, PeriodoHoras>> {
  const r: Partial<Record<ParteHora, PeriodoHoras>> = {};
  for (const l of linhas) {
    const u = Date.parse(String(l.ultima ?? ""));
    if (isNaN(u)) continue;
    const ate = u + MS_HORA;
    r[String(l.parte) as ParteHora] = { de: ate - HORAS_ANALISE * MS_HORA, ate, horas: Math.min(HORAS_ANALISE, Number(l.horas ?? 0)) };
  }
  return r;
}
/** As horas analisadas de cada parte a partir das unidades feitas (as de qHorasFeitas, na ação): o mesmo que a tela lia
    em H-00 (13,6 MB por leitura no laboratório, a cada minuto por aba), montado pela tarefa "hora" e gravado no App State
    (1.44.4). Funis só os da chave de jornadas em uso. */
export function periodosDasUnidades(unidades: Iterable<string>, funis: string | null): Partial<Record<ParteHora, PeriodoHoras>> {
  const por = new Map<string, { ultima: number; horas: Set<number> }>();
  for (const u of unidades) {
    const [h, parte, fj] = u.split("|");
    if (!parte || (parte === "funis" && (!funis || fj !== funis))) continue;
    const t = Date.parse(h);
    if (isNaN(t)) continue;
    const e = por.get(parte) ?? { ultima: 0, horas: new Set<number>() };
    e.ultima = Math.max(e.ultima, t); e.horas.add(t);
    por.set(parte, e);
  }
  return periodosDasHoras([...por].map(([parte, e]) => ({ parte, ultima: iso(e.ultima), horas: e.horas.size })));
}
/** O que a tarefa "hora" grava no App State: os períodos e a chave das jornadas com que foram montados. */
export interface HorasAnalisadas { funis: string | null; periodos: Partial<Record<ParteHora, PeriodoHoras>> }
/** Os registros das horas do período, só os de unidade com controle (como as fatias). */
const fonteHoras = (p: PeriodoHoras, ks: string[]) => `fetch bizevents, from: "${iso(p.de)}", to: "${iso(p.ate)}", bucket: {"${BUCKET_HORAS}"}
| filter ${ks.length === 1 ? `k == "${ks[0]}"` : `in(k, array(${ks.map((k) => `"${k}"`).join(", ")}))`} and versao >= ${VERSAO_AGREGADOS}
| lookup [fetch bizevents, from: "${iso(p.de)}", to: "${iso(p.ate)}", bucket: {"${BUCKET_HORAS}"}
  | filter k == "hora" and versao >= ${VERSAO_AGREGADOS}
  | summarize chave = arrayLast(arraySort(collectArray(record(e = exec, c = chave))))[c], by:{unidade}
  | fields chave], sourceField: chave, lookupField: chave, prefix: "ok."
| filter isNotNull(ok.chave)`;
const faixasSomadas = () => Array.from({ length: N_FAIXAS }, (_, i) => `f${i} = sum(f${i})`).join(", ");
const fApp = (app: string) => (app === "*" ? "" : `\n| filter app == "${aspas(app)}"`);
/** H-SES (no lugar de H-01 a H-03, 1.43): as partes de sessão das 24 horas analisadas numa leitura, todas as aplicações
    (a tela filtra a aplicação; a aba guarda 5 min): onde as sessões terminam, caminhos (com as páginas com erro em texto) e
    páginas (somas e faixas de tempo). Cada leitor separado varria o bucket de horas inteiro de novo. */
export const qSessoes24 = (p: PeriodoHoras) => `${fonteHoras(p, ["h_fim", "h_cam", "h_pag"])}
| summarize n = sum(n), fins_erro = sum(fins_erro), uma = sum(uma), com_erro = sum(com_erro), navs = sum(navs), fim_erro = sum(fim_erro), erros_t = collectArray(erros_t),
    visitas = sum(visitas), errosp = sum(errosp), sessoes_erro = sum(sessoes_erro), soma = sum(soma), nd = sum(nd), ${faixasSomadas()}, by:{k, app, item}
| sort k asc, n desc
| limit 30000`;
/** H-REQ (no lugar de H-04 a H-07, 1.43): qualidade, domínios sem trace, chamadas, terceiros, as 3 mais lentas de cada
    página, os valores dos filtros e os funis das jornadas de agora, das 24 horas analisadas, numa leitura (todas as
    aplicações; a aba guarda 5 min). */
export const qReq24 = (pr: PeriodoHoras, pf: PeriodoHoras | null, funis: string | null) => {
  const de = Math.min(pr.de, pf?.de ?? pr.de), ate = Math.max(pr.ate, pf?.ate ?? pr.ate);
  const tempo = (x: PeriodoHoras) => `timestamp >= toTimestamp("${iso(x.de)}") and timestamp < toTimestamp("${iso(x.ate)}")`;
  const funil = pf && funis ? ` or (k == "h_fun" and jornadas == "${aspas(funis)}" and ${tempo(pf)})` : "";
  return `${fonteHoras({ de, ate, horas: 0 }, ["h_app", "h_dom", "h_cha", "h_ter", "h_len", "h_val", "h_fun"])}
| filter (in(k, array("h_app", "h_dom", "h_cha", "h_ter", "h_len", "h_val")) and ${tempo(pr)})${funil}
| summarize navs = sum(navs), nova_aba_sem_origem = sum(nova_aba_sem_origem), frames = sum(frames), sem_nome = sum(sem_nome), genericas = sum(genericas), hibridas = sum(hibridas), wv_and = sum(wv_and), wv_and_hib = sum(wv_and_hib), ios_hib = sum(ios_hib), reqs = sum(reqs), reqs_trace = sum(reqs_trace),
    n = sum(n), falhas = sum(falhas), sessoes_falha = sum(sessoes_falha), lentas = sum(lentas), sessoes = sum(sessoes), paginas_j = collectArray(paginas_j), exemplos_j = collectArray(exemplos_j),
    v_os_j = collectArray(v_os_j), v_nav_j = collectArray(v_nav_j), v_ver_j = collectArray(v_ver_j), v_pais_j = collectArray(v_pais_j), v_reg_j = collectArray(v_reg_j), funil_j = collectArray(funil_j), ${faixasSomadas()},
    by:{k, app, dominio, caminho, regiao, pagina, jornadas}
| fieldsAdd ordem = if(k == "h_dom" or k == "h_ter", n, else: if(k == "h_cha", falhas + lentas, else: 0))
| sort k asc, ordem desc
| limit 30000`;
};
/** H-08: ligação página -> serviço das 24 h (formato de qPaginasServicosGlobal: app, view, robo, servico, chamadas). */
export const qLigacao24 = (p: PeriodoHoras) => `${fonteHoras(p, ["h_lig"])}
| summarize chamadas = sum(chamadas), by:{app, view, robo, servico}
| sort chamadas desc
| limit 100000`;

/* ---- Montagem das linhas no formato das telas de antes (no navegador) --------------------------------------------- */
/** H-SES -> fins (formato de INI-A "1fim"), caminhos (com a lista de erros) e páginas (INI-B "pagina"), todas as aplicações. */
export function sessoes24ParaPartes(ls: Record<string, unknown>[]) {
  const de = (k: string) => ls.filter((l) => l.k === k);
  return {
    fins: de("h_fim").map((l) => ({ app: l.app, fim: l.item ?? null, fins: Number(l.n ?? 0), fins_erro: Number(l.fins_erro ?? 0), uma: Number(l.uma ?? 0), com_erro: Number(l.com_erro ?? 0), navs: Number(l.navs ?? 0) })) as Record<string, unknown>[],
    caminhos: caminhosDas24(de("h_cam").map((l) => ({ ...l, caminho: l.item }))) as Record<string, unknown>[],
    paginas: paginasDas24(de("h_pag").map((l) => ({ ...l, view: l.item ?? null, erros: l.errosp, sessoes: l.n }))) as Record<string, unknown>[],
  };
}
export type PartesSessoes24 = ReturnType<typeof sessoes24ParaPartes>;
/** Os caminhos de uma aplicação (ou de todas), os 2000 com mais sessões. */
export const caminhosDoEscopo = (cs: Record<string, unknown>[], app: string) => cs.filter((c) => app === "*" || c.app === app).sort((a, b) => Number(b.n) - Number(a.n)).slice(0, 2000);
/** H-REQ -> as linhas da qualidade (para qualidadeDas24), as mais lentas por página, os valores dos filtros e o funil. */
export function req24ParaPartes(ls: Record<string, unknown>[]) {
  const de = (k: string) => ls.filter((l) => l.k === k);
  return {
    qualidade: ls.filter((l) => l.k === "h_app" || l.k === "h_dom" || l.k === "h_cha" || l.k === "h_ter"),
    lentas: lentasDas24(de("h_len")),
    valores: valoresDas24(de("h_val").length ? [{ os: de("h_val").flatMap((l) => (l.v_os_j as unknown[]) ?? []), navegador: de("h_val").flatMap((l) => (l.v_nav_j as unknown[]) ?? []), versao: de("h_val").flatMap((l) => (l.v_ver_j as unknown[]) ?? []),
                                               pais: de("h_val").flatMap((l) => (l.v_pais_j as unknown[]) ?? []), regiao: de("h_val").flatMap((l) => (l.v_reg_j as unknown[]) ?? []) }] : []),
    funil: funisDas24(de("h_fun")),
  };
}
export type PartesReq24 = ReturnType<typeof req24ParaPartes>;
type L = Record<string, unknown>;
const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
/** H-02 -> linhas de caminho com a lista de erros (uma entrada por sessão e página, como INI-A). */
export const caminhosDas24 = (ls: L[]) => ls.map((l) => {
  const m = new Map<string, number>();
  for (const t of Array.isArray(l.erros_t) ? l.erros_t : []) for (const [k, v] of lerContagemTexto(t)) m.set(k, (m.get(k) ?? 0) + v);
  return { app: l.app, caminho: l.caminho, n: num(l.n), fim_erro: num(l.fim_erro), erros: [...m].flatMap(([k, v]) => Array.from({ length: Math.min(v, 10000) }, () => k)) };
});
/** H-03 -> linhas de página de INI-B (tipo "pagina", média e p75 em ms). */
export const paginasDas24 = (ls: L[]) => ls.map((l) => ({
  tipo: "pagina", app: l.app, view: l.view ?? null, visitas: num(l.visitas), erros: num(l.erros), sessoes: num(l.sessoes), sessoes_erro: num(l.sessoes_erro),
  media_ms: num(l.nd) > 0 ? num(l.soma) / num(l.nd) : null, p75_ms: percentilDasFaixas(faixasDaLinha(l)),
}));
const listaJson = (xs: unknown) => (Array.isArray(xs) ? xs : []).flatMap((s) => { try { const v = JSON.parse(String(s)); return Array.isArray(v) ? v : []; } catch { return []; } });
/** H-04 -> o resultado de separarQualidade (qualidade, domínios, chamadas e terceiros no formato das regras). */
export function qualidadeDas24(ls: L[]) {
  const de = (k: string) => ls.filter((l) => l.k === k);
  const p75 = (l: L) => percentilDasFaixas(faixasDaLinha(l));
  const paginas = (l: L) => [...new Set(listaJson(l.paginas_j).map(String))].slice(0, 5);
  return {
    qualidade: de("h_app").map((l) => ({ app: l.app, navs: num(l.navs), nova_aba_sem_origem: num(l.nova_aba_sem_origem), frames: num(l.frames), sem_nome: num(l.sem_nome), genericas: num(l.genericas), hibridas: num(l.hibridas), wv_and: num(l.wv_and), wv_and_hib: num(l.wv_and_hib), ios_hib: num(l.ios_hib), reqs: num(l.reqs), reqs_trace: num(l.reqs_trace) })),
    dominios: de("h_dom").map((l) => ({ app: l.app, dominio: l.dominio, n: num(l.n) })),
    chamadas: de("h_cha").slice(0, 1500).map((l) => ({ app: String(l.app ?? ""), caminho: String(l.caminho ?? ""), regiao: l.regiao == null || l.regiao === "" ? null : String(l.regiao), total: num(l.n), falhas: num(l.falhas), sessoesFalha: num(l.sessoes_falha), lentas: num(l.lentas), p75Ms: p75(l), paginas: paginas(l) })),
    terceiros: de("h_ter").slice(0, 200).map((l) => ({ app: String(l.app ?? ""), dominio: String(l.dominio ?? ""), n: num(l.n), falhas: num(l.falhas), p75Ms: p75(l), sessoes: num(l.sessoes), paginas: paginas(l) })),
  };
}
/** Exemplo lento: duração (ms), trace, sessão e endpoint. */
/** h (1.45.6): quando a requisição aconteceu, para o atalho do trace abrir no intervalo certo (as horas analisadas antes
    da 1.45.6 não têm). */
export interface ExemploLento { d: number; t: string; s: string | null; c: string | null; h?: string | null }
/** H-05 -> as 3 mais lentas de cada página. */
export function lentasDas24(ls: L[]): Map<string, ExemploLento[]> {
  const m = new Map<string, ExemploLento[]>();
  for (const l of ls) {
    const xs = listaJson(l.exemplos_j).map((x) => x as L).filter((x) => x && x.t).map((x) => ({ d: num(x.d), t: String(x.t), s: x.s == null ? null : String(x.s), c: x.c == null ? null : String(x.c), h: x.h == null ? null : String(x.h) }));
    const k = `${l.app}|${l.pagina ?? ""}`;
    m.set(k, [...(m.get(k) ?? []), ...xs].sort((a, b) => b.d - a.d).filter((x, i, a) => a.findIndex((y) => y.t === x.t) === i).slice(0, 3));
  }
  return m;
}
/** Valores das horas -> a linha de SEG-01 (listas sem repetição). */
export function valoresDas24(ls: L[]) {
  const l = ls[0] ?? {};
  const u = (c: string) => [...new Set(listaJson(l[c]).filter((x) => x != null && x !== "").map(String))].sort();
  return [{ os: u("os"), navegador: u("navegador"), versao: u("versao"), pais: u("pais"), regiao: u("regiao") }];
}
/** Funil das horas -> a linha de qFunisJuntos (j<n>_*: soma de cada campo das horas; cada hora guarda o seu em JSON). */
export function funisDas24(ls: L[]): L | undefined {
  const linhas = ls.flatMap((l) => (Array.isArray(l.funil_j) ? l.funil_j : l.funil_j != null ? [l.funil_j] : []));
  if (!linhas.length) return undefined;
  const r: L = {};
  let comC = 0;
  for (const j of linhas) { try { const o = JSON.parse(String(j)) as L; if (Object.keys(o).some((c) => /^j\d+_c\d+$/.test(c))) comC++; for (const [c, v] of Object.entries(o)) if (/^j\d+_/.test(c)) r[c] = num(r[c]) + num(v); } catch { /* hora com JSON quebrado: fica fora */ } }
  // 1.46.3: "seguiu com erro" (c) em todas as horas: só então o veredito do "Por quê?" sai das horas (linhasDosFunis, c_ok)
  r.j_c_ok = comC === linhas.length;
  return r;
}
