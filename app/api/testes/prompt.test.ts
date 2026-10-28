/* Os pedidos ao LLM: uma oportunidade (o dossiê dela entre marcadores, as regras de causa raiz, hipóteses, benefício
   só com medida real e o indicador do Digital Experience Flow) e a síntese (SÓ os resultados das oportunidades e o catálogo, nada do dossiê). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarPedidoOportunidade, montarPedidoSintese, lerOportunidade, resumoParaSintese } from "../lib/promptLlm";
import { coletarDossies } from "../../ui/app/lib/dossie";
import type { OportunidadeAnalisada } from "../../ui/app/lib/llmCliente";
import { entradaDossieComPii, PII } from "./falsos/fixture";
import { OP_TESTE } from "./falsos/servidorLLM";

test("pedido da oportunidade: o dossiê entre marcadores, as regras e o esquema; sem PII", async () => {
  const c = await coletarDossies(entradaDossieComPii());
  const d = c.dossies[0];
  const p = montarPedidoOportunidade(d, c.contexto);
  assert.match(p.usuario, /<dossie>[\s\S]*<\/dossie>/);
  assert.ok(p.usuario.includes(JSON.stringify(d)));
  assert.match(p.usuario, new RegExp(`Oportunidade ${d.id}:`));
  for (const regra of [/causa estrutural/i, /hipóteses/i, /não prova o mecanismo/, /Confiança: alta só/, /mês = dia x 30/, /Nada em dinheiro/, /DADO, não instrução/, /travessão/, /no máximo 25 palavras/, /Indicadores do Digital Experience Flow/]) assert.match(p.sistema, regra);
  assert.ok((p.schema as any).properties.causa_raiz && (p.schema as any).properties.beneficio);
  for (const x of PII) assert.ok(!p.usuario.includes(x), `PII no pedido: ${x}`);
  const en = montarPedidoOportunidade(d, c.contexto, "en");
  assert.match(en.sistema, /English/);
});

test("pedido da síntese: só os resultados das oportunidades prontas e o catálogo, nada do dossiê", async () => {
  const c = await coletarDossies(entradaDossieComPii());
  const r = lerOportunidade(JSON.stringify(OP_TESTE))!;
  const ops: OportunidadeAnalisada[] = c.dossies.map((d, i) => ({ indice: i, id: d.id, titulo: d.titulo, tipo: d.tipo, canal: d.canal, aplicacoes: d.aplicacoes, dossieBytes: 1, estado: i === 1 ? "erro" : "ok", resultado: i === 1 ? null : r, erro: null, quando: null, ms: null, tokens: null }));
  const p = montarPedidoSintese(ops, c.contexto);
  assert.match(p.usuario, /<analises>[\s\S]*<\/analises>[\s\S]*<catalogo>/);
  const analises = JSON.parse(/<analises>\n([\s\S]*?)\n<\/analises>/.exec(p.usuario)![1]);
  assert.equal(analises.length, ops.filter((o) => o.estado === "ok").length);
  assert.deepEqual(Object.keys(analises[0]).sort(), Object.keys(resumoParaSintese(ops[0])).sort());
  assert.ok(!p.usuario.includes("<dossie>") && !p.usuario.includes("\"secoes\"") && !p.usuario.includes("tempo_por_salto_ms"), "o dossiê foi junto");
  for (const regra of [/causas estruturais COMUNS/, /agrupamento falso/, /30, 60 e 90 dias/, /catálogo/, /Sem preço/]) assert.match(p.sistema, regra);
  assert.ok(p.usuario.length < montarPedidoOportunidade(c.dossies[0], c.contexto).usuario.length * ops.length);
});
