/* Validação do modelo de custo por volumetria (aba Documentação, sub-aba Custos), sem tenant, arquitetura da 1.43 (modelo
   por feature: erros e Apdex ao vivo, sessões da última hora, análise de hora em hora das últimas 24 h, três workflows):
   a função pura estimarCustos (lib/custos.ts) com a volumetria do laboratório reproduz a ordem de grandeza medida lá (GiB
   da cópia e da experiência por dia, linhas de agregado por dia), as fórmulas de cada parte (fatias; hora em hora com
   sessões, funis só com jornada salva, requisições e ligação com o teto de spans; última hora só nas horas de uso;
   funções dos três workflows; o que eles gravam e guardam nos buckets de agregados, de erros e de horas; retenção de 1
   dia; cargas de tela com o trecho ao vivo, as leituras pequenas e o Flow; leituras sob demanda), zero sessões e tarifa
   zero dão custo zero, o modelo é puro e sanea entradas inválidas, e a sub-aba DocCustos renderiza a calculadora com a
   tabela de resultados, com os textos da 1.43.
   Roda com: npx esbuild ui/testes/validar_custos.tsx --bundle --platform=node --format=cjs --jsx=automatic --outfile=<saida>.cjs && node <saida>.cjs
   (opcional: TERMOS_PROIBIDOS="termo1,termo2" no ambiente barra termos extras no texto renderizado). */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { estimarCustos, MODELO, TARIFAS_LISTA, VOLUMETRIA_LAB, type Tarifas, type Volumetria } from "../app/lib/custos";
import { DocCustos } from "../app/components/docs/DocCustos";

(globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA = "pt";
(globalThis as { __DEF_DOC_TUDO?: boolean }).__DEF_DOC_TUDO = true;   // todas as seções (na tela elas são abinhas)
let falhas = 0;
const ok = (cond: boolean, nome: string, detalhe = "") => { console.log(`${cond ? "OK " : "FALHA"} ${nome}${cond || !detalhe ? "" : `: ${detalhe}`}`); if (!cond) falhas++; };
const entre = (x: number, a: number, b: number) => x >= a && x <= b;
const perto = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const GIB = 2 ** 30;
const T = TARIFAS_LISTA;

console.log("== volumetria do laboratório: ordem de grandeza medida (20/10/2026)");
const lab = estimarCustos(VOLUMETRIA_LAB, T);
const c0 = lab.copia, navErro = c0.gibNavDia + c0.gibErroDia, navErroExp = navErro + c0.experienciaGibDia;
ok(perto(c0.registrosDia, 15000 * (5.75 + 4.9 + 0.33)), "registros da cópia = sessões × (navegações + chamadas + erros)", String(c0.registrosDia));
ok(entre(c0.gibDia, 0.10, 0.14), "cópia entre 0,10 e 0,14 GiB por dia", c0.gibDia.toFixed(4));
ok(entre(c0.experienciaGibDia, 0.12, 0.16), "experiência entre 0,12 e 0,16 GiB por dia", c0.experienciaGibDia.toFixed(4));
ok(perto(c0.gibDia, c0.gibNavDia + c0.gibErroDia + c0.gibReqDia), "cópia = navegação + erro + requisição");
const linhasAgregadoDia = (lab.gravado.agregadosGibDia * GIB) / MODELO.bytesPorAgregado;
ok(entre(linhasAgregadoDia, 40_000, 45_000), "linhas de agregado por dia perto das medidas (882 em 30 min = 42 mil por dia)", String(Math.round(linhasAgregadoDia)));

console.log("== workflows: fatias, hora em hora e última hora");
const w = lab.workflows;
ok(perto(w.fatiasGibMes, navErroExp * 30), "fatias = (navegação + erro + experiência) por dia × 30");
ok(perto(w.horaSessoesGibMes, navErro * (120 / 60) * 30), "hora em hora, sessões = (nav + erro) por dia × 120 min ÷ 60 × 30 (30 min antes, a hora, 30 min depois)");
ok(perto(w.horaFunisGibMes, w.horaSessoesGibMes), "funis com jornada salva = a mesma leitura das sessões");
ok(perto(w.horaReqGibMes, c0.gibDia * 30), "hora em hora, requisições = a hora dos 3 buckets, cada hora uma vez (cópia por dia × 30)");
ok(perto(w.horaLigacaoGibMes, 24 * (Math.min(0.07, 0.5) + 0.07 / 10000) * 30), "ligação = 24 × (spans da hora até 0,5 GiB + contagem 1/10.000), × 30: a hora da cópia é a mesma leitura das requisições (1.45.2)");
const spans = estimarCustos({ ...VOLUMETRIA_LAB, spansGibHora: 50 }, T);
ok(perto(spans.workflows.horaLigacaoGibMes, 24 * (0.5 + 50 / 10000) * 30), "spans pesados: o lado dos spans da ligação para em 0,5 GiB por hora");
ok(perto(w.ultimaHoraGibMes, 10 * 4 * navErro * (60 / 1440) * 30), "última hora = 10 h de uso × 4 leituras × 60 min de (nav + erro), × 30");
ok(w.invocacoesMes === 288 * 30, "funções: 288 invocações por dia (um workflow a cada 5 min, 1.44.5) × 30", String(w.invocacoesMes));
ok(perto(w.custoFuncoesMes, 288 * 30 * T.funcaoPorInvocacao), "custo das funções = invocações × tarifa");
ok(perto(w.gibMes, w.fatiasGibMes + w.horaSessoesGibMes + w.horaFunisGibMes + w.horaReqGibMes + w.horaLigacaoGibMes + w.ultimaHoraGibMes) && perto(w.custoMes, w.gibMes * T.consultaPorGib),
  "leitura dos workflows = (fatias + sessões + funis + requisições + ligação + última hora) × tarifa");
ok(!("retratoGibMes" in w) && !("retratoExecucoesDia" in w) && !("retratoMin" in MODELO) && !("janelaRetratoMin" in MODELO) && !("ligacaoGib" in lab.cargas) && !("agregados" in lab),
  "nada do retrato a cada 5 min nem da ligação lida ao abrir o Flow (1.42)");
const semJornada = estimarCustos({ ...VOLUMETRIA_LAB, jornadasSalvas: 0 }, T);
ok(semJornada.workflows.horaFunisGibMes === 0 && perto(semJornada.workflows.horaSessoesGibMes, w.horaSessoesGibMes), "sem jornada salva: os funis não leem; as sessões continuam");

console.log("== o que os workflows gravam e guardam");
const g = lab.gravado;
ok(perto(g.agregadosGibDia, (40 * 3.7 * 288 * 420) / GIB), "agregados = páginas × 3,7 linhas × 288 fatias × 420 bytes");
ok(perto(g.errosGibDia, (40 * 1 * 288 * 650) / GIB), "erros com exemplos = páginas × 1 linha × 288 fatias × 650 bytes");
ok(perto(g.horasGibDia, (40 * 8 * 24 * 600) / GIB), "horas analisadas = páginas × 8 linhas × 24 horas × 600 bytes");
ok(perto(g.custoGravacaoMes, (g.agregadosGibDia + g.errosGibDia + g.horasGibDia) * 30 * T.gravacaoPorGib), "gravação = (agregados + erros + horas) × 30 × tarifa");
ok(perto(g.custoRetencaoMes, (g.agregadosGibDia * 8 + g.errosGibDia * 8 + g.horasGibDia * 3) * 30 * T.retencaoPorGibDia), "retenção: agregados e erros 8 dias, horas 3 dias");
ok(perto(lab.retencao.gibGuardado, c0.gibDia + c0.experienciaGibDia), "retenção da cópia: 1 dia de cópia + experiência");

console.log("== cargas de tela: ao vivo, leituras pequenas e Flow");
const c = lab.cargas, fj = 30 / 1440;
ok(perto(c.aoVivoGib, (13 / 1440) * navErroExp), "ao vivo = 13 min de (nav + erro + experiência), numa leitura só");
ok(perto(c.agregadosGib, g.agregadosGibDia * 14 * fj), "agregados = agregados por dia × 14 leituras × período");
ok(perto(c.errosGib, g.errosGibDia * 2 * fj), "erros = erros gravados por dia × 2 leituras × período");
ok(perto(c.horasGib, g.horasGibDia * 4), "horas = as 24 h analisadas × 4 leituras (2 consultas, cada uma com o controle), em qualquer período");
ok(perto(c.grafoGib, g.agregadosGibDia * 2 * fj), "grafo por carga = origens pelas fatias (grupo orig: leitura + cobertura, 1.46.1); antes, as navegações da cópia do período (BAS-10)");
ok(perto(c.flowGib, g.horasGibDia * 2), "Flow = ligação das 24 h (horas × 2); as entidades das aplicações habilitadas saem de graça desde a 1.45.9");
ok(perto(c.gibMes, ((c.aoVivoGib + c.agregadosGib + c.errosGib + c.horasGib + c.grafoGib) * 40 + c.flowGib * 20) * 30), "cargas por mês = (carga × 40 + Flow × 20) × 30");
const dia24 = estimarCustos({ ...VOLUMETRIA_LAB, janelaMin: 1440 }, T);
ok(perto(dia24.cargas.grafoGib, g.agregadosGibDia * 2) && dia24.cargas.grafoGib < c0.gibNavDia, "período de 24 h: o grafo lê as fatias do dia (2 leituras pequenas), não o dia inteiro de navegação da cópia");
ok(perto(c.custoMes, c.gibMes * T.consultaPorGib), "custo das cargas = GiB × tarifa de consulta");
const semana = estimarCustos({ ...VOLUMETRIA_LAB, janelaMin: 7 * 1440 }, T), mes = estimarCustos({ ...VOLUMETRIA_LAB, janelaMin: 30 * 1440 }, T);
ok(perto(semana.cargas.agregadosGib, g.agregadosGibDia * 14 * 7) && perto(mes.cargas.agregadosGib, semana.cargas.agregadosGib) && perto(mes.cargas.horasGib, c.horasGib),
  "período longo: as fatias param em 7 dias; as horas são sempre as 24 h");
const semCargas = estimarCustos({ ...VOLUMETRIA_LAB, cargasDia: 0, cargasFlowDia: 0 }, T);
const soFlow = estimarCustos({ ...VOLUMETRIA_LAB, cargasDia: 0 }, T);
ok(semCargas.cargas.gibMes === 0 && semCargas.cargas.custoMes === 0, "sem cargas de tela nem Flow: nada lido nas cargas", String(semCargas.cargas.gibMes));
ok(perto(soFlow.cargas.gibMes, soFlow.cargas.flowGib * 20 * 30), "só aberturas do Flow: a ligação de 24 h × aberturas");

console.log("== sob demanda");
const s = lab.sobDemanda;
ok(perto(s.filtroGib, fj * (4 * c0.gibNavDia + 4 * c0.gibErroDia + c0.gibReqDia)), "filtro, robôs ou frames = período de (nav × 4 + erro × 4 + requisição)");
ok(perto(s.analiseGib, fj * 2 * c0.gibNavDia), "Isolar e Por quê? = período de navegação × 2");
ok(perto(s.ondeFalhaGib, (0.07 * 12 / 60) * 0.5), "Onde falha = spans de 12 min × 0,5");
ok(perto(s.gibMes, (s.filtroGib * 10 + s.analiseGib * 10 + s.ondeFalhaGib * 5) * 30), "sob demanda por mês = ações por dia × 30");
const doisDias = estimarCustos({ ...VOLUMETRIA_LAB, janelaMin: 2 * 1440 }, T);
ok(perto(doisDias.sobDemanda.filtroGib, (60 / 1440) * (4 * c0.gibNavDia + 4 * c0.gibErroDia + c0.gibReqDia)) && perto(doisDias.sobDemanda.analiseGib, (60 / 1440) * 2 * c0.gibNavDia), "período acima de 1 dia: o filtro (1.46.1), \"Isolar\" e \"Por quê?\" (1.46.3) param na última hora");

console.log("== total, fixo, uso e custo por 1.000 sessões");
ok(perto(lab.fixoMes, w.custoMes + w.custoFuncoesMes + g.custoGravacaoMes + g.custoRetencaoMes + lab.retencao.custoMes), "fixo = workflows + funções + gravado e retido + retenção da cópia");
ok(perto(lab.usoMes, c.custoMes + s.custoMes) && perto(lab.totalMes, lab.fixoMes + lab.usoMes), "uso = cargas + sob demanda; total = fixo + uso");
ok(perto(lab.gravacaoCopia.gibMes, (c0.gibDia + c0.experienciaGibDia) * 30) && perto(lab.totalMesComGravacao, lab.totalMes + lab.gravacaoCopia.custoMes) && lab.totalMes < lab.totalMesComGravacao, "gravação da cópia à parte");
ok(perto(lab.custoPorMilSessoesDia, lab.totalMes / 15), "custo por 1.000 sessões por dia = total ÷ 15");
ok(lab.totalMes > 0, "laboratório tem custo positivo", lab.totalMes.toFixed(4));

console.log("== zero sessões, zero horas de uso e tarifa zero");
const zero = estimarCustos({ ...VOLUMETRIA_LAB, sessoesDia: 0 }, T);
ok(zero.totalMes === 0 && zero.totalMesComGravacao === 0 && zero.custoPorMilSessoesDia === 0, "zero sessões = custo zero (inclusive gravação e por mil sessões)");
ok(zero.workflows.invocacoesMes === 0 && zero.workflows.gibMes === 0 && zero.gravado.agregadosGibDia === 0 && zero.gravado.errosGibDia === 0 && zero.gravado.horasGibDia === 0 && zero.sobDemanda.gibMes === 0,
  "zero sessões: sem execução, sem nada gravado, sem leitura");
ok(zero.cargas.gibMes === 0 && zero.cargas.aoVivoGib === 0 && zero.cargas.agregadosGib === 0 && zero.cargas.errosGib === 0 && zero.cargas.horasGib === 0 && zero.cargas.grafoGib === 0 && zero.cargas.flowGib === 0, "zero sessões: cargas de tela zeradas");
const semUso = estimarCustos({ ...VOLUMETRIA_LAB, horasUsoDia: 0 }, T);
ok(semUso.workflows.ultimaHoraGibMes === 0 && semUso.workflows.fatiasGibMes === w.fatiasGibMes && semUso.workflows.horaSessoesGibMes === w.horaSessoesGibMes && semUso.workflows.invocacoesMes === w.invocacoesMes,
  "sem horas de uso: a última hora não lê; fatias e horas continuam; as execuções contam igual");
const tarifaZero: Tarifas = { consultaPorGib: 0, retencaoPorGibDia: 0, gravacaoPorGib: 0, funcaoPorInvocacao: 0, moeda: "X" };
const semTarifa = estimarCustos(VOLUMETRIA_LAB, tarifaZero);
ok(semTarifa.totalMes === 0 && semTarifa.totalMesComGravacao === 0 && semTarifa.custoPorMilSessoesDia === 0, "tarifa zero = custo zero");
ok(semTarifa.copia.gibDia === c0.gibDia && semTarifa.workflows.gibMes === w.gibMes && semTarifa.cargas.gibMes === c.gibMes, "tarifa zero mantém os volumes");

console.log("== pureza e saneamento");
const copia: Volumetria = { ...VOLUMETRIA_LAB };
const a = estimarCustos(copia, T), b = estimarCustos(copia, T);
ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(copia) === JSON.stringify(VOLUMETRIA_LAB), "mesma entrada, mesma saída; entrada não é alterada");
const invalida = estimarCustos({ ...VOLUMETRIA_LAB, paginasDistintas: Number.NaN, aberturasFiltroDia: -5, horasUsoDia: 48 }, { ...T, consultaPorGib: Number.POSITIVE_INFINITY });
ok(Number.isFinite(invalida.totalMes) && invalida.gravado.agregadosGibDia === 0 && invalida.gravado.horasGibDia === 0 && invalida.sobDemanda.custoMes === 0 && invalida.workflows.custoMes === 0,
  "NaN, negativo e infinito viram 0");
ok(perto(invalida.sobDemanda.gibMes, (s.analiseGib * 10 + s.ondeFalhaGib * 5) * 30), "aberturas com filtro negativas viram 0 (só Isolar, Por quê? e Onde falha leem)");
ok(perto(invalida.workflows.ultimaHoraGibMes, 24 * 4 * navErro * (60 / 1440) * 30), "horas de uso acima de 24 viram 24 (96 leituras da última hora por dia)");
const dobro = estimarCustos({ ...VOLUMETRIA_LAB, sessoesDia: 30000 }, T);
ok(perto(dobro.copia.gibDia, 2 * c0.gibDia) && perto(dobro.workflows.fatiasGibMes, 2 * w.fatiasGibMes) && dobro.workflows.invocacoesMes === w.invocacoesMes && dobro.gravado.agregadosGibDia === g.agregadosGibDia && dobro.gravado.horasGibDia === g.horasGibDia,
  "o dobro de sessões dobra a cópia e as fatias; execuções e o que é gravado (por página) não mudam");

console.log("== DocCustos renderizado (sem tenant): calculadora com a tabela de resultados");
const html = renderToStaticMarkup(<DocCustos />);
const nInputs = (html.match(/<input /g) ?? []).length;
ok(html.includes('class="doc-calc"') && nInputs >= Object.keys(VOLUMETRIA_LAB).length + 5, "um campo por item da volumetria e das tarifas", String(nInputs));
ok(["Horas do dia com alguém na Visão geral", "Jornadas salvas", "Aberturas com filtro de segmento, robôs ou frames por dia", "\"Isolar\" e \"Por quê?\" por dia", "Período típico das telas", "Cargas de tela por dia que vão ao Grail"]
  .every((x) => html.includes(x.replace(/"/g, "&quot;"))), "campos novos e renomeados da 1.43");
ok(!/fora do retrato|Painéis de página|Janela típica das leituras/.test(html), "sem os campos removidos (fora do retrato, painéis)");
ok([`Workflow: fatias de ${MODELO.fatiaMin} min`, "Workflow: hora em hora, sessões e funis", "Workflow: hora em hora, requisições e ligação página → serviço", "Workflow: sessões da última hora",
  "Workflow: execuções (funções)", "Gravado pelo workflow: totais, erros e horas", `Retenção da cópia (${MODELO.diasRetencaoCopia} dia)`, "Cargas de tela", "Leituras sob demanda"]
  .every((x) => html.includes(x)), "linhas da tabela: workflows (fatias, hora, última hora), funções, gravado, retenção, cargas e sob demanda");
const execDia = MODELO.minutosDia / MODELO.fatiaMin;
ok(html.includes(`janela de ${MODELO.horaSessoesMin} min`) && html.includes(`até ${MODELO.aoVivoMin} min da cópia`) && html.includes(`${execDia} por dia, uma a cada ${MODELO.fatiaMin} min`)
  && html.includes(`${execDia} execuções por dia`) && html.includes(`a cópia das sessões fica ${MODELO.diasRetencaoCopia} dia`) && html.includes(`a análise de hora em hora, ${MODELO.diasRetencaoHoras} dias`),
  "números do texto e da tabela montados das constantes do modelo");
ok(html.includes("rum_flow_") && html.includes("Um workflow simples") && html.includes("não paga a hora de workflow"), "os buckets do app e o workflow único, simples, sem hora de workflow");
// "retrato" só como a chave literal do registro de controle (k = retrato), nunca como o retrato da Visão geral
const semChave = html.replace(/<code class="doc-cod">retrato<\/code>/g, "");
ok(!/retrato|dois workflows|2 de 2|ligação na hora|lida ao abrir o Flow|até 9 min|50 mais recentes/i.test(semChave), "nada do retrato da Visão geral, dos dois workflows nem da ligação ao abrir o Flow");
ok(html.includes("doc-calc-total") && html.includes("Total por mês") && html.includes("fixo") && html.includes("uso"), "total por mês, fixo e uso");
ok(/<th[^>]*>Componente<\/th>/.test(html) && /<th[^>]*>Custo por mês<\/th>/.test(html), "tabela de resultados com as colunas Componente e Custo por mês");
ok(html.includes("Onde falha no backend?") && html.includes("Isolar") && html.includes("Por quê?"), "ações sob demanda: Onde falha, Isolar e Por quê?");
ok(!/rum_flow\.\*|10 métricas|séries ativas/.test(html), "nada das métricas próprias de antes");
ok(html.includes("não é cobrada como gravação") && html.includes("1.000 sessões"), "a cópia não é cobrada como gravação (só a retenção) e custo por 1.000 sessões");
ok(html.includes("Consumo do app") && html.includes("Editar preços") && html.includes("Projeção de 30 dias"), "o cartão Consumo do app: projeção de 30 dias e Editar preços");
ok(html.includes("referência pública") && html.includes("laboratório"), "tarifas rotuladas como referência pública; padrões rotulados como laboratório");
ok(!html.includes("undefined") && !html.includes("NaN"), "nada indefinido no texto");
// guarda negativa só com termos genéricos; termos extras podem ser passados no ambiente do teste:
// TERMOS_PROIBIDOS="termo1,termo2" no ambiente do teste (comparação sem distinguir maiúsculas)
// a calculadora é em R$ (preço de lista convertido); o que não pode aparecer é ambiente nem tarifa de contrato
const genericos = /\bDEV\b|\bQA\b|\bPROD\b/;
const extras = (process.env.TERMOS_PROIBIDOS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const reExtras = extras.length ? new RegExp(extras.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : null;
ok(!genericos.test(html), "sem ambiente nem tarifa de contrato no texto");
ok(!reExtras || !reExtras.test(html), `sem termo proibido no texto (TERMOS_PROIBIDOS: ${extras.length} termo(s))`);
ok(!/\u2014/.test(html), "sem travessão no texto");

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
