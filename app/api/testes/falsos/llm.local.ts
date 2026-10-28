/* llm.local.ts falso dos testes: o teste aponta baseURL para o servidor simulado (http://127.0.0.1:PORTA/<cenario>/anthropic). */
export const LLM = { apiKey: "sk-teste-SEGREDO-0123456789", baseURL: "http://127.0.0.1:1/ok/anthropic", model: "modelo-teste", liberados: ["@empresa.example"], timeoutMs: 5000 } as {
  apiKey: string; baseURL: string; model: string; timeoutMs?: number; liberados?: string[];
};
