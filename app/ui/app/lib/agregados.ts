/* AGREGADOS DO DEF (arquitetura de 19/10/2026). No lugar das 10 métricas
   próprias (cobradas por série e minuto: centenas de reais por mês num ambiente grande), a ação "def-agregar" do
   app roda num workflow simples a cada 5 min, lê só a última fatia de 5 min da cópia (navegação, erro e experiência) e
   grava os totais dela como business events num bucket pequeno (rum_flow_agregados). O app soma as fatias da janela.
   Os agregados têm as MESMAS dimensões das métricas que substituem, e as leituras daqui devolvem as MESMAS colunas das
   consultas de métrica (lib/queries.ts): o grafo, a Visão geral e o Apdex não mudam, só a fonte.
   Sem dependência do SDK: a ação (actions/def-agregar.action.ts) e o app montam o texto aqui, e os testes rodam em Node. */
import { REGRAS_APDEX_MOBILE, LIMITES_ABERTURA, semParametro, BUCKET_AGREGADOS, BUCKETS_PASSOS, TIPO_AGREGADO, BUCKET_ERROS, TIPO_ERRO_AMOSTRA } from "./prerequisitos";

export { BUCKET_AGREGADOS, TIPO_AGREGADO, BUCKET_ERROS, TIPO_ERRO_AMOSTRA };
/** Tamanho da fatia e quanto esperar depois do fim dela antes de ler (registro que chega atrasado fica fora dela). */
export const FATIA_MIN = 5;
export const ATRASO_MIN = 3;
/** Fatias que cada execução confere para trás: uma execução que falhou é refeita pela seguinte (até 1 h depois). */
export const FATIAS_CONFERIDAS = 12;
/** Fatias que uma execução grava no máximo (cada uma é uma leitura; o teto mantém a execução abaixo de 1 min). */
export const FATIAS_POR_EXECUCAO = 4;
export const VERSAO_AGREGADOS = 7;   // 2: mobile sem view.sequence_number conta como navegação (como a métrica), não como entrada nula; 3: grupo errx; 4: análise de hora em hora com item e números; 5: 20 faixas de tempo; 6: buckets de erros e de horas, funil em JSON; 7: exemplos com hora e duração, grupo tcar, sessões da última hora
/** 1.46.2: as fatias com o grupo orig levam vo = 1 no registro de controle (campo próprio: VERSAO_AGREGADOS também vale para as
    horas analisadas, que filtram versao >= ela, e subir a versão invalidaria as 24 h analisadas, o que aconteceu na 1.46.1, com
    versao 8 nas fatias e nas horas daquela hora: essas também têm o grupo). Janela com fatia sem a marca lê as origens da cópia. */
export const VERSAO_ORIGENS = 1;
/** Buckets que a fatia lê: navegação, erro e experiência. As requisições (rum_flow_passos_req) não entram. */
export const BUCKETS_DA_FATIA = [BUCKETS_PASSOS.nav, BUCKETS_PASSOS.erro, BUCKETS_PASSOS.exp];

const MS_FATIA = FATIA_MIN * 60000;

/* ---- Faixas de tempo (p75 que se soma: fatia a fatia e hora a hora) ------------------------------------------------- */
/** Limites das faixas de tempo, em ms: faixa i = (limite i-1, limite i]; a última, acima do último limite. Progressão
    geométrica de 1,35 a partir de 50 ms (até ~15 s): erro máximo de ~17 % na interpolação (no LAB, 0,9 a 1,2 % do p75
    exato). A faixa sai de uma conta (logaritmo), não de 20 comparações: a leitura ao vivo cabe no limite de expressões. */
const FAIXA_BASE = 50, FAIXA_RAZAO = 1.35;
export const FAIXAS_MS = Array.from({ length: 20 }, (_, i) => FAIXA_BASE * FAIXA_RAZAO ** i);
export const N_FAIXAS = FAIXAS_MS.length + 1;
export const faixaDql = (campo: string) => `if(isNotNull(${campo}), if(${campo} <= ${FAIXA_BASE}, 0, else: if(${campo} > ${FAIXAS_MS[FAIXAS_MS.length - 1]}, ${N_FAIXAS - 1}, else: toLong(ceil(log(${campo} / ${FAIXA_BASE}.0) / log(${FAIXA_RAZAO}))))))`;
export const somasFaixas = (cond: (i: number) => string) => Array.from({ length: N_FAIXAS }, (_, i) => `f${i} = ${cond(i)}`).join(", ");
/** O percentil (0 a 1) a partir das contagens por faixa: interpolação linear dentro da faixa (a última vai até 1,5 x o último
    limite). null sem medição. */
export function percentilDasFaixas(f: number[], q = 0.75): number | null {
  const total = f.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return null;
  const alvo = q * total;
  let acc = 0;
  for (let i = 0; i < f.length; i++) {
    if (acc + f[i] >= alvo && f[i] > 0) {
      const ini = i === 0 ? 0 : FAIXAS_MS[i - 1], fim = i < FAIXAS_MS.length ? FAIXAS_MS[i] : FAIXAS_MS[FAIXAS_MS.length - 1] * 1.5;
      return ini + ((alvo - acc) / f[i]) * (fim - ini);
    }
    acc += f[i];
  }
  return FAIXAS_MS[FAIXAS_MS.length - 1];
}
export const faixasDaLinha = (l: Record<string, unknown>) => Array.from({ length: N_FAIXAS }, (_, i) => Number(l[`f${i}`] ?? 0) || 0);
/** Início da fatia que contém o instante (ms). */
export const inicioDaFatia = (ms: number) => Math.floor(ms / MS_FATIA) * MS_FATIA;
/** Fim da última fatia que já pode ser lida agora. */
export const fimLegivel = (agora: number) => inicioDaFatia(agora - ATRASO_MIN * 60000);
/** As fatias (início, ms) que faltam entre as FATIAS_CONFERIDAS mais recentes, da mais antiga para a mais nova, até o
    teto por execução. `feitas` = início das fatias que já têm o registro de controle. */
export function fatiasPendentes(agora: number, feitas: Set<number>, conferidas = FATIAS_CONFERIDAS, teto = FATIAS_POR_EXECUCAO): number[] {
  const fim = fimLegivel(agora);
  const todas = Array.from({ length: conferidas }, (_, i) => fim - (conferidas - i) * MS_FATIA);
  return todas.filter((t) => !feitas.has(t)).slice(-teto);
}
const iso = (ms: number) => new Date(ms).toISOString();

/* ---- Leitura da fatia (na ação) --------------------------------------------------------------------------------------
   Cada registro da cópia entra em um ou mais grupos (k) com o filtro e as dimensões da métrica que o grupo substitui:
     nav    · rum_flow.navigation + rum_flow.entry: navegação; origem vazia = entrada (web: sem view.source.name; mobile:
              1ª tela da sessão, pela sequência, porque a origem dela é a última tela da sessão anterior);
     erro   · rum_flow.error;
     view   · rum_flow.view + rum_flow.view_time: resumo da tela (view_summary), com a soma e a contagem do tempo em 1º plano;
     clique · rum_flow.interaction;
     carga  · rum_flow.web_apdex: nota apdex_score pela página da carga (page.name), soma e quantidade;
     amob   · rum_flow.mobile_apdex: item e faixa pelas mesmas regras (REGRAS_APDEX_MOBILE);
     lugar  · rum_flow.web_apdex_lugar + rum_flow.mobile_apdex_lugar: canal, aplicação, país, estado e faixa;
     errx   · (1.43) cada erro como o cliente sentiu (página, tipo, status, endpoint, domínio, mensagem, tipo da exceção), com
              os 3 exemplos mais recentes (hora, trace, sessão e duração) e o último instante: a lista de erros, o painel da
              página e os exemplos ("só o que importa: os erros") saem daqui, sem leitura sob demanda;
     tcar   · (1.43) tempo de carga por página: navegações com duração, soma e faixas de tempo (média e p75 do período);
     orig   · (1.46.1) origem que o RUM não ligou (aba nova ou frame), a mesma contagem de qOrigensRecuperadas (lib/queries.ts):
              a página anterior que o navegador informa (page.source.url.path, minúsculas e sem ";..."), a página, o tipo de
              navegação, a aba e o usuário; "origem igual à página" sai na leitura (qOrigensAgregado), para a fatia caber no
              limite de expressões. O grafo deixa de ler as navegações da cópia do período a cada abertura.
   Mobile = id de aplicação com hífen (UUID), a mesma regra do resto do app (a cópia não leva frontend.type). Os nomes de
   página saem limpos (sem ";jsessionid=..."), como os campos def.* que as métricas liam. */
const MOB = 'contains(dt.rum.application.id, "-")';
/** Item e faixa do Apdex mobile do registro (record(i, f)) ou nulo: as MESMAS regras de REGRAS_APDEX_MOBILE
    (lib/prerequisitos.ts), em forma compacta: cada condição repetida (ação, abertura, tela, erro, sem erro, limites da
    abertura por tipo) é calculada uma vez, e as regras se aplicam na mesma ordem, a primeira que casa vale. Antes cada regra
    trazia o próprio texto inteiro e a leitura ao vivo (cabeça e cauda da cópia, cada uma com as regras) passava do limite
    de 1.000 expressões do DQL. Provado igual às regras por extenso nas fatias gravadas. */
const msLit = (s: number) => `${Math.round(s * 1000)}ms`;
const ACAO_LIMITES: [number, number] = [3, 12];   // ação: até 3 s = 1, até 12 s = 0,5 (as de REGRAS_APDEX_MOBILE)
const limiteAbertura = (k: 0 | 1) => `if(app_start.type == "warm", ${msLit(LIMITES_ABERTURA.warm[k])}, else: if(app_start.type == "hot", ${msLit(LIMITES_ABERTURA.hot[k])}, else: ${msLit(LIMITES_ABERTURA.cold[k])}))`;
const rec = (i: string, f: string) => `record(i = "${i}", f = "${f}")`;
const REGRAS_MOBILE = `| fieldsAdd m_ua = mob and c == "user_action" and (isNull(user_action.type) or user_action.type != "app_start"), m_ap = mob and c == "app_start", m_te = mob and c == "view_summary", m_er = mob and c == "error", m_se = isNull(error.count) or error.count <= 0, m_ce = error.count > 0
| fieldsAdd m_l1 = if(m_ap, ${limiteAbertura(0)}), m_l2 = if(m_ap, ${limiteAbertura(1)}), m_cr = m_er and (error.type == "crash" or characteristics.has_crash == true),
    m_an = m_er and (error.type == "anr" or characteristics.has_anr == true) and (isNull(error.type) or error.type != "crash") and (isNull(characteristics.has_crash) or characteristics.has_crash != true)
| fieldsAdd af = if(m_ua and m_se and duration <= ${msLit(ACAO_LIMITES[0])}, ${rec("acao", "satisfeito")}, else: if(m_ua and m_se and duration > ${msLit(ACAO_LIMITES[0])} and duration <= ${msLit(ACAO_LIMITES[1])}, ${rec("acao", "tolerante")},
    else: if(m_ua and m_se and duration > ${msLit(ACAO_LIMITES[1])}, ${rec("acao", "frustrado_tempo")}, else: if(m_ua and m_ce, ${rec("acao", "frustrado_erro")},
    else: if(m_ap and duration <= m_l1, ${rec("abertura", "satisfeito")}, else: if(m_ap and duration > m_l1 and duration <= m_l2, ${rec("abertura", "tolerante")}, else: if(m_ap and duration > m_l2, ${rec("abertura", "frustrado_tempo")},
    else: if(m_te and m_se, ${rec("tela", "satisfeito")}, else: if(m_te and m_ce, ${rec("tela", "frustrado_erro")}, else: if(m_cr, ${rec("crash", "frustrado_erro")}, else: if(m_an, ${rec("anr", "frustrado_erro")})))))))))))`;
/** As regras por extenso (uma por campo), como até a 1.41.9: servem para comparar com a forma compacta. */
const regraDql = (m: string) => m.split('frontend.type == "mobile"').join(MOB);
export const REGRAS_MOBILE_EXTENSO = `| fieldsAdd ${REGRAS_APDEX_MOBILE.map((r, i) => `ra${i} = ${regraDql(r.matcher)}`).join(", ")}
| fieldsAdd af = if(mob, ${REGRAS_APDEX_MOBILE.reduceRight((resto, r, i) => `if(ra${i}, ${rec(r.item, r.faixa)}${resto ? `, else: ${resto}` : ""})`, "")})`;
let regrasMobile = REGRAS_MOBILE;
/** Para comparação: troca as regras compactas pelas por extenso. */
export const usarRegrasMobileExtenso = (sim: boolean) => { regrasMobile = sim ? REGRAS_MOBILE_EXTENSO : REGRAS_MOBILE; };
const L = semParametro;
export const LIMITE_LINHAS_FATIA = 500_000;
export type GrupoAgregado = "nav" | "erro" | "view" | "clique" | "carga" | "amob" | "lugar" | "errx" | "tcar" | "orig";
export const GRUPOS_AGREGADO: GrupoAgregado[] = ["nav", "erro", "view", "clique", "carga", "amob", "lugar", "errx", "tcar", "orig"];
/** Buckets da cópia que cada grupo lê. */
const BUCKETS_DO_GRUPO: Record<GrupoAgregado, string[]> = {
  nav: [BUCKETS_PASSOS.nav], erro: [BUCKETS_PASSOS.erro], view: [BUCKETS_PASSOS.exp], clique: [BUCKETS_PASSOS.exp], carga: [BUCKETS_PASSOS.exp],
  amob: [BUCKETS_PASSOS.exp, BUCKETS_PASSOS.erro], lugar: [BUCKETS_PASSOS.exp, BUCKETS_PASSOS.erro], errx: [BUCKETS_PASSOS.erro], tcar: [BUCKETS_PASSOS.nav], orig: [BUCKETS_PASSOS.nav],
};
/** Os grupos (k) de um trecho da cópia, com as mesmas colunas dos agregados gravados. Lê só os buckets dos grupos pedidos
    e só monta as regras do Apdex mobile quando algum grupo precisa delas. */
export const qAgregarCopia = (ini: number, fim: number, ks: GrupoAgregado[] = GRUPOS_AGREGADO) => {
  const tem = (k: GrupoAgregado) => ks.includes(k);
  const comMobile = tem("amob") || tem("lugar");
  const buckets = [...new Set(ks.flatMap((k) => BUCKETS_DO_GRUPO[k]))];
  const grupos = [
    tem("nav") ? 'if(c == "navigation", "nav")' : null, tem("erro") ? 'if(c == "error", "erro")' : null, tem("view") ? 'if(c == "view_summary", "view")' : null,
    tem("clique") ? 'if(c == "user_interaction", "clique")' : null, tem("carga") ? 'if(isNotNull(apdex_score) and isNotNull(page.name), "carga")' : null,
    tem("amob") ? 'if(isNotNull(af), "amob")' : null, tem("lugar") ? 'if(isNotNull(fw) or isNotNull(af), "lugar")' : null,
    tem("errx") ? 'if(c == "error", "errx")' : null, tem("tcar") ? 'if(c == "navigation" and toDouble(duration) > 0, "tcar")' : null,
    tem("orig") ? 'if(isNotNull(po) and po != "", "orig")' : null,
  ].filter(Boolean).join(", ");
  // errx: os 3 exemplos mais recentes (entre os primeiros 200 de cada erro na fatia) com hora, trace, sessão e duração, e o
  // último instante (os outros grupos ficam com lista vazia)
  const amostras = tem("errx") ? `, amostras = arraySlice(arraySort(arrayRemoveNulls(collectArray(if(g == "errx", record(h = start_time, t = toString(trace.id), s = dt.rum.session.id, d = toDouble(duration) / 1000000.0)), maxLength: 200)), direction: "descending"), from: 0, to: 3), ultimo = max(if(g == "errx", start_time))` : "";
  // tcar: a faixa do tempo de carga é chave do grupo (média = soma / n; p75 pelas contagens de cada faixa)
  const faixasCarga = "";
  const chavesErrx = tem("errx") ? `,
        status = if(g == "errx", http.response.status_code), caminho = if(g == "errx", url.path), dominio = if(g == "errx", url.domain),
        msg = if(g == "errx", substring(coalesce(exception.message, error.display_name, ""), from: 0, to: 140)), excecao = if(g == "errx", exception.type)` : "";
  return `fetch bizevents, from: "${iso(ini)}", to: "${iso(fim)}", bucket: {${buckets.map((b) => `"${b}"`).join(", ")}}
| fieldsAdd c = characteristics.classifier, mob = ${MOB}
| fieldsAdd e_entrada = c == "navigation" and ((mob and coalesce(view.sequence_number, 0) == 1) or (not mob and isNull(view.source.name)))${comMobile ? `
${regrasMobile}` : `
| fieldsAdd af = if(false, record(i = "", f = ""))`}
| fieldsAdd fw = if(isNotNull(apdex_score), if(apdex_score >= 1, "satisfeito", else: if(apdex_score > 0, "tolerante", else: "frustrado")))${tem("tcar") ? `
| fieldsAdd dc = if(c == "navigation" and toDouble(duration) > 0, toDouble(duration) / 1000000.0)
| fieldsAdd fx = ${faixaDql("dc")}` : ""}${tem("orig") ? `
| fieldsAdd po = if(c == "navigation" and isNotNull(page.source.url.path) and (isNull(view.source.name) or navigation.tab_state == "duplicated"), lower(splitString(toString(page.source.url.path), ";")[0]))` : ""}
| fieldsAdd g = arrayRemoveNulls(array(${grupos}))
| expand g
| summarize n = count(), soma = sum(if(g == "carga", toDouble(apdex_score), else: if(g == "view", toDouble(view.foreground_time), else: if(g == "tcar", dc)))), medidos = countIf(g == "view" and isNotNull(view.foreground_time))${amostras}${faixasCarga},
    by:{k = g, app = dt.rum.application.id, entidade = if(g == "nav", dt.rum.application.entity), origem = if(g == "nav" and not e_entrada, ${L("view.source.name")}${tem("orig") ? ", else: if(g == \"orig\", po)" : ""}),
        pagina = if(g != "carga" and g != "lugar", ${L("view.name")}), navegacao = if(g == "nav" or g == "orig", navigation.type), aba = if(g == "nav" or g == "orig", navigation.tab_state), entrada = if(g == "nav", e_entrada),
        usuario = if(in(g, array("nav", "erro", "view", "clique", "errx", "tcar", "orig")), dt.rum.user_type), etipo = if(g == "erro" or g == "errx", error.type), provedor = if(g == "erro" or g == "errx", url.provider),
        itipo = if(g == "clique", interaction.type), elemento = if(g == "clique", ui_element.detected_name), tag = if(g == "clique", ui_element.tag_name),
        frontend = if(g == "carga" or g == "amob", frontend.name), carga = if(g == "carga", ${L("page.name")}),
        sistema = if(g == "amob", os.name), acao = if(g == "amob", user_action.name), abertura = if(g == "amob", app_start.type), item = if(g == "amob", af[i]),
        faixa = if(g == "amob", af[f], else: if(g == "lugar", coalesce(fw, if(af[f] == "satisfeito", "satisfeito", else: if(af[f] == "tolerante", "tolerante", else: "frustrado"))))),
        canal = if(g == "lugar", if(mob, "mobile", else: "web")), pais = if(g == "lugar", geo.country.iso_code), regiao = if(g == "lugar", geo.region.name)${chavesErrx}${tem("tcar") ? ", ft = if(g == \"tcar\", fx)" : ""}}`;
};
export const qFatia = (ini: number, fim: number) => `${qAgregarCopia(ini, fim)}
| limit ${LIMITE_LINHAS_FATIA}`;

/** Campos de cada agregado gravado (além de k, n e da fatia). */
export const CAMPOS_AGREGADO = ["app", "entidade", "origem", "pagina", "navegacao", "aba", "entrada", "usuario", "etipo", "provedor", "itipo", "elemento", "tag",
  "frontend", "carga", "sistema", "acao", "abertura", "item", "faixa", "canal", "pais", "regiao", "status", "caminho", "dominio", "msg", "excecao"] as const;
/** Separador das listas de exemplo gravadas como texto até a 1.43.5 (traces e sessões: hexadecimal e letras, sem vírgula). */
export const SEP_AMOSTRA = ",";
/** Um exemplo de erro: hora, trace (vazio no erro de tela), sessão e duração (ms; só no erro de requisição). */
export interface ExemploErro { h: string | null; t: string | null; s: string | null; d: number | null }
/** Os exemplos de uma ou mais linhas de errx, em qualquer formato: a lista de registros (leitura da cópia), o JSON gravado
    (amostras_j, uma ou várias horas/fatias) ou as listas de texto de antes (amostra_t, amostra_s). Os 3 mais recentes. */
export function exemplosDe(...ls: Record<string, unknown>[]): ExemploErro[] {
  const out: ExemploErro[] = [];
  const normal = (x: Record<string, unknown>): ExemploErro => ({ h: x.h == null ? null : String(x.h), t: x.t == null || x.t === "" ? null : String(x.t), s: x.s == null ? null : String(x.s), d: x.d == null || !Number.isFinite(Number(x.d)) ? null : Number(x.d) });
  for (const l of ls) {
    const antes = out.length;
    if (Array.isArray(l.amostras)) for (const x of l.amostras) if (x && typeof x === "object") out.push(normal(x as Record<string, unknown>));
    if (Array.isArray(l.exemplos)) for (const x of l.exemplos) if (x && typeof x === "object") out.push(normal(x as Record<string, unknown>));
    for (const j of Array.isArray(l.amostras_j) ? l.amostras_j : l.amostras_j != null ? [l.amostras_j] : []) {
      try { const v = JSON.parse(String(j)); if (Array.isArray(v)) for (const x of v) if (x && typeof x === "object") out.push(normal(x)); } catch { /* fora */ }
    }
    // 1.47.10: as listas de texto (de antes) só valem para a linha SEM exemplo completo: numa linha já fechada elas saem dos
    // exemplos filtradas uma a uma (lib/aovivo.ts) e, desalinhadas, formavam um par trace x sessão que não existe (exemplo sem hora)
    if (out.length > antes) continue;
    const ts = typeof l.amostra_t === "string" ? l.amostra_t.split(SEP_AMOSTRA) : Array.isArray(l.amostra_t) ? l.amostra_t.map(String) : [];
    const ss = typeof l.amostra_s === "string" ? l.amostra_s.split(SEP_AMOSTRA) : Array.isArray(l.amostra_s) ? l.amostra_s.map(String) : [];
    for (let i = 0; i < Math.max(ts.length, ss.length); i++) out.push({ h: null, t: ts[i] || null, s: ss[i] || null, d: null });
  }
  const vistos = new Set<string>();
  return out.filter((x) => (x.t || x.s) && !vistos.has(`${x.t}|${x.s}`) && vistos.add(`${x.t}|${x.s}`))
    .sort((a, b) => (b.h ?? "").localeCompare(a.h ?? "")).slice(0, 3);
}

/** Um business event do agregado: o que a ação manda para a ingestão (CloudEvent). time = início da fatia (é o
    timestamp do registro: a leitura do app pega as fatias que começam dentro da janela). chave = fatia + execução: a
    leitura só aceita agregado cuja chave tem o registro de controle (lib abaixo), então uma execução que gravou metade e
    caiu não conta duas vezes quando a seguinte refaz a fatia. */
export interface EventoAgregado { specversion: "1.0"; id: string; source: string; type: string; time: string; data: Record<string, string | number | boolean> }
const ORIGEM_EVENTO = "def.agregador";
export function eventosDaFatia(linhas: Record<string, unknown>[], ini: number, exec: string): EventoAgregado[] {
  const chave = `${iso(ini)}|${exec}`;
  return linhas.map((l, i) => {
    const data: Record<string, string | number | boolean> = { k: String(l.k), n: Number(l.n ?? 0), fatia: iso(ini), chave, versao: VERSAO_AGREGADOS };
    if (l.k === "carga" || l.k === "view" || l.k === "tcar") { const s = Number(l.soma); if (Number.isFinite(s)) data.soma = s; }
    if (l.k === "view") data.medidos = Number(l.medidos ?? 0);
    if (l.k === "tcar" && l.ft != null && Number.isFinite(Number(l.ft))) data.ft = Number(l.ft);
    if (l.k === "errx") {
      const ex = exemplosDe(l);
      if (ex.length) data.amostras_j = JSON.stringify(ex);
      if (l.ultimo != null) data.ultimo = String(l.ultimo);
    }
    for (const c of CAMPOS_AGREGADO) {
      const v = l[c];
      if (v == null || v === "") continue;
      data[c] = c === "entrada" ? v === true || v === "true" : String(v);
    }
    // errx no bucket de erros (tipo próprio): quem lê o resto dos agregados não varre os erros com exemplos
    return { specversion: "1.0", id: `${chave}|${i}`, source: ORIGEM_EVENTO, type: l.k === "errx" ? TIPO_ERRO_AMOSTRA : TIPO_AGREGADO, time: iso(ini), data };
  });
}
/** O registro de controle da fatia: grava por último; sem ele, a fatia conta como não feita e os agregados dela não valem. */
export function controleDaFatia(ini: number, exec: string, medida: { linhas: number; bytes: number | null; registros: number | null; ms: number }): EventoAgregado {
  const chave = `${iso(ini)}|${exec}`;
  const data: Record<string, string | number | boolean> = { k: "fatia", fatia: iso(ini), fatia_fim: iso(ini + MS_FATIA), chave, exec, versao: VERSAO_AGREGADOS, vo: VERSAO_ORIGENS, linhas: medida.linhas, ms: medida.ms };
  if (medida.bytes != null) data.bytes = medida.bytes;
  if (medida.registros != null) data.registros = medida.registros;
  return { specversion: "1.0", id: `${chave}|fatia`, source: ORIGEM_EVENTO, type: TIPO_AGREGADO, time: iso(ini), data };
}
/** O registro de controle do retrato da Visão geral (tarefa "sessoes", lib/agendado.ts): quando leu, quanto leu e o tamanho de
    cada parte gravada no App State (-1 = grande demais, -2 = não gravou por falha). k = "retrato". */
export function controleDoRetrato(t: number, m: { consultas: number; bytes: number; ms: number; tamanhos: Record<string, number>; jornadas: number; pulado?: string }): EventoAgregado {
  const data: Record<string, string | number | boolean> = { k: "retrato", desde: iso(t), versao: VERSAO_AGREGADOS, consultas: m.consultas, bytes: m.bytes, ms: m.ms, jornadas: m.jornadas };
  if (m.pulado) data.pulado = m.pulado;
  for (const [parte, tam] of Object.entries(m.tamanhos)) data[`tam_${parte}`] = tam;
  return { specversion: "1.0", id: `retrato|${iso(t)}`, source: ORIGEM_EVENTO, type: TIPO_AGREGADO, time: iso(t), data };
}
/** Lotes de ingestão abaixo do limite da API (5 MiB por chamada), com o controle sempre no último. */
export function lotesDeIngestao(eventos: EventoAgregado[], maxBytes = 4_000_000): EventoAgregado[][] {
  const lotes: EventoAgregado[][] = [];
  let atual: EventoAgregado[] = [], tam = 2;
  for (const e of eventos) {
    const t = JSON.stringify(e).length + 1;
    if (atual.length && tam + t > maxBytes) { lotes.push(atual); atual = []; tam = 2; }
    atual.push(e); tam += t;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}
/** Fatias já feitas (registro de controle) nas FATIAS_CONFERIDAS mais recentes. */
export const qFatiasFeitas = (agora: number) => `fetch bizevents, from: "${iso(fimLegivel(agora) - (FATIAS_CONFERIDAS + 1) * MS_FATIA)}", to: "${iso(fimLegivel(agora) + MS_FATIA)}", bucket: {"${BUCKET_AGREGADOS}"}
| filter k == "fatia"
| fields fatia
| limit 1000`;

/* ---- Leitura dos agregados (no app): AO VIVO -------------------------------------------------------------------------
   Decisão de produto: tempo real, sem esperar a fatia. Janela relativa ("30m") = [agora - 30 min, agora], exata:
     cabeça · da cópia, do início da janela até a 1ª fatia inteira (menos de 5 min);
     fatias · as guardadas no bucket de agregados (cada minuto foi lido uma vez, pela ação);
     cauda  · da cópia, do fim da última fatia gravada até agora (de 3 a 8 min com o workflow em dia).
   A cabeça e a cauda saem da cópia com a MESMA agregação da ação (qAgregarCopia) e têm as mesmas colunas dos agregados.
   No app (1.42), a cabeça e a cauda de TODOS os grupos saem de UMA leitura por aba a cada 5 min (qTrechoAoVivo,
   lib/aovivo.ts), e cada leitor lê só as fatias guardadas do mesmo trecho (parâmetro `t`) e soma a cabeça e a cauda no
   navegador. Ler a cabeça e a cauda em cada leitor relia a mesma cópia até 9 vezes por carga (dezenas de GiB
   por carga num ambiente grande). Sem `t`, o leitor ainda lê tudo numa consulta (cabeça + fatias + cauda): os cliques do painel da página e a
   prova. Janela "início/fim" (prova, dossiê): só as fatias guardadas. */
let fimAgregados: number | null = null;
export const usarFimAgregados = (ms: number | null) => { fimAgregados = ms; };
export const fimDosAgregados = () => fimAgregados ?? fimLegivel(Date.now());
/** "Agora" das leituras ao vivo (null = o relógio); uma comparação fixa o instante para comparar com a leitura direta. */
let agoraFixo: number | null = null;
export const usarAgoraFixo = (ms: number | null) => { agoraFixo = ms; };
const agoraDasLeituras = () => agoraFixo ?? Date.now();
/** 1.46.0: sem tempo real (Configuração › Atualização dos números, lib/atualizacao.ts). A janela relativa termina no fim da
    última fatia gravada pelo workflow e começa `janela` antes dele: só as fatias guardadas, sem cabeça nem cauda da cópia
    (nenhuma leitura ao vivo). O dado fica de 5 a 10 min atrás e é o mesmo em todas as abas da mesma fatia. */
let semTempoReal = false;
export const usarSemTempoReal = (v: boolean) => { semTempoReal = v; };
export const semTempoRealEmUso = () => semTempoReal;
const minutos =(janela: string) => { const m = /^(\d+)([mhd])$/.exec(janela); return m ? +m[1] * ({ m: 1, h: 60, d: 1440 } as Record<string, number>)[m[2]] : null; };
/** Janela relativa ("30m"): a que tem leitura ao vivo. */
export const janelaRelativa = (janela: string) => minutos(janela) != null;
/** Os trechos de uma janela relativa: cabeça e cauda na cópia, fatias guardadas no meio (ms). */
export interface Trecho { ini: number; iniFatias: number; fimFatias: number; fim: number }
export function trechosAoVivo(janela: string, agora = agoraDasLeituras()): Trecho {
  const m = minutos(janela) ?? 0;
  if (semTempoReal) {
    const fim = Math.min(fimDosAgregados(), inicioDaFatia(agora));
    return { ini: fim - m * 60000, iniFatias: fim - m * 60000, fimFatias: fim, fim };
  }
  const ini = agora - m * 60000;
  const iniFatias = Math.min(Math.ceil(ini / MS_FATIA) * MS_FATIA, agora);
  const fimFatias = Math.max(iniFatias, Math.min(fimDosAgregados(), inicioDaFatia(agora)));
  return { ini, iniFatias, fimFatias, fim: agora };
}
export const intervaloAgregados = (janela: string): { ini: number; fim: number } => {
  if (minutos(janela) != null) { const t = trechosAoVivo(janela); return { ini: t.ini, fim: t.fim }; }
  const [a, b] = janela.split("/");
  return { ini: Date.parse(a), fim: b ? Date.parse(b) : Date.now() };
};
const deAte = (ini: number, fim: number) => `"${iso(ini)}", to: "${iso(fim)}"`;
/** Nome atual da aplicação (web, mobile ou custom), como em lib/queries.ts. */
const nomeAplicacao = (campo: string) => `entityName(${campo}, type: "dt.entity.application"), entityName(${campo}, type: "dt.entity.mobile_application"), entityName(${campo}, type: "dt.entity.custom_application")`;
const aspas = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const lista = (xs: string[]) => `array(${xs.map((x) => `"${aspas(x)}"`).join(", ")})`;
/** Só as fatias guardadas num intervalo, e só as de fatia com registro de controle (ver eventosDaFatia). O errx fica no bucket
    de erros; o controle, sempre no de agregados. */
const fatiasGuardadas = (ini: number, fim: number, ks: string[]) => `fetch bizevents, from: ${deAte(ini, fim)}, bucket: {${[...new Set(ks.map((k) => (k === "errx" ? BUCKET_ERROS : BUCKET_AGREGADOS)))].map((b) => `"${b}"`).join(", ")}}
| filter ${ks.length === 1 ? `k == "${ks[0]}"` : `in(k, ${lista(ks)})`}
| lookup [fetch bizevents, from: ${deAte(ini, fim)}, bucket: {"${BUCKET_AGREGADOS}"}
  | filter k == "fatia"
  | fields chave], sourceField: chave, lookupField: chave, prefix: "ok."
| filter isNotNull(ok.chave)`;
/** Os agregados dos grupos pedidos na janela. Relativa: cabeça + fatias + cauda (ao vivo); "início/fim": só as fatias.
    `aoVivo` = false lê só as fatias também na relativa (séries e escopo de 7 dias). `so` = só as fatias guardadas desse
    trecho (a cabeça e a cauda dele vêm de qTrechoAoVivo e são somadas no navegador, lib/aovivo.ts). */
export const fonteAgregados = (janela: string, ks: GrupoAgregado[], aoVivo = true, so?: Trecho) => {
  if (so) return fatiasGuardadas(so.iniFatias, so.fimFatias > so.iniFatias ? so.fimFatias : so.iniFatias + 1, ks);
  if (minutos(janela) == null) { const { ini, fim } = intervaloAgregados(janela); return fatiasGuardadas(ini, fim, ks); }
  const t = trechosAoVivo(janela);
  if (!aoVivo || semTempoReal) return fatiasGuardadas(t.iniFatias, t.fimFatias > t.iniFatias ? t.fimFatias : t.iniFatias + 1, ks);
  const partes: string[] = [];
  // a cauda sempre existe (pelo menos 1 s): é a consulta principal
  const cauda = qAgregarCopia(Math.min(t.fimFatias, t.fim - 1000), t.fim, ks);
  if (t.fimFatias > t.iniFatias) partes.push(fatiasGuardadas(t.iniFatias, t.fimFatias, ks));
  if (t.iniFatias > t.ini) partes.push(qAgregarCopia(t.ini, t.iniFatias, ks));
  return `${cauda}${partes.map((p) => `\n| append [${p.split("\n").join("\n  ")}]`).join("")}`;
};
/** Os grupos da leitura ao vivo do app: todos (os cliques e o tempo de carga entraram na 1.43.6 para o painel da página ficar
    no período escolhido; a leitura varre os mesmos buckets, só devolve mais linhas). */
export const GRUPOS_TRECHO: GrupoAgregado[] = ["nav", "erro", "view", "clique", "carga", "amob", "lugar", "errx", "tcar", "orig"];
/** A cabeça e a cauda do trecho, de todos os grupos, numa leitura: as linhas agregadas da cópia (mesmas colunas das
    fatias), com o nome atual da aplicação nas de navegação (a aplicação que só aparece nos últimos minutos também tem
    nome). A cauda tem pelo menos 1 s. */
export const qTrechoAoVivo = (t: Trecho, ks: GrupoAgregado[] = GRUPOS_TRECHO) => {
  const cauda = `${qAgregarCopia(Math.min(t.fimFatias, t.fim - 1000), t.fim, ks)}
| fieldsAdd parte = "cauda"`;
  const cabeca = t.iniFatias > t.ini ? `\n| append [${`${qAgregarCopia(t.ini, t.iniFatias, ks)}\n| fieldsAdd parte = "cabeca"`.split("\n").join("\n  ")}]` : "";
  return `${cauda}${cabeca}
| fieldsAdd nome = if(k == "nav", coalesce(${nomeAplicacao("entidade")}))`;
};
/** Verificação ao abrir (PRE-01): o fim da última fatia gravada nas últimas 2 h e o relógio do Grail. */
export const qUltimaFatia = () => `fetch bizevents, from: now()-2h, bucket: {"${BUCKET_AGREGADOS}"}
| filter k == "fatia"
| sort timestamp desc
| limit 1
| fields fim = fatia_fim, agora = now()`;
/** As fatias gravadas na janela (cobertura: "6 de 6 fatias"). */
export const qCoberturaAgregados = (janela: string) => `fetch bizevents, from: ${(() => { const i = intervaloAgregados(janela); return deAte(i.ini, i.fim); })()}, bucket: {"${BUCKET_AGREGADOS}"}
| filter k == "fatia"
| summarize fatias = countDistinct(fatia), bytes = sum(bytes), linhas = sum(linhas)`;

const TODAS = "*";
const fApp = (app: string) => (app === TODAS ? "" : ` and app == "${aspas(app)}"`);
const fRobos = (robos: boolean) => (robos ? "" : ' and (isNull(usuario) or usuario != "robot")');
const fQuadros = (quadros: boolean) => (quadros ? "" : ' and (isNull(aba) or aba != "duplicated")');
/** Falha de terceiros não é erro da página, só na web (no mobile o agente marca toda chamada como third_party). */
const SO_PROPRIO = '(isNull(provedor) or provedor != "third_party" or contains(app, "-"))';

/** BAS-01 (era qAplicacoesMetrica): navegações e entradas por aplicação, com o nome atual da entidade. */
export const qAplicacoesAgregado = (janela: string, t?: Trecho) => `${fonteAgregados(janela, ["nav"], true, t)}
| summarize navegacoes = sum(n), entidade = arrayFirst(arrayRemoveNulls(collectDistinct(entidade))), by:{app}
| fieldsAdd nome = coalesce(${nomeAplicacao("entidade")}, app)
| fields dt.rum.application.id = app, nome, entidade, navegacoes, sessoes = 0
| sort navegacoes desc
| limit 200`;
/** BAS-02 (era qArestasMetrica): ligações página -> página e entradas (origem vazia). */
export const qArestasAgregado = (app: string, janela: string, robos: boolean, quadros: boolean, limite: number, t?: Trecho) => `${fonteAgregados(janela, ["nav"], true, t)}
| filter true${fApp(app)}${fRobos(robos)}${fQuadros(quadros)}
| summarize n = sum(n), by:{app, de = origem, para = pagina, tipo = navegacao}
| fieldsAdd sessoes = 0
| sort n desc
| limit ${limite}`;
/** BAS-10 pelas fatias (1.46.1, grupo orig): a mesma contagem de qOrigensRecuperadas (lib/queries.ts), sem ler as navegações
    da cópia do período. A linha "cobertura" diz quantas fatias da janela são de antes do grupo (sem vo nem versao 8;
    antigas > 0: o app lê a cópia, como antes; some 24 h depois da troca para o período de 24 h). Sem o filtro de frames: a contagem traz
    `quadro` e o app decide, como na leitura da cópia. */
export const qOrigensAgregado = (app: string, janela: string, robos: boolean, t?: Trecho) => {
  // as fatias guardadas que a leitura usa (o trecho ao vivo, quando houver, vem da cópia e está sempre completo)
  const tr = t ?? (minutos(janela) != null ? trechosAoVivo(janela) : null);
  const { ini, fim } = tr ? { ini: tr.iniFatias, fim: Math.max(tr.fimFatias, tr.iniFatias + 1) } : intervaloAgregados(janela);
  return `${fonteAgregados(janela, ["orig"], true, t)}
| filter origem != pagina${fApp(app)}${fRobos(robos)}
| summarize n = sum(n), by:{app, de = origem, para = pagina, tipo = navegacao, quadro = coalesce(aba == "duplicated", false)}
| limit 4000
| append [fetch bizevents, from: ${deAte(ini, fim)}, bucket: {"${BUCKET_AGREGADOS}"}
  | filter k == "fatia"
  | summarize fatias = count(), antigas = countIf(isNull(vo) and (isNull(versao) or toLong(versao) < 8))
  | fieldsAdd linha = "cobertura"]`;
};
/** BAS-04 (era qErrosPorViewMetrica): erros próprios por página, por tipo. */
export const qErrosPorViewAgregado = (app: string, janela: string, robos: boolean, t?: Trecho) => `${fonteAgregados(janela, ["erro"], true, t)}
| filter ${SO_PROPRIO}${fApp(app)}${fRobos(robos)}
| summarize excecoes = sum(if(etipo == "exception", n, else: 0)), falhas = sum(if(etipo == "request", n, else: 0)), outros = sum(if(isNull(etipo) or (etipo != "exception" and etipo != "request"), n, else: 0)), by:{app, view = pagina}
| fieldsAdd erros = excecoes + falhas + outros
| limit 4000`;
/** BAS-03 (era qViewsMetrica): views por página e tempo médio em 1º plano (soma / medições, em ms). A soma e as medições
    ficam no resultado: lib/aovivo.ts soma a cabeça e a cauda e refaz o tempo médio. */
export const qViewsAgregado = (app: string, janela: string, robos: boolean, t?: Trecho) => `${fonteAgregados(janela, ["view"], true, t)}
| filter true${fApp(app)}${fRobos(robos)}
| summarize views = sum(n), soma = sum(soma), medidos = sum(medidos), by:{app, view = pagina}
| fieldsAdd tempo_ms = if(medidos > 0, soma / medidos / 1000000.0), sessoes = 0
| limit 4000`;
/** PAG-03 (era qCliquesMetrica): cliques e teclas da página por elemento. */
export const qCliquesAgregado = (app: string, janela: string, robos: boolean, view: string, so?: Trecho) => `${fonteAgregados(janela, ["clique"], true, so)}
| filter app == "${aspas(app)}" and pagina == "${aspas(view)}"${fRobos(robos)}
| summarize n = sum(n), by:{tipo = itipo, elemento, tag}
| fieldsAdd sessoes = 0
| sort n desc
| limit 25`;
/** Apdex web pela página da carga (era o append de rum_flow.web_apdex em qApdex): soma das notas e cargas medidas. */
export const qApdexCargaAgregado = (nomes: string[] | null, janela: string, t?: Trecho) => `${fonteAgregados(janela, ["carga"], true, t)}${nomes ? `\n| filter in(frontend, ${lista(nomes)})` : ""}
| summarize soma = sum(soma), medidos = sum(n), by:{frontend.name = frontend, view.name = carga}
| fieldsAdd apdex = if(medidos > 0, soma / medidos, else: 0.0)
| fieldsAdd tipo = "carga", perda = medidos - soma
| sort perda desc, apdex asc
| limit 200`;
/** Intervalo das séries que saem dos agregados: nunca abaixo da fatia. */
export const intervaloSerieAgregado = (intervalo: string | undefined) => {
  const m = intervalo ? minutos(intervalo) : null;
  return m == null || m < FATIA_MIN ? `${FATIA_MIN}m` : intervalo!;
};
/** APX-03 (era rum_flow.mobile_apdex): as linhas base, item, serie e escopo7d com as colunas de antes; a abertura (métrica
    nativa) entra por fora. `so` = filtro de sistema do segmento. Base e item saem de UMA leitura ao vivo (cabeça + fatias +
    cauda; duas leituras ao vivo passariam do limite de expressões do DQL por causa das regras do Apdex mobile); a série
    (faixas de pelo menos 5 min), só das fatias guardadas. O escopo de 7 dias saiu daqui (1.42): ele relia o bucket de
    agregados inteiro de 7 dias a cada carga (muitos GB num ambiente grande) e só serve quando não há medição no período
    (qApdexMobileEscopo7d, lido só então, com validade de 1 hora). */
export const qApdexMobileAgregado = (apps: string[], janela: string, so: string | null, intervalo: string | undefined, t?: Trecho) => {
  const f = `
| filter in(app, ${lista(apps)})${so ? ` and sistema == "${aspas(so)}"` : ""}`;
  const { ini, fim } = intervaloAgregados(janela);
  return `${fonteAgregados(janela, ["amob"], true, t)}${f}
| fieldsAdd linha = array("base", "item")
| expand linha
| summarize { n = sum(n), sat = sum(if(faixa == "satisfeito", n, else: 0)), tol = sum(if(faixa == "tolerante", n, else: 0)),
              erro = sum(if(faixa == "frustrado_erro", n, else: 0)), lento = sum(if(faixa == "frustrado_tempo", n, else: 0)) },
    by:{linha, app, item, frontend = if(linha == "base", frontend), sistema = if(linha == "base", sistema), faixa = if(linha == "base", faixa),
        view = if(linha == "item", pagina), acao = if(linha == "item", acao), tipoAbertura = if(linha == "item", abertura)}
| fieldsAdd perda = if(linha == "item", n - sat - tol / 2)
| sort linha asc, perda desc, n desc
| limit 1000
| append [${fonteAgregados(janela, ["amob"], false)}${f}
  | makeTimeseries serie = sum(n), by:{app, item, faixa}, interval: ${intervaloSerieAgregado(intervalo)}, time: timestamp, from: "${iso(ini)}", to: "${iso(fim)}"
  | fieldsAdd linha = "serie"]`;
};
/** APX-03, linha "escopo7d": medições das aplicações em 7 dias (separa "sem medição agora" de "a regra não grava nada"). */
export const qApdexMobileEscopo7d = (apps: string[], so: string | null) => `${fonteAgregados("7d", ["amob"], false)}
| filter in(app, ${lista(apps)})${so ? ` and sistema == "${aspas(so)}"` : ""}
| summarize n = sum(n)
| fieldsAdd linha = "escopo7d"`;
/** Os exemplos gravados (JSON de cada fatia, e as listas de texto de antes): os 3 mais recentes saem no navegador (exemplosDe). */
const amostrasDql = () => "amostras_j = collectArray(amostras_j), amostra_t = collectArray(amostra_t), amostra_s = collectArray(amostra_s)";
/** ERR-01 (1.43, era INI-04 na cópia): os erros da própria aplicação como o cliente sentiu, AO VIVO pelos agregados errx:
    ocorrências, páginas onde aconteceram, último instante e até 3 traces e 3 sessões de exemplo. Sem "sessões afetadas"
    (não se soma fatia a fatia): a ordem é pelas ocorrências. */
export const qErrosClienteAgregado = (app: string, janela: string, robos: boolean, t?: Trecho) => `${fonteAgregados(janela, ["errx"], true, t)}
| filter ${SO_PROPRIO}${fApp(app)}${fRobos(robos)}
| summarize n = sum(n), paginas = collectDistinct(pagina, maxLength: 50), ultimo = max(ultimo), ${amostrasDql()},
    by:{app, tipo = etipo, status, caminho, dominio, msg}
| sort n desc
| limit 300`;
/** PAG-03 (1.43, era a cópia sob demanda): os erros de uma página, AO VIVO pelos agregados errx, com o nome como o painel
    mostra, as chamadas que falharam (endpoint e status) e até 3 traces e 3 sessões de exemplo de cada. */
/** view: a página, ou a página e os frames que só existem dentro dela (1.45.8: os erros deles contam na página). */
export const qErrosPaginaAgregado = (app: string, view: string | string[], janela: string, robos: boolean, t?: Trecho) => `${fonteAgregados(janela, ["errx"], true, t)}
| filter app == "${aspas(app)}" and ${Array.isArray(view) && view.length > 1 ? `in(pagina, array(${view.map((v) => `"${aspas(v)}"`).join(", ")}))` : `pagina == "${aspas(Array.isArray(view) ? view[0] : view)}"`}${fRobos(robos)}
| summarize n = sum(n), ultimo = max(ultimo), ${amostrasDql()},
    by:{tipo = etipo, msg, status, caminho, dominio, excecao_tipo = excecao, terceiro = isNotNull(provedor) and provedor == "third_party" and not(contains(app, "-"))}
| fieldsAdd nome = if(isNotNull(msg) and msg != "", msg, else: concat(coalesce(toString(status), "?"), ": ", coalesce(dominio, ""), coalesce(caminho, "")))
| sort n desc
| limit 100`;
/** INI-05 (1.43, era a cópia): erros próprios por página ao longo do período, das fatias guardadas do trecho (faixas de pelo
    menos 5 min); a cabeça e a cauda entram no navegador (lib/aovivo.ts, serieDoTrecho). */
export const qSerieErrosAgregado = (app: string, janela: string, robos: boolean, intervalo: string | undefined, so: Trecho) => `${fonteAgregados(janela, ["erro"], true, so)}
| filter ${SO_PROPRIO}${fApp(app)}${fRobos(robos)}
| makeTimeseries n = sum(n), by:{app, view = pagina}, interval: ${intervaloSerieAgregado(intervalo)}, time: timestamp, from: "${iso(so.ini)}", to: "${iso(so.fim)}"
| limit 5000`;
/** PAG-05 (1.43.6, era a cópia sob demanda): tempo de carga da página no período (navegações com duração): quantidade, soma
    (ms) e faixas; média e p75 no navegador. */
export const qCargaPaginaAgregado = (app: string, view: string, janela: string, robos: boolean, t?: Trecho) => `${fonteAgregados(janela, ["tcar"], true, t)}
| filter app == "${aspas(app)}" and pagina == "${aspas(view)}"${fRobos(robos)}
| summarize n = sum(n), soma = sum(soma), by:{ft}`;
/** APX-04 (era rum_flow.web_apdex_lugar + mobile_apdex_lugar): contagem por canal, aplicação, lugar e faixa. */
export const qApdexLugaresAgregado = (apps: string[], janela: string, t?: Trecho) => `${fonteAgregados(janela, ["lugar"], true, t)}
| filter in(app, ${lista(apps)})
| summarize n = sum(n), by:{canal, app, pais, regiao, faixa}
| filter n > 0
| limit 3000`;
