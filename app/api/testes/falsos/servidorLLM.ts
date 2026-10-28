/* LLM SIMULADO: servidor HTTP local que responde como a API Messages da Anthropic no Azure AI Foundry
   (POST {baseURL}/v1/messages). O cenário vai no caminho do baseURL: http://127.0.0.1:PORTA/<cenario>/anthropic.
   O tipo de chamada sai do pedido: esquema com "resumo_executivo" = síntese; senão, uma oportunidade (o id dela vem do
   texto "Oportunidade oN:"). Cenários: ok, lento, 401, 429, 529, 500, formato400 (recusa output_config.format e aceita
   sem ele), recusa, vazio, texto (sem JSON), cortada (max_tokens), json-errado, eco-chave (401 que repete a chave),
   sintese-falha (oportunidades ok, síntese 529), o2-falha (só a oportunidade o2 com 529), ops-falham (toda
   oportunidade com 529). Guarda cada pedido para conferir. */
import http from "node:http";
import type { AddressInfo } from "node:net";

/** Resposta de UMA oportunidade, no formato do esquema (com travessão e id escapado de propósito, para a leitura limpar). */
export const OP_TESTE = {
  problema: { resumo: "Pix falha com HTTP 500 — em 20% das chamadas.", numeros_chave: ["150 clientes com erro (negocio.paginas)", "62% de falha no RJ (por_estado)"] },
  causa_raiz: {
    afirmacao: "pagamentos rejeita a requisição em 0,5 ms antes de chamar o banco.", causa_estrutural: "Falta de failover e de tratamento de erro no canal.",
    assinatura: "pagamentos POST /contas/{id}/pix, server.js:26, desde 16/10 19h",
    cadeia_de_evidencias: [{ evidencia: "20 de 20 traces com origem em pagamentos", fonte: "backend.falha.traces.origem_da_falha", o_que_prova: "a falha nasce ali" }, { evidencia: "0 chamadas ao banco na falha", fonte: "backend.falha.traces.o_que_a_origem_chamou_media", o_que_prova: "decide antes de processar" }],
    confianca: "alta", justificativa_da_confianca: "cadeia sem lacuna",
    hipoteses_descartadas: [{ hipotese: "CPU", por_que: "3% de CPU" }, { hipotese: "deploy", por_que: "nenhum evento" }],
    hipoteses_em_aberto: [{ hipotese: "regra regional", como_confirmar: "ler o handler" }],
  },
  solucao: { correcao_rapida: [{ acao: "Desligar a condição", onde: "pagamentos", prazo: "1 a 3 dias" }], mudanca_estrutural: [{ acao: "Failover por região", camada: "resiliencia", detalhe: "evita o 500 no canal" }, { acao: "camada inválida", camada: "nuvem", detalhe: "cai em arquitetura" }] },
  beneficio: { sessoes_afetadas_por_dia: 1142, sessoes_recuperadas_por_dia: 1036, sessoes_recuperadas_por_mes: 31080, conversao_atual_pct: 0, conversao_esperada_pct: 100, conta: "136 em 2 h x 12 x 0,9", premissas: ["mês = dia x 30"], o_que_nao_da_para_medir: "valor das transações" },
  esforco: { nivel: "M", justificativa: "dois times" },
  validacao: { indicador_def: "Não concluíram em /pix", linha_de_base: "136 em 2 h", meta: "menos de 10", como_medir: "7 dias" },
  riscos: ["Pix duplicado sem idempotência — cuidado"],
};
/** Resposta da síntese (ids que não existem e serviço fora do catálogo de propósito, para a leitura tirar). */
export const SINTESE_TESTE = {
  resumo_executivo: "O que mais custa é o Pix — e a o2 tem a mesma causa.",
  causas_estruturais_comuns: [{ causa: "Falha decidida no código sem failover", oportunidades: ["o1", "o2", "o9"], evidencias_que_ligam: ["mesma função falha()"], o_que_separa: "serviços diferentes", mudanca_estrutural: "contrato de erro e failover", beneficio_sessoes_mes: 40000, confianca: "media" }],
  priorizacao: [{ id: "o2", ordem: 2, razao: "segunda" }, { id: "o1", ordem: 1, razao: "maior benefício" }, { id: "o9", ordem: 3, razao: "não existe" }],
  plano_em_ondas: [{ onda: "30", objetivo: "Estancar", acoes: ["Corrigir a o1"], oportunidades: ["o1"], indicador_def: "não concluíram" }, { onda: "120", objetivo: "Inválida", acoes: ["x"], oportunidades: ["o2"], indicador_def: "x" }],
  iniciativas_recomendadas: [{ servico: "correcao-aplicacoes", oportunidades: ["o1", "o2"], como_ajuda: "Correção." }, { servico: "fora-do-catalogo", oportunidades: ["o1"], como_ajuda: "fora do catálogo" }],
  o_que_falta_medir: ["valor das transações"],
};
export interface RespostasSimuladas { oportunidade: unknown; sintese: unknown }

export type TipoPedido = "oportunidade" | "sintese";
export interface PedidoRecebido { cenario: string; tipo: TipoPedido; op: string | null; caminho: string; headers: http.IncomingHttpHeaders; corpo: Record<string, any> }
export interface ServidorLLM { url: (cenario: string) => string; pedidos: PedidoRecebido[]; fechar: () => Promise<void>; respostas: RespostasSimuladas; emCurso: () => number; maxEmCurso: () => number }

const json = (res: http.ServerResponse, status: number, corpo: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(corpo));
};
const mensagem = (texto: string | null, stop = "end_turn", tipo: TipoPedido = "oportunidade") => ({
  id: "msg_simulado", type: "message", role: "assistant", model: "modelo-teste", stop_reason: stop,
  content: texto == null ? [] : [{ type: "text", text: texto }], usage: tipo === "oportunidade" ? { input_tokens: 9000, output_tokens: 4800 } : { input_tokens: 6000, output_tokens: 3500 },
});
export const tipoDoPedido = (corpo: Record<string, any>): TipoPedido => (corpo.output_config?.format?.schema?.properties?.resumo_executivo || /<analises>/.test(String(corpo.messages?.[0]?.content ?? "")) ? "sintese" : "oportunidade");
export const opDoPedido = (corpo: Record<string, any>) => /Oportunidade (o\d+):/.exec(String(corpo.messages?.[0]?.content ?? ""))?.[1] ?? null;

export async function subirServidorLLM(respostas: RespostasSimuladas = { oportunidade: OP_TESTE, sintese: SINTESE_TESTE }, opcoes: { lentoMs?: number } = {}): Promise<ServidorLLM> {
  const pedidos: PedidoRecebido[] = [];
  let emCurso = 0, maxEmCurso = 0;
  const servidor = http.createServer((req, res) => {
    let bruto = "";
    req.on("data", (c) => (bruto += c));
    req.on("end", async () => {
      const partes = (req.url ?? "").split("/").filter(Boolean);
      const cenario = partes[0] ?? "ok";
      let corpo: Record<string, any> = {};
      try { corpo = JSON.parse(bruto); } catch { /* corpo inválido */ }
      const tipo = tipoDoPedido(corpo), op = opDoPedido(corpo);
      pedidos.push({ cenario, tipo, op, caminho: req.url ?? "", headers: req.headers, corpo });
      if (!(req.url ?? "").endsWith("/v1/messages") || req.method !== "POST") return json(res, 404, { type: "error", error: { type: "not_found_error", message: "Not found" } });
      const base = tipo === "sintese" ? respostas.sintese : respostas.oportunidade;
      const texto = JSON.stringify(typeof base === "function" ? (base as (c: Record<string, any>) => unknown)(corpo) : base);
      const ok = () => json(res, 200, mensagem(texto, "end_turn", tipo));
      const sobrecarga = () => json(res, 529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
      emCurso++; maxEmCurso = Math.max(maxEmCurso, emCurso);
      try {
        switch (cenario) {
          case "ok": return ok();
          case "lento": await new Promise((fim) => setTimeout(fim, opcoes.lentoMs ?? 3000)); if (!res.destroyed) ok(); return;
          case "sintese-falha": return tipo === "sintese" ? sobrecarga() : ok();
          case "o2-falha": return tipo === "oportunidade" && op === "o2" ? sobrecarga() : ok();
          case "ops-falham": return tipo === "oportunidade" ? sobrecarga() : ok();
          case "401": return json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
          case "eco-chave": return json(res, 401, { type: "error", error: { type: "authentication_error", message: `invalid key ${req.headers["x-api-key"]}` } });
          case "429": return json(res, 429, { type: "error", error: { type: "rate_limit_error", message: "Number of requests exceeded" } }, { "retry-after": "37" });
          case "529": return sobrecarga();
          case "500": return json(res, 500, { type: "error", error: { type: "api_error", message: "Internal server error" } });
          case "formato400":
            if (corpo.output_config?.format) return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "output_config.format: json_schema is not supported for this deployment" } });
            return json(res, 200, mensagem("Segue:\n```json\n" + texto + "\n```", "end_turn", tipo));
          case "recusa": return json(res, 200, mensagem(null, "refusal"));
          case "vazio": return json(res, 200, mensagem(null, "end_turn"));
          case "texto": return json(res, 200, mensagem("## Análise\n\nTexto livre — sem JSON."));
          case "cortada": return json(res, 200, mensagem(texto.slice(0, Math.floor(texto.length / 2)), "max_tokens", tipo));
          case "json-errado": return json(res, 200, mensagem(JSON.stringify({ outra: "coisa" })));
          default: return json(res, 404, { type: "error", error: { type: "not_found_error", message: "cenário desconhecido" } });
        }
      } finally { emCurso--; }
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const porta = (servidor.address() as AddressInfo).port;
  return {
    url: (cenario) => `http://127.0.0.1:${porta}/${cenario}/anthropic`,
    pedidos, respostas, emCurso: () => emCurso, maxEmCurso: () => maxEmCurso,
    fechar: () => new Promise<void>((ok) => { servidor.closeAllConnections?.(); servidor.close(() => ok()); }),
  };
}
