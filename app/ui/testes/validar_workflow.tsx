/* Validação do workflow do app (1.47.7), sem tenant: o título leva o nome do app na língua de quem cria o workflow, e a
   Configuração acha o workflow deste app pelo título de hoje (nas duas línguas) e pelos de antes ("DEF | ..."), com a
   ação def-agregar deste app, numa API de workflows falsa (duas buscas, sem repetir o mesmo workflow).
   Roda com: npx esbuild ui/testes/validar_workflow.tsx --bundle --platform=node --format=cjs --outfile=<saida>.cjs && node <saida>.cjs */
import { acharWorkflow, definicoesWorkflows, intentCriarWorkflow, TITULOS_CICLO } from "../app/lib/workflows";

let falhas = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK " : "FALHA"} ${msg}`); if (!c) falhas++; };
const idioma = (i: "pt" | "en") => { (globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA = i; };
const APP = "my.digital.experience.flow";

idioma("pt");
ok(definicoesWorkflows(APP)[0].title === TITULOS_CICLO.pt && TITULOS_CICLO.pt.startsWith("Digital Experience Flow | "), `título em português: ${definicoesWorkflows(APP)[0].title}`);
ok(definicoesWorkflows(APP)[0].description.startsWith("Digital Experience Flow: a cada 5 minutos"), "descrição em português");
idioma("en");
ok(intentCriarWorkflow(APP).title === TITULOS_CICLO.en, `título em inglês (o do botão Criar o workflow): ${intentCriarWorkflow(APP).title}`);
ok(definicoesWorkflows(APP)[0].description.startsWith("Digital Experience Flow: every 5 minutes"), "descrição em inglês");
ok(!/\bDEF\b/.test(JSON.stringify(definicoesWorkflows(APP))), "nenhum \"DEF\" no workflow novo");

/** API de workflows falsa: a busca filtra pelo trecho do título; cada workflow tem uma tarefa com a ação. */
function api(lista: { id: string; title: string; action: string }[]) {
  const buscas: string[] = [];
  return { buscas, c: { chamar: async (_m: string, url: string, _c?: unknown, params?: Record<string, string>) => {
    if (params?.search != null) { buscas.push(params.search); return { status: 200, dados: { results: lista.filter((w) => w.title.includes(params.search)).map(({ id, title }) => ({ id, title })) } }; }
    const w = lista.find((x) => url.endsWith(`/${x.id}`));
    return w ? { status: 200, dados: { tasks: { agregar: { action: w.action } }, modificationInfo: { createdTime: "2026-10-28T12:00:00Z" } } } : { status: 404, dados: {} };
  } } };
}
const run = async () => {
  const antigo = api([{ id: "w1", title: "DEF | Agregados, sessoes e horas a cada 5 min", action: `${APP}:def-agregar` }]);
  ok((await acharWorkflow(antigo.c, APP) as { id: string } | null)?.id === "w1", "acha o workflow de antes da 1.47.7 (\"DEF | ...\")");
  ok(antigo.buscas.length === 2, `duas buscas: ${antigo.buscas.join(" e ")}`);
  const novoEn = api([{ id: "w2", title: TITULOS_CICLO.en, action: `${APP}:def-agregar` }]);
  ok((await acharWorkflow(novoEn.c, APP) as { id: string } | null)?.id === "w2", "acha o de hoje criado em inglês, com a tela em português ou inglês");
  idioma("pt");
  ok((await acharWorkflow(novoEn.c, APP) as { id: string } | null)?.id === "w2", "o de inglês também com a tela em português");
  const outroApp = api([{ id: "w3", title: TITULOS_CICLO.pt, action: "my.outro.app:def-agregar" }]);
  ok(await acharWorkflow(outroApp.c, APP) === null, "mesmo título com a ação de outro app: não é deste");
  const semPermissao = { c: { chamar: async () => ({ status: 403, dados: {} }) } };
  ok(await acharWorkflow(semPermissao.c, APP) === "sem-permissao", "sem permissão de ler workflows: \"sem-permissao\"");
  console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
};
void run();
