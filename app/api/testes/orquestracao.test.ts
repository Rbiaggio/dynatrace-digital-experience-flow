/* A orquestração da tela (lib/llmCliente.ts analisarComLlm e continuarAnalise) contra a função de verdade em
   processo (executar) e o LLM simulado: progresso por oportunidade e da síntese, oportunidades em PARALELO (o tempo
   total é o da mais lenta, não a soma), uma oportunidade que falha (as outras e a síntese valem; a retomada roda só ela),
   dado pessoal achado na coleta (nada é enviado) e nenhuma oportunidade pronta (a reserva é liberada). */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { executar, type Dependencias } from "../lib/analiseLlm";
import { CHAVE_USO, type RegistroUso } from "../lib/usoLlm";
import { analisarComLlm, continuarAnalise, type EntradaLlm, type ProgressoLlm, type RespostaLlm } from "../../ui/app/lib/llmCliente";
import { coletarDossies, type ColetaDossie } from "../../ui/app/lib/dossie";
import { EstadoMemoria } from "./falsos/estado";
import { subirServidorLLM, type ServidorLLM } from "./falsos/servidorLLM";
import { comVarias, entradaDossieComPii } from "./falsos/fixture";

let srv: ServidorLLM, C: ColetaDossie;
before(async () => { srv = await subirServidorLLM(undefined, { lentoMs: 1200 }); C = comVarias(await coletarDossies(entradaDossieComPii())); });
after(async () => { await srv.fechar(); });
const OUTRO = { id: "u-1", nome: "Ana Usuária", email: "ana@usuarios.example" };
const deps = (cenario: string, estado: EstadoMemoria): Dependencias => ({
  estado, usuario: () => OUTRO, ambiente: () => ({ id: "abc12345", url: "https://abc12345.apps.dynatrace.com" }), versaoApp: () => "1.35.0",
  llm: { apiKey: "sk-teste-SEGREDO-0123456789", baseURL: srv.url(cenario), model: "modelo-teste", liberados: ["@empresa.example"], timeoutMs: 5000 },
  espera: (ms: number) => new Promise<void>((ok) => setTimeout(ok, Math.min(ms, 20))),   // confirmação das marcas, encurtada
  somenteLiberados: false,   // o usuário destes roteiros não está na lista: exercitam a regra de 1 por ambiente (desligada por padrão)
});
/** A chamada da tela, mas em processo: o mesmo JSON de ida e volta que o POST /api/analise-llm. */
const emProcesso = (d: () => Dependencias, enviados: EntradaLlm[] = []) => async (e: EntradaLlm): Promise<RespostaLlm> => {
  enviados.push(JSON.parse(JSON.stringify(e)));
  return JSON.parse(JSON.stringify(await executar(JSON.parse(JSON.stringify(e)), d())));
};

test("análise nova: coleta, início, oportunidades em paralelo com progresso de cada uma e síntese", async () => {
  const estado = new EstadoMemoria(), eventos: ProgressoLlm[] = [], enviados: EntradaLlm[] = [];
  const t0 = Date.now();
  const fim = await analisarComLlm(async (cb) => { cb({ etapa: "amostra", consultas: 0, bytes: 0 }); return C; }, (p) => eventos.push(p), { chamar: emProcesso(() => deps("lento", estado), enviados) });
  const ms = Date.now() - t0;
  assert.equal(fim.fase, "pronto", JSON.stringify(fim.erro));
  assert.equal(fim.resultado?.estado.completa, true);
  // paralelo: as N oportunidades levam perto de UMA ida (1,2 s), mais a síntese (1,2 s); em série seriam N+1 idas
  assert.ok(ms < 1200 * 3.2, `total ${ms} ms para ${C.dossies.length} oportunidades`);
  assert.ok(srv.maxEmCurso() >= Math.min(3, C.dossies.length));
  // progresso: coleta, iniciando, cada oportunidade analisando e pronta, síntese analisando e pronta
  const fases = [...new Set(eventos.map((e) => e.fase))];
  assert.deepEqual(fases, ["coleta", "iniciando", "oportunidades", "sintese", "pronto"]);
  assert.ok(eventos.some((e) => e.oportunidades.filter((o) => o.estado === "analisando").length >= 2), "mais de uma ao mesmo tempo");
  assert.ok(eventos.at(-1)!.oportunidades.every((o) => o.estado === "pronta" && o.ms != null));
  assert.equal(eventos.at(-1)!.sintese.estado, "pronta");
  assert.equal(fim.coleta?.etapa, "pronto");
  // o que foi à função: iniciar com os dossiês; cada oportunidade só com o id e o índice; a síntese só com o id
  assert.equal(enviados[0].modo, "iniciar");
  assert.ok("dossies" in enviados[0]);
  assert.ok(enviados.filter((e) => e.modo === "oportunidade").every((e) => Object.keys(e).sort().join() === "analiseId,idioma,indice,modo" || Object.keys(e).sort().join() === "analiseId,indice,modo"));
  assert.equal(enviados.filter((e) => e.modo === "sintese").length, 1);
  assert.equal(fim.uso?.consumido, true);
});

test("uma oportunidade falha: as outras e a síntese valem; continuar roda só ela e refaz a síntese", async () => {
  const estado = new EstadoMemoria();
  let cenario = "o2-falha";
  const chamar = emProcesso(() => deps(cenario, estado));
  const fim = await analisarComLlm(async () => C, () => undefined, { chamar });
  assert.equal(fim.fase, "erro");
  assert.equal(fim.resultado?.estado.falhas, 1);
  assert.equal(fim.resultado?.estado.sintese, true);
  assert.ok(fim.oportunidades.find((o) => o.estado === "falhou")?.erro);
  assert.equal(estado.json<RegistroUso>(CHAVE_USO)?.status, "usado", "a primeira pronta contou o uso");
  cenario = "ok";
  const antes = srv.pedidos.length;
  const eventos: ProgressoLlm[] = [];
  const fim2 = await continuarAnalise(fim.resultado!, (p) => eventos.push(p), { chamar });
  assert.equal(fim2.fase, "pronto", JSON.stringify(fim2.erro));
  assert.equal(srv.pedidos.length, antes + 2, "só a oportunidade que faltava e a síntese");
  assert.ok(eventos.some((e) => e.oportunidades.filter((o) => o.estado === "pronta").length === C.dossies.length - 1), "as prontas aparecem prontas desde o começo");
});

test("dado pessoal achado na coleta: nada vai à função", async () => {
  const enviados: EntradaLlm[] = [];
  const fim = await analisarComLlm(async () => ({ ...C, achados: [{ onde: "o1.secoes.negocio", tipo: "cpf" }] }), () => undefined, { chamar: emProcesso(() => deps("ok", new EstadoMemoria()), enviados) });
  assert.equal(fim.fase, "erro");
  assert.equal(fim.erro?.codigo, "pacote-com-dado-pessoal");
  assert.equal(enviados.length, 0);
});

test("nenhuma oportunidade pronta: a reserva é liberada e a análise do ambiente continua livre", async () => {
  const estado = new EstadoMemoria();
  const fim = await analisarComLlm(async () => C, () => undefined, { chamar: emProcesso(() => deps("ops-falham", estado)) });
  assert.equal(fim.fase, "erro");
  assert.equal(fim.erro?.codigo, "llm-indisponivel");
  assert.equal(estado.json<RegistroUso>(CHAVE_USO)?.status, "liberado");
});
