/* Regra de uso na análise estrutural: liberados sem limite; os demais 1 análise por ambiente, que conta quando a
   PRIMEIRA oportunidade termina bem (as outras, a síntese e a retomada não gastam de novo); dois cliques ao mesmo tempo;
   nenhuma oportunidade pronta libera a reserva; reserva de quem caiu expira; retomada reserva de novo; App State com
   erro não vira "livre". LLM injetado (fetch falso que responde a chamada pedida). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { executar, type Dependencias } from "../lib/analiseLlm";
import { ehLiberado, CHAVE_USO, PREFIXO_REGISTRO, RESERVA_MS, type RegistroUso } from "../lib/usoLlm";
import { coletarDossies } from "../../ui/app/lib/dossie";
import type { RespostaLlm, RespostaErro, RespostaIniciar, RespostaOportunidade, RespostaStatus } from "../../ui/app/lib/llmCliente";
import { EstadoMemoria } from "./falsos/estado";
import { OP_TESTE, SINTESE_TESTE, tipoDoPedido } from "./falsos/servidorLLM";
import { comVarias, entradaDossieComPii } from "./falsos/fixture";

const COLETA = comVarias(await coletarDossies(entradaDossieComPii()));
const OUTRO = { id: "u-1", nome: "Ana Usuária", email: "ana@usuarios.example" };
const OUTRO2 = { id: "u-2", nome: "Bruno Usuário", email: "bruno@usuarios.example" };
const LIBERADO = { id: "u-9", nome: "Carla Liberada", email: "carla@empresa.example" };

function fetchFalso(opcoes: { status?: number; atrasoMs?: number; contador?: { n: number } } = {}): typeof fetch {
  return (async (_url: unknown, init?: { body?: unknown }) => {
    if (opcoes.contador) opcoes.contador.n++;
    const tipo = tipoDoPedido(JSON.parse(String(init?.body ?? "{}")));
    if (opcoes.atrasoMs) await new Promise((ok) => setTimeout(ok, Math.random() * opcoes.atrasoMs!));
    const status = opcoes.status ?? 200;
    const corpo = status === 200
      ? { model: "modelo-teste", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(tipo === "sintese" ? SINTESE_TESTE : OP_TESTE) }], usage: { input_tokens: 9000, output_tokens: 4000 } }
      : { type: "error", error: { type: "api_error", message: "falha" } };
    return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
let seq = 0;
function deps(estado: EstadoMemoria, usuario: { id: string; nome: string; email: string }, extra: Partial<Dependencias> = {}): Dependencias {
  return {
    estado, usuario: () => usuario, ambiente: () => ({ id: "abc12345", url: "https://abc12345.apps.dynatrace.com" }), versaoApp: () => "1.35.0",
    llm: { apiKey: "sk-teste-SEGREDO-0123456789", baseURL: "https://llm-teste.services.ai.azure.com/anthropic", model: "modelo-teste", liberados: ["@empresa.example"], timeoutMs: 5000 },
    // a regra de 1 análise por ambiente (testada abaixo) fica desligada por padrão (SOMENTE_LIBERADOS);
    // os testes "só liberados" no fim do arquivo usam o padrão
    fetch: fetchFalso(), gerarId: () => `id${++seq}`, somenteLiberados: false, ...extra,
  };
}
const iniciar = (d: Dependencias) => executar({ modo: "iniciar", dossies: COLETA.dossies, contexto: COLETA.contexto }, d) as Promise<RespostaIniciar | RespostaErro>;
const op = (d: Dependencias, id: string, i: number) => executar({ modo: "oportunidade", analiseId: id, indice: i }, d) as Promise<RespostaOportunidade | RespostaErro>;
/** A análise inteira como a tela faz: iniciar, as oportunidades em paralelo e a síntese. */
async function analisar(d: Dependencias) {
  const ini = await iniciar(d);
  if (!ini.ok) return { ini, ops: [] as (RespostaOportunidade | RespostaErro)[] };
  const ops = await Promise.all((ini as RespostaIniciar).resultado.oportunidades.map((o) => op(d, (ini as RespostaIniciar).resultado.id, o.indice)));
  if (ops.some((x) => x.ok)) await executar({ modo: "sintese", analiseId: (ini as RespostaIniciar).resultado.id }, d);
  else await executar({ modo: "liberar", analiseId: (ini as RespostaIniciar).resultado.id }, d);
  return { ini: ini as RespostaIniciar, ops };
}

test("ehLiberado: só o domínio exato, sem identidade ausente", () => {
  assert.ok(ehLiberado("Carla@Empresa.Example", ["@empresa.example"]));
  assert.ok(!ehLiberado("x@empresa.example.br", ["@empresa.example"]));
  assert.ok(!ehLiberado("x@notempresa.example", ["@empresa.example"]));
  assert.ok(!ehLiberado("empresa.example", ["@empresa.example"])); assert.ok(!ehLiberado("carla@empresa.example", []));
  assert.ok(!ehLiberado("dt.missing.user.email"));
  assert.ok(!ehLiberado(""));
  assert.ok(ehLiberado("teste@lab.example", ["teste@lab.example"]));
});

test("liberado: análises ilimitadas e não gasta a do ambiente", async () => {
  const estado = new EstadoMemoria();
  for (let i = 0; i < 3; i++) {
    const { ini, ops } = await analisar(deps(estado, LIBERADO));
    assert.equal(ini.ok, true, JSON.stringify(ini));
    assert.equal((ini as RespostaIniciar).uso.ilimitado, true);
    assert.ok(ops.every((x) => x.ok && (x as RespostaOportunidade).uso?.consumido !== true));
  }
  assert.equal(estado.json(CHAVE_USO), null);
  const s = (await executar({ modo: "status" }, deps(estado, OUTRO))) as RespostaStatus;
  assert.equal(s.uso.disponivel, true);
  assert.ok(s.analise, "a última análise fica guardada para reabrir");
});

test("fora da lista: conta quando a primeira oportunidade termina bem (uma vez só, com as outras em paralelo); a 2ª análise recebe 'já usada'", async () => {
  const estado = new EstadoMemoria();
  const contador = { n: 0 };
  const { ini, ops } = await analisar(deps(estado, OUTRO, { fetch: fetchFalso({ contador, atrasoMs: 30 }) }));
  assert.equal(ini.ok, true);
  assert.equal((ini as RespostaIniciar).uso.consumido, false, "iniciar só reserva");
  assert.ok(ops.every((x) => x.ok));
  assert.ok(ops.some((x) => (x as RespostaOportunidade).uso?.consumido === true), "a primeira que termina conta");
  assert.equal(estado.json<RegistroUso>(CHAVE_USO)?.status, "usado");
  assert.equal(contador.n, COLETA.dossies.length + 1, "oportunidades + síntese");
  const r2 = (await iniciar(deps(estado, OUTRO2, { fetch: fetchFalso({ contador }) }))) as RespostaErro;
  assert.equal(r2.codigo, "ja-usada");
  assert.equal(r2.uso?.usada?.nome, "Ana Usuária");
  assert.match(r2.uso?.usada?.quando ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(contador.n, COLETA.dossies.length + 1, "a 2ª tentativa não chama o LLM");
  // o status mostra a análise que contou o uso para reabrir; qualquer um repete o que falta sem gastar
  const s = (await executar({ modo: "status" }, deps(estado, OUTRO2))) as RespostaStatus;
  assert.equal(s.uso.usada?.nome, "Ana Usuária");
  assert.equal(s.analise?.por.nome, "Ana Usuária");
  assert.equal(s.analise?.usoConfirmado, true);
  const ret = (await executar({ modo: "iniciar", analiseId: (ini as RespostaIniciar).resultado.id }, deps(estado, OUTRO2))) as RespostaIniciar;
  assert.equal(ret.ok, true, "retomar a análise que já contou não é outra análise");
  assert.equal(estado.json<RegistroUso>(CHAVE_USO)?.por.nome, "Ana Usuária");
  assert.equal((await iniciar(deps(estado, LIBERADO))).ok, true, "o liberado continua podendo");
});

test("dois cliques ao mesmo tempo (bilhetes gravados antes de qualquer listagem): só um começa", async () => {
  const estado = new EstadoMemoria(Date.now, 3);
  estado.barreiraAntesDeListar(2);
  const [a, b] = await Promise.all([iniciar(deps(estado, OUTRO)), iniciar(deps(estado, OUTRO2))]);
  const oks = [a, b].filter((r) => r.ok), erros = [a, b].filter((r) => !r.ok) as RespostaErro[];
  assert.equal(oks.length, 1, JSON.stringify([a, b].map((r) => (r.ok ? "ok" : (r as RespostaErro).codigo))));
  assert.ok(["em-andamento", "ja-usada"].includes(erros[0].codigo));
});

test("muitos cliques soltos (atrasos aleatórios), 15 rodadas: nunca mais de uma análise de quem está fora da lista", async () => {
  for (let rodada = 0; rodada < 15; rodada++) {
    const estado = new EstadoMemoria(Date.now, 4);
    const rs = await Promise.all([OUTRO, OUTRO2, OUTRO, OUTRO2].map((u) => iniciar(deps(estado, u))));
    assert.equal(rs.filter((r) => r.ok).length, 1, `rodada ${rodada}: ${rs.map((r) => (r.ok ? "ok" : (r as RespostaErro).codigo)).join(",")}`);
  }
});

test("nenhuma oportunidade pronta: liberar devolve a análise do ambiente; a próxima tentativa funciona", async () => {
  const estado = new EstadoMemoria();
  const { ops } = await analisar(deps(estado, OUTRO, { fetch: fetchFalso({ status: 503 }) }));
  assert.ok(ops.every((x) => !x.ok && (x as RespostaErro).codigo === "llm-indisponivel"));
  assert.equal(estado.json<RegistroUso>(CHAVE_USO)?.status, "liberado");
  const { ini, ops: ops2 } = await analisar(deps(estado, OUTRO2));
  assert.equal(ini.ok, true);
  assert.ok(ops2.every((x) => x.ok));
});

test("reserva de quem caiu no meio expira e libera; a retomada reserva de novo e a oportunidade sem reserva é recusada", async () => {
  let agora = Date.now();
  const estado = new EstadoMemoria(() => agora);
  const d = (u = OUTRO) => deps(estado, u, { agora: () => agora });
  const ini = (await iniciar(d())) as RespostaIniciar;
  assert.equal(ini.ok, true);
  assert.equal(((await iniciar(d(OUTRO2))) as RespostaErro).codigo, "em-andamento");
  agora += RESERVA_MS + 1000;
  // a reserva venceu: a oportunidade sozinha não segue; a retomada reserva de novo
  assert.equal(((await op(d(), ini.resultado.id, 0)) as RespostaErro).codigo, "reserva-expirada");
  const ret = (await executar({ modo: "iniciar", analiseId: ini.resultado.id }, d())) as RespostaIniciar;
  assert.equal(ret.ok, true, JSON.stringify(ret));
  assert.equal(((await op(d(), ini.resultado.id, 0)) as RespostaOportunidade).ok, true);
  assert.equal(estado.json<RegistroUso>(CHAVE_USO)?.status, "usado");
});

test("App State com erro de leitura não vira 'livre': nada é enviado", async () => {
  const estado = new EstadoMemoria();
  estado.falharLeitura = true;
  const contador = { n: 0 };
  const r = (await iniciar(deps(estado, OUTRO, { fetch: fetchFalso({ contador }) }))) as RespostaErro;
  assert.equal(r.codigo, "estado-indisponivel");
  assert.equal(contador.n, 0);
  assert.equal(((await executar({ modo: "status" }, deps(estado, OUTRO))) as RespostaErro).codigo, "estado-indisponivel");
});

test("identidade ausente (dt.missing) é tratada como fora da lista", async () => {
  const estado = new EstadoMemoria();
  const anonimo = { id: "dt.missing.user.id", nome: "dt.missing.user.name", email: "dt.missing.user.email" };
  assert.equal((await analisar(deps(estado, anonimo))).ini.ok, true);
  assert.equal(((await iniciar(deps(estado, anonimo))) as RespostaErro).codigo, "ja-usada");
});

test("registro de cada passo para os administradores; registros só para liberados; e-mail desligado por padrão", async () => {
  const estado = new EstadoMemoria();
  await analisar(deps(estado, OUTRO));
  await iniciar(deps(estado, OUTRO2));                 // negado: também fica registrado
  const negado = (await executar({ modo: "registros" }, deps(estado, OUTRO))) as RespostaErro;
  assert.equal(negado.codigo, "sem-permissao-registros");
  const r = (await executar({ modo: "registros" }, deps(estado, LIBERADO))) as RespostaLlm & { registros: any[] };
  assert.equal(r.ok, true);
  const porEtapa = (e: string) => r.registros.filter((x) => x.etapa === e);
  assert.equal(porEtapa("iniciar").length, 2);
  assert.equal(porEtapa("oportunidade").length, COLETA.dossies.length);
  assert.equal(porEtapa("sintese").length, 1);
  assert.ok(r.registros.some((x) => x.resultado === "negado:ja-usada"));
  assert.ok(r.registros.every((x) => x.email === "desligado"));
  assert.ok([...estado.dados.keys()].filter((k) => k.startsWith(PREFIXO_REGISTRO)).length === r.registros.length);
  // ligado: um e-mail, quando a análise conta
  const enviados: { corpo: string }[] = [];
  const e2 = new EstadoMemoria();
  await analisar(deps(e2, OUTRO, { enviarEmail: async (_p, _a, corpo) => { enviados.push({ corpo }); }, email: { habilitado: true, para: ["admin@empresa.example"], assunto: "x" } }));
  assert.ok(enviados.length >= 1);
  assert.match(enviados[0].corpo, /Ambiente: abc12345/);
  assert.ok(!enviados[0].corpo.includes("sk-teste"));
});

test("só liberados (padrão): quem está fora da lista não vê a análise nem consegue pedir; liberados e e-mail extra seguem", async () => {
  const estado = new EstadoMemoria();
  const cli = deps(estado, OUTRO, { somenteLiberados: undefined });            // undefined = padrão (SOMENTE_LIBERADOS)
  const st = (await executar({ modo: "status" }, cli)) as RespostaStatus;
  assert.equal(st.ok, true); assert.equal(st.uso.autorizado, false); assert.equal(st.analise, null);
  const ini = (await iniciar(cli)) as RespostaErro;
  assert.equal(ini.ok, false); assert.equal(ini.codigo, "nao-autorizado");
  for (const modo of ["oportunidade", "sintese", "liberar"] as const) {
    const r = (await executar({ modo, analiseId: "x", indice: 0 }, cli)) as RespostaErro;
    assert.equal(r.ok, false, modo); assert.equal(r.codigo, "nao-autorizado", modo); assert.equal(r.modo, modo);
  }
  assert.ok(![...estado.dados.keys()].includes(CHAVE_USO), "nada reservado para quem está fora da lista");
  // liberado: normal, com a análise no status
  const lib = deps(estado, LIBERADO, { somenteLiberados: undefined });
  assert.equal((await analisar(lib)).ini.ok, true);
  const stLib = (await executar({ modo: "status" }, lib)) as RespostaStatus;
  assert.equal(stLib.uso.autorizado, true); assert.ok(stLib.analise, "quem está liberado vê a análise");
  // quem está fora da lista continua sem ver a análise do liberado
  assert.equal(((await executar({ modo: "status" }, cli)) as RespostaStatus).analise, null);
  // e-mail extra do llm.local.ts (liberados) é autorizado
  const extra = deps(estado, { id: "u-5", nome: "Teste Lab", email: "teste@lab.example" }, { somenteLiberados: undefined, llm: { ...cli.llm, liberados: ["teste@lab.example"] } });
  assert.equal(((await executar({ modo: "status" }, extra)) as RespostaStatus).uso.autorizado, true);
  // o pedido negado fica registrado para os administradores
  const regs = (await executar({ modo: "registros" }, lib)) as RespostaLlm & { registros: any[] };
  assert.ok(regs.registros.some((x) => x.resultado === "negado:nao-autorizado"));
});
