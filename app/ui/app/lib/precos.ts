/* Preço de lista público da Dynatrace e câmbio padrão (1.44.6), sem SDK: usados pelo cartão "Consumo do app", pela coleta
   da análise por LLM (custo das leituras) e pelos testes. O preço do contrato de cada cliente nunca fica no código: o
   administrador digita no cartão (lib/consumo.ts, App State). */
export type ParteConsumo = "consulta" | "gravacao" | "retencao" | "funcao";
/** Rate card da Dynatrace (US$; conferido em dynatrace.com/pricing/rate-card em 20/10/2026): Events/Traces/Logs - Query
    US$ 0,0035 por GiB lido; Events - Ingest & Process US$ 0,20 por GiB; Events - Retain US$ 0,0007 por GiB-dia;
    AppEngine Functions US$ 0,001 por execução (US$ 1 por mil). */
export const PRECO_LISTA_USD: Record<ParteConsumo, number> = { consulta: 0.0035, gravacao: 0.2, retencao: 0.0007, funcao: 1 };
/** Câmbio padrão (R$ por US$): PTAX de venda do Banco Central de 19/10/2026 (5,0564), editável no cartão. */
export const CAMBIO_PADRAO = 5.06;
/** A moeda da tela (1.47.7): reais em português, dólar em inglês, que é a moeda do preço de lista da Dynatrace (sem
    câmbio). O idioma vem de globalThis.__DEF_IDIOMA (lib/i18n.ts), sem import de valor. */
export type Moeda = "BRL" | "USD";
export const moedaDaTela = (): Moeda => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "USD" : "BRL");
/** Preço de lista na moeda pedida (padrão: a da tela); em reais, pelo câmbio. */
export const precoDeLista = (p: ParteConsumo, cambio: number | null, moeda: Moeda = moedaDaTela()) => PRECO_LISTA_USD[p] * (moeda === "USD" ? 1 : cambio ?? CAMBIO_PADRAO);
/** Um valor de uma moeda para a outra, pelo câmbio (R$ por US$). */
export const converterMoeda = (v: number, de: Moeda, para: Moeda, cambio: number | null) => (de === para ? v : de === "USD" ? v * (cambio ?? CAMBIO_PADRAO) : v / (cambio ?? CAMBIO_PADRAO));
export const simboloMoeda = (moeda: Moeda = moedaDaTela()) => (moeda === "USD" ? "US$" : "R$");
/** Dinheiro na moeda da tela; abaixo de 1 centavo, com 4 casas (o valor de verdade, não "menos de"). */
export function formatarDinheiro(v: number | null | undefined, moeda: Moeda = moedaDaTela()): string {
  if (v == null || !isFinite(v)) return "";
  const loc = moeda === "USD" ? "en-US" : "pt-BR";
  if (v > 0 && v < 0.00005) return `< ${simboloMoeda(moeda)}\u00a0${(0.0001).toLocaleString(loc, { minimumFractionDigits: 4 })}`;
  const casas = v > 0 && v < 0.01 ? 4 : 2;
  return `${simboloMoeda(moeda)}\u00a0${v.toLocaleString(loc, { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}
