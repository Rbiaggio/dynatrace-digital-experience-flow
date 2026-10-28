/**
 * App function "analise-llm" do DEF: "Analisar com LLM" (análise estrutural, 1.35).
 *
 * Chamada pela tela (POST /api/analise-llm, lib/llmCliente.ts) com { modo, ... , idioma? }:
 * - modo "status": regra de uso e a análise já feita (com o que já terminou), sem gastar nada;
 * - modo "iniciar": os dossiês de evidências (lib/dossie.ts) e o contexto -> validação, sanitização de novo,
 *   verificação de privacidade, regra de uso (liberados sem limite; os demais 1 por ambiente: reserva) e guarda.
 *   Com analiseId: retomada (reserva de novo se a análise ainda não contou);
 * - modo "oportunidade": uma oportunidade (o dossiê guardado) -> uma ida ao LLM (API Messages): Problema x Causa x Solução x Benefício. A primeira que termina bem conta o uso do ambiente;
 * - modo "sintese": só os resultados das oportunidades -> causas estruturais comuns, priorização, ondas de 30, 60 e
 *   90 dias e iniciativas recomendadas;
 * - modo "liberar": nenhuma oportunidade terminou: a reserva volta a ficar livre;
 * - modo "registros": registros de uso para quem está na lista de liberados.
 * Cada chamada faz no máximo uma ida ao LLM, abaixo de 80 s no esperado e do teto de 120 s da app function.
 * A identidade vem da plataforma (token de quem chamou), nunca do navegador. A chave do LLM fica no pacote da
 * função (llm.local.ts, fora do git) e nunca volta na resposta.
 */
import { executar } from "./lib/analiseLlm";
import { dependenciasReais } from "./lib/dependenciasLlm";

export default async function (payload: unknown) {
  return executar(payload, dependenciasReais());
}
