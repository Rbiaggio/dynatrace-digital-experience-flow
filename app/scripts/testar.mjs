// npm test: todos os testes que rodam sem tenant e sem LLM de verdade.
//  1. análise por LLM (app/api/testes: regra de uso, função, prompt, sanitização, com LLM simulado num servidor local);
//  2. validações da tela (app/ui/testes/validar_*.tsx: modelo de custo, mapas, Session Replay), empacotadas com o esbuild.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(APP, "package.json"))("esbuild");
let falhas = 0;
const rodar = (titulo, args) => {
  console.log(`\n=== ${titulo}`);
  const r = spawnSync(process.execPath, args, { stdio: "inherit", cwd: APP });
  if (r.status !== 0) { falhas++; console.log(`FALHOU: ${titulo}`); }
};

rodar("análise por LLM (app/api/testes)", [path.join(APP, "api", "testes", "rodar.mjs")]);

const pasta = path.join(APP, "ui", "testes"), saida = fs.mkdtempSync(path.join(os.tmpdir(), "def-ui-testes-"));
for (const f of fs.readdirSync(pasta).filter((x) => /^validar_.*\.tsx$/.test(x))) {
  const out = path.join(saida, f.replace(/\.tsx$/, ".cjs"));
  await build({ entryPoints: [path.join(pasta, f)], outfile: out, bundle: true, platform: "node", format: "cjs", jsx: "automatic",
                loader: { ".css": "empty", ".svg": "dataurl", ".jpg": "dataurl", ".png": "dataurl" }, logLevel: "error" });
  rodar(`tela: ${f}`, [out]);
}
console.log(falhas ? `\n${falhas} conjunto(s) com falha` : "\nTodos os testes passaram");
process.exit(falhas ? 1 : 0);
