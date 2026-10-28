/* Execução de DQL a partir da UI, com as credenciais do usuário logado. As consultas ficam em queries.ts. */
import { queryExecutionClient } from "@dynatrace-sdk/client-query";

export * from "./queries";

export type Linha = Record<string, unknown>;

/** Quem pediu a consulta. Vai no cabeçalho dt-client-context como "def/<funcionalidade>/<id>" (id = o da consulta no
    lista de consultas: BAS-02, PAG-01...) e aparece em dt.system.query_executions (client.client_context): dá para
    somar o que cada funcionalidade lê no Grail. Não leva dado de negócio (nome de página, filtro, usuário). */
export type Funcionalidade = "prereq" | "filtros" | "base" | "inicio" | "apdex" | "funil" | "painel" | "isolar" | "porque"
  | "sessoes" | "ondefalha" | "backend" | "qualidade" | "config" | "ia" | "llm";
export type Contexto = `${Funcionalidade}/${string}`;
/** aoGrail: recebe o metadado do Grail de cada consulta (bytes e registros lidos): a coleta da análise por LLM
    (lib/dossie.ts) mede a leitura consulta a consulta e corta pelo orçamento. */
export interface OpcoesDql { contexto: Contexto; maxRecords?: number; aoGrail?: (g: { scannedBytes: number | null; scannedRecords: number | null }) => void }

/** Consumo desta aba (memória, só para depuração: no console, __defConsumo): consultas e bytes lidos (scannedBytes do
    Grail) por funcionalidade e por consulta. Consulta de métrica sai com 0 bytes. */
export interface Consumo { consultas: number; falhas: number; scannedBytes: number; scannedRecords: number; semMetadado: number }
const consumo = { porFuncionalidade: {} as Record<string, Consumo>, porConsulta: {} as Record<string, Consumo> };
export const consumoDql = () => consumo;
try { (globalThis as unknown as { __defConsumo?: typeof consumo }).__defConsumo = consumo; } catch { /* sem globalThis */ }
const novoConsumo = (): Consumo => ({ consultas: 0, falhas: 0, scannedBytes: 0, scannedRecords: 0, semMetadado: 0 });
function registrar(contexto: Contexto, grail: { scannedBytes?: number; scannedRecords?: number } | undefined, falhou: boolean) {
  const f = contexto.split("/")[0];
  for (const c of [(consumo.porFuncionalidade[f] ??= novoConsumo()), (consumo.porConsulta[contexto] ??= novoConsumo())]) {
    c.consultas++;
    if (falhou) { c.falhas++; continue; }
    if (grail?.scannedBytes == null) c.semMetadado++;
    c.scannedBytes += Number(grail?.scannedBytes ?? 0);
    c.scannedRecords += Number(grail?.scannedRecords ?? 0);
  }
}

/* Varredura da cópia por janela (guarda das consultas juntadas, lib/juntas.ts): o scannedBytes da última consulta desta aba
   que varreu a cópia UMA vez na janela (fetch da cópia sem join nem append), por janela relativa ("10m", "30m", "2h"...) e
   pelos buckets que ela leu (etapa 6: cada consulta lê só os buckets que o filtro dela pode precisar). A guarda estima
   cada consulta juntada pelos buckets dela (estimarVarreduraDe); estimarVarredura é a maior entre os conjuntos medidos
   na janela. Fica também no navegador, para a primeira leitura da próxima abertura. Janela sem medida: a estimativa pelas
   outras, proporcional ao tempo (superestimar só faz a guarda separar antes). A verificação da cópia (sort timestamp desc
   e limit 1, que para no primeiro bloco com registro) não conta. */
const varreduras = new Map<string, number>();
const K_VARREDURAS = "def.varreduras-copia";   // as entradas de antes ("30m": a cópia inteira) continuam valendo: maiores, mais conservadoras
let varredurasLidas = false;
const minutosJanela = (j: string) => { const m = /^(\d+)([smhd])$/.exec(j); return m ? +m[1] * ({ s: 1 / 60, m: 1, h: 60, d: 1440 } as Record<string, number>)[m[2]] : null; };
const RE_VARREDURA = /^fetch bizevents, from: now\(\)-(\d+[smhd]), bucket: \{([^}]*)\}(?:\n|$)/;
function lerVarreduras() {
  if (varredurasLidas) return;
  varredurasLidas = true;
  try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(K_VARREDURAS) ?? "{}") as Record<string, number>)) if (!varreduras.has(k) && typeof v === "number") varreduras.set(k, v); } catch { /* sem armazenamento */ }
}
function aprenderVarredura(query: string, bytes: unknown) {
  const b = Number(bytes);
  const m = RE_VARREDURA.exec(query);
  if (!m || !(b > 0) || /\bjoin \[|\bappend \[|\n\| sort timestamp desc\n\| limit \d+/.test(query)) return;
  lerVarreduras();
  varreduras.set(`${m[1]}|${m[2].split(",").map((x) => x.trim()).sort().join(",")}`, b);
  try { localStorage.setItem(K_VARREDURAS, JSON.stringify(Object.fromEntries(varreduras))); } catch { /* sem armazenamento */ }
}
/** Bytes estimados de uma varredura da cópia na janela, pela MAIOR medida dela (null = nada medido ainda nem janela
    relativa). Sem os buckets da consulta; as consultas juntadas usam estimarVarreduraDe (pelos buckets de cada uma). */
export function estimarVarredura(janela: string): number | null {
  lerVarreduras();
  const daJanela = (j: string) => [...varreduras].filter(([k]) => k.split("|")[0] === j).map(([, b]) => b);
  const v = daJanela(janela);
  if (v.length) return Math.max(...v);
  const m = minutosJanela(janela);
  if (m == null) return null;
  let est: number | null = null;
  for (const [k, b] of varreduras) { const mj = minutosJanela(k.split("|")[0]); if (mj) est = Math.max(est ?? 0, (b * m) / mj); }
  return est;
}

/** Bytes estimados de UMA varredura da cópia com a janela e os buckets que o texto da consulta lê (o fetch do começo do
    texto): a guarda das consultas juntadas (lib/juntas.ts) decide consulta a consulta, e não pela maior varredura da
    janela (a dos 3 buckets, que a qualidade lê a cada Visão geral, desligava cedo demais as que leem menos buckets: no
    ambiente grande a janela de 6 h dos 3 buckets lê mais que o dobro da de navegação + erro). Ordem, da mais certa para a mais
    conservadora: a medida desses mesmos buckets na janela; a soma das medidas de cada bucket sozinho, quando todos foram
    medidos na janela; a menor medida de um conjunto que contém esses buckets (lê mais: superestima); o mesmo nas outras
    janelas, proporcional ao tempo; sem nada disso, a estimativa de antes (a maior varredura da janela). Texto que não lê
    a cópia (user.events) ou sem janela relativa: a estimativa de antes. */
export function estimarVarreduraDe(query: string): number | null {
  const m = RE_VARREDURA.exec(query);
  if (!m) { const j = /^fetch \w[\w.]*, from: now\(\)-(\d+[smhd])/.exec(query); return j ? estimarVarredura(j[1]) : null; }
  lerVarreduras();
  const janela = m[1], buckets = m[2].split(",").map((x) => x.trim()).filter(Boolean).sort();
  const medidas = [...varreduras].map(([k, b]) => { const [j, bs] = k.split("|"); return { j, bs: (bs ?? "").split(",").filter(Boolean), b }; });
  const naJanela = (j: string): number | null => {
    const daJ = medidas.filter((x) => x.j === j);
    const igual = daJ.find((x) => x.bs.length === buckets.length && x.bs.every((b, i) => b === buckets[i]));
    if (igual) return igual.b;
    const sozinhos = buckets.map((b) => daJ.find((x) => x.bs.length === 1 && x.bs[0] === b)?.b);
    if (sozinhos.every((x) => x != null)) return sozinhos.reduce((s: number, x) => s + x!, 0);
    const maiores = daJ.filter((x) => buckets.every((b) => x.bs.includes(b))).map((x) => x.b);
    return maiores.length ? Math.min(...maiores) : null;
  };
  const daJanela = naJanela(janela);
  if (daJanela != null) return daJanela;
  const min = minutosJanela(janela);
  let est: number | null = null;
  if (min != null) for (const j of new Set(medidas.map((x) => x.j)).values()) {
    const mj = minutosJanela(j), b = j === janela ? null : naJanela(j);
    if (mj && b != null) est = Math.max(est ?? 0, (b * min) / mj);
  }
  return est ?? estimarVarredura(janela);
}

/** Mensagem útil a partir do erro do SDK: tipo de erro do Grail, escopos que faltam, status HTTP. */
function descreverErro(e: unknown): string {
  const err = e as { message?: string; body?: { error?: { message?: string; details?: { errorType?: string; errorMessage?: string; missingScopes?: string[] } } }; response?: { status?: number } };
  const d = err?.body?.error?.details;
  const partes = [
    d?.errorType ?? err?.body?.error?.message ?? err?.message ?? String(e),
    d?.errorMessage && d.errorMessage !== d.errorType ? d.errorMessage : "",
    d?.missingScopes?.length ? `missing scopes: ${d.missingScopes.join(", ")}` : "",
    err?.response?.status ? `HTTP ${err.response.status}` : "",
  ].filter(Boolean);
  return partes.join(" · ");
}

export async function dql<T extends Linha = Linha>(query: string, opcoes: OpcoesDql): Promise<T[]> {
  const { contexto, maxRecords = 1000 } = opcoes;
  const dtClientContext = `def/${contexto}`;
  let inicio;
  try {
    inicio = await queryExecutionClient.queryExecute({
      body: { query, requestTimeoutMilliseconds: 60000, maxResultRecords: maxRecords },
      dtClientContext,
    });
  } catch (e) {
    registrar(contexto, undefined, true);
    console.error("[RUM Flow] query:execute falhou", e, "\n", query);
    throw new Error(`execute: ${descreverErro(e)}`);
  }
  let result = inicio.result;
  const token = inicio.requestToken;
  let estado: string | undefined = inicio.state;
  while (!result && token) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000, dtClientContext });
      estado = poll.state;
      result = poll.result;
    } catch (e) {
      registrar(contexto, undefined, true);
      console.error("[RUM Flow] query:poll falhou", e, "\n", query);
      throw new Error(`poll: ${descreverErro(e)}`);
    }
    if (!result && estado !== "RUNNING" && estado !== "NOT_STARTED") { registrar(contexto, undefined, true); throw new Error(`consulta terminou em ${estado}`); }
  }
  registrar(contexto, result?.metadata?.grail, false);
  aprenderVarredura(query, result?.metadata?.grail?.scannedBytes);
  if (opcoes.aoGrail) {
    const g = result?.metadata?.grail;
    try { opcoes.aoGrail({ scannedBytes: g?.scannedBytes == null ? null : Number(g.scannedBytes), scannedRecords: g?.scannedRecords == null ? null : Number(g.scannedRecords) }); } catch { /* só a medida */ }
  }
  return ((result?.records ?? []) as unknown[]).filter(Boolean) as T[];
}

/** Grail devolve inteiros longos como texto; converte com segurança. */
export const num = (v: unknown): number => (v == null || v === "" ? 0 : Number(v));
export const texto = (v: unknown): string | null => (v == null ? null : String(v));
