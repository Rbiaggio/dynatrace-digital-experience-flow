/* Exemplo para a documentação e para a prévia: os dossiês montados pelo código da tela (lib/dossie.ts) com o executor
   falso dos testes (PII inventada, que sai mascarada), e uma resposta SIMULADA (servidor local) passando pela função
   inteira: iniciar, as oportunidades em paralelo e a síntese. Grava dossies.json, resposta_simulada.json,
   resposta_simulada.md e o PDF da análise (o mesmo gerador do "Baixar a análise (PDF)" da tela).
   Uso: node app/api/testes/rodar.mjs --exemplo <pasta de saída> */
import fs from "node:fs";
import path from "node:path";
import { coletarDossies } from "../../ui/app/lib/dossie";
import { bytesDe } from "../../ui/app/lib/llmPacote";
import { analisarComLlm, type EntradaLlm, type RespostaLlm } from "../../ui/app/lib/llmCliente";
import { gerarAnaliseLlmPdf } from "../../ui/app/lib/relatorioLlm";
import { executar, type Dependencias } from "../lib/analiseLlm";
import { EstadoMemoria } from "./falsos/estado";
import { subirServidorLLM } from "./falsos/servidorLLM";
import { RESPOSTAS_EXEMPLO } from "./falsos/analiseExemplo";
import { entradaDossieComPii } from "./falsos/fixture";

const pasta = process.argv[2] ?? ".";
fs.mkdirSync(pasta, { recursive: true });
const coleta = await coletarDossies(entradaDossieComPii());
fs.writeFileSync(path.join(pasta, "dossies.json"), JSON.stringify({ dossies: coleta.dossies, contexto: coleta.contexto, consultas: coleta.consultas }, null, 1));
console.log(`dossiês: ${coleta.dossies.map((d) => `${d.id} ${bytesDe(d)} B`).join(", ")} · verificação: ${coleta.achados.length} achados`);

const srv = await subirServidorLLM(RESPOSTAS_EXEMPLO);
const estado = new EstadoMemoria();
const d: Dependencias = {
  estado, usuario: () => ({ id: "u-1", nome: "Ana Usuária", email: "ana@usuarios.example" }),
  ambiente: () => ({ id: "abc12345", url: "https://abc12345.apps.dynatrace.com" }), versaoApp: () => "1.35.0",
  // a Ana entra na lista de e-mails extras: sem isso a regra de quem pode pedir recusa o exemplo (1.47.10)
  llm: { apiKey: "sk-teste-simulado", baseURL: srv.url("ok"), model: "modelo-teste", liberados: ["ana@usuarios.example"] },
};
const chamar = async (e: EntradaLlm): Promise<RespostaLlm> => JSON.parse(JSON.stringify(await executar(JSON.parse(JSON.stringify(e)), d)));
const fim = await analisarComLlm(async () => coleta, () => undefined, { chamar });
await srv.fechar();
if (!fim.resultado) throw new Error(`sem resultado: ${JSON.stringify(fim.erro)}`);
fs.writeFileSync(path.join(pasta, "resposta_simulada.json"), JSON.stringify(fim.resultado, null, 1));
fs.writeFileSync(path.join(pasta, "resposta_simulada.md"), fim.resultado.markdown);
fs.writeFileSync(path.join(pasta, "analise_llm_simulada.pdf"), gerarAnaliseLlmPdf({ resultado: fim.resultado, escopo: "Todas as aplicações", periodo: fim.resultado.periodo, geradoEm: Date.now(), geradoPor: "Ana Usuária" }));
console.log(`resposta simulada: fase ${fim.fase} · ${fim.resultado.estado.prontas}/${fim.resultado.estado.total} oportunidades · síntese ${fim.resultado.estado.sintese} · motor "${fim.resultado.motor.nome}"`);
console.log("gravado em", pasta);
