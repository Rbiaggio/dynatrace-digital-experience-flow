/* Chamada ao LLM: um LLM pela API Messages (formato da Anthropic: Anthropic API ou Azure AI Foundry), com fetch puro (o runtime da
   app function não é um Node completo; é o mesmo formato que o SDK do Foundry monta: baseURL .../anthropic,
   x-api-key e anthropic-version). Um motor só: se ele falhar, a função devolve o erro com o motivo, nunca troca de
   motor em silêncio. Nenhuma mensagem de erro leva a chave. */
import type { MotorLlm } from "../../ui/app/lib/llmCliente";

export type Esforco = "low" | "medium" | "high" | "xhigh" | "max";
export interface ConfigLLM {
  apiKey: string; baseURL: string; model: string;
  timeoutMs?: number; esforco?: Esforco; maxTokens?: number; saidaEstruturada?: boolean; liberados?: string[];
  /** effort e teto de tokens de cada chamada (sem isso, vale esforco/maxTokens; sem os dois, o padrão de cada uma) */
  esforcoOportunidade?: Esforco; esforcoSintese?: Esforco; maxTokensOportunidade?: number; maxTokensSintese?: number;
}
/** Medido em laboratório com um modelo servido pela API Messages (protótipo da análise estrutural, dossiês de 10 a 16 KB):
    - uma chamada por oportunidade, effort low: 62 a 71 s com 4,8 a 5,1 mil tokens de saída (cerca de US$ 0,33 a 0,38);
      com 8,5 mil tokens de saída, 110 s; effort medium passou de 115 s. A saída pedida aqui é mais curta (listas e textos
      menores) para ficar abaixo de 80 s; seis em paralelo levaram o mesmo que a mais lenta;
    - síntese (só os resultados), effort low: 93 s com 7,6 mil tokens de saída; o esquema daqui é menor.
    Teto de cada ida: 100 s (a app function tem 120 s). max_tokens: no modelo usado, o raciocínio conta dentro dele; cortar no meio
    perde a chamada (o JSON fica incompleto), por isso o teto fica acima do esperado (não custa mais: cobra o gerado). */
export const PADRAO_LLM = { timeoutMs: 100_000, esforcoOportunidade: "low" as Esforco, esforcoSintese: "low" as Esforco, maxTokensOportunidade: 12_000, maxTokensSintese: 12_000, saidaEstruturada: true };

export type CodigoLLM = "nao-configurado" | "timeout" | "autenticacao" | "limite" | "indisponivel" | "endpoint" | "saida-bloqueada" | "recusa" | "resposta-invalida" | "requisicao";
export class ErroLLM extends Error {
  constructor(public codigo: CodigoLLM, mensagem: string, public extra: { status?: number; tentarDeNovoEmS?: number; detalhe?: string } = {}) {
    super(mensagem);
    this.name = "ErroLLM";
  }
}

/** Configurado de verdade: chave e endereço preenchidos (o modelo do llm.local.example.ts não conta). */
export function llmConfigurado(c: Partial<ConfigLLM> | null | undefined): boolean {
  if (!c?.apiKey || !c.baseURL || !c.model) return false;
  if (/^SUA-|SEU-RECURSO/i.test(c.apiKey) || /SEU-RECURSO/i.test(c.baseURL)) return false;
  try { const u = new URL(c.baseURL); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
}

/** Endereço local = servidor de teste: a resposta diz "LLM simulado", nunca o nome do motor (LLM). */
export function motorDe(c: Partial<ConfigLLM>): MotorLlm {
  let local = false;
  try { local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(new URL(c.baseURL ?? "").hostname); } catch { /* endereço inválido */ }
  return local
    ? { nome: "LLM simulado (servidor local de teste)", provedor: "simulado", modelo: c.model ?? "?", simulado: true }
    : { nome: "LLM (API Messages)", provedor: "api-messages", modelo: c.model ?? "?", simulado: false };
}

/** Tira do texto a chave e qualquer coisa com cara de credencial, e corta. */
export function limparDetalhe(texto: string, c: Partial<ConfigLLM>, max = 300): string {
  let s = String(texto ?? "");
  if (c.apiKey && c.apiKey.length >= 4) s = s.split(c.apiKey).join("[chave]");
  s = s.replace(/\b(x-api-key|api[-_]?key|authorization|bearer)\b\s*[:=]?\s*[^\s,;"']+/gi, "$1 [oculto]")
       .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, "[oculto]")
       .replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface PedidoLLM { sistema: string; usuario: string; schema?: Record<string, unknown> | null }
export interface RespostaLLM { texto: string; estruturado: boolean; modelo: string; tokens: { entrada: number; saida: number } | null; stopReason: string | null; ms: number }
interface CorpoMensagem { model?: string; content?: { type: string; text?: string }[]; stop_reason?: string | null; usage?: { input_tokens?: number; output_tokens?: number }; error?: { type?: string; message?: string } }

const pareceErroDeFormato = (msg: string) => /output_config|format|json_schema|schema/i.test(msg);

/** Uma ida ao LLM. Falha vira ErroLLM com o código do motivo. Se o recurso recusar a saída estruturada (400 citando
    output_config/format), repete uma vez pedindo o JSON só no texto (mesmo motor; a resposta diz estruturado=false). */
export async function chamarLLM(c: ConfigLLM, pedido: PedidoLLM, opcoes: { fetch?: typeof fetch; agora?: () => number } = {}): Promise<RespostaLLM> {
  if (!llmConfigurado(c)) throw new ErroLLM("nao-configurado", "LLM não configurado (app/api/lib/llm.local.ts).");
  const f = opcoes.fetch ?? fetch, agora = opcoes.agora ?? Date.now;
  const timeoutMs = c.timeoutMs ?? PADRAO_LLM.timeoutMs;
  const inicio = agora();
  const usarFormato = (c.saidaEstruturada ?? PADRAO_LLM.saidaEstruturada) && !!pedido.schema;
  try {
    return await umaIda(c, pedido, usarFormato, timeoutMs, f, agora, inicio);
  } catch (e) {
    const restante = timeoutMs - (agora() - inicio);
    if (usarFormato && e instanceof ErroLLM && e.codigo === "requisicao" && pareceErroDeFormato(e.extra.detalhe ?? "") && restante > 15_000) {
      return umaIda(c, pedido, false, restante, f, agora, inicio);
    }
    throw e;
  }
}

async function umaIda(c: ConfigLLM, pedido: PedidoLLM, usarFormato: boolean, timeoutMs: number, f: typeof fetch, agora: () => number, inicio: number): Promise<RespostaLLM> {
  const corpo: Record<string, unknown> = {
    model: c.model,
    max_tokens: c.maxTokens ?? PADRAO_LLM.maxTokensOportunidade,
    system: pedido.sistema,
    messages: [{ role: "user", content: usarFormato ? pedido.usuario : `${pedido.usuario}\n\nResponda somente com o objeto JSON pedido, sem texto antes ou depois.` }],
    // modelos com raciocínio sempre ligado: a profundidade é o effort (thinking explícito desligado dá 400)
    output_config: { effort: c.esforco ?? PADRAO_LLM.esforcoOportunidade, ...(usarFormato && pedido.schema ? { format: { type: "json_schema", schema: pedido.schema } } : {}) },
  };
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), Math.max(1, timeoutMs));
  let r: Response;
  try {
    r = await f(`${c.baseURL.replace(/\/+$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    });
  } catch (e) {
    clearTimeout(relogio);
    throw erroDeRede(e, controle.signal.aborted, timeoutMs, c);
  }
  let bruto = "";
  try { bruto = await r.text(); } catch (e) { clearTimeout(relogio); throw erroDeRede(e, controle.signal.aborted, timeoutMs, c); }
  clearTimeout(relogio);
  let d: CorpoMensagem | null = null;
  try { d = JSON.parse(bruto) as CorpoMensagem; } catch { d = null; }
  const msg = limparDetalhe(d?.error?.message ?? bruto, c);
  if (!r.ok) throw erroHttp(r, msg);
  if (!d) throw new ErroLLM("resposta-invalida", "O LLM respondeu algo que não é JSON.", { detalhe: msg });
  if (d.stop_reason === "refusal") throw new ErroLLM("recusa", "O modelo recusou o pedido (stop_reason: refusal).");
  const texto = (d.content ?? []).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n").trim();
  if (!texto) throw new ErroLLM("resposta-invalida", `Resposta vazia do LLM (stop_reason: ${d.stop_reason ?? "?"}).`);
  return {
    texto, estruturado: usarFormato, modelo: d.model ?? c.model,
    tokens: d.usage ? { entrada: d.usage.input_tokens ?? 0, saida: d.usage.output_tokens ?? 0 } : null,
    stopReason: d.stop_reason ?? null, ms: agora() - inicio,
  };
}

function erroHttp(r: Response, msg: string): ErroLLM {
  const s = r.status;
  const ra = Number(r.headers.get("retry-after"));
  const tentar = Number.isFinite(ra) && ra > 0 ? Math.round(ra) : undefined;
  if (s === 401 || s === 403) return new ErroLLM("autenticacao", `O LLM recusou a chave (HTTP ${s}). Confira apiKey e o acesso ao deployment.`, { status: s, detalhe: msg });
  if (s === 404) return new ErroLLM("endpoint", `Endereço ou deployment do LLM não encontrado (HTTP 404). Confira baseURL e model.`, { status: s, detalhe: msg });
  if (s === 429) return new ErroLLM("limite", `Limite de uso do LLM atingido (HTTP 429).${tentar ? ` Tente de novo em ${tentar} s.` : " Tente de novo em alguns minutos."}`, { status: s, tentarDeNovoEmS: tentar ?? 60, detalhe: msg });
  if (s === 529 || s >= 500) return new ErroLLM("indisponivel", `O LLM está indisponível ou sobrecarregado (HTTP ${s}). Tente de novo em alguns minutos.`, { status: s, tentarDeNovoEmS: tentar, detalhe: msg });
  return new ErroLLM("requisicao", `O LLM recusou o pedido (HTTP ${s}).`, { status: s, detalhe: msg });
}

/** Falha antes da resposta: tempo esgotado, nome que não existe no DNS, conexão recusada, saída bloqueada pelo ambiente. */
function erroDeRede(e: unknown, abortado: boolean, timeoutMs: number, c: Partial<ConfigLLM>): ErroLLM {
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  const texto = [err?.name, err?.code, err?.message, err?.cause?.code, err?.cause?.message].filter(Boolean).join(" ");
  const detalhe = limparDetalhe(texto, c);
  if (abortado || /abort|timeout|timed out/i.test(texto)) return new ErroLLM("timeout", `O LLM não respondeu em ${Math.round(timeoutMs / 1000)} s.`, { detalhe });
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns|lookup|resolve|name or service/i.test(texto)) return new ErroLLM("endpoint", "O endereço do LLM não existe (o nome não resolve no DNS). Confira baseURL: o recurso do Azure pode ter sido apagado.", { detalhe });
  if (/allow ?list|not allowed|outbound|blocked|permitid/i.test(texto)) return new ErroLLM("saida-bloqueada", "O ambiente bloqueou a saída da função para o endereço do LLM. Inclua o host na lista de conexões externas permitidas do AppEngine.", { detalhe });
  if (/ECONNREFUSED|ECONNRESET|connection refused|refused|reset|certificate|tls|ssl/i.test(texto)) return new ErroLLM("endpoint", "Não foi possível conectar ao endereço do LLM (conexão recusada ou erro de TLS).", { detalhe });
  return new ErroLLM("indisponivel", "Falha de rede ao chamar o LLM.", { detalhe });
}
