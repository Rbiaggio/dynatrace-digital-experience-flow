/* MODELO do llm.local.ts: a análise por LLM ("Analisar com LLM", nas Oportunidades de melhoria) é OPCIONAL.
   - Sem configurar nada: o build cria o llm.local.ts a partir deste modelo (scripts/garantir-llm-local.mjs) e o botão
     não aparece para ninguém (a função responde "não configurado").
   - Para ligar: edite app/api/lib/llm.local.ts (está no .gitignore e NUNCA vai para o git) com a sua chave, o endereço,
     o modelo e a lista de quem pode pedir. O conteúdo entra só no pacote da função do app (servidor), nunca no
     navegador; mas vai junto no artefato do app instalado no ambiente: use uma chave própria deste uso, que possa ser
     revogada, e libere a saída para o endereço do LLM na lista de conexões externas do AppEngine (docs/llm.md).

   Protocolo: API Messages no formato da Anthropic (POST {baseURL}/v1/messages, cabeçalhos x-api-key e
   anthropic-version 2023-06-01). Serve a Anthropic API (baseURL https://api.anthropic.com) ou um recurso do
   Azure AI Foundry com modelo da Anthropic (baseURL https://{recurso}.services.ai.azure.com/anthropic). */
export const LLM = {
  /** chave da API (Anthropic ou Azure AI Foundry) */
  apiKey: "SUA-CHAVE",
  /** https://api.anthropic.com ou https://SEU-RECURSO.services.ai.azure.com/anthropic (sem /v1 no fim) */
  baseURL: "https://SEU-RECURSO.services.ai.azure.com/anthropic",
  /** id do modelo (Anthropic API) ou nome do deployment (Azure AI Foundry; nome errado dá 404 DeploymentNotFound) */
  model: "NOME-DO-MODELO",
  /** quem pode pedir a análise, sem limite: e-mails ("ana@empresa.example") ou domínios inteiros ("@empresa.example").
      Vazio = ninguém pede (o botão não aparece). */
  liberados: [] as string[],
  /* Opcionais (podem ficar de fora):
  timeoutMs: 100000,               // teto de cada ida ao LLM; a app function tem teto de 120 s
  esforcoOportunidade: "low",      // output_config.effort de cada oportunidade (low cabe abaixo de 80 s)
  esforcoSintese: "low",           // output_config.effort do resumo estrutural
  maxTokensOportunidade: 12000,    // em modelos com raciocínio, ele conta dentro de max_tokens
  maxTokensSintese: 12000,
  saidaEstruturada: true,          // output_config.format (JSON com esquema); false = JSON pedido só no texto
  */
};
