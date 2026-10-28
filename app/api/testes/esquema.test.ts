/* Esquemas das respostas (oportunidade e síntese), a leitura delas (enums, nulos, ids e serviços que não existem,
   travessão) e o texto pronto no formato Problema x Causa x Solução x Benefício. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaOportunidade, schemaSintese, lerOportunidade, lerSintese, markdownDaAnalise, lerObjeto } from "../lib/promptLlm";
import { idsCatalogo } from "../lib/catalogoIniciativas";
import type { OportunidadeAnalisada } from "../../ui/app/lib/llmCliente";
import { OP_TESTE, SINTESE_TESTE } from "./falsos/servidorLLM";

/** Todo objeto fechado, com todos os campos obrigatórios (exigência da saída estruturada) e sem limites numéricos. */
function conferirFechado(s: Record<string, any>, onde = "raiz") {
  if (s.type === "object") {
    assert.equal(s.additionalProperties, false, `${onde}: additionalProperties`);
    assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${onde}: required`);
    for (const [k, v] of Object.entries(s.properties)) conferirFechado(v as Record<string, any>, `${onde}.${k}`);
  }
  if (s.type === "array") conferirFechado(s.items, `${onde}[]`);
  for (const k of ["minItems", "maxItems", "minimum", "maximum", "minLength", "maxLength"]) assert.ok(!(k in s), `${onde}: ${k}`);
}

test("esquemas: objetos fechados, campos obrigatórios, enums de confiança, esforço, camada, onda e catálogo", () => {
  const op = schemaOportunidade(), si = schemaSintese();
  conferirFechado(op); conferirFechado(si);
  assert.deepEqual((op as any).properties.causa_raiz.properties.confianca.enum, ["alta", "media", "baixa"]);
  assert.deepEqual((op as any).properties.esforco.properties.nivel.enum, ["P", "M", "G"]);
  assert.ok((op as any).properties.solucao.properties.mudanca_estrutural.items.properties.camada.enum.includes("resiliencia"));
  assert.deepEqual((op as any).properties.beneficio.properties.sessoes_recuperadas_por_mes.type, ["number", "null"]);
  assert.deepEqual((si as any).properties.plano_em_ondas.items.properties.onda.enum, ["30", "60", "90"]);
  assert.deepEqual((si as any).properties.iniciativas_recomendadas.items.properties.servico.enum, idsCatalogo());
});

test("leitura da oportunidade: travessão sai, camada inválida vira arquitetura, números e nulos ficam", () => {
  const r = lerOportunidade(JSON.stringify(OP_TESTE))!;
  assert.ok(r);
  assert.ok(!/[—–]/.test(JSON.stringify(r)));
  assert.equal(r.causaRaiz.confianca, "alta");
  assert.equal(r.solucao.estrutural[1].camada, "arquitetura");
  assert.equal(r.beneficio.sessoesRecuperadasMes, 31080);
  assert.equal(r.causaRaiz.cadeia.length, 2);
  assert.match(r.causaRaiz.assinatura, /server\.js:26/);
  const nulos = lerOportunidade(JSON.stringify({ ...OP_TESTE, beneficio: { ...OP_TESTE.beneficio, sessoes_recuperadas_por_mes: null, conversao_atual_pct: "50" }, esforco: { nivel: "X", justificativa: "" } }))!;
  assert.equal(nulos.beneficio.sessoesRecuperadasMes, null);
  assert.equal(nulos.beneficio.conversaoAtualPct, null);
  assert.equal(nulos.esforco.nivel, "M");
  assert.equal(lerOportunidade(JSON.stringify({ outra: "coisa" })), null);
  assert.equal(lerOportunidade("texto sem json"), null);
  assert.ok(lerOportunidade("Segue:\n```json\n" + JSON.stringify(OP_TESTE) + "\n```"));
  assert.ok(lerObjeto("antes " + JSON.stringify({ a: 1 }) + " depois"));
});

test("leitura da síntese: id que não existe e serviço fora do catálogo saem; ordem refeita; onda inválida cai em 60", () => {
  const s = lerSintese(JSON.stringify(SINTESE_TESTE), ["o1", "o2"])!;
  assert.deepEqual(s.causasComuns[0].oportunidades, ["o1", "o2"]);
  assert.deepEqual(s.priorizacao.map((p) => [p.id, p.ordem]), [["o1", 1], ["o2", 2]]);
  assert.equal(s.ondas[1].onda, "60");
  assert.deepEqual(s.iniciativasRecomendadas.map((x) => x.servico), ["correcao-aplicacoes"]);
  assert.match(s.resumoExecutivo, /oportunidade 2/);   // o id que escapou para o texto vira "oportunidade 2"
  assert.ok(!/[—–]/.test(JSON.stringify(s)));
  assert.equal(lerSintese(JSON.stringify({ x: 1 }), ["o1"]), null);
  // duas ondas com o mesmo prazo viram uma, na ordem 30, 60, 90
  const duas = lerSintese(JSON.stringify({ ...SINTESE_TESTE, plano_em_ondas: [
    { onda: "90", objetivo: "A", acoes: ["a"], oportunidades: ["o1"], indicador_def: "x" }, { onda: "30", objetivo: "B", acoes: ["b"], oportunidades: ["o2"], indicador_def: "y" },
    { onda: "90", objetivo: "C", acoes: ["c"], oportunidades: ["o2"], indicador_def: "z" }] }), ["o1", "o2"])!;
  assert.deepEqual(duas.ondas.map((w) => [w.onda, w.objetivo, w.acoes.join(), w.oportunidades.join()]), [["30", "B", "b", "o2"], ["90", "A; C", "a,c", "o1,o2"]]);

});

test("texto pronto: resumo estrutural no topo e cada oportunidade em Problema x Causa x Solução x Benefício, sem travessão", () => {
  const r = lerOportunidade(JSON.stringify(OP_TESTE))!, s = lerSintese(JSON.stringify(SINTESE_TESTE), ["o1", "o2"])!;
  const ops: OportunidadeAnalisada[] = [
    { indice: 0, id: "o1", titulo: "Pix falha — no RJ", tipo: "falha-backend", canal: "web", aplicacoes: ["PF"], dossieBytes: 9000, estado: "ok", resultado: r, erro: null, quando: null, ms: 60000, tokens: null },
    { indice: 1, id: "o2", titulo: "Reserva", tipo: "falha-backend", canal: "mobile", aplicacoes: ["App"], dossieBytes: 8000, estado: "erro", resultado: null, erro: { codigo: "llm-timeout", mensagem: "não respondeu" }, quando: null, ms: null, tokens: null },
  ];
  const md = markdownDaAnalise(ops, s, { motor: { nome: "LLM simulado", provedor: "simulado", modelo: "x", simulado: true }, quando: "2026-10-17T12:00:00Z", periodo: "2 h" });
  assert.ok(md.indexOf("## Resumo estrutural") < md.indexOf("## Oportunidades"));
  for (const k of ["**Problema:**", "**Causa raiz**", "**Solução:**", "**Benefício:**", "Prova no Digital Experience Flow", "Causas estruturais comuns", "Plano em ondas", "Iniciativas recomendadas"]) assert.ok(md.includes(k), k);
  assert.match(md, /Não foi analisada: não respondeu/);
  assert.ok(!/[—–]/.test(md));
  const en = markdownDaAnalise(ops, null, { motor: { nome: "x", provedor: "simulado", modelo: "x", simulado: true }, quando: "2026-10-17T12:00:00Z", periodo: "2 h", idioma: "en" });
  assert.match(en, /Problem x Cause x Solution x Benefit/);
  assert.match(en, /Being prepared/);
});
