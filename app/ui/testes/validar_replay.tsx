/* Validação do botão Replay (1.41), sem tenant: desde a 1.41 o app não lê user.sessions, e o botão segue a habilitação do
   Session Replay da aplicação (Settings): ativo quando ela grava (ou não se sabe), abrindo a sessão no Users & Sessions;
   cinza, sem ação, com o motivo na dica, quando não grava (ou só em crash e a sessão não teve crash). Confere também a
   leitura dos objetos de habilitação (web e mobile, com o padrão do ambiente), o escopo de cada aplicação e o rótulo
   "Ver sessões e Replay".
   Roda com: npx esbuild ui/testes/validar_replay.tsx --bundle --platform=node --format=cjs --jsx=automatic --outfile=<saida>.cjs && node <saida>.cjs */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LinksSessao } from "../app/components/Links";
import { estadoReplay, escopoDaApp, lerReplayApps, replayDaApp, rotuloVerSessoes, type ReplayApps } from "../app/lib/replay";
import type { AppInfo } from "../app/lib/graph";

(globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA = "pt";
let falhas = 0;
const ok = (cond: boolean, nome: string, detalhe = "") => { console.log(`${cond ? "OK " : "FALHA"} ${nome}${cond || !detalhe ? "" : `: ${detalhe}`}`); if (!cond) falhas++; };

const apps: AppInfo[] = [
  { id: "0f1e2d3c4b5a6978", nome: "Banco Demo PF", canal: "web", entidade: "APPLICATION-0F1E2D3C4B5A6978" },
  { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", nome: "App Mobile", canal: "mobile", entidade: "MOBILE_APPLICATION-1A2B3C4D5E6F4A7B" },
  { id: "a1b2c3d4e5f60718", nome: "Portal Web", canal: "web" },
];

console.log("== estadoReplay: pela habilitação da aplicação (has_replay só se alguém ainda informar)");
ok(estadoReplay(true, "desligado").ativo === true, "has_replay true vence até a aplicação 'desligada' (o Dynatrace tem o replay)");
ok(estadoReplay(true, "desconhecido").motivo === null, "ativo não tem motivo");
const desl = estadoReplay(null, "desligado"); ok(!desl.ativo && /desligado nesta aplicação/.test(desl.motivo ?? ""), "aplicação desligada: motivo da aplicação", desl.motivo ?? "");
ok(/desligado nesta aplicação/.test(estadoReplay(false, "desligado").motivo ?? ""), "aplicação desligada com has_replay false: o mesmo motivo");
ok(/só em crash/.test(estadoReplay(false, "so_crash").motivo ?? ""), "mobile só em crash");
ok(/não tem replay/.test(estadoReplay(false, "ligado").motivo ?? ""), "aplicação ligada e sessão sem replay");
const lig = estadoReplay(null, "ligado"); ok(lig.ativo && /Users & Sessions/.test(lig.motivo ?? ""), "aplicação ligada: ativo, a dica diz que abre no Users & Sessions", lig.motivo ?? "");
ok(estadoReplay(null, "desconhecido").ativo, "sem leitura de Settings: ativo (o Users & Sessions mostra se houver)");
ok(!estadoReplay(null, "so_crash").ativo && estadoReplay(null, "so_crash", true).ativo, "só em crash: ativo só na sessão com crash");
ok(/não tem replay/.test(estadoReplay(false, "desconhecido").motivo ?? ""), "sem leitura de Settings e has_replay false: 'não tem replay'");

console.log("== escopo de Settings de cada aplicação");
ok(escopoDaApp("0f1e2d3c4b5a6978", apps).escopo === "APPLICATION-0F1E2D3C4B5A6978", "web pela entidade da lista");
ok(escopoDaApp("a1b2c3d4e5f60718", apps).escopo === "APPLICATION-A1B2C3D4E5F60718" && !escopoDaApp("a1b2c3d4e5f60718", apps).mobile, "web sem entidade na lista: APPLICATION-<id>");
const mob = escopoDaApp("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", apps); ok(mob.escopo === "MOBILE_APPLICATION-1A2B3C4D5E6F4A7B" && mob.mobile, "mobile pela entidade da lista");
const mobSem = escopoDaApp("2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e", apps); ok(mobSem.escopo === null && mobSem.mobile, "mobile sem entidade: sem escopo, mas mobile (padrão mobile do ambiente)");

console.log("== leitura dos objetos de habilitação (cliente falso)");
const itens: Record<string, unknown[]> = {
  "builtin:rum.web.enablement": [
    { scope: "environment", value: { rum: { enabled: true }, sessionReplay: { enabled: false, costAndTrafficControl: 100 } } },
    { scope: "APPLICATION-0F1E2D3C4B5A6978", value: { rum: { enabled: true }, sessionReplay: { enabled: true, costAndTrafficControl: 100 } } },
  ],
  "builtin:rum.mobile.enablement": [
    { scope: "environment", value: { rum: { enabled: true }, sessionReplay: { fullSessionReplay: true, onCrash: true } } },
    { scope: "MOBILE_APPLICATION-1A2B3C4D5E6F4A7B", value: { rum: { enabled: true }, sessionReplay: { onCrash: true } } },
    { scope: "MOBILE_APPLICATION-3C4D5E6F70814B9C", value: { rum: { enabled: false }, sessionReplay: { onCrash: false } } },
  ],
};
const chamadas: string[] = [];
const clienteFalso = { async chamar(_m: string, _u: string, _c?: unknown, params?: Record<string, string>) { chamadas.push(params?.schemaIds ?? "?"); return { status: 200, dados: { items: itens[params?.schemaIds ?? ""] ?? [] } }; } };
(async () => {
  const mapa = await lerReplayApps(clienteFalso as any);
  ok(mapa.lido && chamadas.length === 2, "lê os dois esquemas", chamadas.join(","));
  ok(mapa.padraoWeb === "desligado" && mapa.padraoMobile === "ligado", "padrões do ambiente: web desligado, mobile ligado", `${mapa.padraoWeb}/${mapa.padraoMobile}`);
  ok(replayDaApp("0f1e2d3c4b5a6978", apps, mapa) === "ligado", "PF: objeto próprio ligado");
  ok(replayDaApp("a1b2c3d4e5f60718", apps, mapa) === "desligado", "Portal Web sem objeto: herda o padrão web (desligado)");
  ok(replayDaApp("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", apps, mapa) === "so_crash", "App Mobile: objeto próprio só em crash");
  ok(replayDaApp("2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e", apps, mapa) === "ligado", "mobile sem objeto: herda o padrão mobile (ligado)");
  const semPermissao = await lerReplayApps({ async chamar() { return { status: 403, dados: { error: "x" } }; } } as any);
  ok(!semPermissao.lido && replayDaApp("0f1e2d3c4b5a6978", apps, semPermissao) === "desconhecido", "403 em Settings: tudo 'desconhecido' (vale só o has_replay)");
  const comErro = await lerReplayApps({ async chamar() { throw new Error("fora da plataforma"); } } as any);
  ok(!comErro.lido, "erro na chamada: 'desconhecido', sem lançar");
  ok(replayDaApp("0f1e2d3c4b5a6978", apps, null) === "desconhecido", "mapa ainda não lido (null): desconhecido");

  console.log("== rótulo dos botões que abrem a lista");
  ok(rotuloVerSessoes("desligado") === "Ver sessões" && rotuloVerSessoes("ligado") === "Ver sessões e Replay" && rotuloVerSessoes("desconhecido") === "Ver sessões e Replay", "'e Replay' sai só com a aplicação desligada");

  console.log("== LinksSessao renderizado (fora da plataforma os links nativos viram texto; o Replay inativo é um span cinza com a dica)");
  const html = (hasReplay: boolean | null, daApp: Parameters<typeof estadoReplay>[1]) => renderToStaticMarkup(<LinksSessao id="S-0" inicio="2026-10-19T10:00:00Z" fim={null} hasReplay={hasReplay} temErro replayDaApp={daApp} />);
  const inativo = html(null, "desligado");
  ok(inativo.includes('class="acao-icone sem-replay"') && inativo.includes('aria-disabled="true"') && inativo.includes("Session Replay desligado nesta aplicação"), "inativo: classe sem-replay, aria-disabled e a dica com o motivo");
  ok(!inativo.includes("open-session-replay"), "inativo não tem link do Session Replay");
  const ativo = html(true, "ligado");
  ok(!ativo.includes("sem-replay") && ativo.includes("Replay"), "ativo: sem a classe de inativo (fora da plataforma o link vira texto 'fora da plataforma')");
  const semReplay = html(false, "ligado");
  ok(semReplay.includes("sem-replay") && semReplay.includes("Esta sessão não tem replay"), "sessão sem replay numa aplicação ligada: inativo com a dica da sessão");
  const padrao = renderToStaticMarkup(<LinksSessao id="S-0" inicio={null} fim={null} hasReplay={null} temErro={false} />);
  ok(!padrao.includes("sem-replay"), "sem replayDaApp (desconhecido): ativo");
  ok(padrao.includes("Sessão") && !padrao.includes("Erros"), "Sessão sempre; Erros só com erro");

  console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})();
