/* Validação dos dois mapas da Visão geral (1.36.1), sem tenant: renderiza CartoesMapas com dados sintéticos e confere,
   no HTML gerado, a cor (tom) da bolha, do ponto da lista, do número e da legenda em cada caso, e os textos das legendas.
   Regras que valem: sessões = Apdex do lugar (0,85+ verde, 0,70 a 0,84 âmbar, abaixo vermelho, sem medição cinza);
   erros = taxa de sessões com erro (25%+ ou 1,5x a média vermelho, 10%+ ou 1,15x âmbar, abaixo verde). */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CartoesMapas } from "../app/components/InicioMapas";
import type { LinhaApdexLugar, LinhaLugar } from "../app/lib/lugares";

(globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA = "pt";
const lugar = (regiao: string, sessoes: number, sessoesErro: number): LinhaLugar => ({ pais: "BR", regiao, visitas: sessoes * 3, erros: sessoesErro * 2, sessoes, sessoesErro, mediaMs: 800, p75Ms: 900 });
const apdex = (regiao: string, sat: number, tol: number, fru: number): LinhaApdexLugar[] => [
  { canal: "web", app: "a", pais: "BR", regiao, faixa: "satisfeito", n: sat }, { canal: "web", app: "a", pais: "BR", regiao, faixa: "tolerante", n: tol }, { canal: "mobile", app: "m", pais: "BR", regiao, faixa: "frustrado", n: fru },
];
// média do escopo de erro: (30+15+5+0)/(100+100+100+100) = 12,5% -> SP 30% vermelho (absoluto), RJ 15% âmbar (absoluto), MG 5% verde, PR 0% verde
const lugares = [lugar("São Paulo", 100, 30), lugar("Rio de Janeiro", 100, 15), lugar("Minas Gerais", 100, 5), lugar("Paraná", 100, 0)];
// Apdex: SP 0,95 verde; RJ (50 + 25*0,5)/100 = 0,625 vermelho; MG (70 + 20*0,5)/100 = 0,80 âmbar; PR sem medição
const apdexLinhas = [...apdex("São Paulo", 95, 0, 5), ...apdex("Rio de Janeiro", 50, 25, 25), ...apdex("Minas Gerais", 70, 20, 10)];
const html = renderToStaticMarkup(<CartoesMapas lugares={lugares} filtro={{}} aoFiltrar={() => undefined} apdexLugares={apdexLinhas} />);
const secoes = html.split('<section ');
const mapaSessoes = secoes.find((s) => s.includes("Onde estão os clientes")) ?? "", mapaErros = secoes.find((s) => s.includes("Onde acontecem os erros")) ?? "";
let falhas = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "OK " : "FALHA"} ${msg}`); if (!cond) falhas++; };
const linhaDe = (bloco: string, nome: string) => { const i = bloco.indexOf(`ex-lugar">${nome}`); const ini = bloco.lastIndexOf("<tr", i); const fim = bloco.indexOf("</tr>", i); return bloco.slice(ini, fim); };
const bolhaDe = (bloco: string, sigla: string) => { const i = bloco.indexOf(`>${sigla}</text>`); const trecho = bloco.slice(0, i); const j = trecho.lastIndexOf("mp-bolha"); return trecho.slice(j, j + 40); };

console.log("== mapa de sessões (cor = Apdex)");
ok(mapaSessoes.includes("cor: Apdex do lugar"), "legenda diz que a cor é o Apdex do lugar");
for (const [txt, tom] of [["Apdex 0,85 ou mais", "tom-bom"], ["0,70 a 0,84", "tom-atencao"], ["abaixo de 0,70", "tom-erro"], ["sem medição de Apdex", "tom-sem"]] as const)
  ok(new RegExp(`ex-leg ${tom}"><i></i>${txt}`).test(mapaSessoes), `legenda "${txt}" com a cor ${tom}`);
ok(!mapaSessoes.includes("mp-bolha sessoes") && !mapaSessoes.includes("anel-erro") && !mapaSessoes.includes("anel-atencao"), "nenhuma bolha azul nem anel: só preenchimento por tom");
for (const [nome, tom, nota] of [["São Paulo", "tom-bom", "0,95"], ["Rio de Janeiro", "tom-erro", "0,63"], ["Minas Gerais", "tom-atencao", "0,80"], ["Paraná", "tom-sem", "sem medição"]] as const) {
  const linha = linhaDe(mapaSessoes, nome);
  ok(linha.includes(`ex-ponto ${tom}`), `${nome}: ponto da lista ${tom}`);
  ok(linha.includes(`ex-pct ${tom}`) && linha.includes(nota), `${nome}: número "${nota}" com a cor ${tom}`);
}
ok(/<th[^>]*>Apdex<\/th>/.test(mapaSessoes) && !/<th[^>]*>Com erro<\/th>/.test(mapaSessoes), "coluna Apdex no lugar de Com erro");
ok(/Apdex do escopo: 0,79 \(300 medições\)/.test(mapaSessoes), "rodapé com o Apdex do escopo (0,79 em 300 medições)");
console.log("== mapa de erros (cor = taxa de sessões com erro)");
for (const [txt, tom] of [["25% ou mais das sessões com erro, ou 1,5x a média", "tom-erro"], ["10% ou mais, ou 1,15x a média", "tom-atencao"], ["abaixo disso", "tom-bom"]] as const)
  ok(new RegExp(`ex-leg ${tom}"><i></i>${txt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(mapaErros), `legenda "${txt}" com a cor ${tom}`);
for (const [nome, tom, pct] of [["São Paulo", "tom-erro", "30%"], ["Rio de Janeiro", "tom-atencao", "15%"], ["Minas Gerais", "tom-bom", "5%"]] as const) {
  const linha = linhaDe(mapaErros, nome);
  ok(linha.includes(`ex-ponto ${tom}`), `${nome}: ponto da lista ${tom}`);
  ok(linha.includes(`ex-pct ${tom}`) && linha.includes(pct), `${nome}: "% do lugar" ${pct} com a cor ${tom}`);
}
ok(!mapaErros.includes("Paraná"), "Paraná (0 sessões com erro) fica fora da lista de erros");
ok(mapaErros.includes("Média do escopo: 13% das sessões com erro") || mapaErros.includes("Média do escopo: 12% das sessões com erro"), "rodapé com a média do escopo");
console.log("== bolhas (SVG) nos dois mapas");
const tons = (bloco: string) => [...bloco.matchAll(/mp-bolha (tom-[a-z]+)/g)].map((m) => m[1]);
const siglas = (bloco: string) => [...bloco.matchAll(/class="mp-sigla"[^>]*>([A-Z]{2})</g)].map((m) => m[1]);
// a sigla do PR não é desenhada (colide com a de SP no mapa); as 4 bolhas saem na ordem da lista (SP, RJ, MG, PR)
ok(JSON.stringify(tons(mapaSessoes)) === JSON.stringify(["tom-bom", "tom-erro", "tom-atencao", "tom-sem"]) && siglas(mapaSessoes).join(",") === "SP,RJ,MG", `mapa de sessões: bolhas SP,RJ,MG,PR = ${tons(mapaSessoes).join(",")}`);
ok(JSON.stringify(siglas(mapaErros)) === JSON.stringify(["SP", "RJ", "MG"]) && JSON.stringify(tons(mapaErros)) === JSON.stringify(["tom-erro", "tom-atencao", "tom-bom"]), `mapa de erros: bolhas ${siglas(mapaErros).join(",")} = ${tons(mapaErros).join(",")}`);
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exit(falhas ? 1 : 0);
