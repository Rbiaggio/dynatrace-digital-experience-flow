/* Validação dos exemplos de erro (1.47.10), sem tenant: numa linha já fechada (exemplos completos e as listas de traces e
   de sessões filtradas uma a uma, como lib/aovivo.ts grava), a leitura seguinte devolve só os exemplos de verdade; antes,
   as listas desalinhadas formavam um par trace x sessão que não existe (um exemplo sem hora a mais). As listas de texto
   de antes continuam valendo para a linha que só tem elas.
   Roda com: npx esbuild ui/testes/validar_exemplos.tsx --bundle --platform=node --format=cjs --outfile=<saida>.cjs && node <saida>.cjs */
import { exemplosDe } from "../app/lib/agregados";

let falhas = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK " : "FALHA"} ${msg}`); if (!c) falhas++; };

// 2 ocorrências, a primeira sem trace (erro de tela): era o caso do print com "2 ocorrências" e 3 linhas, uma sem hora
const exemplos = [
  { h: "2026-10-28T12:18:03Z", t: null, s: "S1", d: null },
  { h: "2026-10-28T12:17:11Z", t: "T2", s: "S2", d: 8 },
];
const fechada = { exemplos, amostra_t: exemplos.map((x) => x.t).filter(Boolean), amostra_s: exemplos.map((x) => x.s).filter(Boolean) };
const r = exemplosDe(fechada);
ok(r.length === 2, `linha fechada: ${r.length} exemplos (os 2 de verdade)`);
ok(r.every((x) => x.h), "nenhum exemplo sem hora");
ok(JSON.stringify(r.map((x) => `${x.t}|${x.s}`)) === JSON.stringify(["null|S1", "T2|S2"]), "os pares trace x sessão são os gravados");
ok(JSON.stringify(exemplosDe(exemplosDe(fechada).length ? { ...fechada, exemplos: r } : fechada).map((x) => x.t)) === JSON.stringify(r.map((x) => x.t)), "reler a linha não muda nada");
const ra = exemplosDe({ amostra_t: ["TA", "TB"], amostra_s: ["SA", "SB"] });
ok(ra.length === 2 && ra.every((x) => x.h === null), "linha de antes (só as listas): os exemplos saem delas, sem hora");
console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
