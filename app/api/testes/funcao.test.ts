/* A função de ponta a ponta com o LLM SIMULADO num servidor HTTP local (fetch de verdade): iniciar (validação,
   sanitização de novo, verificação), uma chamada por oportunidade em paralelo, a síntese só com os resultados; erros do
   LLM (timeout, 401, 429, 529, endpoint inexistente, conexão recusada, 400 da saída estruturada, recusa, vazio, texto,
   cortada); uma oportunidade que falha e repete só ela; o que terminou é reaproveitado; a síntese refeita quando entra
   uma oportunidade nova; nunca a chave, o pedido ou o dossiê cru na resposta; o motor que respondeu sempre dito. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { executar, type Dependencias } from "../lib/analiseLlm";
import { coletarDossies, type ColetaDossie } from "../../ui/app/lib/dossie";
import type { RespostaErro, RespostaIniciar, RespostaOportunidade, RespostaSintese, RespostaStatus } from "../../ui/app/lib/llmCliente";
import { EstadoMemoria, EstadoReplicaAtrasada } from "./falsos/estado";
import { subirServidorLLM, type ServidorLLM } from "./falsos/servidorLLM";
import { comVarias, entradaDossieComPii, PII, TRACES } from "./falsos/fixture";

const CHAVE = "sk-teste-SEGREDO-0123456789abcdef";
const LIBERADO = { id: "u-9", nome: "Carla Liberada", email: "carla@empresa.example" };
const OUTRO = { id: "u-1", nome: "Ana Usuária", email: "ana@usuarios.example" };
let srv: ServidorLLM, COLETA: ColetaDossie;
before(async () => { srv = await subirServidorLLM(undefined, { lentoMs: 1500 }); COLETA = comVarias(await coletarDossies(entradaDossieComPii())); });
after(async () => { await srv.fechar(); });

const deps = (baseURL: string, usuario = LIBERADO, estado = new EstadoMemoria(), timeoutMs = 5000): Dependencias => ({
  estado, usuario: () => usuario, ambiente: () => ({ id: "abc12345", url: "https://abc12345.apps.dynatrace.com" }), versaoApp: () => "1.35.0",
  llm: { apiKey: CHAVE, baseURL, model: "modelo-teste", liberados: ["@empresa.example"], timeoutMs },
  // confirmação das marcas (300, 600 e 900 ms na plataforma): encurtada nos testes; os de réplica atrasada ajustam por conta própria
  espera: (ms: number) => new Promise<void>((ok) => setTimeout(ok, Math.min(ms, 20))),
  // os roteiros com usuário fora da lista exercitam a regra de 1 por ambiente, desligada por padrão (SOMENTE_LIBERADOS); o bloqueio está em uso.test.ts e funcao_dossie.test.ts
  somenteLiberados: false,
});
const iniciar = (d: Dependencias, c = COLETA) => executar({ modo: "iniciar", dossies: c.dossies, contexto: c.contexto }, d) as Promise<RespostaIniciar | RespostaErro>;
const op = (d: Dependencias, analiseId: string, indice: number) => executar({ modo: "oportunidade", analiseId, indice }, d) as Promise<RespostaOportunidade | RespostaErro>;
const sintese = (d: Dependencias, analiseId: string, prontas?: number[]) => executar({ modo: "sintese", analiseId, prontas }, d) as Promise<RespostaSintese | RespostaErro>;
/** Nada de chave, de instrução do sistema, do dossiê cru ou de trace id na resposta. */
function semSegredo(r: unknown) {
  const s = JSON.stringify(r);
  assert.ok(!s.includes(CHAVE), "a chave voltou na resposta");
  assert.ok(!s.includes("Você é o arquiteto"), "o pedido voltou na resposta");
  assert.ok(!s.includes("<dossie>") && !s.includes("tempo_por_salto_ms"), "o dossiê cru voltou na resposta");
  for (const t of TRACES) assert.ok(!s.includes(t), "trace id na resposta");
}

test("análise completa: iniciar sem LLM, oportunidades em paralelo (uma ida cada), síntese só com os resultados", async () => {
  const estado = new EstadoMemoria();
  const d = deps(srv.url("lento"), LIBERADO, estado);
  const antes = srv.pedidos.length;
  const ini = (await iniciar(d)) as RespostaIniciar;
  assert.equal(ini.ok, true, JSON.stringify(ini));
  assert.equal(srv.pedidos.length, antes, "iniciar não chama o LLM");
  assert.equal(ini.resultado.estado.pendentes, COLETA.dossies.length);
  semSegredo(ini);
  const t0 = Date.now();
  const rs = await Promise.all(ini.resultado.oportunidades.map((o) => op(d, ini.resultado.id, o.indice)));
  const ms = Date.now() - t0;
  assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.find((r) => !r.ok)));
  assert.ok(ms < 1500 * 2 + 500, `em paralelo: ${ms} ms`);   // + confirmação das marcas (encurtada em deps)
  assert.ok(srv.maxEmCurso() >= Math.min(3, rs.length), `paralelo no LLM: ${srv.maxEmCurso()}`);
  const pedidosOp = srv.pedidos.slice(antes);
  assert.equal(pedidosOp.length, rs.length, "uma ida por oportunidade");
  assert.deepEqual(pedidosOp.map((p) => p.op).sort(), COLETA.dossies.map((x) => x.id).sort());
  for (const p of pedidosOp) {
    assert.equal(p.tipo, "oportunidade"); assert.equal(p.corpo.output_config.effort, "low"); assert.equal(p.corpo.output_config.format.type, "json_schema");
    assert.equal(p.headers["x-api-key"], CHAVE);
    for (const x of [...PII, ...TRACES]) assert.ok(!JSON.stringify(p.corpo).includes(x), `PII no pedido: ${x}`);
  }
  const r1 = rs[0] as RespostaOportunidade;
  assert.equal(r1.oportunidade.estado, "ok");
  assert.equal(r1.oportunidade.resultado?.causaRaiz.confianca, "alta");
  assert.deepEqual(r1.tokens, { entrada: 9000, saida: 4800 });
  semSegredo(r1);
  const s = (await sintese(deps(srv.url("ok"), LIBERADO, estado), ini.resultado.id)) as RespostaSintese;
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(s.resultado.estado.completa, true);
  assert.ok(s.resultado.sintese!.causasComuns.length > 0);
  const ps = srv.pedidos[srv.pedidos.length - 1];
  assert.equal(ps.tipo, "sintese");
  assert.ok(!JSON.stringify(ps.corpo).includes("<dossie>") && !JSON.stringify(ps.corpo).includes("tempo_por_salto_ms"), "a síntese não recebe o dossiê");
  assert.match(s.resultado.markdown, /## Resumo estrutural[\s\S]*## Oportunidades/);
  semSegredo(s);
  // de novo: tudo reaproveitado, nada chamado
  const n = srv.pedidos.length;
  assert.equal(((await op(d, ini.resultado.id, 0)) as RespostaOportunidade).reaproveitada, true);
  assert.equal(((await sintese(d, ini.resultado.id)) as RespostaSintese).reaproveitada, true);
  assert.equal(srv.pedidos.length, n);
  // status traz a análise completa
  const st = (await executar({ modo: "status" }, d)) as RespostaStatus;
  assert.equal(st.analise?.id, ini.resultado.id);
  assert.equal(st.analise?.estado.completa, true);
});

test("uma oportunidade falha: as outras valem, a síntese sai com as prontas; repetir só ela e a síntese é refeita", async () => {
  const estado = new EstadoMemoria();
  const d = deps(srv.url("o2-falha"), LIBERADO, estado);
  const ini = (await iniciar(d)) as RespostaIniciar;
  const rs = await Promise.all(ini.resultado.oportunidades.map((o) => op(d, ini.resultado.id, o.indice)));
  const falhou = rs.find((r) => !r.ok) as RespostaErro;
  assert.equal(falhou.codigo, "llm-indisponivel");
  assert.equal(falhou.oportunidade?.estado, "erro");
  assert.equal(rs.filter((r) => r.ok).length, rs.length - 1);
  const s1 = (await sintese(d, ini.resultado.id)) as RespostaSintese;
  assert.equal(s1.ok, true);
  assert.equal(s1.resultado.estado.completa, false);
  assert.equal(s1.resultado.estado.falhas, 1);
  // retomada: só a que falhou vai ao LLM; a síntese é refeita para incluir a nova
  const d2 = deps(srv.url("ok"), LIBERADO, estado);
  const ret = (await executar({ modo: "iniciar", analiseId: ini.resultado.id }, d2)) as RespostaIniciar;
  assert.equal(ret.ok, true); assert.equal(ret.nova, false);
  const antes = srv.pedidos.length;
  for (const o of ret.resultado.oportunidades) await op(d2, ini.resultado.id, o.indice);
  assert.equal(srv.pedidos.length, antes + 1, "só a que faltava");
  const s2 = (await sintese(d2, ini.resultado.id)) as RespostaSintese;
  assert.equal(s2.reaproveitada, false);
  assert.equal(s2.resultado.estado.completa, true);
});

test("síntese falha: as oportunidades continuam valendo e dá para repetir só a síntese", async () => {
  const estado = new EstadoMemoria();
  const d = deps(srv.url("sintese-falha"), LIBERADO, estado);
  const ini = (await iniciar(d)) as RespostaIniciar;
  await Promise.all(ini.resultado.oportunidades.map((o) => op(d, ini.resultado.id, o.indice)));
  const s = (await sintese(d, ini.resultado.id)) as RespostaErro;
  assert.equal(s.ok, false); assert.equal(s.codigo, "llm-indisponivel");
  assert.equal(s.resultado?.estado.prontas, COLETA.dossies.length);
  assert.equal(s.resultado?.estado.sintese, false);
  const s2 = (await sintese(deps(srv.url("ok"), LIBERADO, estado), ini.resultado.id)) as RespostaSintese;
  assert.equal(s2.ok, true);
});

test("erros do LLM numa oportunidade: código certo, sem a chave, e nada gasto", async () => {
  const casos: [string, string, Partial<{ timeoutMs: number; baseURL: string }>][] = [
    ["lento", "llm-timeout", { timeoutMs: 300 }], ["401", "llm-autenticacao", {}], ["eco-chave", "llm-autenticacao", {}], ["429", "llm-limite", {}], ["529", "llm-indisponivel", {}], ["500", "llm-indisponivel", {}],
    ["recusa", "llm-recusa", {}], ["vazio", "llm-resposta-invalida", {}], ["texto", "llm-resposta-invalida", {}], ["cortada", "llm-resposta-invalida", {}], ["json-errado", "llm-resposta-invalida", {}],
    ["dns", "llm-endpoint", { baseURL: "https://nao-existe-def.invalid/anthropic" }],
  ];
  // conexão recusada: uma porta sem servidor
  const fechado = http.createServer(); await new Promise<void>((ok) => fechado.listen(0, "127.0.0.1", ok)); const porta = (fechado.address() as AddressInfo).port; await new Promise((ok) => fechado.close(ok));
  casos.push(["recusada", "llm-endpoint", { baseURL: `http://127.0.0.1:${porta}/x/anthropic` }]);
  for (const [cenario, codigo, extra] of casos) {
    const estado = new EstadoMemoria();
    const d = deps(extra.baseURL ?? srv.url(cenario), OUTRO, estado, extra.timeoutMs ?? 5000);
    const ini = (await iniciar(d)) as RespostaIniciar;
    assert.equal(ini.ok, true, `${cenario}: ${JSON.stringify(ini)}`);
    const r = (await op(d, ini.resultado.id, 0)) as RespostaErro;
    assert.equal(r.ok, false, cenario); assert.equal(r.codigo, codigo, `${cenario}: ${r.codigo} ${r.detalhe ?? ""}`);
    semSegredo(r);
    assert.ok(r.motor, `${cenario}: o motor que respondeu`);
    const st = (await executar({ modo: "status" }, deps(srv.url("ok"), { ...OUTRO, id: "u-x", email: "outra@banco.example" }, estado))) as RespostaStatus;
    assert.equal(st.uso.usada, null, `${cenario}: falha não gasta`);
    const lib = await executar({ modo: "liberar", analiseId: ini.resultado.id }, d);
    assert.deepEqual(lib, { ok: true, modo: "liberar", liberada: true }, cenario);
  }
});

test("400 da saída estruturada: repete uma vez pedindo o JSON no texto (mesmo motor)", async () => {
  const d = deps(srv.url("formato400"), LIBERADO, new EstadoMemoria(), 30_000);
  const ini = (await iniciar(d)) as RespostaIniciar;
  const antes = srv.pedidos.length;
  const r = (await op(d, ini.resultado.id, 0)) as RespostaOportunidade;
  assert.equal(r.ok, true, JSON.stringify(r));
  const [a, b] = srv.pedidos.slice(antes);
  assert.ok(a.corpo.output_config.format && !b.corpo.output_config.format);
});

test("entrada inválida e análise que não existe", async () => {
  const d = deps(srv.url("ok"));
  assert.equal(((await executar({ modo: "qualquer" }, d)) as RespostaErro).codigo, "entrada-invalida");
  assert.equal(((await op(d, "nao-existe", 0)) as RespostaErro).codigo, "analise-nao-encontrada");
  assert.equal(((await sintese(d, "../x")) as RespostaErro).codigo, "analise-nao-encontrada");
  const ini = (await iniciar(d)) as RespostaIniciar;
  assert.equal(((await op(d, ini.resultado.id, 99)) as RespostaErro).codigo, "entrada-invalida");
  assert.equal(((await sintese(d, ini.resultado.id)) as RespostaErro).codigo, "sem-oportunidade-pronta");
});

test("oportunidade em andamento (outra aba): não chama o LLM duas vezes", async () => {
  const estado = new EstadoMemoria();
  const d = deps(srv.url("lento"), LIBERADO, estado);
  const ini = (await iniciar(d)) as RespostaIniciar;
  const antes = srv.pedidos.length;
  const [a, b] = await Promise.all([op(d, ini.resultado.id, 0), new Promise((ok) => setTimeout(ok, 200)).then(() => op(d, ini.resultado.id, 0))]);
  assert.equal(a.ok, true);
  assert.equal((b as RespostaErro).codigo, "em-andamento");
  assert.equal(srv.pedidos.length, antes + 1);
});

test("réplica atrasada do App State: a marca da síntese e da oportunidade é confirmada em vez de ficar armada", async () => {
  // antes da correção: a releitura logo após a gravação vinha com a versão anterior, a função devolvia "em-andamento" e a
  // própria marca ficava gravada por 150 s (LAB, 17/10/2026); ninguém mais conseguia gerar a síntese
  const estado = new EstadoReplicaAtrasada(120);
  const d = { ...deps(srv.url("ok"), LIBERADO, estado), espera: (ms: number) => new Promise<void>((ok) => setTimeout(ok, Math.min(ms, 60))) };
  const ini = (await iniciar(d)) as RespostaIniciar;
  const antes = srv.pedidos.length;
  const o = await op(d, ini.resultado.id, 0);
  assert.equal(o.ok, true, JSON.stringify(o).slice(0, 200));
  // a tela diz quais viu prontas; a função relê as que a réplica atrasada ainda mostra em andamento
  const s = await sintese(d, ini.resultado.id, [0]);
  assert.equal(s.ok, true, JSON.stringify(s).slice(0, 200));
  assert.equal(srv.pedidos.length, antes + 2);
  // e a marca não fica para trás: de novo, reaproveita sem chamar o LLM
  const s2 = (await sintese(d, ini.resultado.id)) as RespostaSintese;
  assert.equal(s2.ok && s2.reaproveitada, true);
  assert.equal(srv.pedidos.length, antes + 2);
});

test("duas abas na síntese ao mesmo tempo: uma gera, a outra recebe em-andamento e só há uma chamada ao LLM", async () => {
  const estado = new EstadoMemoria();
  const d = { ...deps(srv.url("lento"), LIBERADO, estado), espera: (ms: number) => new Promise<void>((ok) => setTimeout(ok, Math.min(ms, 30))) };
  const ini = (await iniciar(d)) as RespostaIniciar;
  assert.equal((await op(d, ini.resultado.id, 0)).ok, true);
  const antes = srv.pedidos.length;
  const [a, b] = await Promise.all([sintese(d, ini.resultado.id), new Promise((ok) => setTimeout(ok, 150)).then(() => sintese(d, ini.resultado.id))]);
  assert.equal(a.ok, true);
  assert.equal((b as RespostaErro).codigo, "em-andamento");
  assert.equal(srv.pedidos.length, antes + 1);
});
