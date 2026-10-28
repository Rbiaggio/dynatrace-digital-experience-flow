/* Testes da análise por LLM (app/api e lib/llm*.ts da tela). Empacota cada *.test.ts com o esbuild do app (o
   mesmo empacotador do dt-app: resolve os imports sem extensão da tela), troca os SDKs da plataforma e o llm.local.ts
   por falsos e roda com node --test. O LLM é SIMULADO (servidor local) e as consultas do dossiê usam um executor falso; nada vai a tenant nem ao Azure.
     node app/api/testes/rodar.mjs                 # todos os testes
     node app/api/testes/rodar.mjs uso prompt      # só os arquivos que contêm esses nomes
     node app/api/testes/rodar.mjs --exemplo <pasta>          # dossiês de exemplo + resposta simulada + PDF (prévia)
*/
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(AQUI, "../..");
const { build } = createRequire(path.join(APP, "package.json"))("esbuild");
const SAIDA = path.join(os.tmpdir(), "def-llm-testes");
fs.mkdirSync(SAIDA, { recursive: true });

const FALSOS = {
  "@dynatrace-sdk/client-state": "sdk-client-state.ts",
  "@dynatrace-sdk/app-environment": "sdk-app-environment.ts",
  "@dynatrace-sdk/http-client": "sdk-http-client.ts",
  "@dynatrace-sdk/client-query": "sdk-client-query.ts",
};
const falsos = (real) => ({
  name: "falsos",
  setup(b) {
    b.onResolve({ filter: /^@dynatrace-sdk\/(client-state|app-environment|http-client|client-query)$/ }, (a) => ({ path: path.join(AQUI, "falsos", FALSOS[a.path]) }));
    // nos testes, o llm.local.ts é o falso (aponta para o servidor simulado)
    if (!real) b.onResolve({ filter: /^\.\/llm\.local$/ }, () => ({ path: path.join(AQUI, "falsos", "llm.local.ts") }));
  },
});
async function empacotar(entrada, real = false) {
  const saida = path.join(SAIDA, path.basename(entrada).replace(/\.ts$/, ".mjs"));
  await build({ entryPoints: [entrada], outfile: saida, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "error", plugins: [falsos(real)],
                banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  return saida;
}

const args = process.argv.slice(2);
if (args[0] === "--exemplo") {
  const arquivo = await empacotar(path.join(AQUI, "exemplo.ts"));
  const r = spawnSync(process.execPath, [arquivo, ...args.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
const testes = fs.readdirSync(AQUI).filter((f) => f.endsWith(".test.ts") && (!args.length || args.some((a) => f.includes(a))));
const arquivos = [];
for (const t of testes) arquivos.push(await empacotar(path.join(AQUI, t)));
const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...arquivos], { stdio: "inherit" });
process.exit(r.status ?? 1);
