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
export const precoDeLista = (p: ParteConsumo, cambio: number | null) => PRECO_LISTA_USD[p] * (cambio ?? CAMBIO_PADRAO);
