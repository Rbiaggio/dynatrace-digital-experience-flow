/* O arquivo da função de verdade (analise-llm.function.ts) com as dependências reais (dependenciasLlm.ts)
   ligadas a SDKs falsos (App State em memória, identidade da plataforma) e o LLM simulado: a fiação de iniciar,
   oportunidade, síntese e status; e o que iniciar recusa antes de reservar ou guardar qualquer coisa (formato, dado
   pessoal, tamanho, lista de dossiês). */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import funcao from "../analise-llm.function";
import { LLM } from "./falsos/llm.local";
import { memoria } from "./falsos/sdk-client-state";
import { subirServidorLLM, type ServidorLLM } from "./falsos/servidorLLM";
import { coletarDossies, type ColetaDossie } from "../../ui/app/lib/dossie";
import { comVarias, entradaDossieComPii } from "./falsos/fixture";
import type { RespostaErro, RespostaIniciar, RespostaOportunidade, RespostaSintese, RespostaStatus } from "../../ui/app/lib/llmCliente";

let srv: ServidorLLM, C: ColetaDossie;
const g = globalThis as unknown as { __DEF_USUARIO?: { id: string; name: string; email: string } };
before(async () => { srv = await subirServidorLLM(); LLM.baseURL = srv.url("ok"); C = comVarias(await coletarDossies(entradaDossieComPii())); });
after(async () => { await srv.fechar(); });

test("pela função de verdade: fora da lista barrado (status sem análise, iniciar recusado); liberado: iniciar, oportunidades, síntese", async () => {
  memoria.clear();
  // regra padrão (SOMENTE_LIBERADOS): quem não está liberado não vê a análise nem consegue pedir
  g.__DEF_USUARIO = { id: "u-1", name: "Ana Usuária", email: "ana@usuarios.example" };
  const s0 = (await funcao({ modo: "status" })) as RespostaStatus;
  assert.equal(s0.ok, true); assert.equal(s0.uso.autorizado, false); assert.equal(s0.analise, null);
  const barrado = (await funcao({ modo: "iniciar", dossies: C.dossies, contexto: C.contexto })) as RespostaErro;
  assert.equal(barrado.codigo, "nao-autorizado");
  g.__DEF_USUARIO = { id: "u-9", name: "Carla Liberada", email: "carla@empresa.example" };
  const s1 = (await funcao({ modo: "status" })) as RespostaStatus;
  assert.equal(s1.ok, true); assert.equal(s1.ambiente, "abc12345"); assert.equal(s1.uso.autorizado, true); assert.equal(s1.uso.disponivel, true); assert.equal(s1.llmConfigurado, true); assert.equal(s1.analise, null);
  const ini = (await funcao({ modo: "iniciar", dossies: C.dossies, contexto: C.contexto })) as RespostaIniciar;
  assert.equal(ini.ok, true, JSON.stringify(ini));
  // dossiês e oportunidades em chaves próprias
  assert.ok([...memoria.keys()].some((k) => k.endsWith(`${ini.resultado.id}.d0`)));
  const ops = (await Promise.all(ini.resultado.oportunidades.map((o) => funcao({ modo: "oportunidade", analiseId: ini.resultado.id, indice: o.indice })))) as RespostaOportunidade[];
  assert.ok(ops.every((x) => x.ok), JSON.stringify(ops.find((x) => !x.ok)));
  assert.ok([...memoria.keys()].some((k) => k.endsWith(`${ini.resultado.id}.o0`)));
  const s = (await funcao({ modo: "sintese", analiseId: ini.resultado.id })) as RespostaSintese;
  assert.equal(s.ok, true); assert.equal(s.resultado.estado.completa, true);
  assert.ok(!JSON.stringify(s).includes(LLM.apiKey));
  // outra pessoa liberada vê a análise pronta no status; quem está fora da lista continua sem ver nada
  g.__DEF_USUARIO = { id: "u-8", name: "Caio Liberado", email: "caio@empresa.example" };
  const s3 = (await funcao({ modo: "status" })) as RespostaStatus;
  assert.equal(s3.analise?.id, ini.resultado.id);
  assert.equal(s3.analise?.por.email, "carla@empresa.example");
  g.__DEF_USUARIO = { id: "u-2", name: "Bruno", email: "bruno@usuarios.example" };
  const neg = (await funcao({ modo: "iniciar", dossies: C.dossies, contexto: C.contexto })) as RespostaErro;
  assert.equal(neg.codigo, "nao-autorizado");
  assert.equal(((await funcao({ modo: "status" })) as RespostaStatus).analise, null);
  assert.equal(srv.pedidos.length, C.dossies.length + 1, "nenhuma ida ao LLM por quem está fora da lista");
});

test("iniciar recusa sem reservar nem guardar: formato, campo a mais, dado pessoal, tamanho e lista", async () => {
  memoria.clear();
  g.__DEF_USUARIO = { id: "u-9", name: "Carla Liberada", email: "carla@empresa.example" };   // autorizado: o que se testa é a validação
  const d = C.dossies[0];
  const casos: [string, unknown, string, RegExp][] = [
    ["lista vazia", [], "pacote-invalido", /lista de 1 a 8/],
    ["9 dossiês", Array(9).fill(d), "pacote-invalido", /lista de 1 a 8/],
    ["campo a mais", [{ ...d, sessionId: "7f3a9c2e" }], "pacote-invalido", /campo não permitido/],
    ["tipo inválido", [{ ...d, tipo: "sql" }], "pacote-invalido", /tipo: fora da lista/],
    ["chave dinâmica", [{ ...d, secoes: { negocio: { "Maria Souza": 1 } } }], "pacote-invalido", /chave não permitida/],
    ["grande", [{ ...d, secoes: { nota: "x".repeat(25_000) } }], "pacote-invalido", /acima do limite/],
    ["id repetido", [d, d], "pacote-invalido", /id repetido/],
  ];
  for (const [nome, dossies, codigo, re] of casos) {
    const r = (await funcao({ modo: "iniciar", dossies, contexto: C.contexto })) as RespostaErro;
    assert.equal(r.codigo, codigo, nome); assert.match(JSON.stringify(r.erros), re, nome);
  }
  // dado pessoal que a sanitização da função não tira (número dentro de chave permitida não existe: vai num texto que a
  // máscara não cobre, um nome de host com IP v6 sem marcação) é pego pela verificação
  const comIp = { ...d, secoes: { negocio: { host: "conta 4111 1111 1111 1111 de maria.souza@example.com" } } };
  const r = await funcao({ modo: "iniciar", dossies: [comIp], contexto: C.contexto }) as RespostaIniciar;
  assert.equal(r.ok, true, "a função sanitiza de novo o que o navegador deixou passar");
  assert.ok(!JSON.stringify([...memoria.values()].map((x) => x.value)).includes("maria.souza@example.com"));
  assert.ok(!JSON.stringify([...memoria.values()].map((x) => x.value)).includes("4111 1111"));
  // o que a sanitização não pega (um CPF sem pontuação numa CHAVE permitida) a verificação da função pega: nada é guardado
  const antes = memoria.size;
  const naChave = { ...d, secoes: { negocio: { cpf12345678909: 1 } } };
  const v = (await funcao({ modo: "iniciar", dossies: [naChave], contexto: C.contexto })) as RespostaErro;
  assert.equal(v.codigo, "pacote-com-dado-pessoal");
  assert.match(JSON.stringify(v.erros), /número longo/);
  assert.equal(memoria.size, antes);
  // nada foi reservado pelas recusas (a única gravação de uso é a do caso que passou)
  assert.equal(srv.pedidos.length, C.dossies.length + 1, "nenhuma ida ao LLM");
});
