/* Consumo do app pela cobrança da própria Dynatrace (1.44.3), para o cartão "Consumo do app" da Configuração. Fonte:
   dt.system.events, event.kind BILLING_USAGE_EVENT (escopo storage:system:read; a leitura é de poucos MB):
   - consultas: todo evento "<capacidade> - Query" com client.application_context = id do app (a tela e a ação dos
     workflows); client.client_context = "def/<funcionalidade>/<id>" dá o detalhe por funcionalidade;
   - gravação: "Events - Ingest & Process" nos buckets do DEF (os workflows gravam agregados, erros e horas; a cópia das
     sessões que o OpenPipeline extrai não aparece como gravação na cobrança);
   - retenção: "Events - Retain" nos buckets do DEF, um retrato por hora do volume guardado (GiB-dia = soma dos retratos / 24);
   - funções: "AppEngine Functions - *" com function.id do app (billed_invocations);
   - os três workflows são simples: não geram evento de cobrança.
   Em reais pelo preço de lista público da Dynatrace (US$, convertido pelo câmbio) até o administrador digitar os preços do
   contrato (App State; o preço do contrato de cada cliente não fica no código). A cobrança das consultas chega em segundos; a da gravação, em janelas de 15 minutos; a da retenção, de hora em hora. */
import { stateClient } from "@dynatrace-sdk/client-state";
import { BUCKETS_PASSOS, BUCKET_AGREGADOS, BUCKET_ERROS, BUCKET_HORAS } from "./prerequisitos";

import { CAMBIO_PADRAO, PRECO_LISTA_USD, precoDeLista, converterMoeda, moedaDaTela, type Moeda, type ParteConsumo } from "./precos";
export { CAMBIO_PADRAO, PRECO_LISTA_USD, precoDeLista, type ParteConsumo };
export const PARTES_CONSUMO: ParteConsumo[] = ["consulta", "gravacao", "retencao", "funcao"];
/** Preço de cada parte em R$ na unidade da tabela de preços: GiB lido, GiB gravado, GiB-dia guardado, mil execuções. */
export type Precos = Record<ParteConsumo, number | null>;
export const PRECOS_VAZIOS: Precos = { consulta: null, gravacao: null, retencao: null, funcao: null };
/** O que fica no App State: os preços do contrato (null = usa o de lista), o câmbio e (1.47.7) a moeda em que os preços
    do contrato foram digitados (sem ela, reais, como até a 1.47.6). */
export interface ConfigPrecos { contrato: Precos; cambio: number | null; moeda?: Moeda }
export const CONFIG_PRECOS_VAZIA: ConfigPrecos = { contrato: { ...PRECOS_VAZIOS }, cambio: null };
/** O preço usado em cada parte, na moeda pedida (padrão: a da tela): o do contrato, se digitado (convertido se foi
    digitado na outra moeda); senão o de lista. */
export const precosEfetivos = (c: ConfigPrecos, moeda: Moeda = moedaDaTela()): Record<ParteConsumo, number> =>
  Object.fromEntries(PARTES_CONSUMO.map((p) => [p, c.contrato[p] != null ? converterMoeda(c.contrato[p]!, c.moeda ?? "BRL", moeda, c.cambio) : precoDeLista(p, c.cambio, moeda)])) as Record<ParteConsumo, number>;
/** Os preços do contrato na moeda pedida (para editar na tela). */
export const contratoNaMoeda = (c: ConfigPrecos, moeda: Moeda = moedaDaTela()): Precos =>
  Object.fromEntries(PARTES_CONSUMO.map((p) => [p, c.contrato[p] == null ? null : Number(converterMoeda(c.contrato[p]!, c.moeda ?? "BRL", moeda, c.cambio).toPrecision(6))])) as Precos;
/** As partes que estão no preço de lista (sem preço do contrato). */
export const partesNaLista = (c: ConfigPrecos) => PARTES_CONSUMO.filter((p) => c.contrato[p] == null);
const CHAVE_PRECOS = "rum-flow.precos.v1";
const GIB = 1024 ** 3;
export const BUCKETS_DO_DEF = [...Object.values(BUCKETS_PASSOS), BUCKET_AGREGADOS, BUCKET_ERROS, BUCKET_HORAS];

const filtroDoApp = (app: string) => `filter event.kind == "BILLING_USAGE_EVENT"
| filter (endsWith(event.type, " - Query") and client.application_context == "${app}")
    or (in(event.type, array("Events - Ingest & Process", "Events - Retain")) and in(usage.bucket, array(${BUCKETS_DO_DEF.map((b) => `"${b}"`).join(", ")})))
    or (startsWith(event.type, "AppEngine Functions") and startsWith(function.id, "${app}."))
| fieldsAdd parte = if(endsWith(event.type, " - Query"), "consulta", else: if(event.type == "Events - Ingest & Process", "gravacao", else: if(event.type == "Events - Retain", "retencao", else: "funcao")))`;

/** Por hora e parte, desde `de`: bytes cobrados (consulta, gravação), soma dos retratos (retenção) e execuções (funções). */
export const qConsumoPorHora = (app: string, de: number) => `fetch dt.system.events, from: "${new Date(de).toISOString()}"
| ${filtroDoApp(app)}
| summarize bytes = sum(toDouble(billed_bytes)), execucoes = sum(toDouble(billed_invocations)), primeiro = min(timestamp), ultimo = max(timestamp), by:{parte, hora = bin(timestamp, 1h)}`;

/** Consultas das últimas 24 horas por funcionalidade (o segundo pedaço de client.client_context). */
export const qConsumoPorFuncionalidade = (app: string, de: number) => `fetch dt.system.events, from: "${new Date(de).toISOString()}"
| ${filtroDoApp(app)}
| filter parte == "consulta"
| fieldsAdd funcionalidade = coalesce(splitString(client.client_context, "/")[1], "outras")
| summarize bytes = sum(toDouble(billed_bytes)), consultas = countDistinct(query_id), by:{funcionalidade}
| sort bytes desc`;

export interface LinhaConsumoHora { parte: string; hora: string; bytes: number; execucoes: number; primeiro: string | null; ultimo?: string | null }
/** Horas de cobrança de uma parte antes de projetar 30 dias pelo ritmo dela. */
export const HORAS_PARA_PROJETAR = 24;
/** Quantidade de cada parte na unidade do preço: GiB (consulta, gravação), GiB-dia (retenção), mil execuções (funções). */
export type Quantidades = Record<ParteConsumo, number>;
const zeradas = (): Quantidades => ({ consulta: 0, gravacao: 0, retencao: 0, funcao: 0 });
const quantidadeDe = (l: LinhaConsumoHora): number =>
  l.parte === "funcao" ? l.execucoes / 1000 : l.parte === "retencao" ? l.bytes / GIB / 24 : l.bytes / GIB;

export interface ResumoConsumo {
  hoje: Quantidades;
  /** desde o início da leitura (até 7 dias) */
  periodo: Quantidades;
  /** horas com cobrança de cada parte, desde o primeiro evento dela (no máximo 7 dias): a base da projeção */
  horas: Quantidades;
  /** projeção de 30 dias pelo ritmo de cada parte nas horas observadas (na retenção, o volume médio guardado × 30 dias);
      null na parte com menos de HORAS_PARA_PROJETAR (uma hora de teste não vira um mês) */
  mes: Record<ParteConsumo, number | null>;
  /** o evento de cobrança mais recente */
  ultimo: number | null;
}
/** Junta as linhas por hora em hoje (desde a meia-noite local), período e projeção de 30 dias pelo ritmo observado de cada
    parte (as consultas e as funções contam desde o primeiro evento do app; a gravação e a retenção, dos buckets). */
export function resumirConsumo(linhas: LinhaConsumoHora[], agora: number, meiaNoite: number): ResumoConsumo {
  const hoje = zeradas(), periodo = zeradas(), horas = zeradas();
  const mes: Record<ParteConsumo, number | null> = { consulta: null, gravacao: null, retencao: null, funcao: null };
  const primeiro: Record<ParteConsumo, number> = { consulta: Infinity, gravacao: Infinity, retencao: Infinity, funcao: Infinity };
  let ultimo: number | null = null;
  for (const l of linhas) {
    const p = l.parte as ParteConsumo;
    if (!PARTES_CONSUMO.includes(p)) continue;
    const h = Date.parse(l.hora), q = quantidadeDe(l);
    periodo[p] += q;
    if (h + 3600_000 > meiaNoite) hoje[p] += h >= meiaNoite ? q : q * ((h + 3600_000 - meiaNoite) / 3600_000);
    const p0 = l.primeiro ? Date.parse(l.primeiro) : h;
    if (p0 < primeiro[p]) primeiro[p] = p0;
    const u = l.ultimo ? Date.parse(l.ultimo) : h;
    if (ultimo == null || u > ultimo) ultimo = u;
  }
  for (const p of PARTES_CONSUMO) {
    horas[p] = primeiro[p] === Infinity ? 0 : Math.max(1, (agora - primeiro[p]) / 3600_000);
    mes[p] = horas[p] === 0 ? 0 : horas[p] >= HORAS_PARA_PROJETAR ? (periodo[p] / horas[p]) * 24 * 30 : null;
  }
  return { hoje, periodo, horas, mes, ultimo };
}
/** Valor em R$ de uma quantidade (null sem preço). */
export const emReais = (q: number, preco: number | null) => (preco == null ? null : q * preco);
export const totalEmReais = (q: Record<ParteConsumo, number | null>, precos: Precos) => {
  if (PARTES_CONSUMO.some((p) => q[p] == null)) return null;
  const partes = PARTES_CONSUMO.map((p) => emReais(q[p]!, precos[p]));
  return partes.every((v) => v == null) ? null : partes.reduce<number>((s, v) => s + (v ?? 0), 0);
};

const numeroOuNull = (x: unknown) => (typeof x === "number" && isFinite(x) && x >= 0 ? x : null);
export async function lerPrecos(): Promise<ConfigPrecos> {
  try {
    const v = JSON.parse((await stateClient.getAppState({ key: CHAVE_PRECOS })).value) as { contrato?: Record<string, unknown>; cambio?: unknown; moeda?: unknown } & Record<string, unknown>;
    // 1.44.3 gravava só os preços do contrato no topo do objeto
    const contrato = v?.contrato ?? v;
    return { contrato: Object.fromEntries(PARTES_CONSUMO.map((p) => [p, numeroOuNull(contrato?.[p])])) as Precos, cambio: numeroOuNull(v?.cambio), ...(v?.moeda === "USD" || v?.moeda === "BRL" ? { moeda: v.moeda } : {}) };
  } catch { return { contrato: { ...PRECOS_VAZIOS }, cambio: null }; }
}
export async function salvarPrecos(c: ConfigPrecos): Promise<void> {
  await stateClient.setAppState({ key: CHAVE_PRECOS, body: { value: JSON.stringify(c) } });
}
/** "0,0035" ou "0.0035" → número; vazio → null. */
export const lerNumero = (s: string): number | null => {
  const x = s.trim().replace(/\s/g, "");
  if (!x) return null;
  const n = Number(x.includes(",") ? x.replace(/\./g, "").replace(",", ".") : x);
  return isFinite(n) && n >= 0 ? n : null;
};
