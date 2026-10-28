// Antes de build, dev e deploy: se app/api/lib/llm.local.ts não existe, cria a partir do modelo (llm.local.example.ts).
// O modelo deixa a análise por LLM desligada; para ligar, edite o llm.local.ts (fora do git). Ver docs/llm.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "api", "lib");
const local = path.join(lib, "llm.local.ts");
if (!fs.existsSync(local)) {
  fs.copyFileSync(path.join(lib, "llm.local.example.ts"), local);
  console.log("llm.local.ts criado a partir do modelo: a análise por LLM fica desligada até você configurar (docs/llm.md).");
}
