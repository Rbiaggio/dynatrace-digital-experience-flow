/* Validação da moeda (1.47.7), sem tenant: a moeda segue a língua da tela (reais em português, pelo câmbio; dólar em
   inglês, o preço de lista da Dynatrace sem câmbio), os preços do contrato guardados numa moeda aparecem convertidos na
   outra (os de antes da 1.47.7, sem moeda, são reais) e a calculadora de custos em inglês não mostra reais.
   Roda com: npx esbuild ui/testes/validar_moeda.tsx --bundle --platform=node --format=cjs --jsx=automatic --outfile=<saida>.cjs && node <saida>.cjs */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PRECO_LISTA_USD, CAMBIO_PADRAO, precoDeLista, formatarDinheiro, moedaDaTela, converterMoeda } from "../app/lib/precos";
import { precosEfetivos, contratoNaMoeda, type ConfigPrecos } from "../app/lib/consumo";
import { tarifasLista, TARIFAS_LISTA } from "../app/lib/custos";
import { DocCustos } from "../app/components/docs/DocCustos";

let falhas = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK " : "FALHA"} ${msg}`); if (!c) falhas++; };
const perto = (a: number, b: number) => Math.abs(a - b) < 1e-12;
const idioma = (i: "pt" | "en") => { (globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA = i; };
(globalThis as { __DEF_DOC_TUDO?: boolean }).__DEF_DOC_TUDO = true;   // todas as seções da documentação (na tela são abinhas)

idioma("pt");
ok(moedaDaTela() === "BRL", "português: reais");
ok(perto(precoDeLista("consulta", null), PRECO_LISTA_USD.consulta * CAMBIO_PADRAO), "preço de lista em reais pelo câmbio de referência");
ok(formatarDinheiro(0.02) === "R$ 0,02" && formatarDinheiro(0.0012) === "R$ 0,0012", `formato em reais (espaço inseparável): ${formatarDinheiro(0.02)}, ${formatarDinheiro(0.0012)}`);
idioma("en");
ok(moedaDaTela() === "USD", "inglês: dólar");
ok(perto(precoDeLista("consulta", 5.5), PRECO_LISTA_USD.consulta), "preço de lista em dólar, sem câmbio");
ok(formatarDinheiro(0.02) === "US$ 0.02" && formatarDinheiro(0.00001) === "< US$ 0.0001", `formato em dólar: ${formatarDinheiro(0.02)}, ${formatarDinheiro(0.00001)}`);

const antigo: ConfigPrecos = { contrato: { consulta: 0.02, gravacao: null, retencao: null, funcao: null }, cambio: 5 };   // de antes da 1.47.7: reais
ok(perto(precosEfetivos(antigo, "USD").consulta, 0.02 / 5), "contrato de antes (reais) em inglês: convertido pelo câmbio guardado");
ok(perto(precosEfetivos(antigo, "USD").gravacao, PRECO_LISTA_USD.gravacao), "linha sem contrato em inglês: preço de lista em dólar");
ok(perto(precosEfetivos(antigo, "BRL").consulta, 0.02), "o mesmo contrato em português: como foi digitado");
const emDolar: ConfigPrecos = { contrato: { consulta: 0.003, gravacao: null, retencao: null, funcao: null }, cambio: null, moeda: "USD" };
ok(perto(precosEfetivos(emDolar, "BRL").consulta, 0.003 * CAMBIO_PADRAO), "contrato digitado em dólar, visto em português: convertido pelo câmbio de referência");
ok(contratoNaMoeda(emDolar, "USD").consulta === 0.003 && contratoNaMoeda(emDolar, "BRL").gravacao === null, "edição abre o contrato na moeda da tela");
ok(perto(contratoNaMoeda(emDolar, "BRL").consulta!, Number((0.003 * CAMBIO_PADRAO).toPrecision(6))) && perto(contratoNaMoeda(antigo, "USD").consulta!, Number((0.02 / 5).toPrecision(6))),
  "edição na outra moeda: o contrato abre convertido pelo câmbio");
ok(perto(converterMoeda(converterMoeda(1, "BRL", "USD", 5.1), "USD", "BRL", 5.1), 1), "ida e volta entre as moedas");

ok(tarifasLista("USD").moeda === "US$" && perto(tarifasLista("USD").consultaPorGib, PRECO_LISTA_USD.consulta), "calculadora em inglês: tarifas de lista em dólar");
ok(TARIFAS_LISTA.moeda === "R$", "TARIFAS_LISTA (referência dos testes de custo) continua em reais");
const html = renderToStaticMarkup(<DocCustos />);
ok(html.includes("US$") && !html.includes("R$"), "a aba Custos em inglês mostra dólar e nenhum R$");
idioma("pt");
const htmlPt = renderToStaticMarkup(<DocCustos />);
ok(htmlPt.includes("R$"), "a aba Custos em português mostra reais");

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
